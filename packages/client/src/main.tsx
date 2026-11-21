import "./theme.ts"
import { render } from "@solidjs/web"
import { App } from "./App.tsx"
import { boot } from "./pages.ts"
import "./app.css"

// Settle the initial snapshot and active tab before mounting the DOM so a reload paints once in its final state.
await boot().catch(() => {})
render(() => <App />, document.getElementById("root")!)
