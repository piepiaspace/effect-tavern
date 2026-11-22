// Prompt Tree: design-time read-only request assembly preview (sandbox & story branch modes).
// Outline-first, calm 2-column layout: left shows ordered narrate messages, cache breakpoints, role rewrites,
// prefill conflicts, and clickable source attribution (with collapsed omitted & resources sections);
// right holds restrained sandbox controls (opening, fields including hidden, player input) or story branch node picker.
import type { PreviewDiagnostic, PreviewNarrateResult, ResourceEntryView } from "@effect-tavern/runtime/src/preview.ts"
import type { TimelineNode as Node } from "@effect-tavern/runtime/src/projection.ts"
import type { OmittedReason, SourceRef } from "@effect-tavern/runtime/src/trace.ts"
import * as L from "@effect-tavern/runtime/src/log.ts"
import { createEffect, createMemo, createSignal, For, onSettled, Show } from "solid-js"
import { read } from "./bridge.ts"
import { Menu, Stepper, Switch, Tick } from "./controls.tsx"
import { Family } from "./family.tsx"
import { Back, EyeOff, Fold, Next, Plugs, Swipe, Warning } from "./icons.tsx"
import { t } from "./i18n.ts"
import { close, openPreviewEditor, openStoryPage } from "./pages.ts"
import {
  buildPreviewRequest,
  defaultMemory,
  getPromptTreeMemory,
  omittedRows,
  reusePreviewOutline,
  scrubPlayPreview,
  setPromptTreeMemory,
  sourceDestination,
  sourceLabel,
  type PromptTreeMemory,
} from "./prompt-tree-state.ts"
import { RequestView, SourceDetailCard } from "./request-view.tsx"
import { openSettings } from "./settings-navigation.ts"
import { activeOf, cards, cardTitle, characterCards, FREE_CHAT_ID, isFreeChat, log, stories, tabs } from "./store.ts"
import { fetchPreview, fetchStoryNodes } from "./wire.ts"

const omittedReasonLabel = (r: OmittedReason): string => {
  switch (r) {
    case "when_false":
      return t("promptTree.reasonWhenFalse")
    case "disabled":
      return t("promptTree.reasonDisabled")
    case "muted":
      return t("promptTree.reasonMuted")
    case "yielded":
      return t("promptTree.reasonYielded")
    case "overridden":
      return t("promptTree.reasonOverridden")
    case "unfilled_hole":
      return t("promptTree.reasonUnfilledHole")
    case "empty_text":
      return t("promptTree.reasonEmptyText")
    case "empty_slot":
      return t("promptTree.reasonEmptySlot")
    case "folded":
      return t("promptTree.reasonFolded")
    case "outside_window":
      return t("promptTree.reasonOutsideWindow")
    case "invalid":
      return t("promptTree.reasonInvalid")
  }
}

const residencyLabel = (s: ResourceEntryView["residencyStatus"]): string => {
  switch (s) {
    case "none":
      return t("promptTree.resNone")
    case "resident_in_window":
      return t("promptTree.resWindow")
    case "resident_permanent":
      return t("promptTree.resPermanent")
    case "delivered_this_turn":
      return t("promptTree.resThisTurn")
  }
}

const diagnosticText = (d: PreviewDiagnostic, deliverTool: boolean): string => {
  switch (d.code) {
    case "deliver_needs_tools":
      return t("promptTree.diagDeliverNeedsTools")
    case "hat_needs_tools":
      return t("promptTree.diagHatNeedsTools")
    case "prefill_disallowed":
      return deliverTool ? t("promptTree.diagDeliverNoPrefill") : t("promptTree.diagPrefillDisallowed")
    default:
      return d.message
  }
}

