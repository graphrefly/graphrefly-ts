import { depLatest } from "../../ctx/types.js";
import type { Graph } from "../../graph/graph.js";
import type {
	FactId,
	KnowledgeAssertion,
	KnowledgeAssertionObject,
	KnowledgeAssertionSubject,
} from "../../patterns/semantic-memory.js";
import { solutionProjection } from "./projection.js";
import {
	agenticStatusState,
	assertStrictJsonValue,
	errorMessage,
	freezeError,
	isDenseArrayOf,
	isNonEmptyString,
	isPlainRecord,
	safeArrayLength,
	validateAndProjectRecords,
} from "./shared.js";
import type {
	AgenticMemoryError,
	AgenticMemoryKgAssertionDraft,
	AgenticMemoryKgProjectionBundle,
	AgenticMemoryKgProjectionBundleOptions,
	AgenticMemoryKgProjectionCursor,
	AgenticMemoryKgProjectionError,
	AgenticMemoryKgProjectionSnapshot,
	AgenticMemoryKgProjectionStatus,
	AgenticMemoryRecord,
	StrictJsonValue,
} from "./types.js";

/**
 * Creates an agentic memory kg projection bundle.
 *
 * @param graph - Graph that owns the created nodes or projector.
 * @param opts - Options that configure the helper.
 * @returns A bundle of graph-visible nodes for the recipe.
 * @category solutions
 * @example
 * ```ts
 * import { agenticMemoryKgProjectionBundle } from "@graphrefly/ts/solutions/agentic-memory";
 * ```
 */
export function agenticMemoryKgProjectionBundle(
	graph: Graph,
	opts: AgenticMemoryKgProjectionBundleOptions,
): AgenticMemoryKgProjectionBundle {
	const name = opts.name ?? "agenticMemoryKgProjection";
	const projection = graph.node<AgenticMemoryKgProjectionSnapshot>(
		[opts.records, opts.drafts],
		(ctx) => {
			const state =
				ctx.state.get<{ evaluation: number }>() ??
				({ evaluation: 0 } satisfies { evaluation: number });
			state.evaluation += 1;
			const recordProjection = validateAndProjectRecords(depLatest(ctx, 0));
			const draftProjection = validateAndProjectKgDrafts(
				depLatest(ctx, 1),
				recordProjection.records,
			);
			const cursor: AgenticMemoryKgProjectionCursor = Object.freeze({
				evaluation: state.evaluation,
				validRecords: recordProjection.records.length,
				validDrafts: draftProjection.assertions.length,
				invalidDrafts: draftProjection.invalidDrafts,
				projectedAssertions: draftProjection.assertions.length,
			});
			const errors = Object.freeze(
				[...recordProjection.errors.map(kgErrorFromRecordError), ...draftProjection.errors].map(
					(error) => freezeError({ ...error, cursor }),
				),
			);
			const status: AgenticMemoryKgProjectionStatus = Object.freeze({
				state: agenticStatusState(errors.length, draftProjection.assertions.length),
				cursor,
			});
			ctx.state.set(state);
			ctx.down([
				[
					"DATA",
					Object.freeze({
						assertions: Object.freeze(draftProjection.assertions),
						status,
						errors,
						cursor,
					}),
				],
			]);
		},
		{
			name: `${name}/projection`,
			factory: "agenticMemoryKgProjection",
			completeWhenDepsComplete: false,
			errorWhenDepsError: false,
		},
	);
	return {
		input: { records: opts.records, drafts: opts.drafts },
		projection,
		assertions: solutionProjection(
			graph,
			projection,
			`${name}/assertions`,
			"agenticMemoryKgAssertions",
			(fact) => fact.assertions,
		),
		status: solutionProjection(
			graph,
			projection,
			`${name}/status`,
			"agenticMemoryKgStatus",
			(fact) => fact.status,
		),
		errors: solutionProjection(
			graph,
			projection,
			`${name}/errors`,
			"agenticMemoryKgErrors",
			(fact) => fact.errors,
		),
		cursor: solutionProjection(
			graph,
			projection,
			`${name}/cursor`,
			"agenticMemoryKgCursor",
			(fact) => fact.cursor,
		),
	};
}

/** Build a D166 strict-JSON frame from an in-memory AgenticMemoryRecord. */

