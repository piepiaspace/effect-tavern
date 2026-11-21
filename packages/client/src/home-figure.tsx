// Shared contract and Hairline drafting frame primitive for interactive Home figures.
// Every figure (projector-rosette-*, cinema-astrolabe-*, etc.) plugs into HomeMechanism through this interface:
// - HomeMechanism owns physics, adaptive rAF scheduling, pointer parallax, Web Audio coupling, telemetry, and controls.
import type { JSX } from "@solidjs/web"
import type { SoundProfile } from "./home-sound.ts"
// - Each figure owns only its inline SVG artwork, optional figure-specific blueprint overlays, and its lightweight rig.

export interface StageState {
  /** Primary continuous drive angle in degrees. */
  theta: number
  /** Current angular velocity impulse from composer typing (deg/s). */
  vel: number
  /** Spring-damped normalized pointer X in [-1, 1]. */
  px: number
  /** Spring-damped normalized pointer Y in [-1, 1]. */
  py: number
  /** Spring-damped aperture/focus openness in [0, ~1.25]. */
  iris: number
  /** Spring-damped fine dial counter-tracking angle in degrees. */
  dial: number
  /** Spring-damped pointer azimuth angle for the outer vernier arc in degrees. */
  vernier: number
  hovered: boolean
  focused: boolean
  hasPointer: boolean
}

/** Returns true when `value` changed by more than `eps` since the last recorded update for `key`. */
export type DirtyCheck = (key: string, value: number, eps: number) => boolean

export interface FigureRig {
  /** Mutate this figure's SVG transforms directly on each rendered frame. */
  apply(state: StageState, dirty: DirtyCheck): void
  /** Optional custom telemetry readout (defaults to `${angle}° · ${aperture}×`). */
  readout?(state: StageState): string
}

export interface HairlineSpec {
  /** ViewBox covering the hairline drafting overlay around the figure. */
  viewBox: string
  /** Optical center X in viewBox coordinates. */
  cx: number
  /** Optical center Y in viewBox coordinates. */
  cy: number
  /** Primary dashed calibration ring radius (also where the vernier arc rides). */
  r: number
  /** Outer faint hairline ring radius. */
  outerR: number
  /** Half-span from center to corner registration crosshairs (x, y). */
  cornerX: number
  cornerY: number
  /** Cardinal axis tick inner/outer offsets from center (x, y). */
  axisX: [inner: number, outer: number]
  axisY: [inner: number, outer: number]
}

export interface HomeFigure {
  readonly id: string
  readonly shape: "tall" | "square"
  readonly idleSpeed?: number
  readonly detentDeg?: number
  /** Optional musical theme/timbre profile for this figure (falls back to DEFAULT_SOUND_PROFILE). */
  readonly sound?: SoundProfile
  readonly frame: HairlineSpec
  /** Optional figure-specific blueprint paths rendered inside the shared HairlineFrame SVG. */
  ExtraHairline?: () => JSX.Element
  /** Inline SVG artwork for the figure (must carry class="home-emblem" and data-brand={id}). */
  Artwork: () => JSX.Element
  /** Bind DOM sub-assemblies once mounted and return the per-frame transform applicator. */
  createRig: (artworkSvg: SVGSVGElement, hairlineSvg: SVGSVGElement) => FigureRig
}

/** Shared precision hairline drafting overlay parameterized by a figure's HairlineSpec. */
export const HairlineFrame = (props: {
  spec: HairlineSpec
  ref: (el: SVGSVGElement) => void
  onVernier: (el: SVGGElement) => void
  children?: JSX.Element
}) => {
  const s = () => props.spec
  // Vernier arc spans ±16° around 0° (3 o'clock) on radius r
  const vernierPath = () => {
    const { cx, cy, r } = s()
    const a = (16 * Math.PI) / 180
    const x = cx + r * Math.cos(a)
    const y1 = cy - r * Math.sin(a)
    const y2 = cy + r * Math.sin(a)
    return `M${x.toFixed(1)} ${y1.toFixed(1)} A${r} ${r} 0 0 1 ${x.toFixed(1)} ${y2.toFixed(1)}`
  }

  return (
    <svg ref={props.ref} class="home-hairline-svg" viewBox={s().viewBox} fill="none" aria-hidden="true">
      {/* Outer calibration rings */}
      <circle cx={s().cx} cy={s().cy} r={s().r} class="hl-ring-lo" stroke-dasharray="3 9" />
      <circle cx={s().cx} cy={s().cy} r={s().outerR} class="hl-ring-faint pr-detail-fine" />

      {/* Cardinal architectural axis ticks */}
      <g class="hl-axis">
        <path
          d={`M${s().cx - s().axisX[1]} ${s().cy}H${s().cx - s().axisX[0]} M${s().cx + s().axisX[0]} ${s().cy}H${s().cx + s().axisX[1]}`}
        />
        <path
          d={`M${s().cx - s().axisX[1] + 24} ${s().cy - 8}V${s().cy + 8} M${s().cx + s().axisX[1] - 24} ${s().cy - 8}V${s().cy + 8}`}
        />
        <path
          d={`M${s().cx} ${s().cy - s().axisY[1]}V${s().cy - s().axisY[0]} M${s().cx} ${s().cy + s().axisY[0]}V${s().cy + s().axisY[1]}`}
        />
      </g>

      {/* Corner drafting registration crosshairs */}
      <g class="hl-reg pr-detail-fine">
        <path
          d={`M${s().cx - s().cornerX - 13} ${s().cy - s().cornerY}H${s().cx - s().cornerX + 13} M${s().cx - s().cornerX} ${s().cy - s().cornerY - 13}V${s().cy - s().cornerY + 13}`}
        />
        <path
          d={`M${s().cx + s().cornerX - 13} ${s().cy - s().cornerY}H${s().cx + s().cornerX + 13} M${s().cx + s().cornerX} ${s().cy - s().cornerY - 13}V${s().cy - s().cornerY + 13}`}
        />
        <path
          d={`M${s().cx - s().cornerX - 13} ${s().cy + s().cornerY}H${s().cx - s().cornerX + 13} M${s().cx - s().cornerX} ${s().cy + s().cornerY - 13}V${s().cy + s().cornerY + 13}`}
        />
        <path
          d={`M${s().cx + s().cornerX - 13} ${s().cy + s().cornerY}H${s().cx + s().cornerX + 13} M${s().cx + s().cornerX} ${s().cy + s().cornerY - 13}V${s().cy + s().cornerY + 13}`}
        />
      </g>

      {/* Figure-specific blueprint schematics (e.g. film belts, orbital guides, callouts) */}
      {props.children}

      {/* Pointer-reactive vernier tracking arc */}
      <g ref={props.onVernier} class="hl-vernier">
        <path d={vernierPath()} />
        <circle cx={s().cx + s().r} cy={s().cy} r="4.5" class="hl-vernier-pip" />
        <path d={`M${s().cx + s().r + 9} ${s().cy}H${s().cx + s().r + 25}`} />
      </g>
    </svg>
  )
}
