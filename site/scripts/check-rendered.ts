// Fails when a built page shows Markdown emphasis markers as text. CommonMark closes `**` only where it is
// "right-flanking": after punctuation it must be followed by whitespace or more punctuation, so `**读数（Readings）**视图`
// stays literal (a full-width bracket, then a letter). Chinese text has no space to offer there; write the gloss outside
// the bold instead: `**读数**（Readings）视图`. Run after `astro build`: `bun scripts/check-rendered.ts`.
// It sees only markers left as text: bold that paired with the wrong `**` and left none showing (`**甲（a）**与**乙**`
// bolds 与 inside 甲…乙) passes here; `tools/mdlint` at the root reads the source and finds those.
import { readdir, readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const dist = fileURLToPath(new URL("../dist/", import.meta.url));
const strip = (html: string, tags: string) =>
  html.replace(new RegExp(`<(${tags})\\b[\\s\\S]*?</\\1>`, "g"), " ");
const entities: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', "#39": "'", nbsp: " " };

const found: string[] = [];
let pages = 0;
const files = await readdir(dist, { recursive: true }).catch(() => [] as string[]);
for (const file of files.filter((f) => f.endsWith(".html")).sort()) {
  pages++;
  const html = await readFile(dist + file, "utf8");
  const main = /<main\b[\s\S]*?<\/main>/.exec(html)?.[0] ?? html;
  const text = strip(main, "pre|code|script|style")
    .replace(/<[^>]+>/g, "")
    .replace(/&(amp|lt|gt|quot|#39|nbsp);/g, (_, e: string) => entities[e]!);
  for (const m of text.matchAll(/\*\*/g)) {
    const at = m.index;
    found.push(`${file}: …${text.slice(Math.max(0, at - 24), at + 26).replace(/\s+/g, " ")}…`);
  }
}

if (pages === 0) {
  console.error("check-rendered: no pages under dist/; run the build first");
  process.exit(1);
}
if (found.length) {
  console.error(`check-rendered: ${found.length} emphasis marker(s) shown as text:`);
  for (const line of found) console.error("  " + line);
  console.error("  move the punctuation or the bracketed gloss outside the bold: **term**（gloss）text");
  process.exit(1);
}
console.log(`check-rendered: ${pages} pages, no emphasis markers shown as text`);
