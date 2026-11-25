import assert from "node:assert/strict"
import { fake, fakeText } from "@effect-tavern/provider"
import { readCard } from "@effect-tavern/runtime/support/author.ts"
import { defaultAnswer, readStage } from "@effect-tavern/runtime/support/script.ts"
import { chat } from "../../runtime/test/cards/index.ts"
import { FREE_CHAT_ID } from "@effect-tavern/runtime/src/library.ts"
import type { PreviewNarrateResult } from "@effect-tavern/runtime/src/preview.ts"
import type { TimelineEvent } from "@effect-tavern/runtime/src/projection.ts"
import type { Event as RuntimeEvent } from "@effect-tavern/runtime/src/session.ts"
import { open } from "../src/data.ts"
import { library } from "../src/library.ts"
import { handle, listen } from "../src/serve.ts"
import { shelf } from "../src/shelf.ts"

const lifeOfPi = await readCard(new URL("../../../samples/life-of-pi/life-of-pi.yaml", import.meta.url))
const canned = { notes: "N1", options: ["A", "B", "C", "D"], people: [], scene: { place: "P", present: [] } }

const sse = (text: string) =>
  text
    .split("\n\n")
    .filter(Boolean)
    .map((block) => {
      const [ev, data] = block.split("\n")
      return {
        event: ev.slice(7),
        data: JSON.parse(data.slice(6)) as TimelineEvent | Extract<RuntimeEvent, { kind: "call" }>,
      }
    })

const fictionIds = (res: PreviewNarrateResult) =>
  res.traces.flatMap((t) => t.spans.filter((s) => s.kind === "fiction").map((s) => s.source.fragmentId))

const fictionSlice = (res: PreviewNarrateResult, fragmentId: string) => {
  for (const tr of res.traces) {
    const span = tr.spans.find((s) => s.kind === "fiction" && s.source.fragmentId === fragmentId)
    if (span) {
      const content = res.messages[tr.index]?.content
      return typeof content === "string" ? content.slice(span.start, span.end) : undefined
    }
  }
  return undefined
}

