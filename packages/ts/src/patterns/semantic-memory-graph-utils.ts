/**
 * Graph-visible semantic-memory retrieval patterns.
 *
 * D158 allows horizontal semantic-memory patterns when they are ordinary graph
 * nodes with declared deps and graph-visible facts. This file intentionally
 * owns no storage restore/hydration, scheduler, hidden subscription, vector DB,
 * retention loop, consolidation loop, Graph subclass, or protocol behavior.
 */

import {
	cosineSimilarity,
	type FactId,
	filterMemoryFragments,
	type KnowledgeAssertion,
	type KnowledgeAssertionObject,
	type KnowledgeAssertionSubject,
	type MemoryFragment,
	memoryFragmentMatchesQuery,
	validateMemoryFragment,
} from "./semantic-memory.js";
import type {
	KnowledgeGraphEntity,
	KnowledgeGraphError,
	KnowledgeGraphIndex,
	KnowledgeGraphPolicy,
	KnowledgeGraphRelation,
	KnowledgeGraphTopic,
	MemoryRetrievalError,
	MemoryRetrievalQuery,
	MemoryRetrievalStatusState,
} from "./semantic-memory-graph-types.js";

interface MemoryRetrievalQueryValidation {
	readonly ok: boolean;
	readonly query: MemoryRetrievalQuery;
	readonly errors: readonly Omit<MemoryRetrievalError, "cursor">[];
}

interface FragmentValidationResult<T> {
	readonly fragment?: MemoryFragment<T>;
	readonly error?: Omit<MemoryRetrievalError, "cursor">;
}

export function validateKnowledgeGraphPolicy(value: unknown): {
	readonly policy?: KnowledgeGraphPolicy;
	readonly errors: readonly Omit<KnowledgeGraphError, "cursor">[];
} {
	if (value === undefined) return { policy: undefined, errors: [] };
	if (!isPlainObject(value)) {
		return {
			errors: [
				{
					code: "invalid-policy",
					message: "knowledgeGraphReducerBundle: policy must be an object",
					assertion: value,
				},
			],
		};
	}
	const errors: string[] = [];
	const policy = value as Partial<KnowledgeGraphPolicy>;
	if (
		policy.allowedPredicates !== undefined &&
		!isDenseArrayOf(policy.allowedPredicates, (item): item is string => typeof item === "string")
	) {
		errors.push("allowedPredicates must be a readonly string array");
	}
	if (policy.requireEntityTypes !== undefined && typeof policy.requireEntityTypes !== "boolean") {
		errors.push("requireEntityTypes must be a boolean when present");
	}
	if (errors.length > 0) {
		return {
			errors: [
				{
					code: "invalid-policy",
					message: "knowledgeGraphReducerBundle: policy is invalid",
					assertion: value,
					validationErrors: Object.freeze(errors),
				},
			],
		};
	}
	return {
		policy: Object.freeze({
			...(policy.allowedPredicates === undefined
				? {}
				: { allowedPredicates: Object.freeze([...policy.allowedPredicates]) }),
			...(policy.requireEntityTypes === undefined
				? {}
				: { requireEntityTypes: policy.requireEntityTypes }),
		}),
		errors: [],
	};
}

export function reduceKnowledgeAssertions(
	value: unknown,
	policy?: KnowledgeGraphPolicy,
): {
	readonly assertions: readonly KnowledgeAssertion[];
	readonly entities: readonly KnowledgeGraphEntity[];
	readonly relations: readonly KnowledgeGraphRelation[];
	readonly topics: readonly KnowledgeGraphTopic[];
	readonly index: KnowledgeGraphIndex;
	readonly errors: readonly Omit<KnowledgeGraphError, "cursor">[];
	readonly invalidAssertions: number;
} {
	const assertions: KnowledgeAssertion[] = [];
	const errors: Omit<KnowledgeGraphError, "cursor">[] = [];
	const seenAssertions = new Set<FactId>();
	if (!Array.isArray(value)) {
		return {
			assertions,
			entities: [],
			relations: [],
			topics: [],
			index: emptyKnowledgeGraphIndex(),
			errors: [
				{
					code: "invalid-assertions-input",
					message: "knowledgeGraphReducerBundle: assertions input must be an array",
					assertion: value,
				},
			],
			invalidAssertions: 0,
		};
	}
	const length = safeArrayLength(value);
	if (length === undefined) {
		return {
			assertions,
			entities: [],
			relations: [],
			topics: [],
			index: emptyKnowledgeGraphIndex(),
			errors: [
				{
					code: "invalid-assertions-input",
					message: "knowledgeGraphReducerBundle: assertions input length could not be read",
					assertion: value,
				},
			],
			invalidAssertions: 0,
		};
	}
	for (let i = 0; i < length; i += 1) {
		const result = validateKnowledgeAssertion(value[i], i, policy);
		if (result.error !== undefined) {
			errors.push(result.error);
			continue;
		}
		const assertion = result.assertion as KnowledgeAssertion;
		if (seenAssertions.has(assertion.id)) {
			errors.push({
				code: "duplicate-assertion-id",
				message: "knowledgeGraphReducerBundle: duplicate assertion id",
				index: i,
				assertionId: assertion.id,
				assertion,
				validationErrors: Object.freeze([`duplicate assertion id '${assertion.id}'`]),
			});
			continue;
		}
		seenAssertions.add(assertion.id);
		assertions.push(assertion);
	}
	const materialized = materializeKnowledgeGraph(assertions);
	return {
		assertions: Object.freeze(assertions),
		...materialized,
		errors,
		invalidAssertions: errors.filter((error) => error.code !== "invalid-policy").length,
	};
}

