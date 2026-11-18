// The terminal surface: display widths, the two screens, and failures in plain words. Golden blocks at a phone's 48
// columns and at 100 in both languages; for every code, in both languages, at both widths: words exist, every line
// fits `columns - 1` cells, only the allowed glyphs, no escape bytes without colour. And `explain` reads the server's
// own failures by their codes and a model call's through the provider's `diagnose`.
import { ConnectionError } from "@effect-tavern/provider"
import { faultCodes, type Fault } from "@effect-tavern/provider/src/fault.ts"
import clientEn from "../../client/src/locales/en.ts"
import clientZh from "../../client/src/locales/zh-CN.ts"
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

const keyRefused: Fault = {
  code: "key-refused",
  message: "invalid x-api-key",
  status: 401,
  type: "authentication_error",
  host: "api.anthropic.com",
}
const rateLimited: Fault = {
  code: "rate-limited",
  message: "This request would exceed your organization's rate limit",
  status: 429,
  type: "rate_limit_error",
  host: "api.anthropic.com",
  attempts: 3,
  retryAfter: 20,
}
const unknown: Fault = {
  code: "unknown",
  message:
    "request ends in an assistant message, and this connection does not take a prefill (capabilities.prefill is false): end the hat's tail in a user or system message",
}
const golden: [Fault, Lang, number, string[]][] = [
  [
    keyRefused,
    "zh",
    48,
    [
      "14:07 ✗ 故事3  叙事没有完成  3.1s",
      "  服务商不认这把密钥",
      "  密钥可能填错、过期，或已被停用。",
      "  > 到「设置」的「模型服务」里重新填写这家的",
      "    API 密钥，再发送一次。",
      "  HTTP 401 authentication_error",
      "  api.anthropic.com",
    ],
  ],
  [
    keyRefused,
    "en",
    48,
    [
      "14:07 ✗ story 3  narrate failed  3.1s",
      "  The provider refused the key",
      "  The key may be mistyped, expired or revoked.",
      "  > In Settings, under Providers, enter this",
      "    provider's API key again, then send again.",
      "  HTTP 401 authentication_error",
      "  api.anthropic.com",
    ],
  ],
  [
    keyRefused,
    "zh",
    100,
    [
      "14:07 ✗ 故事3  叙事没有完成  3.1s",
      "  服务商不认这把密钥",
      "  密钥可能填错、过期，或已被停用。",
      "  > 到「设置」的「模型服务」里重新填写这家的 API 密钥，再发送一次。",
      "  HTTP 401 authentication_error api.anthropic.com",
    ],
  ],
  [
    keyRefused,
    "en",
    100,
    [
      "14:07 ✗ story 3  narrate failed  3.1s",
      "  The provider refused the key",
      "  The key may be mistyped, expired or revoked.",
      "  > In Settings, under Providers, enter this provider's API key again, then send again.",
      "  HTTP 401 authentication_error api.anthropic.com",
    ],
  ],
  [
    rateLimited,
    "zh",
    48,
    [
      "14:07 ✗ 故事3  叙事没有完成  3.1s",
      "  发得太快，服务商要你等一等",
      "  短时间内请求太多，或账户的速率上限较低。",
      "  > 等 20 秒左右，再发送一次。",
      "  HTTP 429 rate_limit_error api.anthropic.com",
      "  试了3次 retry-after=20s",
    ],
  ],
  [
    rateLimited,
    "en",
    100,
    [
      "14:07 ✗ story 3  narrate failed  3.1s",
      "  Too fast: the provider asks you to wait",
      "  Too many requests in a short time, or the account's rate limit is low.",
      "  > Wait about 20 seconds, then send again.",
      "  HTTP 429 rate_limit_error api.anthropic.com tries=3 retry-after=20s",
    ],
  ],
  [
    // an error never seen: the thrower's own sentence, two lines at most, and where to send it
    unknown,
    "zh",
    48,
    [
      "14:07 ✗ 故事3  叙事没有完成  3.1s",
      "  遇到一个没见过的错误",
      "  request ends in an assistant message, and",
      "  this connection does not take a prefill...",
      "  > 再试一次；还不行，就把这几行发给帮你的人。",
    ],
  ],
  [
    unknown,
    "en",
    48,
    [
      "14:07 ✗ story 3  narrate failed  3.1s",
      "  An error we have not seen before",
      "  request ends in an assistant message, and",
      "  this connection does not take a prefill...",
      "  > Try again; if it keeps happening, send",
      "    these lines to whoever helps you.",
    ],
  ],
]
for (const [f, lang, columns, want] of golden)
  assert.deepEqual(shown(columns, troubleOf(f, lang), lang), want, `${f.code} ${lang} ${columns}`)

// every code, worded in both languages, fits both widths with the allowed glyphs only, and the tables hold no more
const ALLOWED = /^[\x20-\x7e　-〿一-鿿＀-￯✓✗]*$/u
const LONG: Omit<Facts, "code"> = {
  message:
    "A very long provider sentence that goes on and on, naming parameters like max_tokens and messages.0.content, well past two lines of a phone.",
  status: 400,
  type: "invalid_request_error_with_a_rather_long_name",
  errno: "ECONNREFUSED",
  host: "very-long-gateway-name.example-provider.com:8443",
  model: "anthropic/claude-sonnet-5-5-20261101-thinking-extended",
  retryAfter: 3600,
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
        if (s !== f.message && !s.includes(f.model ?? "\0") && !(w.why === s && code === "bad-request"))
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

// the terminal and the browser say the same thing about a failed turn: the client's `fault` words (its own locale
// files, drawn by code) are these words
{
  const client = { zh: clientZh.fault, en: clientEn.fault } as Record<Lang, Record<string, string>>
  const camel = (code: string) => code.replace(/-(\w)/g, (_, c: string) => c.toUpperCase())
  for (const lang of ["zh", "en"] as Lang[])
    for (const code of faultCodes) {
      if (code === "unknown") continue
      const w = words[lang][code]({ code, message: "" })
      const k = camel(code)
      assert.deepEqual(
        [w.what, w.why, w.next],
        [client[lang][k], client[lang][`${k}Why`], client[lang][`${k}Next`]],
        `${lang} ${code}: the client's words`,
      )
    }
}

// explain: the server's own failures by code, a model call's by the provider's diagnosis
const code = (e: unknown, lang: Lang = "zh") => explain(e, lang).code
assert.equal(code(new NoModel()), "no-model")
assert.equal(code(new Busy()), "busy")
assert.equal(code(new Refused("card-in-use", "card x has 2 stories")), "card-in-use")
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
// a model call's failure: the ai-sdk chain under call.ts's ModelError (fields as the SDK sets them)
{
  const api = Object.assign(new Error("invalid x-api-key"), {
    name: "AI_APICallError",
    statusCode: 401,
    url: "https://api.anthropic.com/v1/messages",
    responseBody: JSON.stringify({
      type: "error",
      error: { type: "authentication_error", message: "invalid x-api-key" },
    }),
    requestBodyValues: { model: "claude-haiku-5-5" },
  })
  const t = explain(Object.assign(new Error("invalid x-api-key"), { name: "ModelError", cause: api }), "zh")
  assert.deepEqual(
    [t.code, t.what, t.facts],
    ["key-refused", "服务商不认这把密钥", "HTTP 401 authentication_error api.anthropic.com claude-haiku-5-5"],
  )
}
assert.equal(code("what"), "unknown")
assert.equal(code(undefined), "unknown")

console.log(`term ok: ${codes.length} codes in 2 languages`)
