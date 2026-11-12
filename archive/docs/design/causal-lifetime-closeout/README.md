# Finite lifetime diagnostic

This diagnostic follows one bounded consumer run through all 64 successful simulated writes, retaining every result until the test ends. It compares automatic assembly with manual orchestration of the same node builder. It does not establish formal performance qualification or stationary steady-state throughput.

Run `node scripts/measure-spending-host-lifetime.mjs`. The receipt binds the script, complete bundled source dependency set, baseline commit, environment, method, raw frontier observations, memory points and failures. This first run completed with no failures or source changes during execution.

## Scope and checks

Both diagnostics modes use the original two-vendor fixture, revisions 1–32 per vendor, with one write outstanding and the original finite bounds. Each arm completes one warmup lifetime and three measured lifetimes; arm order alternates. Every paired lifetime checks exact topology and retained outcomes, each write matches independently constructed oracle bytes, and the complete run reaches `normalEndReady=true`.

Each input timing covers synchronous batched current, verification, local-authority and arrival publication. Completion timing covers microtask drainage of immediately fulfilled simulated writes. Pack preparation, assertions and memory sampling are outside those intervals. There are five identical no-op view observers in each arm. Per-input rows form a growing retained-history trajectory; they are not independent statistical samples.

## Observed results

Across measured automatic lifetimes, the first eight requests averaged about 3.6–4.0 ms of synchronous input processing and 1.2–1.4 ms completion processing. The final eight averaged about 35.1–37.0 ms and 13.8–14.5 ms respectively. Manual assembly shows the same growth: about 35.1–35.6 ms input and 13.5–14.0 ms completion for its final eight.

The shared path therefore has a meaningful cost as retained history grows. This comparison does not identify its root cause or support attributing the growth to the automatic assembly wrapper. Individual maxima and all ordered observations remain in the receipt; these descriptive ranges are not a new acceptance budget.

Every lifetime retained 64 successful results, made 64 simulated writes, published 129 notifications, and reached normal-end eligibility. The largest completion snapshot was 47,167 bytes. This differs from the earlier one-success/63-refusals snapshot because outcome contents differ.

## Separate memory diagnostic

Four fresh processes used `--expose-gc`, one per arm/mode. Two GC calls preceded each observation. No explicit GC occurred in timing workers.

| Mode | Arm | Active 64-record heap increase | After forced test teardown increase |
|---|---|---:|---:|
| off | automatic | 5.120 MiB | 1.572 MiB |
| off | manual | 5.120 MiB | 1.572 MiB |
| summary | automatic | 5.129 MiB | 1.572 MiB |
| summary | manual | 5.128 MiB | 1.574 MiB |

The baseline, after fixture/module loading but before graph construction, was about 5.535 MiB heap used. Active process RSS was about 155–156 MiB. RSS includes Node/V8, compiled code, allocator history and the measurement process; it is not graph-retained heap. The active point is after normal-end eligibility while the run still owns its records. Test teardown then releases all graph nodes and drops the harness references.

The remaining roughly 1.57 MiB cannot be called a leak or assigned to retained host records by this measurement. Compilation, caches, module and runtime state can remain. These finite post-GC observations are not full allocation attribution or a heap-retention proof.

No public API, protocol, production source or resource budget changed. No real inbox I/O was performed.
