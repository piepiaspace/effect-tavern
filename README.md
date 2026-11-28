# Effect Tavern

**English** | [简体中文](README.zh-CN.md)

A ground-up full-stack harness for AI roleplay and interactive fiction, built on **Effect v4**, **Solid 2.0**, **UI SDK (`@ui-sdk`)**, and **Bun**.

Effect Tavern treats a card as declarative data plus deterministic rules rather than a bundle of prompt incantations and regex scripts. Code owns the control loop, state settlement, seeded dice, and prompt cache boundaries; the LLM is invoked only at typed stage seams to judge, narrate prose, and extract structured facts.

---

## Core Architecture

### 1. Multi-Stage Turn Spine

A player turn is a typed pipeline rather than a single chat completion:

```text
lookup → decide → settle → gate → direct → narrate → check → polish → record
```

- **Opt-in structured stages & fast decision passes:** Pure chat cards run only `narrate` and `record`; `lookup`, `decide`, `direct`, `check`, and `polish` activate automatically from what the card declares. An optional install-wide **Decision Model** (`/decision`) settles complete-catalog `lookup` and clear-cut `check` passes via probability scoring before falling back to language-model calls.
- **Narration and off-stage evidence.** `narrate` reads standing context, compiled writing switches, fiction and dialogue history. Conditional prose bands convey mechanical state. Off-stage passes share the standing context as read-only reference. `check` judges the draft and settlement records what the scene establishes. Creative products such as next actions and theater follow their own prompts.
- **Deterministic state, two-phase world settlement & epoch `passages`:** Scalar `fields` settle via seeded RNG (`actions`) and post-prose multiple-choice `readouts`; mutable `world` tables/records update via sparse `DomainChange` transactions (`record`), separate from append-only `chronicle` memory (`notes`) and player-facing `theater` blocks (`inner`, `options`, `<<aside>>`). Post-record `passages` support chapter/time-loop transitions (`digest` epoch boundaries) and terminal endings (`over`).

### 2. Immutable Log Tree & Derived Views

- Every turn is a node in an append/amend tree (`Log`), recording only player inputs, seeds, and model outputs.
- Branching (`checkout`), retries (`swipe`, `reword`), inline prose/input revisions (`edit`), and manual state adjustments (`setField`) are tree operations—state, transcripts, ledgers, and prefix-compressed summaries are pure path folds (`Derived`) with stable prompt-cache breakpoints across Anthropic, OpenAI-compatible, and Gemini endpoints.

### 3. Layered Assembly Without Presets

- Legacy monolithic presets are replaced by a uniform `Layer` resolution order:
  `defaultPack → card → mounted packs → local card settings → persona`
- Players customize voice, writing switches (`pov`, `echo`, `agency`, `verbosity`, `polish`), enhancers (`Pack`), continuation shells (`Hat`), snippets, and provider routing without touching card internals.

### 4. Departures from Legacy Tavern Clients

| Legacy Tavern Habit                       | Effect Tavern Replacement                                                      | Why                                                                                                                        |
| ----------------------------------------- | ------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------- |
| **Monolithic `preset`**                   | `request.ts` + `Layer` / `Pack` / `switches` + `Hat` + `Connection`            | Separates wire roles, player prose preferences, provider continuation handshakes, and endpoint parameters by owner.        |
| **`character card` (`V2` / `V3`)**        | Unified `Card` (`frame` + `fiction` + `participant` / `author` coordinates)    | Covers 1-on-1 roleplay, ensemble casts, RPGs, and protagonist-free worlds without shoehorning world logic into NPC fields. |
| **Chat `depth` (`@D`) & `Author's Note`** | Strict two-zone assembly (`head` + `tail`) & non-persisted `note` channel      | Never splices prompts into mid-history, preserving 100% KV prefix-cache stability and a clean dialogue `transcript`.       |
| **`worldbook` keyword scanning**          | State-gated `Lore` (`unlock` floor, `offer` window, `sections`) + `lookup`     | Replaces brittle substring/regex triggers with monotone plot progression, semantic lookup over hooks, and `ContextPolicy`. |
| **Inline `<status>` / MVU + Regex**       | `decide` / `settle` + `record` (`Readout`, `Product`, `DomainChange`)          | Keeps `narrate` focused purely on prose while code and structured `record` calls own state and side blocks.                |
| **Flat `swipes[]` & branch file copies**  | Immutable `Log` tree (`checkout`, `swipe`, `reword`, `edit`) + `Derived` folds | Zero-copy branching at any turn; state, floors, and interval summaries never desynchronize across branches.                |

