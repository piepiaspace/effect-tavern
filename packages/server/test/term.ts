// The terminal surface: display widths, the two screens, and failures in plain words. Golden blocks at a phone's 48
// columns and at 100 for local errors, plus whole raw bodies for upstream errors.
import { ConnectionError } from "@effect-tavern/provider"
import assert from "node:assert/strict"
import { once } from "node:events"
import { createServer } from "node:http"
import type { AddressInfo } from "node:net"
import { Cause } from "effect"
import { LibraryHeld, LibraryNewer } from "../src/data.ts"
import { NoModel } from "../src/library.ts"
import { Refused } from "../src/shelf.ts"
import {
  block,
  clip,
  codes,
  explain,
  memoryScreen,
  troubleOf,
  width,
  words,
  wrap,
  type Facts,
  type Lang,
} from "../src/term/index.ts"
import { Busy } from "../src/turn.ts"

// widths: CJK is two cells, escapes none; wrap breaks between words and wide characters, keeps a 「name」 whole
assert.equal(width("故事3 ✓✗"), 8)
assert.equal(width("\x1b[2mab\x1b[22m"), 2)
assert.deepEqual(wrap("one two three", 7), ["one two", "three"])
assert.deepEqual(wrap("到「设置」的「默认模型」里", 16), ["到「设置」的", "「默认模型」里"])
assert.deepEqual(wrap("服务商，好。", 6), ["服务", "商，", "好。"]) // a closing mark never starts a line
assert.deepEqual(wrap("abcdefghij", 4), ["abcd", "efgh", "ij"])
assert.equal(clip("abcdefghijkl", 8), "abcde...")
assert.equal(clip("短", 8), "短")
assert.ok(width(clip("这是一句很长很长的中文句子", 9)) <= 9)

// the memory screen shows rows as a terminal would: a carriage return or an erase-line redraws the row in progress
{
  const s = memoryScreen({ columns: 48, live: true })
  s.write("a 0.1s")
  s.write("\r\x1b[Ka 0.2s")
  s.write("\r\x1b[2Kdone\nnext")
  assert.deepEqual(s.shown(), ["done", "next"])
  assert.equal(s.live, true)
  assert.equal(s.color, false)
}

const HEAD: Record<Lang, string> = {
  zh: "14:07 ✗ 故事3  叙事没有完成  3.1s",
  en: "14:07 ✗ story 3  narrate failed  3.1s",
}
const shown = (columns: number, t: ReturnType<typeof troubleOf>, lang: Lang, color = false) => {
  const s = memoryScreen({ columns, color })
  block(s, HEAD[lang], t)
  return s.shown()
}

const body = "unknown gateway policy\n" + "x".repeat(8192)
for (const lang of ["zh", "en"] as const) {
  const upstream = troubleOf({ code: "upstream", message: "Forbidden", status: 403, body }, lang)
  assert.equal(upstream.next, undefined)
  assert.ok(shown(48, upstream, lang).join("\n").endsWith(body))
}

