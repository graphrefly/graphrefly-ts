import { depBatch } from "../../ctx/types.js";
import type { DataIssue } from "../../data/index.js";
import type { Graph } from "../../graph/graph.js";
import { cloneStrictJsonValue } from "../../json/codec.js";
import type { Node } from "../../node/node.js";
import {
	AGENTIC_MEMORY_FACT_STREAM_CURSOR_KIND,
	type AgenticMemoryCommittedFactBatch,
	type AgenticMemoryCommittedFactCursor,
	type AgenticMemoryCommittedFactIdentity,
	type AgenticMemoryCommittedFactMaterialIdentity,
	type AgenticMemoryFactCommitResult,
	type AgenticMemoryFactCommitStatus,
	type AgenticMemoryFactLogAuditEntry,
	agenticMemoryFactCommitStatusIsDurable,
	agenticMemoryFactCommitStatusIsTerminalFailure,
	assertAgenticMemoryCommittedFactBatch,
} from "./committed-fact-log.js";
import { solutionProjection } from "./projection.js";
import type { StrictJsonValue } from "./types.js";

export const AGENTIC_MEMORY_DURABILITY_ADVANCE_ON_COMMITTED_OR_DUPLICATE_POLICY =
	"agentic-memory-durability-advance-on-committed-or-duplicate";

export type AgenticMemoryDurabilityGateStatusState = "durable" | "terminal-failure" | "uncertain";

export interface AgenticMemoryDurabilityDownstreamAdvancePolicy {
	readonly kind: "agentic-memory-durability-downstream-advance-policy";
	readonly policyId: string;
	readonly allowCommitted?: true;
	readonly allowDuplicate?: true;
}

export interface AgenticMemoryDurabilityDownstreamAdvance {
	readonly kind: "agentic-memory-durability-downstream-advance";
	readonly allowed: boolean;
	readonly policyId?: string;
	readonly commitStatus: AgenticMemoryFactCommitStatus;
	readonly reason:
		| "fact-log-committed"
		| "fact-log-duplicate"
		| "terminal-durability-attempt-failure"
		| "uncertain-requires-read-resolution"
		| "no-explicit-policy";
}

export interface AgenticMemoryDurabilityGateCursor {
	readonly evaluation: number;
	readonly batchFacts: number;
	readonly resultFacts: number;
	readonly committed: number;
	readonly duplicate: number;
	readonly terminalFailures: number;
	readonly uncertain: number;
	readonly issues: number;
}

export interface AgenticMemoryDurabilityGateStatus {
	readonly state: AgenticMemoryDurabilityGateStatusState;
	readonly commitStatus: AgenticMemoryFactCommitStatus;
	readonly downstreamAdvance: AgenticMemoryDurabilityDownstreamAdvance;
	readonly factLogCursor: AgenticMemoryCommittedFactCursor;
	readonly cursor: AgenticMemoryDurabilityGateCursor;
}

export interface AgenticMemoryDurabilityGateAuditEntry {
	readonly kind: "agentic-memory-durability-gate-audit";
	readonly action:
		| "durability-result-projected"
		| "downstream-advance-allowed"
		| "downstream-advance-blocked"
		| "terminal-failure-recorded"
		| "uncertain-resolution-required"
		| "fact-log-audit-linked"
		| "issue-recorded";
	readonly reason?: string;
	readonly commitStatus?: AgenticMemoryFactCommitStatus;
	readonly batchIdentity?: AgenticMemoryCommittedFactMaterialIdentity;
	readonly factLogCursor?: AgenticMemoryCommittedFactCursor;
	readonly factLogAction?: AgenticMemoryFactLogAuditEntry["action"];
}

export interface AgenticMemoryDurabilityResult {
	readonly kind: "agentic-memory-durability-result";
	readonly batchIdentity: AgenticMemoryCommittedFactMaterialIdentity;
	readonly factIdentities: readonly AgenticMemoryCommittedFactIdentity[];
	readonly batchFacts: number;
	readonly commitStatus: AgenticMemoryFactCommitStatus;
	readonly factLogCursor: AgenticMemoryCommittedFactCursor;
	readonly state: AgenticMemoryDurabilityGateStatusState;
	readonly downstreamAdvance: AgenticMemoryDurabilityDownstreamAdvance;
}

