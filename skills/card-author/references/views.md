# In-Stream Views (`views`) Reference

Source of truth: `packages/runtime/src/view-shell.ts`, `view-template.ts`, `view-check.ts`, `view-bindings.ts`, `packages/client/src/view-shell.tsx`.
Working examples: [examples/starter.yaml](../examples/starter.yaml) (minimal) and [examples/status-view.yaml](../examples/status-view.yaml) + [status-view.scenario.yaml](../examples/status-view.scenario.yaml) (full showcase).

## 1. Structure

A `ViewShell` renders a scriptless HTML + CSS template inside a Shadow DOM below a turn's prose. It never reaches any model.

```yaml
views:
  - id: hud
    label: 状态栏
    residency: latest # "latest" or "turn"
    consumes: [options] # theater products claimed by this view
    when: { path: weather, is: 暴雪 } # optional Cond
    consts: # optional read-only static constants ({{key}} expanded)
      quick: [{ label: 添柴, prompt: 我往炉里添了一块柴。 }]
    media: # optional state-driven or constant image slots
      - { id: scene, catalog: hut_scenes }
    css: | ...
    html: | ...
```

## 2. Data Scope

Directives take **plain dotted paths** only—no expressions, comparisons, arithmetic, negation, or `{{macros}}` inside `html`/`css`. `card check` resolves every path and type statically.

| Root                                 | Availability                 | Contents                                                                                                                                         |
| ------------------------------------ | ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| `fields.<field>`                     | `latest`, `turn`             | Raw scalar value (`6`, `"暴雪"`, `true`).                                                                                                        |
| `meta.<field>.*`                     | `latest`, `turn`             | Read-only field metadata: `label`, `min`, `max`, `ratio` (`0..1` when both `min` & `max` declared), `band`, `bandLabel` (when `bands` declared). |
| `world.<product>…`                   | `latest` only                | `role: world` products. Records read by key; lists are string arrays; tables are arrays of `{ entityId, ...columns }`.                           |
| `derived.<id>`                       | `latest` only                | Results of `rules.derived` (`count` / `sum` / `any`).                                                                                            |
| `theater.<product>…`                 | `latest`, `turn`             | That turn's `role: theater` products (readable without consuming).                                                                               |
| `consts.<key>…`                      | `latest`, `turn`             | View's own `consts` tree (arrays must have uniform element/row shapes; strings run `names` expansion).                                           |
| `media.<slot>`                       | `latest`, `turn`             | View's own `media` slot (truthy when a catalog item applies).                                                                                    |
| `names.<key>`                        | `latest`, `turn`             | `user`, `char`, and card `names`.                                                                                                                |
| `value` (and record keys)            | When `consumes` has length 1 | The single consumed product's value; if it is a record, its keys are also top-level names.                                                       |
| `<row>`, `<row>.<col>`, `<row>.$num` | Inside `data-each`           | Current item, its columns, and 1-based index.                                                                                                    |

Arrays also expose `.length` and numeric indices (`value.0`). `chronicle`, `lore`, events, and turn numbers are not in scope.

## 3. Residency & `consumes`

- **`residency: latest`** (default when `consumes` is empty): mounts only on the newest settled turn. The only residency with access to `world` and `derived`.
- **`residency: turn`** (default when `consumes` is non-empty): mounts on every turn that has a value for at least one consumed product (or every turn if `consumes` is empty), reading that turn's `fields`, `meta`, and `theater`.
- **`consumes: [ids]`**: claims `role: theater` products (including `surface: composer`). Default UI chrome hides claimed products on every turn where the view applies (`when` holds or omitted). Each product can be claimed by at most one view, and never if bound in `media.illustrations`.
  - A product consumed by a `latest` view is not shown on past turns; use a `turn` view if it should remain visible in history.
  - A `latest` view that `consumes` products must declare `residency: latest` explicitly.

## 4. Directives

