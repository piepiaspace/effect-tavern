// Content addresses, persisted trace envelopes and checkpoint wire contracts shared across hosts.
import { sha256 } from "@noble/hashes/sha2.js"
import { bytesToHex, utf8ToBytes } from "@noble/hashes/utils.js"
import { Schema } from "effect"

export const ObjectId = Schema.String.check(Schema.isPattern(/^[0-9a-f]{64}$/)).pipe(Schema.brand("ObjectId"))
export type ObjectId = typeof ObjectId.Type

export const BlobEncoding = Schema.Literals(["utf8", "deflate-b64"])
export type BlobEncoding = typeof BlobEncoding.Type

const sortedJson = (value: Schema.Json): string => {
  if (Array.isArray(value)) return "[" + value.map(sortedJson).join(",") + "]"
  if (value === null || typeof value !== "object") return JSON.stringify(value)
  const object = value as Schema.JsonObject
  return (
    "{" +
    Object.keys(object)
      .sort()
      .map((k) => JSON.stringify(k) + ":" + sortedJson(object[k]))
      .join(",") +
    "}"
  )
}

/** Sort the actual JSON projection SQLite would store, including omitted properties and array holes. */
export function canonicalJson(value: unknown): string {
  const json = JSON.stringify(value)
  if (json === undefined) throw new TypeError("Expected a JSON value")
  return sortedJson(JSON.parse(json))
}

export const hashBytes = (bytes: Uint8Array): ObjectId => ObjectId.make(bytesToHex(sha256(bytes)))
export const wellFormedText = (s: string) => !/\p{Surrogate}/u.test(s)
export function hashUtf8(s: string): ObjectId {
  if (!wellFormedText(s)) throw new TypeError("Unpaired surrogate in UTF-8 text")
  return hashBytes(utf8ToBytes(s))
}

export const EMPTY_OVERLAY_JSON = "{}"
export const EMPTY_OVERLAY_HASH: ObjectId = hashUtf8(EMPTY_OVERLAY_JSON)

export const CheckpointKind = Schema.Literals(["hat", "pack", "card", "persona", "local"])
export type CheckpointKind = typeof CheckpointKind.Type

export const CheckpointStanding = Schema.Union([
  Schema.Struct({
    status: Schema.Literal("clean"),
    hash: ObjectId,
    updatedAt: Schema.NullOr(Schema.Int),
  }),
  Schema.Struct({
    status: Schema.Literal("drifted"),
    workingHash: ObjectId,
    anchorHash: ObjectId,
    updatedAt: Schema.NullOr(Schema.Int),
  }),
])
export type CheckpointStanding = typeof CheckpointStanding.Type

export const deriveStanding = (
  workingHash: ObjectId,
  anchor: { hash: ObjectId; updatedAt: number | null },
): CheckpointStanding =>
  workingHash === anchor.hash
    ? { status: "clean", hash: anchor.hash, updatedAt: anchor.updatedAt }
    : { status: "drifted", workingHash, anchorHash: anchor.hash, updatedAt: anchor.updatedAt }

export const CheckpointMutation = Schema.Struct({
  action: Schema.Literals(["pin", "revert"]),
  expectedWorkingHash: ObjectId,
  expectedAnchorHash: ObjectId,
  rev: Schema.optionalKey(Schema.String),
})
export type CheckpointMutation = typeof CheckpointMutation.Type

export const CheckpointConflict = Schema.Union([
  Schema.Struct({
    reason: Schema.Literal("hat-name-taken"),
    name: Schema.String,
    takenByHatId: Schema.String,
  }),
  Schema.Struct({
    reason: Schema.Literal("missing-references"),
    missingPacks: Schema.Array(Schema.String),
    missingPersona: Schema.NullOr(Schema.String),
  }),
])
export type CheckpointConflict = typeof CheckpointConflict.Type

export const MIN_BLOB_BYTES = 128
export const TextBlobRef = Schema.Struct({ $text: ObjectId })
export const TextSlicesEnvelope = Schema.Struct({ $slices: Schema.Array(Schema.Union([Schema.String, TextBlobRef])) })
export const EscapedObjectEnvelope = Schema.Struct({ $esc: Schema.JsonObject })
export const StoredCallV1 = Schema.Struct({ $v: Schema.Literal(1), call: Schema.JsonObject })
