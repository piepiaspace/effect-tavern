// A command's own failure: a code the terminal words (term/codes.ts), the thrower's sentence, and the facts the words
// and the facts line read (term/explain.ts `factsOf`).
import type { Facts, ServerCode } from "../term/index.ts"

export class Failed extends Error {
  constructor(
    readonly code: ServerCode,
    message: string,
    facts: Partial<Omit<Facts, "code" | "message">> = {},
    options?: { cause?: unknown },
  ) {
    super(message, options)
    Object.assign(this, facts)
  }
}

/** The errno of a failed system call or fetch, when it has one. */
export const errno = (e: unknown): string | undefined => {
  const code = (e as { code?: unknown } | null)?.code
  return typeof code === "string" ? code : undefined
}