function validateKnowledgeAssertion(
	value: unknown,
	index: number,
	policy?: KnowledgeGraphPolicy,
): {
	readonly assertion?: KnowledgeAssertion;
	readonly error?: Omit<KnowledgeGraphError, "cursor">;
} {
	if (!isPlainObject(value)) {
		return invalidKnowledgeAssertion(index, value, ["assertion must be an object"]);
	}
	const raw = value as Partial<KnowledgeAssertion>;
	const errors: string[] = [];
	if (!isNonEmptyString(raw.id)) errors.push("id must be a non-empty string");
	if (!isKnowledgeSubject(raw.subject)) errors.push("subject.id must be a non-empty string");
	if (!isNonEmptyString(raw.predicate)) errors.push("predicate must be a non-empty string");
	if (!isKnowledgeObject(raw.object)) errors.push("object shape is invalid");
	if (
		raw.confidence !== undefined &&
		(!Number.isFinite(raw.confidence) || raw.confidence < 0 || raw.confidence > 1)
	) {
		errors.push("confidence must be a finite number in [0, 1] when present");
	}
	if (raw.sources !== undefined && !isDenseArrayOf(raw.sources, isNonEmptyString)) {
		errors.push("sources must be a readonly non-empty string array when present");
	}
	if (
		policy?.allowedPredicates !== undefined &&
		!policy.allowedPredicates.includes(raw.predicate ?? "")
	) {
		errors.push(`predicate '${String(raw.predicate)}' is not allowed by policy`);
	}
	if (policy?.requireEntityTypes === true) {
		if (isKnowledgeSubject(raw.subject) && raw.subject.type === undefined) {
			errors.push("subject.type is required by policy");
		}
		if (
			isKnowledgeObject(raw.object) &&
			raw.object.kind === "entity" &&
			raw.object.type === undefined
		) {
			errors.push("object.type is required by policy for entity objects");
		}
	}
	if (errors.length > 0) {
		return invalidKnowledgeAssertion(index, value, errors, raw.id);
	}
	return {
		assertion: Object.freeze({
			id: raw.id as FactId,
			...(raw.recordId === undefined ? {} : { recordId: raw.recordId }),
			...(raw.fragmentId === undefined ? {} : { fragmentId: raw.fragmentId }),
			subject: snapshotSubject(raw.subject as KnowledgeAssertionSubject),
			predicate: raw.predicate as string,
			object: snapshotObject(raw.object as KnowledgeAssertionObject),
			...(raw.confidence === undefined ? {} : { confidence: raw.confidence }),
			sources: Object.freeze([...(raw.sources ?? [])]),
			...(raw.provenance === undefined ? {} : { provenance: raw.provenance }),
		}),
	};
}

function invalidKnowledgeAssertion(
	index: number,
	assertion: unknown,
	validationErrors: readonly string[],
	assertionId?: unknown,
): { readonly error: Omit<KnowledgeGraphError, "cursor"> } {
	return {
		error: {
			code: "invalid-assertion",
			message: "knowledgeGraphReducerBundle: assertion is invalid",
			index,
			assertionId: typeof assertionId === "string" ? assertionId : undefined,
			assertion,
			validationErrors: Object.freeze([...validationErrors]),
		},
	};
}

