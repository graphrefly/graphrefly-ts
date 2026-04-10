/**
 * Messaging patterns (roadmap §4.2).
 *
 * Pulsar-inspired messaging features modeled as graph factories:
 * - `topic()` for append-only topic streams
 * - `subscription()` for cursor-based consumers
 * - `jobQueue()` for queue claim/ack flow
 */

import { DATA, derived, type Node, node, state } from "../core/index.js";
import { reactiveList } from "../extra/reactive-list.js";
import { reactiveLog } from "../extra/reactive-log.js";
import { reactiveMap } from "../extra/reactive-map.js";
import { Graph, type GraphOptions } from "../graph/index.js";

const DEFAULT_MAX_PER_PUMP = 2_147_483_647;

function requireNonNegativeInt(value: number, label: string): number {
	if (!Number.isFinite(value) || !Number.isInteger(value) || value < 0) {
		throw new Error(`${label} must be a non-negative integer`);
	}
	return value;
}

import { domainMeta, keepalive } from "./_internal.js";

function messagingMeta(kind: string, extra?: Record<string, unknown>): Record<string, unknown> {
	return domainMeta("messaging", kind, extra);
}

export type TopicOptions = {
	graph?: GraphOptions;
	retainedLimit?: number;
};

export class TopicGraph<T> extends Graph {
	private readonly _log;
	readonly events: Node<readonly T[]>;
	readonly latest: Node<T | undefined>;

	constructor(name: string, opts: TopicOptions = {}) {
		super(name, opts.graph);
		this._log = reactiveLog<T>([], { name: "events", maxSize: opts.retainedLimit });
		this.events = this._log.entries;
		this.add("events", this.events);
		this.latest = derived<T | undefined>(
			[this.events],
			([snapshot]) => {
				const entries = snapshot as readonly T[];
				return entries.length === 0 ? undefined : entries[entries.length - 1];
			},
			{
				name: "latest",
				describeKind: "derived",
				meta: messagingMeta("topic_latest"),
				initial: undefined,
			},
		);
		this.add("latest", this.latest);
		this.connect("events", "latest");
		this.addDisposer(keepalive(this.latest));
	}

	publish(value: T): void {
		this._log.append(value);
	}

	retained(): readonly T[] {
		return this.events.get() as readonly T[];
	}
}

export type SubscriptionOptions = {
	graph?: GraphOptions;
	cursor?: number;
};

export class SubscriptionGraph<T> extends Graph {
	readonly source: Node<readonly T[]>;
	readonly cursor: Node<number>;
	readonly available: Node<readonly T[]>;

	constructor(name: string, topicGraph: TopicGraph<T>, opts: SubscriptionOptions = {}) {
		super(name, opts.graph);
		const initialCursor = requireNonNegativeInt(opts.cursor ?? 0, "subscription cursor");
		this.mount("topic", topicGraph);
		const topicEvents = topicGraph.events;
		this.source = derived([topicEvents], ([snapshot]) => snapshot as readonly T[], {
			name: "source",
			describeKind: "derived",
			meta: messagingMeta("subscription_source"),
			initial: topicEvents.get() as readonly T[],
		});
		this.add("source", this.source);
		this.cursor = state(initialCursor, {
			name: "cursor",
			describeKind: "state",
			meta: messagingMeta("subscription_cursor"),
		});
		this.add("cursor", this.cursor);
		this.available = derived(
			[this.source, this.cursor],
			([sourceSnapshot, cursor]) => {
				const entries = sourceSnapshot as readonly T[];
				const start = Math.max(0, Math.trunc((cursor as number) ?? 0));
				return entries.slice(start);
			},
			{
				name: "available",
				describeKind: "derived",
				meta: messagingMeta("subscription_available"),
				initial: [],
			},
		);
		this.add("available", this.available);
		this.connect("topic::events", "source");
		this.connect("source", "available");
		this.connect("cursor", "available");
		this.addDisposer(keepalive(this.source));
		this.addDisposer(keepalive(this.available));
	}

	ack(count?: number): number {
		const available = this.available.get() as readonly T[];
		const requested =
			count === undefined
				? available.length
				: requireNonNegativeInt(count, "subscription ack count");
		const step = Math.min(requested, available.length);
		if (step <= 0) return this.cursor.get() as number;
		const next = (this.cursor.get() as number) + step;
		this.cursor.down([[DATA, next]]);
		return next;
	}

	pull(limit?: number, opts: { ack?: boolean } = {}): readonly T[] {
		const available = this.available.get() as readonly T[];
		const max =
			limit === undefined
				? available.length
				: requireNonNegativeInt(limit, "subscription pull limit");
		const out = available.slice(0, max);
		if (opts.ack && out.length > 0) this.ack(out.length);
		return out;
	}
}

export type JobState = "queued" | "inflight";

export type JobEnvelope<T> = {
	id: string;
	payload: T;
	attempts: number;
	metadata: Readonly<Record<string, unknown>>;
	state: JobState;
};

export type JobQueueOptions = {
	graph?: GraphOptions;
};

