/**
 * Helper-first worker compute (D138/D148).
 *
 * `prepare` runs on the graph thread and returns an owned input. The required
 * backend receives only that input plus the static compute closure; Ctx/Node/
 * graph state/live topology never cross the boundary.
 */

import type { Ctx, NodeFn } from "../ctx/types.js";
import type { Graph } from "../graph/graph.js";
import type { Node } from "../node/node.js";
import { errorPayload } from "../protocol/messages.js";

export interface WorkerDerivedJob<TInput, TResult> {
	readonly input: TInput;
	readonly compute: (input: TInput) => TResult;
}

export type WorkerDerivedSettlement<TResult> =
	| { readonly ok: true; readonly value: TResult }
	| { readonly ok: false; readonly error: unknown };

export type WorkerDerivedSettle<TResult> = (settlement: WorkerDerivedSettlement<TResult>) => void;

export type WorkerDerivedCancel = () => void;

export interface WorkerDerivedBackend<TInput, TResult> {
	run(
		job: WorkerDerivedJob<TInput, TResult>,
		settle: WorkerDerivedSettle<TResult>,
	): WorkerDerivedCancel | undefined;
}

export interface WorkerDerivedOptions<TInput, TResult> {
	readonly name?: string;
	prepare(ctx: Ctx): TInput | undefined;
	compute(input: TInput): TResult;
	backend: WorkerDerivedBackend<TInput, TResult>;
}

/**
 * D148 backend-required graph helper. No public submit API is exposed; the
 * backend starts work only after this helper installs the graph-local fence.
 */
export function workerDerived<TInput, TResult>(
	graph: Graph,
	deps: readonly Node<unknown>[],
	opts: WorkerDerivedOptions<TInput, TResult>,
): Node<TResult> {
	if (typeof opts.prepare !== "function") {
		throw new TypeError("workerDerived: prepare must be a function");
	}
	if (typeof opts.compute !== "function") {
		throw new TypeError("workerDerived: compute must be a function");
	}
	if (opts.backend === undefined || typeof opts.backend.run !== "function") {
		throw new TypeError("workerDerived: backend is required");
	}
	let latestInvocation = 0;
	let cancelActive: (() => void) | undefined;
	const fn: NodeFn = (ctx) => {
		cancelActive?.();
		cancelActive = undefined;
		latestInvocation += 1;
		const invocation = latestInvocation;
		let input: TInput | undefined;
		try {
			input = opts.prepare(ctx);
		} catch (error) {
			ctx.down([["ERROR", errorPayload(error, "workerDerived prepare failed")]]);
			return;
		}
		if (input === undefined) {
			ctx.down([["RESOLVED"]]);
			return;
		}
		const ownedInput = cloneWorkerInput(input);
		if (!ownedInput.ok) {
			ctx.down([["ERROR", errorPayload(new Error(ownedInput.message), ownedInput.message)]]);
			return;
		}
		let live = true;
		let cancel: WorkerDerivedCancel | undefined;
		let canceled = false;
		let submitting = true;
		let settled = false;
		let synchronousSettlementError: Error | undefined;
		const cancelThis = (): void => {
			if (canceled) return;
			canceled = true;
			live = false;
			cancel?.();
			cancel = undefined;
		};
		cancelActive = cancelThis;
		ctx.onDeactivation(() => {
			cancelThis();
			if (cancelActive === cancelThis) cancelActive = undefined;
		});
		const assertNotSynchronousCompletion = (): void => {
			if (submitting) {
				synchronousSettlementError = new Error(
					"workerDerived: backend completions must arrive after backend.run returns",
				);
				throw synchronousSettlementError;
			}
		};
		const clearAcceptedSettlement = (): void => {
			cancelActive = undefined;
			cancel = undefined;
			live = false;
		};
		const settle: WorkerDerivedSettle<TResult> = (settlement) => {
			if (settled) return;
			settled = true;
			assertNotSynchronousCompletion();
			if (!live || invocation !== latestInvocation) return;
			clearAcceptedSettlement();
			if (settlement.ok) {
				ctx.down([["DATA", settlement.value]]);
			} else {
				ctx.down([["ERROR", errorPayload(settlement.error, "workerDerived compute failed")]]);
			}
		};
		let thrown = false;
		let thrownError: unknown;
		try {
			cancel =
				opts.backend.run(
					{
						input: ownedInput.value,
						compute: opts.compute,
					},
					settle,
				) ?? undefined;
		} catch (error) {
			thrown = true;
			thrownError = error;
		} finally {
			submitting = false;
		}
		if (synchronousSettlementError !== undefined) {
			if (live && invocation === latestInvocation) {
				ctx.down([
					["ERROR", errorPayload(synchronousSettlementError, "workerDerived compute failed")],
				]);
			}
			cancelThis();
			if (cancelActive === cancelThis) cancelActive = undefined;
			return;
		}
		if (thrown) {
			if (live && invocation === latestInvocation) {
				ctx.down([["ERROR", errorPayload(thrownError, "workerDerived compute failed")]]);
			}
			cancelThis();
			if (cancelActive === cancelThis) cancelActive = undefined;
		}
	};
	return graph.node<TResult>(deps, fn, {
		name: opts.name ?? "workerDerived",
		factory: "workerDerived",
		pool: "async",
		completeWhenDepsComplete: false,
		errorWhenDepsError: false,
	});
}

type CloneWorkerInputResult<TInput> =
	| { readonly ok: true; readonly value: TInput }
	| { readonly ok: false; readonly message: string };

function cloneWorkerInput<TInput>(input: TInput): CloneWorkerInputResult<TInput> {
	if (typeof input === "function" || typeof input === "symbol") {
		return { ok: false, message: "workerDerived: input must be owned and cloneable" };
	}
	if (typeof input !== "object" || input === null) return { ok: true, value: input };
	if (typeof globalThis.structuredClone !== "function") {
		return { ok: false, message: "workerDerived: structuredClone is required for object inputs" };
	}
	try {
		return { ok: true, value: globalThis.structuredClone(input) as TInput };
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		return {
			ok: false,
			message: `workerDerived: input must be owned and cloneable (${message})`,
		};
	}
}
