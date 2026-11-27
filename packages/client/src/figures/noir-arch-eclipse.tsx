// Cosmic Noir 02 — Arch Eclipse: Effect Tavern's architectural doorway framing a live interactive
// solar/lunar eclipse, tilted orbital ellipses, constellation sightlines, and five suspended plumb stars.
// Base vector generated via Rikyū (QuiverAI), decomposed into Anatomy sub-assemblies and rigged to HomeMechanism.
import type { HomeFigure } from "../home-figure.tsx"
import type { SoundProfile } from "../home-sound.ts"

const CX = 512
const CY = 480
const ECLIPSE_CX = 511.8
const ECLIPSE_CY = 383.0

// 04 Arch Eclipse: slow-breathing observatory singing-bowl drone + solemn suspended pendant bells
const SOUND: SoundProfile = {
  engine: "eclipse",
  filter: { baseHz: 4600, rangeHz: 900 },
  room: { wet: 0.48 },
}

const ExtraHairline = () => (
  <>
    <circle cx={ECLIPSE_CX} cy={ECLIPSE_CY} r="285" class="hl-belt hl-orbit-inner" stroke-dasharray="3 12" />
    <g class="hl-callout pr-detail-fine">
      <path d="M512 40V66 M244 794H94 M780 794H930" opacity="0.45" />
    </g>
  </>
)

