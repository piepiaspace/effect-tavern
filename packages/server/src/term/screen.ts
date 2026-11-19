// The one terminal surface's seam: where a person's lines go. The process's stderr (stdout is a command's result and
// nothing else), or a string sink a test reads back. `columns` is read at every paint, so a resized terminal (a phone
// rotated) lays out at its new width.

/** Render untrusted bytes as text; only tabs and newlines lay out the body. */
export const terminalText = (s: string): string =>
  // oxlint-disable-next-line no-control-regex -- terminal control bytes must be visible in untrusted text.
  s.replace(/[\u0000-\u0008\u000b-\u001f\u007f-\u009f]/gu, (c) => `\\x${c.charCodeAt(0).toString(16).padStart(2, "0")}`)

export interface Screen {
  write(s: string): void
  readonly columns: number
  readonly tty?: boolean
  /** May rewrite its last row (a TTY we own). */
  readonly live: boolean
  readonly color: boolean
}

/** A screen on a stream, the one terminal-mode decision every caller shares (the host's stderr, the log preview's
 *  stdout): colour on a TTY only, never under `NO_COLOR` or `TERM=dumb`; live rows only where there is colour (a live
 *  row is redrawn with escapes, so a terminal without them gets none) and unless the caller says otherwise (a guest on
 *  someone else's terminal, Vite's). `columns` overrides the stream's width. */
export const screenOn = (
  stream: { isTTY?: boolean; columns?: number; write(s: string): unknown },
  o: { live?: boolean; columns?: number; env?: Record<string, string | undefined> } = {},
): Screen => {
  const env = o.env ?? Bun.env
  const tty = stream.isTTY === true
  const color = tty && env["TERM"] !== "dumb" && !env["NO_COLOR"]
  return {
    tty,
    write: (s) => void stream.write(s),
    get columns() {
      return o.columns || stream.columns || Number(env["COLUMNS"]) || 80
    },
    live: (o.live ?? true) && color,
    color,
  }
}
export const stderrScreen = (o: { live?: boolean } = {}): Screen => screenOn(process.stderr, o)

/** A screen that keeps what was written, as the rows a terminal would show: a carriage return or an erase-line rewrites
 *  the row in progress, the way a live row is redrawn. */
export const memoryScreen = (o: {
  columns: number
  live?: boolean
  color?: boolean
}): Screen & { shown(): string[] } => {
  const rows: string[] = []
  let row = ""
  return {
    write: (s) => {
      const erased = ["\x1b[K", "\x1b[0K", "\x1b[1K", "\x1b[2K"].reduce((t, erase) => t.replaceAll(erase, "\r"), s)
      for (const part of erased.split(/(\r|\n)/)) {
        if (part === "\n") {
          rows.push(row)
          row = ""
        } else if (part === "\r") row = ""
        else row += part
      }
    },
    columns: o.columns,
    live: o.live ?? false,
    color: o.color ?? false,
    shown: () => (row === "" ? [...rows] : [...rows, row]),
  }
}
