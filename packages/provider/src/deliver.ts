// The narrative delivery tool's meta: the name, description and `text` parameter description a `deliver: "tool"`
// call sends. Pure (no ai-sdk, no node:*) so the browser client can import it by subpath to check a name as it is typed.

export const NARRATIVE_TOOL = "narrative" as const
export const NARRATIVE_TOOL_DESCRIPTION = "Deliver the complete scene narration."
export const NARRATIVE_PARAM_DESCRIPTION = "The full reply, nothing omitted."

/** A function name every vendor accepts: Anthropic `^[a-zA-Z0-9_-]{1,64}$`, OpenAI `^[a-zA-Z0-9_-]{1,64}$`, Gemini
 *  (starts with a letter or underscore, at most 64 of letters, digits, `_`, `-`). The intersection is this. */
export const TOOL_NAME_RE = /^[a-zA-Z_][a-zA-Z0-9_-]{0,63}$/
export const isToolName = (name: string): boolean => TOOL_NAME_RE.test(name)

/** Plain words for why `name` cannot be a tool name, or undefined when it can. */
export const toolNameProblem = (name: string): string | undefined =>
  isToolName(name)
    ? undefined
    : `the delivery tool name ${JSON.stringify(name)} is not one every model accepts: it must start with a letter or ` +
      `an underscore, hold only letters, digits, "_" and "-", and be at most 64 characters (for example ` +
      `"${NARRATIVE_TOOL}" or "actual_content")`

/** Overrides for the delivery tool; an absent or blank field keeps the default. */
export interface DeliverTool {
  name?: string
  description?: string
  param?: string
}
export type ResolvedDeliverTool = Required<DeliverTool>

const filled = (v: string | undefined, fallback: string) => (v === undefined || v.trim() === "" ? fallback : v)

/** Fills the defaults. Does not check the name: see `toolNameProblem`. */
export const resolveDeliverTool = (meta?: DeliverTool): ResolvedDeliverTool => ({
  name: filled(meta?.name, NARRATIVE_TOOL),
  description: filled(meta?.description, NARRATIVE_TOOL_DESCRIPTION),
  param: filled(meta?.param, NARRATIVE_PARAM_DESCRIPTION),
})
