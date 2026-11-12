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

export interface DeclaredLedger<S> {
	/** The ledger state; declare it as one of the runtime's dependencies. */
	readonly ledger: StateNode<S>;
	/** The runtime's setup, given the ledger's index among the runtime's dependencies. */
	setup(ledgerIndex: number): (ctx: Ctx) => () => void;
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
	return {
		ledger,
		setup: (ledgerIndex) => (ctx) => {
			if (ctx.state.get<S>() === undefined)
				ctx.state.set(copyOf((depLatest(ctx, ledgerIndex) as S | undefined) ?? opts.initial()));
			return () => {
				const state = ctx.state.get<S>();
				if (state !== undefined && !isNodeRuntimeReleased(ledger as Node<unknown>))
					ledger.set(copyOf(state));
			};
		},
	};
}
