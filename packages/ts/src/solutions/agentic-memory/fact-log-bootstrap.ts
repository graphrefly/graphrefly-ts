import { depBatch } from "../../ctx/types.js";
import type { DataIssue } from "../../data/index.js";
import type { Graph } from "../../graph/graph.js";
import type { Node } from "../../node/node.js";
import { projectAgenticMemoryRecordApplicationPriorEvidence } from "./application-history.js";
import {
	AGENTIC_MEMORY_FACT_STREAM_CURSOR_KIND,
	type AgenticMemoryCommittedFactCursor,
	type AgenticMemoryCommittedFactMaterializationCursor,
} from "./committed-fact-log.js";
import type {
	AgenticMemoryCommittedFactReadMaterializationAuditEntry,
	AgenticMemoryCommittedFactReadMaterializationCursor,
	AgenticMemoryCommittedFactReadMaterializationProjection,
	AgenticMemoryCommittedFactReadMaterializationStatus,
	AgenticMemoryCommittedFactReadMaterializationStatusState,
} from "./fact-log-read-materialization.js";
import { solutionProjection } from "./projection.js";
import { validateAndProjectRecords } from "./shared.js";
import type {
	AgenticMemoryRecord,
	AgenticMemoryRecordApplicationEvidence,
	AgenticMemoryRecordApplicationPriorEvidence,
	StrictJsonValue,
} from "./types.js";

export type AgenticMemoryMaterializedFactLogBootstrapStatusState =
	| "ready"
	| "empty"
	| "partial"
	| "error";

export interface AgenticMemoryMaterializedFactLogBootstrapCursor {
	readonly evaluation: number;
	readonly factLogCursor: AgenticMemoryCommittedFactCursor;
	readonly records: number;
	readonly priorEvidenceEntries: number;
	readonly evidenceFacts: number;
	readonly sourceReadFacts: number;
	readonly sourceDone: boolean;
	readonly sourceCompletePrefix: boolean;
	readonly sourceIssues: number;
	readonly validationIssues: number;
	readonly readinessIssues: number;
	readonly issues: number;
}

export interface AgenticMemoryMaterializedFactLogBootstrapStatus {
	readonly state: AgenticMemoryMaterializedFactLogBootstrapStatusState;
	readonly factLogCursor: AgenticMemoryCommittedFactCursor;
	readonly sourceState: AgenticMemoryCommittedFactReadMaterializationStatusState;
	readonly sourceDone: boolean;
	readonly sourceCompletePrefix: boolean;
	readonly readyForCallerWiring: boolean;
	readonly cursor: AgenticMemoryMaterializedFactLogBootstrapCursor;
}

export interface AgenticMemoryMaterializedFactLogBootstrapAuditEntry {
	readonly kind: "agentic-memory-materialized-fact-log-bootstrap-audit";
	readonly action:
		| "bootstrap-input-projected"
		| "source-materialization-linked"
		| "caller-wiring-required"
		| "partial-read-recorded"
		| "issue-recorded";
	readonly reason?: string;
	readonly factLogCursor?: AgenticMemoryCommittedFactCursor;
	readonly sourceAction?: AgenticMemoryCommittedFactReadMaterializationAuditEntry["action"];
}

export interface AgenticMemoryMaterializedFactLogBootstrapInput<
	TJson extends StrictJsonValue = StrictJsonValue,
> {
	readonly kind: "agentic-memory-materialized-fact-log-bootstrap-input";
	readonly records: readonly AgenticMemoryRecord<TJson>[];
	readonly priorEvidence: AgenticMemoryRecordApplicationPriorEvidence;
	readonly evidence: readonly AgenticMemoryRecordApplicationEvidence[];
	readonly sourceStatus: AgenticMemoryCommittedFactReadMaterializationStatus;
	readonly sourceIssues: readonly DataIssue[];
	readonly sourceAudit: readonly AgenticMemoryCommittedFactReadMaterializationAuditEntry[];
	readonly sourceCursor: AgenticMemoryCommittedFactReadMaterializationCursor;
}

export interface AgenticMemoryMaterializedFactLogBootstrapProjection<
	TJson extends StrictJsonValue = StrictJsonValue,
