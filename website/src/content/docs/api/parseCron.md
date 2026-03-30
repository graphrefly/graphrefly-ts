---
title: "parseCron()"
description: "Parses a standard 5-field cron expression into a CronSchedule.\n\nSupports `*`, ranges (`1-5`), steps (`*\\/5`, `0-30/10`), and comma-separated\nlists. Fields are: "
---

Parses a standard 5-field cron expression into a CronSchedule.

Supports `*`, ranges (`1-5`), steps (`*\/5`, `0-30/10`), and comma-separated
lists. Fields are: minute (0–59), hour (0–23), day-of-month (1–31),
month (1–12), day-of-week (0–6, Sunday = 0).

## Signature

```ts
function parseCron(expr: string): CronSchedule
```

## Parameters

| Parameter | Type | Description |
|-----------|------|-------------|
| `expr` | `string` | Five-field whitespace-separated cron string (e.g. `"0 9 * * 1-5"`). |

## Returns

Parsed CronSchedule with one `Set&lt;number&gt;` per field.

## Basic Usage

```ts
import { parseCron } from "@graphrefly/graphrefly-ts";

const sched = parseCron("0 9 * * 1-5"); // weekdays at 09:00
sched.hours;      // Set { 9 }
sched.daysOfWeek; // Set { 1, 2, 3, 4, 5 }
```
