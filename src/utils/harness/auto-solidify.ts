/**
 * autoSolidify — promote successful VERIFY runs into a durable artifact
 * (catalog entry, skill, template, doc edit, …).
 *
 * Closes the dogfood retrospective loop: when the harness's VERIFY
 * stage reports `verified: true`, the validated intervention should
 * become an authoring artifact the next loop run can rely on. This
 * primitive is the generic substrate — pass a `write` callback that
 * does the actual promotion (e.g. `overlay.upsertTemplate` for the
 * dogfood catalog overlay; `fs.writeFile` for a doc edit; `ctx.skill`
 * for a Hermes-style skill registry).
 *
 * @example Wire the catalog overlay as the solidify target.
 * ```ts
 * const solidified = autoSolidify({
 *   verifyResults: harness.verifyResults.latest,
 *   extract: (vr) => vr.execution.artifact ?? null,
 *   write: (entry, vr) => overlay.upsertFn(`learned-${vr.item.summary}`, entry),
 * });
 * solidified.subscribe(() => {}); // keep alive for log
 * ```
 *
 * **Why a node and not just an effect.** The returned `Node<R>` emits
 * each promoted artifact, so callers can pipe solidifications through
 * the standard reactive surface (`describe()`, `observe()`, replay
 * buffers) instead of side-channel logging. An audit / dashboard that
 * wants "what was learned this run?" subscribes to the returned node;
 * the `write` callback owns the durable side effect.
 *
 * **Idempotency is the caller's responsibility.** The primitive
 * promotes every `verified: true` wave that passes the predicate. If
 * the harness re-verifies the same item (e.g. via reingestion), the
 * `write` callback is invoked again. Wrap your write fn with a
 * dedup-by-key guard if your target store would otherwise bloat. The
 * inner `seen` set inside this factory is intentionally absent — the
 * harness already retains via topic logs and the user may want
 * re-promotion semantics that are domain-specific.
 *
 * @module
 */

import { COMPLETE, DATA, ERROR, type Messages, type Node, node } from "@graphrefly/pure-ts/core";

import type { VerifyResult } from "./types.js";

/**
 * Configuration for {@link autoSolidify}.
 *
 * `R` is the artifact type the upstream EXECUTE stage produced (and
 * `evalVerifier` carries through `execution.artifact`). `T` is the
 * promotion shape — what `write` consumes and what the returned node
 * emits. Often `T = R`, but they diverge when the actuator's raw
 * artifact needs a transform before storing (e.g. wrap a `CatalogPatch`
 * into a `CatalogEntry` with effectiveness metadata).
 */
export interface AutoSolidifyConfig<R, T = R> {
	/** Reactive verify-result stream. Typically `harness.verifyResults.latest`. */
	verifyResults: Node<VerifyResult<R> | null>;
	/**
	 * Pull the value-to-promote out of a verified VerifyResult.
	 * Default: `(vr) => vr.execution.artifact as T | null`. Return `null`
	 * to skip a particular VerifyResult even when `verified: true` (e.g.
	 * an LLM-default executor produces no artifact and there's nothing to
	 * solidify).
	 */
	extract?: (vr: VerifyResult<R>) => T | null;
	/**
	 * Optional gate beyond `verified === true`. When provided, the
	 * primitive only promotes when this returns `true`. Default: pass
	 * everything verified.
	 *
	 * Useful predicates:
	 *  - `(vr) => vr.item.intervention === "catalog-fn"` — only catalog work.
	 *  - `(vr) => (vr.findings ?? []).every(f => !/regression/i.test(f))` —
	 *    skip even-passes that mention regressions.
	 */
	predicate?: (vr: VerifyResult<R>) => boolean;
	/**
	 * Promote — usually a side effect (write to overlay, fs, KG, etc.).
	 * Receives the extracted artifact AND the originating VerifyResult so
	 * the writer can use any context it needs (item summary, eval task
	 * IDs, finding text, …) when shaping the durable record.
	 */
	write: (artifact: T, vr: VerifyResult<R>) => void;
	/** Node name for `describe()` introspection. Default `"auto-solidify"`. */
	name?: string;
}

/**
 * Build a `Node<T>` that subscribes to `verifyResults`, filters to
 * verified passes that produced an extractable artifact, runs `write`,
 * and emits the artifact. Use the returned node as a subscription
 * point for audit / dashboard / log pipelines.
 *
 * **Terminal-on-error semantics.** A throw from `predicate`, `extract`,
 * or `write` surfaces as `[[ERROR]]` on the returned node and
 * **terminates** it — the upstream subscription tears down and no
 * further DATA is emitted. This matches the spec's terminal-frame
 * contract for ERROR. If you want the solidify node to stay live
 * across user-callback throws, wrap your callbacks with try/catch
 * internally and emit a sentinel value or no-op on failure. A future
 * non-terminal `errors: Node<unknown>` companion may surface failures
 * without terminating the success stream — flagged as a follow-up.
 *
 * @returns A `Node<T>` that emits one DATA per promoted artifact.
 *   Stays live as long as `verifyResults` is live AND no user callback
 *   has thrown.
 */
export function autoSolidify<R, T = R>(config: AutoSolidifyConfig<R, T>): Node<T> {
	const name = config.name ?? "auto-solidify";
	const extract =
		config.extract ?? ((vr: VerifyResult<R>) => (vr.execution.artifact ?? null) as T | null);
	const predicate = config.predicate ?? (() => true);

	return node<T>(
		[],
		(_data, actions) => {
			let unsub: (() => void) | null = null;
			let terminated = false;
			const tearDown = (): void => {
				if (terminated) return;
				terminated = true;
				unsub?.();
				unsub = null;
			};
			const emitTerminalError = (err: unknown): void => {
				if (terminated) return;
				actions.down([[ERROR, err]] satisfies Messages);
				tearDown();
			};
			unsub = config.verifyResults.subscribe((batch) => {
				if (terminated) return;
				for (const m of batch) {
					if (terminated) return;
					if (m[0] !== DATA) {
						if (m[0] === COMPLETE) {
							// Upstream verifyResults completed (rare; harness destroy).
							// Forward COMPLETE and tear down — solidify is terminal too.
							actions.down([[COMPLETE]] satisfies Messages);
							tearDown();
							return;
						}
						continue;
					}
					const vr = m[1] as VerifyResult<R> | null;
					if (vr == null) continue;
					if (!vr.verified) continue;
					// User callbacks (predicate / extract / write) are isolated
					// in try/catch so a throw lands as a single terminal ERROR
					// rather than propagating into the upstream emitter where
					// it would skip later messages in the same batch and leave
					// the solidify node un-terminated.
					let pass: boolean;
					try {
						pass = predicate(vr);
					} catch (err) {
						emitTerminalError(err);
						return;
					}
					if (!pass) continue;
					let artifact: T | null;
					try {
						artifact = extract(vr);
					} catch (err) {
						emitTerminalError(err);
						return;
					}
					if (artifact == null) continue;
					try {
						config.write(artifact, vr);
					} catch (err) {
						emitTerminalError(err);
						return;
					}
					actions.down([[DATA, artifact]] satisfies Messages);
				}
			});
			// If `subscribe` fired terminally during the call (push-on-subscribe
			// of an already-COMPLETE upstream), `tearDown()` ran inside the
			// callback before `unsub` was assigned, so the unsub is still
			// dangling. Drop it now if we're already terminated.
			if (terminated && unsub) {
				unsub();
				unsub = null;
			}
			return () => {
				tearDown();
			};
		},
		{ name, describeKind: "producer" },
	);
}
