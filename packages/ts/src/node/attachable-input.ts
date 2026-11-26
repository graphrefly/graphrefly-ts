import type { Ctx } from "../ctx/types.js";
import { kOf, request } from "./kernel.js";
import type { Node } from "./node.js";
import { nodeOwnerForGraphUse } from "./runtime-accessors.js";

/** What each lifetime has asked its node's dependencies to become, by `rewireBy`. */
const plannedDeps = new WeakMap<AbortSignal, Node<unknown>[]>();

/**
 * @internal Change `node`'s own dependencies through a ctx of its current lifetime (R-request-order:
 * a rewire is a request scoped to its lifetime), by difference: from what this lifetime already
 * asked for, else from the current list, so several asks before the first one runs build on each
 * other. Every helper that rewires a node by difference goes through this.
 */
export function rewireBy(
	ctx: Ctx,
	node: Node<unknown>,
	add: readonly Node<unknown>[],
	remove: readonly (Node<unknown> | null)[],
): void {
	const base = plannedDeps.get(ctx.signal) ?? [...node.deps];
	const next = base.filter((d) => !remove.includes(d));
	for (const a of add) if (!next.includes(a)) next.push(a);
	plannedDeps.set(ctx.signal, next);
	ctx.rewire(next);
}

/**
 * Internal: an input whose sources attach and detach over time (a collection's folders, a process
 * or bus command input). The kernel has no graph-level rewire, so the node changes its own
 * dependencies: its setup keeps its lifetime's ctx, and an attach or detach rewires through it by
 * difference, so the node's own rewires (a timer it adds) are kept. Attach and detach are requests
 * (R-request-order): during a wave or a batch body they run later, and a rolled-back batch drops
 * them. When a lifetime closes the dependencies go back to the declared ones (R-lifetime), and the
 * next lifetime's setup rewires to the attached sources again.
 */
export interface AttachableInput {
	/** The node's setup option. */
	readonly setup: (ctx: Ctx) => () => void;
	/** Give the input its node, once it exists. */
	bind(node: Node<unknown>): void;
	/**
	 * Attach a source. The returned detach removes it only if this attach added it, so a duplicate
	 * attach holds no binding of its own. A source of another graph is refused at once.
	 */
	attach(source: Node<unknown>): () => void;
	readonly attached: readonly Node<unknown>[];
}

export function attachableInput(): AttachableInput {
	const attached: Node<unknown>[] = [];
	let node: Node<unknown> | undefined;
	let kept: Ctx | undefined;
	const rewireTo = (add: readonly Node<unknown>[], remove: readonly Node<unknown>[]): void => {
		if (kept !== undefined && node !== undefined) rewireBy(kept, node, add, remove);
	};
	const bound = (): Node<unknown> => {
		if (node === undefined) throw new Error("attachableInput: not bound to its node");
		return node;
	};
	return {
		setup(ctx) {
			kept = ctx;
			if (attached.length > 0) rewireTo([...attached], []);
			return () => {
				if (kept === ctx) kept = undefined;
			};
		},
		bind(target) {
			node = target;
		},
		attach(source) {
			const target = bound();
			nodeOwnerForGraphUse(source, "rewire"); // a released source is refused (D122)
			const core = kOf(target).kernel;
			if (kOf(source).kernel !== core)
				throw new Error(
					"rewire: dep belongs to a different graph; cross-graph deps require a wire bridge (D22 / R-graph-domain)",
				);
			let owned = false;
			request(core, () => {
				if (attached.includes(source)) return;
				attached.push(source);
				owned = true;
				rewireTo([source], []);
			});
			return () => {
				request(core, () => {
					if (!owned) return;
					owned = false;
					const at = attached.indexOf(source);
					if (at < 0) return;
					attached.splice(at, 1);
					rewireTo([], [source]);
				});
			};
		},
		attached,
	};
}
