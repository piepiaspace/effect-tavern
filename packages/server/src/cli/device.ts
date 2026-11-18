// What the machine does for a running tavern beyond the process itself: keep the phone awake while it serves (Android
// stops a backgrounded Termux otherwise), open the page in the browser, and say how much storage is free. One small
// interface (`Device`) with an adapter per kind of machine: Termux (its termux-api commands), plain Linux and macOS (the
// desktop's opener when there is one; nothing keeps them awake), and none. A tool that is not installed is a no-op that
// answers false, never an error: the tavern serves the same without it.
import { statfsSync } from "node:fs"

export interface Device {
  readonly kind: "termux" | "linux" | "macos" | "none"
  /** Keeps the device awake while the tavern serves; the answer lets it sleep again. */
  keepAwake(): () => void
  /** Opens `url` in the browser: true when the opener ran and said it did. */
  open(url: string): Promise<boolean>
  /** Bytes free for this user on the filesystem holding `dir`, when the system says. */
  free(dir: string): number | undefined
  /** The device's own tools and whether each is installed (for `tavern doctor`). */
  tools(): readonly { name: string; found: boolean }[]
}

type Env = Readonly<Record<string, string | undefined>>

/** The program on this PATH, or none. */
const which = (name: string, env: Env) => Bun.which(name, { PATH: env["PATH"] ?? "" }) ?? undefined

const freeOn = (dir: string): number | undefined => {
  try {
    const s = statfsSync(dir)
    return Number(s.bavail) * Number(s.bsize)
  } catch {
    return undefined
  }
}

/** Runs a tool to its end; false when it is not there or did not succeed. */
const ran = async (path: string | undefined, args: string[]) => {
  if (!path) return false
  try {
    const child = Bun.spawn([path, ...args], { stdin: "ignore", stdout: "ignore", stderr: "ignore" })
    const timer = setTimeout(() => child.kill(), 15_000)
    const code = await child.exited
    clearTimeout(timer)
    return code === 0
  } catch {
    return false
  }
}

const opener = (tool: string, env: Env): Pick<Device, "open" | "free"> => ({
  open: (url) => ran(which(tool, env), [url]),
  free: freeOn,
})

/** Termux on Android: `termux-wake-lock` / `termux-wake-unlock` and `termux-open-url`, from the termux-api package. */
export const termux = (env: Env): Device => ({
  kind: "termux",
  ...opener("termux-open-url", env),
  keepAwake: () => {
    const lock = which("termux-wake-lock", env)
    if (!lock) return () => {}
    // the lock takes a moment (it asks the Termux app); serving does not wait for it
    void ran(lock, [])
    let released = false
    return () => {
      if (released) return
      released = true
      const unlock = which("termux-wake-unlock", env)
      // at exit there is no later tick to wait in: the unlock runs to its end here
      if (unlock) {
        try {
          Bun.spawnSync([unlock], { stdio: ["ignore", "ignore", "ignore"], timeout: 10_000 })
        } catch {}
      }
    }
  },
  tools: () =>
    ["termux-wake-lock", "termux-wake-unlock", "termux-open-url"].map((name) => ({ name, found: !!which(name, env) })),
})

/** A desktop or server: the desktop's opener (`xdg-open`, `open` on macOS) when present; nothing keeps it awake. */
export const desktop = (kind: "linux" | "macos", env: Env): Device => {
  const tool = kind === "macos" ? "open" : "xdg-open"
  return {
    kind,
    ...opener(tool, env),
    keepAwake: () => () => {},
    tools: () => [{ name: tool, found: !!which(tool, env) }],
  }
}

/** A machine the tavern does nothing on: no page is opened, nothing is kept awake. */
export const noDevice: Device = {
  kind: "none",
  keepAwake: () => () => {},
  open: async () => false,
  free: freeOn,
  tools: () => [],
}

/** Termux is where the termux-api tools are: its own session says so, or one of its tools is on the PATH. Which
 *  binary runs here is another question, settled by the installer and the build (release/targets.ts). */
const inTermux = (env: Env) =>
  !!env["TERMUX_VERSION"] || /com\.termux/.test(env["PREFIX"] ?? "") || !!which("termux-wake-lock", env)

export const deviceOf = (platform: string, env: Env): Device => {
  if (inTermux(env)) return termux(env)
  if (platform === "darwin") return desktop("macos", env)
  if (platform === "linux" || platform === "android") return desktop("linux", env)
  return noDevice
}
