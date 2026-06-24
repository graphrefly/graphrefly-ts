---
title: "Integration Matrix"
description: "Current integration surface across focused clean-slate adapter subpaths."
---

This matrix is the fast inventory view. Use it to find what exists today, where to look next, and which package or doc path to start from.

## Adapters

| Integration | Type | Entry |
|---|---|---|
| OpenTelemetry | Adapter | `fromOTel` |
| Kafka | Adapter | `fromKafka` |
| Webhook | Adapter | `fromWebhook` |
| SSE | Adapter | `toSSE` |
| MCP | Adapter | `fromMCP` |
| Postgres | Adapter | `toPostgres` |

See [Adapters](/integrations/adapters/) for usage guidance and naming conventions.

## Framework and Host Bindings

| Integration | Type | Entry |
|---|---|---|
| React | Framework adapter | `@graphrefly/ts/adapters/react` |
| Vue | Framework adapter | `@graphrefly/ts/adapters/vue` |
| Solid | Framework adapter | `@graphrefly/ts/adapters/solid` |
| Svelte | Framework adapter | `@graphrefly/ts/adapters/svelte` |
| NestJS structural metadata | D484 dependency-light boundary factories/decorators | `@graphrefly/ts/adapters/nestjs` |
| NestJS native providers | D486 phase bridges for interceptor/guard/filter/cron/lifecycle plus targeted guard-denial response filter | `@graphrefly/ts/adapters/nestjs/native` |
| NestJS WebSocket boundary | D488 focused optional-peer native gateway bridge | `@graphrefly/ts/adapters/nestjs/websockets` |
| NestJS microservice boundary | D488 focused optional-peer native message-pattern bridge | `@graphrefly/ts/adapters/nestjs/microservices` |
| Jotai-style facade | Framework-neutral store facade | `jotaiAtom` from `@graphrefly/ts/adapters` |
| Nanostores-style facade | Framework-neutral store facade | `nanoAtom` from `@graphrefly/ts/adapters` |
| Zustand-style facade | Framework-neutral store facade | `zustandStore` from `@graphrefly/ts/adapters` |

Legacy `@graphrefly/graphrefly/compat/*` imports are retired.
