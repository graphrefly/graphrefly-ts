# spending-alerts

Node-runnable pipeline backing homepage pain point 02 (_"Action Without Explanation"_) and the [spending-alerts walkthrough](../../website/src/content/docs/demos/spending-alerts.md).

A 5-hop reactive graph flags an anomalous transaction; `graph.describe({ explain: { from: "txFeed", to: "alertMessage" } })` prints the causal chain from raw input to final conclusion.

## Run

```sh
pnpm --filter @graphrefly-examples/spending-alerts start
```

## Topology

```
txFeed (source) → anomalyScore → thresholdGate → reasonFactors → alertMessage
       ↑
  (vendorStats + userProfile feed in as side inputs to anomalyScore)
```

## Output

See the walkthrough page for sample output and a line-by-line explanation of how to get the same behaviour in your own graph.

## Private causal entry and progressive disclosure

Run the complete **offline simulated** integration from the repository root:

```sh
node --import tsx examples/spending-alerts/causal-graded-demo.ts
```

The application creates actual input Nodes, an independent fixture verifier and an
`OfflineAlertResource`, then calls `spendingAlertsFor(graph, { name: "alerts" }).compose(inputs)`.
Configuration allocates no graph nodes; each composition creates a complete runtime. Distinct
instances require distinct names, inputs and resource bindings. Overrides are limited to `name`
and `diagnostics`, with `undefined` inheriting the immutable defaults.

The application keeps the original owner and diagnostics. Display components receive only `.view`
and use `ordinarySpendingPanel`; frameworks receive the original `.capabilities`; maintainers inspect
the same Graph. Unmounting a panel does not settle obligations or erase retained evidence. The example
checks a pending write completing while the panel is detached, then reconnects to the same instance.

These are consumer-private source imports, **not a published package subpath**. The value adapter reports
latest values per port, not an atomic snapshot. Missing facts remain visible. Startup is distinct from
normal lifecycle completion; fixture digests do not attest the loaded production source.

See the [single implementation review](../../docs/design/causal-graded-entry-implementation/README.md)
for the saved business view, complete graph, independent source-change evidence and verification receipts.
