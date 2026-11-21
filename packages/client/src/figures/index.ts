// Registry of interactive Home mechanical figures. Add new adapted brand figures here to make them selectable on Home.
import type { HomeFigure } from "../home-figure.tsx"
import { projectorRosette04 } from "./projector-rosette-04.tsx"

export const HOME_FIGURES: readonly HomeFigure[] = [projectorRosette04]

export const DEFAULT_FIGURE: HomeFigure = projectorRosette04