---

## Workspace Layout

```text
packages/
  runtime/    Turn pipeline, Card/Layer/Product schemas, decision passes, log tree, derived folds, lint & offline card CLI
  provider/   Language & decision model connections, AI SDK compilation (Anthropic / OpenAI / Gemini), cache & stream primitives
  server/     SQLite library, the card shelf & optional card libraries, HTTP + SSE host, Workshop endpoints (compile / sort / review), and `tavern` CLI
  client/     Solid 2.0 + @ui-sdk web client: spatial Shell, Reader, Card Page, Readings, Inspector, Timeline, Packs & Settings
  app/        The installed app for desktops and phones: the web UI and the whole server in one system web view, over a thin Go host (MyGo)
skills/
  card-author/  Progressive-disclosure agent skill for authoring, testing, and remastering cards
samples/        Full remastered exemplar cards (e.g. `life-of-pi` with multi-day `passages` and `digest` boundaries)
site/           Cloudflare Nimbus (Astro) documentation site (HTML + clean Markdown + llms.txt)
docs/           Internal engineering research and design briefs
```

---

## Quick Start

### Install

```sh
# Android (Termux), Linux, macOS
curl -fsSL https://github.com/piepiaspace/effect-tavern/releases/latest/download/install.sh | sh

# Windows (PowerShell)
irm https://github.com/piepiaspace/effect-tavern/releases/latest/download/install.ps1 | iex

# Homebrew
brew install piepiaspace/tavern/tavern

# Docker
docker run -d -p 127.0.0.1:7777:7777 -v tavern:/data ghcr.io/piepiaspace/effect-tavern
```

Then `tavern start`. Updating, locations and uninstalling: [CLI docs](https://piepiaspace.github.io/effect-tavern/cli/).

The program ships with no cards. A new install's shelf is empty: open **Settings → Cards** to import one card (drop or pick a `.yaml` / `.json` file, or paste the card's own `https` link), or to add a card library by its `https` address and install cards from it.

### Desktop & Phone App

