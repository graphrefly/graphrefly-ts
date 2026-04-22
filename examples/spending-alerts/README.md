# spending-alerts

Node-runnable pipeline backing homepage pain point 02 (_"Action Without Explanation"_) and the [spending-alerts walkthrough](../../website/src/content/docs/demos/spending-alerts.md).

A 5-hop reactive graph flags an anomalous transaction; `graph.explain("txFeed", "alertMessage")` prints the causal chain from raw input to final conclusion.

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
