# TypeScript-local decisions

This ledger owns only `graphrefly-ts` package and implementation decisions. Its record identity is
`graphrefly-ts:<D#>`. Language-neutral product, protocol, cross-runtime and cross-project decisions
remain owned by `graphrefly`; protocol changes still use `/spec-amend` there.

`root-origin-history.jsonl` separately owns records originally authored as `graphrefly:<D#>` and
physically relocated here under D783. Their origin-qualified identity, body and provenance do not
change. New TypeScript decisions never enter that historical ledger.

`decisions.jsonl` is intentionally empty until a new package-local lock. Do not copy upstream
decision text between ledgers.
