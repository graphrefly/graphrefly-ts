import { type Codec, strictJsonCodec } from "../../json/codec.js";
import type { MemoryFragment } from "../../patterns/semantic-memory.js";
import {
	assertAgenticMemoryRecordCodecShape,
	assertArtifactKindValue,
	assertConfidence,
	assertExactKeys,
	assertFiniteNumberArray,
	assertKindValue,
	assertNonEmptyString,
	assertPersistenceLevelValue,
	assertScopeFrame,
	assertStrictJsonValue,
	assertString,
	assertStringArray,
	decimalBigIntString,
	isPlainRecord,
	parseDecimalBigInt,
	validateAndSnapshotRecord,
} from "./shared.js";
import type {
	AgenticMemoryFragmentFrame,
	AgenticMemoryRecord,
	AgenticMemoryRecordFrame,
	StrictJsonValue,
} from "./types.js";

export const AGENTIC_MEMORY_RECORD_FRAME_FORMAT = "graphrefly.agenticMemoryRecord";
export const AGENTIC_MEMORY_RECORD_FRAME_VERSION = 1;

/**
 * Creates an agentic memory record frame.
 *
 * @param record - Record to encode, validate, or project.
 * @returns The agentic memory record frame result.
 * @category solutions
 * @example
 * ```ts
 * import { agenticMemoryRecordFrame } from "@graphrefly/ts/solutions/agentic-memory";
 * ```
 */
export function agenticMemoryRecordFrame<TJson extends StrictJsonValue>(
	record: AgenticMemoryRecord<TJson>,
): AgenticMemoryRecordFrame<TJson> {
	const result = validateAndSnapshotRecord<TJson>(record, 0);
	if (result.errors.length > 0 || result.record === undefined) {
		throw new TypeError(
			`agenticMemoryRecordFrame: invalid record: ${result.errors
				.flatMap((error) => error.validationErrors ?? [error.message])
				.join("; ")}`,
		);
	}
	assertAgenticMemoryRecordCodecShape(record);
	assertStrictJsonValue(result.record.fragment.payload, "record.fragment.payload");
	return Object.freeze({
		format: AGENTIC_MEMORY_RECORD_FRAME_FORMAT,
		version: AGENTIC_MEMORY_RECORD_FRAME_VERSION,
		record: Object.freeze({
			id: result.record.id,
			kind: result.record.kind,
			persistenceLevel: result.record.persistenceLevel,
			artifactKind: result.record.artifactKind,
			...(result.record.scope === undefined ? {} : { scope: result.record.scope }),
			fragment: fragmentFrame(result.record.fragment as MemoryFragment<TJson>),
		}),
	});
}

/** Assert and snapshot a decoded D166 record frame. Unknown fields fail honestly.
 * @param value - Unknown value to check or decode.
 * @returns The narrowed, validated value.
 * @category solutions
 * @example
 * ```ts
 * import { assertAgenticMemoryRecordFrame } from "@graphrefly/ts/solutions";
 * ```
 */
export function assertAgenticMemoryRecordFrame<TJson extends StrictJsonValue = StrictJsonValue>(
	value: unknown,
): AgenticMemoryRecordFrame<TJson> {
	if (!isPlainRecord(value))
		throw new TypeError("agenticMemoryRecordFrame: frame must be an object");
	assertStrictJsonValue(value, "agenticMemoryRecordFrame");
	assertExactKeys(value, ["format", "record", "version"], "agenticMemoryRecordFrame");
	if (value.format !== AGENTIC_MEMORY_RECORD_FRAME_FORMAT) {
		throw new TypeError("agenticMemoryRecordFrame: invalid format");
	}
	if (value.version !== AGENTIC_MEMORY_RECORD_FRAME_VERSION) {
		throw new TypeError("agenticMemoryRecordFrame: invalid version");
	}
	const rawRecord = value.record;
	if (!isPlainRecord(rawRecord)) {
		throw new TypeError("agenticMemoryRecordFrame: record must be an object");
	}
	assertExactKeys(
		rawRecord,
		rawRecord.scope === undefined
			? ["artifactKind", "fragment", "id", "kind", "persistenceLevel"]
			: ["artifactKind", "fragment", "id", "kind", "persistenceLevel", "scope"],
		"agenticMemoryRecordFrame.record",
	);
	const rawFragment = rawRecord.fragment;
	if (!isPlainRecord(rawFragment)) {
		throw new TypeError("agenticMemoryRecordFrame: fragment must be an object");
	}
	assertExactKeys(
		rawFragment,
		[
			"id",
			"payload",
			"tNs",
			...(rawFragment.validFrom === undefined ? [] : ["validFrom"]),
			...(rawFragment.validTo === undefined ? [] : ["validTo"]),
			"confidence",
			"tags",
			"sources",
			...(rawFragment.embedding === undefined ? [] : ["embedding"]),
			...(rawFragment.parentFragmentId === undefined ? [] : ["parentFragmentId"]),
			...(rawFragment.provenance === undefined ? [] : ["provenance"]),
		],
		"agenticMemoryRecordFrame.record.fragment",
	);
	if (rawRecord.scope !== undefined) assertScopeFrame(rawRecord.scope);
	const frame = value as unknown as AgenticMemoryRecordFrame<TJson>;
	const decoded = recordFromFrame(frame);
	const roundtrip = agenticMemoryRecordFrame(decoded);
	return roundtrip as AgenticMemoryRecordFrame<TJson>;
}

