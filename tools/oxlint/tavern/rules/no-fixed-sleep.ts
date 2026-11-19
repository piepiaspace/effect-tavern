// A test that awaits a fixed delay is betting the thing it waits for is done by then: it passes on this machine and
// flakes on a loaded one. Reported: `await` of `Bun.sleep(n)`, `sleep(n)`, `new Promise((r) => setTimeout(r, n))`, or a
// same-file `const` helper whose body is one of these. Not reported: a delay of literal 0 (a yield to the next task, an
// ordering, not a bet), a delay inside a `while`/`do` loop or a `for` loop that can `return`/`break` (a poll on a
// condition), and a delay inside a callback passed to a call (simulated work, not the test waiting).
// `allow: { "<path>": n }` admits exactly n in a file (a path suffix): more fails, and fewer asks to lower n.
import { defineRule } from "@oxlint/plugins"

import type { ESTree } from "@oxlint/plugins"

type Node = ESTree.Node & { parent?: Node }
type Expr = ESTree.Expression

/** The delay's milliseconds argument when `e` starts a delay: `null` for none given (setTimeout's 0), `false` when it is no delay. */
const delayOf = (e: Expr, helpers: Map<string, { param?: string; ms: Expr | null }>): Expr | null | false => {
  if (e.type === "CallExpression") {
    const c = e.callee
    const arg = (e.arguments[0] as Expr | undefined) ?? null
    if (c.type === "MemberExpression" && c.object.type === "Identifier" && c.object.name === "Bun")
      return c.property.type === "Identifier" && c.property.name === "sleep" ? arg : false
    if (c.type !== "Identifier") return false
    if (c.name === "sleep") return arg
    const h = helpers.get(c.name)
    if (!h) return false
    return h.ms?.type === "Identifier" && h.ms.name === h.param ? arg : h.ms
  }
  if (e.type === "NewExpression" && e.callee.type === "Identifier" && e.callee.name === "Promise") {
    const f = e.arguments[0]
    if (f?.type !== "ArrowFunctionExpression" && f?.type !== "FunctionExpression") return false
    const body = f.body.type === "BlockStatement" ? f.body.body : [{ type: "ExpressionStatement", expression: f.body }]
    if (body.length !== 1 || body[0]!.type !== "ExpressionStatement") return false
    const call = (body[0] as ESTree.ExpressionStatement).expression
    if (call.type !== "CallExpression" || call.callee.type !== "Identifier" || call.callee.name !== "setTimeout")
      return false
    return (call.arguments[1] as Expr | undefined) ?? null
  }
  return false
}

const zero = (ms: Expr | null) => ms === null || (ms.type === "Literal" && ms.value === 0)

const FUNCTIONS = new Set(["ArrowFunctionExpression", "FunctionExpression", "FunctionDeclaration"])
const LOOPS = new Set(["WhileStatement", "DoWhileStatement"])

/** Whether `n` is a step that may end the loop it sits in. */
const exits = (n: Node | null | undefined): boolean => {
  if (!n || typeof n !== "object") return false
  if (n.type === "ReturnStatement" || n.type === "BreakStatement") return true
  if (FUNCTIONS.has(n.type)) return false
  return Object.entries(n).some(
    ([k, v]) => k !== "parent" && (Array.isArray(v) ? v.some((x) => exits(x)) : v && typeof v === "object" && exits(v)),
  )
}

/** A poll (inside a loop that waits on a condition) or a callback's own delay. */
const exempt = (node: Node) => {
  for (let n = node.parent; n; n = n.parent) {
    if (LOOPS.has(n.type)) return true
    if (n.type === "ForStatement" && exits((n as ESTree.ForStatement).body as Node)) return true
    if (FUNCTIONS.has(n.type)) {
      const p = n.parent
      return !!p && (p.type === "CallExpression" || p.type === "NewExpression") && p.callee !== (n as unknown)
    }
  }
  return false
}

export const noFixedSleepRule = defineRule({
  meta: {
    type: "problem",
    docs: { description: "A test awaits what it waits for, never a fixed delay." },
    schema: [
      {
        type: "object",
        properties: { allow: { type: "object", additionalProperties: { type: "integer", minimum: 1 } } },
        additionalProperties: false,
      },
    ],
  },
  create(context) {
    const allow = (context.options[0] as { allow?: Record<string, number> } | undefined)?.allow ?? {}
    const file = context.filename.replaceAll("\\", "/")
    const allowed = Object.entries(allow).find(([path]) => file.endsWith(`/${path}`))?.[1] ?? 0
    const helpers = new Map<string, { param?: string; ms: Expr | null }>()
    const awaits: ESTree.AwaitExpression[] = []
    return {
      VariableDeclarator(d: ESTree.VariableDeclarator) {
        const f = d.init
        if (d.id.type !== "Identifier" || f?.type !== "ArrowFunctionExpression" || f.body.type === "BlockStatement") return
        const ms = delayOf(f.body, helpers)
        if (ms === false) return
        const p = f.params[0]
        helpers.set(d.id.name, { ...(p?.type === "Identifier" && { param: p.name }), ms })
      },
      AwaitExpression(a: ESTree.AwaitExpression) {
        awaits.push(a)
      },
      // judged at the end, so a helper declared below its first use is known
      "Program:exit"(program: ESTree.Program) {
        const hits = awaits.filter((a) => {
          const ms = delayOf(a.argument, helpers)
          return ms !== false && !zero(ms) && !exempt(a as Node)
        })
        if (hits.length > allowed)
          for (const node of hits)
            context.report({
              node,
              message: allowed
                ? `${hits.length} fixed delays here, ${allowed} allowed: await the operation or a signal it emits.`
                : "A fixed delay: await the operation or a signal it emits, or poll its condition in a loop.",
            })
        else if (hits.length < allowed)
          context.report({
            node: program,
            message: `${hits.length} fixed delays here, ${allowed} allowed: lower this file's allowance to ${hits.length || "none"}.`,
          })
      },
    }
  },
})
