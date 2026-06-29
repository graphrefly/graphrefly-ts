import { type Ctx, depBatch, depLiveWaves, depWaves } from "../ctx/types.js";
import type { Graph } from "../graph/graph.js";
import type { Node } from "../node/node.js";
import { SENTINEL } from "../protocol/messages.js";
import type { CanonicalWireEdgeFrame } from "./bridge-protobuf.js";
import type {
	WireBridgeBundle,
	WireBridgeCommand,
	WireBridgeEnvelope,
	WireBridgeProtobufData,
} from "./bridge-types.js";

export interface WireEdgeGroupEdge {
	readonly edgeId: string;
	readonly outbound?: Node<Uint8Array>;
}
export type WireEdgeGroupIssueCode =
	| "wire-edge-group-missing-snapshot"
	| "wire-edge-group-unknown-edge"
	| "wire-edge-group-duplicate-dirty"
	| "wire-edge-group-duplicate-data"
	| "wire-edge-group-data-before-dirty"
	| "wire-edge-group-competing-cause"
	| "wire-edge-group-malformed-frame"
	| "wire-edge-group-incomplete-cause";
export interface WireEdgeGroupIssue {
	readonly code: WireEdgeGroupIssueCode;
	readonly message: string;
	readonly edgeId?: string;
	readonly causeId?: string;
	readonly activeCauseId?: string;
}
export interface WireEdgeGroupStatus {
	readonly state: "idle" | "collecting" | "released" | "issues";
	readonly expectedEdges: readonly string[];
	readonly dirty: number;
	readonly data: number;
	readonly released: number;
	readonly issues: number;
	readonly activeCauseId?: string;
	readonly lastIssue?: WireEdgeGroupIssue;
}
export interface WireEdgeGroupOptions {
	readonly name?: string;
	readonly edges: readonly WireEdgeGroupEdge[];
}
export interface WireEdgeGroupBundle {
	readonly inbound: ReadonlyMap<string, Node<Uint8Array>>;
	readonly status: Node<WireEdgeGroupStatus>;
	readonly issues: Node<WireEdgeGroupIssue>;
	release(): void;
}

type Command = WireBridgeCommand<WireBridgeProtobufData>;
type Event =
	| { kind: "outbound"; command: Command }
	| { kind: "frame"; frame: CanonicalWireEdgeFrame }
	| { kind: "bridge-end" }
	| { kind: "issue"; issue: WireEdgeGroupIssue };
type Gate =
	| { kind: "release"; causeId: string; values: ReadonlyMap<string, Uint8Array> }
	| { kind: "progress"; causeId: string; dirty: number; data: number }
	| { kind: "issue"; issue: WireEdgeGroupIssue };
interface ReleaseCohort {
	readonly causeId: string;
	readonly values: ReadonlyMap<string, Uint8Array>;
}
interface ReleaseDrain {
	ack(edgeId: string): void;
	missing(): string[];
}
interface OutState {
	nextCause: number;
	snapshots: Map<string, Uint8Array>;
	pendingFresh: Map<string, Uint8Array>;
	emittedCause: boolean;
}
interface GateState {
	activeCauseId?: string;
	dirty: Set<string>;
	data: Map<string, Uint8Array>;
	failed: CauseTombstones;
	released: CauseTombstones;
}

const WIRE_EDGE_GROUP_CAUSE_TOMBSTONE_LIMIT = 1024;

class CauseTombstones {
	private readonly seen = new Set<string>();
	private readonly order: string[] = [];

	has(causeId: string): boolean {
		return this.seen.has(causeId);
	}

	add(causeId: string): void {
		if (this.seen.has(causeId)) return;
		this.seen.add(causeId);
		this.order.push(causeId);
		while (this.order.length > WIRE_EDGE_GROUP_CAUSE_TOMBSTONE_LIMIT) {
			const evicted = this.order.shift();
			if (evicted !== undefined) this.seen.delete(evicted);
		}
	}
}

function releaseDrain(expectedIds: readonly string[]): ReleaseDrain {
	const pending = new Set(expectedIds);
	return {
		ack(edgeId) {
			pending.delete(edgeId);
		},
		missing() {
			return [...pending];
		},
	};
}

