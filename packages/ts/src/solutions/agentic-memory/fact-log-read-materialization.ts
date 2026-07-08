import { depBatch } from "../../ctx/types.js";
import type { DataIssue } from "../../data/index.js";
import type { Graph } from "../../graph/graph.js";
import { cloneStrictJsonValue } from "../../json/codec.js";
import type { Node } from "../../node/node.js";
import {
	AGENTIC_MEMORY_FACT_STREAM_CURSOR_KIND,
	type AgenticMemoryCommittedFact,
	type AgenticMemoryCommittedFactCursor,
	type AgenticMemoryCommittedFactMaterializationCursor,
	type AgenticMemoryCommittedFactReadResult,
	type AgenticMemoryFactLogAuditEntry,
	materializeAgenticMemoryCommittedFacts,
} from "./committed-fact-log.js";
import { solutionProjection } from "./projection.js";
import type {
	AgenticMemoryRecord,
	AgenticMemoryRecordApplicationEvidence,
	AgenticMemoryRecordApplicationPriorEvidence,
	StrictJsonValue,
} from "./types.js";

export type AgenticMemoryCommittedFactReadMaterializationStatusState =
	| "ready"
	| "empty"
	| "partial"
	| "error";

export interface AgenticMemoryCommittedFactReadMaterializationCursor {
	readonly evaluation: number;
	readonly factLogCursor: AgenticMemoryCommittedFactCursor;
	readonly readFacts: number;
	readonly materializedRecords: number;
	readonly evidenceFacts: number;
	readonly done: boolean;
	readonly completePrefix: boolean;
	readonly invalidFacts: number;
	readonly readIssues: number;
	readonly materializationIssues: number;
	readonly issues: number;
	readonly materialization: AgenticMemoryCommittedFactMaterializationCursor;
}

export interface AgenticMemoryCommittedFactReadMaterializationStatus {
	readonly state: AgenticMemoryCommittedFactReadMaterializationStatusState;
	readonly factLogCursor: AgenticMemoryCommittedFactCursor;
	readonly done: boolean;
	readonly completePrefix: boolean;
	readonly cursor: AgenticMemoryCommittedFactReadMaterializationCursor;
}

export interface AgenticMemoryCommittedFactReadMaterializationAuditEntry {
	readonly kind: "agentic-memory-committed-fact-read-materialization-audit";
	readonly action:
		| "read-result-materialized"
		| "read-result-invalid"
		| "fact-log-audit-linked"
		| "materialization-audit-linked"
		| "issue-recorded";
	readonly reason?: string;
	readonly factLogCursor?: AgenticMemoryCommittedFactCursor;
	readonly factLogAction?: AgenticMemoryFactLogAuditEntry["action"];
	readonly materializationAction?: string;
}

export interface AgenticMemoryCommittedFactReadMaterializationProjection<T = unknown> {
	readonly kind: "agentic-memory-committed-fact-read-materialization-projection";
	readonly records: readonly AgenticMemoryRecord<T>[];
	readonly priorEvidence: AgenticMemoryRecordApplicationPriorEvidence;
	readonly evidence: readonly AgenticMemoryRecordApplicationEvidence[];
	readonly status: AgenticMemoryCommittedFactReadMaterializationStatus;
	readonly issues: readonly DataIssue[];
	readonly audit: readonly AgenticMemoryCommittedFactReadMaterializationAuditEntry[];
	readonly cursor: AgenticMemoryCommittedFactReadMaterializationCursor;
}

export interface AgenticMemoryCommittedFactReadMaterializationBundle<
	TJson extends StrictJsonValue = StrictJsonValue,
> {
	readonly input: {
		readonly readResult: Node<AgenticMemoryCommittedFactReadResult<TJson>>;
	};
	readonly projection: Node<AgenticMemoryCommittedFactReadMaterializationProjection<TJson>>;
	readonly records: Node<readonly AgenticMemoryRecord<TJson>[]>;
	readonly priorEvidence: Node<AgenticMemoryRecordApplicationPriorEvidence>;
	readonly evidence: Node<readonly AgenticMemoryRecordApplicationEvidence[]>;
	readonly status: Node<AgenticMemoryCommittedFactReadMaterializationStatus>;
	readonly issues: Node<readonly DataIssue[]>;
	readonly audit: Node<readonly AgenticMemoryCommittedFactReadMaterializationAuditEntry[]>;
	readonly cursor: Node<AgenticMemoryCommittedFactReadMaterializationCursor>;
}

