/**
 * Recipe — **standard forgetting curve** (Hassabis confidence drift).
 *
 * Periodically decays every live fact's `confidence` toward a floor on an
 * exponential half-life schedule, re-ingesting the drifted fragment (MEME L1
 * direct-replace). The periodic trigger is a reactive `fromTimer` source
 * (spec §5.8 no-polling / §5.10 no raw `setTimeout` — `fromTimer` is the
 * sanctioned reactive timer) and the only reactive dep, so there is no
 * within-wave feedback loop (COMPOSITION-GUIDE-GRAPH §7): the store snapshot is
 * read **advisory** off `mem.factStore.cache`, never as a reactive dep; the
 * re-ingest write commits **synchronously this tick** (graphrefly push is
 * synchronous) and the next tick decays from there.
 *
 * > **Why a recipe, not the `decay` face.** `ReactiveFactStoreConfig.decay:
 * > Node<DecayPolicy>` is a *locked design face* (DS-14.7 PART 4.1) but the
 * > shipped `reactiveFactStore()` v1 factory does **not** consume it (tracked
 * > as a factory-gap item in `docs/optimizations.md`). This recipe delivers the
 * > §5.8 "`decay` recipe uses `fromTimer` for periodic confidence drift"
 * > behavior over the **wired** `ingest` face instead — fully spec-compliant
 * > and zero-core-change. It composes regardless of whether the `decay` face is
 * > later wired.
 *
 * **Convergence (conditional — read this).** Per-id decay is computed against
 * the elapsed time since this fact was last decayed (recipe-owned closure
 * clock — `t_ns` provenance is preserved, never overwritten; a re-ingested
 * *new version* — fresher `t_ns` than the last tick — restarts from its own
 * `t_ns`, not the stale prior-version tick). A fragment is skipped (no
 * re-ingest) when it is obsolete (`validTo` set), already at/below `floor`, or
 * the drift is below `epsilon`. Quiescence ("timer keeps ticking, recipe emits
 * `[]`, no churn") therefore holds **only when `epsilon > 0` AND `floor` is
 * reachable** — with `epsilon <= 0` and a finite half-life the geometric
 * drift toward `floor` is always `> 0`, so the loop re-ingests every live fact
 * forever (silent CPU/GC churn, never an error). `epsilon` is clamped to a
 * tiny positive minimum to make accidental non-quiescence impossible.
 * Obsoletion safety: the obsolete guard is re-checked against the **live**
 * store immediately before re-ingest, so a fact obsoleted by an in-flight
 * cascade earlier in the same tick is never resurrected by a stale snapshot
 * read.
 *
 * @module
 */

import { type Node, node, wallClockNs } from "@graphrefly/pure-ts/core";
import { fromTimer, keepalive } from "@graphrefly/pure-ts/extra";
import type { FactId, MemoryFragment, ReactiveFactStoreGraph } from "../fact-store.js";

export interface DecayExponentialOptions {
	/** Half-life in nanoseconds — confidence halves every `halfLifeNs` of fact age. */
	readonly halfLifeNs: bigint;
	/** Timer period in milliseconds (how often the forgetting pass runs). */
	readonly periodMs: number;
	/** Confidence floor; facts at/below it are left untouched. Default `0`. */
	readonly floor?: number;
	/**
	 * Minimum confidence drift to bother re-ingesting. Default `1e-4`. Clamped
	 * to a tiny positive minimum (`<= 0` would prevent quiescence — see the
	 * module "Convergence" note).
	 */
	readonly epsilon?: number;
	/** Node name. Default `decay_exponential`. */
	readonly name?: string;
}

/**
 * Wire an exponential-decay forgetting loop onto a {@link reactiveFactStore}.
 * Self-adds a driver Node to the store's graph (`describe()`-visible) and
 * returns it; each emission is the batch of fragments decayed that tick (also
 * fed back through `ingest`).
 *
 * @category memory
 */
export function decayExponential<T>(
	mem: ReactiveFactStoreGraph<T>,
	ingest: Node<MemoryFragment<T>>,
	opts: DecayExponentialOptions,
): Node<readonly MemoryFragment<T>[]> {
	const floor = opts.floor ?? 0;
	// Clamp to a tiny positive min: epsilon <= 0 would make the geometric
	// drift never fall below it ⇒ the loop never quiesces (module note).
	const epsilon = Math.max(opts.epsilon ?? 1e-4, Number.EPSILON);
	const half = Number(opts.halfLifeNs);
	// Recipe-owned per-id "last decayed at" clock — keeps `t_ns` provenance
	// intact while still giving correct per-interval exponential drift.
	const lastTick = new Map<FactId, bigint>();

	const timer = fromTimer(opts.periodMs, { period: opts.periodMs });

	const driver = node<readonly MemoryFragment<T>[]>(
		[timer],
		(_batchData, actions) => {
			const fs = mem.factStore.cache as
				| { byId: ReadonlyMap<FactId, MemoryFragment<T>> }
				| undefined;
			if (!fs) {
				actions.emit([]);
				return;
			}
			const now = BigInt(wallClockNs());
			const decayed: MemoryFragment<T>[] = [];
			const liveIds = new Set<FactId>();
			for (const f of fs.byId.values()) {
				liveIds.add(f.id);
				if (f.validTo !== undefined) continue; // obsolete — dead, don't drift
				if (f.confidence <= floor) continue; // already forgotten
				// Version-aware "since": if our last tick predates the fact's own
				// t_ns, this is a freshly re-ingested version — restart from its
				// t_ns, not the stale prior-version tick (which would over-decay
				// across time the new version didn't exist).
				const lt = lastTick.get(f.id);
				const since = lt !== undefined && lt >= f.t_ns ? lt : f.t_ns;
				const elapsed = Number(now - since);
				if (elapsed <= 0) continue;
				const factor = 0.5 ** (half > 0 ? elapsed / half : 0);
				if (!Number.isFinite(factor)) continue; // bigint→Number overflow guard
				let next = f.confidence * factor;
				if (next < floor) next = floor;
				if (f.confidence - next < epsilon) continue; // drift too small
				// Resurrection guard: re-read the LIVE store — a fact obsoleted by
				// an in-flight cascade triggered by an earlier re-ingest this same
				// tick must not be re-ingested from this (pre-cascade) snapshot.
				const liveNow = (
					mem.factStore.cache as { byId: ReadonlyMap<FactId, MemoryFragment<T>> } | undefined
				)?.byId.get(f.id);
				if (liveNow && liveNow.validTo !== undefined) continue;
				lastTick.set(f.id, now);
				const drifted: MemoryFragment<T> = { ...f, confidence: next };
				decayed.push(drifted);
				ingest.emit(drifted); // MEME L1 direct-replace (the wired face)
			}
			// Prune the closure clock of ids no longer in the store (bounds the
			// Map to live facts; obsoleted-but-present ids stay until removed).
			if (lastTick.size > liveIds.size) {
				for (const id of lastTick.keys()) if (!liveIds.has(id)) lastTick.delete(id);
			}
			actions.emit(decayed);
		},
		{
			name: opts.name ?? "decay_exponential",
			describeKind: "derived",
			initial: [] as readonly MemoryFragment<T>[],
		},
	);

	mem.add(driver, { name: opts.name ?? "decay_exponential" });
	mem.addDisposer(keepalive(timer));
	mem.addDisposer(keepalive(driver));
	return driver;
}
