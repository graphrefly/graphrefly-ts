import { depLatest } from "../../ctx/types.js";
import type { Graph } from "../../graph/graph.js";
import type { FactId } from "../../patterns/semantic-memory.js";
import { solutionProjection } from "./projection.js";
import {
	agenticStatusState,
	errorMessage,
	freezeError,
	isAgenticMemoryPersistenceLevel,
	isDenseArrayOf,
	isNonEmptyString,
	isPlainRecord,
	safeArrayLength,
	validateAndProjectRecords,
} from "./shared.js";
import type {
	AgenticMemoryConsolidationRequest,
	AgenticMemoryError,
	AgenticMemoryPersistenceLevel,
	AgenticMemoryRecord,
	AgenticMemoryRetentionBundle,
	AgenticMemoryRetentionBundleOptions,
	AgenticMemoryRetentionCommand,
	AgenticMemoryRetentionCursor,
	AgenticMemoryRetentionError,
	AgenticMemoryRetentionSnapshot,
	AgenticMemoryRetentionStatus,
} from "./types.js";

/**
 * Creates an agentic memory retention bundle.
 *
 * @param graph - Graph that owns the created nodes or projector.
 * @param opts - Options that configure the helper.
 * @returns A bundle of graph-visible nodes for the recipe.
 * @category solutions
 * @example
 * ```ts
 * import { agenticMemoryRetentionBundle } from "@graphrefly/ts/solutions/agentic-memory";
 * ```
 */
export function agenticMemoryRetentionBundle<T = unknown>(
	graph: Graph,
	opts: AgenticMemoryRetentionBundleOptions<T>,
): AgenticMemoryRetentionBundle<T> {
	const name = opts.name ?? "agenticMemoryRetention";
	const projection = graph.node<AgenticMemoryRetentionSnapshot<T>>(
		[opts.records, opts.commands],
		(ctx) => {
			const state =
				ctx.state.get<{ evaluation: number }>() ??
				({ evaluation: 0 } satisfies { evaluation: number });
			state.evaluation += 1;
			const recordProjection = validateAndProjectRecords<T>(depLatest(ctx, 0));
			const retention = projectRetention<T>(depLatest(ctx, 1), recordProjection.records);
			const cursor: AgenticMemoryRetentionCursor = Object.freeze({
				evaluation: state.evaluation,
				validRecords: recordProjection.records.length,
				validCommands: retention.validCommands,
				invalidCommands: retention.invalidCommands,
				activeRecords: retention.activeRecords.length,
				archivedRecords: retention.archivedRecords.length,
				consolidationRequests: retention.consolidationRequests.length,
			});
			const errors = Object.freeze(
				[...recordProjection.errors.map(retentionErrorFromRecordError), ...retention.errors].map(
					(error) => freezeError({ ...error, cursor }),
				),
			);
			const status: AgenticMemoryRetentionStatus = Object.freeze({
				state: agenticStatusState(errors.length, recordProjection.records.length),
				cursor,
			});
			ctx.state.set(state);
			ctx.down([
				[
					"DATA",
					Object.freeze({
						activeRecords: Object.freeze(retention.activeRecords),
						archivedRecords: Object.freeze(retention.archivedRecords),
						consolidationRequests: Object.freeze(retention.consolidationRequests),
						status,
						errors,
						cursor,
					}),
				],
			]);
		},
		{
			name: `${name}/projection`,
			factory: "agenticMemoryRetention",
			completeWhenDepsComplete: false,
			errorWhenDepsError: false,
		},
	);
	return {
		input: { records: opts.records, commands: opts.commands },
		projection,
		activeRecords: solutionProjection(
			graph,
			projection,
			`${name}/activeRecords`,
			"agenticMemoryRetentionActiveRecords",
			(fact) => fact.activeRecords,
		),
		archivedRecords: solutionProjection(
			graph,
			projection,
			`${name}/archivedRecords`,
			"agenticMemoryRetentionArchivedRecords",
			(fact) => fact.archivedRecords,
		),
		consolidationRequests: solutionProjection(
			graph,
			projection,
			`${name}/consolidationRequests`,
			"agenticMemoryRetentionConsolidationRequests",
			(fact) => fact.consolidationRequests,
		),
		status: solutionProjection(
			graph,
			projection,
			`${name}/status`,
			"agenticMemoryRetentionStatus",
			(fact) => fact.status,
		),
		errors: solutionProjection(
			graph,
			projection,
			`${name}/errors`,
			"agenticMemoryRetentionErrors",
			(fact) => fact.errors,
		),
		cursor: solutionProjection(
			graph,
			projection,
			`${name}/cursor`,
			"agenticMemoryRetentionCursor",
			(fact) => fact.cursor,
		),
	};
}

/**
 * D171 consolidation outcome projection.
 *
 * The bundle does not execute consolidation. External adapters may publish
 * outcome facts, and this projection turns them into visible result/proposal
 * facts for downstream record-creation policy.
 */

