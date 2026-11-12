/**
 * Pure renderers over `InspectSnapshot` (D39 / D40 tail).
 *
 * Render is graph-layer presentation: no Graph method, no topology mutation, no substrate behavior.
 */

import { canonicalTupleKey } from "../identity.js";
import type { Status } from "../node/types.js";
import {
	type GraphBlueprint,
	graphBlueprintDiagnostics,
	type NormalizedGraphTopologySnapshot,
} from "./blueprint.js";
import { parseGraphBlueprint } from "./blueprint-evidence.js";
import type { InspectEdge, InspectNode, InspectSnapshot } from "./describe.js";

export type DiagramDirection = "TD" | "LR" | "BT" | "RL";

export interface InspectToMermaidOptions {
	/** Diagram direction; default "LR". */
	direction?: DiagramDirection;
}

/** Diagram options for Blueprint-direct Mermaid rendering. */
export type GraphBlueprintToMermaidOptions = InspectToMermaidOptions;

export type MermaidLiveTheme = "default" | "dark" | "forest" | "neutral" | "base";

export interface MermaidLiveUrlOptions {
	/** Mermaid Live theme; default "default". */
	theme?: MermaidLiveTheme;
	/** Mermaid Live auto-sync flag; default true. */
	autoSync?: boolean;
}

export interface InspectToMermaidUrlOptions
	extends InspectToMermaidOptions,
		MermaidLiveUrlOptions {}

export interface InspectToD2Options {
	/** Diagram direction; default "LR". */
	direction?: DiagramDirection;
}

export interface InspectToPrettyOptions {
	/** Include the Edges section; default true. */
	includeEdges?: boolean;
}

export interface InspectToAsciiOptions {
	/** Include cached values; default false. */
	includeValues?: boolean;
}

export interface InspectToJsonOptions {
	/** Include edges; default true. */
	includeEdges?: boolean;
	/** JSON indent; default 2. */
	indent?: number;
}

interface FlatSnapshot {
	name?: string;
	nodes: InspectNode[];
	edges: InspectEdge[];
}

/** Render a D39 describe snapshot as Mermaid flowchart text.
 * @param snapshot - snapshot value used by the helper.
 * @param opts - Options that configure the helper.
 * @returns A `string` value.
 * @category graph
 * @example
 * ```ts
 * import { inspectToMermaid } from "@graphrefly/ts/graph";
 * ```
 */
export function inspectToMermaid(
	snapshot: InspectSnapshot,
	opts: InspectToMermaidOptions = {},
): string {
	const direction = normalizeDirection(opts.direction);
	const flat = flattenDescribe(snapshot);
	const nodes = sortedNodes(flat.nodes);
	const ids = new Map<string, string>();
	for (let i = 0; i < nodes.length; i += 1) ids.set(nodes[i]!.id, `n${i}`);

	const lines = [`flowchart ${direction}`];
	for (const node of nodes) {
		lines.push(`  ${ids.get(node.id)!}["${escapeMermaidLabel(node.id)}"]`);
	}
	for (const edge of sortedEdges(flat.edges)) {
		const from = ids.get(edge.from);
		const to = ids.get(edge.to);
		if (from === undefined || to === undefined) continue;
		lines.push(`  ${from} --> ${to}`);
	}
	return lines.join("\n");
}

/** Render a portable D629/D630 GraphBlueprint directly as deterministic Mermaid source.
 *
 * Unlike {@link inspectToMermaid}, this helper consumes only the versioned Blueprint evidence
 * envelope. It never reads runtime values, status, or a live Graph.
 *
 * @param blueprint - Portable GraphBlueprint evidence.
 * @param opts - Diagram direction.
 * @returns Deterministic Mermaid flowchart source preserving subgraph groups.
 * @category graph
 */
