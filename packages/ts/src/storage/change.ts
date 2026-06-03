/**
 * Storage change envelopes (D82): persistence framing for raw graph/data-structure deltas.
 */

/** Storage-side lifecycle namespace for change envelopes; presentation framing only. */
export type ChangeLifecycle = "spec" | "data" | "ownership";

/** Persistence envelope for raw graph/data-structure deltas (D82), not restore semantics. */
export interface ChangeEnvelope<T = unknown> {
	readonly lifecycle: ChangeLifecycle;
	readonly structure: string;
	readonly version: number | string;
	readonly t_ns: number;
	readonly seq?: number;
	readonly change: T;
}

/** Options for wrapping a raw change in a storage envelope. */
export interface ChangeEnvelopeOptions {
	lifecycle?: ChangeLifecycle;
	structure: string;
	version?: number | string;
	t_ns?: number;
	seq?: number;
}

/** Wall-clock nanoseconds for storage metadata. */
export function nowNs(): number {
	return Date.now() * 1_000_000;
}

/** Wrap a raw change payload in a D82 storage envelope. */
export function envelopeChange<T>(change: T, opts: ChangeEnvelopeOptions): ChangeEnvelope<T> {
	return {
		lifecycle: opts.lifecycle ?? "data",
		structure: opts.structure,
		version: opts.version ?? 1,
		t_ns: opts.t_ns ?? nowNs(),
		...(opts.seq === undefined ? {} : { seq: opts.seq }),
		change,
	};
}
