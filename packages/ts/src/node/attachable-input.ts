import { request } from "../batch/batch.js";
import { CTX_NODE_BINDING, type Ctx } from "../ctx/types.js";
import type { Node } from "./node.js";
import { CORE } from "./node-keys.js";
import { assertRewireDepOwner } from "./node-rewire-runtime.js";

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
	const rewireNow = (add: readonly Node<unknown>[], remove: readonly Node<unknown>[]): void => {
		kept?.[CTX_NODE_BINDING]?.rewireDiffNow(add, remove);
	};
	const bound = (): Node<unknown> => {
		if (node === undefined) throw new Error("attachableInput: not bound to its node");
		return node;
	};
	return {
		setup(ctx) {
			kept = ctx;
			if (attached.length > 0) ctx[CTX_NODE_BINDING]?.rewireDiff([...attached], []);
			return () => {
				if (kept === ctx) kept = undefined;
			};
		},
		bind(target) {
			node = target;
		},
		attach(source) {
			const target = bound();
			assertRewireDepOwner(target, source);
			const core = target[CORE];
			let owned = false;
			request(core, () => {
				if (attached.includes(source)) return;
				attached.push(source);
				owned = true;
				rewireNow([source], []);
			});
			return () => {
				request(core, () => {
					if (!owned) return;
					owned = false;
					const at = attached.indexOf(source);
					if (at < 0) return;
					attached.splice(at, 1);
					rewireNow([], [source]);
				});
			};
		},
		attached,
	};
}
