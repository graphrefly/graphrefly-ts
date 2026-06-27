# reactive-layout examples

Reactive-layout examples are split by purpose:

- `flow/` is a runnable browser demo for `reactiveFlowLayout` plus browser canvas measurement.
- `recipes/` is user-land glue for platform measurement facts: React Native
  `onLayout`/native probes, Skia font readiness, and provider composition with
  `mergeMeasurements`.

The recipes are intentionally not standalone apps because they reference optional host runtimes
such as React Native and React Native Skia. Those packages stay caller-owned and do not become
workspace or universal reactive-layout dependencies.
