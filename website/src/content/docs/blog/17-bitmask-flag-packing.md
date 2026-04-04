---
title: "Bitmask Flag Packing in TypeScript"
description: "Why GraphReFly packs status and lifecycle flags into a single integer field, and how that improves object shape stability and hot-path performance."
date: 2026-03-25T09:00:00
authors: [david]
tags: [performance, architecture]
---

# Bitmask Flag Packing in TypeScript

*Chronicle 17 - Arc 5: Architecture v4 - Performance Without Compromise*

JavaScript engines reward stable object shapes. Reactive runtimes touch the same node fields millions of times. Tiny layout decisions matter.

In v4, we consolidated multiple boolean and enum-like fields into one `_flags` integer with bit ranges for status and lifecycle state.

## The before and after

Before, a node tracked state with multiple properties:

- separate booleans (`isDirty`, `isRunning`, `isPaused`, ...)
- string status (`"idle"`, `"running"`, `"success"`, ...)
- a few transient markers

After, internal state is packed:

- bits `0..n` for boolean flags
- bits `7..9` for status code
- getters expose human-friendly status strings externally

Users still see readable values. Hot paths use integers.

## Why engines like this

Packing helps in three ways:

- **Fewer property loads** in dispatch loops
- **Stable hidden classes** from predictable field layout
- **Cheaper comparisons** with bit operations instead of strings

This does not turn TypeScript into C. It just avoids avoidable runtime overhead where the graph is hottest.

## Trade-offs

Bitmasks can become write-only code if unmanaged. We mitigated that with:

- named constants for every bit and mask
- helper functions for encode/decode
- explicit comments for reserved ranges

If you cannot understand your own bit layout in six months, you traded too much readability for speed.

## Where not to use it

We did not pack everything. Low-frequency or user-facing values stay explicit. Bit packing is for dense, high-frequency internal state only.

Rule of thumb: if a field is not read in the dispatch critical path, leave it readable.

## Lesson

Performance work is often about representation, not algorithms.

Packing flags gave us better engine behavior without changing semantics. Same architecture, better fit for how JavaScript actually executes.
