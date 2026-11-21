// node:fs and node:os for the server's modules in a page: data.ts imports them for the lock and backups, which
// open(…, { lock: false }) never reaches.
const none = (name: string) => () => {
  throw new Error(`${name} is not available in the app`)
}
export const mkdirSync = none("mkdirSync"),
  readFileSync = none("readFileSync"),
  writeFileSync = none("writeFileSync"),
  rmSync = none("rmSync"),
  linkSync = none("linkSync"),
  renameSync = none("renameSync"),
  appendFileSync = none("appendFileSync"),
  statSync = none("statSync"),
  statfsSync = none("statfsSync"),
  chmodSync = none("chmodSync"),
  accessSync = none("accessSync"),
  readdirSync = none("readdirSync")
export const existsSync = () => false,
  realpathSync = (p: string) => p,
  constants = {},
  homedir = () => "/"
export default {}
