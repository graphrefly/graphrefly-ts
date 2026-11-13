import { moduleName } from "../graph/module-naming.js";
import { assertLocalName } from "../node/naming.js";
/**
 * Wire edge groups (R-bridge@2, graphrefly:D803, D804).
 *
 * A group carries a fixed set of edges from a sender graph to a receiver graph.
 *   - Sender: the group's outbound node depends on the group's edges. It is a fan-in, so it runs at
 *     most once per wave on a consistent set of inputs (R-wave), and each run in which some edge
 *     brought input is one cause: one frame, sent as one DATA value. A sink hands frames to the
 *     transport; the transport is not the bridge's.
 *   - Receiver: frames come out of a node with no dependencies whose setup opens the receiving end,
 *     so each frame is one wave. The gate checks it, and every inbound node depends on the gate, so
 *     the edges of a cause settle in that one wave and a fan-in over them runs once. Nothing waits
 *     across graphs and nothing is drained by hand.
 *
 * A frame is a {@link WireEdgeCause}. Each array holds only DATA, INVALIDATE, COMPLETE and ERROR,
 * DATA values and ERROR payloads as bytes (`Uint8Array`); the application encodes them. Bridge nodes
 * carry no recipe: their values are bytes, so a checkpoint of them is not covered (local-only).
 */

import type { Ctx, Sink } from "../ctx/types.js";

import type { Graph } from "../graph/graph.js";
import type { Node } from "../node/node.js";
import { type Message, SENTINEL, type Wave } from "../protocol/messages.js";

/** One edge of a cause: what the edge brought in the sender's wave, as arrays in order. */
export interface WireEdgeCauseEdge {
	readonly edgeId: string;
	readonly arrays: readonly Wave[];
}

/** One cause of a wire edge group: one sender wave, sent as one frame (`WireEdgeCause`). */
export interface WireEdgeCause {
	readonly group: string;
	/** One lifetime of the group's outbound node. */
	readonly session: string;
	/** Counts from 1 within the session. */
	readonly cause: number;
	readonly edges: readonly WireEdgeCauseEdge[];
}

/** What an edge last brought, as the receiver's gate has released it. */
export interface WireEdgeView {
	readonly values: readonly Uint8Array[] | null;
	readonly terminal: Message | null;
}

/** A drop, gap or refusal of a group's gate: a value of its issues node, never a terminal. */
export type WireEdgeGroupIssue =
	| { readonly kind: "malformed"; readonly frame: unknown }
	| {
			readonly kind: "stale";
			readonly session: string;
			readonly cause: number;
			readonly last: number;
	  }
	| { readonly kind: "gap"; readonly session: string; readonly from: number; readonly to: number }
	| {
			/** D804: arrays for an ended inbound edge, not ending with a terminal, were skipped. */
			readonly kind: "ended";
			readonly session: string;
			readonly cause: number;
			readonly edgeId: string;
	  }
	| {
			readonly kind: "refused";
			readonly session: string;
			readonly cause: number;
			readonly reason: string;
	  };

/** One value of a gate: the causes it released in a wave, its issues, and every edge's view. */
export interface WireEdgeGateOutput {
	readonly released: readonly WireEdgeCause[];
	readonly issues: readonly WireEdgeGroupIssue[];
	readonly view: Readonly<Record<string, WireEdgeView>>;
}

export interface WireEdgeGroupOutOptions {
	/** The group's name, borne by every frame. */
	readonly group: string;
	/** Each edge id and the sender node it carries. */
	readonly edges: Readonly<Record<string, Node<Uint8Array>>>;
	readonly name?: string;
}

export interface WireEdgeGroupInOptions {
	readonly group: string;
	/** The node whose values are received frames (see {@link frameSource}). */
	readonly frames: Node<unknown>;
	/** The declared edge ids, the same as the sender's. */
	readonly edges: readonly string[];
	readonly name?: string;
}

export interface WireEdgeGroupInBundle {
	readonly gate: Node<WireEdgeGateOutput>;
	/** One inbound node per declared edge; each sends its edge's arrays as its own output. */
	readonly inbound: ReadonlyMap<string, Node<Uint8Array>>;
	readonly issues: Node<WireEdgeGroupIssue>;
}

const CROSSING = new Set(["DATA", "INVALIDATE", "COMPLETE", "ERROR"]);
const isTerminalMessage = (m: Message): boolean => m[0] === "COMPLETE" || m[0] === "ERROR";
const isBytes = (v: unknown): v is Uint8Array => v instanceof Uint8Array;
const MANUAL = { complete: "manual", error: "manual" } as const;

