---
title: "Compat"
description: "Framework compatibility layers that embed GraphReFly into application runtimes."
---

Compat packages make GraphReFly feel native inside framework ecosystems.

## Current compat layers

- **NestJS**: Graph module wiring, CQRS helpers, guards, and stream bridges.
- **Jotai**: Bind graph nodes into atom-driven React state.
- **Nanostores**: Expose graph values through store-first reactive APIs.
- **Zustand**: Bridge graph updates into lightweight store slices.

See the full walkthrough in [NestJS Integration](/recipes/nestjs-integration/).

## When to use compat

- You want framework-native dependency injection and lifecycle hooks.
- You are integrating GraphReFly into an existing app architecture incrementally.
- You want framework ergonomics without losing graph observability and checkpointing.

## When to use raw API instead

Use core/extra APIs directly when you are building standalone runtimes or libraries that should stay framework-agnostic.