export function blueprintToMermaid(
	blueprint: GraphBlueprint,
	opts: GraphBlueprintToMermaidOptions = {},
): string {
	const parsed = parseGraphBlueprint(blueprint);
	const diagnostics = graphBlueprintDiagnostics(parsed.topology);
	if (!diagnostics.ok) {
		throw new TypeError("blueprintToMermaid: cannot render a topology with error diagnostics");
	}
	const direction = normalizeDirection(opts.direction);
	const lines = [`flowchart ${direction}`];
	let nodeIndex = 0;
	let subgraphIndex = 0;

	const visit = (
		topology: NormalizedGraphTopologySnapshot,
		indent: string,
		root: boolean,
	): void => {
		let childIndent = indent;
		if (!root) {
			const alias = `sg${subgraphIndex++}`;
			const label = topology.name ?? (topology.mountId as string);
			lines.push(`${indent}subgraph ${alias}["${escapeMermaidLabel(label)}"]`);
			childIndent = `${indent}  `;
		}
		const aliases = new Map<string, string>();
		for (const node of topology.nodes) {
			const alias = `n${nodeIndex++}`;
			aliases.set(node.id, alias);
			lines.push(`${childIndent}${alias}["${escapeMermaidLabel(node.id)}"]`);
		}
		for (const edge of topology.edges) {
			const from = aliases.get(edge.from);
			const to = aliases.get(edge.to);
			if (from === undefined || to === undefined) {
				throw new TypeError(
					`blueprintToMermaid: edge '${edge.from}' -> '${edge.to}' cannot be resolved locally`,
				);
			}
			lines.push(`${childIndent}${from} --> ${to}`);
		}
		for (const child of topology.subgraphs ?? []) visit(child, childIndent, false);
		if (!root) lines.push(`${indent}end`);
	};

	visit(parsed.topology, "  ", true);
	return lines.join("\n");
}

/** Encode arbitrary Mermaid source as a mermaid.live deep link.
 * @param mermaidSource - mermaid source value used by the helper.
 * @param opts - Options that configure the helper.
 * @returns A `string` value.
 * @category graph
 * @example
 * ```ts
 * import { mermaidLiveUrl } from "@graphrefly/ts/graph";
 * ```
 */
export function mermaidLiveUrl(mermaidSource: string, opts: MermaidLiveUrlOptions = {}): string {
	const payload = {
		code: mermaidSource,
		mermaid: { theme: opts.theme ?? "default" },
		autoSync: opts.autoSync ?? true,
	};
	return `https://mermaid.live/edit#base64:${base64UrlEncode(JSON.stringify(payload))}`;
}

/** Render a D39 describe snapshot as a mermaid.live deep link.
 * @param snapshot - snapshot value used by the helper.
 * @param opts - Options that configure the helper.
 * @returns A `string` value.
 * @category graph
 * @example
 * ```ts
 * import { inspectToMermaidUrl } from "@graphrefly/ts/graph";
 * ```
 */
export function inspectToMermaidUrl(
	snapshot: InspectSnapshot,
	opts: InspectToMermaidUrlOptions = {},
): string {
	return mermaidLiveUrl(inspectToMermaid(snapshot, opts), opts);
}

/** Render a D39 describe snapshot as D2 diagram text.
 * @param snapshot - snapshot value used by the helper.
 * @param opts - Options that configure the helper.
 * @returns A `string` value.
 * @category graph
 * @example
 * ```ts
 * import { inspectToD2 } from "@graphrefly/ts/graph";
 * ```
 */
export function inspectToD2(snapshot: InspectSnapshot, opts: InspectToD2Options = {}): string {
	const direction = normalizeDirection(opts.direction);
	const flat = flattenDescribe(snapshot);
	const nodes = sortedNodes(flat.nodes);
	const ids = new Map<string, string>();
	for (let i = 0; i < nodes.length; i += 1) ids.set(nodes[i]!.id, `n${i}`);

	const lines = [`direction: ${d2Direction(direction)}`];
	for (const node of nodes) {
		lines.push(`${ids.get(node.id)!}: "${escapeD2Label(node.id)}"`);
	}
	for (const edge of sortedEdges(flat.edges)) {
		const from = ids.get(edge.from);
		const to = ids.get(edge.to);
		if (from === undefined || to === undefined) continue;
		lines.push(`${from} -> ${to}`);
	}
	return lines.join("\n");
}