| Directive                                   | Reads         | Behavior                                                                                                                                                                                                                   |
| ------------------------------------------- | ------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `data-text="<path>"`                        | scalar        | Sets plain text (ignores element children).                                                                                                                                                                                |
| `data-if="<path>"` / `data-unless="<path>"` | any           | Mounts element when truthy / falsy (`false`, `0`, `""`, `null`, missing, `[]` are falsy).                                                                                                                                  |
| `data-each="<path>" data-as="<row>"`        | list / table  | Repeats children once per item; `<row>` has no dots.                                                                                                                                                                       |
| `data-media="<source>"`                     | image binding | Renders catalog image (`media.<slot>`, `portraits.<slot>`, or `<catalog>:<path>` on a `theater` or `world` catalog column). Optional `data-fit="cover\|contain\|natural"`, `data-lightbox`. Omitted when no item resolves. |
| `data-attr-<name>="<path>"`                 | scalar        | Sets `data-<name>="<value>"` for CSS attribute selectors.                                                                                                                                                                  |
| `data-var-<name>="<path>"`                  | finite number | Sets CSS custom property `--<name>` (provide fallback `var(--name, 0)`).                                                                                                                                                   |
| `<details data-open="latest">`              | —             | Opens on newest turn, closed on past turns.                                                                                                                                                                                |
| `<button data-fill="<path>">`               | scalar        | Fills composer input on click (never sends). Enabled only on newest turn, idle, non-blank value, and resolvable accessible name (`aria-label`, text, or non-empty `data-text`).                                            |

Host carries `data-latest` on the newest turn (`:host([data-latest])`). Radio `name`s and `data-each` input `id` / label `for` are scoped automatically per turn and row.

Button constraints: `<button>` must have `data-fill` (and nothing else may); no `type` other than `button`, no `name`/`disabled` attributes; no nested interactive controls or `data-media`/`data-lightbox`. Consuming a `surface: composer` product without a `data-fill` button warns.

## 5. Patterns

See [examples/starter.yaml](../examples/starter.yaml) and [examples/status-view.yaml](../examples/status-view.yaml) for full tested snippets:

- **Normalized gauge + band styling:** Bind `data-var-ratio="meta.<f>.ratio"` and `data-attr-band="meta.<f>.band"` on the root, then use `width: calc(var(--ratio, 0) * 100%)` and `[data-band="..."]` CSS rules, with `data-text="meta.<f>.bandLabel"` for the stage badge.
- **Threshold alerts without expressions:** Prefer `Field.bands` + `[data-band="..."]`, a `when`-gated second view, or an enum + `data-attr-*`.
- **Static quick-action buttons:** Put static prompt lists in `views[].consts` and render with `data-each="consts.<key>"` + `<button data-fill="act.prompt" data-text="act.label">`, keeping `world` products clean.
- **Tabs without JS:** Hidden `<input type="radio">` + `<label for>` + `#id:checked ~ .panel` (panels must be later siblings of inputs).
- **Background image:** CSS `url()` only allows `#id`; place an absolutely positioned `data-media` element with `z-index: -1` inside an `isolation: isolate` container.
- **Images from `world` or `theater`:** Declare `{ key, type: enum, catalog: <cat> }` on the product, then bind `data-media="<cat>:world.<prod>.<key>"` (in `latest` views) or `data-media="<cat>:<row>.<key>"` (inside `data-each`). Only declared `catalog` columns authorize images.
- **Theme-aware styling:** Use `light-dark(<light>, <dark>)` and host tokens (`packages/client/src/tokens.css`): `--ink`, `--ink-2`, `--ink-3`, `--surface-1..3`, `--alpha-1..4`, `--line`, `--line-strong`, `--fill`, `--primary`, `--ok`, `--warn`, `--danger` (`-soft`), `--font-sans`, `--font-mono`, `--radius`, `--radius-sm`, `--radius-card`, `--radius-pill`, `--text-caption`, `--text-footnote`, `--text-body`, `--text-prose`.

## 6. Whitelist & Limits