/**
 * What one input brought in this run, as the outbound node's ctx gives it: an INVALIDATE (the
 * manual policy shows it, and what came before it is gone), then the arrays that carried DATA, in
 * order, then a terminal. An input that brought only RESOLVED brings nothing.
 */
function brought(ctx: Ctx, i: number): Wave[] {
	const arrays: Wave[] = [];
	const dep = ctx.deps[i];
	if (dep.invalidated) arrays.push([["INVALIDATE"]]);
	for (const w of dep.waves) if (w.length > 0) arrays.push(w.map((v) => ["DATA", v] as Message));
	const t = dep.terminal;
	if (t !== undefined) arrays.push([t.kind === "complete" ? ["COMPLETE"] : ["ERROR", t.error]]);
	return arrays;
}

interface OutState {
	readonly session: string;
	readonly cause: number;
}

/**
 * The sender side of a wire edge group (R-bridge@2): a fan-in over the group's edges under manual
 * COMPLETE, ERROR and INVALIDATE policies whose every run with new input sends one cause.
 *
 * A session is one lifetime of this node: its setup names the session, and its causes are numbered
 * from 1. The first run brings every edge's snapshot; an edge without a value gets an INVALIDATE
 * ahead of it, also one whose snapshot is its terminal alone, so a receiver that kept a value from
 * an earlier session drops it. A DATA value or ERROR payload that is
 * not bytes is a throw of this node.
 *
 * @param graph - The sender graph.
 * @param opts - The group's name and edges.
 * @returns The outbound node; subscribe a {@link frameSink} to hand its frames to the transport.
 * @category adapters
 * @example
 * ```ts
 * import { frameSink, wireEdgeGroupOut } from "@graphrefly/ts/adapters";
 * import { graph } from "@graphrefly/ts/graph";
 *
 * const g = graph();
 * const x = g.state<Uint8Array>(new Uint8Array([1]));
 * const out = wireEdgeGroupOut(g, { group: "gx", edges: { x } });
 * out.subscribe(frameSink((frame) => transport.send(frame)));
 * ```
 */
export function wireEdgeGroupOut(graph: Graph, opts: WireEdgeGroupOutOptions): Node<WireEdgeCause> {
	const { group } = opts;
	const edgeIds = Object.keys(opts.edges);
	if (edgeIds.length === 0) throw new RangeError("wireEdgeGroupOut: a group needs an edge");
	if (opts.name === undefined) assertLocalName(group);
	const name = moduleName(graph, opts.name, `${group}/out`);
	return graph.node<WireEdgeCause>(
		edgeIds.map((e) => opts.edges[e] as Node<unknown>),
		(ctx) => {
			const st = ctx.state.get<OutState>() as OutState;
			const first = st.cause === 0;
			const carried: WireEdgeCauseEdge[] = [];
			edgeIds.forEach((edgeId, i) => {
				const arrays = brought(ctx, i);
				// The first cause clears, on the receiver, a value an earlier session left for an edge
				// that has none now, also one whose snapshot is its terminal alone (R-bridge@2).
				if (first && !arrays.some((a) => a[0]?.[0] === "DATA")) arrays.unshift([["INVALIDATE"]]);
				if (arrays.length > 0) carried.push({ edgeId, arrays });
			});
			if (carried.length === 0) return; // a run with no new input forms no cause
			for (const { edgeId, arrays } of carried)
				for (const m of arrays.flat())
					if ((m[0] === "DATA" || m[0] === "ERROR") && !isBytes(m[1]))
						throw new TypeError(
							`${name}: edge ${edgeId} sent a ${m[0]} that is not bytes; encode it before the edge (R-bridge)`,
						);
			const cause = st.cause + 1;
			ctx.state.set<OutState>({ session: st.session, cause });
			ctx.down([["DATA", Object.freeze({ group, session: st.session, cause, edges: carried })]]);
		},
		{
			name,
			factory: "wireEdgeGroupOut",
			// The first run is the session's first cause, also when an edge has no value yet.
			// The edges' terminals and INVALIDATEs are this node's input, to carry, not to act on.
			...MANUAL,
			invalidate: "manual",
			setup: (ctx) => {
				ctx.state.set<OutState>({ session: globalThis.crypto.randomUUID(), cause: 0 });
			},
		},
	);
}

