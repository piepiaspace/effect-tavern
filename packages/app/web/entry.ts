// The server in the page: the library is Go's (db.go, reached through sqlite.ts), the model whatever the player's
// routing names, and the client's fetch of /api is answered by the server's own handler, the Wire a listener mounts.
import { served } from "./host.ts"
import { open } from "@effect-tavern/server/src/data.ts"
import { standalone } from "@effect-tavern/server/src/host.ts"
import { refresh } from "@effect-tavern/server/src/names.ts"
import { app } from "@effect-tavern/server/src/serve.ts"

try {
  const data = open("tavern.db", { lock: false })
  served.resolve(app(standalone(data, { page: true }).handler))
  void refresh(data)
} catch (e) {
  // a library this build cannot read (one a newer app has upgraded, say): every /api request fails with it
  served.reject(e)
}
