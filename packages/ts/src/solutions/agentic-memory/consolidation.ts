import { depLatest } from "../../ctx/types.js";
import type { Graph } from "../../graph/graph.js";
import { compoundTupleKey } from "../../identity.js";
import type { FactId } from "../../patterns/semantic-memory.js";
import { solutionProjection } from "./projection.js";
import {
	agenticStatusState,
	errorMessage,
	freezeError,
	isDenseArrayOf,
	isNonEmptyString,
	isPlainRecord,
	safeArrayLength,
	validateAndProjectRecords,
	validateAndSnapshotRecord,
} from "./shared.js";
import type {
	AgenticMemoryConsolidationBundle,
	AgenticMemoryConsolidationBundleOptions,
	AgenticMemoryConsolidationCommand,
	AgenticMemoryConsolidationCursor,
	AgenticMemoryConsolidationError,
	AgenticMemoryConsolidationOutcome,
	AgenticMemoryConsolidationRecordDraft,
	AgenticMemoryConsolidationRequest,
	AgenticMemoryConsolidationResult,
	AgenticMemoryConsolidationSnapshot,
	AgenticMemoryConsolidationStatus,
	AgenticMemoryError,
	AgenticMemoryFactRef,
	AgenticMemoryRecord,
	AgenticMemoryRecordApplicationOperation,
	AgenticMemoryRecordCandidateMaterial,
	AgenticMemoryRecordProposal,
	AgenticMemoryRetentionError,
} from "./types.js";

const AGENTIC_MEMORY_RECORD_APPLICATION_OPERATION_VERSION = 1 as const;

/**
 * Creates an agentic memory consolidation bundle.
 *
 * @param graph - Graph that owns the created nodes or projector.
 * @param opts - Options that configure the helper.
 * @returns A bundle of graph-visible nodes for the recipe.
 * @category solutions
 * @example
 * ```ts
 * import { agenticMemoryConsolidationBundle } from "@graphrefly/ts/solutions/agentic-memory";
 * ```
 */
export function agenticMemoryConsolidationBundle<T = unknown>(
	graph: Graph,
	opts: AgenticMemoryConsolidationBundleOptions<T>,
): AgenticMemoryConsolidationBundle<T> {
	const name = opts.name ?? "agenticMemoryConsolidation";
	const projection = graph.node<AgenticMemoryConsolidationSnapshot<T>>(
		[opts.records, opts.requests, opts.outcomes],
		(ctx) => {
			const state =
				ctx.state.get<{ evaluation: number }>() ??
				({ evaluation: 0 } satisfies { evaluation: number });
			state.evaluation += 1;
			const recordProjection = validateAndProjectRecords<T>(depLatest(ctx, 0));
			const requests = validateConsolidationRequests(depLatest(ctx, 1), recordProjection.records);
			const outcomes = projectConsolidationOutcomes<T>(
				depLatest(ctx, 2),
				requests.requests,
				recordProjection.records,
				state.evaluation,
			);
			const cursor: AgenticMemoryConsolidationCursor = Object.freeze({
				evaluation: state.evaluation,
				validRequests: requests.requests.length,
				validOutcomes: outcomes.validOutcomes,
				invalidOutcomes: outcomes.invalidOutcomes,
				results: outcomes.results.length,
				proposedRecordDrafts: outcomes.proposedRecordDrafts.length,
				recordProposals: outcomes.recordProposals.length,
			});
			const errors = Object.freeze(
				[
					...recordProjection.errors.map(consolidationErrorFromRecordError),
					...requests.errors.map(consolidationErrorFromRetentionError),
					...outcomes.errors,
				].map((error) => freezeError({ ...error, cursor })),
			);
			const status: AgenticMemoryConsolidationStatus = Object.freeze({
				state: agenticStatusState(errors.length, outcomes.results.length),
				cursor,
			});
			ctx.state.set(state);
			ctx.down([
				[
					"DATA",
					Object.freeze({
						results: Object.freeze(outcomes.results),
						proposedRecordDrafts: Object.freeze(outcomes.proposedRecordDrafts),
						recordProposals: Object.freeze(outcomes.recordProposals),
						commands: Object.freeze(outcomes.commands),
						status,
						errors,
						cursor,
					}),
				],
			]);
		},
		{
			name: `${name}/projection`,
			factory: "agenticMemoryConsolidation",
			completeWhenDepsComplete: false,
			errorWhenDepsError: false,
		},
	);
	return {
		input: { records: opts.records, requests: opts.requests, outcomes: opts.outcomes },
		projection,
		results: solutionProjection(
			graph,
			projection,
			`${name}/results`,
			"agenticMemoryConsolidationResults",
			(fact) => fact.results,
		),
		proposedRecordDrafts: solutionProjection(
			graph,
			projection,
			`${name}/proposedRecordDrafts`,
			"agenticMemoryConsolidationRecordDrafts",
			(fact) => fact.proposedRecordDrafts,
		),
		recordProposals: solutionProjection(
			graph,
			projection,
			`${name}/recordProposals`,
			"agenticMemoryConsolidationRecordProposals",
			(fact) => fact.recordProposals,
		),
		commands: solutionProjection(
			graph,
			projection,
			`${name}/commands`,
			"agenticMemoryConsolidationCommands",
			(fact) => fact.commands,
		),
		status: solutionProjection(
			graph,
			projection,
			`${name}/status`,
			"agenticMemoryConsolidationStatus",
			(fact) => fact.status,
		),
		errors: solutionProjection(
			graph,
			projection,
			`${name}/errors`,
			"agenticMemoryConsolidationErrors",
			(fact) => fact.errors,
		),
		cursor: solutionProjection(
			graph,
			projection,
			`${name}/cursor`,
			"agenticMemoryConsolidationCursor",
			(fact) => fact.cursor,
		),
	};
}

