/**
 * GraphBlueprint first slice (D173/D177).
 *
 * A blueprint is read-only audit/collaboration evidence over graph.topology(). It is not an
 * authoring spec, checkpoint, restore input, hash owner, or collaboration ownership artifact.
 */

import { canonicalTupleKey } from "../identity.js";
import {
	assertStrictJsonObject,
	type StrictJsonObject,
	type StrictJsonValue,
	stableJsonString,
	strictCanonicalJsonBytes,
} from "../json/codec.js";
import type { GraphTopologyEdge, GraphTopologySnapshot } from "./describe.js";

export const GRAPH_BLUEPRINT_VERSION = "graphrefly.blueprint.v1" as const;

export type GraphBlueprintJson = StrictJsonValue;

export type GraphBlueprintProvenance = StrictJsonObject;

export interface NormalizedGraphTopologyNode {
	readonly id: string;
	readonly name?: string;
	readonly factory: string;
	readonly deps: readonly string[];
	readonly meta?: Readonly<Record<string, GraphBlueprintJson>>;
}

export interface NormalizedGraphTopologySnapshot {
	readonly name?: string;
	readonly nodes: readonly NormalizedGraphTopologyNode[];
	readonly edges: readonly GraphTopologyEdge[];
	readonly subgraphs?: readonly NormalizedGraphTopologySnapshot[];
}

export type GraphBlueprintDiagnosticCode = "dangling-dep" | "duplicate-node-id" | "island-node";

export interface GraphBlueprintDiagnosticIssue {
	readonly severity: "warning" | "error";
	readonly code: GraphBlueprintDiagnosticCode;
	readonly message: string;
	readonly nodeId?: string;
	readonly from?: string;
	readonly to?: string;
}

export interface GraphBlueprintDiagnostics {
	readonly ok: boolean;
	readonly issues: readonly GraphBlueprintDiagnosticIssue[];
}

export type GraphBlueprintHashInput = "strictCanonicalTopologyBytes";

export interface GraphBlueprintHash {
	readonly kind: "topology";
	readonly algorithm: string;
	readonly input: GraphBlueprintHashInput;
	readonly value: string;
}

export interface GraphBlueprintHashOptions {
	readonly algorithm: string;
	readonly hash: (bytes: Uint8Array) => string | Promise<string>;
}

export interface GraphBlueprint {
	readonly version: typeof GRAPH_BLUEPRINT_VERSION;
	readonly topology: NormalizedGraphTopologySnapshot;
	readonly diagnostics?: GraphBlueprintDiagnostics;
	readonly provenance?: GraphBlueprintProvenance;
	readonly hash?: GraphBlueprintHash;
}

export interface GraphBlueprintOptions {
	/** Include graph-local structural diagnostics over the normalized topology. */
	readonly diagnostics?: boolean;
	/** Caller-supplied provenance only; environment enrichment stays outside Graph core (D177). */
	readonly provenance?: GraphBlueprintProvenance;
}

export function normalizeTopologyMeta(
	meta: Record<string, unknown>,
	label = "meta",
	kind = "graph meta",
): Readonly<Record<string, GraphBlueprintJson>> {
	try {
		return assertStrictJsonObject(meta, label);
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		throw new TypeError(`${label}: ${kind} must be strict JSON-compatible data (D177): ${message}`);
	}
}

/**
 * Normalize a graph topology into its canonical blueprint shape.
 *
 * @param snapshot - Graph topology snapshot or already-normalized topology.
 * @returns A normalized topology with derived edges and sorted nodes.
 * @example
 * ```ts
 * import { normalizeTopology } from "@graphrefly/ts/graph";
 *
 * const normalized = normalizeTopology({
 *   nodes: [{ id: "source", factory: "state", deps: [] }],
 *   edges: [],
 * });
 * ```
 * @category graph
 */
export function normalizeTopology(
	snapshot: GraphTopologySnapshot | NormalizedGraphTopologySnapshot,
): NormalizedGraphTopologySnapshot {
	return normalizeTopologySnapshot(snapshot as GraphTopologySnapshot, new WeakSet<object>(), "$");
}

