// The reader's play sheet on a phone (#223): the strip's `card › story ▾` opens it over the story, a short sheet at
// the thumb. Its head names the card and story in full. The upper block is the install's routing as the settings
// page's 默认模型 words it (connections.ts): by stage off, the main model and the default template; by stage on, the
// narrate stage's model and template, each able to follow the main one, which the row then names. The lower block is
// this story's persona and this card's writing (the drawer's workspace rows, stories.ts `personaLine` and switches.ts
// `writingLine`), and a light foot leads to the prompt tree, the Inspector on the line's last node and the settings.
// A pick on a menu is written at once and the sheet stays; the persona picker rises over it and returns to it; a row
// that opens a page closes it. While a turn runs the menus and the persona are held (the server reads the routing at
// every stage call, so a change mid-turn would split it); the rest stays open to read. It is the phone's alone: the
// shell mounts it only under 72rem, and nothing it imports is a page the app loads lazily.
import { createMemo, For, onCleanup } from "solid-js"
import { read } from "./bridge.ts"
import {
  conflictText,
  HAT_NONE,
  hatLabel,
  hatOptions,
  mainConflicts,
  modelOptions,
  pairKey,
  pairLabel,
  pairOf,
  stageConflicts,
  stageHatValue,
  staleHatOption,
  staleModelOption,
  withDefaultPair,
  withMainHat,
  withStageHat,
  withStagePair,
} from "./connections.ts"
import { dialogHandle, type DialogHandle, Menu } from "./controls.tsx"
import { openPicker } from "./dialogs.tsx"
import { Jump, Probe, Settings, Stack, User, Write } from "./icons.tsx"
import { open } from "./pages.ts"
import { openPromptTree } from "./prompt-tree-state.ts"
import { Sheet } from "./readings.tsx"
import { openSettings } from "./settings-navigation.ts"
import { personaLine } from "./stories.ts"
import {
  card as cardAtom,
  cards,
  focus,
  hats,
  isFreeChat,
  locals,
  page,
  path,
  personas,
  providers,
  routing,
  stories,
  working,
} from "./store.ts"
import { writingLine } from "./switches.ts"
import { putRouting } from "./wire.ts"
import { t } from "./i18n.ts"

// the mounted sheet's handle: one per mount, so a sheet the viewport took away (wide again) is not reopened by it
let current: DialogHandle | undefined
/** Opens the play sheet; with none mounted (the desktop) it does nothing. */
export const openPlaySheet = (): void => void current?.open()
/** Closes it, for a way out of the reader taken from over it (the persona picker's 管理人设). */
export const closePlaySheet = (): void => void current?.close()

