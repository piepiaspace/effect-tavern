// One text read over https, for what the install fetches because the player gave it an address: a card library's index
// and files (depot.ts) and a single card's link (library.ts `importLink`). https only, at the address asked and after
// any redirect (a forge's raw links move hosts; none may leave https); a host that does not begin to answer in
// `ANSWER` is given up on, and so is a body still arriving after `WHOLE`; a body over the card ceiling is not read.
// What fails is `Refused` with the caller's code, never a hang.
import { CARD_BYTES } from "@effect-tavern/runtime/src/library.ts"
import { Refused } from "./shelf.ts"

/** How long a host has to begin answering, and how long the whole body may take: a heavy card on a slow line needs
 *  the second, a host that says nothing is given up on by the first. */
const ANSWER = 15_000
const WHOLE = 120_000
export const remote = (location: string) => /^https:\/\//i.test(location)

export const readHttps = async (
  address: string | URL,
  {
    fetch: io = fetch,
    code = "depot-unreadable" as Refused["code"],
    patience = { answer: ANSWER, whole: WHOLE },
  }: { fetch?: typeof fetch; code?: Refused["code"]; patience?: { answer: number; whole: number } } = {},
): Promise<string> => {
  const refuse = (what: string) => new Refused(code, what, 502)
  let url: URL
  try {
    url = new URL(address)
  } catch {
    throw refuse(`${String(address)}: not an address`)
  }
  if (url.protocol !== "https:") throw refuse(`${url.href}: not an https address`)
  const gone = new AbortController()
  let timer = setTimeout(() => gone.abort(new Error("no answer")), patience.answer)
  try {
    const res = await io(url, { redirect: "follow", signal: gone.signal })
    clearTimeout(timer)
    timer = setTimeout(() => gone.abort(new Error("the answer took too long")), patience.whole)
    if (res.url && !remote(res.url)) throw refuse(`${url.href}: redirected off https`)
    if (!res.ok) throw refuse(`${url.href}: HTTP ${res.status}`)
    if (Number(res.headers.get("content-length") ?? 0) > CARD_BYTES) throw refuse(`${url.href}: too large`)
    if (!res.body) return ""
    const decoder = new TextDecoder()
    let size = 0
    let text = ""
    for await (const chunk of res.body) {
      size += chunk.byteLength
      if (size > CARD_BYTES) throw refuse(`${url.href}: too large`)
      text += decoder.decode(chunk, { stream: true })
    }
    return text + decoder.decode()
  } catch (e) {
    gone.abort()
    throw e instanceof Refused ? e : refuse(`${url.href}: ${e instanceof Error ? e.message : "no answer"}`)
  } finally {
    clearTimeout(timer)
  }
}
