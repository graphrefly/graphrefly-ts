/**
 * A bundle's durable ledger (the user's Q13, graphrefly-ts:D180): idempotency, cursor and audit
 * state that must outlive a deactivation is held in a state node the bundle owns and the runtime
 * declares as a dependency, so the relation is a drawable edge (R-no-imperative@2) and a
 * checkpoint captures it. Within a lifetime the runtime's private state is the working copy: the
 * setup seeds it from the ledger only when the lifetime has none (a restored working copy is newer
 * than the ledger), and the lifetime's cleanup writes it back, a queued request that lands before
 * any later lifetime starts. A ledger released with its graph has nothing to keep.
 */

import type { Ctx } from "../ctx/types.js";
import { depLatest } from "../ctx/types.js";
import type { Node, StateNode } from "../node/node.js";
import { isNodeRuntimeReleased } from "../node/runtime-accessors.js";
import type { Graph } from "./graph.js";

/**
 * How a runtime whose private state holds more than its ledger (pending payloads, claims, live
 * handles) splits it: only the ledger part is kept in the ledger state, the rest stays in the
 * lifetime (graphrefly-ts:D180; Rust's ledger::write_back with an extract).
 */
export interface LedgerParts<W, S> {
	/** A lifetime's working copy, built from the ledger when the lifetime has none. */
	seed(ledger: S): W;
	/** The ledger part of the working copy, written back when the lifetime closes. */
	extract(working: W): S;
}

export interface DeclaredLedger<S> {
	/** The ledger state; declare it as one of the runtime's dependencies. */
	readonly ledger: StateNode<S>;
	/** The setup of a runtime whose private state is the ledger's working copy itself. */
	setup(ledgerIndex: number): (ctx: Ctx) => () => void;
	/** The setup of a runtime whose private state holds the ledger as one part (LedgerParts). */
	setupWith<W>(ledgerIndex: number, parts: LedgerParts<W, S>): (ctx: Ctx) => () => void;
}

/** @internal A detached copy, so the ledger's value never aliases the working copy. */
function copyOf<S>(value: S): S {
	return structuredClone(value);
}

/** @internal Build a bundle's ledger state and the runtime setup that keeps it. */
export function declaredLedger<S>(
	graph: Graph,
	opts: { readonly name: string; readonly factory: string; readonly initial: () => S },
): DeclaredLedger<S> {
	const ledger = graph.state<S>(opts.initial(), { name: opts.name, factory: opts.factory });
	const setupWith =
		<W>(ledgerIndex: number, parts: LedgerParts<W, S>) =>
		(ctx: Ctx) => {
			if (ctx.state.get<W>() === undefined)
				ctx.state.set(
					parts.seed(copyOf((depLatest(ctx, ledgerIndex) as S | undefined) ?? opts.initial())),
				);
			return () => {
				const working = ctx.state.get<W>();
				if (working !== undefined && !isNodeRuntimeReleased(ledger as Node<unknown>))
					ledger.set(copyOf(parts.extract(working)));
			};
		};
	return {
		ledger,
		setup: (ledgerIndex) => setupWith<S>(ledgerIndex, { seed: (s) => s, extract: (s) => s }),
		setupWith,
	};
}
