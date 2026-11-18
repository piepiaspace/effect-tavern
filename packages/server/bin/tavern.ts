#!/usr/bin/env bun
// The `tavern` command: one tree, the compiled binary's entry (package.json `compile`) and `bun run tavern` from
// source. `tavern` shows help and `tavern start` serves. Settings come from cli/config.ts alone; a command
// reaches its library by itself (src/reach.ts): the tavern at --server, else the running tavern that announced itself on
// the data directory, else the library opened here. `run(argv, world)` is the whole of it, for tests.
//
// The player's commands are a tavern's life: `tavern start` holds the wake lock and opens the page on a
// terminal, `stop`, `status`, `update`, `doctor` (src/cli/). Every failure a person reads is worded by the terminal's
// tables (src/term/: `explain`, then `failure`), or is one `{"error":{code,message,next}}` line under --json; the help
// is the player's language at the terminal's width (src/cli/help.ts).
//
// Exit codes: 0 done; 1 refused or failed; 2 the command line was wrong (and `update` with nobody to ask and no
// --yes); 3 the library cannot be reached (and `status` when no tavern runs).
import { BunServices } from "@effect/platform-bun"
import { authorCommands } from "@effect-tavern/runtime/bin/card.ts"
import { Here, Json } from "@effect-tavern/runtime/bin/cli.ts"
import { unrollCommand } from "@effect-tavern/runtime/bin/unroll.ts"
import { checkCard, parseCard } from "@effect-tavern/runtime/support/author.ts"
import { runScenario } from "@effect-tavern/runtime/support/scenario.ts"
import { decodeCard } from "@effect-tavern/runtime/src/card.ts"
import { Cause, Console, Effect, Exit, Option } from "effect"
import { Argument, CliConfig, CliError, CliOutput, Command, Flag, GlobalFlag } from "effect/cli"
import { existsSync, unlinkSync } from "node:fs"
import { basename, resolve } from "node:path"
import { format } from "node:util"
import { compiled, config, processWorld, version, type Config, type Flags, type World } from "../src/cli/config.ts"
import { noDevice } from "../src/cli/device.ts"
import { doctor } from "../src/cli/doctor.ts"
import { Failed } from "../src/cli/failed.ts"
import { helpFormatter } from "../src/cli/help.ts"
import { already, showStatus, stop } from "../src/cli/lifecycle.ts"
import { fail, screenOf } from "../src/cli/say.ts"
import { update } from "../src/cli/update.ts"
import type { CliHost } from "../src/cli-host.ts"
import { play } from "../src/play.ts"
import { reach } from "../src/reach.ts"
import { start, told } from "../src/start.ts"

export type ExitCode = 0 | 1 | 2 | 3

// Anywhere on the command line, before or after the command: --data, --server, --json, -h/--help, -V/--version.
const Data = GlobalFlag.Setting("data")({
  flag: Flag.String("data").pipe(
    Flag.withDescription(`the library's directory (TAVERN_DATA; default ${compiled ? "~" : "."}/.tavern)`),
    Flag.optional,
  ),
})
const Server = GlobalFlag.Setting("server")({
  flag: Flag.String("server").pipe(
    Flag.withDescription(
      "talk to the tavern at this address, on another machine say (TAVERN_SERVER); one running on this machine is found by itself",
    ),
    Flag.optional,
  ),
})
const Version = GlobalFlag.Action({
  flag: Flag.Boolean("version").pipe(
    Flag.withAlias("V"),
    Flag.withDescription("Show the version"),
    Flag.withDefault(false),
  ),
  run: (_, { version }) => Console.log(`tavern ${version}`),
})
// effect/cli's --wizard, --completions and --log-level are left out: the built-ins are help and version only.
const builtIns = CliConfig.layer({ builtIns: [GlobalFlag.Help, Version] })

/** The client build: an asset inside the compiled binary, packages/client/dist from source. */
const dist = resolve(import.meta.dir, compiled ? "dist" : "../../client/dist")

/** What a command sets when it ends other than 0 without failing: `status` with no tavern, `doctor` with a ✗. */
interface Ending {
  code: ExitCode
}

