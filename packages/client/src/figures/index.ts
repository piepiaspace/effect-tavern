// Registry of all 8 interactive Home mechanical figures, alternating Projector Rosettes and Cinema Astrolabes.
// The default figure (projector-rosette-04) is loaded synchronously for instant first paint; the remaining 7 are
// dynamically imported on demand so they stay out of the main entry chunk.
import type { HomeFigure } from "../home-figure.tsx"
import { projectorRosette04 } from "./projector-rosette-04.tsx"

interface FigureEntry {
  readonly id: string
  readonly load: () => Promise<HomeFigure>
}

export const FIGURE_ENTRIES: readonly FigureEntry[] = [
  { id: projectorRosette04.id, load: () => Promise.resolve(projectorRosette04) },
  { id: "cinema-astrolabe-01", load: () => import("./cinema-astrolabe-01.tsx").then((m) => m.cinemaAstrolabe01) },
  { id: "projector-rosette-01", load: () => import("./projector-rosette-01.tsx").then((m) => m.projectorRosette01) },
  { id: "cinema-astrolabe-02", load: () => import("./cinema-astrolabe-02.tsx").then((m) => m.cinemaAstrolabe02) },
  { id: "projector-rosette-02", load: () => import("./projector-rosette-02.tsx").then((m) => m.projectorRosette02) },
  { id: "cinema-astrolabe-03", load: () => import("./cinema-astrolabe-03.tsx").then((m) => m.cinemaAstrolabe03) },
  { id: "projector-rosette-03", load: () => import("./projector-rosette-03.tsx").then((m) => m.projectorRosette03) },
  { id: "cinema-astrolabe-04", load: () => import("./cinema-astrolabe-04.tsx").then((m) => m.cinemaAstrolabe04) },
]

export const FIGURE_COUNT = FIGURE_ENTRIES.length

export const DEFAULT_FIGURE: HomeFigure = projectorRosette04

const cache = new Map<string, HomeFigure>([[projectorRosette04.id, projectorRosette04]])

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
