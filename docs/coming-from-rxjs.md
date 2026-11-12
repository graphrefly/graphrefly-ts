# Coming from RxJS

A concise migration guide for developers familiar with RxJS moving to GraphReFly.

---

## Name mapping

GraphReFly uses its own operator names and ships no RxJS aliases.

| RxJS | GraphReFly |
|------|-----------|
| `combineLatest([a, b])` | `g.initNode(combine(), [a, b])` |
| `debounceTime(ms)` | `debounce(ms)` |
| `throttleTime(ms)` | `throttle(ms)` |
| `catchError(fn)` | `rescue(fn)` |
| `mergeMap(fn, n)` | `mergeMap(fn, { concurrent: n })` |
| `flatMap` | `mergeMap` |
| `shareReplay(1)` | Not needed: every node multicasts and keeps its latest value |

---

## API shape differences

### Every node belongs to a graph

An operator is a factory definition. It becomes a node when a graph instantiates it
with its dependencies:

```ts
import { graph, map } from "@graphrefly/ts";

const g = graph({ name: "app" });
const source = g.state(1, { name: "source" });
const doubled = g.initNode(map((x: number) => x * 2), [source], { name: "doubled" });
```

There is no standalone node. `describe()` lists every node a graph built.

### Combinators take a dependency array

```ts
// RxJS
combineLatest([a, b, c]);

// GraphReFly
g.initNode(combine<[number, string, boolean]>(), [a, b, c]);
```

This applies to `merge`, `combine`, `zip`, `race` and `withLatestFrom`.

### Chaining with `pipe`

```ts
// RxJS
source$.pipe(
  map((x) => x - 2),
  filter((x) => x > 0),
);

// GraphReFly: the graph and the source come first
const positive = pipe(
  g,
  source,
  map((x: number) => x - 2),
  filter((x: number) => x > 0),
);
```

`pipe` instantiates each step through `g.initNode`, so `describe()` shows every step
as its own node.

### Subscribers receive arrays of messages

A sink receives one array of messages per delivery, not one value:

```ts
positive.subscribe((msgs) => {
  for (const [type, value] of msgs) {
    if (type === "DATA") console.log(value);
  }
});
```

The first array a subscriber receives is `START` followed by the node's current
value, if it has one. A late subscriber therefore sees the latest value without a
`shareReplay`.

---

## Intentional divergences

| Topic | RxJS | GraphReFly |
|-------|------|-----------|
| **scan / reduce seed** | Seed is optional (seedless mode infers from first value) | Seed is always required: `scan(reducer, seed)` |
| **tap** | Accepts a function or a partial `Observer` | Accepts a function or `{ data, error, complete }` observer object |
| **share / replay** | Opt-in operators with configurable `refCount` | Built in: a node multicasts, keeps its latest value, activates on its first subscriber and deactivates when the last one leaves |
| **startWith** | Prepends values | No operator: a state node always has a current value, and a new subscriber receives it first |
| **distinct values** | `distinctUntilChanged` | Same name; nodes deliver every DATA unchanged, so add it where repeats should be dropped |

---

## Waves and glitch-freedom

A write starts a wave. Before any value moves, the kernel sends `PENDING` through
every node the write can reach. Each of those nodes then receives either:

- **DATA**: the new value, or
- **RESOLVED**: "this node ran in the wave and sent nothing".

A node with several dependencies runs once per wave, after every pending
dependency has settled. A diamond therefore never exposes a half-updated state:

```ts
const s = g.state(1, { name: "s" });
const left = g.derived([s], (v) => v + 1, { name: "left" });
const right = g.derived([s], (v) => v * 2, { name: "right" });
const joined = g.derived([left, right], (l, r) => `${l}/${r}`, { name: "joined" });

joined.subscribe((msgs) => console.log(msgs));
// [["START"], ["DATA", "2/2"]]
s.set(2);
// [["PENDING"], ["DATA", "3/4"]]   (never "3/2")
```

RxJS `combineLatest` emits on each input change, so the same shape can expose an
intermediate value (a "glitch"). The message types are `START`, `PENDING`, `DATA`,
`RESOLVED`, `INVALIDATE`, `COMPLETE` and `ERROR`.
