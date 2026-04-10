---
title: "Adapters"
description: "System-level connectors for ingesting and emitting reactive graph messages."
---

Adapters are where GraphReFly meets external systems. They convert events, streams, and transport payloads into graph-native message flow.

## Typical use cases

- Ingest infrastructure signals (for example from Kafka or OTel) into a graph pipeline.
- Emit graph outcomes to external delivery channels (for example SSE, storage, or transport systems).
- Bridge existing evented systems without rewriting orchestration logic.

## Design notes

- Prefer adapters when integrating **systems**.
- Keep business logic in graph nodes; adapters should stay thin and transport-focused.
- Use recipes for full workflows, adapters pages for "connect to X" docs.

## Next step

Use the [Integration Matrix](/integrations/matrix/) to locate a specific connector and then jump into its API reference.
