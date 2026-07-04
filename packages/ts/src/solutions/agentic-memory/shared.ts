import { strictJsonCodec } from "../../json/codec.js";
import type { FactId, MemoryFragment } from "../../patterns/semantic-memory.js";
import { validateMemoryFragment } from "../../patterns/semantic-memory.js";
import type {
	AgenticMemoryArtifactKind,
	AgenticMemoryContextAttribution,
	AgenticMemoryContextTruncation,
	AgenticMemoryError,
	AgenticMemoryFactRef,
	AgenticMemoryKind,
	AgenticMemoryPersistenceLevel,
	AgenticMemoryRecord,
	AgenticMemoryRecordMetadata,
	AgenticMemoryScope,
	AgenticMemoryStatusState,
	StrictJsonValue,
} from "./types.js";

export function validateAndProjectRecords<T>(value: unknown): {
	readonly records: AgenticMemoryRecord<T>[];
	readonly fragments: MemoryFragment<T>[];
	readonly metadataByFragmentId: Record<FactId, AgenticMemoryRecordMetadata>;
	readonly errors: Omit<AgenticMemoryError, "cursor">[];
	readonly invalidRecordIndexes: Set<number>;
} {
	const records: AgenticMemoryRecord<T>[] = [];
	const fragments: MemoryFragment<T>[] = [];
	const metadataByFragmentId = Object.create(null) as Record<FactId, AgenticMemoryRecordMetadata>;
	const errors: Omit<AgenticMemoryError, "cursor">[] = [];
	const invalidRecordIndexes = new Set<number>();
	const seenRecordIds = new Set<FactId>();
	const seenFragmentIds = new Set<FactId>();
	if (!Array.isArray(value)) {
		errors.push({
			code: "invalid-records-input",
			message: "agenticMemoryBundle: records input must be an array",
			record: value,
		});
		return { records, fragments, metadataByFragmentId, errors, invalidRecordIndexes };
	}
	const length = safeArrayLength(value);
	if (length === undefined) {
		errors.push({
			code: "invalid-records-input",
			message: "agenticMemoryBundle: records input length could not be read",
			record: value,
		});
		return { records, fragments, metadataByFragmentId, errors, invalidRecordIndexes };
	}
	for (let i = 0; i < length; i += 1) {
		let raw: unknown;
		try {
			raw = value[i];
		} catch (error) {
			invalidRecordIndexes.add(i);
			errors.push({
				code: "invalid-record",
				message: `agenticMemoryBundle: record access failed: ${errorMessage(error)}`,
				index: i,
				validationErrors: Object.freeze(["record access failed"]),
			});
			continue;
		}
		const result = validateAndSnapshotRecord<T>(raw, i);
		if (result.errors.length > 0) {
			invalidRecordIndexes.add(i);
			errors.push(...result.errors);
			continue;
		}
		if (result.record === undefined) continue;
		if (seenRecordIds.has(result.record.id)) {
			invalidRecordIndexes.add(i);
			errors.push({
				code: "duplicate-record-id",
				message: "agenticMemoryBundle: duplicate record id",
				index: i,
				recordId: result.record.id,
				record: raw,
				validationErrors: [`duplicate record id '${result.record.id}'`],
			});
			continue;
		}
		if (seenFragmentIds.has(result.record.fragment.id)) {
			invalidRecordIndexes.add(i);
			errors.push({
				code: "duplicate-fragment-id",
				message: "agenticMemoryBundle: duplicate fragment id",
				index: i,
				recordId: result.record.id,
				fragmentId: result.record.fragment.id,
				record: raw,
				validationErrors: [`duplicate fragment id '${result.record.fragment.id}'`],
			});
			continue;
		}
		seenRecordIds.add(result.record.id);
		seenFragmentIds.add(result.record.fragment.id);
		records.push(result.record);
		fragments.push(result.record.fragment);
		metadataByFragmentId[result.record.fragment.id] = recordMetadata(result.record);
	}
	return { records, fragments, metadataByFragmentId, errors, invalidRecordIndexes };
}

export function validateAndSnapshotRecord<T>(
	value: unknown,
	index: number,
): {
	readonly record?: AgenticMemoryRecord<T>;
	readonly errors: Omit<AgenticMemoryError, "cursor">[];
} {
	try {
		return validateAndSnapshotRecordInner<T>(value, index);
	} catch (error) {
		return {
			errors: [
				{
					code: "invalid-record",
					message: `agenticMemoryBundle: record access failed: ${errorMessage(error)}`,
					index,
					record: value,
					validationErrors: Object.freeze(["record access failed"]),
				},
			],
		};
	}
}

