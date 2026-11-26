// Offline authoring commands (`tavern card init|check|view|test`, run by the tree in packages/server/bin/tavern.ts);
// pure preview lives in src/view.ts. They read files against `Here` (cli.ts) and print through the tree's Console.
import { basename } from "node:path"
import { Console, Effect, FileSystem, Option, Schema } from "effect"
import { Argument, Command, Flag } from "effect/cli"
import { here, Json } from "./cli.ts"
import { checkCard, readCard, scaffold, templates } from "../support/author.ts"
import { runScenario } from "../support/scenario.ts"
import { Hat, hatToolProblem, normalizeHatDelivery } from "../src/fragment.ts"
import { stages, view } from "../src/view.ts"
import { starter } from "../support/rows.ts"

const card = Argument.String("card").pipe(Argument.withDescription("path to a .yaml card file"))
const load = (name: string) =>
  Effect.flatMap(here(name), (path) =>
    Effect.tryPromise({
      try: () => readCard(path),
      catch: (e) => (e as Error).message,
    }),
  )

/** A `.hat.json` file (the settings page's export: a hat without its id), in its one stored shape. Each way it can
 *  fail says which file, what is wrong with it and what a template file is: never the runtime's own error alone. */
const loadHat = (name: string) =>
  Effect.flatMap(here(name), (path) =>
    Effect.tryPromise({
      try: async () => {
        const said = (e: unknown) => (e instanceof Error ? e.message : String(e))
        const file = Bun.file(path)
        if (!(await file.exists()))
          throw new Error(
            `--hat ${name}: there is no file at ${path}. Give the path of a template exported from Settings (a .hat.json file).`,
          )
        let raw: unknown
        try {
          raw = JSON.parse(await file.text())
        } catch (e) {
          throw new Error(
            `--hat ${name}: the file is not JSON (${said(e)}). A template file is the .hat.json that Settings exports.`,
            { cause: e },
          )
        }
        if (!raw || typeof raw !== "object" || Array.isArray(raw))
          throw new Error(
            `--hat ${name}: the file holds JSON but not a template: a template is an object with a name, a delivery and its message slots, as Settings exports it.`,
          )
        let decoded: Hat
        try {
          decoded = Schema.decodeUnknownSync(Hat)({ name: basename(path, ".hat.json"), ...raw, id: "file" })
        } catch (e) {
          throw new Error(
            `--hat ${name}: this is not a template as Settings exports it (${said(e)}). Export it again, or correct that field.`,
            { cause: e },
          )
        }
        const hat = normalizeHatDelivery(decoded)
        const problem = hatToolProblem(hat)
        if (problem) throw new Error(`--hat ${name}: ${problem}`)
        return hat
      },
      catch: (e) => (e as Error).message,
    }),
  )

