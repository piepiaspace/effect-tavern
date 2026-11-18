# Upstream

- Source: https://github.com/K-Mistele/anti-slop (MIT, `LICENSE`), commit `3944fc34ea7923ed8354df313474633ec73e6488`
  (2026-11-18), path `skills/install-anti-slop/assets/anti-slop/effect/`.
- Copied unchanged: `rules/throw-in-effect-gen.ts`, `rules/no-unbounded-retry.ts`, `shared/effect-modules.ts`.
  Each one's blob matches upstream at that commit.
- Ours: `index.ts` registers only these two rules. The rest of the plugin was evaluated on 2026-11-18 and not taken.
- `throw-in-effect-gen` is itself ported from mpsuesser/enfect (MIT); `no-unbounded-retry` from cevr/effect-oxlint (MIT).
