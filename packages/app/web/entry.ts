// The server in the page: the library is Go's (db.go, reached through sqlite.ts), the model whatever the player's
// routing names, and the client's fetch of /api is answered by the server's own handler, the Wire a listener mounts.
import { served } from "./host.ts"
import { openSqlite } from "@effect-tavern/server/src/sqlite.ts"
import { standalone } from "@effect-tavern/server/src/host.ts"
import { refresh } from "@effect-tavern/server/src/names.ts"

try {
  const data = openSqlite("tavern.db")
  served.resolve(standalone(data, { page: true }).handler)
  void refresh(data)
} catch (e) {
  // a library this build cannot read (one a newer app has upgraded, say): every /api request fails with it
  served.reject(e)
}
