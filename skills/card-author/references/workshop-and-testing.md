# Remastering, Workshop Pipeline & Scenario Testing

## 1. Porting / Remastering SillyTavern Cards (`unroll` → `sort`)

`tavern card unroll` (`packages/runtime/bin/unroll.ts`) is a read-only inspection instrument—not an unattended converter. It expands a SillyTavern PNG (`ccv3` / `chara` chunk) or V2/V3 JSON card in ST's exact prompt assembly order so you and the author can see what the original card actually sent to the model.

```sh
bun run tavern card unroll source-card.png --user 李 > unrolled.md
bun run tavern card unroll source-card.json --json
```

Remastering workflow:

1. **Unroll & audit:** Read the unrolled blocks (`before_char`, `description`, `personality`, `scenario`, `after_char`, split `mes_example`, `first_mes` + `alternate_greetings`, depth entries, and selective trigger table) plus any unexpanded macros at the bottom.
2. **Translate legacy tavern constructs by intent—strip scaffolding, keep the art:**

| SillyTavern V2/V3 Construct                                            | Effect Tavern Target (or Discard)                                                                                                                                                                                                                                                                                                             |
| ---------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `description` / `personality` (character/cast prose)                   | `fiction` fragments (`when`-gated `Band`s when posture shifts across state)                                                                                                                                                                                                                                                                   |
| `scenario` (premise vs. scene setup)                                   | Global premise in `frame` (`setting`); counterpart scene posture in `fiction`                                                                                                                                                                                                                                                                 |
| `mes_example` (`<START>` dialogue samples)                             | Unlabelled voice-sample fragment in `fiction` (never `frame`)                                                                                                                                                                                                                                                                                 |
| `first_mes` + `alternate_greetings`                                    | `greetings[n].text`, with route-specific initial deltas moved into `greetings[n].do`                                                                                                                                                                                                                                                          |
| `character_book` `constant` ("blue light") entries                     | Always-on `fiction` fragment, or `lore` with `activation: "always"` when gated by `unlock`                                                                                                                                                                                                                                                    |
| `character_book` `selective` ("green light" keywords)                  | `lore` entry (`layers` for progressive plot secrets, `sections` for horizontal appendices; rewrite first sentence as a natural `lookup` hook, discard regex keys)                                                                                                                                                                             |
| `at_depth` (`@D0`–`@D4`), `Author's Note`, `post_history_instructions` | **Never recreate depth injection.** Map voice/register rules to `frame` slots, prohibitions to `guard`, slop lists to `lexicon`, and state-dependent reminders to `fiction` bands                                                                                                                                                             |
| Inline `<status>` bars, MVU JSON patches & regex scripts               | **Discard prompt instructions & regexes.** Model scalar axes in `rules.fields` (`actions` / `readouts`), structured state in `world` `products`, and side blocks in `theater` (one `record` call per theater product); rebuild the bar's look as a view ([views.md §10](views.md#10-porting-a-sillytavern-status-bar) maps each ST construct) |
| Anti-impersonation / jailbreak / CoT `<thinking>` walls                | **Discard.** Handled by `switches.agency` (`pov`), provider `Hat` (`/hats`), and stage separation                                                                                                                                                                                                                                             |
| `{{user}}` / `{{char}}` vs. `{{setvar}}` / `{{roll}}`                  | Keep proper-noun holes in `names`; replace stateful/random macros with `rules.fields`, `Cond`, `Effect`, and `Action.roll`                                                                                                                                                                                                                    |

3. **Architect first (Hat 1):** Scaffold target coordinates with `card init`, design `rules` / `lore` gates / `products` / `greetings[].do`, and verify with `card check`.
4. **Sort & wire:** Place verbatim source paragraphs into `frame.<slot>`, `fiction.<id>`, `greetings[n]`, or `lore.<id>.layers[n]` (manually or via `tavern card sort <card.yaml> unrolled.md -o candidate.yaml`, skipping `##` header paragraphs). Preserve the original author's character and world prose verbatim unless the user explicitly asks to rewrite.

---

## 2. Workshop CLI (`compile` / `sort` / `review`)

Contract implementation: `packages/runtime/src/workshop.ts` and `packages/server/bin/tavern.ts`.
Uses model route `routing.stages.author` (falling back to `routing.default` / env `MODEL`). A running dev or headless server on the same library is found and used by itself (no flag); `--server <url>` names a tavern on another machine.

