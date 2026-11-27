// Cosmic Noir 04 — Vinyl Cosmos: a midnight-jazz celestial turntable whose vinyl grooves are
// concentric star-orbits dotted with a crescent moon and sparkles, tracked by an architectural tonearm.
// Base vector generated via Rikyū (QuiverAI), decomposed into Anatomy sub-assemblies and rigged to HomeMechanism.
import type { HomeFigure } from "../home-figure.tsx"
import type { SoundProfile } from "../home-sound.ts"

const CX = 501
const CY = 515
const PIVOT_X = 890
const PIVOT_Y = 172

// 06 Vinyl Cosmos: authentic vinyl hiss/rumble/crackle + 74 BPM late-night Rhodes jazz progression
const SOUND: SoundProfile = {
  engine: "vinyl",
  filter: { baseHz: 4400, rangeHz: 850 },
  room: { wet: 0.42 },
}

const ExtraHairline = () => (
  <>
    <circle cx={CX} cy={CY} r="438" class="hl-belt hl-orbit-inner" stroke-dasharray="5 13" />
    <circle cx={PIVOT_X} cy={PIVOT_Y} r="108" class="hl-ring-faint pr-detail-fine" stroke-dasharray="3 9" />
  </>
)

const Artwork = () => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    class="home-emblem"
    data-brand="noir-vinyl-cosmos"
    data-themed="true"
    viewBox="0 0 1024 1024"
    fill="none"
    aria-hidden="true"
  >
    {/* Rotating celestial vinyl platter */}
    <g id="nvc-platter">
      <circle cx={CX} cy={CY} r="404" fill="currentColor" />
      <circle cx="501.3" cy="514.9" r="126.9" fill="var(--brand)" stroke="var(--surface-1)" stroke-width="4.424" />
      <circle cx="500.7" cy="515.7" r="19.38" fill="currentColor" />
      <circle cx="500.7" cy="515.7" r="6.129" fill="var(--surface-1)" />
      <path
        d="m586.2 171.1c-28.93-6.4-58.62-9.344-87.42-9.344-183.2 0-363 144.4-363 355.5 0 214.8 162.8 359.3 358.4 359.3 216.2 0 367.5-169.7 367.5-361.2 0-47.49-8.576-96.64-27.39-135.7"
        stroke="var(--surface-1)"
        stroke-width="1.932"
      />
      <path d="m814 351.1c-65.02-118.9-180.5-172.7-219.6-176.6" stroke="var(--surface-1)" stroke-width="1.932" />
      <path d="m443.9 197.1c-76.42 11.78-146.2 50.69-194 99.2" stroke="var(--surface-1)" stroke-width="1.932" />
      <path d="m246.9 301.3c-48.38 50.82-75.01 124.3-77.18 202.1" stroke="var(--surface-1)" stroke-width="1.932" />
      <path d="m169.2 506.2c-3.2 125.4 59.26 229.9 144.5 281.7" stroke="var(--surface-1)" stroke-width="1.932" />
      <path d="m332.4 797.3c48.77 28.29 109.3 41.6 161.4 42.75" stroke="var(--surface-1)" stroke-width="1.932" />
      <path
        d="m497.9 839.9c173.8 1.664 332.9-127.1 332.9-314.5 0-7.168 0.128-9.088 0.128-10.37"
        stroke="var(--surface-1)"
        stroke-width="1.932"
      />
      <path d="m831.4 515.6c0-31.87-5.632-68.1-13.95-93.57" stroke="var(--surface-1)" stroke-width="1.932" />
      <path d="m798.8 389.1c-19.71-44.67-51.07-68.86-52.48-74.24" stroke="var(--surface-1)" stroke-width="1.932" />
      <path
        d="m703.7 301.2c-58.62-52.1-134.4-77.82-199.3-77.82-49.02 0-93.44 13.06-124.5 34.82"
        stroke="var(--surface-1)"
        stroke-width="1.641"
      />
      <path
        d="m301.8 294.3c-59.78 49.66-94.59 133.2-94.59 221.7 0 50.56 11.52 100.4 31.87 135.8"
        stroke="var(--surface-1)"
        stroke-width="1.932"
      />
      <path
        d="m247.2 664.6c52.22 95.1 165 137.3 261.6 137.3 169 0 283.4-110.8 284.7-280.4 0-19.46 14.85 2.56 0 0 0.64-16 11.52-7.552 3.328-50.82"
        stroke="var(--surface-1)"
        stroke-width="1.932"
      />
      <path d="m782 437.2c-14.21-55.94-45.82-106.6-77.18-134.5" stroke="var(--surface-1)" stroke-width="1.932" />
      <path
        d="m399.2 283.6c32-16.64 72.32-23.68 111.6-23.68 139.9 0 238.8 105.3 242.4 242.4"
        stroke="var(--surface-1)"
        stroke-width="1.641"
      />
      <path d="m311.6 333.8c-35.97 33.28-55.81 84.74-61.57 124.7" stroke="var(--surface-1)" stroke-width="1.641" />
      <path
        d="m246.4 471.3c-1.28 12.16-1.408 29.18-1.408 41.34 0 151.2 116.1 253.3 256.9 253.3 128.1 0 226.2-70.02 256.5-159.5"
        stroke="var(--surface-1)"
        stroke-width="1.932"
      />
      <path
        d="m625.5 700.7c-41.22 19.46-86.91 29.57-129.8 29.57-126.2 0-219.8-100.6-219.8-217.7 0-62.46 24.06-123.6 60.8-156.5"
        stroke="var(--surface-1)"
        stroke-width="1.932"
      />
      <path d="m681.9 378.5c18.3 23.94 28.93 54.27 33.41 80.51" stroke="var(--surface-1)" stroke-width="1.641" />
      <path d="m718 470.7c4.736 31.1 3.712 63.49-1.28 91.01" stroke="var(--surface-1)" stroke-width="1.932" />
      <path
        d="m411.4 315.9c25.98-17.28 59.01-23.55 91.52-23.55 61.18 0 121 24.32 153 62.34"
        stroke="var(--surface-1)"
        stroke-width="1.641"
      />
      <path d="m486.9 323.7c-57.09 5.76-111.6 37.12-138.5 78.34" stroke="var(--surface-1)" stroke-width="1.932" />
      <path
        d="m338 412.4c-18.94 28.54-28.93 65.92-28.93 101 0 91.65 65.41 161 135.2 176.6"
        stroke="var(--surface-1)"
        stroke-width="1.932"
      />
      <path
        d="m454 693.1c14.34 2.56 29.82 3.584 43.65 3.584 114 0 191.4-79.1 191.4-185.1 0-116.2-95.36-194.2-201.5-188.7"
        stroke="var(--surface-1)"
        stroke-width="1.932"
      />
      <path d="m345 471.2c13.31-10.62-0.256-0.256 0 0z" stroke="var(--surface-1)" stroke-width="1.932" />
      <path d="m344.7 471.3c-13.82-0.896-42.88-2.048-61.95-0.512" stroke="currentColor" stroke-width=".966" />
      <path d="m654.5 529c4.864 3.328 2.432 1.792 0 0z" stroke="var(--surface-1)" stroke-width="1.932" />
      <path d="m754.6 605.8c11.52 2.176 22.91 3.584 31.23 4.352" stroke="currentColor" stroke-width=".966" />
      <path d="m344.1 471c4.736 57.86-0.256 63.23 0 0z" stroke="currentColor" stroke-width=".966" />
      <path d="m349.2 400.8c10.62-18.43 8.32-3.456 0 0z" stroke="var(--surface-1)" stroke-width=".966" />
      <path
        d="m347.4 472.1c18.69-66.69 85.89-112.4 156.3-112.4 88.96 0 154.2 68.99 153 155 0 93.95-79.23 150.5-158 150.5-88.19 0-155.3-67.58-154.8-150.5-0.384-14.59 1.024-28.93 3.456-42.88"
        stroke="var(--surface-1)"
        stroke-width="1.932"
      />
      <circle cx="342.9" cy="406.8" r="8.742" fill="var(--surface-1)" />
      <circle cx="155.3" cy="369.6" r="2.715" fill="var(--surface-1)" />
      <circle cx="151.5" cy="476.7" r="2.342" fill="var(--surface-1)" />
      <circle cx="187.4" cy="563.4" r="2.992" fill="var(--surface-1)" />
      <circle cx="134.5" cy="645.6" r="2.542" fill="var(--surface-1)" />
      <circle cx="168.1" cy="710.3" r="2.668" fill="var(--surface-1)" />
      <circle cx="195.6" cy="749.3" r="2.466" fill="var(--surface-1)" />
      <circle cx="270.1" cy="778" r="2.243" fill="var(--surface-1)" />
      <circle cx="322.5" cy="856.5" r="2.418" fill="var(--surface-1)" />
      <circle cx="486" cy="898.1" r="3.186" fill="var(--surface-1)" />
      <circle cx="654.4" cy="863" r="3.361" fill="var(--surface-1)" />
      <circle cx="746" cy="803.9" r="2.342" fill="var(--surface-1)" />
      <circle cx="828.9" cy="700.6" r="2.367" fill="var(--surface-1)" />
      <circle cx="832.8" cy="622.9" r="2.154" fill="var(--surface-1)" />
      <circle cx="818.8" cy="559.2" r="3.217" fill="var(--surface-1)" />
      <circle cx="774.7" cy="317.3" r="2.227" fill="var(--surface-1)" />
      <circle cx="298.4" cy="207" r="2.265" fill="var(--surface-1)" />
      <circle cx="241.4" cy="336.4" r="2.294" fill="var(--surface-1)" />
      <circle cx="197.7" cy="416.4" r="2.542" fill="var(--surface-1)" />
      <circle cx="194.4" cy="440.6" r="2.39" fill="var(--surface-1)" />
      <circle cx="168.9" cy="503.7" r="4.892" fill="var(--surface-1)" />
      <circle cx="175.1" cy="653.9" r="2.329" fill="var(--surface-1)" />
      <circle cx="225.1" cy="733.5" r="2.554" fill="var(--surface-1)" />
      <circle cx="276.8" cy="734.7" r="2.841" fill="var(--surface-1)" />
      <circle cx="323.2" cy="725.3" r="2.464" fill="var(--surface-1)" />
      <circle cx="369.6" cy="791.3" r="2.766" fill="var(--surface-1)" />
      <circle cx="371.4" cy="840.3" r="2.604" fill="var(--surface-1)" />
      <circle cx="494.2" cy="839.8" r="5.179" fill="var(--surface-1)" />
      <circle cx="545.1" cy="784.4" r="3.18" fill="var(--surface-1)" />
      <circle cx="591.3" cy="775" r="2.257" fill="var(--surface-1)" />
      <circle cx="683.3" cy="728.1" r="2.155" fill="var(--surface-1)" />
      <circle cx="781" cy="661.2" r="2.367" fill="var(--surface-1)" />
      <circle cx="808.7" cy="647.2" r="5.229" fill="var(--surface-1)" />
      <circle cx="831.8" cy="517.8" r="5.141" fill="var(--surface-1)" />
      <circle cx="754.9" cy="404" r="2.342" fill="var(--surface-1)" />
      <circle cx="701.3" cy="294.4" r="11.08" fill="var(--surface-1)" />
      <circle cx="636.1" cy="276.3" r="2.992" fill="var(--surface-1)" />
      <circle cx="464.1" cy="210.2" r="2.257" fill="var(--surface-1)" />
      <circle cx="427.9" cy="252.6" r="2.39" fill="var(--surface-1)" />
      <circle cx="445.1" cy="197.1" r="4.129" fill="var(--surface-1)" />
      <circle cx="593.3" cy="172.1" r="8.028" fill="var(--surface-1)" />
      <circle cx="249.5" cy="298.3" r="6.791" fill="var(--surface-1)" />
      <circle cx="241.3" cy="660.1" r="11.95" fill="var(--surface-1)" />
      <circle cx="320.2" cy="793.8" r="13.93" fill="var(--surface-1)" />
      <circle cx="258.6" cy="510.7" r="2.629" fill="var(--surface-1)" />
      <circle cx="246.5" cy="619" r="2.353" fill="var(--surface-1)" />
      <circle cx="305.5" cy="653.1" r="3.243" fill="var(--surface-1)" />
      <circle cx="358.2" cy="706.4" r="2.239" fill="var(--surface-1)" />
      <circle cx="487.8" cy="750.8" r="2.466" fill="var(--surface-1)" />
      <circle cx="568.2" cy="705.7" r="2.342" fill="var(--surface-1)" />
      <circle cx="693.1" cy="668" r="2.195" fill="var(--surface-1)" />
      <circle cx="642.9" cy="610.4" r="1.905" fill="var(--surface-1)" />
      <circle cx="670.7" cy="539.6" r="3.129" fill="var(--surface-1)" />
      <circle cx="716.2" cy="466.8" r="7.167" fill="var(--surface-1)" />
      <circle cx="600.6" cy="370" r="2.916" fill="var(--surface-1)" />
      <circle cx="559.7" cy="350.6" r="2.353" fill="var(--surface-1)" />
      <circle cx="483.3" cy="323.6" r="5.604" fill="var(--surface-1)" />
      <circle cx="404.9" cy="374.5" r="2.668" fill="var(--surface-1)" />
      <circle cx="307.3" cy="423.3" r="2.265" fill="var(--surface-1)" />
      <circle cx="333" cy="492.6" r="3.516" fill="var(--surface-1)" />
      <circle cx="295.6" cy="550.5" r="2.668" fill="var(--surface-1)" />
      <circle cx="351.5" cy="598.8" r="2.39" fill="var(--surface-1)" />
      <circle cx="399.6" cy="653.2" r="3.18" fill="var(--surface-1)" />
      <circle cx="448.3" cy="691.5" r="7.066" fill="var(--surface-1)" />
      <path
        d="m367.2 253.7c-27.26-3.584-51.84 20.35-51.84 47.36 0 24.19 20.1 43.26 41.6 43.26 18.94 0 36.61-13.06 41.98-27.65-6.912 7.808-17.54 12.42-27.52 12.42-19.97 0-34.94-16.26-34.94-35.84 0-19.2 13.44-36.1 30.72-39.55z"
        fill="var(--surface-1)"
      />
      <path
        d="m667.3 341.4c-3.456 23.55-3.584 23.81-19.2 26.88 17.02 3.328 15.87 2.688 19.2 25.34 3.456-23.42 2.304-22.27 19.97-25.34-18.94-3.328-17.54-3.84-19.97-26.88z"
        fill="var(--surface-1)"
      />
      <path
        d="m236.7 440.8c-1.92 22.02-1.664 21.12-16 24.45 15.87 3.584 13.95 2.048 15.62 22.27 3.84-20.35 2.56-20.35 15.87-22.27-14.72-3.072-13.31-6.528-15.49-24.45z"
        fill="var(--surface-1)"
      />
    </g>

    {/* Stylus contact star spark */}
    <g id="nvc-stylus-spark">
      <path
        d="m639.6 655.5c-4.096 34.43-3.456 31.87-29.82 37.12 27.9 5.376 25.09 2.56 29.44 32.9 5.12-29.82 1.536-29.18 30.85-32.9-28.67-6.016-25.34-1.28-30.46-37.12z"
        fill="var(--surface-1)"
      />
    </g>

    {/* Upper-right tonearm base mount */}
    <g id="nvc-mount">
      <circle cx="888" cy="173" r="90" fill="currentColor" />
      <path
        d="m910.5 97.15c-6.144-1.408-13.06-2.048-20.74-2.048-43.01 0-80.13 35.33-80.13 77.06 0 32 20.86 59.14 47.36 68.22"
        stroke="var(--surface-1)"
        stroke-width="3.217"
      />
      <path
        d="m889.6 244.5c41.86 0.768 72.7-34.69 72.7-71.81 0-19.58-7.808-38.27-19.71-49.79"
        stroke="var(--surface-1)"
        stroke-width="3.217"
      />
      <path
        d="m898.3 126.2c-22.78 0-40.58 17.79-40.58 39.04 0 13.7 6.528 25.6 16.9 32.26l5.504-15.62 15.23 5.248 1.536 2.56 1.536 1.152 4.224 6.016 0.256 7.68-2.432 0.64c20.86 0.384 36.61-15.87 36.61-36.99 0-8.448-1.28-14.08-4.608-21.38l-13.7 30.21c-3.2 5.632-10.5 7.552-18.56 5.504-11.65-2.944-18.3-16.51-14.34-25.22l11.65-31.1h0.768z"
        fill="var(--brand)"
      />
    </g>

    {/* Pivoting architectural tonearm & vermilion stylus */}
    <g id="nvc-tonearm">
      <path
        d="m881.4 180.6-146.2 376.4 15.74 7.296 147.7-373.1-17.28-10.62z"
        fill="var(--surface-1)"
        stroke="currentColor"
        stroke-width="2.916"
      />
      <path
        d="m726 557.3c-18.82 21.76-41.6 50.69-59.39 74.24l25.22 14.08 57.22-54.91 5.632-23.55-28.67-9.856z"
        fill="var(--surface-1)"
        stroke="currentColor"
        stroke-width="2.916"
      />
      <circle cx="719.9" cy="592.5" r="8.202" fill="currentColor" />
      <path
        d="m672.6 641.4-16 27.78 7.68 5.888 23.55-26.24-15.23-7.424z"
        fill="var(--brand)"
        stroke="currentColor"
        stroke-width="1.932"
      />
      <path d="m656.5 670-8.704 16.38 16.38-12.16-7.68-4.224z" fill="var(--surface-1)" />
      <circle cx="939.4" cy="82.98" r="7.101" fill="currentColor" />
      <path
        d="m921.3 78.46-32.9 82.56c-2.048 13.44 17.79 22.4 25.22 15.1l34.94-80c13.44-12.29-15.1-28.42-27.26-17.66z"
        fill="var(--surface-1)"
        stroke="currentColor"
        stroke-width="3.912"
      />
      <ellipse
        transform="matrix(.9523 .3052 -.3052 .9523 69.78 -283.1)"
        cx="940.2"
        cy="81.63"
        rx="17.47"
        ry="12.08"
        fill="currentColor"
      />
    </g>

    {/* Floating outer vermilion stars */}
    <g id="nvc-outer-stars">
      <path
        d="m168.3 118.5c-5.76 44.8-3.328 43.52-38.14 49.54 35.71 4.992 33.28 7.04 37.76 44.54 5.888-39.81 2.176-39.04 39.94-44.29-36.22-6.4-33.66-7.168-38.91-49.79h-0.64z"
        fill="var(--brand)"
      />
      <path
        d="m876.9 790c-5.76 48.77-3.712 49.79-42.24 54.91 38.91 4.864 36.86 9.728 41.86 49.28h0.896c4.736-41.22 2.944-43.39 39.3-49.15-38.14-6.528-35.46-9.984-39.04-55.04h-0.768z"
        fill="var(--brand)"
      />
    </g>
  </svg>
)

