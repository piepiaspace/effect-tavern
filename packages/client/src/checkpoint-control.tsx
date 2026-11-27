import type { CheckpointConflict, CheckpointKind } from "@effect-tavern/runtime/src/storage.ts"
import { createPopoverController, Popover, PopoverContent, PopoverTitle, PopoverTrigger } from "@ui-sdk/solid/popover"
import { createEffect, createSignal, Show } from "solid-js"
import { blurField } from "./controls.tsx"
import { t } from "./i18n.ts"
import { Anchor, Pin, Restore } from "./icons.tsx"
import { packs, personas, registry } from "./store.ts"
import { fetchCheckpoint, mutateCheckpoint, type CheckpointStatus } from "./wire.ts"

export interface CheckpointControlProps {
  kind: CheckpointKind
  id: string
  /** Value that changes when the host finishes an auto-save or reload, driving GET /checkpoints/:kind/:id. */
  watch: unknown
  /** Defaults to .icon.sm (24px); pass false in writing.tsx to match 32px .icon. */
  small?: boolean
  /** Flush focused input and pending debounced/queued writes before reading or mutating; return false to abort. */
  flush?: () => Promise<boolean> | boolean
  /** Notify host after Revert succeeds to drop local drafts and reload the asset. */
  onReverted: () => Promise<void> | void
}

const pad2 = (n: number) => String(n).padStart(2, "0")

const formatTime = (timestamp: number): string => {
  const ms = timestamp < 1e12 ? timestamp * 1000 : timestamp
  const d = new Date(ms)
  const now = new Date()
  const time = `${pad2(d.getHours())}:${pad2(d.getMinutes())}`
  if (d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth() && d.getDate() === now.getDate()) {
    return time
  }
  return `${pad2(d.getMonth() + 1)}-${pad2(d.getDate())} ${time}`
}

const formatConflict = (conflict: CheckpointConflict): string => {
  if (conflict.reason === "hat-name-taken") {
    return t("checkpoint.conflictHatName", { name: conflict.name })
  }
  const parts: string[] = []
  if (conflict.missingPacks.length > 0) {
    const allPacks = registry.get(packs)
    const names = conflict.missingPacks.map((id) => allPacks.find((p) => p.id === id)?.name ?? id)
    parts.push(t("checkpoint.missingPacks", { names: names.join(t("checkpoint.listSep")) }))
  }
  if (conflict.missingPersona) {
    const pid = conflict.missingPersona
    const name = registry.get(personas).find((p) => p.id === pid)?.name ?? pid
    parts.push(t("checkpoint.missingPersona", { name }))
  }
  return t("checkpoint.conflictMissingRefs", { items: parts.join(t("checkpoint.andSep")) })
}