/**
 * A sink that hands every frame a subscription to a group's outbound node delivers, the
 * subscription's snapshot included, to `send`. A frame delivered twice is dropped by the receiver
 * as a cause already taken.
 *
 * @param send - The transport's send.
 * @returns A sink for `outbound.subscribe`.
 * @category adapters
 * @example
 * ```ts
 * import { frameSink } from "@graphrefly/ts/adapters";
 *
 * const sink = frameSink((frame) => console.log(frame.cause));
 * ```
 */
export function frameSink(send: (frame: WireEdgeCause) => void): Sink {
	return (msgs) => {
		for (const m of msgs) if (m[0] === "DATA") send(m[1] as WireEdgeCause);
	};
}

/**
 * The receiving end: a node with no dependencies whose setup calls `open(deliver)`, which may
 * return the close function. Each `deliver(frame)` is a late output of the node, so one wave.
 *
 * @param graph - The receiver graph.
 * @param open - Opens the receiving end for one lifetime of the node.
 * @param opts - Optional node name.
 * @returns The frames node, for {@link wireEdgeGroupIn}.
 * @category adapters
 * @example
 * ```ts
 * import { frameSource } from "@graphrefly/ts/adapters";
 * import { graph } from "@graphrefly/ts/graph";
 *
 * const g = graph();
 * const frames = frameSource(g, (deliver) => transport.onFrame(deliver));
 * ```
 */
export function frameSource(
	graph: Graph,
	// biome-ignore lint/suspicious/noConfusingVoidType: open returns its close function or nothing.
	open: (deliver: (frame: unknown) => void) => (() => void) | undefined | void,
	opts: { readonly name?: string } = {},
): Node<unknown> {
	return graph.node<unknown>([], () => {}, {
		name: moduleName(graph, opts.name, "frameSource"),
		factory: "frameSource",
		setup: (ctx) => {
			const close = open((frame) => ctx.down([["DATA", frame]]));
			return typeof close === "function" ? close : undefined;
		},
	});
}

interface GateState {
	readonly session: string | null;
	readonly last: number;
	readonly view: Readonly<Record<string, WireEdgeView>>;
}

/**
 * The receiver side of a wire edge group (R-bridge@2): the gate over `frames`, an inbound node per
 * declared edge, and the issues node.
 *
 * The gate takes the frames bearing its group's name and releases a session's causes in order and
 * each at most once: a cause at or below the last one taken is dropped, a cause past the next one
 * is released and the gap reported, a new session starts the count again, and a frame naming an
 * undeclared edge or carrying arrays no inbound node could send is refused whole, its number taken.
 * An inbound node that has ended takes nothing more: its edge's arrays are skipped and the rest of
 * the frame released, reported as an `ended` issue only when they do not end with a terminal
 * (graphrefly:D804). Each inbound node sends its edge's arrays in the wave of the release; its snapshot is what
 * its edge last brought.
 *
 * @param graph - The receiver graph.
 * @param opts - The group's name, its frames node and its declared edges.
 * @returns The gate, the inbound nodes by edge id, and the issues node.
 * @category adapters
 * @example
 * ```ts
 * import { frameSource, wireEdgeGroupIn } from "@graphrefly/ts/adapters";
 * import { graph } from "@graphrefly/ts/graph";
 *
 * const g = graph();
 * const frames = frameSource(g, (deliver) => transport.onFrame(deliver));
 * const { inbound } = wireEdgeGroupIn(g, { group: "gx", frames, edges: ["x"] });
 * ```
 */
export function wireEdgeGroupIn(graph: Graph, opts: WireEdgeGroupInOptions): WireEdgeGroupInBundle {
	const { group } = opts;
	const declared = [...opts.edges];
	if (declared.length === 0) throw new RangeError("wireEdgeGroupIn: a group needs an edge");
	if (new Set(declared).size !== declared.length)
		throw new RangeError("wireEdgeGroupIn: edge ids must be distinct");
	if (opts.name === undefined) assertLocalName(group);
	for (const edgeId of declared) assertLocalName(edgeId);
	const name = moduleName(graph, opts.name, `${group}/in`);
	const gate = graph.node<WireEdgeGateOutput>([opts.frames], gateFn(group, declared), {
		name,
		factory: "wireEdgeGroupGate",
		...MANUAL,
	});
	const inbound = new Map<string, Node<Uint8Array>>();
	for (const edgeId of declared)
		inbound.set(
			edgeId,
			graph.node<Uint8Array>([gate as Node<unknown>], inboundFn(edgeId), {
				name: `${name}/edges/${edgeId}`,
				factory: "wireEdgeGroupInbound",
				...MANUAL,
			}),
		);
	const issues = graph.node<WireEdgeGroupIssue>([gate as Node<unknown>], issuesFn, {
		name: `${name}/issues`,
		factory: "wireEdgeGroupIssues",
		...MANUAL,
	});
	return { gate, inbound, issues };
}

