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
import {
	batch,
	DATA,
	derived,
	ERROR,
	type Node,
	placeholderArgs,
	state,
} from "../../core/index.js";
import { node } from "../../core/node.js";
import { domainMeta } from "../../extra/meta.js";
import {
	type BaseAuditRecord,
	bumpCursor,
	createAuditLog,
	lightMutation,
	registerCursor,
} from "../../extra/mutation/index.js";
import { reactiveList } from "../../extra/reactive-list.js";
import { type ReactiveLogBundle, reactiveLog } from "../../extra/reactive-log.js";
import { reactiveMap } from "../../extra/reactive-map.js";
import { fromAny, keepalive, type NodeInput } from "../../extra/sources.js";
import type { AppendLogStorageTier } from "../../extra/storage-tiers.js";
import { Graph, type GraphOptions } from "../../graph/index.js";

const DEFAULT_MAX_PER_PUMP = 256;
const DEFAULT_COMPLETED_RETAINED_LIMIT = 1024;

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

	// Tier 8 / COMPOSITION-GUIDE §35: lightMutation wrappers for the four
	// single-record mutation methods. Assigned in the constructor (NOT via
	// class-field initializers) because field initializers run before the
	// constructor body — `this.events` and `this._seqCursor` aren't ready yet.
	// `claim` stays inline because it emits one record per claimed job.
	private readonly _enqueueImpl: (
		payload: T,
		opts: { id?: string; metadata?: Record<string, unknown> },
	) => string;
	private readonly _ackImpl: (id: string, job: JobEnvelope<T>) => void;
	private readonly _nackImpl: (id: string, job: JobEnvelope<T>, requeue: boolean) => void;
	private readonly _removeByIdImpl: (id: string, job: JobEnvelope<T>) => void;

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

		// `freeze: false` everywhere because the payload may be large and
		// per-mutation cost matters on hot paths. lightMutation bumps `seq` via
		// the registered cursor BEFORE the action runs, so action bodies that
		// need the just-bumped value (e.g. enqueue's auto-id) read
		// `this._seqCursor.cache`.
		this._enqueueImpl = lightMutation<
			[T, { id?: string; metadata?: Record<string, unknown> }],
			string,
			JobEvent<T>
		>(
			(payload, enqueueOpts): string => {
				const seq = this._seqCursor.cache as number;
				const id = enqueueOpts.id ?? `${this.name}-${seq}`;
				if (this._jobs.get(id) !== undefined) {
					throw new Error(`jobQueue("${this.name}"): duplicate job id "${id}"`);
				}
				const job: JobEnvelope<T> = {
					id,
					payload,
					attempts: 0,
					metadata: Object.freeze({ ...(enqueueOpts.metadata ?? {}) }),
					state: "queued",
				};
				this._jobs.set(id, job);
				this._pending.append(id);
				return id;
			},
			{
				audit: this.events,
				seq: this._seqCursor,
				freeze: false,
				onSuccess: ([payload], id, { t_ns, seq }) => ({
					action: "enqueue",
					id,
					payload,
					t_ns,
					seq: seq ?? 0,
				}),
			},
		);

		this._ackImpl = lightMutation<[string, JobEnvelope<T>], void, JobEvent<T>>(
			(id, _job): void => {
				this._jobs.delete(id);
			},
			{
				audit: this.events,
				seq: this._seqCursor,
				freeze: false,
				onSuccess: ([id, job], _r, { t_ns, seq }) => ({
					action: "ack",
					id,
					attempts: job.attempts,
					t_ns,
					seq: seq ?? 0,
				}),
			},
		);

		this._nackImpl = lightMutation<[string, JobEnvelope<T>, boolean], void, JobEvent<T>>(
			(id, job, requeue): void => {
				if (requeue) {
					this._jobs.set(id, { ...job, state: "queued" });
					this._pending.append(id);
				} else {
					this._jobs.delete(id);
				}
			},
			{
				audit: this.events,
				seq: this._seqCursor,
				freeze: false,
				onSuccess: ([id, job], _r, { t_ns, seq }) => ({
					action: "nack",
					id,
					attempts: job.attempts,
					t_ns,
					seq: seq ?? 0,
				}),
			},
		);

		this._removeByIdImpl = lightMutation<[string, JobEnvelope<T>], void, JobEvent<T>>(
			(id, job): void => {
				if (job.state === "queued") {
					const pending = this.pending.cache as readonly string[];
					const idx = pending.indexOf(id);
					if (idx >= 0) this._pending.pop(idx);
				}
				this._jobs.delete(id);
			},
			{
				audit: this.events,
				seq: this._seqCursor,
				freeze: false,
				onSuccess: ([id, job], _r, { t_ns, seq }) => ({
					action: "remove",
					id,
					attempts: job.attempts,
					t_ns,
					seq: seq ?? 0,
				}),
			},
		);
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
		return this._enqueueImpl(payload, opts);
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
			// claim emits one audit record per claimed job; lightMutation wraps a
			// single call → single record, so claim stays inline and bumps the
			// cursor directly via the shared `bumpCursor` helper.
			this.events.append({
				action: "claim",
				id,
				attempts: inflight.attempts,
				t_ns: wallClockNs(),
				seq: bumpCursor(this._seqCursor),
			});
		}
		return out;
	}

	ack(id: string): boolean {
		const job = this._jobs.get(id);
		if (!job || job.state !== "inflight") return false;
		this._ackImpl(id, job);
		return true;
	}

	nack(id: string, opts: { requeue?: boolean } = {}): boolean {
		const job = this._jobs.get(id);
		if (!job || job.state !== "inflight") return false;
		this._nackImpl(id, job, opts.requeue ?? true);
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
		this._removeByIdImpl(id, job);
		return true;
	}

	/**
	 * Subscribe to a Node and enqueue each DATA payload into this queue.
	 * Returns a disposer that stops consuming when called.
	 *
	 * Used internally by {@link JobFlowGraph} for stage-to-stage wiring but
	 * also useful for users wiring an external source into a job queue.
	 *
	 * @param source - Node whose DATA values are enqueued.
	 * @param opts - Optional enqueue options (id generator, metadata prefix).
	 */
	consumeFrom(
		source: Node<T>,
		opts?: {
			metadata?: Record<string, unknown>;
		},
	): () => void {
		return source.subscribe((msgs) => {
			for (const m of msgs) {
				if (m[0] !== DATA) continue;
				const payload = m[1] as T;
				this.enqueue(payload, opts ? { metadata: opts.metadata } : undefined);
			}
		});
	}
}