> {
	readonly kind: "agentic-memory-materialized-fact-log-bootstrap-projection";
	readonly input: AgenticMemoryMaterializedFactLogBootstrapInput<TJson>;
	readonly records: readonly AgenticMemoryRecord<TJson>[];
	readonly priorEvidence: AgenticMemoryRecordApplicationPriorEvidence;
	readonly evidence: readonly AgenticMemoryRecordApplicationEvidence[];
	readonly status: AgenticMemoryMaterializedFactLogBootstrapStatus;
	readonly issues: readonly DataIssue[];
	readonly audit: readonly AgenticMemoryMaterializedFactLogBootstrapAuditEntry[];
	readonly cursor: AgenticMemoryMaterializedFactLogBootstrapCursor;
}

export interface AgenticMemoryMaterializedFactLogBootstrapBundle<
	TJson extends StrictJsonValue = StrictJsonValue,
> {
	readonly input: {
		readonly materialization: Node<AgenticMemoryCommittedFactReadMaterializationProjection<TJson>>;
	};
	readonly projection: Node<AgenticMemoryMaterializedFactLogBootstrapProjection<TJson>>;
	readonly bootstrapInput: Node<AgenticMemoryMaterializedFactLogBootstrapInput<TJson>>;
	readonly records: Node<readonly AgenticMemoryRecord<TJson>[]>;
	readonly priorEvidence: Node<AgenticMemoryRecordApplicationPriorEvidence>;
	readonly evidence: Node<readonly AgenticMemoryRecordApplicationEvidence[]>;
	readonly status: Node<AgenticMemoryMaterializedFactLogBootstrapStatus>;
	readonly issues: Node<readonly DataIssue[]>;
	readonly audit: Node<readonly AgenticMemoryMaterializedFactLogBootstrapAuditEntry[]>;
	readonly cursor: Node<AgenticMemoryMaterializedFactLogBootstrapCursor>;
}

export interface AgenticMemoryMaterializedFactLogBootstrapBundleOptions<
	TJson extends StrictJsonValue = StrictJsonValue,
> {
	readonly name?: string;
	readonly materialization: Node<AgenticMemoryCommittedFactReadMaterializationProjection<TJson>>;
}

/** Build a D593 bootstrap/re-entry input from already-materialized D591 DATA.
 *
 * The returned value is caller-wirable ordinary DATA. It does not read storage,
 * call a backend, mutate live graph records, refresh subscribers, bypass
 * admission/application, feed current-evaluation decisions back into the same
 * evaluation, claim lifecycle completion, or create a graph commit barrier.
 *
 * @param materialization - D591 read materialization projection DATA.
 * @returns A D593 caller-wirable bootstrap input DATA object.
 * @category solutions
 */
export function agenticMemoryMaterializedFactLogBootstrapInput<
	TJson extends StrictJsonValue = StrictJsonValue,
>(
	materialization: AgenticMemoryCommittedFactReadMaterializationProjection<TJson>,
): AgenticMemoryMaterializedFactLogBootstrapInput<TJson> {
	return normalizeBootstrapInput<TJson>(materialization).input;
}

/** Project D593 caller-wirable bootstrap/re-entry DATA from D591 materialization.
 *
 * The helper validates that the source materialization is complete and ready
 * before marking its status ready. Partial or issue-bearing inputs are still
 * exposed as DATA with status/issues so callers can choose explicit follow-up
 * wiring, but the helper never performs that wiring itself.
 *
 * @param materialization - D591 read materialization projection DATA.
 * @param opts - Optional graph evaluation counter.
 * @returns D593 caller-wirable input, status, issues, audit, and cursor DATA.
 * @category solutions
 */
export function projectAgenticMemoryMaterializedFactLogBootstrap<
	TJson extends StrictJsonValue = StrictJsonValue,
