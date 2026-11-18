import assert from "node:assert/strict"
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
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
  assert.deepEqual(
    [bare.port, bare.portAsked, bare.bind, bare.lang, bare.json, bare.inspect, bare.fake],
    [7777, false, "127.0.0.1", "zh", false, false, false],
  )
  const phone = config({}, world({ PORT: "8080", HOST: "0.0.0.0", TAVERN_URL: "https://m" }))
  assert.deepEqual([phone.port, phone.portAsked, phone.bind, phone.mirror], [8080, true, "0.0.0.0", "https://m"])
  const named = world({ PORT: "1", TAVERN_PORT: "2", TAVERN_BIND: "::1", TAVERN_MIRROR: "https://n", TAVERN_URL: "x" })
  assert.deepEqual([config({}, named).port, config({}, named).bind, config({}, named).mirror], [2, "::1", "https://n"])
  assert.equal(config({ port: 3 }, named).port, 3)
  assert.throws(() => config({}, world({ PORT: "eighty" })), /PORT=eighty is not a port/)
  const set = config({}, world({ TAVERN_LANG: "en", TAVERN_INSPECT: "1", MODEL: "fake", TAVERN_SERVER: "http://x" }))
  assert.deepEqual([set.lang, set.inspect, set.fake, set.server], ["en", true, true, "http://x"])
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
  for (const word of ["serve", "card", "depot", "story", "play", "--data", "--server", "--json"])
    assert.ok(help.includes(word), word)
  for (const absent of ["--wizard", "--log-level", "--completions"]) assert.ok(!help.includes(absent), absent)
  assert.match(await done("card", "--help"), /unroll/)
  // a wrong command line: exit 2, what was wrong on stderr, nothing on stdout
  const wrong = await run(["story", "list", "--bogus"])
  assert.equal(wrong.code, 2)
  assert.equal(wrong.out, "")
  assert.match(wrong.err, /--bogus[^]*> tavern story list --help/)
  assert.equal((await run(["story", "drop", "1"])).code, 2)
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
  assert.match(refused.err, /bad\.yaml did not pass card check/)
  const missing = await run(["play", "999999", "--input", "hello"])
  assert.equal(missing.code, 1)
  assert.match(missing.err, /no story 999999/)
  assert.equal((await run(["card", "check", "bad.yaml"])).code, 1)
  // nothing answers at --server: exit 3
  const nobody = await run(["story", "list", "--server", "http://127.0.0.1:9"])
  assert.equal(nobody.code, 3)
  assert.match(nobody.err, /nothing answers at http:\/\/127\.0\.0\.1:9/)
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
try {
  await ok("card", "check", file)
  assert.deepEqual(JSON.parse(await ok("card", "install", file, "--json")), { id: "cli", installed: true })
  const { id: story } = JSON.parse(await ok("story", "new", "cli", "--json"))
  assert.equal(JSON.parse(await ok("story", "list", "--json"))[0].id, story)
  const numericFile = join(dir, "numeric.yaml")
  writeFileSync(numericFile, scaffold(String(story), "chat"))
  await ok("card", "install", numericFile)
  const numericEvents = (await ok("play", String(story), "--card", "--user", "阿青", "--input", "/greet", "--jsonl"))
    .trim()
    .split("\n")
    .map((s) => JSON.parse(s))
  const numericId = numericEvents.find((e) => e.kind === "story").id
  assert.notEqual(numericId, story)
  assert.equal(JSON.parse(await ok("story", "export", String(numericId), "--json")).card.id, String(story))
  assert.deepEqual(JSON.parse(await ok("story", "remove", String(numericId), "--json")), {
    id: numericId,
    removed: true,
  })
  assert.match(await ok("story", "show", String(story)), /Story .*head root/)
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
  const saved = JSON.parse(await ok("story", "export", String(story), "--format", "json"))
  assert.equal(saved.snapshot.nodes.length, 2)
  assert.match(await ok("story", "export", String(story)), /hello world/)
  await ok("play", String(story), "--input", "/greet")
  const before = JSON.parse(await ok("story", "show", String(story), "--json"))

  server = Bun.spawn(["bun", bin, "serve", "--headless", "-p", "0"], { cwd: dir, env, stdout: "pipe", stderr: "pipe" })
  const url = await announced(server)
  assert.match(url, /\/api$/)
  assert.equal((await fetch(url.replace(/\/api$/, "/"))).status, 404)
  const named = (await (await fetch(`${url}/cards/cli`)).json()) as { layer: { names: { user?: string } } }
  assert.equal(named.layer.names.user, "阿青")
  // the library is held: exit 3, naming the way through
  const held = await spawned("story", "list")
  assert.equal(held.code, 3)
  assert.match(held.err, /is open in process \d+[^]*--server/)
  const heldInProcess = await run(["story", "list"], { DATA: dir })
  assert.equal(heldInProcess.code, 3)
  // --server never opens the library, even though this one is held; before or after the command
  assert.deepEqual(JSON.parse(await ok("story", "show", String(story), "--json", "--server", url)), before)
  await ok("--server", url, "card", "install", file)
  const remote = Number(await ok("story", "new", "cli", "--server", url))
  await ok("play", String(remote), "--server", url, "--input", "remote hello", "--jsonl")
  assert.match(await ok("story", "export", String(remote), "--server", url), /remote hello/)
  await ok("play", String(remote), "--server", url, "--input", "/checkout root", "--jsonl")
  await ok("play", String(remote), "--server", url, "--input", "/tree", "--jsonl")
  await ok("play", String(remote), "--server", url, "--input", "/context", "--jsonl")
  await ok("play", String(remote), "--server", url, "--input", "/detail 0", "--jsonl")
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
  assert.equal(JSON.parse(await ok("story", "list", "--json")).length, 1)
  // A bare `tavern` serves, as start.sh runs it: the legacy names, explicit inspect and clean shutdown.
  for (const inspect of [false, true]) {
    server = Bun.spawn(["bun", bin], {
      cwd: dir,
      env: { ...env, PORT: "0", TAVERN_INSPECT: inspect ? "1" : "0" },
      stdout: "pipe",
      stderr: "pipe",
    })
    // the page's address when the client build is there, the API's when it is not
    const api = (await announced(server)).replace(/\/api$/, "") + "/api"
    const headers = { "x-tavern-story": String(story) }
    const trace = await (await fetch(`${api}/nodes/0/trace`, { headers })).json()
    assert.ok(trace.length > 0)
    assert.equal(
      trace.some((c: { msgs: unknown[] }) => c.msgs.length > 0),
      inspect,
    )
    server.kill("SIGTERM")
    assert.equal(await server.exited, 0)
    server = undefined
  }
  // The terminal loop accepts a pipe; no raw-mode input is needed.
  const child = Bun.spawn(["bun", bin, "play", String(story), "--jsonl"], {
    cwd: dir,
    env,
    stdin: new Blob(["/note continue\n/tree\n/quit\n"]),
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
  const api = createServer(
    app(async (_req, res) => {
      res.end("api")
    }, staticRoot(dist)),
  )
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