function materializeKnowledgeGraph(assertions: readonly KnowledgeAssertion[]): {
	readonly entities: readonly KnowledgeGraphEntity[];
	readonly relations: readonly KnowledgeGraphRelation[];
	readonly topics: readonly KnowledgeGraphTopic[];
	readonly index: KnowledgeGraphIndex;
} {
	const entityAssertions = new Map<
		FactId,
		{
			type?: string;
			assertionIds: Set<FactId>;
			subjectAssertionIds: Set<FactId>;
			objectAssertionIds: Set<FactId>;
		}
	>();
	const topics = new Map<FactId, { assertionIds: Set<FactId>; entityIds: Set<FactId> }>();
	const relations: KnowledgeGraphRelation[] = [];
	for (const assertion of assertions) {
		const subject = touchEntity(entityAssertions, assertion.subject.id, assertion.subject.type);
		subject.assertionIds.add(assertion.id);
		subject.subjectAssertionIds.add(assertion.id);
		let topic = topics.get(assertion.predicate);
		if (topic === undefined) {
			topic = { assertionIds: new Set(), entityIds: new Set() };
			topics.set(assertion.predicate, topic);
		}
		topic.assertionIds.add(assertion.id);
		topic.entityIds.add(assertion.subject.id);
		if (assertion.object.kind === "entity") {
			const object = touchEntity(entityAssertions, assertion.object.id, assertion.object.type);
			object.assertionIds.add(assertion.id);
			object.objectAssertionIds.add(assertion.id);
			topic.entityIds.add(assertion.object.id);
		}
		relations.push(
			Object.freeze({
				assertionId: assertion.id,
				subject: assertion.subject,
				predicate: assertion.predicate,
				object: assertion.object,
				...(assertion.confidence === undefined ? {} : { confidence: assertion.confidence }),
				sources: Object.freeze([...(assertion.sources ?? [])]),
				...(assertion.provenance === undefined ? {} : { provenance: assertion.provenance }),
			}),
		);
	}
	const entities = [...entityAssertions.entries()].map(([id, entity]) =>
		Object.freeze({
			id,
			...(entity.type === undefined ? {} : { type: entity.type }),
			assertionIds: freezeSortedSet(entity.assertionIds),
			subjectAssertionIds: freezeSortedSet(entity.subjectAssertionIds),
			objectAssertionIds: freezeSortedSet(entity.objectAssertionIds),
		}),
	);
	entities.sort((a, b) => compareString(a.id, b.id));
	relations.sort((a, b) => compareString(a.assertionId, b.assertionId));
	const topicFacts = [...topics.entries()].map(([predicate, topic]) =>
		Object.freeze({
			predicate,
			assertionIds: freezeSortedSet(topic.assertionIds),
			entityIds: freezeSortedSet(topic.entityIds),
		}),
	);
	topicFacts.sort((a, b) => compareString(a.predicate, b.predicate));
	const index: KnowledgeGraphIndex = Object.freeze({
		assertionIds: Object.freeze(assertions.map((assertion) => assertion.id).sort(compareString)),
		entityIds: Object.freeze(entities.map((entity) => entity.id)),
		relationIds: Object.freeze(relations.map((relation) => relation.assertionId)),
		predicates: Object.freeze(topicFacts.map((topic) => topic.predicate)),
	});
	return {
		entities: Object.freeze(entities),
		relations: Object.freeze(relations),
		topics: Object.freeze(topicFacts),
		index,
	};
}

function touchEntity(
	entities: Map<
		FactId,
		{
			type?: string;
			assertionIds: Set<FactId>;
			subjectAssertionIds: Set<FactId>;
			objectAssertionIds: Set<FactId>;
		}
	>,
	id: FactId,
	type?: string,
) {
	let entity = entities.get(id);
	if (entity === undefined) {
		entity = {
			...(type === undefined ? {} : { type }),
			assertionIds: new Set(),
			subjectAssertionIds: new Set(),
			objectAssertionIds: new Set(),
		};
		entities.set(id, entity);
	} else if (entity.type === undefined && type !== undefined) {
		entity.type = type;
	}
	return entity;
}

function emptyKnowledgeGraphIndex(): KnowledgeGraphIndex {
	return Object.freeze({
		assertionIds: Object.freeze([]),
		entityIds: Object.freeze([]),
		relationIds: Object.freeze([]),
		predicates: Object.freeze([]),
	});
}

function snapshotSubject(subject: KnowledgeAssertionSubject): KnowledgeAssertionSubject {
	return Object.freeze({
		id: subject.id,
		...(subject.type === undefined ? {} : { type: subject.type }),
	});
}