export function wireEdgeGroup(
	graph: Graph,
	bridge: WireBridgeBundle<WireBridgeProtobufData, WireBridgeProtobufData>,
	opts: WireEdgeGroupOptions,
): WireEdgeGroupBundle {
	const name = opts.name ?? "wireEdgeGroup";
	const edges = normalize(opts.edges);
	const expected = edges.map((edge) => edge.edgeId);
	const outbound = edges
		.map((edge, index) => ({ edge, index }))
		.filter(
			(entry): entry is { edge: { edgeId: string; outbound: Node<Uint8Array> }; index: number } =>
				entry.edge.outbound !== undefined,
		);
	const topology = graph.topologyGroup({ name: `${name}.wireEdgeGroup` });
	const events = topology.node<Event>(
		[...outbound.map((entry) => entry.edge.outbound), bridge.inbound],
		eventsFn(
			name,
			edges,
			outbound.map((entry) => entry.index),
		),
		{
			name: `${name}/events`,
			factory: "wireEdgeGroupEvents",
			partial: true,
			completeWhenDepsComplete: false,
			errorWhenDepsError: false,
			terminalAsRealInput: true,
		},
	);
	const releaseCohorts = topology.node<ReleaseCohort>([], null, {
		name: `${name}/releaseCohorts`,
		factory: "wireEdgeGroupReleaseCohorts",
	});
	const releaseDrains = new WeakMap<ReleaseCohort, ReleaseDrain>();
	const gate = topology.node<Gate>(
		[events],
		gateFn(name, expected, releaseCohorts, releaseDrains),
		{
			name: `${name}/gate`,
			factory: "wireEdgeGroupGate",
			partial: true,
			completeWhenDepsComplete: false,
			errorWhenDepsError: false,
		},
	);
	const commands = topology.node<Command>(
		[events],
		(ctx) => {
			for (const raw of depBatch(ctx, 0) ?? []) {
				const event = raw as Event;
				if (event.kind === "outbound") ctx.down([["DATA", event.command]]);
			}
		},
		{
			name: `${name}/commands`,
			factory: "wireEdgeGroupCommands",
			partial: true,
			completeWhenDepsComplete: false,
			errorWhenDepsError: false,
		},
	);
	const issues = topology.node<WireEdgeGroupIssue>(
		[events, gate],
		(ctx) => {
			for (const raw of depBatch(ctx, 0) ?? []) {
				const event = raw as Event;
				if (event.kind === "issue") ctx.down([["DATA", event.issue]]);
			}
			for (const raw of depBatch(ctx, 1) ?? []) {
				const event = raw as Gate;
				if (event.kind === "issue") ctx.down([["DATA", event.issue]]);
			}
		},
		{
			name: `${name}/issues`,
			factory: "wireEdgeGroupIssues",
			partial: true,
			completeWhenDepsComplete: false,
			errorWhenDepsError: false,
		},
	);
	const status = topology.node<WireEdgeGroupStatus>([events, gate], statusFn(expected), {
		name: `${name}/status`,
		factory: "wireEdgeGroupStatus",
		partial: true,
		completeWhenDepsComplete: false,
		errorWhenDepsError: false,
	});
	const inbound = new Map(
		edges.map(
			(edge) =>
				[
					edge.edgeId,
					topology.node<Uint8Array>(
						[releaseCohorts],
						(ctx) => {
							for (const raw of depBatch(ctx, 0) ?? []) {
								const cohort = raw as ReleaseCohort;
								const value = cohort.values.get(edge.edgeId);
								if (value !== undefined) {
									releaseDrains.get(cohort)?.ack(edge.edgeId);
									ctx.down([["DATA", Uint8Array.from(value)]]);
								}
							}
						},
						{
							name: `${name}/inbound/${edge.edgeId}`,
							factory: "wireEdgeGroupInboundEdge",
							partial: true,
							completeWhenDepsComplete: false,
							errorWhenDepsError: false,
							meta: { edgeId: edge.edgeId },
						},
					),
				] as const,
		),
	);
	const inboundProjectorDrainName = `${name}/inboundProjectorDrain`;
	const inboundProjectorDrain = topology.node<void>([...inbound.values()], () => {}, {
		name: inboundProjectorDrainName,
		factory: "wireEdgeGroupInboundProjectorDrain",
		partial: true,
		completeWhenDepsComplete: false,
		errorWhenDepsError: false,
	});
	let releaseInboundProjectorDrain: (() => void) | undefined = graph.retain(inboundProjectorDrain, {
		reason: `${name}.wireEdgeGroup.inboundProjectorDrain`,
	});
	bridge.command.replaceDeps([commands], commandSourceFn());
	let released = false;
	return {
		inbound,
		status,
		issues,
		release() {
			if (released) return;
			bridge.command.replaceDeps([], commandSourceFn());
			const commit = () => {
				topology.release({ reason: `${name}.wireEdgeGroup.release` });
				released = true;
			};
			try {
				commit();
			} catch (error) {
				if (
					releaseInboundProjectorDrain === undefined ||
					!isPrivateReleaseBlock(error, inboundProjectorDrainName)
				) {
					bridge.command.replaceDeps([commands], commandSourceFn());
					throw error;
				}
				const releasePrivateDrain = releaseInboundProjectorDrain;
				releaseInboundProjectorDrain = undefined;
				releasePrivateDrain();
				try {
					commit();
				} catch (commitError) {
					bridge.command.replaceDeps([commands], commandSourceFn());
					try {
						releaseInboundProjectorDrain = graph.retain(inboundProjectorDrain, {
							reason: `${name}.wireEdgeGroup.inboundProjectorDrain`,
						});
					} catch {
						releaseInboundProjectorDrain = undefined;
					}
					throw commitError;
				}
			}
		},
	};
}

