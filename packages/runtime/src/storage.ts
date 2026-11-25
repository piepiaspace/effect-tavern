import { sha256 } from "@noble/hashes/sha2.js"
import { bytesToHex, utf8ToBytes } from "@noble/hashes/utils.js"
import { Schema } from "effect"

// ─── 1. 内容寻址原语 (地址仅取决于未压缩原始 UTF-8 字节) ─────────────────────

/** 64 位小写 hex SHA-256 内容地址（SQLite blob 表与未来 #228 宿主旁路媒体 CAS 共用） */
export const ObjectId = Schema.String.check(Schema.isPattern(/^[0-9a-f]{64}$/)).pipe(Schema.brand("ObjectId"))
export type ObjectId = typeof ObjectId.Type

export const BlobEncoding = Schema.Literals(["utf8", "deflate-b64"])
export type BlobEncoding = typeof BlobEncoding.Type

/** 递归按 UTF-16 码元序排列普通对象键，消除键序差异造成的资产哈希漂移 */
export const canonicalJson = (value: Schema.Json): string => {
  if (Array.isArray(value)) return "[" + value.map(canonicalJson).join(",") + "]"
  if (value === null || typeof value !== "object") return JSON.stringify(value)
  const object = value as Schema.JsonObject
  return (
    "{" +
    Object.keys(object)
      .sort()
      .map((k) => JSON.stringify(k) + ":" + canonicalJson(object[k]))
      .join(",") +
    "}"
  )
}

export const hashUtf8 = (utf8: string): ObjectId => ObjectId.make(bytesToHex(sha256(utf8ToBytes(utf8))))

/** 稀疏覆盖项（harness / local）无任何用户覆盖时的天然基线对象地址 */
export const EMPTY_OVERLAY_JSON = "{}"
export const EMPTY_OVERLAY_HASH: ObjectId = hashUtf8(EMPTY_OVERLAY_JSON)

// ─── 2. Layer 3 · 通用单层快照状态、请求与冲突契约 ───────────────────────────

export const CheckpointKind = Schema.Literals(["hat", "pack", "card", "persona", "local"])
export type CheckpointKind = typeof CheckpointKind.Type

/** 二态快照投影（迁移一次性打底 + 稀疏项默认锚定 EMPTY_OVERLAY_HASH，无 Unanchored 态） */
export const CheckpointStanding = Schema.Union([
  Schema.Struct({
    status: Schema.Literal("clean"),
    hash: ObjectId,
    updatedAt: Schema.NullOr(Schema.Int), // 隐式锚定 EMPTY_OVERLAY_HASH 且尚未显式落行时为 null
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

/** Pin 与 Revert 必须同时校验工作态与锚点双侧版本，防止跨标签页并发盲盖或回退目标漂移 */
export const CheckpointMutation = Schema.Struct({
  action: Schema.Literals(["pin", "revert"]),
  expectedWorkingHash: ObjectId,
  expectedAnchorHash: ObjectId,
  rev: Schema.optionalKey(Schema.String), // card 工坊额外透传当前 rev 对齐既有乐观锁
})
export type CheckpointMutation = typeof CheckpointMutation.Type

/** Revert 遇到外部环境冲突时拒绝静默改写，返回结构化冲突原因供前端明确提示 */
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

/** Hashes and provenance used to plan one mutation against a consistent snapshot.
 * The storage adapter checks and applies this decision within the same transaction. */
export interface CheckpointState {
  working: ObjectId
  anchor: ObjectId
  updatedAt: number | null
  workingEdited?: boolean
  anchorEdited?: boolean
  rev?: string
}

export function checkpointMutation(
  state: CheckpointState,
  request: CheckpointMutation,
  now: number,
  conflict?: CheckpointConflict,
) {
  if (
    request.expectedWorkingHash !== state.working ||
    request.expectedAnchorHash !== state.anchor ||
    (request.rev !== undefined && request.rev !== state.rev)
  ) {
    return {
      code: "checkpoint-changed",
      standing: deriveStanding(state.working, { hash: state.anchor, updatedAt: state.updatedAt }),
    } as const
  }
  if (request.action === "pin") {
    return { action: "pin", hash: state.working, edited: state.workingEdited, updatedAt: now } as const
  }
  if (conflict) return { code: "checkpoint-conflict", conflict } as const
  return { action: "revert", hash: state.anchor, edited: state.anchorEdited } as const
}
