// `import x from "….css" with { type: "text" }`: Bun hands the file's text (bin/card.ts reads the client's sheets so).
declare module "*.css" {
  const source: string
  export default source
}
