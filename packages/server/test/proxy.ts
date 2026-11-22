// A local SOCKS5 peer serves an HTTP stream inside the tunnel. The target
// cannot resolve, so getting the first event also verifies proxy-side DNS.
import assert from "node:assert/strict"
import { Database } from "bun:sqlite"
import { decisionService } from "../bin/decision-service.ts"
import { createServer } from "node:net"
import { environmentProxy, fetchVia, outbound } from "../src/proxy-host.ts"

const closed = Promise.withResolvers<void>()
const proxy = createServer((socket) => {
  socket.once("data", (greeting) => {
    assert.equal(greeting[0], 5)
    socket.write(Buffer.from([5, 0]))
    socket.once("data", (connect) => {
      assert.ok(Buffer.isBuffer(connect))
      assert.equal(connect.subarray(5, 5 + connect.readUInt8(4)).toString(), "provider.invalid")
      socket.write(Buffer.from([5, 0, 0, 1, 127, 0, 0, 1, 0, 80]))
      socket.once("data", () => {
        socket.write("HTTP/1.1 200 OK\r\nContent-Type: text/event-stream\r\nConnection: close\r\n\r\ndata: first\n\n")
      })
    })
  })
  socket.on("close", () => closed.resolve())
})
proxy.listen(0, "127.0.0.1")
await new Promise<void>((r) => proxy.once("listening", r))
const address = proxy.address()
assert.ok(address && typeof address === "object")
const controller = new AbortController()
try {
  const response = await outbound(
    "http://provider.invalid/chat",
    { signal: AbortSignal.any([controller.signal, AbortSignal.timeout(5000)]) },
    `socks5h://127.0.0.1:${address.port}`,
  )
  const reader = response.body!.getReader()
  assert.equal(new TextDecoder().decode((await reader.read()).value), "data: first\n\n")
  controller.abort()
  await assert.rejects(reader.read())
  await closed.promise
} finally {
  proxy.close()
}
const target = new URL("https://service.invalid/")
assert.equal(environmentProxy(target, { NO_PROXY: "other.invalid" }), undefined)
assert.equal(environmentProxy(target, { NO_PROXY: ".invalid" }), false)
assert.equal(environmentProxy(target, { HTTPS_PROXY: "proxy.invalid:7890" }), "http://proxy.invalid:7890")
assert.equal(environmentProxy(new URL("https://10.2.3.4"), { NO_PROXY: "10.0.0.0/8" }), false)
assert.equal(environmentProxy(new URL("https://[::1]"), { ALL_PROXY: "socks://proxy.invalid" }), false)

// Abort while the peer is still waiting to answer the SOCKS greeting.
const greeting = Promise.withResolvers<void>()
const ended = Promise.withResolvers<void>()
const stalled = createServer((socket) => {
  socket.once("data", () => greeting.resolve())
  socket.once("close", () => ended.resolve())
}).listen(0, "127.0.0.1")
await new Promise<void>((resolve) => stalled.once("listening", resolve))
try {
  const at = stalled.address()
  assert.ok(at && typeof at === "object")
  const cancel = new AbortController()
  const request = outbound(target, { signal: cancel.signal }, `socks://127.0.0.1:${at.port}`)
  await greeting.promise
  cancel.abort()
  await assert.rejects(request, { name: "AbortError" })
  await Promise.race([
    ended.promise,
    Bun.sleep(1000).then(() => {
      throw new Error("SOCKS handshake socket stayed open")
    }),
  ])
} finally {
  stalled.close()
}

// A forward proxy returns a cross-origin redirect. The second hop must use
// its own route, replay the JSON body and drop the old Authorization header.
const seen: string[] = []
const destination = Bun.serve({
  hostname: "127.0.0.1",
  port: 0,
  async fetch(req) {
    assert.equal(req.headers.get("authorization"), null)
    return new Response(req.method + " " + (await req.text()))
  },
})
const first = Bun.serve({
  hostname: "127.0.0.1",
  port: 0,
  async fetch(req) {
    assert.equal(req.headers.get("authorization"), "Bearer first")
    assert.equal(await req.text(), '{"q":1}')
    return Response.redirect(new URL("/finish", destination.url), 307)
  },
})
try {
  const res = await fetchVia(
    "http://provider.invalid/start",
    { method: "POST", headers: { authorization: "Bearer first" }, body: '{"q":1}', signal: AbortSignal.timeout(5000) },
    async (url) => {
      seen.push(url.href)
      return url.hostname === "provider.invalid" ? first.url.href : false
    },
  )
  assert.equal(await res.text(), 'POST {"q":1}')
  assert.deepEqual(seen, ["http://provider.invalid/start", new URL("/finish", destination.url).href])
} finally {
  await Promise.all([first.stop(true), destination.stop(true)])
}
// The calibration commands share the saved route, even for libraries opened
// read-only before the network migration.
const db = new Database(":memory:")
const responder = (body: string) => Bun.serve({ hostname: "127.0.0.1", port: 0, fetch: () => new Response(body) })
const origin = responder("direct")
const relay = responder("proxy")
try {
  db.exec("create table decision (id integer primary key, json text not null)")
  db.query("insert into decision values (1, ?)").run(JSON.stringify({ enabled: true, driver: "google", model: "test" }))
  const read = async () => (await decisionService(db).fetch(origin.url)).text()
  assert.equal(await read(), "direct")
  db.exec("create table network (id integer primary key, json text not null)")
  db.query("insert into network values (1, ?)").run(JSON.stringify(relay.url.href))
  assert.equal(await read(), "proxy")
  db.query("update decision set json = ? where id = 1").run(
    JSON.stringify({ enabled: true, driver: "google", model: "test", proxy: false }),
  )
  assert.equal(await read(), "direct")
} finally {
  db.close()
  await Promise.all([origin.stop(true), relay.stop(true)])
}
console.log("proxy ok")
