/** Portable GraphBlueprint evidence helpers (D629/D630). */

import { canonicalTupleKey } from "../identity.js";
import { assertStrictJsonObject, type StrictJsonObject, stableJsonString } from "../json/codec.js";
import {
	canonicalTopologyBytes,
	GRAPH_BLUEPRINT_VERSION,
	GRAPH_BLUEPRINT_VERSION_V1,
	type GraphBlueprintDiagnosticCode,
	type GraphBlueprintDiagnosticIssue,
	type GraphBlueprintDiagnostics,
	type GraphBlueprintEvidence,
	type GraphBlueprintHash,
	type GraphBlueprintHashOptions,
	type GraphBlueprintVersion,
	graphBlueprintDiagnostics,
	type NormalizedGraphTopologyNode,
	type NormalizedGraphTopologySnapshot,
	normalizeTopology,
} from "./blueprint.js";
import type { GraphTopologyEdge } from "./describe.js";

/** Version of the deterministic intrinsic Blueprint delta envelope. */
export const GRAPH_BLUEPRINT_DELTA_VERSION = "graphrefly.blueprint-delta.v1" as const;

/** Root-relative stable mount path; empty for root-level node and edge events. */
export type GraphBlueprintTopologyPath = readonly string[];

/** Closed structural event vocabulary emitted by {@link diffGraphBlueprints}. */
export type GraphBlueprintDeltaEvent =
	| {
			readonly type: "subgraph-added";
			readonly topologyPath: GraphBlueprintTopologyPath;
			readonly topology: NormalizedGraphTopologySnapshot;
	  }
	| {
			readonly type: "node-added";
			readonly topologyPath: GraphBlueprintTopologyPath;
			readonly node: NormalizedGraphTopologyNode;
	  }
	| {
			readonly type: "node-changed";
			readonly topologyPath: GraphBlueprintTopologyPath;
			readonly before: NormalizedGraphTopologyNode;
			readonly after: NormalizedGraphTopologyNode;
	  }
	| {
			readonly type: "edge-added";
			readonly topologyPath: GraphBlueprintTopologyPath;
			readonly edge: GraphTopologyEdge;
	  }
	| {
			readonly type: "edge-removed";
			readonly topologyPath: GraphBlueprintTopologyPath;
			readonly edge: GraphTopologyEdge;
	  }
	| {
			readonly type: "node-removed";
			readonly topologyPath: GraphBlueprintTopologyPath;
			readonly node: NormalizedGraphTopologyNode;
	  }
	| {
			readonly type: "subgraph-removed";
			readonly topologyPath: GraphBlueprintTopologyPath;
			readonly topology: NormalizedGraphTopologySnapshot;
	  };

/** Versioned deterministic structural difference between equal-version Blueprints. */
export interface GraphBlueprintDelta {
	readonly version: typeof GRAPH_BLUEPRINT_DELTA_VERSION;
	readonly fromBlueprintVersion: GraphBlueprintVersion;
	readonly toBlueprintVersion: GraphBlueprintVersion;
	readonly fromHash?: GraphBlueprintHash;
	readonly toHash?: GraphBlueprintHash;
	readonly events: readonly GraphBlueprintDeltaEvent[];
}

const BLUEPRINT_KEYS = new Set(["version", "topology", "diagnostics", "provenance", "hash"]);
const TOPOLOGY_V1_KEYS = new Set(["name", "nodes", "edges", "subgraphs"]);
const TOPOLOGY_V2_KEYS = new Set(["mountId", "name", "nodes", "edges", "subgraphs"]);
const NODE_KEYS = new Set(["id", "name", "factory", "deps", "meta"]);
const EDGE_KEYS = new Set(["from", "to"]);
const DIAGNOSTICS_KEYS = new Set(["ok", "issues"]);
const ISSUE_KEYS = new Set(["severity", "code", "message", "nodeId", "from", "to"]);
const HASH_KEYS = new Set(["kind", "algorithm", "input", "value"]);
const DIAGNOSTIC_CODES = new Set<GraphBlueprintDiagnosticCode>([
	"dangling-dep",
	"duplicate-node-id",
	"island-node",
]);

