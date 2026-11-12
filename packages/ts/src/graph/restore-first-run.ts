/**
 * A restored node's first run (R-checkpoint@1, R-subscription@3).
 *
 * Restore gives an open restored computed node a seed whose note records what it had received
 * from each dependency, and wraps its function. On the seeded instance's first run the wrapper
 * compares each dependency with that record and runs the real function only on a change, showing
 * it only the changed dependencies (one that only ended shows only its end); a first run with no
 * change runs nothing, so the node keeps its seeded values and private state. Every other run is
 * the real function. The kernel holds the note and never reads it.
 */

import { type Ctx, type CtxDep, ctxWithDeps, type DepTerminal, type NodeFn } from "../ctx/types.js";
import { strictCanonicalJsonBytes } from "../json/codec.js";

/** What a restored node had received from one dependency: its last array's values and its terminal. */
export interface RestoredReceived {
	readonly values: readonly unknown[];
	/** `true` for COMPLETE, an ERROR payload, or `undefined` while it was open. */
	readonly terminal: true | unknown | undefined;
}

/** The note restore gives a restored node's seed. */
class RestoredNote {
	constructor(readonly received: readonly RestoredReceived[]) {}
}

/** @internal The seed note recording what a restored node had received from each dependency. */
export function restoredNote(received: readonly RestoredReceived[]): unknown {
	return new RestoredNote(received);
}

/** @internal What a restored node had received, read from its seed's note; else `undefined`. */
export function receivedInNote(note: unknown): readonly RestoredReceived[] | undefined {
	return note instanceof RestoredNote ? note.received : undefined;
}

const realFns = new WeakMap<NodeFn, NodeFn>();

/** @internal The function a node was built with, behind a restored node's wrapper. */
export function realNodeFn(fn: NodeFn | null): NodeFn | null {
	return fn === null ? null : (realFns.get(fn) ?? fn);
}

/** @internal A restored node's function around `real` (see the module doc). */
export function restoredFirstRun(real: NodeFn): NodeFn {
	const run: NodeFn = (ctx: Ctx) => {
		const received = receivedInNote(ctx.seed);
		if (received === undefined) {
			real(ctx);
			return;
		}
		let changed = false;
		const shown = ctx.deps.map((dep, i): CtxDep => {
			const was = received[i];
			const waves = dep.waves;
			const values = waves.length === 0 ? [] : waves[waves.length - 1];
			const terminal = terminalValue(dep.terminal);
			const valuesSame = same([...(was?.values ?? [])], [...values]);
			const endSame = same(was?.terminal ?? null, terminal ?? null);
			if (valuesSame && endSame) return unchanged(dep, undefined);
			changed = true;
			// A dependency that only ended gives only its end.
			return valuesSame ? unchanged(dep, dep.terminal) : dep;
		});
		if (changed) real(ctxWithDeps(ctx, shown));
	};
	realFns.set(run, realFns.get(real) ?? real);
	return run;
}

const NO_WAVES: readonly (readonly unknown[])[] = Object.freeze([]);

/** A dependency that brings nothing to this run but `terminal`; it still holds its value. */
function unchanged(dep: CtxDep, terminal: DepTerminal | undefined): CtxDep {
	return {
		get id() {
			return dep.id;
		},
		waves: NO_WAVES,
		terminal,
		get value() {
			return dep.value;
		},
		get has() {
			return dep.has;
		},
		get invalidated() {
			return dep.invalidated;
		},
	};
}

function terminalValue(t: DepTerminal | undefined): true | unknown | undefined {
	if (t === undefined) return undefined;
	return t.kind === "complete" ? true : t.error;
}

/** Whether two values encode the same canonical JSON (the same one is always the same). */
function same(a: unknown, b: unknown): boolean {
	if (a === b) return true;
	try {
		return (
			new TextDecoder().decode(strictCanonicalJsonBytes(a)) ===
			new TextDecoder().decode(strictCanonicalJsonBytes(b))
		);
	} catch {
		return false;
	}
}
