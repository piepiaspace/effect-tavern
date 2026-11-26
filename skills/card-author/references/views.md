# In-Stream Views (`views`): Status Bars, Panels & Option Buttons

Read this before writing or porting any status bar, HUD, panel, letter, or option list that should appear in the story
column. Source of truth: `packages/runtime/src/view-shell.ts` (the declaration), `view-template.ts` (the whitelist and
markup checks), `view-check.ts` (binding checks), `view-bindings.ts` (the data scope), `packages/client/src/view-shell.tsx`
(the renderer). The complete working card is [`../examples/status-view.yaml`](../examples/status-view.yaml) with its
scenario [`../examples/status-view.scenario.yaml`](../examples/status-view.scenario.yaml); every snippet below is taken
from it or was checked by `tavern card check` inside it.

## 1. What a View Is

A view (a `ViewShell`, one entry of the card's `views`) is a small HTML template plus a stylesheet that the client
draws inside the story column, below a turn's prose. It never reaches a model. It runs no script: the client fills the
template from the turn's data through six `data-*` directives (§4), inside a Shadow DOM, so the view's CSS styles only
the view.

```yaml
views:
  - id: hud # unique per card
    label: 小屋状态 # optional human name for the view
    residency: latest # "latest" or "turn" (see §3)
    consumes: [options] # theater products this view draws instead of the default chrome (see §3)
    when: { path: weather, is: 暴雪 } # optional Cond: the view applies only on turns where it holds
    media: # optional image slots (see §6)
      - { id: scene, catalog: hut_scenes }
    css: | # optional
      .hud { padding: 10px 14px; }
    html: |
      <section class="hud" data-each="value" data-as="o"><button data-fill="o" data-text="o"></button></section>
```

## 2. The Data Scope: What a Path Can Read

Every directive takes a **plain dotted path** into the scope below. A path that leads nowhere renders as nothing, which
is why templates that "passed" older checks rendered empty; `tavern card check` now resolves every path against the
card and reports a wrong one with a "did you mean".

| Path starts with                        | What it is                                                                                                                                                                                                                                                                                                          |
| --------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `fields.<field>`                        | A field's current **raw value** (`6`, `"暴雪"`, `true`). A field's `min`, `max`, `label` and enum `options` are **not** readable: write a gauge's maximum into the CSS (`/ 10`).                                                                                                                                    |
| `world.<product>…`                      | A `role: world` product, **only in a `residency: latest` view**. A record is read by its keys (`world.hut.door`); a list is an array of strings; a **table is an array of rows `{ entityId, ...columns }`** (`data-each="world.supplies"`), although its `initial` in the card is written as `{ <entityId>: row }`. |
| `theater.<product>…`                    | This turn's `role: theater` products (including `surface: composer` ones). A view may read any of them without consuming it.                                                                                                                                                                                        |
| `media.<slot>`                          | The view's own `media` slot: the catalog item picked for it, truthy when one of the catalog's items has a `when` that holds (or no `when`). Used by `data-media` and `data-if`.                                                                                                                                     |
| `names.<key>`                           | `names.user` (the player character's name when one is given), `names.char`, and every key of the card's `names`.                                                                                                                                                                                                    |
| `value`, and a record's keys            | Only when `consumes` lists **exactly one** product: `value` is that product's value on this turn; if it is a record, each of its keys is also a top-level name (`<key>` = `value.<key>`).                                                                                                                           |
| `<row>`, `<row>.<column>`, `<row>.$num` | Inside an element with `data-each="…" data-as="<row>"`: the current item, its columns, and its 1-based position.                                                                                                                                                                                                    |

An array also answers `.length` (`value.length`) and a numbered item (`value.0`).

**Not in scope at all:** `chronicle` products, `lore`, events, the turn number, any field's bounds or labels. A view
that needs one of these needs a field or a world/theater product that carries it.

`fields` and `theater` in a `latest` view are the newest turn's; in a `turn` view they are that turn's own.

## 3. Residency and Consumption: Where a View Appears

- **`residency: latest`** (the default when `consumes` is empty): the view mounts only on the newest turn, once that
  turn's `record` has settled, and moves to each new turn. It is the **only** kind that receives `world`.
- **`residency: turn`** (the default when `consumes` lists anything): the view mounts on every turn that has a value for
  at least one of its consumed products (a `turn` view with no `consumes` mounts on every turn), and reads that turn's
  `fields` and `theater`. A path under `world` in a `turn` view is a check error.
- **`consumes: [ids]`** claims `role: theater` products, including `surface: composer` ones. A claimed product is never
  drawn by the default chrome (the gray 小剧场 box, or the option chips above the input) **on any turn where the view
  applies** (it has no `when`, or its `when` holds on that turn), whether or not the view is mounted there. Each product
  may be claimed by one view only. A product bound in `media.illustrations` cannot be consumed.

The consequence you choose between:

- A HUD that should show only on the newest turn → `residency: latest`, reading `fields`, `world` and this turn's `theater`.
- Something that should remain on every past turn (a letter, a post, a radio message) → its own `residency: turn` view
  that consumes that product.
- A product consumed by a `latest` view is **not shown on past turns** at all: the view is gone from them and the default
  chrome leaves the product alone. Its value stays stored on the turn, and a `surface: theater` product stays listed in
  that turn's 小剧场 menu (asking again replaces the value), but nothing draws it there. If it should stay visible in
  history, give it to a `turn` view instead.

A `latest` view that `consumes` something must say `residency: latest` explicitly, since `consumes` makes `turn` the
default. The example's `hud` does this for the composer `options`.

## 4. Directives

Six directives: `data-text`, `data-if` / `data-unless`, `data-each` with `data-as`, `data-media` (with `data-fit` and
`data-lightbox`), `data-attr-*` / `data-var-*`, and `data-fill` on a `<button>`; plus `data-open="latest"` on a
`<details>`.

| Directive                                   | Reads             | Does                                                                                                                                                                                                                                                                                                      |
| ------------------------------------------- | ----------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `data-text="<path>"`                        | a scalar          | Sets the element's text (plain text, never HTML). An object or array shows nothing. The element's own children are not drawn.                                                                                                                                                                             |
| `data-if="<path>"` / `data-unless="<path>"` | anything          | Mounts the element only when the value is truthy / falsy. Falsy: `false`, `0`, `""`, `null`, missing, and an empty array.                                                                                                                                                                                 |
| `data-each="<path>" data-as="<row>"`        | a list or a table | Repeats the element's **children** once per item; the element itself is drawn once, as the container. Both attributes are required together; the row name has no dots.                                                                                                                                    |
| `data-media="<source>"`                     | an image binding  | Draws a catalog image in the element (§6). Optional `data-fit="cover"` (default), `"contain"` or `"natural"`, and `data-lightbox` (click to enlarge). The element is not drawn without a hit.                                                                                                             |
| `data-attr-<name>="<path>"`                 | a scalar          | Writes `data-<name>="<value>"` on the element, for CSS attribute selectors (`[data-weather="暴雪"]`).                                                                                                                                                                                                     |
| `data-var-<name>="<path>"`                  | a finite number   | Sets the CSS variable `--<name>` on the element; anything else leaves it unset (write `var(--name, 0)`).                                                                                                                                                                                                  |
| `<details data-open="latest">`              | —                 | Open on the newest turn, closed on past ones. A plain `open` attribute is also allowed.                                                                                                                                                                                                                   |
| `<button data-fill="<path>">`               | a scalar          | A click puts the value into the input box; it **never sends**. The button is enabled only on the newest turn, with no turn in flight, when the value is not blank (spaces only count as blank), and when it has a name with this turn's data (below); otherwise it is drawn disabled (style `:disabled`). |

The host element carries `data-latest` on the newest turn, so `:host([data-latest]) …` styles the newest turn apart.

Rules the check enforces:

- **There are no expressions.** No comparisons (`fields.hp < 20`), arithmetic, negation (`!x`), formatting, filters, or
  `{{macros}}`; a `{{…}}` in a view's html (outside an HTML comment) or css (outside a CSS comment) is an error,
  because a view is never name-filled. Compare by choosing the data (§5).
- Every `<button>` must have `data-fill` (and `data-fill` sits on nothing else) and a name a player and an agent can
  find it by: a non-blank `aria-label`, words inside it, or a `data-text` on it or inside it, none of it under
  `hidden` or `aria-hidden="true"`. On the turn, the name is what the button shows with that turn's data (an
  `aria-label`, else its text, leaving out what `data-if` / `data-unless` hide), so a button whose only words come from
  an empty `data-text` is drawn disabled. `type` other than `button`, `name`, and `disabled` are rejected on a button
  (the host sets `type` and `disabled`).
- A button holds words, nothing interactive or media: no `<button>`, `<input>`, `<label>`, `<details>` or `<summary>`
  inside it, and no `data-media` or `data-lightbox` on it or inside it (put an image beside the button).
- A view that consumes a `surface: composer` product but has no `data-fill` button is warned: its options would be drawn
  but could not be chosen.
- Radio `name`s are made unique per turn and per view, and inside `data-each` an input's `id` and its label's `for`
  are made unique per row, so tabs work on every turn and in every row.

## 5. Working Patterns

All from `examples/status-view.yaml` unless marked otherwise.

**Progress bar (gauge).** Bind the number, divide by the maximum you know:

```html
<section class="hud" data-attr-weather="fields.weather" data-var-warmth="fields.warmth">
  <div class="gauge" role="meter" aria-label="炉温"><span class="fill"></span></div>
```

```css
.gauge {
  position: relative;
  height: 6px;
  margin: 8px 0;
  border-radius: var(--radius-pill);
  background: var(--alpha-2);
  overflow: hidden;
}
.fill {
  position: absolute;
  inset: 0 auto 0 0;
  width: calc(var(--warmth, 0) / 10 * 100%);
  background: var(--ok);
}
```

**"Turn red under 20%" without a comparison.** Three ways, pick one:

1. `clamp()` on the variable: a red layer whose opacity is 1 at warmth 0 and 1 and 0 from 2 up.

   ```css
   .fill::after {
     content: "";
     position: absolute;
     inset: 0;
     background: var(--danger);
     opacity: clamp(0, 2 - var(--warmth, 0), 1);
   }
   ```

2. A second view gated by `when` (`Cond` has `lt` / `lte` / `gt` / `gte`; checked in a card):

   ```yaml
   - id: cold_alert
     label: 炉火将熄
     when: { path: warmth, op: lt, value: 2 }
     css: |
       p { margin: 0; color: var(--danger); }
     html: |
       <p>炉火快熄了：<span data-text="fields.warmth"></span> / 10</p>
   ```

3. An enum or boolean field set by a readout, then `data-attr-*` (next pattern).

**Enum → colour.** `data-attr-weather="fields.weather"` on the section above, then:

```css
.hud[data-weather="暴雪"] {
  background: light-dark(#e6edf5, #18202b);
}
.hud[data-weather="晴"] {
  background: light-dark(#fbf3df, #262014);
}
```

**Tabs without script.** Radio inputs, labels, and `:checked ~` (the panels must be later siblings of the inputs):

```html
<div class="tabs">
  <input type="radio" name="tab" id="tab-room" checked />
  <label for="tab-room">屋内</label>
  <input type="radio" name="tab" id="tab-store" />
  <label for="tab-store">存货</label>
  <div class="panel room">
    <div class="panel store">
```

```css
.tabs input {
  position: absolute;
  opacity: 0;
}
.tabs input:checked + label {
  background: var(--alpha-2);
  color: var(--ink);
}
.panel {
  display: none;
  padding-top: 8px;
}
#tab-room:checked ~ .room,
#tab-store:checked ~ .store {
  display: block;
}
```

**Folding.** `<details>` / `<summary>`; `data-open="latest"` opens it on the newest turn only (useful in a `turn` view):

```html
<details data-open="latest">
  <summary>电台 · <span data-text="value.length"></span> 段 · 窗外<span data-text="fields.weather"></span></summary>
```

**Iterating a world table** (in a `latest` view; each row also has `entityId`):

```html
<ul data-each="world.supplies" data-as="item">
  <li><span data-text="item.name"></span> × <span data-text="item.count"></span></li>
</ul>
```

**Iterating a theater table** the view consumes (`value` is the one consumed product), with the row number:

```html
<ul data-each="value" data-as="voice">
  <strong><span data-text="voice.$num"></span>. <span data-text="voice.who"></span></strong>
  <p data-text="voice.says"></p>
```

A product the view does not consume reads the same way as `data-each="theater.<product>"`.

**An image chosen by state.** A catalog whose items carry `when`; the first item that holds is the slot's image:

```yaml
- id: hut_scenes
  kind: image
  baseUrl: https://media.example.org/snowline/scenes
  items:
    - { id: clear, label: 晴夜, when: { path: weather, is: 晴 }, variants: [clear.webp] }
    - { id: storm, label: 暴雪, when: { path: weather, is: 暴雪 }, variants: [storm.webp] }
    - { id: snow, label: 风雪, variants: [snow.webp] }
```

The view declares the slot (`media: [{ id: scene, catalog: hut_scenes }]`) and draws it:

```html
<div class="scene" data-media="media.scene" data-lightbox></div>
```

**An image the model picks, inside `data-each`.** A theater table column `{ key: face, type: enum, catalog: faces }`
makes `record` choose a `faces` item id per row; `<catalog>:<path>` draws it:

```html
<div class="face" data-media="faces:voice.face" data-lightbox></div>
```

Only `role: theater` products (read as `theater.<id>` or `value`) can carry a model-picked image into a view.

**A constant image.** A one-item catalog without `when`, bound to a slot (`media: [{ id: crest, catalog: crest }]`):

```yaml
- id: crest
  kind: image
  baseUrl: https://media.example.org/snowline
  items:
    - { id: map, label: 山口地图, variants: [map.webp], aspect: 3 / 2 }
```

**A background image.** CSS `url()` accepts only `#id`, so put a `data-media` element behind the content:

```html
<div class="backdrop" data-media="media.crest" data-fit="cover"></div>
```

```css
.hud {
  position: relative;
  isolation: isolate;
  overflow: hidden;
  padding: 10px 14px;
  border-radius: var(--radius-card);
  background: light-dark(#f4f1ea, #1d1b18);
  box-shadow: inset 0 0 0 1px var(--line);
}
.backdrop {
  position: absolute;
  inset: 0;
  z-index: -1;
  opacity: 0.12;
}
```

**Options as buttons.** Consume the `surface: composer` list (so the default chips step aside) and draw each item as a
fill button:

```html
<div class="moves" data-each="value" data-as="move">
  <button data-fill="move" data-text="move"></button>
</div>
```

```css
.moves button {
  padding: 4px 10px;
  border: 0;
  border-radius: var(--radius-pill);
  background: var(--fill);
}
.moves button:disabled {
  opacity: 0.5;
}
```

**Colours that follow the theme.** The page sets `color-scheme`, so `light-dark(<light>, <dark>)` picks the side the
player chose; the app's design tokens also reach a view. Ones you can rely on (defined in
`packages/client/src/tokens.css`): `--ink`, `--ink-2`, `--ink-3` (text); `--surface-1`, `--surface-2`, `--surface-3`
(backgrounds); `--alpha-1` … `--alpha-4`, `--line`, `--line-strong`, `--fill` (washes and borders); `--primary`, `--ok`,
`--warn`, `--danger` and their `-soft` forms (`--ok-soft`, `--warn-soft`, `--danger-soft`); `--font-sans`, `--font-mono`;
`--radius`, `--radius-sm`, `--radius-card`, `--radius-pill`; `--text-caption`, `--text-footnote`, `--text-body`,
`--text-prose`. There is no `--font-prose`: the story's prose is set in `--font-sans` at `--text-prose`.