>(
	materialization: unknown,
	opts: { readonly evaluation?: number } = {},
): AgenticMemoryMaterializedFactLogBootstrapProjection<TJson> {
	const evaluation = opts.evaluation ?? 0;
	const normalized = normalizeBootstrapInput<TJson>(materialization);
	const input = normalized.input;
	const sourceStatus = input.sourceStatus;
	const validationIssues = normalized.issues;
	const readinessIssues = readinessIssuesFor(sourceStatus, input.sourceIssues);
	const issues = Object.freeze([...input.sourceIssues, ...validationIssues, ...readinessIssues]);
	const readyForCallerWiring =
		issues.length === 0 &&
		(sourceStatus.state === "ready" || sourceStatus.state === "empty") &&
		sourceStatus.done &&
		sourceStatus.completePrefix;
	const state = bootstrapState({
		readyForCallerWiring,
		records: input.records.length,
		evidence: input.evidence.length,
		sourceState: sourceStatus.state,
		issues: issues.length,
	});
	const cursor = bootstrapCursor({
		evaluation,
		factLogCursor: sourceStatus.factLogCursor,
		records: input.records.length,
		priorEvidenceEntries: input.priorEvidence.entries.length,
		evidenceFacts: input.evidence.length,
		sourceReadFacts: input.sourceCursor.readFacts,
		sourceDone: sourceStatus.done,
		sourceCompletePrefix: sourceStatus.completePrefix,
		sourceIssues: input.sourceIssues.length,
		validationIssues: validationIssues.length,
		readinessIssues: readinessIssues.length,
		issues: issues.length,
	});
	const status: AgenticMemoryMaterializedFactLogBootstrapStatus = Object.freeze({
		state,
		factLogCursor: sourceStatus.factLogCursor,
		sourceState: sourceStatus.state,
		sourceDone: sourceStatus.done,
		sourceCompletePrefix: sourceStatus.completePrefix,
		readyForCallerWiring,
		cursor,
	});
	const audit = Object.freeze([
		auditEntry("bootstrap-input-projected", {
			factLogCursor: sourceStatus.factLogCursor,
			reason: "D591 materialized DATA projected for explicit caller wiring",
		}),
		auditEntry("caller-wiring-required", {
			factLogCursor: sourceStatus.factLogCursor,
			reason: "helper does not connect records or evidence into application inputs",
		}),
		...(sourceStatus.done && sourceStatus.completePrefix
			? []
			: [
					auditEntry("partial-read-recorded", {
						factLogCursor: sourceStatus.factLogCursor,
						reason: "source materialization is not a complete prefix",
					}),
				]),
		...input.sourceAudit.map((entry) =>
			auditEntry("source-materialization-linked", {
				factLogCursor: entry.factLogCursor ?? sourceStatus.factLogCursor,
				sourceAction: entry.action,
				reason: entry.reason,
			}),
		),
		...issues.map((item) => auditEntry("issue-recorded", { reason: item.code })),
	]);
	return Object.freeze({
		kind: "agentic-memory-materialized-fact-log-bootstrap-projection",
		input,
		records: input.records,
		priorEvidence: input.priorEvidence,
		evidence: input.evidence,
		status,
		issues,
		audit,
		cursor,
	});
}

/** Create a graph-visible D593 bundle over already-materialized D591 DATA.
 *
 * The bundle only projects ordinary DATA nodes for explicit caller wiring. It
 * never reads storage, owns restore/bootstrap lifecycle, mutates live records,
 * refreshes subscribers, or creates a graph commit barrier.
 *
 * @param graph - Graph that owns the created nodes.
 * @param opts - Materialization input node and optional bundle name.
 * @returns Projection and read-model nodes for D593 caller-wirable DATA.
 * @category solutions
 */
export function agenticMemoryMaterializedFactLogBootstrapBundle<
	TJson extends StrictJsonValue = StrictJsonValue,
>(
	graph: Graph,
	opts: AgenticMemoryMaterializedFactLogBootstrapBundleOptions<TJson>,
): AgenticMemoryMaterializedFactLogBootstrapBundle<TJson> {
	const name = opts.name ?? "agenticMemoryMaterializedFactLogBootstrap";
	const projection = graph.node<AgenticMemoryMaterializedFactLogBootstrapProjection<TJson>>(
		[opts.materialization],
		(ctx) => {
			const materializations = depBatch(ctx, 0) ?? [];
			if (materializations.length === 0) return;
			const state =
				ctx.state.get<{ evaluation: number }>() ??
				({ evaluation: 0 } satisfies { evaluation: number });
			const outputs: AgenticMemoryMaterializedFactLogBootstrapProjection<TJson>[] = [];
			for (const materialization of materializations) {
				state.evaluation += 1;
				outputs.push(
					projectAgenticMemoryMaterializedFactLogBootstrap<TJson>(materialization, {
						evaluation: state.evaluation,
					}),
				);
			}
			ctx.state.set(state);
			ctx.down(outputs.map((output) => ["DATA", output] as const));
		},
		{
			name: `${name}/projection`,
			factory: "agenticMemoryMaterializedFactLogBootstrap",
			completeWhenDepsComplete: false,
			errorWhenDepsError: false,
		},
	);
	return {
		input: { materialization: opts.materialization },
		projection,
		bootstrapInput: solutionProjection(
			graph,
			projection,
			`${name}/bootstrapInput`,
			"agenticMemoryMaterializedFactLogBootstrapInput",
			(fact) => fact.input,
		),
		records: solutionProjection(
			graph,
			projection,
			`${name}/records`,
			"agenticMemoryMaterializedFactLogBootstrapRecords",
			(fact) => fact.records,
		),
		priorEvidence: solutionProjection(
			graph,
			projection,
			`${name}/priorEvidence`,
			"agenticMemoryMaterializedFactLogBootstrapPriorEvidence",
			(fact) => fact.priorEvidence,
		),
		evidence: solutionProjection(
			graph,
			projection,
			`${name}/evidence`,
			"agenticMemoryMaterializedFactLogBootstrapEvidence",
			(fact) => fact.evidence,
		),
		status: solutionProjection(
			graph,
			projection,
			`${name}/status`,
			"agenticMemoryMaterializedFactLogBootstrapStatus",
			(fact) => fact.status,
		),
		issues: solutionProjection(
			graph,
			projection,
			`${name}/issues`,
			"agenticMemoryMaterializedFactLogBootstrapIssues",
			(fact) => fact.issues,
		),
		audit: solutionProjection(
			graph,
			projection,
			`${name}/audit`,
			"agenticMemoryMaterializedFactLogBootstrapAudit",
			(fact) => fact.audit,
		),
		cursor: solutionProjection(
			graph,
			projection,
			`${name}/cursor`,
			"agenticMemoryMaterializedFactLogBootstrapCursor",
			(fact) => fact.cursor,
		),
	};
}

