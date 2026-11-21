// Registry of all 8 interactive Home mechanical figures, alternating Projector Rosettes and Cinema Astrolabes
// so stepping left/right gives a fresh silhouette and musical key on every switch.
import type { HomeFigure } from "../home-figure.tsx"
import { cinemaAstrolabe01 } from "./cinema-astrolabe-01.tsx"
import { cinemaAstrolabe02 } from "./cinema-astrolabe-02.tsx"
import { cinemaAstrolabe03 } from "./cinema-astrolabe-03.tsx"
import { cinemaAstrolabe04 } from "./cinema-astrolabe-04.tsx"
import { projectorRosette01 } from "./projector-rosette-01.tsx"
import { projectorRosette02 } from "./projector-rosette-02.tsx"
import { projectorRosette03 } from "./projector-rosette-03.tsx"
import { projectorRosette04 } from "./projector-rosette-04.tsx"

export const HOME_FIGURES: readonly HomeFigure[] = [
  projectorRosette04,
  cinemaAstrolabe01,
  projectorRosette01,
  cinemaAstrolabe02,
  projectorRosette02,
  cinemaAstrolabe03,
  projectorRosette03,
  cinemaAstrolabe04,
]

export const DEFAULT_FIGURE: HomeFigure = projectorRosette04

const STORAGE_KEY = "tavern.home.figure"

export const loadFigureIndex = (): number => {
  try {
    const saved = localStorage.getItem(STORAGE_KEY)
    if (!saved) return 0
    const idx = HOME_FIGURES.findIndex((f) => f.id === saved)
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
