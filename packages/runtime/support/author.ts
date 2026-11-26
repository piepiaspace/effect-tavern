/// <reference types="bun" />
// YAML is a host concern; the value report and workshop transformations also run in the browser.
import { cardIdError, checkValue } from "../src/author.ts"
import { decodeCard, type Card } from "../src/card.ts"
import { starter } from "./rows.ts"

/** A card's text as a value: YAML, and JSON with it (a JSON document is a YAML one). Not yet decoded. */
export const parseCard = (text: string): unknown => Bun.YAML.parse(text)
/** A card as the text a card file holds: `parseCard(printCard(card))` decodes to the same card. */
export const printCard = (card: Card): string => Bun.YAML.stringify(card, null, 2)
/** A card file: YAML, decoded through the Card schema. A missing file fails naming it (ENOENT, with the path). */
export const readCard = async (path: string | URL): Promise<Card> => decodeCard(parseCard(await Bun.file(path).text()))

export const checkCard = (source: string): ReturnType<typeof checkValue> => {
  try {
    return checkValue(parseCard(source), starter)
  } catch (e) {
    return {
      ...checkValue(undefined),
      diagnostics: [
        {
          rule: "schema",
          level: "error",
          path: "$",
          message: `the file is not valid YAML: ${(e instanceof Error ? e.message : String(e)).replace(/^YAML Parse error:\s*/, "")}`,
          hint: "the YAML parser names no line: check the indentation under html: | and css: | (every line indented past the key), and any unclosed quote or bracket",
        },
      ],
    }
  }
}

export const templates = ["chat", "readout", "rpg", "world"] as const
export const scaffold = (id: string, template: (typeof templates)[number]) => {
  const idError = cardIdError(id)
  if (idError) throw new Error(idError)
  const persona = template === "chat" || template === "readout"
  const card: Card = {
    id,
    title: id,
    input: template === "readout" || template === "world" ? "note" : "act",
    frame: persona ? [{ id: "persona", text: "{{user}}是来到此地的旅人。" }] : [],
    fiction: [{ id: "setting", text: "雨停了，门外传来脚步声。" }],
    greetings: [{ text: "门被轻轻推开。" }],
    rules: { fields: [], actions: [] },
    lore: [],
    guard: [],
  }
  return `# ${template}: persona=${persona}, input=${card.input}\n# frame: 玩家身份与叙事约定；fiction: 世界、人物与条件变体。\n# rules: 声明字段与动作；lore: 分层知识；guard: 叙事约束。\n# greetings[].do 可设置开场状态。使用 card check / view / test 验证。\n${Bun.YAML.stringify(card)}`
}