function normalizeBootstrapInput<TJson extends StrictJsonValue>(
	value: unknown,
): {
	readonly input: AgenticMemoryMaterializedFactLogBootstrapInput<TJson>;
	readonly issues: readonly DataIssue[];
} {
	try {
		return normalizeBootstrapInputInner<TJson>(value);
	} catch (error) {
		return fallbackInput<TJson>([
			issue(
				"agentic-memory.materialized-fact-log-bootstrap.invalid-input",
				error instanceof Error ? error.message : String(error),
			),
		]);
	}
}

function normalizeBootstrapInputInner<TJson extends StrictJsonValue>(
	value: unknown,
): {
	readonly input: AgenticMemoryMaterializedFactLogBootstrapInput<TJson>;
	readonly issues: readonly DataIssue[];
} {
	if (value === null || typeof value !== "object" || Array.isArray(value)) {
		return fallbackInput<TJson>([
			issue(
				"agentic-memory.materialized-fact-log-bootstrap.invalid-input",
				"materialization projection must be an object",
			),
		]);
	}
	const raw = value as Partial<AgenticMemoryCommittedFactReadMaterializationProjection<TJson>>;
	const issues: DataIssue[] = [];
	if (raw.kind !== "agentic-memory-committed-fact-read-materialization-projection") {
		issues.push(
			issue(
				"agentic-memory.materialized-fact-log-bootstrap.invalid-input",
				"materialization projection kind is invalid",
			),
		);
	}
	const recordProjection = validateAndProjectRecords<TJson>(raw.records);
	issues.push(
		...recordProjection.errors.map((error) =>
			issue("agentic-memory.materialized-fact-log-bootstrap.invalid-records", error.message, {
				refs: error.validationErrors,
				path: error.index === undefined ? undefined : [error.index],
			}),
		),
	);
	const priorEvidence = projectAgenticMemoryRecordApplicationPriorEvidence(raw.priorEvidence);
	issues.push(
		...priorEvidence.issues.map((item) =>
			issue("agentic-memory.materialized-fact-log-bootstrap.invalid-prior-evidence", item.message, {
				refs: item.refs,
			}),
		),
	);
	const evidenceProjection = projectAgenticMemoryRecordApplicationPriorEvidence(raw.evidence);
	issues.push(
		...evidenceProjection.issues.map((item) =>
			issue("agentic-memory.materialized-fact-log-bootstrap.invalid-evidence", item.message, {
				refs: item.refs,
			}),
		),
	);
	const sourceStatus = validateSourceStatus(raw.status, issues);
	const sourceCursor = validateSourceCursor(raw.cursor, sourceStatus, issues);
	const sourceIssues = normalizeIssues(raw.issues, "sourceIssues", issues);
	const sourceAudit = normalizeSourceAudit(raw.audit, issues);
	validateProjectionConsistency(
		{
			records: recordProjection.records.length,
			priorEvidence: priorEvidence.priorEvidence.entries,
			evidence: evidenceProjection.priorEvidence.entries,
			sourceStatus,
			sourceCursor,
		},
		issues,
	);
	return {
		input: Object.freeze({
			kind: "agentic-memory-materialized-fact-log-bootstrap-input",
			records: Object.freeze(recordProjection.records),
			priorEvidence: priorEvidence.priorEvidence,
			evidence: evidenceProjection.priorEvidence.entries,
			sourceStatus,
			sourceIssues,
			sourceAudit,
			sourceCursor,
		}),
		issues: Object.freeze(issues),
	};
}