function validateAndProjectKgDrafts(
	value: unknown,
	records: readonly AgenticMemoryRecord[],
): {
	readonly assertions: KnowledgeAssertion[];
	readonly errors: Omit<AgenticMemoryKgProjectionError, "cursor">[];
	readonly invalidDrafts: number;
} {
	const assertions: KnowledgeAssertion[] = [];
	const errors: Omit<AgenticMemoryKgProjectionError, "cursor">[] = [];
	let invalidDrafts = 0;
	if (!Array.isArray(value)) {
		return {
			assertions,
			invalidDrafts: 1,
			errors: [
				{
					code: "invalid-drafts-input",
					message: "agenticMemoryKgProjectionBundle: drafts input must be an array",
					draft: value,
				},
			],
		};
	}
	const length = safeArrayLength(value);
	if (length === undefined) {
		return {
			assertions,
			invalidDrafts: 1,
			errors: [
				{
					code: "invalid-drafts-input",
					message: "agenticMemoryKgProjectionBundle: drafts input length could not be read",
					draft: value,
				},
			],
		};
	}
	const recordById = new Map(records.map((record) => [record.id, record]));
	const fragmentToRecord = new Map(records.map((record) => [record.fragment.id, record.id]));
	const seenAssertions = new Set<FactId>();
	for (let i = 0; i < length; i += 1) {
		let raw: unknown;
		try {
			raw = value[i];
			const result = validateKgDraft(raw, i);
			if (result.errors.length > 0 || result.draft === undefined) {
				invalidDrafts += 1;
				errors.push(...result.errors);
				continue;
			}
			const draft = result.draft;
			if (seenAssertions.has(draft.id)) {
				invalidDrafts += 1;
				errors.push({
					code: "duplicate-assertion-id",
					message: "agenticMemoryKgProjectionBundle: duplicate assertion id",
					index: i,
					assertionId: draft.id,
					recordId: draft.recordId,
					fragmentId: draft.fragmentId,
					draft: raw,
					validationErrors: [`duplicate assertion id '${draft.id}'`],
				});
				continue;
			}
			const record = recordById.get(draft.recordId);
			if (record === undefined) {
				invalidDrafts += 1;
				errors.push({
					code: "missing-record-ref",
					message: "agenticMemoryKgProjectionBundle: draft references a missing record",
					index: i,
					assertionId: draft.id,
					recordId: draft.recordId,
					fragmentId: draft.fragmentId,
					draft: raw,
					validationErrors: [`record '${draft.recordId}' is not projected`],
				});
				continue;
			}
			const owner = fragmentToRecord.get(draft.fragmentId);
			if (owner === undefined) {
				invalidDrafts += 1;
				errors.push({
					code: "missing-fragment-ref",
					message: "agenticMemoryKgProjectionBundle: draft references a missing fragment",
					index: i,
					assertionId: draft.id,
					recordId: draft.recordId,
					fragmentId: draft.fragmentId,
					draft: raw,
					validationErrors: [`fragment '${draft.fragmentId}' is not projected`],
				});
				continue;
			}
			if (owner !== draft.recordId || record.fragment.id !== draft.fragmentId) {
				invalidDrafts += 1;
				errors.push({
					code: "fragment-record-mismatch",
					message: "agenticMemoryKgProjectionBundle: draft record and fragment refs disagree",
					index: i,
					assertionId: draft.id,
					recordId: draft.recordId,
					fragmentId: draft.fragmentId,
					draft: raw,
					validationErrors: [
						`fragment '${draft.fragmentId}' belongs to record '${owner}', not '${draft.recordId}'`,
					],
				});
				continue;
			}
			seenAssertions.add(draft.id);
			assertions.push(
				Object.freeze({
					id: draft.id,
					recordId: draft.recordId,
					fragmentId: draft.fragmentId,
					subject: draft.subject,
					predicate: draft.predicate,
					object: draft.object,
					...(draft.confidence === undefined ? {} : { confidence: draft.confidence }),
					sources: Object.freeze(draft.sources ?? [draft.fragmentId]),
					...(draft.provenance === undefined ? {} : { provenance: draft.provenance }),
				}),
			);
		} catch (error) {
			invalidDrafts += 1;
			errors.push({
				code: "invalid-draft",
				message: `agenticMemoryKgProjectionBundle: draft access failed: ${errorMessage(error)}`,
				index: i,
				draft: raw,
				validationErrors: ["draft access failed"],
			});
		}
	}
	return { assertions, errors, invalidDrafts };
}

