import type {
	EvalAdmittedEffect,
	EvalAdmittedToolEffect,
	EvalBillingObservationEffect,
	EvalBillingObservationOutcome,
	EvalEffectOutcome,
	EvalProviderOutcome,
	EvalRetryDelayEffect,
	EvalRetryDelayOutcome,
} from "./eval-topology.js";

// Mechanical execution ownership only. Admission, retry, budget and lifecycle
// completion remain in the Graph. Completed identities are never evicted to
// make room for redispatch; a finite campaign has an explicit receipt bound.
function focusedAdapter<
	E extends { readonly kind: string; readonly executionId: string },
	O extends { readonly kind: string; readonly executionId: string; readonly admission: unknown },
>(
	kind: E["kind"],
	outcomeKind: O["kind"],
	maxExecutions: number,
	execute: (effect: E) => Promise<O>,
) {
	if (!Number.isSafeInteger(maxExecutions) || maxExecutions < 1)
		throw new TypeError("focused async adapter receipt bound invalid");
	const receipts = new Set<string>();
	const active = new Set<Promise<O>>();
	let closed = false;
	return Object.freeze({
		run(effect: E): Promise<O> {
			if (
				closed ||
				effect.kind !== kind ||
				!effect.executionId ||
				receipts.has(effect.executionId) ||
				receipts.size >= maxExecutions
			)
				return Promise.reject(
					new TypeError("focused async adapter rejected replay, kind, capacity or disposal"),
				);
			receipts.add(effect.executionId);
			let resolve!: (result: O) => void;
			let reject!: (error: unknown) => void;
			const operation = new Promise<O>((yes, no) => {
				resolve = yes;
				reject = no;
			});
			// Register before invoking any user/transport code, including synchronous
			// prefixes of async functions. Reentrant dispose must see this operation.
			active.add(operation);
			const settle = (result: O) => {
				if (
					result.kind !== outcomeKind ||
					result.admission !== effect ||
					result.executionId !== effect.executionId
				)
					throw new TypeError("focused async adapter outcome lost its exact admission");
				return result;
			};
			try {
				Promise.resolve(execute(effect)).then(settle).then(resolve, reject);
			} catch (error) {
				reject(error);
			}
			void operation.then(
				() => active.delete(operation),
				() => active.delete(operation),
			);
			return operation;
		},
		close(): void {
			closed = true;
		},
		async drain(): Promise<void> {
			await Promise.allSettled([...active]);
		},
		pending: () => active.size,
	});
}

export const createRootEvalProviderAdapter = (
	bound: number,
	run: (effect: EvalAdmittedEffect) => Promise<EvalProviderOutcome>,
) => focusedAdapter("eval-admitted-effect", "eval-provider-outcome", bound, run);
export const createRootEvalExactToolAdapter = (
	bound: number,
	run: (effect: EvalAdmittedToolEffect) => Promise<EvalEffectOutcome>,
) => focusedAdapter("eval-admitted-tool-effect", "eval-effect-outcome", bound, run);
export const createRootEvalRetryDelayAdapter = (
	bound: number,
	run: (effect: EvalRetryDelayEffect) => Promise<EvalRetryDelayOutcome>,
) => focusedAdapter("eval-admitted-retry-delay", "eval-retry-delay-outcome", bound, run);
export const createRootEvalBillingAdapter = (
	bound: number,
	run: (effect: EvalBillingObservationEffect) => Promise<EvalBillingObservationOutcome>,
) =>
	focusedAdapter(
		"eval-admitted-billing-observation",
		"eval-billing-observation-outcome",
		bound,
		run,
	);