function validateSourceStatus(
	value: AgenticMemoryCommittedFactReadMaterializationStatus | undefined,
	issues: DataIssue[],
): AgenticMemoryCommittedFactReadMaterializationStatus {
	if (value === undefined || value === null || typeof value !== "object" || Array.isArray(value)) {
		issues.push(
			issue(
				"agentic-memory.materialized-fact-log-bootstrap.invalid-status",
				"source materialization status must be an object",
			),
		);
		return emptySourceStatus();
	}
	const cursor = validateFactCursor(value.factLogCursor);
	if (cursor === undefined) {
		issues.push(
			issue(
				"agentic-memory.materialized-fact-log-bootstrap.invalid-status",
				"source materialization status factLogCursor must be a fact-stream cursor",
			),
		);
	}
	if (!isSourceState(value.state)) {
		issues.push(
			issue(
				"agentic-memory.materialized-fact-log-bootstrap.invalid-status",
				"source materialization status state is invalid",
			),
		);
	}
	if (typeof value.done !== "boolean" || typeof value.completePrefix !== "boolean") {
		issues.push(
			issue(
				"agentic-memory.materialized-fact-log-bootstrap.invalid-status",
				"source materialization status done/completePrefix must be boolean",
			),
		);
	}
	return Object.freeze({
		state: isSourceState(value.state) ? value.state : "error",
		factLogCursor: cursor ?? factCursor(0),
		done: typeof value.done === "boolean" ? value.done : false,
		completePrefix: typeof value.completePrefix === "boolean" ? value.completePrefix : false,
		cursor:
			value.cursor === undefined
				? emptySourceCursor()
				: validateSourceCursor(value.cursor, undefined, issues),
	});
}

function validateSourceCursor(
	value: AgenticMemoryCommittedFactReadMaterializationCursor | undefined,
	status: AgenticMemoryCommittedFactReadMaterializationStatus | undefined,
	issues: DataIssue[],
): AgenticMemoryCommittedFactReadMaterializationCursor {
	if (value === undefined || value === null || typeof value !== "object" || Array.isArray(value)) {
		issues.push(
			issue(
				"agentic-memory.materialized-fact-log-bootstrap.invalid-cursor",
				"source materialization cursor must be an object",
			),
		);
		return emptySourceCursor(status?.factLogCursor);
	}
	const factLogCursor = validateFactCursor(value.factLogCursor) ?? status?.factLogCursor;
	if (factLogCursor === undefined) {
		issues.push(
			issue(
				"agentic-memory.materialized-fact-log-bootstrap.invalid-cursor",
				"source materialization cursor factLogCursor must be a fact-stream cursor",
			),
		);
	}
	return Object.freeze({
		evaluation: numberOrZero(value.evaluation),
		factLogCursor: factLogCursor ?? factCursor(0),
		readFacts: numberOrZero(value.readFacts),
		materializedRecords: numberOrZero(value.materializedRecords),
		evidenceFacts: numberOrZero(value.evidenceFacts),
		done: typeof value.done === "boolean" ? value.done : (status?.done ?? false),
		completePrefix:
			typeof value.completePrefix === "boolean"
				? value.completePrefix
				: (status?.completePrefix ?? false),
		invalidFacts: numberOrZero(value.invalidFacts),
		readIssues: numberOrZero(value.readIssues),
		materializationIssues: numberOrZero(value.materializationIssues),
		issues: numberOrZero(value.issues),
		materialization: validateMaterializationCursor(value.materialization, issues),
	});
}

