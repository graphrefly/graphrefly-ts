/**
 * Surface: one-shot `input → pipeline → output` (§9.3-core).
 *
 * `runReduction` compiles a {@link GraphSpec}, pushes an input value to a
 * named state node, awaits the first post-push DATA emission on a named
 * output, then disposes the graph. Stateless per call — no graphId, no
 * registry.
 *
 * Named `runReduction` (not `reduce`) to avoid collision with the
 * reactive {@link reduce} operator in `extra/operators.ts`. The MCP tool
 * name (`graphrefly_reduce`) and CLI subcommand (`graphrefly reduce`) use
 * the short form; the library export carries the verb.
 *
 * The subscribe-before-push ordering is deliberate. `graph.set` propagates
 * synchronously for sync derived/operator chains; for async sources
 * (`fromPromise`, `fromAsyncIter`, LLM adapters) the first post-push DATA
 * arrives on a later tick. Subscribing before the push catches both, and
 * skipping the priming push-on-subscribe emission avoids resolving with the
 * stale pre-push cache (spec §2.2).
 *
 * @module
 */

import { COMPLETE, DATA, ERROR, RESOLVED } from "../../core/messages.js";
import type { Node } from "../../core/node.js";
import type { GraphSpec, GraphSpecCatalog } from "../graphspec/index.js";
import { createGraph } from "./create.js";
import { SurfaceError } from "./errors.js";

/** Options for {@link reduce}. */
export interface ReduceOptions {
	/** Fn/source catalog for {@link createGraph}. */
	catalog?: GraphSpecCatalog;
	/** Path of the state node that receives the input. Default `"input"`. */
	inputPath?: string;
	/** Path of the node whose first post-push DATA is the result. Default `"output"`. */
	outputPath?: string;
	/** Hard deadline in milliseconds. Default `30_000`. */
	timeoutMs?: number;
}

const DEFAULT_TIMEOUT_MS = 30_000;

/**
 * Run a spec as a one-shot reduction: `input → graph → output`.
 *
 * Resolves on the first `[DATA, v]` **or** `[RESOLVED]` emitted by
 * `outputPath` after the input push. The RESOLVED path handles spec
 * §1.3.3 equals-substitution (output recomputed to a value equal to its
 * cache, so the graph skips the DATA push) by returning `outputNode.cache`
 * — the caller always gets the settled value, never hangs on idempotent
 * inputs.
 *
 * @throws {SurfaceError} `invalid-spec` / `catalog-error` (propagated from
 *   {@link createGraph}), `node-not-found` when `inputPath`/`outputPath`
 *   can't be resolved, `reduce-timeout` when `timeoutMs` elapses without
 *   a post-push emission, or the ERROR payload from the graph re-thrown
 *   as `internal-error`.
 */
export async function runReduction(
	spec: GraphSpec,
	input: unknown,
	opts?: ReduceOptions,
): Promise<unknown> {
	const inputPath = opts?.inputPath ?? "input";
	const outputPath = opts?.outputPath ?? "output";
	const timeoutMs = opts?.timeoutMs ?? DEFAULT_TIMEOUT_MS;

	const graph = createGraph(spec, { catalog: opts?.catalog });
	let outputNode: Node<unknown>;
	try {
		outputNode = graph.resolve(outputPath);
	} catch {
		graph.destroy();
		throw new SurfaceError(
			"node-not-found",
			`reduce: output path "${outputPath}" is not registered`,
			{ path: outputPath },
		);
	}
	// Verify input path exists before we subscribe and push.
	try {
		graph.resolve(inputPath);
	} catch {
		graph.destroy();
		throw new SurfaceError(
			"node-not-found",
			`reduce: input path "${inputPath}" is not registered`,
			{ path: inputPath },
		);
	}

	try {
		return await new Promise<unknown>((resolve, reject) => {
			let primed = false;
			let settled = false;
			let timer: ReturnType<typeof setTimeout> | undefined;
			let unsub: (() => void) | undefined;
			// Sync-settle deferred-unsubscribe invariant (C24-4):
			// `outputNode.subscribe(cb)` may invoke `cb` synchronously during
			// the call (push-on-subscribe per spec §2.2). If `cb` reaches
			// `finish()` BEFORE `subscribe()` returns, `unsub` is still
			// `undefined` and we'd leak the subscription if we tried `unsub?.()`
			// immediately. The contract: `finish()` toggles `shouldUnsub = true`;
			// the post-subscribe block (after `unsub` is assigned) checks that
			// flag and tears down. Two-phase ensures exactly one unsubscribe
			// regardless of whether settlement happened during or after the
			// subscribe call.
			let shouldUnsub = false;

			const finish = (action: () => void): void => {
				if (settled) return;
				settled = true;
				if (timer !== undefined) clearTimeout(timer);
				if (unsub !== undefined) {
					unsub();
					unsub = undefined;
				} else {
					shouldUnsub = true;
				}
				action();
			};

			unsub = outputNode.subscribe((msgs) => {
				for (const m of msgs) {
					if (settled) return;
					// Skip push-on-subscribe emissions that land before we
					// trigger the input push — those carry pre-push state.
					if (!primed) continue;
					if (m[0] === DATA) {
						finish(() => resolve(m[1]));
						return;
					}
					if (m[0] === RESOLVED) {
						// Spec §1.3.3 equals-substitution: the output recomputed to
						// a value equal to its cached value, so the graph emits
						// RESOLVED instead of DATA. For a one-shot reduce the
						// caller wants the output value — read the cache **before**
						// finish() runs unsub (which can trigger lazy deactivation
						// and clear the cache per the RAM-cache rule).
						const cached = outputNode.cache;
						finish(() => resolve(cached));
						return;
					}
					if (m[0] === ERROR) {
						const payload = m[1];
						const message = payload instanceof Error ? payload.message : String(payload);
						const cause = payload instanceof Error ? payload : undefined;
						finish(() =>
							reject(
								new SurfaceError(
									"internal-error",
									`reduce: output emitted ERROR: ${message}`,
									cause != null ? { cause } : undefined,
								),
							),
						);
						return;
					}
					if (m[0] === COMPLETE) {
						finish(() =>
							reject(
								new SurfaceError(
									"internal-error",
									`reduce: output COMPLETEd without a post-push DATA`,
								),
							),
						);
						return;
					}
				}
			});
			if (shouldUnsub) {
				unsub?.();
				unsub = undefined;
			}

			primed = true;
			try {
				graph.set(inputPath, input);
			} catch (err) {
				const message = err instanceof Error ? err.message : String(err);
				const cause = err instanceof Error ? err : undefined;
				finish(() =>
					reject(
						new SurfaceError(
							"internal-error",
							`reduce: failed to set input on "${inputPath}": ${message}`,
							cause != null ? { path: inputPath, cause } : { path: inputPath },
						),
					),
				);
				return;
			}

			// Synchronous wave may have already settled the promise via the
			// subscribe callback above; skip the timer in that case so we
			// don't leak an orphan setTimeout into the event loop (A1, E4).
			if (!settled && Number.isFinite(timeoutMs) && timeoutMs > 0) {
				timer = setTimeout(() => {
					finish(() =>
						reject(
							new SurfaceError(
								"reduce-timeout",
								`reduce: no output emitted within ${timeoutMs}ms`,
								{ timeoutMs, outputPath },
							),
						),
					);
				}, timeoutMs);
				// Belt-and-suspenders: if the caller drops the returned promise
				// we shouldn't keep the process alive.
				timer.unref?.();
			}
		});
	} finally {
		graph.destroy();
	}
}
