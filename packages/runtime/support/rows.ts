// The reference player rows the authoring tools, the hosts and the tests share: a card is linted, previewed and played
// under a player, and these are the two the project uses.
import type { Rows } from "../src/layer.ts"
import { createStarterPack } from "../src/starter-pack.ts"

// The minimal player contributes no instructions or products.
export const plain: Rows = {}
// The first-party writing pack as the install's default, what a new library starts with.
export const starter: Rows = { defaultPack: createStarterPack() }
