// Cinema Astrolabe 01 figure definition: a high-contrast obsidian circular astrolabe medallion with concentric
// orbital rings, eight tethered orbital nodes, four cardinal compass stars, dual counter-rotating graduation scales,
// a twelve-blade curved aperture iris, and a pointer-reactive central optical lens.
import type { HomeFigure } from "../home-figure.tsx"
import type { SoundProfile } from "../home-sound.ts"

// Optical centers from the source geometry
const OUTER_CX = 511
const OUTER_CY = 503
const IRIS_CX = 511
const IRIS_CY = 498

// Celestial Eb maj9 celesta identity (Eb4, F4, G4, Bb4, C5, Eb5, F5, G5, Bb5 — always-consonant pentatonic)
const SOUND: SoundProfile = {
  scale: [311.13, 349.23, 392.0, 466.16, 523.25, 622.25, 698.46, 783.99, 932.33],
  motif: [0, 2, 5, 3, 6, 5, 4, 2, 3, 5, 7, 5],
  wave: "triangle",
  overtone: { ratio: 2, level: 0.2, decayRatio: 0.52 },
  tap: { startHz: 320, endHz: 150, level: 0.14 },
  filter: { baseHz: 2700, rangeHz: 750 },
  echo: { delaySec: 0.38, feedback: 0.3, wet: 0.32 },
  decay: { base: 0.62, accent: 0.88 },
  accents: {
    beats: [0, 4, 8],
    irisOpen: 7,
    irisClose: 3,
    hover: [5, 7],
    click: 5,
    engage: [2, 5],
  },
}

const ExtraHairline = () => (
  <>
    {/* Counter-drifting celestial orbital reference rings */}
    <circle cx={OUTER_CX} cy={OUTER_CY} r="498" class="hl-belt hl-orbit-inner" stroke-dasharray="6 14" />
    <circle cx={OUTER_CX} cy={OUTER_CY} r="558" class="hl-belt hl-orbit-outer" stroke-dasharray="3 18" />
    {/* Diagonal 45-degree celestial azimuth sightlines & transit nodes */}
    <g class="hl-callout pr-detail-fine">
      <path d="M126 118L154 146 M896 118L868 146 M126 888L154 860 M896 888L868 860" />
      <circle cx="122" cy="114" r="3.5" />
      <circle cx="900" cy="114" r="3.5" />
      <circle cx="122" cy="892" r="3.5" />
      <circle cx="900" cy="892" r="3.5" />
    </g>
  </>
)