/** A Status (R-node@2) as `cache/output/lifecycle`, for the text renderers. */
function statusLabel(status: Status): string {
	return `${status.cache}/${status.output}/${status.lifecycle}`;
}

/** Render a D39 describe snapshot as compact human-readable plaintext.
 * @param snapshot - snapshot value used by the helper.
 * @param opts - Options that configure the helper.
 * @returns A `string` value.
 * @category graph
 * @example
 * ```ts
 * import { inspectToPretty } from "@graphrefly/ts/graph";
 * ```
 */
export function inspectToPretty(
	snapshot: InspectSnapshot,
	opts: InspectToPrettyOptions = {},
): string {
	const flat = flattenDescribe(snapshot);
	const includeEdges = opts.includeEdges ?? true;
	const lines: string[] = [`Graph ${flat.name ?? "(anonymous)"}`, "Nodes:"];
	for (const node of sortedNodes(flat.nodes)) {
		lines.push(`- ${node.id} (${node.factory}/${statusLabel(node.status)}): ${formatValue(node)}`);
	}
	if (includeEdges) {
		lines.push("Edges:");
		for (const edge of sortedEdges(flat.edges)) lines.push(`- ${edge.from} -> ${edge.to}`);
	}
	return lines.join("\n");
}

/** Render a D39 describe snapshot as a compact ASCII adjacency diagram.
 * @param snapshot - snapshot value used by the helper.
 * @param opts - Options that configure the helper.
 * @returns A `string` value.
 * @category graph
 * @example
 * ```ts
 * import { inspectToAscii } from "@graphrefly/ts/graph";
 * ```
 */
export function inspectToAscii(
	snapshot: InspectSnapshot,
	opts: InspectToAsciiOptions = {},
): string {
	const flat = flattenDescribe(snapshot);
	const outgoing = new Map<string, string[]>();
	for (const edge of sortedEdges(flat.edges)) {
		const list = outgoing.get(edge.from);
		if (list) list.push(edge.to);
		else outgoing.set(edge.from, [edge.to]);
	}
	const lines: string[] = [`Graph ${flat.name ?? "(anonymous)"}`];
	for (const node of sortedNodes(flat.nodes)) {
		const value = opts.includeValues ? ` ${formatValue(node)}` : "";
		const to = outgoing.get(node.id)?.join(", ") ?? "-";
		lines.push(`${node.id} [${node.factory}/${statusLabel(node.status)}${value}] -> ${to}`);
	}
	return lines.join("\n");
}

/** Render a D39 describe snapshot as deterministic JSON text.
 * @param snapshot - snapshot value used by the helper.
 * @param opts - Options that configure the helper.
 * @returns A `string` value.
 * @category graph
 * @example
 * ```ts
 * import { inspectToJson } from "@graphrefly/ts/graph";
 * ```
 */
export function inspectToJson(snapshot: InspectSnapshot, opts: InspectToJsonOptions = {}): string {
	const includeEdges = opts.includeEdges ?? true;
	const flat = flattenDescribe(snapshot);
	const payload: FlatSnapshot = {
		...(flat.name !== undefined ? { name: flat.name } : {}),
		nodes: sortedNodes(flat.nodes).map((node) => sortJsonValue(node) as InspectNode),
		edges: includeEdges ? sortedEdges(flat.edges) : [],
	};
	return JSON.stringify(sortJsonValue(payload), null, opts.indent ?? 2);
}

function flattenDescribe(snapshot: InspectSnapshot): FlatSnapshot {
	const nodes: InspectNode[] = [];
	const edges: InspectEdge[] = [];
	const visit = (snap: InspectSnapshot): void => {
		nodes.push(...snap.nodes);
		edges.push(...snap.edges);
		for (const child of snap.subgraphs ?? []) visit(child);
	};
	visit(snapshot);
	return { ...(snapshot.name !== undefined ? { name: snapshot.name } : {}), nodes, edges };
}

function sortedNodes(nodes: readonly InspectNode[]): InspectNode[] {
	return [...nodes].sort((a, b) => compareText(a.id, b.id));
}

