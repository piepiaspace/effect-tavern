import { defineConfig } from "astro/config";
import tailwindcss from "@tailwindcss/vite";
import nimbus, {
  defineConfig as defineNimbusConfig,
} from "@cloudflare/nimbus-docs";
import { tableScroll } from "@cloudflare/nimbus-docs/markdown";
import { tableLayout } from "./src/lib/table-layout";

const nimbusConfig = defineNimbusConfig({
  site: "https://piepiaspace.github.io",
  title: "Effect Tavern",
  description:
    "Declarative cards, multi-stage turn harness, and deterministic state settlement on Effect v4.",
  locale: "en",
  github: "https://github.com/piepiaspace/effect-tavern",
  editPattern: "https://github.com/piepiaspace/effect-tavern/edit/main/site/{path}",
  socialImageAlt: "Effect Tavern documentation",
  agents: {
    discovery: false,
  },
  sidebar: {
    items: [
      { label: "English", autogenerate: { collection: "docs" } },
      { label: "简体中文", autogenerate: { collection: "zh" } },
    ],
  },
});

export default defineConfig({
  base: "/effect-tavern",
  output: "static",
  vite: {
    plugins: [tailwindcss()],
  },
  prefetch: {
    prefetchAll: true,
    defaultStrategy: "hover",
  },
  integrations: [
    nimbus(nimbusConfig, {
      rules: {
        "nimbus/frontmatter-shape": "error",
        "nimbus/internal-link": "error",
      },
      markdown: {
        hastPlugins: [tableLayout(), tableScroll()],
        features: { headingAttributes: false },
      },
    }),
  ],
});
