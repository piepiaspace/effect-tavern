// A start that failed, said in the page. A phone has no console to open: a server bundle that threw as it loaded, or
// a library that would not open, used to leave a blank screen or a client drawn over nothing with every request
// failing. This puts a short notice over the page instead: what failed, the next step, and the error as it came, for
// whoever the player shows it to. It depends on nothing, since what failed may be everything else.
//
// Two callers. entry.ts shows it when the library cannot be opened. `watch`, inlined into index.html ahead of the
// server's script (build.ts), shows it when that script cannot be read or throws before the server is up; entry.ts
// calls `started` once it is, and from then on an error in the page is the running app's own business, never this.

const WORDS = {
  "zh-CN": {
    load: "应用没能启动：页面里的程序加载失败。",
    library: "应用没能启动：数据打不开。",
    next: "请关闭应用后重新打开。若仍然如此，请更新到最新版本。",
  },
  en: {
    load: "The app could not start: its program failed to load.",
    library: "The app could not start: its data could not be opened.",
    next: "Close the app and open it again. If this keeps happening, update to the latest version.",
  },
} as const
export type Failure = "load" | "library"

// The interface's language as the client picks it (its i18n.ts): the player's pick on this device, else the system's.
const language = (): keyof typeof WORDS => {
  try {
    const picked = localStorage.getItem("locale")
    if (picked === "zh-CN" || picked === "en") return picked
  } catch {
    // no storage: the system's
  }
  const langs = typeof navigator === "undefined" ? [] : (navigator.languages ?? [navigator.language])
  return langs.some((l) => /^zh/i.test(l ?? "")) ? "zh-CN" : "en"
}

const detail = (error: unknown): string => {
  const text = error instanceof Error ? error.message : typeof error === "string" ? error : ""
  return text.trim().slice(0, 600)
}

/** The notice over the page. The first failure stands: what follows it is usually its consequence. */
export const showFailure = (what: Failure, error: unknown): void => {
  if (typeof document === "undefined" || document.getElementById("start-failure")) return
  const words = WORDS[language()]
  const box = document.createElement("div")
  box.id = "start-failure"
  box.setAttribute("role", "alert")
  // over the client's root whatever it draws later, in the system's own colours for the appearance in force
  box.style.cssText =
    "position:fixed;inset:0;z-index:2147483647;box-sizing:border-box;overflow:auto;" +
    "padding:calc(env(safe-area-inset-top) + 2rem) 1.5rem calc(env(safe-area-inset-bottom) + 2rem);" +
    "background:Canvas;color:CanvasText;font:16px/1.6 system-ui,sans-serif;-webkit-user-select:text;user-select:text"
  for (const [text, style] of [
    [words[what], "margin:0 0 .5rem;font-weight:600"],
    [words.next, "margin:0 0 1.5rem"],
    [detail(error), "margin:0;opacity:.6;font-size:13px;white-space:pre-wrap;overflow-wrap:anywhere"],
  ]) {
    if (!text) continue
    const line = document.createElement("p")
    line.style.cssText = style
    line.textContent = text
    box.append(line)
  }
  ;(document.body ?? document.documentElement).append(box)
}

const g = globalThis as { tavernStarted?: boolean }
/** The server is up (entry.ts): from here on `watch` says nothing. */
export const started = (): void => {
  g.tavernStarted = true
}
/** Until the server is up, an error in the page is its script failing: one that could not be read (the event of the
 *  script element, which only capture hears) or that threw as it ran. Nothing else runs that early. */
export const watch = (): void => {
  const on = (e: Event) => {
    if (g.tavernStarted) return removeEventListener("error", on, true)
    if (e instanceof ErrorEvent) showFailure("load", e.error ?? e.message)
    else if (e.target instanceof HTMLScriptElement) showFailure("load", e.target.src)
  }
  addEventListener("error", on, true)
}
