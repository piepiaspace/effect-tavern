import { render } from "@solidjs/web"
import { For, createSignal } from "solid-js"
import { installDiagnosticsBridge } from "@solidjs/diagnostics/browser"
import { ViewBlock } from "../src/view-shell.tsx"
import { MediaFrame } from "../src/lightbox.tsx"
import { card, registry } from "../src/store.ts"
import { importCard, fetchCardOf } from "../src/wire.ts"
import type { EffectiveView } from "@effect-tavern/runtime/src/view-shell.ts"
import { until, quiet } from "./settle.ts"
import { postResult } from "./media-transport.ts"
import "../src/app.css"

async function run() {
  const yaml = await fetch("/__fixture/ferry.yaml").then((r) => r.text())
  const installed = await importCard(yaml)
  await fetchCardOf(installed.id)
  const cardView = registry.get(card)!
  const diagnostics = installDiagnosticsBridge()
  diagnostics.begin()
  const [value, setValue] = createSignal({ rows: ["first", "second"], level: 2, weather: "rain" })
  const view: EffectiveView = {
    id: "letter",
    product: "inner",
    playerTemplate: true,
    html: '<details data-open="latest" data-attr-weather="value.weather" data-var-level="value.level"><summary>Log</summary><ol data-each="value.rows" data-as="row"><li><b data-text="row.$num"></b><span data-text="row"></span></li></ol><label for="tab">Tab</label><input type="radio" name="tabs" id="tab"><p data-if="fields.secret">private</p></details>',
  }
  const [latest, setLatest] = createSignal(true)
  const ratios = ["3 / 1", "1 / 1", "1 / 3"]
  const dispose = render(
    () => (
      <>
        <ViewBlock card={cardView} view={view} latest={latest()} value={value()} />
        <For each={ratios}>
          {(aspect, i) => (
            <MediaFrame
              fit="natural"
              aspect={aspect}
              focus={[0.25, 0.2]}
              label={aspect}
              src={
                "data:image/svg+xml," +
                encodeURIComponent(
                  '<svg xmlns="http://www.w3.org/2000/svg" width="' +
                    [120, 40, 40][i()] +
                    '" height="' +
                    [40, 40, 120][i()] +
                    '"/>',
                )
              }
            />
          )}
        </For>
      </>
    ),
    document.getElementById("root")!,
  )
  try {
    const root = () => document.querySelector(".view-shell")?.shadowRoot
    const require = (ok: unknown, message: string) => {
      if (!ok) throw new Error(message)
    }
    require(await until(() => root()?.querySelectorAll("li").length === 2), "rows render")
    const details = root()!.querySelector("details")!
    require(details.open &&
      details.dataset.weather === "rain" &&
      details.style.getPropertyValue("--level") === "2", "initial bindings")
    require(details.querySelectorAll("li")[1]?.textContent === "2second" &&
      !details.querySelector("p"), "row scope and player lock")
    require(details.querySelector("label")?.control === details.querySelector("input"), "namespaced radio and label")
    details.open = false
    setValue({ rows: ["<b>literal</b>"], weather: "sun", level: NaN })
    await quiet()
    require(!details.open &&
      details.querySelector("li")?.textContent === "1<b>literal</b>" &&
      !details.style.getPropertyValue("--level"), "text, numeric validation and user fold persist")
    details.open = true
    setLatest(false)
    await quiet()
    require(!details.open &&
      !document.querySelector(".view-shell")?.hasAttribute("data-latest"), "historical disclosure")
    require(await until(
      () => document.querySelectorAll(".media-frame[data-state=ready]").length === 3,
    ), "test images decode")
    for (const [i, frame] of [...document.querySelectorAll<HTMLElement>(".media-frame")].entries()) {
      const css = getComputedStyle(frame)
      const img = getComputedStyle(frame.querySelector("img")!)
      require(css.aspectRatio === ratios[i] &&
        img.objectFit === "contain" &&
        img.objectPosition === "25% 20%", "natural composition " + i + " " + css.aspectRatio)
    }
    await postResult({ failures: diagnostics.end().diagnostics.map((d) => d.message) })
  } finally {
    dispose()
  }
}
void run().catch((e) => postResult({ failures: [String(e)] }))
