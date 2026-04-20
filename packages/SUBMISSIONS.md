# MCP ecosystem submission drafts

Paste-ready payloads for publishing `@graphrefly/mcp-server` to every major MCP directory.

**Precondition — do these first:**

1. `cd packages/mcp-server && pnpm build && pnpm test`
2. `cd packages/mcp-server && npm publish --access public` (passkey 2FA prompt).
3. Confirm the package is live: `https://www.npmjs.com/package/@graphrefly/mcp-server`.
4. Pick a 400×400 PNG logo and commit it to the repo (e.g. `website/public/logo-400.png`). Several directories want a URL to a 400×400 logo.
5. Record a 30-second screencap of Claude Desktop calling `graphrefly_create` → `graphrefly_describe` (PulseMCP and several others appreciate a demo).

---

## 1. Official MCP Registry (`registry.modelcontextprotocol.io`)

Publishing is done via the `mcp-publisher` CLI — **no PR**, no fork. Metadata is verified against the npm package, so step 2 above is load-bearing. The registry is in preview; expect the schema URL and CLI to evolve.

### What the user does

- **Accounts needed:** GitHub (for device-flow auth), npm (for package upload).
- **Binary install (one-time):**
  ```bash
  curl -L "https://github.com/modelcontextprotocol/registry/releases/latest/download/mcp-publisher_$(uname -s | tr '[:upper:]' '[:lower:]')_$(uname -m | sed 's/x86_64/amd64/;s/aarch64/arm64/').tar.gz" \
    | tar xz mcp-publisher \
    && sudo mv mcp-publisher /usr/local/bin/
  ```
  (Or `brew install mcp-publisher`.)
- **Auth:** `mcp-publisher login github` — visit the device code URL, approve.
- **Publish:** from `packages/mcp-server/`, run `mcp-publisher publish`.
- **Verify:**
  ```bash
  curl "https://registry.modelcontextprotocol.io/v0.1/servers?search=io.github.graphrefly/mcp-server"
  ```

### `server.json` — write this to `packages/mcp-server/server.json`

```json
{
  "$schema": "https://static.modelcontextprotocol.io/schemas/2025-12-11/server.schema.json",
  "name": "io.github.graphrefly/mcp-server",
  "description": "Reactive harness for agent workflows — create/describe/observe/explain/reduce graphs and manage snapshots through the GraphReFly reactive graph layer.",
  "repository": {
    "url": "https://github.com/graphrefly/graphrefly-ts",
    "source": "github"
  },
  "version": "0.0.1",
  "packages": [
    {
      "registryType": "npm",
      "identifier": "@graphrefly/mcp-server",
      "version": "0.0.1",
      "transport": {
        "type": "stdio"
      },
      "environmentVariables": [
        {
          "name": "GRAPHREFLY_STORAGE_DIR",
          "description": "Directory for snapshot persistence. When unset, snapshots are in-memory and vanish on restart.",
          "format": "string",
          "isRequired": false,
          "isSecret": false
        }
      ]
    }
  ]
}
```

### Package verification — already wired

`packages/mcp-server/package.json` includes `"mcpName": "io.github.graphrefly/mcp-server"`. The registry reads this from the published npm tarball to verify ownership. The value **must** match `name` in `server.json`.

### Namespace note

Because we authenticate via GitHub, the server name must start with `io.github.<github-login-or-org>/...`. The draft above assumes the repo lives under a GitHub org named `graphrefly`. If it ends up under a personal account (e.g. `io.github.chenhuanming/...`), update both `mcpName` in `package.json` and `name` in `server.json` before publishing.

### Bumping the version later

1. Bump `version` in `package.json` **and** `server.json` (they must match).
2. `pnpm build && pnpm test && npm publish --access public`.
3. `mcp-publisher publish` (re-auth with `mcp-publisher login github` if JWT expired).

---

## 2. Cline Marketplace (`github.com/cline/mcp-marketplace`)

A GitHub Issue in the marketplace repo, reviewed by the Cline team. No PR, no manifest — the README is the source of truth.

### What the user does

- **Accounts needed:** GitHub.
- Test-install the server once, driving Cline with only `README.md`: give Cline the repo URL and watch it set up the server. Fix any ambiguity in the README that trips Cline up before submitting.
- Open `https://github.com/cline/mcp-marketplace/issues/new?template=mcp-server-submission.yml` and paste the payload below.
- Attach the 400×400 PNG logo directly to the issue (drag-drop).
- Wait "a couple of days" for review; Discord `#mcp` if it stalls.

