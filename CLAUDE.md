<!--VITE PLUS START-->

# Using Vite+, the Unified Toolchain for the Web

This project is using Vite+, a unified toolchain built on top of Vite, Rolldown, Vitest, tsdown, Oxlint, Oxfmt, and Vite Task. Vite+ wraps runtime management, package management, and frontend tooling in a single global CLI called `vp`. Vite+ is distinct from Vite, and it invokes Vite through `vp dev` and `vp build`. Run `vp help` to print a list of commands and `vp <command> --help` for information about a specific command.

Docs are local at `node_modules/vite-plus/docs` or online at https://viteplus.dev/guide/.

## Built-in Commands vs Scripts

`vp <name>` runs a built-in command. `vp run <name>` runs a `package.json` script or a `vite.config.ts` task. Scripts cannot overwrite built-ins, so `vp dev` and `vp run dev` may do different things. Check `package.json` and `vite.config.ts` first, and run `vp run <name>` when the project defines a script or task with that name.

## Tool Versions

Run `vp toolchain` to show versions and relationships in the active Vite+
release. Add a tool name to select part of the graph. For example, run
`vp toolchain vite`. Use `--global` to ignore the local `vite-plus` package. Use
`vp why <package>` to show the package-manager dependency graph.

## Review Checklist

- [ ] Run `vp install` after pulling remote changes and before getting started.
- [ ] Run `vp check` (the pre-push hook runs it anyway) and only the test files of what you changed (`bun test/<name>.ts`
      in that package). The whole `vp run verify` is not a habit: never for a doc or copy edit, and not after every step.
- [ ] Check if there are `vite.config.ts` tasks or `package.json` scripts necessary for validation, run via `vp run <script>`.
- [ ] If setup, runtime, or package-manager behavior looks wrong, run `vp env doctor` and include its output when asking for help.

<!--VITE PLUS END-->

## Solid 2.0

The client (`packages/client`) uses Solid 2.0 (`solid-js` 2.x with `@solidjs/web`), pinned exactly; move the
`solid-js`, `@solidjs/web`, `@solidjs/vite-plugin` and `@solidjs/diagnostics` pins together. Components run once; there
is no re-render. Read the `solid-2.0` skill (`packages/client/node_modules/solid-js/skills/solid-2.0/SKILL.md`) and `CHEATSHEET.md`
beside it before writing Solid code, especially the cheatsheet's last section, "What changed from 1.x".

Rules that matter most:

- Props are read, never destructured: `props.name` inside JSX, a memo, or an effect.
  `function Comp({ name })` loses reactivity. Pass values, not accessors: `<Child count={count()} />`.
- `createEffect(compute, apply)` takes two functions. The first reads reactive values and
  returns a result; the second receives it and performs side effects. One argument is an error.
- Stores are written through the draft: `setStore(s => { s.user.name = "Ada" })`.
  There are no path setters and no `produce`.
- Read reactive values inside JSX, a memo, or an effect, never at the top of a component body.
- Do not write a signal or store from a memo, an effect's compute function, or a component body.
  Write from event handlers, `onSettled`, or actions.

Names that no longer exist, and what to use:

- `solid-js/web` -> `@solidjs/web`; `solid-js/store` -> `solid-js`
- `Suspense` -> `Loading`; `SuspenseList` -> `Reveal`; `ErrorBoundary` -> `Errored`
- `mergeProps` -> `merge`; `splitProps` -> `omit`; `unwrap` -> `snapshot`; `onMount` -> `onSettled`
- `createResource` -> an async `createMemo` or `createStore(fn)` read under `<Loading>`
- `createSelector` -> `createProjection`; `createComputed` -> `createMemo` or a two-function `createEffect`
- `batch` -> writes batch on a microtask (`flush()` applies them now); `on()` -> the compute half of `createEffect`
- `startTransition` / `useTransition` -> built in; `isPending()` reports an in-flight change
- `Index` -> `<For keyed={false}>`; `indexArray` -> `mapArray`; `createMutable` -> `createStore` with draft setters
- `onError` / `catchError` -> `<Errored>` or the `error` option of `createEffect`
- `classList` -> `class={{ active: isActive() }}`; `use:` directives -> `ref={factory(args)}`
- `Context.Provider` -> `<Context value={...}>`; `equalFn` -> `isEqual`; `getListener` -> `getObserver`

