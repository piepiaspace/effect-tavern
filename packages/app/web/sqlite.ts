// bun:sqlite as far as the server's data.ts uses it (exec, query → all/get/run/values, close), on the app's SQLite in
// Go (db.go): one synchronous XMLHttpRequest per call, so data.ts stays synchronous. Android's web view gives the host
// no request body, and MyGo's own patch leaves synchronous requests alone, so the body goes ahead through its bridge
// (putBody, as that patch does) and the request names it in X-MyGo-Body.
type Param = string | number | bigint | null | boolean
const android = (globalThis as { mygoAndroid?: { putBody(id: string, base64: string): void } }).mygoAndroid

const base64 = (bytes: Uint8Array): string => {
  const native = (bytes as { toBase64?: () => string }).toBase64
  if (native) return native.call(bytes)
  let s = ""
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  return btoa(s)
}

const call = (body: { sql: string; params?: Param[]; mode: "exec" | "run" | "rows" }): any => {
  const x = new XMLHttpRequest()
  x.open("POST", "/__db", false)
  const text = JSON.stringify(body, (_k, v) =>
    typeof v === "bigint" ? Number(v) : typeof v === "boolean" ? Number(v) : v,
  )
  if (android) {
    const id = Date.now().toString(36) + Math.random().toString(36).slice(2)
    android.putBody(id, base64(new TextEncoder().encode(text)))
    x.setRequestHeader("X-MyGo-Body", id)
    x.send()
  } else x.send(text)
  if (x.status !== 200) {
    let error = x.responseText || `/__db ${x.status}`
    try {
      error = JSON.parse(x.responseText).error ?? error
    } catch {}
    throw new Error(error)
  }
  return JSON.parse(x.responseText)
}

class Statement {
  constructor(private sql: string) {}
  private rows(p: Param[]): { columns: string[]; rows: unknown[][] } {
    return call({ sql: this.sql, params: p, mode: "rows" })
  }
  all = (...p: Param[]) => {
    const { columns, rows } = this.rows(p)
    return rows.map((r) => Object.fromEntries(columns.map((c, i) => [c, r[i]])))
  }
  get = (...p: Param[]) => this.all(...p)[0] ?? null
  values = (...p: Param[]) => this.rows(p).rows
  run = (...p: Param[]) => call({ sql: this.sql, params: p, mode: "run" })
}

export class Database {
  // The file is Go's. A page that went away inside a transaction (reloaded, its process killed) left Go's one
  // connection in it: a new page starts by ending it.
  constructor(_file: string, _o?: unknown) {
    try {
      call({ sql: "rollback", mode: "exec" })
    } catch {
      // no transaction was open
    }
  }
  exec(sql: string) {
    call({ sql, mode: "exec" })
  }
  query(sql: string) {
    return new Statement(sql)
  }
  close() {}
}
