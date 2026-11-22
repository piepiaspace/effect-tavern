// A scripted model for self-checks: the same `Model` the session calls, answered by a function of the request.
// Lives here so the runtime's checks need no ai-sdk import of their own.
import { simulateReadableStream, type FinishReason } from "ai"
import { MockLanguageModelV4 } from "ai/test"
import type { Model } from "./call.ts"

export type FakeCall = Parameters<MockLanguageModelV4["doGenerate"]>[0]
export type FakeMessage = FakeCall["prompt"][number]

export const fakeText = (m: FakeMessage): string =>
  typeof m.content === "string" ? m.content : m.content.map((p) => ("text" in p ? p.text : "")).join("")

const usage = {
  inputTokens: { total: 0, noCache: 0, cacheRead: 0, cacheWrite: 0 },
  outputTokens: { total: 0, text: 0, reasoning: 0 },
}
const finish = (r: FakeReply) =>
  ({
    unified: r.finishReason ?? (r.cut ? "length" : r.toolCalls?.length ? "tool-calls" : "stop"),
    raw: r.rawFinishReason,
  }) as const

/** `reply` sees the provider-side request: `prompt` (messages), `responseFormat.name` (the `name` passed to `object`).
 *  A streamed request gets the same answer in eight-character deltas, `delay` milliseconds apart when set. */
export interface FakeReply {
  text: string
  reasoning?: string
  reasoningMetadata?: Record<string, Record<string, string>>
  cut?: boolean
  delay?: number
  finishReason?: FinishReason
  rawFinishReason?: string
  toolCalls?: readonly {
    name: string
    input: unknown
    /** Raw JSON text to emit instead of `JSON.stringify(input)` (e.g. truncated mid-string JSON). */
    rawInput?: string
    /** Skip `tool-input-end` and `tool-call` in `doStream` to simulate a stream cut before closing the call. */
    unclosed?: boolean
    id?: string
  }[]
}
export const fake = (reply: (o: FakeCall) => FakeReply): Model => ({
  format: "openai-compatible",
  prefill: false, // as on current Claude; a test that continues a cut prose sets it
  model: new MockLanguageModelV4({
    doGenerate: async (o) => {
      const r = reply(o)
      if (r.delay) await new Promise((f) => setTimeout(f, r.delay)) // a slow answer waits once; the stream waits per chunk
      const reasoning =
        r.reasoning !== undefined
          ? [
              {
                type: "reasoning" as const,
                text: r.reasoning,
                ...(r.reasoningMetadata && { providerMetadata: r.reasoningMetadata }),
              },
            ]
          : []
      const main = r.toolCalls
        ? r.toolCalls.map((c, i) => ({
            type: "tool-call" as const,
            toolCallId: c.id ?? `call_${crypto.randomUUID()}_${i}`,
            toolName: c.name,
            input: c.rawInput ?? JSON.stringify(c.input),
          }))
        : r.finishReason === "content-filter" && r.text === ""
          ? []
          : [{ type: "text" as const, text: r.text }]
      return {
        content: [...reasoning, ...main],
        finishReason: finish(r),
        usage,
        warnings: [],
      }
    },
    doStream: async (o) => {
      const r = reply(o)
      const reasoningChunks =
        r.reasoning !== undefined
          ? [
              {
                type: "reasoning-start" as const,
                id: "r0",
                ...(r.reasoningMetadata && { providerMetadata: r.reasoningMetadata }),
              },
              ...(r.reasoning.match(/[^]{1,8}/g) ?? []).map((delta) => ({
                type: "reasoning-delta" as const,
                id: "r0",
                delta,
                ...(r.reasoningMetadata && { providerMetadata: r.reasoningMetadata }),
              })),
              { type: "reasoning-end" as const, id: "r0" },
            ]
          : []
      const bodyChunks = r.toolCalls
        ? r.toolCalls.flatMap((c, i) => {
            const id = c.id ?? `call_${crypto.randomUUID()}_${i}`
            const raw = c.rawInput ?? JSON.stringify(c.input)
            return [
              { type: "tool-input-start" as const, id, toolName: c.name },
              ...(raw.match(/[^]{1,8}/g) ?? []).map((delta) => ({ type: "tool-input-delta" as const, id, delta })),
              ...(c.unclosed
                ? []
                : [
                    { type: "tool-input-end" as const, id },
                    { type: "tool-call" as const, toolCallId: id, toolName: c.name, input: raw },
                  ]),
            ]
          })
        : r.finishReason === "content-filter" && r.text === ""
          ? []
          : [
              { type: "text-start" as const, id: "0" },
              ...(r.text.match(/[^]{1,8}/g) ?? []).map((delta) => ({ type: "text-delta" as const, id: "0", delta })),
              { type: "text-end" as const, id: "0" },
            ]
      return {
        stream: simulateReadableStream({
          chunkDelayInMs: r.delay ?? null,
          chunks: [
            { type: "stream-start", warnings: [] },
            ...reasoningChunks,
            ...bodyChunks,
            { type: "finish", finishReason: finish(r), usage },
          ],
        }),
      }
    },
  }),
})