export interface AgenticMemoryDurabilityGateProjection {
	readonly kind: "agentic-memory-durability-gate-projection";
	readonly result: AgenticMemoryDurabilityResult;
	readonly status: AgenticMemoryDurabilityGateStatus;
	readonly issues: readonly DataIssue[];
	readonly audit: readonly AgenticMemoryDurabilityGateAuditEntry[];
	readonly cursor: AgenticMemoryDurabilityGateCursor;
}

export interface AgenticMemoryDurabilityUncertainResolutionStatus {
	readonly kind: "agentic-memory-durability-uncertain-resolution-status";
	readonly state: "not-required" | "requires-fact-log-read";
	readonly batchIdentity: AgenticMemoryCommittedFactMaterialIdentity;
	readonly factIdentities: readonly AgenticMemoryCommittedFactIdentity[];
	readonly factLogCursor: AgenticMemoryCommittedFactCursor;
	readonly reason: "status-is-not-uncertain" | "uncertain-requires-read-idempotency-resolution";
}

export interface AgenticMemoryDurabilityGateInput<TJson extends StrictJsonValue = StrictJsonValue> {
	readonly kind: "agentic-memory-durability-gate-input";
	readonly batch: AgenticMemoryCommittedFactBatch<TJson>;
	readonly commitResult: AgenticMemoryFactCommitResult;
}

export interface AgenticMemoryDurabilityGateBundle<
	TJson extends StrictJsonValue = StrictJsonValue,
> {
	readonly input: {
		readonly attemptResult: Node<AgenticMemoryDurabilityGateInput<TJson>>;
	};
	readonly projection: Node<AgenticMemoryDurabilityGateProjection>;
	readonly result: Node<AgenticMemoryDurabilityResult>;
	readonly status: Node<AgenticMemoryDurabilityGateStatus>;
	readonly downstreamAdvance: Node<AgenticMemoryDurabilityDownstreamAdvance>;
	readonly issues: Node<readonly DataIssue[]>;
	readonly audit: Node<readonly AgenticMemoryDurabilityGateAuditEntry[]>;
	readonly cursor: Node<AgenticMemoryDurabilityGateCursor>;
}

export interface AgenticMemoryDurabilityGateBundleOptions<
	TJson extends StrictJsonValue = StrictJsonValue,
> {
	readonly name?: string;
	readonly attemptResult: Node<AgenticMemoryDurabilityGateInput<TJson>>;
	readonly downstreamAdvancePolicy?: AgenticMemoryDurabilityDownstreamAdvancePolicy;
}

/** D590 explicit policy for workflows that may advance after fact-log durability.
 *
 * The returned policy only allows `committed` and `duplicate` fact-log commit
 * statuses. It does not turn a durability result into an application
 * acknowledgement, live graph truth, record mutation authority, hot hydration,
 * or a graph wave/batch commit barrier.
 *
 * @param policyId - Optional caller-visible policy identifier.
 * @returns A D590 downstream-advance policy.
 * @category solutions
 */
export function agenticMemoryDurabilityAdvanceOnCommittedOrDuplicatePolicy(
	policyId = AGENTIC_MEMORY_DURABILITY_ADVANCE_ON_COMMITTED_OR_DUPLICATE_POLICY,
): AgenticMemoryDurabilityDownstreamAdvancePolicy {
	return Object.freeze({
		kind: "agentic-memory-durability-downstream-advance-policy",
		policyId,
		allowCommitted: true,
		allowDuplicate: true,
	});
}

/** Evaluate the D590 explicit downstream-advance policy.
 *
 * Only `committed` and `duplicate` can return true, and only when the supplied
 * policy explicitly allows that status.
 *
 * @param status - D589 fact-log commit status.
 * @param policy - Explicit downstream-advance policy.
 * @returns Whether a downstream workflow may advance by the supplied policy.
 * @category solutions
 */
