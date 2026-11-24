// Shared read-only Request Assembly Outline used by both Prompt Tree and Inspector.
// Default view is a compact outline (message order, cache breakpoints, role rewrites, prefill conflict, clickable source spans);
// full message prose expands on demand. Gracefully falls back to region-only view for legacy Inspector calls without `trace`.
import type { Message } from "@effect-tavern/provider/src/call.ts"
import type {
  DeliveryToolTrace,
  MessageTrace,
  SourceKind,
  SourceRef,
  WireErrorInfo,
  WrapTrace,
} from "@effect-tavern/runtime/src/trace.ts"
import { createMemo, createSignal, For, Show } from "solid-js"
import {
  Card as CardIcon,
  Chat,
  Expand,
  Fold,
  Jump,
  Lightning,
  Next,
  Package,
  Settings,
  Template,
  User,
  Warning,
  Write,
} from "./icons.tsx"
import { WrapMark } from "./controls.tsx"
import { pattern, regions, textOf } from "./inspect.ts"
import {
  breakpointChars,
  messageText,
  toolParts,
  wrappedTexts,
  sliceSpanText,
  snippetOf,
  spanRows,
  sourceLabel,
  type SourceDestination,
} from "./prompt-tree-state.ts"
import { t } from "./i18n.ts"

const fmt = (n: number) => n.toLocaleString("en-US")

const kindLabel = (k: SourceKind): string => {
  switch (k) {
    case "harness":
      return t("promptTree.kindHarness")
    case "pack":
      return t("promptTree.kindPack")
    case "local":
      return t("promptTree.kindLocal")
    case "card":
      return t("promptTree.kindCard")
    case "persona":
      return t("promptTree.kindPersona")
    case "hat":
      return t("promptTree.kindHat")
    case "story":
      return t("promptTree.kindStory")
    case "runtime":
      return t("promptTree.kindRuntime")
  }
}

const bpLabel = (z: "head" | "summary" | "history"): string => {
  switch (z) {
    case "head":
      return t("promptTree.bpHead")
    case "summary":
      return t("promptTree.bpSummary")
    case "history":
      return t("promptTree.bpHistory")
  }
}

const destLabel = (dest: SourceDestination): string => {
  if (!dest.ok) return ""
  switch (dest.target?.kind) {
    case "workshop":
      return t("promptTree.jumpWorkshop")
    case "pack":
      return t("promptTree.jumpPack")
    case "hat":
      return t("promptTree.jumpHat")
    case "persona":
      return t("promptTree.jumpPersona")
    case "writing":
      return t("promptTree.jumpWriting")
    case "inspect":
      return t("promptTree.jumpInspector")
    case "timeline":
      return t("promptTree.jumpTimeline")
    default:
      return t("promptTree.jumpEditor")
  }
}

const Marked = (props: { text: string; q: string }) => {
  const parts = createMemo(() => (props.q ? props.text.split(pattern(props.q)) : [props.text]))
  return (
    <For each={parts()} keyed={false}>
      {(p, i) => (
        <Show when={i % 2} fallback={p()}>
          <mark>{p()}</mark>
        </Show>
      )}
    </For>
  )
}

const formatActual = (v: unknown): string => {
  if (v === undefined) return "—"
  return JSON.stringify(v) ?? "—"
}

const wireErrorText = (err: WireErrorInfo, deliver?: "text" | "tool"): string => {
  if (err.code !== "prefill_disallowed") return err.message
  return deliver === "tool" ? t("promptTree.diagDeliverNoPrefill") : t("promptTree.diagPrefillDisallowed")
}

const SourceKindGlyph = (props: { kind: SourceKind; title?: string }) => {
  const icon = () => {
    switch (props.kind) {
      case "card":
        return <CardIcon aria-hidden="true" />
      case "pack":
        return <Package aria-hidden="true" />
      case "local":
        return <Write aria-hidden="true" />
      case "hat":
        return <Template aria-hidden="true" />
      case "persona":
        return <User aria-hidden="true" />
      case "story":
        return <Chat aria-hidden="true" />
      case "runtime":
        return <Lightning aria-hidden="true" />
      case "harness":
        return <Settings aria-hidden="true" />
    }
  }
  return (
    <span class="rv-kind-ico" data-kind={props.kind} title={props.title ?? kindLabel(props.kind)}>
      {icon()}
    </span>
  )
}

