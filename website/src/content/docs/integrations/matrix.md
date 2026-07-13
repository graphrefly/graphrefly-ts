---
title: "Integration Matrix"
description: "Current package, adapter, application, and framework surfaces across focused subpaths."
---

> **Legacy TypeScript website content.** Shared public website, blog, protocol, guide, and
> language-neutral docs ownership now lives in `~/src/graphrefly` under D563.
> This page is retained here only as migration/reference material while the TS
> API generator still lives in `website/`.


This matrix is the fast inventory view. Use it to find what exists today, where to look next, and which package or doc path to start from.

## Focused Package Surfaces

| Surface | Type | Entry |
|---|---|---|
| Root convenience surface | Primary package entry | `@graphrefly/ts` |
| Core graph layer | Graph API | `@graphrefly/ts/graph` |
| Protocol/core primitives | Node, ctx, and message-level API | `@graphrefly/ts/core` |
| Data contracts | Data-only result and issue types | `@graphrefly/ts/data` |
| Operators | Tree-shakeable operator factories | `@graphrefly/ts/operators` |
| Sources | Universal source factories | `@graphrefly/ts/sources` |
| Browser sources | Browser-only source factories | `@graphrefly/ts/sources/browser` |
| Node sources | Node-only source factories | `@graphrefly/ts/sources/node` |
| Render | Pure describe snapshot renderers | `@graphrefly/ts/render` |
| Composition | Topology composition helpers | `@graphrefly/ts/composition` |
| Data structures | Reactive list/map/index/log helpers | `@graphrefly/ts/data-structures` |
| Passive storage | Storage codecs, KV, append-log, WAL, and read-through helpers | `@graphrefly/ts/storage` |
| Browser storage | IndexedDB-backed storage helpers | `@graphrefly/ts/storage/browser` |
| Node storage | File and SQLite-backed storage helpers | `@graphrefly/ts/storage/node` |
| Testing helpers | Package-level assertions for tests | `@graphrefly/ts/testing` |

See [Adapters](/integrations/adapters/) for usage guidance and naming conventions.

## Adapter and Application Surfaces