Tooling:

- Skills: the Solid packages ship their own under `packages/client/node_modules/<pkg>/skills/<name>/SKILL.md`; read them
  there: `solid-js` `reactivity-diagnostics` (every warning code and its fix), `@solidjs/diagnostics` `agent-loops`
  (capture evidence, assert budgets), `@solidjs/web` `server-components` (unused, no SSR).
- A console warning with a bracketed code, such as `[REACTIVE_WRITE_IN_OWNED_SCOPE]`, is a defect.
  Look it up in the repair guide; do not suppress it.
- Verify a reactive change with `captureArtifact` and `expectNoDiagnostics` from `@solidjs/diagnostics`,
  or `POST /__solid/diagnostics` on the dev server with `{"method":"begin"}` ... `{"method":"end"}`.
- `vp check` runs `eslint-plugin-solid/configs/v2` through oxlint (root `vite.config.ts`).
- Docs: https://v2.solidjs.com/llms.txt; append `.md` to any page URL for its Markdown.

## UI SDK (`@ui-sdk`)

Interactive controls, overlays, and gesture primitives in `packages/client` build on `@ui-sdk/solid` and `@ui-sdk/core` (pinned together on Solid 2.0 RC; skill at `packages/client/node_modules/@ui-sdk/core/skills/ui-sdk`), replacing ad-hoc native `<select>`, `<dialog>`, `[popover]`, Escape/outside-click listeners, and raw pointer drag loops so behavior converges across desktop and touch browsers:

- **Behavior vs. styling:** `@ui-sdk` owns focus management, keyboard navigation, Escape/scrim dismissal, background inertness, popup positioning, pointer velocity/rubber-band/spring physics (`@ui-sdk/core/gesture`), and responsive adaptation (`presentation="auto"`). Styling stays strictly in our stylesheets under the five-layer cascade `@layer ui-sdk, tokens, components, card, user` (`src/app.css`), so component rules override `@ui-sdk` defaults without `!important`.
- **Shared controls & primitives:** Reuse the wrappers in `src/controls.tsx` (`Menu` on `Select`, `Switch`, `Modal` and `Prompt` on `Dialog` + `createDialogController`, `Confirm` on `AlertDialog` + `createConfirm`), `src/readings.tsx` (`Sheet` on `Dialog`, `Demand` on `Menu`), `src/shell.tsx` (phone `Drawer`), `src/composer.tsx` + `src/invocation-menu.tsx` (`Popover` + multi-page `Command`), and `src/edge.tsx` (`definePrimitive` separator with `bindDrag`, `rubberBand`, and `solveSpring` over `src/fold.ts`). When building a control `@ui-sdk` does not ship, author it with `definePrimitive` and `createParts` rather than raw DOM listeners.
- **Agent bridge & browser check (`#181`):** Every interactive control an agent should reach is an `@ui-sdk` part (or `definePrimitive` declaring `agent: { actions }`) with an accessible name, mounted in `packages/client/test/controls.tsx`. `vp run verify:ui` in `packages/client` (kept out of `verify` because it launches headless Chrome; set `CHROME` when not at the macOS default) drives `test/controls.tsx` through `createAgent` (`snapshot` / `act`) and `@solidjs/diagnostics`, failing on any unnamed control, unreachable action, or Solid diagnostic (all but the clock-gated perf codes in `test/settle.ts` `CLOCKED`, which fire by machine load; a fixture gates through `defects()`); it then runs `test/cards.tsx` (the settings page's 卡片 section) and `test/workshop.tsx` (the workshop's list and a card's manuscript), each over a stand-in server, the same way. A page-level flow that needs a browser gets its own fixture listed in `test/ui.ts`.
- **Browser bundle boundary:** `packages/client/test/imports.ts` (run in `vp run verify`) walks value imports from `packages/client/src/` across workspace packages and fails if any `node:*` module or `@effect-tavern/provider`'s root barrel (which pulls AI SDK drivers and Node code) becomes reachable in the browser. Import pure provider helpers by explicit subpath (`@effect-tavern/provider/src/names.ts`, `url.ts`) or `import type`.

## Interface words (i18n, #67)

The chrome's words live in `packages/client/src/locales/zh-CN.ts` (the source, Chinese) and `en.ts` (English, the same
keys), read with `t("side.stories")` from `src/i18n.ts` where the word is drawn (JSX, a memo, an effect); a module-level
table holds keys, not words. A new word: add the key to both files (or `x18n set <key> --locale <l> --value <v>` in
packages/client), then use it. `x18n check` runs in `vp run verify` and fails on a key used but undeclared, declared
but unused, missing in a locale, or a `{hole}` the English drops; `x18n extract --list` finds hard-coded strings.
A card's own text (labels, group names, openings) and the model's words are never translated.

