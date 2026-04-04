---
title: "GraphReFly vs n8n"
description: "Both wire together multi-step workflows — n8n is a visual automation platform; GraphReFly is a code-first reactive library."
---

Both wire together multi-step workflows. n8n is a visual automation platform; GraphReFly is a code-first reactive library.

## At a Glance

| Feature | n8n | GraphReFly |
|---------|-----|------------|
| **Interface** | Visual drag-and-drop UI | TypeScript code |
| **Deployment** | Self-hosted server or n8n Cloud | npm library (in-process) |
| **Runs in browser** | No | Yes |
| **Trigger types** | Webhooks, cron, events, manual | `fromCron()`, `fromWebhook()`, `fromEvent()` |
| **Execution model** | Webhook/polling -> queue -> worker | Reactive push (in-process) |
| **Branching** | If/Switch nodes | `derived()`, `filter()`, `dynamicNode()` |
| **Error handling** | Retry node, error workflow | `retry()`, `rescue()`, `circuitBreaker()` |
| **Human-in-the-loop** | Wait node (polling) | `gate()` — reactive approve/reject |
| **State** | Execution data only | Full reactive state graph |
| **Scheduling** | Built-in cron | `fromCron()` |
| **Persistence** | PostgreSQL/SQLite | `checkpoint()` — file, SQLite, IndexedDB |
| **Bundle size** | N/A (server platform) | ~5 KB core (tree-shakeable) |

## The Key Difference

n8n is a platform for non-developers to automate workflows visually. GraphReFly is a library for developers to build reactive pipelines in TypeScript with full type safety and composability.

```ts
// n8n — visual workflow (conceptual)
// Trigger: Webhook → HTTP Request → IF → Slack / Email

// GraphReFly — code-first reactive pipeline
import {
  state, pipe, filter, switchMap, derived, effect,
  fromWebhook, retry
} from "@graphrefly/graphrefly";

const webhook = fromWebhook('/api/incoming')
const enriched = pipe(webhook, switchMap(payload =>
  fromPromise(fetchExternalData(payload))
), retry(3))
const urgent = pipe(enriched, filter(d => d.priority === 'high'))
const summary = derived([enriched], () => summarize(enriched.get()))
effect([urgent], () => notifySlack(urgent.get()))
```

## What n8n Lacks

### 1. Reactive state

n8n workflows are stateless executions — each run is independent. GraphReFly maintains reactive state between events. Derived values, running totals, and historical context are first-class.

### 2. Type safety

n8n passes JSON blobs between nodes. GraphReFly is fully typed — every operator, every node, every derived value is type-checked at compile time.

### 3. Browser execution

n8n requires a server. GraphReFly runs in the browser for client-side workflows, edge AI, or hybrid patterns.

### 4. Diamond resolution

When multiple n8n branches converge, execution order is not guaranteed. GraphReFly's two-phase push ensures convergence points see consistent values.

### 5. Composability

n8n nodes are pre-built integrations. GraphReFly operators compose freely — `pipe(source, switchMap(fn), retry(3), debounce(100))` builds arbitrarily complex logic from simple primitives.

## What n8n Does Better

- **Visual builder** — non-developers can create and modify workflows
- **400+ integrations** — pre-built connectors for Slack, GitHub, Google Sheets, databases, CRMs
- **No coding required** — expressions, not TypeScript
- **Execution history UI** — built-in interface for viewing past runs, errors, and data
- **Easy deployment** — self-hosted or cloud, deploy in minutes

## When to Choose GraphReFly

- You're a developer who wants type-safe, testable pipelines
- You need reactive state (not just execution data)
- You need browser-side or edge execution
- You're building something n8n's pre-built nodes don't cover
- You want composable operators instead of visual node wiring
- You need diamond resolution for consistent multi-source convergence
