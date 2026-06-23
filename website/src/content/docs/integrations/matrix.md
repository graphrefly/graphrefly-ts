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
| NestJS | Experimental D478 decorator/provider host boundary adapter | `@graphrefly/ts/adapters/nestjs` |
| Jotai-style facade | Framework-neutral store facade | `jotaiAtom` from `@graphrefly/ts/adapters` |
| Nanostores-style facade | Framework-neutral store facade | `nanoAtom` from `@graphrefly/ts/adapters` |
| Zustand-style facade | Framework-neutral store facade | `zustandStore` from `@graphrefly/ts/adapters` |

Legacy `@graphrefly/graphrefly/compat/*` imports are retired.