/** D168 deterministic context-packing bundle over explicit context text facts. */

function validateConsolidationRequests<T>(
	value: unknown,
	records: readonly AgenticMemoryRecord<T>[],
): {
	readonly requests: readonly AgenticMemoryConsolidationRequest[];
	readonly errors: readonly Omit<AgenticMemoryRetentionError, "cursor">[];
} {
	const byId = new Map(records.map((record) => [record.id, record]));
	const requests: AgenticMemoryConsolidationRequest[] = [];
	const errors: Omit<AgenticMemoryRetentionError, "cursor">[] = [];
	if (!Array.isArray(value)) {
		return {
			requests,
			errors: [
				{
					code: "invalid-commands-input",
					message: "agenticMemoryConsolidationBundle: requests input must be an array",
					command: value,
				},
			],
		};
	}
	const length = safeArrayLength(value);
	if (length === undefined) {
		return {
			requests,
			errors: [
				{
					code: "invalid-commands-input",
					message: "agenticMemoryConsolidationBundle: requests input length could not be read",
					command: value,
				},
			],
		};
	}
	const seen = new Set<FactId>();
	for (let i = 0; i < length; i += 1) {
		let raw: unknown;
		try {
			if (!Object.hasOwn(value, i)) {
				throw new TypeError("request array must be dense");
			}
			raw = value[i];
		} catch (error) {
			errors.push({
				code: "invalid-command",
				message: `agenticMemoryConsolidationBundle: request access failed: ${errorMessage(error)}`,
				index: i,
				validationErrors: Object.freeze(["request access failed"]),
			});
			continue;
		}
		if (!isPlainRecord(raw)) {
			errors.push({
				code: "invalid-command",
				message: "agenticMemoryConsolidationBundle: request must be an object",
				index: i,
				command: raw,
			});
			continue;
		}
		const id = isNonEmptyString(raw.id) ? raw.id : undefined;
		const commandId = isNonEmptyString(raw.commandId) ? raw.commandId : undefined;
		const recordIds = isDenseArrayOf(raw.recordIds, isNonEmptyString)
			? Object.freeze([...raw.recordIds])
			: undefined;
		const validationErrors: string[] = [];
		if (id === undefined) validationErrors.push("request.id must be a non-empty string");
		if (commandId === undefined) {
			validationErrors.push("request.commandId must be a non-empty string");
		}
		if (recordIds === undefined || recordIds.length === 0) {
			validationErrors.push("request.recordIds must be a non-empty string array");
		}
		if (raw.reason !== undefined && typeof raw.reason !== "string") {
			validationErrors.push("request.reason must be a string when present");
		}
		if (id !== undefined && seen.has(id)) {
			validationErrors.push(`duplicate request id '${id}'`);
		}
		const missing = (recordIds ?? []).filter((recordId) => !byId.has(recordId));
		if (missing.length > 0) {
			errors.push({
				code: "missing-record-ref",
				message: "agenticMemoryConsolidationBundle: request references missing records",
				index: i,
				commandId,
				recordIds: Object.freeze(missing),
				command: raw,
				validationErrors: Object.freeze(
					missing.map((recordId) => `record '${recordId}' is not projected`),
				),
			});
			continue;
		}
		if (
			validationErrors.length > 0 ||
			id === undefined ||
			commandId === undefined ||
			recordIds === undefined
		) {
			errors.push({
				code: "invalid-command",
				message: "agenticMemoryConsolidationBundle: request is invalid",
				index: i,
				commandId,
				recordIds,
				command: raw,
				validationErrors: Object.freeze(validationErrors),
			});
			continue;
		}
		seen.add(id);
		requests.push(
			Object.freeze({
				id,
				commandId,
				recordIds,
				...(raw.reason === undefined ? {} : { reason: raw.reason as string }),
			}),
		);
	}
	return { requests: Object.freeze(requests), errors };
}