function normalizeTopologySnapshot(
	snapshot: GraphTopologySnapshot,
	seen: WeakSet<object>,
	path: string,
): NormalizedGraphTopologySnapshot {
	if (snapshot === null || typeof snapshot !== "object") {
		throw new TypeError(`normalizeTopology: snapshot at ${path} must be an object`);
	}
	if (seen.has(snapshot)) {
		throw new TypeError(`normalizeTopology: circular subgraph reference at ${path}`);
	}
	seen.add(snapshot);
	try {
		const nodes = mapDense(snapshot.nodes, `${path}.nodes`, (node, index) => {
			const nodePath = `${path}.nodes[${index}]`;
			assertTopologyObject(node, nodePath);
			const id = topologyString(node.id, `${nodePath}.id`);
			const factory = topologyString(node.factory, `${nodePath}.factory`);
			const out: NormalizedGraphTopologyNode = {
				id,
				factory,
				deps: mapDense(node.deps, `${labelForNode(id)}.deps`, (dep, depIndex) =>
					topologyString(dep, `${labelForNode(id)}.deps[${depIndex}]`),
				),
			};
			if (node.name !== undefined) {
				(out as { name?: string }).name = topologyString(node.name, `${nodePath}.name`);
			}
			if (node.meta !== undefined) {
				(out as { meta?: Readonly<Record<string, GraphBlueprintJson>> }).meta =
					normalizeTopologyMeta(node.meta, `${labelForNode(id)}.meta`);
			}
			return out;
		}).sort(compareNodes);
		const out: NormalizedGraphTopologySnapshot = {
			nodes,
			edges: deriveEdges(nodes),
		};
		if (snapshot.name !== undefined) {
			(out as { name?: string }).name = topologyString(snapshot.name, `${path}.name`);
		}
		if (snapshot.subgraphs !== undefined) {
			(out as { subgraphs?: readonly NormalizedGraphTopologySnapshot[] }).subgraphs = mapDense(
				snapshot.subgraphs,
				`${path}.subgraphs`,
				(subgraph, index) =>
					normalizeTopologySnapshot(subgraph, seen, `${path}.subgraphs[${index}]`),
			).sort(compareTopologies);
		}
		return out;
	} finally {
		seen.delete(snapshot);
	}
}

function mapDense<T, U>(
	values: readonly T[],
	path: string,
	mapper: (value: T, index: number) => U,
): U[] {
	if (!Array.isArray(values)) {
		throw new TypeError(`normalizeTopology: ${path} must be an array`);
	}
	const out: U[] = [];
	for (let i = 0; i < values.length; i += 1) {
		if (!(i in values)) {
			throw new TypeError(`normalizeTopology: sparse array hole at ${path}[${i}]`);
		}
		out.push(mapper(values[i] as T, i));
	}
	return out;
}

function assertTopologyObject(
	value: unknown,
	path: string,
): asserts value is Record<string, unknown> {
	if (value === null || typeof value !== "object" || Array.isArray(value)) {
		throw new TypeError(`normalizeTopology: ${path} must be an object`);
	}
}

function topologyString(value: unknown, path: string): string {
	if (typeof value !== "string") {
		throw new TypeError(`normalizeTopology: ${path} must be a string`);
	}
	return value;
}

/**
 * Serialize a topology to the canonical blueprint JSON string.
 *
 * @param snapshot - Graph topology snapshot or normalized topology.
 * @returns A deterministic JSON string for the normalized topology.
 * @example
 * ```ts
 * import { canonicalTopologyJson } from "@graphrefly/ts/graph";
 *
 * canonicalTopologyJson({
 *   nodes: [{ id: "source", factory: "state", deps: [] }],
 *   edges: [],
 * });
 * ```
 * @category graph
 */
