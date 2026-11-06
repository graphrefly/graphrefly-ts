# TypeScript agent entrypoint

Start with [README](README.md) and the [documentation map](docs/README.md).
This repository owns `@graphrefly/ts`; language-neutral protocol and cross-project
contracts remain in [root authority](../graphrefly/AGENTS.md).

- [Package documentation policy](docs/docs.jsonl) owns the local docs boundary.
- [Local work](plan/work.jsonl) owns TS delivery. Resolve foreign work through
  [the root locator](../graphrefly/authority/work-ledgers.jsonl).
- [Local decisions](decisions/decisions.jsonl) own TS-only locks. Use
  [the authority contract](../graphrefly/authority/README.md) and
  [ledger locator](../graphrefly/authority/ledgers.jsonl) for admission/history.
- [Current protocol and drafts](../graphrefly/authority/README.md#protocol-revision-contract)
  remain distinct. Route semantic changes through root spec-amend before code.
- [Development](docs/development.md) contains package checks and migration constraints.

For authority or execution/spend/retry classification follow
[personal project governance](/Users/davidchenallio/.codex/skills/project-governance/SKILL.md).
Use the local [design-review](.agents/skills/design-review/SKILL.md),
[dev-dispatch](.agents/skills/dev-dispatch/SKILL.md) and [QA](.agents/skills/qa/SKILL.md)
entrypoints within approved work. Shared build and human review use
[bmad-build](.agents/skills/bmad-build/SKILL.md) and
[bmad-checkpoint-preview](.agents/skills/bmad-checkpoint-preview/SKILL.md).
Human review is build-handoff by default; explicit checkpoint/`--practice` is interactive.
The maintained cross-project workflows are [root-owned](../graphrefly/AGENTS.md#workflow-routing).
