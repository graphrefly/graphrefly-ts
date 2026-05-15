# RN / Hermes verification (`graphrefly-ts#4`)

The ongoing indicator that **`@graphrefly/pure-ts` stays compatible
with the Hermes engine React Native ships**. Two tiers, because no
single cheap check is fully faithful (see "Why three legs" below).

## Tier 1 — engine smoke (per-commit, CI)

```bash
pnpm test:hermes
```

`scripts/hermes-smoke/run.mjs`:

1. **Bytecode gate** — esbuild-bundles the spike + pure-ts (modern
   `es2018`, real shipped syntax) and runs it through
   `hermesc -emit-binary -O`, the **exact compiler RN 0.85.3 uses**
   (npm `hermes-compiler@250829098.0.10`, version-pinned). `-O` =
   release-optimized bytecode. Success ⇒ pure-ts parses, semantically
   analyses and code-generates on RN's real Hermes toolchain.
2. **Semantics gate** — runs the same spike under Node
   (`run-node.mjs`) asserting the two reactive blocks (basic
   propagation + diamond fan-in *dedupe*).

Wired into `.github/workflows/ci.yml` after `pnpm test`. No source
build, no Xcode — runs anywhere `hermes-compiler` installs (mac /
linux / win prebuilts ship in the npm package).

## Tier 2 — on-device fixture (periodic, manual)

`apps/rn-hermes-fixture` — Expo SDK 55 (official matrix: RN 0.83.6 /
React 19.2.0), `jsEngine: hermes`, importing `@graphrefly/pure-ts`
via the workspace. Covers the real Hermes **VM** + RN polyfills.

```bash
cd apps/rn-hermes-fixture

pnpm bundle:check                       # automated: Metro + babel-preset-expo
                                        # + Hermes → emits an .hbc bundle.
                                        # Proves the RN pipeline compiles
                                        # pure-ts. (CI-able if ever desired.)

pnpm ios                                # dev build  — real Hermes VM
pnpm ios:release                        # RELEASE build — Hermes bytecode +
                                        # aggressive opt (the case that
                                        # historically breaks where dev passes)
```

The screen renders a **PASS/FAIL banner** + per-assertion log and
mirrors to the device console (`[spike] …`). Expected: green PASS,
`block1 sum emissions [3,12,30]`, `block2 c2 after set==5 [15]`
(fires **once**, not twice), `engine: Hermes`, all polyfill probes
`present`. Capture a screenshot for the issue.

The reactive assertions are kept equivalent to the canonical
`spike-core.mjs`. **Change one ⇒ change both.**

## Why three legs (the faithfulness model)

| Concern | Covered by | Tier |
|---|---|---|
| pure-ts's real syntax compiles to RN's optimized Hermes bytecode | RN-pinned `hermesc -O` | 1, per-commit |
| Reactive protocol math + diamond dedupe are correct | Node execution | 1, per-commit |
| Full RN/Metro/Babel pipeline emits a valid `.hbc` for an app using pure-ts | `expo export` (`bundle:check`) | 2, automatable |
| Real Hermes **VM** execution + RN polyfills on device | `expo run:ios[:release]` | 2, periodic manual |

Dead ends ruled out (don't retry these): the **facebook/hermes
standalone CLI _releases_ are frozen at an ancient pre-`class`
v0.13.0**; building the RN-pinned tag from source yields an old
(0.12.0, no-`class`) `hermes`; **esbuild cannot down-level pure-ts to
es5** (classes / for-of). Raw Hermes never sees app code in RN
anyway — Metro/Babel transforms first — so a standalone VM step
would not be representative. Hence: faithful *compile* in Tier 1,
*semantics* in Node, real *VM* in the Tier-2 fixture.

## Version matrix (bump deliberately)

| Component | Pinned | Where |
|---|---|---|
| `@graphrefly/pure-ts` | 0.45.0 | workspace |
| `hermes-compiler` (RN 0.85.3's exact hermesc) | `250829098.0.10` | root devDep + `run.mjs` MATRIX |
| React Native (fixture) | 0.83.6 | `apps/rn-hermes-fixture` (Expo SDK 55 matrix) |
| Expo (fixture) | SDK 55 | `apps/rn-hermes-fixture` |
| Hermes bytecode version observed | 96 | `expo export` `.hbc` header |

To bump: update the `hermes-compiler` devDep + `MATRIX` in
`run.mjs`, and the fixture's Expo/RN versions; re-run both tiers;
update this table and re-file the result on issue #4.

## Polyfills

pure-ts is zero-dependency and universal (no `node:*`, no DOM). The
spike's probes (`globalThis`, `Symbol`, `BigInt`, `Promise`,
`queueMicrotask`, `crypto.randomUUID`, `structuredClone`) are
informational. **No polyfills are required** for the verified
surface — the bytecode gate compiles clean and Node semantics pass.
Record any `MISSING` probe from the on-device fixture run here if a
future pure-ts change starts depending on one.
