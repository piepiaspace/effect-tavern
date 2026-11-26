# Remastering, Workshop CLI & Scenario Testing

## 1. Porting SillyTavern V2/V3 Cards (`unroll` → `sort`)

`tavern card unroll` is a read-only inspection tool that prints a SillyTavern PNG (`ccv3`/`chara`) or V2/V3 JSON card in ST's assembly order:

```sh
bun run tavern card unroll source-card.png --user 李 > unrolled.md
bun run tavern card unroll source-card.json --json
```

Target mapping (preserve author prose verbatim; strip single-completion scaffolding):

| SillyTavern Construct                                  | Effect Tavern Target                                                                                                                                                  |
| ------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `description` / `personality`                          | `fiction` fragments (`when`-gated bands for state-dependent posture)                                                                                                  |
| `scenario`                                             | Global premise in `frame` (`setting`); scene posture in `fiction`                                                                                                     |
| `mes_example` (`<START>`)                              | Unlabelled voice-sample fragment in `fiction`                                                                                                                         |
| `first_mes` + `alternate_greetings`                    | `greetings[n].text`, with per-opening deltas in `greetings[n].do`                                                                                                     |
| `character_book` `constant`                            | Always-on `fiction`, or `lore` with `activation: "always"` when `unlock`-gated                                                                                        |
| `character_book` `selective`                           | `lore` (`layers` for progressive secrets, `sections` for horizontal appendices; natural first-sentence hook; drop regex keys)                                         |
| `at_depth`, Author's Note, `post_history_instructions` | Voice/register → `frame`; prohibitions → `guard`; slop → `lexicon`; state reminders → `fiction` bands                                                                 |
| Inline `<status>` bars, MVU JSON, regexes              | Scalar axes → `rules.fields`; structured state → `world` products; side blocks → `theater`; UI → `views` ([views.md §8](views.md#8-porting-a-sillytavern-status-bar)) |
| Anti-impersonation / CoT `<thinking>` walls            | Handled by `switches.agency` (`pov`), `Hat`, and stage separation; omit                                                                                               |
| `{{user}}` / `{{char}}` vs. `{{setvar}}` / `{{roll}}`  | Proper nouns → `names`; stateful/random macros → `rules.fields`, `Cond`, `Effect_`, `Action.roll`                                                                     |

Workflow: `unroll` → build Hat 1 skeleton (`card init` or copy `examples/starter.yaml`) → place verbatim paragraphs manually or via `tavern card sort` → verify with `scripts/verify-card.sh`.

## 2. Workshop CLI (`compile` / `sort` / `review`)

Uses model route `routing.stages.author` (falling back to `routing.default` / `MODEL`). Auto-discovers a local running server, or pass `--server <url>`. Run `--help` on any subcommand for full flags.

- `tavern card compile <card> --select <path> --intent "<text>" -o <out>` — compiles rules/bindings only; output schema carries no prose fields (new slots stay empty as `empty-text`). If `<card>.scenario.yaml` sits beside `<card>.yaml` and `rules` change, runs zero-token scenario regression automatically.
- `tavern card sort <card> <notes.md> -o <out>` — places whole paragraphs verbatim into `frame`, `fiction`, `greetings`, or `lore` slots.
- `tavern card review <card> --json` — read-only semantic consistency check (`review:consistency` warnings).
- `tavern card install <card>` — validates and installs (blocks on any lint error including `empty-text`).

## 3. Deterministic Zero-Token Testing (`scenario.yaml`)

`bun run tavern card test <card> [scenario.yaml]` runs the full `Session` pipeline under `plain` player rows with zero LLM calls (omitting `scenario.yaml` runs a 1-turn smoke test).

```yaml
seed: 42 # first die uses seed + 1, incrementing per roll (default 0)
greeting: 0 # 0-based greeting index; omit to start from raw field initials
steps:
  - text: 向前走
    # note: 推进剧情
    # invoke: [card:secret]
    replies:
      decide:
        - { next: win } # action id or "end"; add chance: 0.6 for { judge } rolls
      narrate:
        - "你走到了门口。"
      check:
        - { fired: [secret], violated: [] }
      record:
        - notes: 已到门口 # chronicle/theater value by product id
          hut: { door: 开着, lit: false } # world record: full replacement
          supplies: [{ name: 罐头, count: 2 }] # world table: rows to insert
          answers: { warmth: close } # readout_id: option_id
    expect:
      state: { hp: 2 } # partial deep-equal on post-turn scalar fields
      events: [won] # exact ordered match
      windows: ["secret#2"] # exact ordered match of open lore windows
      lore: ["secret#1", "secret#2"] # exact ordered match of confirmed disclosures
      end: end # end | over | stopped
      products: { notes: 已到门口 } # deep-equal per listed product id
      world: { hut: { door: 开着 }, supplies: [{ name: 罐头, count: 2 }] }
```

Rules:

- Unknown keys fail strict decoding; every supplied stage queue must be consumed completely without running dry.
- Every step asserts scalar bounds and `settlementStatus === "committed"`.
- In `replies.record`, one object answers all `record` calls of the turn: `theater`/`chronicle` take their value directly; `world` records replace whole; `world` tables insert each listed row with a host-assigned `entityId`.
- In `expect.world`, records match partially by given keys; tables match exact row count in any order, comparing given columns and ignoring `entityId`.
- Complete working example: [examples/status-view.scenario.yaml](../examples/status-view.scenario.yaml).