export const PlaySheet = (props: { card: string; story: string; unnamed: boolean }) => {
  const sheet = dialogHandle()
  current = sheet
  onCleanup(() => {
    if (current === sheet) current = undefined
  })
  const list = read(providers)
  const route = read(routing)
  const hatList = read(hats)
  const busy = read(working)
  const line = read(path)
  const lib = read(stories)
  const at = read(focus)
  const view = read(cardAtom)
  const people = read(personas)
  const allLocals = read(locals)
  const shelf = read(cards)
  const pg = read(page)
  const pairs = createMemo(() => modelOptions(list()))
  const hatChoices = createMemo(() => hatOptions(hatList()))
  const byStage = () => !!route().stages
  const freeChat = () => isFreeChat(shelf().find((c) => c.id === at()) ?? at(), shelf())
  // what following the main model or template resolves to, named in the follow row and so on its trigger
  const mainModel = () => pairLabel(list(), route().default) ?? t("settings.unset")
  const mainHat = () => hatLabel(hatList(), route().hat) ?? t("settings.noHat")
  const narrateLabel = () => t("settings.stageNarrate")
  const conflicts = () =>
    byStage() ? stageConflicts(list(), hatList(), route(), "narrate") : mainConflicts(list(), hatList(), route())
  /** A way to a page: the sheet goes first, so the page is not opened under it. */
  const leave = (go: () => void) => {
    sheet.close()
    go()
  }
  return (
    <Sheet
      controller={sheet}
      fit
      heading={
        <span class="play-names">
          <span class="c">{props.card}</span>
          <span class="sep" aria-hidden="true">
            {" › "}
          </span>
          <span class={{ s: true, unnamed: props.unnamed }}>{props.story}</span>
        </span>
      }
      footer={
        <footer class="play-foot">
          <button
            type="button"
            class="btn ghost"
            disabled={lib()?.current == null}
            onClick={() =>
              leave(() => openPromptTree({ cardId: at(), storyId: lib()?.current ?? undefined, play: true }))
            }
          >
            <Stack aria-hidden="true" />
            <span>{t("side.promptTree")}</span>
          </button>
          <button
            type="button"
            class="btn ghost"
            disabled={line().length === 0}
            onClick={() => {
              const id = line().at(-1)?.id
              if (id !== undefined) leave(() => open({ inspect: id }))
            }}
          >
            <Probe aria-hidden="true" />
            <span>{t("side.inspector")}</span>
          </button>
          <button type="button" class="btn ghost" onClick={() => leave(() => openSettings())}>
            <Settings aria-hidden="true" />
            <span>{t("play.allSettings")}</span>
            <Jump aria-hidden="true" />
          </button>
        </footer>
      }
    >
      <div class="play scroller">
        <div class="play-route">
          <div class="play-field">
            <span class="lbl">{byStage() ? t("play.narrateModel") : t("settings.mainModel")}</span>
            <Menu
              label={byStage() ? t("play.narrateModel") : t("settings.mainModel")}
              placeholder={t("settings.unset")}
              disabled={busy()}
              value={
                byStage()
                  ? route().stages?.narrate
                    ? pairKey(route().stages!.narrate!)
                    : ""
                  : route().default && pairKey(route().default!)
              }
              options={
                byStage()
                  ? [{ value: "", label: t("play.followMainModel", { model: mainModel() }) }, ...pairs()]
                  : pairs()
              }
              stale={staleModelOption(list(), byStage() ? route().stages?.narrate : route().default)}
              onPick={(k) =>
                void putRouting(
                  byStage() ? withStagePair("narrate", k ? pairOf(k) : undefined) : withDefaultPair(pairOf(k)),
                )
              }
            />
          </div>
          <div class="play-field">
            <span class="lbl">
              {byStage() ? t("settings.stageHat", { stage: narrateLabel() }) : t("settings.mainHat")}
            </span>
            <Menu
              label={byStage() ? t("settings.stageHat", { stage: narrateLabel() }) : t("settings.mainHat")}
              disabled={busy()}
              value={byStage() ? stageHatValue(route(), "narrate") : (route().hat ?? "")}
              options={
                byStage()
                  ? [
                      { value: "", label: t("play.followMainHat", { hat: mainHat() }) },
                      { value: HAT_NONE, label: t("settings.noHat") },
                      ...hatChoices(),
                    ]
                  : [{ value: "", label: t("settings.noHat") }, ...hatChoices()]
              }
              stale={staleHatOption(hatList(), byStage() ? route().stageHats?.narrate : route().hat)}
              onPick={(v) => void putRouting(byStage() ? withStageHat("narrate", v) : withMainHat(v || undefined))}
            />
          </div>
          <For each={conflicts()}>{(c) => <div class="warn">{conflictText(c)}</div>}</For>
        </div>
        <div class="play-story">
          <button type="button" class="play-row" disabled={busy() || at() === null} onClick={openPicker}>
            <span class="lbl">
              <User aria-hidden="true" />
              <span>{t("common.persona")}</span>
            </span>
            <span class="val">{personaLine(people(), lib(), view(), at(), pg())}</span>
          </button>
          <button
            type="button"
            class="play-row"
            disabled={at() === null}
            aria-label={freeChat() ? t("writing.freeChatTitle") : undefined}
            onClick={() => leave(() => open("writing"))}
          >
            <span class="lbl">
              <Write aria-hidden="true" />
              <span>{freeChat() ? t("side.freeChatWriting") : t("side.writing")}</span>
            </span>
            <span class="val">{writingLine(view(), allLocals(), at())}</span>
          </button>
        </div>
      </div>
    </Sheet>
  )
}