/**
 * Strictly parse and normalize a portable GraphBlueprint evidence value.
 *
 * Unknown versions and fields fail closed. Diagnostics, when present, must exactly describe the
 * normalized topology; hash bytes are verified separately with {@link verifyBlueprintHash}.
 *
 * @param value - Untrusted value read from a wire artifact or another process.
 * @returns A deeply frozen normalized GraphBlueprint.
 * @category graph
 */
export function parseGraphBlueprint(value: unknown): GraphBlueprintEvidence {
	const input = assertStrictJsonObject(value, "GraphBlueprint") as Record<string, unknown>;
	assertKnownKeys(input, BLUEPRINT_KEYS, "GraphBlueprint");
	if (input.version !== GRAPH_BLUEPRINT_VERSION && input.version !== GRAPH_BLUEPRINT_VERSION_V1) {
		throw new TypeError(
			`GraphBlueprint.version must be '${GRAPH_BLUEPRINT_VERSION_V1}' or '${GRAPH_BLUEPRINT_VERSION}', received ${String(input.version)}`,
		);
	}
	const version = input.version;

	const topology = parseTopology(input.topology, "GraphBlueprint.topology", version, true);
	const out: {
		version: GraphBlueprintVersion;
		topology: NormalizedGraphTopologySnapshot;
		diagnostics?: GraphBlueprintDiagnostics;
		provenance?: StrictJsonObject;
		hash?: GraphBlueprintHash;
	} = { version, topology };

	if (input.diagnostics !== undefined) {
		const diagnostics = parseDiagnostics(input.diagnostics);
		const expected = graphBlueprintDiagnostics(topology);
		if (stableJsonString(diagnostics) !== stableJsonString(expected)) {
			throw new TypeError("GraphBlueprint.diagnostics does not match the normalized topology");
		}
		out.diagnostics = diagnostics;
	}
	if (input.provenance !== undefined) {
		out.provenance = assertStrictJsonObject(input.provenance, "GraphBlueprint.provenance");
	}
	if (input.hash !== undefined) out.hash = parseHash(input.hash);
	return deepFreeze(out) as GraphBlueprintEvidence;
}

/**
 * Verify a Blueprint's recorded topology hash using caller-owned hashing.
 *
 * @param blueprint - Blueprint carrying optional hash metadata.
 * @param options - Expected algorithm and sync or async hash implementation.
 * @returns False for a missing or mismatched hash, or a Promise when the hash implementation is async.
 * @category graph
 */
export function verifyBlueprintHash(
	blueprint: GraphBlueprintEvidence,
	options: GraphBlueprintHashOptions,
): boolean | Promise<boolean> {
	if (typeof options.algorithm !== "string" || options.algorithm.length === 0) {
		throw new TypeError("verifyBlueprintHash: algorithm must be a non-empty string");
	}
	const parsed = parseGraphBlueprint(blueprint);
	if (parsed.hash === undefined || parsed.hash.algorithm !== options.algorithm) return false;
	const matches = (value: string): boolean => {
		if (typeof value !== "string" || value.length === 0) {
			throw new TypeError("verifyBlueprintHash: hash value must be a non-empty string");
		}
		return value === parsed.hash?.value;
	};
	const value = options.hash(canonicalTopologyBytes(parsed.topology));
	if (typeof value === "string") return matches(value);
	const maybeThenable = value as { then?: unknown } | null | undefined;
	if (
		maybeThenable === null ||
		maybeThenable === undefined ||
		typeof maybeThenable.then !== "function"
	) {
		throw new TypeError("verifyBlueprintHash: hash value must be a non-empty string");
	}
	return (value as Promise<string>).then(matches);
}

/**
 * Compute a canonical structural delta between two portable GraphBlueprints.
 *
 * Runtime values, diagnostics, provenance and hash metadata are not structural events.
 *
 * @param previous - Semantic parent Blueprint.
 * @param next - Current Blueprint.
 * @returns A deterministic v1 structural event set.
 * @category graph
 */
