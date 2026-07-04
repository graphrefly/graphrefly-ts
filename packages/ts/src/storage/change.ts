/**
 * Storage change envelopes (D82): persistence framing for raw graph/data-structure deltas.
 */

import type { Codec } from "./codec.js";
import { strictJsonCodecFor } from "./codec.js";
import {
	assertNonNegativeDecimalIntegerString,
	bigIntToNonNegativeDecimalString,
	type NonNegativeDecimalIntegerString,
} from "./scalar.js";

/** Storage-side lifecycle namespace for change envelopes; presentation framing only. */
export type ChangeLifecycle = "spec" | "data" | "ownership";

/** D84 cross-runtime wall-clock nanosecond metadata: canonical non-negative decimal string. */
export type StorageTimestampNs = NonNegativeDecimalIntegerString;

/** Persistence envelope for raw graph/data-structure deltas (D82), not restore semantics. */
export interface ChangeEnvelope<T = unknown> {
	readonly lifecycle: ChangeLifecycle;
	readonly structure: string;
	readonly version: number | string;
	readonly t_ns: StorageTimestampNs;
	readonly seq?: number;
	readonly change: T;
}

/** Options for wrapping a raw change in a storage envelope. */
export interface ChangeEnvelopeOptions {
	lifecycle?: ChangeLifecycle;
	structure: string;
	version?: number | string;
	t_ns?: StorageTimestampNs;
	seq?: number;
}

/** Wall-clock nanoseconds for storage metadata.
 * @returns A `StorageTimestampNs` value.
 * @category storage
 * @example
 * ```ts
 * import { nowNs } from "@graphrefly/ts/storage";
 * ```
 */
export function nowNs(): StorageTimestampNs {
	return bigIntToNonNegativeDecimalString(BigInt(Date.now()) * 1_000_000n);
}

/** Wrap a raw change payload in a D82 storage envelope.
 * @param change - change value used by the helper.
 * @param opts - Options that configure the helper.
 * @returns A `ChangeEnvelope<T>` value.
 * @category storage
 * @example
 * ```ts
 * import { envelopeChange } from "@graphrefly/ts/storage";
 * ```
 */
export function envelopeChange<T>(change: T, opts: ChangeEnvelopeOptions): ChangeEnvelope<T> {
	const envelope = {
		lifecycle: opts.lifecycle ?? "data",
		structure: opts.structure,
		version: opts.version ?? 1,
		t_ns: opts.t_ns ?? nowNs(),
		...(opts.seq === undefined ? {} : { seq: opts.seq }),
		change,
	};
	return assertChangeEnvelope<T>(envelope);
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isLifecycle(value: unknown): value is ChangeLifecycle {
	return value === "spec" || value === "data" || value === "ownership";
}

/** Validate a decoded D82 change envelope and return it with typed payload.
 * @param value - Unknown value to check or decode.
 * @returns The narrowed, validated value.
 * @category storage
 * @example
 * ```ts
 * import { assertChangeEnvelope } from "@graphrefly/ts/storage";
 * ```
 */
export function assertChangeEnvelope<T = unknown>(value: unknown): ChangeEnvelope<T> {
	if (!isRecord(value)) throw new TypeError("changeEnvelopeCodec: frame must be an object");
	if (!isLifecycle(value.lifecycle)) {
		throw new TypeError("changeEnvelopeCodec: lifecycle must be spec, data, or ownership");
	}
	if (typeof value.structure !== "string" || value.structure.length === 0) {
		throw new TypeError("changeEnvelopeCodec: structure must be a non-empty string");
	}
	if (
		(typeof value.version !== "number" || !Number.isFinite(value.version)) &&
		typeof value.version !== "string"
	) {
		throw new TypeError("changeEnvelopeCodec: version must be a finite number or string");
	}
	assertNonNegativeDecimalIntegerString(value.t_ns, "changeEnvelopeCodec: t_ns");
	if (value.seq !== undefined && (!Number.isSafeInteger(value.seq) || (value.seq as number) < 0)) {
		throw new TypeError(
			"changeEnvelopeCodec: seq must be a non-negative safe integer when present",
		);
	}
	if (!Object.hasOwn(value, "change")) {
		throw new TypeError("changeEnvelopeCodec: change payload is required");
	}
	return value as unknown as ChangeEnvelope<T>;
}

/** Stable JSON codec for D82 change envelopes, with strict framing checks.
 * @returns A `Codec<ChangeEnvelope<T>>` value.
 * @category storage
 * @example
 * ```ts
 * import { changeEnvelopeCodec } from "@graphrefly/ts/storage";
 * ```
 */
export function changeEnvelopeCodec<T = unknown>(): Codec<ChangeEnvelope<T>> {
	const codec = strictJsonCodecFor<unknown>();
	return {
		encode(value) {
			return codec.encode(assertChangeEnvelope(value));
		},
		decode(bytes) {
			return assertChangeEnvelope<T>(codec.decode(bytes));
		},
	};
}