```css
:host {
  display: block;
  font-family: var(--font-sans);
  color: var(--ink);
}
```

## 6. Images (`media` slots and catalogs)

- A catalog used by a view needs `kind: image` (or no `kind`), an `https://` `baseUrl`, and `variants` that are
  relative file names; when an item has several variants, one is picked per turn from the turn's seed. Items may carry
  `label` (the image's name), `focus: [x, y]` (0..1, the point to keep when cropped) and `aspect: "W / H"` (0.25..4).
- `data-media` sources: `media.<slot>` (the view's own slot), `portraits.<slot>` (a slot of the card's
  `media.portraits`), or `<catalog>:<path>` (a theater column declared with `catalog: <catalog>`).
- There are no local files, no `data:` URLs, and no `<img>`: an image comes from a catalog or not at all.

## 7. What the Check Allows (the whitelist)

**Elements:** `button` (with `data-fill`), `div span p section article header footer aside h1`–`h6 ul ol li dl dt dd
table thead tbody tr th td strong em b i u s del ins mark ruby rt rp abbr time kbd q cite wbr small sub sup code pre
blockquote hr br figure figcaption details summary label`, `input` (`type="radio"` or `"checkbox"` only), and inline
SVG: `svg`, and inside it `g path circle ellipse rect line polyline polygon defs linearGradient radialGradient stop
clipPath text tspan title desc use mask pattern` (`<use href="#id">` only). The two sets do not mix: an SVG element
outside an `<svg>` is an error (it would be an unknown HTML element; `<title>` would even be another element), and so
is an HTML element inside one (it would be a dead SVG node; write SVG `<text>`, or close the `</svg>` first).

**Attributes:** `class id title lang dir hidden aria-label aria-hidden role name for type checked open colspan rowspan`,
SVG geometry and presentation attributes (`viewBox width height x y … d fill stroke stroke-width … transform
text-anchor font-size …`), and the directives above. `fill`, `stroke` and `stop-color` take `#hex`, a colour keyword,
`url(#id)`, a numeric `rgb()` / `hsl()`, or `var(--x)` with one of those as fallback.

**CSS:** at-rules `@media`, `@supports`, `@container`, `@keyframes`, `@layer`; functions `var env calc min max clamp
round mod rem abs sign` and the trigonometric/exponential ones, colour functions (`rgb rgba hsl hsla hwb lab lch oklab
oklch color color-mix light-dark`), gradients (linear, radial, conic, and their repeating forms), transforms (`translate*
rotate* scale* skew* perspective matrix matrix3d`), filters (`blur brightness contrast drop-shadow grayscale hue-rotate
invert opacity saturate sepia`), shapes (`inset polygon circle ellipse path rect xywh ray`), `repeat minmax fit-content
cubic-bezier steps linear counter counters`, and `url(#id)`.

**Rejected, each with a hint in the report:** `<script>`, `<style>` (use `css:`), `<link>`, `<img>`, `<a>`, `<iframe>`,
`<audio>`, `<video>`, `<canvas>`, `<form>`, text inputs, `<select>`, `<textarea>`, and any element not listed;
`style="…"`, every `on*` handler, `href` / `src` / `srcset`, `tabindex`, any static `data-*` that is not a directive
(use a class); in CSS `@import`, `@font-face`, `@property`, `@namespace` and any other at-rule, `attr()`, `image-set()`
and any function not listed, any `url()` but `url(#id)`, and a backslash escape outside a string. Markup the browser
would repair (an unclosed element, a stray end tag, a `<div>` inside a `<p>`, text directly in a `<table>`) is reported
too.

## 8. The Feedback Loop

1. **Write** the view in the card (start from `examples/status-view.yaml`).
2. **Check:** `bun run tavern card check <card>`. Each view problem is reported as `views.<id>.html:<line>:<column>`
   (or `.css:`), where line 1 is the first line inside the `html: |` or `css: |` block, with a `hint` saying what to
   write instead. Paths are resolved against the card (`cuont is not a key of item … did you mean item.count?`), and
   types are checked (a `data-var-*` on an enum, a `data-each` on a record). Reading `theater.<id>` or `names.<key>`
   the card does not declare is a warning: a player's writing pack may supply it, but the card cannot rely on it.
   A file that is not valid YAML (often a line under `html: |` or `css: |` indented less than the block) is one error
   under rule `schema` at path `$`, before any view is read.
3. **Preview offline:** `bun run tavern card view <card> --views --scenario <card>.scenario.yaml --html /tmp/views.html`.
   It prints, per view, whether it mounts on that turn (and why not), and what every binding resolved to
   (`→ "暴雪"`, `→ [3 rows]`, `undefined (nothing at this path)`); a `data-fill` line says what a press would put in
   the input box, or why the button is disabled there (not the newest turn, nothing but blank at its path, or no name
   with that data). Then it writes a static page drawing each mounted view, its buttons enabled or disabled the same way.
   Other flags: `--step <n>` (the turn after step n), `--state k=v`, `--greeting <n>`, `--json`. Without
   `--scenario` it reads the opening, where no theater product exists yet: theater products appear only after a turn,
   so script them in a scenario (`references/workshop-and-testing.md` §3). A product with `on: false` or
   `trigger: demand` is made only when the player asks, so no scenario produces it.
4. **Open the page** in a browser and look at it in light and dark (the page has a toggle).
5. **Lock it:** `bun run tavern card test <card> <scenario>`; `expect.world` asserts the world a view reads.
6. **Install:** `bun run tavern card install <card>` and play.

## 9. Limits (do not spend time on these)

- No script of any kind, and no self-contained HTML page or attachment: a view is a template plus CSS.
- Images only from `https://` catalogs; no local files, no `data:` URLs, no CSS background URLs.
- No audio in a view. `media.bgm` is a runtime contract (a product picks a track per turn) with no player in the
  client yet: nothing plays it.
- A view cannot write state. A `data-fill` button only fills the input box; the player still sends.
- Tab and fold state is the reader's and resets when a `latest` view moves to the new turn.
- No `world` data on past turns: only the newest turn's `latest` views receive it.
- No fonts beyond the host's (`--font-sans`, `--font-mono`).

## 10. Porting a SillyTavern Status Bar

| SillyTavern                                                | Here                                                                                     |
| ---------------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| `<style>` block in the regex output                        | the view's `css:`                                                                        |
| inline `style="width:{{getvar::hp}}%"`                     | `data-var-hp="fields.hp"` and `width: calc(var(--hp, 0) / <max> * 100%)` in `css:`       |
| `{{getvar::x}}`                                            | a `rules.fields` field (moved by a readout) or a `world` product, shown with `data-text` |
| `{{user}}` / `{{char}}`                                    | `data-text="names.user"` / `data-text="names.char"`                                      |
| `<img src="…">`                                            | a catalog item and `data-media`                                                          |
| CSS `background: url(…)`                                   | a positioned `data-media` element behind the content                                     |
| JS tabs                                                    | radio inputs + `:checked ~` in CSS                                                       |
| click-to-fold                                              | `<details>` / `<summary>` (`data-open="latest"`)                                         |
| a JSON blob rendered by JS                                 | a `table` product (world or theater) and `data-each`                                     |
| a regex capture `$1` from the model's reply                | a theater product the view consumes; the model writes it in `record`, not in the prose   |
| JS threshold colouring                                     | `clamp()` on a `data-var-*`, a `when`-gated view, or an enum field + `data-attr-*`       |
| option buttons that write into the input box               | a `surface: composer` list consumed by the view, drawn with `<button data-fill>`         |
| Google Fonts `@import`                                     | `var(--font-sans)` / `var(--font-mono)`                                                  |
| `<audio>`, `<canvas>`, timers, text inputs, `localStorage` | no equivalent                                                                            |

Also remove the prompt instructions that asked the model to print the bar: state reaches the view through fields and
products, and `card check` flags a card that asks the narrator for it (`inline-product`).