export const SourceDetailCard = (props: {
  source: SourceRef
  excerpt?: string
  destination?: SourceDestination
  onJump?: (source: SourceRef) => void
}) => {
  const [showRaw, setShowRaw] = createSignal(false)
  const hasRawDiff = () =>
    props.source.rawText !== undefined && props.excerpt !== undefined && props.source.rawText !== props.excerpt
  const metaParts = () => {
    const s = props.source
    const lbl = sourceLabel(s)
    const out: string[] = []
    if (s.packName && s.packName !== lbl) out.push(s.packName)
    if (s.hatName && s.hatName !== lbl) out.push(s.hatName)
    if (s.personaName && s.personaName !== lbl) out.push(s.personaName)
    if (s.fragmentId && s.fragmentId !== lbl) out.push(s.fragmentId)
    if (s.entryId && s.entryId !== lbl) out.push(s.entryId)
    if (s.hatSlot && s.hatSlot !== lbl) out.push(`${s.hatStage ?? "narrate"}.${s.hatSlot}`)
    if (s.path && s.path !== lbl && !out.includes(s.path)) out.push(s.path)
    if (s.nodeId !== undefined) out.push(`#${s.nodeId}`)
    if (s.summaryRange) out.push(`#${s.summaryRange.from}–#${s.summaryRange.to}`)
    return out
  }
  return (
    <div class="rv-detail">
      <div class="rv-detail-head">
        <span class="rv-kind-pill" data-kind={props.source.kind}>
          <SourceKindGlyph kind={props.source.kind} />
          <span>{kindLabel(props.source.kind)}</span>
        </span>
        <Show when={metaParts().length}>
          <span class="rv-detail-path mono">{metaParts().join(" · ")}</span>
        </Show>
        <span class="rv-spacer" />
        <Show when={hasRawDiff()}>
          <button
            type="button"
            class="icon sm"
            aria-label={showRaw() ? t("promptTree.showExpanded") : t("promptTree.showRawTemplate")}
            aria-pressed={showRaw() ? "true" : "false"}
            title={showRaw() ? t("promptTree.showExpanded") : t("promptTree.showRawTemplate")}
            onClick={() => setShowRaw((v) => !v)}
          >
            <Template aria-hidden="true" />
          </button>
        </Show>
        <Show when={props.destination?.ok && props.onJump}>
          <button
            type="button"
            class="btn sm rv-jump"
            onClick={(e) => {
              e.stopPropagation()
              props.onJump?.(props.source)
            }}
          >
            <span>{destLabel(props.destination!)}</span>
            <Jump aria-hidden="true" />
          </button>
        </Show>
      </div>
      <Show when={props.source.whenDetails?.length}>
        <div class="rv-cond-list">
          <For each={props.source.whenDetails} keyed={false}>
            {(d) => (
              <div
                class={{
                  "rv-cond-row": true,
                  ok: !d().skipped && d().passed,
                  bad: !d().skipped && !d().passed,
                  skip: !!d().skipped,
                }}
              >
                <span class="rv-cond-mark" aria-hidden="true">
                  {d().skipped ? "–" : d().passed ? "✓" : "✗"}
                </span>
                <span class="rv-cond-expr mono">{d().expr}</span>
                <Show when={!d().skipped}>
                  <span class="rv-cond-actual mono">
                    {t("promptTree.actualValue", { v: formatActual(d().actual) })}
                  </span>
                </Show>
              </div>
            )}
          </For>
        </div>
      </Show>
      <Show when={props.excerpt !== undefined}>
        <pre class="rv-excerpt scroller">{hasRawDiff() && showRaw() ? props.source.rawText : props.excerpt}</pre>
      </Show>
    </div>
  )
}

