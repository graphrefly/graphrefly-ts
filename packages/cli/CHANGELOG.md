# Changelog

## 0.0.2

### Patch Changes

- Updated dependencies [[`64ab268`](https://github.com/graphrefly/graphrefly-ts/commit/64ab26858804265f60f169f69f95343793e5afde)]:
  - @graphrefly/graphrefly@0.45.0
  - @graphrefly/mcp-server@0.0.2

## 0.0.1 — 2026-04-19

Initial release — stateless command-line shell over the GraphReFly surface layer (roadmap §9.3c).

### Commands shipped

- `describe <spec>` — compile + emit topology. `--detail=minimal|standard|full`, `--format=json|pretty|mermaid|d2`.
- `explain  <spec> --from X --to Y` — compile + emit a `CausalChain`.
- `observe  <spec> [--path P]` — compile + one-shot observe of graph or a single node.
- `reduce   <spec> --input <path|->` — one-shot stateless `input → pipeline → output` run with optional `--input-path` / `--output-path` / `--timeout-ms`.
- `snapshot diff <a> <b>` — diff two snapshot files.
- `snapshot validate <file>` — structural snapshot envelope validation.
- `mcp` — boot the `@graphrefly/mcp-server` on stdio; honors `GRAPHREFLY_STORAGE_DIR`.

### Quality-of-life

- Spec and input sources accept `-` for stdin.
- Exit code drains stdout/stderr cleanly before exiting (prevents truncated file redirects on fast hosts).
- `SurfaceError` codes surfaced as JSON on stderr; exit `1` on any runtime error.
