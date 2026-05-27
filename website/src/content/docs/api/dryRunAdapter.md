---
title: "dryRunAdapter()"
description: "Create a DryRun adapter."
---

Create a DryRun adapter.

## Signature

```ts
function dryRunAdapter(opts: DryRunAdapterOptions = {}): LLMAdapter
```

## Parameters

| Parameter | Type | Description |
|-----------|------|-------------|
| <code>opts</code> | <code>DryRunAdapterOptions</code> |  |

## Basic Usage

```ts
const adapter = dryRunAdapter({ respond: (msgs) => "hello from dry-run" });
const resp = await Promise.resolve(adapter.invoke([{ role: "user", content: "hi" }]));
```