export const noirVinylCosmos: HomeFigure = {
  id: "noir-vinyl-cosmos",
  shape: "square",
  idleSpeed: 10.0,
  detentDeg: 15.0,
  sound: SOUND,
  frame: {
    viewBox: "-140 -140 1304 1304",
    cx: CX,
    cy: CY,
    r: 528,
    outerR: 586,
    cornerX: 590,
    cornerY: 590,
    axisX: [560, 632],
    axisY: [560, 632],
  },
  ExtraHairline,
  Artwork,
  createRig: (svg, hairline) => {
    const platter = svg.querySelector<SVGGElement>("#nvc-platter")
    const tonearm = svg.querySelector<SVGGElement>("#nvc-tonearm")
    const spark = svg.querySelector<SVGGElement>("#nvc-stylus-spark")
    const outerStars = svg.querySelector<SVGGElement>("#nvc-outer-stars")
    const orbitInner = hairline.querySelector<SVGCircleElement>(".hl-orbit-inner")

    return {
      apply: (s, dirty) => {
        // Smooth 33 1/3 RPM style continuous platter spin
        const spin = s.theta * 0.85
        if (platter && dirty("spin", spin, 0.04)) {
          platter.setAttribute("transform", `rotate(${spin.toFixed(2)} ${CX} ${CY})`)
        }

        // Tonearm subtly tracks groove depth with hover/focus iris + pointer dial
        const armAng = -s.iris * 4.2 + s.px * 2.6 + Math.sin(((s.theta * Math.PI) / 180) * 0.6) * 0.6
        if (tonearm && dirty("arm", armAng, 0.03)) {
          tonearm.setAttribute("transform", `rotate(${armAng.toFixed(2)} ${PIVOT_X} ${PIVOT_Y})`)
        }

        // Stylus spark gently breathes with typing velocity & iris
        const sc = 0.92 + s.iris * 0.24 + Math.min(0.22, Math.abs(s.vel) * 0.002)
        if (spark && dirty("spark", sc, 0.004)) {
          spark.setAttribute("transform", `translate(639.6 692.6) scale(${sc.toFixed(3)}) translate(-639.6 -692.6)`)
        }

        // Outer stars drift gently with pointer parallax
        const ox = s.px * 10
        const oy = s.py * 8
        if (outerStars && (dirty("oX", ox, 0.04) || dirty("oY", oy, 0.04))) {
          outerStars.setAttribute("transform", `translate(${ox.toFixed(2)} ${oy.toFixed(2)})`)
        }

        const dash = (s.theta * 1.3) % 36
        if (orbitInner && dirty("dash", dash, 0.15)) {
          orbitInner.style.strokeDashoffset = dash.toFixed(1)
        }
      },
      readout: (s) => {
        const rpm = (33.3 + Math.min(12, Math.abs(s.vel) * 0.04)).toFixed(1)
        const deg = (((s.theta * 0.85) % 360) + 360) % 360
        return `${rpm} RPM · ${deg.toFixed(1).padStart(5, "0")}°`
      },
    }
  },
}
