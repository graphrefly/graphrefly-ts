---
title: "Integration Matrix"
description: "Current integration surface across adapters, compat layers, and ecosystem packages."
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

See [Compat](/integrations/compat/) for framework integration guidance.

## Ecosystem

| Integration | Type | Entry |
|---|---|---|
| MCP Server | Ecosystem package | `@graphrefly/mcp-server` |
| Vercel AI SDK middleware | Ecosystem package | `@graphrefly/ai-sdk` |
| LangGraph tooling | Ecosystem package | `@graphrefly/langgraph` |

See [Ecosystem](/integrations/ecosystem/) for adoption strategy and quickstarts.