function isPrivateReleaseBlock(error: unknown, nodeName: string): boolean {
	return (
		error instanceof Error &&
		error.message.includes(`'${nodeName}'`) &&
		error.message.includes("still has live subscribers")
	);
}

function commandSourceFn(): (ctx: Ctx) => void {
	return (ctx) => {
		for (const command of depBatch(ctx, 0) ?? []) ctx.down([["DATA", command as Command]]);
	};
}
function normalize(edges: readonly WireEdgeGroupEdge[]) {
	const seen = new Set<string>();
	if (edges.length === 0) throw new RangeError("wireEdgeGroup: edges must be non-empty");
	return edges.map((edge) => {
		if (!edge.edgeId) throw new RangeError("wireEdgeGroup: edgeId must be a non-empty string");
		if (seen.has(edge.edgeId))
			throw new RangeError(`wireEdgeGroup: duplicate edgeId ${edge.edgeId}`);
		seen.add(edge.edgeId);
		return edge;
	});
}
function issue(
	code: WireEdgeGroupIssueCode,
	message: string,
	extra: Omit<WireEdgeGroupIssue, "code" | "message"> = {},
): WireEdgeGroupIssue {
	return { code, message, ...extra };
}
function send(frame: CanonicalWireEdgeFrame): Command {
	return { kind: "send", payload: { kind: "wire_edge", frame: clone(frame) } };
}
function clone(frame: CanonicalWireEdgeFrame): CanonicalWireEdgeFrame {
	return frame.kind === "data"
		? {
				kind: "data",
				edgeId: frame.edgeId,
				causeId: frame.causeId,
				value: Uint8Array.from(frame.value ?? new Uint8Array()),
			}
		: { kind: "dirty", edgeId: frame.edgeId, causeId: frame.causeId };
}
function eventsFn(
	name: string,
	edges: readonly WireEdgeGroupEdge[],
	outboundIndexes: readonly number[],
): (ctx: Ctx) => void {
	const byDep = new Map<number, WireEdgeGroupEdge>();
	outboundIndexes.forEach((edgeIndex, depIndex) => {
		byDep.set(depIndex, edges[edgeIndex]);
	});
	const inboundIndex = outboundIndexes.length;
	return (ctx) => {
		let st = ctx.state.get<OutState>();
		if (!st) {
			st = {
				nextCause: 1,
				snapshots: new Map(),
				pendingFresh: new Map(),
				emittedCause: false,
			};
			ctx.state.set(st);
			ctx.state.persist(true);
		}
		let trigger = false;
		for (let i = 0; i < outboundIndexes.length; i++) {
			const edge = byDep.get(i);
			if (!edge) continue;
			const waves = st.emittedCause ? depLiveWaves(ctx, i) : depWaves(ctx, i);
			for (const wave of waves) {
				for (const raw of wave) {
					if (raw === SENTINEL) {
						st.snapshots.delete(edge.edgeId);
						st.pendingFresh.delete(edge.edgeId);
					} else if (!(raw instanceof Uint8Array)) {
						ctx.down([
							[
								"DATA",
								{
									kind: "issue",
									issue: issue(
										"wire-edge-group-malformed-frame",
										`${name}: outbound edge ${edge.edgeId} must emit Uint8Array bytes`,
										{ edgeId: edge.edgeId },
									),
								} satisfies Event,
							],
						]);
					} else {
						const value = Uint8Array.from(raw);
						st.snapshots.set(edge.edgeId, value);
						st.pendingFresh.set(edge.edgeId, Uint8Array.from(value));
						trigger = true;
					}
				}
			}
		}
		if (trigger) emitOutbound(ctx, name, edges, st);
		for (const rawEnvelope of depBatch(ctx, inboundIndex) ?? []) {
			const ev = frameEvent(name, rawEnvelope as WireBridgeEnvelope<unknown>);
			if (ev) ctx.down([["DATA", ev]]);
		}
	};
}
function emitOutbound(
	ctx: Ctx,
	name: string,
	edges: readonly WireEdgeGroupEdge[],
	st: OutState,
): void {
	const missing = edges.filter((edge) => !st.pendingFresh.has(edge.edgeId));
	if (missing.length) {
		for (const edge of missing)
			ctx.down([
				[
					"DATA",
					{
						kind: "issue",
						issue: issue(
							"wire-edge-group-missing-snapshot",
							`${name}: missing outbound snapshot for edge ${edge.edgeId}`,
							{ edgeId: edge.edgeId },
						),
					} satisfies Event,
				],
			]);
		return;
	}
	const causeId = `${name}:cause:${st.nextCause++}`;
	for (const edge of edges)
		ctx.down([
			[
				"DATA",
				{
					kind: "outbound",
					command: send({ kind: "dirty", edgeId: edge.edgeId, causeId }),
				} satisfies Event,
			],
		]);
	for (const edge of edges) {
		const value = st.pendingFresh.get(edge.edgeId);
		if (value)
			ctx.down([
				[
					"DATA",
					{
						kind: "outbound",
						command: send({ kind: "data", edgeId: edge.edgeId, causeId, value }),
					} satisfies Event,
				],
			]);
	}
	st.pendingFresh.clear();
	st.emittedCause = true;
}
function frameEvent(name: string, envelope: WireBridgeEnvelope<unknown>): Event | undefined {
	if (envelope.type === "close" || envelope.type === "error") return { kind: "bridge-end" };
	if (envelope.type !== "data") return undefined;
	const value = envelope.payload?.kind === "data" ? envelope.payload.value : undefined;
	if (
		value instanceof Uint8Array ||
		(typeof value === "object" && value !== null && (value as { kind?: unknown }).kind === "value")
	)
		return undefined;
	if (
		typeof value !== "object" ||
		value === null ||
		(value as { kind?: unknown }).kind !== "wire_edge"
	)
		return {
			kind: "issue",
			issue: issue(
				"wire-edge-group-malformed-frame",
				`${name}: wire-edge payload must be a wire_edge frame`,
			),
		};
	const frame = (value as { frame?: unknown }).frame;
	const bad = validate(name, frame);
	return bad
		? { kind: "issue", issue: bad }
		: { kind: "frame", frame: clone(frame as CanonicalWireEdgeFrame) };
}
function validate(name: string, frame: unknown): WireEdgeGroupIssue | undefined {
	if (typeof frame !== "object" || frame === null)
		return issue("wire-edge-group-malformed-frame", `${name}: wire-edge frame must be an object`);
	const f = frame as Partial<CanonicalWireEdgeFrame>;
	if (f.kind !== "dirty" && f.kind !== "data")
		return issue(
			"wire-edge-group-malformed-frame",
			`${name}: wire-edge frame kind must be dirty or data`,
		);
	if (!f.edgeId)
		return issue(
			"wire-edge-group-malformed-frame",
			`${name}: wire-edge frame edgeId must be non-empty`,
			{ causeId: f.causeId },
		);
	if (!f.causeId)
		return issue(
			"wire-edge-group-malformed-frame",
			`${name}: wire-edge frame causeId must be non-empty`,
			{ edgeId: f.edgeId },
		);
	if (f.kind === "dirty" && f.value !== undefined)
		return issue(
			"wire-edge-group-malformed-frame",
			`${name}: DIRTY wire-edge frame must not carry value bytes`,
			{ edgeId: f.edgeId, causeId: f.causeId },
		);
	if (f.kind === "data" && !(f.value instanceof Uint8Array))
		return issue(
			"wire-edge-group-malformed-frame",
			`${name}: DATA wire-edge frame requires Uint8Array value bytes`,
			{ edgeId: f.edgeId, causeId: f.causeId },
		);
	return undefined;
}
function gateFn(
	name: string,
	expectedIds: readonly string[],
	releaseCohorts: Node<ReleaseCohort>,
	releaseDrains: WeakMap<ReleaseCohort, ReleaseDrain>,
): (ctx: Ctx) => void {
	const expected = new Set(expectedIds);
	return (ctx) => {
		let st = ctx.state.get<GateState>();
		if (!st) {
			st = {
				dirty: new Set(),
				data: new Map(),
				failed: new CauseTombstones(),
				released: new CauseTombstones(),
			};
			ctx.state.set(st);
			ctx.state.persist(true);
		}
		const emitIssue = (i: WireEdgeGroupIssue) =>
			ctx.down([["DATA", { kind: "issue", issue: i } satisfies Gate]]);
		const reset = () => {
			st.activeCauseId = undefined;
			st.dirty.clear();
			st.data.clear();
		};
		const fail = (causeId?: string) => {
			if (causeId) st.failed.add(causeId);
			reset();
		};
		const progress = (causeId: string) =>
			ctx.down([
				[
					"DATA",
					{ kind: "progress", causeId, dirty: st.dirty.size, data: st.data.size } satisfies Gate,
				],
			]);
		for (const raw of depBatch(ctx, 0) ?? []) {
			const ev = raw as Event;
			if (ev.kind === "issue") {
				emitIssue(ev.issue);
				continue;
			}
			if (ev.kind === "outbound") continue;
			if (ev.kind === "bridge-end") {
				if (st.activeCauseId) {
					emitIssue(
						issue(
							"wire-edge-group-incomplete-cause",
							`${name}: cause ${st.activeCauseId} ended before all expected edge frames arrived`,
							{ causeId: st.activeCauseId },
						),
					);
					fail(st.activeCauseId);
				}
				continue;
			}
			const f = ev.frame;
			if (st.failed.has(f.causeId)) {
				emitIssue(
					issue(
						"wire-edge-group-incomplete-cause",
						`${name}: cause ${f.causeId} was already failed closed`,
						{ edgeId: f.edgeId, causeId: f.causeId },
					),
				);
				continue;
			}
			if (st.released.has(f.causeId)) {
				emitIssue(
					issue(
						f.kind === "dirty"
							? "wire-edge-group-duplicate-dirty"
							: "wire-edge-group-duplicate-data",
						`${name}: cause ${f.causeId} was already released`,
						{ edgeId: f.edgeId, causeId: f.causeId },
					),
				);
				continue;
			}
			if (!expected.has(f.edgeId)) {
				emitIssue(
					issue("wire-edge-group-unknown-edge", `${name}: unknown edge ${f.edgeId}`, {
						edgeId: f.edgeId,
						causeId: f.causeId,
					}),
				);
				fail(f.causeId);
				continue;
			}
			if (!st.activeCauseId) st.activeCauseId = f.causeId;
			if (st.activeCauseId !== f.causeId) {
				const activeCauseId = st.activeCauseId;
				emitIssue(
					issue(
						"wire-edge-group-competing-cause",
						`${name}: competing cause ${f.causeId} arrived while ${activeCauseId} is active`,
						{ edgeId: f.edgeId, causeId: f.causeId, activeCauseId },
					),
				);
				emitIssue(
					issue(
						"wire-edge-group-incomplete-cause",
						`${name}: active cause ${activeCauseId} is incomplete`,
						{ causeId: activeCauseId },
					),
				);
				fail(activeCauseId);
				st.failed.add(f.causeId);
				continue;
			}
			if (f.kind === "dirty") {
				if (st.dirty.has(f.edgeId)) {
					emitIssue(
						issue(
							"wire-edge-group-duplicate-dirty",
							`${name}: duplicate DIRTY for edge ${f.edgeId}`,
							{ edgeId: f.edgeId, causeId: f.causeId },
						),
					);
					fail(f.causeId);
					continue;
				}
				st.dirty.add(f.edgeId);
				progress(f.causeId);
				continue;
			}
			if (!st.dirty.has(f.edgeId)) {
				emitIssue(
					issue(
						"wire-edge-group-data-before-dirty",
						`${name}: DATA for edge ${f.edgeId} arrived before DIRTY`,
						{ edgeId: f.edgeId, causeId: f.causeId },
					),
				);
				fail(f.causeId);
				continue;
			}
			if (st.data.has(f.edgeId)) {
				emitIssue(
					issue("wire-edge-group-duplicate-data", `${name}: duplicate DATA for edge ${f.edgeId}`, {
						edgeId: f.edgeId,
						causeId: f.causeId,
					}),
				);
				fail(f.causeId);
				continue;
			}
			st.data.set(f.edgeId, Uint8Array.from(f.value ?? new Uint8Array()));
			if (st.dirty.size === expectedIds.length && st.data.size === expectedIds.length) {
				const values = new Map<string, Uint8Array>();
				for (const edgeId of expectedIds) {
					const value = st.data.get(edgeId);
					if (value) values.set(edgeId, Uint8Array.from(value));
				}
				const cohort = { causeId: f.causeId, values } satisfies ReleaseCohort;
				const drain = releaseDrain(expectedIds);
				releaseDrains.set(cohort, drain);
				try {
					releaseCohorts.down([["DATA", cohort]]);
					const missing = drain.missing();
					if (missing.length > 0) {
						throw new Error(
							`${name}: release cohort ${f.causeId} was not consumed by inbound projectors before tombstone/reset (${missing.join(", ")})`,
						);
					}
				} finally {
					releaseDrains.delete(cohort);
				}
				ctx.down([["DATA", { kind: "release", causeId: f.causeId, values } satisfies Gate]]);
				st.released.add(f.causeId);
				reset();
			} else progress(f.causeId);
		}
	};
}
function statusFn(expectedIds: readonly string[]): (ctx: Ctx) => void {
	return (ctx) => {
		let next =
			ctx.state.get<WireEdgeGroupStatus>() ??
			({
				state: "idle",
				expectedEdges: [...expectedIds],
				dirty: 0,
				data: 0,
				released: 0,
				issues: 0,
			} satisfies WireEdgeGroupStatus);
		for (const raw of depBatch(ctx, 0) ?? []) {
			const ev = raw as Event;
			if (ev.kind === "issue")
				next = { ...next, state: "issues", issues: next.issues + 1, lastIssue: ev.issue };
		}
		for (const raw of depBatch(ctx, 1) ?? []) {
			const ev = raw as Gate;
			if (ev.kind === "issue")
				next = { ...next, state: "issues", issues: next.issues + 1, lastIssue: ev.issue };
			else if (ev.kind === "progress")
				next = {
					...next,
					state: "collecting",
					activeCauseId: ev.causeId,
					dirty: ev.dirty,
					data: ev.data,
				};
			else
				next = {
					...next,
					state: "released",
					activeCauseId: ev.causeId,
					dirty: expectedIds.length,
					data: expectedIds.length,
					released: next.released + ev.values.size,
				};
		}
		ctx.state.set(next);
		ctx.down([["DATA", next]]);
	};
}