function projectConsolidationOutcomes<T>(
	value: unknown,
	requests: readonly AgenticMemoryConsolidationRequest[],
	records: readonly AgenticMemoryRecord<T>[],
	evaluation: number,
): {
	readonly results: readonly AgenticMemoryConsolidationResult[];
	readonly proposedRecordDrafts: readonly AgenticMemoryConsolidationRecordDraft<T>[];
	readonly recordProposals: readonly AgenticMemoryRecordProposal<T>[];
	readonly commands: readonly AgenticMemoryConsolidationCommand[];
	readonly errors: readonly Omit<AgenticMemoryConsolidationError, "cursor">[];
	readonly validOutcomes: number;
	readonly invalidOutcomes: number;
} {
	const byRequest = new Map(requests.map((request) => [request.id, request]));
	const recordsById = new Map(records.map((record) => [record.id, record]));
	const results: AgenticMemoryConsolidationResult[] = [];
	const proposedRecordDrafts: AgenticMemoryConsolidationRecordDraft<T>[] = [];
	const recordProposals: AgenticMemoryRecordProposal<T>[] = [];
	const commands: AgenticMemoryConsolidationCommand[] = [];
	const errors: Omit<AgenticMemoryConsolidationError, "cursor">[] = [];
	let validOutcomes = 0;
	let invalidOutcomes = 0;
	if (!Array.isArray(value)) {
		return {
			results,
			proposedRecordDrafts,
			recordProposals,
			commands,
			validOutcomes,
			invalidOutcomes: 1,
			errors: [
				{
					code: "invalid-outcomes-input",
					message: "agenticMemoryConsolidationBundle: outcomes input must be an array",
					outcome: value,
				},
			],
		};
	}
	const length = safeArrayLength(value);
	if (length === undefined) {
		return {
			results,
			proposedRecordDrafts,
			recordProposals,
			commands,
			validOutcomes,
			invalidOutcomes: 1,
			errors: [
				{
					code: "invalid-outcomes-input",
					message: "agenticMemoryConsolidationBundle: outcomes input length could not be read",
					outcome: value,
				},
			],
		};
	}
	const seenOutcomes = new Set<FactId>();
	for (let i = 0; i < length; i += 1) {
		let raw: unknown;
		let outcome: {
			readonly outcome?: AgenticMemoryConsolidationOutcome<T>;
			readonly error?: Omit<AgenticMemoryConsolidationError, "cursor">;
		};
		try {
			if (!Object.hasOwn(value, i)) {
				throw new TypeError("outcome array must be dense");
			}
			raw = value[i];
			outcome = validateConsolidationOutcome<T>(raw, i);
		} catch (error) {
			invalidOutcomes += 1;
			errors.push({
				code: "invalid-outcome",
				message: `agenticMemoryConsolidationBundle: outcome access failed: ${errorMessage(error)}`,
				index: i,
				outcome: raw,
				validationErrors: Object.freeze(["outcome access failed"]),
			});
			continue;
		}
		if (outcome.error !== undefined || outcome.outcome === undefined) {
			invalidOutcomes += 1;
			if (outcome.error !== undefined) errors.push(outcome.error);
			continue;
		}
		const validOutcome = outcome.outcome;
		if (seenOutcomes.has(validOutcome.id)) {
			invalidOutcomes += 1;
			errors.push({
				code: "duplicate-outcome-id",
				message: "agenticMemoryConsolidationBundle: duplicate outcome id",
				index: i,
				outcomeId: validOutcome.id,
				requestId: validOutcome.requestId,
				outcome: raw,
				validationErrors: Object.freeze([`duplicate outcome id '${validOutcome.id}'`]),
			});
			continue;
		}
		const request = byRequest.get(validOutcome.requestId);
		if (request === undefined) {
			invalidOutcomes += 1;
			errors.push({
				code: "missing-request-ref",
				message: "agenticMemoryConsolidationBundle: outcome references missing request",
				index: i,
				outcomeId: validOutcome.id,
				requestId: validOutcome.requestId,
				outcome: raw,
				validationErrors: Object.freeze([`request '${validOutcome.requestId}' is not projected`]),
			});
			continue;
		}
		seenOutcomes.add(validOutcome.id);
		if (validOutcome.kind === "failed") {
			validOutcomes += 1;
			const resultId = compoundTupleKey("agentic-memory-consolidation-result", [
				validOutcome.requestId,
				validOutcome.id,
			]);
			results.push(
				Object.freeze({
					id: resultId,
					requestId: validOutcome.requestId,
					outcomeId: validOutcome.id,
					state: "failed",
					sourceRecordIds: request.recordIds,
					proposedRecordIds: Object.freeze([]),
					message: validOutcome.message,
					...(validOutcome.provenance === undefined ? {} : { provenance: validOutcome.provenance }),
				}),
			);
			commands.push(
				Object.freeze({
					id: compoundTupleKey("agentic-memory-consolidation-command", [resultId, "markFailed"]),
					kind: "markFailed",
					requestId: validOutcome.requestId,
					outcomeId: validOutcome.id,
					message: validOutcome.message,
				}),
			);
			continue;
		}
		const operation = validOutcome.applicationOperation ?? "create";
		const operationVersion =
			validOutcome.operationVersion ?? AGENTIC_MEMORY_RECORD_APPLICATION_OPERATION_VERSION;
		const targetRecordIds = validOutcome.targetRecordIds;
		if (operation === "replace" || operation === "update") {
			const validationErrors: string[] = [];
			if (targetRecordIds === undefined || targetRecordIds.length !== validOutcome.records.length) {
				validationErrors.push(`${operation} outcome.targetRecordIds must align with records`);
			}
			for (let recordIndex = 0; recordIndex < validOutcome.records.length; recordIndex += 1) {
				const record = validOutcome.records[recordIndex] as AgenticMemoryRecord<T>;
				const targetRecordId = targetRecordIds?.[recordIndex];
				if (targetRecordId === undefined) continue;
				if (!request.recordIds.includes(targetRecordId)) {
					validationErrors.push(
						`targetRecordIds[${recordIndex}]: target record '${targetRecordId}' is not in the request`,
					);
				}
				if (!recordsById.has(targetRecordId)) {
					validationErrors.push(
						`targetRecordIds[${recordIndex}]: target record '${targetRecordId}' is not projected`,
					);
				}
				if (record.id !== targetRecordId) {
					validationErrors.push(
						`records[${recordIndex}]: ${operation} record id '${record.id}' must equal target record id '${targetRecordId}'`,
					);
				}
			}
			if (validationErrors.length > 0) {
				invalidOutcomes += 1;
				errors.push({
					code: "invalid-proposed-record",
					message: `agenticMemoryConsolidationBundle: ${operation} outcome is invalid`,
					index: i,
					outcomeId: validOutcome.id,
					requestId: validOutcome.requestId,
					outcome: raw,
					validationErrors: Object.freeze(validationErrors),
				});
				continue;
			}
		}
		validOutcomes += 1;
		const draftIds = validOutcome.records.map((record) =>
			compoundTupleKey("agentic-memory-record-draft", [
				validOutcome.requestId,
				validOutcome.id,
				record.id,
			]),
		);
		const proposalIds = validOutcome.records.map((record) =>
			compoundTupleKey("agentic-memory-record-proposal", [
				validOutcome.requestId,
				validOutcome.id,
				record.id,
			]),
		);
		for (let recordIndex = 0; recordIndex < validOutcome.records.length; recordIndex += 1) {
			const record = validOutcome.records[recordIndex] as AgenticMemoryRecord<T>;
			const draftId = draftIds[recordIndex] as FactId;
			const proposalId = proposalIds[recordIndex] as FactId;
			const targetRecordId = targetRecordIds?.[recordIndex];
			const targetRecord =
				targetRecordId === undefined ? undefined : recordsById.get(targetRecordId);
			const refs = consolidationProposalRefs(request, validOutcome.id, draftId, targetRecord);
			const candidateMaterial: AgenticMemoryRecordCandidateMaterial<T> = Object.freeze({
				kind: "agentic-memory-record-candidate-material",
				operation,
				operationVersion,
				record,
				...(targetRecordId === undefined ? {} : { targetRecordId }),
				sourceRefs: refs,
				evidenceRefs: refs,
			});
			proposedRecordDrafts.push(
				Object.freeze({
					id: draftId,
					requestId: validOutcome.requestId,
					outcomeId: validOutcome.id,
					record,
					applicationOperation: operation,
					operationVersion,
					...(targetRecordId === undefined ? {} : { targetRecordId }),
					proposalId,
					candidateMaterial,
				}),
			);
			recordProposals.push(
				Object.freeze({
					kind: "agentic-memory-record-proposal",
					proposalId,
					operation,
					operationVersion,
					candidateMaterial,
					...(targetRecordId === undefined ? {} : { targetRecordId }),
					reason: request.reason ?? validOutcome.provenance ?? "consolidation",
					proposalStatus: "consolidation-proposed",
					sourceRefs: refs,
					evidenceRefs: refs,
					idempotencyKey: proposalId,
					correlationId: request.id,
					causationId: validOutcome.id,
				}),
			);
		}
		const resultId = compoundTupleKey("agentic-memory-consolidation-result", [
			validOutcome.requestId,
			validOutcome.id,
		]);
		results.push(
			Object.freeze({
				id: resultId,
				requestId: validOutcome.requestId,
				outcomeId: validOutcome.id,
				state: "proposed",
				sourceRecordIds: request.recordIds,
				proposedRecordIds: Object.freeze(validOutcome.records.map((record) => record.id)),
				applicationOperation: operation,
				...(targetRecordIds === undefined ? {} : { targetRecordIds }),
				proposalIds: Object.freeze(proposalIds),
				...(validOutcome.provenance === undefined ? {} : { provenance: validOutcome.provenance }),
			}),
		);
		commands.push(
			Object.freeze({
				id: compoundTupleKey("agentic-memory-consolidation-command", [resultId, "proposeRecords"]),
				kind: "proposeRecords",
				requestId: validOutcome.requestId,
				outcomeId: validOutcome.id,
				draftIds: Object.freeze(draftIds),
				proposalIds: Object.freeze(proposalIds),
			}),
		);
	}
	void evaluation;
	return {
		results: Object.freeze(results),
		proposedRecordDrafts: Object.freeze(proposedRecordDrafts),
		recordProposals: Object.freeze(recordProposals),
		commands: Object.freeze(commands),
		errors,
		validOutcomes,
		invalidOutcomes,
	};
}

