// compileView's whitelist (#248): what a view may write, and the fetch and escape paths that stay shut.
import assert from "node:assert/strict"
import { compileView, inspectView } from "../src/view-template.ts"

const css = (rule: string) => () => compileView({ html: "<p></p>", css: rule })
const html = (markup: string) => () => compileView({ html: markup })

for (const rule of [
  ":host { color-scheme: inherit; } .card { background: light-dark(#fcf7eb, #26221b); color: light-dark(rgb(0 0 0), white); }",
  ".x { filter: brightness(1.1) contrast(0.9) grayscale(0.2) hue-rotate(10deg) invert(0) opacity(0.8) saturate(1.2) sepia(0.3); }",
  ".x { transform: perspective(200px) rotateX(10deg) rotateY(5deg) rotateZ(1deg) rotate3d(1, 1, 0, 4deg) translateZ(2px) scaleZ(1) matrix(1, 0, 0, 1, 0, 0) matrix3d(1,0,0,0,0,1,0,0,0,0,1,0,0,0,0,1); }",
  ".x { width: calc(round(nearest, 10.4px, 1px) + mod(7px, 3px) + rem(7px, 3px) + abs(-1px) * sign(2)); }",
  ".x { rotate: calc(atan2(1, 2) + asin(0.5) + acos(0.5) + atan(1)); scale: calc(sin(1rad) + cos(1rad) + tan(0.1rad) + pow(2, 2) + sqrt(4) + hypot(3, 4) + log(8) + exp(0)); }",
  ".x { padding-top: env(safe-area-inset-top, 0px); }",
  "ol { counter-reset: n; } li::before { counter-increment: n; content: counter(n) '. ' counters(n, '.'); }",
  ".x { color: hwb(10 20% 30%); background: lab(50% 20 30); border-color: lch(50% 30 40); }",
  ".x { clip-path: path('M0 0 L10 10 Z'); offset-path: ray(45deg closest-side); }",
  ".x { clip-path: xywh(0 0 100% 50%); } .y { clip-path: rect(0 10px 10px 0); }",
  ".x { transition: opacity 200ms linear(0, 0.5 50%, 1); }",
  "@layer base, theme; @layer base { .x { color: red } }",
  '.dot::before { content: "\\2022"; } .q::after { content: "\\"" }',
  '.x { font-family: "Noto \\53 erif"; }',
  ".x { mask: url(#m); fill: url( '#grad' ); }",
])
  assert.doesNotThrow(css(rule), rule)

for (const [rule, message] of [
  // The modern typed attr() can turn a model-written data-attr-* value into a URL.
  [".x { content: attr(data-weather); }", /function attr\(\)/],
  [".x { background: url(https://x.example/a.png); }", /url\(https:\/\/x\.example\/a\.png\)/],
  [".x { background: url('https://x.example/a.png'); }", /url\(https:\/\/x\.example\/a\.png\)/],
  [".x { background: image('a.png'); }", /function image\(\)/],
  [".x { background: image-set('a.png' 1x); }", /function image-set\(\)/],
  [".x { background: -webkit-image-set('a.png' 1x); }", /function -webkit-image-set\(\)/],
  [".x { background: src('a.png'); }", /function src\(\)/],
  [".x { background: element(#a); }", /function element\(\)/],
  [".x { background: paint(worklet); }", /function paint\(\)/],
  [".x { background: cross-fade(url(#a), url(#b)); }", /function cross-fade\(\)/],
  [".x { background: -webkit-cross-fade(url(#a), url(#b), 50%); }", /function -webkit-cross-fade\(\)/],
  ["@import 'x.css';", /@import/],
  ["@font-face { font-family: x; src: local(x); }", /@font-face/],
  ["@namespace svg 'http://www.w3.org/2000/svg';", /@namespace/],
  ["@property --x { syntax: '<color>'; inherits: false; initial-value: red; }", /@property/],
  ["@scope (.a) { .b { color: red } }", /@scope/],
  // Escapes outside a string: each spells something past the name checks to a browser.
  ["p { background: \\75 rl(https://x.example/a.png); }", /escape outside a string at 1:17$/],
  ["p { background: u\\72l(https://x.example/a.png); }", /escape outside a string/],
  ["p { background: url(\\68ttps://x.example/a.png); }", /escape outside a string/],
  ["@\\69mport 'x.css';", /escape outside a string at 1:1$/],
  ["p { background: im\\61ge-set('a.png' 1x); }", /escape outside a string/],
  ["p { content: \\61ttr(data-x); }", /escape outside a string/],
  ["p\\:x { color: red; }", /escape outside a string/],
  ["/* \\ */ p { color: red; }", /escape outside a string/],
  // A string's escape decodes in the Url node, so it is checked as the URL a browser would fetch.
  ['p { background: url("\\68ttps://x.example/a.png"); }', /url\(https:\/\/x\.example\/a\.png\)/],
  ['@import "\\61.css";', /@import/],
] as const)
  assert.throws(css(rule), message, rule)

