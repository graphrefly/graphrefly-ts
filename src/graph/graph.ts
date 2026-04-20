import type { Actor } from "../core/actor.js";
import { batch, isBatching } from "../core/batch.js";
import { monotonicNs, wallClockNs } from "../core/clock.js";
import type { GraphReFlyConfig } from "../core/config.js";
import { GuardDenied } from "../core/guard.js";
import {
	COMPLETE,
	DATA,
	DIRTY,
	ERROR,
	INVALIDATE,
	type Messages,
	PAUSE,
	RESOLVED,
	RESUME,
	TEARDOWN,
} from "../core/messages.js";
import {
	type DescribeDetail,
	type DescribeField,
	type DescribeNodeOutput,
	describeNode,
	resolveDescribeFields,
} from "../core/meta.js";
import {
	defaultConfig,
	type Node,
	NodeImpl,
	type NodeSink,
	type NodeTransportOptions,
} from "../core/node.js";
import { producer, state as stateNode } from "../core/sugar.js";
import type { VersioningLevel } from "../core/versioning.js";
import type { StorageHandle, StorageTier } from "../extra/storage.js";
import { ResettableTimer } from "../extra/timer.js";
import { RingBuffer } from "../extra/utils/ring-buffer.js";
import { decodeEnvelope, encodeEnvelope, type GraphCodec } from "./codec.js";
import { type CausalChain, explainPath } from "./explain.js";
import { type GraphProfileOptions, type GraphProfileResult, graphProfile } from "./profile.js";

/** The separator used for qualified paths in {@link Graph.resolve} et al. */
const PATH_SEP = "::";

/**
 * Reserved segment for meta companion paths: `nodeName::__meta__::metaKey` (GRAPHREFLY-SPEC §3.6).
 * Forbidden as a local node or mount name.
 */
export const GRAPH_META_SEGMENT = "__meta__";

/**
 * Options for {@link Graph}. Named fields documented below; the open index
 * signature is preserved so callers can stash extension data on the graph
 * without losing type discipline on the reserved names.
 *
 * - `config` — bind this graph to a specific {@link GraphReFlyConfig} for
 *   tier/metaPassthrough/inspector lookups. Defaults to the singleton
 *   `defaultConfig` exported from `core/node.ts`.
 * - `versioning` — convenience for `graph.setVersioning(level)` at
 *   construction time. Monotonic bulk-apply; see {@link Graph.setVersioning}.
 * - `factories` — reserved for future per-graph factory registration;
 *   currently factories flow through `Graph.fromSnapshot(data, {factories})`.
 */
export interface GraphOptions {
	config?: GraphReFlyConfig;
	versioning?: VersioningLevel;
	factories?: Record<string, GraphNodeFactory>;
	/**
	 * Capacity of the reasoning-trace ring buffer. Default: `1000`. Set lower
	 * to reduce memory; higher for audit-heavy workloads. Set at construction
	 * time — not mutable afterward (ring buffers can't resize cleanly).
	 */
	traceCapacity?: number;
	[key: string]: unknown;
}

/** Filter for {@link Graph.describe} — object-style partial match or predicate. */
export type DescribeFilter =
	| Partial<Pick<DescribeNodeOutput, "type" | "status">>
	| {
			type?: DescribeNodeOutput["type"];
			status?: DescribeNodeOutput["status"];
			/** Keep nodes whose `deps` includes this qualified path. */
			depsIncludes?: string;
			/** Snake-case alias for `depsIncludes` (Python parity). */
			deps_includes?: string;
			/** Keep nodes whose `meta` contains this key. */
			metaHas?: string;
			/** Snake-case alias for `metaHas` (Python parity). */
			meta_has?: string;
	  }
	| ((node: DescribeNodeOutput) => boolean)
	| ((nodePath: string, node: DescribeNodeOutput) => boolean);

/** Options for {@link Graph.signal} and {@link Graph.set} (actor context, internal lifecycle). */
export type GraphActorOptions = {
	actor?: Actor;
	/**
	 * When `true`, skips node guards (graph lifecycle TEARDOWN, unmount teardown, etc.).
	 */
	internal?: boolean;
};

/** Options for {@link Graph.describe} (Phase 3.3b progressive disclosure). */
export type GraphDescribeOptions = {
	actor?: Actor;
	/**
	 * Node filter. Filters operate on whatever fields the chosen `detail` level
	 * provides. For `metaHas` and `status` filters, use `detail: "standard"` or
	 * higher — at `"minimal"` those fields are absent and the filter silently
	 * excludes all nodes.
	 */
	filter?: DescribeFilter;
	/**
	 * Detail level (Phase 3.3b). Default: `"minimal"`.
	 * - `"minimal"` — type + deps only
	 * - `"standard"` — type, status, value, deps, meta, versioning (`v`)
	 * - `"full"` — standard + guard, lastMutation
	 */
	detail?: DescribeDetail;
	/**
	 * Explicit field selection (GraphQL-style). Overrides `detail` when provided.
	 * Dotted paths like `"meta.label"` select specific meta keys.
	 */
	fields?: DescribeField[];
	/**
	 * Output format.
	 * - `undefined` / omitted — return the full {@link GraphDescribeOutput} object.
	 * - `"spec"` — GraphSpec input format (object; no status/value, deps as edges).
	 * - `"json"` — stable JSON **text** with sorted keys.
	 * - `"pretty"` — human-readable plaintext (optionally colorized; see
	 *   `colorize` / `indent` / `logger` / `includeEdges` / `includeSubgraphs`).
	 * - `"mermaid"` — Mermaid flowchart text.
	 * - `"d2"` — D2 diagram text.
	 */
	format?: "spec" | "json" | "pretty" | "mermaid" | "d2";
	/** Pretty/diagram render: direction for diagram formats (default `LR`). */
	direction?: GraphDiagramDirection;
	/** Pretty/JSON render: indent (default 2 for JSON, ignored for pretty). */
	indent?: number;
	/** Pretty render: optional logger hook; fires with the rendered text before return. */
	logger?: (text: string) => void;
	/** Pretty render: include an Edges section (default `true`). */
	includeEdges?: boolean;
	/** Pretty render: include a Subgraphs section (default `true`). */
	includeSubgraphs?: boolean;
};

/** JSON snapshot from {@link Graph.describe} (GRAPHREFLY-SPEC §3.6, Appendix B). */
export type GraphDescribeOutput = {
	name: string;
	nodes: Record<string, DescribeNodeOutput>;
	edges: ReadonlyArray<{ from: string; to: string }>;
	subgraphs: string[];
	/**
	 * Re-read the live graph with higher detail (Phase 3.3b).
	 * Returns a new `GraphDescribeOutput`; the original remains a snapshot.
	 * Present on live describe results; absent on deserialized snapshots.
	 */
	expand?: (detailOrFields: DescribeDetail | DescribeField[]) => GraphDescribeOutput;
};

/**
 * Persisted graph snapshot: {@link GraphDescribeOutput} plus optional format version
 * ({@link Graph.snapshot}, {@link Graph.restore}, {@link Graph.fromSnapshot}, {@link Graph.toObject},
 * {@link Graph.toJSONString} — §3.8).
 */
export type GraphPersistSnapshot = GraphDescribeOutput & {
	version?: number;
};

export type GraphFactoryContext = {
	path: string;
	type: DescribeNodeOutput["type"];
	value: unknown;
	meta: Record<string, unknown>;
	deps: readonly string[];
	resolvedDeps: readonly Node[];
};

export type GraphNodeFactory = (name: string, context: GraphFactoryContext) => Node;

/**
 * Checkpoint record shape passed to `StorageTier.save`. Written by
 * {@link Graph.attachStorage} per-tier according to each tier's
 * `compactEvery` cadence.
 *
 * `mode: "full"` → full snapshot. Baseline anchor emitted on the first save
 *   and every `compactEvery`-th save thereafter. Sufficient to recover state
 *   on its own without WAL replay.
 * `mode: "diff"` → delta payload only, relative to this tier's most recent
 *   `"full"` baseline. Between compacts. Wire-efficient; requires WAL replay
 *   over the preceding `"full"` record to reconstruct state.
 *
 * Every record includes `seq` (per-tier monotonic counter), `timestamp_ns`
 * (wall-clock at flush time), and `format_version` (envelope version for
 * cross-version WAL replay).
 */
export type GraphCheckpointRecord = {
	seq: number;
	timestamp_ns: number;
	format_version: number;
} & ({ mode: "full"; snapshot: GraphPersistSnapshot } | { mode: "diff"; diff: GraphWALDiff });

/** Options for {@link Graph.attachStorage}. */
export type GraphAttachStorageOptions = {
	/**
	 * Before the first save, attempt to restore from the first tier whose
	 * `load(graph.name)` hits. Runs asynchronously in the background for
	 * async tiers; errors surface via `onError`. Default `false`.
	 */
	autoRestore?: boolean;
	/**
	 * Limit the subscription surface (scoped observe). By default
	 * `attachStorage` observes every node in the graph tree; on large graphs
	 * that's thousands of subscriptions just for tier-gating. Pass a path
	 * list (or a single glob) to observe only those nodes.
	 */
	paths?: readonly string[] | string;
	/** Pre-save path-level filter — skip records triggered by paths that fail this predicate. */
	filter?: (name: string, described: DescribeNodeOutput) => boolean;
	/** Surfaced on tier save errors and autoRestore failures. */
	onError?: (error: unknown, tier: StorageTier) => void;
};

/**
 * Event emitted by {@link Graph.topology} on every structural change to the
 * graph's own registry. Does NOT include value mutations (use `observe()` for
 * those) or transitively nested subgraph events (subscribe to each mounted
 * child's `topology` for that).
 *
 * - `"added"` — `name` is the local key registered via {@link Graph.add}
 *   (`nodeKind: "node"`) or {@link Graph.mount} (`nodeKind: "mount"`).
 * - `"removed"` — emitted AFTER {@link Graph.remove} completes teardown.
 *   `audit` is the full {@link GraphRemoveAudit} returned to the caller.
 */
export type TopologyEvent =
	| { kind: "added"; name: string; nodeKind: "node" | "mount" }
	| {
			kind: "removed";
			name: string;
			nodeKind: "node" | "mount";
			audit: GraphRemoveAudit;
	  };

/** Direction options for diagram export helpers. */
export type GraphDiagramDirection = "TD" | "LR" | "BT" | "RL";

/** Options for {@link Graph.toMermaid} / {@link Graph.toD2}. */
export type GraphDiagramOptions = {
	/**
	 * Diagram flow direction.
	 * - `TD`: top-down
	 * - `LR`: left-right (default)
	 * - `BT`: bottom-top
	 * - `RL`: right-left
	 */
	direction?: GraphDiagramDirection;
};

/**
 * Snapshot format version (§3.8). Exported so the surface layer's
 * `saveSnapshot` writes the same `format_version` as
 * `Graph.attachStorage` — one source of truth prevents silent wire
 * drift between auto-checkpoint and one-shot persistence paths.
 */
export const SNAPSHOT_VERSION = 1;

/**
 * Drain a disposer set iteratively — pop, remove, run. Disposers registered
 * mid-drain are picked up by the next iteration. Capped to guard against a
 * disposer that re-registers itself in an infinite loop. Exceptions are
 * surfaced via `console.error` rather than silently swallowed so leaks in
 * cleanup code remain visible.
 */
function drainDisposers(set: Set<() => void>, graphName: string): void {
	const cap = Math.max(16, set.size * 4);
	let iterations = 0;
	while (set.size > 0) {
		if (iterations++ >= cap) {
			console.error(
				`[Graph "${graphName}".destroy] disposer drain exceeded cap (${cap}); ${set.size} disposer(s) discarded`,
			);
			set.clear();
			return;
		}
		const it = set.values().next();
		if (it.done) return;
		const dispose = it.value;
		set.delete(dispose);
		try {
			dispose();
		} catch (err) {
			console.error(`[Graph "${graphName}".destroy] disposer threw:`, err);
		}
	}
}

/**
 * Cheap graph-level V0 version fingerprint: concatenate `v.id@v.version` for
 * every node that carries V0 info. Used by {@link Graph.attachStorage} to
 * short-circuit per-tier flushes when nothing versioned has changed since
 * the tier's last save. Non-versioned graphs produce an empty string so the
 * shortcut is a no-op for them (every scheduled flush writes).
 */
function computeVersionFingerprint(nodes: Record<string, DescribeNodeOutput>): string {
	const parts: string[] = [];
	for (const path of Object.keys(nodes).sort()) {
		const v = nodes[path]!.v;
		if (v != null) parts.push(`${path}\t${v.id}\t${v.version}`);
	}
	return parts.join("\n");
}

/**
 * Validate the snapshot envelope: version, required keys, types. Aligned with
 * Python `_parse_snapshot_envelope`. Throws on invalid data.
 */
function parseSnapshotEnvelope(data: GraphPersistSnapshot): void {
	if (data.version !== SNAPSHOT_VERSION) {
		throw new Error(
			`unsupported snapshot version ${String(data.version)} (expected ${SNAPSHOT_VERSION})`,
		);
	}
	for (const key of ["name", "nodes", "edges", "subgraphs"] as const) {
		if (!(key in data)) {
			throw new Error(`snapshot missing required key "${key}"`);
		}
	}
	if (typeof data.name !== "string") {
		throw new TypeError(`snapshot 'name' must be a string`);
	}
	if (typeof data.nodes !== "object" || data.nodes === null || Array.isArray(data.nodes)) {
		throw new TypeError(`snapshot 'nodes' must be an object`);
	}
	if (!Array.isArray(data.edges)) {
		throw new TypeError(`snapshot 'edges' must be an array`);
	}
	if (!Array.isArray(data.subgraphs)) {
		throw new TypeError(`snapshot 'subgraphs' must be an array`);
	}
}

/**
 * Structural deep equality — handles cycles, BigInt, Map, Set, Date, RegExp,
 * TypedArray, and nested objects/arrays. Used by `Graph.diff` to compare
 * node values without the cycle/BigInt/Map/Set footguns of `JSON.stringify`.
 *
 * Semantics: `Object.is` on primitives (so `NaN === NaN`, `-0 !== 0`), same
 * constructor required for object types, key-order-insensitive for plain
 * objects, order-sensitive for arrays + TypedArrays, unordered for Set,
 * key-equality for Map.
 */
function deepEqual(a: unknown, b: unknown): boolean {
	const seen = new WeakMap<object, WeakSet<object>>();
	const walk = (x: unknown, y: unknown): boolean => {
		if (Object.is(x, y)) return true;
		if (x == null || y == null || typeof x !== "object" || typeof y !== "object") return false;
		// Cycle handling: assume equal on re-encounter (cycles match iff they
		// correspond structurally — standard "optimistic" deep-equal rule).
		let seenRhs = seen.get(x as object);
		if (seenRhs == null) {
			seenRhs = new WeakSet();
			seen.set(x as object, seenRhs);
		}
		if (seenRhs.has(y as object)) return true;
		seenRhs.add(y as object);

		const ctorA = (x as object).constructor;
		const ctorB = (y as object).constructor;
		if (ctorA !== ctorB) return false;

		if (x instanceof Date) return (x as Date).getTime() === (y as Date).getTime();
		if (x instanceof RegExp)
			return (
				(x as RegExp).source === (y as RegExp).source && (x as RegExp).flags === (y as RegExp).flags
			);
		if (Array.isArray(x)) {
			const arrB = y as unknown[];
			if ((x as unknown[]).length !== arrB.length) return false;
			for (let i = 0; i < (x as unknown[]).length; i++) {
				if (!walk((x as unknown[])[i], arrB[i])) return false;
			}
			return true;
		}
		if (x instanceof Map) {
			const mB = y as Map<unknown, unknown>;
			if ((x as Map<unknown, unknown>).size !== mB.size) return false;
			for (const [k, v] of x as Map<unknown, unknown>) {
				if (!mB.has(k) || !walk(v, mB.get(k))) return false;
			}
			return true;
		}
		if (x instanceof Set) {
			const sB = y as Set<unknown>;
			if ((x as Set<unknown>).size !== sB.size) return false;
			// O(n²) fallback — Sets have no ordering, and walking each pair
			// is the only way to support structural equality on non-primitive
			// members. Acceptable: diff scale is describe-output-sized.
			for (const v of x as Set<unknown>) {
				let found = false;
				for (const w of sB) {
					if (walk(v, w)) {
						found = true;
						break;
					}
				}
				if (!found) return false;
			}
			return true;
		}
		if (ArrayBuffer.isView(x)) {
			const taA = x as unknown as { length: number; [i: number]: number };
			const taB = y as unknown as { length: number; [i: number]: number };
			if (taA.length !== taB.length) return false;
			for (let i = 0; i < taA.length; i++) if (taA[i] !== taB[i]) return false;
			return true;
		}
		// Plain object: same key-set, same values (key order irrelevant).
		const keysA = Object.keys(x as Record<string, unknown>);
		const keysB = Object.keys(y as Record<string, unknown>);
		if (keysA.length !== keysB.length) return false;
		const setB = new Set(keysB);
		for (const k of keysA) {
			if (!setB.has(k)) return false;
			if (!walk((x as Record<string, unknown>)[k], (y as Record<string, unknown>)[k])) return false;
		}
		return true;
	};
	return walk(a, b);
}