/**
 * Private state: the current session, the last cause number taken in it, and the view, what each
 * edge last brought, which gives a late subscriber of an inbound node its snapshot. Each run with a
 * frame of this group sends one value: the causes released, the issues, the view.
 */
function gateFn(group: string, declared: readonly string[]): (ctx: Ctx) => void {
	const known = new Set(declared);
	return (ctx) => {
		let st = ctx.state.get<GateState>() ?? { session: null, last: 0, view: {} };
		const released: WireEdgeCause[] = [];
		const issues: WireEdgeGroupIssue[] = [];
		for (const raw of ctx.deps[0].waves.flat()) {
			if (raw === SENTINEL) continue;
			const frame = raw as Partial<WireEdgeCause> | null;
			if (frame?.group !== group) continue; // another group's frame on the same channel
			if (
				typeof frame.session !== "string" ||
				!Number.isSafeInteger(frame.cause) ||
				(frame.cause as number) < 1 ||
				!Array.isArray(frame.edges)
			) {
				issues.push(Object.freeze({ kind: "malformed", frame }));
				continue;
			}
			const session = frame.session;
			const cause = frame.cause as number;
			if (session !== st.session) st = { ...st, session, last: 0 };
			if (cause <= st.last) {
				issues.push(Object.freeze({ kind: "stale", session, cause, last: st.last }));
				continue;
			}
			const gap =
				cause > st.last + 1
					? { kind: "gap" as const, session, from: st.last + 1, to: cause - 1 }
					: null;
			st = { ...st, last: cause };
			const checked = refuse(frame as WireEdgeCause, known, st.view);
			if (typeof checked === "string") {
				issues.push(Object.freeze({ kind: "refused", session, cause, reason: checked }));
				continue;
			}
			if (gap !== null) issues.push(Object.freeze(gap));
			for (const edgeId of checked.diverged)
				issues.push(Object.freeze({ kind: "ended", session, cause, edgeId }));
			st = { ...st, view: checked.view };
			released.push(checked.frame);
		}
		ctx.state.set<GateState>(st);
		if (released.length > 0 || issues.length > 0)
			ctx.down([
				[
					"DATA",
					Object.freeze({
						released: Object.freeze(released),
						issues: Object.freeze(issues),
						view: st.view,
					}),
				],
			]);
	};
}

class BadFrame extends Error {}

interface Checked {
	readonly view: Readonly<Record<string, WireEdgeView>>;
	/** The frame to release: without the edges whose inbound node has ended. */
	readonly frame: WireEdgeCause;
	/** Ended edges whose skipped arrays did not end with a terminal. */
	readonly diverged: readonly string[];
}

/**
 * Checks a frame against what its inbound nodes could send as their own output. Returns the reason
 * it is refused whole, or the view after it with the frame to release. An edge whose inbound node
 * has ended takes nothing more (R-bridge@2): its arrays are skipped and the rest of the frame is
 * released; when the skipped arrays do not end with a terminal, the sender's edge goes on while the
 * receiver's has ended, and the edge is reported. A new session's first cause repeats an ended
 * edge's snapshot with its terminal, which is not reported.
 */
function refuse(
	frame: WireEdgeCause,
	known: ReadonlySet<string>,
	view: Readonly<Record<string, WireEdgeView>>,
): Checked | string {
	try {
		return viewAfter(frame, known, view);
	} catch (e) {
		if (e instanceof BadFrame) return e.message;
		throw e;
	}
}