export interface AgenticMemoryCommittedFactReadMaterializationBundleOptions<
	TJson extends StrictJsonValue = StrictJsonValue,
> {
	readonly name?: string;
	readonly readResult: Node<AgenticMemoryCommittedFactReadResult<TJson>>;
}

/** Project D591 read materialization DATA from an explicit D589 read result.
 *
 * The helper consumes caller-supplied fact-log read result DATA and delegates
 * deterministic stream-order materialization to the D589 library materializer.
 * It does not call storage, apply/admit/mutate records, refresh subscribers,
 * acknowledge application success, or create a graph commit barrier. The
 * records, priorEvidence, and evidence it emits are ordinary DATA for callers
 * to wire into later admission, application, bootstrap, or restore inputs.
 *
 * @param readResult - Host/backend supplied D589 committed fact read result DATA.
 * @param opts - Optional graph evaluation counter.
 * @returns Read materialization and caller-wired re-entry DATA facts.
 * @category solutions
 */
export function projectAgenticMemoryCommittedFactReadMaterialization<
	TJson extends StrictJsonValue = StrictJsonValue,
>(
	readResult: unknown,
	opts: { readonly evaluation?: number } = {},
): AgenticMemoryCommittedFactReadMaterializationProjection<TJson> {
	const evaluation = opts.evaluation ?? 0;
	const validated = validateReadResult<TJson>(readResult);
	if (!validated.ok) {
		const cursor = readMaterializationCursor({
			evaluation,
			factLogCursor: factCursor(0),
			readFacts: 0,
			materializedRecords: 0,
			evidenceFacts: 0,
			done: false,
			completePrefix: false,
			invalidFacts: 0,
			readIssues: 0,
			materializationIssues: 0,
			issues: validated.issues.length,
			materialization: emptyMaterializationCursor(validated.issues.length),
		});
		return Object.freeze({
			kind: "agentic-memory-committed-fact-read-materialization-projection",
			records: Object.freeze([]),
			priorEvidence: emptyPriorEvidence(),
			evidence: Object.freeze([]),
			status: Object.freeze({
				state: "error",
				factLogCursor: cursor.factLogCursor,
				done: false,
				completePrefix: false,
				cursor,
			}),
			issues: validated.issues,
			audit: Object.freeze([
				auditEntry("read-result-invalid", { reason: "read result validation failed" }),
				...validated.issues.map((item) => auditEntry("issue-recorded", { reason: item.code })),
			]),
			cursor,
		});
	}

	const result = validated.result;
	const materialized = materializeAgenticMemoryCommittedFacts<TJson>(result.facts);
	const issues = Object.freeze([...result.issues, ...materialized.issues]);
	const evidence = Object.freeze([...materialized.priorEvidence.entries]);
	const completePrefix = result.done && result.cursor.position === result.facts.length;
	const cursor = readMaterializationCursor({
		evaluation,
		factLogCursor: result.cursor,
		readFacts: result.facts.length,
		materializedRecords: materialized.records.length,
		evidenceFacts: evidence.length,
		done: result.done,
		completePrefix,
		invalidFacts: materialized.cursor.invalidFacts,
		readIssues: result.issues.length,
		materializationIssues: materialized.issues.length,
		issues: issues.length,
		materialization: materialized.cursor,
	});
	const state = readMaterializationState({
		readFacts: result.facts.length,
		records: materialized.records.length,
		evidence: evidence.length,
		issues: issues.length,
		invalidFacts: materialized.cursor.invalidFacts,
		done: result.done,
		completePrefix,
	});
	return Object.freeze({
		kind: "agentic-memory-committed-fact-read-materialization-projection",
		records: materialized.records,
		priorEvidence: materialized.priorEvidence,
		evidence,
		status: Object.freeze({
			state,
			factLogCursor: result.cursor,
			done: result.done,
			completePrefix,
			cursor,
		}),
		issues,
		audit: Object.freeze([
			auditEntry("read-result-materialized", {
				factLogCursor: result.cursor,
				reason: "explicit read result DATA materialized in supplied stream order",
			}),
			...result.audit.map((entry) =>
				auditEntry("fact-log-audit-linked", {
					factLogCursor: entry.cursor ?? result.cursor,
					factLogAction: entry.action,
					reason: entry.reason,
				}),
			),
			...materialized.audit.map((entry) =>
				auditEntry("materialization-audit-linked", {
					materializationAction: entry.action,
					reason: entry.reason,
				}),
			),
			...issues.map((item) => auditEntry("issue-recorded", { reason: item.code })),
		]),
		cursor,
	});
}