export const PromptTreePage = () => {
  const strip = read(tabs)
  const shelf = read(cards)
  const lib = read(stories)
  const activeLog = read(log)

  const tab = createMemo(() => activeOf(strip()))
  const tabId = () => tab().id

  const [revision, edited] = createSignal(0)
  const mem = createMemo((): PromptTreeMemory => {
    revision()
    const existing = getPromptTreeMemory(tabId())
    if (existing) return existing
    const fallbackCard = tab().card ?? characterCards(shelf())[0]?.id ?? FREE_CHAT_ID
    const origin = tab().under.at(-1)
    if (origin === "settings" || origin === "manuscript") return defaultMemory(fallbackCard)
    const storyId = lib()?.stories.find((s) => s.id === tab().story && s.card === fallbackCard)?.id
    return {
      ...defaultMemory(fallbackCard),
      mode: "story",
      play: true,
      storyId,
      nodeId: storyId === undefined ? null : undefined,
    }
  })
  const [pane, setPane] = createSignal<"outline" | "controls">("outline")
  const [cacheRevision, cacheChanged] = createSignal(0)
  let lastShown: { context: string; value: PreviewNarrateResult } | undefined
  const [slowContext, setSlowContext] = createSignal<string | null>(null)
  const [errMsg, setErrMsg] = createSignal<string | null>(null)
  const [fetchedStory, setFetchedStory] = createSignal<{
    id: number
    nodes: readonly Node[]
    head: number | null
  } | null>(null)

  // Per-mount caches (discarded automatically when leaving Prompt Tree so returning from an editor is always fresh).
  const previewCache = new Map<string, PreviewNarrateResult>()
  const storyNodesCache = new Map<number, { nodes: readonly Node[]; head: number | null }>()
  type Timing = "immediate" | "step" | "text"
  let timing: Timing = "immediate"

  const update = (patch: Partial<PromptTreeMemory>, next: Timing = "immediate") => {
    timing = next
    const id = tabId()
    setPromptTreeMemory(id, { ...(getPromptTreeMemory(id) ?? mem()), ...patch })
    edited((n) => n + 1)
  }

  // Stories belonging to the currently previewed card.
  const cardId = createMemo(() => mem().cardId)
  const cardStories = createMemo(() => {
    const cid = cardId()
    if (!cid) return []
    return (lib()?.stories ?? []).filter((s) => s.card === cid)
  })

  // Derive story nodes synchronously from activeLog / cache / fetchedStory (zero effect relay tear).
  const storyView = createMemo(() => {
    const m = mem()
    if (m.mode !== "story" || m.storyId === undefined)
      return { nodes: [] as readonly Node[], head: null as number | null }
    if (m.storyId === lib()?.current) {
      const curLog = activeLog()
      return { nodes: [...curLog.nodes.values()].sort((a, b) => a.id - b.id), head: curLog.head }
    }
    const cached = storyNodesCache.get(m.storyId)
    if (cached) return cached
    const f = fetchedStory()
    if (f && f.id === m.storyId) return { nodes: f.nodes, head: f.head }
    return { nodes: [] as readonly Node[], head: null as number | null }
  })
  const storyNodes = () => storyView().nodes
  const storyHead = () => storyView().head

  // Fetch story nodes only when not active and not already cached.
  const inactiveStoryId = createMemo(() => {
    const m = mem()
    const sid = m.mode === "story" ? m.storyId : undefined
    return sid !== undefined && sid !== lib()?.current ? sid : undefined
  })
  createEffect(
    () => inactiveStoryId(),
    (sid) => {
      if (sid === undefined || storyNodesCache.has(sid)) return
      const ac = new AbortController()
      void fetchStoryNodes(sid, ac.signal).then(
        (snap) => {
          if (ac.signal.aborted) return
          const l = L.of(snap)
          const nodes = [...l.nodes.values()].sort((a, b) => a.id - b.id)
          storyNodesCache.set(sid, { nodes, head: l.head })
          setFetchedStory({ id: sid, nodes, head: l.head })
        },
        () => {},
      )
      return () => ac.abort()
    },
  )

  // Fetch preview whenever the preview request parameters change.
  // Layout and selection edits leave the request key unchanged.
  const requestEntry = createMemo(
    () => {
      const m = mem()
      const body = buildPreviewRequest(m)
      // Keep the outline mounted across edits within the same tab, audience, card, mode, and story
      // (including branch node, greeting, fields, events, and input). Switching tab, audience, card,
      // mode, or story clears the outline so unrelated or author-only data never lingers.
      const context = JSON.stringify({
        tab: tabId(),
        play: m.play,
        card: m.cardId,
        mode: m.mode,
        story: m.storyId,
      })
      return { body, context, key: JSON.stringify([context, body]) }
    },
    { equals: (a, b) => a.key === b.key },
  )

  const result = createMemo<PreviewNarrateResult | null>(() => {
    const { key, context } = requestEntry()
    cacheRevision()
    return previewCache.get(key) ?? (lastShown?.context === context ? lastShown.value : null)
  })
  // Entered from play (the session card): a condition that reads a hidden field is not shown, and an entry it left out is not listed.
  const play = createMemo(() => !!mem().play)
  const selectedKey = createMemo(() => mem().selectedKey)
  const expandedMessages = createMemo(() => mem().expandedMessages, {
    equals: (a, b) => a.length === b.length && a.every((x, i) => x === b[i]),
  })
  const shown = createMemo<PreviewNarrateResult | null>(() => {
    if (errMsg() !== null) return null
    const r = result()
    return !r || !play() ? r : scrubPlayPreview(r)
  })
  const sandboxControls = createMemo(() => {
    const r = result()
    return r?.mode === "sandbox" && r.card.id === mem().cardId ? r.sandbox : undefined
  })

  const omitted = createMemo(() => omittedRows(shown()?.omitted ?? []))
  const loading = () => slowContext() === requestEntry().context && !previewCache.has(requestEntry().key)

  type Entry = ReturnType<typeof requestEntry>
  let active: { entry: Entry; controller: AbortController } | undefined
  let pending: { entry: Entry; readyAt: number; step: boolean } | undefined
  let wake: ReturnType<typeof setTimeout> | undefined
  let lastStep = -Infinity

  // At most one request runs in a context. While it runs, only the newest unsent input matters.
  const dispatch = async () => {
    if (!pending || active) return
    clearTimeout(wake)
    const { entry, readyAt, step } = pending
    const wait = readyAt - performance.now()
    if (wait > 0) {
      wake = setTimeout(() => void dispatch(), Math.ceil(wait))
      return
    }
    pending = undefined
    const { key, context, body } = entry
    const controller = new AbortController()
    active = { entry, controller }
    if (step) lastStep = performance.now()
    const busyTimer = setTimeout(() => {
      if (!controller.signal.aborted) setSlowContext(context)
    }, 150)
    try {
      const response = await fetchPreview(body, controller.signal)
      if (controller.signal.aborted) return
      const value = reusePreviewOutline(lastShown?.context === context ? lastShown.value : undefined, response)
      previewCache.set(key, value)
      if (previewCache.size > 64) previewCache.delete(previewCache.keys().next().value!)
      if (key === requestEntry().key) {
        lastShown = { context, value }
        cacheChanged((n) => n + 1)
      }
    } catch (e) {
      if (!controller.signal.aborted && key === requestEntry().key)
        setErrMsg(e instanceof Error ? e.message : String(e))
    } finally {
      clearTimeout(busyTimer)
      if (!controller.signal.aborted) {
        active = undefined
        setSlowContext(null)
        void dispatch()
      }
    }
  }

  createEffect(
    () => requestEntry(),
    (entry) => {
      const nextTiming = timing
      timing = "immediate"
      clearTimeout(wake)
      pending = undefined
      setErrMsg(null)
      if (active && active.entry.context !== entry.context) {
        active.controller.abort()
        active = undefined
        setSlowContext(null)
        lastStep = -Infinity
      }
      const cached = previewCache.get(entry.key)
      if (cached) {
        previewCache.delete(entry.key)
        previewCache.set(entry.key, cached)
        lastShown = { context: entry.context, value: cached }
        return
      }
      if (active?.entry.key === entry.key) return
      const readyAt = nextTiming === "text" ? performance.now() + 120 : nextTiming === "step" ? lastStep + 75 : 0
      pending = { entry, readyAt, step: nextTiming === "step" }
      queueMicrotask(() => void dispatch())
    },
  )
  onSettled(() => () => {
    pending = undefined
    clearTimeout(wake)
    active?.controller.abort()
  })

  const currentCardTitle = () => {
    const r = result()
    if (r?.card.title) return isFreeChat(r.card.id, shelf()) ? t("home.freeChat") : r.card.title
    const cid = mem().cardId
    if (!cid) return ""
    return cardTitle(shelf().find((c) => c.id === cid) ?? cid, shelf())
  }

  const resolveDest = (source: SourceRef) => {
    const m = mem()
    const cid = m.cardId
    return sourceDestination(source, {
      cardId: cid,
      isFreeChatCard: isFreeChat(cid, shelf()),
      hasStory: m.mode === "story" && m.storyId !== undefined,
      hasNode: (nodeId) => storyNodes().some((n) => n.id === nodeId),
    })
  }

  const jumpTo = (source: SourceRef) => {
    const dest = resolveDest(source)
    if (!dest.ok || !dest.target) return
    const m = mem()
    switch (dest.target.kind) {
      case "workshop":
        if (m.candidateCard) update({ candidateCard: undefined })
        void openPreviewEditor(dest.target.cardId, "manuscript")
        break
      case "pack":
        openSettings("packs", dest.target.packId)
        break
      case "hat":
        if (m.candidateHat) update({ candidateHat: undefined })
        openSettings("templates", dest.target.hatId)
        break
      case "persona":
        openSettings("personas", dest.target.personaId)
        break
      case "writing":
        if (m.cardId) void openPreviewEditor(m.cardId, "writing")
        break
      case "inspect":
      case "timeline":
        if (m.storyId !== undefined)
          void openStoryPage(m.storyId, dest.target.kind === "timeline" ? "timeline" : { inspect: dest.target.nodeId })
        break
    }
  }

  const switchMode = (nextMode: "sandbox" | "story") => {
    if (nextMode === mem().mode) return
    if (nextMode === "story") {
      const list = cardStories()
      if (!list.length) return
      const activeId = tab().story
      const picked = list.find((s) => s.id === activeId)?.id ?? list[0].id
      update({ mode: "story", storyId: picked, nodeId: undefined, candidateCard: undefined })
    } else {
      update({ mode: "sandbox" })
    }
  }

  const setField = (path: string, value: unknown, timing: Timing = "immediate") => {
    update({ fields: { ...mem().fields, [path]: value } }, timing)
  }

  const resetFields = () => update({ fields: {} })

  const toggleEvent = (ev: string) => {
    const cur = mem().events
    update({ events: cur.includes(ev) ? cur.filter((x) => x !== ev) : [...cur, ev] })
  }

  const toggleAssumedRead = (resourceId: string) => {
    const cur = mem().assumedReads
    update({ assumedReads: cur.includes(resourceId) ? cur.filter((x) => x !== resourceId) : [...cur, resourceId] })
  }

  const toggleInvoke = (resourceId: string) => {
    const cur = mem().inputInvoke
    update({ inputInvoke: cur.includes(resourceId) ? cur.filter((x) => x !== resourceId) : [...cur, resourceId] })
  }

  const toggleExpandMsg = (idx: number) => {
    const cur = mem().expandedMessages
    update({ expandedMessages: cur.includes(idx) ? cur.filter((x) => x !== idx) : [...cur, idx] })
  }

  const allExpanded = () => {
    const traces = result()?.traces ?? []
    return traces.length > 0 && traces.every((tr) => expandedMessages().includes(tr.index))
  }

  const toggleExpandAll = () => {
    const traces = result()?.traces ?? []
    update({ expandedMessages: allExpanded() ? [] : traces.map((tr) => tr.index) })
  }

  const displayedMessages = () => {
    const r = result()
    if (!r) return []
    return r.connection.routingSource === "none" ? r.messages : (r.wiredMessages ?? r.messages)
  }

  const connectionTooltip = () => {
    const c = result()?.connection
    if (!c) return ""
    if (c.routingSource === "none") return t("promptTree.noConnectionNote")
    const parts: string[] = []
    if (c.providerName) parts.push(c.providerName)
    if (c.modelId) parts.push(c.modelId)
    if (c.format) parts.push(c.format)
    if (c.deliver === "tool") parts.push(t("promptTree.deliverTool"))
    return parts.join(" / ") || c.routingSource || ""
  }

  const modifiedFieldCount = () => {
    return sandboxControls()?.fields.filter((f) => f.value !== f.initial).length ?? 0
  }

  const sampleCards = createMemo(() => characterCards(shelf()))

  const [selectedOmitted, setSelectedOmitted] = createSignal<string | null>(null)
  const [eventDraft, setEventDraft] = createSignal("")
  const [eventsOpen, setEventsOpen] = createSignal(false)
  const addCustomEvent = () => {
    const ev = eventDraft().trim()
    if (!ev) return
    if (!mem().events.includes(ev)) update({ events: [...mem().events, ev] })
    setEventDraft("")
  }

  return (
    <div class="inspect pt-page" data-pane={pane() === "outline" ? "pipeline" : "node"}>
      <header class="top">
        <button type="button" class="icon" aria-label={t("common.back")} onClick={close}>
          <Back />
        </button>
        <div class="pt-title-wrap">
          <h1>{t("promptTree.title")}</h1>
          <Show when={currentCardTitle()}>
            <span class="pt-card-chip">{currentCardTitle()}</span>
          </Show>
          <Show when={mem().sampleCard}>
            <span class="pill soft">{t("promptTree.sampleCard")}</span>
          </Show>
          <Show when={mem().candidateCard || mem().candidateHat}>
            <span class="pill warn">{t("promptTree.unsavedDraft")}</span>
          </Show>
        </div>

        <div class="pt-header-end">
          <Show when={!mem().play}>
            <div class="seg pt-mode" role="tablist" aria-label={t("promptTree.mode")}>
              <button
                type="button"
                role="tab"
                aria-selected={mem().mode === "sandbox" ? "true" : "false"}
                onClick={() => switchMode("sandbox")}
              >
                {t("promptTree.modeSandbox")}
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={mem().mode === "story" ? "true" : "false"}
                disabled={!cardStories().length || !!mem().candidateCard}
                title={!cardStories().length ? t("promptTree.noStoriesForCard") : undefined}
                onClick={() => switchMode("story")}
              >
                {t("promptTree.modeStory")}
              </button>
            </div>
          </Show>

          <Show when={result()}>
            {(r) => {
              const c = () => r().connection
              const isNone = () => c().routingSource === "none"
              return (
                <button
                  type="button"
                  class={{ "pt-conn": true, warn: isNone() }}
                  title={connectionTooltip()}
                  onClick={() => openSettings("routing")}
                >
                  <Show
                    when={!isNone()}
                    fallback={
                      <>
                        <Warning aria-hidden="true" />
                        <span>{t("promptTree.noConnection")}</span>
                      </>
                    }
                  >
                    <Show when={c().modelId} fallback={<Plugs aria-hidden="true" />}>
                      {(mid) => <Family id={mid()} />}
                    </Show>
                    <span class="pt-conn-name">{c().modelId ?? c().format ?? c().routingSource}</span>
                  </Show>
                </button>
              )
            }}
          </Show>

          <div class="seg" role="tablist" aria-label={t("promptTree.view")}>
            <button
              type="button"
              role="tab"
              aria-selected={pane() === "outline" ? "true" : "false"}
              onClick={() => setPane("outline")}
            >
              {t("promptTree.paneOutline")}
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={pane() === "controls" ? "true" : "false"}
              onClick={() => setPane("controls")}
            >
              {t("promptTree.paneControls")}
            </button>
          </div>
        </div>
      </header>

      <div class="cols">
        <section class="pane pipeline pt-main" aria-label={t("promptTree.paneOutline")}>
          <Show when={loading() && !shown() && !errMsg()}>
            <span class="pt-meta-item muted" role="status">
              {t("promptTree.updating")}
            </span>
          </Show>
          <Show when={errMsg()}>
            {(msg) => (
              <div class="pt-alert bad" role="alert">
                <Warning aria-hidden="true" />
                <div>
                  <strong>{t("promptTree.previewError")}</strong>
                  <pre>{msg()}</pre>
                </div>
              </div>
            )}
          </Show>

          <Show when={shown()}>
            {(r) => (
              <>
                <div class="pt-meta-strip">
                  <span class="pt-meta-item mono">{t("promptTree.messageCount", { n: r().traces.length })}</span>
                  <Show when={r().connection.hatName}>
                    {(hn) => <span class="pt-meta-item">{t("promptTree.hatActive", { name: hn() })}</span>}
                  </Show>
                  <Show when={(r().connection.deliver ?? mem().candidateHat?.deliver) === "tool"}>
                    <span class="pill soft pt-deliver-chip">{t("promptTree.deliverTool")}</span>
                  </Show>
                  <Show when={r().mode === "sandbox"}>
                    <span class="pt-meta-item muted">
                      {r().upstream.lookup.status === "simulated_assumed"
                        ? t("promptTree.upstreamSimulated", { n: r().upstream.lookup.assumedReads.length })
                        : t("promptTree.upstreamSkipped")}
                    </span>
                  </Show>
                  <span class="pt-meta-item muted pt-updating" role={loading() ? "status" : undefined}>
                    {t("promptTree.updating")}
                  </span>
                  <span class="rv-spacer" />
                  <Show when={r().traces.length > 0}>
                    <button
                      type="button"
                      class="icon sm"
                      aria-label={t("promptTree.toggleExpandAll")}
                      aria-pressed={allExpanded() ? "true" : "false"}
                      title={t("promptTree.toggleExpandAll")}
                      onClick={toggleExpandAll}
                    >
                      <Fold aria-hidden="true" />
                    </button>
                  </Show>
                </div>

                <Show when={r().connection.routingSource === "none"}>
                  <div class="pt-alert info">
                    <span>{t("promptTree.noConnectionNote")}</span>
                    <button type="button" class="btn sm" onClick={() => openSettings("routing")}>
                      {t("app.goDefaultModel")}
                    </button>
                  </div>
                </Show>

                <Show when={r().diagnostics.length > 0}>
                  <div class="pt-diags">
                    <For each={r().diagnostics} keyed={false}>
                      {(d) => (
                        <div class={{ "pt-alert": true, [d().level]: true }}>
                          <Warning aria-hidden="true" />
                          <span>
                            {diagnosticText(d(), (r().connection.deliver ?? mem().candidateHat?.deliver) === "tool")}
                          </span>
                        </div>
                      )}
                    </For>
                  </div>
                </Show>

                <RequestView
                  messages={displayedMessages()}
                  traces={r().traces}
                  wireError={r().wireError}
                  deliver={r().connection.deliver ?? mem().candidateHat?.deliver}
                  selectedKey={selectedKey()}
                  onSelectKey={(k) => update({ selectedKey: k })}
                  expandedMessages={expandedMessages()}
                  onToggleExpand={toggleExpandMsg}
                  resolveDestination={resolveDest}
                  onJump={jumpTo}
                />

                {/* Secondary section 1: Omitted items (collapsed by default) */}
                <details
                  class="pt-fold"
                  open={mem().showOmitted || undefined}
                  onToggle={(e) => {
                    if (e.currentTarget.open !== mem().showOmitted) update({ showOmitted: e.currentTarget.open })
                  }}
                >
                  <summary>
                    <Next class="pt-chev" aria-hidden="true" />
                    <span>{t("promptTree.omittedTitle")}</span>
                    <span class="pt-count mono">{r().omitted.length}</span>
                  </summary>
                  <div class="pt-fold-body">
                    <Show
                      when={r().omitted.length > 0}
                      fallback={<p class="pt-empty">{t("promptTree.omittedEmpty")}</p>}
                    >
                      <div class="pt-omitted-list">
                        <For each={omitted()} keyed={(row) => row.key}>
                          {(row) => {
                            const item = () => row().item
                            const key = () => row().key
                            const open = () => selectedOmitted() === key()
                            const detail = () => {
                              const story = r().story
                              if (story && item().reason === "outside_window")
                                return t("promptTree.turnsOutsideWindow", { n: story.foldStart })
                              if (story?.summaryRange && item().reason === "folded")
                                return t("promptTree.turnsSummarized", { n: story.foldStart, ...story.summaryRange })
                              return item().detail
                            }
                            return (
                              <div class={{ "pt-omitted-wrap": true, open: open() }}>
                                <button
                                  type="button"
                                  class="pt-omitted-row"
                                  aria-expanded={open() ? "true" : "false"}
                                  onClick={() => setSelectedOmitted(open() ? null : key())}
                                >
                                  <Next class="rv-chev" aria-hidden="true" />
                                  <span class="pill mono">{item().category}</span>
                                  <span class="pt-omitted-label">{item().label ?? item().id}</span>
                                  <span class="pill soft">{omittedReasonLabel(item().reason)}</span>
                                  <Show when={item().source.whenText}>
                                    {(w) => (
                                      <span class="pt-omitted-cond mono" title={w()}>
                                        {w()}
                                      </span>
                                    )}
                                  </Show>
                                </button>
                                <Show when={open()}>
                                  <div class="pt-omitted-detail">
                                    <Show when={detail()}>{(text) => <p class="pt-omitted-by">{text()}</p>}</Show>
                                    <Show when={item().by}>
                                      {(by) => (
                                        <p class="pt-omitted-by">
                                          {t("promptTree.overriddenBy", { name: sourceLabel(by()) })}
                                        </p>
                                      )}
                                    </Show>
                                    <Show when={item().missingHoles?.length ? item().missingHoles : undefined}>
                                      {(holes) => (
                                        <p class="pt-omitted-by mono">
                                          {t("promptTree.missingHoles", { holes: holes().join(", ") })}
                                        </p>
                                      )}
                                    </Show>
                                    <SourceDetailCard
                                      source={item().source}
                                      excerpt={item().preview}
                                      destination={resolveDest(item().source)}
                                      onJump={jumpTo}
                                    />
                                  </div>
                                </Show>
                              </div>
                            )
                          }}
                        </For>
                      </div>
                    </Show>
                  </div>
                </details>

                {/* Secondary section 2: Resources & simulated reads (collapsed by default) */}
                <details
                  class="pt-fold"
                  open={mem().showResources || undefined}
                  onToggle={(e) => {
                    if (e.currentTarget.open !== mem().showResources) update({ showResources: e.currentTarget.open })
                  }}
                >
                  <summary>
                    <Next class="pt-chev" aria-hidden="true" />
                    <span>{t("promptTree.resourcesTitle")}</span>
                    <span class="pt-count mono">{r().resources.length}</span>
                    <Show when={mem().assumedReads.length > 0}>
                      <span class="pill ok">{t("promptTree.simulatedCount", { n: mem().assumedReads.length })}</span>
                    </Show>
                  </summary>
                  <div class="pt-fold-body">
                    <Show
                      when={r().resources.length > 0}
                      fallback={<p class="pt-empty">{t("promptTree.resourcesEmpty")}</p>}
                    >
                      <div class="pt-res-list">
                        <For each={r().resources} keyed={(res) => res.resourceId}>
                          {(res) => (
                            <div class="pt-res-card">
                              <div class="pt-res-head">
                                <span class="pt-res-title">{res().title}</span>
                                <span class="pill mono">{residencyLabel(res().residencyStatus)}</span>
                                <Show when={res().access.model}>
                                  <span class="pill soft">{t("promptTree.accessModel")}</span>
                                </Show>
                                <Show when={res().access.player}>
                                  <span class="pill soft">{t("promptTree.accessPlayer")}</span>
                                </Show>
                                <Show when={res().totalLayers > 1}>
                                  <span class="pill mono">
                                    {t("promptTree.layerRatio", {
                                      unlocked: res().unlockedLayer,
                                      total: res().totalLayers,
                                    })}
                                  </span>
                                </Show>
                              </div>
                              <div class="pt-res-actions">
                                <Show when={res().modelSelectable || mem().assumedReads.includes(res().resourceId)}>
                                  <Tick
                                    class="pt-check"
                                    on={mem().assumedReads.includes(res().resourceId)}
                                    onFlip={() => toggleAssumedRead(res().resourceId)}
                                  >
                                    <span>{t("promptTree.simulateModelRead")}</span>
                                  </Tick>
                                </Show>
                                <Show when={res().playerSelectable || mem().inputInvoke.includes(res().resourceId)}>
                                  <Tick
                                    class="pt-check"
                                    on={mem().inputInvoke.includes(res().resourceId)}
                                    onFlip={() => toggleInvoke(res().resourceId)}
                                  >
                                    <span>{t("promptTree.simulatePlayerInvoke")}</span>
                                  </Tick>
                                </Show>
                              </div>
                              <Show when={res().sections.length > 0}>
                                <div class="pt-res-sections">
                                  <For each={res().sections} keyed={(s) => s.resourceId}>
                                    {(sec) => (
                                      <Show when={sec().inCatalog || mem().assumedReads.includes(sec().resourceId)}>
                                        <Tick
                                          class="pt-check sm"
                                          on={mem().assumedReads.includes(sec().resourceId)}
                                          onFlip={() => toggleAssumedRead(sec().resourceId)}
                                        >
                                          <span>{sec().title}</span>
                                          <Show when={sec().resident}>
                                            <span class="pill mono">{t("promptTree.resWindow")}</span>
                                          </Show>
                                        </Tick>
                                      </Show>
                                    )}
                                  </For>
                                </div>
                              </Show>
                            </div>
                          )}
                        </For>
                      </div>
                    </Show>
                  </div>
                </details>

                {/* Secondary section 3: Sandbox events (collapsed by default, supports custom readout events) */}
                <Show when={r().mode === "sandbox"}>
                  <details class="pt-fold" open={eventsOpen()} onToggle={(e) => setEventsOpen(e.currentTarget.open)}>
                    <summary>
                      <Next class="pt-chev" aria-hidden="true" />
                      <span>{t("promptTree.events")}</span>
                      <Show when={mem().events.length > 0}>
                        <span class="pt-count mono">{mem().events.length}</span>
                      </Show>
                    </summary>
                    <div class="pt-fold-body pt-events">
                      <For each={r().sandbox.eventOptions} keyed={false}>
                        {(ev) => (
                          <Tick class="pt-check sm" on={mem().events.includes(ev())} onFlip={() => toggleEvent(ev())}>
                            <span class="mono">{ev()}</span>
                          </Tick>
                        )}
                      </For>
                      <For each={mem().events.filter((ev) => !r().sandbox.eventOptions.includes(ev))} keyed={false}>
                        {(ev) => (
                          <Tick class="pt-check sm" on onFlip={() => toggleEvent(ev())}>
                            <span class="mono">{ev()}</span>
                          </Tick>
                        )}
                      </For>
                      <input
                        type="text"
                        class="pt-input"
                        aria-label={t("promptTree.events")}
                        placeholder={t("promptTree.eventPlaceholder")}
                        autocapitalize="none"
                        autocorrect="off"
                        spellcheck="false"
                        enterkeyhint="done"
                        value={eventDraft()}
                        onInput={(e) => setEventDraft(e.currentTarget.value)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter" && !e.isComposing) {
                            e.preventDefault()
                            addCustomEvent()
                          }
                        }}
                      />
                    </div>
                  </details>
                </Show>
              </>
            )}
          </Show>
        </section>

        <aside class="pane node" aria-label={t("promptTree.paneControls")}>
          {/* Sample card selector when opened from Settings → Templates with no active card */}
          <Show when={mem().sampleCard && sampleCards().length > 1}>
            <div class="pt-group">
              <span class="pt-label">{t("promptTree.sampleCardSelect")}</span>
              <Menu
                fit
                small
                label={t("promptTree.sampleCardSelect")}
                value={mem().cardId ?? undefined}
                options={sampleCards().map((c) => ({ value: c.id, label: c.title }))}
                onPick={(id) =>
                  update({
                    cardId: id,
                    mode: "sandbox",
                    storyId: undefined,
                    nodeId: undefined,
                    fields: {},
                    greetingIndex: undefined,
                    assumedReads: [],
                    inputInvoke: [],
                  })
                }
              />
            </div>
          </Show>

          <Show
            when={mem().mode === "sandbox"}
            fallback={
              /* Story branch mode controls */
              <>
                <Show when={cardStories().length}>
                  <div class="pt-group">
                    <span class="pt-label">{t("promptTree.storySelect")}</span>
                    <Menu
                      fit
                      small
                      label={t("promptTree.storySelect")}
                      value={mem().storyId !== undefined ? String(mem().storyId) : undefined}
                      options={cardStories().map((s) => ({
                        value: String(s.id),
                        label: `${s.title ?? t("stories.newStory")} (#${s.turns})`,
                      }))}
                      onPick={(v) => {
                        const sid = Number(v)
                        if (Number.isFinite(sid)) update({ storyId: sid, nodeId: undefined })
                      }}
                    />
                  </div>
                </Show>
                <Show when={result()?.story}>
                  {(st) => (
                    <div class="pt-story-status">
                      <span class="pill mono">{t("promptTree.turnCount", { n: st().turnCount })}</span>
                      <Show when={st().summarized && st().summaryRange}>
                        <span class="pill ok">
                          {t("promptTree.summarizedRange", {
                            from: st().summaryRange!.from,
                            to: st().summaryRange!.to,
                          })}
                        </span>
                      </Show>
                      <Show when={st().foldStart > 0 && !st().summarized}>
                        <span class="pill warn">{t("promptTree.missingSummary")}</span>
                      </Show>
                      <Show when={st().settlementPending}>
                        <span class="pill warn">{t("promptTree.settlementPending")}</span>
                      </Show>
                    </div>
                  )}
                </Show>

                <div class="pt-group">
                  <div class="pt-group-head">
                    <span class="pt-label">{t("promptTree.branchNode")}</span>
                  </div>
                  <div class="pt-node-list scroller">
                    <button
                      type="button"
                      class="pt-node-row"
                      aria-current={mem().nodeId === null ? "true" : undefined}
                      onClick={() => update({ nodeId: null })}
                    >
                      <span class="mono">—</span>
                      <span class="pt-node-snip">{t("promptTree.beforeFirstTurn")}</span>
                    </button>
                    <For each={storyNodes()} keyed={(n) => n.id}>
                      {(n) => {
                        const effectiveNodeId = () =>
                          mem().nodeId !== undefined ? mem().nodeId : (result()?.story?.nodeId ?? storyHead())
                        const active = () => effectiveNodeId() === n().id
                        const snippet = () =>
                          (n().prose || n().input.text || "").replace(/\s+/g, " ").trim().slice(0, 60)
                        return (
                          <button
                            type="button"
                            class="pt-node-row"
                            aria-current={active() ? "true" : undefined}
                            onClick={() => update({ nodeId: n().id })}
                          >
                            <span class="mono">#{n().id}</span>
                            <span class="pt-node-snip">{snippet() || t("promptTree.emptyTurn")}</span>
                            <Show when={storyHead() === n().id}>
                              <span class="pill ok">{t("promptTree.head")}</span>
                            </Show>
                          </button>
                        )
                      }}
                    </For>
                  </div>
                </div>

                <div class="pt-group">
                  <label class="pt-label" for="pt-story-input">
                    {t("promptTree.nextInput")}
                  </label>
                  <textarea
                    id="pt-story-input"
                    class="pt-textarea"
                    rows="2"
                    enterkeyhint="enter"
                    placeholder={t("promptTree.inputPlaceholder")}
                    value={mem().inputText}
                    onInput={(e) => update({ inputText: e.currentTarget.value }, "text")}
                  />
                </div>
              </>
            }
          >
            {/* Sandbox mode controls */}
            <Show when={sandboxControls()?.greetings.length}>
              <div class="pt-group">
                <span class="pt-label">{t("card.opening")}</span>
                <Menu
                  fit
                  small
                  label={t("card.opening")}
                  value={
                    sandboxControls()?.greetingIndex === null
                      ? "__none__"
                      : String(sandboxControls()?.greetingIndex ?? 0)
                  }
                  options={[
                    { value: "__none__", label: t("card.noOpening") },
                    ...(sandboxControls()?.greetings ?? []).map((g) => ({
                      value: String(g.index),
                      label: `${g.index + 1}. ${g.label}`,
                    })),
                  ]}
                  onPick={(v) => update({ greetingIndex: v === "__none__" ? null : Number(v) })}
                />
              </div>
            </Show>

            <Show when={sandboxControls()?.fields.length}>
              <div class="pt-group">
                <div class="pt-group-head">
                  <span class="pt-label">{t("promptTree.fields")}</span>
                  <button
                    type="button"
                    class="icon sm pt-reset"
                    disabled={modifiedFieldCount() === 0}
                    aria-label={t("promptTree.resetFields")}
                    title={t("promptTree.resetFields")}
                    onClick={resetFields}
                  >
                    <Swipe aria-hidden="true" />
                  </button>
                </div>
                <div class="pt-fields">
                  <For each={sandboxControls()?.fields ?? []} keyed={(f) => f.path}>
                    {(f) => {
                      const localVal = () =>
                        Object.hasOwn(mem().fields, f().path) ? mem().fields[f().path] : f().value
                      const changed = () => localVal() !== f().initial
                      const fieldText = () => {
                        const value = localVal()
                        return typeof value === "string" ? value : ""
                      }
                      const numVal = (): number => {
                        const v = localVal()
                        return typeof v === "number" ? v : 0
                      }
                      return (
                        <div class={{ "pt-field": true, changed: changed() }}>
                          <div class="pt-field-head">
                            <span class="pt-field-name" title={f().path}>
                              {f().label}
                            </span>
                            <Show when={f().hidden}>
                              <span
                                class="pt-hidden-ico"
                                title={t("promptTree.hiddenField")}
                                aria-label={t("promptTree.hiddenField")}
                              >
                                <EyeOff aria-hidden="true" />
                              </span>
                            </Show>
                            <Show when={changed()}>
                              <span class="pt-dot" aria-label={t("promptTree.modified")} />
                            </Show>
                          </div>

                          <Show when={f().type === "int" || f().type === "number"}>
                            <Stepper
                              label={f().label}
                              value={numVal()}
                              min={f().min}
                              max={f().max}
                              step={f().type === "int" ? 1 : 0.5}
                              onChange={(n) => setField(f().path, n, "step")}
                            />
                          </Show>

                          <Show when={f().type === "boolean"}>
                            <Switch
                              on={Boolean(localVal())}
                              label={f().label}
                              onFlip={() => setField(f().path, !localVal())}
                            />
                          </Show>

                          <Show when={f().type === "enum" && f().options?.length}>
                            <Menu
                              small
                              label={f().label}
                              value={fieldText()}
                              options={(f().options ?? []).map((opt) => ({ value: opt, label: opt }))}
                              onPick={(v) => setField(f().path, v)}
                            />
                          </Show>

                          <Show when={f().type === "enum" && !f().options?.length}>
                            <input
                              type="text"
                              class="pt-input"
                              aria-label={f().label}
                              autocapitalize="none"
                              autocorrect="off"
                              spellcheck="false"
                              enterkeyhint="done"
                              value={fieldText()}
                              onInput={(e) => setField(f().path, e.currentTarget.value, "text")}
                            />
                          </Show>
                        </div>
                      )
                    }}
                  </For>
                </div>
              </div>
            </Show>

            <div class="pt-group">
              <label class="pt-label" for="pt-sandbox-input">
                {t("promptTree.playerInput")}
              </label>
              <textarea
                id="pt-sandbox-input"
                class="pt-textarea"
                rows="2"
                enterkeyhint="enter"
                placeholder={t("promptTree.inputPlaceholder")}
                value={mem().inputText}
                onInput={(e) => update({ inputText: e.currentTarget.value }, "text")}
              />
              <input
                type="text"
                class="pt-input"
                aria-label={t("promptTree.playerNote")}
                placeholder={t("promptTree.notePlaceholder")}
                enterkeyhint="done"
                value={mem().inputNote}
                onInput={(e) => update({ inputNote: e.currentTarget.value }, "text")}
              />
            </div>
          </Show>
        </aside>
      </div>
    </div>
  )
}