/** Recursively sort object keys for deterministic JSON (git-diffable). */
function sortJsonValue(value: unknown): unknown {
	if (value === null || typeof value !== "object") {
		return value;
	}
	if (Array.isArray(value)) {
		return value.map(sortJsonValue);
	}
	const obj = value as Record<string, unknown>;
	const keys = Object.keys(obj).sort();
	const out: Record<string, unknown> = {};
	for (const k of keys) {
		out[k] = sortJsonValue(obj[k]);
	}
	return out;
}

function escapeMermaidLabel(value: string): string {
	return value.replaceAll("\\", "\\\\").replaceAll('"', '\\"');
}

function escapeD2Label(value: string): string {
	return value.replaceAll("\\", "\\\\").replaceAll('"', '\\"');
}

function d2DirectionFromGraphDirection(direction: GraphDiagramDirection): string {
	if (direction === "TD") return "down";
	if (direction === "BT") return "up";
	if (direction === "RL") return "left";
	return "right";
}

/** Collect deduplicated (from, to) arrows from deps + edges. */
function collectDiagramArrows(described: GraphDescribeOutput): [string, string][] {
	const seen = new Set<string>();
	const arrows: [string, string][] = [];
	function add(from: string, to: string): void {
		const key = `${from}\0${to}`;
		if (seen.has(key)) return;
		seen.add(key);
		arrows.push([from, to]);
	}
	for (const [path, info] of Object.entries(described.nodes)) {
		const deps: string[] | undefined = (info as Record<string, unknown>).deps as
			| string[]
			| undefined;
		if (deps) {
			for (const dep of deps) add(dep, path);
		}
	}
	for (const edge of described.edges) add(edge.from, edge.to);
	return arrows;
}

function normalizeDiagramDirection(direction: unknown): GraphDiagramDirection {
	if (direction === undefined) return "LR";
	if (direction === "TD" || direction === "LR" || direction === "BT" || direction === "RL") {
		return direction;
	}
	throw new Error(
		`invalid diagram direction ${String(direction)}; expected one of: TD, LR, BT, RL`,
	);
}

// ---------------------------------------------------------------------------
//  describe({format}) renderers — consolidated from the ex-dumpGraph /
//  ex-toMermaid / ex-toD2 methods (Unit 12 + Unit 20).
// ---------------------------------------------------------------------------

function renderDescribeAsJson(d: GraphDescribeOutput, options: GraphDescribeOptions): string {
	const includeEdges = options.includeEdges ?? true;
	const includeSubgraphs = options.includeSubgraphs ?? true;
	const { expand: _expand, ...rest } = d;
	const payload: GraphDescribeOutput = {
		...rest,
		edges: includeEdges ? d.edges : [],
		subgraphs: includeSubgraphs ? d.subgraphs : [],
	};
	const text = JSON.stringify(sortJsonValue(payload), null, options.indent ?? 2);
	options.logger?.(text);
	return text;
}

function renderDescribeAsPretty(d: GraphDescribeOutput, options: GraphDescribeOptions): string {
	const includeEdges = options.includeEdges ?? true;
	const includeSubgraphs = options.includeSubgraphs ?? true;
	const lines: string[] = [];
	lines.push(`Graph ${d.name}`);
	lines.push("Nodes:");
	for (const path of Object.keys(d.nodes).sort()) {
		const n = d.nodes[path]!;
		lines.push(`- ${path} (${n.type}/${n.status}): ${describeData(n.value)}`);
	}
	if (includeEdges) {
		lines.push("Edges:");
		for (const edge of d.edges) {
			lines.push(`- ${edge.from} -> ${edge.to}`);
		}
	}
	if (includeSubgraphs) {
		lines.push("Subgraphs:");
		for (const sg of d.subgraphs) {
			lines.push(`- ${sg}`);
		}
	}
	const text = lines.join("\n");
	options.logger?.(text);
	return text;
}

function renderDescribeAsMermaid(d: GraphDescribeOutput, options: GraphDescribeOptions): string {
	const direction = normalizeDiagramDirection(options.direction);
	const paths = Object.keys(d.nodes).sort();
	const ids = new Map<string, string>();
	for (let i = 0; i < paths.length; i += 1) ids.set(paths[i]!, `n${i}`);
	const lines: string[] = [`flowchart ${direction}`];
	for (const path of paths) {
		const id = ids.get(path)!;
		lines.push(`  ${id}["${escapeMermaidLabel(path)}"]`);
	}
	for (const [from, to] of collectDiagramArrows(d)) {
		const fromId = ids.get(from);
		const toId = ids.get(to);
		if (!fromId || !toId) continue;
		lines.push(`  ${fromId} --> ${toId}`);
	}
	return lines.join("\n");
}

function renderDescribeAsD2(d: GraphDescribeOutput, options: GraphDescribeOptions): string {
	const direction = normalizeDiagramDirection(options.direction);
	const paths = Object.keys(d.nodes).sort();
	const ids = new Map<string, string>();
	for (let i = 0; i < paths.length; i += 1) ids.set(paths[i]!, `n${i}`);
	const lines: string[] = [`direction: ${d2DirectionFromGraphDirection(direction)}`];
	for (const path of paths) {
		const id = ids.get(path)!;
		lines.push(`${id}: "${escapeD2Label(path)}"`);
	}
	for (const [from, to] of collectDiagramArrows(d)) {
		const fromId = ids.get(from);
		const toId = ids.get(to);
		if (!fromId || !toId) continue;
		lines.push(`${fromId} -> ${toId}`);
	}
	return lines.join("\n");
}

