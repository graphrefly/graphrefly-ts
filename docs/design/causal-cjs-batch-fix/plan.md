# CJS cross-entry batch repair

Baseline ba68578b. User approved bounded repair of reproduced CJS public-entry batch failure.
Keep runtime source/protocol/public exports unchanged; preserve unrelated worktree edits.
Use installed tsup's existing cjs-splitting support to share bundled module instances. No global registry,
new singleton, public API, per-format identity policy change or preserved-module-tree migration.

Acceptance: actual installed exports root/graph/core combine in ESM/CJS; commit once, nested batch joins,
rollback/throw cancels and next batch recovers. Same-root control stays green. Integrated regression must
fail old dist. Build/export/type/lint and full offline tests pass; blind/edge/verification QA review.
ESM behavior is the already split control. DTS and entry paths unchanged. Record artifact footprint and
bounded fresh-process CJS import observations; do not treat these as formal consumer performance qualification.
No spending API/design implementation, real inbox/provider/live/spend or previous performance matrix restart.
