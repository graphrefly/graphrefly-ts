---
title: "validateSpec()"
description: "Validate a GraphSpec JSON object.\n\nChecks structural validity: required fields, node types, dep references,\ntemplate references, feedback edge targets, self-cyc"
---

Validate a GraphSpec JSON object.

Checks structural validity: required fields, node types, dep references,
template references, feedback edge targets, self-cycles, and bind completeness.

**Effect-node feedback advisory (C24-3).** When a feedback edge's `from`
refers to an `effect` node, the validator flags it via `warnings` (not
`errors`) — effect nodes produce no DATA emission, so a feedback counter
targeting one will never advance. The spec compiles either way; the
advisory exists because the misconfiguration is silent at runtime
(counter at 0 forever) without it.

## Signature

```ts
function validateSpec(spec: unknown): GraphSpecValidation
```

## Parameters

| Parameter | Type | Description |
|-----------|------|-------------|
| `spec` | `unknown` |  |