const tree = (world: World, ending: Ending) => {
  const out = (s: string) => world.out.write(`${s}\n`)
  const note = (s: string) => world.err.write(`${s}\n`)
  const at = (file: string) => resolve(world.cwd, file)
  /** This run's settings: the global flags, what a command adds, and the environment. */
  const configured = (more: Flags) =>
    Effect.flatMap(Effect.all({ data: Data, server: Server, json: Json }), (g) =>
      Effect.try({
        try: () =>
          config(
            { data: Option.getOrUndefined(g.data), server: Option.getOrUndefined(g.server), json: g.json, ...more },
            world,
          ),
        catch: (e) => e,
      }),
    )
  const task = (f: (c: Config) => Promise<void>, more: Flags = {}) =>
    Effect.flatMap(configured(more), (c) => Effect.tryPromise({ try: () => f(c), catch: (e) => e }))
  const hosted = (f: (host: CliHost, c: Config) => Promise<void>, more?: Flags) =>
    task(async (c) => {
      const { host, at, found } = await reach(c)
      if (found) note(c.lang === "en" ? `through the tavern running at ${at}` : `经由正在运行的酒馆 ${at}`)
      try {
        await f(host, c)
      } finally {
        host.close()
      }
    }, more)
  const startFlags = {
    port: Flag.Int("port").pipe(
      Flag.withAlias("p"),
      Flag.withDescription("TCP port to listen on (TAVERN_PORT; default 7777)"),
      Flag.optional,
    ),
    bind: Flag.String("bind").pipe(
      Flag.withDescription("address to listen on (TAVERN_BIND; default 127.0.0.1)"),
      Flag.optional,
    ),
    headless: Flag.Boolean("headless").pipe(
      Flag.withDefault(false),
      Flag.withDescription("serve the HTTP+SSE API only, without the page"),
    ),
    inspect: Flag.Boolean("inspect").pipe(
      Flag.withDefault(false),
      Flag.withDescription(
        "keep request and response bodies in Inspector traces, and text in the log (TAVERN_INSPECT=1)",
      ),
    ),
    log: Flag.Literals("log", ["quiet", "turn", "detail"]).pipe(
      Flag.withDescription(
        "what the terminal shows: quiet (failures only), turn (one line a turn, the default) or detail (every call; TAVERN_LOG)",
      ),
      Flag.optional,
    ),
    open: Flag.Boolean("open").pipe(Flag.withDefault(true), Flag.withDescription("--no-open: do not open the page")),
  }
  const install = Command.make(
    "install",
    {
      file: Argument.String("file").pipe(
        Argument.withDescription("path to a .yaml card file, or one card's https link"),
      ),
    },
    ({ file }) =>
      hosted(async (host, c) => {
        const linked = /^https:\/\//i.test(file)
        const source = linked ? undefined : await Bun.file(at(file)).text()
        if (source !== undefined) {
          const report = checkCard(source)
          const errors = report.diagnostics.filter((d) => d.level === "error")
          for (const d of report.diagnostics.filter((d) => d.level !== "error"))
            note(`${d.level} ${d.path}: ${d.message}${d.hint ? `\n  hint: ${d.hint}` : ""}`)
          // refused here as the shelf's gate would refuse it: its own lines, and the shelf left as it was
          if (errors.length) {
            const id = (() => {
              try {
                const v = parseCard(source) as { id?: unknown } | null
                return typeof v?.id === "string" ? v.id : undefined
              } catch {
                return undefined
              }
            })()
            throw new Failed(
              "card-invalid",
              errors.map((d) => `${d.level} ${d.rule} ${d.path}: ${d.message}`).join("\n"),
              { file, ...(id && { card: id }) },
            )
          }
        }
        const card = source === undefined ? await host.link(file) : await host.install(source)
        out(c.json ? JSON.stringify({ id: card.id, installed: true }) : `Installed ${card.id}`)
      }),
  ).pipe(
    Command.withDescription(
      "Validate and install a card onto the shelf from a YAML file or its https link, over the card of that id",
    ),
  )
  const cardId = Argument.String("id").pipe(Argument.withDescription("installed card id"))
  const origin = (o: { via: string; depot?: string; version?: string; edited?: boolean }) =>
    [o.via === "depot" ? o.depot : o.via, o.version, o.edited ? "edited" : ""].filter(Boolean).join(" ")
  const cardList = Command.make("list", {}, () =>
    hosted(async (host, c) => {
      const rows = await host.cards()
      out(c.json ? JSON.stringify(rows) : rows.map((r) => `${r.id}\t${r.title}\t${origin(r.origin)}`).join("\n"))
    }),
  ).pipe(Command.withDescription("List the installed cards and how each reached the install"))
  const cardRemove = Command.make("remove", { id: cardId }, ({ id }) =>
    hosted(async (host, c) => {
      await host.remove(id)
      out(c.json ? JSON.stringify({ id, removed: true }) : `Removed ${id}`)
    }),
  ).pipe(Command.withDescription("Remove an installed card; refused while it has stories"))
  const output = Flag.String("output").pipe(
    Flag.withAlias("o"),
    Flag.withDescription("write candidate YAML to file instead of stdout"),
    Flag.optional,
  )
  const load = async (file: string) => decodeCard(Bun.YAML.parse(await Bun.file(at(file)).text()))
  const save = async (card: unknown, output: Option.Option<string>) => {
    const yaml = Bun.YAML.stringify(card)
    if (Option.isSome(output)) await Bun.write(at(output.value), yaml)
    else out(yaml)
  }
  const cardExport = Command.make("export", { id: cardId, output }, ({ id, output }) =>
    hosted(async (host) => {
      const text = await host.source(id)
      if (Option.isSome(output)) await Bun.write(at(output.value), text)
      else out(text)
    }),
  ).pipe(Command.withDescription("Print an installed card as a YAML card file"))
  const compile = Command.make(
    "compile",
    {
      file: Argument.String("file").pipe(Argument.withDescription("path to a .yaml card file")),
      output,
      select: Flag.String("select").pipe(
        Flag.atLeast(1),
        Flag.withDescription("card path(s) selected as context (e.g. fiction.setting, lore.letter.layers[1])"),
      ),
      intent: Flag.String("intent").pipe(Flag.withDescription("natural-language mechanism intent to compile")),
    },
    ({ file, output, select, intent }) =>
      hosted(async (host) => {
        const card = await load(file)
        const result = await host.author.compile({ card, select, intent })
        const scenario = at(file).replace(/\.ya?ml$/, "") + ".scenario.yaml"
        if (existsSync(scenario) && JSON.stringify(card.rules) !== JSON.stringify(result.candidate.rules)) {
          try {
            const steps = await runScenario(result.candidate, Bun.YAML.parse(await Bun.file(scenario).text()))
            note(`scenario: PASS ${steps.length} step(s)`)
          } catch (e) {
            note(`scenario: FAIL ${String(e)}`)
          }
        }
        for (const d of result.diagnostics) note(`${d.level} ${d.rule} ${d.path}: ${d.message}`)
        await save(result.candidate, output)
      }),
  ).pipe(
    Command.withDescription(
      "Compile rules and bindings from selected card prose and intent; leaves new prose slots empty",
    ),
  )
  const sort = Command.make(
    "sort",
    {
      file: Argument.String("file").pipe(Argument.withDescription("path to target .yaml card file")),
      source: Argument.String("source").pipe(
        Argument.withDescription("source markdown or notes file to place verbatim"),
      ),
      output,
    },
    ({ file, source, output }) =>
      hosted(async (host) => {
        const result = await host.author.sort({ card: await load(file), source: await Bun.file(at(source)).text() })
        await save(result.candidate, output)
      }),
  ).pipe(Command.withDescription("Place whole paragraphs from a source document into card slots verbatim"))
  const review = Command.make(
    "review",
    { file: Argument.String("file").pipe(Argument.withDescription("path to a .yaml card file")) },
    ({ file }) =>
      hosted(async (host, c) => {
        const { diagnostics } = await host.author.review({ card: await load(file) })
        if (c.json) out(JSON.stringify(diagnostics))
        else for (const d of diagnostics) note(`${d.level} ${d.rule} ${d.path}: ${d.message}`)
      }),
  ).pipe(Command.withDescription("Run read-only semantic consistency review and emit path-addressed warnings"))
  const card = Command.make("card").pipe(
    Command.withDescription("Cards: a file offline, the shelf, the author model"),
    Command.withSubcommands([
      ...authorCommands,
      unrollCommand,
      install,
      cardList,
      cardExport,
      cardRemove,
      compile,
      sort,
      review,
    ]),
  )

  const depotId = Argument.String("library").pipe(Argument.withDescription("card library id (see depot list)"))
  const depot = Command.make("depot").pipe(
    Command.withDescription("Card libraries: add, list, browse, take a card from one, forget"),
    Command.withSubcommands([
      Command.make(
        "add",
        {
          location: Argument.String("location").pipe(
            Argument.withDescription(
              "an https URL of a library (its index.json or the directory above it), or a local directory",
            ),
          ),
        },
        ({ location }) =>
          hosted(async (host, c) => {
            const d = await host.depots.add(/^https?:\/\//i.test(location) ? location : at(location))
            out(c.json ? JSON.stringify(d) : `Added ${d.id}\t${d.name}`)
          }),
      ).pipe(Command.withDescription("Add a card library; a directory only without --server")),
      Command.make("list", {}, () =>
        hosted(async (host, c) => {
          const rows = await host.depots.list()
          out(c.json ? JSON.stringify(rows) : rows.map((d) => `${d.id}\t${d.name}\t${d.location}`).join("\n"))
        }),
      ).pipe(Command.withDescription("List the card libraries the install knows")),
      Command.make("show", { id: depotId }, ({ id }) =>
        hosted(async (host, c) => {
          const d = await host.depots.view(id)
          out(
            c.json
              ? JSON.stringify(d)
              : d.entries
                  .map((e) => `${e.id}\t${e.title}\t${e.version ?? ""}\t${e.state}${e.edited ? " edited" : ""}`)
                  .join("\n"),
          )
        }),
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
        },
        ({ id, entry, replace }) =>
          hosted(async (host, c) => {
            const card = await host.depots.pull(id, entry, replace)
            out(c.json ? JSON.stringify({ id: card.id, installed: true }) : `Installed ${card.id}`)
          }),
      ).pipe(Command.withDescription("Copy one card of a library onto the shelf")),
      Command.make("remove", { id: depotId }, ({ id }) =>
        hosted(async (host, c) => {
          await host.depots.remove(id)
          out(c.json ? JSON.stringify({ id, removed: true }) : `Removed ${id}`)
        }),
      ).pipe(Command.withDescription("Forget a card library; the cards taken from it stay")),
    ]),
  )

  const storyId = Argument.Int("id").pipe(Argument.withDescription("numeric story id"))
  const storyRemove = (name: string) =>
    Command.make(name, { id: storyId }, ({ id }) =>
      hosted(async (host, c) => {
        await host.drop(id)
        out(c.json ? JSON.stringify({ id, removed: true }) : `Removed ${id}`)
      }),
    ).pipe(Command.withDescription("Remove a story and all of its nodes"))
  const story = Command.make("story").pipe(
    Command.withDescription("Stories: create, list, read, export, remove"),
    Command.withSubcommands([
      Command.make(
        "new",
        { card: Argument.String("card").pipe(Argument.withDescription("installed card id")) },
        ({ card }) =>
          hosted(async (host, c) => {
            const id = await host.create(card)
            out(c.json ? JSON.stringify({ id }) : String(id))
          }),
      ).pipe(Command.withDescription("Create an empty story for a card and print its id")),
      Command.make("list", {}, () =>
        hosted(async (host, c) => {
          const rows = await host.list()
          out(
            c.json
              ? JSON.stringify(rows)
              : rows.map((r) => `${r.id}\t${r.card}\t${r.title ?? ""}\t${r.turns} turns`).join("\n"),
          )
        }),
      ).pipe(Command.withDescription("List all stories in the library")),
      Command.make("show", { id: storyId }, ({ id }) =>
        hosted(async (host, c) => {
          const timeline = await host.timeline(id)
          out(
            c.json
              ? JSON.stringify(timeline)
              : [
                  `Story ${id}, head ${timeline.head ?? "root"}`,
                  ...timeline.nodes.map((n) => `#${n.id} <- ${n.parent ?? "root"} [${n.end}]\n${n.prose}`),
                ].join("\n\n"),
          )
        }),
      ).pipe(Command.withDescription("Print a story's timeline and prose (or full timeline snapshot with --json)")),
      Command.make(
        "export",
        {
          id: storyId,
          format: Flag.Literals("format", ["md", "json"]).pipe(
            Flag.withDescription("output format: md (default) or json"),
            Flag.optional,
          ),
        },
        ({ id, format }) =>
          hosted(async (host, c) => {
            if (c.json && Option.contains(format, "md")) throw new Error("--json conflicts with --format md")
            out(await host.export(id, c.json ? "json" : Option.getOrElse(format, () => "md" as const)))
          }),
      ).pipe(Command.withDescription("Export a story as Markdown or JSON")),
      storyRemove("remove"),
      // the old name, for one release
      storyRemove("delete").pipe(Command.unlisted),
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
      model: Flag.Literals("model", ["fake"]).pipe(
        Flag.withDescription("use the deterministic zero-token fake model for this run (MODEL=fake)"),
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
    ({ target, card, input, jsonl, model, greeting, set, note, user }) =>
      hosted(
        async (host) => {
          await play(host, target, {
            input: Option.getOrUndefined(input),
            jsonl,
            card,
            greeting: Option.getOrUndefined(greeting),
            set: Option.getOrUndefined(set),
            note: Option.getOrUndefined(note),
            user: Option.getOrUndefined(user),
          })
        },
        Option.isSome(model) ? { fake: true } : {},
      ),
  ).pipe(
    Command.withDescription("Play a story interactively, via --input, or from stdin (/help inside for slash commands)"),
  )

  const serving = Command.make("start", startFlags, (f) =>
    task(
      async (c) => {
        const device = world.device ?? noDevice
        const opening = c.open && (world.terminal?.err ?? false)
        if (await already(c, world, { device, opening: opening && !f.headless })) return
        await start(c, {
          dist: f.headless ? undefined : dist,
          screen: screenOf(world),
          device,
          opening,
          ...(world.signal && { signal: world.signal }),
        })
      },
      {
        port: Option.getOrUndefined(f.port),
        bind: Option.getOrUndefined(f.bind),
        inspect: f.inspect,
        log: Option.getOrUndefined(f.log),
        open: f.open,
      },
    ),
  ).pipe(Command.withDescription("Start the page and its API on this machine"))
  const stopping = Command.make("stop", {}, () => task((c) => stop(c, world))).pipe(
    Command.withDescription("Stop the tavern serving this data directory"),
  )
  const statusing = Command.make("status", {}, () =>
    task(async (c) => {
      ending.code = await showStatus(c, world)
    }),
  ).pipe(Command.withDescription("Whether a tavern serves this data directory, its address, the data, the version"))
  const updating = Command.make(
    "update",
    {
      yes: Flag.Boolean("yes").pipe(Flag.withAlias("y"), Flag.withDefault(false), Flag.withDescription("do not ask")),
      check: Flag.Boolean("check").pipe(Flag.withDefault(false), Flag.withDescription("only report")),
    },
    ({ yes, check }) =>
      task(async (c) => {
        ending.code = await update(c, world, { yes, check })
      }),
  ).pipe(Command.withDescription("Show what the latest release changes, ask, and replace this program with it"))
  const doctoring = Command.make(
    "doctor",
    { verbose: Flag.Boolean("verbose").pipe(Flag.withDefault(false), Flag.withDescription("add the raw facts")) },
    ({ verbose }) =>
      task(async (c) => {
        ending.code = await doctor(c, world, { verbose })
      }),
  ).pipe(Command.withDescription("Check the device, the command, the data, the network and the last failure"))

  return Command.make("tavern").pipe(
    Command.withDescription("Effect Tavern command-line interface."),
    Command.withSubcommands([serving, stopping, statusing, updating, doctoring, card, depot, story, playing]),
    Command.withGlobalFlags([Json, Data, Server]),
  )
}

/** The library cannot be reached (exit 3): held by another process, from a newer version, nothing answers at the
 *  tavern's address, its owner never said one, or MODEL=fake met a tavern on a real model. */
const unreachable = (e: unknown) =>
  ["library-held", "library-newer", "host-unreachable", "host-silent", "host-not-scripted"].includes(
    String((e as { code?: unknown } | null)?.code),
  )

export const run = async (given: readonly string[], world: World): Promise<ExitCode> => {
  // `tavern help` and `tavern help card` are the same as --help: including nested commands
  const argv = given[0] === "help" ? [...given.slice(1), "--help"] : given
  const lang = world.env["TAVERN_LANG"] === "en" ? "en" : "zh"
  const json = argv.includes("--json")
  const columns = () => (world.out as { columns?: number }).columns || Number(world.env["COLUMNS"]) || 80
  const base = CliOutput.defaultFormatter({ colors: false })
  const formatter = helpFormatter(base, { lang, columns, version: world.self?.version ?? version })
  const console_: Console.Console = Object.assign(Object.create(console), {
    log: (...a: unknown[]) => world.out.write(`${format(...a)}\n`),
    info: (...a: unknown[]) => world.out.write(`${format(...a)}\n`),
    error: (...a: unknown[]) => world.err.write(`${format(...a)}\n`),
    warn: (...a: unknown[]) => world.err.write(`${format(...a)}\n`),
  })
  // A wrong command line names what was wrong and where its help is, on stderr; stdout stays for results.
  const presenter = CliOutput.layerPresenter({
    present: (event) =>
      event._tag === "InvalidInvocation"
        ? Effect.sync(() =>
            world.err.write(`${base.formatErrors(event.errors)}\n> ${event.commandPath.join(" ")} --help\n`),
          )
        : CliOutput.defaultPresenter.present(event),
  })
  const ending: Ending = { code: 0 }
  const exit = await Effect.runPromiseExit(
    Command.runWith(tree(world, ending), { version: world.self?.version ?? version })(argv).pipe(
      Effect.provideService(Console.Console, console_),
      Effect.provideService(Here, world.cwd),
      Effect.provide(presenter),
      Effect.provide(CliOutput.layer(formatter)),
      Effect.provide(builtIns),
      Effect.provide(BunServices.layer),
    ),
  )
  if (Exit.isSuccess(exit)) return ending.code
  const error = Cause.squash(exit.cause)
  if (CliError.isCliError(error) && error._tag === "ShowHelp") return error.errors.length ? 2 : 0
  if (Cause.hasInterruptsOnly(exit.cause)) return 1
  // a failure to start is already on the terminal in plain words (start.ts, through the server's logbook); anything
  // else is said here, in the same words: what happened, why, the next step, the raw facts
  if (!told.has(error as object)) fail(world, error, { lang, json })
  if (unreachable(error)) return 3
  return (error as { code?: unknown } | null)?.code === "update-needs-yes" ? 2 : 1
}

if (import.meta.main) {
  const world = processWorld()
  // A 0.1.6 self-update replaces only the binary. Retire the forwarder its installer left on PATH.
  if (compiled && world.device?.kind === "termux" && basename(process.execPath) === "tavern") {
    const old = Bun.which("effect-tavern")
    const installed = Bun.which("tavern")
    if (old && installed) {
      const forward = `#!/bin/sh\nexec '${installed.replaceAll("'", "'\\''")}' "$@"\n`
      try {
        if (Bun.file(old).size === Buffer.byteLength(forward) && (await Bun.file(old).text()) === forward)
          unlinkSync(old)
      } catch {
        // A read-only old launcher is reported by tavern doctor.
      }
    }
  }
  const code = await run(Bun.argv.slice(2), world)
  if (code) process.exitCode = code
}
