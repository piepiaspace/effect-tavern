// Cosmic Noir 03 — Celestial Mobile: a Calder-inspired kinetic astronomical sculpture with
// hierarchical coupled-pendulum physics (main balance arm → crescent/Saturn/vermilion sub-branches).
// Base vector generated via Rikyū (QuiverAI), decomposed into Anatomy sub-assemblies and rigged to HomeMechanism.
import type { HomeFigure } from "../home-figure.tsx"
import type { SoundProfile } from "../home-sound.ts"

const CX = 512
const CY = 490
const ARM_PX = 513.4
const ARM_PY = 156.0

// 05 Celestial Mobile: soft breeze + ethereal C3/G3 pad + polyphony-capped Cmaj9 modal wind chimes
const SOUND: SoundProfile = {
  engine: "chime",
  filter: { baseHz: 5000, rangeHz: 950 },
  room: { wet: 0.46 },
}

const ExtraHairline = () => (
  <>
    <circle cx={CX} cy={CY} r="506" class="hl-belt hl-orbit-inner" stroke-dasharray="2 16" />
    <g class="hl-callout pr-detail-fine">
      <path d="M513.4 -40V0" opacity="0.55" />
    </g>
  </>
)

const Artwork = () => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    class="home-emblem"
    data-brand="noir-celestial-mobile"
    data-themed="true"
    viewBox="0 0 1024 1024"
    fill="none"
    aria-hidden="true"
  >
    {/* Fixed ceiling suspension wire & primary pivot bead */}
    <g id="ncm-top-stem">
      <path d="m513.9 0v156.4" stroke="currentColor" stroke-width="4.667" />
      <circle cx="513.4" cy="121.5" r="17.07" fill="currentColor" />
    </g>

    {/* Hierarchical mobile assembly pivoting at (513.4, 156.0) */}
    <g id="ncm-main-arm">
      <path
        d="m187.8 168.8c63.1-23.94 175-28.67 319.1-13.31 123.9 13.31 215.3 35.71 259.7 61.31"
        stroke="currentColor"
        stroke-width="6.564"
      />
      <circle cx="181.3" cy="171.2" r="9.642" fill="currentColor" />
      <circle cx="776.2" cy="220.5" r="12.27" fill="currentColor" />

      {/* Left hanging branch: crescent moon + 4-point star + sphere counterweight */}
      <g id="ncm-left-branch">
        <path d="m181.4 176.3v70.14" stroke="currentColor" stroke-width="4.667" />
        <circle cx="181.3" cy="254.7" r="10.75" fill="currentColor" />
        <path
          d="m213.9 265.1c-29.95 11.14-52.35 38.4-52.35 72.7 0 39.17 31.36 69.38 67.71 70.66-9.984 3.456-23.42 6.656-36.35 6.656-43.65 0-77.57-33.02-77.57-72.7 0-43.14 40.19-77.31 86.4-77.31h12.16z"
          fill="currentColor"
        />
        <path d="m201.7 413.6v76.8" stroke="currentColor" stroke-width="4.067" />
        <circle cx="201.5" cy="495.4" r="7.479" fill="currentColor" />
        <path
          d="m201.7 500.6c0 49.54 7.04 57.34 46.72 59.9-39.68 1.792-44.8 13.31-44.8 59.52v43.52h-4.096v-43.52c0-46.21-8.192-57.73-46.46-59.52 38.27-2.56 47.1-13.44 47.1-59.9h1.536z"
          fill="currentColor"
        />
        <circle cx="200.6" cy="685.1" r="22.89" fill="currentColor" />
      </g>

      {/* Center hanging branch: half-vermilion ringed Saturn + large lower 4-point star */}
      <g id="ncm-center-branch">
        <path d="m513.5 156.4v174.1" stroke="currentColor" stroke-width="4.667" />
        <circle cx="513.4" cy="341.2" r="13.54" fill="currentColor" />
        <path
          d="m513.7 361.3c-61.7-1.024-113.2 47.74-113.2 112.4 35.97 11.78 72.45 19.33 97.41 23.94-3.2-55.81 2.432-106.1 15.74-136.3z"
          fill="currentColor"
        />
        <path
          d="m514.3 361.3c-15.62 36.61-18.69 92.42-16.51 136.4 41.47 9.472 84.35 14.72 116.7 16.13 4.608-12.16 6.912-25.09 6.912-40.19 0-59.65-48.64-110.7-107.1-112.4z"
          fill="var(--brand)"
        />
        <path
          d="m498.7 518.7c1.536 29.44 7.424 56.45 16.51 71.81 40.45-1.408 75.39-25.34 90.37-56.06-36.99-3.712-74.5-9.856-106.9-15.74z"
          fill="var(--brand)"
        />
        <path
          d="m401 495.9c7.936 55.55 57.09 94.59 114.2 94.59-10.5-21.38-15.23-49.79-16.26-72.58-34.18-7.936-68.35-16-97.92-22.02z"
          fill="currentColor"
        />
        <g id="ncm-saturn-ring">
          <path
            d="m407.2 426.6c-72.06-7.552-124.5-1.536-124.9 14.85-0.896 20.86 79.36 48.9 208.8 74.88 143 30.21 233.3 24.19 234 3.456 0.768-17.92-52.1-37.89-100.1-50.3v7.552c34.43 11.52 55.17 23.3 53.63 32.26-2.688 16.64-83.71 13.18-185.7-6.144-100.5-19.84-157.3-43.14-156.7-56.45 0.384-11.9 33.15-14.21 68.99-13.44l2.048-6.656z"
            fill="currentColor"
          />
        </g>
        <g id="ncm-center-star">
          <path d="m513 588v33.28" stroke="currentColor" stroke-width="4.067" />
          <circle cx="513" cy="629.9" r="10.75" fill="currentColor" />
          <path
            d="m515.1 637.4c-2.56 91.65 6.272 109.7 65.79 111.9-59.52 2.816-64.77 21.38-67.84 97.92-2.176-76.54-10.88-95.74-68.22-97.92 57.34-2.944 67.71-23.17 66.56-111.9h3.712z"
            fill="currentColor"
          />
        </g>
      </g>

      {/* Right hanging branch: vermilion planet → nested S-curve sub-arm → crescent + star */}
      <g id="ncm-right-branch">
        <path d="m776.2 230.7v96.26" stroke="currentColor" stroke-width="4.667" />
        <circle cx="775.6" cy="373.6" r="47.8" fill="var(--brand)" />
        <path d="m776.2 420.5v53.89" stroke="currentColor" stroke-width="4.667" />
        <circle cx="776.3" cy="484.2" r="10.75" fill="currentColor" />

        <g id="ncm-right-sub">
          <path
            d="m783.7 489.2c47.23 6.016 77.31 24.96 77.31 55.3v22.14"
            stroke="currentColor"
            stroke-width="4.667"
          />
          <circle cx="861.2" cy="572.9" r="8.716" fill="currentColor" />
          <path
            d="m845.8 582.5c21.76 9.344 37.5 27.26 37.5 49.15 0 30.98-27.26 55.68-56.32 57.47 7.424 2.432 16.13 3.968 25.09 3.968 35.07 0 62.46-25.98 62.46-57.86 0-31.1-27.52-52.74-59.52-52.74h-9.216z"
            fill="currentColor"
          />
          <path d="m860 691.8v57.98" stroke="currentColor" stroke-width="4.667" />
          <circle cx="860.5" cy="754.6" r="6.892" fill="currentColor" />
          <path
            d="m861.8 758.9c0 40.96 6.912 48.77 38.66 50.69-33.79 2.048-38.14 12.67-38.14 49.92v32.77h-4.864v-32.77c0-37.25-5.632-48.38-40.32-49.92 33.41-1.92 40.83-11.78 40.83-50.69h3.84z"
            fill="currentColor"
          />
          <circle cx="859.5" cy="915.8" r="24.43" fill="currentColor" />
        </g>
      </g>
    </g>
  </svg>
)