export function diffGraphBlueprints(
	previous: GraphBlueprintEvidence,
	next: GraphBlueprintEvidence,
): GraphBlueprintDelta {
	const before = parseGraphBlueprint(previous);
	const after = parseGraphBlueprint(next);
	if (before.version !== after.version) {
		throw new TypeError("diffGraphBlueprints: Blueprint versions must match");
	}
	if (
		!graphBlueprintDiagnostics(before.topology).ok ||
		!graphBlueprintDiagnostics(after.topology).ok
	) {
		throw new TypeError("diffGraphBlueprints: cannot diff a topology with error diagnostics");
	}
	const p = flattenTopology(before.topology, before.version);
	const n = flattenTopology(after.topology, after.version);
	const events: GraphBlueprintDeltaEvent[] = [];

	for (const key of addedKeys(p.subgraphs, n.subgraphs)) {
		const entry = n.subgraphs.get(key)!;
		events.push({ type: "subgraph-added", topologyPath: entry.path, topology: entry.topology });
	}
	for (const key of addedKeys(p.nodes, n.nodes)) {
		const entry = n.nodes.get(key)!;
		events.push({ type: "node-added", topologyPath: entry.path, node: entry.node });
	}
	for (const key of sharedKeys(p.nodes, n.nodes)) {
		const prior = p.nodes.get(key)!;
		const current = n.nodes.get(key)!;
		if (stableJsonString(prior.node) !== stableJsonString(current.node)) {
			events.push({
				type: "node-changed",
				topologyPath: current.path,
				before: prior.node,
				after: current.node,
			});
		}
	}
	for (const key of addedKeys(p.edges, n.edges)) {
		const entry = n.edges.get(key)!;
		events.push({ type: "edge-added", topologyPath: entry.path, edge: entry.edge });
	}
	for (const key of addedKeys(n.edges, p.edges)) {
		const entry = p.edges.get(key)!;
		events.push({ type: "edge-removed", topologyPath: entry.path, edge: entry.edge });
	}
	for (const key of addedKeys(n.nodes, p.nodes)) {
		const entry = p.nodes.get(key)!;
		events.push({ type: "node-removed", topologyPath: entry.path, node: entry.node });
	}
	for (const key of addedKeys(n.subgraphs, p.subgraphs).reverse()) {
		const entry = p.subgraphs.get(key)!;
		events.push({ type: "subgraph-removed", topologyPath: entry.path, topology: entry.topology });
	}

	return deepFreeze({
		version: GRAPH_BLUEPRINT_DELTA_VERSION,
		fromBlueprintVersion: before.version,
		toBlueprintVersion: after.version,
		...(before.hash === undefined ? {} : { fromHash: before.hash }),
		...(after.hash === undefined ? {} : { toHash: after.hash }),
		events,
	});
}

function parseTopology(
	value: unknown,
	label: string,
	version: GraphBlueprintVersion,
	root: boolean,
): NormalizedGraphTopologySnapshot {
	const input = objectValue(value, label);
	assertKnownKeys(
		input,
		version === GRAPH_BLUEPRINT_VERSION ? TOPOLOGY_V2_KEYS : TOPOLOGY_V1_KEYS,
		label,
	);
	let mountId: string | undefined;
	if (version === GRAPH_BLUEPRINT_VERSION) {
		if (root && input.mountId !== undefined) {
			throw new TypeError(`${label}.mountId must be absent on the root topology`);
		}
		if (!root) {
			mountId = stringValue(input.mountId, `${label}.mountId`);
			if (mountId.length === 0) throw new TypeError(`${label}.mountId must be non-empty`);
		}
	}
	if (input.name !== undefined) stringValue(input.name, `${label}.name`);
	const nodes = denseArray(input.nodes, `${label}.nodes`).map((nodeValue, index) => {
		const node = objectValue(nodeValue, `${label}.nodes[${index}]`);
		assertKnownKeys(node, NODE_KEYS, `${label}.nodes[${index}]`);
		const id = stringValue(node.id, `${label}.nodes[${index}].id`);
		const factory = stringValue(node.factory, `${label}.nodes[${index}].factory`);
		const deps = denseArray(node.deps, `${label}.nodes[${index}].deps`).map((dep, depIndex) =>
			stringValue(dep, `${label}.nodes[${index}].deps[${depIndex}]`),
		);
		return {
			id,
			factory,
			deps,
			...(node.name === undefined
				? {}
				: { name: stringValue(node.name, `${label}.nodes[${index}].name`) }),
			...(node.meta === undefined
				? {}
				: { meta: assertStrictJsonObject(node.meta, `${label}.nodes[${index}].meta`) }),
		};
	});
	const edges = denseArray(input.edges, `${label}.edges`).map((edgeValue, index) => {
		const edge = objectValue(edgeValue, `${label}.edges[${index}]`);
		assertKnownKeys(edge, EDGE_KEYS, `${label}.edges[${index}]`);
		return {
			from: stringValue(edge.from, `${label}.edges[${index}].from`),
			to: stringValue(edge.to, `${label}.edges[${index}].to`),
		};
	});
	const subgraphs =
		input.subgraphs === undefined
			? undefined
			: denseArray(input.subgraphs, `${label}.subgraphs`).map((subgraph, index) =>
					parseTopology(subgraph, `${label}.subgraphs[${index}]`, version, false),
				);
	if (version === GRAPH_BLUEPRINT_VERSION && subgraphs !== undefined) {
		const mountIds = new Set<string>();
		for (const child of subgraphs) {
			const childMountId = child.mountId as string;
			if (mountIds.has(childMountId)) {
				throw new TypeError(`${label}.subgraphs contains duplicate mountId '${childMountId}'`);
			}
			mountIds.add(childMountId);
		}
	}
	const raw: NormalizedGraphTopologySnapshot = {
		nodes,
		edges,
		...(mountId === undefined ? {} : { mountId }),
		...(input.name === undefined ? {} : { name: input.name as string }),
		...(subgraphs === undefined ? {} : { subgraphs }),
	};
	const normalized = normalizeTopology(raw);
	const suppliedEdges = [...edges].sort(compareEdges);
	if (stableJsonString(suppliedEdges) !== stableJsonString(normalized.edges)) {
		throw new TypeError(`${label}.edges must exactly match the edges derived from node deps`);
	}
	return normalized;
}

