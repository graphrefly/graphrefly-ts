---
title: "TypeScript Docs"
description: "Package-local documentation for @graphrefly/ts."
tableOfContents: false
slug: /
---

<!-- Legacy TypeScript website content. D563 package-local docs host marker. -->

TypeScript APIs, examples, demos, recipes, integrations, and comparisons for
building graph-driven reactive systems with `@graphrefly/ts`.

## Start here

- **[API reference](/api/)** — generated from current exports and source JSDoc.
- **[Solutions](/solutions/)** — higher-level package bundles such as reactive layout.
- **[Examples](/examples/)** — small TypeScript entry points and runnable repo examples.
- **[Demos](/demos/)** — interactive and walkthrough-style package demos.
- **[Recipes](/recipes/)** — composition notes for common runtime boundaries.
- **[Integrations](/integrations/)** — adapters, sources, storage, and framework edges.
- **[Compare](/compare/)** — migration and positioning notes for adjacent tools.

## Install

```bash
npm i @graphrefly/ts
```

```ts
import { graph } from "@graphrefly/ts/graph";
import { map } from "@graphrefly/ts/operators";

const g = graph({ name: "hello" });
const count = g.state(1, { name: "count" });
const doubled = g.initNode(map((n: number) => n * 2), [count], { name: "doubled" });

doubled.subscribe((msgs) => console.log(msgs));
// [["START"], ["DATA", 2]]
count.set(2);
// [["PENDING"], ["DATA", 4]]
```

Every node is built by a graph: `g.state`, `g.derived`, `g.effect`, `g.producer`,
`g.node` for a raw `(ctx) => void` function, and `g.initNode(operator, deps)` for
operators and sources. `@graphrefly/ts/core` holds the low-level types (`Node`,
`Ctx`, `Message`) and the dispatcher.
