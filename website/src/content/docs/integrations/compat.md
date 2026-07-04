---
title: "Retired Compat"
description: "Historical note for the retired pre-clean-slate compatibility layers."
---

> **Legacy TypeScript website content.** Shared public website, blog, protocol, guide, and
> language-neutral docs ownership now lives in `~/src/graphrefly` under D563.
> This page is retained here only as migration/reference material while the TS
> API generator still lives in `website/`.


The old `@graphrefly/graphrefly/compat/*` runtime model is retired. Clean-slate framework and host bindings now live under focused `@graphrefly/ts/adapters/*` subpaths.

## Current replacements

- **NestJS structural metadata**: `@graphrefly/ts/adapters/nestjs` keyed ingress/egress boundary nodes plus decorators over existing graph nodes.
- **NestJS HTTP/native providers**: `@graphrefly/ts/adapters/nestjs/native` explicit D494 provider bundles for interceptor, guard, filter, cron, and lifecycle phases.
- **NestJS WebSocket/message providers**: `@graphrefly/ts/adapters/nestjs/websockets` and `@graphrefly/ts/adapters/nestjs/microservices` focused D495 provider bundles over the existing D488 bridges.
- **React/Vue/Solid/Svelte**: focused framework adapter subpaths.
- **Jotai/Nanostores/Zustand-style facades**: small store facades from `@graphrefly/ts/adapters`.

See the full walkthrough in [NestJS Integration](/recipes/nestjs-integration/).

## What stayed retired

Do not use `compat/nestjs`, `GraphReflyModule`, `GraphReflyGuard`, `Actor`, `CqrsGraph`, hidden event buses, root `@graphrefly/graphrefly` imports, container scanning, hidden graph creation, or transport retry/session/reconnect ownership for clean-slate work.

Adapter diagnostics are not a callback or logging API. Use host-side `diagnostics()` snapshots for local bridge state, or wire `fromNestDiagnostics(...)` explicitly when diagnostics should become sanitized graph DATA.