// 1. Sandbox mode on Life of Pi: 裂隙 2 -> 3 switches seam-calm to seam-mid, zero stories created, zero LLM calls
// 2. Unsaved candidateCard reflects edits while GET /cards/:id & GET /cards/:id/whole (rev & content) stay untouched
// 3. Anthropic candidateHat prefill conflict without an API secret returns HTTP 200 with wireError + complete messages/traces
{
  const data = open(":memory:")
  shelf(data).install(lifeOfPi, { via: "file" })
  const lib = library({
    data,
  })
  const server = listen(handle(lib), "127.0.0.1", 0)
  const base = `http://127.0.0.1:${server.port}`
  const postPreview = (body: unknown, headers?: Record<string, string>) =>
    fetch(`${base}/preview`, {
      method: "POST",
      headers: { "content-type": "application/json", ...headers },
      body: typeof body === "string" ? body : JSON.stringify(body),
    })

  try {
    // Works with no x-tavern-story header and even with a stale story header
    const r2 = await postPreview(
      { cardId: lifeOfPi.id, greetingIndex: 0, fields: { 裂隙: 2 } },
      { "x-tavern-story": "99999" },
    )
    assert.equal(r2.status, 200)
    const p2 = (await r2.json()) as PreviewNarrateResult
    assert.equal(p2.mode, "sandbox")
    assert.equal(p2.connection.routingSource, "none")
    assert.equal(p2.connection.format, undefined)
    assert.equal(p2.connection.prefill, true)
    assert.equal(p2.wiredMessages, undefined)
    assert.ok(p2.traces.every((tr) => tr.wiredRole === undefined))
    assert.ok(fictionIds(p2).includes("seam-calm"))
    assert.ok(!fictionIds(p2).includes("seam-mid"))
    assert.ok(p2.omitted.some((o) => o.category === "fiction" && o.id === "seam-mid" && o.reason === "when_false"))
    assert.equal(fictionSlice(p2, "seam-calm"), lifeOfPi.fiction.find((f) => f.id === "seam-calm")!.text)

    const r3 = await postPreview({ cardId: lifeOfPi.id, greetingIndex: 0, fields: { 裂隙: 3 } })
    assert.equal(r3.status, 200)
    const p3 = (await r3.json()) as PreviewNarrateResult
    assert.ok(fictionIds(p3).includes("seam-mid"))
    assert.ok(!fictionIds(p3).includes("seam-calm"))
    assert.ok(p3.omitted.some((o) => o.category === "fiction" && o.id === "seam-calm" && o.reason === "when_false"))
    assert.equal(fictionSlice(p3, "seam-mid"), lifeOfPi.fiction.find((f) => f.id === "seam-mid")!.text)
    assert.equal(lib.stories.list().length, 0)

    // Empty {} preview (no cardId, no candidateCard) falls back to FREE_CHAT_CARD without persisting to shelf
    const emptyPreview = await postPreview({})
    assert.equal(emptyPreview.status, 200)
    const emptyBody = (await emptyPreview.json()) as PreviewNarrateResult
    assert.equal(emptyBody.card.id, FREE_CHAT_ID)
    assert.equal(lib.cards.has(FREE_CHAT_ID), false)
    assert.equal((await postPreview({ cardId: FREE_CHAT_ID })).status, 200)
    assert.equal(lib.cards.has(FREE_CHAT_ID), false)

    // Scenario 2: candidateCard reflects unsaved edits without touching shelf rev or GET /cards/:id
    const beforeView = await (await fetch(`${base}/cards/${lifeOfPi.id}`)).json()
    const beforeWhole = (await (await fetch(`${base}/cards/${lifeOfPi.id}/whole`)).json()) as {
      card: typeof lifeOfPi
      rev: string
    }
    const candidateCard = {
      ...beforeWhole.card,
      frame: [...beforeWhole.card.frame, { id: "style", text: "UNSAVED-FRAME-MARKER" }],
      fiction: [...beforeWhole.card.fiction, { id: "unsaved-fic", label: "Unsaved", text: "UNSAVED-FICTION-MARKER" }],
    }
    const candRes = await postPreview({ cardId: lifeOfPi.id, candidateCard })
    assert.equal(candRes.status, 200)
    const candBody = (await candRes.json()) as PreviewNarrateResult
    const serializedMessages = JSON.stringify(candBody.messages)
    assert.ok(serializedMessages.includes("UNSAVED-FRAME-MARKER"))
    assert.ok(serializedMessages.includes("UNSAVED-FICTION-MARKER"))
    assert.ok(fictionIds(candBody).includes("unsaved-fic"))

    const afterView = await (await fetch(`${base}/cards/${lifeOfPi.id}`)).json()
    const afterWhole = (await (await fetch(`${base}/cards/${lifeOfPi.id}/whole`)).json()) as {
      card: typeof lifeOfPi
      rev: string
    }
    assert.deepEqual(afterView, beforeView)
    assert.equal(afterWhole.rev, beforeWhole.rev)
    assert.deepEqual(afterWhole.card, beforeWhole.card)

    // Scenario 3: Anthropic routed model with NO API secret + candidateHat ending in assistant -> HTTP 200 + wireError
    lib.providers.put({
      id: "anthropic-nosecret",
      name: "Anthropic Preview",
      enabled: false, // disabled and no secret: preview still resolves format & capabilities cleanly
      defaultFormat: "anthropic",
      endpoints: { anthropic: { url: "https://api.anthropic.com" } },
      cacheTtl: "1h",
      models: [{ id: "claude-test", contextTokens: 128000 }],
    })
    lib.routing.write({ stages: { narrate: { provider: "anthropic-nosecret", model: "claude-test" } } })

    const hatRes = await postPreview({
      cardId: lifeOfPi.id,
      candidateHat: {
        id: "unsaved-hat",
        name: "Unsaved Prefill Hat",
        narrate: {
          head: [{ role: "system", text: "CANDIDATE-HAT-HEAD" }],
          tail: [{ role: "assistant", text: "Story continues:" }],
        },
      },
      input: { text: "早安小派" },
    })
    assert.equal(hatRes.status, 200)
    const hatBody = (await hatRes.json()) as PreviewNarrateResult
    assert.equal(hatBody.connection.format, "anthropic")
    assert.equal(hatBody.connection.prefill, false)
    assert.equal(hatBody.connection.reasoningBack, false)
    assert.equal(hatBody.connection.ttl, "1h")
    assert.equal(hatBody.connection.contextTokens, 128000)
    assert.equal(hatBody.connection.routingSource, "stage")
    assert.equal(hatBody.connection.hatId, "unsaved-hat")
    assert.equal(hatBody.wireError?.code, "prefill_disallowed")
    assert.equal(hatBody.wireError?.source?.hatSlot, "tail")
    assert.equal(hatBody.wireError?.source?.hatIndex, 0)
    assert.ok(hatBody.messages.length > 0)
    assert.equal(hatBody.traces.length, hatBody.messages.length)
    assert.ok(JSON.stringify(hatBody.messages).includes("CANDIDATE-HAT-HEAD"))
    assert.equal(lib.hats.list().length, 0) // candidateHat was NOT persisted

    // Saved hat + routing hat + hatId: null override + personaId & packNames in SourceRef
    lib.hats.put({
      id: "saved-hat",
      name: "Saved Hat",
      narrate: { tail: [{ role: "user", text: "SAVED-HAT-TAIL" }] },
    })
    lib.routing.write({
      default: { provider: "anthropic-nosecret", model: "claude-test" },
      hat: "saved-hat",
    })
    lib.personas.put({ id: "p-hero", name: "林远", text: "你是林远。" })
    lib.packs.put({
      id: "tone-pack",
      name: "文风包",
      fragments: [{ id: "pack-note", text: "PACK-FRAGMENT-TEXT" }],
    })
    lib.locals.write({
      id: "local",
      name: lifeOfPi.id,
      card: lifeOfPi.id,
      persona: "p-hero",
      mounts: ["tone-pack"],
    })
    const withSavedHat = (await (await postPreview({ cardId: lifeOfPi.id })).json()) as PreviewNarrateResult
    assert.equal(withSavedHat.connection.routingSource, "default")
    assert.equal(withSavedHat.connection.hatId, "saved-hat")
    assert.ok(JSON.stringify(withSavedHat.messages).includes("SAVED-HAT-TAIL"))
    const personaSpan = withSavedHat.traces.flatMap((t) => t.spans).find((s) => s.kind === "persona")
    assert.equal(personaSpan?.source.personaId, "p-hero")
    const packSpan = withSavedHat.traces.flatMap((t) => t.spans).find((s) => s.source.packId === "tone-pack")
    assert.equal(packSpan?.source.packName, "文风包")

    const forcedNoHat = (await (await postPreview({ cardId: lifeOfPi.id, hatId: null })).json()) as PreviewNarrateResult
    assert.equal(forcedNoHat.connection.hatId, undefined)
    assert.equal(JSON.stringify(forcedNoHat.messages).includes("SAVED-HAT-TAIL"), false)

    const firstTurn = await postPreview({ mode: "story", cardId: lifeOfPi.id, nodeId: null })
    assert.equal(firstTurn.status, 200)
    const first = (await firstTurn.json()) as PreviewNarrateResult
    assert.equal(first.mode, "story")
    assert.equal(first.story?.nodeId, null)
    assert.equal(first.card.id, lifeOfPi.id)
    assert.equal(lib.stories.list().length, 0)
    assert.equal((await postPreview({ mode: "story", cardId: lifeOfPi.id, nodeId: 1 })).status, 400)
    lib.routing.write({ default: { provider: "anthropic-nosecret", model: "removed" } })
    const stale = await postPreview({ cardId: lifeOfPi.id })
    assert.equal(stale.status, 200)
    const body = (await stale.json()) as PreviewNarrateResult
    assert.ok(body.messages.length)
    assert.ok(body.diagnostics.some((d) => d.code === "connection_unavailable" && d.message.includes("removed")))

    // Clean 400 and 404 error mappings
    assert.equal((await postPreview("{")).status, 400)
    assert.equal((await postPreview({ mode: "story" })).status, 400)
    assert.equal((await postPreview({ mode: "invalid" })).status, 400)
    const badCardRes = await postPreview({ candidateCard: { id: "bad" } })
    assert.equal(badCardRes.status, 400)
    assert.equal(((await badCardRes.json()) as { code?: string }).code, "invalid-candidate")
    const emptyGuardRes = await postPreview({ candidateCard: { ...lifeOfPi, guard: [""] } })
    assert.equal(emptyGuardRes.status, 400)
    assert.equal(((await emptyGuardRes.json()) as { code?: string }).code, "invalid-candidate")
    const badHatRes = await postPreview({ candidateHat: { id: "bad", name: 123 } })
    assert.equal(badHatRes.status, 400)
    assert.equal(((await badHatRes.json()) as { code?: string }).code, "invalid-candidate")
    assert.equal((await postPreview({ cardId: "nonexistent-card" })).status, 404)
    assert.equal((await postPreview({ storyId: 99999 })).status, 404)
    assert.equal((await postPreview({ cardId: lifeOfPi.id, hatId: "nonexistent-hat" })).status, 404)
    assert.equal((await fetch(`${base}/preview`)).status, 404)
  } finally {
    await server.stop(true)
  }
}

