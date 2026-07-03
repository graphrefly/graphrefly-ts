/**
 * Pure renderers over `DescribeSnapshot` (D39 / D40 tail).
 *
 * Render is graph-layer presentation: no Graph method, no topology mutation, no substrate behavior.
 */

import { canonicalTupleKey } from "../identity.js";
import type { DescribeEdge, DescribeNode, DescribeSnapshot } from "./describe.js";

export type DiagramDirection = "TD" | "LR" | "BT" | "RL";

export interface DescribeToMermaidOptions {
	/** Diagram direction; default "LR". */
	direction?: DiagramDirection;
}

export type MermaidLiveTheme = "default" | "dark" | "forest" | "neutral" | "base";

export interface MermaidLiveUrlOptions {
	/** Mermaid Live theme; default "default". */
	theme?: MermaidLiveTheme;
	/** Mermaid Live auto-sync flag; default true. */
	autoSync?: boolean;
}

export interface DescribeToMermaidUrlOptions
	extends DescribeToMermaidOptions,
		MermaidLiveUrlOptions {}

export interface DescribeToD2Options {
	/** Diagram direction; default "LR". */
	direction?: DiagramDirection;
}

export interface DescribeToPrettyOptions {
	/** Include the Edges section; default true. */
	includeEdges?: boolean;
}

export interface DescribeToAsciiOptions {
	/** Include cached values; default false. */
	includeValues?: boolean;
}

export interface DescribeToJsonOptions {
	/** Include edges; default true. */
	includeEdges?: boolean;
	/** JSON indent; default 2. */
	indent?: number;
}

interface FlatSnapshot {
	name?: string;
	nodes: DescribeNode[];
	edges: DescribeEdge[];
}

/** Render a D39 describe snapshot as Mermaid flowchart text. */
export function describeToMermaid(
	snapshot: DescribeSnapshot,
	opts: DescribeToMermaidOptions = {},
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

/** Encode arbitrary Mermaid source as a mermaid.live deep link. */
export function mermaidLiveUrl(mermaidSource: string, opts: MermaidLiveUrlOptions = {}): string {
	const payload = {
		code: mermaidSource,
		mermaid: { theme: opts.theme ?? "default" },
		autoSync: opts.autoSync ?? true,
	};
	return `https://mermaid.live/edit#base64:${base64UrlEncode(JSON.stringify(payload))}`;
}

/** Render a D39 describe snapshot as a mermaid.live deep link. */
export function describeToMermaidUrl(
	snapshot: DescribeSnapshot,
	opts: DescribeToMermaidUrlOptions = {},
): string {
	return mermaidLiveUrl(describeToMermaid(snapshot, opts), opts);
}

/** Render a D39 describe snapshot as D2 diagram text. */
export function describeToD2(snapshot: DescribeSnapshot, opts: DescribeToD2Options = {}): string {
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

/** Render a D39 describe snapshot as compact human-readable plaintext. */
export function describeToPretty(
	snapshot: DescribeSnapshot,
	opts: DescribeToPrettyOptions = {},
): string {
	const flat = flattenDescribe(snapshot);
	const includeEdges = opts.includeEdges ?? true;
	const lines: string[] = [`Graph ${flat.name ?? "(anonymous)"}`, "Nodes:"];
	for (const node of sortedNodes(flat.nodes)) {
		lines.push(`- ${node.id} (${node.factory}/${node.status}): ${formatValue(node)}`);
	}
	if (includeEdges) {
		lines.push("Edges:");
		for (const edge of sortedEdges(flat.edges)) lines.push(`- ${edge.from} -> ${edge.to}`);
	}
	return lines.join("\n");
}

/** Render a D39 describe snapshot as a compact ASCII adjacency diagram. */
export function describeToAscii(
	snapshot: DescribeSnapshot,
	opts: DescribeToAsciiOptions = {},
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
		lines.push(`${node.id} [${node.factory}/${node.status}${value}] -> ${to}`);
	}
	return lines.join("\n");
}

/** Render a D39 describe snapshot as deterministic JSON text. */
export function describeToJson(
	snapshot: DescribeSnapshot,
	opts: DescribeToJsonOptions = {},
): string {
	const includeEdges = opts.includeEdges ?? true;
	const flat = flattenDescribe(snapshot);
	const payload: FlatSnapshot = {
		...(flat.name !== undefined ? { name: flat.name } : {}),
		nodes: sortedNodes(flat.nodes).map((node) => sortJsonValue(node) as DescribeNode),
		edges: includeEdges ? sortedEdges(flat.edges) : [],
	};
	return JSON.stringify(sortJsonValue(payload), null, opts.indent ?? 2);
}

function flattenDescribe(snapshot: DescribeSnapshot): FlatSnapshot {
	const nodes: DescribeNode[] = [];
	const edges: DescribeEdge[] = [];
	const visit = (snap: DescribeSnapshot): void => {
		nodes.push(...snap.nodes);
		edges.push(...snap.edges);
		for (const child of snap.subgraphs ?? []) visit(child);
	};
	visit(snapshot);
	return { ...(snapshot.name !== undefined ? { name: snapshot.name } : {}), nodes, edges };
}

function sortedNodes(nodes: readonly DescribeNode[]): DescribeNode[] {
	return [...nodes].sort((a, b) => compareText(a.id, b.id));
}

function sortedEdges(edges: readonly DescribeEdge[]): DescribeEdge[] {
	const seen = new Set<string>();
	const out: DescribeEdge[] = [];
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

function formatValue(node: DescribeNode): string {
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
