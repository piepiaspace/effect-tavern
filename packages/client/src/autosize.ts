import { createEffect } from "solid-js"

// A textarea that grows with its words where `field-sizing: content` is missing (Safari before 26.2): the CSS rule stays
// the one owner where it holds, and this ref does nothing there. Elsewhere it sizes the box to its content on every
// input and whenever `value` changes from outside (a send clearing it, a draft restored); min-height and max-height in
// the sheet still bound it. Border-box only, as every textarea that uses it is.
export const autosize = (value: () => unknown): ((el: HTMLTextAreaElement) => void) => {
  if (CSS.supports("field-sizing", "content")) return () => {}
  let box: HTMLTextAreaElement | undefined
  const fit = () => {
    if (!box) return
    box.style.height = "auto"
    box.style.height = `${box.scrollHeight + box.offsetHeight - box.clientHeight}px`
  }
  createEffect(value, fit)
  return (el) => {
    box = el
    el.addEventListener("input", fit)
  }
}