## Dev

Bun is the package manager (`bun.lock`; `bunfig.toml` holds the week-old release floor and its temporary exceptions). A pre-push hook (`.vite-hooks/pre-push`, installed by `vp install` through `prepare`) runs `vp check`. Markdown emphasis that GitHub shows as asterisks (`**读数（Readings）**视图`, `是**“核心”**，`) is caught by `tools/mdlint`: the pre-commit hook (`vp staged`) moves sentence marks and whole bracket or quote pairs outside the markers in staged `.md`/`.mdx` (never a token's character such as the `+` of `Vite+`, never half a pair), and the commit, pre-push and `verify` fail on what is left, each place named with its two hand fixes. By hand, on any file, a PR or issue body before posting included: `bun tools/mdlint/index.ts --fix <file>`. Tests are `vp run verify` (bun assert scripts per package, `test/*.ts`, and the root's `test/install.ts` for the phone installer `install.sh`); the `vp test` built-in finds no vitest files and exits 1. Run `vp run verify:ui` in `packages/client` whenever client controls, dialogs, popups, or gestures change (see `## UI SDK`).

`bun --bun vp run dev` at the root (`bun --bun vp dev` in `packages/client`; `--bun` makes the `node` Vite+ launches resolve to Bun) is the whole stack: the session (`packages/server/src/dev.ts`) runs inside the Vite process through its module runner, mounted at `/api`; client edits are HMR, runtime/server edits take effect on the next request. `MODEL=fake` scripts the model, the library lives in `.dev/tavern.db` (gitignored; `DATA=<dir>` moves it; delete it to start every story over). The user starts and stops `vp dev` in their own terminal; an agent uses it and never starts, restarts or kills it.

`tavern` (`packages/server/bin/tavern.ts`) is the one command and the binary's compile target (`compile` in `packages/server`, the client build inside, `VERSION`, `TARGET` and `ASSET` stamped; `release/targets.ts` is the release's one table of targets, compiled for every channel (GitHub Release, ghcr.io image, Homebrew tap) by `.github/workflows/release.yml`); `bun run tavern …` at the root runs it from source. A bare `tavern` shows help. `tavern start` launches the standalone app, the one-port form a phone runs: `/api` plus the client build (`vp build` in `packages/client` → `dist`) under every other path (`--headless`: `/api` only). It is the production host (`start.ts` → `host.ts`), not the dev session: the library is `~/.tavern/tavern.db` for the binary and `.tavern/tavern.db` from source (`--data <dir>`, `TAVERN_DATA` or `DATA` moves it; the root `tavern` script sets `TAVERN_DATA=.dev`, the dev library), and no local key is imported. Flags and environment are read only by `packages/server/src/cli/config.ts`. A command finds its library by itself (`src/reach.ts`): the process that listens on a library (`tavern start`, or the dev session once Vite listens) writes its address beside the lock (`tavern.db.address`) and answers `GET /api/host`, and a command goes through it; with nobody holding the library it opens it and calls the same handler (`serve.ts` `handle`, a `Wire` in `src/wire.ts`) in-process; `--server <url>` names a tavern on another machine. Exit 3 when none of these can be reached, including `MODEL=fake` meeting a tavern on a real model. The player's commands (`tavern stop`, `status`, `update`, `doctor`, and `start`'s wake lock and opening the page) live in `packages/server/src/cli/` behind two injected interfaces in `World`, `Device` and `Release`; local refusals go through `term/` `explain` (a local code needs words in both tables), and `packages/server/test/lifecycle.golden.txt` holds the 48-column transcripts (`GOLDEN_WRITE=1 bun test/lifecycle.ts` rewrites it). `tavern stop` leaves the dev session (its address file says `"dev": true`) to its own terminal. Everything a running server prints (the banner, full model exchanges by default, turn summaries; `--log full|turn|quiet`, `TAVERN_LOG`) and `<data>/log/turns.jsonl` come from its logbook (`packages/server/src/logbook.ts`, `docs/tavern-cli.md`); the dev session's is a guest on Vite's terminal, and a command or a test prints none of it. A schema change to the library needs a new `user_version` step in `data.ts` `upgrade`: a stamped library no longer runs the create statements on open.