function snapshotObject(object: KnowledgeAssertionObject): KnowledgeAssertionObject {
	return object.kind === "entity"
		? Object.freeze({
				kind: "entity",
				id: object.id,
				...(object.type === undefined ? {} : { type: object.type }),
			})
		: Object.freeze({
				kind: "value",
				value: object.value,
				...(object.valueType === undefined ? {} : { valueType: object.valueType }),
			});
}

function isKnowledgeSubject(value: unknown): value is KnowledgeAssertionSubject {
	return (
		isPlainObject(value) &&
		isNonEmptyString(value.id) &&
		(value.type === undefined || isNonEmptyString(value.type))
	);
}

function isKnowledgeObject(value: unknown): value is KnowledgeAssertionObject {
	if (!isPlainObject(value)) return false;
	if (value.kind === "entity") {
		return isNonEmptyString(value.id) && (value.type === undefined || isNonEmptyString(value.type));
	}
	if (value.kind !== "value") return false;
	return (
		isStrictJsonValue(value.value) &&
		(value.valueType === undefined || isNonEmptyString(value.valueType))
	);
}

function isStrictJsonValue(value: unknown): boolean {
	if (value === null || typeof value === "string" || typeof value === "boolean") return true;
	if (typeof value === "number") return Number.isFinite(value);
	if (Array.isArray(value)) {
		for (let i = 0; i < value.length; i += 1) {
			if (!Object.hasOwn(value, i) || !isStrictJsonValue(value[i])) return false;
		}
		return true;
	}
	if (!isPlainObject(value)) return false;
	for (const key of Object.keys(value)) {
		if (!isStrictJsonValue(value[key])) return false;
	}
	return Object.getOwnPropertySymbols(value).length === 0;
}

function freezeSortedSet(value: ReadonlySet<FactId>): readonly FactId[] {
	return Object.freeze([...value].sort(compareString));
}

export function rankFragments<T>(
	fragments: readonly MemoryFragment<T>[],
	query: MemoryRetrievalQuery,
): readonly MemoryFragment<T>[] {
	if (query.vector === undefined) return filterMemoryFragments(fragments, query);
	const ranked = fragments.filter((fragment) => memoryFragmentMatchesQuery(fragment, query));
	ranked.sort((a, b) => {
		const vectorDelta = vectorScore(b, query) - vectorScore(a, query);
		if (vectorDelta !== 0) return vectorDelta;
		const confidenceDelta = b.confidence - a.confidence;
		if (confidenceDelta !== 0) return confidenceDelta;
		return compareBigIntDesc(a.tNs, b.tNs);
	});
	return query.limit === undefined ? ranked : ranked.slice(0, Math.max(0, query.limit));
}

function vectorScore(fragment: MemoryFragment, query: MemoryRetrievalQuery): number {
	if (query.vector === undefined || fragment.embedding === undefined) return 0;
	return cosineSimilarity(query.vector, fragment.embedding);
}

export function statusState(
	errors: readonly Omit<MemoryRetrievalError, "cursor">[],
	resultCount: number,
): MemoryRetrievalStatusState {
	if (errors.some((error) => !isRecoverableFragmentError(error))) return "error";
	if (errors.length > 0) return "partial";
	return resultCount > 0 ? "ready" : "empty";
}

export function isRecoverableFragmentError(error: Omit<MemoryRetrievalError, "cursor">): boolean {
	return error.code === "invalid-fragment" || error.code === "duplicate-fragment-id";
}

export function indexById<T>(
	fragments: readonly MemoryFragment<T>[],
): Readonly<Record<FactId, MemoryFragment<T>>> {
	const byId = Object.create(null) as Record<FactId, MemoryFragment<T>>;
	for (const fragment of fragments) byId[fragment.id] = fragment;
	return Object.freeze(byId);
}

function isFiniteVector(value: unknown): value is readonly number[] {
	if (!Array.isArray(value)) return false;
	for (let i = 0; i < value.length; i += 1) {
		if (!Object.hasOwn(value, i) || !Number.isFinite(value[i])) return false;
	}
	return true;
}

export function validateMemoryRetrievalQuery(value: unknown): MemoryRetrievalQueryValidation {
	try {
		return validateMemoryRetrievalQueryInner(value);
	} catch (error) {
		return {
			ok: false,
			query: {},
			errors: [
				{
					code: "invalid-query",
					message: `memoryRetrievalBundle: query access failed: ${errorMessage(error)}`,
					fragment: value,
				},
			],
		};
	}
}

