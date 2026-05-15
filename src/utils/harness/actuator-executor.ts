/**
 * actuatorExecutor — bridge a side-effecting actuator into the harness
 * EXECUTE work fn.
 *
 * `refineExecutor` covers the artifact-typed case (refine a candidate
 * `T` against an evaluator); `actuatorExecutor` covers the side-effecting
 * case (write a catalog entry, mutate a template registry, edit a doc on
 * disk). The user's `apply` callback owns the side effect; the executor
 * wraps it in the per-claim lifecycle:
 *
 * 1. **One DATA per claim.** The producer captures the first DATA from
 *    the bridged `apply` result, emits a {@link HarnessJobPayload} with
 *    `execution` filled in, and completes. Subsequent inner DATAs are
 *    ignored.
 * 2. **Cancel-on-teardown.** When the JobFlow pump unsubscribes (after
 *    capturing first DATA, or on graph teardown), the producer's cleanup
 *    fires `ac.abort()` which propagates into `apply`'s `signal`.
 * 3. **Errors surfaced as failure payload.** A thrown / ERROR result is
 *    mapped via `onError` into a `failure`-outcome `ExecuteOutput` so the
 *    dispatch effect can route the item rather than silently dropping it.
 *
 * **What `apply` may return.** Anything `fromAny` accepts: `Promise<R>`,
 * `Node<R>`, `AsyncIterable<R>`, `Iterable<R>`, or a synchronous `R`.
 * `Promise<R>` is the typical shape (`writeFile`, `fetch`, `db.execute`).
 *
 * **Pairing with `evalVerifier`.** `ExecuteOutput.artifact` is set to
 * the actuation record; an `evalVerifier<R>` whose `extractArtifact`
 * returns the record (or the post-apply world state) closes EXECUTE →
 * VERIFY with consistent typing end-to-end.
 *
 * @module
 */

import { COMPLETE, DATA, ERROR, type Messages } from "@graphrefly/pure-ts/core";
import { type Node, node } from "@graphrefly/pure-ts/core";
import { fromAny, type NodeInput } from "@graphrefly/pure-ts/extra";
import type { JobEnvelope } from "../job-queue/index.js";

import type { ExecuteOutput, HarnessExecutor, HarnessJobPayload, TriagedItem } from "./types.js";

/**
 * What an actuator's `apply` may return. Mirrors `NodeInput<R>` plus a
 * raw `R` for synchronous side effects.
 */
export type ActuatorResult<R> = NodeInput<R>;

/** Configuration for {@link actuatorExecutor}. */
export interface ActuatorExecutorConfig<R> {
	/**
	 * Apply the side effect for this triaged item. Receives the abort
	 * signal — actuators that own real I/O should thread `signal` into
	 * `fetch`, `fs.writeFile`, child-process kills, etc. so that the
	 * pump's teardown actually cancels in-flight work.
	 *
	 * The first DATA emitted by the bridged result wins; later DATAs are
	 * discarded. ERROR (or a synchronous throw) is mapped via `onError`.
	 */
	apply: (item: TriagedItem, opts: { signal: AbortSignal }) => ActuatorResult<R>;

	/**
	 * Optional gate — when provided and returning `false`, the actuator
	 * is skipped and the executor emits an `ExecuteOutput` with
	 * `outcome: "failure"`. Use to route interventions the actuator can't
	 * handle into the failure path.
	 */
	shouldApply?: (item: TriagedItem) => boolean;

	/** Detail string for the skip path. Default: includes intervention name. */
	skipDetail?: (item: TriagedItem) => string;

	/**
	 * Map a successfully-applied actuation record into an `ExecuteOutput<R>`.
	 */
	toOutput?: (record: R, item: TriagedItem) => ExecuteOutput<R>;

	/**
	 * Map a thrown / ERROR result into an `ExecuteOutput<R>`.
	 */
	onError?: (err: unknown, item: TriagedItem) => ExecuteOutput<R>;

