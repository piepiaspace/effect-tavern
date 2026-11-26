# Card Schema & Placement Reference

Source of truth: `packages/runtime/src/card.ts`, `fragment.ts`, `cond.ts`, `lore.ts`, `context.ts`, `product.ts`, `world.ts`, `derived.ts`, `media.ts`, `view-shell.ts`, `lint.ts`.

## Stage Visibility Matrix

| Card Field                              | Stages That Read It                                                                                                                |
| --------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| `frame`                                 | `narrate` reads full `frame`; off-stage stages read `<world>` (card-declared slots + `persona`, minus `pov`, `verbosity`, `style`) |
| `fiction` + `transcript`                | `narrate` only                                                                                                                     |
| `lore` (`layers`, `sections`)           | `lookup` (catalog/search/read), `gate` / `direct` (windows), `narrate` (delivered text)                                            |
| `rules.actions`                         | `decide` (menu + `{ judge }` chance), `settle` (deterministic code)                                                                |
| `rules.readouts`                        | `record` (post-prose multiple choice), settled by code                                                                             |
| `rules.derived`                         | `Cond`, state interpolation, and `residency: latest` views (`derived.<id>`)                                                        |
| `products` + `catalogs`                 | `record`, including interval `digest` on passages                                                                                  |
| `guard`                                 | `check` only (fast `DecisionModel` pass when configured, then LLM `check`)                                                         |
| `lexicon`                               | `polish` only (rewrites matched sentences outside dialogue)                                                                        |
| `greetings`                             | Node `0` (`do` settles initial state/world/events; `note` triggers dynamic narration)                                              |
| `passages`                              | Post-`record` transition child node (first-match `when`; `do`, optional `digest` epoch `boundary`, optional `end`)                 |
| `media` + `views`                       | Host validation & client Shadow DOM / `MediaFrame` rendering only (never sent to any model)                                        |
| `title`, `summary`, `version`, `source` | Card page metadata only (never sent to any model)                                                                                  |

---

## Field-by-Field Placement

### 1. `frame`: Voice, Register & Slots

- Array of `Fragment`: `{ id, text?, role?, enabled?, when? }` (`role` defaults to `"system"`).
- Standard slots (`SLOTS`): `persona`, `pov`, `voice`, `style`, `setting`, `language`, `verbosity`.
  - Omitting `text` opens an empty slot for the player.
  - `pov` and `verbosity` compile from player `switches` unless filled by the card.
  - Custom `id` triggers `unknown-frame-slot` (warn); non-writing card slots enter `<world>` on every off-stage pass.

### 2. `fiction`: Characters, Cast & State Bands

- Array of `Fragment`: `{ id, label?, text, role?, enabled?, when? }`.
- `label` names the module on the Card Page without exposing `text`.
- `when` turns a fragment into a state-gated **band**. Bands gating on one scalar field should cover `[min, max]` without gaps (`band-gap` lint).

### 3. `greetings` & `passages`

