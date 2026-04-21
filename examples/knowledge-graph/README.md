# Knowledge-graph extraction (Node-runnable)

Pre-parsed documents → reactive `effect` → `knowledgeGraph()` → live `reactiveExplainPath`.

Mirrors the browser demo at `demos/knowledge-graph/` (which uses Chrome's built-in Gemini Nano against a real long paper). This example uses pre-parsed documents so it runs in CI with no API key, no model download, no network.

```bash
pnpm install
pnpm --filter @graphrefly-examples/knowledge-graph start
```
