// Cinema Astrolabe 02 figure definition: an engraved oblique-perspective astrolabe disc with a hatched machined edge,
// graduated bezel index ring, orbiting studs and compass stars, ten spiral-hatched iris blades rotating in true
// perspective, and a glass-shaded optical aperture with pointer-reactive specular reflections.
import type { HomeFigure } from "../home-figure.tsx"
import type { SoundProfile } from "../home-sound.ts"

// Optical center of the oblique astrolabe silhouette in artwork coordinates
const FRAME_CX = 514
const FRAME_CY = 495

// Crystalline F#m11 / A6/9 glass astrolabe identity (F#4, A4, B4, C#5, E5, F#5, A5, B5, C#6 + glassy 3x overtone)
const SOUND: SoundProfile = {
  scale: [369.99, 440.0, 493.88, 554.37, 659.25, 739.99, 880.0, 987.77, 1108.73],
  motif: [0, 3, 4, 2, 5, 4, 3, 1, 2, 4, 6, 4],
  wave: "sine",
  overtone: { ratio: 3, level: 0.14, decayRatio: 0.38 },
  tap: { startHz: 420, endHz: 190, level: 0.12 },
  filter: { baseHz: 2900, rangeHz: 800 },
  echo: { delaySec: 0.42, feedback: 0.28, wet: 0.34 },
  decay: { base: 0.68, accent: 0.94 },
  accents: {
    beats: [0, 5, 9],
    irisOpen: 6,
    irisClose: 2,
    hover: [4, 6],
    click: 4,
    engage: [1, 4],
  },
}

const ExtraHairline = () => (
  <>
    {/* Oblique celestial ecliptic & meridian tracks matching the -26° disc inclination */}
    <ellipse
      cx="0"
      cy="0"
      rx="486"
      ry="522"
      transform="translate(518 489) rotate(-26)"
      class="hl-belt hl-ecliptic"
      stroke-dasharray="5 12"
    />
    <ellipse
      cx="0"
      cy="0"
      rx="552"
      ry="496"
      transform="translate(514 495) rotate(-26)"
      class="hl-belt hl-meridian pr-detail-fine"
      stroke-dasharray="2 16"
    />
    {/* Inclination axis callouts along the -26° tilt */}
    <g class="hl-callout pr-detail-fine" transform="translate(518 489) rotate(-26)">
      <path d="M-548 0H-506 M506 0H548" />
      <circle cx="-552" cy="0" r="3.5" />
      <circle cx="552" cy="0" r="3.5" />
    </g>
  </>
)

