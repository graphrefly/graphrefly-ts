# Try `@graphrefly/mcp-server` in Claude Code — 2 minutes

## 1. Add the server

Paste this into your `claude_desktop_config.json` (macOS: `~/Library/Application Support/Claude/claude_desktop_config.json`):

```json
{
  "mcpServers": {
    "graphrefly": {
      "command": "npx",
      "args": ["-y", "@graphrefly/mcp-server"],
      "env": {
        "GRAPHREFLY_STORAGE_DIR": "~/.graphrefly/snapshots"
      }
    }
  }
}
```

Restart Claude Desktop. You should see twelve `graphrefly_*` tools available.

Using Claude Code instead? Add the server from the terminal:

```bash
claude mcp add graphrefly -- npx -y @graphrefly/mcp-server
```

## 2. Paste these three prompts in order

**Prompt 1 — build a graph:**

> Call `graphrefly_create` with `graphId: "pricing"` and this spec:
> ```json
> {
>   "name": "pricing",
>   "nodes": {
>     "price": { "kind": "state", "initial": 100 },
>     "tax":   { "kind": "derived", "deps": ["price"], "fn": "mul", "args": [0.1] },
>     "total": { "kind": "derived", "deps": ["price", "tax"], "fn": "add" }
>   }
> }
> ```

**Prompt 2 — inspect it:**

> Call `graphrefly_describe` with `graphId: "pricing"` and `detail: "standard"`. Then `graphrefly_observe` with `path: "total"`.

**Prompt 3 — explain causality:**

> Call `graphrefly_explain` with `graphId: "pricing"`, `from: "price"`, `to: "total"`. Summarize the causal chain it returns.

That's it — three calls, and the model has composed, inspected, and explained a reactive graph. Snapshot it with `graphrefly_snapshot_save` or drop it with `graphrefly_delete`.

## Troubleshooting

- **Tools not visible:** make sure `node >= 20` is on `PATH` (MCP clients inherit your shell's path). Restart the client after config changes.
- **`fn "mul"` unknown:** the default binary ships an empty fn catalog. State-only and passthrough specs work out of the box; for arithmetic, register a catalog (see the [README](./README.md#programmatic-use)) or adapt the spec to use built-in reducers.
- **Snapshots vanishing:** set `GRAPHREFLY_STORAGE_DIR` to any writable path. Unset, snapshots live in process memory and die with the server.

More: [graphrefly.dev](https://graphrefly.dev) · [tool reference](./README.md#tools) · [MCP registry listing](https://registry.modelcontextprotocol.io/v0.1/servers?search=io.github.graphrefly/mcp-server)
