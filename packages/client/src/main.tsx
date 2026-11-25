import "./theme.ts"
import { render } from "@solidjs/web"
import { App } from "./App.tsx"
import { flushHiddenProse } from "./store.ts"
import { boot } from "./pages.ts"
import "./app.css"

document.addEventListener("visibilitychange", flushHiddenProse)

if (import.meta.env.DEV && "serviceWorker" in navigator) {
  await navigator.serviceWorker
    .register("/__dev-media-sw.js", { scope: "/" })
    .then(async () => {
      await navigator.serviceWorker.ready
      if (!navigator.serviceWorker.controller) {
        await new Promise<void>((resolve) => {
          const done = () => {
            navigator.serviceWorker.removeEventListener("controllerchange", done)
            resolve()
          }
          navigator.serviceWorker.addEventListener("controllerchange", done)
          setTimeout(done, 800)
        })
      }
    })
    .catch(() => {})
}

// Settle the initial snapshot and active tab before mounting the DOM so a reload paints once in its final state.
await boot().catch(() => {})
render(() => <App />, document.getElementById("root")!)
