# Changelog

## 0.0.1 — 2026-04-19

Initial release — Model Context Protocol server for GraphReFly (roadmap §9.3).

### Tools shipped

- `graphrefly_create` — compile a GraphSpec into a live graph.
- `graphrefly_describe` — topology + values snapshot, with `minimal` / `standard` / `full` detail and `json` / `spec` / `pretty` / `mermaid` / `d2` formats.
- `graphrefly_observe` — one-shot observation of a graph or a single node by `path`.
- `graphrefly_explain` — `CausalChain` walking dependencies from `to` back to `from`.
- `graphrefly_reduce` — stateless one-shot `input → pipeline → output` run.
- `graphrefly_snapshot_save` / `_restore` / `_diff` / `_list` / `_delete` — checkpoint lifecycle against the session storage tier.
- `graphrefly_delete` — destroy a live graph.
- `graphrefly_list` — enumerate registered `graphId`s.

### Transport & session

- Stdio transport via `startStdioServer()`; SIGINT/SIGTERM graceful shutdown.
- Session-scoped `graphId → Graph` registry; per-session snapshot tier defaulting to in-memory, switchable to `fileStorage(GRAPHREFLY_STORAGE_DIR)`.
- Non-`SurfaceError` handler throws are mapped to `internal-error` responses instead of killing the transport loop.