export function canonicalTopologyJson(
	snapshot: GraphTopologySnapshot | NormalizedGraphTopologySnapshot,
): string {
	return stableJsonString(normalizeTopology(snapshot as GraphTopologySnapshot));
}

/**
 * Serialize a topology to canonical JSON bytes.
 *
 * @param snapshot - Graph topology snapshot or normalized topology.
 * @returns The canonical byte representation used for blueprint hashing.
 * @example
 * ```ts
 * import { canonicalTopologyBytes } from "@graphrefly/ts/graph";
 *
 * canonicalTopologyBytes({
 *   nodes: [{ id: "source", factory: "state", deps: [] }],
 *   edges: [],
 * });
 * ```
 * @category graph
 */
export function canonicalTopologyBytes(
	snapshot: GraphTopologySnapshot | NormalizedGraphTopologySnapshot,
): Uint8Array {
	return strictCanonicalJsonBytes(normalizeTopology(snapshot as GraphTopologySnapshot));
}

/**
 * Attach a content hash to a graph blueprint.
 *
 * @param blueprint - Blueprint to augment.
 * @param options - Hash algorithm and hashing function.
 * @returns The blueprint with a computed `hash` field, or a Promise for one.
 * @example
 * ```ts
 * import { GRAPH_BLUEPRINT_VERSION, normalizeTopology, withBlueprintHash } from "@graphrefly/ts/graph";
 *
 * const blueprint = {
 *   version: GRAPH_BLUEPRINT_VERSION,
 *   topology: normalizeTopology({ nodes: [], edges: [] }),
 * };
 * await withBlueprintHash(blueprint, {
 *   algorithm: "sha256",
 *   hash: async () => "abc123",
 * });
 * ```
 * @category graph
 */
export function withBlueprintHash(
	blueprint: GraphBlueprint,
	options: GraphBlueprintHashOptions,
): GraphBlueprint | Promise<GraphBlueprint> {
	if (typeof options.algorithm !== "string" || options.algorithm.length === 0) {
		throw new TypeError("withBlueprintHash: algorithm must be a non-empty string");
	}
	const topology = normalizeTopology(blueprint.topology);
	const withHash = (value: string): GraphBlueprint => {
		if (typeof value !== "string" || value.length === 0) {
			throw new TypeError("withBlueprintHash: hash value must be a non-empty string");
		}
		return {
			...blueprint,
			topology,
			hash: {
				kind: "topology",
				algorithm: options.algorithm,
				input: "strictCanonicalTopologyBytes",
				value,
			},
		};
	};
	const value = options.hash(canonicalTopologyBytes(topology));
	if (typeof value !== "string" || value.length === 0) {
		const maybeThenable = value as { then?: unknown } | null | undefined;
		if (
			maybeThenable === null ||
			maybeThenable === undefined ||
			typeof maybeThenable.then !== "function"
		) {
			throw new TypeError("withBlueprintHash: hash value must be a non-empty string");
		}
		return (value as Promise<string>).then(withHash);
	}
	return withHash(value);
}

/**
 * Attach caller-supplied provenance data to a blueprint.
 *
 * @param blueprint - Blueprint to augment.
 * @param provenance - Strict JSON provenance payload.
 * @returns The blueprint with normalized provenance attached.
 * @example
 * ```ts
 * import {
 *   GRAPH_BLUEPRINT_VERSION,
 *   normalizeTopology,
 *   withBlueprintProvenance,
 * } from "@graphrefly/ts/graph";
 *
 * const blueprint = {
 *   version: GRAPH_BLUEPRINT_VERSION,
 *   topology: normalizeTopology({ nodes: [], edges: [] }),
 * };
 * withBlueprintProvenance(blueprint, { source: "snapshot" });
 * ```
 * @category graph
 */
export function withBlueprintProvenance(
	blueprint: GraphBlueprint,
	provenance: GraphBlueprintProvenance,
): GraphBlueprint {
	return {
		...blueprint,
		provenance: normalizeTopologyMeta(provenance, "graph blueprint provenance", "provenance"),
	};
}

