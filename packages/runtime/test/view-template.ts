// compileView's whitelist (#248): what a view may write, and the fetch and escape paths that stay shut.
import assert from "node:assert/strict"
import { compileView } from "../src/view-template.ts"

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
])
  assert.throws(html(markup), markup)

console.log("view template ok")
