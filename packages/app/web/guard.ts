// The script build.ts inlines at the top of the app's index.html (bundle.ts `bundleGuard`): listening for a start
// that fails, before anything that could fail is loaded.
import { watch } from "./failure.ts"

watch()