export const CheckpointControl = (props: CheckpointControlProps) => {
  const pop = createPopoverController()
  const [data, setData] = createSignal<CheckpointStatus | null>(null)
  const [confirming, setConfirming] = createSignal(false)
  const [alert, setAlert] = createSignal<string | null>(null)
  const [busy, setBusy] = createSignal(false)
  let opSeq = 0
  let fetchSeq = 0
  let activeFetch: AbortController | null = null

  const cancelFetch = () => {
    activeFetch?.abort()
    activeFetch = null
  }

  const loadCheckpoint = async (kind: CheckpointKind, id: string, token: number): Promise<CheckpointStatus | null> => {
    cancelFetch()
    const ac = new AbortController()
    activeFetch = ac
    try {
      const status = await fetchCheckpoint(kind, id, ac.signal)
      if (ac.signal.aborted || token !== fetchSeq || props.kind !== kind || props.id !== id) return null
      setData(status)
      return status
    } finally {
      if (activeFetch === ac) activeFetch = null
    }
  }

  const syncWithFlush = async (kind: CheckpointKind, id: string): Promise<CheckpointStatus | null> => {
    const op = ++opSeq
    cancelFetch()
    blurField()
    if (props.flush) {
      const ok = await props.flush()
      if (!ok || op !== opSeq || props.kind !== kind || props.id !== id) return null
    }
    // Cancel any redundant GET triggered by props.watch during flush, then run one authoritative read.
    return await loadCheckpoint(kind, id, ++fetchSeq)
  }

  createEffect(
    () => [props.kind, props.id, props.watch] as const,
    ([kind, id], prev) => {
      if (!id) {
        opSeq++
        fetchSeq++
        cancelFetch()
        setData(null)
        setConfirming(false)
        setAlert(null)
        return
      }
      if (prev && (prev[0] !== kind || prev[1] !== id)) {
        opSeq++
        setData(null)
        setConfirming(false)
        setAlert(null)
      }
      const token = ++fetchSeq
      void loadCheckpoint(kind, id, token).catch(() => {})
      return () => {
        if (token === fetchSeq) cancelFetch()
      }
    },
  )

  const standing = () => data()?.standing
  const status = () => standing()?.status ?? "clean"

  const statusText = () => {
    const s = standing()
    if (!s) return t("checkpoint.loading")
    if (s.status === "clean") {
      return s.updatedAt === null
        ? t("checkpoint.cleanBaseline")
        : t("checkpoint.cleanAt", { time: formatTime(s.updatedAt) })
    }
    return s.updatedAt === null
      ? t("checkpoint.driftedBaseline")
      : t("checkpoint.driftedAt", { time: formatTime(s.updatedAt) })
  }

  const onOpenChange = (open: boolean) => {
    if (!open) {
      setConfirming(false)
      setAlert(null)
      return
    }
    const kind = props.kind
    const id = props.id
    if (!id || busy()) return
    setBusy(true)
    setAlert(null)
    void syncWithFlush(kind, id)
      .catch((e: unknown) => {
        if (e instanceof Error && e.name === "AbortError") return
        if (props.kind === kind && props.id === id) setAlert(e instanceof Error ? e.message : String(e))
      })
      .finally(() => setBusy(false))
  }

  const doPin = async () => {
    const kind = props.kind
    const id = props.id
    if (busy() || !id) return
    setBusy(true)
    setAlert(null)
    try {
      const cur = await syncWithFlush(kind, id)
      if (!cur || cur.standing.status !== "drifted" || props.kind !== kind || props.id !== id) return
      const op = ++opSeq
      fetchSeq++
      cancelFetch()
      const outcome = await mutateCheckpoint(kind, id, {
        action: "pin",
        expectedWorkingHash: cur.standing.workingHash,
        expectedAnchorHash: cur.standing.anchorHash,
        ...(cur.rev !== undefined && { rev: cur.rev }),
      })
      if (op !== opSeq || props.kind !== kind || props.id !== id) return
      if (outcome.ok) {
        setData({ standing: outcome.standing, ...(outcome.rev !== undefined && { rev: outcome.rev }) })
        setConfirming(false)
        pop.close()
      } else if (outcome.code === "checkpoint-changed") {
        setData({ standing: outcome.standing, ...(outcome.rev !== undefined && { rev: outcome.rev }) })
        setConfirming(false)
        setAlert(t("checkpoint.conflictChanged"))
      } else {
        setConfirming(false)
        setAlert(formatConflict(outcome.conflict))
      }
    } catch (e) {
      if (!(e instanceof Error && e.name === "AbortError")) setAlert(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  const doRevert = async () => {
    const kind = props.kind
    const id = props.id
    if (busy() || !id) return
    setBusy(true)
    setAlert(null)
    try {
      const cur = await syncWithFlush(kind, id)
      if (!cur || cur.standing.status !== "drifted" || props.kind !== kind || props.id !== id) return
      const op = ++opSeq
      fetchSeq++
      cancelFetch()
      const outcome = await mutateCheckpoint(kind, id, {
        action: "revert",
        expectedWorkingHash: cur.standing.workingHash,
        expectedAnchorHash: cur.standing.anchorHash,
        ...(cur.rev !== undefined && { rev: cur.rev }),
      })
      if (op !== opSeq || props.kind !== kind || props.id !== id) return
      if (outcome.ok) {
        setData({ standing: outcome.standing, ...(outcome.rev !== undefined && { rev: outcome.rev }) })
        setConfirming(false)
        pop.close()
        await props.onReverted()
      } else if (outcome.code === "checkpoint-changed") {
        setData({ standing: outcome.standing, ...(outcome.rev !== undefined && { rev: outcome.rev }) })
        setConfirming(false)
        setAlert(t("checkpoint.conflictChanged"))
      } else {
        setConfirming(false)
        setAlert(formatConflict(outcome.conflict))
      }
    } catch (e) {
      if (!(e instanceof Error && e.name === "AbortError")) setAlert(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Popover controller={pop} onOpenChange={onOpenChange}>
      <PopoverTrigger
        class={{ icon: true, sm: props.small !== false, "checkpoint-trigger": true }}
        data-status={status()}
        disabled={!props.id}
        aria-label={t("checkpoint.title")}
        title={standing() ? statusText() : t("checkpoint.title")}
      >
        <Anchor aria-hidden="true" />
        <span class="checkpoint-dot" aria-hidden="true" />
      </PopoverTrigger>
      <PopoverContent class="checkpoint-pop" align="end" sideOffset={6} collisionPadding={12}>
        <PopoverTitle class="sr-only">{t("checkpoint.title")}</PopoverTitle>
        <Show when={!confirming()} fallback={<div class="checkpoint-head">{t("checkpoint.confirmPrompt")}</div>}>
          <div class="checkpoint-head" data-status={status()}>
            <span class="checkpoint-pill-dot" aria-hidden="true" />
            <span>{statusText()}</span>
          </div>
        </Show>
        <Show when={standing()?.status === "clean"}>
          <p class="checkpoint-hint">{t("checkpoint.cleanHint")}</p>
        </Show>
        <Show when={standing()?.status === "drifted"}>
          <Show
            when={confirming()}
            fallback={
              <div class="checkpoint-actions">
                <button type="button" class="btn sm" disabled={busy()} onClick={() => void doPin()}>
                  <Pin aria-hidden="true" />
                  <span>{t("checkpoint.pin")}</span>
                </button>
                <button
                  type="button"
                  class="btn sm ghost"
                  disabled={busy()}
                  onClick={() => {
                    setAlert(null)
                    setConfirming(true)
                  }}
                >
                  <Restore aria-hidden="true" />
                  <span>{t("checkpoint.revert")}</span>
                </button>
              </div>
            }
          >
            <div class="checkpoint-actions">
              <button type="button" class="btn sm" disabled={busy()} onClick={() => setConfirming(false)}>
                {t("common.cancel")}
              </button>
              <button type="button" class="btn sm checkpoint-danger" disabled={busy()} onClick={() => void doRevert()}>
                <Restore aria-hidden="true" />
                <span>{t("checkpoint.confirmRevert")}</span>
              </button>
            </div>
          </Show>
        </Show>
        <Show when={alert()}>
          {(message) => (
            <p class="checkpoint-alert" role="alert">
              {message()}
            </p>
          )}
        </Show>
      </PopoverContent>
    </Popover>
  )
}