const Artwork = () => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    class="home-emblem"
    data-brand="cinema-astrolabe-01"
    viewBox="0 0 1024 1018"
    aria-hidden="true"
  >
    <defs>
      <g id="ca1-outer-graduation-sector" fill="none" stroke="#fff" stroke-width="3">
        <path d="M511 126V151" stroke-width="5" />
        <path d="M511 127V143" transform="rotate(2.5 511 503)" class="pr-detail-micro" />
        <path d="M511 127V143" transform="rotate(5 511 503)" class="pr-detail-fine" />
        <path d="M511 127V143" transform="rotate(7.5 511 503)" class="pr-detail-micro" />
        <path d="M511 127V143" transform="rotate(10 511 503)" class="pr-detail-fine" />
        <path d="M511 127V143" transform="rotate(12.5 511 503)" class="pr-detail-micro" />
        <path d="M511 127V146" transform="rotate(15 511 503)" />
        <path d="M511 127V143" transform="rotate(17.5 511 503)" class="pr-detail-micro" />
        <path d="M511 127V143" transform="rotate(20 511 503)" class="pr-detail-fine" />
        <path d="M511 127V143" transform="rotate(22.5 511 503)" class="pr-detail-micro" />
        <path d="M511 127V143" transform="rotate(25 511 503)" class="pr-detail-fine" />
        <path d="M511 127V143" transform="rotate(27.5 511 503)" class="pr-detail-micro" />
      </g>
      <g id="ca1-inner-graduation-sector" fill="none" stroke="#fff" stroke-width="4">
        <path d="M511 157V198" stroke-width="7" />
        <path d="M511 179V196" transform="rotate(3.5 511 503)" class="pr-detail-micro" />
        <path d="M511 179V196" transform="rotate(7 511 503)" class="pr-detail-fine" />
        <path d="M511 179V196" transform="rotate(10.5 511 503)" class="pr-detail-micro" />
        <path d="M511 179V196" transform="rotate(14 511 503)" class="pr-detail-fine" />
        <path d="M511 179V196" transform="rotate(17.5 511 503)" class="pr-detail-micro" />
        <path d="M511 179V196" transform="rotate(21 511 503)" class="pr-detail-fine" />
        <path d="M511 179V196" transform="rotate(24.5 511 503)" class="pr-detail-micro" />
      </g>
      <path
        id="ca1-aperture-blade-seam"
        d="M519 228C474 277 417 392 399 480"
        fill="none"
        stroke="#fff"
        stroke-width="6"
        stroke-linejoin="round"
      />
      <path id="ca1-cardinal-star" d="M512 43L519 70L544 79L519 86L512 112L505 86L480 79L505 71Z" fill="#fff" />
      <g id="ca1-orbital-marker">
        <path d="M278 149L298 182" fill="none" stroke="#fff" stroke-width="1" opacity=".65" class="pr-detail-fine" />
        <circle cx="278" cy="149" r="10.2" fill="#fff" />
      </g>
      <clipPath id="ca1-iris-clip">
        <ellipse cx="511" cy="498" rx="272" ry="270" />
      </clipPath>
    </defs>

    <g id="black-medallion">
      <ellipse cx="511.5" cy="504.5" rx="470" ry="471.5" fill="#020303" />
    </g>

    <g id="outer-orbital-rings" fill="none" stroke="#fff">
      <ellipse cx="511.5" cy="504" rx="446.5" ry="447.5" stroke-width="3.5" />
      <ellipse cx="511.5" cy="503" rx="422" ry="423" stroke-width="3.5" />
      <circle cx="511" cy="503" r="387" stroke-width="10" />
      <circle cx="511" cy="503" r="347" stroke-width="4" />
    </g>

    <g id="orbital-dots">
      <use href="#ca1-orbital-marker" />
      <g transform="translate(1023 0) scale(-1 1)">
        <use href="#ca1-orbital-marker" />
      </g>
      <g transform="translate(0 1004) scale(1 -1)">
        <use href="#ca1-orbital-marker" />
      </g>
      <g transform="translate(1023 1004) scale(-1 -1)">
        <use href="#ca1-orbital-marker" />
      </g>
      <g fill="#fff" stroke="#fff">
        <path
          d="M137 299L116 289M885 300L906 289M137 704L116 716M884 703L905 715"
          fill="none"
          stroke-width="1"
          opacity=".7"
          class="pr-detail-fine"
        />
        <circle cx="137" cy="299" r="10" />
        <circle cx="885" cy="300" r="10" />
        <circle cx="137" cy="704" r="10" />
        <circle cx="884" cy="703" r="10" />
      </g>
    </g>

    <g id="four-compass-stars">
      <use href="#ca1-cardinal-star" />
      <path d="M88 473L96 495L120 503L96 511L88 536L81 511L58 503L81 495Z" fill="#fff" />
      <path d="M933 471L941 495L966 503L941 511L933 537L926 511L902 503L926 495Z" fill="#fff" />
      <path d="M512 891L520 916L545 924L520 932L512 959L504 932L480 924L504 917Z" fill="#fff" />
    </g>

    <g id="outer-fine-scale">
      <use href="#ca1-outer-graduation-sector" />
      <use href="#ca1-outer-graduation-sector" transform="rotate(30 511 503)" />
      <use href="#ca1-outer-graduation-sector" transform="rotate(60 511 503)" />
      <use href="#ca1-outer-graduation-sector" transform="rotate(90 511 503)" />
      <use href="#ca1-outer-graduation-sector" transform="rotate(120 511 503)" />
      <use href="#ca1-outer-graduation-sector" transform="rotate(150 511 503)" />
      <use href="#ca1-outer-graduation-sector" transform="rotate(180 511 503)" />
      <use href="#ca1-outer-graduation-sector" transform="rotate(210 511 503)" />
      <use href="#ca1-outer-graduation-sector" transform="rotate(240 511 503)" />
      <use href="#ca1-outer-graduation-sector" transform="rotate(270 511 503)" />
      <use href="#ca1-outer-graduation-sector" transform="rotate(300 511 503)" />
      <use href="#ca1-outer-graduation-sector" transform="rotate(330 511 503)" />
    </g>

    <g id="inner-bold-scale">
      <use href="#ca1-inner-graduation-sector" />
      <use href="#ca1-inner-graduation-sector" transform="rotate(30 511 503)" />
      <use href="#ca1-inner-graduation-sector" transform="rotate(60 511 503)" />
      <use href="#ca1-inner-graduation-sector" transform="rotate(90 511 503)" />
      <use href="#ca1-inner-graduation-sector" transform="rotate(120 511 503)" />
      <use href="#ca1-inner-graduation-sector" transform="rotate(150 511 503)" />
      <use href="#ca1-inner-graduation-sector" transform="rotate(180 511 503)" />
      <use href="#ca1-inner-graduation-sector" transform="rotate(210 511 503)" />
      <use href="#ca1-inner-graduation-sector" transform="rotate(240 511 503)" />
      <use href="#ca1-inner-graduation-sector" transform="rotate(270 511 503)" />
      <use href="#ca1-inner-graduation-sector" transform="rotate(300 511 503)" />
      <use href="#ca1-inner-graduation-sector" transform="rotate(330 511 503)" />
    </g>

    <g id="aperture-surround" fill="none" stroke="#fff">
      <ellipse cx="511" cy="498" rx="295" ry="293" stroke-width="10" />
      <ellipse cx="511" cy="498" rx="272" ry="270" stroke-width="8" />
    </g>

    <g clip-path="url(#ca1-iris-clip)">
      <g id="twelve-curved-aperture-blades">
        <use href="#ca1-aperture-blade-seam" />
        <use href="#ca1-aperture-blade-seam" transform="rotate(30 511 498)" />
        <use href="#ca1-aperture-blade-seam" transform="rotate(60 511 498)" />
        <use href="#ca1-aperture-blade-seam" transform="rotate(90 511 498)" />
        <use href="#ca1-aperture-blade-seam" transform="rotate(120 511 498)" />
        <use href="#ca1-aperture-blade-seam" transform="rotate(150 511 498)" />
        <use href="#ca1-aperture-blade-seam" transform="rotate(180 511 498)" />
        <use href="#ca1-aperture-blade-seam" transform="rotate(210 511 498)" />
        <use href="#ca1-aperture-blade-seam" transform="rotate(240 511 498)" />
        <use href="#ca1-aperture-blade-seam" transform="rotate(270 511 498)" />
        <use href="#ca1-aperture-blade-seam" transform="rotate(300 511 498)" />
        <use href="#ca1-aperture-blade-seam" transform="rotate(330 511 498)" />
      </g>
    </g>

    <g id="central-lens">
      <ellipse cx="510.5" cy="497" rx="112" ry="110" fill="#020303" stroke="#fff" stroke-width="6" />
      <g id="central-lens-glint">
        <ellipse cx="462.5" cy="459" rx="49" ry="19" transform="rotate(-42 462.5 459)" fill="#fff" />
      </g>
    </g>
  </svg>
)