/** Strict canonical JSON codec for D166 AgenticMemoryRecordFrame values.
 * @returns A `Codec<AgenticMemoryRecordFrame<TJson>>` value.
 * @category solutions
 * @example
 * ```ts
 * import { agenticMemoryRecordFrameCodec } from "@graphrefly/ts/solutions";
 * ```
 */
export function agenticMemoryRecordFrameCodec<
	TJson extends StrictJsonValue = StrictJsonValue,
>(): Codec<AgenticMemoryRecordFrame<TJson>> {
	return {
		encode(value: AgenticMemoryRecordFrame<TJson>): Uint8Array {
			return strictJsonCodec.encode(assertAgenticMemoryRecordFrame<TJson>(value));
		},
		decode(bytes: Uint8Array): AgenticMemoryRecordFrame<TJson> {
			return assertAgenticMemoryRecordFrame<TJson>(strictJsonCodec.decode(bytes));
		},
	};
}

/** Strict canonical JSON codec that persists records and decodes bigint fields back to bigint.
 * @returns A `Codec<` value.
 * @category solutions
 * @example
 * ```ts
 * import { agenticMemoryRecordCodec } from "@graphrefly/ts/solutions";
 * ```
 */
export function agenticMemoryRecordCodec<TJson extends StrictJsonValue = StrictJsonValue>(): Codec<
	AgenticMemoryRecord<TJson>
> {
	const frameCodec = agenticMemoryRecordFrameCodec<TJson>();
	return {
		encode(value: AgenticMemoryRecord<TJson>): Uint8Array {
			return frameCodec.encode(agenticMemoryRecordFrame(value));
		},
		decode(bytes: Uint8Array): AgenticMemoryRecord<TJson> {
			return recordFromFrame(frameCodec.decode(bytes));
		},
	};
}

/**
 * D167 solution-level retention command projection.
 *
 * Archive/restore/setPersistenceLevel are derived views over current records;
 * requestConsolidation emits request facts only.
 */

function fragmentFrame<TJson extends StrictJsonValue>(
	fragment: MemoryFragment<TJson>,
): AgenticMemoryFragmentFrame<TJson> {
	return Object.freeze({
		id: fragment.id,
		payload: fragment.payload,
		tNs: decimalBigIntString(fragment.tNs, "fragment.tNs"),
		...(fragment.validFrom === undefined
			? {}
			: { validFrom: decimalBigIntString(fragment.validFrom, "fragment.validFrom") }),
		...(fragment.validTo === undefined
			? {}
			: { validTo: decimalBigIntString(fragment.validTo, "fragment.validTo") }),
		confidence: fragment.confidence,
		tags: Object.freeze([...fragment.tags]),
		sources: Object.freeze([...fragment.sources]),
		...(fragment.embedding === undefined
			? {}
			: { embedding: Object.freeze([...fragment.embedding]) }),
		...(fragment.parentFragmentId === undefined
			? {}
			: { parentFragmentId: fragment.parentFragmentId }),
		...(fragment.provenance === undefined ? {} : { provenance: fragment.provenance }),
	});
}

function recordFromFrame<TJson extends StrictJsonValue>(
	frame: AgenticMemoryRecordFrame<TJson>,
): AgenticMemoryRecord<TJson> {
	const fragment = frame.record.fragment;
	const record: AgenticMemoryRecord<TJson> = {
		id: assertNonEmptyString(frame.record.id, "record.id"),
		kind: assertKindValue(frame.record.kind),
		persistenceLevel: assertPersistenceLevelValue(frame.record.persistenceLevel),
		artifactKind: assertArtifactKindValue(frame.record.artifactKind),
		...(frame.record.scope === undefined ? {} : { scope: assertScopeFrame(frame.record.scope) }),
		fragment: {
			id: assertNonEmptyString(fragment.id, "fragment.id"),
			payload: assertStrictJsonValue(fragment.payload, "fragment.payload") as TJson,
			tNs: parseDecimalBigInt(fragment.tNs, "fragment.tNs"),
			...(fragment.validFrom === undefined
				? {}
				: { validFrom: parseDecimalBigInt(fragment.validFrom, "fragment.validFrom") }),
			...(fragment.validTo === undefined
				? {}
				: { validTo: parseDecimalBigInt(fragment.validTo, "fragment.validTo") }),
			confidence: assertConfidence(fragment.confidence, "fragment.confidence"),
			tags: assertStringArray(fragment.tags, "fragment.tags"),
			sources: assertStringArray(fragment.sources, "fragment.sources"),
			...(fragment.embedding === undefined
				? {}
				: { embedding: assertFiniteNumberArray(fragment.embedding, "fragment.embedding") }),
			...(fragment.parentFragmentId === undefined
				? {}
				: {
						parentFragmentId: assertNonEmptyString(fragment.parentFragmentId, "parentFragmentId"),
					}),
			...(fragment.provenance === undefined
				? {}
				: { provenance: assertString(fragment.provenance, "provenance") }),
		},
	};
	const result = validateAndSnapshotRecord<TJson>(record, 0);
	if (result.errors.length > 0 || result.record === undefined) {
		throw new TypeError(
			`agenticMemoryRecordFrame: decoded record is invalid: ${result.errors
				.flatMap((error) => error.validationErrors ?? [error.message])
				.join("; ")}`,
		);
	}
	return result.record;
}
