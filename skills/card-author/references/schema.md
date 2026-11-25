# Card Schema & Placement Reference

Source of truth: `packages/runtime/src/card.ts`, `fragment.ts`, `cond.ts`, `lore.ts`, `context.ts`, `product.ts`, `world.ts`, `media.ts`, `view-shell.ts`, `view-template.ts`, `view-bindings.ts`, and `lint.ts`.

## Stage Visibility Matrix

| Card Field                              | Stages That Read It                                                                                                                           |
| --------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| `frame`                                 | `narrate` reads full `frame`; off-stage stages read `<world>` (`worldOf`: card-declared slots + `persona`, minus `pov`, `verbosity`, `style`) |
| `fiction` + `transcript`                | `narrate` only                                                                                                                                |
| `lore` (`layers`, `sections`)           | `lookup` (host `catalog` / `search_context` / `read_context`), `gate` / `direct` (windows), `narrate` (delivered text)                        |
| `rules.actions`                         | `decide` (action menu + `{ judge }` chance), `settle` (deterministic code)                                                                    |
| `rules.readouts`                        | `record` (post-prose multiple choice), settled by code                                                                                        |
| `products` + `catalogs`                 | `record`, including interval `digest` on passages                                                                                             |
| `guard`                                 | `check` only (`DecisionModel` fast pass when configured, then LLM `check`; never shown to `narrate`)                                          |
| `lexicon`                               | `polish` only (rewrites matched sentences outside dialogue)                                                                                   |
| `greetings`                             | Node `0` (`do` settles initial state/events; `note` triggers dynamic narration)                                                               |
| `passages`                              | Post-`record` transition child node (`when` first-match-wins; `do`, optional `digest` epoch `boundary`, optional `end`)                       |
| `media` + `views`                       | Host media/template validation & client Shadow DOM / `MediaFrame` rendering only (never sent to any model)                                    |
| `title`, `summary`, `version`, `source` | Card page / metadata only (never sent to any model)                                                                                           |

---

## Field-by-Field Placement

### 1. `frame`: Voice, Register & Slots

- Array of `Fragment`: `{ id, text?, role?, enabled?, when? }`. (`role` defaults to `"system"`; order is preserved.)
- `id` names a **slot**. Known slots (`SLOTS` in `fragment.ts`): `persona`, `pov`, `voice`, `style`, `setting`, `language`, `verbosity`.
  - Leaving `text` absent opens an empty slot for the player to fill.
  - `pov` and `verbosity` are compiled from player `switches` unless the card fills the slot itself (e.g. `yandao.yaml` fills `pov` for protagonist-free narration).
  - Any other `id` triggers lint `unknown-frame-slot` (warn): intentional custom slots are allowed, but never put a character sheet in `frame`—non-writing slots declared on `card.frame` enter `<world>` on every off-stage pass including `direct`.

### 2. `fiction`: Characters, Cast & World Bands

- Array of `Fragment`: `{ id, label?, text, role?, enabled?, when? }`.
- `label` names the module on the Card Page without exposing `text`.
- `when` turns a fragment into a state-gated **band**. Bands gating on the same scalar field represent mutually exclusive narrative stages: at most one should hold at any value within `[min, max]` (checked by lint `band-gap`).

### 3. `greetings` & `passages`: Openings, Epoch Transitions & Endings

- **`greetings`**: `[{ text?, do?, note? }]` (at least `text` or `note` required; lint `empty-greeting`).
  - `do`: array of `Effect_` applied on node `0` before turn 1; emitted events reach turn 1's `gate`.
  - **Static opening:** `text` alone (no `note` and no player `--note`) commits `text` verbatim at zero token cost.
  - **Dynamic opening:** when `note` is set on the greeting (or the player passes `--note` / `Field.start` overrides on `greet`), node `0` runs `narrate` over the settled opening state using `note` as direction (`swipe` and `reword` work on node `0`).
