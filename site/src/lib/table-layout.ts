/**
 * tableLayout — build-time Rehype (HAST) plugin that computes optimal percentage
 * column widths for every Markdown table and emits a static `<colgroup>`.
 *
 * Algorithm:
 *   1. Measure each cell's visual character width (CJK ≈ 1.85, ASCII = 1.0, code ≈ 1.04 + badge pad)
 *      and its longest unbreakable non-CJK token so English words and short code identifiers
 *      (e.g. `greetings`, `passages`, `rules.readouts`) are not split mid-word.
 *   2. Give every column a safe minimum share covering its longest unbreakable token
 *      (bounded so total min <= 85%, leaving room for height optimization).
 *   3. Allocate remaining percentage points (+1% at a time) to the column whose
 *      widening most reduces total wrapped row height and any residual word-break penalty.
 *
 * Zero client JS, zero CLS, eliminates unnecessary horizontal scrollbars on desktop.
 */
import type { Element, ElementContent } from "hast";

const CJK_RE = /[\u2E80-\u9FFF\uF900-\uFAFF\uFE30-\uFE4F\uFF00-\uFFEF]/;
const NON_CJK_RUN_RE = /[^\s\u2E80-\u9FFF\uF900-\uFAFF\uFE30-\uFE4F\uFF00-\uFFEF]+/g;
const CONTENT_CHARS = 76; // approximate monospace/prose chars fitting 100% of --nb-content-max
const CELL_PAD_CHARS = 3.6; // ~28px horizontal td padding (0.875rem * 2) in char units
const CODE_PAD_CHARS = 1.4; // inline <code> horizontal padding in char units
const MAX_TOKEN_FLOOR = 18; // cap floor per token so long URLs/paths still wrap instead of starving siblings

interface CellMeasure {
  len: number;
  maxToken: number;
}

function measureNode(node: ElementContent, inCode = false): CellMeasure {
  if (node.type === "text") {
    let len = 0;
    const mult = inCode ? 1.04 : 1.0;
    for (const ch of node.value) {
      len += CJK_RE.test(ch) ? 1.85 : mult;
    }
    let maxToken = 0;
    for (const m of node.value.matchAll(NON_CJK_RUN_RE)) {
      const tokenLen = m[0].length * mult + (inCode ? CODE_PAD_CHARS : 0);
      if (tokenLen > maxToken) maxToken = tokenLen;
    }
    return { len, maxToken };
  }
  if (node.type === "element") {
    const isCode = node.tagName === "code";
    const code = inCode || isCode;
    let len = isCode ? CODE_PAD_CHARS : 0;
    let maxToken = 0;
    for (const child of node.children) {
      const m = measureNode(child, code);
      len += m.len;
      if (m.maxToken > maxToken) maxToken = m.maxToken;
    }
    return { len, maxToken };
  }
  return { len: 0, maxToken: 0 };
}

function collectRows(table: Element): Element[][] {
  const rows: Element[][] = [];
  const walk = (el: Element) => {
    for (const child of el.children) {
      if (child.type !== "element") continue;
      if (child.tagName === "tr") {
        const cells = child.children.filter(
          (c): c is Element => c.type === "element" && (c.tagName === "th" || c.tagName === "td"),
        );
        if (cells.length > 0) rows.push(cells);
      } else if (child.tagName === "thead" || child.tagName === "tbody" || child.tagName === "tfoot") {
        walk(child);
      }
    }
  };
  walk(table);
  return rows;
}

