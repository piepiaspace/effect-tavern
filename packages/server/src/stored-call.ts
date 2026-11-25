// The persisted value of a Call is its JSON projection, as on the Inspector wire.
import {
  hashBytes,
  wellFormedText,
  type ObjectId,
  MIN_BLOB_BYTES,
  TextBlobRef,
  TextSlicesEnvelope,
  EscapedObjectEnvelope,
  StoredCallV1,
} from "@effect-tavern/runtime/src/storage.ts"
import { Schema } from "effect"
import type { Call } from "./turn.ts"

const utf8 = new TextEncoder()
const isRecord = (v: Schema.Json): v is Schema.JsonObject => v !== null && typeof v === "object" && !Array.isArray(v)
const mapFields = (object: Schema.JsonObject, f: (v: Schema.Json, key: string) => Schema.Json): Schema.JsonObject =>
  Object.fromEntries(Object.entries(object).map(([key, value]) => [key, f(value, key)]))

export function dehydrateCall(call: Call) {
  const json: Schema.JsonObject = JSON.parse(JSON.stringify(call))
  const objects = new Map<ObjectId, string>()
  const text = (s: string): string | typeof TextBlobRef.Type => {
    // A lone surrogate would be replaced by U+FFFD during UTF-8 encoding.
    if (!wellFormedText(s)) return s
    const bytes = utf8.encode(s)
    if (bytes.length < MIN_BLOB_BYTES) return s
    const id = hashBytes(bytes)
    objects.set(id, s)
    return { $text: id }
  }
  const slices = (description: string, sections: NonNullable<Call["wrap"]>["sections"]) => {
    const parts: (string | typeof TextBlobRef.Type)[] = []
    let cursor = 0
    for (const {
      body: { start, end },
    } of sections) {
      if (
        !Number.isSafeInteger(start) ||
        !Number.isSafeInteger(end) ||
        start < cursor ||
        end < start ||
        end > description.length
      )
        throw new Error("Invalid wrap body range")
      if (cursor < start) parts.push(text(description.slice(cursor, start)))
      parts.push(text(description.slice(start, end)))
      cursor = end
    }
    if (cursor < description.length) parts.push(text(description.slice(cursor)))
    return { $slices: parts }
  }
  function encode(value: Schema.Json): Schema.Json {
    if (typeof value === "string") return text(value)
    if (Array.isArray(value)) return value.map(encode)
    if (!isRecord(value)) return value
    const fields = mapFields(value, (v, key) =>
      value === json.tool && key === "description" && typeof v === "string" && call.wrap
        ? slices(v, call.wrap.sections)
        : encode(v),
    )
    return ["$text", "$esc", "$slices"].some((key) => Object.hasOwn(value, key)) ? { $esc: fields } : fields
  }
  const envelope = { $v: 1, call: encode(json) } as const
  return { envelope, objects }
}

/** Both SQL read paths supply the dictionary fetched for the selected rows. */
export function hydrateCall(row: Schema.JsonObject, objects: ReadonlyMap<ObjectId, string>): Schema.JsonObject {
  if (!Object.hasOwn(row, "$v") && row.kind === "call") return row
  if (!Schema.is(StoredCallV1)(row) || Object.keys(row).length !== 2) throw new Error("Invalid stored call envelope")
  function resolve(ref: Schema.Json): string {
    if (typeof ref === "string") return ref
    if (!Schema.is(TextBlobRef)(ref) || Object.keys(ref).length !== 1) throw new Error("Invalid stored text reference")
    const body = objects.get(ref.$text)
    if (body === undefined) throw new Error(`Missing stored text ${ref.$text}`)
    return body
  }
  function decode(value: Schema.Json): Schema.Json {
    if (Array.isArray(value)) return value.map(decode)
    if (!isRecord(value)) return value
    if (Object.hasOwn(value, "$text")) return resolve(value)
    if (Object.hasOwn(value, "$slices")) {
      if (!Schema.is(TextSlicesEnvelope)(value) || Object.keys(value).length !== 1)
        throw new Error("Invalid stored text slices")
      return value.$slices.map(resolve).join("")
    }
    if (Object.hasOwn(value, "$esc")) {
      if (!Schema.is(EscapedObjectEnvelope)(value) || Object.keys(value).length !== 1)
        throw new Error("Invalid escaped object")
      return mapFields(value.$esc, decode)
    }
    return mapFields(value, decode)
  }
  const call = decode(row.call)
  if (!isRecord(call) || call.kind !== "call") throw new Error("Invalid stored call root")
  return call
}