- **`passages`**: `[{ when: Cond, text?, note?, do?, digest?: string[], end?: boolean }]`.
  - Evaluated first-match-wins and non-reentrantly after a player turn's `record` commits.
  - Appends a static (`text`) or dynamically narrated (`note`) transition child node (`passage: true`), applying `do` effects (e.g. resetting single-day clocks while keeping cross-loop counters).
  - **`digest` & epoch `boundary`:** declaring `digest` (product IDs, checked by `unknown-product`; `digest: []` marks a clean boundary with zero extra extraction) runs an interval `record` pass over the ending epoch's transcript and sets `boundary: true` on the passage node—slicing `narratorHistory`, `ledger`, `Known:`, prefix folds, and `window` lore residency cleanly from the new epoch while keeping scalar `fields`, `lore` unlock floors, and `world`/`chronicle` state folded across the full path.
  - **`end: true`:** marks the passage node `end: "over"` (matching `rules.over`), guarding the terminal leaf against further child turns (`swipe` / `reword` on the parent remain valid).

### 4. `rules`: Fields, Actions, Readouts & Termination

- **`fields`**: `{ path, type: "int" | "number" | "boolean" | "enum", initial, min?, max?, options?, label?, group?, hidden?, start?, view? }`.
  - Flat paths; strings exist **only** inside `enum` (`options` required).
  - `hidden: true` hides internal switches from the UI while keeping them active in `settle` and `Cond`.
  - `start: true` lets the player set the field when starting a story (`greet` opening / `tavern play --set`); never combine with `hidden: true`.
  - **UI Meter Derivation (`drawn` in `card.ts`):**
    - `enum` → `steps` track.
    - Bounded `int` (`min` and `max` present) → `scale` if `min < 0` or `fiction` bands cut ≥ 2 thresholds on that field; otherwise `gauge` (`now / max` stock, e.g. HP `0..100`).
    - Override with `view: "gauge" | "scale"` when a stock also has multiple injury/resource bands.
    - Everything else → `value` row.
- **`actions`**: `{ id, text, when?, roll?, hit?, miss?, do? }`.
  - `when` gates availability (unavailable actions cannot be decoded).
  - `roll`: number (`0..1`), `{ path }`, or `{ judge: "<rubric>" }` (model estimates probability in `decide`, RNG seed rolls the die).
  - `Effect_`: `{ path, set }`, `{ path, add }` (number or `{ path }`, clamped to `[min, max]`), or `{ event }` (`{path}` interpolates post-effect state).
- **`readouts`**: `{ id, text, when?, options: [{ id, text, do }] }`.
  - Asked in `record` when `when` holds on post-settlement state; chosen option's `do` effects apply deterministically.
- **`over`** (`Cond`, code-decided ending).

### 5. `lore`: Progressive Layers, Sections & `ContextPolicy`

- Entry shape: `{ id, layers: string[], sections?: [{ id, text }], unlock, offer?, access?, activation?, residency? }`.
- **Hook:** First sentence of `layers[0]` (keep concise; lint `hook-length`).
- **`unlock` (monotone floor):** Single `Cond` (for 1-layer entries) or array of `Cond` (one per layer). `{ all: [] }` = always unlocked; `{ any: [] }` = never unlocked. Once satisfied along a path, a layer stays unlocked.
- **`offer` (turn window):** `Cond` over state, turn events (`{ event }`), and `lore.<id>.since | shown` counters (`since` = `Infinity` if never shown, `0` this turn). Opens `current + 1` for this turn (`may`, or `must`/`may` when `director: true`). Delivering a deeper layer also delivers unread lower layers.
- **`sections` (on-demand appendices):** `sections: [{ id, text }]` (max 8, unique IDs without `#`, lint `bad-section`). Ungated horizontal detail (`card:<entry>#<section>`) whose first sentence serves as its lookup hook. Available to `lookup` whenever the parent entry is visible; never shown in the player `/` menu and never `always` injected.
- **`ContextPolicy`** (leave omitted unless overriding defaults):
  - `access: { model: boolean, player: boolean }` (card default: `{ model: true, player: false }`; set `player: true` to expose in player `/` pin menu).
  - `activation: "on_demand" | "always"` (default `"on_demand"`).
  - `residency: "window" | "permanent" | "turn"` (default `"window"`—remains until compressed out of the active window).