// every code, worded in both languages, fits both widths with the allowed glyphs only, and the tables hold no more
const ALLOWED = /^[\x20-\x7e　-〿一-鿿＀-￯✓✗]*$/u
const LONG: Omit<Facts, "code"> = {
  message:
    "A very long provider sentence that goes on and on, naming parameters like max_tokens and messages.0.content, well past two lines of a phone.",
  status: 400,
  errno: "ECONNREFUSED",
  host: "very-long-gateway-name.example-provider.com:8443",
  model: "anthropic/claude-sonnet-5-5-20261101-thinking-extended",
  attempts: 3,
  requestId: "req_011CSHoEeqs5C35K2UUqR7Fyxxxxxxxxxxxxxxxxxxxxxxx",
  pid: 48213,
  file: "/data/data/com.termux/files/home/.tavern/tavern.db",
  port: 7777,
  version: 9,
  supported: 7,
}
for (const lang of ["zh", "en"] as Lang[]) {
  assert.deepEqual(Object.keys(words[lang]).sort(), [...codes].sort(), `${lang}: one entry per code`)
  for (const code of codes)
    for (const f of [
      { code, message: "" },
      { ...LONG, code },
    ] as Facts[]) {
      const w = words[lang][code](f)
      assert.ok(w.what && w.next, `${lang} ${code}: what and next`)
      for (const s of [w.what, w.why ?? "", w.next])
        if (s !== f.message && !s.includes(f.model ?? "\0"))
          assert.match(s, ALLOWED, `${lang} ${code}: glyphs in ${JSON.stringify(s)}`)
      for (const columns of [48, 100]) {
        const t = troubleOf(f, lang)
        for (const line of shown(columns, t, lang))
          assert.ok(
            width(line) <= columns - 1,
            `${lang} ${code} at ${columns}: ${JSON.stringify(line)} is ${width(line)}`,
          )
        assert.ok(!shown(columns, t, lang).join("\n").includes("\x1b"), `${lang} ${code}: no escape without colour`)
        const colored = shown(columns, t, lang, true)
        assert.ok(colored.join("\n").includes("\x1b[1m"), `${lang} ${code}: bold with colour`)
        for (const line of colored) assert.ok(width(line) <= columns - 1, `${lang} ${code} coloured at ${columns}`)
      }
    }
}
// the words never carry a status number, a protocol or an SDK's name; the facts line does
for (const lang of ["zh", "en"] as Lang[])
  for (const code of codes) {
    const w = words[lang][code]({ code, message: "" })
    assert.doesNotMatch(
      `${w.what} ${w.why ?? ""} ${w.next}`,
      /\b\d{3}\b|SSE|upstream|AI_|ai-sdk|HTTP/,
      `${lang} ${code}`,
    )
  }

// explain: the server's own failures by code, a model call's by the provider's diagnosis
const code = (e: unknown, lang: Lang = "zh") => explain(e, lang).code
assert.equal(code(new NoModel()), "no-model")
assert.equal(code(new Busy()), "busy")
assert.equal(code(new Refused("card-exists", "card x is already installed")), "card-exists")
assert.equal(code(new ConnectionError("provider-disabled", 'provider "Relay": disabled')), "provider-disabled")
assert.equal(
  explain(new ConnectionError("provider-disabled", 'provider "Relay": disabled'), "en").facts,
  'provider "Relay": disabled',
)
const held = explain(new LibraryHeld("/home/u/.tavern/tavern.db", 4242), "zh")
assert.deepEqual(
  [held.code, held.why, held.facts],
  ["library-held", "进程 4242 已经打开了它。", "pid 4242 /home/u/.tavern/tavern.db"],
)
assert.equal(
  new LibraryHeld("f", 1).message,
  "f is open in process 1, a running tavern: pass --server <its address> to use it, or --data <another directory>",
)
const newer = explain(new LibraryNewer(9, 7), "en")
assert.deepEqual([newer.code, newer.facts], ["library-newer", "user_version 9 > 7"])
assert.equal(code(Cause.fail(new NoModel())), "no-model") // a Cause is squashed first
// a busy port, as listen really fails
{
  const a = createServer().listen(0, "127.0.0.1")
  await once(a, "listening")
  const port = (a.address() as AddressInfo).port
  const b = createServer().listen(port, "127.0.0.1")
  const [e] = (await once(b, "error")) as [Error]
  a.close()
  const t = explain(e, "zh")
  assert.deepEqual([t.code, t.what], ["port-in-use", `端口 ${port} 已被占用`])
}
assert.equal(code("what"), "internal")
assert.equal(code(undefined), "internal")
const defect = new Error("the invariant broke")
assert.equal(explain(defect, "en").raw, defect.stack)

console.log(`term ok: ${codes.length} codes in 2 languages`)
