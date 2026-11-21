import * as L from "@effect-tavern/runtime/src/log.ts"
import { render } from "@solidjs/web"
import { flush } from "solid-js"
import { t } from "../src/i18n.ts"
import { log, registry } from "../src/store.ts"
import { Timeline } from "../src/timeline.tsx"
import { timelineNode } from "./fixtures.ts"
import "../src/app.css"

const failures: string[] = []
try {
  registry.set(log, L.of({ nodes: [timelineNode(1, null, "正文")], head: 1 }))
  flush() // a write shows after Solid's flush, and the Timeline's body reads the log under an owner, where get does not flush
  render(() => <Timeline />, document.getElementById("root")!)
  flush()
  const nodeTab = [...document.querySelectorAll<HTMLButtonElement>('[role="tab"]')].find((tab) =>
    tab.textContent?.includes(t("common.node")),
  )
  nodeTab!.click()
  flush()

  const pane = document.querySelector(`section[aria-label="${t("common.node")}"]`)!
  const title = pane.querySelector("h2")!.getBoundingClientRect()
  const action = pane.querySelector(`button[aria-label="${t("timeline.openInReader")}"]`)!.getBoundingClientRect()
  const details = [...pane.querySelectorAll("span")]
    .find((s) => s.textContent === t("timeline.belowN", { n: 0 }))!
    .getBoundingClientRect()
  if (Math.min(title.height, action.height, details.height) <= 0 || Math.max(title.bottom, action.bottom) > details.top)
    failures.push("the selected node's heading and actions must be visible above its details")
} catch (e) {
  failures.push(String(e))
}
void fetch("/result", { method: "POST", body: JSON.stringify({ failures, snapshot: [] }) })