const Artwork = () => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    class="home-emblem"
    data-brand="cinema-astrolabe-02"
    viewBox="0 0 1010 1024"
    aria-hidden="true"
  >
    <defs>
      <pattern id="ca2-edge-engraving" width="7" height="7" patternUnits="userSpaceOnUse" patternTransform="rotate(43)">
        <rect width="7" height="7" fill="#080909" />
        <path d="M1 0V7 M3 0V7" stroke="#f8f8f5" stroke-width="1" />
      </pattern>
      <radialGradient id="ca2-glass-shading" cx="70%" cy="42%" r="75%">
        <stop offset="0" stop-color="#fff" />
        <stop offset=".36" stop-color="#eee" />
        <stop offset=".58" stop-color="#92938f" />
        <stop offset=".78" stop-color="#282a28" />
        <stop offset="1" stop-color="#020303" />
      </radialGradient>
      <pattern id="ca2-glass-etching" width="8" height="4.5" patternUnits="userSpaceOnUse">
        <path d="M0 1H8" stroke="#080909" stroke-width="2" />
        <path d="M0 3.1H8" stroke="#fff" stroke-width=".7" />
      </pattern>
      <g id="ca2-radial-major-mark">
        <path d="M0-434V-411" stroke="#080909" stroke-width="2.5" />
        <path d="M0-410V-337" stroke="#151615" stroke-width="1" class="pr-detail-fine" />
        <path d="M-6-395H6 M-5-354H5" stroke="#111" stroke-width="1.4" class="pr-detail-fine" />
        <circle cy="-395" r="2" fill="#fff" stroke="#151515" stroke-width="1" class="pr-detail-micro" />
      </g>
      <g id="ca2-radial-mark-quadrant">
        <use href="#ca2-radial-major-mark" />
        <use href="#ca2-radial-major-mark" transform="rotate(15)" class="pr-detail-fine" />
        <use href="#ca2-radial-major-mark" transform="rotate(30)" />
        <use href="#ca2-radial-major-mark" transform="rotate(45)" class="pr-detail-fine" />
        <use href="#ca2-radial-major-mark" transform="rotate(60)" />
        <use href="#ca2-radial-major-mark" transform="rotate(75)" class="pr-detail-fine" />
      </g>
      <g id="ca2-round-ring-stud">
        <path d="M-22 0H22 M0-22V22" stroke="#101211" stroke-width="1.4" class="pr-detail-fine" />
        <circle r="16" fill="#fafaf7" stroke="#070908" stroke-width="1.8" />
        <circle r="12.5" fill="#161917" stroke="#080909" stroke-width="1" />
        <circle r="10" fill="#030504" stroke="#d1d2cb" stroke-width="1" />
        <path d="M-9-8Q0-16 9-8" fill="none" stroke="#fff" stroke-width=".7" class="pr-detail-micro" />
      </g>
      <g id="ca2-small-ring-rivet">
        <circle r="6.5" fill="#f4f4ef" stroke="#090b0a" stroke-width="1.4" />
        <circle r="4.4" fill="#171b18" />
        <path d="M-3-3L2-4" stroke="#b6b8b1" stroke-width="1" class="pr-detail-micro" />
      </g>
      <g id="ca2-compass-star">
        <path
          d="M0-27 4-8 13-13 8-4 25 0 8 4 13 13 4 8 0 27-4 8-13 13-8 4-25 0-8-4-13-13-4-8Z"
          fill="#070908"
          stroke="#080908"
          stroke-width=".9"
        />
        <path
          d="M0-24V0L-10-10 0-5 10-10 4 0 20 0 3 4 0 22V0L-10 10-4 0-20 0-3-4Z"
          fill="#c8cac4"
          class="pr-detail-fine"
        />
        <path
          d="M0-22V22 M-20 0H20 M-10-10 10 10 M10-10-10 10"
          fill="none"
          stroke="#080909"
          stroke-width=".9"
          class="pr-detail-micro"
        />
      </g>
      {/* Streamlined spiral blade engraving: 9 primary curves + 8 fine LOD curves (reduced from 26 redundant paths) */}
      <g id="ca2-spiral-blade">
        <path
          d="M0-318A318 318 0 0 1 186.92-257.27C317-165 212 36 88.99 64.66A110 110 0 0 0 110 0C180-95 180-310 0-318Z"
          fill="#030504"
        />
        <g fill="none" stroke="#f4f4ef" stroke-width="1.2">
          <path d="M12-317.8C189-300 182-87 109.8 4.6" />
          <path d="M30-316.6C202-285 186-74 109.3 11.5" />
          <path d="M48-314.4C216-270 189-61 108.4 18.3" />
          <path d="M66-311.1C229-255 192-48 107.1 25.1" />
          <path d="M84-306.7C243-240 196-35 105.3 31.8" />
          <path d="M102-301.2C256-225 199-22 103.1 38.4" />
          <path d="M120-294.4C270-210 202-9 100.5 44.8" />
          <path d="M138-286.5C283-195 206 4 97.5 51.1" />
          <path d="M156-277.1C297-180 209 17 94.1 57.1" />
        </g>
        <g fill="none" stroke="#f4f4ef" stroke-width="1.05" class="pr-detail-fine">
          <path d="M21-317.3C196-292 184-80 109.6 8" />
          <path d="M39-315.6C209-277 187-67 108.9 14.9" />
          <path d="M57-312.8C222-262 190-54 107.8 21.7" />
          <path d="M75-309C236-247 194-41 106.2 28.4" />
          <path d="M93-304.1C249-232 197-28 104.2 35.1" />
          <path d="M111-298C263-217 200-15 101.8 41.6" />
          <path d="M129-290.6C276-202 204-2 99 47.9" />
          <path d="M147-282C290-187 207 11 95.8 54.1" />
        </g>
        <path d="M0-318C180-310 180-95 110 0" fill="none" stroke="#fff" stroke-width="3.2" />
        <path d="M3-317C183-309 183-94 112 0" fill="none" stroke="#a7a9a3" stroke-width=".7" class="pr-detail-micro" />
      </g>
      <clipPath id="ca2-lens-clip">
        <ellipse cx="0" cy="0" rx="69" ry="105" />
      </clipPath>
      <clipPath id="ca2-iris-clip">
        <circle r="318" />
      </clipPath>
    </defs>

    <g id="engraved-metal-body" transform="translate(518 489) rotate(-26) scale(.97 1.06)">
      <g id="thick-rear-edge" transform="translate(-27 14)">
        <circle r="448" fill="#090b0a" stroke="#050706" stroke-width="5" />
        <circle r="443" fill="url(#ca2-edge-engraving)" stroke="#e1e2dd" stroke-width="1.8" />
        <circle r="426" fill="#0a0b0a" stroke="#030504" stroke-width="3" />
        <path d="M-440-66A445 445 0 0 1-217-387" fill="none" stroke="#f4f4ef" stroke-width="1.2" />
        <path d="M-445 10A445 445 0 0 0-90 435" fill="none" stroke="#b5b7b1" stroke-width="1.5" />
        <path d="M145 419A443 443 0 0 0 430 95" fill="none" stroke="#f5f5ef" stroke-width="1.1" />
      </g>

      <g id="outer-machined-bezel">
        <circle r="441" fill="#fcfcfa" stroke="#050706" stroke-width="5" />
        <circle r="435.5" fill="none" stroke="#333632" stroke-width="1" class="pr-detail-micro" />
        <circle r="429" fill="none" stroke="#080a09" stroke-width="3" />
        <circle r="421.5" fill="none" stroke="#080a09" stroke-width="13" stroke-dasharray="2.4 3.55" />
        <circle r="415" fill="none" stroke="#0c0e0c" stroke-width="1.7" />
        <circle
          r="406"
          fill="none"
          stroke="#30332f"
          stroke-width="5"
          stroke-dasharray="1.3 24.2"
          class="pr-detail-fine"
        />
        <circle r="379" fill="none" stroke="#090b09" stroke-width="2.6" />
        <circle
          r="351"
          fill="none"
          stroke="#0a0d0a"
          stroke-width="5.7"
          stroke-dasharray=".1 16.1"
          stroke-linecap="round"
          class="pr-detail-fine"
        />
        <circle r="338" fill="none" stroke="#080a08" stroke-width="2.1" />
        <g id="graduated-index-lines">
          <use href="#ca2-radial-mark-quadrant" />
          <use href="#ca2-radial-mark-quadrant" transform="rotate(90)" />
          <use href="#ca2-radial-mark-quadrant" transform="rotate(180)" />
          <use href="#ca2-radial-mark-quadrant" transform="rotate(270)" />
        </g>
        <g id="inner-knurled-border">
          <circle r="330.5" fill="none" stroke="#0b0d0b" stroke-width="13" />
          <circle
            r="330.5"
            fill="none"
            stroke="#f8f8f4"
            stroke-width="13"
            stroke-dasharray="1.8 2.3"
            class="pr-detail-fine"
          />
          <circle r="333.5" fill="none" stroke="#080a08" stroke-width="1.7" />
          <circle r="329" fill="none" stroke="#0b0d0a" stroke-width="1.1" class="pr-detail-micro" />
          <circle r="323" fill="none" stroke="#0b0d0a" stroke-width="1.9" />
          <circle r="320" fill="#050706" stroke="#f8f8f4" stroke-width="3.1" />
        </g>
      </g>

      <g clip-path="url(#ca2-iris-clip)">
        <g id="iris-diaphragm">
          <use href="#ca2-spiral-blade" transform="rotate(-6)" />
          <use href="#ca2-spiral-blade" transform="rotate(30)" />
          <use href="#ca2-spiral-blade" transform="rotate(66)" />
          <use href="#ca2-spiral-blade" transform="rotate(102)" />
          <use href="#ca2-spiral-blade" transform="rotate(138)" />
          <use href="#ca2-spiral-blade" transform="rotate(174)" />
          <use href="#ca2-spiral-blade" transform="rotate(210)" />
          <use href="#ca2-spiral-blade" transform="rotate(246)" />
          <use href="#ca2-spiral-blade" transform="rotate(282)" />
          <use href="#ca2-spiral-blade" transform="rotate(318)" />
          <circle r="317.8" fill="none" stroke="#fff" stroke-width="2" />
          <circle r="315.4" fill="none" stroke="#161915" stroke-width="1" class="pr-detail-micro" />
        </g>
      </g>

      <g id="bezel-symbols">
        <use href="#ca2-round-ring-stud" transform="translate(-116 -360)" />
        <use href="#ca2-round-ring-stud" transform="translate(304 -226)" />
        <use href="#ca2-round-ring-stud" transform="translate(163 342)" />
        <use href="#ca2-round-ring-stud" transform="translate(-352 140)" />
        <use href="#ca2-small-ring-rivet" transform="translate(-272 -264)" />
        <use href="#ca2-small-ring-rivet" transform="translate(-35 -377)" />
        <use href="#ca2-small-ring-rivet" transform="translate(365 -102)" />
        <use href="#ca2-small-ring-rivet" transform="translate(273 263)" />
        <use href="#ca2-small-ring-rivet" transform="translate(34 377)" />
        <use href="#ca2-compass-star" transform="translate(166 -340) rotate(26)" />
        <use href="#ca2-compass-star" transform="translate(340 166) rotate(26)" />
        <use href="#ca2-compass-star" transform="translate(-166 340) rotate(26)" />
        <use href="#ca2-compass-star" transform="translate(-340 -166) rotate(26)" />
      </g>
    </g>

    <g id="central-optical-aperture" transform="translate(529 472) rotate(-23)">
      <ellipse rx="108" ry="134" fill="#030504" stroke="#f8f8f4" stroke-width="3.5" />
      <ellipse rx="100" ry="127" fill="none" stroke="#7c8079" stroke-width="1.1" />
      <ellipse rx="94" ry="120" fill="#030504" stroke="#edede7" stroke-width="1.8" />
      <ellipse cx="-4" cy="1" rx="83" ry="113" fill="#080a08" stroke="#777c73" stroke-width="1" />
      <g transform="translate(-7 0)">
        <ellipse rx="69" ry="105" fill="url(#ca2-glass-shading)" stroke="#8e9488" stroke-width="1" />
        <g clip-path="url(#ca2-lens-clip)">
          <g transform="rotate(23)">
            <rect x="-140" y="-150" width="280" height="300" fill="url(#ca2-glass-etching)" class="pr-detail-fine" />
            <path
              d="M37-102C52-95 66-77 70-56L73 49C69 65 62 72 55 66 43 56 41 31 38 8 31-24 27-66 29-88Z"
              fill="#fff"
            />
            <path d="M34-83C37-72 38-64 40-59" fill="none" stroke="#fff" stroke-width="4" />
          </g>
        </g>
        <ellipse rx="69" ry="105" fill="none" stroke="#0a0d09" stroke-width="2.2" />
      </g>
      <g id="lens-rim-reflections" fill="#fff">
        <path d="M36-101C56-88 71-65 78-34L64-39C61-63 51-85 36-101Z" />
        <path d="M80 2C81 18 78 34 72 47L60 37C64 25 66 13 66 1Z" />
        <path d="M67 52 62 64 52 73 58 56Z" fill="#bfc3b9" />
        <path d="M24-110 33-106 40-100 33-102Z" fill="#c5c8c0" />
      </g>
      <path d="M-73-76C-100-30-93 42-65 78" fill="none" stroke="#c3c7bd" stroke-width=".9" class="pr-detail-fine" />
      <path d="M-60 97C-21 133 33 122 62 88" fill="none" stroke="#f8f8f1" stroke-width="1.1" />
    </g>
  </svg>
)