function projectRetention<T>(
	value: unknown,
	records: readonly AgenticMemoryRecord<T>[],
): {
	readonly activeRecords: AgenticMemoryRecord<T>[];
	readonly archivedRecords: AgenticMemoryRecord<T>[];
	readonly consolidationRequests: AgenticMemoryConsolidationRequest[];
	readonly errors: Omit<AgenticMemoryRetentionError, "cursor">[];
	readonly validCommands: number;
	readonly invalidCommands: number;
} {
	const byId = new Map(records.map((record) => [record.id, record]));
	const view = new Map(records.map((record) => [record.id, record]));
	const requests: AgenticMemoryConsolidationRequest[] = [];
	const errors: Omit<AgenticMemoryRetentionError, "cursor">[] = [];
	let validCommands = 0;
	let invalidCommands = 0;
	if (!Array.isArray(value)) {
		return {
			activeRecords: records.filter((record) => record.persistenceLevel !== "archived"),
			archivedRecords: records.filter((record) => record.persistenceLevel === "archived"),
			consolidationRequests: requests,
			validCommands,
			invalidCommands: 1,
			errors: [
				{
					code: "invalid-commands-input",
					message: "agenticMemoryRetentionBundle: commands input must be an array",
					command: value,
				},
			],
		};
	}
	const length = safeArrayLength(value);
	if (length === undefined) {
		return {
			activeRecords: records.filter((record) => record.persistenceLevel !== "archived"),
			archivedRecords: records.filter((record) => record.persistenceLevel === "archived"),
			consolidationRequests: requests,
			validCommands,
			invalidCommands: 1,
			errors: [
				{
					code: "invalid-commands-input",
					message: "agenticMemoryRetentionBundle: commands input length could not be read",
					command: value,
				},
			],
		};
	}
	const seenCommands = new Set<FactId>();
	for (let i = 0; i < length; i += 1) {
		let raw: unknown;
		try {
			raw = value[i];
			const result = validateRetentionCommand(raw, i);
			if (result.errors.length > 0 || result.command === undefined) {
				invalidCommands += 1;
				errors.push(...result.errors);
				continue;
			}
			const command = result.command;
			if (seenCommands.has(command.id)) {
				invalidCommands += 1;
				errors.push({
					code: "duplicate-command-id",
					message: "agenticMemoryRetentionBundle: duplicate command id",
					index: i,
					commandId: command.id,
					command: raw,
					validationErrors: [`duplicate command id '${command.id}'`],
				});
				continue;
			}
			const missing = retentionMissingRecords(command, byId);
			if (missing.length > 0) {
				invalidCommands += 1;
				errors.push({
					code: "missing-record-ref",
					message: "agenticMemoryRetentionBundle: command references missing records",
					index: i,
					commandId: command.id,
					recordId: "recordId" in command ? command.recordId : undefined,
					recordIds: Object.freeze(missing),
					command: raw,
					validationErrors: Object.freeze(missing.map((id) => `record '${id}' is not projected`)),
				});
				continue;
			}
			seenCommands.add(command.id);
			validCommands += 1;
			applyRetentionCommand(command, byId, view, requests);
		} catch (error) {
			invalidCommands += 1;
			errors.push({
				code: "invalid-command",
				message: `agenticMemoryRetentionBundle: command access failed: ${errorMessage(error)}`,
				index: i,
				command: raw,
				validationErrors: ["command access failed"],
			});
		}
	}
	const projected = records.map((record) => view.get(record.id) ?? record);
	return {
		activeRecords: projected.filter((record) => record.persistenceLevel !== "archived"),
		archivedRecords: projected.filter((record) => record.persistenceLevel === "archived"),
		consolidationRequests: requests,
		errors,
		validCommands,
		invalidCommands,
	};
}