const Artwork = () => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    class="home-emblem"
    data-brand="noir-arch-eclipse"
    data-themed="true"
    viewBox="0 0 1024 1024"
    fill="none"
    aria-hidden="true"
  >
    {/* Threshold floor shadow & warm vermilion light spill */}
    <g id="nae-floor">
      <path
        d="m292.9 783.7c-49.28 30.08-199.6 146.3-199.6 146.3h829.7s-146.7-120.1-193.5-146.3h-436.6z"
        fill="currentColor"
      />
      <path id="nae-spill" d="m460.2 783.7-222 146.3h539.9l-214.7-146.3h-103.3z" fill="var(--brand)" />
    </g>

    {/* Architectural semicircular archway */}
    <g id="nae-arch" fill="currentColor">
      <path d="m243.6 330.5h25.09v463.6h-25.34l0.256-463.6z" />
      <path d="m272.5 331.4 14.85 0.384 2.432 450.7-16.77 9.088-0.512-460.2z" />
      <path d="m780.7 330.6h-26.37v463.5h28.16l-1.792-463.5z" />
      <path d="m750.3 331.1-14.34 0.384-2.176 450.7 16.51 9.6v-460.7z" />
      <path d="m512.4 66.3c-146.6 0-268 115.1-268 259.2h42.88v-6.016c0-119.8 105.2-210.9 225.2-210.9 119.8 0 224.4 91.14 224.4 210.9v6.016h43.65c0-144.1-121.3-259.2-268-259.2z" />
    </g>

    {/* Dashed constellation sightlines & vertical center axis */}
    <g id="nae-sightlines" stroke="var(--brand)">
      <path d="m362.4 394.6 134.3 296.1" stroke-dasharray="5.5 7.3" stroke-width="2.15" />
      <path d="m650.9 415.6-124.8 275.1" stroke-dasharray="5.5 7.3" stroke-width="2.15" />
      <circle cx="433" cy="548.6" r="5.7" fill="var(--brand)" stroke="none" />
      <circle cx="590.2" cy="548.6" r="5.7" fill="var(--brand)" stroke="none" />
      <path d="m512.1 67.2v67.46 M512.1 138v14.21 M512.1 217.5v8.448 M512.1 224.3v64.51" stroke-width="2.0" />
      <path d="m511.6 505.3v45.44 M511.6 565.4v74.37 M511.6 646.9v32.26 M511.6 732.9v50.82" stroke-width="2.0" />
      <circle cx="512.2" cy="137.1" r="5.7" fill="var(--brand)" stroke="none" />
      <circle cx="512.1" cy="230.9" r="8.1" fill="var(--brand)" stroke="none" />
      <circle cx="511.7" cy="558.3" r="9.3" fill="var(--brand)" stroke="none" />
      <circle cx="511.5" cy="644.4" r="5.7" fill="var(--brand)" stroke="none" />
      <path
        d="m512.6 150.7c0 14.59 9.344 22.91 20.61 23.68v0.512c-12.29 1.408-20.1 9.6-20.61 22.4h-1.024c-0.256-13.18-9.344-21.89-19.71-22.27v-0.768c11.01-1.408 20.74-10.5 20.74-23.55z"
        fill="var(--brand)"
        stroke="none"
      />
      <path
        d="m512.3 678.8c0.768 17.41 13.31 26.88 27.9 27.39v0.64c-16.38 1.792-27.14 11.9-27.78 27.65h-1.536c-0.768-16.64-12.42-27.01-26.75-27.65v-0.768c15.74-1.408 27.01-12.8 26.75-27.26h1.408z"
        fill="var(--brand)"
        stroke="none"
      />
    </g>

    {/* Hanging pendulum stars on arch flanks */}
    <g id="nae-pend-far-left">
      <path d="m321.9 144.1v404 M322.9 554.1v36.74" stroke="var(--brand)" stroke-width="1.9" />
      <circle cx="323" cy="550.3" r="5.7" fill="var(--brand)" />
      <path
        d="m323.1 590c0 14.21 10.62 24.06 23.81 24.96v0.64c-13.18 1.024-21.76 9.6-22.91 23.94h-0.896c-1.152-14.34-10.88-23.3-23.55-23.94v-0.64c12.8-0.896 23.55-11.14 23.55-24.96z"
        fill="var(--brand)"
      />
    </g>
    <g id="nae-pend-mid-left">
      <path d="m370.2 153.7v74.88 M370 234.6v24.83" stroke="var(--brand)" stroke-width="1.9" />
      <circle cx="370.2" cy="232.2" r="5.7" fill="var(--brand)" />
      <path
        d="m370.8 258c0 13.18 8.96 20.99 19.97 22.02v0.384c-11.78 1.408-19.2 8.704-20.1 21.89h-0.64c-1.28-13.18-9.984-21.38-21.25-22.02v-0.512c11.78-1.152 22.02-9.6 22.02-21.76z"
        fill="var(--brand)"
      />
    </g>
    <g id="nae-pend-right">
      <path d="m654.3 154.5v254.6 M700.9 144.1v425.3 M700.4 577.4v22.14" stroke="var(--brand)" stroke-width="1.9" />
      <circle cx="700.3" cy="574" r="5.8" fill="var(--brand)" />
      <path
        d="m700.8 597c0 15.36 10.37 24.06 22.02 24.96v0.512c-13.18 1.408-21.38 10.5-22.02 23.94h-0.896c-0.512-14.34-10.62-23.55-23.42-24.06v-0.512c13.06-1.28 24.32-11.01 24.32-24.83z"
        fill="var(--brand)"
      />
    </g>

    {/* Vermilion corona + interactive eclipsing dark moon */}
    <g id="nae-corona">
      <circle cx={ECLIPSE_CX} cy={ECLIPSE_CY} r="122.7" fill="var(--brand)" />
    </g>
    <g id="nae-moon">
      <circle cx={ECLIPSE_CX} cy={ECLIPSE_CY} r="94.5" fill="currentColor" />
    </g>

    {/* Tilted celestial orbital ellipses & orbital nodes */}
    <g id="nae-orbits">
      <path
        d="m568.1 272c54.02-19.33 104.2-25.73 116.4-10.75 18.43 22.02-32.38 67.33-135.4 119-107.9 54.02-212.1 85.38-227.5 63.62-14.59-20.61 34.69-66.69 109.2-108.3"
        stroke="var(--brand)"
        stroke-width="2.9"
      />
      <path
        d="m598.8 345.1c59.26 36.22 97.92 71.94 92.93 94.85-6.016 27.78-61.44 37.25-133.6 26.88"
        stroke="var(--brand)"
        stroke-width="2.9"
      />
      <circle cx="337.3" cy="451.3" r="8.0" fill="var(--brand)" />
      <circle cx="669.9" cy="301.9" r="8.2" fill="var(--brand)" />
    </g>
  </svg>
)