for (const markup of [
  "<p><u>u</u><s>s</s><del>d</del><ins>i</ins><mark>m</mark><abbr title='abbr'>a</abbr><time>t</time><kbd>k</kbd><q>q</q><cite>c</cite>a<wbr>b</p>",
  "<ruby>漢<rp>(</rp><rt>kan</rt><rp>)</rp></ruby>",
  "<p lang='en' dir='rtl' hidden>x</p>",
  "<svg viewBox='0 0 10 10'><title>t</title><desc>d</desc><text x='5' y='5' dx='1' dy='1' text-anchor='middle' dominant-baseline='central' font-size='4' font-weight='600' font-family='serif' letter-spacing='0.1'>a<tspan dx='1'>b</tspan></text></svg>",
  "<svg><defs><path id='leaf' d='M0 0L1 1'/></defs><use href='#leaf' x='2' y='2'/></svg>",
  "<svg><defs><mask id='m' maskUnits='userSpaceOnUse' maskContentUnits='userSpaceOnUse'><rect width='10' height='10' fill='white'/></mask><pattern id='p' width='4' height='4' patternUnits='userSpaceOnUse' patternContentUnits='userSpaceOnUse' patternTransform='rotate(45)'><circle r='1' fill='black'/></pattern></defs><rect mask='url(#m)' fill='url(#p)'/></svg>",
  ...[
    "rgb(10, 20, 30)",
    "rgba(10,20,30,0.5)",
    "rgb(10 20 30 / 50%)",
    "hsl(120deg 50% 50%)",
    "hsla(120, 50%, 50%, .5)",
    "var(--ink)",
    "var(--ink, #333)",
    "var(--ink, currentColor)",
    "var(--ink, rgb(1 2 3))",
    "var(--ink, url(#grad))",
  ].map((v) => `<svg><path fill="${v}" stroke="${v}"/><stop stop-color="${v}"/></svg>`),
])
  assert.doesNotThrow(html(markup), markup)

for (const markup of [
  "<a href='#x'>a</a>",
  "<img src='x'>",
  "<button>b</button>",
  "<form></form>",
  "<audio></audio>",
  "<video></video>",
  "<canvas></canvas>",
  "<iframe></iframe>",
  "<style>p{}</style>",
  "<script></script>",
  "<p tabindex='0'>x</p>",
  "<p style='color:red'>x</p>",
  "<p onclick='x'>x</p>",
  "<blockquote cite='https://x.example'>x</blockquote>",
  // The new SVG names stay SVG-only.
  "<title>t</title>",
  "<text>t</text>",
  "<svg><use href='https://x.example/s.svg#a'/></svg>",
  "<svg><use href='s.svg#a'/></svg>",
  "<svg><use href='#a b'/></svg>",
  "<svg><use xlink:href='#a'/></svg>",
  "<svg><use/><path href='#a'/></svg>",
  "<svg><pattern id='p' href='#q'></pattern></svg>",
  "<svg><rect mask='url(https://x.example/m.svg#m)'/></svg>",
  "<svg><rect mask='url(#m) red'/></svg>",
  "<svg><animate attributeName='fill'/></svg>",
  "<svg><set attributeName='fill' to='red'/></svg>",
  "<svg><foreignObject><p>x</p></foreignObject></svg>",
  "<svg><image href='#a'/></svg>",
  "<svg><a href='#a'><rect/></a></svg>",
  "<svg><filter id='f'></filter></svg>",
  ...[
    "url(https://x.example/a.svg#g)",
    "var(--ink, url(https://x.example/a.svg#g))",
    "var(--ink, var(--line))",
    "rgb(var(--r), 0, 0)",
    "rgb(1 2 3) url(#a)",
    "hsl(calc(1), 50%, 50%)",
    "attr(data-x)",
    "light-dark(red, blue)",
  ].map((v) => `<svg><path fill="${v}"/></svg>`),
  // Inside <svg> only SVG elements: an HTML name there would be a dead SVG-namespace node.
  ...["section", "details", "input", "label", "summary", "article", "time", "mark"].map(
    (tag) => `<svg><g><${tag}>x</${tag}></g></svg>`,
  ),
  // And SVG-only names stay out of HTML.
  "<g></g>",
  "<path d='M0 0'></path>",
  "<circle r='1'></circle>",
  "<p><use href='#a'></use></p>",
])
  assert.throws(html(markup), markup)