| Surface | Type | Entry |
|---|---|---|
| Generic adapters | Store facades, environment projections, bridge helpers, and persistence adapters | `@graphrefly/ts/adapters` |
| Observe storage adapter | Graph-observe egress into passive storage sinks/logs | `@graphrefly/ts/adapters/observe-storage` |
| Messaging | Topic message helpers and bus projections | `@graphrefly/ts/messaging` |
| CQRS | CQRS helpers | `@graphrefly/ts/cqrs` |
| CQRS messaging recipe | Focused CQRS messaging recipe | `@graphrefly/ts/cqrs/messaging` |
| CQRS work-queue recipe | Focused CQRS work-queue recipe | `@graphrefly/ts/cqrs/work-queue` |
| Work queue | Work queue facts and projections | `@graphrefly/ts/work-queue` |
| Orchestration | Process, retry, timeout, tool-provider, and scheduled-readiness projectors | `@graphrefly/ts/orchestration` |
| Orchestration messaging recipe | Focused orchestration messaging recipe | `@graphrefly/ts/orchestration/messaging` |
| Orchestration work-queue recipe | Focused orchestration work-queue recipe | `@graphrefly/ts/orchestration/work-queue` |
| Executor work-queue recipe | Focused executor work-queue recipe | `@graphrefly/ts/executors/work-queue` |
| Execution-environment targeting | Strict environment-pinned profile/route/run contracts and D419-admitted local-host gate; remote/container bindings are not implied | `@graphrefly/ts/executors/execution-environment` |
| Local-container PostgreSQL binding | Digest-pinned, host-injected PostgreSQL container lifecycle with exact cancellation and independently visible cleanup | `@graphrefly/ts/executors/local-container-postgresql` |
| Tool-provider execution recipe | Focused tool-provider execution recipe | `@graphrefly/ts/executors/tool-provider` |
| Tool-provider runtime | Explicit low-level adapter runtime attach boundary; runtime handles stay private data | `@graphrefly/ts/executors/tool-provider-runtime` |
| Tool-provider adapter pack | Local builtin, process, and HTTP adapter helpers | `@graphrefly/ts/executors/tool-provider-adapters` |
| PostgreSQL tool-provider adapter | Version-pinned PostgreSQL-compatible read-only async runtime with private driver lifecycle | `@graphrefly/ts/executors/postgresql-tool-provider` |
| Boundary inspection | Boundary manifest inspection helpers | `@graphrefly/ts/inspection/boundary` |
| Memory | Horizontal memory and fact-fragment families | `@graphrefly/ts/memory` |
| Semantic memory | Focused semantic memory fact-fragment helpers | `@graphrefly/ts/memory/semantic` |
| Patterns | Reusable projection patterns | `@graphrefly/ts/patterns` |
| Event-flow pattern | Focused event-flow pattern | `@graphrefly/ts/patterns/event-flow` |
| Scoring | Reusable subjects/signals/policy scoring helpers | `@graphrefly/ts/scoring` |
| Solutions | Vertical solution kits | `@graphrefly/ts/solutions` |
| Agentic memory | Focused agentic memory solution | `@graphrefly/ts/solutions/agentic-memory` |
| Agentic memory browser | Browser-only AgenticMemory reference backends | `@graphrefly/ts/solutions/agentic-memory/browser` |
| Agentic memory Node | Node-only AgenticMemory reference backends | `@graphrefly/ts/solutions/agentic-memory/node` |
| Agentic WorkItem memory bridge | Mapper-only bridge namespace | `@graphrefly/ts/solutions/agentic-work-item-memory` |
| Agentic WorkItem memory application | Cross-family application composition recipe | `@graphrefly/ts/solutions/agentic-work-item-memory-application` |
| Reactive layout | DOM-free reactive layout solution core | `@graphrefly/ts/solutions/reactive-layout` |
| Reactive layout browser | Browser measurement helpers | `@graphrefly/ts/solutions/reactive-layout/browser` |
| Reactive layout node-canvas | Node canvas measurement helpers | `@graphrefly/ts/solutions/reactive-layout/node-canvas` |
| Reactive layout React Native | React Native measurement helpers | `@graphrefly/ts/solutions/reactive-layout/react-native` |
| Reactive layout Skia | Skia measurement helpers | `@graphrefly/ts/solutions/reactive-layout/skia` |
| Work item | Focused WorkItem solution barrel | `@graphrefly/ts/solutions/work-item` |
| Work-item actions | Focused work-item action projectors | `@graphrefly/ts/solutions/work-item/actions` |
| Work-item scheduling | Focused work-item scheduling projectors | `@graphrefly/ts/solutions/work-item/scheduling` |
| Work-item work-queue recipe | Focused work-item work-queue recipe | `@graphrefly/ts/solutions/work-item/work-queue` |

## Framework and Host Bindings

| Integration | Type | Entry |
|---|---|---|
| React | Framework adapter | `@graphrefly/ts/adapters/react` |
| Vue | Framework adapter | `@graphrefly/ts/adapters/vue` |
| Solid | Framework adapter | `@graphrefly/ts/adapters/solid` |
| Svelte | Framework adapter | `@graphrefly/ts/adapters/svelte` |
| NestJS structural metadata | D484 dependency-light boundary factories/decorators | `@graphrefly/ts/adapters/nestjs` |
| NestJS native providers | D494 HTTP/guard/filter/cron/lifecycle provider bundles and explicit targets | `@graphrefly/ts/adapters/nestjs/native` |
| NestJS WebSocket boundary | D488 focused optional-peer gateway bridge plus D495 provider bundle | `@graphrefly/ts/adapters/nestjs/websockets` |
| NestJS microservice boundary | D488 focused optional-peer message-pattern bridge plus D495 provider bundle | `@graphrefly/ts/adapters/nestjs/microservices` |
| Jotai-style facade | Framework-neutral store facade | `jotaiAtom` from `@graphrefly/ts/adapters` |
| Nanostores-style facade | Framework-neutral store facade | `nanoAtom` from `@graphrefly/ts/adapters` |
| Zustand-style facade | Framework-neutral store facade | `zustandStore` from `@graphrefly/ts/adapters` |

Legacy `@graphrefly/graphrefly/compat/*` imports are retired.

NestJS provider bundles are explicit arrays over existing options. They are not modules, do not scan the container, do not create graphs, and do not own retry, session, reconnect, or transport lifecycle policy. Graph-visible adapter diagnostics require an explicitly wired sanitized diagnostics ingress boundary; there is no diagnostics callback or logging API.