export class JobQueueGraph<T> extends Graph {
	private readonly _pending;
	private readonly _jobs;
	private _seq = 0;
	readonly pending: Node<readonly string[]>;
	readonly jobs: Node<ReadonlyMap<string, JobEnvelope<T>>>;
	readonly depth: Node<number>;

	constructor(name: string, opts: JobQueueOptions = {}) {
		super(name, opts.graph);
		this._pending = reactiveList<string>([], { name: "pending" });
		this._jobs = reactiveMap<string, JobEnvelope<T>>({ name: "jobs" });
		this.pending = this._pending.items;
		this.jobs = this._jobs.entries;
		this.add("pending", this.pending);
		this.add("jobs", this.jobs);
		this.depth = derived([this.pending], ([snapshot]) => (snapshot as readonly string[]).length, {
			name: "depth",
			describeKind: "derived",
			meta: messagingMeta("queue_depth"),
			initial: 0,
		});
		this.add("depth", this.depth);
		this.connect("pending", "depth");
		this.addDisposer(keepalive(this.depth));
	}

	enqueue(payload: T, opts: { id?: string; metadata?: Record<string, unknown> } = {}): string {
		const id = opts.id ?? `${this.name}-${++this._seq}`;
		if (this._jobs.get(id) !== undefined) {
			throw new Error(`jobQueue("${this.name}"): duplicate job id "${id}"`);
		}
		const job: JobEnvelope<T> = {
			id,
			payload,
			attempts: 0,
			metadata: Object.freeze({ ...(opts.metadata ?? {}) }),
			state: "queued",
		};
		this._jobs.set(id, job);
		this._pending.append(id);
		return id;
	}

	claim(limit = 1): readonly JobEnvelope<T>[] {
		const max = requireNonNegativeInt(limit, "job queue claim limit");
		if (max === 0) return [];
		const out: JobEnvelope<T>[] = [];
		while (out.length < max) {
			const ids = this.pending.get() as readonly string[];
			if (ids.length === 0) break;
			const id = this._pending.pop(0);
			const job = this._jobs.get(id);
			if (!job || job.state !== "queued") continue;
			const inflight: JobEnvelope<T> = {
				...job,
				state: "inflight",
				attempts: job.attempts + 1,
			};
			this._jobs.set(id, inflight);
			out.push(inflight);
		}
		return out;
	}

	ack(id: string): boolean {
		const job = this._jobs.get(id);
		if (!job || job.state !== "inflight") return false;
		this._jobs.delete(id);
		return true;
	}

	nack(id: string, opts: { requeue?: boolean } = {}): boolean {
		const job = this._jobs.get(id);
		if (!job || job.state !== "inflight") return false;
		if (opts.requeue ?? true) {
			this._jobs.set(id, { ...job, state: "queued" });
			this._pending.append(id);
			return true;
		}
		this._jobs.delete(id);
		return true;
	}
}

export type JobFlowOptions = {
	graph?: GraphOptions;
	stages?: readonly string[];
	maxPerPump?: number;
};

export class JobFlowGraph<T> extends Graph {
	private readonly _stageNames: readonly string[];
	private readonly _queues = new Map<string, JobQueueGraph<T>>();
	private readonly _completed;
	readonly completed: Node<readonly JobEnvelope<T>[]>;
	readonly completedCount: Node<number>;

	constructor(name: string, opts: JobFlowOptions = {}) {
		super(name, opts.graph);
		const stages = (opts.stages ?? ["incoming", "processing", "done"]).map((v) => v.trim());
		if (stages.length < 2) {
			throw new Error(`jobFlow("${name}"): requires at least 2 stages`);
		}
		const unique = new Set(stages);
		if (unique.size !== stages.length) {
			throw new Error(`jobFlow("${name}"): stage names must be unique`);
		}
		this._stageNames = Object.freeze([...stages]);
		for (const stage of this._stageNames) {
			const q = jobQueue<T>(`${name}-${stage}`);
			this._queues.set(stage, q);
			this.mount(stage, q);
		}
		this._completed = reactiveLog<JobEnvelope<T>>([], { name: "completed" });
		this.completed = this._completed.entries;
		this.add("completed", this.completed);
		this.completedCount = derived(
			[this.completed],
			([snapshot]) => (snapshot as readonly JobEnvelope<T>[]).length,
			{
				name: "completedCount",
				describeKind: "derived",
				meta: messagingMeta("job_flow_completed_count"),
				initial: 0,
			},
		);
		this.add("completedCount", this.completedCount);
		this.connect("completed", "completedCount");
		this.addDisposer(keepalive(this.completedCount));

		const maxPerPump = Math.max(
			1,
			requireNonNegativeInt(opts.maxPerPump ?? DEFAULT_MAX_PER_PUMP, "job flow maxPerPump"),
		);
		for (let i = 0; i < this._stageNames.length; i += 1) {
			const stage = this._stageNames[i] as string;
			const current = this.queue(stage);
			const next =
				i + 1 < this._stageNames.length ? this.queue(this._stageNames[i + 1] as string) : null;
			const pump = node<unknown>(
				[current.pending],
				() => {
					let moved = 0;
					while (moved < maxPerPump) {
						const claim = current.claim(1);
						if (claim.length === 0) break;
						const job = claim[0] as JobEnvelope<T>;
						if (!job) break;
						if (next) {
							next.enqueue(job.payload, {
								metadata: {
									...job.metadata,
									job_flow_from: stage,
								},
							});
						} else {
							this._completed.append(job);
						}
						current.ack(job.id);
						moved += 1;
					}
				},
				{
					name: `pump_${stage}`,
					describeKind: "effect",
					meta: messagingMeta("job_flow_pump"),
				},
			);
			this.add(`pump_${stage}`, pump);
			this.connect(`${stage}::pending`, `pump_${stage}`);
			this.addDisposer(keepalive(pump));
		}
	}