Decision-model calibration instruments live in `packages/server/bin/` (`decision-probe.ts`, `decision-replay.ts`, `decision-lookup.ts`): they open a library read-only (defaulting to `.dev/tavern.db` without locking a running dev server) and send labeled scenes, stored node prose, or `lookup` catalog pools to the saved `decision` service to measure probability thresholds (`LO`, `HI`, `LOOKUP` in `packages/runtime/src/decision.ts`), latency, and block rates. Pass `--dry` (`decision-replay.ts`, `decision-lookup.ts`) to inspect built requests without calling the network.

## The app (`packages/app`)

The installed app for desktops and phones, on MyGo (pinned in `go.mod`, run as `go tool mygo`): one window on the system's web view, with the client and the whole server running in the page over a thin Go host. It is a different thing from `tavern start` (`## Dev`), the one-port server that section also calls standalone.

- **Two sides:** Go at the package root holds what a page cannot: the library's SQLite (`db.go`, `/__db`), the save picker (`save.go`, `/__save`), the bound `Host` service (`host.go`: clipboard, appearance), recovery of a page whose process the system ended (`recovery.go`), menus (`menu.go`). `web/` is the page's side: `host.ts` (stand-ins for Bun and Node, the page's `fetch`, `tavernHost`), `entry.ts` (the server started in the page), `sqlite.ts` (`bun:sqlite` as synchronous requests to `/__db`), `failure.ts` (the notice when the start fails).
- **Host seam:** the client asks the host for anything only through `packages/client/src/host.ts` (`host()`, `saveFile`, `copyText`, `active`), which declares the `Host` interface; `web/host.ts` builds `tavernHost` to fit it by `import type`. A new capability goes in that order: the interface, then `web/host.ts`, then Go, as a method on `Host` the page calls by name (`mygo.call("Host.<Method>")`) or, for a body too large for JSON, a path on the app's scheme as `/__save` is. `test/page.ts` gets its case.
- **Appearance is Go's:** the pick (`system`, `light` or `dark`) lives in `preferences.json` in the user data directory and is applied with `Theme.SetSource` before the first window. That call also flips the page's `prefers-color-scheme`; the page still pins `data-theme` for a side picked (`src/theme.ts`, once the host has told it the pick) and releases it for `system`, as in a browser, because Android before 12 (API 31) flips nothing: there the page follows the pick, but the system bars and keyboard keep the system's appearance. `minSdk` is left at MyGo's default (26).
- **What the design rests on:** SQLite stays on the page's main thread (Android's request-body bridge exists only on the main frame), so every `/api` call costs synchronous requests: read in batches (`GET /locals`), one answer for many rows. Android waits 60 s for a response to begin: a handler that waits on the player sends its status and flushes first, then answers in the body (`save.go`). An upload to Go is bytes (WebKit hands a custom scheme no body for a Blob). Recovery acts on the process-gone signal alone: a live page blocks on Go by design and is left to itself.
- **Test** (in `packages/app`): `bun run verify` is `go test -count=1 ./...` then `bun test/page.ts`, the page bundle run with a browser's globals and none of Bun's, so a Bun or Node API on a path the page takes fails there before it fails on a phone. Also `gofmt -l .`, `go vet ./...`, and `GOOS=darwin` / `GOOS=windows go vet ./...` for the other desktops; Android needs its cgo toolchain and compiles only in the release workflow, and nothing compiles iOS. `dist/` holds only `.gitkeep` until a build, which is all `go test` needs.
- **Build:** `go tool mygo build -platform <os>/<arch>` runs `bun web/build.ts` (the client's build and `server.js` into `dist/`), packages into `build/` (for Linux a `.deb` and a `.tar.gz`), and writes `mygo.ts`, a typed client for `Host` that nothing imports (ignored). `.github/workflows/release.yml` (`app`) builds macOS, Windows, Linux and Android on a `v*` tag; run by hand it builds everything and publishes nothing. No job builds iOS, though `mygo.json` configures it.
- **The library** is `tavern.db` in MyGo's `PathUserData`: the per-user configuration directory joined with the app's name (`name` in `mygo.json`). That directory is `~/Library/Application Support` on macOS, `%AppData%` on Windows, `$XDG_CONFIG_HOME` or `~/.config` on Linux, the app's own container on iOS and its files directory on Android. `TAVERN_DB` names another file (tests).

## Cards: the shelf and card libraries

The program ships no card and reads none from beside itself: no card is embedded in a build, and no host loads a card directory. Three owners, kept apart:

- **Harness** (ours): stage protocol framing in `packages/runtime/src/request.ts`, switch sentences in `packages/runtime/src/layer.ts`, and the first-party starter writing pack in `packages/runtime/src/starter-pack.ts` (seeded into a fresh library as an ordinary editable default pack; reference test rows in `packages/runtime/support/rows.ts`). Code only.
- **Card author**: a card file. Its `creator`, `version` and `source` are the author's facts and travel inside the card.
- **Player**: everything in the install's library, including each card on the shelf.

`packages/server/src/shelf.ts` is the install's cards, one table and one owner per row: `install` (YAML/JSON text or a value, through the whole gate; an id already there is refused until `replace`), `remove` (refused while the card has stories), `text` (the card as a file again), and the workshop's three: `create` (a blank card of a fresh id), `whole` (the card with its revision) and `save` (the card whole, through the same gate, from the revision it was read at). Every row carries an `origin` (`file`, `link`, `workshop` or `depot`), the install's fact about how the card got here. One card comes in as a file or by its own https link (`POST /cards`, `POST /cards/link`; the client's 导入卡片 dialog takes a dropped or picked file, or a link); many come from a card library. A card file may weigh up to `CARD_BYTES` (32 MB, `packages/runtime/src/library.ts`) wherever it travels; every other request body is capped at 1 MB. Everything the server fetches for the player goes through `packages/server/src/remote.ts` (https only, timeout, the same ceiling). `packages/server/src/depot.ts` is a card library (卡库; "depot" in code because "library" is the install's store): a directory or https URL holding `index.json` and card files, read-only, optional, known to the install only once the player adds it. A pull copies a card onto the shelf; nothing is fetched on its own. The wire accepts https locations only; a directory is registered with `tavern depot add <dir>`.

The workshop (制卡工坊; `packages/client/src/workshop.tsx`, `docs/workshop-brief.md` §0) writes the shelf itself: there is no draft. New is a card at once, and every edit autosaves to that card through the gate, naming the revision it was read at (`GET`/`PUT /cards/<id>/whole`; a card changed elsewhere meanwhile is a 409 `card-changed`, never overwritten). Its page shows a card as a manuscript of plain text (`src/manuscript.ts`: always-on chapters, openings, single-layer entries) and carries everything else through untouched, so a new control there must keep `cardOf(card, manuscriptOf(card))` equal to `card`, and an edit must move nothing it did not touch. A block with no text stays on the page and is never written, which is how the gate's `empty-text` is never tripped. Stages are never declared there: a turn's stages follow from what the card holds.

A new library has an empty shelf. To get a card into the dev library: 制卡工坊 → 新建卡片 or Settings → 卡片 in the client, or `bun run tavern card install <file.yaml>` (it goes through the running dev server, or opens `.dev` when none runs). The four YAML cards under `packages/runtime/test/cards/` are test fixtures (`ri` and `banxing` are remasters of other authors' cards and are never published as examples); tests install what they play (`shelf(data).install(...)`), and nothing outside `test/` may read them.