export function validateAndSnapshotRecordInner<T>(
	value: unknown,
	index: number,
): {
	readonly record?: AgenticMemoryRecord<T>;
	readonly errors: Omit<AgenticMemoryError, "cursor">[];
} {
	const errors: Omit<AgenticMemoryError, "cursor">[] = [];
	if (typeof value !== "object" || value === null || Array.isArray(value)) {
		return {
			errors: [
				{
					code: "invalid-record",
					message: "agenticMemoryBundle: record must be an object",
					index,
					record: value,
				},
			],
		};
	}
	const record = value as Partial<AgenticMemoryRecord<T>> & Record<string, unknown>;
	const recordId = typeof record.id === "string" ? record.id : undefined;
	if (recordId === undefined || recordId.length === 0) {
		errors.push({
			code: "invalid-record",
			message: "agenticMemoryBundle: record.id must be a non-empty string",
			index,
			record: value,
			validationErrors: ["record.id must be a non-empty string"],
		});
	}
	if (!isAgenticMemoryKind(record.kind)) {
		errors.push({
			code: "invalid-record-kind",
			message: "agenticMemoryBundle: record.kind is invalid",
			index,
			recordId,
			record: value,
			validationErrors: ["kind must be one of working, episodic, semantic, procedural, profile"],
		});
	}
	if (!isAgenticMemoryPersistenceLevel(record.persistenceLevel)) {
		errors.push({
			code: "invalid-persistence-level",
			message: "agenticMemoryBundle: record.persistenceLevel is invalid",
			index,
			recordId,
			record: value,
			validationErrors: [
				"persistenceLevel must be one of turn, session, project, longTerm, permanent, archived",
			],
		});
	}
	if (!isAgenticMemoryArtifactKind(record.artifactKind)) {
		errors.push({
			code: "invalid-artifact-kind",
			message: "agenticMemoryBundle: record.artifactKind is invalid",
			index,
			recordId,
			record: value,
			validationErrors: ["artifactKind must be one of raw, insight, profile, procedure"],
		});
	}
	const scopeValidation = validateScope(record.scope);
	if (!scopeValidation.ok) {
		errors.push({
			code: "invalid-scope",
			message: "agenticMemoryBundle: record.scope is invalid",
			index,
			recordId,
			record: value,
			validationErrors: Object.freeze(scopeValidation.errors),
		});
	}
	const fragmentValidation = validateMemoryFragment(record.fragment);
	if (!fragmentValidation.ok) {
		errors.push({
			code: "invalid-fragment",
			message: "agenticMemoryBundle: record.fragment is invalid",
			index,
			recordId,
			fragmentId:
				typeof record.fragment === "object" &&
				record.fragment !== null &&
				typeof (record.fragment as Partial<MemoryFragment>).id === "string"
					? (record.fragment as Partial<MemoryFragment>).id
					: undefined,
			record: value,
			validationErrors: Object.freeze([...fragmentValidation.errors]),
		});
	}
	const forbiddenFields = [
		"storageTier",
		"storageKey",
		"adapter",
		"collection",
		"collections",
		"ttl",
		"ttlMs",
		"ttlNs",
		"expiresAt",
		"timer",
		"scheduler",
		"schedule",
		"retentionTimer",
		"consolidationSchedule",
		"reflectionSchedule",
		"llm",
		"llmHandle",
		"tool",
		"toolHandle",
		"runner",
		"runnerHandle",
		"restore",
		"hydrate",
		"hydration",
		"graphMutation",
		"protocol",
	] as const;
	const presentForbidden = forbiddenFields.filter((field) => Object.hasOwn(record, field));
	if (presentForbidden.length > 0) {
		errors.push({
			code: "invalid-record",
			message: "agenticMemoryBundle: record contains forbidden runtime/persistence fields",
			index,
			recordId,
			record: value,
			validationErrors: Object.freeze(
				presentForbidden.map((field) => `${field} is not part of AgenticMemoryRecord`),
			),
		});
	}
	if (errors.length > 0) return { errors };
	const scope = scopeValidation.scope;
	const fragment = snapshotFragment(record.fragment as MemoryFragment<T>);
	return {
		record: Object.freeze({
			id: recordId as FactId,
			kind: record.kind as AgenticMemoryKind,
			persistenceLevel: record.persistenceLevel as AgenticMemoryPersistenceLevel,
			artifactKind: record.artifactKind as AgenticMemoryArtifactKind,
			...(scope === undefined ? {} : { scope }),
			fragment,
		}),
		errors,
	};
}