function validateRetentionCommand(
	value: unknown,
	index: number,
): {
	readonly command?: AgenticMemoryRetentionCommand;
	readonly errors: Omit<AgenticMemoryRetentionError, "cursor">[];
} {
	if (!isPlainRecord(value)) {
		return {
			errors: [
				{
					code: "invalid-command",
					message: "agenticMemoryRetentionBundle: command must be an object",
					index,
					command: value,
				},
			],
		};
	}
	const id = typeof value.id === "string" && value.id.length > 0 ? value.id : undefined;
	const kind = value.kind;
	const errors: string[] = [];
	if (id === undefined) errors.push("command.id must be a non-empty string");
	if (
		kind !== "archive" &&
		kind !== "restore" &&
		kind !== "setPersistenceLevel" &&
		kind !== "requestConsolidation"
	) {
		errors.push("command.kind is invalid");
	}
	if (value.reason !== undefined && typeof value.reason !== "string") {
		errors.push("command.reason must be a string when present");
	}
	if (kind === "archive") {
		if (!isNonEmptyString(value.recordId)) errors.push("command.recordId must be non-empty");
	} else if (kind === "restore") {
		if (!isNonEmptyString(value.recordId)) errors.push("command.recordId must be non-empty");
		if (
			value.persistenceLevel !== undefined &&
			(!isAgenticMemoryPersistenceLevel(value.persistenceLevel) ||
				value.persistenceLevel === "archived")
		) {
			errors.push("restore.persistenceLevel must be a non-archived persistence level when present");
		}
	} else if (kind === "setPersistenceLevel") {
		if (!isNonEmptyString(value.recordId)) errors.push("command.recordId must be non-empty");
		if (!isAgenticMemoryPersistenceLevel(value.persistenceLevel)) {
			errors.push("setPersistenceLevel.persistenceLevel is invalid");
		}
	} else if (kind === "requestConsolidation") {
		if (!isDenseArrayOf(value.recordIds, isNonEmptyString) || value.recordIds.length === 0) {
			errors.push("requestConsolidation.recordIds must be a non-empty string array");
		}
		if (
			value.requestId !== undefined &&
			(typeof value.requestId !== "string" || value.requestId.length === 0)
		) {
			errors.push("requestConsolidation.requestId must be non-empty when present");
		}
	}
	if (errors.length > 0 || id === undefined) {
		return {
			errors: [
				{
					code: "invalid-command",
					message: "agenticMemoryRetentionBundle: command is invalid",
					index,
					commandId: id,
					command: value,
					validationErrors: Object.freeze(errors),
				},
			],
		};
	}
	const base = { id, reason: value.reason as string | undefined };
	if (kind === "archive") {
		return {
			command: Object.freeze({
				...base,
				kind,
				recordId: value.recordId as string,
				...(base.reason === undefined ? {} : { reason: base.reason }),
			}),
			errors: [],
		};
	}
	if (kind === "restore") {
		return {
			command: Object.freeze({
				...base,
				kind,
				recordId: value.recordId as string,
				...(value.persistenceLevel === undefined
					? {}
					: {
							persistenceLevel: value.persistenceLevel as Exclude<
								AgenticMemoryPersistenceLevel,
								"archived"
							>,
						}),
				...(base.reason === undefined ? {} : { reason: base.reason }),
			}),
			errors: [],
		};
	}
	if (kind === "setPersistenceLevel") {
		return {
			command: Object.freeze({
				...base,
				kind,
				recordId: value.recordId as string,
				persistenceLevel: value.persistenceLevel as AgenticMemoryPersistenceLevel,
				...(base.reason === undefined ? {} : { reason: base.reason }),
			}),
			errors: [],
		};
	}
	return {
		command: Object.freeze({
			...base,
			kind: "requestConsolidation",
			recordIds: Object.freeze([...(value.recordIds as readonly string[])]),
			...(value.requestId === undefined ? {} : { requestId: value.requestId as string }),
			...(base.reason === undefined ? {} : { reason: base.reason }),
		}),
		errors: [],
	};
}

function retentionMissingRecords(
	command: AgenticMemoryRetentionCommand,
	records: ReadonlyMap<FactId, AgenticMemoryRecord>,
): readonly FactId[] {
	if ("recordId" in command) return records.has(command.recordId) ? [] : [command.recordId];
	return command.recordIds.filter((recordId) => !records.has(recordId));
}

function applyRetentionCommand<T>(
	command: AgenticMemoryRetentionCommand,
	source: ReadonlyMap<FactId, AgenticMemoryRecord<T>>,
	view: Map<FactId, AgenticMemoryRecord<T>>,
	requests: AgenticMemoryConsolidationRequest[],
): void {
	if (command.kind === "requestConsolidation") {
		requests.push(
			Object.freeze({
				id: command.requestId ?? command.id,
				commandId: command.id,
				recordIds: Object.freeze([...command.recordIds]),
				...(command.reason === undefined ? {} : { reason: command.reason }),
			}),
		);
		return;
	}
	const record = view.get(command.recordId) ?? source.get(command.recordId);
	if (record === undefined) return;
	const persistenceLevel =
		command.kind === "archive"
			? "archived"
			: command.kind === "restore"
				? (command.persistenceLevel ?? nonArchivedLevel(source.get(command.recordId) ?? record))
				: command.persistenceLevel;
	view.set(command.recordId, withPersistenceLevel(record, persistenceLevel));
}

function nonArchivedLevel(
	record: AgenticMemoryRecord,
): Exclude<AgenticMemoryPersistenceLevel, "archived"> {
	return record.persistenceLevel === "archived" ? "session" : record.persistenceLevel;
}

function withPersistenceLevel<T>(
	record: AgenticMemoryRecord<T>,
	persistenceLevel: AgenticMemoryPersistenceLevel,
): AgenticMemoryRecord<T> {
	return Object.freeze({
		...record,
		persistenceLevel,
	});
}

function retentionErrorFromRecordError(
	error: Omit<AgenticMemoryError, "cursor">,
): Omit<AgenticMemoryRetentionError, "cursor"> {
	return {
		...error,
		code: error.code,
	};
}
