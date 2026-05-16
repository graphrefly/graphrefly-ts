---
"@graphrefly/graphrefly": minor
"@graphrefly/pure-ts": minor
---

memo:Re consumer follow-ups (rebuildable-projection story + ergonomics):

- **`reactiveFactStore`** — opt-in `recordIngest?: boolean` config exposes a
  payload-carrying `ingestLog: ReactiveLogBundle<MemoryFragment<T>>`.
  `attachStorage` it (with `bigintJsonCodecFor`) and replay entries into
  `config.ingest` on restart to rebuild a byte-identical store (cascade
  `validTo` is now deterministically derived from the triggering root).
- **`appendLogStorage`** — new `mode?: "append" | "overwrite"` option
  (`"append"` default = accumulate/read-merge, unchanged; `"overwrite"` =
  snapshot, replace key per flush). Contradictory JSDoc clarified — it is a
  true logical append log; callers do not need a custom tier.
- **`ReactiveLogBundle.attach`** — new `attach(upstream, { skipCachedReplay })`
  option to drop the push-on-subscribe cached-replay burst (avoids
  double-counting when attaching after a replay).

Migration note: `harnessLoop` moved export paths — it is now
`@graphrefly/graphrefly/presets/harness` (was
`@graphrefly/pure-ts/patterns/harness`, which now errors with
`ERR_PACKAGE_PATH_NOT_EXPORTED`). The root barrel re-export is unchanged.
