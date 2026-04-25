/**
 * Job queue patterns (roadmap §4.2).
 *
 * Queue / flow primitives modeled as graph factories:
 * - `jobQueue()` — claim/ack/nack workflow with reactive depth.
 * - `jobFlow()` — multi-stage queue chain.
 *
 * Topic / subscription / hub primitives live in `patterns/messaging`.
 */

import { wallClockNs } from "../../core/clock.js";
import { derived, type Node } from "../../core/index.js";
import { node } from "../../core/node.js";
import { reactiveList } from "../../extra/reactive-list.js";
import { type ReactiveLogBundle, reactiveLog } from "../../extra/reactive-log.js";
import { reactiveMap } from "../../extra/reactive-map.js";
import type { AppendLogStorageTier } from "../../extra/storage-tiers.js";
import { Graph, type GraphOptions } from "../../graph/index.js";
import {
	type BaseAuditRecord,
	createAuditLog,
	registerCursor,
} from "../_internal/imperative-audit.js";
import { domainMeta, keepalive } from "../_internal/index.js";

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

/** Audit record for a job-queue mutation (Audit 2 cross-cutting). */
export type JobEventAction = "enqueue" | "claim" | "ack" | "nack" | "remove";

export interface JobEvent<T = unknown> extends BaseAuditRecord {
	readonly action: JobEventAction;
	readonly id: string;
	readonly attempts?: number;
	readonly payload?: T;
}

/** Recommended `keyOf` for keyed-storage adapters (Audit 2 #7). */
export const jobEventKeyOf = <T>(e: JobEvent<T>): string => e.action;

export type JobQueueOptions = {
	graph?: GraphOptions;
};

export class JobQueueGraph<T> extends Graph {
	private readonly _pending;
	private readonly _jobs;
	private readonly _seqCursor: Node<number>;
	readonly pending: Node<readonly string[]>;
	readonly jobs: Node<ReadonlyMap<string, JobEnvelope<T>>>;
	readonly depth: Node<number>;
	/** Audit log of every queue mutation (Audit 2). */
	readonly events: ReactiveLogBundle<JobEvent<T>>;
	/** Alias for {@link JobQueueGraph.events} — Audit 2 `.audit` duplication. */
	readonly audit: ReactiveLogBundle<JobEvent<T>>;

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

		this.events = createAuditLog<JobEvent<T>>({
			name: "events",
			retainedLimit: 1024,
			graph: this,
		});
		this.audit = this.events;
		this._seqCursor = registerCursor(this, "seq", 0);
	}

	private _bumpSeq(): number {
		const cur = (this._seqCursor.cache as number | undefined) ?? 0;
		const next = cur + 1;
		this._seqCursor.emit(next);
		return next;
	}

	/**
	 * Wire append-log storage tiers (Audit 4). Returns a disposer.
	 *
	 * Named `attachEventStorage` to avoid colliding with {@link Graph.attachSnapshotStorage}.
	 */
	attachEventStorage(tiers: readonly AppendLogStorageTier<JobEvent<T>>[]): () => void {
		return this.events.attachStorage(tiers);
	}

	enqueue(payload: T, opts: { id?: string; metadata?: Record<string, unknown> } = {}): string {
		const seq = this._bumpSeq();
		const id = opts.id ?? `${this.name}-${seq}`;
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
		this.events.append({ action: "enqueue", id, payload, t_ns: wallClockNs(), seq });
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
			this.events.append({
				action: "claim",
				id,
				attempts: inflight.attempts,
				t_ns: wallClockNs(),
				seq: this._bumpSeq(),
			});
		}
		return out;
	}

	ack(id: string): boolean {
		const job = this._jobs.get(id);
		if (!job || job.state !== "inflight") return false;
		this._jobs.delete(id);
		this.events.append({
			action: "ack",
			id,
			attempts: job.attempts,
			t_ns: wallClockNs(),
			seq: this._bumpSeq(),
		});
		return true;
	}

	nack(id: string, opts: { requeue?: boolean } = {}): boolean {
		const job = this._jobs.get(id);
		if (!job || job.state !== "inflight") return false;
		if (opts.requeue ?? true) {
			this._jobs.set(id, { ...job, state: "queued" });
			this._pending.append(id);
			this.events.append({
				action: "nack",
				id,
				attempts: job.attempts,
				t_ns: wallClockNs(),
				seq: this._bumpSeq(),
			});
			return true;
		}
		this._jobs.delete(id);
		this.events.append({
			action: "nack",
			id,
			attempts: job.attempts,
			t_ns: wallClockNs(),
			seq: this._bumpSeq(),
		});
		return true;
	}

	/**
	 * Remove a job by id regardless of its current state. Returns `true` if
	 * the job existed and was removed, `false` if no job has this id.
	 *
	 * `ack` only works on inflight; `nack` only works on inflight.
	 * `removeById` is the state-agnostic escape hatch — useful for
	 * audit/observability layers that enqueue but never claim, and need to
	 * finalize a job when an external decision (e.g. harness verify
	 * outcome) resolves it. Distinct name from the inherited
	 * {@link Graph.remove}, which removes a mounted child subgraph by path.
	 *
	 * When the job is in `queued` state, its id is also pulled from the
	 * `pending` list — depth + pending snapshot stay consistent.
	 */
	removeById(id: string): boolean {
		const job = this._jobs.get(id);
		if (!job) return false;
		if (job.state === "queued") {
			const pending = this.pending.cache as readonly string[];
			const idx = pending.indexOf(id);
			if (idx >= 0) this._pending.pop(idx);
		}
		this._jobs.delete(id);
		this.events.append({
			action: "remove",
			id,
			attempts: job.attempts,
			t_ns: wallClockNs(),
			seq: this._bumpSeq(),
		});
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
