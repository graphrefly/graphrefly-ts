/**
 * actuatorExecutor — bridge a side-effecting actuator into the harness EXECUTE slot.
 *
 * `refineExecutor` covers the artifact-typed case (refine a candidate
 * `T` against an evaluator); `actuatorExecutor` covers the side-effecting
 * case (write a catalog entry, mutate a template registry, edit a doc on
 * disk). The user's `apply` callback owns the side effect; the executor
 * wraps it in the per-item lifecycle that makes the four
 * {@link HarnessExecutor} contract rules structurally unreachable:
 *
 *  1. **One DATA per actuation.** The inner producer captures the first
 *     DATA from the bridged `apply` result, emits a single
 *     `ExecuteOutput<R>` carrying the actuation record as `artifact`, and
 *     completes. Subsequent inner DATAs are ignored.
 *  2. **Cancel-on-supersede.** A new triaged item supersedes via
 *     `switchMap`; the prior producer's cleanup fires `ac.abort()`, which
 *     propagates into `apply`'s `signal` (and through `fromAny`'s
 *     internal cancellation hooks) so signal-aware actuators stop
 *     in-flight work instead of double-writing.
 *  3. **Item via deps, not closure mirror.** The triaged item is captured
 *     in the `switchMap` callback's lexical scope, not mirrored to a
 *     side-state node — same shape as `refineExecutor`.
 *  4. **Fires on result, not input.** The producer emits exactly when
 *     `apply`'s bridged node settles (or fails). Input-arrival waves
 *     never produce an `ExecuteOutput`.
 *
 * **What `apply` may return.** Anything `fromAny` accepts: a
 * `Promise<R>`, a `Node<R>`, an `AsyncIterable<R>`, an `Iterable<R>`,
 * or a synchronous `R`. `Promise<R>` is the typical shape (`writeFile`,
 * `fetch`, `db.execute`); reactive composition through `Node<R>` is the
 * escape hatch when the actuator itself wants to surface intermediate
 * progress before settling.
 *
 * **Pairing with `evalVerifier`.** `ExecuteOutput.artifact` is set to
 * the actuation record; an `evalVerifier<R>` whose `extractArtifact`
 * returns the record (or a transform of it — typically the post-apply
 * world state needed by the evaluator) closes the EXECUTE → VERIFY loop
 * with consistent typing end-to-end.
 *
 * @module
 */

import { COMPLETE, DATA, ERROR, type Messages } from "../../core/messages.js";
import type { Node } from "../../core/node.js";
import { producer } from "../../core/sugar.js";
import { filter, switchMap } from "../../extra/operators.js";
import { fromAny, type NodeInput } from "../../extra/sources.js";

import type { ExecuteOutput, HarnessExecutor, TriagedItem } from "./types.js";

/**
 * What an actuator's `apply` may return. Mirrors `NodeInput<R>` plus a
 * raw `R` for synchronous side effects, so callers can write the most
 * direct shape for their case (Promise for async I/O, raw record for
 * pure in-memory mutation).
 */
export type ActuatorResult<R> = NodeInput<R>;

/** Configuration for {@link actuatorExecutor}. */
export interface ActuatorExecutorConfig<R> {
	/**
	 * Apply the side effect for this triaged item. Receives the abort
	 * signal — actuators that own real I/O should thread `signal` into
	 * `fetch`, `fs.writeFile`, child-process kills, etc. so that
	 * `switchMap` supersede actually cancels in-flight work.
	 *
	 * The first DATA emitted by the bridged result wins; later DATAs are
	 * discarded. ERROR (or a synchronous throw) is mapped via `onError`.
	 */
	apply: (item: TriagedItem, opts: { signal: AbortSignal }) => ActuatorResult<R>;

	/**
	 * Optional gate — when provided and returning `false`, the actuator
	 * is skipped and the executor emits an `ExecuteOutput` with
	 * `outcome: "failure"` and detail from `skipDetail` (default
	 * `"actuator skipped (shouldApply returned false)"`). Use this to
	 * route interventions the actuator can't handle (e.g. `intervention:
	 * "investigate"` items) into the failure path so the verifier sees
	 * them.
	 */
	shouldApply?: (item: TriagedItem) => boolean;

	/** Detail string for the skip path. Default: includes intervention name. */
	skipDetail?: (item: TriagedItem) => string;

	/**
	 * Map a successfully-applied actuation record into an `ExecuteOutput<R>`.
	 * Default: `outcome: "success"`, `detail` references the intervention
	 * + summary, `artifact: record`.
	 */
	toOutput?: (record: R, item: TriagedItem) => ExecuteOutput<R>;

	/**
	 * Map a thrown / ERROR result into an `ExecuteOutput<R>`. Default:
	 * `outcome: "failure"`, `detail` carries the error message,
	 * `artifact: undefined`.
	 */
	onError?: (err: unknown, item: TriagedItem) => ExecuteOutput<R>;

	/** Node name prefix for `describe()` introspection. Default `"actuator-executor"`. */
	name?: string;
}