const attempt = <A>(f: () => A) => Effect.try({ try: f, catch: (e) => (e instanceof Error ? e.message : String(e)) })
const VIEW_PLACE = /^views\..+\.(?:html|css):\d+:\d+$/
const check = Command.make("check", { card }, ({ card: name }) =>
  Effect.gen(function* () {
    const json = yield* Json
    const path = yield* here(name)
    const report = yield* (yield* FileSystem.FileSystem).readFileString(path).pipe(
      Effect.match({
        onSuccess: checkCard,
        onFailure: (error): ReturnType<typeof checkCard> => ({
          diagnostics: [{ rule: "io", level: "error", path: name, message: error.message }],
          fields: [],
          fieldLines: [],
          greetings: [],
          sections: [],
          total: 0,
        }),
      }),
    )
    if (json) yield* Console.log(JSON.stringify(report))
    else {
      for (const d of report.diagnostics)
        yield* Console.log(`${d.level} ${d.rule} ${d.path}: ${d.message}${d.hint ? `\n    hint: ${d.hint}` : ""}`)
      if (report.diagnostics.some((d) => VIEW_PLACE.test(d.path)))
        yield* Console.log(
          "note: in views.<id>.html:<line>:<column> and views.<id>.css:<line>:<column>, line 1 is the first line inside the view's html: or css: block",
        )
      for (const line of [...report.fieldLines, ...report.greetings]) yield* Console.log(line)
      for (const section of report.sections.filter((s) => s.tokens))
        yield* Console.log(`${section.name} ~${section.tokens} tokens`)
      yield* Console.log(`narrate document ~${report.total} tokens`)
    }
    const errors = report.diagnostics.filter((d) => d.level === "error").length
    if (errors) return yield* Effect.fail(`${name}: ${errors} error${errors === 1 ? "" : "s"}`)
  }),
).pipe(Command.withDescription("Validate YAML, Card schema, static lint, field drawing, openings and token estimates"))
const init = Command.make(
  "init",
  {
    id: Argument.String("id").pipe(Argument.withDescription("card id; writes <id>.yaml in the current directory")),
    template: Flag.Literals("template", templates).pipe(
      Flag.withDefault("chat"),
      Flag.withDescription("coordinate scaffold: chat | readout | rpg | world"),
    ),
  },
  ({ id, template }) =>
    Effect.gen(function* () {
      const content = yield* attempt(() => scaffold(id, template))
      const path = yield* here(`${id}.yaml`)
      yield* (yield* FileSystem.FileSystem).writeFileString(path, content, { flag: "wx" })
      yield* Console.log(`Created ${id}.yaml`)
    }),
).pipe(Command.withDescription("Scaffold a new <id>.yaml card from one of the four coordinate templates"))
const test = Command.make(
  "test",
  {
    card,
    scenario: Argument.String("scenario").pipe(
      Argument.optional,
      Argument.withDescription("optional scenario.yaml with scripted replies and state/event/lore assertions"),
    ),
  },
  ({ card: name, scenario }) =>
    Effect.gen(function* () {
      const c = yield* load(name)
      const file = Option.isSome(scenario) ? yield* here(scenario.value) : undefined
      const source = file === undefined ? undefined : yield* (yield* FileSystem.FileSystem).readFileString(file)
      const value = yield* attempt(() => (source === undefined ? undefined : Bun.YAML.parse(source)))
      const results = yield* Effect.tryPromise({ try: () => runScenario(c, value), catch: (e) => String(e) })
      yield* Console.log(`PASS ${results.length} step(s), zero model tokens`)
    }),
).pipe(Command.withDescription("Run deterministic zero-token smoke or scenario assertions against the fake model"))

const show = Command.make(
  "view",
  {
    card,
    events: Flag.String("events").pipe(
      Flag.withDescription("comma-separated turn events for lore offer preview (e.g. met,won)"),
      Flag.optional,
    ),
    pin: Flag.String("pin").pipe(
      Flag.withDescription("player-invoked lore resource id for this turn (e.g. secret or card:secret)"),
      Flag.optional,
    ),
    persona: Flag.String("persona").pipe(
      Flag.withDescription("override player persona text for slot and request assembly preview"),
      Flag.optional,
    ),
    state: Flag.KeyValuePair("state").pipe(
      Flag.withDescription("field=value, set after the greeting; repeat the flag for more fields"),
      Flag.optional,
    ),
    greeting: Flag.Int("greeting").pipe(Flag.withDescription("apply greetings[n].do first (0-based)"), Flag.optional),
    stage: Flag.Literals("stage", stages).pipe(Flag.withDefault("narrate")),
    lore: Flag.Boolean("lore").pipe(
      Flag.withDescription("list every lore entry, the fully unlocked ones with no window included"),
      Flag.withDefault(false),
    ),
    hat: Flag.String("hat").pipe(
      Flag.withDescription("a .hat.json file to wear: its messages, and on narrate its delivery tool and wrap"),
      Flag.optional,
    ),
  },
  ({ card: name, state, greeting, stage, events, pin, persona, lore, hat }) =>
    Effect.gen(function* () {
      const json = yield* Json
      const c = yield* load(name)
      const worn = Option.isSome(hat) ? yield* loadHat(hat.value) : undefined
      const v = yield* Effect.try({
        try: () =>
          view(
            c,
            { ...starter, ...(Option.isSome(persona) ? { persona: { name: "你", text: persona.value } } : {}) },
            {
              state: Option.getOrUndefined(state),
              greeting: Option.getOrUndefined(greeting),
              stage,
              events: Option.getOrUndefined(events)?.split(",").filter(Boolean),
              pin: Option.getOrUndefined(pin),
              lore,
              ...(worn && { hat: worn }),
            },
          ),
        catch: (e) => (e as Error).message,
      })
      yield* Console.log(json ? JSON.stringify(v) : v.text)
    }),
).pipe(Command.withDescription("Print the stage's document at a state, sectioned, with token estimates"))

export const authorCommands = [init, check, show, test]
