// The one terminal surface, shared by the CLI and the server's log: a screen, display widths, and failures in plain
// words (explain.ts, block.ts).
export { block, cells, failure } from "./block.ts"
export { codes, isServerCode, type Code, type Facts, type ServerCode, type Table, type Words } from "./codes.ts"
export { explain, factsOf, troubleOf, words, type Lang, type Trouble } from "./explain.ts"
export { memoryScreen, stderrScreen, type Screen } from "./screen.ts"
export { clip, width, wrap, wrapKept } from "./width.ts"
