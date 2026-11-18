// The terminal's words for every failure in English, the same codes as zh-CN.ts (the source) saying the same thing.
// Places are the client's own words (client src/locales/en.ts: Settings, Providers, Default model, Cards, API URL,
// API key, Network proxy, Context window).
import { CARD_BYTES } from "@effect-tavern/runtime/src/library.ts"
import { sentence, type Facts, type Table, type Words } from "../codes.ts"

const PROVIDERS = "In Settings, under Providers,"
const ROUTING = "in Settings, under Default model"
const wait = (s: number) => (s > 90 ? `${Math.ceil(s / 60)} minutes` : `${s} seconds`)
const url =
  (why: string): ((f: Facts) => Words) =>
  () => ({
    what: "The provider's API URL is not valid",
    why,
    next: `${PROVIDERS} correct the API URL.`,
  })

export const en: Table = {
  "key-refused": () => ({
    what: "The provider refused the key",
    why: "The key may be mistyped, expired or revoked.",
    next: `${PROVIDERS} enter this provider's API key again, then send again.`,
  }),
  "no-credit": () => ({
    what: "The provider account is out of credit",
    why: "The free allowance or the paid balance has run out.",
    next: `Top up on the provider's website, or pick another provider's model ${ROUTING}.`,
  }),
  "rate-limited": (f) => ({
    what: "Too fast: the provider asks you to wait",
    why: "Too many requests in a short time, or the account's rate limit is low.",
    next: f.retryAfter ? `Wait about ${wait(f.retryAfter)}, then send again.` : "Wait a minute or so, then send again.",
  }),
  overloaded: () => ({
    what: "The provider is too busy right now",
    why: "It is busy on their side; nothing is wrong with your settings.",
    next: `Send again in a few minutes; if it keeps happening, pick another model ${ROUTING}.`,
  }),
  "model-not-found": (f) => ({
    what: f.model ? `The provider has no model ${f.model}` : "The provider has no such model",
    why: "The model name may be mistyped or retired, or the API URL is missing part of its path.",
    next: `${PROVIDERS} check the model name and the API URL.`,
  }),
  "context-too-long": () => ({
    what: "This request is too long for the model",
    why: "The story and its settings together are more than the model can read.",
    next: `${PROVIDERS} lower this model's Context window, then send again.`,
  }),
  blocked: () => ({
    what: "The provider refused this content",
    why: "It tripped the provider's safety review.",
    next: `Say it another way and send again, or pick another model ${ROUTING}.`,
  }),
  unreachable: () => ({
    what: "Could not reach the provider",
    why: "The network is down, the address is wrong, or it needs a proxy.",
    next: "Check the network first; then check the API URL and Network proxy in Settings, under Providers.",
  }),
  timeout: () => ({
    what: "The provider took too long to answer",
    why: "The network is slow, or the provider is stuck.",
    next: "Send again later; if it happens often, check the network and the Network proxy.",
  }),
  "bad-request": (f) => ({
    what: "The provider would not take this request",
    why: sentence(f.message) ?? "The model may not support one of the current settings.",
    next: `${PROVIDERS} check this model's settings, or pick another model ${ROUTING}.`,
  }),
  "bad-answer": () => ({
    what: "The model's answer could not be used",
    why: "The answer was not in the right shape, or the API URL points at a web page.",
    next: `Send again; if it keeps happening, pick another model ${ROUTING}.`,
  }),
  "provider-down": () => ({
    what: "The provider had an error on its side",
    why: "Not your settings; it usually passes soon.",
    next: "Send again in a few minutes.",
  }),
  unknown: (f) => ({
    what: "An error we have not seen before",
    why: sentence(f.message),
    next: "Try again; if it keeps happening, send these lines to whoever helps you.",
  }),
  "provider-missing": () => ({
    what: "The chosen provider no longer exists",
    next: `Pick a model again ${ROUTING}.`,
  }),
  "provider-disabled": () => ({
    what: "The chosen provider is switched off",
    next: `${PROVIDERS} switch it on, or pick another one ${ROUTING}.`,
  }),
  "provider-no-model": () => ({
    what: "The chosen model is not in that provider's list",
    next: `Pick a model again ${ROUTING}.`,
  }),
  "provider-no-endpoint": () => ({
    what: "The provider has no API URL yet",
    next: `${PROVIDERS} fill in the API URL.`,
  }),
  "provider-no-key": () => ({ what: "The provider has no key yet", next: `${PROVIDERS} fill in the API key.` }),
  "url-empty": url("The address is empty."),
  "url-invalid": url("It is not a complete URL."),
  "url-scheme": url("Only http or https addresses work."),
  "url-credentials": url("An address cannot carry a username or password."),
  "url-fragment": url("An address cannot contain #."),
  "url-query": url("An address cannot contain a query string."),
  "url-operation": url("It is a full endpoint, so exact prefix must be on."),
  "url-origin": url("The default path takes a bare domain only."),
  "no-model": () => ({ what: "No default model is chosen yet", next: `Pick a model ${ROUTING}.` }),
  busy: () => ({
    what: "This story is still writing its last turn",
    next: "Wait for it to finish, or stop it, then send.",
  }),
  "port-in-use": (f) => ({
    what: f.port ? `Port ${f.port} is already in use` : "The port is already in use",
    why: "A tavern may already be running, or another program holds it.",
    next: "Use the one already running, or start again with --port and another port.",
  }),
  "library-held": (f) => ({
    what: "The data directory is in use by another tavern",
    ...(f.pid !== undefined && { why: `Process ${f.pid} already has it open.` }),
    next: "Use the one already running, or stop it first, then start.",
  }),
  "library-newer": () => ({
    what: "The data comes from a newer tavern",
    why: "A newer version has opened it, and this version cannot read it.",
    next: "Update the tavern to the latest version, then open it.",
  }),
  "no-card": () => ({ what: "There is no such card", next: "See the installed cards in Settings, under Cards." }),
  "card-exists": () => ({
    what: "A card with this id is installed",
    next: "To overwrite it, choose Replace; otherwise change the card's id first.",
  }),
  "card-in-use": () => ({
    what: "This card still has stories",
    why: "A card cannot be removed while stories use it.",
    next: "Delete the stories on this card first, then the card.",
  }),
  "card-invalid": () => ({
    what: "Not a usable card",
    why: "The card did not pass the check.",
    next: "Fix the card file as the last line says, then import it again.",
  }),
  "card-changed": () => ({
    what: "The card was changed elsewhere",
    next: "Reread the card, then make the change again.",
  }),
  "no-depot": () => ({ what: "There is no such library", next: "See the libraries added in Settings, under Cards." }),
  "depot-unreadable": () => ({
    what: "Could not read this library",
    why: "The address may be wrong, or the network is down.",
    next: "Check the library's address and the network, then try again.",
  }),
  "depot-is-card": () => ({ what: "This is a card, not a library", next: "Import it from the link with Import card." }),
  "link-unreadable": () => ({
    what: "Could not read this link",
    why: "The link may be wrong, not https, or the network is down.",
    next: "Check the link, then try again.",
  }),
  "too-large": () => ({
    what: "The file is too large",
    why: `A card file can be at most ${CARD_BYTES / 1024 / 1024} MB.`,
    next: "Use a smaller file.",
  }),
}
