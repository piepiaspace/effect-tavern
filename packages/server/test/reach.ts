// One transport (wire.ts) and how a command finds its library (reach.ts, announce.ts). The terminal's operations
// (cli-host.ts `host`) run against the handler called in-process, with no spawn and no port, and the same calls over a
// real listener through the node bridge answer the same, refusals included. A turn streams incrementally both ways,
// and a reader going away stops nothing. A command reaches: the library itself when nobody holds it; the owner by its
// announced address; never a tavern on a real model under MODEL=fake; a live owner that never says its address is
// exit 3 naming its pid; a stale address is ignored and removed.
import { fake, fakeText } from "@effect-tavern/provider"
import { chat, plain as player } from "@effect-tavern/runtime/test/cards/index.ts"
import { printCard } from "@effect-tavern/runtime/support/author.ts"
import { defaultAnswer, readStage } from "@effect-tavern/runtime/support/script.ts"
import assert from "node:assert/strict"
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { createServer } from "node:http"
import type { AddressInfo } from "node:net"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { run as tavern } from "../bin/tavern.ts"
import type { Writer } from "../src/cli/config.ts"
import { addressFile, announce, announced, libraryFile, local, lockFile } from "../src/announce.ts"
import { Answered, host, type CliEvent, type CliHost } from "../src/cli-host.ts"
import { open } from "../src/data.ts"
import { library } from "../src/library.ts"
import { HostNotScripted, HostSilent, reach } from "../src/reach.ts"
import { app, handle } from "../src/serve.ts"
import { shelf } from "../src/shelf.ts"
import { node, over, Unreachable } from "../src/wire.ts"

process.env.NO_PROXY = "localhost,127.0.0.1"
const dir = mkdtempSync(join(tmpdir(), "tavern-reach-"))
const canned = { notes: "N1", options: ["A", "B", "C", "D"], people: [], scene: { place: "P", present: [] } }
/** Prose a word at a time, slowly when the line asks for it: what lets a test see a stream arrive in pieces. */
const model = fake((o) => {
  const doc = readStage(o)
  if (doc.phase !== "narrate") return defaultAnswer(doc, canned)
  return o.prompt.some((m) => /slow/.test(fakeText(m)))
    ? { text: "hello world ".repeat(20), delay: 20 }
    : { text: "done." }
})
const lib = library({ data: open(":memory:"), overlay: player.harness, model: () => model })
const wire = handle(lib, { inspect: true, dirs: true, scripted: true })
const listener = createServer(node(app(wire))).listen(0, "127.0.0.1")
await new Promise<void>((resolve) => listener.once("listening", resolve))
const origin = `http://127.0.0.1:${(listener.address() as AddressInfo).port}`
const quiet: Writer = { write: () => {} }
const wired = (v: unknown) => JSON.parse(JSON.stringify(v)) as unknown
const world = (env: Record<string, string>, err: Writer = quiet) => ({ env, home: dir, cwd: dir, out: quiet, err })

/** What a call throws, as the terminal reads it. */
let refusals = 0
const refusal = async (p: Promise<unknown>) => {
  refusals++
  try {
    await p
  } catch (e) {
    assert.ok(e instanceof Answered, String(e))
    return { status: e.status, code: e.code, message: e.message }
  }
  assert.fail(`no refusal: call ${++refusals}`)
}