function validateMaterializationCursor(
	value: AgenticMemoryCommittedFactMaterializationCursor | undefined,
	issues: DataIssue[],
): AgenticMemoryCommittedFactMaterializationCursor {
	if (value === undefined) return emptyMaterializationCursor();
	if (value === null || typeof value !== "object" || Array.isArray(value)) {
		issues.push(
			issue(
				"agentic-memory.materialized-fact-log-bootstrap.invalid-cursor",
				"source materialization cursor materialization must be an object",
			),
		);
		return emptyMaterializationCursor();
	}
	const fields = [
		"facts",
		"recordMaterialFacts",
		"applicationDecisionFacts",
		"applicationEvidenceFacts",
		"priorEvidenceFacts",
		"invalidFacts",
		"issues",
	] as const;
	const invalid = fields.filter((field) => !isNonNegativeSafeInteger(value[field]));
	if (invalid.length > 0) {
		issues.push(
			issue(
				"agentic-memory.materialized-fact-log-bootstrap.invalid-cursor",
				"source materialization cursor counters must be non-negative safe integers",
				{ refs: invalid },
			),
		);
	}
	return Object.freeze({
		facts: numberOrZero(value.facts),
		recordMaterialFacts: numberOrZero(value.recordMaterialFacts),
		applicationDecisionFacts: numberOrZero(value.applicationDecisionFacts),
		applicationEvidenceFacts: numberOrZero(value.applicationEvidenceFacts),
		priorEvidenceFacts: numberOrZero(value.priorEvidenceFacts),
		invalidFacts: numberOrZero(value.invalidFacts),
		issues: numberOrZero(value.issues),
	});
}

function normalizeIssues(
	values: readonly DataIssue[] | undefined,
	label: string,
	issues: DataIssue[],
): readonly DataIssue[] {
	if (values === undefined) return Object.freeze([]);
	if (!Array.isArray(values)) {
		issues.push(
			issue(
				"agentic-memory.materialized-fact-log-bootstrap.invalid-issues",
				`${label} must be an array`,
			),
		);
		return Object.freeze([]);
	}
	const out: DataIssue[] = [];
	for (let index = 0; index < values.length; index += 1) {
		const item = values[index];
		if (
			item?.kind !== "issue" ||
			typeof item.code !== "string" ||
			item.code.length === 0 ||
			typeof item.message !== "string" ||
			item.message.length === 0
		) {
			issues.push(
				issue(
					"agentic-memory.materialized-fact-log-bootstrap.invalid-issues",
					`${label}[${index}] must be a DataIssue`,
					{ path: [index] },
				),
			);
			continue;
		}
		out.push(Object.freeze({ ...item }));
	}
	return Object.freeze(out);
}

function normalizeSourceAudit(
	values: readonly AgenticMemoryCommittedFactReadMaterializationAuditEntry[] | undefined,
	issues: DataIssue[],
): readonly AgenticMemoryCommittedFactReadMaterializationAuditEntry[] {
	if (values === undefined) return Object.freeze([]);
	if (!Array.isArray(values)) {
		issues.push(
			issue(
				"agentic-memory.materialized-fact-log-bootstrap.invalid-audit",
				"sourceAudit must be an array",
			),
		);
		return Object.freeze([]);
	}
	const out: AgenticMemoryCommittedFactReadMaterializationAuditEntry[] = [];
	for (let index = 0; index < values.length; index += 1) {
		const item = values[index];
		if (
			item?.kind !== "agentic-memory-committed-fact-read-materialization-audit" ||
			!isSourceAuditAction(item.action)
		) {
			issues.push(
				issue(
					"agentic-memory.materialized-fact-log-bootstrap.invalid-audit",
					`sourceAudit[${index}] is invalid`,
					{ path: [index] },
				),
			);
			continue;
		}
		const cursor = validateFactCursor(item.factLogCursor);
		if (item.factLogCursor !== undefined && cursor === undefined) {
			issues.push(
				issue(
					"agentic-memory.materialized-fact-log-bootstrap.invalid-audit",
					`sourceAudit[${index}].factLogCursor must be a fact-stream cursor`,
					{ path: [index, "factLogCursor"] },
				),
			);
		}
		if (item.reason !== undefined && typeof item.reason !== "string") {
			issues.push(
				issue(
					"agentic-memory.materialized-fact-log-bootstrap.invalid-audit",
					`sourceAudit[${index}].reason must be a string`,
					{ path: [index, "reason"] },
				),
			);
		}
		out.push(
			Object.freeze({
				kind: item.kind,
				action: item.action,
				...(typeof item.reason === "string" ? { reason: item.reason } : {}),
				...(cursor === undefined ? {} : { factLogCursor: cursor }),
			}),
		);
	}
	return Object.freeze(out);
}

