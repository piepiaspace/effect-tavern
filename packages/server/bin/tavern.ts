#!/usr/bin/env bun
import { runScenario } from "@effect-tavern/runtime/support/scenario.ts"
import { Effect, Option } from "effect"
import { Argument, Command, Flag } from "effect/cli"
import { authorCommands, runCli } from "@effect-tavern/runtime/bin/card.ts"
import { checkCard } from "@effect-tavern/runtime/support/author.ts"
import { decodeCard } from "@effect-tavern/runtime/src/card.ts"
import { existsSync, readFileSync, writeFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { connect, type CliHost } from "../src/cli-host.ts"
import { start } from "../src/start.ts"
import { play } from "../src/play.ts"

const url = Flag.String("url").pipe(
  Flag.withDescription("connect to a running tavern server over HTTP/SSE instead of opening local DATA"),
  Flag.optional,
)
const json = Flag.Boolean("json").pipe(Flag.withDefault(false), Flag.withDescription("emit machine-readable JSON"))
const task = (f: () => Promise<void>) => Effect.tryPromise({ try: f, catch: (e) => String(e) })
const withHost = async (url: Option.Option<string>, work: (host: CliHost) => Promise<void>, fakeModel?: boolean) => {
  const host = await connect(Option.getOrUndefined(url), fakeModel)
  try {
    await work(host)
  } finally {
    host.close()
  }
}
const install = Command.make(
  "install",
  {
    file: Argument.String("file").pipe(Argument.withDescription("path to a .yaml card file")),
    url,
    json,
  },
  ({ file, url, json }) =>
    task(async () => {
      const source = readFileSync(file, "utf8")
      const report = checkCard(source)
      for (const d of report.diagnostics)
        console.error(`${d.level} ${d.path}: ${d.message}${d.hint ? `\n  hint: ${d.hint}` : ""}`)
      if (report.diagnostics.some((d) => d.level === "error")) throw new Error("card check failed")
      await withHost(url, async (host) => {
        const card = await host.install(source)
        console.log(json ? JSON.stringify({ id: card.id, installed: true }) : `Installed ${card.id}`)
      })
    }),
).pipe(
  Command.withDescription(
    "Validate and install a YAML card onto the shelf, over the card of that id (clears any saved draft)",
  ),
)
const cardId = Argument.String("id").pipe(Argument.withDescription("installed card id"))
const origin = (o: { via: string; depot?: string; version?: string; edited?: boolean }) =>
  [o.via === "depot" ? o.depot : o.via, o.version, o.edited ? "edited" : ""].filter(Boolean).join(" ")
const cardList = Command.make("list", { url, json }, ({ url, json }) =>
  task(() =>
    withHost(url, async (host) => {
      const rows = await host.cards()
      console.log(json ? JSON.stringify(rows) : rows.map((r) => `${r.id}\t${r.title}\t${origin(r.origin)}`).join("\n"))
    }),
  ),
).pipe(Command.withDescription("List the installed cards and how each reached the install"))
const cardRemove = Command.make("remove", { id: cardId, url, json }, ({ id, url, json }) =>
  task(() =>
    withHost(url, async (host) => {
      await host.remove(id)
      console.log(json ? JSON.stringify({ id, removed: true }) : `Removed ${id}`)
    }),
  ),
).pipe(Command.withDescription("Remove an installed card with its draft; refused while it has stories"))
const output = Flag.String("output").pipe(
  Flag.withAlias("o"),
  Flag.withDescription("write candidate YAML to file instead of stdout"),
  Flag.optional,
)
const load = (file: string) => decodeCard(Bun.YAML.parse(readFileSync(file, "utf8")))
const save = (card: unknown, output: Option.Option<string>) => {
  const yaml = Bun.YAML.stringify(card)
  if (Option.isSome(output)) writeFileSync(output.value, yaml)
  else console.log(yaml)
}
const cardExport = Command.make("export", { id: cardId, url, output }, ({ id, url, output }) =>
  task(() =>
    withHost(url, async (host) => {
      const text = await host.source(id)
      if (Option.isSome(output)) writeFileSync(output.value, text)
      else console.log(text)
    }),
  ),
).pipe(Command.withDescription("Print an installed card as a YAML card file"))
const depotId = Argument.String("library").pipe(Argument.withDescription("card library id (see depot list)"))
const depot = Command.make("depot").pipe(
  Command.withDescription("Card libraries: add, list, browse, take a card from one, forget"),
  Command.withSubcommands([
    Command.make("list", { url, json }, ({ url, json }) =>
      task(() =>
        withHost(url, async (host) => {
          const rows = await host.depots.list()
          console.log(json ? JSON.stringify(rows) : rows.map((d) => `${d.id}\t${d.name}\t${d.location}`).join("\n"))
        }),
      ),
    ).pipe(Command.withDescription("List the card libraries the install knows")),
    Command.make(
      "add",
      {
        location: Argument.String("location").pipe(
          Argument.withDescription(
            "an https URL of a library (its index.json or the directory above it), or a local directory",
          ),
        ),
        url,
        json,
      },
      ({ location, url, json }) =>
        task(() =>
          withHost(url, async (host) => {
            const d = await host.depots.add(location)
            console.log(json ? JSON.stringify(d) : `Added ${d.id}\t${d.name}`)
          }),
        ),
    ).pipe(Command.withDescription("Add a card library; a directory only without --url")),
    Command.make("show", { id: depotId, url, json }, ({ id, url, json }) =>
      task(() =>
        withHost(url, async (host) => {
          const d = await host.depots.view(id)
          console.log(
            json
              ? JSON.stringify(d)
              : d.entries
                  .map((e) => `${e.id}\t${e.title}\t${e.version ?? ""}\t${e.state}${e.edited ? " edited" : ""}`)
                  .join("\n"),
          )
        }),
      ),
    ).pipe(Command.withDescription("Read a card library's index: its cards, each against the shelf")),
    Command.make(
      "pull",
      {
        id: depotId,
        entry: Argument.String("card").pipe(Argument.withDescription("card id in the library")),
        replace: Flag.Boolean("replace").pipe(
          Flag.withDefault(false),
          Flag.withDescription("take it over a card of that id already installed (an update)"),
        ),
        url,
        json,
      },
      ({ id, entry, replace, url, json }) =>
        task(() =>
          withHost(url, async (host) => {
            const card = await host.depots.pull(id, entry, replace)
            console.log(json ? JSON.stringify({ id: card.id, installed: true }) : `Installed ${card.id}`)
          }),
        ),
    ).pipe(Command.withDescription("Copy one card of a library onto the shelf")),
    Command.make("remove", { id: depotId, url, json }, ({ id, url, json }) =>
      task(() =>
        withHost(url, async (host) => {
          await host.depots.remove(id)
          console.log(json ? JSON.stringify({ id, removed: true }) : `Removed ${id}`)
        }),
      ),
    ).pipe(Command.withDescription("Forget a card library; the cards taken from it stay")),
  ]),
)
const compile = Command.make(
  "compile",
  {
    file: Argument.String("file").pipe(Argument.withDescription("path to a .yaml card file")),
    url,
    output,
    select: Flag.String("select").pipe(
      Flag.atLeast(1),
      Flag.withDescription("card path(s) selected as context (e.g. fiction.setting, lore.letter.layers[1])"),
    ),
    intent: Flag.String("intent").pipe(Flag.withDescription("natural-language mechanism intent to compile")),
  },
  ({ file, url, output, select, intent }) =>
    task(() =>
      withHost(url, async (host) => {
        const card = load(file)
        const result = await host.author.compile({ card, select, intent })
        const scenario = file.replace(/\.ya?ml$/, "") + ".scenario.yaml"
        if (existsSync(scenario) && JSON.stringify(card.rules) !== JSON.stringify(result.candidate.rules)) {
          try {
            const steps = await runScenario(result.candidate, Bun.YAML.parse(readFileSync(scenario, "utf8")))
            console.error(`scenario: PASS ${steps.length} step(s)`)
          } catch (e) {
            console.error(`scenario: FAIL ${String(e)}`)
          }
        }
        for (const d of result.diagnostics) console.error(`${d.level} ${d.rule} ${d.path}: ${d.message}`)
        save(result.candidate, output)
      }),
    ),
).pipe(
  Command.withDescription(
    "Compile rules and bindings from selected card prose and intent; leaves new prose slots empty",
  ),
)
const sort = Command.make(
  "sort",
  {
    file: Argument.String("file").pipe(Argument.withDescription("path to target .yaml card file")),
    source: Argument.String("source").pipe(Argument.withDescription("source markdown or notes file to place verbatim")),
    url,
    output,
  },
  ({ file, source, url, output }) =>
    task(() =>
      withHost(url, async (host) => {
        const result = await host.author.sort({ card: load(file), source: readFileSync(source, "utf8") })
        save(result.candidate, output)
      }),
    ),
).pipe(Command.withDescription("Place whole paragraphs from a source document into card slots verbatim"))
const review = Command.make(
  "review",
  {
    file: Argument.String("file").pipe(Argument.withDescription("path to a .yaml card file")),
    url,
    json,
  },
  ({ file, url, json }) =>
    task(() =>
      withHost(url, async (host) => {
        const { diagnostics } = await host.author.review({ card: load(file) })
        if (json) console.log(JSON.stringify(diagnostics))
        else for (const d of diagnostics) console.error(`${d.level} ${d.rule} ${d.path}: ${d.message}`)
      }),
    ),
).pipe(Command.withDescription("Run read-only semantic consistency review and emit path-addressed warnings"))
const storyId = Argument.Int("id").pipe(Argument.withDescription("numeric story id"))
const remove = (name: "delete" | "drop", desc: string) =>
  Command.make(name, { url, id: storyId, json }, ({ url, id, json }) =>
    task(() =>
      withHost(url, async (host) => {
        await host.drop(id)
        console.log(json ? JSON.stringify({ id, deleted: true }) : `Deleted ${id}`)
      }),
    ),
  ).pipe(Command.withDescription(desc))
const story = Command.make("story").pipe(
  Command.withDescription("List, create, inspect, export or delete stories"),
  Command.withSubcommands([
    Command.make("list", { url, json }, ({ url, json }) =>
      task(() =>
        withHost(url, async (host) => {
          const rows = await host.list()
          console.log(
            json
              ? JSON.stringify(rows)
              : rows.map((r) => `${r.id}\t${r.card}\t${r.title ?? ""}\t${r.turns} turns`).join("\n"),
          )
        }),
      ),
    ).pipe(Command.withDescription("List all stories in the library")),
    Command.make(
      "new",
      {
        url,
        card: Argument.String("card").pipe(Argument.withDescription("installed card id")),
        json,
      },
      ({ url, card, json }) =>
        task(() =>
          withHost(url, async (host) => {
            const id = await host.create(card)
            console.log(json ? JSON.stringify({ id }) : String(id))
          }),
        ),
    ).pipe(Command.withDescription("Create an empty story for a card and print its id")),
    Command.make("show", { url, id: storyId, json }, ({ url, id, json }) =>
      task(() =>
        withHost(url, async (host) => {
          const timeline = await host.timeline(id)
          console.log(
            json
              ? JSON.stringify(timeline)
              : [
                  `Story ${id}, head ${timeline.head ?? "root"}`,
                  ...timeline.nodes.map((n) => `#${n.id} ← ${n.parent ?? "root"} [${n.end}]\n${n.prose}`),
                ].join("\n\n"),
          )
        }),
      ),
    ).pipe(Command.withDescription("Print a story's timeline and prose (or full timeline snapshot with --json)")),
    remove("delete", "Delete a story and all of its nodes"),
    remove("drop", "Alias for story delete"),
    Command.make(
      "export",
      {
        url,
        id: storyId,
        json,
        format: Flag.Literals("format", ["md", "json"]).pipe(
          Flag.withDescription("output format: md (default) or json"),
          Flag.optional,
        ),
      },
      ({ url, id, format, json }) =>
        task(() =>
          withHost(url, async (host) => {
            if (json && Option.contains(format, "md")) throw new Error("--json conflicts with --format md")
            console.log(await host.export(id, json ? "json" : Option.getOrElse(format, () => "md" as const)))
          }),
        ),
    ).pipe(Command.withDescription("Export a story as Markdown or JSON")),
  ]),
)
const playing = Command.make(
  "play",
  {
    target: Argument.String("card-or-story").pipe(
      Argument.withDescription("numeric story id to resume, or card id to start a new story"),
    ),
    card: Flag.Boolean("card").pipe(
      Flag.withDefault(false),
      Flag.withDescription("treat target as a card id, including numeric ids"),
    ),
    url,
    model: Flag.Literals("model", ["fake"]).pipe(
      Flag.withDescription("use the deterministic zero-token fake model for this run"),
      Flag.optional,
    ),
    input: Flag.String("input").pipe(
      Flag.withDescription("run a single line or slash command (/greet, /act, /note, ...) and exit"),
      Flag.optional,
    ),
    jsonl: Flag.Boolean("jsonl").pipe(
      Flag.withDefault(false),
      Flag.withDescription("stream one JSON event per line on stdout"),
    ),
    greeting: Flag.Int("greeting").pipe(
      Flag.withDescription("open the new story on greetings[n] (0-based)"),
      Flag.optional,
    ),
    set: Flag.KeyValuePair("set").pipe(
      Flag.withDescription("field=value on a `start` field when the story opens; repeat the flag for more fields"),
      Flag.optional,
    ),
    note: Flag.String("note").pipe(Flag.withDescription("a note to the narrator for the opening"), Flag.optional),
    user: Flag.String("user").pipe(
      Flag.withDescription("the player's name on this card ({{user}}), kept for its later stories"),
      Flag.optional,
    ),
  },
  ({ target, card, url, input, jsonl, model, greeting, set, note, user }) =>
    task(() =>
      withHost(
        url,
        (host) =>
          play(host, target, {
            input: Option.getOrUndefined(input),
            jsonl,
            card,
            greeting: Option.getOrUndefined(greeting),
            set: Option.getOrUndefined(set),
            note: Option.getOrUndefined(note),
            user: Option.getOrUndefined(user),
          }),
        Option.isSome(model) ? true : undefined,
      ),
    ),
).pipe(
  Command.withDescription("Play a story interactively, via --input, or from stdin (/help inside for slash commands)"),
)
const serving = Command.make(
  "serve",
  {
    port: Flag.Int("port").pipe(
      Flag.withDefault(Number(process.env["PORT"] ?? 7777)),
      Flag.withDescription("TCP port to listen on (default: PORT env or 7777)"),
    ),
    inspect: Flag.Boolean("inspect").pipe(
      Flag.withDefault(process.env["TAVERN_INSPECT"] === "1"),
      Flag.withDescription("Include request and response bodies in Inspector traces"),
    ),
    headless: Flag.Boolean("headless").pipe(
      Flag.withDefault(false),
      Flag.withDescription("serve HTTP+SSE endpoints only, without static client assets"),
    ),
  },
  ({ port, headless, inspect }) =>
    task(() =>
      start({
        port,
        inspect,
        dist: headless ? undefined : fileURLToPath(new URL("../../client/dist/", import.meta.url)),
      }),
    ),
).pipe(Command.withDescription("Start the tavern HTTP/SSE server (serves client/dist too unless --headless)"))
const cli = Command.make("tavern").pipe(
  Command.withDescription(
    "Effect Tavern CLI: card toolchain & workshop, card libraries, story management, terminal play and server",
  ),
  Command.withSubcommands([
    Command.make("card").pipe(
      Command.withDescription(
        "Author, check, preview, test, compile, sort, review, install, list, export and remove cards",
      ),
      Command.withSubcommands([...authorCommands, install, cardList, cardExport, cardRemove, compile, sort, review]),
    ),
    depot,
    story,
    playing,
    serving,
  ]),
)
await runCli(cli)
