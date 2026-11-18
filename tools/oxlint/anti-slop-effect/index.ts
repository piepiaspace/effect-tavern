import { eslintCompatPlugin } from "@oxlint/plugins";

import { noUnboundedRetryRule } from "./rules/no-unbounded-retry.ts";
import { throwInEffectGenRule } from "./rules/throw-in-effect-gen.ts";

/** Two of anti-slop's Effect rules (UPSTREAM.md): a throw in an Effect generator, a retry that never stops. */
export default eslintCompatPlugin({
	meta: { name: "anti-slop-effect" },
	rules: {
		"no-unbounded-retry": noUnboundedRetryRule,
		"throw-in-effect-gen": throwInEffectGenRule,
	},
});