export interface RequestViewProps {
  messages: readonly Message[]
  traces?: readonly MessageTrace[]
  /** Tool delivery (#221): the delivery tool as sent, its fields' sources when known (a recorded call has none). */
  tool?: Pick<DeliveryToolTrace, "name" | "description" | "param"> & { sources?: DeliveryToolTrace["sources"] }
  /** The hat's wrap (#220): the wrapped messages' traces and their sections in `tool.description`; `messages` and
   *  `traces` are then the outer shell, after the tool in the order the model meets them. */
  wrap?: Pick<WrapTrace, "traces" | "sections" | "context">
  wireError?: WireErrorInfo
  deliver?: "text" | "tool"
  q?: string
  compact?: boolean
  selectedKey?: string | null
  onSelectKey?: (key: string | null) => void
  expandedMessages?: readonly number[]
  onToggleExpand?: (index: number) => void
  resolveDestination?: (source: SourceRef) => SourceDestination
  onJump?: (source: SourceRef) => void
}

/** The expansion key of a wrapped message: below zero, apart from the outer messages' indices. */
export const wrappedExpandKey = (index: number) => -(index + 1)

export const RequestView = (props: RequestViewProps) => {
  const [localSelected, setLocalSelected] = createSignal<string | null>(null)
  const [localExpanded, setLocalExpanded] = createSignal<readonly number[]>([])

  const selectedKey = () => (props.onSelectKey ? (props.selectedKey ?? null) : localSelected())
  const toggleSelect = (key: string) => {
    const next = selectedKey() === key ? null : key
    if (props.onSelectKey) props.onSelectKey(next)
    else setLocalSelected(next)
  }

  const expandedList = () => (props.onToggleExpand ? (props.expandedMessages ?? []) : localExpanded())
  const isExpanded = (idx: number, text: string) => {
    if (expandedList().includes(idx)) return true
    if (props.q && text.toLowerCase().includes(props.q.toLowerCase())) return true
    return false
  }
  const toggleExpand = (idx: number) => {
    if (props.onToggleExpand) props.onToggleExpand(idx)
    else setLocalExpanded((list) => (list.includes(idx) ? list.filter((i) => i !== idx) : [...list, idx]))
  }

  const bpMap = createMemo(() => breakpointChars(props.traces ?? [], props.messages), {
    equals: (a, b) => a.size === b.size && [...a].every(([index, chars]) => b.get(index) === chars),
  })

  // the wrapped messages as the description carries them: each section's body, by its trace's index
  const wrapped = createMemo(() => (props.wrap && props.tool ? wrappedTexts(props.tool.description, props.wrap) : []))
  const wrappedText = createMemo(() => new Map(wrapped().map((w) => [w.trace.index, w.text])))
  const tool = createMemo(() => props.tool && toolParts(props.tool, props.wrap))

  /** One row of the tool: what it says, from where; opened, its source card (or its text alone, for a recorded call). */
  const ToolRow = (p: { id: string; label: string; text: string; source?: SourceRef; mono?: boolean }) => {
    const key = () => `tool:${p.id}`
    const open = () => selectedKey() === key()
    return (
      <div class={{ "rv-span-wrap": true, open: open() }}>
        <button
          type="button"
          class="rv-span-row"
          aria-expanded={open() ? "true" : "false"}
          onClick={() => toggleSelect(key())}
        >
          <Next class="rv-chev" aria-hidden="true" />
          <Show when={p.source}>{(src) => <SourceKindGlyph kind={src().kind} />}</Show>
          <span class="rv-span-label">{p.label}</span>
          <span class={{ "rv-span-snip": true, mono: !!p.mono }}>{snippetOf(p.text)}</span>
          <span class="rv-chars mono">{fmt(p.text.length)}c</span>
        </button>
        <Show when={open()}>
          <Show
            when={p.source}
            fallback={
              <div class="rv-detail">
                <pre class="rv-excerpt scroller">{p.text}</pre>
              </div>
            }
          >
            {(src) => (
              <SourceDetailCard
                source={src()}
                excerpt={p.text}
                destination={props.resolveDestination?.(src())}
                onJump={props.onJump}
              />
            )}
          </Show>
        </Show>
      </div>
    )
  }

  /** Messages as rows: the outer shell (`outer`: breakpoints and the wire's conflict), or the wrapped context. */
  const TraceRows = (p: {
    traces: readonly MessageTrace[]
    textAt: (tr: MessageTrace) => string
    prefix: "msg" | "wrap"
    expandAt: (index: number) => number
    outer?: boolean
  }) => (
    <For each={p.traces} keyed={(tr) => tr.index}>
      {(tr) => {
        const text = createMemo(() => p.textAt(tr()))
        const spans = createMemo(() => spanRows(tr().spans))
        const rewritten = () => tr().wiredRole !== undefined && tr().wiredRole !== tr().role
        const effectiveRole = () => tr().wiredRole ?? tr().role
        const conflict = () => !!p.outer && props.wireError?.messageIndex === tr().index
        const expanded = () => isExpanded(p.expandAt(tr().index), text())
        const wholeKey = () => `${p.prefix}:${tr().index}:whole`

        return (
          <>
            <article class={{ "rv-msg": true, conflict: conflict() }} data-role={effectiveRole()} data-zone={tr().zone}>
              <header class="rv-msg-head">
                <span class="rv-idx mono">#{tr().index + 1}</span>
                <span class="rv-zone mono">
                  {tr().zone === tr().subzone ? tr().zone : `${tr().zone} · ${tr().subzone}`}
                </span>
                <Show
                  when={rewritten()}
                  fallback={
                    <span class="rv-role" data-role={tr().role}>
                      {tr().role}
                    </span>
                  }
                >
                  <span class="rv-role-rewrite" title={t("promptTree.roleRewritten")}>
                    <span class="rv-role" data-role={tr().role}>
                      {tr().role}
                    </span>
                    <span class="rv-arrow" aria-hidden="true">
                      →
                    </span>
                    <span class="rv-role" data-role={tr().wiredRole}>
                      {tr().wiredRole}
                    </span>
                  </span>
                </Show>
                <Show when={conflict()}>
                  <span class="rv-badge bad">{t("promptTree.prefillConflict")}</span>
                </Show>
                <Show when={tr().partSummary?.reasoningCount}>
                  {(n) => <span class="rv-badge">{t("promptTree.reasoningParts", { n: n() })}</span>}
                </Show>
                <Show when={tr().partSummary?.toolCallCount}>
                  {(n) => <span class="rv-badge">{t("promptTree.toolCallParts", { n: n() })}</span>}
                </Show>
                <Show when={tr().partSummary?.toolResultCount}>
                  {(n) => <span class="rv-badge">{t("promptTree.toolResultParts", { n: n() })}</span>}
                </Show>
                <span class="rv-spacer" />
                <span class="rv-chars mono">{fmt(text().length || tr().chars)}c</span>
                <button
                  type="button"
                  class="icon sm rv-expand-btn"
                  aria-label={expanded() ? t("promptTree.collapseText") : t("promptTree.expandText")}
                  aria-pressed={expanded() ? "true" : "false"}
                  title={expanded() ? t("promptTree.collapseText") : t("promptTree.expandText")}
                  onClick={() => toggleExpand(p.expandAt(tr().index))}
                >
                  <Show when={expanded()} fallback={<Expand aria-hidden="true" />}>
                    <Fold aria-hidden="true" />
                  </Show>
                </button>
              </header>

              <Show
                when={!expanded()}
                fallback={
                  <div class="rv-full-wrap">
                    <div class="rv-full">
                      <Marked text={text()} q={props.q ?? ""} />
                    </div>
                  </div>
                }
              >
                <div class="rv-spans">
                  <Show
                    when={tr().spans.length > 0}
                    fallback={
                      <Show when={tr().source} fallback={<div class="rv-plain-snip">{snippetOf(text(), 180)}</div>}>
                        {(src) => {
                          const open = () => selectedKey() === wholeKey()
                          return (
                            <div class={{ "rv-span-wrap": true, open: open() }}>
                              <button
                                type="button"
                                class="rv-span-row"
                                aria-expanded={open() ? "true" : "false"}
                                onClick={() => toggleSelect(wholeKey())}
                              >
                                <Next class="rv-chev" aria-hidden="true" />
                                <SourceKindGlyph kind={src().kind} />
                                <span class="rv-span-label">{sourceLabel(src())}</span>
                                <span class="rv-span-snip">{snippetOf(text())}</span>
                                <span class="rv-chars mono">{fmt(text().length || tr().chars)}c</span>
                              </button>
                              <Show when={open()}>
                                <SourceDetailCard
                                  source={src()}
                                  excerpt={text()}
                                  destination={props.resolveDestination?.(src())}
                                  onJump={props.onJump}
                                />
                              </Show>
                            </div>
                          )
                        }}
                      </Show>
                    }
                  >
                    <For each={spans()} keyed={(row) => row.key}>
                      {(row) => {
                        const sp = createMemo(() => row().item)
                        const key = () => `${p.prefix}:${tr().index}:span:${row().key}`
                        const open = () => selectedKey() === key()
                        const sliced = createMemo(() => sliceSpanText(text(), sp()))
                        const chars = () => Math.max(0, sp().end - sp().start)
                        return (
                          <div class={{ "rv-span-wrap": true, open: open() }}>
                            <button
                              type="button"
                              class="rv-span-row"
                              aria-expanded={open() ? "true" : "false"}
                              onClick={() => toggleSelect(key())}
                            >
                              <Next class="rv-chev" aria-hidden="true" />
                              <SourceKindGlyph kind={sp().source.kind} />
                              <span class="rv-span-label">{sourceLabel(sp().source)}</span>
                              <Show when={sp().source.whenText}>
                                {(w) => (
                                  <span class="rv-cond ok" title={w()}>
                                    ✓ {w()}
                                  </span>
                                )}
                              </Show>
                              <span class="rv-span-snip">{snippetOf(sliced())}</span>
                              <span class="rv-chars mono">{fmt(chars())}c</span>
                            </button>
                            <Show when={open()}>
                              <SourceDetailCard
                                source={sp().source}
                                excerpt={sliced()}
                                destination={props.resolveDestination?.(sp().source)}
                                onJump={props.onJump}
                              />
                            </Show>
                          </div>
                        )
                      }}
                    </For>
                  </Show>
                </div>
              </Show>
            </article>

            <Show when={p.outer && tr().breakpoint}>
              {(bp) => (
                <div class="rv-bp" title={t("inspector.breakpoint")}>
                  <span>
                    {bpLabel(bp().zone)} · {fmt(bpMap().get(tr().index) ?? 0)}c
                    <Show when={bp().ttl}>{(ttl) => ` · ${t("promptTree.bpTtl", { ttl: ttl() })}`}</Show>
                  </span>
                </div>
              )}
            </Show>
          </>
        )
      }}
    </For>
  )

  return (
    <div class={{ "rv-root": true, compact: !!props.compact }}>
      <Show when={props.wireError}>
        {(err) => {
          const dest = () =>
            err().source && props.resolveDestination ? props.resolveDestination(err().source!) : undefined
          return (
            <div class="rv-wire-err" role="alert">
              <Warning aria-hidden="true" />
              <div class="rv-wire-err-body">
                <strong>
                  {t("promptTree.prefillConflictTitle", {
                    n: err().messageIndex + 1,
                    format: err().format ?? "narrative",
                  })}
                </strong>
                <p>{wireErrorText(err(), props.deliver)}</p>
              </div>
              <Show when={err().source && dest()?.ok && props.onJump}>
                <button type="button" class="btn sm" onClick={() => props.onJump?.(err().source!)}>
                  <span>{destLabel(dest()!)}</span>
                  <Jump aria-hidden="true" />
                </button>
              </Show>
            </div>
          )
        }}
      </Show>

      {/* the delivery tool first, as every vendor's request puts it before the messages; under the wrap the story
          context sits inside its description, between the description's own wording */}
      <Show when={tool()}>
        {(parts) => (
          <section class={{ "rv-tool": true, wrapped: !!props.wrap }} aria-label={t("promptTree.toolZone")}>
            <header class="rv-tool-head">
              <span class="rv-tool-title">{t("promptTree.toolZone")}</span>
              <span class="rv-tool-name mono">{parts().name}</span>
              <Show when={props.wrap}>
                <WrapMark />
              </Show>
              <span class="rv-spacer" />
              <span class="rv-chars mono">{fmt(parts().description.length)}c</span>
            </header>
            <div class="rv-spans">
              <ToolRow
                id="name"
                label={t("promptTree.toolName")}
                text={parts().name}
                source={props.tool?.sources?.name}
                mono
              />
              <Show
                when={props.wrap}
                fallback={
                  <ToolRow
                    id="description"
                    label={t("promptTree.toolDescription")}
                    text={parts().description}
                    source={props.tool?.sources?.description}
                  />
                }
              >
                <Show when={parts().before}>
                  <ToolRow
                    id="before"
                    label={t("promptTree.toolDescription")}
                    text={parts().before}
                    source={props.tool?.sources?.description}
                  />
                </Show>
                <div class="rv-wrapped" role="group" aria-label={t("promptTree.wrappedContext")}>
                  <div class="rv-wrapped-head">
                    <span>{t("promptTree.wrappedContext")}</span>
                    <span class="rv-spacer" />
                    <span class="rv-chars mono">{fmt(parts().context.length)}c</span>
                  </div>
                  <div class="rv-list">
                    <TraceRows
                      traces={wrapped().map((w) => w.trace)}
                      textAt={(tr) => wrappedText().get(tr.index) ?? ""}
                      prefix="wrap"
                      expandAt={wrappedExpandKey}
                    />
                  </div>
                </div>
                <Show when={parts().after}>
                  <ToolRow
                    id="after"
                    label={t("promptTree.toolDescription")}
                    text={parts().after}
                    source={props.tool?.sources?.description}
                  />
                </Show>
              </Show>
              <ToolRow
                id="param"
                label={t("promptTree.toolParam")}
                text={parts().param}
                source={props.tool?.sources?.param}
              />
            </div>
          </section>
        )}
      </Show>
      {/* where a breakpoint would be marked: under the wrap there is none, the prefix cache is off */}
      <Show when={props.wrap}>
        <div class="rv-bp off" title={t("promptTree.cacheOffWhy")}>
          <span>{t("promptTree.cacheOff")}</span>
        </div>
        <div class="rv-zone-title">{t("promptTree.outerMessages")}</div>
      </Show>

      <Show
        when={props.traces && props.traces.length > 0}
        fallback={
          /* Legacy Inspector records without `trace`: render classic region + message view */
          <div class="rv-legacy">
            <For each={regions(props.messages)} keyed={false}>
              {(r) => (
                <>
                  <For each={r().msgs} keyed={false}>
                    {(m) => (
                      <div class="msg" data-role={m().role}>
                        <span class="role">{m().role}</span>
                        <div class="txt">
                          <Marked text={textOf(m())} q={props.q ?? ""} />
                        </div>
                      </div>
                    )}
                  </For>
                  <Show when={r().breakpoint}>
                    <div class="bp" title={t("inspector.breakpoint")}>
                      {r().name} {fmt(r().chars)}c
                    </div>
                  </Show>
                </>
              )}
            </For>
          </div>
        }
      >
        <div class="rv-list">
          <TraceRows
            traces={props.traces!}
            textAt={(tr) => messageText(props.messages[tr.index])}
            prefix="msg"
            expandAt={(i) => i}
            outer
          />
        </div>
      </Show>
    </div>
  )
}