// ── StageDef ─────────────────────────────────────────────────────────────

/**
 * Work function for a job flow stage. Receives the full job envelope and
 * an optional per-claim options object carrying an `AbortSignal`; returns
 * a `NodeInput<T>` — raw value (sync), Promise (async), or Node (composed
 * pipeline). `fromAny` coerces any of these shapes.
 *
 * On error / rejection: the stage nacks the job (no requeue by default).
 *
 * **Per-claim signal (Tier 6.5 2.5b, 2026-04-29).** The pump mints an
 * `AbortController` per claim and supplies its `signal` via `opts`. The
 * signal aborts when (a) the result node settles (first DATA / first
 * ERROR — auto-cleanup after the pump captures), OR (b) the pump itself
 * tears down (e.g. parent Graph `destroy()`). User-supplied work fns that
 * do long-running async (HTTP, LLM streams, evaluator subgraphs) can
 * forward this signal into `fetch({ signal })`, `adapter.invoke({ signal
 * })`, etc. for cooperative cancellation. Sync work fns ignore `opts` —
 * the second arg is optional, no behavior change for legacy callers.
 *
 * Mirrors the `LLMInvokeOptions.signal` / `apply(item, { signal })` /
 * tool-handler `(args, { signal })` precedents — same shape across the
 * library's user-callback boundaries.
 */
export type WorkFn<T> = (job: JobEnvelope<T>, opts?: { signal: AbortSignal }) => NodeInput<T>;

/**
 * Stage definition for {@link JobFlowGraph}. Either a bare name string
 * (no work hook, pure pass-through) or a full definition object.
 */
export type StageDef<T> =
	| string
	| {
			name: string;
			work?: WorkFn<T>;
			handlerVersion?: { id: string; version: string | number };
			/**
			 * Per-stage cap on `claim → work → ack` cycles per pump tick.
			 * Overrides {@link JobFlowOptions.maxPerPump} for this stage. Useful
			 * when stages have asymmetric cost (e.g. an LLM-execute stage capped
			 * at 4 concurrent calls while a cheap verify stage runs unbounded).
			 *
			 * Falls back to the top-level `JobFlowOptions.maxPerPump`, which in
			 * turn falls back to `DEFAULT_MAX_PER_PUMP` (256).
			 */
			maxPerPump?: number;
			/**
			 * Per-stage cap on TOTAL concurrent inflight claims (Tier 6.5 3.1,
			 * 2026-04-29). Distinct from {@link maxPerPump}: `maxPerPump` caps
			 * claims per pump tick, while `maxInflight` caps the number of
			 * unsettled in-flight claims at any moment across all ticks. Use
			 * for rigorous LLM cost ceilings (e.g. "no more than 4 concurrent
			 * adapter.invoke calls regardless of pending depth").
			 *
			 * When set, the stage mounts an internal `state(0)` counter as a
			 * pump dep so the pump re-fires on each settle — pending items
			 * resume claiming as soon as inflight drops below the cap.
			 *
			 * Unset (default): unbounded inflight, gated only by `maxPerPump`.
			 */
			maxInflight?: number;
	  };