try {
  // The terminal's operations against the handler itself: no spawn, no port.
  {
    const h = host(wire)
    const card = { ...chat, id: "cli", title: "CLI" }
    assert.equal((await h.install(printCard(card))).id, "cli")
    assert.ok((await h.cards()).some((c) => c.id === "cli"))
    assert.match(await h.source("cli"), /^id: cli$/m)
    const story = await h.create("cli")
    assert.ok((await h.list()).some((s) => s.id === story && s.card === "cli"))
    await h.name("cli", "阿青")
    assert.equal(lib.locals.read("cli").names?.user, "阿青")
    assert.equal(await h.input(story), "act")
    const events: CliEvent[] = []
    await h.submit(story, { kind: "act", input: { text: "hello" } }, (e) => events.push(e))
    assert.ok(events.some((e) => e.kind === "delta"))
    const landed = events.findLast((e) => e.kind === "change")
    assert.ok(landed?.kind === "change" && landed.node?.settlementStatus === "committed")
    const { head, nodes } = await h.timeline(story)
    assert.equal(nodes.length, 1)
    assert.deepEqual(wired(await h.context(story, head)), wired(lib.session(story).activeContext(head)))
    assert.ok((await h.detail(story, head!)) !== undefined)
    // in-process, the person at the terminal sees the call bodies
    const trace = (await h.trace(story, head!)) as { msgs: unknown[] }[]
    assert.ok(trace.some((c) => c.msgs.length > 0))
    assert.match(await h.export(story, "md"), /hello/)
    assert.equal(JSON.parse(await h.export(story, "json")).snapshot.nodes.length, 1)
    // nothing running: attach is nothing, stop stops nothing
    const attached: CliEvent[] = []
    await h.attach(story, (e) => attached.push(e))
    assert.deepEqual(attached, [])
    assert.deepEqual(await h.stop(story), { stopped: null })
    // a turn in flight: an attach sees it from where it is, a stop halts it, a second action is busy
    const running = h.submit(story, { kind: "act", input: { text: "slow" } }, () => {})
    while (lib.attach(story)?.phase !== "narrate") await Bun.sleep(5)
    const busy = await refusal(h.submit(story, { kind: "act", input: { text: "no" } }, () => {}))
    assert.deepEqual([busy.status, busy.code], [409, "busy"])
    const seen: CliEvent[] = []
    const following = h.attach(story, (e) => seen.push(e))
    while (!seen.some((e) => e.kind === "delta")) await Bun.sleep(5)
    assert.equal(seen[0]?.kind, "attach")
    assert.deepEqual(await h.stop(story), { stopped: "halted" })
    await Promise.all([running, following])
    const stopped = seen.findLast((e) => e.kind === "change")
    assert.ok(stopped?.kind === "change" && stopped.node?.end === "stopped")
    // a local directory as a card library: the terminal's alone
    const depotDir = join(dir, "depot")
    mkdirSync(join(depotDir, "cards"), { recursive: true })
    writeFileSync(
      join(depotDir, "index.json"),
      JSON.stringify({ name: "卡库", entries: [{ id: "two", title: "二", file: "cards/two.yaml" }] }),
    )
    writeFileSync(join(depotDir, "cards/two.yaml"), printCard({ ...chat, id: "two", title: "二" }))
    const d = await h.depots.add(depotDir)
    assert.deepEqual(await h.depots.list(), [d])
    assert.equal((await h.depots.view(d.id)).entries[0]?.state, "absent")
    assert.equal((await h.depots.pull(d.id, "two", false)).id, "two")
    await h.depots.remove(d.id)
    assert.deepEqual(await h.depots.list(), [])
    // refusals: the server's own sentence and code, never a body
    const inUse = await refusal(h.remove("cli"))
    assert.deepEqual([inUse.status, inUse.code], [409, "card-in-use"])
    const none = await refusal(h.create("none"))
    assert.equal(none.status, 400)
    const noStory = await refusal(h.export(999, "md"))
    assert.deepEqual([noStory.status, noStory.message], [404, "no story 999"])
    const notHttps = await refusal(h.link("http://example.invalid/card.yaml"))
    assert.equal(notHttps.code, "link-unreadable")
    // The same calls over a listener through the node bridge: the same answers.
    const net = host(over(`${origin}/api`))
    for (const call of [
      (x: CliHost) => x.remove("cli"),
      (x: CliHost) => x.create("none"),
      (x: CliHost) => x.export(999, "md"),
      (x: CliHost) => x.link("http://example.invalid/card.yaml"),
    ])
      assert.deepEqual(await refusal(call(net)), await refusal(call(h)))
    await h.drop(story)
    assert.ok(!(await h.list()).some((s) => s.id === story))
    await h.remove("two")

    // A local directory is not a card library over a listener, and the trace carries no bodies there (that
    // listener's handler is not inspecting): the network has only what the wire gives anyone.
    const remote = createServer(node(app(handle(lib)))).listen(0, "127.0.0.1")
    await new Promise<void>((resolve) => remote.once("listening", resolve))
    try {
      const plain = host(over(`http://127.0.0.1:${(remote.address() as AddressInfo).port}/api`))
      const refused = await refusal(plain.depots.add(depotDir))
      assert.equal(refused.code, "depot-unreadable")
      const s = await plain.create("cli")
      await plain.submit(s, { kind: "act", input: { text: "hello" } }, () => {})
      const t = (await plain.trace(s, (await plain.timeline(s)).head!)) as { msgs: unknown[] }[]
      assert.ok(t.length > 0 && t.every((c) => c.msgs.length === 0))
      await plain.drop(s)
    } finally {
      remote.close()
    }
    // nothing answers there: Unreachable, never a refusal
    await assert.rejects(host(over("http://127.0.0.1:9/api")).cards(), Unreachable)
    // a proxy in the environment (set to reach a provider) is not asked for this machine's own tavern
    {
      const script = `import { over } from ${JSON.stringify(new URL("../src/wire.ts", import.meta.url).pathname)}
        const r = await over(${JSON.stringify(`${origin}/api`)})(new Request("http://tavern/host"))
        console.log(r.status)`
      const child = Bun.spawn(["bun", "-e", script], {
        env: {
          ...process.env,
          HTTP_PROXY: "http://127.0.0.1:9",
          http_proxy: "http://127.0.0.1:9",
          NO_PROXY: "",
          no_proxy: "",
        },
        stdout: "pipe",
        stderr: "pipe",
      })
      const [code, out, err] = await Promise.all([
        child.exited,
        new Response(child.stdout).text(),
        new Response(child.stderr).text(),
      ])
      assert.equal(`${code} ${out.trim()}`, "0 200", err)
    }
  }

  // A turn's events arrive as they are made, in-process and over the bridge; a reader that goes away stops nothing.
  {
    const story = lib.stories.create("cli")
    const post = (send: (r: Request) => Promise<Response>, text: string) =>
      send(
        new Request("http://tavern/", {
          method: "POST",
          headers: { "x-tavern-story": String(story) },
          body: JSON.stringify({ kind: "act", input: { text } }),
        }),
      )
    const paths = {
      "in-process": (r: Request) => wire(r),
      bridge: (r: Request) => over(`${origin}/api`)(r),
    }
    for (const [name, send] of Object.entries(paths)) {
      const r = await post(send, "slow")
      assert.equal(r.headers.get("content-type"), "text/event-stream", name)
      const reader = r.body!.getReader()
      const at: number[] = []
      const t0 = performance.now()
      let text = ""
      for (let c = await reader.read(); !c.done; c = await reader.read()) {
        text += new TextDecoder().decode(c.value)
        if (/event: delta/.test(text) && at.length === 0) at.push(performance.now() - t0)
      }
      const end = performance.now() - t0
      assert.ok(at[0]! < end - 100, `${name}: the first delta came ${at[0]} ms in, the end at ${end} ms`)
      // gone after the first piece: the turn goes on to its node
      const before = lib.session(story).timeline().nodes.length
      const left = (await post(send, "slow")).body!.getReader()
      let first = ""
      while (!/event: delta/.test(first)) first += new TextDecoder().decode((await left.read()).value)
      await left.cancel()
      assert.ok(lib.attach(story), `${name}: the turn runs on`)
      while (lib.attach(story)) await Bun.sleep(10)
      const after = lib.session(story).timeline()
      assert.equal(after.nodes.length, before + 1, name)
      assert.notEqual(after.nodes.at(-1)!.end, "stopped", name)
    }
  }

  // The announcement on its own: written whole, read only while its process holds the lock, withdrawn only by its own.
  {
    const here = join(dir, "announce")
    mkdirSync(here)
    assert.equal(announced(here), undefined)
    assert.deepEqual(
      [
        local({ address: "0.0.0.0", port: 1 }),
        local({ address: "::", port: 2 }),
        local({ address: "::1", port: 3 }, "https"),
        local({ address: "127.0.0.1", port: 4 }),
      ],
      ["http://127.0.0.1:1", "http://[::1]:2", "https://[::1]:3", "http://127.0.0.1:4"],
    )
    const data = open(libraryFile(here))
    const withdraw = announce(here, "http://127.0.0.1:1234")
    assert.deepEqual(JSON.parse(readFileSync(addressFile(here), "utf8")), {
      pid: process.pid,
      url: "http://127.0.0.1:1234",
    })
    assert.equal(readFileSync(lockFile(here), "utf8"), String(process.pid)) // the lock's own format: a bare pid
    assert.deepEqual(announced(here), { pid: process.pid, url: "http://127.0.0.1:1234" })
    withdraw()
    assert.ok(!existsSync(addressFile(here)))
    // a later owner's address is not ours to take back
    const again = announce(here, "http://127.0.0.1:1")
    writeFileSync(addressFile(here), JSON.stringify({ pid: process.pid, url: "http://127.0.0.1:2" }))
    again()
    assert.ok(existsSync(addressFile(here)))
    data.close()
    assert.ok(!existsSync(lockFile(here))) // close releases the lock
    // the lock gone, the address is stale: ignored and removed; so is one naming a dead process, or garbage
    assert.equal(announced(here), undefined)
    assert.ok(!existsSync(addressFile(here)))
    const dead = Bun.spawnSync(["true"]).pid
    writeFileSync(lockFile(here), String(dead))
    writeFileSync(addressFile(here), JSON.stringify({ pid: dead, url: "http://127.0.0.1:2" }))
    assert.equal(announced(here), undefined)
    assert.ok(!existsSync(addressFile(here)))
    writeFileSync(addressFile(here), "not json")
    assert.equal(announced(here), undefined)
    assert.ok(!existsSync(addressFile(here)))
    rmSync(lockFile(here))
  }

  // Reaching a library.
  {
    // nobody holds it: the command opens it, and closing lets it go (many opens in one process leave nothing locked)
    const nobody = join(dir, "nobody")
    for (let i = 0; i < 3; i++) {
      const r = await reach({ data: nobody, fake: true })
      assert.equal(r.at, undefined)
      assert.deepEqual(await r.host.cards(), [])
      assert.equal(readFileSync(lockFile(nobody), "utf8"), String(process.pid))
      r.host.close()
      assert.ok(!existsSync(lockFile(nobody)))
    }
    assert.equal(process.listenerCount("SIGTERM"), 0)
    // a stale address (its process gone) is ignored, removed, and the library opened here
    writeFileSync(addressFile(nobody), JSON.stringify({ pid: Bun.spawnSync(["true"]).pid, url: "http://127.0.0.1:9" }))
    const stale = await reach({ data: nobody, fake: true })
    assert.equal(stale.at, undefined)
    assert.ok(!existsSync(addressFile(nobody)))
    stale.host.close()

    // an owner that announced: reached over the network, found, and checked under MODEL=fake
    const owned = join(dir, "owned")
    mkdirSync(owned)
    const data = open(libraryFile(owned))
    const real = library({ data, overlay: player.harness })
    shelf(data).install({ ...chat, id: "owned" }, { via: "file" })
    const server = createServer(node(app(handle(real, { scripted: false })))).listen(0, "127.0.0.1")
    await new Promise<void>((resolve) => server.once("listening", resolve))
    const url = local(server.address() as AddressInfo)
    const withdraw = announce(owned, url)
    try {
      const r = await reach({ data: owned, fake: false })
      assert.deepEqual([r.at, r.found], [url, true])
      assert.deepEqual(
        (await r.host.cards()).map((c) => c.id),
        ["owned"],
      )
      await assert.rejects(reach({ data: owned, fake: true }), HostNotScripted)
      let said = ""
      const code = await tavern(
        ["card", "list"],
        world({ TAVERN_DATA: owned, MODEL: "fake" }, { write: (s) => void (said += s) }),
      )
      assert.equal(code, 3)
      assert.match(said, /正在运行的酒馆用的是真实模型[^]*MODEL=fake/)
      // --server names it: nothing local is read (the data directory is somewhere else entirely), the old /api too
      const named = await reach({ data: join(dir, "elsewhere"), server: `${url}/api`, fake: false })
      assert.deepEqual([named.at, named.found], [url, undefined])
      assert.ok(!existsSync(join(dir, "elsewhere")))
    } finally {
      withdraw()
      server.close()
      data.close()
    }

    // --server to nothing: exit 3 in plain words
    let said = ""
    assert.equal(
      await tavern(["story", "list", "--server", "http://127.0.0.1:9"], world({}, { write: (s) => void (said += s) })),
      3,
    )
    assert.match(said, /连不上酒馆/)
    said = ""
    assert.equal(
      await tavern(
        ["story", "list", "--server", "http://127.0.0.1:9"],
        world({ TAVERN_LANG: "en" }, { write: (s) => void (said += s) }),
      ),
      3,
    )
    assert.match(said, /Cannot reach the tavern[^]*127\.0\.0\.1:9/)

    // a live owner that never says its address (an older binary, or one still starting): waited for, then exit 3
    const silent = join(dir, "silent")
    mkdirSync(silent)
    const sleeper = Bun.spawn(["sleep", "30"])
    try {
      writeFileSync(lockFile(silent), String(sleeper.pid))
      const t0 = Date.now()
      await assert.rejects(reach({ data: silent, fake: false }, { patience: 300 }), (e: unknown) => {
        assert.ok(e instanceof HostSilent)
        assert.equal(e.pid, sleeper.pid)
        return true
      })
      assert.ok(Date.now() - t0 >= 300)
      said = ""
      assert.equal(
        await tavern(["story", "list"], world({ TAVERN_DATA: silent }, { write: (s) => void (said += s) })),
        3,
      )
      assert.match(said, new RegExp(`进程 ${sleeper.pid}`))
      assert.equal(readFileSync(lockFile(silent), "utf8"), String(sleeper.pid)) // the owner's lock untouched
      // it says its address late, within the wait: the command waits for it and goes through
      setTimeout(() => writeFileSync(addressFile(silent), JSON.stringify({ pid: sleeper.pid, url: origin })), 300)
      const late = await reach({ data: silent, fake: true })
      assert.deepEqual([late.at, late.found], [origin, true])
    } finally {
      sleeper.kill()
      await sleeper.exited
    }
  }
} finally {
  listener.close()
  rmSync(dir, { recursive: true, force: true })
}
console.log("reach ok")
