// Solid's development runtime rejects primitives created in image refs. Exercise the actual card
// prop getters as well as the lightbox's dialog payload, both of which depend on reactive state.
import { render } from "@solidjs/web"
import { installDiagnosticsBridge } from "@solidjs/diagnostics/browser"
import { createAgent } from "@ui-sdk/solid/agent"
import { CardPage } from "../src/card.tsx"
import { t } from "../src/i18n.ts"
import { Lightbox } from "../src/lightbox.tsx"
import { fetchCardOf, importCard } from "../src/wire.ts"
import { installMediaTransport, postResult } from "./media-transport.ts"
import { until } from "./settle.ts"

async function verifyGallery() {
  await installMediaTransport()
  const yaml = await fetch("/__fixture/ferry.yaml").then((r) => r.text())
  const card = await importCard(yaml)
  await fetchCardOf(card.id)
  const diagnostics = installDiagnosticsBridge()
  diagnostics.begin()
  const dispose = render(
    () => (
      <>
        <CardPage />
        <Lightbox />
      </>
    ),
    document.getElementById("root")!,
  )
  try {
    const agent = createAgent({ allow: () => true })
    const tab = await agent.act({ steps: [{ ref: t("common.view"), action: "setValue", args: [t("card.gallery")] }] })
    if (!tab.ok) throw new Error(tab.error?.message)
    if (!(await until(() => document.querySelector('.gallery-frame[data-state="ready"]'))))
      throw new Error("Gallery image did not load")
    const opened = await agent.act({ steps: [{ ref: "渡口薄雾", action: "press" }] })
    if (!opened.ok) throw new Error(opened.error?.message)
    if (!(await until(() => document.querySelector('.lightbox-img[data-state="ready"]'))))
      throw new Error("Lightbox did not load")
    await postResult({ failures: diagnostics.end().diagnostics.map((d) => d.message) })
  } finally {
    dispose()
  }
}
void verifyGallery().catch((error) => postResult({ failures: [String(error)] }))
