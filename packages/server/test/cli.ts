import assert from "node:assert/strict"
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { scaffold } from "@effect-tavern/runtime/support/author.ts"
import { createServer } from "node:http"
import type { AddressInfo } from "node:net"
import { run as tavern } from "../bin/tavern.ts"
import { config, type World } from "../src/cli/config.ts"
import { readEvents } from "../src/cli-host.ts"
import type { CliEvent } from "../src/cli-host.ts"
import { staticRoot } from "../src/start.ts"
import { app } from "../src/serve.ts"
import { node } from "../src/wire.ts"

const dir = mkdtempSync(join(tmpdir(), "tavern-cli-"))
const bin = new URL("../bin/tavern.ts", import.meta.url).pathname

// The settings: flag > TAVERN_* > the legacy name > default; the binary's library is ~/.tavern, source's ./.tavern.
{
  const world = (env: Record<string, string>): World => ({
    env,
    home: "/home/p",
    cwd: "/work",
    out: { write: () => {} },
    err: { write: () => {} },
  })
  assert.equal(config({}, world({}), "binary").data, "/home/p/.tavern")
  assert.equal(config({}, world({}), "source").data, "/work/.tavern")
  assert.equal(config({}, world({ DATA: "lib" }), "binary").data, "/work/lib")
  assert.equal(config({}, world({ DATA: "/a", TAVERN_DATA: "/b" })).data, "/b")
  assert.equal(config({ data: "/c" }, world({ DATA: "/a", TAVERN_DATA: "/b" })).data, "/c")
  const bare = config({}, world({}))
  assert.deepEqual([bare.port, bare.bind, bare.lang, bare.json, bare.fake], [7777, "127.0.0.1", "zh", false, false])
  const phone = config({}, world({ PORT: "8080", HOST: "0.0.0.0", TAVERN_URL: "https://m" }))
  assert.deepEqual([phone.port, phone.bind, phone.mirror], [8080, "0.0.0.0", "https://m"])
  const named = world({ PORT: "1", TAVERN_PORT: "2", TAVERN_BIND: "::1", TAVERN_MIRROR: "https://n", TAVERN_URL: "x" })
  assert.deepEqual([config({}, named).port, config({}, named).bind, config({}, named).mirror], [2, "::1", "https://n"])
  assert.equal(config({ port: 3 }, named).port, 3)
  assert.throws(() => config({}, world({ PORT: "eighty" })), /PORT=eighty is not a port/)
  const set = config({}, world({ TAVERN_LANG: "en", MODEL: "fake", TAVERN_SERVER: "http://x" }))
  assert.deepEqual([set.lang, set.fake, set.server], ["en", true, "http://x"])
  assert.equal(config({ server: "http://y" }, world({ TAVERN_SERVER: "http://x" })).server, "http://y")
  assert.equal(set.version, "dev")
}

