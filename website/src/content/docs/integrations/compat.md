---
title: "Retired Compat"
description: "Historical note for the retired pre-clean-slate compatibility layers."
---

The old `@graphrefly/graphrefly/compat/*` runtime model is retired. Clean-slate framework and host bindings now live under focused `@graphrefly/ts/adapters/*` subpaths.

## Current replacements

- **NestJS**: `@graphrefly/ts/adapters/nestjs` keyed ingress/egress boundary nodes.
- **React/Vue/Solid/Svelte**: focused framework adapter subpaths.
- **Jotai/Nanostores/Zustand-style facades**: small store facades from `@graphrefly/ts/adapters`.

See the full walkthrough in [NestJS Integration](/recipes/nestjs-integration/).

## What stayed retired

Do not use `compat/nestjs`, `GraphReflyModule`, `GraphReflyGuard`, `Actor`, `CqrsGraph`, hidden event buses, or root `@graphrefly/graphrefly` imports for clean-slate work.
