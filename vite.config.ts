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
      // built-ins picked from a trial of @cloudflare/oxlint-config (the preset itself is React-shaped)
      "prefer-const": "error",
      "preserve-caught-error": "error",
      "typescript/no-unnecessary-type-assertion": "error",
      "typescript/no-unsafe-function-type": "error",
      "typescript/no-empty-object-type": "error",
      "typescript/switch-exhaustiveness-check": [
        "error",
        { allowDefaultCaseForExhaustiveSwitch: true, considerDefaultExhaustiveForUnions: true },
      ],
      "unicorn/prefer-set-has": "error",
    },
    overrides: [
      {
        files: ["packages/*/test/**"],
        rules: {
          // a test awaits what it waits for; the edge's pulls pace their moves, the time between them being the input
          "tavern/no-fixed-sleep": ["error", { allow: { "packages/client/test/controls.tsx": 4 } }],
        },
      },
      {
        files: ["packages/server/src/**"],
        rules: {
          "no-restricted-imports": [
            "error",
            {
              patterns: [
                {
                  group: [
                    "*client*",
                    "**/client/**",
                    "@effect-tavern/client*",
                    "@effect-tavern/app*",
                    "**/app/**",
                    "**/test/**",
                  ],
                  message: "server/src must not import client, app, or test modules.",
                },
              ],
            },
          ],
        },
      },
      {
        files: ["packages/runtime/src/**", "packages/provider/src/**"],
        rules: {
          "no-restricted-imports": [
            "error",
            {
              paths: ["bun", "@effect/platform-bun"],
              patterns: [
                {
                  group: [
                    "node:*",
                    "bun:*",
                    "@effect/platform-bun/*",
                    "@effect-tavern/server*",
                    "@effect-tavern/client*",
                    "@effect-tavern/app*",
                    "**/client/**",
                    "**/server/**",
                    "**/app/**",
                    "**/test/**",
                  ],
                  message:
                    "runtime/src and provider/src must stay portable and must not import server, client, app, or test modules.",
                },
              ],
            },
          ],
        },
      },
      {
        files: ["packages/provider/src/dev.ts"],
        rules: {
          "no-restricted-imports": [
            "error",
            {
              patterns: [
                {
                  group: [
                    "@effect-tavern/server*",
                    "@effect-tavern/client*",
                    "@effect-tavern/app*",
                    "**/client/**",
                    "**/server/**",
                    "**/app/**",
                    "**/test/**",
                  ],
                  message: "provider/src/dev.ts must not import server, client, app, or test modules.",
                },
              ],
            },
          ],
        },
      },
      {
        files: ["packages/client/src/**"],
        rules: {
          "no-restricted-imports": [
            "error",
            {
              paths: [
                "bun",
                "@effect/platform-bun",
                {
                  name: "@effect-tavern/provider",
                  message: "Import browser-safe subpaths (@effect-tavern/provider/src/*) instead of the root barrel.",
                },
              ],
              patterns: [
                {
                  group: [
                    "node:*",
                    "bun:*",
                    "@effect/platform-bun/*",
                    "@effect-tavern/server*",
                    "@effect-tavern/app*",
                    "**/server/**",
                    "**/app/**",
                    "**/test/**",
                  ],
                  message:
                    "client/src must stay browser-pure and must not import Node/Bun, server, app, or test modules.",
                },
              ],
            },
          ],
        },
      },
    ],
    options: { typeAware: true, typeCheck: true, reportUnusedDisableDirectives: "error" },
  },
})