function parseDiagnostics(value: unknown): GraphBlueprintDiagnostics {
	const input = objectValue(value, "GraphBlueprint.diagnostics");
	assertKnownKeys(input, DIAGNOSTICS_KEYS, "GraphBlueprint.diagnostics");
	if (typeof input.ok !== "boolean") {
		throw new TypeError("GraphBlueprint.diagnostics.ok must be a boolean");
	}
	const issues = denseArray(input.issues, "GraphBlueprint.diagnostics.issues").map(
		(issueValue, index): GraphBlueprintDiagnosticIssue => {
			const label = `GraphBlueprint.diagnostics.issues[${index}]`;
			const issue = objectValue(issueValue, label);
			assertKnownKeys(issue, ISSUE_KEYS, label);
			if (issue.severity !== "warning" && issue.severity !== "error") {
				throw new TypeError(`${label}.severity must be 'warning' or 'error'`);
			}
			if (typeof issue.code !== "string" || !DIAGNOSTIC_CODES.has(issue.code as never)) {
				throw new TypeError(`${label}.code is not a supported GraphBlueprint diagnostic code`);
			}
			return {
				severity: issue.severity,
				code: issue.code as GraphBlueprintDiagnosticCode,
				message: stringValue(issue.message, `${label}.message`),
				...optionalStringField(issue, "nodeId", label),
				...optionalStringField(issue, "from", label),
				...optionalStringField(issue, "to", label),
			};
		},
	);
	return { ok: input.ok, issues };
}

function parseHash(value: unknown): GraphBlueprintHash {
	const input = objectValue(value, "GraphBlueprint.hash");
	assertKnownKeys(input, HASH_KEYS, "GraphBlueprint.hash");
	if (input.kind !== "topology") throw new TypeError("GraphBlueprint.hash.kind must be 'topology'");
	if (input.input !== "strictCanonicalTopologyBytes") {
		throw new TypeError("GraphBlueprint.hash.input must be 'strictCanonicalTopologyBytes'");
	}
	const algorithm = stringValue(input.algorithm, "GraphBlueprint.hash.algorithm");
	const hashValue = stringValue(input.value, "GraphBlueprint.hash.value");
	if (algorithm.length === 0 || hashValue.length === 0) {
		throw new TypeError("GraphBlueprint.hash algorithm and value must be non-empty strings");
	}
	return { kind: "topology", algorithm, input: "strictCanonicalTopologyBytes", value: hashValue };
}

interface FlatNodeEntry {
	path: GraphBlueprintTopologyPath;
	node: NormalizedGraphTopologyNode;
}

interface FlatEdgeEntry {
	path: GraphBlueprintTopologyPath;
	edge: GraphTopologyEdge;
}