// inspectView (#248): every problem, each placed in its block; `fatal` is exactly what compileView throws on.
const said = (v: { html: string; css?: string }) =>
  inspectView(v).problems.map(
    (p) => `${p.level}${p.fatal ? "!" : ""} ${p.block}:${p.line}:${p.column} ${p.message} | ${p.hint ?? ""}`,
  )
for (const [markup, want] of [
  // Structure: parse5 raises no parse error for any of these; they are read off the tree's source locations.
  ["<div>a", ["error html:1:1 <div> is never closed: the browser closes it at the end of the html"]],
  [
    "<div></dvi>",
    [
      "error html:1:1 <div> is never closed",
      "error html:1:6 </dvi> does not close the open <div> (from 1:1), so the browser ignores it",
    ],
  ],
  [
    "<span><div></span></div>",
    ["error html:1:1 <span> is never closed", "error html:1:12 </span> does not close the open <div> (from 1:7)"],
  ],
  [
    "<b><i>x</b></i>",
    [
      "error html:1:4 <i> is never closed: the browser closes it at 1:8",
      "error html:1:12 </i> has nothing open to close",
    ],
  ],
  [
    "<p><div>x</div></p>",
    [
      "warn html:1:1 <p> has no end tag, and the browser closes it at 1:4, before <div> | write </p>: a <p> cannot hold a block element",
      "error html:1:16 </p> has nothing open to close",
    ],
  ],
  [
    "<table><div>x</div></table>",
    [
      "error html:1:8 <div> cannot sit inside <table> where it is written, so the browser moves it out | a table holds only rows and cells",
      "error html:1:13 text 「x」 cannot sit inside <table>",
    ],
  ],
  [
    "<body><div></div></body>",
    ["error html:1:1 <body> is dropped", "error html:1:18 </body> has nothing open to close"],
  ],
  ["<div></br></div>", ["warn html:1:6 </br> is read as a line break <br> | write <br>"]],
  // An end tag the HTML makes optional, closed by a sibling or the parent's end, is how a browser reads it: silent.
  ["<ul>\n  <li>a\n  <li>b\n</ul><dl><dt>a<dd>b</dl><table><tr><td>a<td>b</tr></table><p>a<p>b", []],
  ["<svg><path/><path></path><g><rect></g></svg>", []],
  // Macros: a view's html is never name-filled and runs none.
  [
    "<p title='{{user}}'>{{char}} {{getvar::hp}} {{ fields.潮位 }}</p><!-- {{note}} -->",
    [
      'error html:1:11 {{user}} is shown as written: a view does not interpolate | write <span data-text="names.user"></span>',
      'error html:1:21 {{char}} is shown as written: a view does not interpolate | write <span data-text="names.char"></span>',
      "error html:1:30 {{getvar::hp}} is shown as written: a view does not interpolate or run macros",
      'error html:1:45 {{ fields.潮位 }} is shown as written: a view does not interpolate | write <span data-text="fields.潮位"></span>',
    ],
  ],
  // The whitelist: every rejection placed (an attribute at the attribute) and each common one with its replacement.
  [
    "<div class='a'\n     style='color: red' onclick='x()' data-foo='1'>\n  <img src='x.png'><a href='#x'>a</a><script>a</b></script><button>b</button><style>p{}</style>\n</div>",
    [
      "error! html:2:6 <div>: style is not allowed in a view | give the element a class and style it in the view's css block, or bind a number with data-var-<name>",
      "error! html:2:25 <div>: onclick is not allowed in a view | a view runs no code: build tabs from radio inputs and :checked in css, folding from <details>",
      "error! html:2:39 <div>: data-foo is not a view directive | static data-* attributes are not allowed: use a class",
      "error! html:3:3 <img> is not a view element | show a catalog image with data-media",
      "error! html:3:20 <a> is not a view element | a view links nowhere",
      "error! html:3:38 <script> is not a view element | a view runs no code",
      'error! html:3:60 <button> has no data-fill | a view\'s button fills the composer: write <button data-fill="<path>">',
      "error! html:3:78 <style> is not a view element | move these rules into the view's css block",
    ],
  ],
  [
    "<p data-text='fields.hp < 20'></p><p data-if='!x'></p><p data-var-w='a / b'></p>",
    [
      '!error! html:1:4 <p>: data-text="fields.hp < 20" is not a path | views take plain paths only, no expressions',
      '!error! html:1:38 <p>: data-if="!x" is not a path',
      '!error! html:1:58 <p>: data-var-w="a / b" is not a path',
    ],
  ],
] as [string, string[]][]) {
  const got = said({ html: markup })
  const strip = (w: string) => w.replace(/^!/, "")
  for (const w of want.map(strip))
    assert.ok(
      got.some((g) => g.startsWith(w.split(" | ")[0]) && (!w.includes(" | ") || g.includes(w.split(" | ")[1]))),
      `${markup}\nwant: ${w}\ngot:\n${got.join("\n")}`,
    )
  assert.equal(got.length, want.length, `${markup}\n${got.join("\n")}`)
}
assert.deepEqual(
  said({
    html: "<p></p>",
    css: "p { color: red; }\n.a { background: url(https://x.example/a.png); }\n@font-face { font-family: x; }\n@import 'x.css';",
  }),
  [
    "error! css:2:18 unsupported view CSS: url(https://x.example/a.png) | a view loads no file: an image comes from a catalog through data-media; for a background, put a data-media element behind the content with position: absolute",
    "error! css:3:1 unsupported view CSS: @font-face | a view loads no font: use the host's fonts through var(--font-sans), var(--font-prose) or var(--font-mono)",
    "error! css:4:1 unsupported view CSS: @import | a view loads no stylesheet: put the rules in its css block",
  ],
)
// The fill button (#248): one kind of button, which puts the text at a path into the composer. It has data-fill, a
// name the gate can see, and no type but button; the host owns disabled.
for (const markup of [
  "<button data-fill='opt'>选这条</button>",
  "<button data-fill='opt' data-text='opt'></button>",
  "<button data-fill='row.text' type='button'><span data-text='row.text'></span></button>",
  "<button data-fill='opt' aria-label='选这条' class='pick' title='t' data-if='opt' data-attr-kind='opt' data-var-n='n'><svg viewBox='0 0 1 1'><path d='M0 0'/></svg></button>",
])
  assert.doesNotThrow(html(markup), markup)
