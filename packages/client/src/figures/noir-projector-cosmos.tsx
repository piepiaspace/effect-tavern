// Cosmic Noir 01 — Projector Cosmos: a vintage silhouette projector casting a diagonal cosmic beam
// holding a half-lit ringed planet, an eclipsed vermilion companion moon, and plumb-line stars.
// Base vector generated via Rikyū (QuiverAI), decomposed into Anatomy sub-assemblies and rigged to HomeMechanism.
import type { HomeFigure } from "../home-figure.tsx"
import type { SoundProfile } from "../home-sound.ts"

const CX = 512
const CY = 512
const REEL_TOP_CX = 159.2
const REEL_TOP_CY = 570.7
const REEL_BOT_CX = 98.4
const REEL_BOT_CY = 687.5
const PLANET_CX = 691
const PLANET_CY = 529

// 03 16mm Film Projector: 58Hz warm motor hum + gate air hiss + steady 14.5fps celluloid shutter pulse
const SOUND: SoundProfile = {
  engine: "projector",
  filter: { baseHz: 4200, rangeHz: 800 },
  room: { wet: 0.36 },
}

const ExtraHairline = () => (
  <>
    <circle cx={PLANET_CX} cy={PLANET_CY} r="360" class="hl-belt hl-orbit-inner" stroke-dasharray="4 14" />
    <g class="hl-callout pr-detail-fine">
      <path d="M322 652L975 57 M336 664L975 808" opacity="0.35" />
    </g>
  </>
)