export type JobFlowOptions<T = unknown> = {
	graph?: GraphOptions;
	/**
	 * Stage definitions. Each stage is either a bare name string (pure
	 * pass-through) or a `{ name, work?, handlerVersion?, maxPerPump? }` object.
	 *
	 * For back-compat, `string[]` values behave as stages with no work hook.
	 */
	stages?: readonly StageDef<T>[];
	/**
	 * Default cap on claims per pump tick across all stages. Per-stage
	 * overrides can be set on each {@link StageDef.maxPerPump}; if neither is
	 * set, falls back to `DEFAULT_MAX_PER_PUMP` (256).
	 */
	maxPerPump?: number;
};

export class JobFlowGraph<T> extends Graph {
	private readonly _stageNames: readonly string[];
	private readonly _stageWorkFns: ReadonlyMap<string, WorkFn<T>>;
	private readonly _queues = new Map<string, JobQueueGraph<T>>();
	private readonly _completed;
	readonly completed: Node<readonly JobEnvelope<T>[]>;
	readonly completedCount: Node<number>;

	constructor(name: string, opts: JobFlowOptions<T> = {}) {
		super(name, opts.graph);

		// Normalise stage definitions.
		const rawStages = opts.stages ?? (["incoming", "processing", "done"] as readonly StageDef<T>[]);
		const stageNames: string[] = [];
		const stageWorkFns = new Map<string, WorkFn<T>>();
		const stageMaxPerPump = new Map<string, number>();
		const stageMaxInflight = new Map<string, number>();

		for (const raw of rawStages) {
			const stageName = typeof raw === "string" ? raw.trim() : raw.name.trim();
			if (typeof raw !== "string" && raw.work) {
				stageWorkFns.set(stageName, raw.work);
			}
			if (typeof raw !== "string" && raw.maxPerPump != null) {
				stageMaxPerPump.set(
					stageName,
					Math.max(
						1,
						requireNonNegativeInt(raw.maxPerPump, `job flow stage "${stageName}" maxPerPump`),
					),
				);
			}
			if (typeof raw !== "string" && raw.maxInflight != null) {
				stageMaxInflight.set(
					stageName,
					Math.max(
						1,
						requireNonNegativeInt(raw.maxInflight, `job flow stage "${stageName}" maxInflight`),
					),
				);
			}
			stageNames.push(stageName);
		}

		if (stageNames.length < 2) {
			throw new Error(`jobFlow("${name}"): requires at least 2 stages`);
		}
		const unique = new Set(stageNames);
		if (unique.size !== stageNames.length) {
			throw new Error(`jobFlow("${name}"): stage names must be unique`);
		}
		this._stageNames = Object.freeze([...stageNames]);
		this._stageWorkFns = stageWorkFns;

		for (const stage of this._stageNames) {
			const q = jobQueue<T>(`${name}-${stage}`);
			this._queues.set(stage, q);
			this.mount(stage, q);
		}

		this._completed = reactiveLog<JobEnvelope<T>>([], {
			name: "completed",
			maxSize: DEFAULT_COMPLETED_RETAINED_LIMIT,
		});
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

		const defaultMaxPerPump = Math.max(
			1,
			requireNonNegativeInt(opts.maxPerPump ?? DEFAULT_MAX_PER_PUMP, "job flow maxPerPump"),
		);

		// Wire up per-stage pumps.
		for (let i = 0; i < this._stageNames.length; i += 1) {
			const stage = this._stageNames[i] as string;
			const current = this.queue(stage);
			const next =
				i + 1 < this._stageNames.length ? this.queue(this._stageNames[i + 1] as string) : null;
			const workFn = this._stageWorkFns.get(stage);
			// Per-stage `maxPerPump` override falls back to the top-level cap.
			// Captured per stage so each pump's loop sees its own resolved limit.
			const stagePerPump = stageMaxPerPump.get(stage) ?? defaultMaxPerPump;
			const stageMaxInflightCap = stageMaxInflight.get(stage);
			// When `maxInflight` is set, mount a state(0) counter on the graph
			// and wire it as an extra pump dep — settles `inflightCounter.emit`
			// re-fire the pump so pending items resume claiming after each
			// settle (without a counter, the pump only fires on `pending`
			// changes, which `ack` does not affect → maxInflight at saturation
			// would deadlock the queue).
			// qa F-D (Tier 5 /qa pass, 2026-04-29): mount under `__inflight__/`
			// internal namespace so the counter cannot collide with a user-named
			// stage (e.g. `inflight_my-stage`). Matches the EH-16
			// `__processManagers__/<name>` convention (COMPOSITION-GUIDE §38 —
			// internal infrastructure paths use the `__` prefix).
			const inflightCounter =
				stageMaxInflightCap !== undefined
					? state<number>(0, { name: `__inflight__/${stage}` })
					: null;
			if (inflightCounter) {
				this.add(inflightCounter, { name: `__inflight__/${stage}` });
			}

			// `isTerminal` marks the last stage — completed jobs go into
			// `_completed` log instead of a next queue.
			const isTerminal = next === null;

			if (workFn) {
				// ── Stage with work hook ──────────────────────────────────────
				// Pump effect: claim one job, run work(job), forward result on
				// success; nack on failure.
				// Per B.3 lock: effects ARE sanctioned for side-effects.
				// `fromAny` bridges sync value / Promise / Node → Node<T>.
				//
				// **Inflight teardown drain (Tier 6.5 2.5a, 2026-04-29).** Each
				// claim mints a per-claim `AbortController` and tracks the
				// `(unsub, ac)` pair in a `ctx.store.inflight` Set. The
				// per-claim signal is supplied to the work fn via the optional
				// second-arg `{ signal }` (mirrors `LLMInvokeOptions.signal` /
				// `apply(item, {signal})` / tool-handler precedents). On the
				// pump's `deactivate` hook (parent Graph TEARDOWN cascade —
				// e.g. `harness.destroy()`), every inflight entry is aborted +
				// unsubscribed so user-supplied async work (LLM streams, eval
				// HTTP calls, refineLoop iterations) gets cooperative
				// cancellation instead of leaking past the harness lifetime.
				type InflightEntry = { unsub: () => void; ac: AbortController };
				type InflightStore = { entries: Set<InflightEntry>; terminated: boolean };
				const pumpDeps: Node[] =
					inflightCounter != null ? [current.pending, inflightCounter] : [current.pending];
				const pump = node<unknown>(
					pumpDeps,
					(_data, _actions, ctx) => {
						if (!("inflight" in ctx.store)) {
							ctx.store.inflight = {
								entries: new Set<InflightEntry>(),
								terminated: false,
							} satisfies InflightStore;
						}
						const inflightStore = ctx.store.inflight as InflightStore;
						const inflight = inflightStore.entries;
						let processed = 0;
						while (processed < stagePerPump) {
							// 3.1 maxInflight gate: cap concurrent inflight across pump
							// ticks. The inflightCounter (mounted as a pump dep) re-fires
							// the pump when a settle decrements it, so pending items
							// resume claiming when capacity frees up.
							if (stageMaxInflightCap !== undefined && inflight.size >= stageMaxInflightCap) {
								break;
							}
							const claims = current.claim(1);
							if (claims.length === 0) break;
							const job = claims[0] as JobEnvelope<T>;
							if (!job) break;

							// Build the updated path accumulator.
							const prevPath = (job.metadata.job_flow_path as readonly string[] | undefined) ?? [];
							const newPath = [...prevPath, stage];

							const ac = new AbortController();
							const entry: InflightEntry = { unsub: () => undefined, ac };
							inflight.add(entry);
							inflightCounter?.emit(inflight.size);

							let result: NodeInput<T>;
							try {
								result = workFn(job, { signal: ac.signal });
							} catch {
								// Sync throw → nack no-requeue.
								inflight.delete(entry);
								inflightCounter?.emit(inflight.size);
								current.nack(job.id, { requeue: false });
								processed += 1;
								continue;
							}

							// Coerce to Node<T> via fromAny.
							const resultNode = fromAny<T>(result);

							// M8: Subscribe once to the result node; on DATA forward; on ERROR nack.
							// Use `let unsub` + TDZ guard (same pattern as toPromise) so sync
							// DATA delivery inside subscribe() doesn't hit TDZ on `unsub`.
							let settled = false;
							let unsub: (() => void) | undefined;
							const cleanupSub = (): void => {
								if (unsub) {
									unsub();
								} else {
									Promise.resolve().then(() => unsub?.());
								}
								inflight.delete(entry);
								// qa F-F (Tier 5 /qa pass, 2026-04-29): skip the counter
								// emit after teardown — the counter Node is itself in the
								// cascade. Late ERROR/DATA arriving via the deferred
								// `Promise.resolve().then(unsub)` path could otherwise emit
								// on a torn-down node.
								if (!inflightStore.terminated) {
									inflightCounter?.emit(inflight.size);
								}
							};
							unsub = resultNode.subscribe((msgs) => {
								if (settled) return;
								for (const m of msgs) {
									if (m[0] === DATA) {
										settled = true;
										cleanupSub();
										const newPayload = m[1] as T;
										const newMetadata = {
											...job.metadata,
											job_flow_path: newPath,
										};
										if (isTerminal) {
											const completedJob: JobEnvelope<T> = {
												...job,
												payload: newPayload,
												metadata: Object.freeze(newMetadata),
											};
											batch(() => {
												current.ack(job.id);
												this._completed.append(completedJob);
											});
										} else {
											batch(() => {
												current.ack(job.id);
												(next as JobQueueGraph<T>).enqueue(newPayload, {
													metadata: newMetadata,
												});
											});
										}
										return;
									} else if (m[0] === ERROR) {
										settled = true;
										cleanupSub();
										current.nack(job.id, { requeue: false });
										return;
									}
								}
							});
							entry.unsub = () => unsub?.();

							processed += 1;
						}
						return {
							deactivate: () => {
								// qa F-F: set terminated BEFORE draining so any
								// `cleanupSub` racing via the deferred-microtask path
								// (`Promise.resolve().then(() => unsub?.())`) sees
								// `terminated === true` and skips its `inflightCounter.emit`.
								inflightStore.terminated = true;
								for (const e of inflight) {
									try {
										e.ac.abort();
									} catch {
										// best-effort
									}
									try {
										e.unsub();
									} catch {
										// best-effort
									}
								}
								inflight.clear();
							},
						};
					},
					{
						name: `pump_${stage}`,
						describeKind: "effect",
						meta: jobQueueMeta("job_flow_pump", { stage, has_work: true }),
					},
				);
				this.add(pump, { name: `pump_${stage}` });
				this.addDisposer(keepalive(pump));
			} else {
				// ── Stage without work hook (pass-through ferry) ──────────────
				// Claim, accumulate path, forward to next stage or completed.
				const pump = node<unknown>(
					[current.pending],
					() => {
						let moved = 0;
						while (moved < stagePerPump) {
							const claim = current.claim(1);
							if (claim.length === 0) break;
							const job = claim[0] as JobEnvelope<T>;
							if (!job) break;

							const prevPath = (job.metadata.job_flow_path as readonly string[] | undefined) ?? [];
							const newPath = [...prevPath, stage];
							const newMetadata = { ...job.metadata, job_flow_path: newPath };

							if (isTerminal) {
								const completedJob: JobEnvelope<T> = {
									...job,
									metadata: Object.freeze(newMetadata),
								};
								batch(() => {
									current.ack(job.id);
									this._completed.append(completedJob);
								});
							} else {
								batch(() => {
									current.ack(job.id);
									(next as JobQueueGraph<T>).enqueue(job.payload, {
										metadata: newMetadata,
									});
								});
							}
							moved += 1;
						}
					},
					{
						name: `pump_${stage}`,
						describeKind: "effect",
						meta: jobQueueMeta("job_flow_pump", { stage, has_work: false }),
					},
				);
				this.add(pump, { name: `pump_${stage}` });
				this.addDisposer(keepalive(pump));
			}
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
export function jobFlow<T>(name: string, opts?: JobFlowOptions<T>): JobFlowGraph<T> {
	const g = new JobFlowGraph<T>(name, opts);
	// Tier 1.5.3 Phase 2.5 (DG1=B): tag the Graph with its constructing
	// factory so `describe()` surfaces provenance. Route through
	// `placeholderArgs` since `stages[].work` is a function and
	// `opts.graph` may carry non-JSON fields.
	const { factory: _f, factoryArgs: _fa, ...tagArgs } = (opts ?? {}) as Record<string, unknown>;
	g.tagFactory("jobFlow", placeholderArgs(tagArgs));
	return g;
}
