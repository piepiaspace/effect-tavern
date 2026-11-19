import { eslintCompatPlugin } from "@oxlint/plugins"

import { noFixedSleepRule } from "./rules/no-fixed-sleep.ts"

/** Our own rules. */
export default eslintCompatPlugin({
  meta: { name: "tavern" },
  rules: { "no-fixed-sleep": noFixedSleepRule },
})
