/**
 * Pause as a module (R-pause@2), re-ported from graphrefly reference/modules/pause.mjs and the
 * pause function of reference/operators/gate.mjs (graphrefly:D817, graphrefly-ts:D194 (3)).
 *
 * A pausable is one node placed after its input, depending on [input, lock state]. The lock state
 * is a plain state node holding the set of held locks, and the only copy of them: pause and resume
 * write it with a function (R-request-order), so two controllers in one wave keep each other's
 * locks, and the locks outlive the pausable's deactivation and terminal. While a lock is held the
 * pausable holds every array that arrives, in order and keeping its boundaries; when the last lock
 * is released it sends them in one wave. An INVALIDATE passes at once and drops what was held; a
 * terminal passes at once, and in a wave that also changes the locks the locks after the wave
 * decide (D830 (4)).
 */
import type { Ctx, CtxDep, NodeFn } from "../ctx/types.js";
import type { Node, StateNode } from "../node/node.js";
import type { Message } from "../protocol/messages.js";
import type { Graph } from "./graph.js";
import { moduleName } from "./module-naming.js";
import type { GraphRecipeFactory } from "./restore.js";

/** A lock state and the writes to it (R-pause@2): the state node is the only copy of the locks. */
export interface PauseLocks {
	readonly locks: StateNode<readonly string[]>;
	/** Take a lock (a fresh one by default) by writing the lock state; returns the lock. */
	pause(lock?: string): string;
	/** Release a lock by writing the lock state. */
	resume(lock: string): void;
}

/** A pausable and its lock state. */
export interface Pausable<T> extends PauseLocks {
	readonly node: Node<T>;
}

/** The recipe the pausable node carries; the default restore registry builds it. */
export const PAUSABLE_RECIPE = Object.freeze({ ref: "pause.pausable" });

const terminalMessage = (dep: CtxDep): Message | undefined =>
	dep.terminal === undefined
		? undefined
		: dep.terminal.kind === "complete"
			? ["COMPLETE"]
			: ["ERROR", dep.terminal.error];

const isPaused = (control: CtxDep) =>
	control.has && Array.isArray(control.value) && (control.value as readonly string[]).length > 0;

/**
 * The pausable's function. Private state: the arrays held since the input's last INVALIDATE, each
 * as it arrived, which a checkpoint saves. While paused nothing but the input's terminal goes
 * out; unpaused, or on the release, the held arrays and the new ones go out one per array, the
 * input's terminal in the last of them.
 */
export const pausableFn: NodeFn = (ctx: Ctx) => {
	const [input, control] = ctx.deps as [CtxDep, CtxDep];
	let held = ctx.state.get<unknown[][]>() ?? [];
	if (input.invalidated) {
		held = [];
		ctx.down([["INVALIDATE"]]);
	}
	// A restored pausable's first run: an input that holds no value now was invalidated while the
	// graph was saved, and what was held is gone (R-checkpoint).
	if (ctx.seed !== undefined && !input.has) held = [];
	// The lock state's ERROR ends the pausable without that run's DATA and what was held, unless
	// the input ended with an ERROR of its own, which comes first in declared order.
	if (control.terminal?.kind === "error" && input.terminal?.kind !== "error") {
		ctx.state.set([]);
		ctx.down([["ERROR", control.terminal.error]]);
		return;
	}
	held = [...held, ...input.waves.filter((w) => w.length > 0).map((w) => [...w])];
	const end = terminalMessage(input);
	if (isPaused(control)) {
		ctx.state.set(end ? [] : held);
		if (end) ctx.down([end]);
		return;
	}
	ctx.state.set([]);
	held.forEach((w, i) => {
		ctx.down([
			...w.map((v) => ["DATA", v] as Message),
			...(end && i === held.length - 1 ? [end] : []),
		]);
	});
	if (end && held.length === 0) ctx.down([end]);
};

/** The writes to a lock state; they keep nothing of their own (graphrefly-ts:D194 (3)). */
export function pauseControl(locks: StateNode<readonly string[]>, name: string): PauseLocks {
	return {
		locks,
		pause(lock = `${name}#${crypto.randomUUID()}`) {
			locks.set((held = Object.freeze([])) =>
				held.includes(lock) ? held : Object.freeze([...held, lock]),
			);
			return lock;
		},
		resume(lock) {
			locks.set((held = Object.freeze([])) =>
				held.includes(lock) ? Object.freeze(held.filter((l) => l !== lock)) : held,
			);
		},
	};
}

/** A lock state, `${name}/locks`, that several pausables may share. */
export function pauseLocks(graph: Graph, opts: { readonly name?: string } = {}): PauseLocks {
	const name = moduleName(graph, opts.name, "pause");
	const locks = graph.state<readonly string[]>(Object.freeze([]), { name: `${name}/locks` });
	return pauseControl(locks, name);
}

/**
 * A pausable after `input` (R-pause@2), with its own lock state `${name}/locks` or the shared
 * `locks` given.
 */
export function pausable<T>(
	graph: Graph,
	input: Node<T>,
	opts: { readonly name?: string; readonly locks?: PauseLocks } = {},
): Pausable<T> {
	const name = moduleName(graph, opts.name, "pausable");
	const control = opts.locks ?? pauseLocks(graph, { name });
	if ((input as unknown) === control.locks)
		throw new RangeError(`pausable ${name}: its inputs are distinct nodes`);
	const node = graph.node<T>([input as Node<unknown>, control.locks as Node<unknown>], pausableFn, {
		name,
		complete: "manual",
		error: "manual",
		invalidate: "manual",
		recipe: PAUSABLE_RECIPE,
	});
	return { node, ...control };
}

/** The handle of a pausable a restore built: its lock state is its second declared dependency. */
export function pausableOf<T>(graph: Graph, node: Node<T>): Pausable<T> {
	const locks = graph.definition(node).deps[1] as unknown as StateNode<readonly string[]>;
	return { node, ...pauseControl(locks, node.name ?? "pausable") };
}

/** The restore registry entry of the pausable. */
export const pausableRestoreDescriptor: GraphRecipeFactory<undefined> = {
	ref: PAUSABLE_RECIPE.ref,
	build: () => ({ fn: pausableFn }),
};
