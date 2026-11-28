// bun icon/render.ts: the app's icons from the Arch Aperture V2-B mark, drawn by Chrome:
// - resources/icon.png: full-bleed warm terracotta plate + white arch cutout (55% height, -2% lift)
// - icon/foreground.png: Android adaptive icon foreground (37% of 108dp = 55.5% of 72dp visible viewport, inside 66dp safe circle)
// - icon/AppIcon.icns: macOS rounded terracotta plate (824/1024 grid)
// - icon/icon-dark.png: optional dark obsidian variant (Option A, warm glowing cone) ready for iOS dark icon support
import { fileURLToPath, pathToFileURL } from "node:url"
import { $ } from "bun"

const at = (p: string) => fileURLToPath(new URL(p, import.meta.url))
const chrome = Bun.env["CHROME"] ?? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"

const ARCH_D =
  "M 0 1024 L 0 487.619 C 0 218.314 218.314 0 487.619 0 C 756.924 0 975.238 218.314 975.238 487.619 L 975.238 1024 L 780.19 1024 L 780.19 536.381 C 780.19 449.276 733.721 368.788 658.286 325.236 C 583.281 615.073 400.049 865.144 146.286 1024 L 0 1024 Z"
const CONE_D =
  "M 780.19 1024 L 780.19 536.381 C 780.19 449.276 733.721 368.788 658.286 325.236 C 583.281 615.073 400.049 865.144 146.286 1024 Z"

const terracotta = "linear-gradient(160deg, #ea7644 0%, #c95128 100%)"
const obsidian = "linear-gradient(180deg, #1b1b19 0%, #111110 100%)"

const archCutoutSvg = (height: string, lift = "-2%") =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 975.238 1024" style="height:${height};width:auto;display:block;transform:translateY(${lift})"><path d="${ARCH_D}" fill="#faf8f4" fill-rule="evenodd"/></svg>`

const archWarmGlowSvg = (height: string, lift = "-2%") =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 975.238 1024" style="height:${height};width:auto;display:block;transform:translateY(${lift})"><defs><linearGradient id="warm" x1="20%" y1="95%" x2="80%" y2="20%"><stop offset="0%" stop-color="#ffa85e"/><stop offset="100%" stop-color="#eb6a34"/></linearGradient></defs><path d="${CONE_D}" fill="url(#warm)"/><path d="${ARCH_D}" fill="#f9f9f7" fill-rule="evenodd"/></svg>`

const draw = async (out: string, plate: string) => {
  const html = at("./.render.html")
  await Bun.write(
    html,
    `<body style="margin:0;width:1024px;height:1024px;display:grid;place-items:center">${plate}</body>`,
  )
  await $`${chrome} --headless --hide-scrollbars --force-device-scale-factor=1 --window-size=1024,1024 --default-background-color=00000000 --screenshot=${out} ${pathToFileURL(html).href}`.quiet()
  await $`rm ${html}`
}

const plate = (size: number, radius: number, bg: string, emblem: string, shadow = "none") =>
  `<div style="width:${size}px;height:${size}px;border-radius:${radius}px;background:${bg};box-shadow:${shadow};display:grid;place-items:center">${emblem}</div>`

// Default (Option C): warm terracotta plate + pure-white arch cutout at 55% scale
await draw(at("../resources/icon.png"), plate(1024, 0, terracotta, archCutoutSvg(`${1024 * 0.55}px`)))
await draw(at("./foreground.png"), archCutoutSvg("37%"))

// Optional dark variant (Option A): obsidian plate + white arch + warm glowing cone at 55% scale
await draw(at("./icon-dark.png"), plate(1024, 0, obsidian, archWarmGlowSvg(`${1024 * 0.55}px`)))

const mac = at("./.mac.png")
await draw(
  mac,
  plate(
    824,
    185,
    terracotta,
    archCutoutSvg(`${824 * 0.55}px`),
    "0 10px 20px rgb(0 0 0 / 0.24), inset 0 1.5px 0 rgb(255 255 255 / 0.18)",
  ),
)
const set = at("./.AppIcon.iconset")
await $`mkdir -p ${set}`
for (const s of [16, 32, 128, 256, 512]) {
  await $`sips -Z ${s} ${mac} --out ${set}/icon_${s}x${s}.png`.quiet()
  await $`sips -Z ${s * 2} ${mac} --out ${set}/icon_${s}x${s}@2x.png`.quiet()
}
await $`iconutil -c icns ${set} -o ${at("./AppIcon.icns")} && rm -r ${set} ${mac}`
