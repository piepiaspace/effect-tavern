import type { CheckpointConflict, CheckpointKind } from "@effect-tavern/runtime/src/storage.ts"
import { createPopoverController, Popover, PopoverContent, PopoverTitle, PopoverTrigger } from "@ui-sdk/solid/popover"
import { createEffect, createSignal, Show } from "solid-js"
import { blurField } from "./controls.tsx"
import { t } from "./i18n.ts"
import { Anchor, Pin, Restore } from "./icons.tsx"
import { packs, personas, registry } from "./store.ts"
import {
  fetchCheckpoint,
  mutateCheckpoint,
  pendingAssetWrite,
  reloadAsset,
  settleAssetWrites,
  type CheckpointStatus,
} from "./wire.ts"

export type FlushOutcome = { state: "clean" | "invalid" | "stale" }
export interface CheckpointSession {
  flush(): Promise<FlushOutcome>
  quiesce(): Promise<void>
  disarm(): void
  reload(): Promise<void>
}

type RowKind = "local" | "pack" | "persona"
type CheckpointControlProps = {
  id: string
  watch: unknown
  small?: boolean
  onReload?: () => void
} & ({ kind: RowKind; session?: never } | { kind: "card" | "hat"; session: CheckpointSession })

function rowSession(kind: RowKind, id: string): CheckpointSession {
  return {
    async flush() {
      blurField()
      return await pendingAssetWrite(kind, id).then(
        () => ({ state: "clean" as const }),
        () => ({ state: "invalid" as const }),
      )
    },
    quiesce: () => settleAssetWrites(kind),
    disarm() {},
    reload: () => reloadAsset(kind, id),
  }
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
  type Observed = CheckpointStatus & { kind: CheckpointKind; id: string }
  const [badge, setBadge] = createSignal<CheckpointStatus | null>(null)
  const [observed, setObserved] = createSignal<Observed | null>(null)
  const [local, setLocal] = createSignal<FlushOutcome["state"]>("clean")
  const [confirming, setConfirming] = createSignal(false)
  const [alert, setAlert] = createSignal<string | null>(null)
  const [busy, setBusy] = createSignal(false)
  const [reloadPending, setReloadPending] = createSignal(false)
  let badgeRead: AbortController | undefined
  let opening: AbortController | undefined
  let panelOpen = false
  const current = (asset: { kind: CheckpointKind; id: string }) => props.kind === asset.kind && props.id === asset.id
  const session = () => props.session ?? rowSession(props.kind, props.id)

  createEffect(
    () => [props.kind, props.id, props.watch] as const,
    ([kind, id], prev) => {
      if (prev && (kind !== prev[0] || id !== prev[1])) {
        pop.close()
        opening?.abort()
        panelOpen = false
        setObserved(null)
        setReloadPending(false)
        setAlert(null)
        setBusy(false)
        setBadge(null)
      }
      if (!id || panelOpen) return
      const read = new AbortController()
      badgeRead = read
      void fetchCheckpoint(kind, id, read.signal)
        .then((result) => {
          if (!read.signal.aborted) setBadge(result)
        })
        .catch(() => {})
      return () => read.abort()
    },
  )

  const standing = () => observed()?.standing
  const badgeStanding = () => badge()?.standing
  const statusText = (s?: CheckpointStatus["standing"]) => {
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

  const badgeTitle = () => {
    if (reloadPending()) return t("checkpoint.reloadFailed")
    return badgeStanding() ? statusText(badgeStanding()) : t("checkpoint.title")
  }

  const onOpenChange = async (open: boolean) => {
    panelOpen = open
    opening?.abort()
    setConfirming(false)
    if (!open || reloadPending()) return
    const { kind, id } = props
    const read = new AbortController()
    opening = read
    badgeRead?.abort()
    setAlert(null)
    setObserved(null)
    setBusy(true)
    try {
      const result = await session().flush()
      if (read.signal.aborted) return
      setLocal(result.state)
      if (result.state === "stale") {
        setAlert(t("checkpoint.conflictChanged"))
        return
      }
      const status = await fetchCheckpoint(kind, id, read.signal)
      if (!read.signal.aborted) {
        setObserved({ kind, id, ...status })
        setBadge(status)
      }
    } catch (error) {
      if (!read.signal.aborted) setAlert(error instanceof Error ? error.message : String(error))
    } finally {
      if (opening === read) setBusy(false)
    }
  }

  const reload = async (editor: CheckpointSession, asset: Observed) => {
    try {
      await editor.reload()
      if (current(asset)) {
        props.onReload?.()
        setBadge(asset)
        setReloadPending(false)
        setLocal("clean")
        setAlert(null)
        pop.close()
      }
    } catch {
      if (current(asset)) {
        setReloadPending(true)
        setAlert(t("checkpoint.reloadFailed"))
      }
    }
  }

  const retryReload = async () => {
    const asset = observed()
    if (busy() || !asset) return
    setBusy(true)
    await reload(session(), asset)
    if (current(asset)) setBusy(false)
  }

  const mutate = async (action: "pin" | "revert") => {
    const asset = observed()
    if (busy() || !asset || !current(asset)) return
    const editor = session()
    setBusy(true)
    setAlert(null)
    try {
      if (action === "revert") await editor.quiesce()
      const { standing, kind, id, rev } = asset
      const outcome = await mutateCheckpoint(kind, id, {
        action,
        expectedWorkingHash: standing.status === "clean" ? standing.hash : standing.workingHash,
        expectedAnchorHash: standing.status === "clean" ? standing.hash : standing.anchorHash,
        ...(rev !== undefined && { rev }),
      })
      if (!current(asset)) {
        if (outcome.ok && action === "revert") await reloadAsset(kind, id)
        return
      }
      setConfirming(false)
      if (!outcome.ok && outcome.code === "checkpoint-conflict") {
        setAlert(formatConflict(outcome.conflict))
        return
      }
      const next = { kind, id, standing: outcome.standing, rev: outcome.rev }
      setObserved(next)
      if (!outcome.ok) {
        setBadge(next)
        setAlert(t("checkpoint.conflictChanged"))
      } else if (action === "revert") {
        editor.disarm()
        setLocal("clean")
        await reload(editor, next)
      } else {
        setBadge(next)
        pop.close()
      }
    } catch (error) {
      if (current(asset)) setAlert(error instanceof Error ? error.message : String(error))
    } finally {
      if (current(asset)) setBusy(false)
    }
  }

  return (
    <Popover controller={pop} onOpenChange={onOpenChange}>
      <PopoverTrigger
        class={{ icon: true, sm: props.small !== false, "checkpoint-trigger": true }}
        data-status={reloadPending() ? "reload-pending" : (badgeStanding()?.status ?? "clean")}
        disabled={!props.id}
        aria-label={t("checkpoint.title")}
        title={badgeTitle()}
      >
        <Anchor aria-hidden="true" />
        <span class="checkpoint-dot" aria-hidden="true" />
      </PopoverTrigger>
      <PopoverContent class="checkpoint-pop" align="end" sideOffset={6} collisionPadding={12}>
        <PopoverTitle class="sr-only">{t("checkpoint.title")}</PopoverTitle>
        <Show when={!confirming()} fallback={<div class="checkpoint-head">{t("checkpoint.confirmPrompt")}</div>}>
          <div class="checkpoint-head" data-status={standing()?.status}>
            <span class="checkpoint-pill-dot" aria-hidden="true" />
            <span>
              {local() === "invalid"
                ? t("checkpoint.unsaved")
                : local() === "stale"
                  ? t("checkpoint.title")
                  : statusText(standing())}
            </span>
          </div>
        </Show>
        <Show when={standing()?.status === "clean" && local() === "clean" && !reloadPending()}>
          <p class="checkpoint-hint">{t("checkpoint.cleanHint")}</p>
        </Show>
        <Show when={reloadPending()}>
          <div class="checkpoint-actions">
            <button type="button" class="btn sm" disabled={busy()} onClick={() => void retryReload()}>
              {t("checkpoint.retryReload")}
            </button>
          </div>
        </Show>
        <Show when={!reloadPending() && observed() && (standing()?.status === "drifted" || local() === "invalid")}>
          <Show
            when={confirming()}
            fallback={
              <div class="checkpoint-actions">
                <button
                  type="button"
                  class="btn sm"
                  disabled={busy() || local() !== "clean"}
                  onClick={() => void mutate("pin")}
                >
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
              <button
                type="button"
                class="btn sm checkpoint-danger"
                disabled={busy()}
                onClick={() => void mutate("revert")}
              >
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