function validateProjectionConsistency(
	input: {
		readonly records: number;
		readonly priorEvidence: readonly AgenticMemoryRecordApplicationEvidence[];
		readonly evidence: readonly AgenticMemoryRecordApplicationEvidence[];
		readonly sourceStatus: AgenticMemoryCommittedFactReadMaterializationStatus;
		readonly sourceCursor: AgenticMemoryCommittedFactReadMaterializationCursor;
	},
	issues: DataIssue[],
): void {
	if (!sameFactCursor(input.sourceStatus.factLogCursor, input.sourceStatus.cursor.factLogCursor)) {
		issues.push(
			issue(
				"agentic-memory.materialized-fact-log-bootstrap.inconsistent-materialization",
				"source status cursor must match source status factLogCursor",
			),
		);
	}
	if (!sameFactCursor(input.sourceStatus.factLogCursor, input.sourceCursor.factLogCursor)) {
		issues.push(
			issue(
				"agentic-memory.materialized-fact-log-bootstrap.inconsistent-materialization",
				"source cursor must match source status factLogCursor",
			),
		);
	}
	if (!sameEvidenceList(input.priorEvidence, input.evidence)) {
		issues.push(
			issue(
				"agentic-memory.materialized-fact-log-bootstrap.inconsistent-materialization",
				"source evidence must match priorEvidence entries",
			),
		);
	}
	if (input.sourceCursor.materializedRecords !== input.records) {
		issues.push(
			issue(
				"agentic-memory.materialized-fact-log-bootstrap.inconsistent-materialization",
				"source cursor materializedRecords must match projected records",
			),
		);
	}
	if (input.sourceCursor.evidenceFacts !== input.evidence.length) {
		issues.push(
			issue(
				"agentic-memory.materialized-fact-log-bootstrap.inconsistent-materialization",
				"source cursor evidenceFacts must match projected evidence",
			),
		);
	}
}

function readinessIssuesFor(
	status: AgenticMemoryCommittedFactReadMaterializationStatus,
	sourceIssues: readonly DataIssue[],
): readonly DataIssue[] {
	const issues: DataIssue[] = [];
	if (sourceIssues.length > 0) {
		issues.push(
			issue(
				"agentic-memory.materialized-fact-log-bootstrap.source-issues",
				"source materialization reported issues",
				{ severity: "warning" },
			),
		);
	}
	if (status.state === "error") {
		issues.push(
			issue(
				"agentic-memory.materialized-fact-log-bootstrap.source-error",
				"source materialization status is error",
			),
		);
	}
	if (status.state === "partial" || !status.done || !status.completePrefix) {
		issues.push(
			issue(
				"agentic-memory.materialized-fact-log-bootstrap.partial-read",
				"source materialization is not a complete committed fact-log prefix",
				{ severity: "warning" },
			),
		);
	}
	return Object.freeze(issues);
}

function bootstrapState(input: {
	readonly readyForCallerWiring: boolean;
	readonly records: number;
	readonly evidence: number;
	readonly sourceState: AgenticMemoryCommittedFactReadMaterializationStatusState;
	readonly issues: number;
}): AgenticMemoryMaterializedFactLogBootstrapStatusState {
	if (input.readyForCallerWiring) {
		if (input.sourceState === "empty" || (input.records === 0 && input.evidence === 0)) {
			return "empty";
		}
		return "ready";
	}
	if (input.issues > 0 || input.sourceState === "error") {
		return input.sourceState === "partial" ? "partial" : "error";
	}
	return "ready";
}

function bootstrapCursor(
	cursor: AgenticMemoryMaterializedFactLogBootstrapCursor,
): AgenticMemoryMaterializedFactLogBootstrapCursor {
	return Object.freeze({
		...cursor,
		factLogCursor: validateFactCursor(cursor.factLogCursor) ?? factCursor(0),
	});
}

function fallbackInput<TJson extends StrictJsonValue>(
	issues: readonly DataIssue[],
): {
	readonly input: AgenticMemoryMaterializedFactLogBootstrapInput<TJson>;
	readonly issues: readonly DataIssue[];
} {
	const status = emptySourceStatus();
	const cursor = emptySourceCursor();
	return {
		input: Object.freeze({
			kind: "agentic-memory-materialized-fact-log-bootstrap-input",
			records: Object.freeze([]),
			priorEvidence: emptyPriorEvidence(),
			evidence: Object.freeze([]),
			sourceStatus: status,
			sourceIssues: Object.freeze([]),
			sourceAudit: Object.freeze([]),
			sourceCursor: cursor,
		}),
		issues: Object.freeze([...issues]),
	};
}

function emptySourceStatus(): AgenticMemoryCommittedFactReadMaterializationStatus {
	const cursor = emptySourceCursor();
	return Object.freeze({
		state: "error",
		factLogCursor: cursor.factLogCursor,
		done: false,
		completePrefix: false,
		cursor,
	});
}

