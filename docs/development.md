# TypeScript development

Use [the package metadata](../package.json), [mise toolchain](../.mise.toml) and
[documentation policy](docs.jsonl) for commands and ownership. The only current
TypeScript implementation is `@graphrefly/ts`.

```sh
pnpm install
pnpm test
pnpm run lint
pnpm run build
pnpm run docs:gen:check
pnpm run docs:gen:missing
```

Generated API pages and sidebars come from exported API JSDoc through
`website/scripts/gen-api-docs.mjs`; do not hand-edit them. The shared public site,
blog and protocol/control views are [root-owned](../../graphrefly/guide/docs.jsonl).

Use [root contributor guidance](../../graphrefly/guide/contribute.jsonl) and
[the authority contract](../../graphrefly/authority/README.md) for spec-first,
owner-first admission, no-backward-compatibility migration and shared workflow
constraints. Protocol, message, ctx and batch changes require root spec-amend.
Operators and package ergonomics do not become cross-runtime protocol by being
implemented here. Historical root-origin decision files are relocation-only.

Do not restore the old root/pure-ts packages, structural Impl parity or port-era
workflows from historical documents. [The documentation map](README.md) locates
current work, rules and retained history. If package code and governing rules
conflict, surface the exact conflict rather than choose semantics autonomously.

For Rust commands used from this checkout, follow the sibling
[development guide](../../graphrefly-rs/docs/development.md) and use
`mise exec -- cargo <cmd>` (or `~/.cargo/bin/cargo` when PATH is constrained).

Generated node and group names follow [R-naming@1](../../graphrefly/spec/rules.jsonl):
use `/` and camelCase, preserving semantic words and removing only repeated prefix words.
The first generated scope, view or binding is unsuffixed; later instances use `1`, `2`, etc.
Reject local names containing `::` or beginning/ending with `:` before mutation; preserve
other caller labels, recipe keys and payload identities.
Collection request nodes use `snapshotRequest`; persistence defaults to
`reactiveCollection/persistence`, and shared Agentic aggregate nodes use `snapshot`.