export function agenticMemoryDurabilityResultMayAdvance(
	status: AgenticMemoryFactCommitStatus,
	policy: AgenticMemoryDurabilityDownstreamAdvancePolicy,
): boolean {
	if (status === "committed") return policy.allowCommitted === true;
	if (status === "duplicate") return policy.allowDuplicate === true;
	return false;
}

/** Pair a canonical D589 fact batch with its explicit fact-log commit result.
 *
 * The graph bundle consumes this paired DATA shape so it never correlates a
 * stale result from one batch with another batch. The pair is still only
 * fact-log persistence progress, not an application acknowledgement or graph
 * commit barrier.
 *
 * @param batch - Canonical D589 committed fact batch.
 * @param commitResult - D589 fact-log commit result for this batch attempt.
 * @returns A D590 durability-gate input DATA object.
 * @category solutions
 */
export function agenticMemoryDurabilityGateInput<TJson extends StrictJsonValue = StrictJsonValue>(
	batch: AgenticMemoryCommittedFactBatch<TJson>,
	commitResult: AgenticMemoryFactCommitResult,
): AgenticMemoryDurabilityGateInput<TJson> {
	return Object.freeze({
		kind: "agentic-memory-durability-gate-input",
		batch: assertAgenticMemoryCommittedFactBatch<TJson>(batch),
		commitResult: assertAgenticMemoryFactCommitResult(commitResult),
	});
}

/** Project a D590 graph-visible durability result from a canonical batch and commit result.
 *
 * This helper classifies fact-log persistence progress only. It does not call a
 * backend, append facts, acknowledge application success, mutate records,
 * hydrate/restore graph state, or create a graph commit barrier.
 *
 * @param batch - Canonical D589 committed fact batch.
 * @param commitResult - Host/backend supplied D589 fact-log commit result DATA.
 * @param opts - Optional evaluation counter and explicit downstream-advance policy.
 * @returns Durability result/read-model DATA facts.
 * @category solutions
 */
export function projectAgenticMemoryDurabilityGate<TJson extends StrictJsonValue = StrictJsonValue>(
	batch: AgenticMemoryCommittedFactBatch<TJson>,
	commitResult: AgenticMemoryFactCommitResult,
	opts: {
		readonly evaluation?: number;
		readonly downstreamAdvancePolicy?: AgenticMemoryDurabilityDownstreamAdvancePolicy;
	} = {},
): AgenticMemoryDurabilityGateProjection {
	const canonicalBatch = assertAgenticMemoryCommittedFactBatch<TJson>(batch);
	const result = assertAgenticMemoryFactCommitResult(commitResult);
	const issues = Object.freeze([...result.issues]);
	const state = durabilityState(result.status);
	const downstreamAdvance = downstreamAdvanceFor(result.status, opts.downstreamAdvancePolicy);
	const cursor = Object.freeze({
		evaluation: opts.evaluation ?? 0,
		batchFacts: canonicalBatch.facts.length,
		resultFacts: result.facts,
		committed: result.status === "committed" ? 1 : 0,
		duplicate: result.status === "duplicate" ? 1 : 0,
		terminalFailures: agenticMemoryFactCommitStatusIsTerminalFailure(result.status) ? 1 : 0,
		uncertain: result.status === "uncertain" ? 1 : 0,
		issues: issues.length,
	} satisfies AgenticMemoryDurabilityGateCursor);
	const durabilityResult: AgenticMemoryDurabilityResult = Object.freeze({
		kind: "agentic-memory-durability-result",
		batchIdentity: canonicalBatch.batchIdentity,
		factIdentities: Object.freeze(canonicalBatch.facts.map((fact) => fact.identity)),
		batchFacts: canonicalBatch.facts.length,
		commitStatus: result.status,
		factLogCursor: result.cursor,
		state,
		downstreamAdvance,
	});
	const status: AgenticMemoryDurabilityGateStatus = Object.freeze({
		state,
		commitStatus: result.status,
		downstreamAdvance,
		factLogCursor: result.cursor,
		cursor,
	});
	const audit = Object.freeze([
		auditEntry("durability-result-projected", {
			batchIdentity: canonicalBatch.batchIdentity,
			commitStatus: result.status,
			factLogCursor: result.cursor,
		}),
		auditEntry(
			downstreamAdvance.allowed ? "downstream-advance-allowed" : "downstream-advance-blocked",
			{
				batchIdentity: canonicalBatch.batchIdentity,
				commitStatus: result.status,
				factLogCursor: result.cursor,
				reason: downstreamAdvance.reason,
			},
		),
		...(agenticMemoryFactCommitStatusIsTerminalFailure(result.status)
			? [
					auditEntry("terminal-failure-recorded", {
						batchIdentity: canonicalBatch.batchIdentity,
						commitStatus: result.status,
						factLogCursor: result.cursor,
					}),
				]
			: []),
		...(result.status === "uncertain"
			? [
					auditEntry("uncertain-resolution-required", {
						batchIdentity: canonicalBatch.batchIdentity,
						commitStatus: result.status,
						factLogCursor: result.cursor,
						reason: "read/idempotency resolution required",
					}),
				]
			: []),
		...result.audit.map((entry) =>
			auditEntry("fact-log-audit-linked", {
				batchIdentity: canonicalBatch.batchIdentity,
				commitStatus: result.status,
				factLogCursor: entry.cursor ?? result.cursor,
				factLogAction: entry.action,
				reason: entry.reason,
			}),
		),
		...issues.map((issue) =>
			auditEntry("issue-recorded", {
				batchIdentity: canonicalBatch.batchIdentity,
				commitStatus: result.status,
				factLogCursor: result.cursor,
				reason: issue.code,
			}),
		),
	]);
	return Object.freeze({
		kind: "agentic-memory-durability-gate-projection",
		result: durabilityResult,
		status,
		issues,
		audit,
		cursor,
	});
}

