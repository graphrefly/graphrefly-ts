# @graphrefly/cli

Stateless command-line shell for [GraphReFly](https://graphrefly.dev). Compile a `GraphSpec`, inspect its topology, trace causal chains, run one-shot reductions, and diff snapshots — all without writing code.

## Install

```bash
npm install -g @graphrefly/cli
# then use the `graphrefly` binary
```

Or run on demand:

```bash
npx @graphrefly/cli <command> ...
```

## 30-second quickstart

Create a tiny pricing graph as JSON, describe it, then explain one edge:

```bash
cat > pricing.json <<'JSON'
{
  "name": "pricing",
  "nodes": {
    "price": { "kind": "state", "initial": 100 },
    "tax":   { "kind": "derived", "deps": ["price"], "fn": "mul", "args": [0.1] },
    "total": { "kind": "derived", "deps": ["price", "tax"], "fn": "add" }
  }
}
JSON

npx @graphrefly/cli describe pricing.json --format=pretty
npx @graphrefly/cli describe pricing.json --format=mermaid > pricing.mmd
npx @graphrefly/cli explain  pricing.json --from price --to total --format=pretty
npx @graphrefly/cli observe  pricing.json --path total
```

Pipe the spec in via stdin by passing `-`:

```bash
cat pricing.json | npx @graphrefly/cli describe -
```

## Commands

| Command | What it does |
|---|---|
| `describe <spec>` | Compile a `GraphSpec` and emit its topology. Supports `--detail=minimal\|standard\|full` and `--format=json\|pretty\|mermaid\|d2`. |
| `explain  <spec> --from X --to Y` | Compile + walk dependencies from `Y` back to `X` and emit a `CausalChain`. |
| `observe  <spec> [--path P]` | Compile + one-shot observe: full graph state, or a single node if `--path` is given. |
| `reduce   <spec> --input <path\|-> [--input-path P] [--output-path Q] [--timeout-ms N]` | Stateless run: push `input` to `inputPath` (default `input`), await first `DATA` on `outputPath` (default `output`), print result, dispose. |
| `snapshot diff <a> <b>` | Diff two snapshot files on disk. |
| `snapshot validate <file>` | Structural validation of a snapshot envelope. |
| `help` / `--help` / `-h` | Print the help text. |

### Common flags

- `--format=json\|pretty` — stdout format (default `json`). `describe` also accepts `mermaid` and `d2` for topology rendering.
- `--detail=minimal\|standard\|full` — detail level for `describe` / `observe`.

### Spec and input sources

Any `<spec>` positional accepts either a path to a `.json` file or `-` for stdin. Same for `reduce --input`.

## Examples

Render a Mermaid diagram for a README:

```bash
npx @graphrefly/cli describe graph.json --format=mermaid > graph.mmd
```

Trace why a node has the value it has:

```bash
npx @graphrefly/cli explain graph.json --from user.input --to billing.total --format=pretty
```

One-shot reduction (stateless pipeline-as-function):

```bash
echo '{"query":"hello"}' | npx @graphrefly/cli reduce pipeline.json --input -
```

## Exit codes

| Code | Meaning |
|---|---|
| `0` | Success. |
| `1` | Runtime or validation error (`SurfaceError` printed as JSON on stderr). |
| `2` | Unknown command — prints help and exits. |

## Programmatic use

```ts
import { dispatch, parseArgv } from "@graphrefly/cli";

const argv = parseArgv(["describe", "pricing.json", "--format=pretty"]);
const exitCode = await dispatch(argv, { catalog: myFnCatalog });
```

`catalog` is a `GraphSpecCatalog` from `@graphrefly/graphrefly`. The default binary ships an empty catalog — state-only and passthrough specs work out of the box; custom `fn` names need an operator-provided catalog entry.

## License

[MIT](./LICENSE)
