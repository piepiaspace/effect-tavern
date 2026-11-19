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

/** Colour on a TTY only, never under `NO_COLOR` or `TERM=dumb`; live rows on a TTY unless the caller says otherwise
 *  (a guest on someone else's terminal, Vite's). */
export const stderrScreen = (o: { live?: boolean } = {}): Screen => {
  const tty = process.stderr.isTTY === true
  const dumb = Bun.env.TERM === "dumb"
  return {
    tty,
    write: (s) => void process.stderr.write(s),
    get columns() {
      return process.stderr.columns || Number(Bun.env.COLUMNS) || 80
    },
    live: (o.live ?? true) && tty && !dumb,
    color: tty && !dumb && !Bun.env.NO_COLOR,
  }
}

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