// 4. Story mode on TWO diverged branches returns each branch's own state and transcript independently
// 5. Historical lib.trace(storyId, nodeId) stays unchanged after Hat edits, while POST /preview reflects updated Hat
{
  const data = open(":memory:")
  shelf(data).install({ ...chat, greetings: [{ text: "Opening line" }] }, { via: "file" })
  let narrateSeq = 0
  const scripted = {
    ...fake((o) => {
      const doc = readStage(o)
      if (doc.phase === "narrate") {
        const txt = o.prompt.map(fakeText).join("\n")
        narrateSeq++
        return {
          text: txt.includes("Branch A")
            ? `Reply A #${narrateSeq}`
            : txt.includes("Branch B")
              ? `Reply B #${narrateSeq}`
              : `Reply Base #${narrateSeq}`,
        }
      }
      return defaultAnswer(doc, canned)
    }),
    hat: "story-hat",
  }
  const lib = library({
    data,
    model: () => scripted,
  })
  lib.hats.put({
    id: "story-hat",
    name: "Story Hat",
    narrate: { tail: [{ role: "user", text: "HAT-V1" }] },
  })
  lib.routing.write({ hat: "story-hat" })
  const storyId = lib.stories.create(chat.id)
  const server = listen(handle(lib), "127.0.0.1", 0)
  const base = `http://127.0.0.1:${server.port}`
  const storyFetch = (path: string, init: RequestInit = {}) => {
    const headers = new Headers(init.headers)
    if (!headers.has("x-tavern-story")) headers.set("x-tavern-story", String(storyId))
    return fetch(`${base}${path}`, { ...init, headers })
  }
  const act = async (body: unknown) => {
    const res = await storyFetch("/", { method: "POST", body: JSON.stringify(body) })
    assert.equal(res.status, 200)
    const events = sse(await res.text())
    return (events.at(-1)!.data as Extract<TimelineEvent, { kind: "change" }>).node!
  }

  try {
    const rootNode = await act({ kind: "greet" })
    const branchA = await act({ kind: "act", parent: rootNode.id, input: { text: "Branch A move" } })
    await act({ kind: "setField", node: branchA.id, effects: [{ path: "bond", set: 3 }] })

    // Diverge Branch B from rootNode with a different input and field state (bond = 9)
    const branchB = await act({ kind: "act", parent: rootNode.id, input: { text: "Branch B move" } })
    await act({ kind: "setField", node: branchB.id, effects: [{ path: "bond", set: 9 }] })

    // Also create a swipe sibling on Branch A to verify swipe branches keep independent transcripts and state
    const branchASwipe = await act({ kind: "swipe", node: branchA.id })
    await act({ kind: "setField", node: branchASwipe.id, effects: [{ path: "bond", set: 2 }] })

    const prevA = (await (
      await fetch(`${base}/preview`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ storyId, nodeId: branchA.id, input: { text: "Next on A" } }),
      })
    ).json()) as PreviewNarrateResult
    const prevASwipe = (await (
      await fetch(`${base}/preview`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ storyId, nodeId: branchASwipe.id, input: { text: "Next on A swipe" } }),
      })
    ).json()) as PreviewNarrateResult
    const prevB = (await (
      await fetch(`${base}/preview`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ storyId, nodeId: branchB.id, input: { text: "Next on B" } }),
      })
    ).json()) as PreviewNarrateResult

    assert.equal(prevA.mode, "story")
    assert.equal(prevA.story?.storyId, storyId)
    assert.equal(prevA.story?.nodeId, branchA.id)
    assert.equal(prevA.sandbox.state.bond, 3)
    assert.ok(fictionIds(prevA).includes("pei-cool"))
    assert.ok(!fictionIds(prevA).includes("pei-warm"))
    const histA = JSON.stringify(prevA.messages)
    assert.ok(histA.includes("Branch A move") && histA.includes("Reply A #1"))
    assert.ok(!histA.includes("Branch B move") && !histA.includes("Reply A #3"))

    assert.equal(prevASwipe.story?.nodeId, branchASwipe.id)
    assert.equal(prevASwipe.sandbox.state.bond, 2)
    const histASwipe = JSON.stringify(prevASwipe.messages)
    assert.ok(histASwipe.includes("Reply A #3"))
    assert.ok(!histASwipe.includes("Reply A #1") && !histASwipe.includes("Branch B move"))

    assert.equal(prevB.mode, "story")
    assert.equal(prevB.story?.nodeId, branchB.id)
    assert.equal(prevB.sandbox.state.bond, 9)
    assert.ok(fictionIds(prevB).includes("pei-warm"))
    assert.ok(!fictionIds(prevB).includes("pei-cool"))
    const histB = JSON.stringify(prevB.messages)
    assert.ok(histB.includes("Branch B move") && histB.includes("Reply B #2"))
    assert.ok(!histB.includes("Branch A move") && !histB.includes("Reply A #1"))

    // Root nodeId: null & nonexistent nodeId -> 404
    const prevRoot = (await (
      await fetch(`${base}/preview`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ storyId, nodeId: null }),
      })
    ).json()) as PreviewNarrateResult
    assert.equal(prevRoot.story?.nodeId, null)
    assert.equal(prevRoot.story?.turnCount, 0)
    assert.equal(
      (
        await fetch(`${base}/preview`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ storyId, nodeId: 99999 }),
        })
      ).status,
      404,
    )

    // Scenario 5: Edit saved Hat -> historical lib.trace(storyId, nodeId) is preserved, POST /preview updates immediately
    const traceBefore = JSON.stringify(lib.trace(storyId, branchA.id))
    assert.ok(traceBefore.includes("HAT-V1"))
    assert.ok(JSON.stringify(prevA.messages).includes("HAT-V1"))

    const putHatRes = await fetch(`${base}/hats/story-hat`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        name: "Story Hat",
        narrate: { tail: [{ role: "user", text: "HAT-V2-UPDATED" }] },
      }),
    })
    assert.equal(putHatRes.status, 200)

    const traceAfter = JSON.stringify(lib.trace(storyId, branchA.id))
    assert.equal(traceAfter, traceBefore)
    assert.ok(traceAfter.includes("HAT-V1"))
    assert.ok(!traceAfter.includes("HAT-V2-UPDATED"))

    const prevAfterHatEdit = (await (
      await fetch(`${base}/preview`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ storyId, nodeId: branchA.id, input: { text: "Check updated hat" } }),
      })
    ).json()) as PreviewNarrateResult
    const updatedMsgs = JSON.stringify(prevAfterHatEdit.messages)
    assert.ok(updatedMsgs.includes("HAT-V2-UPDATED"))
    assert.ok(!updatedMsgs.includes("HAT-V1"))
  } finally {
    await server.stop(true)
  }
}