/** Describe the D590 resolution requirement for an uncertain durability result.
 *
 * This helper does not perform the read. It only names the required next
 * boundary: explicit fact-log read plus idempotency/material-identity
 * resolution, followed by library-owned materialization if facts re-enter.
 *
 * @param result - D590 durability result DATA.
 * @returns Whether explicit fact-log read resolution is required.
 * @category solutions
 */
export function agenticMemoryDurabilityUncertainResolutionStatus(
	result: AgenticMemoryDurabilityResult,
): AgenticMemoryDurabilityUncertainResolutionStatus {
	return Object.freeze({
		kind: "agentic-memory-durability-uncertain-resolution-status",
		state: result.commitStatus === "uncertain" ? "requires-fact-log-read" : "not-required",
		batchIdentity: result.batchIdentity,
		factIdentities: result.factIdentities,
		factLogCursor: result.factLogCursor,
		reason:
			result.commitStatus === "uncertain"
				? "uncertain-requires-read-idempotency-resolution"
				: "status-is-not-uncertain",
	});
}

/** Create a graph-visible D590 durability-result gate bundle.
 *
 * The bundle consumes explicit paired batch/result DATA supplied by a host or
 * adapter boundary. It performs no storage I/O, never appends facts, and never
 * correlates independent latest values.
 *
 * @param graph - Graph that owns the created nodes.
 * @param opts - Paired attempt-result input plus optional explicit downstream policy.
 * @returns Projection and read-model nodes for durability result/status/issues/audit/cursor.
 * @category solutions
 */