const Artwork = () => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    class="home-emblem"
    data-brand="noir-projector-cosmos"
    data-themed="true"
    viewBox="0 0 1024 1024"
    fill="none"
    aria-hidden="true"
  >
    <defs>
      <clipPath id="npc-beam-clip">
        <path d="m975.2 56.7c-14.34 8.192-34.56 21.63-54.91 35.46l-391.7 259.6c-88.45 59.14-165.2 118.9-193.5 151.7l36.74 71.55-51.2 48.26c9.344 10.62 14.59 24.96 15.49 37.76l639.1 147.5v-751.7z" />
      </clipPath>
    </defs>

    {/* Diagonal cosmic projection beam */}
    <g id="npc-beam">
      <path
        d="m975.2 56.7c-14.34 8.192-34.56 21.63-54.91 35.46l-391.7 259.6c-88.45 59.14-165.2 118.9-193.5 151.7l36.74 71.55-51.2 48.26c9.344 10.62 14.59 24.96 15.49 37.76l639.1 147.5v-751.7z"
        fill="currentColor"
      />
    </g>

    {/* Celestial scene clipped cleanly to the projection beam */}
    <g clip-path="url(#npc-beam-clip)">
      <g id="npc-stars" fill="var(--surface-1)">
        <circle cx="831.9" cy="207.9" r="4.513" />
        <circle cx="735.4" cy="258.9" r="6.45" />
        <circle cx="653.8" cy="322.3" r="3.113" />
        <circle cx="445.6" cy="457" r="4.85" />
        <circle cx="378.2" cy="510.4" r="4.012" />
        <circle cx="490" cy="516.4" r="3.025" />
        <circle cx="873.9" cy="554.5" r="3.263" />
        <circle cx="834.4" cy="622.4" r="5.463" />
        <circle cx="785.4" cy="690.6" r="3.075" />
        <circle cx="681.1" cy="717.7" r="3.025" />
        <circle cx="886.2" cy="722.5" r="6.45" />
        <circle cx="513.3" cy="660.4" r="3.738" />
      </g>

      {/* Suspended plumb-line stars */}
      <g id="npc-plumb-left">
        <path
          d="m528 352.1-1.024 0.768c0.128 73.86 1.664 70.14-28.54 73.6 28.29 2.432 26.62 3.712 29.95 42.88 3.328-40.19 2.048-40.06 30.98-42.88-29.82-2.688-28.8-4.736-29.31-63.49l-0.384-10.37-1.664-0.512z"
          fill="var(--surface-1)"
        />
      </g>
      <g id="npc-plumb-right">
        <path
          d="m919.7 92.8-2.432 3.584v466.9c0 38.02-3.584 41.22-33.66 43.78 32.13 3.072 32 3.712 35.2 47.87 3.072-44.93 2.176-45.06 35.2-47.87-30.72-2.944-32.51-4.864-32.51-45.82l-1.792-468.5z"
          fill="var(--surface-1)"
        />
      </g>

      {/* Half-lit ringed Saturn planet */}
      <g id="npc-planet">
        <path
          d="m690.9 391.4c-77.06 0-138.9 62.34-140.8 135.2-82.69 30.98-162.3 79.74-207.5 117.4 78.72-11.52 163.1-25.86 223.6-40.19 19.07 34.3 57.22 57.34 97.79 62.85 7.808 2.048 16.26 3.072 24.7 3.072 73.73 0 130.2-62.34 130.2-136.7 0-4.352-0.128-8.704-0.512-12.8 83.2-36.48 140.4-75.52 140.4-90.24 0-22.78-96.77-6.4-163.6 14.98-21.38-32.9-59.65-53.5-104.3-53.5z"
          fill="var(--surface-1)"
        />
        <path
          d="m736.1 400c-67.33-2.176-116.9 81.54-110 163.6 73.98-19.2 168.7-55.55 198.4-70.66 23.81-12.29 36.61-25.6 36.61-31.87 0-10.37-33.41-7.296-58.37-2.176l-1.152-2.56c44.93-15.1 92.03-18.69 92.03-6.4 0 32.9-265.7 140.3-412.9 149.2-14.34 0.256-18.43-3.456-18.43-8.32 0-14.34 55.94-40.32 87.55-54.4l-0.128-2.944c-69.12 28.29-114.3 55.94-114.3 67.97 0 6.784 10.24 8.704 21.38 8.704 146.9-6.4 461.6-128.3 461.6-166.7 0-19.2-65.79-6.656-120.6 7.168l-2.688-4.224c8.96 16.13 15.36 32 17.66 46.72l-1.92 0.768c-7.424-46.34-37.12-81.66-74.75-93.95z"
          fill="currentColor"
        />
        <path
          d="m550.5 540.4c-31.87 15.23-52.61 30.08-52.61 37.25 0 10.62 33.41 6.784 58.37 1.536-3.84-13.7-5.632-26.37-5.76-38.78z"
          fill="currentColor"
        />
        <path
          d="m816.4 521.9c-62.46 29.31-131.3 52.35-188.7 65.79 2.304 33.28 18.69 64 39.42 77.44 71.55 15.87 154.8-47.23 149.2-143.2z"
          fill="currentColor"
        />
      </g>

      {/* Vermilion eclipsed companion moon */}
      <g id="npc-moon">
        <circle cx="813.6" cy="355.2" r="41.25" fill="var(--brand)" />
        <path
          d="m815.9 316.7c11.9 7.168 18.69 20.22 18.69 34.94 0 20.35-13.18 37.38-27.78 42.24 24.32 4.864 46.59-13.06 46.59-39.42 0-22.4-18.56-38.4-37.5-37.76z"
          fill="currentColor"
        />
      </g>
    </g>

    {/* Vintage cinema projector body & lens */}
    <g id="npc-projector">
      <path d="m315.8 624.1-35.2 22.78v36.86l35.2 20.99c-3.2-27.9-3.2-55.94 0-80.64z" fill="currentColor" />
      <g id="npc-lens-glow">
        <path
          d="m319.2 631.9c-3.84 19.33-2.816 46.72 0.256 63.74 15.23-15.23 15.49-51.33-0.256-63.74z"
          fill="var(--brand)"
        />
      </g>
      {/* Main projector chassis & pedestal */}
      <path
        d="m264.1 636h-104.2v155.5h43.39v10.24h-74.24v-9.856h-33.41v-51.84l14.98-0.896c15.36-10.11 28.42-32 28.42-54.27 0-9.728-1.28-16.9-3.712-23.42h23.17v-25.45h105.6z"
        fill="currentColor"
      />
      <rect x="266.5" y="648.9" width="10.79" height="31.03" fill="currentColor" />
      <path d="m132.4 807.2-27.01 36.48h164.6l-27.65-36.61c-35.84-1.024-74.24-1.024-110 0.128z" fill="currentColor" />
      <circle cx="214.1" cy="715.3" r="8.638" fill="var(--surface-1)" />
      <g fill="var(--surface-1)" opacity="0.45">
        <rect x="127.5" y="747" width="56.1" height="4.201" />
        <rect x="127.5" y="760.6" width="56.1" height="4.201" />
        <rect x="127.5" y="773.7" width="57.13" height="5.783" />
      </g>

      {/* Upper spinning film reel */}
      <g id="npc-reel-top">
        <circle cx={REEL_TOP_CX} cy={REEL_TOP_CY} r="71.4" fill="currentColor" />
        <circle cx="140.3" cy="604.5" r="17.3" fill="var(--surface-1)" />
        <circle cx="120.8" cy="561.8" r="17.3" fill="var(--surface-1)" />
        <circle cx="151.6" cy="532.5" r="17.3" fill="var(--surface-1)" />
        <circle cx="194.7" cy="555.5" r="17.15" fill="var(--surface-1)" />
        <circle cx={REEL_TOP_CX} cy={REEL_TOP_CY} r="7.1" fill="var(--surface-1)" />
      </g>

      {/* Lower spinning film reel */}
      <g id="npc-reel-bot">
        <circle cx={REEL_BOT_CX} cy={REEL_BOT_CY} r="55.2" fill="currentColor" />
        <circle cx="93.25" cy="659.9" r="15.01" fill="var(--surface-1)" />
        <ellipse cx="127.5" cy="684" rx="12.2" ry="15.4" fill="var(--surface-1)" />
        <circle cx="74.8" cy="696.9" r="14.6" fill="var(--surface-1)" />
        <circle cx="105.1" cy="718.5" r="13.0" fill="var(--surface-1)" />
        <circle cx={REEL_BOT_CX} cy={REEL_BOT_CY} r="6.2" fill="var(--surface-1)" />
      </g>
    </g>
  </svg>
)

