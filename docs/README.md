# TypeScript documentation map

This repository owns package-local TypeScript documentation. Shared public docs
and protocol authority remain [root-owned](../../graphrefly/docs/README.md).

| Category | Question | Current entrypoint | Maintenance boundary |
|---|---|---|---|
| Rules | What applies now? | [Root current protocol](../../graphrefly/authority/README.md#protocol-revision-contract), [local docs policy](docs.jsonl), exported API JSDoc | Package guidance explains TS use without adding protocol requirements |
| Draft rules | What is unapproved or inactive? | Root [rule revisions](../../graphrefly/spec/rules.jsonl); local proposals indexed in [docs policy](docs.jsonl) | Design approval, implementation and activation are distinct |
| Decisions | Why this choice? | [Local ledger](../decisions/decisions.jsonl), [root locator](../../graphrefly/authority/ledgers.jsonl) | Root-origin history is immutable relocation material, not a new-record surface |
| Work | What is being done? | [Local work](../plan/work.jsonl), [root work locator](../../graphrefly/authority/work-ledgers.jsonl) | Local owner controls delivery; foreign work is linked |
| Evidence | What was checked? | Exact receipts in local work and [docs-policy indexes](docs.jsonl), retained [qualification](../packages/ts/qualification/) | Preserve hashes, failed attempts and verification limits |
| Design / guides | How do I use or maintain it? | [Usage](usage.md), [development](development.md), [RxJS migration](coming-from-rxjs.md), [benchmarks](benchmark.md), [design](design/) | Keep active design/evidence paths and generated API ownership intact |
| Reference | What material can inform us? | [Research](research/), [legacy website](../website/) | Reference and migration sources are not shared/public authority |

The package [docs policy](docs.jsonl) owns documentation maintenance and generation
checks. Do not edit generated API pages or mirror root shared docs. Current design,
research and hash-bound evidence stay in place; old planning/review documents were
moved only in the approved B142 batch. [B142 execution evidence](../../graphrefly/sessions/active/docs-reorganization-evidence/2026-11-05-ts.md)
records every move and its checks.
