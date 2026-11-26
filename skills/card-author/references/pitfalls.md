# Card Design Invariants & Reference Cards

## 1. Readout & Band Invariants

1. **Name observable deeds in readout options, not internal psychology.** In restrained prose, unspoken feelings remain implicit and `record` defaults to the neutral option. Phrase options around concrete scene behavior (`accepts the token`, `presses for details`, `changes the subject`).
2. **Keep `fiction` bands descriptive of current posture, not prescriptive of readout outcomes.** If a low-affinity band instructs the character to deflect every approach, `narrate` obeys and the field cannot advance. Describe present tension and leave room for player action.
3. **Include an in-flight neutral option on latching readouts.** When a readout's `when` matches a `lore` `offer` threshold, `record` evaluates it on the turn the topic is raised—before the player replies. Cover `raised this turn, awaiting player's answer` in the neutral option so `record` does not falsely latch `refused`. Verify with `bun run tavern card view <card> --stage record --state <field>=<threshold>`.
4. **Match write authority to gameplay intent.** Fields written only by `rules.actions` are purely mechanical; attach a `readout` whenever narrative events should move a field (`prose-cannot-move` lint).

## 2. Openings, `frame` Isolation & Hooks

1. **Set `Field.initial` to the lowest baseline shared across greetings; put route-specific deltas in `greetings[n].do`.** (Including `world` patches when openings start in different places or times.) Verify per-greeting state, active bands, and turn-1 windows in `card check` output.
2. **Keep character sheets out of `frame`.** Non-writing `frame` slots enter `<world>` on every off-stage pass (`lookup`, `decide`, `direct`). Put characters, casts, and world prose in `fiction` (`narrate` only); keep `frame` for `persona`, `pov`, `setting`, `voice`, `style`, `language`, and `verbosity`.
3. **Write lore hooks as natural first sentences.** `layers[0]`'s first sentence (and each `section`'s first sentence) is what `lookup` scans—write how a player refers to the topic, not keyword lists.

## 3. Live-Verified Reference Cards

Inspect these cards for concrete YAML idioms:

- **`skills/card-author/examples/starter.yaml`** — Minimal neutral template (`bands`/`meta`, `derived`, `consts`, `world` + `theater`, `views`).
- **`skills/card-author/examples/status-view.yaml`** — Full `ViewShell` showcase (`latest` HUD + `turn` history view, catalogs, tabs, `data-fill`, `derived`, `consts`).
- **`packages/runtime/test/cards/banxing.yaml`** — Pure chat (`participant mode`, no rules/lore, `fiction` voice samples).
- **`packages/runtime/test/cards/ri.yaml`** — Multi-stage affection (`Field.bands` + `meta.*`, `views[].consts`, `hidden` route switches, 3 greetings, latching readout, `director: true`, expression/portrait catalogs).
- **`packages/runtime/test/cards/wuxia.yaml`** — Full RPG + memory (`actions` with rolls, readout-driven `bond`, 3-layer `lore`, `world` record + `world` table with `recall`, `guard`).
- **`packages/runtime/test/cards/yandao.yaml`** — `author mode` (`input: "note"`, no `persona`, card-supplied `pov`, greeting-triggered window).
- **`samples/life-of-pi/life-of-pi.yaml`** — Multi-day time loop (`passages`, `digest` epoch `boundary`, cooldown band, `end: true`).
