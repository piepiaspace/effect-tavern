// One draft travels through sending, revision, failure recovery and story switching.
import type { InvocationToken, PlayerCatalogItem } from "@effect-tavern/runtime/src/projection.ts"
export interface DraftModel {
  text: string
  note: string
  invocations: readonly InvocationToken[]
  noteOpen: boolean
}
export const emptyDraft = (): DraftModel => ({ text: "", note: "", invocations: [], noteOpen: false })
export const hasDraft = (d: DraftModel): boolean => !!(d.text || d.note || d.invocations.length)
export const removeInvocation = (d: DraftModel, resourceId: string): DraftModel => ({
  ...d,
  invocations: d.invocations.filter((i) => i.resourceId !== resourceId),
})
export const addInvocation = (d: DraftModel, token: InvocationToken): DraftModel =>
  d.invocations.some((i) => i.resourceId === token.resourceId)
    ? d
    : {
        ...d,
        invocations: [...d.invocations, { resourceId: token.resourceId, title: token.title, source: token.source }],
      }
/** Native textarea keeps composition/selection semantics; tokens precede its first character. */
export const backspaceInvocation = (d: DraftModel, start: number, end: number, composing: boolean): DraftModel =>
  !composing && start === 0 && end === 0 && d.invocations.length ? { ...d, invocations: d.invocations.slice(0, -1) } : d

export const availableInvocations = (items: readonly PlayerCatalogItem[], selected: readonly InvocationToken[]) =>
  items.filter((item) => item.available && !selected.some((s) => s.resourceId === item.resourceId))
