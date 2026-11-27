import { defects } from "./settle.ts"
import { installDiagnosticsBridge } from "@solidjs/diagnostics/browser"
import { render } from "@solidjs/web"
import { createSignal, flush, Show } from "solid-js"
import { Draft } from "../src/App.tsx"
import { read } from "../src/bridge.ts"
import { flip, locale, t } from "../src/i18n.ts"
import { apply, clear, draft, error, lost, registry, stage } from "../src/store.ts"
import { leadKind, settleKind, TurnStatus, type TurnStatusKind } from "../src/turn-status.tsx"
import "../src/app.css"

const bridge = installDiagnosticsBridge()
bridge.begin()
if (locale() !== "zh-CN") flip()

const failures: string[] = []
const check = (ok: boolean, why: string) => {
  if (!ok) failures.push(why)
}
const nextFrame = () => new Promise<void>((r) => requestAnimationFrame(() => r()))

void (async () => {
  try {
    // Pure mapping for the three moments (#208)
    check(leadKind(null, {}) === "waiting", "null phase maps to waiting")
    check(leadKind("lookup", {}) === "lookup", "lookup phase maps to lookup")
    check(leadKind("decide", {}) === "decide", "decide phase maps to decide")
    check(leadKind("direct", {}) === "direct", "direct phase maps to direct")
    check(leadKind("narrate", {}) === "narrate", "narrate without reasoning maps to narrate")
    check(leadKind("narrate", { thinking: true }) === "thinking", "reasoning-delta maps to thinking")
    check(
      leadKind("narrate", { prev: "first draft", thinking: true }) === "rewriting",
      "rewrite takes priority over thinking",
    )
    check(settleKind("check") === "check", "check settles as check")
    check(settleKind("polish") === "polish", "polish settles as polish")
    check(settleKind("record") === "record", "record settles as record")
    check(settleKind(null) === "record", "fallback settle kind is record")

    // 1. Standalone TurnStatus across all 9 active states
    const [kind, setKind] = createSignal<TurnStatusKind>("lookup")
    const [variant, setVariant] = createSignal<"lead" | "pill">("lead")
    const [immediate, setImmediate] = createSignal(true)
    const root = document.getElementById("root")!

    const disposeStatus = render(() => <TurnStatus kind={kind()} variant={variant()} immediate={immediate()} />, root)
    flush()

    const steps: [TurnStatusKind, "lead" | "pill", boolean, string][] = [
      ["lookup", "lead", true, t("app.phaseLookup")],
      ["decide", "lead", true, t("app.phaseDecide")],
      ["direct", "lead", true, t("app.phaseDirect")],
      ["narrate", "lead", false, t("app.phaseNarrate")],
      ["thinking", "lead", false, t("app.phaseThinking")],
      ["rewriting", "lead", true, t("app.phaseRewriting")],
      ["check", "pill", false, t("app.phaseCheck")],
      ["polish", "pill", false, t("app.phasePolish")],
      ["record", "pill", false, t("app.phaseRecord")],
    ]

    for (const [k, v, imm, expected] of steps) {
      setKind(k)
      setVariant(v)
      setImmediate(imm)
      flush()
      const el = root.querySelector<HTMLElement>('[role="status"].turn-status')
      check(el !== null, `status element missing for ${k}`)
      const canvas = el?.querySelector<HTMLCanvasElement>("canvas.turn-orb") ?? null
      check(canvas !== null && canvas.getAttribute("aria-hidden") === "true", `decorative orb canvas missing for ${k}`)
      const rect = canvas?.getBoundingClientRect()
      check(Boolean(rect && rect.width === 20 && rect.height === 20), `orb canvas must be 20x20 for ${k}`)
      check(el?.textContent === expected, `expected "${expected}" for ${k}, got "${el?.textContent}"`)
      check(
        v === "pill" ? Boolean(el?.classList.contains("record-pill")) : Boolean(el?.classList.contains("lead")),
        `variant class mismatch for ${k}`,
      )
    }
    disposeStatus()

    // 2. Real Draft + store.apply replay inside a reader column:
    //    (a) narrate -> narrate (truncation resume) appends prose and never enters rewrite
    //    (b) check -> narrate with queued prose keeps the rewriting explanation visible alongside the replacement
    const disposeDraft = render(() => {
      const d = read(draft)
      const phase = read(stage)
      const err = read(error)
      const gone = read(lost)
      return (
        <div class="panel">
          <div class="scroll">
            <main>
              <Show when={d()}>{(dr) => <Draft d={dr()} phase={phase()} error={err()} lost={gone()} />}</Show>
            </main>
          </div>
        </div>
      )
    }, root)
    flush()

    // (a) Truncation continuation: narrate -> narrate appends instead of rewriting
    registry.set(draft, { parent: null, input: { text: "继续" }, text: "" })
    apply({ kind: "stage", phase: "narrate" })
    apply({ kind: "delta", part: { type: "text-delta", id: "0", text: "甲" } })
    for (let i = 0; i < 40 && registry.get(draft)?.text !== "甲"; i++) await nextFrame()
    apply({ kind: "stage", phase: "narrate" })
    apply({ kind: "delta", part: { type: "text-delta", id: "0", text: "乙" } })
    for (let i = 0; i < 40 && registry.get(draft)?.text !== "甲乙"; i++) await nextFrame()
    flush()
    check(registry.get(draft)?.text === "甲乙", `expected resumed prose "甲乙", got "${registry.get(draft)?.text}"`)
    check(registry.get(draft)?.prev === undefined, "truncation resume must not move prose into prev")
    check(root.querySelector(".drafts .prev") === null, "truncation resume must not mount dust prev")
    check(
      root.querySelector('[role="status"].turn-status') === null,
      "truncation resume must not show rewriting status",
    )

    // (b) Queued rewrite: check + narrate + new first char arrive while first draft is still draining
    clear()
    registry.set(draft, { parent: null, input: { text: "重来" }, text: "" })
    apply({ kind: "stage", phase: "narrate" })
    apply({ kind: "delta", part: { type: "text-delta", id: "0", text: "旧稿第一句" } })
    apply({ kind: "stage", phase: "check" })
    apply({ kind: "stage", phase: "narrate" })
    apply({ kind: "delta", part: { type: "text-delta", id: "0", text: "新稿重写" } })
    for (let i = 0; i < 120 && !registry.get(draft)?.prev; i++) await nextFrame()
    flush()
    check(registry.get(draft)?.prev === "旧稿第一句", "queued rewrite must move first draft to prev")
    const rewriteStatus = root.querySelector<HTMLElement>('[role="status"].turn-status')
    check(
      rewriteStatus?.textContent === t("app.phaseRewriting"),
      `expected rewriting status during queued rewrite, got "${rewriteStatus?.textContent}"`,
    )

    // (c) A lost stream whose reading failed too (#226): the draft stays as it was, not greyed, under the plain
    // "connection lost" line and its retry; the retry reads again (this stand-in server answers no story, so it fails
    // again) and the line comes back, the draft still held. Waiting on the retry is still: no status animating before
    // any prose, no caret after it; reading again animates as writing does.
    clear()
    registry.set(draft, { parent: null, input: { text: "断线" }, text: "" })
    registry.set(lost, true)
    flush()
    const status = () => root.querySelector('.draft [role="status"].turn-status')
    check(status() === null, "lost before any prose: no status animating above the connection-lost line")
    registry.set(lost, false)
    flush()
    check(status() !== null, "not lost: the status before the first character is back")
    clear()
    registry.set(draft, { parent: null, input: { text: "断线" }, text: "写到一半" })
    registry.set(lost, true)
    flush()
    const alert = () => root.querySelector<HTMLElement>('.draft [role="alert"]')
    const caret = () => root.querySelector(".draft .cursor")
    check(caret() === null, "lost: no caret at the prose's edge")
    check(alert()?.textContent?.includes(t("app.connectionLost")) === true, "lost: the connection-lost line is drawn")
    check(!root.querySelector(".draft")?.classList.contains("dead"), "lost: the draft is not the failed turn's ghost")
    const retry = alert()?.querySelector<HTMLButtonElement>("button")
    check(retry?.textContent === t("common.retry"), "lost: the line carries a retry key")
    retry?.click()
    flush()
    check(registry.get(lost) === false, "retry: the line goes while the story is read again")
    check(caret() !== null, "retry: the caret is back while the story is read again")
    for (let i = 0; i < 100 && !registry.get(lost); i++) await nextFrame()
    flush()
    check(registry.get(lost) && alert() !== null, "retry failing again: the line is back")
    check(registry.get(draft)?.text === "写到一半", "retry failing again: the draft is held as it was")
    check(caret() === null, "retry failing again: the caret is still again")

    clear()
    flush()
    check(alert() === null, "cleared: no connection-lost line")
    disposeDraft()

    const found = defects(bridge.end().diagnostics)
    if (found.length) failures.push(`solid diagnostics: ${found.map((d) => `${d.code}: ${d.message}`).join("; ")}`)
  } catch (e) {
    failures.push(String(e))
  }

  void fetch("/result", { method: "POST", body: JSON.stringify({ failures, snapshot: [] }) })
})()
