Now I have everything needed for the audit. Here is the complete report:

---

# Graph Container Audit (§3.1–§3.8) — Batch 2

## §3.1 Construction

**PASS (both repos)**

- TS: `graph.ts:208` — `constructor(name: string, opts?: GraphOptions)` — correct signature.
- Py: `graph.py:153` — `__init__(self, name: str, opts: dict[str, Any] | None = None)` — correct signature.
- Both reject empty names and names containing the path separator `::`.

## §3.2 Node Management

**PASS (both repos)**

| Method | TS | Py |
|--------|----|----|
| `add(name, node)` | `graph.ts:285` | `graph.py:182` |
| `remove(name)` | `graph.ts:312` | `graph.py:232` |
| `get(name)` | `graph.ts:364` → `node(name).get()` | `graph.py:532` → `node(name).get()` |
| `set(name, value)` | `graph.ts:371` → `down([[DATA, v]])` | `graph.py:536` → `down([(DATA, v)])` |
| `node(name)` | `graph.ts:349` | `graph.py:522` |

Both `remove()` implementations unregister AND send `[[TEARDOWN]]`:
- TS: `graph.ts:342` — `node.down([[TEARDOWN]], { internal: true })`
- Py: `graph.py:253` — `n.down([(MessageType.TEARDOWN,)], internal=True)`

Tests confirm: TS `graph.test.ts:43–53`, Py `test_graph.py:55–68`.

## §3.3 Edges

**PASS (both repos)**

| Method | TS | Py |
|--------|----|----|
| `connect(from, to)` | `graph.ts:392` | `graph.py:558` |
| `disconnect(from, to)` | `graph.ts:432` | `graph.py:607` |

Edges are pure wires — both enforce that the target's `_deps` must include the source node by reference:
- TS: `graph.ts:411` — `if (!toNode._deps.includes(fromNode))`
- Py: `graph.py:571` — `if not any(d is from_n for d in to_n._deps)`

No transform capability exists on edges. Connect is idempotent; disconnect raises on missing edge. Self-loops rejected.

## §3.4 Composition

**PASS (both repos)**

| Method | TS | Py |
|--------|----|----|
| `mount(name, childGraph)` | `graph.ts:478` | `graph.py:204` |

Child nodes are addressable under parent namespace (e.g., `root.resolve("sub::a")`). Lifecycle signals propagate parent → children:
- TS: `graph.ts:633–649` — `_signalDeliver` recurses into mounts first
- Py: `graph.py:813–830` — `_signal_graph` recurses into mounts first

Both reject: self-mount, cycle, same instance mounted twice, name collision with existing nodes/mounts.

## §3.5 Namespace

**INCONSISTENCY (spec examples vs both implementations)**

The spec §3.5 examples show **single-colon** delimiters:
```
"system:payment:validate"
```

Both implementations use **double-colon** `::` as `PATH_SEP`:
- TS: `graph.ts:9` — `const PATH_SEP = "::"`
- Py: `graph.py:23` — `PATH_SEP = "::"`

This was clearly a deliberate design choice to allow single colons in names (both repos test this: TS `graph.test.ts:148–156`, Py `test_graph.py:256–264`). However, the spec text says "Colon-delimited paths" and examples use single colons. **The spec examples should be updated to use `::` to match implementations, or the spec should explicitly state the separator is `::` (double colon).**

Other §3.5 requirements:

- **Mount auto-prepends parent scope:** PASS — `root.resolve("sub::a")` works.
- **Local names within graph:** PASS — both use local names for `add`/`connect`.
- **`resolve(path)` returns actual node:** PASS — TS: `graph.ts:511`, Py: `graph.py:259`.
- **Resolve strips leading graph name:** PASS — TS: `graph.ts:513`, Py: `graph.py:268`.

## §3.6 Introspection

### describe()

**PASS (both repos)** — Output matches Appendix B schema.

Both return `{ name, nodes, edges, subgraphs }`:
- TS: `graph.ts:671–711`
- Py: `graph.py:474–509`

Appendix B requires `name` (string), `nodes` (object with `type` and `status` required per node), `edges` (array of `{from, to}`), `subgraphs` (array of strings). Both conform. TS test `graph.test.ts:690–703` runs a dedicated Appendix B validator (`validate-describe-appendix-b.ts`). Py test `test_graph.py:701–727` manually validates the same shape.

### Type inference

**PASS (both repos)** — Logic at:
- TS: `meta.ts:14–19` (`inferDescribeType`)
- Py: `meta.py:43–53` (`_infer_describe_type`)

Both correctly infer: state (no deps, no fn), producer (no deps, with fn), derived (deps, fn returns value), operator (deps, fn uses down()), effect (via `describeKind`/`_describe_kind` override from sugar constructor).

### observe()

**PASS (both repos)**

- `observe(name)` returns subscribable source for one node: TS `graph.ts:770`, Py `graph.py:511`.
- `observe()` (no arg) returns all nodes with path prefix: TS `graph.ts:773–807`, Py `graph.py:511–520` + `GraphObserveSource.subscribe` at `graph.py:769–799`.

Tests: TS `graph.test.ts:714–746`, Py `test_graph.py:456–472`.

## §3.7 Lifecycle

**PASS (both repos)**

| Method | TS | Py |
|--------|----|----|
| `signal(messages)` | `graph.ts:629` | `graph.py:330` |
| `destroy()` | `graph.ts:817` | `graph.py:343` |

Both `destroy()` send `[[TEARDOWN]]` to all nodes then clear registries:
- TS: `graph.ts:818–825` — signals TEARDOWN, then clears `_mounts`, `_nodes`, `_edges`
- Py: `graph.py:343–355` — `_signal_graph` with TEARDOWN, then `_clear_graph_registry`