// 6. Env / pinned model fallback: uses env model format & prefill capabilities with zero LLM calls
{
  const data = open(":memory:")
  shelf(data).install(lifeOfPi, { via: "file" })
  let llmCalls = 0
  const lib = library({
    data,
    pinned: true,
    model: () => ({
      ...fake(() => {
        llmCalls++
        throw new Error("preview must never call any LLM")
      }),
      format: "gemini",
      prefill: false,
      reasoningBack: false,
    }),
  })
  const envLibrary = library({
    data,
    model: () =>
      fake(() => {
        throw new Error("unexpected call")
      }),
  })
  data.hats.put({ id: "routing-only", name: "Routing Hat" })
  envLibrary.routing.write({ hat: "routing-only" })
  assert.equal(envLibrary.preview({}).connection.hatId, undefined)
  envLibrary.routing.write({ default: { provider: "missing", model: "missing" } })
  const stale = envLibrary.preview({})
  assert.equal(stale.connection.routingSource, "none")
  assert.ok(stale.messages.length)
  assert.ok(
    stale.diagnostics.some((d) => d.code === "connection_unavailable" && d.message.includes("no provider missing")),
  )
  const server = listen(handle(lib), "127.0.0.1", 0)
  const base = `http://127.0.0.1:${server.port}`
  try {
    const res = await fetch(`${base}/preview`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        cardId: lifeOfPi.id,
        greetingIndex: 0,
        candidateHat: {
          id: "env-hat",
          name: "Env Prefill Hat",
          narrate: { tail: [{ role: "assistant", text: "Tail prefill" }] },
        },
      }),
    })
    assert.equal(res.status, 200)
    const body = (await res.json()) as PreviewNarrateResult
    assert.equal(body.connection.routingSource, "env")
    assert.equal(body.connection.format, "gemini")
    assert.equal(body.connection.prefill, false)
    assert.equal(body.connection.tools, true)
    assert.equal(body.connection.deliver, "text")
    assert.equal(body.wireError?.code, "prefill_disallowed")
    assert.equal(body.wireError?.format, "gemini")
    assert.equal(llmCalls, 0)

    // Hat.deliver === "tool" over HTTP `/preview`: surfaces deliver, tools, deliver_needs_tools, and prefill_disallowed
    const toolPrefillRes = await fetch(`${base}/preview`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        cardId: lifeOfPi.id,
        greetingIndex: 0,
        candidateHat: {
          id: "tool-hat",
          name: "Tool Hat",
          deliver: "tool",
          narrate: { tail: [{ role: "assistant", text: "Tail prefill" }] },
        },
      }),
    })
    assert.equal(toolPrefillRes.status, 200)
    const toolPrefillBody = (await toolPrefillRes.json()) as PreviewNarrateResult
    assert.equal(toolPrefillBody.connection.deliver, "tool")
    assert.equal(toolPrefillBody.wireError?.code, "prefill_disallowed")
    assert.ok(toolPrefillBody.diagnostics.some((d) => d.code === "prefill_disallowed" && d.level === "error"))
  } finally {
    await server.stop(true)
  }
}