function validateMemoryRetrievalQueryInner(value: unknown): MemoryRetrievalQueryValidation {
	if (typeof value !== "object" || value === null || Array.isArray(value)) {
		return invalidQuery(value, "memoryRetrievalBundle: query must be an object");
	}
	const query = value as Partial<MemoryRetrievalQuery>;
	const errors: Omit<MemoryRetrievalError, "cursor">[] = [];
	if (
		query.tags !== undefined &&
		!isDenseArrayOf(query.tags, (tag): tag is string => typeof tag === "string")
	) {
		errors.push({
			code: "invalid-query",
			message: "memoryRetrievalBundle: query.tags must be a readonly string array",
			fragment: value,
			validationErrors: ["tags must be a readonly string array"],
		});
	}
	if (query.asOf !== undefined && typeof query.asOf !== "bigint") {
		errors.push({
			code: "invalid-query",
			message: "memoryRetrievalBundle: query.asOf must be a bigint",
			fragment: value,
			validationErrors: ["asOf must be a bigint when present"],
		});
	}
	if (
		query.minConfidence !== undefined &&
		(!Number.isFinite(query.minConfidence) || query.minConfidence < 0 || query.minConfidence > 1)
	) {
		errors.push({
			code: "invalid-query",
			message: "memoryRetrievalBundle: query.minConfidence must be a finite number in [0, 1]",
			fragment: value,
			validationErrors: ["minConfidence must be a finite number in [0, 1]"],
		});
	}
	if (query.limit !== undefined && (!Number.isSafeInteger(query.limit) || query.limit < 0)) {
		errors.push({
			code: "invalid-query",
			message: "memoryRetrievalBundle: query.limit must be a non-negative safe integer",
			fragment: value,
			validationErrors: ["limit must be a non-negative safe integer"],
		});
	}
	if (query.vector !== undefined && !isFiniteVector(query.vector)) {
		errors.push({
			code: "invalid-query-vector",
			message: "memoryRetrievalBundle: query.vector must be a finite number array",
			fragment: value,
			validationErrors: ["vector must be a finite number array"],
		});
	}
	if (errors.length > 0) return { ok: false, query: {}, errors };
	return { ok: true, query: snapshotQuery(query), errors };
}

function invalidQuery(value: unknown, message: string): MemoryRetrievalQueryValidation {
	return {
		ok: false,
		query: {},
		errors: [
			{
				code: "invalid-query",
				message,
				fragment: value,
			},
		],
	};
}

function snapshotQuery(query: Partial<MemoryRetrievalQuery>): MemoryRetrievalQuery {
	return Object.freeze({
		...(query.tags === undefined ? {} : { tags: Object.freeze([...query.tags]) }),
		...(query.asOf === undefined ? {} : { asOf: query.asOf }),
		...(query.minConfidence === undefined ? {} : { minConfidence: query.minConfidence }),
		...(query.limit === undefined ? {} : { limit: query.limit }),
		...(query.vector === undefined ? {} : { vector: Object.freeze([...query.vector]) }),
	});
}

export function safeArrayLength(value: readonly unknown[]): number | undefined {
	try {
		return value.length;
	} catch {
		return undefined;
	}
}

export function validateAndSnapshotFragment<T>(
	rawFragments: readonly unknown[],
	index: number,
): FragmentValidationResult<T> {
	let raw: unknown;
	try {
		raw = rawFragments[index];
		const validation = validateMemoryFragment(raw);
		if (!validation.ok) {
			return {
				error: {
					code: "invalid-fragment",
					message: "memoryRetrievalBundle: invalid memory fragment",
					index,
					fragment: raw,
					validationErrors: Object.freeze([...validation.errors]),
				},
			};
		}
		return { fragment: snapshotFragment(raw as MemoryFragment<T>) };
	} catch (error) {
		return {
			error: {
				code: "invalid-fragment",
				message: `memoryRetrievalBundle: fragment access failed: ${errorMessage(error)}`,
				index,
				fragment: raw,
				validationErrors: Object.freeze(["fragment access failed"]),
			},
		};
	}
}

function snapshotFragment<T>(fragment: MemoryFragment<T>): MemoryFragment<T> {
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

function isDenseArrayOf<T>(value: unknown, predicate: (item: unknown) => item is T): value is T[] {
	if (!Array.isArray(value)) return false;
	for (let i = 0; i < value.length; i += 1) {
		if (!Object.hasOwn(value, i) || !predicate(value[i])) return false;
	}
	return true;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
	return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isNonEmptyString(value: unknown): value is string {
	return typeof value === "string" && value.length > 0;
}

function errorMessage(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

function compareString(a: string, b: string): number {
	return a < b ? -1 : a > b ? 1 : 0;
}

function compareBigIntDesc(a: bigint, b: bigint): number {
	if (a === b) return 0;
	return a > b ? -1 : 1;
}
