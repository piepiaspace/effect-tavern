import solidV2 from "eslint-plugin-solid/configs/v2"
import { defineConfig } from "vite-plus"

export default defineConfig({
  fmt: {
    printWidth: 120,
    semi: false,
    ignorePatterns: ["docs/**", "review/**", "site/**", "packages/server/src/names.json", "tools/oxlint/**"], // archived research, reviews, standalone Astro docs site, generated name table, and vendored lint rules stay verbatim
  },
  lint: {
    ignorePatterns: ["**/dist/**", "site/**", "tools/oxlint/**"],
    jsPlugins: [
      { name: "vite-plus", specifier: "vite-plus/oxlint-plugin" },
      { name: "solid", specifier: "eslint-plugin-solid" }, // the 2.0 rules: removed-api, no-single-arg-create-effect, no-accessor-as-prop …
      { name: "anti-slop-effect", specifier: "./tools/oxlint/anti-slop-effect/index.ts" }, // two rules, UPSTREAM.md
      { name: "tavern", specifier: "./tools/oxlint/tavern/index.ts" }, // our own
    ],
    settings: solidV2.settings,
    rules: {
      "vite-plus/prefer-vite-plus-imports": "error",
      ...solidV2.rules,
      "anti-slop-effect/throw-in-effect-gen": "error", // a throw in an Effect generator is a defect; fail with a tagged error
      "anti-slop-effect/no-unbounded-retry": "error", // every retry policy stops
    },
    overrides: [
      {
        files: ["packages/*/test/**"],
        rules: {
          // a test awaits what it waits for; the edge's pulls pace their moves, the time between them being the input
          "tavern/no-fixed-sleep": ["error", { allow: { "packages/client/test/controls.tsx": 4 } }],
        },
      },
    ],
    options: { typeAware: true, typeCheck: true },
  },
})
