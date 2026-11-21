// bun icon/render.ts: the app's icons from the home page's first emblem (client public/brand), drawn by Chrome:
// resources/icon.png (every platform's, full bleed: phones and the launcher round it), icon/foreground.png
// (Android's adaptive icon, the emblem inside the launcher's safe zone, over mygo.json's background color) and
// icon/AppIcon.icns (macOS, whose icons draw their own rounded square on the grid's 824 of 1024).
import { fileURLToPath, pathToFileURL } from "node:url"
import { $ } from "bun"

const at = (p: string) => fileURLToPath(new URL(p, import.meta.url))
const chrome = Bun.env["CHROME"] ?? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
const emblem = at("../../client/public/brand/projector-rosette-04.svg")
const paper = "#fcfcfb"
const draw = async (out: string, plate: string) => {
  const html = at("./.render.html")
  await Bun.write(
    html,
    `<body style="margin:0;width:1024px;height:1024px;display:grid;place-items:center">${plate}</body>`,
  )
  await $`${chrome} --headless --hide-scrollbars --force-device-scale-factor=1 --window-size=1024,1024 --default-background-color=00000000 --screenshot=${out} ${pathToFileURL(html).href}`.quiet()
  await $`rm ${html}`
}
const img = (height: string) => `<img src="${pathToFileURL(emblem).href}" style="height:${height}">`
/** A square of paper with the emblem at 80% of its side. */
const plate = (size: number, radius: number, shadow = "none") =>
  `<div style="width:${size}px;height:${size}px;border-radius:${radius}px;background:${paper};box-shadow:${shadow};display:grid;place-items:center">${img(`${size * 0.8}px`)}</div>`

await draw(at("../resources/icon.png"), plate(1024, 0))
await draw(at("./foreground.png"), img("54%"))
const mac = at("./.mac.png")
await draw(mac, plate(824, 185, "0 10px 20px rgb(0 0 0 / 0.18)"))
const set = at("./.AppIcon.iconset")
await $`mkdir -p ${set}`
for (const s of [16, 32, 128, 256, 512]) {
  await $`sips -Z ${s} ${mac} --out ${set}/icon_${s}x${s}.png`.quiet()
  await $`sips -Z ${s * 2} ${mac} --out ${set}/icon_${s}x${s}@2x.png`.quiet()
}
await $`iconutil -c icns ${set} -o ${at("./AppIcon.icns")} && rm -r ${set} ${mac}`
