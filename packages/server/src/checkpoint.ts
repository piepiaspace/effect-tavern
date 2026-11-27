// Decide a checkpoint mutation from the state the current request observes.
import {
  canonicalJson,
  hashBytes,
  type CheckpointKind,
  deriveStanding,
  type CheckpointConflict,
  type CheckpointMutation,
  type ObjectId,
} from "@effect-tavern/runtime/src/storage.ts"
import { Hat, normalizeHatDelivery } from "@effect-tavern/runtime/src/fragment.ts"
import { Schema } from "effect"
import { decodeLayer, decodeLocal, locked, type Local } from "@effect-tavern/runtime/src/layer.ts"

interface Version {
  hash: ObjectId
  originEdited?: boolean
}
export interface CheckpointState {
  working: Version
  anchor: Version & { updatedAt: number | null }
  rev?: string
}

export function decideCheckpoint(
  state: CheckpointState,
  request: CheckpointMutation,
  now: number,
  conflict?: CheckpointConflict,
) {
  const { working, anchor, rev } = state
  if (request.expectedWorkingHash !== working.hash || request.expectedAnchorHash !== anchor.hash || request.rev !== rev)
    return {
      code: "checkpoint-changed",
      standing: deriveStanding(working.hash, anchor),
      ...(rev !== undefined && { rev }),
    } as const
  if (working.hash === anchor.hash) return { action: "unchanged" } as const
  if (request.action === "pin") return { action: "pin", ...working, updatedAt: now } as const
  if (conflict) return { code: "checkpoint-conflict", conflict } as const
  return { action: "revert", hash: anchor.hash, originEdited: anchor.originEdited } as const
}

type Decision = ReturnType<typeof decideCheckpoint>
export class CheckpointRefused extends Error {
  constructor(readonly detail: Extract<Decision, { code: string }> | { code: "no-checkpoint" }) {
    super(detail.code)
  }
}

/** Identity comes from the checkpoint owner. Empty top-level collections have no effect;
 * nested values (including false, empty names and an explicit null persona) are user data. */
export function layerDelta(row: Local | undefined): Record<string, unknown> {
  if (!row) return {}
  const fields: Record<string, unknown> = JSON.parse(JSON.stringify(locked(row)))
  return Object.fromEntries(
    Object.entries(fields).filter(
      ([key, value]) =>
        key !== "id" &&
        key !== "name" &&
        key !== "card" &&
        (value === null || typeof value !== "object" || Object.keys(value).length > 0),
    ),
  )
}

/** An empty delta restores the absent physical row. */
export function restoreLayerDelta(delta: ReturnType<typeof layerDelta>, owner: { kind: "local"; card: string }) {
  if (!Object.keys(delta).length) return undefined
  return decodeLocal({ ...delta, id: "local", name: owner.card, card: owner.card })
}

const decodeHat = Schema.decodeUnknownSync(Hat)
export const checkpointPersona = Schema.decodeUnknownSync(
  Schema.Struct({ id: Schema.String, name: Schema.String, text: Schema.String }),
)
// The same JSON projection seeds old libraries, anchors new assets, and measures edits.
export function checkpointValue(kind: CheckpointKind, value: unknown) {
  switch (kind) {
    case "card":
      return value
    case "hat":
      return normalizeHatDelivery(decodeHat(value))
    case "pack":
      return decodeLayer(value)
    case "persona":
      return checkpointPersona(value)
    case "local":
      return layerDelta(value as Local | undefined)
  }
}
export function checkpointObject(value: unknown) {
  const body = canonicalJson(value)
  const bytes = new TextEncoder().encode(body)
  return { body, hash: hashBytes(bytes), size: bytes.length }
}