- **HTML elements:** `button` (`data-fill`), `div span p section article header footer aside h1`–`h6 ul ol li dl dt dd table thead tbody tr th td strong em b i u s del ins mark ruby rt rp abbr time kbd q cite wbr small sub sup code pre blockquote hr br figure figcaption details summary label`, `input` (`type="radio"` or `"checkbox"` only), and inline `<svg>` (`g path circle ellipse rect line polyline polygon defs linearGradient radialGradient stop clipPath text tspan title desc use mask pattern`, `<use href="#id">` only). Do not mix HTML inside `<svg>` or SVG tags outside `<svg>`.
- **Attributes:** `class id title lang dir hidden aria-label aria-hidden role name for type checked open colspan rowspan`, SVG geometry/presentation attributes (`fill`/`stroke`/`stop-color` accept `#hex`, color keyword, `url(#id)`, `rgb()`/`hsl()`, or `var(--x)`), plus directives above.
- **CSS:** At-rules `@media`, `@supports`, `@container`, `@keyframes`, `@layer`; math/color/gradient/transform/filter/shape/grid functions (`var env calc min max clamp round mod rem abs sign`, trig/exp, `rgb rgba hsl hsla hwb lab lch oklab oklch color color-mix light-dark`, gradients, transforms, filters, shapes, `repeat minmax fit-content cubic-bezier steps linear counter counters`, `url(#id)`).
- **Rejected:** `<script>`, `<style>`, `<link>`, `<img>`, `<a>`, `<iframe>`, `<audio>`, `<video>`, `<canvas>`, `<form>`, text inputs, `<select>`, `<textarea>`, `style="…"`, `on*`, `href`/`src`/`srcset`, `tabindex`, non-directive `data-*`, `@import`/`@font-face`/`@property`/`@namespace`, `attr()`, `image-set()`, non-`#id` `url()`, and malformed HTML.
- **Hard limits:** No scripts, no local/`data:` images (only `https://` catalogs), no audio playback, views cannot mutate state, no `world`/`derived` on past turns, tab/fold state resets when a `latest` view moves to a new turn.

## 7. Verification Loop

```sh
skills/card-author/scripts/verify-card.sh <card.yaml> <scenario.yaml> /tmp/views.html
```

Or run steps individually:

1. `bun run tavern card check <card>` — reports exact `views.<id>.html:<line>:<col>` / `.css:` diagnostics with suggestions.
2. `bun run tavern card view <card> --views --scenario <scenario.yaml> --html /tmp/views.html` — prints mount status and every resolved binding (`--step n`, `--state k=v`, `--greeting n`, `--json`), and writes a light/dark preview page. (Theater products only exist after a turn, so script them in `scenario.yaml`.)
3. `bun run tavern card test <card> <scenario.yaml>` — locks behavior with `expect.world` and `expect.products`.

## 8. Porting a SillyTavern Status Bar

| SillyTavern                                   | Effect Tavern                                                                    |
| --------------------------------------------- | -------------------------------------------------------------------------------- |
| Regex `<style>` block                         | View `css:`                                                                      |
| Inline `style="width:{{getvar::hp}}%"`        | `data-var-ratio="meta.hp.ratio"` + `width: calc(var(--ratio, 0) * 100%)`         |
| `{{getvar::x}}` / `{{user}}` / `{{char}}`     | `fields.x` / `world.*` / `names.user` / `names.char`                             |
| JS threshold coloring                         | `Field.bands` + `data-attr-band="meta.<f>.band"` (or `when`-gated view)          |
| `<img src="…">` / CSS `background: url(…)`    | `https://` catalog + `data-media` (positioned behind content for backdrops)      |
| JS tabs / click-to-fold                       | Radio inputs + `:checked ~` / `<details data-open="latest">`                     |
| JSON blob rendered by JS                      | `world` or `theater` `table` + `data-each`                                       |
| Regex `$1` from prose                         | `theater` product consumed by the view (produced in `record`, not prose)         |
| Option buttons writing to input               | `surface: composer` list (or `consts` for static actions) + `<button data-fill>` |
| `<audio>`, `<canvas>`, timers, `localStorage` | No equivalent                                                                    |