```sh
# 1. Compile mechanism increments & bindings from selected prose + intent (leaves new prose slots empty)
bun run tavern card compile my-card.yaml \
  --select fiction.setting \
  --select 'lore.letter.layers[1]' \
  --intent 'Open letter layer 2 when bond reaches 8' \
  -o candidate.yaml

# 2. Place verbatim paragraphs from markdown notes into card slots
bun run tavern card sort my-card.yaml notes.md -o candidate.yaml

# 3. Read-only semantic consistency check (emits review:consistency warnings)
bun run tavern card review my-card.yaml --json

# 4. Validate & install into library (rejects any lint error including empty-text)
bun run tavern card install my-card.yaml
```

Key invariants:

- `compile` output schemas carry **no prose fields**: existing prose stays untouched, and new slots/rubrics remain empty (`empty-text`) for the author to fill.
- If `<card>.scenario.yaml` sits next to `<card>.yaml` and `compile` alters `rules`, `compile` automatically runs the zero-token scenario regression and prints `PASS` / `FAIL` on `stderr`.

---

## 3. Deterministic Zero-Token Testing (`scenario.yaml`)

`bun run tavern card test <card> [scenario.yaml]` runs the full `Session` pipeline under the `plain` player rows (`packages/runtime/support/rows.ts`: no player instructions and no player products, so only the card's own products are made) with zero online LLM calls. Omitting `scenario.yaml` runs a 1-turn smoke test.

```yaml
seed: 42 # first die uses seed + 1, incrementing by 1 per roll (default 0)
greeting: 0 # optional 0-based greeting index; omit to start from raw field initials
steps:
  - text: 向前走
    # note: 推进剧情
    # invoke: [card:secret]   # respects actual player access policy
    replies:
      decide:
        - { next: win } # an action id or "end"; add chance: 0.6 when that action's roll is { judge }
      narrate:
        - "你走到了门口。"
      check:
        - { fired: [secret], violated: [] }
      record:
        - notes: 已到门口 # a chronicle or theater product: its value, by product id
          answers: { warmth: close } # readout_id: option_id
          # world products: see "Scripting record" below
    expect:
      state: { hp: 2 } # partial key deep-equal against post-turn scalar fields
      events: [won] # exact ordered match
      windows: ["secret#2"] # exact ordered match of open lore windows this turn
      lore: ["secret#1", "secret#2"] # exact ordered match of confirmed disclosures
      end: end # end | over | stopped
      products: { notes: 已到门口 } # per listed product id, deep-equal
      world: { boat: { aboard: true } } # per world product id, in the shape a view sees (below)
```

Scenario rules:

- Unknown keys fail strict schema decoding.
- Omitted stage queues fall back to deterministic fake answers; any **supplied** stage queue that runs dry early or leaves unconsumed items at the end fails the test.
- Every step automatically asserts scalar field bounds and `settlementStatus === "committed"`.
- `card test` reads only the scenario file you pass; it does not look for `<card>.scenario.yaml` by itself (only `compile` does).

### Scripting `record`

One `record` reply is an object keyed by product id; it answers every `record` call of that turn (each theater product is
a separate call, and they all read from the same reply). What each value does depends on the product:

- **`theater` and `chronicle` products:** the value is the product's value this turn, in its shape (a string, a list of
  strings, a record object, or an array of table rows). A catalog-backed enum column takes a catalog item id.
- **`world` record (or text/list):** the value replaces the whole product, so give every key.
- **`world` table:** the value is an array of rows to **add**; each becomes a new entity with a host-assigned
  `entityId`. A scenario cannot patch or remove an existing row.
- **`answers`:** `{ <readout id>: <option id> }`; without it each asked readout takes its first option.
- A product id the card does not declare is ignored. A product the reply leaves out gets a deterministic default
  (a table with an enum column gets one synthesized row; anything else is left out).

```yaml
replies:
  record:
    - hut: { door: 开着, lit: false } # world record: replaced whole
      supplies: [{ name: 罐头, count: 2 }] # world table: one row inserted
      voices: # theater table, `face` is a catalog column
        - { who: 护林员, says: 东坡塌了，我从那边绕过来的。, face: ranger }
      options: [请护林员进屋, 把门关上, 重新点灯] # theater list (surface: composer)
      answers: { fire: down, sky: clear }
```

(From `skills/card-author/examples/status-view.scenario.yaml`, which plays two turns of `status-view.yaml`.)

### `expect.world`

`expect.world: { <world product id>: <partial> }` asserts the world after the step, in the shape a view sees: a record
compares only the keys given (nested records likewise); a table is matched as the array a view iterates, with the same
number of rows, each expected row matching a different actual row by the columns it gives, in any order and ignoring
`entityId`. An id that is not a world product of the card is an error.

```yaml
expect:
  world:
    hut: { door: 开着, lit: false }
    supplies: [{ name: 柴, count: 6 }, { name: 茶砖, count: 1 }, { name: 罐头, count: 2 }]
```