export function agenticMemoryDurabilityGateBundle<TJson extends StrictJsonValue = StrictJsonValue>(
	graph: Graph,
	opts: AgenticMemoryDurabilityGateBundleOptions<TJson>,
): AgenticMemoryDurabilityGateBundle<TJson> {
	const name = opts.name ?? "agenticMemoryDurabilityGate";
	const projection = graph.node<AgenticMemoryDurabilityGateProjection>(
		[opts.attemptResult],
		(ctx) => {
			const attempts = depBatch(ctx, 0) ?? [];
			if (attempts.length === 0) return;
			const state =
				ctx.state.get<{ evaluation: number }>() ??
				({ evaluation: 0 } satisfies { evaluation: number });
			const outputs: AgenticMemoryDurabilityGateProjection[] = [];
			for (const raw of attempts) {
				const attempt = assertAgenticMemoryDurabilityGateInput<TJson>(raw);
				state.evaluation += 1;
				outputs.push(
					projectAgenticMemoryDurabilityGate(attempt.batch, attempt.commitResult, {
						evaluation: state.evaluation,
						downstreamAdvancePolicy: opts.downstreamAdvancePolicy,
					}),
				);
			}
			ctx.state.set(state);
			ctx.down(outputs.map((output) => ["DATA", output] as const));
		},
		{
			name: `${name}/projection`,
			factory: "agenticMemoryDurabilityGate",
			completeWhenDepsComplete: false,
			errorWhenDepsError: false,
		},
	);
	return {
		input: { attemptResult: opts.attemptResult },
		projection,
		result: solutionProjection(
			graph,
			projection,
			`${name}/result`,
			"agenticMemoryDurabilityGateResult",
			(fact) => fact.result,
		),
		status: solutionProjection(
			graph,
			projection,
			`${name}/status`,
			"agenticMemoryDurabilityGateStatus",
			(fact) => fact.status,
		),
		downstreamAdvance: solutionProjection(
			graph,
			projection,
			`${name}/downstreamAdvance`,
			"agenticMemoryDurabilityGateDownstreamAdvance",
			(fact) => fact.status.downstreamAdvance,
		),
		issues: solutionProjection(
			graph,
			projection,
			`${name}/issues`,
			"agenticMemoryDurabilityGateIssues",
			(fact) => fact.issues,
		),
		audit: solutionProjection(
			graph,
			projection,
			`${name}/audit`,
			"agenticMemoryDurabilityGateAudit",
			(fact) => fact.audit,
		),
		cursor: solutionProjection(
			graph,
			projection,
			`${name}/cursor`,
			"agenticMemoryDurabilityGateCursor",
			(fact) => fact.cursor,
		),
	};
}

function assertAgenticMemoryDurabilityGateInput<TJson extends StrictJsonValue = StrictJsonValue>(
	value: unknown,
): AgenticMemoryDurabilityGateInput<TJson> {
	const cloned = cloneStrictJsonValue(value, "agenticMemoryDurabilityGateInput");
	if (cloned === null || typeof cloned !== "object" || Array.isArray(cloned)) {
		throw new TypeError("agenticMemoryDurabilityGateInput: input must be an object");
	}
	const input = cloned as unknown as AgenticMemoryDurabilityGateInput<TJson>;
	if (input.kind !== "agentic-memory-durability-gate-input") {
		throw new TypeError("agenticMemoryDurabilityGateInput: invalid kind");
	}
	return agenticMemoryDurabilityGateInput(input.batch, input.commitResult);
}

function assertAgenticMemoryFactCommitResult(
	value: AgenticMemoryFactCommitResult,
): AgenticMemoryFactCommitResult {
	const cloned = cloneStrictJsonValue(value, "agenticMemoryFactCommitResult");
	if (cloned === null || typeof cloned !== "object" || Array.isArray(cloned)) {
		throw new TypeError("agenticMemoryFactCommitResult: result must be an object");
	}
	const result = cloned as unknown as AgenticMemoryFactCommitResult;
	if (!isCommitStatus(result.status)) {
		throw new TypeError("agenticMemoryFactCommitResult: invalid status");
	}
	validateCursor(result.cursor);
	if (!Number.isSafeInteger(result.facts) || result.facts < 0) {
		throw new TypeError("agenticMemoryFactCommitResult: facts must be a non-negative safe integer");
	}
	if (!Array.isArray(result.issues)) {
		throw new TypeError("agenticMemoryFactCommitResult: issues must be an array");
	}
	if (!Array.isArray(result.audit)) {
		throw new TypeError("agenticMemoryFactCommitResult: audit must be an array");
	}
	const cursor = freezeCursor(result.cursor);
	return Object.freeze({
		status: result.status,
		cursor,
		facts: result.facts,
		issues: Object.freeze(result.issues.map(freezeIssue)),
		audit: Object.freeze(result.audit.map(freezeFactLogAuditEntry)),
	});
}