export const noirProjectorCosmos: HomeFigure = {
  id: "noir-projector-cosmos",
  shape: "square",
  idleSpeed: 6.5,
  detentDeg: 15.0,
  sound: SOUND,
  frame: {
    viewBox: "-140 -140 1304 1304",
    cx: CX,
    cy: CY,
    r: 545,
    outerR: 600,
    cornerX: 590,
    cornerY: 590,
    axisX: [570, 636],
    axisY: [570, 636],
  },
  ExtraHairline,
  Artwork,
  createRig: (svg, hairline) => {
    const reelTop = svg.querySelector<SVGGElement>("#npc-reel-top")
    const reelBot = svg.querySelector<SVGGElement>("#npc-reel-bot")
    const lensGlow = svg.querySelector<SVGGElement>("#npc-lens-glow")
    const planet = svg.querySelector<SVGGElement>("#npc-planet")
    const moon = svg.querySelector<SVGGElement>("#npc-moon")
    const stars = svg.querySelector<SVGGElement>("#npc-stars")
    const plumbL = svg.querySelector<SVGGElement>("#npc-plumb-left")
    const plumbR = svg.querySelector<SVGGElement>("#npc-plumb-right")
    const orbitInner = hairline.querySelector<SVGCircleElement>(".hl-orbit-inner")

    return {
      apply: (s, dirty) => {
        const topAng = s.theta * 1.6
        if (reelTop && dirty("reelTop", topAng, 0.05)) {
          reelTop.setAttribute("transform", `rotate(${topAng.toFixed(2)} ${REEL_TOP_CX} ${REEL_TOP_CY})`)
        }

        const botAng = s.theta * 2.15
        if (reelBot && dirty("reelBot", botAng, 0.05)) {
          reelBot.setAttribute("transform", `rotate(${botAng.toFixed(2)} ${REEL_BOT_CX} ${REEL_BOT_CY})`)
        }

        const rad = (s.theta * Math.PI) / 180
        const px = s.px * 12
        const py = s.py * 9
        const pRock = Math.sin(rad * 0.7) * 2.2 + s.dial * 0.25
        if (planet && (dirty("pX", px, 0.04) || dirty("pY", py, 0.04) || dirty("pR", pRock, 0.03))) {
          planet.setAttribute(
            "transform",
            `translate(${px.toFixed(2)} ${py.toFixed(2)}) rotate(${pRock.toFixed(2)} ${PLANET_CX} ${PLANET_CY})`,
          )
        }

        const mx = s.px * 18 + Math.cos(rad * 0.9) * 8
        const my = s.py * 14 + Math.sin(rad * 0.9) * 6
        if (moon && (dirty("mX", mx, 0.04) || dirty("mY", my, 0.04))) {
          moon.setAttribute("transform", `translate(${mx.toFixed(2)} ${my.toFixed(2)})`)
        }

        const sx = s.px * 5
        const sy = s.py * 4
        if (stars && (dirty("sX", sx, 0.04) || dirty("sY", sy, 0.04))) {
          stars.setAttribute("transform", `translate(${sx.toFixed(2)} ${sy.toFixed(2)})`)
        }

        const swayL = Math.sin(rad * 0.8 + 0.6) * 2.4 + s.px * 3.5
        if (plumbL && dirty("plumbL", swayL, 0.03)) {
          plumbL.setAttribute("transform", `rotate(${swayL.toFixed(2)} 528 352)`)
        }

        const swayR = Math.sin(rad * 0.65 + 2.1) * 1.6 + s.px * 2.2
        if (plumbR && dirty("plumbR", swayR, 0.03)) {
          plumbR.setAttribute("transform", `rotate(${swayR.toFixed(2)} 920 93)`)
        }

        if (lensGlow && dirty("iris", s.iris, 0.005)) {
          lensGlow.style.opacity = (0.82 + s.iris * 0.18).toFixed(3)
        }

        const dash = (s.theta * 1.4) % 36
        if (orbitInner && dirty("dash", dash, 0.15)) {
          orbitInner.style.strokeDashoffset = dash.toFixed(1)
        }
      },
      readout: (s) => {
        const deg = (((Math.round(s.theta) % 360) + 360) % 360).toString().padStart(3, "0")
        return `REEL ${deg}° · ${(1 + s.iris * 0.4).toFixed(2)}×`
      },
    }
  },
}