export const noirCelestialMobile: HomeFigure = {
  id: "noir-celestial-mobile",
  shape: "square",
  idleSpeed: 5.0,
  detentDeg: 18.0,
  sound: SOUND,
  frame: {
    viewBox: "-140 -120 1304 1264",
    cx: CX,
    cy: CY,
    r: 540,
    outerR: 596,
    cornerX: 592,
    cornerY: 576,
    axisX: [568, 636],
    axisY: [556, 620],
  },
  ExtraHairline,
  Artwork,
  createRig: (svg, hairline) => {
    const mainArm = svg.querySelector<SVGGElement>("#ncm-main-arm")
    const leftBranch = svg.querySelector<SVGGElement>("#ncm-left-branch")
    const centerBranch = svg.querySelector<SVGGElement>("#ncm-center-branch")
    const saturnRing = svg.querySelector<SVGGElement>("#ncm-saturn-ring")
    const centerStar = svg.querySelector<SVGGElement>("#ncm-center-star")
    const rightBranch = svg.querySelector<SVGGElement>("#ncm-right-branch")
    const rightSub = svg.querySelector<SVGGElement>("#ncm-right-sub")
    const orbitInner = hairline.querySelector<SVGCircleElement>(".hl-orbit-inner")

    return {
      apply: (s, dirty) => {
        const rad = (s.theta * Math.PI) / 180
        const breeze = Math.min(4.5, Math.abs(s.vel) * 0.03)

        // Primary Calder balance beam tilt
        const mainTilt = Math.sin(rad * 0.7) * 3.0 + s.px * 5.2 + Math.sin(rad * 1.9) * breeze
        if (mainArm && dirty("main", mainTilt, 0.03)) {
          mainArm.setAttribute("transform", `rotate(${mainTilt.toFixed(2)} ${ARM_PX} ${ARM_PY})`)
        }

        // Coupled gravity-restoring counter-sway on each suspended branch
        const leftSway = -mainTilt * 0.72 + Math.sin(rad * 0.9 + 1.1) * 3.6 + s.py * 2.4
        if (leftBranch && dirty("left", leftSway, 0.03)) {
          leftBranch.setAttribute("transform", `rotate(${leftSway.toFixed(2)} 181.3 171.2)`)
        }

        const centerSway = -mainTilt * 0.52 + Math.sin(rad * 0.65 + 2.3) * 2.1
        if (centerBranch && dirty("center", centerSway, 0.03)) {
          centerBranch.setAttribute("transform", `rotate(${centerSway.toFixed(2)} 513.4 156.4)`)
        }

        const ringTilt = s.py * 4.5 + Math.sin(rad * 1.1) * 1.8
        if (saturnRing && dirty("ring", ringTilt, 0.03)) {
          saturnRing.setAttribute("transform", `rotate(${ringTilt.toFixed(2)} 513 475)`)
        }

        const starSway = Math.sin(rad * 1.15 + 0.5) * 4.2 - s.px * 3.2
        if (centerStar && dirty("star", starSway, 0.03)) {
          centerStar.setAttribute("transform", `rotate(${starSway.toFixed(2)} 513 629.9)`)
        }

        const rightSway = -mainTilt * 0.68 + Math.sin(rad * 0.8 + 0.4) * 3.2
        if (rightBranch && dirty("right", rightSway, 0.03)) {
          rightBranch.setAttribute("transform", `rotate(${rightSway.toFixed(2)} 776.2 220.5)`)
        }

        const subSway = Math.sin(rad * 1.2 + 1.7) * 5.0 + s.px * 4.0 + s.py * 2.2
        if (rightSub && dirty("sub", subSway, 0.03)) {
          rightSub.setAttribute("transform", `rotate(${subSway.toFixed(2)} 776.3 484.2)`)
        }

        const dash = (s.theta * 0.9) % 36
        if (orbitInner && dirty("dash", dash, 0.15)) {
          orbitInner.style.strokeDashoffset = dash.toFixed(1)
        }
      },
      readout: (s) => {
        const tilt = (Math.sin((s.theta * Math.PI) / 180 * 0.7) * 3.0 + s.px * 5.2).toFixed(1)
        const sign = Number(tilt) >= 0 ? "+" : ""
        return `TILT ${sign}${tilt}° · ${(1 + s.iris * 0.3).toFixed(2)}×`
      },
    }
  },
}