- **`greetings`**: `[{ text?, do?, note? }]` (at least `text` or `note` required; `empty-greeting` lint).
  - `do`: `Effect_[]` applied on node `0` (supports scalar and world ops; emitted events reach turn 1's `gate`).
  - Static opening: `text` alone commits verbatim at zero token cost.
  - Dynamic opening: `note` (or player `--note` / `Field.start` overrides) runs `narrate` over settled opening state.
- **`passages`**: `[{ when: Cond, text?, note?, do?, digest?: string[], end?: boolean }]`.
  - Evaluated first-match-wins, non-reentrantly, after a player turn's `record` commits.
  - `digest` (product IDs, checked by `unknown-product`; `digest: []` marks a pure boundary) runs interval `record` over the ending epoch and sets `boundary: true`—slicing `narratorHistory`, `ledger`, `Known:`, and `window` lore while keeping `fields`, `lore` unlock floors, and `world`/`chronicle` state folded across the path.
  - `end: true` marks the passage node `end: "over"`.

### 4. `rules`: Fields, Bands, Actions, Readouts, Derived & Effects

- **`fields`**: `{ path, type: "int" | "number" | "boolean" | "enum", initial, min?, max?, options?, bands?, label?, group?, hidden?, start?, view? }`.
  - Flat paths; strings live inside `enum` (`options` required).
  - `hidden: true` hides internal switches from UI while keeping them active in `settle` and `Cond`.
  - `start: true` exposes the field at story start (`greet` / `tavern play --set`); never combine with `hidden: true`.
  - **`bands`** (optional on `int` / `number`): `[{ id, min, label }]`, strictly increasing `min` (`bands[0].min === field.min` when `field.min` is set; all `min <= field.max`; checked by `bad-band`).
    - Exposes read-only **`meta.<field>`** in `Cond` and `views`: `label`, `min?`, `max?`, `ratio?` (clamped `0..1` when both `min` and `max` exist), `band?` (active `id`), `bandLabel?` (active `label`).
  - **UI meter derivation (`drawn`):** `enum` → `steps`; bounded `int` → `scale` if `min < 0` or bands/`fiction` cut ≥ 2 thresholds, else `gauge` (override with `view: "gauge" | "scale"`); everything else → `value`.
- **`actions`**: `{ id, text, when?, roll?, hit?, miss?, do? }`.
  - `when` gates selection in `decide`; recorded beats replay by `action.id` + `seed`.
  - `roll`: number (`0..1`), `{ path }`, or `{ judge: "<rubric>" }`.
- **`readouts`**: `{ id, text, when?, options: [{ id, text, do }] }`.
  - `when` gates which readouts `record` asks; answered options settle in card declaration order.
- **`derived`** (optional): closed pure aggregations over top-level `role: world` tables (reads full table rows regardless of `TableShape.filter`; checked by `bad-derived`), exposed at **`derived.<id>`** in `Cond`, interpolation, and `latest` views:
  - `{ id, label?, op: "count", table, where? }` → `number`
  - `{ id, label?, op: "sum", table, column, where? }` → `number` (`column` must be `int`)
  - `{ id, label?, op: "any", table, where? }` → `boolean`
  - `where` is a row-level `Cond` reading `"entityId"` or declared columns of `table` (no `{ event }` or `{ band }`).
- **`Effect_`** (used in `greetings[].do`, `passages[].do`, `actions`, `readouts`, and player `setField`—except `event` is forbidden in `setField`):
  - Scalar: `{ path, set }`, `{ path, add }` (number or `{ path }`, clamped to `[min, max]`), `{ event }` (`{path}` interpolates post-effect state).
  - World (validated against the product's static schema & limits; `bad-world-effect` lint):
    - `{ world, replace }` (`text` | `list` | `record`)
    - `{ world, patch }` (`record`)
    - `{ world, entityId, put }` (`table`, idempotent upsert)
    - `{ world, entityId, patch }` (`table`, updates existing entity)
    - `{ world, entityId, remove: true }` (`table`)
- **Single-turn settlement order** (folds `{ fields, world }` together): `opening/passage → beats (pre) → record changes + readout.do → player adjust`.
- **`over`**: `Cond` for code-decided story termination.

### 5. `lore`: Progressive Layers, Sections & `ContextPolicy`

- `{ id, layers: string[], sections?: [{ id, text }], unlock, offer?, access?, activation?, residency? }`.
- **Hook:** First sentence of `layers[0]` (and of each `section`); keep concise (`hook-length`).
- **`unlock` (monotone floor):** Single `Cond` or array of `Cond` (one per layer). `{ all: [] }` = always unlocked; `{ any: [] }` = never unlocked.
- **`offer` (turn window):** `Cond` over state, events, and `lore.<id>.since | shown`. Opens `current + 1` for this turn.
- **`sections`:** Horizontal appendices (`card:<entry>#<section>`, max 8, unique IDs without `#`, `bad-section`). Available to `lookup` whenever the parent entry is visible.
- **`ContextPolicy`** (omit unless overriding): `access: { model: true, player: false }`, `activation: "on_demand" | "always"`, `residency: "window" | "permanent" | "turn"`.

### 6. `products` & `catalogs`

- **`products`**: `{ id, label?, text, shape, role, initial?, fold?, when?, on?, trigger?, feed?, recall?, surface? }` (`on` defaults to `true`).
  - **Shapes:** `text` (`max?`), `list` (`max?`), `record` (`keys`: columns or `{ key, shape }` nested arbitrarily), `table` (`columns` of `text | int | boolean | enum`, `max?`, row `filter?`).
  - **Roles:**
    1. `world`: Current mutable world state (`WorldState.world`). Updated via sparse ops in `record` or deterministic `Effect_`. No `fold`, identifier `id`, no `entityId` column (host-assigned; `initial` for tables is `{ entityId: row }`, while `read_<table>`, `Current:`, and views see `{ entityId, ...columns }[]`). Supports `feed: true`, `recall: "<col>"`, and **`catalog` enum columns** (per-turn tool plans narrow writable columns/ops to currently live catalog items while preserving stored values).
    2. `chronicle`: Path-accumulated memory (`fold`: `"append"`, `"latest"`, or `{ key }`). Supports `feed`, `recall`, and `catalog` columns.
    3. `theater`: Player-only output (`surface: "theater" | "composer"`, `trigger: "turn" | "demand"`). Never `feed` or `recall`. Each theater product runs an independent `record` call.
- **`catalogs`**: `[{ id, kind?, baseUrl?, items: [{ id, label?, when?, focus?, aspect?, variants? }] }]`.
  - `kind`: `image` or `audio` (`media-kind-mismatch`). `focus: [x, y]` (`0..1`), `aspect: "W / H"` (`0.25..4`).
  - Referenced by `enum` columns (`catalog: "<id>"`) on `world`, `chronicle`, or `theater` products. `item.when` restricts pickable choices at `record` time only; stored values validate against the full static catalog.

### 7. `media` & `views`

- **`media`**: `{ illustrations?: [{ product }], portraits?: [{ id?, label?, catalog }], gallery?: string[], bgm?: { product } }`. Bound catalogs require `https://` `baseUrl` and relative `variants`. `bgm` is a runtime contract only (no client audio player yet).
- **`views` (`ViewShell`)**: `[{ id, label?, consumes?: string[], residency?: "latest" | "turn", when?: Cond, consts?: Record<string, ConstValue>, media?: [{ id, catalog, label? }], html, css? }]`. Full reference in [views.md](views.md).

### 8. `Cond`, `names`, `guard`, `lexicon` & `heading`

- **`Cond`:** `{ path, is }`, `{ path, op: "lt" | "lte" | "gt" | "gte", value }`, `{ path, band: string | string[] }`, `{ all: Cond[] }`, `{ any: Cond[] }`, `{ not: Cond }`, `{ event: string }`.
  - Paths: `<field>` (or `fields.<field>`), `meta.<field>.<prop>`, `derived.<id>`, `world.<record>.<key>`, `world.<table>.<entityId>.<col>` (for table length/aggregates, declare `rules.derived`), `lore.<id>.since | shown`.
  - Reserved field names (`reserved-path`): `fields`, `world`, `lore`, `meta`, `derived`.
- **`names`:** `{ user?, char?, [key]: string }` single-pass `{{key}}` expansion (`unfilled-name` warn, `unsupported-macro` error).
- **`guard`:** `string[]` (post-prose checks in `check`).
- **`lexicon`:** `[{ pattern, hint?, max? }]` (`*` intra-sentence wildcard, rewritten in `polish`).
- **`heading`:** `<field>` or `<worldOrRecordProduct>.<key>` shown as the turn's scene heading.

---

## Static Checks (`card check`)

Schema decode + `packages/runtime/src/lint.ts` enforce:
`unknown-frame-slot`, `unknown-path`, `reserved-path`, `orphan-event`, `dead-field`, `prose-cannot-move`, `band-gap`, `bad-band`, `bad-derived`, `bad-world-effect`, `unreachable-layer`, `hook-length`, `field-in-prose`, `inline-product`, `unfilled-name`, `unsupported-macro`, `unknown-catalog`, `duplicate-catalog-item`, `bad-view`, `bad-media-product`, `bad-media-slot`, `bad-media-url`, `bad-media-variant`, `media-focus`, `media-aspect`, `media-kind-mismatch`, `duplicate-media-binding`, `duplicate-media-slot`, `bad-section`, `bad-identifier`, `unknown-product`, `empty-greeting`, `empty-text` (error), `broken-text` (error).
