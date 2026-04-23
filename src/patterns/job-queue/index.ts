/**
 * Job queue patterns (roadmap §4.2).
 *
 * Queue / flow primitives modeled as graph factories:
 * - `jobQueue()` — claim/ack/nack workflow with reactive depth.
 * - `jobFlow()` — multi-stage queue chain.
 *
 * Topic / subscription / hub primitives live in `patterns/messaging`.
 */

import { derived, type Node } from "../../core/index.js";
import { node } from "../../core/node.js";
import { reactiveList } from "../../extra/reactive-list.js";
import { reactiveLog } from "../../extra/reactive-log.js";
import { reactiveMap } from "../../extra/reactive-map.js";
import { Graph, type GraphOptions } from "../../graph/index.js";
import { domainMeta, keepalive } from "../_internal.js";

const DEFAULT_MAX_PER_PUMP = 2_147_483_647;

function requireNonNegativeInt(value: number, label: string): number {
	if (!Number.isFinite(value) || !Number.isInteger(value) || value < 0) {
		throw new Error(`${label} must be a non-negative integer`);
	}
	return value;
}

function jobQueueMeta(kind: string, extra?: Record<string, unknown>): Record<string, unknown> {
	return domainMeta("job_queue", kind, extra);
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
		this.add(this.pending, { name: "pending" });
		this.add(this.jobs, { name: "jobs" });
		this.depth = derived([this.pending], ([snapshot]) => (snapshot as readonly string[]).length, {
			name: "depth",
			describeKind: "derived",
			meta: jobQueueMeta("queue_depth"),
			initial: 0,
		});
		this.add(this.depth, { name: "depth" });
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
			const ids = this.pending.cache as readonly string[];
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
		this.add(this.completed, { name: "completed" });
		this.completedCount = derived(
			[this.completed],
			([snapshot]) => (snapshot as readonly JobEnvelope<T>[]).length,
			{
				name: "completedCount",
				describeKind: "derived",
				meta: jobQueueMeta("job_flow_completed_count"),
				initial: 0,
			},
		);
		this.add(this.completedCount, { name: "completedCount" });
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
					meta: jobQueueMeta("job_flow_pump"),
				},
			);
			this.add(pump, { name: `pump_${stage}` });
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
		return this.completed.cache as readonly JobEnvelope<T>[];
	}
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