function consolidationProposalRefs(
	request: AgenticMemoryConsolidationRequest,
	outcomeId: FactId,
	draftId: FactId,
	targetRecord?: AgenticMemoryRecord<unknown>,
): readonly AgenticMemoryFactRef[] {
	return Object.freeze([
		Object.freeze({ kind: "agentic-memory-consolidation-request", id: request.id }),
		Object.freeze({ kind: "agentic-memory-consolidation-outcome", id: outcomeId }),
		Object.freeze({ kind: "agentic-memory-consolidation-record-draft", id: draftId }),
		...(targetRecord === undefined
			? []
			: [
					Object.freeze({ kind: "agentic-memory-record", id: targetRecord.id }),
					Object.freeze({ kind: "agentic-memory-fragment", id: targetRecord.fragment.id }),
				]),
	]);
}

function validateConsolidationOutcome<T>(
	value: unknown,
	index: number,
): {
	readonly outcome?: AgenticMemoryConsolidationOutcome<T>;
	readonly error?: Omit<AgenticMemoryConsolidationError, "cursor">;
} {
	if (!isPlainRecord(value)) {
		return {
			error: {
				code: "invalid-outcome",
				message: "agenticMemoryConsolidationBundle: outcome must be an object",
				index,
				outcome: value,
			},
		};
	}
	const errors: string[] = [];
	const id = isNonEmptyString(value.id) ? value.id : undefined;
	const requestId = isNonEmptyString(value.requestId) ? value.requestId : undefined;
	if (id === undefined) errors.push("outcome.id must be a non-empty string");
	if (requestId === undefined) errors.push("outcome.requestId must be a non-empty string");
	if (value.kind !== "proposedRecords" && value.kind !== "failed") {
		errors.push("outcome.kind must be proposedRecords or failed");
	}
	if (value.provenance !== undefined && typeof value.provenance !== "string") {
		errors.push("outcome.provenance must be a string when present");
	}
	if (
		value.applicationOperation !== undefined &&
		value.applicationOperation !== "create" &&
		value.applicationOperation !== "replace" &&
		value.applicationOperation !== "update"
	) {
		errors.push("outcome.applicationOperation must be create, replace, or update when present");
	}
	if (
		value.operationVersion !== undefined &&
		value.operationVersion !== AGENTIC_MEMORY_RECORD_APPLICATION_OPERATION_VERSION
	) {
		errors.push("outcome.operationVersion must be 1 when present");
	}
	if (value.kind === "failed" && !isNonEmptyString(value.message)) {
		errors.push("failed outcome.message must be a non-empty string");
	}
	const records: AgenticMemoryRecord<T>[] = [];
	let targetRecordIds: readonly FactId[] | undefined;
	if (value.kind === "proposedRecords") {
		if (value.targetRecordIds !== undefined) {
			if (!isDenseArrayOf(value.targetRecordIds, isNonEmptyString)) {
				errors.push("proposedRecords.targetRecordIds must be a dense non-empty string array");
			} else {
				targetRecordIds = Object.freeze([...value.targetRecordIds]);
			}
		}
		if (!Array.isArray(value.records)) {
			errors.push("proposedRecords.records must be a non-empty array");
		} else {
			const recordsLength = safeArrayLength(value.records);
			const seenRecordIds = new Set<FactId>();
			if (recordsLength === undefined || recordsLength === 0) {
				errors.push("proposedRecords.records must be a non-empty array");
			}
			for (let i = 0; i < (recordsLength ?? 0); i += 1) {
				let result: {
					readonly record?: AgenticMemoryRecord<T>;
					readonly errors: Omit<AgenticMemoryError, "cursor">[];
				};
				try {
					if (!Object.hasOwn(value.records, i)) {
						throw new TypeError("proposedRecords.records must be dense");
					}
					result = validateAndSnapshotRecord<T>(value.records[i], i);
				} catch (error) {
					errors.push(`records[${i}]: record access failed: ${errorMessage(error)}`);
					continue;
				}
				if (result.record === undefined || result.errors.length > 0) {
					errors.push(
						...result.errors
							.flatMap((error) => error.validationErrors ?? [error.message])
							.map((error) => `records[${i}]: ${error}`),
					);
				} else if (seenRecordIds.has(result.record.id)) {
					errors.push(`records[${i}]: duplicate proposed record id '${result.record.id}'`);
				} else {
					seenRecordIds.add(result.record.id);
					records.push(result.record);
				}
			}
		}
	}
	if (errors.length > 0 || id === undefined || requestId === undefined) {
		return {
			error: {
				code: value.kind === "proposedRecords" ? "invalid-proposed-record" : "invalid-outcome",
				message: "agenticMemoryConsolidationBundle: outcome is invalid",
				index,
				outcomeId: id,
				requestId,
				outcome: value,
				validationErrors: Object.freeze(errors),
			},
		};
	}
	if (value.kind === "failed") {
		return {
			outcome: Object.freeze({
				id,
				requestId,
				kind: "failed",
				message: value.message as string,
				...(value.provenance === undefined ? {} : { provenance: value.provenance as string }),
			}),
		};
	}
	return {
		outcome: Object.freeze({
			id,
			requestId,
			kind: "proposedRecords",
			...(value.applicationOperation === undefined
				? {}
				: {
						applicationOperation:
							value.applicationOperation as AgenticMemoryRecordApplicationOperation,
					}),
			...(value.operationVersion === undefined
				? {}
				: { operationVersion: value.operationVersion as 1 }),
			records: Object.freeze(records),
			...(targetRecordIds === undefined ? {} : { targetRecordIds }),
			...(value.provenance === undefined ? {} : { provenance: value.provenance as string }),
		}),
	};
}

function consolidationErrorFromRecordError(
	error: Omit<AgenticMemoryError, "cursor">,
): Omit<AgenticMemoryConsolidationError, "cursor"> {
	return {
		...error,
		code: error.code,
	};
}

function consolidationErrorFromRetentionError(
	error: Omit<AgenticMemoryRetentionError, "cursor">,
): Omit<AgenticMemoryConsolidationError, "cursor"> {
	return {
		...error,
		code: error.code,
	};
}