function defaultToOutput<R>(record: R, item: TriagedItem): ExecuteOutput<R> {
	return {
		outcome: "success",
		detail: `actuator applied ${item.intervention} for ${truncate(item.summary)}`,
		artifact: record,
	};
}

function defaultOnError<R>(err: unknown, item: TriagedItem): ExecuteOutput<R> {
	const message = err instanceof Error ? err.message : String(err);
	return {
		outcome: "failure",
		detail: `actuator threw on ${item.intervention}: ${message}`,
	};
}

function defaultSkipDetail(item: TriagedItem): string {
	return `actuator skipped ${item.intervention} (shouldApply returned false)`;
}

function truncate(s: string, max = 80): string {
	return s.length <= max ? s : `${s.slice(0, max - 1)}…`;
}

/**
 * Build a {@link HarnessExecutor} backed by a side-effecting actuator.
 *
 * @example File-system actuator that writes a catalog entry and emits the diff.
 * ```ts
 * const harness = harnessLoop("repair", {
 *   adapter,
 *   executor: actuatorExecutor<CatalogPatch>({
 *     async apply(item, { signal }) {
 *       const patch = patchFromItem(item);
 *       await fs.writeFile(patch.path, patch.contents, { signal });
 *       return patch;
 *     },
 *     shouldApply: (item) => item.intervention === "catalog-fn",
 *   }),
 *   verifier: evalVerifier<CatalogPatch>({
 *     evaluator,
 *     datasetFor,
 *     extractArtifact: (exec) => exec.artifact ?? null,
 *   }),
 * });
 * ```
 */
export function actuatorExecutor<R>(config: ActuatorExecutorConfig<R>): HarnessExecutor<R> {
	const name = config.name ?? "actuator-executor";
	const toOutput = config.toOutput ?? defaultToOutput<R>;
	const onError = config.onError ?? defaultOnError<R>;
	const skipDetail = config.skipDetail ?? defaultSkipDetail;

	return (input: Node<TriagedItem | null>): Node<ExecuteOutput<R> | null> => {
		// Filter null items upstream of switchMap. The harness's `executeInput`
		// is a merge of queue-latest nodes that start nullish before any item
		// is published — without this gate, every activation wave would
		// allocate a fresh producer + AbortController inside the switchMap
		// callback. Mirrors the gate in `refineExecutor`.
		const nonNullInput = filter(input, (v) => v != null, {
			name: `${name}/gate-in`,
		}) as Node<TriagedItem>;

		const raw = switchMap<TriagedItem, ExecuteOutput<R> | null>(
			nonNullInput,
			(item) => {
				if (config.shouldApply && !config.shouldApply(item)) {
					return producer<ExecuteOutput<R> | null>(
						(actions) => {
							actions.down([
								[DATA, { outcome: "failure", detail: skipDetail(item) } as ExecuteOutput<R>],
								[COMPLETE],
							] satisfies Messages);
							return () => {};
						},
						{ name: `${name}/skip` },
					);
				}
				return producer<ExecuteOutput<R> | null>(
					(actions) => {
						const ac = new AbortController();
						let captured = false;
						let unsub: (() => void) | null = null;
						const emitOnce = (out: ExecuteOutput<R>): void => {
							if (captured) return;
							captured = true;
							actions.down([[DATA, out], [COMPLETE]] satisfies Messages);
							// Tear down the inner subscription as soon as we've
							// committed; later inner messages are noise.
							unsub?.();
							unsub = null;
						};
						let inner: Node<R>;
						try {
							const rawResult = config.apply(item, { signal: ac.signal });
							inner = fromAny<R>(rawResult, { signal: ac.signal });
						} catch (err) {
							// Synchronous throw from `apply` — emit failure
							// ExecuteOutput and complete. Producer cleanup still
							// aborts the controller for symmetry.
							emitOnce(onError(err, item));
							return () => {
								ac.abort();
							};
						}
						unsub = inner.subscribe((batch) => {
							for (const m of batch) {
								if (captured) return;
								if (m[0] === DATA) {
									emitOnce(toOutput(m[1] as R, item));
									return;
								}
								if (m[0] === ERROR) {
									emitOnce(onError(m[1], item));
									return;
								}
								if (m[0] === COMPLETE) {
									emitOnce(
										onError(new Error(`actuator inner completed without emitting DATA`), item),
									);
									return;
								}
							}
						});
						// If the subscribe fired synchronously (cached state /
						// `fromAny` on a sync value), the callback ran reentrantly
						// before `unsub` was assigned, so `emitOnce`'s `unsub?.()`
						// was a no-op. Drop the upstream subscription now that we
						// have the handle. Without this, the inner stays subscribed
						// until the outer producer tears down (downstream unsub or
						// switchMap supersede) — leaks for high-volume runs.
						if (captured && unsub) {
							unsub();
							unsub = null;
						}
						return () => {
							ac.abort();
							unsub?.();
							unsub = null;
						};
					},
					{ name: `${name}/inner` },
				);
			},
			{ name },
		);

		return filter(raw, (v) => v != null, {
			name: `${name}/gate-out`,
		}) as Node<ExecuteOutput<R> | null>;
	};
}