function downstreamAdvanceFor(
	status: AgenticMemoryFactCommitStatus,
	policy: AgenticMemoryDurabilityDownstreamAdvancePolicy | undefined,
): AgenticMemoryDurabilityDownstreamAdvance {
	const nonDurableReason = agenticMemoryFactCommitStatusIsTerminalFailure(status)
		? "terminal-durability-attempt-failure"
		: status === "uncertain"
			? "uncertain-requires-read-resolution"
			: undefined;
	if (nonDurableReason !== undefined) {
		return Object.freeze({
			kind: "agentic-memory-durability-downstream-advance",
			allowed: false,
			...(policy === undefined ? {} : { policyId: policy.policyId }),
			commitStatus: status,
			reason: nonDurableReason,
		});
	}
	if (policy === undefined) {
		return Object.freeze({
			kind: "agentic-memory-durability-downstream-advance",
			allowed: false,
			commitStatus: status,
			reason: "no-explicit-policy",
		});
	}
	const allowed = agenticMemoryDurabilityResultMayAdvance(status, policy);
	return Object.freeze({
		kind: "agentic-memory-durability-downstream-advance",
		allowed,
		policyId: policy.policyId,
		commitStatus: status,
		reason: status === "committed" ? "fact-log-committed" : "fact-log-duplicate",
	});
}

function durabilityState(
	status: AgenticMemoryFactCommitStatus,
): AgenticMemoryDurabilityGateStatusState {
	if (agenticMemoryFactCommitStatusIsDurable(status)) return "durable";
	if (agenticMemoryFactCommitStatusIsTerminalFailure(status)) return "terminal-failure";
	return "uncertain";
}

function isCommitStatus(value: unknown): value is AgenticMemoryFactCommitStatus {
	return (
		value === "committed" ||
		value === "duplicate" ||
		value === "conflict" ||
		value === "rejected" ||
		value === "uncertain"
	);
}

function validateCursor(cursor: AgenticMemoryCommittedFactCursor): void {
	if (cursor?.kind !== AGENTIC_MEMORY_FACT_STREAM_CURSOR_KIND) {
		throw new TypeError("agenticMemoryFactCommitResult: cursor must be a fact-stream cursor");
	}
	if (!Number.isSafeInteger(cursor.position) || cursor.position < 0) {
		throw new TypeError("agenticMemoryFactCommitResult: cursor position must be >= 0");
	}
}

function freezeCursor(cursor: AgenticMemoryCommittedFactCursor): AgenticMemoryCommittedFactCursor {
	validateCursor(cursor);
	return Object.freeze({ kind: cursor.kind, position: cursor.position });
}

function freezeIssue(issue: DataIssue): DataIssue {
	return deepFreezeStrict({ ...issue }) as DataIssue;
}

function freezeFactLogAuditEntry(
	entry: AgenticMemoryFactLogAuditEntry,
): AgenticMemoryFactLogAuditEntry {
	return deepFreezeStrict({
		...entry,
		...(entry.cursor === undefined ? {} : { cursor: freezeCursor(entry.cursor) }),
	}) as AgenticMemoryFactLogAuditEntry;
}

function deepFreezeStrict<T>(value: T): T {
	if (value === null || typeof value !== "object") return value;
	for (const item of Object.values(value)) deepFreezeStrict(item);
	return Object.freeze(value);
}

function auditEntry(
	action: AgenticMemoryDurabilityGateAuditEntry["action"],
	fields: Omit<AgenticMemoryDurabilityGateAuditEntry, "kind" | "action"> = {},
): AgenticMemoryDurabilityGateAuditEntry {
	return Object.freeze({ kind: "agentic-memory-durability-gate-audit", action, ...fields });
}
