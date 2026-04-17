import type { Actor } from "../core/actor.js";
import { batch, isBatching } from "../core/batch.js";
import { monotonicNs } from "../core/clock.js";
import type { GraphReFlyConfig } from "../core/config.js";
import { GuardDenied } from "../core/guard.js";
import {
	COMPLETE,
	DATA,
	DIRTY,
	ERROR,
	INVALIDATE,
	type Messages,
	RESOLVED,
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
import { state as stateNode } from "../core/sugar.js";
import type { VersioningLevel } from "../core/versioning.js";
import { RingBuffer } from "../extra/utils/ring-buffer.js";
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

/** @deprecated Use `CheckpointAdapter` from `extra/checkpoint` instead. */
export type AutoCheckpointAdapter = {
	save(key: string, data: unknown): void;
};

export type GraphCheckpointRecord =
	| { mode: "full"; snapshot: GraphPersistSnapshot; seq: number }
	| { mode: "diff"; diff: GraphDiffResult; snapshot: GraphPersistSnapshot; seq: number };

export type GraphAutoCheckpointOptions = {
	debounceMs?: number;
	compactEvery?: number;
	filter?: (name: string, described: DescribeNodeOutput) => boolean;
	onError?: (error: unknown) => void;
};

export type GraphAutoCheckpointHandle = {
	dispose(): void;
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

/** Snapshot format version (§3.8). */
const SNAPSHOT_VERSION = 1;

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
	complete: "\u001b[34m",
	error: "\u001b[31m",
	derived: "\u001b[35m",
	path: "\u001b[90m",
	reset: "\u001b[0m",
};

const OBSERVE_NO_COLOR_THEME: Required<ObserveTheme> = {
	data: "",
	dirty: "",
	resolved: "",
	complete: "",
	error: "",
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
		complete: theme.complete ?? "",
		error: theme.error ?? "",
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
 * - `"standard"` — all message types (DATA, DIRTY, RESOLVED, COMPLETE, ERROR).
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
};

/** Accumulated observation result (structured mode). */
export type ObserveResult<T = unknown> = {
	/** Latest DATA value by observed path. */
	readonly values: Record<string, T>;
	/** Number of DIRTY messages received. */
	readonly dirtyCount: number;
	/** Number of RESOLVED messages received. */
	readonly resolvedCount: number;
	/** All events in order. */
	readonly events: ObserveEvent[];
	/** True if any observed node sent COMPLETE without prior ERROR on that node. */
	readonly anyCompletedCleanly: boolean;
	/** True if any observed node sent ERROR. */
	readonly anyErrored: boolean;
	/** True if at least one COMPLETE received and no ERROR from any observed node. */
	readonly completedWithoutErrors: boolean;
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

/** A single event in the structured observation log. */
export type ObserveEvent = {
	type: "data" | "dirty" | "resolved" | "complete" | "error" | "derived";
	path?: string;
	data?: unknown;
	timestamp_ns?: number;
	in_batch?: boolean;
	/** Monotonically increasing counter per subscribe-callback invocation. All events in one delivery share the same id. */
	batch_id?: number;
	trigger_dep_index?: number;
	trigger_dep_name?: string;
	/**
	 * V0 version of the triggering dep at observation time (§6.0b).
	 * This is the dep's post-emission version (after its own `advanceVersion`),
	 * not the pre-emission version that caused this node's recomputation.
	 */
	trigger_version?: { id: string; version: number };
	dep_values?: unknown[];
};

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
	/** @internal — exposed for {@link teardownMountedGraph}. */
	readonly _mounts = new Map<string, Graph>();
	private readonly _autoCheckpointDisposers = new Set<() => void>();
	private readonly _disposers = new Set<() => void>();

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
		if (opts?.versioning != null) {
			// No nodes yet, but keep the API consistent — apply at construction
			// so opts.versioning is honored as a startup default via this helper.
			this.setVersioning(opts.versioning);
		}
	}

	/**
	 * Graphs reachable from this instance via nested {@link Graph.mount} (includes `this`).
	 */
	private _graphsReachableViaMounts(seen = new Set<Graph>()): Set<Graph> {
		if (seen.has(this)) return seen;
		seen.add(this);
		for (const child of this._mounts.values()) {
			child._graphsReachableViaMounts(seen);
		}
		return seen;
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
		for (const [existingName, existing] of this._nodes) {
			if (existing === node) {
				throw new Error(
					`Graph "${this.name}": node instance already registered as "${existingName}"`,
				);
			}
		}
		this._nodes.set(name, node);
		// Edges are derived on demand from node `_deps` via `scanEdges` — no
		// stored registry to keep in sync. See Unit 7 of the graph review.
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
			teardownMountedGraph(child);
			return audit;
		}

		// Case 2: remove a local node
		const node = this._nodes.get(name);
		if (!node) {
			throw new Error(`Graph "${this.name}": unknown node or mount "${name}"`);
		}
		this._nodes.delete(name);
		node.down([[TEARDOWN]] satisfies Messages, { internal: true });
		return { kind: "node", nodes: [name], mounts: [] };
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
		// Reject same child instance mounted twice on this parent.
		for (const existing of this._mounts.values()) {
			if (existing === child) {
				throw new Error(`Graph "${this.name}": this child graph is already mounted on this graph`);
			}
		}
		if (child._graphsReachableViaMounts().has(this)) {
			throw new Error(`Graph "${this.name}": mount("${name}", …) would create a mount cycle`);
		}
		this._mounts.set(name, child);
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
	 * Companion `meta` nodes receive the same batch for control-plane types (e.g.
	 * PAUSE) that the primary does not forward. **TEARDOWN-only** batches skip the
	 * extra meta pass — the primary’s `down()` already cascades TEARDOWN to meta.
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
	 * Overloads: `(path, options?)` for one node; `(options?)` for all nodes. Whole-graph mode
	 * subscribes in **sorted path order** (code-point order). With structured options
	 * (`structured`, `timeline`, `causal`, `derived`), returns an {@link ObserveResult}.
	 * Inspector-gated extras (`causal` / `derived`) require `graph.config.inspectorEnabled`.
	 *
	 * @param pathOrOpts - Qualified `path` string, or omit and pass only `options` for graph-wide observation.
	 * @param options - Optional `actor`, `structured`, `causal`, `timeline` (inspector-gated).
	 * @returns `GraphObserveOne`, `GraphObserveAll`, or `ObserveResult` depending on overload/options.
	 */
	observe(
		path: string,
		options?: ObserveOptions & {
			structured?: true;
			timeline?: true;
			causal?: true;
			derived?: true;
		},
	): ObserveResult;
	observe(path: string, options: ObserveOptions & { format: "pretty" | "json" }): ObserveResult;
	observe(path: string, options?: ObserveOptions): GraphObserveOne;
	observe(
		options: ObserveOptions & { structured?: true; timeline?: true; causal?: true; derived?: true },
	): ObserveResult;
	observe(options: ObserveOptions & { format: "pretty" | "json" }): ObserveResult;
	observe(options?: ObserveOptions): GraphObserveAll;
	observe(
		pathOrOpts?: string | ObserveOptions,
		options?: ObserveOptions,
	): GraphObserveOne | GraphObserveAll | ObserveResult {
		if (typeof pathOrOpts === "string") {
			const path = pathOrOpts;
			const resolved = resolveObserveDetail(options);
			const actor = resolved.actor;
			const target = this.resolve(path);
			if (actor != null && !target.allowsObserve(actor)) {
				throw new GuardDenied({ actor, action: "observe", nodeName: path });
			}
			const wantsStructured =
				resolved.structured === true ||
				resolved.timeline === true ||
				resolved.causal === true ||
				resolved.derived === true ||
				resolved.detail === "minimal" ||
				resolved.detail === "full" ||
				resolved.format != null;
			if (wantsStructured) {
				const result = this.config.inspectorEnabled
					? this._createObserveResult(path, target, resolved)
					: this._createFallbackObserveResult(path, resolved);
				if (resolved.format != null) {
					this._attachFormatLogger(result, resolved);
				}
				return result;
			}
			return {
				subscribe(sink: NodeSink) {
					return target.subscribe(sink);
				},
				up(messages: Messages) {
					try {
						target.up?.(messages);
					} catch (err) {
						if (err instanceof GuardDenied) return; // silently drop — guard denied flow control
						throw err;
					}
				},
			};
		}
		const opts = resolveObserveDetail(pathOrOpts as ObserveOptions | undefined);
		const actor = opts.actor;
		const wantsStructured =
			opts.structured === true ||
			opts.timeline === true ||
			opts.causal === true ||
			opts.derived === true ||
			opts.detail === "minimal" ||
			opts.detail === "full" ||
			opts.format != null;
		if (wantsStructured) {
			const result = this.config.inspectorEnabled
				? this._createObserveResultForAll(opts)
				: this._createFallbackObserveResultForAll(opts);
			if (opts.format != null) {
				this._attachFormatLogger(result, opts);
			}
			return result;
		}
		return {
			subscribe: (sink: (nodePath: string, messages: Messages) => void) => {
				const targets: [string, Node][] = [];
				this._collectObserveTargets("", targets);
				targets.sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
				const picked =
					actor == null ? targets : targets.filter(([, nd]) => nd.allowsObserve(actor));
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
					if (err instanceof GuardDenied) return; // silently drop — guard denied flow control
					throw err;
				}
			},
		};
	}

	private _createObserveResult<T>(
		path: string,
		target: Node<T>,
		options: ObserveOptions,
	): ObserveResult<T> {
		const timeline = options.timeline === true;
		const causal = options.causal === true;
		const derived = options.derived === true;
		const minimal = options.detail === "minimal";
		const result: {
			values: Record<string, T>;
			dirtyCount: number;
			resolvedCount: number;
			events: ObserveEvent[];
			anyCompletedCleanly: boolean;
			anyErrored: boolean;
		} = {
			values: {},
			dirtyCount: 0,
			resolvedCount: 0,
			events: [],
			anyCompletedCleanly: false,
			anyErrored: false,
		};

		let lastTriggerDepIndex: number | undefined;
		let lastRunDepValues: unknown[] | undefined;
		let batchSeq = 0;
		// Attach inspector hook for causal/derived tracing.
		let detachInspectorHook: (() => void) | undefined;
		if ((causal || derived) && target instanceof NodeImpl) {
			detachInspectorHook = target._setInspectorHook((event) => {
				if (event.kind === "dep_message") {
					lastTriggerDepIndex = event.depIndex;
				} else if (event.kind === "run") {
					// Effective dep values: this wave's last DATA if dep fired,
					// else the stable value from the previous wave (prevData).
					const effectiveDepValues = event.batchData.map((batch, i) =>
						batch != null && batch.length > 0 ? batch.at(-1) : event.prevData[i],
					);
					lastRunDepValues = effectiveDepValues;
					// Emit a synthetic "derived" event when requested.
					if (derived) {
						const base = timeline
							? {
									timestamp_ns: monotonicNs(),
									in_batch: isBatching(),
									batch_id: batchSeq,
								}
							: {};
						result.events.push({
							type: "derived",
							path,
							dep_values: effectiveDepValues,
							...base,
						} as ObserveEvent);
					}
				}
			});
		}

		const unsub = target.subscribe((msgs) => {
			batchSeq++;
			for (const m of msgs) {
				const t = m[0];
				const base = timeline
					? { timestamp_ns: monotonicNs(), in_batch: isBatching(), batch_id: batchSeq }
					: {};
				const withCausal =
					causal && lastRunDepValues != null
						? (() => {
								const triggerDepRecord =
									lastTriggerDepIndex != null &&
									lastTriggerDepIndex >= 0 &&
									target instanceof NodeImpl
										? target._deps[lastTriggerDepIndex]
										: undefined;
								const triggerNode = triggerDepRecord?.node;
								const tv = triggerNode?.v;
								return {
									trigger_dep_index: lastTriggerDepIndex,
									trigger_dep_name: triggerNode?.name,
									...(tv != null ? { trigger_version: { id: tv.id, version: tv.version } } : {}),
									dep_values: [...lastRunDepValues],
								};
							})()
						: {};
				if (t === DATA) {
					result.values[path] = m[1] as T;
					result.events.push({ type: "data", path, data: m[1], ...base, ...withCausal });
				} else if (minimal) {
					// minimal: track state but don't push non-DATA events
					if (t === DIRTY) result.dirtyCount++;
					else if (t === RESOLVED) result.resolvedCount++;
					else if (t === COMPLETE && !result.anyErrored) result.anyCompletedCleanly = true;
					else if (t === ERROR) result.anyErrored = true;
				} else if (t === DIRTY) {
					result.dirtyCount++;
					result.events.push({ type: "dirty", path, ...base });
				} else if (t === RESOLVED) {
					result.resolvedCount++;
					result.events.push({ type: "resolved", path, ...base, ...withCausal });
				} else if (t === COMPLETE) {
					if (!result.anyErrored) result.anyCompletedCleanly = true;
					result.events.push({ type: "complete", path, ...base });
				} else if (t === ERROR) {
					result.anyErrored = true;
					result.events.push({ type: "error", path, data: m[1], ...base });
				}
			}
		});

		const graph = this;
		const basePath = path;

		return {
			get values() {
				return result.values;
			},
			get dirtyCount() {
				return result.dirtyCount;
			},
			get resolvedCount() {
				return result.resolvedCount;
			},
			get events() {
				return result.events;
			},
			get anyCompletedCleanly() {
				return result.anyCompletedCleanly;
			},
			get anyErrored() {
				return result.anyErrored;
			},
			get completedWithoutErrors() {
				return result.anyCompletedCleanly && !result.anyErrored;
			},
			dispose() {
				unsub();
				detachInspectorHook?.();
			},
			expand(
				extra: Partial<Pick<ObserveOptions, "causal" | "timeline" | "derived">> | ObserveDetail,
			): ObserveResult<T> {
				unsub();
				detachInspectorHook?.();
				const merged: ObserveOptions = { ...options };
				if (typeof extra === "string") {
					merged.detail = extra;
				} else {
					Object.assign(merged, extra);
				}
				const resolvedTarget = graph.resolve(basePath);
				const expanded = graph._createObserveResult<T>(
					basePath,
					resolvedTarget as Node<T>,
					resolveObserveDetail(merged),
				);
				if (merged.format != null) {
					graph._attachFormatLogger(expanded, merged);
				}
				return expanded;
			},
		};
	}

	private _createObserveResultForAll(options: ObserveOptions): ObserveResult {
		const timeline = options.timeline === true;
		const minimal = options.detail === "minimal";
		const result: {
			values: Record<string, unknown>;
			dirtyCount: number;
			resolvedCount: number;
			events: ObserveEvent[];
			anyCompletedCleanly: boolean;
			anyErrored: boolean;
		} = {
			values: {},
			dirtyCount: 0,
			resolvedCount: 0,
			events: [],
			anyCompletedCleanly: false,
			anyErrored: false,
		};
		/** Per-node terminal state for allCompletedCleanly computation. */
		const nodeErrored = new Set<string>();
		const actor = options.actor;
		const targets: [string, Node][] = [];
		this._collectObserveTargets("", targets);
		targets.sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
		const picked = actor == null ? targets : targets.filter(([, nd]) => nd.allowsObserve(actor));
		let batchSeq = 0;
		const unsubs = picked.map(([path, nd]) =>
			nd.subscribe((msgs) => {
				batchSeq++;
				for (const m of msgs) {
					const t = m[0];
					const base = timeline
						? { timestamp_ns: monotonicNs(), in_batch: isBatching(), batch_id: batchSeq }
						: {};
					if (t === DATA) {
						result.values[path] = m[1];
						result.events.push({ type: "data", path, data: m[1], ...base });
					} else if (minimal) {
						if (t === DIRTY) result.dirtyCount++;
						else if (t === RESOLVED) result.resolvedCount++;
						else if (t === COMPLETE && !nodeErrored.has(path)) result.anyCompletedCleanly = true;
						else if (t === ERROR) {
							result.anyErrored = true;
							nodeErrored.add(path);
						}
					} else if (t === DIRTY) {
						result.dirtyCount++;
						result.events.push({ type: "dirty", path, ...base });
					} else if (t === RESOLVED) {
						result.resolvedCount++;
						result.events.push({ type: "resolved", path, ...base });
					} else if (t === COMPLETE) {
						if (!nodeErrored.has(path)) result.anyCompletedCleanly = true;
						result.events.push({ type: "complete", path, ...base });
					} else if (t === ERROR) {
						result.anyErrored = true;
						nodeErrored.add(path);
						result.events.push({ type: "error", path, data: m[1], ...base });
					}
				}
			}),
		);

		const graph = this;
		return {
			get values() {
				return result.values;
			},
			get dirtyCount() {
				return result.dirtyCount;
			},
			get resolvedCount() {
				return result.resolvedCount;
			},
			get events() {
				return result.events;
			},
			get anyCompletedCleanly() {
				return result.anyCompletedCleanly;
			},
			get anyErrored() {
				return result.anyErrored;
			},
			get completedWithoutErrors() {
				return result.anyCompletedCleanly && !result.anyErrored;
			},
			dispose() {
				for (const u of unsubs) u();
			},
			expand(
				extra: Partial<Pick<ObserveOptions, "causal" | "timeline" | "derived">> | ObserveDetail,
			): ObserveResult {
				for (const u of unsubs) u();
				const merged: ObserveOptions = { ...options };
				if (typeof extra === "string") {
					merged.detail = extra;
				} else {
					Object.assign(merged, extra);
				}
				const expanded = graph._createObserveResultForAll(resolveObserveDetail(merged));
				if (merged.format != null) {
					graph._attachFormatLogger(expanded, merged);
				}
				return expanded;
			},
		};
	}

	/**
	 * Fallback ObserveResult for single-node when inspector is disabled but `format` is requested.
	 * Subscribes to raw messages and accumulates events with timeline info.
	 */
	private _createFallbackObserveResult(path: string, options: ObserveOptions): ObserveResult {
		const graph = this;
		const timeline = options.timeline !== false;
		const acc = {
			values: {} as Record<string, unknown>,
			dirtyCount: 0,
			resolvedCount: 0,
			events: [] as ObserveEvent[],
			anyCompletedCleanly: false,
			anyErrored: false,
		};
		const target = this.resolve(path);
		let batchSeq = 0;
		const unsub = target.subscribe((msgs) => {
			batchSeq++;
			for (const m of msgs) {
				const t = m[0];
				const base = timeline
					? { timestamp_ns: monotonicNs(), in_batch: isBatching(), batch_id: batchSeq }
					: {};
				if (t === DATA) {
					acc.values[path] = m[1];
					acc.events.push({ type: "data", path, data: m[1], ...base });
				} else if (t === DIRTY) {
					acc.dirtyCount++;
					acc.events.push({ type: "dirty", path, ...base });
				} else if (t === RESOLVED) {
					acc.resolvedCount++;
					acc.events.push({ type: "resolved", path, ...base });
				} else if (t === COMPLETE) {
					if (!acc.anyErrored) acc.anyCompletedCleanly = true;
					acc.events.push({ type: "complete", path, ...base });
				} else if (t === ERROR) {
					acc.anyErrored = true;
					acc.events.push({ type: "error", path, data: m[1], ...base });
				}
			}
		});
		return {
			get values() {
				return acc.values;
			},
			get dirtyCount() {
				return acc.dirtyCount;
			},
			get resolvedCount() {
				return acc.resolvedCount;
			},
			get events() {
				return acc.events;
			},
			get anyCompletedCleanly() {
				return acc.anyCompletedCleanly;
			},
			get anyErrored() {
				return acc.anyErrored;
			},
			get completedWithoutErrors() {
				return acc.anyCompletedCleanly && !acc.anyErrored;
			},
			dispose() {
				unsub();
			},
			expand(
				extra: Partial<Pick<ObserveOptions, "causal" | "timeline" | "derived">> | ObserveDetail,
			): ObserveResult {
				// Graceful degrade: if inspector is now enabled, upgrade to full
				// structured observer. Otherwise re-create the fallback with merged
				// options — caller always gets a working result, never a throw.
				unsub();
				const merged: ObserveOptions = { ...options };
				if (typeof extra === "string") {
					merged.detail = extra;
				} else {
					Object.assign(merged, extra);
				}
				const resolved = resolveObserveDetail(merged);
				if (graph.config.inspectorEnabled) {
					const resolvedTarget = graph.resolve(path);
					const expanded = graph._createObserveResult(path, resolvedTarget, resolved);
					if (merged.format != null) {
						graph._attachFormatLogger(expanded, merged);
					}
					return expanded;
				}
				const fallback = graph._createFallbackObserveResult(path, resolved);
				if (merged.format != null) {
					graph._attachFormatLogger(fallback, merged);
				}
				return fallback;
			},
		};
	}

	/**
	 * Fallback ObserveResult for graph-wide when inspector is disabled but `format` is requested.
	 */
	private _createFallbackObserveResultForAll(options: ObserveOptions): ObserveResult {
		const graph = this;
		const timeline = options.timeline !== false;
		const actor = options.actor;
		const acc = {
			values: {} as Record<string, unknown>,
			dirtyCount: 0,
			resolvedCount: 0,
			events: [] as ObserveEvent[],
			anyCompletedCleanly: false,
			anyErrored: false,
		};
		const nodeErrored = new Set<string>();
		const targets: [string, Node][] = [];
		this._collectObserveTargets("", targets);
		targets.sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
		const picked = actor == null ? targets : targets.filter(([, nd]) => nd.allowsObserve(actor));
		let batchSeq = 0;
		const unsubs = picked.map(([path, nd]) =>
			nd.subscribe((msgs) => {
				batchSeq++;
				for (const m of msgs) {
					const t = m[0];
					const base = timeline
						? { timestamp_ns: monotonicNs(), in_batch: isBatching(), batch_id: batchSeq }
						: {};
					if (t === DATA) {
						acc.values[path] = m[1];
						acc.events.push({ type: "data", path, data: m[1], ...base });
					} else if (t === DIRTY) {
						acc.dirtyCount++;
						acc.events.push({ type: "dirty", path, ...base });
					} else if (t === RESOLVED) {
						acc.resolvedCount++;
						acc.events.push({ type: "resolved", path, ...base });
					} else if (t === COMPLETE) {
						if (!nodeErrored.has(path)) acc.anyCompletedCleanly = true;
						acc.events.push({ type: "complete", path, ...base });
					} else if (t === ERROR) {
						acc.anyErrored = true;
						nodeErrored.add(path);
						acc.events.push({ type: "error", path, data: m[1], ...base });
					}
				}
			}),
		);
		return {
			get values() {
				return acc.values;
			},
			get dirtyCount() {
				return acc.dirtyCount;
			},
			get resolvedCount() {
				return acc.resolvedCount;
			},
			get events() {
				return acc.events;
			},
			get anyCompletedCleanly() {
				return acc.anyCompletedCleanly;
			},
			get anyErrored() {
				return acc.anyErrored;
			},
			get completedWithoutErrors() {
				return acc.anyCompletedCleanly && !acc.anyErrored;
			},
			dispose() {
				for (const u of unsubs) u();
			},
			expand(
				extra: Partial<Pick<ObserveOptions, "causal" | "timeline" | "derived">> | ObserveDetail,
			): ObserveResult {
				for (const u of unsubs) u();
				const merged: ObserveOptions = { ...options };
				if (typeof extra === "string") {
					merged.detail = extra;
				} else {
					Object.assign(merged, extra);
				}
				const resolved = resolveObserveDetail(merged);
				if (graph.config.inspectorEnabled) {
					const expanded = graph._createObserveResultForAll(resolved);
					if (merged.format != null) {
						graph._attachFormatLogger(expanded, merged);
					}
					return expanded;
				}
				const fallback = graph._createFallbackObserveResultForAll(resolved);
				if (merged.format != null) {
					graph._attachFormatLogger(fallback, merged);
				}
				return fallback;
			},
		};
	}

	/**
	 * Attaches a format logger to an ObserveResult, rendering events as they arrive.
	 * Wraps the result's dispose to flush pending events.
	 */
	private _attachFormatLogger(result: ObserveResult, options: ObserveOptions): void {
		const format = options.format!;
		const logger = options.logger ?? ((line: string) => console.log(line));
		const include = options.includeTypes ? new Set(options.includeTypes) : null;
		const exclude = options.excludeTypes ? new Set(options.excludeTypes) : null;
		const theme = resolveObserveTheme(options.theme);

		const shouldLog = (type: ObserveEvent["type"]): boolean => {
			if (include?.has(type) === false) return false;
			if (exclude?.has(type) === true) return false;
			return true;
		};

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
			const dataPart = event.data !== undefined ? ` ${describeData(event.data)}` : "";
			const triggerPart =
				event.trigger_dep_name != null
					? ` <- ${event.trigger_dep_name}`
					: event.trigger_dep_index != null
						? ` <- #${event.trigger_dep_index}`
						: "";
			const batchPart = event.in_batch ? " [batch]" : "";
			return `${pathPart}${color}${event.type.toUpperCase()}${theme.reset}${dataPart}${triggerPart}${batchPart}`;
		};

		// Poll-free event flushing: watch the events array length via a cursor.
		// The fallback ObserveResult pushes events synchronously during subscribe callbacks,
		// so we use Object.defineProperty to intercept event pushes.
		let cursor = 0;
		const flush = () => {
			const events = result.events;
			while (cursor < events.length) {
				const event = events[cursor++];
				if (shouldLog(event.type)) {
					logger(renderEvent(event), event);
				}
			}
		};

		// Wrap the events array's push to flush on each new event.
		const origPush = (result.events as ObserveEvent[]).push;
		(result.events as ObserveEvent[]).push = function (...items: ObserveEvent[]) {
			const ret = origPush.apply(this, items);
			flush();
			return ret;
		};

		// Wrap dispose to flush any remaining events.
		const origDispose = result.dispose.bind(result);
		(result as { dispose(): void }).dispose = () => {
			origDispose();
			flush();
		};
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
		for (const dispose of [...this._disposers]) {
			try {
				dispose();
			} catch {
				/* ignore */
			}
		}
		this._disposers.clear();
		this.signal([[TEARDOWN]] satisfies Messages, { internal: true });
		for (const dispose of [...this._autoCheckpointDisposers]) {
			try {
				dispose();
			} catch {
				/* ignore */
			}
		}
		this._autoCheckpointDisposers.clear();
		for (const child of [...this._mounts.values()]) {
			child._destroyClearOnly();
		}
		this._mounts.clear();
		this._nodes.clear();
	}

	/** Clear structure after parent already signaled TEARDOWN through this subtree. */
	private _destroyClearOnly(): void {
		for (const child of [...this._mounts.values()]) {
			child._destroyClearOnly();
		}
		this._mounts.clear();
		this._nodes.clear();
	}

	/**
	 * Serializes structure and current values to JSON-shaped data (§3.8). Same information
	 * as {@link Graph.describe} plus a `version` field for format evolution.
	 *
	 * @returns Persistable snapshot with sorted keys.
	 */
	snapshot(): GraphPersistSnapshot {
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
		return { ...d, version: 1, nodes: sortedNodes, subgraphs: sortedSubgraphs };
	}

	/**
	 * Apply persisted values onto an existing graph whose topology matches the snapshot
	 * (§3.8). Only {@link DescribeNodeOutput.type} `state` and `producer` entries with a
	 * `value` field are written; `derived` / `operator` / `effect` are skipped so deps
	 * drive recomputation. Unknown paths are ignored.
	 *
	 * @param data - Snapshot envelope with matching `name` and node slices.
	 * @throws If `data.name` does not equal {@link Graph.name}.
	 */
	restore(data: GraphPersistSnapshot, options?: { only?: string | readonly string[] }): void {
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
		for (const path of Object.keys(data.nodes).sort()) {
			if (onlyPatterns !== null && !onlyPatterns.some((re) => re.test(path))) continue;
			const slice = data.nodes[path];
			if (slice === undefined || slice.value === undefined) continue;
			if (slice.type === "derived" || slice.type === "effect") {
				continue;
			}
			try {
				this.set(path, slice.value);
			} catch {
				/* missing path or set not applicable */
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
	 * Debounced persistence wired to graph-wide observe stream (spec §3.8 auto-checkpoint).
	 *
	 * Checkpoint trigger uses {@link messageTier}: only batches containing tier >= 3 messages
	 * schedule a save (`DATA`/`RESOLVED`/terminal/destruction), never pure tier-0/1/2 control
	 * waves (`START`/`DIRTY`/`INVALIDATE`/`PAUSE`/`RESUME`).
	 */
	autoCheckpoint(
		adapter: AutoCheckpointAdapter,
		options: GraphAutoCheckpointOptions = {},
	): GraphAutoCheckpointHandle {
		const debounceMs = Math.max(0, options.debounceMs ?? 500);
		const compactEvery = Math.max(1, options.compactEvery ?? 10);
		let timer: ReturnType<typeof setTimeout> | undefined;
		let seq = 0;
		let pending = false;
		let lastDescribe: GraphDescribeOutput | undefined;

		const flush = () => {
			timer = undefined;
			if (!pending) return;
			pending = false;
			try {
				const { expand: _expand, ...raw } = this.describe({ detail: "full" });
				// Strip non-restorable fields for persistence idempotency
				const cleanNodes: Record<string, DescribeNodeOutput> = {};
				for (const [p, n] of Object.entries(raw.nodes)) {
					const { lastMutation: _lm, guard: _g, ...node } = n!;
					cleanNodes[p] = node;
				}
				const described = { ...raw, nodes: cleanNodes };
				const snapshot = { ...described, version: SNAPSHOT_VERSION };
				seq += 1;
				const shouldCompact = lastDescribe == null || seq % compactEvery === 0;
				if (shouldCompact) {
					adapter.save(this.name, { mode: "full", snapshot, seq } satisfies GraphCheckpointRecord);
				} else {
					const previous = lastDescribe;
					if (previous == null) return;
					adapter.save(this.name, {
						mode: "diff",
						diff: Graph.diff(previous, described),
						snapshot,
						seq,
					} satisfies GraphCheckpointRecord);
				}
				lastDescribe = described;
			} catch (error) {
				options.onError?.(error);
			}
		};

		const schedule = () => {
			pending = true;
			if (timer !== undefined) clearTimeout(timer);
			timer = setTimeout(flush, debounceMs);
		};

		const off = this.observe().subscribe((path, messages) => {
			// Trigger on tier 3 (DATA/RESOLVED) and tier 4 (COMPLETE/ERROR).
			// Exclude tier 5 (TEARDOWN) — checkpointing a dying graph wastes
			// work; graceful shutdown is the caller's responsibility.
			const triggeredByTier = messages.some((m) => {
				const tier = this.config.messageTier(m[0]);
				return tier >= 3 && tier < 5;
			});
			if (!triggeredByTier) return;
			if (options.filter) {
				const nd = this.resolve(path);
				if (nd == null) return;
				const described = describeNode(nd, resolveDescribeFields("standard"));
				if (!options.filter(path, described)) return;
			}
			schedule();
		});

		const dispose = () => {
			off();
			if (timer !== undefined) {
				clearTimeout(timer);
				timer = undefined;
			}
			this._autoCheckpointDisposers.delete(dispose);
		};
		this._autoCheckpointDisposers.add(dispose);
		return { dispose };
	}

	// ——————————————————————————————————————————————————————————————
	//  Inspector (roadmap 3.3) — reasoning trace, overhead gating
	// ——————————————————————————————————————————————————————————————

	// Inspector gating lives on `this.config.inspectorEnabled` (see
	// `core/config.ts`). Default: `true` outside `NODE_ENV === "production"`.

	private _annotations = new Map<string, string>();
	private _traceRing = new RingBuffer<TraceEntry>(1000);

	/**
	 * Unified reasoning trace: write annotations or read the ring buffer.
	 *
	 * Write: `graph.trace("path", "reason")` — attaches a reasoning annotation
	 * to a node, capturing *why* an AI agent set a value.
	 * No-op when `config.inspectorEnabled` is `false`.
	 *
	 * Read: `graph.trace()` — returns a chronological log of all annotations.
	 * Returns `[]` when `config.inspectorEnabled` is `false`.
	 */
	trace(path: string, reason: string): void;
	trace(): readonly TraceEntry[];
	trace(path?: string, reason?: string): undefined | readonly TraceEntry[] {
		if (path != null && reason != null) {
			if (!this.config.inspectorEnabled) return;
			this.resolve(path); // validate path exists
			this._annotations.set(path, reason);
			this._traceRing.push({ path, reason, timestamp_ns: monotonicNs() });
			return;
		}
		if (!this.config.inspectorEnabled) return [];
		return this._traceRing.toArray();
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

		for (const key of aKeys) {
			if (!bKeys.has(key)) continue;
			const na = a.nodes[key];
			const nb = b.nodes[key];
			// V0 optimization: skip value comparison when both nodes have matching versions.
			const av = na.v;
			const bv = nb.v;
			if (av != null && bv != null && av.id === bv.id && av.version === bv.version) {
				// Version unchanged — only check type/status (cheap string compare).
				for (const field of ["type", "status"] as const) {
					const va = (na as Record<string, unknown>)[field];
					const vb = (nb as Record<string, unknown>)[field];
					if (va !== vb) {
						nodesChanged.push({ path: key, field, from: va, to: vb });
					}
				}
				continue;
			}
			for (const field of ["type", "status", "value"] as const) {
				const va = (na as Record<string, unknown>)[field];
				const vb = (nb as Record<string, unknown>)[field];
				if (!Object.is(va, vb) && JSON.stringify(va) !== JSON.stringify(vb)) {
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
};

/** Result of {@link Graph.diff}. */
export type GraphDiffResult = {
	nodesAdded: string[];
	nodesRemoved: string[];
	nodesChanged: GraphDiffChange[];
	edgesAdded: Array<{ from: string; to: string }>;
	edgesRemoved: Array<{ from: string; to: string }>;
	subgraphsAdded: string[];
	subgraphsRemoved: string[];
};

/** A single field change within a diff. */
export type GraphDiffChange = {
	path: string;
	field: string;
	from: unknown;
	to: unknown;
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
};

/**
 * Reachability query over a {@link Graph.describe} snapshot.
 *
 * Traversal combines dependency links (`deps`) and explicit graph edges (`edges`):
 * - `upstream`: follows `deps` plus incoming edges.
 * - `downstream`: follows reverse-`deps` plus outgoing edges.
 *
 * @param described - `graph.describe()` output to traverse.
 * @param from - Start path (qualified node path).
 * @param direction - Traversal direction.
 * @param options - Optional max depth bound.
 * @returns Sorted list of reachable paths (excluding `from`).
 *
 * @example
 * ```ts
 * import { Graph, reachable } from "@graphrefly/graphrefly-ts";
 *
 * const g = new Graph("app");
 * const a = g.register("a");
 * const b = g.register("b", [a]);
 * const described = g.describe();
 *
 * reachable(described, "app.a", "downstream"); // ["app.b"]
 * reachable(described, "app.b", "upstream");   // ["app.a"]
 * ```
 */
export function reachable(
	described: GraphDescribeOutput,
	from: string,
	direction: ReachableDirection,
	options: ReachableOptions = {},
): string[] {
	if (!from) return [];
	if (direction !== "upstream" && direction !== "downstream") {
		throw new Error(`reachable: direction must be "upstream" or "downstream"`);
	}
	const maxDepth = options.maxDepth;
	if (maxDepth != null && (!Number.isInteger(maxDepth) || maxDepth < 0)) {
		throw new Error(`reachable: maxDepth must be an integer >= 0`);
	}
	if (maxDepth === 0) return [];

	const depsByPath = new Map<string, string[]>();
	const reverseDeps = new Map<string, Set<string>>();
	const incomingEdges = new Map<string, Set<string>>();
	const outgoingEdges = new Map<string, Set<string>>();
	const universe = new Set<string>();

	const nodesRaw =
		described != null &&
		typeof described === "object" &&
		"nodes" in described &&
		typeof (described as Record<string, unknown>).nodes === "object" &&
		(described as Record<string, unknown>).nodes !== null &&
		!Array.isArray((described as Record<string, unknown>).nodes)
			? ((described as Record<string, unknown>).nodes as Record<string, unknown>)
			: {};
	const edgesRaw =
		described != null &&
		typeof described === "object" &&
		"edges" in described &&
		Array.isArray((described as Record<string, unknown>).edges)
			? ((described as Record<string, unknown>).edges as unknown[])
			: [];

	for (const [path, node] of Object.entries(nodesRaw)) {
		if (!path) continue;
		universe.add(path);
		const deps =
			node != null && typeof node === "object" && Array.isArray((node as { deps?: unknown[] }).deps)
				? (node as { deps: unknown[] }).deps
				: [];
		const cleanDeps = deps.filter((d): d is string => typeof d === "string" && d.length > 0);
		depsByPath.set(path, cleanDeps);
		for (const dep of cleanDeps) {
			universe.add(dep);
			if (!reverseDeps.has(dep)) reverseDeps.set(dep, new Set());
			reverseDeps.get(dep)!.add(path);
		}
	}
	for (const edge of edgesRaw) {
		if (edge == null || typeof edge !== "object") continue;
		const edgeFrom =
			"from" in edge && typeof (edge as { from?: unknown }).from === "string"
				? ((edge as { from: string }).from as string)
				: "";
		const edgeTo =
			"to" in edge && typeof (edge as { to?: unknown }).to === "string"
				? ((edge as { to: string }).to as string)
				: "";
		if (!edgeFrom || !edgeTo) continue;
		universe.add(edgeFrom);
		universe.add(edgeTo);
		if (!outgoingEdges.has(edgeFrom)) outgoingEdges.set(edgeFrom, new Set());
		outgoingEdges.get(edgeFrom)!.add(edgeTo);
		if (!incomingEdges.has(edgeTo)) incomingEdges.set(edgeTo, new Set());
		incomingEdges.get(edgeTo)!.add(edgeFrom);
	}

	if (!universe.has(from)) return [];

	const neighbors = (path: string): string[] => {
		if (direction === "upstream") {
			const depNeighbors = depsByPath.get(path) ?? [];
			const edgeNeighbors = [...(incomingEdges.get(path) ?? [])];
			return [...depNeighbors, ...edgeNeighbors];
		}
		const depNeighbors = [...(reverseDeps.get(path) ?? [])];
		const edgeNeighbors = [...(outgoingEdges.get(path) ?? [])];
		return [...depNeighbors, ...edgeNeighbors];
	};

	const visited = new Set<string>([from]);
	const out = new Set<string>();
	const queue: Array<{ path: string; depth: number }> = [{ path: from, depth: 0 }];
	while (queue.length > 0) {
		const next = queue.shift()!;
		if (maxDepth != null && next.depth >= maxDepth) continue;
		for (const nb of neighbors(next.path)) {
			if (!nb || visited.has(nb)) continue;
			visited.add(nb);
			out.add(nb);
			queue.push({ path: nb, depth: next.depth + 1 });
		}
	}

	return [...out].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
}