export const cinemaAstrolabe02: HomeFigure = {
  id: "cinema-astrolabe-02",
  shape: "square",
  idleSpeed: 4.5,
  detentDeg: 8.5,
  sound: SOUND,
  frame: {
    viewBox: "-189 -162 1388 1348",
    cx: FRAME_CX,
    cy: FRAME_CY,
    r: 530,
    outerR: 588,
    cornerX: 608,
    cornerY: 592,
    axisX: [564, 638],
    axisY: [564, 634],
  },
  ExtraHairline,
  Artwork,
  createRig: (svg, hairline) => {
    const indexLines = svg.querySelector<SVGGElement>("#graduated-index-lines")
    const knurledBorder = svg.querySelector<SVGGElement>("#inner-knurled-border")
    const bezelSymbols = svg.querySelector<SVGGElement>("#bezel-symbols")
    const irisDiaphragm = svg.querySelector<SVGGElement>("#iris-diaphragm")
    const rimReflections = svg.querySelector<SVGGElement>("#lens-rim-reflections")
    const ecliptic = hairline.querySelector<SVGEllipseElement>(".hl-ecliptic")
    const meridian = hairline.querySelector<SVGEllipseElement>(".hl-meridian")

    return {
      apply: (s, dirty) => {
        // Children of #engraved-metal-body rotate around local (0, 0) in true -26° oblique perspective
        const indexAngle = s.theta * 0.4 + s.dial * 0.7
        if (indexLines && dirty("index", indexAngle, 0.03)) {
          indexLines.setAttribute("transform", `rotate(${indexAngle.toFixed(2)})`)
        }

        const knurlAngle = s.theta * 0.65
        if (knurledBorder && dirty("knurl", knurlAngle, 0.04)) {
          knurledBorder.setAttribute("transform", `rotate(${knurlAngle.toFixed(2)})`)
        }

        const symbolsAngle = -s.theta * 0.28
        if (bezelSymbols && dirty("symbols", symbolsAngle, 0.03)) {
          bezelSymbols.setAttribute("transform", `rotate(${symbolsAngle.toFixed(2)})`)
        }

        const irisRot = s.theta * 0.22 + s.iris * 18
        if (irisDiaphragm && (dirty("irisRot", irisRot, 0.03) || dirty("irisScale", s.iris, 0.002))) {
          const sc = 1 + s.iris * 0.04
          irisDiaphragm.setAttribute("transform", `rotate(${irisRot.toFixed(2)}) scale(${sc.toFixed(4)})`)
        }

        if (rimReflections && (dirty("reflX", s.px, 0.004) || dirty("reflY", s.py, 0.004))) {
          rimReflections.setAttribute("transform", `translate(${(s.px * 5).toFixed(2)} ${(s.py * 4).toFixed(2)})`)
        }

        const dash = (s.theta * 1.9) % 34
        if (dirty("eclipticDash", dash, 0.15)) {
          if (ecliptic) ecliptic.style.strokeDashoffset = dash.toFixed(1)
          if (meridian) meridian.style.strokeDashoffset = (-dash * 0.8).toFixed(1)
        }
      },
    }
  },
}
