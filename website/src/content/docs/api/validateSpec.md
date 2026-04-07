---
title: "validateSpec()"
description: "Validate a GraphSpec JSON object.\n\nChecks structural validity: required fields, node types, dep references,\ntemplate references, feedback edge targets, self-cyc"
---

Validate a GraphSpec JSON object.

Checks structural validity: required fields, node types, dep references,
template references, feedback edge targets, self-cycles, and bind completeness.

## Signature

```ts
function validateSpec(spec: unknown): GraphSpecValidation
```

## Parameters

| Parameter | Type | Description |
|-----------|------|-------------|
| `spec` | `unknown` |  |