/** Create a graph-visible D591 read materialization bundle over explicit read-result DATA.
 *
 * The bundle performs no fact-log read and owns no backend adapter. Hosts supply
 * read results as ordinary DATA; the bundle projects records, priorEvidence,
 * evidence, status, issues, audit, and cursor DATA for explicit caller wiring.
 *
 * @param graph - Graph that owns the created nodes.
 * @param opts - Read-result input node and optional bundle name.
 * @returns Projection and read-model nodes for D591 caller-wired re-entry DATA.
 * @category solutions
 */
export function agenticMemoryCommittedFactReadMaterializationBundle<
	TJson extends StrictJsonValue = StrictJsonValue,
>(
	graph: Graph,
	opts: AgenticMemoryCommittedFactReadMaterializationBundleOptions<TJson>,
): AgenticMemoryCommittedFactReadMaterializationBundle<TJson> {
	const name = opts.name ?? "agenticMemoryCommittedFactReadMaterialization";
	const projection = graph.node<AgenticMemoryCommittedFactReadMaterializationProjection<TJson>>(
		[opts.readResult],
		(ctx) => {
			const reads = depBatch(ctx, 0) ?? [];
			if (reads.length === 0) return;
			const state =
				ctx.state.get<{ evaluation: number }>() ??
				({ evaluation: 0 } satisfies { evaluation: number });
			const outputs: AgenticMemoryCommittedFactReadMaterializationProjection<TJson>[] = [];
			for (const raw of reads) {
				state.evaluation += 1;
				outputs.push(
					projectAgenticMemoryCommittedFactReadMaterialization<TJson>(raw, {
						evaluation: state.evaluation,
					}),
				);
			}
			ctx.state.set(state);
			ctx.down(outputs.map((output) => ["DATA", output] as const));
		},
		{
			name: `${name}/projection`,
			factory: "agenticMemoryCommittedFactReadMaterialization",
			completeWhenDepsComplete: false,
			errorWhenDepsError: false,
		},
	);
	return {
		input: { readResult: opts.readResult },
		projection,
		records: solutionProjection(
			graph,
			projection,
			`${name}/records`,
			"agenticMemoryCommittedFactReadMaterializationRecords",
			(fact) => fact.records,
		),
		priorEvidence: solutionProjection(
			graph,
			projection,
			`${name}/priorEvidence`,
			"agenticMemoryCommittedFactReadMaterializationPriorEvidence",
			(fact) => fact.priorEvidence,
		),
		evidence: solutionProjection(
			graph,
			projection,
			`${name}/evidence`,
			"agenticMemoryCommittedFactReadMaterializationEvidence",
			(fact) => fact.evidence,
		),
		status: solutionProjection(
			graph,
			projection,
			`${name}/status`,
			"agenticMemoryCommittedFactReadMaterializationStatus",
			(fact) => fact.status,
		),
		issues: solutionProjection(
			graph,
			projection,
			`${name}/issues`,
			"agenticMemoryCommittedFactReadMaterializationIssues",
			(fact) => fact.issues,
		),
		audit: solutionProjection(
			graph,
			projection,
			`${name}/audit`,
			"agenticMemoryCommittedFactReadMaterializationAudit",
			(fact) => fact.audit,
		),
		cursor: solutionProjection(
			graph,
			projection,
			`${name}/cursor`,
			"agenticMemoryCommittedFactReadMaterializationCursor",
			(fact) => fact.cursor,
		),
	};
}

