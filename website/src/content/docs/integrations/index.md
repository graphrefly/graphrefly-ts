---
title: "Integrations"
description: "Connect GraphReFly to frameworks and infrastructure systems."
---

> **Legacy TypeScript website content.** Shared public website, blog, protocol, guide, and
> language-neutral docs ownership now lives in `~/src/graphrefly` under D563.
> This page is retained here only as migration/reference material while the TS
> API generator still lives in `website/`.


GraphReFly integrations are organized by role so teams can quickly choose the right entry point:

- **Adapters**: Connect external systems and host runtimes to graph nodes through focused subpaths.
- **Framework bindings**: React, Vue, Solid, Svelte, and NestJS live under focused adapter subpaths without reviving the retired `compat/*` runtime model.

## Start here

- If you need to answer **"Can GraphReFly connect to X?"**, use the [Integration Matrix](/integrations/matrix/).
- If you need **system connectors**, start with [Adapters](/integrations/adapters/).
- If you need **NestJS**, start with [NestJS Integration](/recipes/nestjs-integration/).

## Related docs

- Recipe examples live under [NestJS Integration](/recipes/nestjs-integration/), where focused adapters are used in a host workflow.
- API-level references live under the [API docs](/api/reactivelayout/).
