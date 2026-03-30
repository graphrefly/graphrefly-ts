Here is the full compliance audit:

---

## GraphReFly Spec Compliance Audit

### 1. §1.1 Message Shape — **PASS (both repos)**

Both repos enforce `[[Type, Data?], ...]` (array of tuples) at all API boundaries.

- **TS:** `Messages = readonly Message[]` (`messages.ts:43`), `Message = readonly [symbol, unknown?]` (`messages.ts:39`). `down()` and `up()` accept `Messages`.
- **Python:** `Messages = list[Message]` (`protocol.py:36`), `Message = tuple[MessageType, Any] | tuple[MessageType]` (`protocol.py:35`). All internal calls use list-of-tuple form (e.g. `[(MessageType.DIRTY,)]`).

**Note:** Python `node.py:85` redefines a local `Message = tuple[Any, Any] | tuple[Any]` with `Any` first element (for forward compat with unknown types). This doesn't conflict at runtime but creates two divergent type definitions in the Python codebase. Not a protocol violation, but a type hygiene concern.

---

### 2. §1.3.1 DIRTY precedes DATA/RESOLVED — **PASS (both repos)**

Both `_emitAutoValue`/`_emit_auto_value` correctly prepend DIRTY when the node is not already dirty:

- **TS `node.ts:633-640`:** If `wasDirty`, emits `[[DATA, v]]` or `[[RESOLVED]]` alone (DIRTY already propagated). If not dirty, emits `[[DIRTY], [DATA, v]]` or `[[DIRTY], [RESOLVED]]`.
- **Python `node.py:338-364`:** Identical logic.

Raw/external sources (no deps) can call `node.down([[DATA, v]])` without DIRTY — this is the intentional compatibility path per spec.

---

### 3. §1.3.2 Two-Phase Push — **PASS (both repos, with caveat → see item 8)**

Structural two-phase is achieved via the dirty/settlement bitmask:

1. `_onDepDirty` emits `[[DIRTY]]` downstream immediately (TS `node.ts:688-695`, Py `node.py:414-419`).
2. `_onDepSettled` only triggers `_runFn` when all dirty deps are settled (TS `node.ts:697-707`, Py `node.py:421-428`).
3. `batch()` partitions messages — DIRTY propagates immediately, DATA/RESOLVED deferred.

Diamond resolution works correctly: D receives DIRTY from both B and C, then recomputes exactly once when both settle (TS `node.ts:702`, Py `node.py:425`).

---

### 4. §1.3.3 RESOLVED Enables Transitive Skip — **PASS (both repos)**

Two paths to RESOLVED:

1. **Equality check on computed value:** `_emitAutoValue` / `_emit_auto_value` compares new value against cached using `equals` (defaults to `Object.is` / `operator.is_`). If unchanged → RESOLVED.
   - TS `node.ts:635`: `const unchanged = this._equals(this._cached, value);`
   - Py `node.py:349`: `unchanged = self._equals(cached_snapshot, value)`

2. **Dep-value identity shortcut:** If all dep values are reference-identical to previous invocation, skips fn entirely and emits RESOLVED.
   - TS `node.ts:655-669`
   - Py `node.py:374-383`

---

### 5. §1.3.4 COMPLETE and ERROR Are Terminal — **PASS (both repos)**

- **Terminal flag:** Set on COMPLETE/ERROR (TS `node.ts:601-603`, Py `node.py:318-319`).
- **Enforcement:** After terminal, `_downInternal` / `_down_body` filters all messages except TEARDOWN and INVALIDATE (TS `node.ts:443-450`, Py `node.py:673-682`).
- **Resubscribable opt-in:** Both reset `_terminal` on new subscription when `resubscribable: true` (TS `node.ts:488-491`, Py `node.py:547-549`).

---

### 6. §1.3.5 Effect Nodes Complete When ALL Deps Complete — **PASS (both repos)**

`_maybeCompleteFromDeps` checks `_depCompleteMask.covers(_allDepsCompleteMask)` — ALL deps must have completed, not ANY.

- TS `node.ts:709-717`
- Py `node.py:430-436`

For passthrough nodes (no fn) with multiple deps: COMPLETE per-dep is accumulated, auto-COMPLETE fires only when all covered (TS `node.ts:735-737`, Py `node.py:450-453`). Single-dep passthrough forwards COMPLETE directly.

---

### 7. §1.3.6 Unknown Message Types Forward Unchanged — **PASS (both repos)**

Both `_handleDepMessages` / `_handle_dep_messages` have a fall-through at the end of the type dispatch that forwards any unrecognized type:

- TS `node.ts:778`: `this._downInternal([msg]);`
- Py `node.py:492`: `self.down([msg], internal=True)`

The `onMessage` interception path also works correctly: if `onMessage` returns `false`, default dispatch runs including the unknown-type forwarding. If `onMessage` returns `true`, the message is consumed (spec §2.6 behavior). If `onMessage` throws, ERROR is emitted (TS `node.ts:725-728`, Py `node.py:443-447`).

Passthrough nodes (no fn) forward all messages directly (including unknown types) except multi-dep COMPLETE which is accumulated.

---

### 8. §1.3.7 Batch Defers DATA, Not DIRTY — **INCONSISTENCY (TS vs Python)**

Both repos correctly defer DATA/RESOLVED and let DIRTY through immediately. However, they differ on **when phase-2 is deferred during drain**:

- **TS `batch.ts:174-176,194`:** `emitWithBatch` defers phase-2 whenever `isBatching()` returns true, which is `batchDepth > 0 || flushInProgress` (`batch.ts:27`). During the drain loop, DATA is **still deferred** (re-queued for the next drain iteration).

- **Python `node.py:700,708`:** The node's `_down_body` calls `emit_with_batch` with `defer_when="depth"`, which only defers when `bs.depth > 0` (`protocol.py:114-115`). During drain (`flush_in_progress=True` but `depth=0`), DATA is **NOT deferred** — it emits immediately.

The Python docstring at `protocol.py:199-201` claims `defer_when="depth"` "Matches TS `emitWithBatch`" — this is incorrect. The TS `emitWithBatch` uses the equivalent of `defer_when="batching"`.

**Impact:** During batch drain, if a deferred callback triggers further DATA emissions, TS re-defers them (preserving strict DIRTY-before-DATA across the entire drain), while Python delivers them immediately (potentially interleaving phase-1 and phase-2 across different nodes).

**Additionally — AMBIGUITY:** The spec §1.3.7 says "Batch defers DATA, not DIRTY" but both repos also defer RESOLVED. The spec §1.3.2 clearly includes RESOLVED in "phase 2", so deferring it is correct behavior. The §1.3.7 wording should explicitly mention RESOLVED to avoid confusion.

---

### 9. §1.4 Directions — **AMBIGUITY (both repos)**

The spec defines:
- **Down** (source→sink): DATA, DIRTY, RESOLVED, COMPLETE, ERROR
- **Up** (sink→source): PAUSE, RESUME, INVALIDATE, TEARDOWN

**Neither repo enforces directional constraints.** Both `down()` and `up()` accept any message type without validation.

Specific concern: In both `_handleDepMessages`, when a dep (upstream node) sends PAUSE, RESUME, INVALIDATE, or TEARDOWN, these are **forwarded downstream** to subscribers:
- TS `node.ts:774`: `if (t === INVALIDATE || t === TEARDOWN || t === PAUSE || t === RESUME) { this._downInternal([msg]); }`
- Py `node.py:483-489`: same logic

This means "upstream" message types can propagate downstream through the graph. Use cases exist for this (e.g., `graph.destroy()` sends TEARDOWN downstream to all nodes, a source pausing its consumers), but it contradicts the strict reading of §1.4.

**Suggestion:** Clarify in spec whether §1.4 describes *intended convention* (recommendation) or *enforced constraint* (hard rule). If convention, note that forwarding upstream types downstream is valid for lifecycle propagation. If hard rule, both implementations need direction enforcement.

---

## Summary Table

| # | Invariant | Verdict |
|---|-----------|---------|
| 1 | §1.1 Message shape | **PASS** |
| 2 | §1.3.1 DIRTY precedes DATA/RESOLVED | **PASS** |
| 3 | §1.3.2 Two-phase push | **PASS** |
| 4 | §1.3.3 RESOLVED transitive skip | **PASS** |
| 5 | §1.3.4 COMPLETE/ERROR terminal | **PASS** |
| 6 | §1.3.5 ALL deps complete | **PASS** |
| 7 | §1.3.6 Unknown types forward | **PASS** |
| 8 | §1.3.7 Batch defers DATA | **INCONSISTENCY** — TS defers during drain (`isBatching`), Py does not (`defer_when="depth"`). Also **AMBIGUITY** — spec omits RESOLVED from §1.3.7 wording |
| 9 | §1.4 Directions | **AMBIGUITY** — neither repo enforces direction; upstream types flow downstream in `_handleDepMessages` |