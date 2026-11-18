// The developer's session: the library's own shelf (shelf.ts; a new library has no card until one is installed, from a
// file, the workshop or a card library) on the local Anthropic connection, or on a scripted
// model (MODEL=fake) that answers every stage well enough to drive the client; served in inspector mode. The library
// (data.ts) is `tavern.db` under DATA, by default .dev/ at the repo root, so Vite re-evaluating this module after a
// runtime/server edit, or a restart, keeps the stories; a second process on the same DATA fails fast on the lock
// (data.ts `lock`); a `tavern` command on the same DATA reaches this session by the address the Vite plugin announces
// (`announce` below, reach.ts). No card is bound: each request names its story and the story its card. An empty story opens on no
// greeting: the player picks one on the card page (a greet is a root, and one picked on the server would stay as an
// orphan root beside the player's). Which model runs each stage is the library's routing (the settings page);
// MODEL=fake puts the scripted model over it. This module is the environment's entry: it reads the environment and
// opens the store, tavern.ts builds the tavern from what it read.
import {
  bind,
  fake,
  fakeText,
  localAnthropic,
  localAnthropicKey,
  type FakeCall,
  type Model,
} from "@effect-tavern/provider"
import { player } from "@effect-tavern/runtime/support/rows.ts"
import { defaultAnswer, readStage } from "@effect-tavern/runtime/support/script.ts"
import { mkdirSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { announce as announceAt, local } from "./announce.ts"
import { open } from "./data.ts"
import { levels, openLogbook, type Level } from "./logbook.ts"
import { refresh } from "./names.ts"
import { tavern } from "./tavern.ts"
import { node } from "./wire.ts"

// a compiled binary (bun build --compile) has no checkout around it: its library lives where it is run
const dir =
  process.env["DATA"] ??
  (import.meta.url.includes("$bunfs")
    ? `${process.cwd()}/.dev`
    : fileURLToPath(new URL("../../../.dev/", import.meta.url)))
mkdirSync(dir, { recursive: true })
const data = open(`${dir}/tavern.db`)
void refresh(data) // the model-name table, in the background: startup never waits on models.dev

let n = 0
/** By phase: lookup reads nothing, decide ends, direct opens what the gate offered, check is clean, record answers each
 *  question with its first option and fills the asked products with canned rows. Prose streams a numbered paragraph.
 *  A line containing 重写 is the slow demo: longer prose at reading pace, a second of check and of record, and the
 *  rewrite — the first draft says 一稿, check fails it, the correction draft says 二稿. */
const answer = (o: FakeCall) => {
  const text = o.prompt.map(fakeText).join("\n")
  const doc = readStage(o)
  const demo = /重写|一稿|二稿/.test(text)
  switch (doc.phase) {
    case "lookup":
      return { ...defaultAnswer(doc), delay: demo ? 1500 : 0 } // room to stop before the first character
    case "direct":
      return { text: JSON.stringify({ must: [], may: doc.open, tone: "平静" }) }
    case "check":
      return {
        text: JSON.stringify({ fired: [], violated: text.includes("一稿") ? [doc.rules[0] ?? ""] : [] }),
        delay: demo ? 1000 : 0,
      }
    case "record": {
      // canned rows for the harness's own products; a card's product is asked of the model alone and decodes to nothing here
      const canned: Record<string, unknown> = {
        notes: `第${n}幕：两人隔着一张桌子说话，各自试探对方的来意。`,
        options: [
          "我把带来的东西放在桌上：「我是来还这个的。」",
          "「既然不愿多说，那就换个问法。」我往前走了一步。",
          "我看着门外，轻声问：「这里以前住过别人吗？」",
          "我点了点头：「今天打扰了，改日再来。」",
        ],
      }
      return { ...defaultAnswer(doc, canned), delay: demo ? 1000 : 0 }
    }
    case "narrate": {
      // inner is a narrate-stage product: asked for on the turn (an `inner:` ask line) it follows the prose as a block;
      // demanded on a node ("Write no prose") the block is the whole answer
      const inner = "对方垂眼看着桌面，心里在想你究竟是从哪里听来这件事的。"
      if (text.includes("Write no prose")) return { text: `<<aside>> inner\n${inner}`, delay: 20 }
      const block = /^inner: /m.test(text) ? `\n<<aside>> inner\n${inner}` : ""
      return {
        text: `第${++n}段。${text.includes("Previous draft broke") ? "二稿。" : demo ? "一稿。" : ""}${"雨刚停，屋檐上的水还在一滴一滴往下落。"}${"对方站在三步开外，没有说话，目光落在你带来的东西上。".repeat(demo ? 6 : 2)}${block}`,
        delay: demo ? 120 : 20,
      }
    }
    default: // decide ends, polish hands every marked sentence back unchanged (a pass-through, so the prose stands)
      return defaultAnswer(doc)
  }
}

/** The environment's model, in force for any stage the routing row does not name: the local Anthropic key, when the
 *  machine has one. */
const live = (): Model | undefined => {
  const conn = localAnthropic()
  if (!conn) return undefined
  // the proxy rides on Bun's fetch (provider connection.ts): on Node a live request goes direct and fails behind one
  if (!("Bun" in globalThis)) throw new Error("live model needs Bun: bun --bun vp run dev, or MODEL=fake")
  return bind({ ...conn, effort: "low", hat: process.env["HAT"] ?? conn.hat }) // HAT=<id> puts a library hat on it
}
const scripted = process.env["MODEL"] === "fake"
const one = scripted ? { ...fake(answer), hat: process.env["HAT"] } : live() // HAT works on the scripted model too
const model = one && (() => one)

const key = localAnthropicKey()
const { handler: wire } = tavern({
  data,
  overlay: player.harness,
  model,
  pinned: scripted, // MODEL=fake scripts every stage, whatever the routing says
  ...(key && { seed: { key } }), // a first start puts the local key in the vault (tavern.ts `seed`)
  inspect: true,
  scripted,
  page: true, // Vite serves it
  // a guest on Vite's terminal: finished turns and failures only (logbook.ts), its file beside the library
  logbook: openLogbook({
    guest: true,
    dir: `${dir}/log`,
    lang: process.env["TAVERN_LANG"] === "en" ? "en" : "zh",
    ...(levels.includes(process.env["TAVERN_LOG"] as Level) && { level: process.env["TAVERN_LOG"] as Level }),
    inspect: process.env["TAVERN_INSPECT"] === "1",
  }),
})
/** What Vite's mount calls (packages/client/vite.config.ts). */
export const handler = node(wire)
/** Says where Vite listens, beside this library's lock, so `tavern` commands on this data directory reach the dev
 *  session by themselves (reach.ts); the answer withdraws it. The plugin calls it once Vite's server listens. */
export const announce = (at: { address: string; port: number }, scheme: "http" | "https" = "http") =>
  announceAt(dir, local(at, scheme))