	stages(): readonly string[] {
		return this._stageNames;
	}

	queue(stage: string): JobQueueGraph<T> {
		const q = this._queues.get(stage);
		if (!q) throw new Error(`jobFlow("${this.name}"): unknown stage "${stage}"`);
		return q;
	}

	enqueue(payload: T, opts: { id?: string; metadata?: Record<string, unknown> } = {}): string {
		return this.queue(this._stageNames[0] as string).enqueue(payload, opts);
	}

	retainedCompleted(): readonly JobEnvelope<T>[] {
		return this.completed.get() as readonly JobEnvelope<T>[];
	}
}

export type TopicBridgeOptions<TIn, TOut> = {
	graph?: GraphOptions;
	cursor?: number;
	maxPerPump?: number;
	map?: (value: TIn) => TOut | undefined;
};

export class TopicBridgeGraph<TIn, TOut = TIn> extends Graph {
	private readonly _sourceSub;
	private readonly _target;
	readonly bridgedCount: Node<number>;

	constructor(
		name: string,
		sourceTopic: TopicGraph<TIn>,
		targetTopic: TopicGraph<TOut>,
		opts: TopicBridgeOptions<TIn, TOut> = {},
	) {
		super(name, opts.graph);
		this._sourceSub = subscription<TIn>(`${name}-subscription`, sourceTopic, {
			cursor: opts.cursor,
		});
		this._target = targetTopic;
		this.mount("subscription", this._sourceSub);
		this.bridgedCount = state(0, {
			name: "bridgedCount",
			describeKind: "state",
			meta: messagingMeta("topic_bridge_count"),
		});
		this.add("bridgedCount", this.bridgedCount);

		const maxPerPump = Math.max(
			1,
			requireNonNegativeInt(opts.maxPerPump ?? DEFAULT_MAX_PER_PUMP, "topic bridge maxPerPump"),
		);
		const mapValue = opts.map ?? ((value: TIn) => value as unknown as TOut);
		const pump = node<unknown>(
			[this._sourceSub.available],
			() => {
				const available = this._sourceSub.pull(maxPerPump, { ack: true });
				if (available.length === 0) return;
				let bridged = 0;
				for (const value of available) {
					const mapped = mapValue(value as TIn);
					if (mapped === undefined) continue;
					this._target.publish(mapped);
					bridged += 1;
				}
				if (bridged > 0) {
					const current = this.bridgedCount.get() as number;
					this.bridgedCount.down([[DATA, current + bridged]]);
				}
			},
			{
				name: "pump",
				describeKind: "effect",
				meta: messagingMeta("topic_bridge_pump"),
			},
		);
		this.add("pump", pump);
		this.connect("subscription::available", "pump");
		this.addDisposer(keepalive(pump));
	}
}

/**
 * Creates a Pulsar-inspired topic graph (append-only retained stream + latest value).
 */
export function topic<T>(name: string, opts?: TopicOptions): TopicGraph<T> {
	return new TopicGraph<T>(name, opts);
}

/**
 * Creates a cursor-based subscription graph over a topic.
 */
export function subscription<T>(
	name: string,
	topicGraph: TopicGraph<T>,
	opts?: SubscriptionOptions,
): SubscriptionGraph<T> {
	return new SubscriptionGraph<T>(name, topicGraph, opts);
}

/**
 * Creates a Pulsar-inspired job queue graph with claim/ack/nack workflow.
 */
export function jobQueue<T>(name: string, opts?: JobQueueOptions): JobQueueGraph<T> {
	return new JobQueueGraph<T>(name, opts);
}

/**
 * Creates an autonomous multi-stage queue chain graph.
 */
export function jobFlow<T>(name: string, opts?: JobFlowOptions): JobFlowGraph<T> {
	return new JobFlowGraph<T>(name, opts);
}

/**
 * Creates an autonomous cursor-based topic relay graph.
 */
export function topicBridge<TIn, TOut = TIn>(
	name: string,
	sourceTopic: TopicGraph<TIn>,
	targetTopic: TopicGraph<TOut>,
	opts?: TopicBridgeOptions<TIn, TOut>,
): TopicBridgeGraph<TIn, TOut> {
	return new TopicBridgeGraph<TIn, TOut>(name, sourceTopic, targetTopic, opts);
}
