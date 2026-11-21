import { createSignal } from "solid-js"
import * as Atom from "./atom.ts"
import { openSource } from "./pages.ts"
import { registry } from "./store.ts"

export type Section = "providers" | "routing" | "templates" | "personas" | "packs" | "cards"
/** The section shown: written by every way in, so the settings layer moves to the section asked for. */
export const section = Atom.make<Section>("providers").pipe(Atom.keepAlive)
export const [pane, setPane] = createSignal<"list" | "detail">("list")
export const pickedAtom = Atom.make<Partial<Record<Section, string>>>({}).pipe(Atom.keepAlive)
/** The settings layer on a section, 模型服务 when none is named: a missing model opens it on 默认模型 (the draft's
 *  error, the card page); Back or Escape returns to the page that opened it. Optional `id` pre-selects a record. */
export const openSettings = (at: Section = "providers", id?: string) => {
  setPane(id ? "detail" : "list")
  registry.set(section, at)
  if (id) registry.update(pickedAtom, (p) => ({ ...p, [at]: id }))
  openSource("settings")
}