function viewAfter(
	frame: WireEdgeCause,
	known: ReadonlySet<string>,
	view: Readonly<Record<string, WireEdgeView>>,
): Checked {
	const next: Record<string, WireEdgeView> = { ...view };
	const seen = new Set<string>();
	const kept: WireEdgeCauseEdge[] = [];
	const diverged: string[] = [];
	if (frame.edges.length === 0) throw new BadFrame("a cause carrying no edge");
	for (const entry of frame.edges) {
		const { edgeId, arrays } = (entry ?? {}) as Partial<WireEdgeCauseEdge>;
		if (typeof edgeId !== "string" || !known.has(edgeId))
			throw new BadFrame(`undeclared edge ${String(edgeId)}`);
		if (seen.has(edgeId)) throw new BadFrame(`edge ${edgeId} twice`);
		seen.add(edgeId);
		if (!Array.isArray(arrays) || arrays.length === 0)
			throw new BadFrame(`edge ${edgeId} carries no array`);
		let ended = false; // within this frame
		for (const a of arrays as readonly unknown[]) {
			if (!Array.isArray(a) || a.length === 0) throw new BadFrame(`edge ${edgeId}: an empty array`);
			if (ended) throw new BadFrame(`edge ${edgeId}: an array after its terminal`);
			const wave = a as Wave;
			wave.forEach((m, i) => {
				if (!Array.isArray(m) || !CROSSING.has(m[0] as string))
					throw new BadFrame(
						`edge ${edgeId}: ${String((m as unknown as unknown[] | undefined)?.[0])} does not cross`,
					);
				if ((m[0] === "DATA" || m[0] === "ERROR") && !isBytes(m[1]))
					throw new BadFrame(`edge ${edgeId}: ${m[0]} without bytes`);
				if ((m[0] === "INVALIDATE" || m[0] === "COMPLETE") && m.length !== 1)
					throw new BadFrame(`edge ${edgeId}: ${m[0]} carries a value`);
				if (isTerminalMessage(m) && i !== wave.length - 1)
					throw new BadFrame(`edge ${edgeId}: a terminal not last`);
			});
			ended = isTerminalMessage(wave[wave.length - 1] as Message);
		}
		if (next[edgeId]?.terminal != null) {
			if (!ended) diverged.push(edgeId);
			continue;
		}
		let values = next[edgeId]?.values ?? null;
		let terminal: Message | null = null;
		for (const wave of arrays as readonly Wave[]) {
			// As the kernel applies it (R-wave, R-invalidation): what came before the last INVALIDATE
			// is gone and the value with it, the DATA after it is the value, and a terminal ends it.
			let k = -1;
			wave.forEach((m, i) => {
				if (m[0] === "INVALIDATE") k = i;
			});
			if (k >= 0) values = null;
			const data = wave
				.slice(k + 1)
				.filter((m) => m[0] === "DATA")
				.map((m) => m[1] as Uint8Array);
			if (data.length > 0) values = data;
			terminal = wave.find(isTerminalMessage) ?? null;
		}
		next[edgeId] = Object.freeze({ values, terminal });
		kept.push(entry);
	}
	const released =
		kept.length === frame.edges.length
			? frame
			: Object.freeze({ ...frame, edges: Object.freeze(kept) });
	return { view: Object.freeze(next), frame: released, diverged };
}

/**
 * An inbound node sends, in each wave, the arrays of its edge in the causes released, as its own
 * output, and nothing when they do not carry it. Its first run in a lifetime sends instead what the
 * edge last brought, from the gate's view, whichever frames carried it: that is its snapshot.
 */
function inboundFn(edgeId: string): (ctx: Ctx) => void {
	return (ctx) => {
		const gates = ctx.deps[0].waves.flat().filter((v) => v !== SENTINEL) as WireEdgeGateOutput[];
		if (ctx.state.get<boolean>() !== true) {
			ctx.state.set(true);
			const last = gates.at(-1)?.view[edgeId];
			if (last !== undefined && (last.values !== null || last.terminal !== null))
				ctx.down([
					...(last.values ?? []).map((v) => ["DATA", v] as Message),
					...(last.terminal !== null ? [last.terminal] : []),
				]);
			return;
		}
		for (const { released } of gates)
			for (const frame of released)
				for (const a of frame.edges.find((e) => e.edgeId === edgeId)?.arrays ?? []) ctx.down(a);
	};
}

/**
 * The group's issues: drops, gaps and refusals, each a value. The first run of a lifetime does not
 * repeat the issues of the gate's last value.
 */
function issuesFn(ctx: Ctx): void {
	const gates = ctx.deps[0].waves.flat().filter((v) => v !== SENTINEL) as WireEdgeGateOutput[];
	if (ctx.state.get<boolean>() !== true) {
		ctx.state.set(true);
		return;
	}
	const issues = gates.flatMap((x) => x.issues);
	ctx.down(issues.map((i) => ["DATA", i] as Message));
}