function escapeRegexLiteral(value: string): string {
	return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function globToRegex(pattern: string): RegExp {
	let re = "^";
	for (let i = 0; i < pattern.length; i += 1) {
		const ch = pattern[i]!;
		if (ch === "*") {
			re += ".*";
			continue;
		}
		if (ch === "?") {
			re += ".";
			continue;
		}
		if (ch === "[") {
			const end = pattern.indexOf("]", i + 1);
			if (end <= i + 1) {
				re += "\\[";
				continue;
			}
			let cls = pattern.slice(i + 1, end);
			if (cls.startsWith("!")) cls = `^${cls.slice(1)}`;
			cls = cls.replace(/\\/g, "\\\\");
			re += `[${cls}]`;
			i = end;
			continue;
		}
		re += escapeRegexLiteral(ch);
	}
	re += "$";
	return new RegExp(re);
}

const OBSERVE_ANSI_THEME: Required<ObserveTheme> = {
	data: "\u001b[32m",
	dirty: "\u001b[33m",
	resolved: "\u001b[36m",
	invalidate: "\u001b[93m",
	pause: "\u001b[90m",
	resume: "\u001b[96m",
	complete: "\u001b[34m",
	error: "\u001b[31m",
	teardown: "\u001b[91m",
	derived: "\u001b[35m",
	path: "\u001b[90m",
	reset: "\u001b[0m",
};

const OBSERVE_NO_COLOR_THEME: Required<ObserveTheme> = {
	data: "",
	dirty: "",
	resolved: "",
	invalidate: "",
	pause: "",
	resume: "",
	complete: "",
	error: "",
	teardown: "",
	derived: "",
	path: "",
	reset: "",
};

function describeData(value: unknown): string {
	if (typeof value === "string") return JSON.stringify(value);
	if (typeof value === "number" || typeof value === "boolean" || value == null)
		return String(value);
	try {
		return JSON.stringify(value);
	} catch {
		return "[unserializable]";
	}
}

function resolveObserveTheme(theme: ObserveOptions["theme"]): Required<ObserveTheme> {
	if (theme === "none") return OBSERVE_NO_COLOR_THEME;
	if (theme === "ansi" || theme == null) return OBSERVE_ANSI_THEME;
	return {
		data: theme.data ?? "",
		dirty: theme.dirty ?? "",
		resolved: theme.resolved ?? "",
		invalidate: theme.invalidate ?? "",
		pause: theme.pause ?? "",
		resume: theme.resume ?? "",
		complete: theme.complete ?? "",
		error: theme.error ?? "",
		teardown: theme.teardown ?? "",
		derived: theme.derived ?? "",
		path: theme.path ?? "",
		reset: theme.reset ?? "",
	};
}

/** Resolve observe `detail` level into effective boolean flags. */
function resolveObserveDetail(opts?: ObserveOptions): ObserveOptions {
	if (opts == null) return {};
	const detail = opts.detail;
	if (detail === "full") {
		return {
			...opts,
			structured: opts.structured ?? true,
			timeline: opts.timeline ?? true,
			causal: opts.causal ?? true,
			derived: opts.derived ?? true,
		};
	}
	if (detail === "minimal") {
		return { ...opts, structured: opts.structured ?? true };
	}
	return opts;
}

/**
 * Option shapes that trigger structured-mode dispatch in {@link Graph.observe}.
 * Presence of any of these fields (truthy) → returns {@link ObserveResult};
 * otherwise `observe()` returns the raw-stream variants.
 */
export type StructuredTriggers = {
	structured?: true;
	timeline?: true;
	causal?: true;
	derived?: true;
	format?: "pretty" | "json";
	detail?: "minimal" | "full";
};

/** {@link Graph.observe} on a single node or meta path — sink receives plain message batches. */
export type GraphObserveOne = {
	subscribe(sink: NodeSink): () => void;
	/** Send messages upstream toward the observed node's sources (e.g. PAUSE/RESUME). */
	up(messages: Messages): void;
};

/**
 * {@link Graph.observe} on the whole graph — sink receives each batch with the qualified source path.
 * Subscription order follows code-point sort on paths (mounts-first walk, then sorted locals/meta).
 */
export type GraphObserveAll = {
	subscribe(sink: (nodePath: string, messages: Messages) => void): () => void;
	/** Send messages upstream toward a specific observed node's sources (e.g. PAUSE/RESUME). */
	up(path: string, messages: Messages): void;
};

/**
 * Detail level for `observe()` progressive disclosure (Phase 3.3b).
 * - `"minimal"` — DATA events only, no timestamps, no causal info.
 * - `"standard"` — all message types (DATA, DIRTY, RESOLVED, INVALIDATE,
 *   PAUSE, RESUME, COMPLETE, ERROR, TEARDOWN).
 * - `"full"` — standard + timeline + causal + derived.
 */
export type ObserveDetail = "minimal" | "standard" | "full";

/** Options for structured observation modes on {@link Graph.observe}. */
export type ObserveOptions = {
	actor?: Actor;
	/** Return an {@link ObserveResult} accumulator instead of a raw stream. */
	structured?: boolean;
	/** Include causal trace info (which dep triggered each recomputation). */
	causal?: boolean;
	/** Include timestamps and batch context on each event. */
	timeline?: boolean;
	/** Include per-evaluation dep snapshots for compute/derived nodes. */
	derived?: boolean;
	/**
	 * Detail level (Phase 3.3b). Individual flags (`causal`, `timeline`, `derived`)
	 * override. `"full"` implies all three plus structured.
	 * `"minimal"` filters to DATA-only events.
	 */
	detail?: ObserveDetail;

	// ——— Format / logging (merged from spy) ———

	/**
	 * When set, auto-enables structured mode and attaches a logger.
	 * `"pretty"` renders colored one-line output; `"json"` emits one JSON object per event.
	 */
	format?: "pretty" | "json";
	/** Sink for rendered lines (`console.log` by default). Only used when `format` is set. */
	logger?: (line: string, event: ObserveEvent) => void;
	/** Keep only these event types in formatted output. Only used when `format` is set. */
	includeTypes?: ObserveEvent["type"][];
	/** Exclude these event types from formatted output. Only used when `format` is set. */
	excludeTypes?: ObserveEvent["type"][];
	/** Built-in color preset (`ansi` default) or explicit color tokens. Only used when `format` is set. */
	theme?: ObserveThemeName | ObserveTheme;
	/**
	 * Cap the `events` buffer. When set, the result uses a {@link RingBuffer}
	 * under the hood: oldest events are dropped on overflow. Unbounded when
	 * omitted (default).
	 */
	maxEvents?: number;
};

/** Accumulated observation result (structured mode). */
export type ObserveResult<T = unknown> = AsyncIterable<ObserveEvent> & {
	/** Latest DATA value by observed path. */
	readonly values: Record<string, T>;
	/** Number of DIRTY messages received. */
	readonly dirtyCount: number;
	/** Number of RESOLVED messages received. */
	readonly resolvedCount: number;
	/** Number of INVALIDATE messages received (tier 1 cache-clear). */
	readonly invalidateCount: number;
	/** Number of PAUSE messages received (tier 2 backpressure). */
	readonly pauseCount: number;
	/** Number of RESUME messages received (tier 2 backpressure). */
	readonly resumeCount: number;
	/** Number of TEARDOWN messages received (tier 5 permanent cleanup). */
	readonly teardownCount: number;
	/**
	 * All events in order — ring-buffered when `options.maxEvents` is set,
	 * unbounded otherwise. Always materialized as an `ObserveEvent[]`
	 * snapshot on read.
	 */
	readonly events: ObserveEvent[];
	/** True if any observed node sent COMPLETE without prior ERROR on that node. */
	readonly anyCompletedCleanly: boolean;
	/** True if any observed node sent ERROR. */
	readonly anyErrored: boolean;
	/** True if at least one COMPLETE received and no ERROR from any observed node. */
	readonly completedWithoutErrors: boolean;
	/**
	 * Attach a live listener that fires for each event as it arrives.
	 * Returns an unsubscribe fn. Independent of the `events` buffer.
	 */
	onEvent(listener: (event: ObserveEvent) => void): () => void;
	/** Stop observing. */
	dispose(): void;
	/**
	 * Resubscribe with higher detail (Phase 3.3b).
	 * Disposes current observation, returns new `ObserveResult` with merged options.
	 */
	expand(
		extra: Partial<Pick<ObserveOptions, "causal" | "timeline" | "derived">> | ObserveDetail,
	): ObserveResult<T>;
};

/** Fields common to every {@link ObserveEvent} variant. */
export interface ObserveEventBase {
	path?: string;
	/** Optional `timeline` context — wall-clock when `options.timeline === true`. */
	timestamp_ns?: number;
	in_batch?: boolean;
	/** Monotonically increasing counter per subscribe-callback invocation. All events in one delivery share the same id. */
	batch_id?: number;
}

/** Optional `causal` context present on `data`/`resolved`/`derived` events. */
export interface ObserveCausalContext {
	trigger_dep_index?: number;
	trigger_dep_name?: string;
	/**
	 * V0 version of the triggering dep at observation time (§6.0b).
	 * This is the dep's post-emission version (after its own `advanceVersion`),
	 * not the pre-emission version that caused this node's recomputation.
	 */
	trigger_version?: { id: string; version: number };
	/**
	 * One scalar per dep: the last value that arrived in the current wave,
	 * or the pre-wave cached value for deps that didn't fire. Convenient
	 * for single-value-wave tooling (the common case).
	 */
	dep_values?: unknown[];
	/**
	 * Full per-dep batches for the wave that fired the fn — `dep_batches[i]`
	 * is the array of values dep `i` delivered this wave (`undefined` for
	 * deps that didn't fire). Use this to distinguish a single-value wave
	 * from a multi-value wave; `dep_values` compresses each batch to its
	 * last element and hides that difference.
	 */
	dep_batches?: ReadonlyArray<ReadonlyArray<unknown> | undefined>;
}

/** A single event in the structured observation log (discriminated on `type`). */
export type ObserveEvent =
	| (ObserveEventBase & ObserveCausalContext & { type: "data"; data: unknown })
	| (ObserveEventBase & { type: "dirty" })
	| (ObserveEventBase & ObserveCausalContext & { type: "resolved" })
	| (ObserveEventBase & { type: "invalidate" })
	| (ObserveEventBase & { type: "pause"; lockId: unknown })
	| (ObserveEventBase & { type: "resume"; lockId: unknown })
	| (ObserveEventBase & { type: "complete" })
	| (ObserveEventBase & { type: "error"; data: unknown })
	| (ObserveEventBase & { type: "teardown" })
	| (ObserveEventBase & ObserveCausalContext & { type: "derived"; dep_values: unknown[] });

/** Built-in color preset names for observe `format` rendering. */
export type ObserveThemeName = "none" | "ansi";

/** ANSI/style overrides for observe `format` event rendering. */
export type ObserveTheme = Partial<Record<ObserveEvent["type"] | "path" | "reset", string>>;

/**
 * Reject characters that would collide with internal serialization or path
 * grammar. Control chars (0x00–0x1F, 0x7F) break `describe()` key stability,
 * diagram rendering, and any tab-delimited log/trace format. Keep the test
 * tight so the error message points at the first offending code point.
 */
function assertNoControlChars(name: string, graphName: string, label: string): void {
	for (let i = 0; i < name.length; i++) {
		const c = name.charCodeAt(i);
		if (c < 0x20 || c === 0x7f) {
			throw new Error(
				`Graph "${graphName}": ${label} "${name}" must not contain control character (U+${c.toString(16).padStart(4, "0").toUpperCase()} at index ${i})`,
			);
		}
	}
}

/**
 * Validate a registerable local name (`add`, `mount`, `remove` inputs):
 * non-empty, no `::` separator, not the reserved `__meta__` segment, and no
 * control characters.
 */
function assertRegisterableName(name: string, graphName: string, label: string): void {
	if (name === "") {
		throw new Error(`Graph "${graphName}": ${label} name must be non-empty`);
	}
	if (name.includes(PATH_SEP)) {
		throw new Error(
			`Graph "${graphName}": ${label} "${name}" must not contain '${PATH_SEP}' (path separator)`,
		);
	}
	if (name === GRAPH_META_SEGMENT) {
		throw new Error(
			`Graph "${graphName}": ${label} name "${GRAPH_META_SEGMENT}" is reserved for meta companion paths`,
		);
	}
	assertNoControlChars(name, graphName, label);
}

function splitPath(path: string, graphName: string): string[] {
	if (path === "") {
		throw new Error(`Graph "${graphName}": resolve path must be non-empty`);
	}
	const segments = path.split(PATH_SEP);
	for (const s of segments) {
		if (s === "") {
			throw new Error(`Graph "${graphName}": resolve path has empty segment`);
		}
	}
	return segments;
}

/**
 * Strip messages that are not marked `metaPassthrough` on the given config
 * (spec §2.3 Companion lifecycle). Built-ins: `INVALIDATE`, `COMPLETE`,
 * `ERROR`, `TEARDOWN` are registered `metaPassthrough: false` in
 * `registerBuiltins`. Custom types default to `true` (meta receives them).
 *
 * To target a meta node directly without the filter, call `meta.down(...)`.
 *
 * Returns empty array when nothing remains.
 */
function filterMetaMessages(messages: Messages, config: GraphReFlyConfig): Messages {
	// Fast path: if every message is metaPassthrough, reuse the input array.
	let anyFiltered = false;
	for (const m of messages) {
		if (!config.isMetaPassthrough(m[0])) {
			anyFiltered = true;
			break;
		}
	}
	if (!anyFiltered) return messages;
	const kept = messages.filter((m) => config.isMetaPassthrough(m[0]));
	return kept as unknown as Messages;
}

/**
 * TEARDOWN every node in a mounted graph tree (depth-first into mounts).
 * Errors from individual node teardowns are swallowed — a single bad handler
 * must not abort cleanup of the rest of the subtree.
 */
function teardownMountedGraph(root: Graph): void {
	for (const child of root._mounts.values()) {
		teardownMountedGraph(child);
	}
	for (const n of root._nodes.values()) {
		try {
			n.down([[TEARDOWN]] satisfies Messages, { internal: true });
		} catch {
			/* resilience: keep tearing down siblings */
		}
	}
}

/**
 * Named container for nodes and explicit edges (GRAPHREFLY-SPEC §3.1–§3.7).
 *
 * Qualified paths use `::` as the segment separator (for example `parent::child::node`).
 *
 * Edges are pure wires: `connect` only validates wiring — the target must already list the source in
 * its dependency array; no transforms run on the edge.
 *
 * @example
 * ```ts
 * import { Graph, state } from "@graphrefly/graphrefly-ts";
 *
 * const g = new Graph("app");
 * g.add("counter", state(0));
 * ```
 *
 * @category graph
 */
export class Graph {
	readonly name: string;
	readonly opts: Readonly<GraphOptions>;
	/** Protocol config bound to this graph (defaults to `defaultConfig`). */
	readonly config: GraphReFlyConfig;
	/** @internal — exposed for {@link teardownMountedGraph} and cross-graph helpers. */
	readonly _nodes = new Map<string, Node>();
	/**
	 * @internal Reverse lookup for duplicate-instance detection in
	 * {@link Graph.add} — O(1) replacement for an O(n) scan of `_nodes`.
	 * Weak so nodes can be GC'd after `remove()` even if a caller keeps the
	 * map alive via some unusual pattern.
	 */
	private readonly _nodeToName = new WeakMap<Node, string>();
	/** @internal — exposed for {@link teardownMountedGraph}. */
	readonly _mounts = new Map<string, Graph>();
	/**
	 * @internal Parent graph if this instance is mounted. `undefined` when
	 * this is the root or when the graph has been unmounted. Used for
	 * reparenting rejection + O(depth) ancestor walks.
	 */
	_parent: Graph | undefined = undefined;
	private readonly _storageDisposers = new Set<() => void>();
	private readonly _disposers = new Set<() => void>();
	/**
	 * @internal Lazy `TopologyEvent` producer. Created on first `.topology`
	 * access. Zero cost until something subscribes — producer fn only runs when
	 * the first sink attaches, registering one handler into
	 * {@link Graph._topologyEmitters}.
	 */
	private _topology: Node<TopologyEvent> | undefined;
	/**
	 * @internal Active emit handlers for the topology producer. Each entry is
	 * the closure registered by the producer fn on activation; cleared on
	 * deactivation. `_emitTopology` broadcasts through every entry (there is at
	 * most one per activation cycle of the producer).
	 */
	private readonly _topologyEmitters = new Set<(event: TopologyEvent) => void>();

	/**
	 * @param name - Non-empty graph id (must not contain `::` and must not
	 *   equal the reserved meta segment `__meta__`).
	 * @param opts - See {@link GraphOptions}. Stored frozen on the instance.
	 */
	constructor(name: string, opts?: GraphOptions) {
		if (name === "") {
			throw new Error("Graph name must be non-empty");
		}
		if (name.includes(PATH_SEP)) {
			throw new Error(`Graph name must not contain '${PATH_SEP}' (got "${name}")`);
		}
		if (name === GRAPH_META_SEGMENT) {
			throw new Error(`Graph name "${GRAPH_META_SEGMENT}" is reserved for meta companion paths`);
		}
		this.name = name;
		this.opts = Object.freeze({ ...(opts ?? {}) });
		this.config = opts?.config ?? defaultConfig;
		this._traceRing = new RingBuffer<TraceEntry>(opts?.traceCapacity ?? 1000);
		if (opts?.versioning != null) {
			// No nodes yet, but keep the API consistent — apply at construction
			// so opts.versioning is honored as a startup default via this helper.
			this.setVersioning(opts.versioning);
		}
	}

	/**
	 * Walk ancestors up through `_parent`. Returns the chain starting at this
	 * instance, ending at the root (a graph with no parent). O(depth).
	 *
	 * @param includeSelf - Include `this` in the chain (default `true`).
	 */
	ancestors(includeSelf = true): Graph[] {
		const out: Graph[] = [];
		let p: Graph | undefined = includeSelf ? this : this._parent;
		while (p != null) {
			out.push(p);
			p = p._parent;
		}
		return out;
	}

	// ——————————————————————————————————————————————————————————————
	//  Topology companion (structural-change event stream)
	// ——————————————————————————————————————————————————————————————

	/**
	 * Reactive stream of structural changes to this graph's own registry
	 * (add / mount / remove). Value mutations live on `observe()`; this
	 * companion only fires when the topology shape changes.
	 *
	 * Lazy: the underlying node is created on first access and activates when
	 * something subscribes. No emission replay — late subscribers do not
	 * receive historical events and should snapshot via {@link Graph.describe}
	 * before listening for incremental changes. Events that fire while the
	 * producer has zero subscribers are dropped (no retention).
	 *
	 * Own-graph only: a parent's `topology` does NOT emit for structural
	 * changes inside a mounted child. Transitive consumers subscribe to each
	 * child's topology separately (recurse through `topology`'s own "added"
	 * events with `nodeKind: "mount"` to discover new children).
	 *
	 * See {@link TopologyEvent} for payload shape.
	 *
	 * @category observability
	 */
	get topology(): Node<TopologyEvent> {
		if (this._topology == null) {
			this._topology = producer<TopologyEvent>(
				(actions) => {
					const handler = (event: TopologyEvent): void => {
						actions.emit(event);
					};
					this._topologyEmitters.add(handler);
					return () => {
						this._topologyEmitters.delete(handler);
					};
				},
				{ name: `${this.name}_topology` },
			);
		}
		return this._topology;
	}

	/**
	 * @internal Fire a {@link TopologyEvent} to every active subscriber of
	 * `this.topology`. No-op when the topology node has never been accessed or
	 * currently has no sinks — zero cost for graphs nobody observes.
	 */
	private _emitTopology(event: TopologyEvent): void {
		if (this._topology == null || this._topologyEmitters.size === 0) return;
		for (const h of this._topologyEmitters) h(event);
	}

	// ——————————————————————————————————————————————————————————————
	//  Node registry
	// ——————————————————————————————————————————————————————————————

	/**
	 * Registers a node under a local name. Fails if the name is already used,
	 * reserved by a mount, the same node instance is already registered, or
	 * the node is torn down.
	 *
	 * Returns the registered node so callers can chain:
	 * `const counter = g.add("counter", state(0))`.
	 *
	 * @param name - Local key (no `::`).
	 * @param node - Node instance to own.
	 */
	add<T extends Node>(name: string, node: T): T {
		assertRegisterableName(name, this.name, "add");
		if (this._mounts.has(name)) {
			throw new Error(`Graph "${this.name}": name "${name}" is already a mount point`);
		}
		if (this._nodes.has(name)) {
			throw new Error(`Graph "${this.name}": node "${name}" already exists`);
		}
		const existingName = this._nodeToName.get(node);
		if (existingName !== undefined) {
			throw new Error(
				`Graph "${this.name}": node instance already registered as "${existingName}"`,
			);
		}
		this._nodes.set(name, node);
		this._nodeToName.set(node, name);
		// Edges are derived on demand from node `_deps` (see `edges()`) — no
		// stored registry to keep in sync. See Unit 7 of the graph review.
		this._emitTopology({ kind: "added", name, nodeKind: "node" });
		return node;
	}

	/**
	 * Bulk-apply a minimum versioning level to every currently-registered node
	 * in this graph (roadmap §6.0). `_applyVersioning` is monotonic — nodes
	 * already at a higher level are untouched. The method refuses to run
	 * mid-wave; invoke at setup time before any external subscribers attach.
	 *
	 * **Not** a default-for-future-adds mechanism — that's what
	 * `config.defaultVersioning` is for. Nodes added after this call do NOT
	 * automatically inherit `level`; register new nodes with their own
	 * `opts.versioning` or set `config.defaultVersioning` before construction.
	 *
	 * **Scope:** local only. Does not propagate to mounted subgraphs.
	 *
	 * @param level - `0` for V0, `1` for V1, or `undefined` to no-op.
	 */
	setVersioning(level: VersioningLevel | undefined): void {
		if (level == null) return;
		for (const node of this._nodes.values()) {
			if (node instanceof NodeImpl) {
				node._applyVersioning(level);
			}
		}
	}

	/**
	 * Unregisters a node or unmounts a subgraph and sends `[[TEARDOWN]]` to the
	 * removed node or recursively through the mounted subtree (§3.2).
	 *
	 * @param name - Local mount or node name.
	 * @returns Audit record of what was removed: `{kind, nodes, mounts}`.
	 *   `kind: "node"` → `nodes: [name]`, `mounts: []`. `kind: "mount"` →
	 *   `nodes` lists every primary node torn down across the subtree (sorted
	 *   qualified paths relative to the unmounted subgraph) and `mounts` lists
	 *   the mounted subgraphs in depth-first order including `name` itself.
	 */
	remove(name: string): GraphRemoveAudit {
		assertRegisterableName(name, this.name, "remove");

		// Case 1: unmount a subgraph
		const child = this._mounts.get(name);
		if (child) {
			const audit: GraphRemoveAudit = { kind: "mount", nodes: [], mounts: [] };
			const targets: [string, Node][] = [];
			child._collectObserveTargets("", targets);
			for (const [p, n] of targets) {
				// Only primary nodes (not meta companions) — meta cascades via
				// the primary's TEARDOWN.
				if (!p.includes(`${PATH_SEP}${GRAPH_META_SEGMENT}${PATH_SEP}`)) {
					audit.nodes.push(p);
				}
				void n;
			}
			audit.nodes.sort();
			audit.mounts.push(name);
			audit.mounts.push(...child._collectSubgraphs(`${name}${PATH_SEP}`));
			this._mounts.delete(name);
			child._parent = undefined;
			teardownMountedGraph(child);
			this._emitTopology({ kind: "removed", name, nodeKind: "mount", audit });
			return audit;
		}

		// Case 2: remove a local node
		const node = this._nodes.get(name);
		if (!node) {
			throw new Error(`Graph "${this.name}": unknown node or mount "${name}"`);
		}
		this._nodes.delete(name);
		this._nodeToName.delete(node);
		node.down([[TEARDOWN]] satisfies Messages, { internal: true });
		const audit: GraphRemoveAudit = { kind: "node", nodes: [name], mounts: [] };
		this._emitTopology({ kind: "removed", name, nodeKind: "node", audit });
		return audit;
	}

	/**
	 * Bulk remove — invokes {@link Graph.remove} for every local name matching
	 * `filter`. Audit records merge into a single result. Mounted subgraphs
	 * are included via `filter` receiving the mount name; internal subtree
	 * entries are not walked directly (use describe + scan for tree-level
	 * queries).
	 *
	 * @param filter - Predicate or glob. Glob strings support `*` within a
	 *   segment and `**` across segments (same grammar as `restore({only})`).
	 * @returns Combined audit of all nodes + mounts removed.
	 */
	removeAll(filter: ((name: string) => boolean) | string): GraphRemoveAudit {
		const match =
			typeof filter === "function"
				? filter
				: (() => {
						const re = globToRegex(filter);
						return (n: string) => re.test(n);
					})();
		const audit: GraphRemoveAudit = { kind: "mount", nodes: [], mounts: [] };
		// Snapshot names first — remove mutates the maps.
		const localNames = [...this._nodes.keys(), ...this._mounts.keys()].filter((n) => match(n));
		for (const name of localNames) {
			const sub = this.remove(name);
			audit.nodes.push(...sub.nodes);
			audit.mounts.push(...sub.mounts);
		}
		audit.nodes.sort();
		audit.mounts.sort();
		return audit;
	}

	/**
	 * Iterable over locally-registered `[localName, Node]` pairs (sorted).
	 * Does not recurse into mounts.
	 */
	[Symbol.iterator](): IterableIterator<[string, Node]> {
		const sorted = [...this._nodes.keys()].sort();
		const nodes = this._nodes;
		let i = 0;
		return {
			[Symbol.iterator]() {
				return this;
			},
			next(): IteratorResult<[string, Node]> {
				if (i >= sorted.length) return { value: undefined, done: true };
				const name = sorted[i++];
				return { value: [name, nodes.get(name)!], done: false };
			},
		};
	}

	/**
	 * Returns a node by local name or `::` qualified path.
	 * Local names are looked up directly; paths with `::` delegate to {@link resolve}.
	 *
	 * @param name - Local name or qualified path.
	 */
	node(name: string): Node {
		if (name === "") {
			throw new Error(`Graph "${this.name}": node name must be non-empty`);
		}
		if (name.includes(PATH_SEP)) {
			return this.resolve(name);
		}
		const n = this._nodes.get(name);
		if (!n) {
			throw new Error(`Graph "${this.name}": unknown node "${name}"`);
		}
		return n;
	}

	/**
	 * Reads `graph.node(name).get()` — accepts `::` qualified paths (§3.2).
	 *
	 * @param name - Local name or qualified path.
	 * @returns Cached value or `undefined`.
	 */
	get(name: string): unknown {
		return this.node(name).cache;
	}

	/**
	 * Shorthand for `graph.node(name).down([[DATA, value]], { actor })` — accepts `::` qualified paths (§3.2).
	 *
	 * @param name - Local name or qualified path.
	 * @param value - Next `DATA` payload.
	 * @param options - Optional `actor` and `internal` guard bypass.
	 */
	set(name: string, value: unknown, options?: GraphActorOptions): void {
		const internal = options?.internal === true;
		this.node(name).down([[DATA, value]] satisfies Messages, {
			actor: options?.actor,
			internal,
			delivery: "write",
		});
	}

	/**
	 * Atomic multi-node DATA write. Wraps every {@link Graph.set} call in a
	 * single `batch(...)` so downstream dependents see one coalesced wave
	 * instead of N cascading ones.
	 *
	 * @param entries - `{name → value}` map or `[name, value]` pairs.
	 * @param options - Passed to each underlying `set` call (same `actor` + `internal` semantics).
	 */
	setAll(
		entries: Record<string, unknown> | Iterable<readonly [string, unknown]>,
		options?: GraphActorOptions,
	): void {
		const iter: Iterable<readonly [string, unknown]> =
			Symbol.iterator in entries
				? (entries as Iterable<readonly [string, unknown]>)
				: Object.entries(entries as Record<string, unknown>);
		batch(() => {
			for (const [name, value] of iter) this.set(name, value, options);
		});
	}

	/**
	 * Emit a single `[[INVALIDATE]]` (tier 1) on a node. Thin wrapper over
	 * `node.down([[INVALIDATE]], …)` matching the {@link Graph.set} ergonomics.
	 */
	invalidate(name: string, options?: GraphActorOptions): void {
		const internal = options?.internal === true;
		this.node(name).down([[INVALIDATE]] satisfies Messages, {
			actor: options?.actor,
			internal,
			delivery: "write",
		});
	}

	/**
	 * Emit a single `[[ERROR, err]]` (tier 4) on a node.
	 */
	error(name: string, err: unknown, options?: GraphActorOptions): void {
		const internal = options?.internal === true;
		this.node(name).down([[ERROR, err]] satisfies Messages, {
			actor: options?.actor,
			internal,
			delivery: "write",
		});
	}

	/**
	 * Emit a single `[[COMPLETE]]` (tier 4) on a node, declaring the stream
	 * cleanly finished. Distinct from {@link Graph.remove} (which emits
	 * TEARDOWN and unregisters the node).
	 */
	complete(name: string, options?: GraphActorOptions): void {
		const internal = options?.internal === true;
		this.node(name).down([[COMPLETE]] satisfies Messages, {
			actor: options?.actor,
			internal,
			delivery: "write",
		});
	}

	// ——————————————————————————————————————————————————————————————
	//  Edges (derived on-demand from node `_deps`)
	// ——————————————————————————————————————————————————————————————

	/**
	 * Returns the full edge list for this graph tree, derived on demand from
	 * each registered node's `_deps` (no stored registry). Local-only
	 * (non-recursive) by default to match the historical `edges()` surface;
	 * pass `{recursive: true}` to include mounted subgraphs with qualified
	 * paths relative to this graph.
	 *
	 * Use {@link Graph.describe} for full-tree snapshots with edges already
	 * qualified and paired with node metadata.
	 */
	edges(opts?: { recursive?: boolean }): ReadonlyArray<[string, string]> {
		const recursive = opts?.recursive === true;
		const nodeToLocal = new Map<Node, string>();
		if (!recursive) {
			for (const [localName, n] of this._nodes) nodeToLocal.set(n, localName);
			const result: [string, string][] = [];
			for (const [localName, n] of this._nodes) {
				if (!(n instanceof NodeImpl)) continue;
				for (const dep of n._deps) {
					const from = nodeToLocal.get(dep.node);
					if (from != null) result.push([from, localName]);
				}
			}
			result.sort((a, b) =>
				a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : a[1] < b[1] ? -1 : a[1] > b[1] ? 1 : 0,
			);
			return result;
		}
		const targets: [string, Node][] = [];
		this._collectObserveTargets("", targets);
		const nodeToPath = new Map<Node, string>();
		for (const [p, n] of targets) nodeToPath.set(n, p);
		const result: [string, string][] = [];
		for (const [path, n] of targets) {
			if (!(n instanceof NodeImpl)) continue;
			for (const dep of n._deps) {
				const from = nodeToPath.get(dep.node);
				if (from != null) result.push([from, path]);
			}
		}
		result.sort((a, b) =>
			a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : a[1] < b[1] ? -1 : a[1] > b[1] ? 1 : 0,
		);
		return result;
	}

	// ——————————————————————————————————————————————————————————————
	//  Composition
	// ——————————————————————————————————————————————————————————————

	/**
	 * Embed a child graph at a local mount name (§3.4). Child nodes are reachable via
	 * {@link Graph.resolve} using `::` delimited paths (§3.5). Lifecycle
	 * {@link Graph.signal} visits mounted subgraphs recursively.
	 *
	 * Rejects: same name as existing node or mount, self-mount, mount cycles,
	 * and the same child graph instance mounted twice on one parent.
	 *
	 * @param name - Local mount point.
	 * @param child - Nested `Graph` instance.
	 * @returns The mounted `child`, for chaining.
	 */
	mount<G extends Graph>(name: string, child: G): G {
		assertRegisterableName(name, this.name, "mount");
		if (this._nodes.has(name)) {
			throw new Error(
				`Graph "${this.name}": cannot mount at "${name}" — node with that name exists`,
			);
		}
		if (this._mounts.has(name)) {
			throw new Error(`Graph "${this.name}": mount "${name}" already exists`);
		}
		if ((child as Graph) === this) {
			throw new Error(`Graph "${this.name}": cannot mount a graph into itself`);
		}
		// Reject reparenting (Unit 6 B): same child instance may only be
		// mounted once across the entire tree. Cheap O(1) check via the
		// back-pointer (replaces both the "mounted twice on this parent"
		// loop AND the O(G) cycle DFS).
		if (child._parent != null) {
			throw new Error(
				`Graph "${this.name}": this child graph is already mounted on "${child._parent.name}"`,
			);
		}
		// Cycle rejection — walk UP from `this` to detect if we are already in
		// `child`'s descendant tree. O(depth), independent of tree size.
		for (let p: Graph | undefined = this; p != null; p = p._parent) {
			if (p === (child as Graph)) {
				throw new Error(`Graph "${this.name}": mount("${name}", …) would create a mount cycle`);
			}
		}
		this._mounts.set(name, child);
		child._parent = this;
		this._emitTopology({ kind: "added", name, nodeKind: "mount" });
		return child;
	}

	/**
	 * Look up a node by qualified path (§3.5). Segments are separated by `::`.
	 *
	 * If the first segment equals this graph's {@link Graph.name}, it is stripped
	 * (so `root.resolve("app::a")` works when `root.name === "app"`). The strip
	 * is applied **recursively** when descending into mounted children, so
	 * `child.resolve("child::x")` also works when `child.name === "child"`.
	 *
	 * @param path - Qualified `::` path or local name.
	 * @returns The resolved `Node`.
	 */
	resolve(path: string): Node {
		const segments = splitPath(path, this.name);
		return this._resolveFromSegments(segments);
	}

	/**
	 * Non-throwing {@link Graph.resolve}. Returns `undefined` instead of
	 * throwing when the path does not resolve to a node.
	 */
	tryResolve(path: string): Node | undefined {
		try {
			return this.resolve(path);
		} catch {
			return undefined;
		}
	}

	private _resolveFromSegments(segments: readonly string[]): Node {
		// Recursive self-name strip: if the first segment equals this graph's
		// own name, peel it off. Applied at every recursion level so nested
		// resolution of `child::x` inside `child` works uniformly.
		let seg = segments;
		if (seg[0] === this.name) {
			seg = seg.slice(1);
			if (seg.length === 0) {
				throw new Error(`Graph "${this.name}": resolve path ends at graph name only`);
			}
		}
		const head = seg[0] as string;
		const rest = seg.slice(1);

		if (rest.length === 0) {
			const n = this._nodes.get(head);
			if (n) return n;
			if (this._mounts.has(head)) {
				throw new Error(
					`Graph "${this.name}": path ends at subgraph "${head}" — not a node (GRAPHREFLY-SPEC §3.5)`,
				);
			}
			throw new Error(`Graph "${this.name}": unknown name "${head}"`);
		}

		const localN = this._nodes.get(head);
		if (localN && rest.length > 0 && rest[0] === GRAPH_META_SEGMENT) {
			return this._resolveMetaChainFromNode(localN, rest, seg.join(PATH_SEP));
		}

		const child = this._mounts.get(head);
		if (!child) {
			if (this._nodes.has(head)) {
				throw new Error(
					`Graph "${this.name}": "${head}" is a node; trailing path "${rest.join(PATH_SEP)}" is invalid`,
				);
			}
			throw new Error(`Graph "${this.name}": unknown mount or node "${head}"`);
		}

		return child.resolve(rest.join(PATH_SEP));
	}

	/**
	 * Resolve `::__meta__::key` segments from a registered primary node (possibly chained).
	 */
	private _resolveMetaChainFromNode(n: Node, parts: readonly string[], fullPath: string): Node {
		let current = n;
		let i = 0;
		const p = [...parts];
		while (i < p.length) {
			if (p[i] !== GRAPH_META_SEGMENT) {
				throw new Error(
					`Graph "${this.name}": expected ${GRAPH_META_SEGMENT} segment in meta path "${fullPath}"`,
				);
			}
			if (i + 1 >= p.length) {
				throw new Error(
					`Graph "${this.name}": meta path requires a key after ${GRAPH_META_SEGMENT} in "${fullPath}"`,
				);
			}
			const key = p[i + 1] as string;
			const next = current.meta[key];
			if (!next) {
				throw new Error(`Graph "${this.name}": unknown meta "${key}" in path "${fullPath}"`);
			}
			current = next;
			i += 2;
		}
		return current;
	}

	/**
	 * Deliver a message batch to every registered node in this graph and, recursively,
	 * in mounted child graphs (§3.7). Recurses into mounts first, then delivers to
	 * local nodes (sorted by name). Each {@link Node} receives at most one delivery
	 * per call (deduped by reference).
	 *
	 * **Primary-vs-meta filter asymmetry (intentional):** primary nodes receive the
	 * unfiltered `messages` batch — that's the canonical data-plane flow. Companion
	 * `meta` nodes receive a filtered subset keyed by the per-type `metaPassthrough`
	 * flag on {@link GraphReFlyConfig}. Built-in defaults: PAUSE / RESUME / DATA /
	 * RESOLVED pass through to meta; INVALIDATE / COMPLETE / ERROR / TEARDOWN do
	 * not.
	 *
	 * **Where lifecycle terminals reach meta:**
	 * - **TEARDOWN** — primary's `_emit` cascades to meta children directly (see
	 *   `core/node.ts` "Meta TEARDOWN fan-out" block) so meta is torn down with
	 *   its primary regardless of the signal-level filter.
	 * - **COMPLETE / ERROR / INVALIDATE** — scoped to primaries on the broadcast
	 *   path. Meta companions are an attribution side-channel, not a lifecycle
	 *   participant; address meta directly via `meta.down(...)` if you need to
	 *   forward these. Audit confirmed 2026-04-17: no current meta consumer
	 *   relies on broadcast COMPLETE/ERROR/INVALIDATE delivery.
	 *
	 * @param messages - Batch to deliver to every registered node (and mounts, recursively).
	 * @param options - Optional `actor` / `internal` for transport.
	 */
	signal(messages: Messages, options?: GraphActorOptions): void {
		// Reject tier ≥ 3 (DATA / RESOLVED / COMPLETE / ERROR / TEARDOWN when
		// called externally — destroy() routes through signal with
		// `{internal: true}` which bypasses this check). Broadcasting per-flow
		// values to every node in the tree is almost always a mistake.
		if (options?.internal !== true) {
			for (const m of messages) {
				const tier = this.config.messageTier(m[0]);
				// Tier 3 (DATA / RESOLVED) is per-flow state — broadcasting it
				// to every node overwrites unrelated caches. Tier 4/5 stays
				// allowed: ERROR/COMPLETE/TEARDOWN have legitimate broadcast
				// use (graceful shutdown, error cascade).
				if (tier === 3) {
					throw new Error(
						`Graph "${this.name}": Graph.signal() rejects tier-3 messages (DATA / RESOLVED). ` +
							`Broadcast is for control-plane tiers (START / DIRTY / INVALIDATE / PAUSE / RESUME / COMPLETE / ERROR / TEARDOWN). ` +
							`For per-node value writes, use Graph.set or graph.node(name).down(...).`,
					);
				}
			}
		}
		const errors: unknown[] = [];
		this._signalDeliver(messages, options ?? {}, new Set(), errors);
		// Surface the first collected error so callers see failures without
		// aborting the rest of the broadcast. Guard denials are re-thrown
		// immediately in _signalDeliver (deliberate access-control rejections).
		if (errors.length > 0) throw errors[0];
	}

	private _signalDeliver(
		messages: Messages,
		opts: GraphActorOptions,
		vis: Set<Node>,
		errors: unknown[],
	): void {
		for (const sub of this._mounts.values()) {
			sub._signalDeliver(messages, opts, vis, errors);
		}
		const internal = opts.internal === true;
		const downOpts: NodeTransportOptions = internal
			? { internal: true }
			: { actor: opts.actor, delivery: "signal" };
		const metaMessages = filterMetaMessages(messages, this.config);
		for (const localName of [...this._nodes.keys()].sort()) {
			const n = this._nodes.get(localName)!;
			if (vis.has(n)) continue;
			vis.add(n);
			try {
				n.down(messages, downOpts);
			} catch (err) {
				// Guard denials bubble — they're deliberate rejections, not
				// resilience failures. Other errors collect so one bad handler
				// doesn't abort the rest of the broadcast.
				if (err instanceof GuardDenied) throw err;
				errors.push(err);
			}
			if (metaMessages.length === 0) continue;
			this._signalMetaSubtree(n, metaMessages, vis, downOpts, errors);
		}
	}

	private _signalMetaSubtree(
		root: Node,
		messages: Messages,
		vis: Set<Node>,
		downOpts: NodeTransportOptions,
		errors: unknown[],
	): void {
		for (const mk of Object.keys(root.meta).sort()) {
			const mnode = root.meta[mk];
			if (vis.has(mnode)) continue;
			vis.add(mnode);
			try {
				mnode.down(messages, downOpts);
			} catch (err) {
				if (err instanceof GuardDenied) throw err;
				errors.push(err);
			}
			this._signalMetaSubtree(mnode, messages, vis, downOpts, errors);
		}
	}

	/**
	 * Static structure snapshot: qualified node keys, edges, mount names (GRAPHREFLY-SPEC §3.6, Appendix B).
	 *
	 * `format` controls the return type:
	 * - omitted or `"spec"` → {@link GraphDescribeOutput} object.
	 * - `"json"` / `"pretty"` / `"mermaid"` / `"d2"` → rendered string.
	 *
	 * @param options - Optional `actor` for guard-scoped visibility, `filter` for
	 *   selective output, or `format` to render.
	 *
	 * @example
	 * ```ts
	 * graph.describe()                                         // full snapshot object
	 * graph.describe({ filter: { status: "errored" } })        // filtered object
	 * graph.describe({ format: "pretty" })                     // human-readable text
	 * graph.describe({ format: "mermaid" })                    // Mermaid flowchart
	 * graph.describe({ format: "d2", direction: "TD" })        // D2 top-down
	 * ```
	 */
	describe(
		options: GraphDescribeOptions & { format: "json" | "pretty" | "mermaid" | "d2" },
	): string;
	describe(options?: GraphDescribeOptions): GraphDescribeOutput;
	describe(options?: GraphDescribeOptions): GraphDescribeOutput | string {
		const actor = options?.actor;
		const filter = options?.filter;
		const includeFields = resolveDescribeFields(options?.detail, options?.fields);
		const isSpec = options?.format === "spec";
		// For spec format, force minimal fields (type + deps only, no status/value)
		const effectiveFields = isSpec ? resolveDescribeFields("minimal") : includeFields;

		const targets: [string, Node][] = [];
		this._collectObserveTargets("", targets);
		const nodeToPath = new Map<Node, string>();
		for (const [p, n] of targets) {
			nodeToPath.set(n, p);
		}
		const nodes: Record<string, DescribeNodeOutput> = {};
		for (const [p, n] of targets) {
			if (actor != null && !n.allowsObserve(actor)) continue;
			const raw = describeNode(n, effectiveFields);
			const deps =
				n instanceof NodeImpl
					? n._deps.map((d) => nodeToPath.get(d.node) ?? d.node.name ?? "")
					: [];
			const { name: _name, ...rest } = raw;
			const entry: DescribeNodeOutput = { ...rest, deps };
			// Unit 14 A: attach reason annotation from `trace(path, reason)`
			// when one exists. Skipped for the `"spec"` format (input-schema
			// use case — annotations don't round-trip through GraphSpec).
			if (!isSpec) {
				const reason = this._annotations.get(p);
				if (reason != null) entry.reason = reason;
			}
			if (filter != null) {
				if (typeof filter === "function") {
					const fn = filter as
						| ((nodePath: string, node: DescribeNodeOutput) => boolean)
						| ((node: DescribeNodeOutput) => boolean);
					const pass =
						fn.length >= 2
							? (fn as (nodePath: string, node: DescribeNodeOutput) => boolean)(p, entry)
							: (fn as (node: DescribeNodeOutput) => boolean)(entry);
					if (!pass) continue;
				} else {
					let match = true;
					for (const [fk, fv] of Object.entries(filter)) {
						const normalizedKey =
							fk === "deps_includes" ? "depsIncludes" : fk === "meta_has" ? "metaHas" : fk;
						if (normalizedKey === "depsIncludes") {
							if (!entry.deps.includes(String(fv))) {
								match = false;
								break;
							}
							continue;
						}
						if (normalizedKey === "metaHas") {
							if (!Object.hasOwn(entry.meta ?? {}, String(fv))) {
								match = false;
								break;
							}
							continue;
						}
						if ((entry as Record<string, unknown>)[normalizedKey] !== fv) {
							match = false;
							break;
						}
					}
					if (!match) continue;
				}
			}
			nodes[p] = entry;
		}
		const nodeKeys = new Set(Object.keys(nodes));
		// Edges are derived from node `_deps` via `edges({recursive: true})`
		// (sorted, fully qualified relative to this graph).
		let edges: { from: string; to: string }[] = this.edges({ recursive: true }).map(
			([from, to]) => ({ from, to }),
		);
		if (actor != null || filter != null) {
			edges = edges.filter((e) => nodeKeys.has(e.from) && nodeKeys.has(e.to));
		}
		const allSubgraphs = this._collectSubgraphs("");
		const subgraphs =
			actor != null || filter != null
				? allSubgraphs.filter((sg) => {
						const prefix = `${sg}${PATH_SEP}`;
						return [...nodeKeys].some((k) => k === sg || k.startsWith(prefix));
					})
				: allSubgraphs;

		// Capture graph ref and base options for expand()
		const graph = this;
		const baseOpts = options;

		const struct: GraphDescribeOutput = {
			name: this.name,
			nodes,
			edges,
			subgraphs,
			expand(detailOrFields: DescribeDetail | DescribeField[]): GraphDescribeOutput {
				const merged: GraphDescribeOptions = { ...baseOpts, format: undefined };
				if (Array.isArray(detailOrFields)) {
					merged.fields = detailOrFields;
					merged.detail = undefined;
				} else {
					merged.detail = detailOrFields;
					merged.fields = undefined;
				}
				return graph.describe(merged);
			},
		};

		// Text-format dispatch. `"spec"` and undefined return the struct as-is.
		const opts = options ?? {};
		const fmt = opts.format;
		if (fmt === "json") return renderDescribeAsJson(struct, opts);
		if (fmt === "pretty") return renderDescribeAsPretty(struct, opts);
		if (fmt === "mermaid") return renderDescribeAsMermaid(struct, opts);
		if (fmt === "d2") return renderDescribeAsD2(struct, opts);
		return struct;
	}

	private _collectSubgraphs(prefix: string): string[] {
		const out: string[] = [];
		for (const m of [...this._mounts.keys()].sort()) {
			const q = prefix === "" ? m : `${prefix}${m}`;
			out.push(q);
			out.push(...this._mounts.get(m)!._collectSubgraphs(`${q}${PATH_SEP}`));
		}
		return out;
	}

	/**
	 * Snapshot-based resource profile: per-node stats, orphan effect detection,
	 * memory hotspots. Zero runtime overhead — walks nodes on demand.
	 *
	 * @param opts - Optional `topN` for hotspot limit (default 10).
	 * @returns Aggregate profile with per-node details, hotspots, and orphan effects.
	 */
	resourceProfile(opts?: GraphProfileOptions): GraphProfileResult {
		return graphProfile(this, opts);
	}

	/**
	 * Reachability query rooted at `from`. Instance convenience — wraps
	 * `reachable(this.describe(), from, direction, opts)`. See
	 * {@link reachable} for semantics.
	 */
	reachable(
		from: string,
		direction: ReachableDirection,
		opts: ReachableOptions & { withDetail: true },
	): ReachableResult;
	reachable(from: string, direction: ReachableDirection, opts?: ReachableOptions): string[];
	reachable(
		from: string,
		direction: ReachableDirection,
		opts: ReachableOptions = {},
	): string[] | ReachableResult {
		if (opts.withDetail === true) {
			return reachable(this.describe(), from, direction, {
				...opts,
				withDetail: true,
			});
		}
		return reachable(this.describe(), from, direction, opts);
	}

	/**
	 * Causal walkback: shortest dep-chain from `from` to `to`, enriched with
	 * each node's value, status, last-mutation actor, and reasoning annotation
	 * from {@link Graph.trace}. Wraps {@link explainPath} (roadmap §9.2).
	 *
	 * @param from - Upstream node (the cause).
	 * @param to - Downstream node (the effect).
	 * @param opts - Optional `maxDepth` and `findCycle`. When `findCycle:true`
	 *   and `from === to`, returns the shortest cycle through other nodes
	 *   (useful for diagnosing feedback loops, COMPOSITION-GUIDE §7).
	 *   Annotations and lastMutations are collected automatically from the
	 *   live graph.
	 */
	explain(
		from: string,
		to: string,
		opts?: { maxDepth?: number; findCycle?: boolean },
	): CausalChain {
		// `detail: "full"` includes `value`, `status`, `lastMutation`, `v`, etc.
		// — everything `explainPath` enriches each step with.
		const described = this.describe({ detail: "full" });
		const annotations = new Map<string, string>(this._annotations);
		const lastMutations = new Map<string, Readonly<{ actor: Actor; timestamp_ns: number }>>();
		for (const [path, n] of Object.entries(described.nodes)) {
			if (n.lastMutation != null) lastMutations.set(path, n.lastMutation);
		}
		return explainPath(described, from, to, {
			...(opts?.maxDepth != null ? { maxDepth: opts.maxDepth } : {}),
			...(opts?.findCycle === true ? { findCycle: true as const } : {}),
			annotations,
			lastMutations,
		});
	}

	/**
	 * @internal Collect all qualified paths in this graph tree matching a
	 * glob pattern. Used by scoped autoCheckpoint subscription.
	 */
	private _pathsMatching(glob: string): string[] {
		const re = globToRegex(glob);
		const targets: [string, Node][] = [];
		this._collectObserveTargets("", targets);
		return targets.map(([p]) => p).filter((p) => re.test(p));
	}

	private _collectObserveTargets(prefix: string, out: [string, Node][]): void {
		for (const m of [...this._mounts.keys()].sort()) {
			const p2 = prefix === "" ? m : `${prefix}${PATH_SEP}${m}`;
			this._mounts.get(m)!._collectObserveTargets(p2, out);
		}
		for (const loc of [...this._nodes.keys()].sort()) {
			const n = this._nodes.get(loc)!;
			const p = prefix === "" ? loc : `${prefix}${PATH_SEP}${loc}`;
			out.push([p, n]);
			this._appendMetaObserveTargets(p, n, out);
		}
	}

	private _appendMetaObserveTargets(basePath: string, n: Node, out: [string, Node][]): void {
		for (const mk of Object.keys(n.meta).sort()) {
			const m = n.meta[mk];
			const mp = `${basePath}${PATH_SEP}${GRAPH_META_SEGMENT}${PATH_SEP}${mk}`;
			out.push([mp, m]);
			this._appendMetaObserveTargets(mp, m, out);
		}
	}

	/**
	 * Live message stream from one node (or meta path), or from the whole graph (§3.6).
	 *
	 * Two modes dispatched on first argument:
	 * - `observe(path, options?)` — one node. Returns {@link GraphObserveOne}
	 *   (raw stream), or {@link ObserveResult} when `options` requests structured
	 *   accumulation (`structured`, `timeline`, `causal`, `derived`, `format`,
	 *   `detail: "minimal"|"full"`).
	 * - `observe(options?)` — all nodes. Returns {@link GraphObserveAll} (raw),
	 *   or {@link ObserveResult} under the same structured trigger conditions.
	 *
	 * Structured mode subscribes in sorted path order (code-point). Inspector
	 * extras (`causal`/`derived`) require `graph.config.inspectorEnabled`;
	 * when disabled, those fields silently drop and the rest still works.
	 *
	 * `ObserveResult` is also an `AsyncIterable<ObserveEvent>` — use
	 * `for await (const ev of result)` for pull-based consumption.
	 */
	observe(path: string, options?: ObserveOptions & StructuredTriggers): ObserveResult;
	observe(path: string, options?: ObserveOptions): GraphObserveOne;
	observe(options: ObserveOptions & StructuredTriggers): ObserveResult;
	observe(options?: ObserveOptions): GraphObserveAll;
	observe(
		pathOrOpts?: string | ObserveOptions,
		options?: ObserveOptions,
	): GraphObserveOne | GraphObserveAll | ObserveResult {
		const isPath = typeof pathOrOpts === "string";
		const rawOpts = isPath ? options : (pathOrOpts as ObserveOptions | undefined);
		const resolved = resolveObserveDetail(rawOpts);
		const wantsStructured =
			resolved.structured === true ||
			resolved.timeline === true ||
			resolved.causal === true ||
			resolved.derived === true ||
			resolved.detail === "minimal" ||
			resolved.detail === "full" ||
			resolved.format != null;
		const actor = resolved.actor;

		if (isPath) {
			const path = pathOrOpts as string;
			const target = this.resolve(path);
			if (actor != null && !target.allowsObserve(actor)) {
				throw new GuardDenied({ actor, action: "observe", nodeName: path });
			}
			if (wantsStructured) return this._buildStructuredObserver([[path, target]], resolved, "one");
			return {
				subscribe(sink: NodeSink) {
					return target.subscribe(sink);
				},
				up(messages: Messages) {
					try {
						target.up?.(messages);
					} catch (err) {
						if (err instanceof GuardDenied) return;
						throw err;
					}
				},
			};
		}

		const collected: [string, Node][] = [];
		this._collectObserveTargets("", collected);
		collected.sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
		const picked =
			actor == null ? collected : collected.filter(([, nd]) => nd.allowsObserve(actor));
		if (wantsStructured) return this._buildStructuredObserver(picked, resolved, "all");
		return {
			subscribe: (sink: (nodePath: string, messages: Messages) => void) => {
				const unsubs = picked.map(([p, nd]) =>
					nd.subscribe((msgs) => {
						sink(p, msgs);
					}),
				);
				return () => {
					for (const u of unsubs) u();
				};
			},
			up: (upPath: string, messages: Messages) => {
				try {
					const nd = this.resolve(upPath);
					nd.up?.(messages);
				} catch (err) {
					if (err instanceof GuardDenied) return;
					throw err;
				}
			},
		};
	}

	/** Dispatch helper — builds a unified observer + its expand closure. */
	private _buildStructuredObserver<T>(
		targets: ReadonlyArray<[string, Node]>,
		options: ObserveOptions,
		mode: "one" | "all",
	): ObserveResult<T> {
		const firstPath = mode === "one" ? targets[0]?.[0] : undefined;
		const expand = (merged: ObserveOptions): ObserveResult<T> => {
			if (mode === "one" && firstPath != null) {
				const target = this.resolve(firstPath);
				return this._buildStructuredObserver([[firstPath, target]], merged, "one");
			}
			const collected: [string, Node][] = [];
			this._collectObserveTargets("", collected);
			collected.sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
			const actor = merged.actor;
			const picked =
				actor == null ? collected : collected.filter(([, nd]) => nd.allowsObserve(actor));
			return this._buildStructuredObserver(picked, merged, "all");
		};
		return this._createObserveResult<T>(targets, options, expand);
	}

	/**
	 * Unified observer builder — replaces the four ex-creators
	 * (`_createObserveResult` / `...ForAll` / `_createFallback…`). Accepts a
	 * list of `[path, node]` targets (single-element for one-node observe,
	 * N-element for all-nodes). Inspector hooks attach per-target when
	 * `causal`/`derived` requested AND `config.inspectorEnabled`; otherwise
	 * those fields gracefully drop.
	 *
	 * Events flow through a `recordEvent()` helper so the format logger,
	 * ring-buffer, and async-iterable hooks all share one push path.
	 */
	private _createObserveResult<T>(
		targets: ReadonlyArray<[string, Node]>,
		options: ObserveOptions,
		expand: (merged: ObserveOptions) => ObserveResult<T>,
	): ObserveResult<T> {
		const timeline = options.timeline === true;
		const causal = options.causal === true;
		const derived = options.derived === true;
		const minimal = options.detail === "minimal";
		const inspectorOn = this.config.inspectorEnabled;
		const wantInspector = (causal || derived) && inspectorOn;

		// Event buffer: unbounded array, or RingBuffer when maxEvents capped.
		const maxEvents = options.maxEvents;
		const ring =
			maxEvents != null && maxEvents > 0 ? new RingBuffer<ObserveEvent>(maxEvents) : null;
		const events: ObserveEvent[] = [];

		// Listener set — format logger, async iterable, and user `onEvent` hooks.
		const listeners = new Set<(event: ObserveEvent) => void>();

		const values: Record<string, T> = {};
		const nodeErrored = new Set<string>();
		let dirtyCount = 0;
		let resolvedCount = 0;
		let invalidateCount = 0;
		let pauseCount = 0;
		let resumeCount = 0;
		let teardownCount = 0;
		let anyCompletedCleanly = false;
		let anyErrored = false;
		let batchSeq = 0;

		// Per-target causal context (keyed by target index).
		const lastTriggerDepIndex = new Map<Node, number>();
		const lastRunDepValues = new Map<Node, readonly unknown[]>();
		const lastRunDepBatches = new Map<Node, ReadonlyArray<ReadonlyArray<unknown> | undefined>>();

		const recordEvent = (event: ObserveEvent): void => {
			if (ring) ring.push(event);
			else events.push(event);
			for (const listener of listeners) listener(event);
		};

		const baseMeta = (): Partial<ObserveEventBase> =>
			timeline ? { timestamp_ns: monotonicNs(), in_batch: isBatching(), batch_id: batchSeq } : {};

		const attachInspector = (target: Node, path: string): (() => void) | undefined => {
			if (!wantInspector || !(target instanceof NodeImpl)) return undefined;
			return target._setInspectorHook((ev) => {
				if (ev.kind === "dep_message") {
					lastTriggerDepIndex.set(target, ev.depIndex);
				} else if (ev.kind === "run") {
					const effective = ev.batchData.map((b, i) =>
						b != null && b.length > 0 ? b.at(-1) : ev.prevData[i],
					);
					lastRunDepValues.set(target, effective);
					// Snapshot the full per-dep batches so multi-value waves stay
					// visible to observers. `ev.batchData` references run-local
					// arrays, so clone the outer array (inner arrays are
					// effectively immutable from the observer's POV).
					const batches: ReadonlyArray<ReadonlyArray<unknown> | undefined> = ev.batchData.map(
						(b) => (b != null ? [...b] : undefined),
					);
					lastRunDepBatches.set(target, batches);
					if (derived) {
						recordEvent({
							type: "derived",
							path,
							dep_values: effective,
							dep_batches: batches,
							...baseMeta(),
						} as ObserveEvent);
					}
				}
			});
		};

		const buildCausal = (target: Node): ObserveCausalContext => {
			const idx = lastTriggerDepIndex.get(target);
			const depValues = lastRunDepValues.get(target);
			if (!causal || depValues == null) return {};
			const triggerDep =
				idx != null && idx >= 0 && target instanceof NodeImpl ? target._deps[idx] : undefined;
			const triggerNode = triggerDep?.node;
			const tv = triggerNode?.v;
			const depBatches = lastRunDepBatches.get(target);
			return {
				trigger_dep_index: idx,
				trigger_dep_name: triggerNode?.name,
				...(tv != null ? { trigger_version: { id: tv.id, version: tv.version } } : {}),
				dep_values: [...depValues],
				...(depBatches != null ? { dep_batches: depBatches } : {}),
			};
		};

		const inspectorDetaches: Array<() => void> = [];
		const unsubs: Array<() => void> = [];
		for (const [path, target] of targets) {
			const detach = attachInspector(target, path);
			if (detach) inspectorDetaches.push(detach);
			unsubs.push(
				target.subscribe((msgs) => {
					batchSeq++;
					for (const m of msgs) {
						const t = m[0];
						const base = baseMeta();
						if (t === DATA) {
							values[path] = m[1] as T;
							recordEvent({
								type: "data",
								path,
								data: m[1],
								...base,
								...buildCausal(target),
							} as ObserveEvent);
						} else if (minimal) {
							if (t === DIRTY) dirtyCount++;
							else if (t === RESOLVED) resolvedCount++;
							else if (t === INVALIDATE) invalidateCount++;
							else if (t === PAUSE) pauseCount++;
							else if (t === RESUME) resumeCount++;
							else if (t === TEARDOWN) teardownCount++;
							else if (t === COMPLETE && !nodeErrored.has(path)) anyCompletedCleanly = true;
							else if (t === ERROR) {
								anyErrored = true;
								nodeErrored.add(path);
							}
						} else if (t === DIRTY) {
							dirtyCount++;
							recordEvent({ type: "dirty", path, ...base } as ObserveEvent);
						} else if (t === RESOLVED) {
							resolvedCount++;
							recordEvent({
								type: "resolved",
								path,
								...base,
								...buildCausal(target),
							} as ObserveEvent);
						} else if (t === INVALIDATE) {
							invalidateCount++;
							recordEvent({ type: "invalidate", path, ...base } as ObserveEvent);
						} else if (t === PAUSE) {
							pauseCount++;
							recordEvent({ type: "pause", path, lockId: m[1], ...base } as ObserveEvent);
						} else if (t === RESUME) {
							resumeCount++;
							recordEvent({ type: "resume", path, lockId: m[1], ...base } as ObserveEvent);
						} else if (t === COMPLETE) {
							if (!nodeErrored.has(path)) anyCompletedCleanly = true;
							recordEvent({ type: "complete", path, ...base } as ObserveEvent);
						} else if (t === ERROR) {
							anyErrored = true;
							nodeErrored.add(path);
							recordEvent({
								type: "error",
								path,
								data: m[1],
								...base,
							} as ObserveEvent);
						} else if (t === TEARDOWN) {
							teardownCount++;
							recordEvent({ type: "teardown", path, ...base } as ObserveEvent);
						}
					}
				}),
			);
		}

		let disposed = false;
		const dispose = (): void => {
			if (disposed) return;
			disposed = true;
			for (const u of unsubs) u();
			for (const d of inspectorDetaches) d();
			for (const resolve of asyncResolvers) resolve({ value: undefined, done: true });
			asyncResolvers.length = 0;
		};

		// AsyncIterator plumbing: queue events until a pull arrives, or wake
		// a pending pull when a new event lands.
		const asyncQueue: ObserveEvent[] = [];
		const asyncResolvers: Array<(r: IteratorResult<ObserveEvent>) => void> = [];
		listeners.add((ev) => {
			const resolve = asyncResolvers.shift();
			if (resolve) resolve({ value: ev, done: false });
			else asyncQueue.push(ev);
		});

		const result: ObserveResult<T> = {
			get values() {
				return values;
			},
			get dirtyCount() {
				return dirtyCount;
			},
			get resolvedCount() {
				return resolvedCount;
			},
			get invalidateCount() {
				return invalidateCount;
			},
			get pauseCount() {
				return pauseCount;
			},
			get resumeCount() {
				return resumeCount;
			},
			get teardownCount() {
				return teardownCount;
			},
			get events() {
				return ring ? ring.toArray() : [...events];
			},
			get anyCompletedCleanly() {
				return anyCompletedCleanly;
			},
			get anyErrored() {
				return anyErrored;
			},
			get completedWithoutErrors() {
				return anyCompletedCleanly && !anyErrored;
			},
			onEvent(listener) {
				listeners.add(listener);
				return () => listeners.delete(listener);
			},
			dispose,
			expand(extra) {
				dispose();
				const merged: ObserveOptions = { ...options };
				if (typeof extra === "string") {
					merged.detail = extra;
				} else {
					Object.assign(merged, extra);
				}
				return expand(resolveObserveDetail(merged));
			},
			[Symbol.asyncIterator](): AsyncIterator<ObserveEvent> {
				return {
					next(): Promise<IteratorResult<ObserveEvent>> {
						if (asyncQueue.length > 0) {
							return Promise.resolve({ value: asyncQueue.shift()!, done: false });
						}
						if (disposed) return Promise.resolve({ value: undefined, done: true });
						return new Promise((resolve) => asyncResolvers.push(resolve));
					},
					return(): Promise<IteratorResult<ObserveEvent>> {
						dispose();
						return Promise.resolve({ value: undefined, done: true });
					},
				};
			},
		};

		// Format logger: subscribes to event stream, renders via theme/format.
		if (options.format != null) this._attachFormatLogger(result, options);

		return result;
	}

	/**
	 * Attach format-rendering logger to an ObserveResult by subscribing to its
	 * event stream (no monkey-patching). Renders each event per `format` and
	 * `theme`, filtered by `includeTypes` / `excludeTypes`.
	 */
	private _attachFormatLogger(result: ObserveResult, options: ObserveOptions): void {
		const format = options.format;
		if (format == null) return;
		const logger = options.logger ?? ((line: string) => console.log(line));
		// Compile include/exclude predicates once.
		const include = options.includeTypes ? new Set(options.includeTypes) : null;
		const exclude = options.excludeTypes ? new Set(options.excludeTypes) : null;
		const shouldLog =
			include == null && exclude == null
				? () => true
				: (type: ObserveEvent["type"]): boolean =>
						(include == null || include.has(type)) && (exclude == null || !exclude.has(type));
		const theme = resolveObserveTheme(options.theme);

		const renderEvent = (event: ObserveEvent): string => {
			if (format === "json") {
				try {
					return JSON.stringify(event);
				} catch {
					return JSON.stringify({
						type: event.type,
						path: event.path,
						data: "[unserializable]",
					});
				}
			}
			const color = theme[event.type] ?? "";
			const pathPart = event.path ? `${theme.path}${event.path}${theme.reset} ` : "";
			const isDataBearing = event.type === "data" || event.type === "error";
			const isLockBearing = event.type === "pause" || event.type === "resume";
			const dataPart = isDataBearing
				? ` ${describeData((event as { data: unknown }).data)}`
				: isLockBearing
					? ` ${describeData((event as { lockId: unknown }).lockId)}`
					: "";
			const causal =
				event.type === "data" || event.type === "resolved" || event.type === "derived"
					? (event as ObserveCausalContext)
					: undefined;
			const triggerPart =
				causal?.trigger_dep_name != null
					? ` <- ${causal.trigger_dep_name}`
					: causal?.trigger_dep_index != null
						? ` <- #${causal.trigger_dep_index}`
						: "";
			const batchPart = event.in_batch ? " [batch]" : "";
			return `${pathPart}${color}${event.type.toUpperCase()}${theme.reset}${dataPart}${triggerPart}${batchPart}`;
		};

		result.onEvent((event) => {
			if (shouldLog(event.type)) logger(renderEvent(event), event);
		});
	}

	// `dumpGraph` is folded into `describe({format: "pretty" | "json"})` (Unit 12).
	// `toMermaid` / `toD2` are folded into `describe({format: "mermaid" | "d2"})` (Unit 20).

	// ——————————————————————————————————————————————————————————————
	//  Lifecycle & persistence (§3.7–§3.8)
	// ——————————————————————————————————————————————————————————————

	/**
	 * Register a cleanup function to be called on {@link Graph.destroy}.
	 *
	 * Factories use this to attach teardown logic for internal nodes, keepalive
	 * subscriptions, or other resources that are not registered on the graph and
	 * would otherwise leak on repeated create/destroy cycles.
	 *
	 * Returns a removal function — call it to unregister the disposer early.
	 */
	addDisposer(fn: () => void): () => void {
		this._disposers.add(fn);
		return () => {
			this._disposers.delete(fn);
		};
	}

	/**
	 * Drains disposers (registered via {@link addDisposer}), then sends `[[TEARDOWN]]` to all
	 * nodes and clears registries on this graph and every mounted subgraph (§3.7).
	 * The instance is left empty and may be reused with {@link Graph.add}.
	 */
	destroy(): void {
		// Drain disposers (keepalive unsubs etc.) BEFORE TEARDOWN so that
		// internal effect nodes are disconnected before the cascade fires.
		// Drain iteratively so disposers registered mid-drain also run; cap
		// iterations to guard against a disposer that re-registers itself.
		drainDisposers(this._disposers, this.name);
		// TEARDOWN is tier 5 — below `attachStorage`'s `tier < 5` gate, so no
		// final checkpoint fires; storage disposers unsubscribe after TEARDOWN
		// has propagated through the subscription pipeline.
		this.signal([[TEARDOWN]] satisfies Messages, { internal: true });
		drainDisposers(this._storageDisposers, this.name);
		for (const child of [...this._mounts.values()]) {
			child._parent = undefined;
			child._destroyClearOnly();
		}
		this._mounts.clear();
		this._nodes.clear();
		this._parent = undefined;
	}

	/** Clear structure after parent already signaled TEARDOWN through this subtree. */
	private _destroyClearOnly(): void {
		for (const child of [...this._mounts.values()]) {
			child._parent = undefined;
			child._destroyClearOnly();
		}
		this._mounts.clear();
		this._nodes.clear();
		this._parent = undefined;
	}

	/**
	 * Serializes structure and current values to JSON-shaped data (§3.8). Same
	 * information as {@link Graph.describe} plus a `version` field for format
	 * evolution.
	 *
	 * The overload path supports three outputs:
	 * - no arg → `GraphPersistSnapshot` (plain JS object).
	 * - `{format: "json-string"}` → deterministic JSON `string`
	 *   (key-sorted; safe for hashing or file write).
	 * - `{format: "bytes", codec: name}` → `Uint8Array` wrapped in the v1
	 *   envelope from {@link encodeEnvelope}. The codec must be registered
	 *   on this graph's {@link GraphReFlyConfig} via `config.registerCodec`.
	 *   Paired with {@link Graph.decode} for auto-dispatch on the read side.
	 */
	snapshot(): GraphPersistSnapshot;
	snapshot(opts: { format: "json-string" }): string;
	snapshot(opts: { format: "bytes"; codec: string }): Uint8Array;
	snapshot(opts?: {
		format?: "json-string" | "bytes";
		codec?: string;
	}): GraphPersistSnapshot | string | Uint8Array {
		const { expand: _, ...d } = this.describe({ detail: "full" });
		// Explicit key sorting for deterministic output — don't rely on
		// describe() iteration order (audit batch-3, §3.8).
		// Strip non-restorable fields (runtime attribution) so snapshot → restore → snapshot
		// is idempotent. Use describe({ detail: "full" }) for audit snapshots instead.
		const sortedNodes: Record<string, DescribeNodeOutput> = {};
		for (const key of Object.keys(d.nodes).sort()) {
			const { lastMutation: _lm, guard: _g, ...node } = d.nodes[key]!;
			sortedNodes[key] = node;
		}
		const sortedSubgraphs = [...d.subgraphs].sort();
		const snap: GraphPersistSnapshot = {
			...d,
			version: 1,
			nodes: sortedNodes,
			subgraphs: sortedSubgraphs,
		};
		if (opts?.format == null) return snap;
		if (opts.format === "json-string") return JSON.stringify(snap);
		if (opts.format === "bytes") {
			if (opts.codec == null) {
				throw new Error("snapshot({format: 'bytes'}) requires a `codec` name");
			}
			const codec = this.config.lookupCodec<GraphCodec>(opts.codec);
			if (codec == null) {
				throw new Error(
					`snapshot: codec "${opts.codec}" is not registered on this graph's config. ` +
						`Call config.registerCodec(...) before creating nodes.`,
				);
			}
			return encodeEnvelope(codec, codec.encode(snap));
		}
		throw new Error(`snapshot: unknown format "${String(opts.format)}"`);
	}

	/**
	 * Auto-dispatch a byte buffer produced by {@link Graph.snapshot} with
	 * `{format: "bytes", codec: name}`. Reads the v1 envelope, resolves the
	 * named codec on `config` (defaults to `defaultConfig`), and returns the
	 * decoded snapshot. Combine with {@link Graph.fromSnapshot} to rehydrate
	 * a full graph topology from bytes.
	 *
	 * @throws If the envelope is malformed or the named codec isn't
	 *   registered on the target config.
	 */
	static decode(bytes: Uint8Array, opts?: { config?: GraphReFlyConfig }): GraphPersistSnapshot {
		const cfg = opts?.config ?? defaultConfig;
		const { codec, codecVersion, payload } = decodeEnvelope(bytes, cfg);
		return codec.decode(payload, codecVersion);
	}

	/**
	 * Apply persisted values onto an existing graph whose topology matches the snapshot
	 * (§3.8). Only {@link DescribeNodeOutput.type} `state` entries with a `value` field
	 * are written by default; `derived` / `operator` / `effect` are always skipped so
	 * deps drive recomputation. `producer` entries are skipped unless `includeProducers`
	 * is set (producers recompute on activation, so restoring is usually a no-op
	 * overwritten on the next wave — opt in for audit / forensic round-trip use cases).
	 * Unknown paths are ignored.
	 *
	 * @param data - Snapshot envelope with matching `name` and node slices.
	 * @throws If `data.name` does not equal {@link Graph.name}.
	 */
	restore(
		data: GraphPersistSnapshot,
		options?: {
			only?: string | readonly string[];
			/**
			 * Fires per failing write. Default behavior (omitted) is silent —
			 * missing paths and guard denials are swallowed to match the
			 * historical semantics. Provide a callback to surface failures
			 * without aborting the remaining restores.
			 */
			onError?: (path: string, err: unknown) => void;
			/**
			 * Restore `producer` node values alongside `state`. Default `false`:
			 * producers are reactive sources whose value recomputes on
			 * activation, so restoring from a snapshot is usually a no-op
			 * overwritten on the next wave. Audit / forensic round-trip use
			 * cases that need the stored value to survive restoration can
			 * opt in. Does not change `derived` / `effect` handling — those
			 * are always skipped.
			 */
			includeProducers?: boolean;
		},
	): void {
		parseSnapshotEnvelope(data);
		if (data.name !== this.name) {
			throw new Error(
				`Graph "${this.name}": restore snapshot name "${data.name}" does not match this graph`,
			);
		}
		const onlyPatterns =
			options?.only == null
				? null
				: (Array.isArray(options.only) ? options.only : [options.only]).map((p) => globToRegex(p));
		const includeProducers = options?.includeProducers === true;
		for (const path of Object.keys(data.nodes).sort()) {
			if (onlyPatterns !== null && !onlyPatterns.some((re) => re.test(path))) continue;
			const slice = data.nodes[path];
			if (slice === undefined) continue;
			if (!("value" in slice) || slice.value === undefined) {
				// Value absent (valid slice with no snapshotted value) or
				// value === undefined (malformed — undefined is the global
				// SENTINEL per spec §2.5, not valid DATA). Surface the
				// malformed case so torn snapshots don't round-trip silently.
				if ("value" in slice && slice.value === undefined) {
					options?.onError?.(
						path,
						new Error(
							`restore: slice.value is undefined for "${path}" (undefined is the global SENTINEL; not valid DATA)`,
						),
					);
				}
				continue;
			}
			if (slice.type === "derived" || slice.type === "effect") {
				continue;
			}
			if (slice.type === "producer" && !includeProducers) {
				// Reactive producers recompute on activation — restoring would
				// be overwritten on the first wave. Opt in via
				// `{includeProducers: true}` for audit use cases.
				continue;
			}
			// V0 shortcut: if the snapshot slice and the live node both carry
			// matching versioning info (`v.id` + `v.version`), skip the
			// `set()` — the state is already what the snapshot represents.
			// Avoids redundant DATA waves on idempotent restores.
			if (slice.v != null) {
				const live = this.tryResolve(path);
				const lv = live?.v;
				if (lv != null && lv.id === slice.v.id && lv.version === slice.v.version) {
					continue;
				}
			}
			try {
				this.set(path, slice.value);
			} catch (err) {
				options?.onError?.(path, err);
			}
		}
	}

	/**
	 * Creates a graph named from the snapshot, optionally runs `build` to register nodes
	 * and mounts, then {@link Graph.restore} values (§3.8).
	 *
	 * @param data - Snapshot envelope (`version` checked).
	 * @param opts - Either a legacy `build(g)` callback, or an options object:
	 *   - `build?` — topology constructor; skips auto-hydration when present.
	 *   - `factories?` — map from glob pattern to {@link GraphNodeFactory},
	 *     used by auto-hydration to reconstruct non-state nodes. Per-call (no
	 *     process-global registry). First matching pattern wins.
	 * @returns Hydrated `Graph` instance.
	 */
	static fromSnapshot(
		data: GraphPersistSnapshot,
		opts?:
			| ((g: Graph) => void)
			| { build?: (g: Graph) => void; factories?: Record<string, GraphNodeFactory> },
	): Graph {
		parseSnapshotEnvelope(data);
		const build = typeof opts === "function" ? opts : opts?.build;
		const factoryMap = typeof opts === "function" ? undefined : opts?.factories;
		const g = new Graph(data.name);
		if (build) {
			build(g);
			g.restore(data);
			return g;
		}
		// Auto-create mount hierarchy from subgraphs.
		for (const mount of [...data.subgraphs].sort((a, b) => {
			const da = a.split(PATH_SEP).length;
			const db = b.split(PATH_SEP).length;
			if (da !== db) return da - db;
			if (a < b) return -1;
			if (a > b) return 1;
			return 0;
		})) {
			const parts = mount.split(PATH_SEP);
			let target: Graph = g;
			for (const seg of parts) {
				if (!target._mounts.has(seg)) {
					target.mount(seg, new Graph(seg));
				}
				target = target._mounts.get(seg)!;
			}
		}

		// Compile factory glob patterns once. First match in insertion order wins.
		const factories = factoryMap
			? Object.entries(factoryMap).map(([pattern, factory]) => ({
					re: globToRegex(pattern),
					factory,
				}))
			: [];
		const factoryForPath = (path: string): GraphNodeFactory | undefined => {
			for (const entry of factories) {
				if (entry.re.test(path)) return entry.factory;
			}
			return undefined;
		};

		// Resolve the owning graph + local name for a qualified snapshot path.
		const ownerForPath = (path: string): [Graph, string] => {
			const segments = path.split(PATH_SEP);
			const local = segments.pop();
			if (local == null || local.length === 0) {
				throw new Error(`invalid snapshot path "${path}"`);
			}
			let owner: Graph = g;
			for (const seg of segments) {
				const next = owner._mounts.get(seg);
				if (!next) throw new Error(`unknown mount "${seg}" in path "${path}"`);
				owner = next;
			}
			return [owner, local];
		};

		const primaryEntries = Object.entries(data.nodes)
			.filter(([path]) => !path.includes(`${PATH_SEP}${GRAPH_META_SEGMENT}${PATH_SEP}`))
			.sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
		const pending = new Map(primaryEntries);
		const created = new Map<string, Node>();

		let progressed = true;
		while (pending.size > 0 && progressed) {
			progressed = false;
			for (const [path, slice] of [...pending.entries()]) {
				const deps = slice?.deps ?? [];
				if (!deps.every((dep) => created.has(dep))) continue;
				const [owner, localName] = ownerForPath(path);
				const meta: Record<string, unknown> = { ...(slice?.meta ?? {}) };
				const factory = factoryForPath(path);
				let node: Node;
				if (slice?.type === "state") {
					node = stateNode(slice.value, { meta });
				} else {
					if (factory == null) continue;
					node = factory(localName, {
						path,
						type: slice.type,
						value: slice.value,
						meta,
						deps,
						resolvedDeps: deps.map((dep) => created.get(dep)!),
					});
				}
				owner.add(localName, node);
				created.set(path, node);
				pending.delete(path);
				progressed = true;
			}
		}
		if (pending.size > 0) {
			const unresolved = [...pending.keys()].sort().join(", ");
			throw new Error(
				`Graph.fromSnapshot could not reconstruct nodes without build callback: ${unresolved}. ` +
					`Pass matching factories via fromSnapshot(data, { factories: { pattern: factoryFn } }).`,
			);
		}
		// Edges are derived from node `_deps` reconstructed during node
		// creation above — no explicit edge replay needed (Unit 7).
		g.restore(data);
		return g;
	}

	/**
	 * ECMAScript `JSON.stringify` hook — returns the same object as
	 * {@link Graph.snapshot}. Makes `JSON.stringify(graph)` "just work"
	 * without double-encoding.
	 */
	toJSON(): GraphPersistSnapshot {
		return this.snapshot();
	}

	/**
	 * Unified persistence surface (§3.8). Cascades snapshot records through
	 * one or more {@link StorageTier}s, each with its own `debounceMs` /
	 * `compactEvery` cadence and independent diff baseline.
	 *
	 * Subscription gates on {@link messageTier} ≥ 3 (DATA/RESOLVED/terminal),
	 * never on tier-0/1/2 control waves (START/DIRTY/INVALIDATE/PAUSE/RESUME)
	 * or tier-5 TEARDOWN (graceful shutdown is the caller's responsibility).
	 *
	 * Per-tier cadence lets the hot tier stay sync while cold tiers absorb
	 * async writes without blocking the hot path. Each tier holds its own
	 * `{lastSnapshot, lastVersionFingerprint}` so cold-tier diff baselines
	 * aren't polluted by hot-tier flushes. Tiers with `debounceMs === 0`
	 * share a single snapshot computation per observe event; debounced tiers
	 * compute their own snapshot when their timer fires.
	 */
	attachStorage(
		tiers: readonly StorageTier[],
		options: GraphAttachStorageOptions = {},
	): StorageHandle {
		type TierState = {
			tier: StorageTier;
			debounceMs: number;
			compactEvery: number;
			timer: ResettableTimer | undefined;
			seq: number;
			lastSnapshot: GraphPersistSnapshot | undefined;
			lastFingerprint: string;
			disposed: boolean;
			// Chain of pending async saves for this tier. Each flush awaits the
			// previous one so baseline advances only after persistence confirms;
			// on rejection the chain resets (next flush starts from the last
			// successfully-persisted baseline). Sync tiers never populate this.
			savePending: Promise<void> | undefined;
		};
		const states: TierState[] = tiers.map((tier) => ({
			tier,
			debounceMs: Math.max(0, tier.debounceMs ?? 0),
			compactEvery: Math.max(1, tier.compactEvery ?? 10),
			timer: undefined,
			seq: 0,
			lastSnapshot: undefined,
			lastFingerprint: "",
			disposed: false,
			savePending: undefined,
		}));

		if (options.autoRestore === true) {
			// Fire-and-forget cascade restore; errors surface via onError with
			// the specific tier that failed.
			void this._cascadeRestore(tiers, options.onError);
		}

		const runFlush = (s: TierState, snapshot: GraphPersistSnapshot): void => {
			if (s.disposed) return;
			const fingerprint = computeVersionFingerprint(snapshot.nodes);
			if (s.lastSnapshot != null && fingerprint !== "" && fingerprint === s.lastFingerprint) {
				return;
			}
			const nextSeq = s.seq + 1;
			// Persisted records carry wall-clock attribution (CLAUDE.md time-util
			// rule). Internal event-order timestamps use monotonicNs — this is the
			// output-to-durable-store boundary, so wall clock is correct and
			// cross-source comparable with surface.saveSnapshot records.
			const timestamp_ns = wallClockNs();
			const isFirst = s.lastSnapshot == null;
			const shouldCompact = isFirst || nextSeq % s.compactEvery === 0;
			const record: GraphCheckpointRecord = shouldCompact
				? {
						mode: "full",
						snapshot,
						seq: nextSeq,
						timestamp_ns,
						format_version: SNAPSHOT_VERSION,
					}
				: {
						mode: "diff",
						diff: diffForWAL(s.lastSnapshot!, snapshot),
						seq: nextSeq,
						timestamp_ns,
						format_version: SNAPSHOT_VERSION,
					};
			if (s.tier.filter && !s.tier.filter(this.name, record)) {
				// Filter rejected — don't advance seq or baseline.
				return;
			}
			let result: void | Promise<void>;
			try {
				result = s.tier.save(this.name, record);
			} catch (error) {
				// Synchronous throw — baseline untouched; surface and bail.
				options.onError?.(error, s.tier);
				return;
			}
			if (result && typeof (result as Promise<void>).then === "function") {
				// Async tier: defer baseline + seq advance until the promise
				// settles. Chain saves per-tier so they land in order without
				// overlapping baselines. On rejection, baseline is left intact
				// so the next flush diffs against the last successfully
				// persisted snapshot.
				const prev = s.savePending ?? Promise.resolve();
				const chained = prev.then(
					() => result as Promise<void>,
					// Previous rejection already surfaced; don't block this save.
					() => result as Promise<void>,
				);
				const final = chained.then(
					() => {
						if (s.disposed) return;
						s.seq = nextSeq;
						s.lastSnapshot = snapshot;
						s.lastFingerprint = fingerprint;
					},
					(err) => {
						options.onError?.(err, s.tier);
					},
				);
				s.savePending = final.finally(() => {
					if (s.savePending === final) s.savePending = undefined;
				});
			} else {
				s.seq = nextSeq;
				s.lastSnapshot = snapshot;
				s.lastFingerprint = fingerprint;
			}
		};

		const flushTier = (s: TierState, snapshot: GraphPersistSnapshot): void => {
			try {
				runFlush(s, snapshot);
			} catch (error) {
				options.onError?.(error, s.tier);
			}
		};

		const onEvent = (path: string, messages: Messages): void => {
			const triggeredByTier = messages.some((m) => {
				const tier = this.config.messageTier(m[0]);
				return tier >= 3 && tier < 5;
			});
			if (!triggeredByTier) return;
			if (options.filter) {
				const nd = this.tryResolve(path);
				if (nd == null) return;
				const described = describeNode(nd, resolveDescribeFields("standard"));
				if (!options.filter(path, described)) return;
			}
			// Shared snapshot for all sync (debounceMs=0) tiers firing on this event.
			let sharedSnapshot: GraphPersistSnapshot | undefined;
			const getSnapshot = (): GraphPersistSnapshot => {
				if (sharedSnapshot == null) sharedSnapshot = this.snapshot();
				return sharedSnapshot;
			};
			for (const s of states) {
				if (s.disposed) continue;
				if (s.debounceMs === 0) {
					flushTier(s, getSnapshot());
				} else {
					if (s.timer == null) s.timer = new ResettableTimer();
					s.timer.start(s.debounceMs, () => {
						if (s.disposed) return;
						flushTier(s, this.snapshot());
					});
				}
			}
		};

		let off: () => void;
		if (options.paths != null) {
			const paths =
				typeof options.paths === "string"
					? this._pathsMatching(options.paths)
					: (options.paths as readonly string[]);
			const unsubs = paths.map((p) => {
				const nd = this.tryResolve(p);
				if (nd == null) return () => {};
				return nd.subscribe((msgs) => onEvent(p, msgs));
			});
			off = () => {
				for (const u of unsubs) u();
			};
		} else {
			off = this.observe().subscribe((path, messages) => onEvent(path, messages));
		}

		const dispose = () => {
			off();
			for (const s of states) {
				s.disposed = true;
				s.timer?.cancel();
			}
			this._storageDisposers.delete(dispose);
		};
		this._storageDisposers.add(dispose);
		return { dispose };
	}

	/**
	 * Try tiers in order (hottest first); apply the first record that hits
	 * via {@link Graph.restore}. Returns `true` if any tier produced a
	 * restorable snapshot, `false` if all missed.
	 *
	 * Resilience: a tier that returns data which cannot be restored (load
	 * throws, shape unrecognized, or `restore()` itself throws) does not abort
	 * the cascade — the error is routed through `onError` (if supplied) and
	 * the next colder tier is tried. This mirrors how a multi-tier cache
	 * falls through on a corrupt hot entry.
	 *
	 * Note: `restore()` mutates state incrementally. If a restore throws
	 * partway through, the graph may hold a mixed state (some slices from
	 * the bad tier, some pre-existing). A subsequent successful tier's
	 * `restore()` overwrites the overlapping slices.
	 *
	 * Internal helper shared by {@link Graph.attachStorage}'s `autoRestore`
	 * option and the static {@link Graph.fromStorage} factory.
	 */
	private async _cascadeRestore(
		tiers: readonly StorageTier[],
		onError?: (err: unknown, tier: StorageTier) => void,
	): Promise<boolean> {
		for (const tier of tiers) {
			let raw: unknown;
			try {
				raw = await tier.load(this.name);
			} catch (err) {
				onError?.(err, tier);
				continue;
			}
			if (raw == null) continue;
			if (typeof raw !== "object" || Array.isArray(raw)) continue;
			const record = raw as Record<string, unknown>;
			try {
				// Accept both a `GraphCheckpointRecord` envelope
				// (`mode === "full"`) and a bare `GraphPersistSnapshot` (the
				// shape written by `saveGraphCheckpoint`). Bare snapshots
				// carry `version: 1`.
				if (record.mode === "full" && record.snapshot != null) {
					this.restore(record.snapshot as GraphPersistSnapshot);
					return true;
				}
				if (record.version === SNAPSHOT_VERSION && record.nodes != null) {
					this.restore(record as GraphPersistSnapshot);
					return true;
				}
			} catch (err) {
				onError?.(err, tier);
				// Fall through to the next tier.
			}
		}
		return false;
	}

	/**
	 * Construct a fresh {@link Graph} pre-hydrated from the first tier that
	 * hits. Delegates topology reconstruction to {@link Graph.fromSnapshot}
	 * on `"full"` records and direct {@link Graph.restore} on bare snapshots.
	 *
	 * Always asynchronous — awaits `tier.load()` for async tier support even
	 * when all tiers are sync. Callers that know they only pass sync tiers
	 * can safely `await` immediately.
	 *
	 * @throws If no tier holds a restorable record matching `name` *and* no
	 *   `factories` override is provided for dynamic nodes.
	 */
	static async fromStorage(
		name: string,
		tiers: readonly StorageTier[],
		opts?: GraphOptions & {
			factories?: Record<string, GraphNodeFactory>;
			/**
			 * Called when a tier throws during `load()` or when
			 * {@link Graph.fromSnapshot} rejects a tier's record. The cascade
			 * falls through to the next colder tier regardless.
			 */
			onError?: (err: unknown, tier: StorageTier) => void;
		},
	): Promise<Graph> {
		for (const tier of tiers) {
			let raw: unknown;
			try {
				raw = await tier.load(name);
			} catch (err) {
				opts?.onError?.(err, tier);
				continue;
			}
			if (raw == null) continue;
			if (typeof raw !== "object" || Array.isArray(raw)) continue;
			const record = raw as Record<string, unknown>;
			const snapshot: GraphPersistSnapshot | undefined =
				record.mode === "full" && record.snapshot != null
					? (record.snapshot as GraphPersistSnapshot)
					: record.version === SNAPSHOT_VERSION && record.nodes != null
						? (record as GraphPersistSnapshot)
						: undefined;
			if (snapshot == null) continue;
			try {
				return Graph.fromSnapshot(snapshot, opts);
			} catch (err) {
				opts?.onError?.(err, tier);
				// Fall through to colder tier.
			}
		}
		throw new Error(
			`Graph.fromStorage: no tier held a restorable record for "${name}" across ${tiers.length} tier(s)`,
		);
	}

	// ——————————————————————————————————————————————————————————————
	//  Inspector (roadmap 3.3) — reasoning trace, overhead gating
	// ——————————————————————————————————————————————————————————————

	// Inspector gating lives on `this.config.inspectorEnabled` (see
	// `core/config.ts`). Default: `true` outside `NODE_ENV === "production"`.

	private _annotations = new Map<string, string>();
	private readonly _traceRing: RingBuffer<TraceEntry>;

	/**
	 * Unified reasoning trace: write annotations or read the ring buffer.
	 *
	 * Write: `graph.trace("path", "reason")` — attaches a reasoning annotation
	 * to a node, capturing *why* an AI agent set a value. Unknown paths are
	 * silently dropped (matching `observe` resilience). No-op when
	 * `config.inspectorEnabled` is `false`.
	 *
	 * Read: `graph.trace()` — returns a chronological log of all annotations.
	 * Returns `[]` when `config.inspectorEnabled` is `false`.
	 */
	trace(path: string, reason: string, opts?: { actor?: Actor }): void;
	trace(): readonly TraceEntry[];
	trace(
		path?: string,
		reason?: string,
		opts?: { actor?: Actor },
	): undefined | readonly TraceEntry[] {
		if (path != null && reason != null) {
			if (!this.config.inspectorEnabled) return;
			// Silent-drop unknown paths — matches `observe` resilience. Callers
			// with robust path-hygiene needs can pre-check via `tryResolve`.
			if (this.tryResolve(path) == null) return;
			this._annotations.set(path, reason);
			const entry: TraceEntry = {
				path,
				reason,
				timestamp_ns: monotonicNs(),
				...(opts?.actor != null ? { actor: opts.actor } : {}),
			};
			this._traceRing.push(entry);
			return;
		}
		if (!this.config.inspectorEnabled) return [];
		return this._traceRing.toArray();
	}

	/**
	 * Latest reason annotation attached to `path` via {@link Graph.trace},
	 * or `undefined` if none. `describe()` surfaces this via the `reason`
	 * field on each node entry (when present).
	 */
	annotation(path: string): string | undefined {
		return this._annotations.get(path);
	}

	/**
	 * Clear all reasoning-trace state (both the per-path annotations map and
	 * the ring buffer). Useful for long-running processes that want periodic
	 * resets, or tests that need a clean slate.
	 */
	clearTrace(): void {
		this._annotations.clear();
		this._traceRing.clear();
	}

	/**
	 * Remove trace entries matching `predicate`. Returns the number of
	 * entries removed. Does not touch the per-path annotations map — call
	 * {@link Graph.clearTrace} for a full reset.
	 */
	pruneTrace(predicate: (entry: TraceEntry) => boolean): number {
		const kept = this._traceRing.toArray().filter((e) => !predicate(e));
		const removed = this._traceRing.size - kept.length;
		this._traceRing.clear();
		for (const e of kept) this._traceRing.push(e);
		return removed;
	}

	/**
	 * Computes structural + value diff between two {@link Graph.describe} snapshots.
	 *
	 * @param a - Earlier describe output.
	 * @param b - Later describe output.
	 * @returns Added/removed nodes, changed fields, and edge deltas.
	 */
	static diff(a: GraphDescribeOutput, b: GraphDescribeOutput): GraphDiffResult {
		const aKeys = new Set(Object.keys(a.nodes));
		const bKeys = new Set(Object.keys(b.nodes));

		const nodesAdded = [...bKeys].filter((k) => !aKeys.has(k)).sort();
		const nodesRemoved = [...aKeys].filter((k) => !bKeys.has(k)).sort();
		const nodesChanged: GraphDiffChange[] = [];
		const versionChanges: GraphVersionChange[] = [];

		for (const key of aKeys) {
			if (!bKeys.has(key)) continue;
			const na = a.nodes[key];
			const nb = b.nodes[key];
			const av = na.v;
			const bv = nb.v;
			// Surface version bumps (even if value is identical, the bump itself
			// is meaningful for audit / wire-efficient sync).
			if (av != null && bv != null && av.id === bv.id && av.version !== bv.version) {
				versionChanges.push({
					path: key,
					id: av.id,
					from: av.version,
					to: bv.version,
				});
			}
			const versionMatches =
				av != null && bv != null && av.id === bv.id && av.version === bv.version;
			// V0 fast path: when versions match, skip value / meta compare —
			// upstream is guaranteed unchanged by protocol. Only type/status
			// (cheap string compare) + sentinel flip are possible.
			for (const field of ["type", "status", "sentinel"] as const) {
				const va = (na as Record<string, unknown>)[field];
				const vb = (nb as Record<string, unknown>)[field];
				if (va !== vb) {
					nodesChanged.push({ path: key, field, from: va, to: vb });
				}
			}
			if (versionMatches) continue;
			// Full slow-path: deep-equal on value + meta.
			for (const field of ["value", "meta"] as const) {
				const va = (na as Record<string, unknown>)[field];
				const vb = (nb as Record<string, unknown>)[field];
				if (!deepEqual(va, vb)) {
					nodesChanged.push({ path: key, field, from: va, to: vb });
				}
			}
		}

		const edgeKey = (e: { from: string; to: string }) => `${e.from}\t${e.to}`;
		const aEdges = new Set(a.edges.map(edgeKey));
		const bEdges = new Set(b.edges.map(edgeKey));

		const edgesAdded = b.edges.filter((e) => !aEdges.has(edgeKey(e)));
		const edgesRemoved = a.edges.filter((e) => !bEdges.has(edgeKey(e)));
		const aSubgraphs = new Set(a.subgraphs);
		const bSubgraphs = new Set(b.subgraphs);
		const subgraphsAdded = [...bSubgraphs].filter((s) => !aSubgraphs.has(s)).sort();
		const subgraphsRemoved = [...aSubgraphs].filter((s) => !bSubgraphs.has(s)).sort();

		return {
			nodesAdded,
			nodesRemoved,
			nodesChanged,
			versionChanges,
			edgesAdded,
			edgesRemoved,
			subgraphsAdded,
			subgraphsRemoved,
		};
	}
}

/** Entry in the reasoning trace ring buffer (roadmap 3.3). */
export type TraceEntry = {
	path: string;
	reason: string;
	timestamp_ns: number;
	/**
	 * Actor that produced the annotation (optional). Enables multi-agent
	 * attribution: distinguish "LLM set this rootCause" from "human approved
	 * this intervention" in the trace log.
	 */
	actor?: Actor;
};

/** Result of {@link Graph.diff}. */
export type GraphDiffResult = {
	nodesAdded: string[];
	nodesRemoved: string[];
	nodesChanged: GraphDiffChange[];
	/**
	 * V0 version bumps (same `v.id`, different `v.version`). Surfaced even
	 * when values are identical — the bump itself is audit-meaningful.
	 */
	versionChanges: GraphVersionChange[];
	edgesAdded: Array<{ from: string; to: string }>;
	edgesRemoved: Array<{ from: string; to: string }>;
	subgraphsAdded: string[];
	subgraphsRemoved: string[];
};

/**
 * WAL-oriented diff — extends {@link GraphDiffResult} with the full node
 * slice for each added path so {@link replayWAL} can reconstruct nodes added
 * between full anchors (topology mutations inside a `compactEvery` window).
 *
 * `Graph.diff()` returns the audit shape (no payload); `attachStorage` writes
 * this WAL shape. The two shapes stay structurally compatible — `GraphWALDiff`
 * is a superset.
 */
export type GraphWALDiff = GraphDiffResult & {
	/**
	 * Full node slices for every path in `nodesAdded`, keyed by path. Applied
	 * verbatim to `snapshot.nodes[path]` during replay.
	 */
	nodesAddedFull: Record<string, DescribeNodeOutput>;
};

/**
 * Build a WAL-ready diff between two snapshots: the structural diff from
 * {@link Graph.diff} plus the full node slice for each added path (pulled
 * from `b.nodes`). Callers that only need the audit shape should use
 * `Graph.diff` directly.
 */
export function diffForWAL(a: GraphDescribeOutput, b: GraphDescribeOutput): GraphWALDiff {
	const base = Graph.diff(a, b);
	const nodesAddedFull: Record<string, DescribeNodeOutput> = {};
	for (const path of base.nodesAdded) {
		const slice = b.nodes[path];
		if (slice != null) nodesAddedFull[path] = slice;
	}
	return { ...base, nodesAddedFull };
}

/** A single field change within a diff. */
export type GraphDiffChange = {
	path: string;
	field: string;
	from: unknown;
	to: unknown;
};

/** A single V0 version bump within a diff. */
export type GraphVersionChange = {
	path: string;
	id: string;
	from: number;
	to: number;
};

/** Audit record returned by {@link Graph.remove}. */
export type GraphRemoveAudit = {
	/** Whether the removed entry was a local node or a mount. */
	kind: "node" | "mount";
	/**
	 * Primary nodes torn down by this `remove()`. For `kind: "node"` contains
	 * just the removed name; for `kind: "mount"` lists every primary node in
	 * the unmounted subtree (qualified paths relative to the mount point,
	 * sorted).
	 */
	nodes: string[];
	/**
	 * Mounted subgraphs that were unmounted. For `kind: "node"` this is empty;
	 * for `kind: "mount"` starts with the top-level mount name and lists its
	 * descendants in depth-first order.
	 */
	mounts: string[];
};

/** Direction for {@link reachable} graph traversal. */
export type ReachableDirection = "upstream" | "downstream";

/** Options for {@link reachable}. */
export type ReachableOptions = {
	/** Maximum hop depth from `from` (0 returns `[]`). Omit for unbounded traversal. */
	maxDepth?: number;
	/**
	 * Traverse both directions in one pass (union of upstream + downstream).
	 * Ignores the `direction` arg when set.
	 */
	both?: boolean;
	/**
	 * Return the richer {@link ReachableResult} shape (paths + per-path
	 * hop depth + truncation flag) instead of the flat sorted string array.
	 */
	withDetail?: boolean;
};

/** Rich reachable result (opt-in via `{withDetail: true}`). */
export type ReachableResult = {
	/** Reachable paths, sorted lexicographically. */
	paths: string[];
	/** Hop depth from `from` to each reachable path. */
	depths: Map<string, number>;
	/** True when traversal hit `maxDepth` and some neighbors were not explored. */
	truncated: boolean;
};

/**
 * Reachability query over a {@link Graph.describe} snapshot.
 *
 * Traversal follows `deps` (upstream) and reverse-`deps` (downstream). Edges
 * are derived from deps post Unit 7, so `edges[]` in the snapshot is
 * redundant with deps — it's walked defensively in case a caller supplied a
 * pre-Unit-7 snapshot.
 *
 * @param described - `graph.describe()` output to traverse.
 * @param from - Start path (qualified node path).
 * @param direction - Traversal direction (ignored when `opts.both` is `true`).
 * @param options - Optional `maxDepth`, `both`, `withDetail`.
 * @returns Sorted paths (flat) — or {@link ReachableResult} when `withDetail: true`.
 */
export function reachable(
	described: GraphDescribeOutput,
	from: string,
	direction: ReachableDirection,
	options?: ReachableOptions & { withDetail: true },
): ReachableResult;
export function reachable(
	described: GraphDescribeOutput,
	from: string,
	direction: ReachableDirection,
	options?: ReachableOptions,
): string[];
export function reachable(
	described: GraphDescribeOutput,
	from: string,
	direction: ReachableDirection,
	options: ReachableOptions = {},
): string[] | ReachableResult {
	const empty: ReachableResult = { paths: [], depths: new Map(), truncated: false };
	if (!from) return options.withDetail ? empty : [];
	if (!options.both && direction !== "upstream" && direction !== "downstream") {
		throw new Error(`reachable: direction must be "upstream" or "downstream"`);
	}
	const maxDepth = options.maxDepth;
	if (maxDepth != null && (!Number.isInteger(maxDepth) || maxDepth < 0)) {
		throw new Error(`reachable: maxDepth must be an integer >= 0`);
	}
	if (maxDepth === 0) return options.withDetail ? empty : [];

	const depsByPath = new Map<string, readonly string[]>();
	const reverseDeps = new Map<string, Set<string>>();
	const incomingEdges = new Map<string, Set<string>>();
	const outgoingEdges = new Map<string, Set<string>>();
	const universe = new Set<string>();

	for (const [path, node] of Object.entries(described.nodes)) {
		if (!path) continue;
		universe.add(path);
		const deps = node.deps ?? [];
		depsByPath.set(path, deps);
		for (const dep of deps) {
			if (!dep) continue;
			universe.add(dep);
			if (!reverseDeps.has(dep)) reverseDeps.set(dep, new Set());
			reverseDeps.get(dep)!.add(path);
		}
	}
	// Edges are normally derived from deps post Unit 7, but synthetic snapshots
	// (e.g. test fixtures) may declare edges independently — walk both for
	// compatibility. Minimal null/string checks for malformed JSON.
	for (const edge of described.edges) {
		if (edge == null || typeof edge !== "object") continue;
		const from = typeof edge.from === "string" ? edge.from : "";
		const to = typeof edge.to === "string" ? edge.to : "";
		if (!from || !to) continue;
		universe.add(from);
		universe.add(to);
		if (!outgoingEdges.has(from)) outgoingEdges.set(from, new Set());
		outgoingEdges.get(from)!.add(to);
		if (!incomingEdges.has(to)) incomingEdges.set(to, new Set());
		incomingEdges.get(to)!.add(from);
	}

	if (!universe.has(from)) return options.withDetail ? empty : [];

	const doBoth = options.both === true;
	const visit = (path: string): readonly string[] => {
		if (doBoth) {
			const up = depsByPath.get(path) ?? [];
			const upEdges = incomingEdges.get(path);
			const down = reverseDeps.get(path);
			const downEdges = outgoingEdges.get(path);
			const acc: string[] = [...up];
			if (upEdges) acc.push(...upEdges);
			if (down) acc.push(...down);
			if (downEdges) acc.push(...downEdges);
			return acc;
		}
		if (direction === "upstream") {
			const up = depsByPath.get(path) ?? [];
			const upEdges = incomingEdges.get(path);
			if (!upEdges) return up;
			return [...up, ...upEdges];
		}
		const down = reverseDeps.get(path);
		const downEdges = outgoingEdges.get(path);
		const acc: string[] = down ? [...down] : [];
		if (downEdges) acc.push(...downEdges);
		return acc;
	};

	// Head-index BFS — avoids O(n²) from `Array.prototype.shift`.
	const visited = new Set<string>([from]);
	const depths = new Map<string, number>();
	const queue: Array<{ path: string; depth: number }> = [{ path: from, depth: 0 }];
	let head = 0;
	let truncated = false;
	while (head < queue.length) {
		const next = queue[head++]!;
		if (maxDepth != null && next.depth >= maxDepth) {
			// Flag truncation only if this node actually has unexplored neighbors.
			if (visit(next.path).length > 0) truncated = true;
			continue;
		}
		for (const nb of visit(next.path)) {
			if (!nb || visited.has(nb)) continue;
			visited.add(nb);
			depths.set(nb, next.depth + 1);
			queue.push({ path: nb, depth: next.depth + 1 });
		}
	}

	const paths = [...depths.keys()].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
	if (options.withDetail) return { paths, depths, truncated };
	return paths;
}