interface FlatSubgraphEntry {
	path: GraphBlueprintTopologyPath;
	topology: NormalizedGraphTopologySnapshot;
}

function flattenTopology(
	topology: NormalizedGraphTopologySnapshot,
	version: GraphBlueprintVersion,
): {
	nodes: Map<string, FlatNodeEntry>;
	edges: Map<string, FlatEdgeEntry>;
	subgraphs: Map<string, FlatSubgraphEntry>;
} {
	const nodes = new Map<string, FlatNodeEntry>();
	const edges = new Map<string, FlatEdgeEntry>();
	const subgraphs = new Map<string, FlatSubgraphEntry>();
	const visit = (snapshot: NormalizedGraphTopologySnapshot, path: readonly string[]): void => {
		const pathKey = canonicalTupleKey(path);
		for (const node of snapshot.nodes) {
			nodes.set(canonicalTupleKey([pathKey, node.id]), { path, node });
		}
		for (const edge of snapshot.edges) {
			edges.set(canonicalTupleKey([pathKey, edge.from, edge.to]), { path, edge });
		}
		const children = snapshot.subgraphs ?? [];
		const nameCounts = new Map<string, number>();
		if (version === GRAPH_BLUEPRINT_VERSION_V1) {
			for (const child of children) {
				if (child.name === undefined || child.name.length === 0) {
					throw new TypeError("diffGraphBlueprints: v1 subgraphs require non-empty unique names");
				}
				nameCounts.set(child.name, (nameCounts.get(child.name) ?? 0) + 1);
			}
		}
		children.forEach((child) => {
			const segment =
				version === GRAPH_BLUEPRINT_VERSION ? (child.mountId as string) : (child.name as string);
			if (version === GRAPH_BLUEPRINT_VERSION_V1 && nameCounts.get(segment) !== 1) {
				throw new TypeError("diffGraphBlueprints: v1 subgraphs require non-empty unique names");
			}
			const childPath = [...path, segment];
			subgraphs.set(canonicalTupleKey(childPath), { path: childPath, topology: child });
			visit(child, childPath);
		});
	};
	visit(topology, []);
	return { nodes, edges, subgraphs };
}

function objectValue(value: unknown, label: string): Record<string, unknown> {
	if (value === null || typeof value !== "object" || Array.isArray(value)) {
		throw new TypeError(`${label} must be an object`);
	}
	return value as Record<string, unknown>;
}

function assertKnownKeys(
	value: Record<string, unknown>,
	allowed: ReadonlySet<string>,
	label: string,
): void {
	for (const key of Object.keys(value)) {
		if (!allowed.has(key)) throw new TypeError(`${label} contains unknown field '${key}'`);
	}
}

function denseArray(value: unknown, label: string): unknown[] {
	if (!Array.isArray(value)) throw new TypeError(`${label} must be an array`);
	for (let index = 0; index < value.length; index += 1) {
		if (!(index in value))
			throw new TypeError(`${label} contains a sparse array hole at [${index}]`);
	}
	return value;
}

function stringValue(value: unknown, label: string): string {
	if (typeof value !== "string") throw new TypeError(`${label} must be a string`);
	return value;
}

function optionalStringField(
	value: Record<string, unknown>,
	key: "nodeId" | "from" | "to",
	label: string,
): Partial<Record<typeof key, string>> {
	return value[key] === undefined ? {} : { [key]: stringValue(value[key], `${label}.${key}`) };
}

function compareText(left: string, right: string): number {
	return left < right ? -1 : left > right ? 1 : 0;
}

function compareEdges(left: GraphTopologyEdge, right: GraphTopologyEdge): number {
	return compareText(left.from, right.from) || compareText(left.to, right.to);
}

function addedKeys<T>(before: ReadonlyMap<string, T>, after: ReadonlyMap<string, T>): string[] {
	return [...after.keys()].filter((key) => !before.has(key)).sort(compareText);
}

function sharedKeys<T>(before: ReadonlyMap<string, T>, after: ReadonlyMap<string, T>): string[] {
	return [...after.keys()].filter((key) => before.has(key)).sort(compareText);
}

function deepFreeze<T>(value: T): T {
	if (value !== null && typeof value === "object" && !Object.isFrozen(value)) {
		for (const child of Object.values(value as Record<string, unknown>)) deepFreeze(child);
		Object.freeze(value);
	}
	return value;
}
