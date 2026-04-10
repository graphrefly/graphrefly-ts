---
title: "Integration Matrix"
description: "Current integration surface across adapters and compat layers."
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

## Compat

| Integration | Type | Entry |
|---|---|---|
| NestJS | Compat | `@graphrefly/graphrefly/compat/nestjs` |
| Jotai | Compat | `@graphrefly/graphrefly/compat/jotai` |
| Nanostores | Compat | `@graphrefly/graphrefly/compat/nanostores` |
| Zustand | Compat | `@graphrefly/graphrefly/compat/zustand` |

See [Compat](/integrations/compat/) for framework integration guidance.