/**
 * Diagnose structural issues in a normalized graph topology.
 *
 * @param topology - Normalized topology to inspect.
 * @returns A diagnostics summary and any structural issues found.
 * @example
 * ```ts
 * import { graphBlueprintDiagnostics, normalizeTopology } from "@graphrefly/ts/graph";
 *
 * graphBlueprintDiagnostics(normalizeTopology({
 *   nodes: [{ id: "source", factory: "state", deps: [] }],
 *   edges: [],
 * }));
 * ```
 * @category graph
 */
export function graphBlueprintDiagnostics(
	topology: NormalizedGraphTopologySnapshot,
): GraphBlueprintDiagnostics {
	const issues: GraphBlueprintDiagnosticIssue[] = [];
	collectDiagnostics(topology, issues);
	issues.sort(compareIssues);
	return { ok: !issues.some((issue) => issue.severity === "error"), issues };
}

function collectDiagnostics(
	topology: NormalizedGraphTopologySnapshot,
	issues: GraphBlueprintDiagnosticIssue[],
): void {
	const seen = new Set<string>();
	const duplicateIds = new Set<string>();
	for (const node of topology.nodes) {
		if (seen.has(node.id)) duplicateIds.add(node.id);
		seen.add(node.id);
	}
	for (const id of duplicateIds) {
		issues.push({
			severity: "error",
			code: "duplicate-node-id",
			nodeId: id,
			message: `duplicate topology node id '${id}'`,
		});
	}

	const dependents = new Map<string, number>();
	for (const node of topology.nodes) dependents.set(node.id, 0);
	for (const node of topology.nodes) {
		for (const dep of node.deps) {
			if (!seen.has(dep)) {
				issues.push({
					severity: "error",
					code: "dangling-dep",
					nodeId: node.id,
					from: dep,
					to: node.id,
					message: `node '${node.id}' depends on missing node '${dep}'`,
				});
				continue;
			}
			dependents.set(dep, (dependents.get(dep) ?? 0) + 1);
		}
	}
	for (const node of topology.nodes) {
		if (node.deps.length === 0 && (dependents.get(node.id) ?? 0) === 0) {
			issues.push({
				severity: "warning",
				code: "island-node",
				nodeId: node.id,
				message: `node '${node.id}' has no deps and no dependents`,
			});
		}
	}

	for (const subgraph of topology.subgraphs ?? []) collectDiagnostics(subgraph, issues);
}

function deriveEdges(nodes: readonly NormalizedGraphTopologyNode[]): GraphTopologyEdge[] {
	const seen = new Set<string>();
	const edges: GraphTopologyEdge[] = [];
	for (const node of nodes) {
		for (const from of node.deps) {
			const key = canonicalTupleKey([from, node.id]);
			if (seen.has(key)) continue;
			seen.add(key);
			edges.push({ from, to: node.id });
		}
	}
	return edges.sort(compareEdges);
}

function labelForNode(id: string): string {
	return id === "" ? "node" : `node '${id}'`;
}

function compareText(a: string, b: string): number {
	return a < b ? -1 : a > b ? 1 : 0;
}

function compareNodes(a: NormalizedGraphTopologyNode, b: NormalizedGraphTopologyNode): number {
	return compareText(a.id, b.id);
}

function compareEdges(a: GraphTopologyEdge, b: GraphTopologyEdge): number {
	return compareText(a.from, b.from) || compareText(a.to, b.to);
}

function compareTopologies(
	a: NormalizedGraphTopologySnapshot,
	b: NormalizedGraphTopologySnapshot,
): number {
	return compareText(stableJsonString(a), stableJsonString(b));
}

function compareIssues(a: GraphBlueprintDiagnosticIssue, b: GraphBlueprintDiagnosticIssue): number {
	return (
		compareText(a.code, b.code) ||
		compareText(a.nodeId ?? "", b.nodeId ?? "") ||
		compareText(a.from ?? "", b.from ?? "") ||
		compareText(a.to ?? "", b.to ?? "")
	);
}
