// Curated registry of 6 interactive Home figures: 4 Cosmic Noir kinetic scenes + 2 refined projector rosettes.
// The default figure (noir-vinyl-cosmos) is loaded synchronously for instant first paint; the remaining 5 are
// dynamically imported on demand so they stay out of the main entry chunk.
import type { HomeFigure } from "../home-figure.tsx"
import { noirVinylCosmos } from "./noir-vinyl-cosmos.tsx"

interface FigureEntry {
  readonly id: string
  readonly load: () => Promise<HomeFigure>
}

export const FIGURE_ENTRIES: readonly FigureEntry[] = [
  { id: noirVinylCosmos.id, load: () => Promise.resolve(noirVinylCosmos) },
  { id: "noir-celestial-mobile", load: () => import("./noir-celestial-mobile.tsx").then((m) => m.noirCelestialMobile) },
  { id: "noir-arch-eclipse", load: () => import("./noir-arch-eclipse.tsx").then((m) => m.noirArchEclipse) },
  { id: "noir-projector-cosmos", load: () => import("./noir-projector-cosmos.tsx").then((m) => m.noirProjectorCosmos) },
  { id: "projector-rosette-04", load: () => import("./projector-rosette-04.tsx").then((m) => m.projectorRosette04) },
  { id: "projector-rosette-03", load: () => import("./projector-rosette-03.tsx").then((m) => m.projectorRosette03) },
]

export const FIGURE_COUNT = FIGURE_ENTRIES.length

export const DEFAULT_FIGURE: HomeFigure = noirVinylCosmos

const cache = new Map<string, HomeFigure>([[noirVinylCosmos.id, noirVinylCosmos]])

/** Synchronously returns a figure if already cached (always defined for the default figure). */
export const peekFigure = (index: number): HomeFigure | undefined => {
  const entry = FIGURE_ENTRIES[index]
  return entry ? cache.get(entry.id) : undefined
}

/** Loads a figure by index, caching its module for instant subsequent switches. */
export const loadFigure = async (index: number): Promise<HomeFigure> => {
  const entry = FIGURE_ENTRIES[index] ?? FIGURE_ENTRIES[0]
  const hit = cache.get(entry.id)
  if (hit) return hit
  const fig = await entry.load()
  cache.set(entry.id, fig)
  return fig
}

const STORAGE_KEY = "tavern.home.figure"

export const loadFigureIndex = (): number => {
  try {
    const saved = localStorage.getItem(STORAGE_KEY)
    if (!saved) return 0
    const idx = FIGURE_ENTRIES.findIndex((f) => f.id === saved)
    return idx >= 0 ? idx : 0
  } catch {
    return 0
  }
}

export const saveFigureId = (id: string): void => {
  try {
    localStorage.setItem(STORAGE_KEY, id)
  } catch {
    // ignore private-mode storage errors
  }
}