function emptySourceCursor(
	factLogCursor: AgenticMemoryCommittedFactCursor = factCursor(0),
): AgenticMemoryCommittedFactReadMaterializationCursor {
	return Object.freeze({
		evaluation: 0,
		factLogCursor,
		readFacts: 0,
		materializedRecords: 0,
		evidenceFacts: 0,
		done: false,
		completePrefix: false,
		invalidFacts: 0,
		readIssues: 0,
		materializationIssues: 0,
		issues: 0,
		materialization: emptyMaterializationCursor(),
	});
}

function emptyMaterializationCursor() {
	return Object.freeze({
		facts: 0,
		recordMaterialFacts: 0,
		applicationDecisionFacts: 0,
		applicationEvidenceFacts: 0,
		priorEvidenceFacts: 0,
		invalidFacts: 0,
		issues: 0,
	});
}

function emptyPriorEvidence(): AgenticMemoryRecordApplicationPriorEvidence {
	return Object.freeze({
		kind: "agentic-memory-record-application-prior-evidence",
		entries: Object.freeze([]),
	});
}

function validateFactCursor(
	cursor: AgenticMemoryCommittedFactCursor | undefined,
): AgenticMemoryCommittedFactCursor | undefined {
	if (cursor?.kind !== AGENTIC_MEMORY_FACT_STREAM_CURSOR_KIND) return undefined;
	if (!Number.isSafeInteger(cursor.position) || cursor.position < 0) return undefined;
	return factCursor(cursor.position);
}

function factCursor(position: number): AgenticMemoryCommittedFactCursor {
	return Object.freeze({ kind: AGENTIC_MEMORY_FACT_STREAM_CURSOR_KIND, position });
}

function numberOrZero(value: unknown): number {
	return isNonNegativeSafeInteger(value) ? value : 0;
}

function isNonNegativeSafeInteger(value: unknown): value is number {
	return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

function sameFactCursor(
	left: AgenticMemoryCommittedFactCursor,
	right: AgenticMemoryCommittedFactCursor,
): boolean {
	return left.kind === right.kind && left.position === right.position;
}

function sameEvidenceList(
	left: readonly AgenticMemoryRecordApplicationEvidence[],
	right: readonly AgenticMemoryRecordApplicationEvidence[],
): boolean {
	if (left.length !== right.length) return false;
	for (let index = 0; index < left.length; index += 1) {
		if (evidenceKey(left[index]!) !== evidenceKey(right[index]!)) return false;
	}
	return true;
}

function evidenceKey(evidence: AgenticMemoryRecordApplicationEvidence): string {
	return [
		evidence.applicationId ?? "",
		evidence.admissionId,
		evidence.proposalId ?? "",
		evidence.operation,
		String(evidence.operationVersion),
		evidence.idempotencyKey ?? "",
		evidence.recordId,
		evidence.fragmentId,
		evidence.targetRecordId ?? "",
		evidence.materialIdentity.algorithm,
		evidence.materialIdentity.key,
	].join("\u0000");
}

function isSourceState(
	value: unknown,
): value is AgenticMemoryCommittedFactReadMaterializationStatusState {
	return value === "ready" || value === "empty" || value === "partial" || value === "error";
}

function isSourceAuditAction(
	value: unknown,
): value is AgenticMemoryCommittedFactReadMaterializationAuditEntry["action"] {
	return (
		value === "read-result-materialized" ||
		value === "read-result-invalid" ||
		value === "fact-log-audit-linked" ||
		value === "materialization-audit-linked" ||
		value === "issue-recorded"
	);
}

function issue(
	code: string,
	message: string,
	fields: Omit<DataIssue, "kind" | "code" | "message" | "severity"> & {
		readonly severity?: DataIssue["severity"];
	} = {},
): DataIssue {
	const { severity = "error", ...rest } = fields;
	return Object.freeze({ kind: "issue", code, message, severity, ...rest });
}

function auditEntry(
	action: AgenticMemoryMaterializedFactLogBootstrapAuditEntry["action"],
	fields: Omit<AgenticMemoryMaterializedFactLogBootstrapAuditEntry, "kind" | "action"> = {},
): AgenticMemoryMaterializedFactLogBootstrapAuditEntry {
	return Object.freeze({
		kind: "agentic-memory-materialized-fact-log-bootstrap-audit",
		action,
		...fields,
	});
}