export const cinemaAstrolabe01: HomeFigure = {
  id: "cinema-astrolabe-01",
  shape: "square",
  idleSpeed: 4.8,
  detentDeg: 8.0,
  sound: SOUND,
  frame: {
    viewBox: "-178 -161 1380 1340",
    cx: OUTER_CX,
    cy: OUTER_CY,
    r: 528,
    outerR: 586,
    cornerX: 604,
    cornerY: 590,
    axisX: [562, 636],
    axisY: [562, 632],
  },
  ExtraHairline,
  Artwork,
  createRig: (svg, hairline) => {
    const orbitalDots = svg.querySelector<SVGGElement>("#orbital-dots")
    const compassStars = svg.querySelector<SVGGElement>("#four-compass-stars")
    const outerScale = svg.querySelector<SVGGElement>("#outer-fine-scale")
    const innerScale = svg.querySelector<SVGGElement>("#inner-bold-scale")
    const irisBlades = svg.querySelector<SVGGElement>("#twelve-curved-aperture-blades")
    const lensGlint = svg.querySelector<SVGGElement>("#central-lens-glint")
    const orbitInner = hairline.querySelector<SVGCircleElement>(".hl-orbit-inner")
    const orbitOuter = hairline.querySelector<SVGCircleElement>(".hl-orbit-outer")

    return {
      apply: (s, dirty) => {
        const dotsAngle = s.theta * 0.45
        if (orbitalDots && dirty("dots", dotsAngle, 0.03)) {
          orbitalDots.setAttribute("transform", `rotate(${dotsAngle.toFixed(2)} ${OUTER_CX} ${OUTER_CY})`)
        }

        const starsAngle = -s.theta * 0.18 + s.dial * 0.65
        if (compassStars && dirty("stars", starsAngle, 0.03)) {
          compassStars.setAttribute("transform", `rotate(${starsAngle.toFixed(2)} ${OUTER_CX} ${OUTER_CY})`)
        }

        const outerAngle = s.theta * 0.35 + s.dial * 0.8
        if (outerScale && dirty("outerScale", outerAngle, 0.03)) {
          outerScale.setAttribute("transform", `rotate(${outerAngle.toFixed(2)} ${OUTER_CX} ${OUTER_CY})`)
        }

        const innerAngle = -s.theta * 0.6 - s.dial * 0.5
        if (innerScale && dirty("innerScale", innerAngle, 0.03)) {
          innerScale.setAttribute("transform", `rotate(${innerAngle.toFixed(2)} ${OUTER_CX} ${OUTER_CY})`)
        }

        if (irisBlades && dirty("iris", s.iris, 0.002)) {
          const sc = 1 + s.iris * 0.045
          const rot = s.iris * 14
          irisBlades.setAttribute(
            "transform",
            `translate(${IRIS_CX} ${IRIS_CY}) rotate(${rot.toFixed(2)}) scale(${sc.toFixed(4)}) translate(${-IRIS_CX} ${-IRIS_CY})`,
          )
        }

        if (lensGlint && (dirty("glintX", s.px, 0.004) || dirty("glintY", s.py, 0.004))) {
          lensGlint.setAttribute("transform", `translate(${(s.px * 7).toFixed(2)} ${(s.py * 5).toFixed(2)})`)
        }

        const dash = (s.theta * 1.8) % 42
        if (dirty("orbitDash", dash, 0.15)) {
          if (orbitInner) orbitInner.style.strokeDashoffset = dash.toFixed(1)
          if (orbitOuter) orbitOuter.style.strokeDashoffset = (-dash * 0.75).toFixed(1)
        }
      },
    }
  },
}