export const noirArchEclipse: HomeFigure = {
  id: "noir-arch-eclipse",
  shape: "square",
  idleSpeed: 4.2,
  detentDeg: 12.0,
  sound: SOUND,
  frame: {
    viewBox: "-140 -140 1304 1304",
    cx: CX,
    cy: CY,
    r: 530,
    outerR: 586,
    cornerX: 590,
    cornerY: 590,
    axisX: [560, 632],
    axisY: [560, 632],
  },
  ExtraHairline,
  Artwork,
  createRig: (svg, hairline) => {
    const corona = svg.querySelector<SVGGElement>("#nae-corona")
    const moon = svg.querySelector<SVGGElement>("#nae-moon")
    const orbits = svg.querySelector<SVGGElement>("#nae-orbits")
    const pendFL = svg.querySelector<SVGGElement>("#nae-pend-far-left")
    const pendML = svg.querySelector<SVGGElement>("#nae-pend-mid-left")
    const pendR = svg.querySelector<SVGGElement>("#nae-pend-right")
    const spill = svg.querySelector<SVGPathElement>("#nae-spill")
    const orbitInner = hairline.querySelector<SVGCircleElement>(".hl-orbit-inner")

    return {
      apply: (s, dirty) => {
        const rad = (s.theta * Math.PI) / 180

        // Live eclipse offset driven by pointer parallax + gentle celestial drift
        const ex = s.px * 24 + Math.cos(rad * 0.6) * 6
        const ey = s.py * 18 + Math.sin(rad * 0.6) * 5
        if (moon && (dirty("eX", ex, 0.04) || dirty("eY", ey, 0.04))) {
          moon.setAttribute("transform", `translate(${ex.toFixed(2)} ${ey.toFixed(2)})`)
        }

        // Subtle corona breathing with hover/focus iris
        const cScale = 1 + s.iris * 0.055 + Math.sin(rad * 0.9) * 0.012
        if (corona && dirty("cScale", cScale, 0.001)) {
          corona.setAttribute(
            "transform",
            `translate(${ECLIPSE_CX} ${ECLIPSE_CY}) scale(${cScale.toFixed(4)}) translate(${-ECLIPSE_CX} ${-ECLIPSE_CY})`,
          )
        }

        // Orbital ellipse gentle rock
        const oRot = Math.sin(rad * 0.5) * 4.5 + s.dial * 0.35
        if (orbits && dirty("oRot", oRot, 0.03)) {
          orbits.setAttribute("transform", `rotate(${oRot.toFixed(2)} ${ECLIPSE_CX} ${ECLIPSE_CY})`)
        }

        // Pendulum star sway from arch suspension points
        const fl = Math.sin(rad * 0.8 + 0.4) * 2.2 + s.px * 3.0
        if (pendFL && dirty("fl", fl, 0.03)) pendFL.setAttribute("transform", `rotate(${fl.toFixed(2)} 322 144)`)

        const ml = Math.sin(rad * 0.95 + 1.8) * 3.0 + s.px * 3.8
        if (pendML && dirty("ml", ml, 0.03)) pendML.setAttribute("transform", `rotate(${ml.toFixed(2)} 370 154)`)

        const pr = Math.sin(rad * 0.75 + 2.9) * 2.0 + s.px * 2.6
        if (pendR && dirty("pr", pr, 0.03)) pendR.setAttribute("transform", `rotate(${pr.toFixed(2)} 701 144)`)

        if (spill && dirty("spill", s.iris, 0.005)) {
          spill.style.opacity = (0.84 + s.iris * 0.16).toFixed(3)
        }

        const dash = (s.theta * 1.1) % 30
        if (orbitInner && dirty("dash", dash, 0.15)) {
          orbitInner.style.strokeDashoffset = dash.toFixed(1)
        }
      },
      readout: (s) => {
        const cov = Math.max(0, Math.min(100, Math.round(92 - Math.hypot(s.px, s.py) * 34)))
        return `ECLIPSE ${cov}% · ${(1 + s.iris * 0.35).toFixed(2)}×`
      },
    }
  },
}