function validateReadResult<TJson extends StrictJsonValue>(
	value: unknown,
):
	| { readonly ok: true; readonly result: AgenticMemoryCommittedFactReadResult<TJson> }
	| { readonly ok: false; readonly issues: readonly DataIssue[] } {
	let cloned: unknown;
	try {
		cloned = cloneStrictJsonValue(value, "agenticMemoryCommittedFactReadResult");
	} catch (error) {
		return {
			ok: false,
			issues: Object.freeze([
				issue(
					"agentic-memory.committed-fact-read-materialization.invalid-read-result",
					error instanceof Error ? error.message : String(error),
				),
			]),
		};
	}
	if (cloned === null || typeof cloned !== "object" || Array.isArray(cloned)) {
		return invalidRead("read result must be an object");
	}
	const read = cloned as Partial<AgenticMemoryCommittedFactReadResult<TJson>>;
	const errors: string[] = [];
	if (!Array.isArray(read.facts)) errors.push("facts must be an array");
	if (typeof read.done !== "boolean") errors.push("done must be boolean");
	if (!Array.isArray(read.issues)) errors.push("issues must be an array");
	if (!Array.isArray(read.audit)) errors.push("audit must be an array");
	const cursor = validateCursor(read.cursor);
	if (cursor === undefined) errors.push("cursor must be a fact-stream cursor");
	const issues = Array.isArray(read.issues)
		? normalizeIssues(read.issues as readonly unknown[])
		: undefined;
	const audit = Array.isArray(read.audit)
		? normalizeFactLogAuditEntries(read.audit as readonly unknown[])
		: undefined;
	if (issues !== undefined) errors.push(...issues.errors);
	if (audit !== undefined) errors.push(...audit.errors);
	if (errors.length > 0 || cursor === undefined) {
		return {
			ok: false,
			issues: Object.freeze([
				issue(
					"agentic-memory.committed-fact-read-materialization.invalid-read-result",
					"committed fact read result is invalid",
					{ refs: Object.freeze(errors) },
				),
			]),
		};
	}
	const facts = read.facts as readonly AgenticMemoryCommittedFact<TJson>[];
	const done = read.done as boolean;
	if (cursor.position < facts.length) {
		return {
			ok: false,
			issues: Object.freeze([
				issue(
					"agentic-memory.committed-fact-read-materialization.invalid-cursor",
					"fact-log cursor cannot precede supplied read facts",
				),
			]),
		};
	}
	return {
		ok: true,
		result: Object.freeze({
			facts: Object.freeze([...facts]),
			cursor,
			done,
			issues: issues?.values ?? Object.freeze([]),
			audit: audit?.values ?? Object.freeze([]),
		}),
	};
}

function invalidRead(message: string) {
	return {
		ok: false as const,
		issues: Object.freeze([
			issue("agentic-memory.committed-fact-read-materialization.invalid-read-result", message),
		]),
	};
}

function readMaterializationState(input: {
	readonly readFacts: number;
	readonly records: number;
	readonly evidence: number;
	readonly issues: number;
	readonly invalidFacts: number;
	readonly done: boolean;
	readonly completePrefix: boolean;
}): AgenticMemoryCommittedFactReadMaterializationStatusState {
	if (input.issues > 0 || input.invalidFacts > 0) return "partial";
	if (!input.done || !input.completePrefix) return "partial";
	if (input.readFacts === 0 && input.records === 0 && input.evidence === 0) return "empty";
	return "ready";
}

function readMaterializationCursor(
	cursor: AgenticMemoryCommittedFactReadMaterializationCursor,
): AgenticMemoryCommittedFactReadMaterializationCursor {
	return Object.freeze({
		...cursor,
		factLogCursor: freezeCursor(cursor.factLogCursor),
		materialization: Object.freeze({ ...cursor.materialization }),
	});
}

function emptyMaterializationCursor(
	issues: number,
): AgenticMemoryCommittedFactMaterializationCursor {
	return Object.freeze({
		facts: 0,
		recordMaterialFacts: 0,
		applicationDecisionFacts: 0,
		applicationEvidenceFacts: 0,
		priorEvidenceFacts: 0,
		invalidFacts: 0,
		issues,
	});
}

function emptyPriorEvidence(): AgenticMemoryRecordApplicationPriorEvidence {
	return Object.freeze({
		kind: "agentic-memory-record-application-prior-evidence",
		entries: Object.freeze([]),
	});
}

function validateCursor(
	cursor: AgenticMemoryCommittedFactCursor | undefined,
): AgenticMemoryCommittedFactCursor | undefined {
	if (cursor?.kind !== AGENTIC_MEMORY_FACT_STREAM_CURSOR_KIND) return undefined;
	if (!Number.isSafeInteger(cursor.position) || cursor.position < 0) return undefined;
	return freezeCursor(cursor);
}

function factCursor(position: number): AgenticMemoryCommittedFactCursor {
	return Object.freeze({ kind: AGENTIC_MEMORY_FACT_STREAM_CURSOR_KIND, position });
}