export function snapshotFragment<T>(fragment: MemoryFragment<T>): MemoryFragment<T> {
	return Object.freeze({
		id: fragment.id,
		payload: fragment.payload,
		tNs: fragment.tNs,
		...(fragment.validFrom === undefined ? {} : { validFrom: fragment.validFrom }),
		...(fragment.validTo === undefined ? {} : { validTo: fragment.validTo }),
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

export function recordMetadata(record: AgenticMemoryRecord): AgenticMemoryRecordMetadata {
	return Object.freeze({
		recordId: record.id,
		kind: record.kind,
		persistenceLevel: record.persistenceLevel,
		artifactKind: record.artifactKind,
		...(record.scope === undefined ? {} : { scope: record.scope }),
	});
}

export function validateRecordMetadata(value: unknown): {
	readonly ok: boolean;
	readonly metadata?: AgenticMemoryRecordMetadata;
	readonly errors: readonly string[];
} {
	if (value === undefined) return { ok: true, errors: [] };
	if (!isPlainRecord(value)) {
		return { ok: false, errors: ["record metadata must be an object when present"] };
	}
	const errors: string[] = [];
	for (const key of Object.keys(value)) {
		if (
			key !== "recordId" &&
			key !== "kind" &&
			key !== "persistenceLevel" &&
			key !== "artifactKind" &&
			key !== "scope"
		) {
			errors.push(`record.${key} is not part of AgenticMemoryRecordMetadata`);
		}
	}
	if (!isNonEmptyString(value.recordId)) {
		errors.push("record.recordId must be a non-empty string");
	}
	if (!isAgenticMemoryKind(value.kind)) {
		errors.push("record.kind is invalid");
	}
	if (!isAgenticMemoryPersistenceLevel(value.persistenceLevel)) {
		errors.push("record.persistenceLevel is invalid");
	}
	if (!isAgenticMemoryArtifactKind(value.artifactKind)) {
		errors.push("record.artifactKind is invalid");
	}
	const scopeValidation = validateScope(value.scope);
	if (!scopeValidation.ok) {
		errors.push(...scopeValidation.errors.map((error) => `record.${error}`));
	}
	if (errors.length > 0) return { ok: false, errors };
	return {
		ok: true,
		errors,
		metadata: Object.freeze({
			recordId: value.recordId as FactId,
			kind: value.kind as AgenticMemoryKind,
			persistenceLevel: value.persistenceLevel as AgenticMemoryPersistenceLevel,
			artifactKind: value.artifactKind as AgenticMemoryArtifactKind,
			...(scopeValidation.scope === undefined ? {} : { scope: scopeValidation.scope }),
		}),
	};
}

export function contextState(
	projection: AgenticMemoryStatusState,
	retrieval: MemoryRetrievalStatus["state"],
): AgenticMemoryContextState {
	if (projection === "error" || retrieval === "error") return "error";
	if (projection === "partial" || retrieval === "partial") return "partial";
	return retrieval;
}

export function agenticStatusState(
	errorCount: number,
	validRecords: number,
): AgenticMemoryStatusState {
	if (errorCount > 0 && validRecords === 0) return "error";
	if (errorCount > 0) return "partial";
	return validRecords > 0 ? "ready" : "empty";
}

export function isAgenticMemoryKind(value: unknown): value is AgenticMemoryKind {
	return (
		value === "working" ||
		value === "episodic" ||
		value === "semantic" ||
		value === "procedural" ||
		value === "profile"
	);
}

export function isAgenticMemoryPersistenceLevel(
	value: unknown,
): value is AgenticMemoryPersistenceLevel {
	return (
		value === "turn" ||
		value === "session" ||
		value === "project" ||
		value === "longTerm" ||
		value === "permanent" ||
		value === "archived"
	);
}

export function isAgenticMemoryArtifactKind(value: unknown): value is AgenticMemoryArtifactKind {
	return value === "raw" || value === "insight" || value === "profile" || value === "procedure";
}

export function validateScope(value: unknown): {
	readonly ok: boolean;
	readonly scope?: AgenticMemoryScope;
	readonly errors: readonly string[];
} {
	if (value === undefined) return { ok: true, errors: [] };
	if (typeof value !== "object" || value === null || Array.isArray(value)) {
		return { ok: false, errors: ["scope must be an object when present"] };
	}
	const scope = value as Record<string, unknown>;
	const errors: string[] = [];
	const allowed = new Set(["sessionId", "projectId", "userId", "tenantId"]);
	for (const key of Object.keys(scope)) {
		if (!allowed.has(key)) errors.push(`scope.${key} is not part of AgenticMemoryScope`);
	}
	for (const key of allowed) {
		if (scope[key] !== undefined && (typeof scope[key] !== "string" || scope[key].length === 0)) {
			errors.push(`scope.${key} must be a non-empty string when present`);
		}
	}
	if (errors.length > 0) return { ok: false, errors };
	return {
		ok: true,
		errors,
		scope: Object.freeze({
			...(scope.sessionId === undefined ? {} : { sessionId: scope.sessionId as string }),
			...(scope.projectId === undefined ? {} : { projectId: scope.projectId as string }),
			...(scope.userId === undefined ? {} : { userId: scope.userId as string }),
			...(scope.tenantId === undefined ? {} : { tenantId: scope.tenantId as string }),
		}),
	};
}

export function isPlainRecord(value: unknown): value is Record<string, unknown> {
	return value !== null && typeof value === "object" && !Array.isArray(value);
}

export function validateAgenticMemoryContextAttribution(
	value: unknown,
	opts: {
		readonly fragmentId?: FactId;
		readonly recordId?: FactId;
	} = {},
): {
	readonly ok: boolean;
	readonly attribution?: AgenticMemoryContextAttribution;
	readonly errors: readonly string[];
} {
	if (value === undefined) return { ok: true, errors: [] };
	const containerErrors = dataRecordContainerErrors(value, "attribution");
	if (containerErrors.length > 0) return { ok: false, errors: containerErrors };
	const errors: string[] = [];
	errors.push(...forbiddenAgenticMemoryDataFields(value, "attribution"));
	const extra = unexpectedFields(value, [
		"kind",
		"fragmentId",
		"recordId",
		"queryId",
		"rank",
		"score",
		"truncated",
		"truncation",
		"sourceRefs",
		"policyRefs",
		"metadata",
	]);
	errors.push(...extra.map((field) => `attribution.${field} is not part of attribution`));
	if (value.kind !== undefined && value.kind !== "agentic-memory-context-attribution") {
		errors.push("attribution.kind must be agentic-memory-context-attribution when present");
	}
	if (value.fragmentId !== undefined && !isNonEmptyString(value.fragmentId)) {
		errors.push("attribution.fragmentId must be a non-empty string when present");
	}
	if (value.recordId !== undefined && !isNonEmptyString(value.recordId)) {
		errors.push("attribution.recordId must be a non-empty string when present");
	}
	if (value.queryId !== undefined && !isNonEmptyString(value.queryId)) {
		errors.push("attribution.queryId must be a non-empty string when present");
	}
	if (
		value.rank !== undefined &&
		(typeof value.rank !== "number" || !Number.isSafeInteger(value.rank) || value.rank < 1)
	) {
		errors.push("attribution.rank must be a 1-based safe integer when present");
	}
	if (
		value.score !== undefined &&
		(typeof value.score !== "number" || !Number.isFinite(value.score))
	) {
		errors.push("attribution.score must be a finite number when present");
	}
	if (value.truncated !== undefined && typeof value.truncated !== "boolean") {
		errors.push("attribution.truncated must be a boolean when present");
	}
	const truncation = validateContextTruncation(value.truncation);
	if (!truncation.ok) {
		errors.push(...truncation.errors.map((error) => `attribution.${error}`));
	}
	if (value.truncation !== undefined && value.truncated === false) {
		errors.push("attribution.truncation requires attribution.truncated to be true or omitted");
	}
	for (const [field, refs] of [
		["sourceRefs", value.sourceRefs],
		["policyRefs", value.policyRefs],
	] as const) {
		if (refs !== undefined) {
			errors.push(
				...validateAgenticMemoryFactRefs(refs).map((error) => `attribution.${field}: ${error}`),
			);
		}
	}
	if (value.metadata !== undefined && !isStrictJsonObject(value.metadata)) {
		errors.push("attribution.metadata must be a strict JSON object");
	}
	if (
		opts.fragmentId !== undefined &&
		value.fragmentId !== undefined &&
		value.fragmentId !== opts.fragmentId
	) {
		errors.push("attribution.fragmentId must match the containing fragmentId");
	}
	if (
		opts.recordId !== undefined &&
		value.recordId !== undefined &&
		value.recordId !== opts.recordId
	) {
		errors.push("attribution.recordId must match the containing record.recordId");
	}
	if (errors.length > 0) return { ok: false, errors };
	return {
		ok: true,
		errors,
		attribution: Object.freeze({
			...(value.kind === undefined ? {} : { kind: "agentic-memory-context-attribution" as const }),
			...(value.fragmentId === undefined ? {} : { fragmentId: value.fragmentId as FactId }),
			...(value.recordId === undefined ? {} : { recordId: value.recordId as FactId }),
			...(value.queryId === undefined ? {} : { queryId: value.queryId as string }),
			...(value.rank === undefined ? {} : { rank: value.rank as number }),
			...(value.score === undefined ? {} : { score: value.score as number }),
			...(value.truncated === undefined ? {} : { truncated: value.truncated as boolean }),
			...(truncation.truncation === undefined ? {} : { truncation: truncation.truncation }),
			...(value.sourceRefs === undefined
				? {}
				: { sourceRefs: snapshotAgenticMemoryFactRefs(value.sourceRefs) }),
			...(value.policyRefs === undefined
				? {}
				: { policyRefs: snapshotAgenticMemoryFactRefs(value.policyRefs) }),
			...(value.metadata === undefined ? {} : { metadata: cloneStrictJsonObject(value.metadata) }),
		}),
	};
}

export function validateAgenticMemoryFactRefs(value: unknown): readonly string[] {
	if (!Array.isArray(value)) return ["must be an array"];
	const length = safeArrayLength(value);
	if (length === undefined) return ["length could not be read"];
	const arrayContainerErrors = dataArrayContainerErrors(value, "refs", length);
	if (arrayContainerErrors.length > 0) return arrayContainerErrors;
	const errors: string[] = [];
	for (let i = 0; i < length; i += 1) {
		if (!Object.hasOwn(value, i)) {
			errors.push(`[${i}] must be present`);
			continue;
		}
		const ref = value[i];
		if (!isPlainRecord(ref)) {
			errors.push(`[${i}] must be an object`);
			continue;
		}
		const containerErrors = dataRecordContainerErrors(ref, `[${i}]`);
		if (containerErrors.length > 0) {
			errors.push(...containerErrors);
			continue;
		}
		const extraFields = unexpectedFields(ref, ["id", "kind", "metadata"]);
		if (extraFields.length > 0) {
			errors.push(`[${i}] has unexpected fields ${extraFields.join(",")}`);
		}
		if (!isNonEmptyString(ref.kind)) errors.push(`[${i}].kind must be non-empty`);
		if (!isNonEmptyString(ref.id)) errors.push(`[${i}].id must be non-empty`);
		errors.push(...forbiddenAgenticMemoryDataFields(ref, `[${i}]`));
		if (ref.metadata !== undefined && !isStrictJsonObject(ref.metadata)) {
			errors.push(`[${i}].metadata must be a strict JSON object`);
		}
	}
	return errors;
}

export function snapshotAgenticMemoryFactRefs(value: unknown): readonly AgenticMemoryFactRef[] {
	if (!Array.isArray(value)) return Object.freeze([]);
	const refs: AgenticMemoryFactRef[] = [];
	for (let i = 0; i < value.length; i += 1) {
		const ref = value[i] as Record<string, unknown>;
		refs.push(
			Object.freeze({
				kind: ref.kind as string,
				id: ref.id as FactId,
				...(ref.metadata === undefined
					? {}
					: {
							metadata: cloneStrictJsonObject(ref.metadata),
						}),
			}),
		);
	}
	return Object.freeze(refs);
}

export function forbiddenAgenticMemoryDataFields(
	value: Record<string, unknown>,
	label: string,
): readonly string[] {
	const forbidden = [
		"storage",
		"storageTier",
		"storageKey",
		"provider",
		"providerHandle",
		"permission",
		"permissions",
		"graph",
		"node",
		"handle",
		"adapter",
		"hydrate",
		"hydration",
		"restore",
		"runtime",
		"runtimeHandle",
		"protocol",
		"patch",
		"merge",
		"WorkItem",
		"workItem",
		"timer",
		"scheduler",
		"llm",
		"tool",
		"runner",
	] as const;
	const errors: string[] = [];
	for (const field of forbidden) {
		if (Object.hasOwn(value, field)) {
			errors.push(`${label}.${field} is not graph-visible DATA`);
		}
	}
	return errors;
}

export function ownKeys(value: Record<string, unknown>): readonly string[] {
	return Object.keys(value).sort();
}

export function assertExactKeys(
	value: Record<string, unknown>,
	expected: readonly string[],
	label: string,
): void {
	const actual = ownKeys(value);
	const want = [...expected].sort();
	if (actual.length !== want.length || actual.some((key, i) => key !== want[i])) {
		throw new TypeError(`${label}: unexpected fields ${actual.join(",")}`);
	}
}

export function assertAgenticMemoryRecordCodecShape(value: unknown): void {
	if (!isPlainRecord(value)) {
		throw new TypeError("agenticMemoryRecordFrame: record must be an object");
	}
	assertNoSymbolKeys(value, "agenticMemoryRecordFrame.record");
	assertExactKeys(
		value,
		value.scope === undefined
			? ["artifactKind", "fragment", "id", "kind", "persistenceLevel"]
			: ["artifactKind", "fragment", "id", "kind", "persistenceLevel", "scope"],
		"agenticMemoryRecordFrame.record",
	);
	const fragment = value.fragment;
	if (!isPlainRecord(fragment)) {
		throw new TypeError("agenticMemoryRecordFrame: fragment must be an object");
	}
	assertNoSymbolKeys(fragment, "agenticMemoryRecordFrame.record.fragment");
	assertExactKeys(
		fragment,
		[
			"id",
			"payload",
			"tNs",
			...(fragment.validFrom === undefined ? [] : ["validFrom"]),
			...(fragment.validTo === undefined ? [] : ["validTo"]),
			"confidence",
			"tags",
			"sources",
			...(fragment.embedding === undefined ? [] : ["embedding"]),
			...(fragment.parentFragmentId === undefined ? [] : ["parentFragmentId"]),
			...(fragment.provenance === undefined ? [] : ["provenance"]),
		],
		"agenticMemoryRecordFrame.record.fragment",
	);
	assertStrictJsonValue(fragment.tags, "record.fragment.tags");
	assertStrictJsonValue(fragment.sources, "record.fragment.sources");
	if (fragment.embedding !== undefined) {
		assertStrictJsonValue(fragment.embedding, "record.fragment.embedding");
	}
	if (value.scope !== undefined) assertScopeFrame(value.scope);
}

export function assertNoSymbolKeys(value: object, label: string): void {
	if (Object.getOwnPropertySymbols(value).length > 0) {
		throw new TypeError(`${label}: unexpected symbol fields`);
	}
}

export function decimalBigIntString(value: bigint, label: string): string {
	const out = value.toString(10);
	if (!/^-?(0|[1-9]\d*)$/.test(out)) {
		throw new TypeError(`${label} must encode as a canonical decimal bigint string`);
	}
	return out;
}

export function parseDecimalBigInt(value: unknown, label: string): bigint {
	if (typeof value !== "string" || !/^(0|-?[1-9]\d*)$/.test(value)) {
		throw new TypeError(`${label} must be a canonical decimal bigint string`);
	}
	return BigInt(value);
}

export function assertStrictJsonValue(value: unknown, label: string): StrictJsonValue {
	try {
		strictJsonCodec.encode(value);
		return value as StrictJsonValue;
	} catch (error) {
		throw new TypeError(`${label} must be strict JSON: ${errorMessage(error)}`);
	}
}

export function assertScopeFrame(value: unknown): AgenticMemoryScope {
	if (!isPlainRecord(value)) {
		throw new TypeError("agenticMemoryRecordFrame: scope must be an object when present");
	}
	assertStrictJsonValue(value, "record.scope");
	const validation = validateScope(value);
	if (!validation.ok || validation.scope === undefined) {
		throw new TypeError(`agenticMemoryRecordFrame: invalid scope: ${validation.errors.join("; ")}`);
	}
	assertExactKeys(
		value as Record<string, unknown>,
		[
			...((value as Record<string, unknown>).sessionId === undefined ? [] : ["sessionId"]),
			...((value as Record<string, unknown>).projectId === undefined ? [] : ["projectId"]),
			...((value as Record<string, unknown>).userId === undefined ? [] : ["userId"]),
			...((value as Record<string, unknown>).tenantId === undefined ? [] : ["tenantId"]),
		],
		"agenticMemoryRecordFrame.record.scope",
	);
	return validation.scope;
}

export function assertKindValue(value: unknown): AgenticMemoryKind {
	if (!isAgenticMemoryKind(value)) {
		throw new TypeError("agenticMemoryRecordFrame: invalid memory kind");
	}
	return value;
}

export function assertPersistenceLevelValue(value: unknown): AgenticMemoryPersistenceLevel {
	if (!isAgenticMemoryPersistenceLevel(value)) {
		throw new TypeError("agenticMemoryRecordFrame: invalid persistence level");
	}
	return value;
}

export function assertArtifactKindValue(value: unknown): AgenticMemoryArtifactKind {
	if (!isAgenticMemoryArtifactKind(value)) {
		throw new TypeError("agenticMemoryRecordFrame: invalid artifact kind");
	}
	return value;
}

export function assertNonEmptyString(value: unknown, label: string): string {
	if (!isNonEmptyString(value)) throw new TypeError(`${label} must be a non-empty string`);
	return value;
}

export function assertString(value: unknown, label: string): string {
	if (typeof value !== "string") throw new TypeError(`${label} must be a string`);
	return value;
}

export function assertConfidence(value: unknown, label: string): number {
	if (!Number.isFinite(value) || (value as number) < 0 || (value as number) > 1) {
		throw new TypeError(`${label} must be a finite number in [0, 1]`);
	}
	return value as number;
}

export function assertStringArray(value: unknown, label: string): readonly string[] {
	if (!isDenseArrayOf(value, (item): item is string => typeof item === "string")) {
		throw new TypeError(`${label} must be a readonly string array`);
	}
	return Object.freeze([...value]);
}

export function assertFiniteNumberArray(value: unknown, label: string): readonly number[] {
	if (!isDenseArrayOf(value, (item): item is number => Number.isFinite(item))) {
		throw new TypeError(`${label} must be a finite number array`);
	}
	return Object.freeze([...value]);
}

export function isNonEmptyString(value: unknown): value is string {
	return typeof value === "string" && value.length > 0;
}

export function isDenseArrayOf<T>(
	value: unknown,
	predicate: (item: unknown) => item is T,
): value is T[] {
	if (!Array.isArray(value)) return false;
	for (let i = 0; i < value.length; i += 1) {
		if (!Object.hasOwn(value, i) || !predicate(value[i])) return false;
	}
	return true;
}

export function freezeError<T extends { readonly validationErrors?: readonly string[] }>(
	error: T,
): T {
	return Object.freeze({
		...error,
		...(error.validationErrors === undefined
			? {}
			: { validationErrors: Object.freeze([...error.validationErrors]) }),
	}) as T;
}

export function safeArrayLength(value: readonly unknown[]): number | undefined {
	try {
		return value.length;
	} catch {
		return undefined;
	}
}

export function errorMessage(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

function validateContextTruncation(value: unknown): {
	readonly ok: boolean;
	readonly truncation?: AgenticMemoryContextTruncation;
	readonly errors: readonly string[];
} {
	if (value === undefined) return { ok: true, errors: [] };
	const containerErrors = dataRecordContainerErrors(value, "truncation");
	if (containerErrors.length > 0) return { ok: false, errors: containerErrors };
	const errors: string[] = [];
	errors.push(...forbiddenAgenticMemoryDataFields(value, "truncation"));
	const extra = unexpectedFields(value, [
		"originalChars",
		"packedChars",
		"omittedChars",
		"originalCost",
		"packedCost",
		"omittedCost",
		"reason",
		"metadata",
	]);
	errors.push(...extra.map((field) => `truncation.${field} is not part of truncation`));
	for (const field of ["originalChars", "packedChars", "omittedChars"] as const) {
		const current = value[field];
		if (
			current !== undefined &&
			(typeof current !== "number" || !Number.isSafeInteger(current) || current < 0)
		) {
			errors.push(`truncation.${field} must be a safe integer >= 0 when present`);
		}
	}
	for (const field of ["originalCost", "packedCost", "omittedCost"] as const) {
		const current = value[field];
		if (
			current !== undefined &&
			(typeof current !== "number" || !Number.isFinite(current) || current < 0)
		) {
			errors.push(`truncation.${field} must be a finite number >= 0 when present`);
		}
	}
	if (value.reason !== undefined && typeof value.reason !== "string") {
		errors.push("truncation.reason must be a string when present");
	}
	if (value.metadata !== undefined && !isStrictJsonObject(value.metadata)) {
		errors.push("truncation.metadata must be a strict JSON object");
	}
	if (errors.length > 0) return { ok: false, errors };
	return {
		ok: true,
		errors,
		truncation: Object.freeze({
			...(value.originalChars === undefined
				? {}
				: { originalChars: value.originalChars as number }),
			...(value.packedChars === undefined ? {} : { packedChars: value.packedChars as number }),
			...(value.omittedChars === undefined ? {} : { omittedChars: value.omittedChars as number }),
			...(value.originalCost === undefined ? {} : { originalCost: value.originalCost as number }),
			...(value.packedCost === undefined ? {} : { packedCost: value.packedCost as number }),
			...(value.omittedCost === undefined ? {} : { omittedCost: value.omittedCost as number }),
			...(value.reason === undefined ? {} : { reason: value.reason as string }),
			...(value.metadata === undefined ? {} : { metadata: cloneStrictJsonObject(value.metadata) }),
		}),
	};
}

function isStrictJsonObject(value: unknown): boolean {
	if (!isPlainRecord(value)) return false;
	try {
		strictJsonCodec.encode(value);
		return true;
	} catch {
		return false;
	}
}

export function cloneStrictJsonObject(value: unknown): Readonly<Record<string, StrictJsonValue>> {
	const decoded = strictJsonCodec.decode(strictJsonCodec.encode(value)) as StrictJsonValue;
	return deepFreezeStrictJson(decoded) as Readonly<Record<string, StrictJsonValue>>;
}

function deepFreezeStrictJson(value: StrictJsonValue): StrictJsonValue {
	if (value !== null && typeof value === "object") {
		if (Array.isArray(value)) {
			for (const item of value) deepFreezeStrictJson(item);
		} else {
			for (const item of Object.values(value)) deepFreezeStrictJson(item);
		}
		Object.freeze(value);
	}
	return value;
}

function unexpectedFields(
	value: Record<string, unknown>,
	expected: readonly string[],
): readonly string[] {
	const allowed = new Set(expected);
	return Object.keys(value)
		.filter((key) => !allowed.has(key))
		.sort();
}

function dataRecordContainerErrors(value: unknown, label: string): readonly string[] {
	if (!isPlainRecord(value)) return [`${label} must be an object when present`];
	const errors: string[] = [];
	const proto = Object.getPrototypeOf(value);
	if (proto !== Object.prototype && proto !== null) {
		errors.push(`${label} must be a plain data object`);
	}
	if (Object.getOwnPropertySymbols(value).length > 0) {
		errors.push(`${label} must not carry symbol keys`);
	}
	for (const key of Object.getOwnPropertyNames(value)) {
		const descriptor = Object.getOwnPropertyDescriptor(value, key);
		if (descriptor === undefined) continue;
		if ("get" in descriptor || "set" in descriptor) {
			errors.push(`${label}.${key} must be a data property`);
		}
		if (!descriptor.enumerable) {
			errors.push(`${label}.${key} must be enumerable`);
		}
	}
	return errors;
}

function dataArrayContainerErrors(
	value: readonly unknown[],
	label: string,
	length: number,
): readonly string[] {
	const errors: string[] = [];
	if (Object.getOwnPropertySymbols(value).length > 0) {
		errors.push(`${label} must not carry symbol keys`);
	}
	for (const key of Object.getOwnPropertyNames(value)) {
		const descriptor = Object.getOwnPropertyDescriptor(value, key);
		if (descriptor === undefined) continue;
		const isIndex =
			/^(0|[1-9]\d*)$/.test(key) && Number.isSafeInteger(Number(key)) && Number(key) < length;
		if ("get" in descriptor || "set" in descriptor) {
			errors.push(`${label}.${key} must be a data property`);
		}
		if (key !== "length" && !isIndex) {
			errors.push(`${label}.${key} must be an indexed data property`);
		}
		if (key !== "length" && isIndex && !descriptor.enumerable) {
			errors.push(`${label}.${key} must be enumerable`);
		}
	}
	return errors;
}
