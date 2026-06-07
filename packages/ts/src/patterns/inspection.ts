/**
 * Horizontal inspection patterns re-derived from old presets (B62 / D125).
 *
 * These helpers compose the clean-slate graph inspection egresses. They do not
 * add graph nodes, hidden subscriptions, policy gates, or storage ownership.
 */

import type { Graph } from "../graph/graph.js";
import type { NodeProfile, ObserveEvent } from "../graph/inspect.js";
import type { MessageType } from "../protocol/messages.js";

export type ObserveTraceDetail = "summary" | "standard" | "full";

export interface ObserveTraceEvent {
	/** Graph-local observe sequence from the source ObserveEvent. */
	seq: number;
	/** Mount-aware observed path. */
	path: string;
	/** Optional caller-owned stage label resolved from path. */
	stage?: string;
	/** Message type tag. */
	type: MessageType;
	/** Message tier. */
	tier: number;
	/** Elapsed nanoseconds since trace attachment, according to the trace clock. */
	elapsedNs: number;
	/** Short payload preview for standard/full detail. */
	summary?: string;
	/** Raw DATA/ERROR payload for full detail. */
	data?: unknown;
}

export interface ObserveTraceOptions {
	/** Exact node/subtree paths to observe. Omit for whole-graph observe. */
	paths?: readonly string[];
	/** Path to stage label map. Exact matches win; otherwise the longest "::" subtree prefix wins. */
	stageLabels?: Readonly<Record<string, string>>;
	/** Restrict captured message types. Omit to capture all observed events. */
	includeTypes?: readonly MessageType[];
	/** Payload detail level. Default "summary". */
	detail?: ObserveTraceDetail;
	/** Optional rendered-line sink. Omit/null for structured-only tracing. */
	logger?: ((line: string) => void) | null;
	/** Testable monotonic-ish nanosecond clock. Default uses Date.now(). */
	nowNs?: () => number;
}

export interface ObserveTraceHandle {
	/** Structured trace events collected since attachment. */
	readonly events: readonly ObserveTraceEvent[];
	/** Detach all underlying observe subscriptions. Safe to call repeatedly. */
	dispose(): void;
}

export interface ProfileSummaryNode {
	path: string;
	invokes: number;
	totalDurationNs: number;
	lastDurationNs: number;
	status: NodeProfile["status"];
}

export interface ProfileSummary {
	/** Number of nodes in describe(), including nodes with zero invokes. */
	nodeCount: number;
	totalInvokes: number;
	byStatus: Partial<Record<NodeProfile["status"], number>>;
	/** Nodes sorted by invokes desc, then path asc. */
	hotNodes: ProfileSummaryNode[];
}

const TRACE_CLOCK_ORIGIN_MS = Date.now();

function defaultNowNs(): number {
	return (Date.now() - TRACE_CLOCK_ORIGIN_MS) * 1_000_000;
}

function payloadOf(event: ObserveEvent): unknown {
	return event.msg.length > 1 ? event.msg[1] : undefined;
}

function summarize(value: unknown): string {
	if (value == null) return "null";
	if (typeof value === "string") return truncate(value, 80);
	if (typeof value === "number" || typeof value === "boolean" || typeof value === "bigint") {
		return String(value);
	}
	try {
		return truncate(JSON.stringify(value), 120);
	} catch {
		return truncate(String(value), 120);
	}
}

function truncate(value: string, max: number): string {
	return value.length > max ? `${value.slice(0, max - 3)}...` : value;
}

function stageFor(
	path: string,
	labels: Readonly<Record<string, string>> | undefined,
): string | undefined {
	if (labels === undefined) return undefined;
	const exact = labels[path];
	if (exact !== undefined) return exact;
	let best: { prefix: string; label: string } | undefined;
	for (const [prefix, label] of Object.entries(labels)) {
		if (
			path.startsWith(`${prefix}::`) &&
			(best === undefined || prefix.length > best.prefix.length)
		) {
			best = { prefix, label };
		}
	}
	return best?.label;
}

