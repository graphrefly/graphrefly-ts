# Batch 16: Integration Stress - Cross-Layer Interactions (TS + Py)

Final audit pass focused on integration boundaries that prior batches did not test deeply in one place:

- Batch 11/12: operator protocol matrix gaps, Tier 2 race/teardown coverage gaps, deterministic snapshot pressure.
- Batch 14: cross-language operator behavior drift risks.
- Batch 15: observe/describe surfaces are strong but cross-layer causal confidence still depends on integration tests.

Below are 10 targeted cross-layer scenarios from `docs/audit-plan.md`, with concrete failure modes and executable pseudocode for both repositories.

---

## 1) BATCH + GRAPH + DIAMOND

- RISK LEVEL: high
- WHAT COULD GO WRONG: `D` recomputes twice (once via `B`, once via `C`) under batched source updates, or `describe()`/`observe(D)` reflects transient state after batch drain.
- WHY BATCHES MISSED IT: core diamond tests and graph tests exist, but not this exact intersection of `batch()` deferral + graph wiring + message-sequence observation.
- SUGGESTED TEST:

```ts
// TS pseudocode
it("graph diamond recomputes once inside batch", () => {
  const g = new Graph("g");
  const a = state(0);
  const b = map(a, (x) => x + 1);
  const c = map(a, (x) => x + 2);
  let dRuns = 0;
  const d = node([b, c], ([bv, cv]) => (dRuns++, bv + cv));
  g.add("a", a).add("b", b).add("c", c).add("d", d);
  const seen: Messages[] = [];
  g.observe("d").subscribe((m) => seen.push(m));
  batch(() => a.down([[DATA, 7]]));
  expect(dRuns).toBe(1);
  expect(g.describe().nodes.d.status).toBe("settled");
  expect(globalDirtyBeforePhase2(seen.flat())).toBe(true);
});
```

```python
# Py pseudocode
def test_graph_diamond_recomputes_once_inside_batch() -> None:
    g = Graph("g")
    a = state(0)
    b = pipe(a, map_(lambda x: x + 1))
    c = pipe(a, map_(lambda x: x + 2))
    runs = {"d": 0}
    d = node([b, c], lambda dps, _m: (runs.__setitem__("d", runs["d"] + 1), dps[0] + dps[1])[1])
    g.add("a", a).add("b", b).add("c", c).add("d", d)
    seen: list[Messages] = []
    g.observe("d").subscribe(seen.append)
    with batch():
        a.down([(MessageType.DATA, 7)])
    assert runs["d"] == 1
    assert g.describe()["nodes"]["d"]["status"] == "settled"
    assert global_dirty_before_phase2(flatten(seen))
```

---

## 2) BATCH + OPERATORS + GRAPH

- RISK LEVEL: high
- WHAT COULD GO WRONG: `switchMap`/`concatMap` inner lifecycle transitions happen during batch drain in a way that leaks stale inners or emits duplicate initial data.
- WHY BATCHES MISSED IT: operator tests and graph tests are mostly separate; inner-subscription lifecycle under graph-managed batched updates is under-specified.
- SUGGESTED TEST:

```ts
it("switchMap inner lifecycle is stable under graph batch", () => {
  const g = new Graph("g");
  const src = state(1);
  const out = pipe(src, switchMap((v) => state(v * 10)));
  g.add("src", src).add("out", out);
  const seen: Messages[] = [];
  g.observe("out").subscribe((m) => seen.push(m));
  batch(() => {
    src.down([[DATA, 2]]);
    src.down([[DATA, 3]]);
  });
  const flat = seen.flat().filter((m) => m[0] === DATA);
  expect(flat.at(-1)?.[1]).toBe(30);
  expect(noDuplicateInitialForInnerAttach(flat)).toBe(true);
});
```

```python
def test_switch_map_inner_lifecycle_under_graph_batch() -> None:
    g = Graph("g")
    src = state(1)
    out = pipe(src, switch_map(lambda v: state(v * 10)))
    g.add("src", src).add("out", out)
    seen: list[Messages] = []
    g.observe("out").subscribe(seen.append)
    with batch():
        src.down([(MessageType.DATA, 2)])
        src.down([(MessageType.DATA, 3)])
    data_vals = [m[1] for b in seen for m in b if m[0] is MessageType.DATA]
    assert data_vals[-1] == 30
    assert no_duplicate_initial_for_inner_attach(data_vals)
```