for (const [markup, want] of [
  ["<button data-fill='opt'>x</button>", []],
  [
    "<button>选</button>",
    [
      'error! html:1:1 <button> has no data-fill | a view\'s button fills the composer: write <button data-fill="<path>">',
    ],
  ],
  ["<div data-fill='opt'>x</div>", ["error! html:1:6 <div>: data-fill belongs on a <button> | a view's button fills"]],
  [
    "<button type='submit' data-fill='opt'>x</button>",
    ['error! html:1:9 <button type="submit">: a view\'s button is always type="button" | remove type'],
  ],
  [
    "<button data-fill='opt'> <span class='x'></span></button>",
    [
      "error html:1:1 <button> has no name: a player and an agent find a button by its words | write its words inside it",
    ],
  ],
  ["<button data-fill='opt' aria-label=' '></button>", ["error html:1:1 <button> has no name"]],
  ["<button data-fill='a + b'>x</button>", ['error! html:1:9 <button>: data-fill="a + b" is not a path']],
  [
    "<button data-fill='opt' disabled name='n' value='v' form='f' formaction='x' autofocus popovertarget='p' command='c' commandfor='d'>x</button>",
    [
      "error! html:1:25 <button>: disabled is not allowed in a view | the host disables a button while it cannot fill",
      "error! html:1:43 <button>: value is not allowed in a view",
      "error! html:1:53 <button>: form is not allowed in a view",
      "error! html:1:62 <button>: formaction is not allowed in a view",
      "error! html:1:77 <button>: autofocus is not allowed in a view",
      "error! html:1:87 <button>: popovertarget is not allowed in a view",
      "error! html:1:105 <button>: command is not allowed in a view",
      "error! html:1:117 <button>: commandfor is not allowed in a view",
      "error! html:1:34 <button>: name is not allowed on a button",
    ],
  ],
] as [string, string[]][]) {
  const got = said({ html: markup })
  for (const w of want)
    assert.ok(
      got.some((g) => g.startsWith(w.split(" | ")[0]) && (!w.includes(" | ") || g.includes(w.split(" | ")[1]))),
      `${markup}\nwant: ${w}\ngot:\n${got.join("\n")}`,
    )
  assert.equal(got.length, want.length, `${markup}\n${got.join("\n")}`)
}
assert.deepEqual(JSON.parse(JSON.stringify(compileView({ html: "<button data-fill='opt'>x</button>" }))), [
  { tag: "button", svg: false, attrs: { "data-fill": "opt" }, children: ["x"] },
])
assert.throws(() => compileView({ html: "<button>x</button>" }), /^Error: <button> has no data-fill at 1:1$/)

