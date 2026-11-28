/**
 * tableLayout — build-time Rehype (HAST) plugin that computes optimal percentage
 * column widths for every Markdown table and emits a static `<colgroup>`.
 *
 * Algorithm:
 *   1. Measure each cell's visual character width (CJK ≈ 1.85, ASCII = 1.0, code ≈ 1.08).
 *   2. Give every column a safe minimum share (bounded so total min <= 100%).
 *   3. Allocate remaining percentage points (+1% at a time) to the column whose
 *      widening most reduces total wrapped row height across the table (discrete
 *      convex optimization minimizing `sum_r max_c ceil(len[r][c] / charsAt(w_c))`).
 *
 * Zero client JS, zero CLS, eliminates unnecessary horizontal scrollbars on desktop.
 */
import type { Element, ElementContent } from "hast";

const CJK_RE = /[\u2E80-\u9FFF\uF900-\uFAFF\uFE30-\uFE4F\uFF00-\uFFEF]/;
const CONTENT_CHARS = 76; // approximate monospace/prose chars fitting 100% of --nb-content-max

function measureNode(node: ElementContent, inCode = false): number {
  if (node.type === "text") {
    let w = 0;
    const mult = inCode ? 1.08 : 1.0;
    for (const ch of node.value) {
      w += CJK_RE.test(ch) ? 1.85 : mult;
    }
    return w;
  }
  if (node.type === "element") {
    const code = inCode || node.tagName === "code";
    let w = 0;
    for (const child of node.children) w += measureNode(child, code);
    return w;
  }
  return 0;
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

function optimizeWidths(matrix: number[][], colCount: number): number[] {
  if (colCount <= 1) return [100];

  const colMax = new Array<number>(colCount).fill(4);
  for (const row of matrix) {
    for (let c = 0; c < colCount; c++) {
      const len = row[c] ?? 0;
      if (len > colMax[c]) colMax[c] = len;
    }
  }

  // Minimum floor per column: at least 10% (or scaled down for 6+ columns), capped by natural width
  const baseMin = Math.min(12, Math.floor(72 / colCount));
  const widths = new Array<number>(colCount).fill(baseMin);
  let remaining = 100 - baseMin * colCount;

  // Estimate wrapped height of the table for a given percentage vector
  const rowLines = (r: number[], w: number[]) => {
    let maxL = 1;
    for (let c = 0; c < colCount; c++) {
      const cap = Math.max(4, (w[c] / 100) * CONTENT_CHARS - 2.5);
      const lines = Math.max(1, Math.ceil((r[c] ?? 0) / cap));
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
    // Slight tie-breaker favoring proportional fit to sqrt(colMax)
    for (let c = 0; c < colCount; c++) {
      const cap = (w[c] / 100) * CONTENT_CHARS;
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
            r[c] ? measureNode(r[c]) : 0,
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
        node.children = [colgroup, ...children];
      },
    },
  };
}