	/** Node name prefix for `describe()` introspection. */
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
 *   verifier: evalVerifier<CatalogPatch>({ ... }),
 * });
 * ```
 */
export function actuatorExecutor<R>(config: ActuatorExecutorConfig<R>): HarnessExecutor<R> {
	const name = config.name ?? "actuator-executor";
	const toOutput = config.toOutput ?? defaultToOutput<R>;
	const onError = config.onError ?? defaultOnError<R>;
	const skipDetail = config.skipDetail ?? defaultSkipDetail;

	return (job: JobEnvelope<HarnessJobPayload<R>>, opts) => {
		const item = job.payload.item;

		if (config.shouldApply && !config.shouldApply(item)) {
			// Synchronous failure payload — return as a plain object;
			// `fromAny` accepts the bare value and emits one DATA.
			return {
				...job.payload,
				execution: { item, outcome: "failure", detail: skipDetail(item) },
			} satisfies HarnessJobPayload<R>;
		}

		return node<HarnessJobPayload<R>>(
			[],
			(_data, actions) => {
				const ac = new AbortController();
				// Link pump-supplied signal (Tier 6.5 2.5b): parent abort
				// (e.g. `harness.destroy()`) cascades into the inner AC and
				// thus into `apply(item, { signal })` + `fromAny({ signal })`.
				const parentSignal = opts?.signal;
				let unlinkParent: () => void = () => undefined;
				if (parentSignal) {
					if (parentSignal.aborted) {
						ac.abort();
					} else {
						const onParentAbort = (): void => ac.abort();
						parentSignal.addEventListener("abort", onParentAbort, { once: true });
						unlinkParent = () => parentSignal.removeEventListener("abort", onParentAbort);
					}
				}
				let captured = false;
				let unsub: (() => void) | null = null;
				const emitOnce = (out: ExecuteOutput<R>): void => {
					if (captured) return;
					captured = true;
					actions.down([
						[DATA, { ...job.payload, execution: { item, ...out } }],
						[COMPLETE],
					] satisfies Messages);
					unsub?.();
					unsub = null;
				};
				let inner: Node<R>;
				try {
					const rawResult = config.apply(item, { signal: ac.signal });
					inner = fromAny<R>(rawResult, { signal: ac.signal });
				} catch (err) {
					emitOnce(onError(err, item));
					return () => {
						unlinkParent();
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
							emitOnce(onError(new Error("actuator inner completed without emitting DATA"), item));
							return;
						}
					}
				});
				// Sync DATA delivery (cached state / `fromAny` over a sync value):
				// the callback ran reentrantly before `unsub` was assigned, so
				// `emitOnce`'s `unsub?.()` was a no-op. Drop the upstream subscription
				// now that we have the handle. Without this, the inner stays
				// subscribed until producer teardown — leaks at high volume.
				if (captured && unsub) {
					unsub();
					unsub = null;
				}
				return () => {
					unlinkParent();
					ac.abort();
					unsub?.();
					unsub = null;
				};
			},
			{ name: `${name}/inner`, describeKind: "producer" },
		);
	};
}

// ---------------------------------------------------------------------------
// dispatchActuator
// ---------------------------------------------------------------------------

/**
 * Apply callback shape consumed by {@link dispatchActuator}. Same shape as
 * {@link ActuatorExecutorConfig.apply}.
 */
export type ActuatorApplyFn<R> = (
	item: TriagedItem,
	opts: { signal: AbortSignal },
) => ActuatorResult<R>;

/** Configuration for {@link dispatchActuator}. */
export interface DispatchActuatorConfig<R> {
	/**
	 * Per-intervention apply callbacks. Keyed by `TriagedItem.intervention`.
	 * Items whose intervention is not in `routes` fall through to `default`
	 * (when set) or emit a skip-failure `ExecuteOutput`.
	 */
	routes: Readonly<Partial<Record<TriagedItem["intervention"], ActuatorApplyFn<R>>>>;
	/** Fallback apply callback for items whose intervention is not in `routes`. */
	default?: ActuatorApplyFn<R>;
	/** Node name prefix for `describe()` introspection. */
	name?: string;
}

/**
 * Multi-intervention actuator — dispatches each `TriagedItem` to one of
 * several `apply` callbacks based on `item.intervention`.
 *
 * Internally builds a single `actuatorExecutor` whose `apply` resolves the
 * intervention → callback at call-time. Items with no matching route and no
 * `default` emit a skip-failure with detail
 * `"no route for intervention 'X'"`.
 */
export function dispatchActuator<R>(config: DispatchActuatorConfig<R>): HarnessExecutor<R> {
	const name = config.name ?? "dispatch-actuator";
	const defaultFn = config.default ?? null;
	const hasDefault = defaultFn != null;
	return actuatorExecutor<R>({
		apply: (item, opts) => {
			const fn = Object.hasOwn(config.routes, item.intervention)
				? config.routes[item.intervention]!
				: defaultFn;
			if (!fn) {
				throw new Error(`dispatchActuator: no route for intervention '${item.intervention}'`);
			}
			return fn(item, opts);
		},
		shouldApply: (item) => Object.hasOwn(config.routes, item.intervention) || hasDefault,
		skipDetail: (item) => `no route for intervention '${item.intervention}'`,
		name,
	});
}