function renderTraceLine(event: ObserveTraceEvent): string {
	const stage = event.stage === undefined ? "" : `[${event.stage}] `;
	const summary = event.summary === undefined ? "" : ` ${event.summary}`;
	return `#${event.seq} +${event.elapsedNs}ns ${stage}${event.path} ${event.type}${summary}`;
}

/**
 * Attach a structured trace over Graph.observe() read-only egress (R-observe / D39).
 *
 * This is the clean-slate replacement for stage-log preset sugar: stage labels
 * are caller-owned presentation metadata, and the helper never mutates topology.
 */
export function observeTrace(graph: Graph, opts: ObserveTraceOptions = {}): ObserveTraceHandle {
	const nowNs = opts.nowNs ?? defaultNowNs;
	const startNs = nowNs();
	const detail = opts.detail ?? "summary";
	const includeTypes = opts.includeTypes === undefined ? undefined : new Set(opts.includeTypes);
	const logger = opts.logger ?? null;
	const events: ObserveTraceEvent[] = [];
	const unsubs: Array<() => void> = [];
	let disposed = false;
	let attaching = true;
	let attachError: unknown;

	function record(source: ObserveEvent): void {
		if (includeTypes !== undefined && !includeTypes.has(source.msg[0])) return;
		const payload = payloadOf(source);
		const event: ObserveTraceEvent = {
			seq: source.seq,
			path: source.path,
			type: source.msg[0],
			tier: source.tier,
			elapsedNs: Math.max(0, nowNs() - startNs),
		};
		const stage = stageFor(source.path, opts.stageLabels);
		if (stage !== undefined) event.stage = stage;
		if (detail !== "summary") event.summary = summarize(payload);
		if (detail === "full") event.data = payload;
		events.push(event);
		if (logger) logger(renderTraceLine(event));
	}

	function observeSink(source: ObserveEvent): void {
		if (!attaching) {
			record(source);
			return;
		}
		if (attachError !== undefined) return;
		try {
			record(source);
		} catch (error) {
			attachError = error;
		}
	}

	const paths = opts.paths === undefined || opts.paths.length === 0 ? [undefined] : opts.paths;
	try {
		for (const path of paths) {
			unsubs.push(graph.observe(path).subscribe(observeSink));
			if (attachError !== undefined) throw attachError;
		}
	} catch (error) {
		for (const unsub of unsubs.splice(0)) unsub();
		throw error;
	} finally {
		attaching = false;
	}

	return {
		get events(): readonly ObserveTraceEvent[] {
			return events;
		},
		dispose() {
			if (disposed) return;
			disposed = true;
			for (const unsub of unsubs.splice(0)) unsub();
		},
	};
}

/**
 * Summarize an opt-in Graph.profile() snapshot while keeping describe() as the
 * source of node cardinality. No counters are stored on nodes (R-profile).
 */
export function profileSummary(graph: Graph, opts: { limit?: number } = {}): ProfileSummary {
	const profile = graph.profile();
	const described = graph.describe();
	const nodeIds = new Set(described.nodes.map((node) => node.id));
	for (const id of Object.keys(profile.nodes)) nodeIds.add(id);

	const byStatus: Partial<Record<NodeProfile["status"], number>> = {};
	const hotNodes: ProfileSummaryNode[] = [];
	for (const path of [...nodeIds].sort()) {
		const nodeProfile = profile.nodes[path];
		if (nodeProfile === undefined) continue;
		byStatus[nodeProfile.status] = (byStatus[nodeProfile.status] ?? 0) + 1;
		hotNodes.push({
			path,
			invokes: nodeProfile.invokes,
			totalDurationNs: nodeProfile.totalDurationNs,
			lastDurationNs: nodeProfile.lastDurationNs,
			status: nodeProfile.status,
		});
	}
	hotNodes.sort((a, b) => b.invokes - a.invokes || a.path.localeCompare(b.path));
	return {
		nodeCount: nodeIds.size,
		totalInvokes: profile.totalInvokes,
		byStatus,
		hotNodes: hotNodes.slice(0, opts.limit ?? hotNodes.length),
	};
}