### Issue payload

- **Title:** `[Server Submission]: GraphReFly — reactive harness for agent workflows`
- **GitHub Repository URL:** `https://github.com/graphrefly/graphrefly-ts/tree/main/packages/mcp-server`
- **Logo Image:** upload the 400×400 PNG.
- **Installation Testing:**
  - [x] I have tested that Cline can successfully set up this server using only the README.md and/or llms-install.md file
  - [x] The server is stable and ready for public use
- **Additional Information:**

  > GraphReFly is a reactive harness layer: describe automations as a graph, trace every decision through a causal chain, persist checkpoints. The MCP server exposes 12 tools covering graph creation, introspection (describe/observe/explain), one-shot reduction, and snapshot lifecycle. Stdio only; installs via `npx -y @graphrefly/mcp-server` with no required env vars. Optional `GRAPHREFLY_STORAGE_DIR` for on-disk snapshot persistence. MIT licensed. Useful for Cline users who want a reactive substrate underneath their own tools — e.g. email triage, spending alerts, knowledge-graph automations — with `graphrefly_explain` giving causal chains for every decision.

### Optional: `llms-install.md`

The README is already Cline-friendly (install command + Claude Desktop snippet + tool table + env var table). No `llms-install.md` needed unless a reviewer flags a setup gap. If needed, drop it next to the README with a literal transcript of a successful Cline install session.

---

## 3. PulseMCP (`pulsemcp.com/submit`)

PulseMCP is a web form, not a manifest. Reviewed by the PulseMCP team; they scrape the repo README after approval.

### What the user does

- **Accounts needed:** none to submit; the form is public.
- Visit `https://www.pulsemcp.com/submit`, choose "Submit server".
- Fill out the form with the fields below.
- They post a page at `https://www.pulsemcp.com/servers/graphrefly` (slug tbd) after approval.

### Form payload

Exact field names may have drifted; fill in the nearest equivalent.

- **Name:** `GraphReFly`
- **Short description (one sentence):** `Reactive harness layer — compose graphs, trace every decision causally, manage snapshots as MCP tools.`
- **Long description:**

  > GraphReFly is a reactive graph protocol for human + LLM co-operation. The MCP server exposes twelve tools that make the full GraphReFly surface callable from any MCP client (Claude Desktop, Claude Code, Cline, Cursor, Continue, …):
  >
  > - **Compose** — `graphrefly_create` compiles a `GraphSpec` (JSON) into a live reactive graph.
  > - **Inspect** — `graphrefly_describe`, `graphrefly_observe`, and `graphrefly_list` expose topology and values with progressive detail levels and Mermaid/D2 export.
  > - **Trace** — `graphrefly_explain` walks dependencies backward and returns a `CausalChain` answering "why is this node the way it is?".
  > - **Run** — `graphrefly_reduce` performs stateless `input → pipeline → output` one-shot runs.
  > - **Persist** — `graphrefly_snapshot_save` / `_restore` / `_diff` / `_list` / `_delete` for checkpoint management.
  >
  > Stdio transport. Zero runtime dependencies beyond the MCP SDK and Zod. Optional `GRAPHREFLY_STORAGE_DIR` env var for on-disk snapshot persistence (in-memory otherwise). MIT licensed.

- **Repository URL:** `https://github.com/graphrefly/graphrefly-ts`
- **Homepage:** `https://graphrefly.dev`
- **Install / run command:** `npx -y @graphrefly/mcp-server`
- **npm package:** `@graphrefly/mcp-server`
- **Transport:** stdio
- **Categories / tags:** `agent-harness`, `orchestration`, `observability`, `causal-trace`, `workflow`, `reactive-graph`, `snapshots`, `llm-tools`
- **Author / maintainer:** David Chen (`@graphrefly`)
- **License:** MIT
- **Logo:** attach 400×400 PNG.
- **Screencap:** optional but recommended — 30 second demo of `graphrefly_create` + `graphrefly_describe` + `graphrefly_explain` in Claude Desktop.

---

## Directories worth considering later (not in §9.2 scope)

- **Smithery** (`smithery.ai`) — manifest-driven, has a CLI; good next target after MCP Registry lands.
- **Glama** (`glama.ai/mcp`) — scrapes the MCP Registry, so listing is often automatic.
- **mcp.so** (`mcp.so`) — community directory; form submission.
- **MCPServers.org** — community directory; form submission.

Track these in `docs/optimizations.md` under "Distribution — MCP directories" when §9.2 is closed out.
