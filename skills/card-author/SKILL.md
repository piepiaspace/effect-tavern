---
name: card-author
description: Author, revise, test, or remaster cards for Effect Tavern. Trigger when editing a card YAML, designing state/lore/products/views/openings, porting a SillyTavern card, or running `tavern card` tools.
---

# Card Author

Use canonical terms from `GLOSSARY.md`: `stage`, `turn`, `slot`, `band`, `readout`, `passage`, `boundary`, `lore`, `section`, `ContextPolicy`, `product`, `role`, `fold`, `catalog`, `ViewShell`.

## 1. Core Model

A card is declarative YAML/JSON validated by `Card` (`packages/runtime/src/card.ts`). Runtime stages derive from what the card declares: `rules.actions` enables `decide`; `lore` or `recall` enables `lookup`; `director: true` enables `direct`.

Two orthogonal coordinates place any card:

- **Player presence (`persona` frame slot):** Filled → `participant mode` (player inhabits a character; `thought` applies). Empty → `author mode` (player directs from outside; model writes everyone).
- **Default input channel (`input`):** `"act"` (enters `transcript`) or `"note"` (feeds `direct` and `narrate` for that turn only).

Turn spine: `lookup → decide → settle → gate → direct → narrate → check → polish → record`.

- **`narrate`** is the only stage that reads `fiction` and `transcript`. State reaches prose through `when`-gated `fiction` bands, never raw numbers.
- **Separation of concerns:** Prompt framing belongs to the runtime (`request.ts` / `Hat`); post-prose rules belong to `guard` (`check`); slop rewrites belong to `lexicon` (`polish`); UI status bars, panels, and option buttons belong to `views` (`ViewShell`, never sent to any model).

## 2. Two-Hat Workflow

Build or revise cards in strict order:

1. **Hat 1 — Architect (Mechanism & Skeleton)**
   - Keep prose to one-line placeholders.
   - Set coordinates (`persona` + `input`), `rules.fields` (with `bands` where staged), `actions` vs. `readouts`, `rules.derived`, `lore` (`unlock`/`offer`/`sections`), `fiction` band `when` conditions, `greetings` (`do`/`note`), `passages`, `products`, `catalogs`, `media`, and `views`.
   - **Done when:** `bun run tavern card check <card>` reports zero errors with expected field meters and per-greeting state, and `bun run tavern card test <card> [scenario.yaml]` passes.
2. **Hat 2 — Novelist (Prose & Voice)**
   - Freeze the mechanism. Fill `frame`, `fiction`, `lore`, `greetings`, `passages`, `guard`, and `lexicon`.
   - **Done when:** `card check` passes (`empty-text`, `field-in-prose`, `inline-product`, `hook-length`, `unfilled-name`), `card view` confirms prompt assembly across boundary states, and `card view --views --scenario <file> --html <out>` renders all views cleanly.

## 3. Author Prose Boundaries

When editing an existing card or running Workshop tools (`compile` / `sort` / `review`):

- **Preserve author prose verbatim** (`frame`, `fiction`, `lore`, `greetings`, `Action.text`, `Readout.text`, option `text`, `Chance.judge`) unless explicitly asked to rewrite.
- **Leave newly created prose or rubric slots empty** when compiling mechanics (`empty-text` blocks install until filled).
- **`sort` moves whole paragraphs** in source order without paraphrasing.

## 4. Runnable Templates & Verification

Start from a working file rather than from scratch, and verify offline with zero model tokens:

- **[examples/starter.yaml](examples/starter.yaml)** — Minimal neutral template (`Field.bands` + `meta.*`, `rules.derived`, `views[].consts`, `world` + `theater` products, `ViewShell`). Copy to start a new card.
- **[examples/status-view.yaml](examples/status-view.yaml)** + **[status-view.scenario.yaml](examples/status-view.scenario.yaml)** — Full view showcase (`latest` HUD + `turn` history view, state & model-picked `catalog` images, tabs, `data-fill` buttons, `derived`, `consts`).
- **[scripts/verify-card.sh](scripts/verify-card.sh)** — One-command offline check loop:
  ```sh
  skills/card-author/scripts/verify-card.sh <card.yaml> [scenario.yaml] [preview.html]
  ```
- **CLI discovery:** Run `bun run tavern card --help` (and `<subcommand> --help`) for exact flags (`init`, `check`, `view`, `test`, `unroll`, `compile`, `sort`, `review`, `install`). All subcommands support `--json`.

## 5. References (Load On Demand)

- **[references/schema.md](references/schema.md)** — Load when mapping concepts to `Card` fields, `Field.bands`/`meta`, `rules.derived`, world `Effect_` ops, `lore`/`sections`/`ContextPolicy`, `products`/`catalogs`, `Cond`, or static lint codes.
- **[references/views.md](references/views.md)** — Load when writing or debugging `views` (`ViewShell`): data scope, `residency`/`consumes`, directives, HTML/CSS whitelist, patterns, and preview loop.
- **[references/pitfalls.md](references/pitfalls.md)** — Load when designing `readouts`, multi-opening state, `frame` vs. `fiction` placement, or surveying live-verified fixture cards.
- **[references/workshop-and-testing.md](references/workshop-and-testing.md)** — Load when porting a SillyTavern V2/V3 card (`unroll` → `sort`), running Workshop CLI commands, or authoring `scenario.yaml` assertions.
