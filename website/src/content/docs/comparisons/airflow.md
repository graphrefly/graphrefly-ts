---
title: "GraphReFly vs Apache Airflow"
description: "Both orchestrate data pipelines with DAG semantics — GraphReFly is lightweight, reactive, runs anywhere, and requires no infrastructure."
---

Both orchestrate data pipelines with DAG semantics. GraphReFly is lightweight, reactive, runs anywhere, and requires no infrastructure.

## At a Glance

| Feature | Airflow | GraphReFly |
|---------|---------|------------|
| **Language** | Python | TypeScript |
| **Infrastructure** | Scheduler + Workers + DB + UI | None (runs in-process) |
| **Runs in browser** | No | Yes |
| **DAG definition** | Python decorators / YAML | `pipeline()` + `task()` — TypeScript |
| **Execution model** | Polling (check DB) | Reactive (push-based) |
| **Scheduling** | Built-in scheduler | `fromCron()` — zero-dep cron parser |
| **Persistence** | PostgreSQL/MySQL | `checkpoint()` — file, SQLite, IndexedDB |
| **Human-in-the-loop** | Manual approval sensor | `gate()` — native, reactive |
| **Monitoring** | Web UI + logs | `graph.describe()` + `graph.observe()` |
| **Retry** | Task-level retry | `retry()`, `circuitBreaker()` — composable |
| **Latency** | Seconds (polling + DB) | Microseconds (in-process, push) |
| **Bundle size** | N/A (server platform) | ~5 KB core (tree-shakeable) |

## The Key Difference

Airflow is a platform — you deploy it, manage it, and build on it. GraphReFly is a library — `npm i @graphrefly/graphrefly-ts` and compose pipelines in your existing TypeScript codebase.

```python
# Airflow (Python)
from airflow.decorators import dag, task
from datetime import datetime

@dag(schedule='0 9 * * *', start_date=datetime(2024, 1, 1))
def daily_pipeline():
    data = fetch_data()
    transformed = transform(data)
    save(transformed)
```

```ts
// GraphReFly (TypeScript)
import {
  pipe, exhaustMap, derived, effect, retry, fromCron, fromPromise
} from "@graphrefly/graphrefly-ts";

const daily = fromCron('0 9 * * *')
const data = pipe(daily, exhaustMap(() => fromPromise(fetchData())), retry(3))
const transformed = derived([data], () => transform(data.get()))
effect([transformed], () => save(transformed.get()))
```

## What Airflow Lacks

### 1. Browser / Edge execution

Airflow requires a server with a scheduler, workers, and a metadata database. GraphReFly runs in the browser, edge runtimes, serverless functions, or your laptop.

### 2. Reactive execution

Airflow polls a database to check if tasks are ready. GraphReFly pushes values through the graph — microsecond latency vs seconds.

### 3. TypeScript native

Airflow is Python. If your app is TypeScript, you maintain two stacks. GraphReFly is your app language.

### 4. Composability

Airflow tasks are isolated Python functions. GraphReFly tasks are reactive nodes — compose them with `derived()`, `pipe()`, `switchMap()`, and the full operator set.

## What Airflow Does Better

- **Battle-tested at scale** — production-proven for massive data pipelines (1000+ DAGs)
- **Rich UI** — web dashboard for DAG visualization, task logs, trigger management
- **Ecosystem** — 1000+ pre-built operators (AWS, GCP, Spark, Kubernetes, etc.)
- **Multi-team coordination** — RBAC, connection management, variable store
- **Distributed execution** — Celery/Kubernetes executors for horizontal scaling

## When to Choose GraphReFly

- Your pipeline is part of a TypeScript application (not a standalone data platform)
- You need browser-side or edge execution
- You want reactive (push-based) execution, not polling
- Infrastructure overhead of Airflow is too high for your use case
- You need human-in-the-loop (`gate()`) or real-time monitoring (`graph.observe()`)
- Your pipeline has < 100 steps and doesn't need distributed execution