// In process: run(argv, world) with the world's stdout and stderr as strings.
const inProcess = join(dir, "in-process")
mkdirSync(inProcess)
const run = async (argv: string[], env: Record<string, string> = {}) => {
  let out = ""
  let err = ""
  const code = await tavern(argv, {
    env: { DATA: join(inProcess, "library"), MODEL: "fake", ...env },
    home: inProcess,
    cwd: inProcess,
    out: { write: (s) => void (out += s) },
    err: { write: (s) => void (err += s) },
  })
  return { code, out, err }
}
const done = async (...argv: string[]) => {
  const result = await run(argv)
  assert.equal(result.code, 0, result.err)
  return result.out
}
{
  assert.equal(await done("--version"), "tavern dev\n")
  assert.equal(await done("-V"), "tavern dev\n")
  const help = await done("--help")
  assert.equal(await done(), help)
  assert.equal(await done("help", "start"), await done("start", "-h"))
  assert.equal((await run(["serve"])).code, 2)
  assert.equal((await run(["--port", "7777"])).code, 2)
  for (const word of ["start", "card", "depot", "story", "play", "--data", "--server", "--json"])
    assert.ok(help.includes(word), word)
  for (const absent of ["--wizard", "--log-level", "--completions"]) assert.ok(!help.includes(absent), absent)
  assert.match(await done("card", "--help"), /unroll/)
  // a wrong command line: exit 2, what was wrong on stderr, nothing on stdout
  const wrong = await run(["story", "list", "--bogus"])
  assert.equal(wrong.code, 2)
  assert.equal(wrong.out, "")
  assert.match(wrong.err, /--bogus[^]*> tavern story list --help/)
  assert.equal((await run(["story", "drop", "1"])).code, 2)
  // `help` is --help, for the root and for a group
  const helped = await run(["help"])
  assert.deepEqual([helped.code, helped.out], [0, (await run(["--help"])).out])
  assert.equal((await run(["help", "card"])).out, (await run(["card", "--help"])).out)
  // files are read against the world's directory
  assert.match(await done("card", "init", "one"), /Created one\.yaml/)
  assert.ok(existsSync(join(inProcess, "one.yaml")))
  await done("card", "check", "one.yaml")
  assert.deepEqual(JSON.parse(await done("card", "install", "one.yaml", "--json")), { id: "one", installed: true })
  assert.ok(existsSync(join(inProcess, "library", "tavern.db")))
  // --json and --data anywhere, before or after the command
  assert.equal(JSON.parse(await done("--json", "card", "list"))[0].id, "one")
  const elsewhere = join(inProcess, "elsewhere")
  assert.deepEqual(JSON.parse(await done("--data", elsewhere, "story", "list", "--json")), [])
  assert.ok(existsSync(join(elsewhere, "tavern.db")))
  const { id } = JSON.parse(await done("story", "new", "one", "--json"))
  assert.equal(JSON.parse(await done("story", "list", "--json"))[0].id, id)
  assert.deepEqual(JSON.parse(await done("story", "remove", String(id), "--json")), { id, removed: true })
  // `story delete` stays for one release, out of help
  const again = JSON.parse(await done("story", "new", "one", "--json")).id
  assert.deepEqual(JSON.parse(await done("story", "delete", String(again), "--json")), { id: again, removed: true })
  assert.ok(!(await done("story", "--help")).includes("delete"))
  // refused or failed: exit 1
  writeFileSync(join(inProcess, "bad.yaml"), "id: bad\n")
  const refused = await run(["card", "install", "bad.yaml"])
  assert.equal(refused.code, 1)
  // in plain words: the gate's own lines under one first line, and the shelf left as it was
  assert.match(
    refused.err,
    /^✗ bad 没有上架：卡片里有 \d 处要先改\n    \$ [^]*tavern card check bad\.yaml\n  书架上原来的 bad 没有被改动。\n$/,
  )
  const missing = await run(["play", "999999", "--input", "hello"])
  assert.equal(missing.code, 1)
  assert.match(missing.err, /no story 999999/)
  assert.equal((await run(["card", "check", "bad.yaml"])).code, 1)
  // nothing answers at --server: exit 3
  const nobody = await run(["story", "list", "--server", "http://127.0.0.1:9"])
  assert.equal(nobody.code, 3)
  assert.match(nobody.err, /连不上酒馆[^]*> /) // in plain words: what happened, why, the next step
  assert.doesNotMatch(nobody.err, /nothing answers/)
  // in-process, one open after another in one process: each command closed its library and let the lock go
  assert.ok(!existsSync(join(inProcess, "library", "tavern.db.lock")))
}