Tests: TS `graph.test.ts:474–489`, Py `test_graph.py:475–500`.

## §3.8 Persistence

### snapshot()

**PASS (both repos)**

- TS: `graph.ts:841–844` — returns `{ version: 1, ...describe() }`
- Py: `graph.py:357–372` — returns sorted dict with version envelope

### restore(data)

**PASS (both repos)**

- TS: `graph.ts:854–873` — skips derived/operator/effect, writes state/producer values
- Py: `graph.py:390–414` — same logic

Both reject name mismatch. Both validate version envelope.

### Graph.fromSnapshot(data)

**PASS (both repos)**

- TS: `graph.ts:879–941` — `static fromSnapshot(data, build?)`
- Py: `graph.py:416–472` — `@classmethod from_snapshot(cls, data, build=None)`

Both support optional `build` callback for graphs with edges/derived nodes. Without `build`, both reject non-empty edges and non-state nodes.

### toJSON()

**PASS (TS)** — `graph.ts:951–953` — returns a plain object (not string) via `sortJsonValue(this.snapshot())`. `JSON.stringify(graph)` will invoke this correctly per the ECMAScript note in the spec.

**VIOLATION (Py)** — Python has no `toJSON()` equivalent that returns a plain dict. Python's `to_json()` at `graph.py:374–388` returns a **string**, which is the `toJSONString()` equivalent. The `snapshot()` method returns a dict, but it doesn't apply recursive key sorting like TS's `toJSON()` does.

This is acceptable because Python has no `JSON.stringify()` convention — `toJSON()` is ECMAScript-specific. However, the spec at §3.8 lists `graph.toJSON()` as a general API (not TS-specific), so strictly speaking Python is missing it. This may be intentional since `snapshot()` fills the same role in Python.

### toJSONString()

**PASS (TS)** — `graph.ts:958–960` — `stableJsonStringify(this.snapshot())`, produces deterministic JSON text with trailing newline.

**PASS (Py, renamed)** — `graph.py:374` as `to_json()` — returns compact JSON with trailing newline and `sort_keys=True`. Functionally equivalent to TS `toJSONString()`.

### Same state → same JSON bytes

**PASS (both repos)** — Both use sorted keys for deterministic output:
- TS: `sortJsonValue()` recursively sorts object keys (`graph.ts:79–93`), test at `graph.test.ts:502–511`
- Py: `json.dumps(..., sort_keys=True)` (`graph.py:383`), test at `test_graph.py:512–520`

## §3.9 Cross-Check: Describe & Snapshot Parity

**INCONSISTENCY (minor) — `snapshot()` node key ordering**

TS `snapshot()` at `graph.ts:841–844` does NOT explicitly sort node keys — it relies on insertion order from `describe()` (which walks nodes in sorted order). Python `snapshot()` at `graph.py:365` explicitly sorts: `dict(sorted(body["nodes"].items()))`. Both produce sorted output in practice, but the TS approach is fragile — if `describe()` iteration order changes, snapshot determinism could break.

**INCONSISTENCY (minor) — `snapshot()` subgraphs sorting**

Python `snapshot()` at `graph.py:366` explicitly sorts subgraphs. TS `snapshot()` does not — it relies on `describe()` collecting subgraphs in mount-name-sorted order (which happens to produce sorted output). Again, TS is less explicit.

**INCONSISTENCY (naming) — `toJSON` vs `to_json`**

| Concept | TS | Py |
|---------|----|----|
| Dict/object return | `toJSON()` → plain object | `snapshot()` → dict (unsorted keys at top level) |
| String return | `toJSONString()` → string | `to_json()` → string |

The Python `to_json()` name maps to `toJSONString()` semantically, not to `toJSON()`. Not a bug — just a naming asymmetry. Both produce equivalent output for equivalent graphs.

**INCONSISTENCY — `describe()` node entries include `value` field**

Both implementations include `value` in describe output (TS `meta.ts:95`, Py `meta.py:76`). The Appendix B schema lists `value` as optional (`"value": {}`). This is fine — optional fields are permitted. Both are consistent with each other.

## Summary

| Section | Verdict |
|---------|---------|
| §3.1 Construction | **PASS** |
| §3.2 Node Management | **PASS** |
| §3.3 Edges | **PASS** |
| §3.4 Composition | **PASS** |
| §3.5 Namespace | **AMBIGUITY** — spec examples use `:`, impls use `::` |
| §3.6 Introspection | **PASS** |
| §3.7 Lifecycle | **PASS** |
| §3.8 Persistence | **PASS** (with minor inconsistencies noted below) |
| Cross-check | **PASS** (schema and content match) |

### Issues requiring attention:

1. **AMBIGUITY (spec §3.5)** — Spec examples show single-colon paths (`system:payment:validate`) but both implementations use `::`. Suggest updating spec examples to `system::payment::validate` and stating the separator is `::` explicitly.

2. **INCONSISTENCY (Py `to_json` naming)** — Python's `to_json()` returns a string (equivalent to TS `toJSONString()`). There is no Python equivalent of TS's `toJSON()` (which returns a plain object with sorted keys). The spec lists `toJSON()` as a general API at §3.8. Consider either: (a) adding a Python `to_json_dict()` or renaming `to_json()` → `to_json_string()` and adding `to_json()` → dict, or (b) clarifying in the spec that `toJSON()` is ECMAScript-specific.

3. **INCONSISTENCY (minor, TS snapshot sorting)** — TS `snapshot()` doesn't explicitly sort node keys or subgraphs (relies on `describe()` iteration order). Python does explicit sorting. Both produce sorted output today, but the TS path is more fragile. Consider adding explicit sorting in TS `snapshot()` for robustness.