function optimizeWidths(matrix: CellMeasure[][], colCount: number): number[] {
  if (colCount <= 1) return [100];

  const colMax = new Array<number>(colCount).fill(4);
  const colMaxToken = new Array<number>(colCount).fill(0);
  for (const row of matrix) {
    for (let c = 0; c < colCount; c++) {
      const cell = row[c];
      if (!cell) continue;
      if (cell.len > colMax[c]) colMax[c] = cell.len;
      const capped = Math.min(cell.maxToken, MAX_TOKEN_FLOOR);
      if (capped > colMaxToken[c]) colMaxToken[c] = capped;
    }
  }

  // Minimum floor per column: cover the column's longest unbreakable token (up to 28%),
  // scaled proportionally if the table has many columns so >= 15% remains for optimization.
  const baseMin = Math.min(12, Math.floor(72 / colCount));
  const rawMin = colMaxToken.map((tok) => {
    const tokenPct = tok > 0 ? Math.ceil(((tok + CELL_PAD_CHARS) / CONTENT_CHARS) * 100) : baseMin;
    return Math.max(baseMin, Math.min(tokenPct, 28));
  });
  const totalRawMin = rawMin.reduce((a, b) => a + b, 0);
  const widths = [...rawMin];
  if (totalRawMin > 85) {
    const excessTotal = rawMin.reduce((s, v) => s + Math.max(0, v - baseMin), 0);
    const allowedExcess = Math.max(0, 85 - baseMin * colCount);
    for (let c = 0; c < colCount; c++) {
      const ex = Math.max(0, rawMin[c] - baseMin);
      widths[c] = baseMin + (excessTotal > 0 ? Math.floor((ex * allowedExcess) / excessTotal) : 0);
    }
  }
  let remaining = 100 - widths.reduce((a, b) => a + b, 0);

  // Estimate wrapped height of the table for a given percentage vector
  const rowLines = (r: CellMeasure[], w: number[]) => {
    let maxL = 1;
    for (let c = 0; c < colCount; c++) {
      const cap = Math.max(4, (w[c] / 100) * CONTENT_CHARS - CELL_PAD_CHARS);
      const lines = Math.max(1, Math.ceil((r[c]?.len ?? 0) / cap));
      if (lines > maxL) maxL = lines;
    }
    return maxL;
  };

  const totalCost = (w: number[]) => {
    let sum = 0;
    for (let i = 0; i < matrix.length; i++) {
      // Weight body rows 1.0, header row 1.4 so headers stay tidy
      sum += rowLines(matrix[i], w) * (i === 0 ? 1.4 : 1.0);
    }
    // Penalize any remaining mid-word break and tie-break gently toward colMax
    for (let c = 0; c < colCount; c++) {
      const cap = Math.max(1, (w[c] / 100) * CONTENT_CHARS - CELL_PAD_CHARS);
      if (colMaxToken[c] > cap) sum += (colMaxToken[c] - cap) * 1.5;
      if (colMax[c] > cap) sum += (colMax[c] - cap) * 0.012;
    }
    return sum;
  };

  while (remaining > 0) {
    let bestCol = 0;
    let bestCost = Infinity;
    for (let c = 0; c < colCount; c++) {
      widths[c] += 1;
      const cost = totalCost(widths);
      widths[c] -= 1;
      if (cost < bestCost) {
        bestCost = cost;
        bestCol = c;
      }
    }
    widths[bestCol] += 1;
    remaining -= 1;
  }

  return widths;
}

export function tableLayout() {
  return {
    name: "et:table-layout",
    element: {
      filter: ["table"],
      visit(node: Element) {
        const children = node.children ?? [];
        const hasColgroup = children.some(
          (c) => c.type === "element" && c.tagName === "colgroup",
        );
        if (hasColgroup) return;
        const rows = collectRows(node);
        const colCount = rows.reduce((m, r) => Math.max(m, r.length), 0);
        if (colCount < 2) return;
        const matrix = rows.map((r) =>
          Array.from({ length: colCount }, (_, c) =>
            r[c] ? measureNode(r[c]) : { len: 0, maxToken: 0 },
          ),
        );
        const widths = optimizeWidths(matrix, colCount);
        const colgroup: Element = {
          type: "element",
          tagName: "colgroup",
          properties: {},
          children: widths.map((w) => ({
            type: "element",
            tagName: "col",
            properties: { style: `width:${w}%` },
            children: [],
          })),
        };
        return {
          ...node,
          children: [colgroup, ...children],
        };
      },
    },
  };
}