// As processes: the shared library, serve, --server and the terminal loop.
const env = { ...process.env, DATA: dir, MODEL: "fake" }
const spawned = async (...args: string[]) => {
  const child = Bun.spawn(["bun", bin, ...args], { cwd: dir, env, stdout: "pipe", stderr: "pipe" })
  const [code, out, err] = await Promise.all([
    child.exited,
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
  ])
  return { code, out, err }
}
const ok = async (...args: string[]) => {
  const result = await spawned(...args)
  assert.equal(result.code, 0, result.err)
  return result.out
}
const file = join(dir, "cli.yaml")
writeFileSync(file, scaffold("cli", "chat"))
let server: ReturnType<typeof Bun.spawn> | undefined
/** The address a starting server's banner names on stderr (its 地址 row). */
const announced = async (child: ReturnType<typeof Bun.spawn>) => {
  const reader = (child.stderr as ReadableStream<Uint8Array>).getReader()
  let text = ""
  while (!/http:\/\/\S+\n/.test(text)) {
    const { value, done } = await reader.read()
    if (done) throw new Error(`serve exited: ${text}`)
    text += new TextDecoder().decode(value)
  }
  reader.releaseLock()
  return /http:\/\/\S+/.exec(text)![0]
}
/** The same commands in this process, on the same directory: run(argv, world), stdout as a string, no spawn. */
const here = async (...args: string[]) => {
  const result = await run(args, { DATA: dir })
  assert.equal(result.code, 0, result.err)
  return result.out
}
try {
  // A valid card file in the working directory does not install itself.
  assert.deepEqual(JSON.parse(await here("card", "list", "--json")), [])
  await here("card", "check", file)
  assert.deepEqual(JSON.parse(await here("card", "install", file, "--json")), { id: "cli", installed: true })
  const { id: story } = JSON.parse(await here("story", "new", "cli", "--json"))
  assert.equal(JSON.parse(await here("story", "list", "--json"))[0].id, story)
  const numericFile = join(dir, "numeric.yaml")
  writeFileSync(numericFile, scaffold(String(story), "chat"))
  await here("card", "install", numericFile)
  const numericEvents = (await ok("play", String(story), "--card", "--user", "阿青", "--input", "/greet", "--jsonl"))
    .trim()
    .split("\n")
    .map((s) => JSON.parse(s))
  const numericId = numericEvents.find((e) => e.kind === "story").id
  assert.notEqual(numericId, story)
  assert.equal(JSON.parse(await here("story", "export", String(numericId), "--json")).card.id, String(story))
  assert.deepEqual(JSON.parse(await here("story", "remove", String(numericId), "--json")), {
    id: numericId,
    removed: true,
  })
  assert.match(await here("story", "show", String(story)), /Story .*head root/)
  // the template leaves `{{user}}` to the player: unnamed, the turn goes through with the literal (names.ts); `--user`
  // names them on the card, kept (the card's resolved names, read from the server below)
  const turn = async (...flags: string[]) =>
    (await ok("play", String(story), ...flags, "--input", "hello", "--model", "fake", "--jsonl"))
      .trim()
      .split("\n")
      .map((s) => JSON.parse(s))
  const unnamed = await turn()
  assert.ok(unnamed.some((e) => e.kind === "change" && e.node?.settlementStatus === "committed"))
  const events = await turn("--user", "阿青")
  assert.ok(events.some((e) => e.kind === "delta"))
  assert.ok(events.some((e) => e.kind === "change" && e.node?.settlementStatus === "committed"))
  const saved = JSON.parse(await here("story", "export", String(story), "--format", "json"))
  assert.equal(saved.snapshot.nodes.length, 2)
  assert.match(await here("story", "export", String(story)), /hello world/)
  await ok("play", String(story), "--input", "/greet")
  const before = JSON.parse(await here("story", "show", String(story), "--json"))

  server = Bun.spawn(["bun", bin, "start", "--headless", "-p", "0"], { cwd: dir, env, stdout: "pipe", stderr: "pipe" })
  const url = await announced(server)
  assert.match(url, /\/api$/)
  assert.equal((await fetch(url.replace(/\/api$/, "/"))).status, 404)
  const named = (await (await fetch(`${url}/cards/cli`)).json()) as { layer: { names: { user?: string } } }
  assert.equal(named.layer.names.user, "阿青")
  // Two processes on one directory: serve holds the library and says its address beside the lock; a command finds it
  // there, says it went through it, and its writes are the server's.
  const address = JSON.parse(readFileSync(join(dir, "tavern.db.address"), "utf8")) as { pid: number; url: string }
  assert.deepEqual(address, { pid: server.pid, url: url.replace(/\/api$/, "") })
  assert.equal(readFileSync(join(dir, "tavern.db.lock"), "utf8"), String(server.pid))
  const found = await spawned("story", "list", "--json")
  assert.equal(found.code, 0, found.err)
  assert.equal(found.err, `经由正在运行的酒馆 ${address.url}\n`)
  assert.equal(JSON.parse(found.out)[0].id, story)
  const second = join(dir, "second.yaml")
  writeFileSync(second, scaffold("second", "chat"))
  await ok("card", "install", second)
  assert.ok(((await (await fetch(`${url}/cards`)).json()) as { id: string }[]).some((c) => c.id === "second"))
  const foundInProcess = await run(["card", "list", "--json"], { DATA: dir })
  assert.equal(foundInProcess.code, 0, foundInProcess.err)
  assert.ok((JSON.parse(foundInProcess.out) as { id: string }[]).some((c) => c.id === "second"))
  // a turn through the server, the same kinds of events as one in-process
  const through = (await ok("play", String(story), "--input", "through", "--jsonl"))
    .trim()
    .split("\n")
    .map((s) => JSON.parse(s).kind as string)
  assert.ok(through.includes("delta") && through.at(-1) === "change", through.join())
  const now = JSON.parse(await ok("story", "show", String(story), "--json"))
  assert.equal(now.nodes.length, before.nodes.length + 1)
  // a second serve on the same directory is not an error: it says one runs, and where
  const twice = await spawned("start", "--headless", "-p", "0")
  assert.equal(twice.code, 0, twice.err)
  assert.ok(twice.err.startsWith(`✓ 酒馆已经在运行\n  地址  ${address.url}\n`), twice.err)
  assert.equal(twice.out, "")
  // --server names the same one; before or after the command
  assert.deepEqual(JSON.parse(await ok("story", "show", String(story), "--json", "--server", url)), now)
  await ok("--server", url, "card", "install", file)
  const remote = Number(await ok("story", "new", "cli", "--server", url))
  await ok("play", String(remote), "--server", url, "--input", "remote hello", "--jsonl")
  assert.match(await ok("story", "export", String(remote), "--server", url), /remote hello/)
  await ok("play", String(remote), "--server", url, "--input", "/checkout root", "--jsonl")
  const readCommand = async (command: string, kind: string) => {
    const output = await ok("play", String(remote), "--server", url, "--input", command, "--jsonl")
    const result = JSON.parse(output.trimEnd().split("\n").at(-1)!)
    assert.equal(result.kind, kind)
    return result.value
  }
  const tree = await readCommand("/tree", "tree")
  assert.equal(tree.head, null)
  assert.deepEqual(
    tree.nodes.map((n: { input: { text: string } }) => n.input.text),
    ["remote hello"],
  )
  assert.deepEqual((await readCommand("/context", "context")).worldState.lore, {})
  assert.equal((await readCommand("/detail 0", "detail")).id, 0)
  assert.deepEqual(JSON.parse(await ok("story", "remove", String(remote), "--server", url, "--json")), {
    id: remote,
    removed: true,
  })
  // the server's refusal in its own words, not its JSON body
  const gone = await spawned("story", "show", String(remote), "--server", url)
  assert.equal(gone.code, 1)
  assert.doesNotMatch(gone.err, /^\{|"error"/)
  const invalid = await fetch(`${url}/cards`, { method: "POST", body: JSON.stringify({ id: "bad" }) })
  assert.equal(invalid.status, 400)
  server.kill("SIGTERM")
  assert.equal(await server.exited, 0)
  server = undefined
  // stopped: its address and its lock are gone, and the next command opens the library itself, saying nothing
  assert.ok(!existsSync(join(dir, "tavern.db.address")))
  assert.ok(!existsSync(join(dir, "tavern.db.lock")))
  const alone = await spawned("story", "list", "--json")
  assert.deepEqual([alone.code, alone.err, JSON.parse(alone.out).length], [0, "", 1])
  // Starting with PORT honors it, the trace carries the call bodies, and it shuts down cleanly.
  {
    server = Bun.spawn(["bun", bin, "start"], {
      cwd: dir,
      env: { ...env, PORT: "0" },
      stdout: "pipe",
      stderr: "pipe",
    })
    // the page's address when the client build is there, the API's when it is not
    const api = (await announced(server)).replace(/\/api$/, "") + "/api"
    const headers = { "x-tavern-story": String(story) }
    const trace = await (await fetch(`${api}/nodes/0/trace`, { headers })).json()
    assert.ok(trace.length > 0)
    for (const call of trace) {
      assert.ok(call.msgs.length > 0)
    }
    server.kill("SIGTERM")
    assert.equal(await server.exited, 0)
    server = undefined
  }
  // The terminal loop accepts a pipe; no raw-mode input is needed.
  const child = Bun.spawn(["bun", bin, "play", String(story), "--jsonl"], {
    cwd: dir,
    env,
    stdin: new Blob(["/note continue\r\n/tree\r\n/quit\r\n"]),
    stdout: "pipe",
    stderr: "pipe",
  })
  const [code, out, err] = await Promise.all([
    child.exited,
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
  ])
  assert.equal(code, 0, err)
  assert.ok(
    out
      .split("\n")
      .filter(Boolean)
      .map((s) => JSON.parse(s))
      .some((e) => e.kind === "tree"),
  )
  // A failing piped line stops all already-buffered later mutations, for command and turn failures.
  for (const bad of ["/badcmd", "/pin card:missing"]) {
    const prior = JSON.parse(await ok("story", "show", String(story), "--json"))
    const pipe = Bun.spawn(["bun", bin, "play", String(story), "--jsonl"], {
      cwd: dir,
      env,
      stdin: new Blob([`/act before\n${bad}\n/act AFTER-ERROR\n`]),
      stdout: "pipe",
      stderr: "pipe",
    })
    const [status, output, error] = await Promise.all([
      pipe.exited,
      new Response(pipe.stdout).text(),
      new Response(pipe.stderr).text(),
    ])
    assert.equal(status, 1, error)
    assert.match(error, bad === "/badcmd" ? /unknown command/ : /not invocable/)
    assert.doesNotMatch(output, /AFTER-ERROR/)
    const after = JSON.parse(await ok("story", "show", String(story), "--json"))
    assert.equal(after.nodes.length, prior.nodes.length + 1)
  }
  // Missing client build gives pure API routing; a built index opts static serving in.
  const dist = join(dir, "client-dist")
  assert.equal(staticRoot(dist), undefined)
  const api = createServer(node(app(async () => new Response("api"), staticRoot(dist))))
  await new Promise<void>((resolve) => api.listen(0, "127.0.0.1", resolve))
  try {
    const origin = `http://127.0.0.1:${(api.address() as AddressInfo).port}`
    assert.equal(await (await fetch(origin + "/api")).text(), "api")
    assert.equal(await (await fetch(origin + "/")).text(), "not found")
    assert.equal((await fetch(origin + "/missing.js")).status, 404)
  } finally {
    await new Promise<void>((resolve) => api.close(() => resolve()))
  }
  mkdirSync(dist)
  writeFileSync(join(dist, "index.html"), "built")
  assert.equal(staticRoot(dist), dist)
} finally {
  server?.kill()
  if (server) await server.exited
  rmSync(dir, { recursive: true, force: true })
}
// A byte at a time, including a multibyte character, CRLF and an attach snapshot.
const bytes = new TextEncoder().encode(
  'event: attach\r\ndata: {"phase":null,"draft":null}\r\n\r\nevent: error\ndata: {"kind":"error","phase":"narrate","message":"错误"}\n\n',
)
const got: CliEvent[] = []
await readEvents(
  new Response(
    new ReadableStream({
      start(c) {
        for (const byte of bytes) c.enqueue(new Uint8Array([byte]))
        c.close()
      },
    }),
  ),
  (e) => got.push(e),
)
assert.equal(got[0]?.kind, "attach")
assert.equal(got[1]?.kind === "error" && got[1].message, "错误")
await assert.rejects(
  readEvents(new Response('data: {"kind":"change"}'), () => {}),
  /incomplete/,
)
console.log("cli ok")
