export type CloneProcessStateResult<TState> =
	| { readonly ok: true; readonly value: TState }
	| { readonly ok: false; readonly message: string };

export function cloneProcessState<TState>(state: TState): CloneProcessStateResult<TState> {
	if (typeof state !== "object" || state === null) return { ok: true, value: state };
	try {
		if (typeof globalThis.structuredClone === "function") {
			return { ok: true, value: globalThis.structuredClone(state) as TState };
		}
		return { ok: true, value: JSON.parse(JSON.stringify(state)) as TState };
	} catch (error) {
		return {
			ok: false,
			message: `processBundle: state must be cloneable before reducer execution (${errorMessage(error)})`,
		};
	}
}

export function readTimestampMs(now: () => number): number | string {
	try {
		const timestampMs = now();
		if (!Number.isFinite(timestampMs)) return "processBundle: now() must return a finite number";
		return timestampMs;
	} catch (error) {
		return errorMessage(error);
	}
}

export function rethrowGraphRuntimeInvariant(error: unknown): void {
	const message = errorMessage(error);
	if (
		message.includes("R-reentrancy") ||
		message.includes("R-rewire") ||
		message.includes("R-graph-domain") ||
		message.includes("D37") ||
		message.includes("D22") ||
		message.includes("different graph") ||
		message.includes("cross-graph") ||
		message.includes("wire bridge") ||
		message.includes("mid-fn topology mutation") ||
		message.includes("reentrant dep mutation") ||
		message.includes("feedback cycle")
	) {
		throw error;
	}
}

export function isObjectRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function errorMessage(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}
