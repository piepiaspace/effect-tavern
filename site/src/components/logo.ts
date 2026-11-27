/**
 * The site's logo, drawn once for every place it appears: the header and the
 * docs layout (Logo.astro) and the social cards (src/pages/og/_card.ts).
 * Replace the drawing here to rebrand them all. Keep it a single-colour
 * mark; each place fills it with its own text colour.
 */
export const logo = {
  /** The drawing's box; callers size it by height and keep the ratio. */
  width: 975.238,
  height: 1024,
  paths: [
    "M 0 1024 L 0 487.619 C 0 218.314 218.314 0 487.619 0 C 756.924 0 975.238 218.314 975.238 487.619 L 975.238 1024 L 780.19 1024 L 780.19 536.381 C 780.19 449.276 733.721 368.788 658.286 325.236 C 583.281 615.073 400.049 865.144 146.286 1024 L 0 1024 Z",
  ],
};