The app (`packages/app`) is the same tavern without a terminal: one window on the system's web view, the server running inside the page, and a thin Go host ([MyGo](https://github.com/egoist/mygo)) that holds the library's SQLite, the save picker, the clipboard and the appearance. Every release carries its installers beside the `tavern` binaries: [latest release](https://github.com/piepiaspace/effect-tavern/releases/latest).

| System                          | Installer                        |
| ------------------------------- | -------------------------------- |
| macOS 14.5 or later (universal) | `.dmg`, ad hoc signed            |
| Windows x64 and arm64           | `-setup-*.exe`, unsigned         |
| Linux amd64 and arm64           | `.deb`, or the `.tar.gz` archive |
| Android arm64                   | `.apk`                           |

iOS is configured in `packages/app/mygo.json` (iOS 17.5 or later), but no release job builds it and no installer is published.

The app keeps its own library, apart from the `tavern` command's `~/.tavern`: `tavern.db` in a folder named after the app, under `~/Library/Application Support` on macOS, `%AppData%` on Windows, `$XDG_CONFIG_HOME` (or `~/.config`) on Linux, and inside the app's own storage on Android and iOS.

```sh
cd packages/app
bun run verify                             # go test -count=1 ./... && bun test/page.ts (the server bundle run as a page)
go tool mygo build -platform linux/amd64   # runs bun web/build.ts, then packages into build/
```

### Prerequisites

- **Bun** `>= 1.4.5`
- **Vite+** (`vp` CLI; Bun installs the packages)

```sh
vp install
```

### Web Stack (Development & Single-Port Server)

```sh
# Full-stack dev server (Vite HMR client + in-process /api session on .dev/tavern.db)
bun --bun vp run dev

# Use the scripted zero-token model
MODEL=fake bun --bun vp run dev

# A new library has no cards: install one from a file, or take one from a card library
bun run tavern card install packages/runtime/test/cards/wuxia.yaml   # reaches the running dev server by itself, else opens .dev
bun run tavern depot add ./my-cards            # a directory holding index.json (only while no server holds the library), or an https URL
bun run tavern depot show <library-id>         # its cards against the shelf
bun run tavern depot pull <library-id> <card>  # copy one onto the shelf

# Build client & run single-port server (serves /api + built client on :7777)
cd packages/client && bun --bun vp build
bun run tavern start --port 7777
```

### CLI Host & Headless Play (`tavern`)

```sh
# Terminal play of an installed card (pass MODEL=fake or --model fake for zero-token runs)
bun run tavern card install packages/runtime/test/cards/wuxia.yaml
MODEL=fake bun run tavern play wuxia --greeting 0 --input "走进竹林"

# Manage stories & headless server (the root script uses the dev library .dev, the binary ~/.tavern, --data <dir> moves it; a command goes through the server running on that library by itself, --server <url> names one on another machine)
bun run tavern story list
bun run tavern start --headless --port 7777
```

The tavern's life, the same commands on a phone and on a computer (`docs/tavern-cli.md`):

```sh
tavern                  # start it: the wake lock on Termux, the page opened on a terminal (--no-open); a second one just says where it runs
tavern status           # running or not, its address, its data, the version (exit 3 when not running; --json)
tavern stop             # stop the one serving this data directory
tavern update           # what the latest release changes, ask, replace this binary (--check only reports, --yes does not ask)
tavern doctor           # device, command, data, space, the tavern, network, tools, leftovers, the last failed turn: one next step each
```

### Card Authoring & Workshop Toolchain (`tavern card`)

```sh
# Offline zero-token authoring loop (init, static lint, prompt preview, scenario assertions)
bun run tavern card init my-card --template readout
bun run tavern card check my-card.yaml
bun run tavern card view my-card.yaml --stage record --state affection=60
bun run tavern card test my-card.yaml

# Inspect a legacy SillyTavern V2/V3 PNG or JSON card in assembly order
bun run tavern card unroll path/to/card.png

# AI-assisted Workshop (compile rules/bindings, sort verbatim prose, semantic review, install)
bun run tavern card compile my-card.yaml --select fiction.setting --intent "Add a trust readout" -o candidate.yaml
bun run tavern card install my-card.yaml
```

### Verification & Documentation Site

```sh
vp check            # oxfmt + oxlint (with Solid 2.0 rules) + type-aware tsc
vp run verify       # Full assertion suite across runtime, provider, server, and client (including x18n & import-boundary checks)
cd packages/client && vp run verify:ui # Headless Chrome control & Solid diagnostics check via @ui-sdk agent bridge

bun run docs:dev    # Start the Nimbus documentation site locally
bun run docs:check  # Run Nimbus structural/MDX/link checks and static build
```

---

## Documentation

- **Documentation Site (`site/`):** Full guides in English and Chinese for core concepts, card authoring, CLI & headless hosting, layers/packs, and web client architecture (also emits `/llms.txt` and `.md` endpoints for coding agents).
- **[GLOSSARY.md](GLOSSARY.md):** Canonical English naming primitives mapping domain concepts directly to code identifiers.
- **[skills/card-author/SKILL.md](skills/card-author/SKILL.md):** Agent skill for designing, linting, testing, and remastering cards.
- **[CLAUDE.md](CLAUDE.md):** Workspace toolchain (`vp`), Solid 2.0 rules, UI SDK (`@ui-sdk`) conventions, i18n (`x18n`), and dev workflow.
