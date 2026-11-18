// Where a new version comes from: the project's releases on GitHub, a mirror of their download directory
// (TAVERN_MIRROR), or a directory on this machine (a mirror given as a path; tests). One small interface (`Release`)
// with an https adapter and a directory adapter.
//
// The contract with the installer (install.sh), held by both halves: every asset sits under
// `releases/latest/download/` and `releases/download/<tag>/`; `release.txt` is the tag on its first line (`v0.9.2`), then
// the notes, one `- ` line each; a platform's binary is `<asset>.gz`. A mirror replaces the `latest/download` base for
// every file; without one, after reading release.txt the binary is fetched from that tag's own directory.
import { createReadStream, statSync } from "node:fs"
import { open, readFile } from "node:fs/promises"
import { isAbsolute, join, resolve } from "node:path"
import { errno, Failed } from "./failed.ts"

export const REPO = "waylon256yhw/effect-tavern"
const LATEST = `https://github.com/${REPO}/releases/latest/download`
const TAGGED = (tag: string) => `https://github.com/${REPO}/releases/download/${tag}`

/** The release binary for a platform: one line a target, the same table as install.sh's. */
const ASSETS: Record<string, string> = {
  "android-arm64": "tavern-android",
}
export const assetFor = (platform: string, arch: string): string | undefined => ASSETS[`${platform}-${arch}`]

export interface Latest {
  /** The release's tag, as `v0.9.2`. */
  tag: string
  /** The notes, one line each, as release.txt has them (`- ...`). */
  notes: string[]
}
export type OnBytes = (got: number, total: number | undefined) => void

export interface Release {
  /** Where it reads from, for a person (`github.com`, a mirror's host, a directory). */
  readonly where: string
  latest(): Promise<Latest>
  /** `<asset>.gz` into the file `to`, reporting bytes as they arrive. */
  download(asset: string, to: string, onBytes: OnBytes): Promise<void>
}

/** The version a tag names: `v0.9.2` is `0.9.2`, as the binary is stamped. */
export const versionOf = (tag: string) => tag.replace(/^v/, "")

/** release.txt: the tag, then the notes. Anything else (a captive portal's page, an empty file) is no release. */
export const parseRelease = (text: string, where: string): Latest => {
  const [first = "", ...rest] = text.replace(/^﻿/, "").split(/\r?\n/)
  const tag = first.trim()
  if (!/^v?\d+\.\d+/.test(tag))
    throw new Failed("release-unreachable", `release.txt at ${where} does not begin with a version`, { host: where })
  return { tag, notes: rest.map((l) => l.trimEnd()).filter((l) => l.trim() !== "") }
}

const hostOf = (url: string) => {
  try {
    return new URL(url).host
  } catch {
    return url
  }
}

/** A file's bytes as they arrive, into `to`; stalls past `stall` ms between chunks end it. */
const save = async (body: ReadableStream<Uint8Array>, to: string, total: number | undefined, onBytes: OnBytes) => {
  const file = await open(to, "w")
  let got = 0
  try {
    for await (const chunk of body) {
      await file.write(chunk)
      got += chunk.byteLength
      onBytes(got, total)
    }
  } finally {
    await file.close()
  }
  if (total !== undefined && got !== total) throw new Error(`got ${got} of ${total} bytes`)
}

/** The releases on GitHub, or a mirror of their download directory at `mirror`. */
export const https = (mirror?: string): Release => {
  const base = (mirror ?? LATEST).replace(/\/+$/, "")
  let tagged: string | undefined
  return {
    where: hostOf(base),
    latest: async () => {
      const url = `${base}/release.txt`
      let response: Response
      try {
        response = await fetch(url, { signal: AbortSignal.timeout(20_000) })
      } catch (e) {
        throw new Failed("release-unreachable", `${url}: ${(e as Error).message}`, {
          host: hostOf(url),
          ...(errno(e) && { errno: errno(e) }),
        })
      }
      if (!response.ok) {
        await response.body?.cancel()
        throw new Failed("release-unreachable", `${url}: HTTP ${response.status}`, {
          host: hostOf(url),
          status: response.status,
        })
      }
      const latest = parseRelease(await response.text(), hostOf(url))
      if (!mirror) tagged = TAGGED(latest.tag)
      return latest
    },
    download: async (asset, to, onBytes) => {
      const url = `${tagged ?? base}/${asset}.gz`
      // a stall, not a slow phone line, ends a download: no total deadline, a minute without a byte
      const ctl = new AbortController()
      let timer = setTimeout(() => ctl.abort(), 60_000)
      const beat: OnBytes = (got, total) => {
        clearTimeout(timer)
        timer = setTimeout(() => ctl.abort(), 60_000)
        onBytes(got, total)
      }
      try {
        const response = await fetch(url, { signal: ctl.signal })
        if (!response.ok || !response.body) {
          await response.body?.cancel()
          throw new Failed("download-failed", `${url}: HTTP ${response.status}`, {
            host: hostOf(url),
            status: response.status,
          })
        }
        const length = Number(response.headers.get("content-length"))
        await save(response.body, to, Number.isFinite(length) && length > 0 ? length : undefined, beat)
      } catch (e) {
        if (e instanceof Failed) throw e
        throw new Failed("download-failed", `${url}: ${(e as Error).message}`, {
          host: hostOf(url),
          ...(errno(e) && { errno: errno(e) }),
        })
      } finally {
        clearTimeout(timer)
      }
    },
  }
}

/** A directory holding release.txt and the `.gz` assets, as a mirror on this machine. */
export const directory = (dir: string): Release => ({
  where: dir,
  latest: async () => {
    let text: string
    try {
      text = await readFile(join(dir, "release.txt"), "utf8")
    } catch (e) {
      throw new Failed("release-unreachable", `${dir}/release.txt: ${(e as Error).message}`, {
        host: dir,
        ...(errno(e) && { errno: errno(e) }),
      })
    }
    return parseRelease(text, dir)
  },
  download: async (asset, to, onBytes) => {
    const from = join(dir, `${asset}.gz`)
    try {
      const total = statSync(from).size
      const body = createReadStream(from) as unknown as ReadableStream<Uint8Array>
      await save(body, to, total, onBytes)
    } catch (e) {
      throw new Failed("download-failed", `${from}: ${(e as Error).message}`, {
        host: dir,
        ...(errno(e) && { errno: errno(e) }),
      })
    }
  },
})

/** The release a mirror names: an http(s) URL is a mirror of the download directory, anything else a directory here
 *  (against `cwd`); none, the project's GitHub releases. */
export const releaseAt = (mirror: string | undefined, cwd: string): Release => {
  if (!mirror) return https()
  if (/^https?:\/\//i.test(mirror)) return https(mirror)
  const path = mirror.replace(/^file:\/\//, "")
  return directory(isAbsolute(path) ? path : resolve(cwd, path))
}
