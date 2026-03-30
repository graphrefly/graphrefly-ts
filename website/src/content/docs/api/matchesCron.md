---
title: "matchesCron()"
description: "Returns `true` if `date` satisfies every field of `schedule`."
---

Returns `true` if `date` satisfies every field of `schedule`.

## Signature

```ts
function matchesCron(schedule: CronSchedule, date: Date): boolean
```

## Parameters

| Parameter | Type | Description |
|-----------|------|-------------|
| `schedule` | `CronSchedule` | Parsed schedule from parseCron. |
| `date` | `Date` | Moment to test (local time via `getMinutes`, `getHours`, etc.). |

## Returns

`true` when all five cron fields match the given date.

## Basic Usage

```ts
import { parseCron, matchesCron } from "@graphrefly/graphrefly-ts";

const sched = parseCron("30 8 * * 1"); // Mondays at 08:30
const monday = new Date("2026-03-30T08:30:00"); // a Monday
matchesCron(sched, monday); // true
```