// The css is never name-filled either: a macro in a string or a custom property is placed in the css block.
assert.deepEqual(
  said({
    html: "<p class='pct'></p>",
    css: '.pct::after { content: "{{getvar::hp}}%"; }\n/* {{note}} */\n:host { --who: "{{char}}"; --tide: "{{ fields.潮位 }}"; }',
  }),
  [
    'error css:1:25 {{getvar::hp}} is shown as written: a view does not interpolate or run macros | css holds no data: put the text in the html with data-text="fields.<x>", or bind a number with data-var-<name> and read var(--<name>)',
    'error css:3:17 {{char}} is shown as written: a view does not interpolate | css holds no data: put the text in the html with data-text="names.char", or bind a number with data-var-<name> and read var(--<name>)',
    'error css:3:37 {{ fields.潮位 }} is shown as written: a view does not interpolate | css holds no data: put the text in the html with data-text="fields.潮位", or bind a number with data-var-<name> and read var(--<name>)',
  ],
)
// Unclosed openers and comments are scanned once, not once per opener.
{
  const start = performance.now()
  inspectView({ html: "{{".repeat(20_000) + "<!--".repeat(10_000), css: "{{".repeat(20_000) + "/*" })
  assert.ok(performance.now() - start < 200, "macro scan is linear")
}
// An element on the wrong side of <svg> says which side it belongs on.
assert.deepEqual(said({ html: "<svg><section></section></svg><g></g>" }), [
  "error! html:1:6 <section> is not a view element inside <svg> | inside <svg> only SVG elements draw: close the </svg> before HTML, or write SVG <text>",
  "error! html:1:31 <g> is not a view element | SVG elements draw only inside an <svg>",
])
// Lint's checks never reach the session: a card that passed the gate before compiles the tree it did.
assert.doesNotThrow(() => compileView({ html: "<div>{{char}}<p><div>x</div></p>" }))
assert.deepEqual(JSON.parse(JSON.stringify(compileView({ html: "<ul><li data-text='a'>x<li>y</ul>" }))), [
  {
    tag: "ul",
    svg: false,
    attrs: {},
    children: [
      { tag: "li", svg: false, attrs: { "data-text": "a" }, children: ["x"] },
      { tag: "li", svg: false, attrs: {}, children: ["y"] },
    ],
  },
])
assert.throws(() => compileView({ html: "<p style='x'></p>" }), /^Error: <p>: style is not allowed in a view at 1:4$/)
// A paint's numeric color: every CSS spelling still accepted, near-misses refused.
const paintOf = (v: string) => () => compileView({ html: `<svg><path fill="${v}"/></svg>` })
for (const v of [
  "rgb(1 2 3)",
  "rgb(1,2,3)",
  "rgb( 1 , 2 , 3 )",
  "rgba(0, 0, 0, .5)",
  "rgba(0 0 0 / 50%)",
  "RGB(1 2 3)",
  "rgb(-1 +2 3.5)",
  "hsl(120deg 50% 50% / 0.3)",
  "hsla(120,50%,50%,0.3)",
  "var(--x, rgb(1 2 3))",
  "var(--x,hsl(1deg 2% 3%))",
])
  assert.doesNotThrow(paintOf(v), v)
for (const v of [
  "rgb()",
  "rgb(,1,2,3)",
  "rgb(1,,2,3)",
  "rgb(1 2 3,)",
  "rgb(1 2 3 /)",
  "rgb(1.)",
  "rgb(1px 2 3)",
  "rgb(a b c)",
  "rgb(1 2 3",
  "rgb(1 2 3) x",
  "var(--x, rgb(1 2 3)",
])
  assert.throws(paintOf(v), v)
// The author writes the value and the server judges it on its main thread: a near-miss of 10,000 characters is refused
// in linear time, never by trying every way to split it (the old pattern took 1.4 s at 20 digits and doubled per digit).
paintOf("rgb(1 2 3)")()
for (const v of [
  "rgb(" + "1".repeat(10_000) + "x)",
  "rgb(" + "1.".repeat(5_000) + "x)",
  "rgb(" + "1 ".repeat(5_000) + "x)",
  "rgb(" + "1, ".repeat(3_333) + "x)",
  "hsl(" + "1% ".repeat(3_333) + "x)",
  "rgb(1" + " ".repeat(10_000) + "x)",
  "var(--a, rgb(" + "1".repeat(10_000) + "x))",
  "var(--a" + " ".repeat(10_000) + "x",
]) {
  const start = performance.now()
  assert.throws(paintOf(v))
  const ms = performance.now() - start
  assert.ok(ms < 50, `${v.slice(0, 12)}… (${v.length} chars) took ${ms.toFixed(1)} ms`)
}

console.log("view template ok")