// 7. Routed model with capabilities.tools = false + saved Hat with deliver = "tool" reports `deliver_needs_tools`
{
  const data = open(":memory:")
  shelf(data).install(lifeOfPi, { via: "file" })
  const lib = library({ data })
  lib.providers.put({
    id: "no-tools",
    name: "No Tools Gateway",
    enabled: true,
    defaultFormat: "openai-compatible",
    endpoints: { "openai-compatible": { url: "https://example.com/v1" } },
    models: [{ id: "plain-chat", capabilities: { tools: false, prefill: true } }],
  })
  lib.hats.put({
    id: "h-tool",
    name: "Tool Delivery Hat",
    deliver: "tool",
    narrate: { tail: [{ role: "user", text: "Go ahead." }] },
  })
  lib.routing.write({ default: { provider: "no-tools", model: "plain-chat" }, hat: "h-tool" })
  const server = listen(handle(lib), "127.0.0.1", 0)
  const base = `http://127.0.0.1:${server.port}`
  try {
    const hatsRes = (await (await fetch(`${base}/hats`)).json()) as {
      id: string
      deliver?: string
      toolChoice?: string
    }[]
    assert.equal(hatsRes[0]?.deliver, "tool")
    assert.equal(hatsRes[0]?.toolChoice, "auto")
    const res = await fetch(`${base}/preview`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ cardId: lifeOfPi.id, greetingIndex: 0 }),
    })
    assert.equal(res.status, 200)
    const body = (await res.json()) as PreviewNarrateResult
    assert.equal(body.connection.tools, false)
    assert.equal(body.connection.deliver, "tool")
    assert.equal(body.connection.toolChoice, "auto")
    assert.equal(body.connection.prefill, true)
    assert.ok(body.diagnostics.some((d) => d.code === "deliver_needs_tools" && d.level === "error"))
    assert.ok(JSON.stringify(body.messages[0]).includes("calling the narrative tool"))

    // 8. `/hats` PUT/GET round-trip and `/preview` `candidateHat` with structured tool handshakes, all 4 slots, and reasoning
    const fullShellHat = {
      name: "Structured Shell Hat",
      deliver: "text" as const,
      narrate: {
        lead: [{ role: "system" as const, text: "HTTP-HAT-LEAD" }],
        head: [
          {
            role: "tool" as const,
            toolName: "load_protocol",
            toolInput: '{"strict":true}',
            text: "HTTP-TOOL-RESULT",
            toolCallId: "http_call_1",
            reasoning: "HTTP-TOOL-REASONING",
          },
        ],
        turn: [{ role: "user" as const, text: "HTTP-HAT-TURN" }],
        tail: [{ role: "assistant" as const, text: "HTTP-TAIL-TEXT", reasoning: "HTTP-TAIL-REASONING" }],
      },
      review: {
        head: [{ role: "system" as const, text: "HTTP-REVIEW-HEAD" }],
      },
    }
    const putRes = await fetch(`${base}/hats/h-shell`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ ...fullShellHat, toolChoice: "force" }),
    })
    assert.equal(putRes.status, 200)
    const listedHats = (await (await fetch(`${base}/hats`)).json()) as Array<typeof fullShellHat & { id: string }>
    const storedShell = listedHats.find((h) => h.id === "h-shell")
    assert.deepEqual(storedShell, { id: "h-shell", ...fullShellHat })
    assert.deepEqual(
      data.hats.list().find((h) => h.id === "h-shell"),
      storedShell,
    )

    // Preview against `no-tools` connection with `h-shell` surfaces `hat_needs_tools`, all slots, and tool messages
    const shellPrevRes = await fetch(`${base}/preview`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ cardId: lifeOfPi.id, greetingIndex: 0, hatId: "h-shell" }),
    })
    assert.equal(shellPrevRes.status, 200)
    const shellPrev = (await shellPrevRes.json()) as PreviewNarrateResult
    assert.ok(shellPrev.diagnostics.some((d) => d.code === "hat_needs_tools" && d.level === "error"))
    assert.equal(shellPrev.connection.toolChoice, undefined)
    assert.equal(shellPrev.traces[0]?.subzone, "hat-lead")
    assert.ok(shellPrev.traces.some((t) => t.subzone === "hat-turn" && t.source?.hatSlot === "turn"))
    assert.ok(shellPrev.traces.some((t) => t.role === "tool" && t.partSummary?.toolResultCount === 1))
    assert.ok(JSON.stringify(shellPrev.messages).includes("HTTP-HAT-LEAD"))

    // Unsaved `candidateHat` with structured entries works without writing to `/hats`
    const candShellRes = await fetch(`${base}/preview`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        cardId: lifeOfPi.id,
        greetingIndex: 0,
        candidateHat: {
          id: "unsaved-shell",
          ...fullShellHat,
          deliver: "tool",
          toolChoice: "force",
          narrate: {
            ...fullShellHat.narrate,
            lead: [{ role: "system" as const, text: "UNSAVED-CANDIDATE-LEAD" }],
          },
        },
      }),
    })
    assert.equal(candShellRes.status, 200)
    const candShellBody = (await candShellRes.json()) as PreviewNarrateResult
    assert.equal(candShellBody.connection.toolChoice, "force")
    assert.ok(JSON.stringify(candShellBody.messages).includes("UNSAVED-CANDIDATE-LEAD"))
    assert.equal(
      lib.hats.list().some((h) => h.id === "unsaved-shell"),
      false,
    )

    // 9. The delivery tool and the wrap (#220, #221): a hat write stores one shape and refuses a bad tool name in plain
    // words; preview carries the tool in force, `wrap`, and the wrapped messages, for a saved and an unsaved hat
    const wrapHat = {
      name: "Wrap Hat",
      deliver: "tool" as const,
      toolChoice: "force" as const,
      wrap: true,
      tool: { name: "actual_content", description: "Story: {{context}}", param: "   " },
      narrate: { lead: [{ role: "system" as const, text: "WRAP-SHELL" }] },
    }
    const put = async (id: string, body: unknown) =>
      fetch(`${base}/hats/${id}`, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      })
    assert.equal((await put("h-wrap", wrapHat)).status, 200)
    const storedWrap = lib.hats.list().find((h) => h.id === "h-wrap")
    assert.deepEqual(storedWrap?.tool, { name: "actual_content", description: "Story: {{context}}" })
    assert.equal(storedWrap?.wrap, true)
    assert.equal((await put("h-textwrap", { name: "Text Wrap", wrap: true, tool: { name: "x" } })).status, 200)
    assert.deepEqual(
      lib.hats.list().find((h) => h.id === "h-textwrap"),
      { id: "h-textwrap", name: "Text Wrap" },
    )
    const badName = await put("h-bad", { ...wrapHat, tool: { name: "my tool!" } })
    assert.equal(badName.status, 400)
    const badBody = await badName.text()
    assert.match(badBody, /the delivery tool name \\?"my tool!\\?" is not one every model accepts/)
    assert.ok(!badBody.includes("Expected"), badBody) // plain words, no schema dump
    assert.equal(
      lib.hats.list().some((h) => h.id === "h-bad"),
      false,
    )
    const wrapPrev = (await (
      await fetch(`${base}/preview`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ cardId: lifeOfPi.id, greetingIndex: 0, hatId: "h-wrap" }),
      })
    ).json()) as PreviewNarrateResult
    assert.equal(wrapPrev.connection.wrap, true)
    assert.equal(wrapPrev.connection.tool?.name, "actual_content")
    assert.ok(wrapPrev.connection.tool?.description.startsWith('Story: <message role="system">'))
    assert.equal(wrapPrev.connection.tool?.sources.description.kind, "hat")
    assert.equal(wrapPrev.connection.tool?.param, "The full reply, nothing omitted.")
    assert.deepEqual(
      wrapPrev.messages.map((m) => m.role),
      ["system", "user"],
    )
    assert.ok((wrapPrev.wrap?.traces.length ?? 0) > 0)
    const candWrap = await fetch(`${base}/preview`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ cardId: lifeOfPi.id, greetingIndex: 0, candidateHat: { id: "unsaved-wrap", ...wrapHat } }),
    })
    assert.equal(candWrap.status, 200)
    assert.equal(((await candWrap.json()) as PreviewNarrateResult).connection.wrap, true)
    const candBad = await fetch(`${base}/preview`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        cardId: lifeOfPi.id,
        candidateHat: { id: "unsaved-bad", ...wrapHat, tool: { name: "9lives" } },
      }),
    })
    assert.equal(candBad.status, 400)
    assert.match(await candBad.text(), /is not one every model accepts/)
  } finally {
    await server.stop(true)
  }
}

console.log("preview: ok")
