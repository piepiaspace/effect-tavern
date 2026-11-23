// The decision call (decision.ts is what it is and its config): `compileDecision` turns a config and its key into an
// ai-sdk decision model, `decide` asks it typed questions about one text.
//
// Three question kinds. `boolean` answers P(true); `choice` picks one option id; `score` places the text on an ordered
// rubric. Questions are judged independently of each other. A native decision model returns a distribution for choice
// and score; an adapter over a language model does not, so `probabilities` is optional and a caller checks for it.
// A safety block refuses every question of the request at once: the call fails as a ModelError (`blocked` tells it
// from any other failure), never a partial answer.
import { createGoogleGenerativeAI } from "@ai-sdk/google"
import { createOpenAI } from "@ai-sdk/openai"
import { createTypeSafeAi } from "@ai-sdk/typesafe-ai"
import { experimental_decide, type Experimental_DecisionModel, type Experimental_DecisionQuestion } from "ai"
import { Experimental_DecisionMockModelV4 } from "ai/test"
import { Effect } from "effect"
import { modelError, observedError, type ModelError, type Usage } from "./call.ts"
import { providerFetch, type CompileOptions } from "./connection.ts"
import type { DecisionConfig } from "./decision.ts"
import { causes, readFault } from "./fault.ts"
import { observe } from "./exchange.ts"
import { ConnectionError, type Secret } from "./providers.ts"

export type DecisionModel = Experimental_DecisionModel
export type Question = Exclude<Experimental_DecisionQuestion, { type: "box" }>

const FACTORY = { google: createGoogleGenerativeAI, openai: createOpenAI, typesafe: createTypeSafeAi }

/** A config as a model, whether or not it is enabled (the player tests before switching it on). What is missing fails
 *  here; an unset `url` is the driver's own address. `onTrace` sees each fetch, as on `compile`. */
export const compileDecision = (c: DecisionConfig, s: Secret | undefined, o: CompileOptions = {}): DecisionModel => {
  if (!s) throw new ConnectionError("provider-no-key", "decision model: no key")
  if (!c.model.trim()) throw new ConnectionError("provider-no-model", "decision model: no model")
  const fetch = providerFetch(c, o)
  const exchange = o.onExchange && observe(o.onExchange, c.model, s.value, c.headers)
  const model = FACTORY[c.driver]({
    apiKey: s.value,
    ...(c.url?.trim() && { baseURL: c.url.trim() }),
    ...(c.headers && { headers: c.headers }),
    // ai-sdk types `fetch` as `typeof fetch`, which under Bun types also requires `preconnect`; the SDK only calls it
    fetch: (exchange ? exchange.wrap(fetch) : fetch) as typeof globalThis.fetch,
  }).decisionModel(c.model.trim())
  if (!exchange) return model
  return {
    specificationVersion: model.specificationVersion,
    provider: model.provider,
    modelId: model.modelId,
    supportedQuestionTypes: model.supportedQuestionTypes,
    async doDecide(options) {
      try {
        const result = await model.doDecide(options)
        exchange.finish(JSON.stringify(result.answers, null, 2))
        return result
      } catch (e) {
        // Keep the SDK error intact so its retry policy still sees isRetryable.
        if (e instanceof Error) Object.assign(e, { fault: observedError(e, exchange).fault })
        throw e
      }
    },
  }
}

export const decide = <const Q extends Record<string, Question>>(
  model: DecisionModel,
  state: string,
  questions: Q,
  o: { maxRetries?: number } = {}, // ai-sdk retries a transient failure twice when unset
) =>
  Effect.tryPromise((abortSignal) => experimental_decide({ model, state, questions, abortSignal, ...o })).pipe(
    Effect.mapError(modelError),
    Effect.map((r) => ({
      answers: r.answers,
      // input only: a decision generates nothing, and the endpoint has no cache
      usage: { input: r.usage.inputTokens ?? 0, output: 0, cacheRead: 0, cacheWrite: 0 } satisfies Usage,
    })),
  )

/** The smallest real request: one yes/no question about one word, sent once. What a "test" button sends. */
export const probeDecision = (model: DecisionModel) =>
  decide(
    model,
    "Hello.",
    { greeting: { type: "boolean", instructions: "Is this text a greeting?" } },
    { maxRetries: 0 },
  )

/** Why the service refused to judge this text, when that is what the failure was (fault.ts `blocked`): its block code,
 *  or `refusal` when it answered with refusals. Google's decisions endpoint answers a block as HTTP 400
 *  `{error: {code: "safety"}}`, which the SDK's error parser (numeric `code`, a `status`) does not read, so the message
 *  is a bare "Bad Request" and the code is only in the response body down the cause chain, where this driver reads it. */
export const blocked = (e: ModelError): string | undefined => {
  for (const c of causes(e)) if (c.name === "AI_DecisionRefusalError") return "refusal"
  const body = readFault(e).body
  if (body) {
    try {
      if (JSON.parse(body)?.error?.code === "safety") return "safety"
    } catch {}
  }
  return undefined
}

type Call = Parameters<Experimental_DecisionMockModelV4["doDecide"]>[0]
type Answers = Awaited<ReturnType<Experimental_DecisionMockModelV4["doDecide"]>>["answers"]
/** A scripted decision model for self-checks, as `fake` is for a stage's model: answers by a function of the request. */
export const fakeDecision = (answer: (call: Call) => Answers): DecisionModel =>
  new Experimental_DecisionMockModelV4({
    supportedQuestionTypes: ["boolean", "choice", "score"],
    doDecide: async (call) => ({ answers: answer(call), warnings: [] }),
  })
