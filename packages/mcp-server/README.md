# @graphrefly/mcp-server

Model Context Protocol server for [GraphReFly](https://graphrefly.dev). Exposes reactive graph operations — compose, inspect, explain, reduce, snapshot — as MCP tools any compatible client (Claude Desktop, Claude Code, Cline, Cursor, Continue, etc.) can call.

GraphReFly is a reactive harness layer for agent workflows: describe automations in plain language, trace every decision through a causal chain, enforce policies, persist checkpoints. This server makes every core surface operation callable as a tool.

## Install

```bash
npm install -g @graphrefly/mcp-server
```

Or run on demand without installing:

```bash
npx -y @graphrefly/mcp-server
```

### Claude Desktop / Claude Code config

Add an entry to your `claude_desktop_config.json` (macOS: `~/Library/Application Support/Claude/claude_desktop_config.json`):

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

Restart the client. You should see twelve `graphrefly_*` tools listed.

## Tools

| Tool | Purpose |
|---|---|
| `graphrefly_create` | Compile a GraphSpec into a live graph registered under `graphId`. |
| `graphrefly_describe` | Topology + values snapshot of a registered graph. Detail levels `minimal` / `standard` / `full`; formats `json` / `spec` / `pretty` / `mermaid` / `d2`. |
| `graphrefly_observe` | One-shot observation — full graph state, or a single node by `path`. |
| `graphrefly_explain` | Walk backward through dependencies from `to` to `from` and return a `CausalChain`. |
| `graphrefly_reduce` | One-shot stateless run: compile spec, push `input` to `inputPath`, await first `DATA` on `outputPath`, dispose. |
| `graphrefly_snapshot_save` | Serialize a graph's current state as a checkpoint. |
| `graphrefly_snapshot_restore` | Load a snapshot from the storage tier as a new live graph. |
| `graphrefly_snapshot_diff` | Structural + value diff between two saved snapshots. |
| `graphrefly_snapshot_list` | Enumerate snapshot ids in the storage tier. |
| `graphrefly_snapshot_delete` | Remove a snapshot from the storage tier. |
| `graphrefly_delete` | Destroy a live graph and drop it from the session registry. |
| `graphrefly_list` | Enumerate registered `graphId`s. |

## Minimal GraphSpec example

```json
{
  "name": "pricing",
  "nodes": {
    "price": { "kind": "state", "initial": 100 },
    "tax":   { "kind": "derived", "deps": ["price"], "fn": "mul", "args": [0.1] },
    "total": { "kind": "derived", "deps": ["price", "tax"], "fn": "add" }
  }
}
```

Call sequence from the client:

1. `graphrefly_create({ graphId: "pricing", spec: <above> })`
2. `graphrefly_describe({ graphId: "pricing", detail: "standard" })` — see the topology.
3. `graphrefly_observe({ graphId: "pricing", path: "total" })` — fetch the current value.
4. `graphrefly_explain({ graphId: "pricing", from: "price", to: "total" })` — why is `total` the way it is.

`fn` / `source` names come from a **catalog** registered by the server operator at startup. The default binary ships an empty catalog (state-only and passthrough specs work out of the box). To register custom fns, import `buildMcpServer` + `createSession` from `@graphrefly/mcp-server` and write your own entry. See [graphrefly.dev](https://graphrefly.dev).

## Environment variables

| Var | Purpose | Default |
|---|---|---|
| `GRAPHREFLY_STORAGE_DIR` | Directory for snapshot persistence via `fileStorage`. | in-memory (session-scoped; snapshots vanish on restart) |

## Programmatic use

```ts
import { buildMcpServer, createSession, startStdioServer } from "@graphrefly/mcp-server";

// Convenience — the same path the `graphrefly-mcp` binary uses:
await startStdioServer({ storageDir: "./checkpoints" });

// Or build manually for custom transports / catalogs:
const session = createSession({ storageDir: "./checkpoints" });
const server = buildMcpServer(session, { catalog: myFnCatalog });
// await server.connect(customTransport);
```

## Surface errors

Handlers throw `SurfaceError` with stable machine-readable codes. The transport layer maps them to MCP `isError` responses whose `content[0].text` is the error JSON:

```json
{ "code": "graph-not-found", "message": "graph \"pricing\" is not registered", "context": { "graphId": "pricing" } }
```

Known codes: `graph-not-found`, `graph-exists`, `node-not-found`, plus validation errors raised by `createGraph`.

## Notes

- **Transport:** stdio only in this release. HTTP/SSE is tracked in `docs/optimizations.md`.
- **Concurrency:** check-then-set on the `graphId` registry is safe under stdio (the SDK serializes requests on a single connection). Future HTTP transports will need a per-`graphId` mutex.
- **Snapshots:** graphs live in process-local memory and **do not** survive restarts automatically. Persist via `graphrefly_snapshot_save` and re-create on reconnect.

## License

[MIT](./LICENSE)