function validateKgDraft(
	value: unknown,
	index: number,
): {
	readonly draft?: AgenticMemoryKgAssertionDraft;
	readonly errors: Omit<AgenticMemoryKgProjectionError, "cursor">[];
} {
	const errors: Omit<AgenticMemoryKgProjectionError, "cursor">[] = [];
	if (!isPlainRecord(value)) {
		return {
			errors: [
				{
					code: "invalid-draft",
					message: "agenticMemoryKgProjectionBundle: draft must be an object",
					index,
					draft: value,
				},
			],
		};
	}
	const raw = value as Partial<AgenticMemoryKgAssertionDraft>;
	const id = typeof raw.id === "string" && raw.id.length > 0 ? raw.id : undefined;
	const recordId =
		typeof raw.recordId === "string" && raw.recordId.length > 0 ? raw.recordId : undefined;
	const fragmentId =
		typeof raw.fragmentId === "string" && raw.fragmentId.length > 0 ? raw.fragmentId : undefined;
	const subject = validateAssertionSubject(raw.subject);
	const object = validateAssertionObject(raw.object);
	const shapeErrors: string[] = [];
	if (id === undefined) shapeErrors.push("draft.id must be a non-empty string");
	if (recordId === undefined) {
		shapeErrors.push("draft.recordId must be a non-empty string");
	}
	if (fragmentId === undefined) {
		shapeErrors.push("draft.fragmentId must be a non-empty string");
	}
	shapeErrors.push(...subject.errors);
	if (typeof raw.predicate !== "string" || raw.predicate.length === 0) {
		shapeErrors.push("draft.predicate must be a non-empty string");
	}
	shapeErrors.push(...object.errors);
	if (
		raw.confidence !== undefined &&
		(!Number.isFinite(raw.confidence) || raw.confidence < 0 || raw.confidence > 1)
	) {
		shapeErrors.push("draft.confidence must be a finite number in [0, 1]");
	}
	if (raw.sources !== undefined && !isDenseArrayOf(raw.sources, isNonEmptyString)) {
		shapeErrors.push("draft.sources must be a readonly string array");
	}
	if (raw.provenance !== undefined && typeof raw.provenance !== "string") {
		shapeErrors.push("draft.provenance must be a string when present");
	}
	if (shapeErrors.length > 0) errors.push(kgShapeError(index, value, ...shapeErrors));
	if (errors.length > 0 || id === undefined || recordId === undefined || fragmentId === undefined) {
		return { errors };
	}
	return {
		draft: Object.freeze({
			id,
			recordId,
			fragmentId,
			subject: subject.subject as KnowledgeAssertionSubject,
			predicate: raw.predicate as string,
			object: object.object as KnowledgeAssertionObject,
			...(raw.confidence === undefined ? {} : { confidence: raw.confidence }),
			...(raw.sources === undefined ? {} : { sources: Object.freeze([...raw.sources]) }),
			...(raw.provenance === undefined ? {} : { provenance: raw.provenance }),
		}),
		errors,
	};
}

function validateAssertionSubject(value: unknown): {
	readonly subject?: KnowledgeAssertionSubject;
	readonly errors: readonly string[];
} {
	if (!isPlainRecord(value)) return { errors: ["subject must be an object"] };
	const id = value.id;
	const type = value.type;
	const errors: string[] = [];
	if (typeof id !== "string" || id.length === 0) errors.push("subject.id must be non-empty");
	if (type !== undefined && (typeof type !== "string" || type.length === 0)) {
		errors.push("subject.type must be a non-empty string when present");
	}
	if (errors.length > 0) return { errors };
	return {
		subject: Object.freeze({
			id: id as string,
			...(type === undefined ? {} : { type: type as string }),
		}),
		errors,
	};
}

function validateAssertionObject(value: unknown): {
	readonly object?: KnowledgeAssertionObject;
	readonly errors: readonly string[];
} {
	if (!isPlainRecord(value)) return { errors: ["object must be an object"] };
	const kind = value.kind;
	const errors: string[] = [];
	if (kind === "entity") {
		if (typeof value.id !== "string" || value.id.length === 0) {
			errors.push("object.id must be non-empty for entity objects");
		}
		if (value.type !== undefined && (typeof value.type !== "string" || value.type.length === 0)) {
			errors.push("object.type must be a non-empty string when present");
		}
		if (Object.hasOwn(value, "value")) errors.push("entity object must not include value");
		if (errors.length > 0) return { errors };
		return {
			object: Object.freeze({
				kind: "entity",
				id: value.id as string,
				...(value.type === undefined ? {} : { type: value.type as string }),
			}),
			errors,
		};
	}
	if (kind === "value") {
		if (!Object.hasOwn(value, "value")) errors.push("value object must include value");
		else {
			try {
				assertStrictJsonValue(value.value, "object.value");
			} catch (error) {
				errors.push(errorMessage(error));
			}
		}
		if (
			value.valueType !== undefined &&
			(typeof value.valueType !== "string" || value.valueType.length === 0)
		) {
			errors.push("object.valueType must be a non-empty string when present");
		}
		if (Object.hasOwn(value, "id")) errors.push("value object must not include id");
		if (errors.length > 0) return { errors };
		return {
			object: Object.freeze({
				kind: "value",
				value: value.value as StrictJsonValue,
				...(value.valueType === undefined ? {} : { valueType: value.valueType as string }),
			}),
			errors,
		};
	}
	return { errors: ["object.kind must be entity or value"] };
}

function kgShapeError(
	index: number,
	draft: unknown,
	...validationErrors: readonly string[]
): Omit<AgenticMemoryKgProjectionError, "cursor"> {
	return {
		code: "invalid-assertion-shape",
		message: "agenticMemoryKgProjectionBundle: draft assertion shape is invalid",
		index,
		draft,
		validationErrors: Object.freeze([...validationErrors]),
	};
}

function kgErrorFromRecordError(
	error: Omit<AgenticMemoryError, "cursor">,
): Omit<AgenticMemoryKgProjectionError, "cursor"> {
	return {
		...error,
		code: error.code,
	};
}