---

## 3) GRAPH.SIGNAL + OPERATOR CLEANUP

- RISK LEVEL: medium
- WHAT COULD GO WRONG: `graph.signal([[PAUSE]])` does not pause timer-backed operators (`debounce`, `delay`), so callbacks still fire while paused and violate pause semantics.
- WHY BATCHES MISSED IT: `PAUSE/RESUME` coverage exists for core and `pausable`, but not end-to-end timer operators driven through graph-wide signal.
- SUGGESTED TEST:

```ts
it("graph.signal(PAUSE) suppresses debounce emissions until RESUME", () => {
  vi.useFakeTimers();
  const g = new Graph("g");
  const src = state(0);
  const deb = pipe(src, debounce(25));
  g.add("src", src).add("deb", deb);
  const values: number[] = [];
  g.observe("deb").subscribe((msgs) => msgs.forEach((m) => m[0] === DATA && values.push(m[1] as number)));
  g.signal([[PAUSE]]);
  src.down([[DATA, 1]]);
  vi.advanceTimersByTime(50);
  expect(values).toEqual([]);
  g.signal([[RESUME]]);
  vi.advanceTimersByTime(30);
  expect(values.at(-1)).toBe(1);
});
```

```python
def test_graph_signal_pause_blocks_debounce_until_resume() -> None:
    g = Graph("g")
    src = state(0)
    deb = pipe(src, debounce(0.025))
    g.add("src", src).add("deb", deb)
    vals: list[int] = []
    g.observe("deb").subscribe(lambda b: [vals.append(m[1]) for m in b if m[0] is MessageType.DATA])
    g.signal([(MessageType.PAUSE,)])
    src.down([(MessageType.DATA, 1)])
    time.sleep(0.06)
    assert vals == []
    g.signal([(MessageType.RESUME,)])
    time.sleep(0.04)
    assert vals[-1] == 1
```

---

## 4) MOUNT + SNAPSHOT + RESTORE

- RISK LEVEL: high
- WHAT COULD GO WRONG: mount relationships and cross-subgraph edges are not preserved after snapshot round-trip; restored graph computes wrong values or has orphaned nodes.
- WHY BATCHES MISSED IT: snapshot and mount are tested, but combined parent/child lifecycle + cross-edge integrity is not deeply stressed.
- SUGGESTED TEST:

```ts
it("mounted child graph survives snapshot/restore with cross-edges", () => {
  const parent = new Graph("parent");
  const child = new Graph("child");
  parent.mount("sub", child);
  const p = state(1);
  const c = state(2);
  const sum = node([p, c], ([a, b]) => a + b);
  parent.add("p", p).add("sum", sum);
  child.add("c", c);
  parent.connect("p", "sum");
  parent.connect("sub/c", "sum");
  const snap = parent.snapshot();
  parent.destroy();
  const restored = Graph.fromSnapshot(snap);
  restored.set("p", 5);
  expect(restored.get("sum")).toBe(7);
});
```

```python
def test_mount_snapshot_restore_preserves_cross_subgraph_edges() -> None:
    parent = Graph("parent")
    child = Graph("child")
    parent.mount("sub", child)
    p, c = state(1), state(2)
    sum_node = node([p, c], lambda d, _m: d[0] + d[1])
    parent.add("p", p).add("sum", sum_node)
    child.add("c", c)
    parent.connect("p", "sum")
    parent.connect("sub/c", "sum")
    snap = parent.snapshot()
    parent.destroy()
    restored = Graph.from_snapshot(snap)
    restored.set("p", 5)
    assert restored.get("sum") == 7
```

---

## 5) GUARD + OBSERVE + META

- RISK LEVEL: high
- WHAT COULD GO WRONG: actor-restricted `observe` leaks guarded nodes (or meta sub-nodes), and `describe(actor=...)` returns unauthorized structure.
- WHY BATCHES MISSED IT: guard tests are strong but mostly per surface; cross-checking `observe`, `describe`, and meta-path exposure for the same actor policy is sparse.
- SUGGESTED TEST:

```ts
it("guarded node hides value and meta from unauthorized actor", () => {
  const g = new Graph("g");
  const secret = guardedState("x", allowActors(["admin"]));
  g.add("secret", secret);
  const deniedSeen: Messages[] = [];
  g.observe("secret", { actor: "guest" }).subscribe((m) => deniedSeen.push(m));
  secret.down([[DATA, "y"]]);
  expect(deniedSeen.flat().some((m) => m[0] === DATA)).toBe(false);
  const deniedDescribe = g.describe({ actor: "guest" });
  expect(deniedDescribe.nodes.secret).toBeUndefined();
  expect(deniedDescribe.nodes["secret.$meta"]).toBeUndefined();
});
```

```python
def test_guard_observe_and_meta_hidden_for_denied_actor() -> None:
    g = Graph("g")
    secret = guarded_state("x", policy=allow_actors({"admin"}))
    g.add("secret", secret)
    denied_seen: list[Messages] = []
    g.observe("secret", actor="guest").subscribe(denied_seen.append)
    secret.down([(MessageType.DATA, "y")])
    assert not any(m[0] is MessageType.DATA for b in denied_seen for m in b)
    desc = g.describe(actor="guest")
    assert "secret" not in desc["nodes"]
    assert "secret.$meta" not in desc["nodes"]
```

---

## 6) ERROR + DIAMOND + BATCH

- RISK LEVEL: high
- WHAT COULD GO WRONG: if one branch errors in a batch, downstream join node hangs waiting forever, or emits partial data and suppresses error propagation.
- WHY BATCHES MISSED IT: error tests and diamond tests exist independently; batch-flush behavior during branch error races is not tightly asserted.
- SUGGESTED TEST:

```ts
it("diamond propagates error without hanging sibling branch in batch", () => {
  const a = state(1);
  const left = map(a, () => { throw new Error("boom"); });
  const right = map(a, (x) => x + 1);
  const join = combine([left, right]);
  const seen: Messages[] = [];
  join.subscribe((m) => seen.push(m));
  batch(() => a.down([[DATA, 2]]));
  const flat = seen.flat();
  expect(flat.some((m) => m[0] === ERROR)).toBe(true);
  expect(streamSettlesOrErrors(flat)).toBe(true);
});
```

```python
def test_diamond_error_in_batch_does_not_hang_join() -> None:
    a = state(1)
    left = pipe(a, map_(lambda _x: (_ for _ in ()).throw(ValueError("boom"))))
    right = pipe(a, map_(lambda x: x + 1))
    join = combine(left, right)
    seen: list[Messages] = []
    join.subscribe(seen.append)
    with batch():
      a.down([(MessageType.DATA, 2)])
    flat = [m for b in seen for m in b]
    assert any(m[0] is MessageType.ERROR for m in flat)
    assert stream_settles_or_errors(flat)
```

---

## 7) CONCURRENT BATCH + GRAPH (Python only)

- RISK LEVEL: high
- WHAT COULD GO WRONG: thread A and thread B batches interleave into partial-visible graph state; per-subgraph lock behavior fails under concurrent `graph.set`.
- WHY BATCHES MISSED IT: concurrency tests exist at protocol level, but graph-level concurrent batch visibility and atomicity across node sets is not fully stressed.
- SUGGESTED TEST:

```ts
// TS pseudocode (informational parity case; no threaded graph batch API)
it("documents JS single-thread expectation for graph batch visibility", () => {
  const g = new Graph("g");
  const a = state(0);
  g.add("a", a);
  batch(() => g.set("a", 1));
  expect(g.get("a")).toBe(1);
  // Cross-thread atomicity is N/A in JS runtime; parity target is deterministic drain.
});
```

```python
def test_two_threads_graph_batch_do_not_leak_partial_state() -> None:
    g = Graph("g")
    a, b = state(0), state(0)
    g.add("a", a).add("b", b)
    seen: list[tuple[int, int]] = []
    def writer_a() -> None:
        with batch():
            g.set("a", 1); g.set("b", 1)
    def writer_b() -> None:
        with batch():
            g.set("a", 2); g.set("b", 2)
    run_concurrently(writer_a, writer_b)
    for _ in range(50):
        seen.append((g.get("a"), g.get("b")))
    assert all(x == y for (x, y) in seen)  # never observe mixed (1,2)/(2,1)
```

---

## 8) OPERATOR CHAIN + RESOLVED PROPAGATION

- RISK LEVEL: medium
- WHAT COULD GO WRONG: one operator in the chain converts unchanged updates into `DATA` instead of `RESOLVED`, causing unnecessary recompute downstream.
- WHY BATCHES MISSED IT: RESOLVED checks exist but mostly per-node/per-operator, not chain-transitive with counters.
- SUGGESTED TEST:

```ts
it("RESOLVED propagates through map->filter chain on unchanged value", () => {
  const a = state(1);
  const out = pipe(a, map((x) => x), filter((x) => x > 0));
  const seen: Messages[] = [];
  let leafRuns = 0;
  const leaf = node([out], ([v]) => (leafRuns++, v));
  leaf.subscribe((m) => seen.push(m));
  a.down([[DATA, 1]]); // unchanged
  const flat = seen.flat();
  expect(flat.some((m) => m[0] === RESOLVED)).toBe(true);
  expect(leafRuns).toBe(0);
});
```

```python
def test_resolved_propagates_through_operator_chain() -> None:
    a = state(1)
    out = pipe(a, map_(lambda x: x), filter_(lambda x: x > 0))
    seen: list[Messages] = []
    runs = {"leaf": 0}
    leaf = node([out], lambda d, _m: (runs.__setitem__("leaf", runs["leaf"] + 1), d[0])[1])
    leaf.subscribe(seen.append)
    a.down([(MessageType.DATA, 1)])
    flat = [m for b in seen for m in b]
    assert any(m[0] is MessageType.RESOLVED for m in flat)
    assert runs["leaf"] == 0
```

---

## 9) LARGE GRAPH PERFORMANCE

- RISK LEVEL: medium
- WHAT COULD GO WRONG: deep linear chain overflows stack, allocates excessive intermediate arrays, or regresses significantly under batched root updates.
- WHY BATCHES MISSED IT: correctness tests dominate; stress/perf checks are mostly manual and not represented as threshold assertions.
- SUGGESTED TEST:

```ts
it("1000-node linear chain updates without stack overflow", () => {
  const n = 1200;
  let cur = state(0);
  const nodes = [cur];
  for (let i = 0; i < n; i++) {
    cur = map(cur, (x) => x + 1);
    nodes.push(cur);
  }
  const leaf = nodes.at(-1)!;
  batch(() => nodes[0].down([[DATA, 1]]));
  expect(leaf.get()).toBe(n + 1);
  expect(noStackOverflowOccurred()).toBe(true);
});
```

```python
def test_large_linear_graph_batch_update_is_stable() -> None:
    n = 1200
    cur = state(0)
    nodes = [cur]
    for _ in range(n):
        cur = pipe(cur, map_(lambda x: x + 1))
        nodes.append(cur)
    with batch():
        nodes[0].down([(MessageType.DATA, 1)])
    assert nodes[-1].get() == n + 1
    assert no_recursion_or_runtime_error()
```

---

## 10) SNAPSHOT DETERMINISM UNDER MUTATION

- RISK LEVEL: high
- WHAT COULD GO WRONG: `snapshot()` taken during in-flight batch captures inconsistent mixed-phase state (DIRTY propagated but DATA not fully drained), producing non-deterministic restore.
- WHY BATCHES MISSED IT: snapshot determinism is tested at settled boundaries, not while a batch is actively mutating graph state.
- SUGGESTED TEST:

```ts
it("snapshot during in-flight batch is deterministic by contract", () => {
  const g = new Graph("g");
  const a = state(1);
  const b = map(a, (x) => x + 1);
  g.add("a", a).add("b", b);
  let snapMid: unknown;
  batch(() => {
    a.down([[DATA, 2]]);
    snapMid = g.snapshot();
  });
  const snapAfter = g.snapshot();
  expect(normalizeSnapshot(snapMid)).toEqual(normalizeSnapshot(snapAfter));
});
```

```python
def test_snapshot_determinism_when_called_during_batch() -> None:
    g = Graph("g")
    a = state(1)
    b = pipe(a, map_(lambda x: x + 1))
    g.add("a", a).add("b", b)
    with batch():
        a.down([(MessageType.DATA, 2)])
        snap_mid = g.snapshot()
    snap_after = g.snapshot()
    assert normalize_snapshot(snap_mid) == normalize_snapshot(snap_after)
```

---

## Execution notes

- These are intentionally integration-heavy and should be implemented as focused tests (one concern per test).
- Priority order for implementation: 1, 2, 6, 10, 7, then 3/8/4/9/5.
- For Tier 2 parity, prefer protocol-level assertions (`DIRTY` before `DATA`/`RESOLVED`, no duplicate initial data on inner attach) over final value assertions alone.
