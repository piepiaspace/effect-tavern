// Bundle entry for the platform-free authoring smoke test.
import { checkValue, validateCard } from "../src/author.ts"
import { applyCompile, applySort } from "../src/workshop.ts"
import { revision } from "../src/context.ts"

import { canonicalJson, hashUtf8 } from "../src/storage.ts"

const authoring = { canonicalJson, hashUtf8, checkValue, validateCard, applyCompile, applySort, revision }
Object.assign(globalThis, { authoring })
export type Authoring = typeof authoring