function sortedEdges(edges: readonly InspectEdge[]): InspectEdge[] {
	const seen = new Set<string>();
	const out: InspectEdge[] = [];
	for (const edge of edges) {
		const key = canonicalTupleKey([edge.from, edge.to]);
		if (seen.has(key)) continue;
		seen.add(key);
		out.push(edge);
	}
	return out.sort((a, b) => compareText(a.from, b.from) || compareText(a.to, b.to));
}

function compareText(a: string, b: string): number {
	return a < b ? -1 : a > b ? 1 : 0;
}

function normalizeDirection(direction: unknown): DiagramDirection {
	if (direction === undefined) return "LR";
	if (direction === "TD" || direction === "LR" || direction === "BT" || direction === "RL") {
		return direction;
	}
	throw new Error(
		`invalid diagram direction ${String(direction)}; expected one of: TD, LR, BT, RL`,
	);
}

function d2Direction(direction: DiagramDirection): string {
	if (direction === "TD") return "down";
	if (direction === "BT") return "up";
	if (direction === "RL") return "left";
	return "right";
}

function escapeMermaidLabel(value: string): string {
	return escapeQuotedLabel(value);
}

function escapeD2Label(value: string): string {
	return escapeQuotedLabel(value);
}

function escapeQuotedLabel(value: string): string {
	return JSON.stringify(value).slice(1, -1);
}

function formatValue(node: InspectNode): string {
	if (!("value" in node)) return "<SENTINEL>";
	const value = node.value;
	if (typeof value === "string") return JSON.stringify(value);
	if (typeof value === "number" || typeof value === "boolean" || value == null)
		return String(value);
	try {
		return JSON.stringify(value);
	} catch {
		return "[unserializable]";
	}
}

function sortJsonValue(value: unknown, seen: WeakSet<object> = new WeakSet()): unknown {
	if (typeof value === "bigint") return value.toString();
	if (value === null || typeof value !== "object") return value;
	if (seen.has(value)) return "[Circular]";
	seen.add(value);
	if (Array.isArray(value)) {
		const out = value.map((item) => sortJsonValue(item, seen));
		seen.delete(value);
		return out;
	}
	const obj = value as Record<string, unknown>;
	const out: Record<string, unknown> = {};
	for (const key of Object.keys(obj).sort(compareText)) out[key] = sortJsonValue(obj[key], seen);
	seen.delete(value);
	return out;
}

const B64 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

function base64UrlEncode(value: string): string {
	const bytes = utf8Bytes(value);
	let out = "";
	for (let i = 0; i < bytes.length; i += 3) {
		const a = bytes[i]!;
		const b = bytes[i + 1];
		const c = bytes[i + 2];
		out += B64[a >> 2];
		out += B64[((a & 0x03) << 4) | ((b ?? 0) >> 4)];
		out += b === undefined ? "=" : B64[((b & 0x0f) << 2) | ((c ?? 0) >> 6)];
		out += c === undefined ? "=" : B64[c & 0x3f];
	}
	return out.replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
}

function utf8Bytes(value: string): number[] {
	const bytes: number[] = [];
	for (let i = 0; i < value.length; i += 1) {
		let cp = value.charCodeAt(i);
		if (cp >= 0xd800 && cp <= 0xdbff && i + 1 < value.length) {
			const lo = value.charCodeAt(i + 1);
			if (lo >= 0xdc00 && lo <= 0xdfff) {
				cp = 0x10000 + ((cp - 0xd800) << 10) + (lo - 0xdc00);
				i += 1;
			}
		}
		if (cp <= 0x7f) bytes.push(cp);
		else if (cp <= 0x7ff) bytes.push(0xc0 | (cp >> 6), 0x80 | (cp & 0x3f));
		else if (cp <= 0xffff)
			bytes.push(0xe0 | (cp >> 12), 0x80 | ((cp >> 6) & 0x3f), 0x80 | (cp & 0x3f));
		else
			bytes.push(
				0xf0 | (cp >> 18),
				0x80 | ((cp >> 12) & 0x3f),
				0x80 | ((cp >> 6) & 0x3f),
				0x80 | (cp & 0x3f),
			);
	}
	return bytes;
}