### 6. `products` & `catalogs`: World State, Chronicle & Theater

- **`products`**: `{ id, label?, text, shape, role, initial?, fold?, when?, on?, trigger?, feed?, recall?, surface? }`.
  - Cards declare their own products whole (the harness ships no default products; a player's default writing pack may supply `options`, `notes`, `inner` below the card).
  - **Shapes:** `text` (`max?`), `list` (`max?`), `record` (`keys`, max 1 nested list/table/record), `table` (`columns` of `text | int | boolean | enum`, `max?`, row `filter?` `Cond`).
  - **Explicit `role` (required on new products):**
    1. `world`: Current mutable world state (`scene`, `people`, `bag`). Lives in `WorldState.world`; updated via sparse `DomainChange` ops (`insert_entity`, `patch_entity`, `remove_entity`, `patch_record`, `replace`) in `record`. No `fold`, identifier `id`, no column named `entityId` (assigned by host; `initial` for tables is `{ entityId: row }`). Supports `feed: true` (`Current:` line) and `recall: "<col>"` (lookup index). Readable in `Cond` as `world.<id>.<key>`.
    2. `chronicle`: Path-accumulated memory (`notes`). Uses `fold` (`"append"`, `"latest"`, or `{ key }`). `feed: true` feeds `Known:`; `recall` feeds lookup.
    3. `theater`: Player-only output (`inner`, `options`, commentary). Never `feed` or `recall`. `surface: "theater"` (default, drawn on the page) or `"composer"` (`list` shape, offered above the input box, never `trigger: "demand"`). `trigger: "turn"` (default) or `"demand"`. Each theater product uses an independent `record` call.
- **`catalogs`**: `[{ id, baseUrl?, items: [{ id, when?, variants? }] }]`.
  - Referenced by an `enum` column (`catalog: "<id>"` instead of `options`) on `chronicle` or `theater` products (never `world`).
  - At `record`, pickable enum values are dynamically restricted to items whose `when` holds (if none hold, that table/key is omitted for the turn; zero prompt bloat). Readers resolve `variants` under `baseUrl` by node seed.

### 7. `media` & `views`: Media Bindings & In-Stream `ViewShell`

- **`media`**: `{ illustrations?: [{ product }], portraits?: [{ id?, label?, catalog }], gallery?: string[], bgm?: { product } }`.
  - `catalogs` items bound to media require `https://` `baseUrl` and relative `variants` (`focus?: [x, y]` in `[0, 1]`, `aspect?: "W / H"` in `[0.25, 4]`).
- **`views` (`ViewShell`)**: `[{ id, label?, consumes?: string[], residency?: "latest" | "turn", when?: Cond, media?: [{ id, catalog, label? }], html, css? }]`.
  - **`consumes`**: Optional array of `theater` (or `surface: "composer"` on `Card.views`) product IDs claimed by this shell (`consumableSurface`; products bound in `media.illustrations`, empty strings, and duplicate IDs are rejected). Claimed products are suppressed from default `<Theater>` / `<Options>` chrome so they never render twice. Each product ID may appear in only one view on a card. Combine a status HUD and character inner thoughts into a single shell via `residency: "latest"` + `consumes: ["inner"]` rather than stacking fragmented widgets.
  - **`residency`**: Defaults to `"turn"` when `consumes` is non-empty, and `"latest"` otherwise. `"latest"` mounts on the active branch head (carrying `latestContext: { fields, world }`); `"turn"` stays on every turn (skipping turns where all `consumes` products are `undefined`).
  - **Data scope** exposes `fields`, `world` (on the latest view), `theater`, `media`, and `names`. A single consumed product also supplies `value` and top-level record key aliases.
  - **Five controlled `data-*` directives** (scriptless Shadow DOM + `adoptedStyleSheets`; zero `eval`, zero external URLs):
    1. **Text (`data-text="<path>"`)** — Writes pure `textContent` (`null` / `undefined` → `""`).
    2. **Conditionals (`data-if="<path>"`, `data-unless="<path>"`)** — Unmounts subtree when falsy (`false`, `0`, `""`, `null`, `undefined`, or `[]`).
    3. **Iteration (`data-each="<path>" data-as="<item>"`)** — Iterates arrays/tables, binding `<item>` and 1-based `<item>.$num` (radio `name` and paired `input[id]` / `label[for]` are automatically row-scoped).
    4. **Controlled media (`data-media="<source>"`, optional `data-fit="cover|contain|natural"`, `data-lightbox`)** — Mounts `MediaFrame` from `media.<slotId>`, `portraits.<slotId>`, or `<catalogId>:<path>` (supporting both `theater.<productId>.<col>` and single-product `value.<col>` / `<col>` on catalog-backed columns).
    5. **Attributes & CSS numbers (`data-attr-<k>="<path>"`, `data-var-<k>="<path>"`)** — `data-attr-<k>` sets scalar `data-<k>` for CSS attribute selectors; `data-var-<k>` sets `--<k>` strictly when the value is a finite `number`.
  - **Host state markers**: Shadow host carries `[data-latest]` on the latest landed turn (`:host([data-latest])` in CSS); `<details data-open="latest">` opens on the latest turn and collapses on historical turns.
  - **HTML/CSS whitelist (`compileView`, lint `bad-view`)**: Allows semantic HTML, `<details>`/`<summary>`, `radio`/`checkbox` `<input>` + `<label>`, inline `<svg>` + presentation attributes (`stroke-linecap`, `stroke-dasharray`, `fill-opacity`, `vector-effect`, etc.), local `url(#id)` references, `@media`/`@supports`/`@container`/`@keyframes`, and safe CSS functions (`var`, `calc`, `min`/`max`/`clamp`, colors, gradients, 2D/3D transforms, `drop-shadow`, shapes); rejects `<script>`, `<img>`, `<a href>`, `on*`, inline `style=""`, CSS escapes, `@import`, external `url()`, and unknown functions with `line:column` diagnostics.

### 8. `Cond`, `names`, `guard`, `lexicon` & `heading`

- **`Cond` grammar:** `{ path, is }`, `{ path, op: "lt" | "lte" | "gt" | "gte", value }`, `{ all: Cond[] }`, `{ any: Cond[] }`, `{ not: Cond }`, `{ event: string }`.
  - Paths: `<field>` (or `fields.<field>`), `world.<product>.<key>`, `lore.<id>.since | shown`. Field names `fields`, `world`, `lore` are reserved (`reserved-path`).
- **`names`:** `{ user?, char?, [key]: string }` single-pass `{{key}}` dictionary (`unfilled-name` warn, `unsupported-macro` error). An unfilled hole in card-authored text passes through literally as `{{key}}` without locking turns; an unfilled hole in a player row's item drops that item.
- **`guard`:** `string[]` checked post-prose in `check`.
- **`lexicon`:** `[{ pattern, hint? }]` (`*` intra-sentence wildcard) rewritten in `polish`.
- **`heading`:** `<field>` or `<worldOrRecordProduct>.<key>` displayed as the turn's scene heading.

---

## Static Checks (`card check`) — Do Not Hand-Verify

Schema & decode enforce structural invariants automatically. Static `lint` (`packages/runtime/src/lint.ts`) checks:
`unknown-frame-slot`, `unknown-path`, `reserved-path`, `orphan-event`, `dead-field`, `prose-cannot-move`, `band-gap`, `unreachable-layer`, `hook-length`, `field-in-prose`, `inline-product`, `unfilled-name`, `unsupported-macro`, `unknown-catalog`, `duplicate-catalog-item`, `bad-view`, `bad-media-product`, `bad-media-slot`, `bad-media-url`, `bad-media-variant`, `media-focus`, `media-aspect`, `media-kind-mismatch`, `duplicate-media-binding`, `duplicate-media-slot`, `bad-section`, `bad-identifier`, `unknown-product`, `empty-greeting`, and `empty-text` (error—blocks install).