function normalizeIssues(values: readonly unknown[]): {
	readonly values: readonly DataIssue[];
	readonly errors: readonly string[];
} {
	const out: DataIssue[] = [];
	const errors: string[] = [];
	for (let index = 0; index < values.length; index += 1) {
		const item = values[index];
		if (item === null || typeof item !== "object" || Array.isArray(item)) {
			errors.push(`issues[${index}] must be an issue object`);
			continue;
		}
		const candidate = item as Partial<DataIssue>;
		if (candidate.kind !== "issue") errors.push(`issues[${index}].kind must be issue`);
		if (typeof candidate.code !== "string" || candidate.code.length === 0) {
			errors.push(`issues[${index}].code must be a non-empty string`);
		}
		if (typeof candidate.message !== "string" || candidate.message.length === 0) {
			errors.push(`issues[${index}].message must be a non-empty string`);
		}
		if (
			candidate.severity !== undefined &&
			candidate.severity !== "info" &&
			candidate.severity !== "warning" &&
			candidate.severity !== "error"
		) {
			errors.push(`issues[${index}].severity is invalid`);
		}
		if (candidate.refs !== undefined && !validStringArray(candidate.refs)) {
			errors.push(`issues[${index}].refs must be an array of strings`);
		}
		if (candidate.path !== undefined && !validPath(candidate.path)) {
			errors.push(`issues[${index}].path must be an array of strings/numbers`);
		}
		out.push(freezeIssue(candidate as DataIssue));
	}
	return Object.freeze({ values: Object.freeze(out), errors: Object.freeze(errors) });
}

function normalizeFactLogAuditEntries(values: readonly unknown[]): {
	readonly values: readonly AgenticMemoryFactLogAuditEntry[];
	readonly errors: readonly string[];
} {
	const out: AgenticMemoryFactLogAuditEntry[] = [];
	const errors: string[] = [];
	for (let index = 0; index < values.length; index += 1) {
		const item = values[index];
		if (item === null || typeof item !== "object" || Array.isArray(item)) {
			errors.push(`audit[${index}] must be a fact-log audit object`);
			continue;
		}
		const candidate = item as Partial<AgenticMemoryFactLogAuditEntry>;
		if (candidate.kind !== "agentic-memory-fact-log-audit") {
			errors.push(`audit[${index}].kind is invalid`);
		}
		if (!isFactLogAuditAction(candidate.action)) {
			errors.push(`audit[${index}].action is invalid`);
		}
		if (candidate.reason !== undefined && typeof candidate.reason !== "string") {
			errors.push(`audit[${index}].reason must be a string`);
		}
		const cursor =
			candidate.cursor === undefined
				? undefined
				: validateCursor(candidate.cursor as AgenticMemoryCommittedFactCursor);
		if (candidate.cursor !== undefined && cursor === undefined) {
			errors.push(`audit[${index}].cursor must be a fact-stream cursor`);
		}
		out.push(
			deepFreezeStrict({
				...candidate,
				...(cursor === undefined ? {} : { cursor }),
			}) as AgenticMemoryFactLogAuditEntry,
		);
	}
	return Object.freeze({ values: Object.freeze(out), errors: Object.freeze(errors) });
}

function isFactLogAuditAction(value: unknown): value is AgenticMemoryFactLogAuditEntry["action"] {
	return (
		value === "batch-committed" ||
		value === "batch-duplicate" ||
		value === "batch-conflict" ||
		value === "batch-rejected" ||
		value === "batch-uncertain" ||
		value === "facts-read" ||
		value === "issue-recorded"
	);
}

function validStringArray(value: readonly string[]): boolean {
	return Array.isArray(value) && value.every((item) => typeof item === "string");
}

function validPath(value: readonly (string | number)[]): boolean {
	return (
		Array.isArray(value) &&
		value.every((item) => typeof item === "string" || typeof item === "number")
	);
}

function freezeCursor(cursor: AgenticMemoryCommittedFactCursor): AgenticMemoryCommittedFactCursor {
	return Object.freeze({ kind: cursor.kind, position: cursor.position });
}

function freezeIssue(item: DataIssue): DataIssue {
	return deepFreezeStrict({ ...item }) as DataIssue;
}

function deepFreezeStrict<T>(value: T): T {
	if (value === null || typeof value !== "object") return value;
	for (const item of Object.values(value)) deepFreezeStrict(item);
	return Object.freeze(value);
}

function issue(
	code: string,
	message: string,
	fields: Omit<DataIssue, "kind" | "code" | "message" | "severity"> = {},
): DataIssue {
	return Object.freeze({ kind: "issue", code, message, severity: "error", ...fields });
}

function auditEntry(
	action: AgenticMemoryCommittedFactReadMaterializationAuditEntry["action"],
	fields: Omit<AgenticMemoryCommittedFactReadMaterializationAuditEntry, "kind" | "action"> = {},
): AgenticMemoryCommittedFactReadMaterializationAuditEntry {
	return Object.freeze({
		kind: "agentic-memory-committed-fact-read-materialization-audit",
		action,
		...fields,
	});
}
