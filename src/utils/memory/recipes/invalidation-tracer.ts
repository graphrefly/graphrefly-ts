/**
 * Recipe — **cascade-event tracer** (debugging the invisible edge).
 *
 * The `dependents_index` lookup that drives cascade invalidation is a fn-body
 * map read, not a topology edge — `describe()` / `explain()` can't see *why*
 * fact C got invalidated. This recipe is the pure-observer (face ④) companion
 * that subscribes `mem.cascade` + `mem.cascadeOverflow` and keeps a bounded
 * ring of human-readable trace entries (each carries the `causalReason` string
 * the store stamps for exactly this purpose), so a developer can answer
 * "what obsoleted this?" without instrumenting the store.
 *
 * ```ts
 * const trace = invalidationTracer(mem, { limit: 256 });
 * trace.subscribe((entries) => entries.forEach(e => log(e.causalReason)));
 * ```
 *
 * Read-only: it never writes back into the store, so it cannot perturb cascade
 * convergence.
 *
 * @module
 */

import { type Node, node } from "@graphrefly/pure-ts/core";
import { keepalive } from "@graphrefly/pure-ts/extra";
import type {
	CascadeEvent,
	CascadeOverflow,
	CascadeReason,
	FactId,
	ReactiveFactStoreGraph,
} from "../fact-store.js";

export interface InvalidationTraceEntry {
	readonly kind: "cascade" | "overflow";
	readonly factId: FactId;
	readonly rootFactId: FactId;
	readonly reason: CascadeReason | "overflow";
	readonly iteration?: number;
	readonly causalReason: string;
}

export interface InvalidationTracerOptions {
	/** Ring-buffer size (most-recent N trace entries retained). Default `256`. */
	readonly limit?: number;
	/** Node name. Default `invalidation_tracer`. */
	readonly name?: string;
}

/**
 * Attach a bounded cascade-event tracer to a {@link reactiveFactStore}.
 * Self-adds a `describe()`-visible observer Node and returns it; each emission
 * is the current trace ring (oldest → newest).
 *
 * @category memory
 */
export function invalidationTracer<T>(
	mem: ReactiveFactStoreGraph<T>,
	opts: InvalidationTracerOptions = {},
): Node<readonly InvalidationTraceEntry[]> {
	const limit = Math.max(1, opts.limit ?? 256);
	const ring: InvalidationTraceEntry[] = []; // sole-owner bounded fold

	const push = (e: InvalidationTraceEntry): void => {
		ring.push(e);
		if (ring.length > limit) ring.splice(0, ring.length - limit);
	};

	const tracer = node<readonly InvalidationTraceEntry[]>(
		[mem.cascade, mem.cascadeOverflow],
		(batchData, actions) => {
			const cascadeWaves = (batchData[0] as readonly (readonly CascadeEvent[])[] | undefined) ?? [];
			for (const wave of cascadeWaves) {
				for (const ev of wave) {
					push({
						kind: "cascade",
						factId: ev.factId,
						rootFactId: ev.rootFactId,
						reason: ev.reason,
						iteration: ev.iteration,
						causalReason: ev.causalReason,
					});
				}
			}
			const overflows = (batchData[1] as readonly (CascadeOverflow | null)[] | undefined) ?? [];
			for (const ov of overflows) {
				if (ov == null) continue;
				push({
					kind: "overflow",
					factId: ov.sample[0] ?? "",
					rootFactId: ov.rootFactId,
					reason: "overflow",
					causalReason: `cascade overflow: ${ov.droppedCount} dropped (root ${ov.rootFactId})`,
				});
			}
			actions.emit([...ring]);
		},
		{
			name: opts.name ?? "invalidation_tracer",
			describeKind: "derived",
			initial: [] as readonly InvalidationTraceEntry[],
		},
	);

	mem.add(tracer, { name: opts.name ?? "invalidation_tracer" });
	mem.addDisposer(keepalive(tracer));
	return tracer;
}
