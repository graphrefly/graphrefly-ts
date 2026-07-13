/**
 * PostgreSQL-compatible read-only Layer C adapter (D602).
 *
 * Graph DATA contains only admitted coordinates, bounded result material, and
 * lifecycle evidence. SQL, credentials, clients, pools, and AbortControllers
 * remain inside the injected resolver/driver boundary.
 */

import type { DataIssue } from "../data/index.js";
import type { Graph } from "../graph/graph.js";
import { canonicalTupleKey, compoundTupleKey } from "../identity.js";
import type { Node } from "../node/node.js";
import type {
	AgentRequestStatusChanged,
	AgentRuntimeAuditRecord,
	ExecutorArtifactMaterial,
	ExecutorOutcome,
	SizeCapacityEvidence,
	SourceRef,
	ToolProviderAdapterInput,
	ToolProviderAdapterRunRequested,
	ToolProviderAdapterRunStatus,
	ToolProviderCatalog,
	ToolProviderCatalogEntry,
} from "../orchestration/index.js";

export interface PostgresqlCoordinate {
	readonly id: string;
	readonly revision: string;
}

export type PostgresqlParameter = string | number | boolean | null;

/** Public, coordinate-only arguments. Raw SQL is deliberately impossible here. */
export interface PostgresqlQueryToolArguments {
	readonly contractVersion: "1";
	readonly source: PostgresqlCoordinate;
	readonly sourceProfile: PostgresqlCoordinate;
	readonly queryPlan: PostgresqlCoordinate;
	readonly executorProfile: PostgresqlCoordinate;
	readonly schemaRef: string;
	readonly parameters?: readonly PostgresqlParameter[];
	readonly parameterRefs?: readonly SourceRef[];
}

/** Host-owned lowering input structurally compatible with Canvas's M9 query intent. */
export interface PostgresqlQueryIntentCoordinates {
	readonly contractVersion: "1";
	readonly source: PostgresqlCoordinate;
	readonly sourceProfile: PostgresqlCoordinate;
	readonly queryPlan: PostgresqlCoordinate;
	readonly executorProfile: PostgresqlCoordinate;
	readonly schemaRef: string;
	readonly parameters?: readonly PostgresqlParameter[];
	readonly parameterRefs?: readonly SourceRef[];
}

export interface PostgresqlQueryIntentHandoff extends PostgresqlQueryIntentCoordinates {
	readonly intentId: string;
	readonly idempotencyKey: string;
}

export interface PostgresqlToolProviderInputCoordinates {
	readonly requestId: string;
	readonly operationId: string;
	readonly effectRunId: string;
	readonly routeId: string;
	readonly providerId?: string;
	readonly executorId: string;
	readonly profileId: string;
}

export interface PostgresqlQueryToolResult {
	readonly adapterVersion: string;
	readonly driverCompatibility: string;
	readonly schemaRef: string;
	readonly rowCount: number;
	readonly columnCount: number;
	readonly dataMode: "inline" | "ref";
	readonly columns?: readonly string[];
	readonly rows?: readonly (readonly PostgresqlParameter[])[];
	readonly resultRef?: SourceRef;
	readonly truncated: boolean;
}

/** Runtime-private material returned by the host's plan resolver. */
export interface PostgresqlResolvedQuery {
	readonly statement: string;
	readonly parameters?: readonly PostgresqlParameter[];
	readonly readOnly: true;
	readonly schemaRef: string;
}

export interface PostgresqlDriverQueryRequest {
	readonly statement: string;
	readonly parameters: readonly PostgresqlParameter[];
	/** The driver must enforce a read-only transaction/session server-side. */
	readonly readOnly: true;
	readonly signal: AbortSignal;
	readonly statementTimeoutMs: number;
	readonly maxRows: number;
}

export interface PostgresqlDriverQueryResult {
	readonly columns: readonly string[];
	readonly rows?: readonly (readonly PostgresqlParameter[])[];
	readonly rowCount?: number;
	readonly byteLength?: number;
	readonly resultRef?: SourceRef;
}

export interface PostgresqlDriverAcquireRequest {
	readonly signal: AbortSignal;
	readonly connectionTimeoutMs: number;
	readonly readOnly: true;
}

export interface PostgresqlToolProviderClient {
	/** Verified by the binding after establishing the server session/transaction. */
	readonly readOnlyEnforced: true;
	query(request: PostgresqlDriverQueryRequest): PromiseLike<PostgresqlDriverQueryResult>;
	release(): void | PromiseLike<void>;
}

export interface PostgresqlToolProviderDriver {
	readonly compatibility: string;
	acquire(request: PostgresqlDriverAcquireRequest): PromiseLike<PostgresqlToolProviderClient>;
	close?(): void | PromiseLike<void>;
}

export type PostgresqlDriverOwnership = "runtime-owned" | "caller-owned";

export type PostgresqlFailureKind =
	| "credential-unavailable"
	| "authentication"
	| "authorization"
	| "read-only-violation"
	| "connectivity"
	| "server-resource-limit"
	| "timeout"
	| "canceled"
	| "user-canceled"
	| "shutdown-canceled"
	| "schema-drift"
	| "incompatible-plan"
	| "unsafe-plan"
	| "result-limit"
	| "artifact-failure"
	| "adapter-driver-mismatch"
	| "provider-unknown";

export interface PostgresqlProviderError extends Error {
	readonly kind?: PostgresqlFailureKind;
	readonly retryable?: boolean;
}

export interface PostgresqlToolProviderCatalogOptions {
	readonly providerId?: string;
	readonly executorId?: string;
	readonly profileId?: string;
	readonly adapterVersion: string;
	readonly driverCompatibility: string;
	readonly argumentSchemaRef: string;
	readonly resultSchemaRef: string;
	readonly supportTier: "certified" | "preview" | "unsupported";
	readonly limitations?: readonly string[];
	readonly rolloutCohort: string;
	readonly maxRows?: number;
	readonly maxColumns?: number;
	readonly maxCellChars?: number;
	readonly maxInlineRows?: number;
	readonly maxResultBytes?: number;
	readonly maxParameterChars?: number;
	readonly maxParameterBytes?: number;
	readonly statementTimeoutMs?: number;
	readonly connectionTimeoutMs?: number;
}

export interface PostgresqlRunCancellationRequested {
	readonly kind: "postgresql-run-cancellation-requested";
	readonly cancellationId: string;
	readonly runId: string;
	readonly adapterInputId: string;
	readonly requestId: string;
	readonly operationId: string;
	readonly attempt: number;
	readonly sourceRefs?: readonly SourceRef[];
}

export interface PostgresqlRunCancellationProposal
	extends Omit<PostgresqlRunCancellationRequested, "kind"> {
	readonly kind: "postgresql-run-cancellation-proposal";
	readonly proposalId: string;
}

export interface PostgresqlRunCancellationDecision {
	readonly kind: "postgresql-run-cancellation-decision";
	readonly decisionId: string;
	readonly proposalId: string;
	readonly outcome: "admit" | "block";
	readonly sourceRefs?: readonly SourceRef[];
}

export interface PostgresqlRunCancellationAdmission {
	readonly kind: "postgresql-run-cancellation-admission";
	readonly admissionId: string;
	readonly proposalId: string;
	readonly decisionId: string;
	readonly cancellationId: string;
	readonly runId: string;
	readonly state: "admitted" | "blocked";
	readonly sourceRefs?: readonly SourceRef[];
}

export interface PostgresqlToolProviderRuntimeOptions extends PostgresqlToolProviderCatalogOptions {
	readonly name?: string;
	readonly inputs: Node<ToolProviderAdapterInput<PostgresqlQueryToolArguments>>;
	/** Must be the existing explicit run-admission projector's approved output. */
	readonly admittedRunRequests: readonly Node<ToolProviderAdapterRunRequested>[];
	readonly cancellationRequests?: readonly Node<PostgresqlRunCancellationRequested>[];
	readonly cancellationDecisions?: readonly Node<PostgresqlRunCancellationDecision>[];
	readonly resolvePlan: (
		args: PostgresqlQueryToolArguments,
		context: { readonly runId: string; readonly attempt: number; readonly signal: AbortSignal },
	) => PostgresqlResolvedQuery | PromiseLike<PostgresqlResolvedQuery>;
	readonly driver: PostgresqlToolProviderDriver;
	readonly driverOwnership?: PostgresqlDriverOwnership;
	readonly now?: () => number;
}

export interface PostgresqlToolProviderRuntimeBundle {
	readonly catalogs: readonly ToolProviderCatalog[];
	readonly runStatus: Node<ToolProviderAdapterRunStatus>;
	readonly outcomes: Node<ExecutorOutcome<PostgresqlQueryToolResult>>;
	readonly status: Node<AgentRequestStatusChanged>;
	readonly issues: Node<DataIssue>;
	readonly audit: Node<AgentRuntimeAuditRecord>;
	readonly cancellationProposals: Node<PostgresqlRunCancellationProposal>;
	readonly cancellationAdmissions: Node<PostgresqlRunCancellationAdmission>;
	dispose(): Promise<void>;
}

const SAFE = /^[A-Za-z0-9][A-Za-z0-9._:/@+-]{0,255}$/;
function boundedIdentity(value: unknown): value is string {
	return (
		typeof value === "string" &&
		value.length > 0 &&
		value.length <= 512 &&
		Array.from(value).every((character) => {
			const code = character.codePointAt(0) ?? 0;
			return code >= 32 && code !== 127;
		})
	);
}

/** Lowers a provider-neutral exact intent to the public coordinate-only tool arguments. */
export function postgresqlQueryToolArgumentsFromIntent(
	intent: PostgresqlQueryIntentCoordinates,
): PostgresqlQueryToolArguments {
	if (hasAccessorOrExoticObject(intent))
		throw new TypeError("PostgreSQL query intent must be inert plain data without accessors.");
	const candidate: PostgresqlQueryToolArguments = {
		contractVersion: "1",
		source: intent.source,
		sourceProfile: intent.sourceProfile,
		queryPlan: intent.queryPlan,
		executorProfile: intent.executorProfile,
		schemaRef: intent.schemaRef,
		...(intent.parameters === undefined ? {} : { parameters: intent.parameters }),
		...(intent.parameterRefs === undefined ? {} : { parameterRefs: intent.parameterRefs }),
	};
	const limits = {
		maxRows: 1,
		maxColumns: 1,
		maxCellChars: 1,
		maxInlineRows: 1,
		maxResultBytes: 1,
		maxParameterChars: 4096,
		maxParameterBytes: 64 * 1024,
		statementTimeoutMs: 1,
		connectionTimeoutMs: 1,
	} satisfies Limits;
	const validation = validateArguments(candidate, limits);
	if (validation !== undefined) throw new TypeError(validation);
	return Object.freeze({
		...candidate,
		source: Object.freeze({ ...candidate.source }),
		sourceProfile: Object.freeze({ ...candidate.sourceProfile }),
		queryPlan: Object.freeze({ ...candidate.queryPlan }),
		executorProfile: Object.freeze({ ...candidate.executorProfile }),
		...(candidate.parameters === undefined
			? {}
			: { parameters: Object.freeze([...candidate.parameters]) }),
		...(candidate.parameterRefs === undefined
			? {}
			: { parameterRefs: snapshotSourceRefs(candidate.parameterRefs) }),
	});
}

/** Host-owned, identity-preserving lowering into the existing Layer C adapter input. */
export function postgresqlToolProviderInputFromIntent(
	intent: PostgresqlQueryIntentHandoff,
	coords: PostgresqlToolProviderInputCoordinates,
): ToolProviderAdapterInput<PostgresqlQueryToolArguments> {
	if (
		hasAccessorOrExoticObject(intent) ||
		hasAccessorOrExoticObject(coords) ||
		!SAFE.test(intent.intentId) ||
		!SAFE.test(intent.idempotencyKey) ||
		![
			coords.requestId,
			coords.operationId,
			coords.effectRunId,
			coords.routeId,
			coords.executorId,
			coords.profileId,
		].every((value) => SAFE.test(value))
	)
		throw new TypeError(
			"PostgreSQL host lowering requires inert exact intent and run coordinates.",
		);
	const providerId = coords.providerId ?? "postgresql";
	if (!SAFE.test(providerId)) throw new TypeError("PostgreSQL provider coordinate is invalid.");
	const args = postgresqlQueryToolArgumentsFromIntent(intent);
	return Object.freeze({
		kind: "tool-provider-adapter-input",
		adapterInputId: compoundTupleKey("postgresql-adapter-input", [
			intent.intentId,
			intent.idempotencyKey,
			coords.requestId,
		]),
		status: "ready",
		requestId: coords.requestId,
		operationId: coords.operationId,
		effectRunId: coords.effectRunId,
		routeId: coords.routeId,
		providerId,
		executorId: coords.executorId,
		profileId: coords.profileId,
		toolName: "postgresql.query",
		operation: "read-query",
		toolCall: Object.freeze({
			kind: "tool-call",
			toolName: "postgresql.query",
			operation: "read-query",
			arguments: args,
		}),
		metadata: Object.freeze({ intentId: intent.intentId, idempotencyKey: intent.idempotencyKey }),
		sourceRefs: Object.freeze([
			Object.freeze({ kind: "workspace-production-data-query-intent", id: intent.intentId }),
		]),
	});
}

export function postgresqlToolProviderCatalog(
	opts: PostgresqlToolProviderCatalogOptions,
): ToolProviderCatalog {
	const providerId = opts.providerId ?? "postgresql";
	const executorId = opts.executorId ?? `${providerId}:tool-executor`;
	const profileId = opts.profileId ?? `${providerId}:read-only:${opts.adapterVersion}`;
	const limits = normalizedLimits(opts);
	const catalogLimits: Record<string, number> = { ...limits };
	const policyRef = Object.freeze({
		kind: "tool-provider-execution-policy",
		id: `${profileId}:policy`,
	});
	const tool = Object.freeze({
		kind: "tool-catalog-entry",
		providerId,
		toolName: "postgresql.query",
		operation: "read-query",
		inputKind: "tool-call",
		profileId,
		executorId,
		resultKinds: Object.freeze(["postgresql-query-result"]),
		schemaRefs: Object.freeze([opts.argumentSchemaRef, opts.resultSchemaRef]),
		capabilities: Object.freeze({
			adapterVersion: opts.adapterVersion,
			driverCompatibility: opts.driverCompatibility,
			supportTier: opts.supportTier,
			rolloutCohort: opts.rolloutCohort,
			readOnly: true,
			asyncRuntime: true,
			limitations: Object.freeze([...(opts.limitations ?? [])]),
		}),
		limits: catalogLimits,
		policyRefs: Object.freeze([policyRef]),
	} satisfies ToolProviderCatalogEntry);
	return Object.freeze({
		kind: "tool-provider-catalog",
		providerId,
		providerKind: "postgresql",
		status: opts.supportTier === "unsupported" ? "unavailable" : "ready",
		profiles: Object.freeze([
			Object.freeze({
				profileId,
				executorId,
				kind: "tool" as const,
				acceptedInputKinds: Object.freeze(["tool-call"]),
				acceptedSchemaRefs: Object.freeze([opts.argumentSchemaRef]),
				acceptedResultKinds: Object.freeze(["postgresql-query-result"]),
				capabilities: tool.capabilities,
				limits: catalogLimits,
				policyRefs: Object.freeze([policyRef]),
			}),
		]),
		tools: Object.freeze([tool]),
		policyRefs: Object.freeze([policyRef]),
		metadata: Object.freeze({ adapterPack: "postgresql-v1", adapterVersion: opts.adapterVersion }),
	});
}

export function postgresqlToolProviderRuntime(
	graph: Graph,
	opts: PostgresqlToolProviderRuntimeOptions,
): PostgresqlToolProviderRuntimeBundle {
	if (opts.admittedRunRequests.length === 0) {
		throw new TypeError("postgresql runtime requires explicit admitted run requests");
	}
	const name = opts.name ?? "postgresqlToolProviderRuntime";
	const providerId = opts.providerId ?? "postgresql";
	const executorId = opts.executorId ?? `${providerId}:tool-executor`;
	const profileId = opts.profileId ?? `${providerId}:read-only:${opts.adapterVersion}`;
	const limits = normalizedLimits(opts);
	const catalog = postgresqlToolProviderCatalog(opts);
	const topology = graph.topologyGroup({ name });
	const outcomes = topology.node<ExecutorOutcome<PostgresqlQueryToolResult>>([], null, {
		name: `${name}/outcomes`,
	});
	const runStatus = topology.node<ToolProviderAdapterRunStatus>([], null, {
		name: `${name}/runStatus`,
	});
	const status = topology.node<AgentRequestStatusChanged>([], null, { name: `${name}/status` });
	const issues = topology.node<DataIssue>([], null, { name: `${name}/issues` });
	const audit = topology.node<AgentRuntimeAuditRecord>([], null, { name: `${name}/audit` });
	const cancellationProposals = topology.node<PostgresqlRunCancellationProposal>([], null, {
		name: `${name}/cancellationProposals`,
	});
	const cancellationAdmissions = topology.node<PostgresqlRunCancellationAdmission>([], null, {
		name: `${name}/cancellationAdmissions`,
	});
	const inputs = new Map<string, ToolProviderAdapterInput<PostgresqlQueryToolArguments>>();
	const runFingerprints = new Map<string, string>();
	const active = new Map<string, ActiveRun>();
	const proposals = new Map<string, PostgresqlRunCancellationProposal>();
	const pending = new Set<Promise<void>>();
	let auditSeq = 0;
	let disposed = false;
	let shutdownPromise: Promise<void> | undefined;
	let topologyReleased = false;

	const publishIssue = (next: DataIssue): void => issues.down([["DATA", next]]);
	const publishAudit = (
		kind: string,
		subjectId: string,
		metadata?: Record<string, unknown>,
	): void => {
		auditSeq += 1;
		audit.down([
			[
				"DATA",
				{
					id: compoundTupleKey("postgresql-runtime-audit", [name, String(auditSeq)]),
					kind,
					subjectId,
					...(metadata === undefined ? {} : { metadata }),
				},
			],
		]);
	};
	const publishRunStatus = (
		request: ToolProviderAdapterRunRequested,
		next: ToolProviderAdapterRunStatus["status"],
		outcomeId?: string,
		nextIssues?: readonly DataIssue[],
	): void => {
		runStatus.down([
			[
				"DATA",
				{
					kind: "tool-provider-adapter-run-status",
					runId: request.runId,
					adapterInputId: request.adapterInputId,
					requestId: request.requestId,
					operationId: request.operationId,
					status: next,
					attempt: request.attempt,
					...(outcomeId === undefined ? {} : { outcomeId }),
					...(nextIssues === undefined ? {} : { issues: nextIssues }),
					sourceRefs: request.sourceRefs,
					metadata: {
						providerId,
						adapterVersion: opts.adapterVersion,
						driverCompatibility: opts.driverCompatibility,
					},
				},
			],
		]);
	};

	function publishOutcome(
		activeRun: ActiveRun,
		outcome: ExecutorOutcome<PostgresqlQueryToolResult>,
	): void {
		outcomes.down([["DATA", outcome]]);
		publishRunStatus(activeRun.request, outcome.kind, outcome.outcomeId, outcome.issues);
		const requestStatus =
			outcome.kind === "result"
				? "completed"
				: outcome.kind === "failure"
					? "failed"
					: outcome.kind;
		status.down([
			[
				"DATA",
				{
					kind: "status",
					requestId: activeRun.request.requestId,
					operationId: activeRun.request.operationId,
					effectRunId: activeRun.input.effectRunId ?? activeRun.request.runId,
					status: requestStatus,
					sourceRefs: outcome.evidenceRefs,
					metadata: { runId: activeRun.request.runId, adapterVersion: opts.adapterVersion },
				},
			],
		]);
		publishAudit("postgresql-runtime-finished", activeRun.request.requestId, {
			runId: activeRun.request.runId,
			attempt: activeRun.request.attempt,
			outcome: outcome.kind,
		});
	}

	function execute(rawRequest: ToolProviderAdapterRunRequested): void {
		if (disposed) return;
		const sourceRefs = snapshotSourceRefs(rawRequest.sourceRefs);
		if (rawRequest.sourceRefs !== undefined && sourceRefs === undefined) {
			publishIssue(issue("postgresql-run-invalid-evidence", "Admitted run refs are invalid."));
			return;
		}
		const request: ToolProviderAdapterRunRequested = Object.freeze({
			kind: rawRequest.kind,
			runId: rawRequest.runId,
			adapterInputId: rawRequest.adapterInputId,
			requestId: rawRequest.requestId,
			operationId: rawRequest.operationId,
			routeId: rawRequest.routeId,
			providerId: rawRequest.providerId,
			executorId: rawRequest.executorId,
			profileId: rawRequest.profileId,
			attempt: rawRequest.attempt,
			reason: rawRequest.reason,
			sourceRefs,
		});
		if (request.providerId !== undefined && request.providerId !== providerId) return;
		const fingerprint = runFingerprint(request);
		const prior = runFingerprints.get(request.runId);
		if (prior !== undefined) {
			if (prior !== fingerprint) {
				const conflict = issue(
					"postgresql-run-coordinate-conflict",
					"PostgreSQL run id was reused with different immutable coordinates.",
				);
				publishIssue(conflict);
				publishRunStatus(request, "mismatched-request", undefined, [conflict]);
			}
			return;
		}
		runFingerprints.set(request.runId, fingerprint);
		publishRunStatus(request, "requested");
		const input = inputs.get(request.adapterInputId);
		if (input === undefined) {
			const missing = issue(
				"postgresql-run-missing-input",
				"PostgreSQL run has no matching adapter input.",
			);
			publishIssue(missing);
			publishRunStatus(request, "missing-input", undefined, [missing]);
			return;
		}
		if (
			!requestMatchesInput(request, input) ||
			input.providerId !== providerId ||
			input.executorId !== executorId ||
			input.profileId !== profileId ||
			input.toolName !== "postgresql.query" ||
			input.operation !== "read-query" ||
			input.toolCall?.toolName !== "postgresql.query" ||
			(input.toolCall.operation !== undefined && input.toolCall.operation !== "read-query") ||
			input.status !== "ready"
		) {
			const mismatch = issue(
				"postgresql-run-input-mismatch",
				"PostgreSQL run does not exactly match a ready adapter input.",
			);
			publishIssue(mismatch);
			publishRunStatus(request, "mismatched-request", undefined, [mismatch]);
			return;
		}
		const args = input.toolCall?.arguments;
		const validation = validateArguments(args, limits);
		if (validation !== undefined) {
			const run: ActiveRun = {
				request,
				input,
				controller: new AbortController(),
				cancelKind: undefined,
			};
			publishOutcome(
				run,
				failureOutcome(run, "unsafe-plan", validation, false, opts, executorId, profileId),
			);
			return;
		}
		if (opts.driver.compatibility !== opts.driverCompatibility) {
			const run: ActiveRun = {
				request,
				input,
				controller: new AbortController(),
				cancelKind: undefined,
			};
			publishOutcome(
				run,
				failureOutcome(
					run,
					"adapter-driver-mismatch",
					"Injected PostgreSQL driver is incompatible with the pinned adapter profile.",
					false,
					opts,
					executorId,
					profileId,
				),
			);
			return;
		}
		const controller = new AbortController();
		const run: ActiveRun = { request, input, controller, cancelKind: undefined };
		active.set(request.runId, run);
		publishRunStatus(request, "started");
		publishAudit("postgresql-runtime-started", request.requestId, {
			runId: request.runId,
			attempt: request.attempt,
			adapterVersion: opts.adapterVersion,
			driverCompatibility: opts.driverCompatibility,
		});
		const task = runQuery(run, args!, opts, limits, executorId, profileId)
			.catch(() =>
				failureOutcome(
					run,
					"artifact-failure",
					"PostgreSQL checked-out client release failed.",
					false,
					opts,
					executorId,
					profileId,
				),
			)
			.then((outcome) => {
				if (!disposed || run.cancelKind !== "dispose") publishOutcome(run, outcome);
			})
			.finally(() => {
				active.delete(request.runId);
				pending.delete(task);
			});
		pending.add(task);
	}

	function requestCancellation(request: PostgresqlRunCancellationRequested): void {
		if (disposed) return;
		if (
			request === null ||
			typeof request !== "object" ||
			Array.isArray(request) ||
			hasAccessorOrExoticObject(request) ||
			!Object.keys(request).every((key) =>
				[
					"kind",
					"cancellationId",
					"runId",
					"adapterInputId",
					"requestId",
					"operationId",
					"attempt",
					"sourceRefs",
				].includes(key),
			) ||
			request.kind !== "postgresql-run-cancellation-requested" ||
			![
				request.cancellationId,
				request.runId,
				request.adapterInputId,
				request.requestId,
				request.operationId,
			].every(boundedIdentity) ||
			!Number.isSafeInteger(request.attempt) ||
			request.attempt < 1
		) {
			publishIssue(
				issue("postgresql-cancellation-invalid", "Cancellation request is not inert data."),
			);
			return;
		}
		const requestSourceRefs = snapshotSourceRefs(request.sourceRefs);
		if (request.sourceRefs !== undefined && requestSourceRefs === undefined) {
			publishIssue(issue("postgresql-cancellation-invalid", "Cancellation refs are invalid."));
			return;
		}
		const run = active.get(request.runId);
		if (run === undefined || !cancellationMatchesRun(request, run)) {
			publishIssue(
				issue(
					"postgresql-cancellation-coordinate-mismatch",
					"Cancellation request does not exactly match an active PostgreSQL run.",
				),
			);
			return;
		}
		const proposal: PostgresqlRunCancellationProposal = Object.freeze({
			kind: "postgresql-run-cancellation-proposal",
			cancellationId: request.cancellationId,
			runId: request.runId,
			adapterInputId: request.adapterInputId,
			requestId: request.requestId,
			operationId: request.operationId,
			attempt: request.attempt,
			sourceRefs: requestSourceRefs,
			proposalId: compoundTupleKey("postgresql-run-cancellation-proposal", [
				request.cancellationId,
				request.runId,
			]),
		});
		proposals.set(proposal.proposalId, proposal);
		cancellationProposals.down([["DATA", proposal]]);
	}

	function decideCancellation(decision: PostgresqlRunCancellationDecision): void {
		if (disposed) return;
		if (
			decision === null ||
			typeof decision !== "object" ||
			Array.isArray(decision) ||
			hasAccessorOrExoticObject(decision) ||
			!Object.keys(decision).every((key) =>
				["kind", "decisionId", "proposalId", "outcome", "sourceRefs"].includes(key),
			) ||
			decision.kind !== "postgresql-run-cancellation-decision" ||
			![decision.decisionId, decision.proposalId].every(boundedIdentity) ||
			(decision.outcome !== "admit" && decision.outcome !== "block")
		) {
			publishIssue(
				issue(
					"postgresql-cancellation-decision-invalid",
					"Cancellation decision is not inert data.",
				),
			);
			return;
		}
		const decisionSourceRefs = snapshotSourceRefs(decision.sourceRefs);
		if (decision.sourceRefs !== undefined && decisionSourceRefs === undefined) {
			publishIssue(
				issue(
					"postgresql-cancellation-decision-invalid",
					"Cancellation decision refs are invalid.",
				),
			);
			return;
		}
		const proposal = proposals.get(decision.proposalId);
		if (proposal === undefined) {
			publishIssue(
				issue(
					"postgresql-cancellation-decision-missing-proposal",
					"Cancellation decision has no matching proposal.",
				),
			);
			return;
		}
		proposals.delete(decision.proposalId);
		const run = active.get(proposal.runId);
		const admitted =
			decision.outcome === "admit" && run !== undefined && cancellationMatchesRun(proposal, run);
		const admission: PostgresqlRunCancellationAdmission = Object.freeze({
			kind: "postgresql-run-cancellation-admission",
			admissionId: compoundTupleKey("postgresql-run-cancellation-admission", [decision.decisionId]),
			proposalId: proposal.proposalId,
			decisionId: decision.decisionId,
			cancellationId: proposal.cancellationId,
			runId: proposal.runId,
			state: admitted ? "admitted" : "blocked",
			sourceRefs: decisionSourceRefs,
		});
		cancellationAdmissions.down([["DATA", admission]]);
		if (admitted && run !== undefined) {
			run.cancelKind = "user";
			run.controller.abort();
		}
	}

	const unsubscribers = [
		opts.inputs.subscribe((msg) => {
			if (msg[0] === "DATA") {
				const input = msg[1] as ToolProviderAdapterInput<PostgresqlQueryToolArguments>;
				if (input.providerId === providerId) {
					inputs.set(input.adapterInputId, snapshotAdapterInput(input));
				}
			}
		}),
		...opts.admittedRunRequests.map((node) =>
			node.subscribe((msg) => {
				if (msg[0] === "DATA") execute(msg[1] as ToolProviderAdapterRunRequested);
			}),
		),
		...(opts.cancellationRequests ?? []).map((node) =>
			node.subscribe((msg) => {
				if (msg[0] === "DATA") requestCancellation(msg[1] as PostgresqlRunCancellationRequested);
			}),
		),
		...(opts.cancellationDecisions ?? []).map((node) =>
			node.subscribe((msg) => {
				if (msg[0] === "DATA") decideCancellation(msg[1] as PostgresqlRunCancellationDecision);
			}),
		),
	];

	return Object.freeze({
		catalogs: Object.freeze([catalog]),
		runStatus,
		outcomes,
		status,
		issues,
		audit,
		cancellationProposals,
		cancellationAdmissions,
		dispose() {
			if (shutdownPromise === undefined) {
				disposed = true;
				for (const unsubscribe of unsubscribers) unsubscribe();
				for (const run of active.values()) {
					run.cancelKind = "dispose";
					run.controller.abort();
				}
				shutdownPromise = Promise.allSettled([...pending]).then(async () => {
					active.clear();
					inputs.clear();
					proposals.clear();
					runFingerprints.clear();
					if ((opts.driverOwnership ?? "caller-owned") === "runtime-owned")
						await opts.driver.close?.();
				});
			}
			const releaseTopology = (): void => {
				if (topologyReleased) return;
				try {
					topology.release({ reason: `${name}:dispose` });
					topologyReleased = true;
				} catch {
					// Public output subscribers are caller-owned. D124 correctly keeps the
					// disposed views inspectable until those subscriptions are released.
				}
			};
			return shutdownPromise.then(releaseTopology, (error: unknown) => {
				releaseTopology();
				throw error;
			});
		},
	});
}

interface ActiveRun {
	readonly request: ToolProviderAdapterRunRequested;
	readonly input: ToolProviderAdapterInput<PostgresqlQueryToolArguments>;
	readonly controller: AbortController;
	cancelKind: "user" | "timeout" | "dispose" | undefined;
}

interface Limits {
	readonly maxRows: number;
	readonly maxColumns: number;
	readonly maxCellChars: number;
	readonly maxInlineRows: number;
	readonly maxResultBytes: number;
	readonly maxParameterChars: number;
	readonly maxParameterBytes: number;
	readonly statementTimeoutMs: number;
	readonly connectionTimeoutMs: number;
}

async function runQuery(
	run: ActiveRun,
	args: PostgresqlQueryToolArguments,
	opts: PostgresqlToolProviderRuntimeOptions,
	limits: Limits,
	executorId: string,
	profileId: string,
): Promise<ExecutorOutcome<PostgresqlQueryToolResult>> {
	let timer: ReturnType<typeof setTimeout> | undefined;
	let client: PostgresqlToolProviderClient | undefined;
	try {
		timer = setTimeout(() => {
			run.cancelKind = "timeout";
			run.controller.abort();
		}, limits.statementTimeoutMs);
		const resolved = await opts.resolvePlan(args, {
			runId: run.request.runId,
			attempt: run.request.attempt,
			signal: run.controller.signal,
		});
		if (
			!resolved.readOnly ||
			resolved.schemaRef !== args.schemaRef ||
			typeof resolved.statement !== "string" ||
			resolved.statement.length === 0
		) {
			return failureOutcome(
				run,
				"unsafe-plan",
				"Host-private plan resolution did not prove an exact read-only plan.",
				false,
				opts,
				executorId,
				profileId,
			);
		}
		client = await opts.driver.acquire({
			signal: run.controller.signal,
			connectionTimeoutMs: limits.connectionTimeoutMs,
			readOnly: true,
		});
		if (client.readOnlyEnforced !== true)
			return failureOutcome(
				run,
				"read-only-violation",
				"PostgreSQL binding did not verify server-side read-only enforcement.",
				false,
				opts,
				executorId,
				profileId,
			);
		const raw = await client.query({
			statement: resolved.statement,
			parameters: Object.freeze([...(resolved.parameters ?? args.parameters ?? [])]),
			readOnly: true,
			signal: run.controller.signal,
			statementTimeoutMs: limits.statementTimeoutMs,
			maxRows: limits.maxRows,
		});
		if (run.controller.signal.aborted)
			return canceledOrTimeout(run, opts, executorId, profileId, limits.statementTimeoutMs);
		return resultOutcome(run, args, raw, opts, limits, executorId, profileId);
	} catch (error: unknown) {
		if (run.controller.signal.aborted)
			return canceledOrTimeout(run, opts, executorId, profileId, limits.statementTimeoutMs);
		const classified = classifyError(error);
		return failureOutcome(
			run,
			classified.kind,
			classified.message,
			classified.retryable,
			opts,
			executorId,
			profileId,
		);
	} finally {
		if (timer !== undefined) clearTimeout(timer);
		await client?.release();
	}
}

function resultOutcome(
	run: ActiveRun,
	args: PostgresqlQueryToolArguments,
	raw: PostgresqlDriverQueryResult,
	opts: PostgresqlToolProviderRuntimeOptions,
	limits: Limits,
	executorId: string,
	profileId: string,
): ExecutorOutcome<PostgresqlQueryToolResult> {
	const columns = denseStrings(raw.columns, limits.maxColumns);
	const rows = raw.rows === undefined ? undefined : denseRows(raw.rows, limits);
	const suppliedRowCount = raw.rowCount;
	const suppliedBytes = raw.byteLength;
	const measuredBytes =
		rows === undefined ? undefined : new TextEncoder().encode(JSON.stringify(rows)).byteLength;
	const resultRef = snapshotSourceRef(raw.resultRef);
	const validCount = (value: number | undefined): boolean =>
		value === undefined || (Number.isSafeInteger(value) && value >= 0);
	const rowCount = suppliedRowCount ?? rows?.length ?? 0;
	const bytes = measuredBytes ?? suppliedBytes ?? 0;
	if (raw.resultRef !== undefined && resultRef === undefined)
		return failureOutcome(
			run,
			"artifact-failure",
			"PostgreSQL result supplied an invalid artifact ref.",
			false,
			opts,
			executorId,
			profileId,
		);
	if (
		columns === undefined ||
		rows === null ||
		!validCount(suppliedRowCount) ||
		!validCount(suppliedBytes) ||
		(rows !== undefined && suppliedRowCount !== undefined && suppliedRowCount !== rows.length) ||
		(rows?.length ?? 0) > limits.maxRows ||
		rowCount > limits.maxRows ||
		bytes > limits.maxResultBytes ||
		rows?.some((row) => row.length !== columns.length)
	) {
		return failureOutcome(
			run,
			"result-limit",
			"PostgreSQL result exceeded an admitted capacity bound.",
			false,
			opts,
			executorId,
			profileId,
		);
	}
	if (rows === undefined && resultRef === undefined)
		return failureOutcome(
			run,
			"result-limit",
			"PostgreSQL result supplied neither bounded rows nor an artifact ref.",
			false,
			opts,
			executorId,
			profileId,
		);
	const inline = rows !== undefined && rows.length <= limits.maxInlineRows;
	const result: PostgresqlQueryToolResult = Object.freeze({
		adapterVersion: opts.adapterVersion,
		driverCompatibility: opts.driverCompatibility,
		schemaRef: args.schemaRef,
		rowCount,
		columnCount: columns.length,
		dataMode: inline ? "inline" : "ref",
		columns: Object.freeze(columns),
		...(inline ? { rows: Object.freeze(rows!.map((row) => Object.freeze(row))) } : { resultRef }),
		truncated: !inline,
	});
	if (!inline && resultRef === undefined)
		return failureOutcome(
			run,
			"result-limit",
			"Oversized PostgreSQL result requires an artifact ref.",
			false,
			opts,
			executorId,
			profileId,
		);
	const sizeEvidence = Object.freeze([
		{
			kind: "size-capacity-evidence",
			unit: "bytes",
			quantity: bytes,
			measurementSource: "postgresql-driver-result",
			metadata: { limit: limits.maxResultBytes },
		},
		{
			kind: "size-capacity-evidence",
			unit: "rows",
			quantity: rowCount,
			measurementSource: "postgresql-driver-result",
			metadata: { limit: limits.maxRows },
		},
	] satisfies SizeCapacityEvidence[]);
	const artifact: ExecutorArtifactMaterial = Object.freeze({
		kind: "postgresql-query-result",
		schemaRef: args.schemaRef,
		dataMode: inline ? "inline" : "ref",
		byteLength: bytes,
		...(inline ? { value: result.rows } : { ref: resultRef }),
		sizeEvidence,
	});
	return Object.freeze({
		...outcomeBase(run, opts, executorId, profileId),
		kind: "result",
		result: Object.freeze({
			kind: "postgresql-query-result",
			value: result,
			refs: resultRef === undefined ? undefined : Object.freeze([resultRef]),
			artifacts: Object.freeze([artifact]),
		}),
	});
}

function failureOutcome(
	run: ActiveRun,
	kind: PostgresqlFailureKind,
	message: string,
	retryable: boolean,
	opts: PostgresqlToolProviderRuntimeOptions,
	executorId: string,
	profileId: string,
): ExecutorOutcome<PostgresqlQueryToolResult> {
	const nextIssue = issue(`postgresql-${kind}`, message, retryable);
	return Object.freeze({
		...outcomeBase(run, opts, executorId, profileId),
		kind: "failure",
		error: nextIssue,
		retryable,
		issues: Object.freeze([nextIssue]),
	});
}

function canceledOrTimeout(
	run: ActiveRun,
	opts: PostgresqlToolProviderRuntimeOptions,
	executorId: string,
	profileId: string,
	timeoutMs: number,
): ExecutorOutcome<PostgresqlQueryToolResult> {
	return run.cancelKind === "timeout"
		? Object.freeze({
				...outcomeBase(run, opts, executorId, profileId),
				kind: "timeout",
				timeoutMs,
				retryable: true,
			})
		: Object.freeze({
				...outcomeBase(run, opts, executorId, profileId),
				kind: "canceled",
				reason: run.cancelKind === "user" ? "admitted-user-cancellation" : "runtime-disposed",
			});
}

function outcomeBase(
	run: ActiveRun,
	opts: PostgresqlToolProviderRuntimeOptions,
	executorId: string,
	profileId: string,
) {
	return {
		outcomeId: compoundTupleKey("postgresql-executor-outcome", [
			run.request.runId,
			String(run.request.attempt),
		]),
		requestId: run.request.requestId,
		operationId: run.request.operationId,
		routeId: run.request.routeId ?? run.input.routeId ?? "postgresql:route-unavailable",
		executorId: run.request.executorId ?? executorId,
		profileId: run.request.profileId ?? profileId,
		attempt: run.request.attempt,
		inputId: run.request.adapterInputId,
		inputKind: "tool-call",
		occurredAtMs: opts.now?.(),
		evidenceRefs: run.request.sourceRefs,
		metadata: Object.freeze({
			runId: run.request.runId,
			adapterVersion: opts.adapterVersion,
			driverCompatibility: opts.driverCompatibility,
			rolloutCohort: opts.rolloutCohort,
		}),
	} as const;
}

function normalizedLimits(opts: PostgresqlToolProviderCatalogOptions): Limits {
	return Object.freeze({
		maxRows: positive(opts.maxRows, 1000),
		maxColumns: positive(opts.maxColumns, 128),
		maxCellChars: positive(opts.maxCellChars, 4096),
		maxInlineRows: positive(opts.maxInlineRows, 100),
		maxResultBytes: positive(opts.maxResultBytes, 1024 * 1024),
		maxParameterChars: positive(opts.maxParameterChars, 4096),
		maxParameterBytes: positive(opts.maxParameterBytes, 64 * 1024),
		statementTimeoutMs: positive(opts.statementTimeoutMs, 30_000),
		connectionTimeoutMs: positive(opts.connectionTimeoutMs, 10_000),
	});
}
function positive(value: number | undefined, fallback: number): number {
	return Number.isSafeInteger(value) && (value ?? 0) > 0 ? value! : fallback;
}
function issue(code: string, message: string, retryable = false): DataIssue {
	return Object.freeze({ kind: "issue", code, message, severity: "error", retryable });
}
function runFingerprint(run: ToolProviderAdapterRunRequested): string {
	return canonicalTupleKey([
		run.runId,
		run.adapterInputId,
		run.requestId,
		run.operationId,
		run.routeId ?? "",
		run.providerId ?? "",
		run.executorId ?? "",
		run.profileId ?? "",
		String(run.attempt),
		run.reason,
	]);
}
function requestMatchesInput(
	request: ToolProviderAdapterRunRequested,
	input: ToolProviderAdapterInput,
): boolean {
	return (
		request.adapterInputId === input.adapterInputId &&
		request.requestId === input.requestId &&
		request.operationId === input.operationId &&
		request.routeId !== undefined &&
		request.routeId === input.routeId &&
		request.providerId !== undefined &&
		request.providerId === input.providerId &&
		request.executorId !== undefined &&
		request.executorId === input.executorId &&
		request.profileId !== undefined &&
		request.profileId === input.profileId
	);
}
function cancellationMatchesRun(
	request: Omit<PostgresqlRunCancellationRequested, "kind">,
	run: ActiveRun,
): boolean {
	return (
		request.runId === run.request.runId &&
		request.adapterInputId === run.request.adapterInputId &&
		request.requestId === run.request.requestId &&
		request.operationId === run.request.operationId &&
		request.attempt === run.request.attempt
	);
}
function validateArguments(value: unknown, limits: Limits): string | undefined {
	if (value === null || typeof value !== "object" || Array.isArray(value))
		return "PostgreSQL arguments must be bounded coordinate-only data.";
	if (hasAccessorOrExoticObject(value))
		return "PostgreSQL arguments must be inert plain data without accessors.";
	const candidate = value as Partial<PostgresqlQueryToolArguments>;
	const allowed = new Set([
		"contractVersion",
		"source",
		"sourceProfile",
		"queryPlan",
		"executorProfile",
		"schemaRef",
		"parameters",
		"parameterRefs",
	]);
	if (Object.keys(candidate).some((key) => !allowed.has(key)))
		return "PostgreSQL arguments contain unsupported or private material.";
	if (
		candidate.contractVersion !== "1" ||
		!coordinate(candidate.source) ||
		!coordinate(candidate.sourceProfile) ||
		!coordinate(candidate.queryPlan) ||
		!coordinate(candidate.executorProfile) ||
		typeof candidate.schemaRef !== "string" ||
		!SAFE.test(candidate.schemaRef)
	)
		return "PostgreSQL arguments contain invalid coordinates.";
	if (
		candidate.parameters !== undefined &&
		(!Array.isArray(candidate.parameters) ||
			candidate.parameters.length > 256 ||
			!dense(candidate.parameters) ||
			candidate.parameters.some(
				(item) =>
					(item !== null &&
						(!["string", "number", "boolean"].includes(typeof item) ||
							(typeof item === "number" && !Number.isFinite(item)))) ||
					(typeof item === "string" && item.length > limits.maxParameterChars),
			) ||
			new TextEncoder().encode(JSON.stringify(candidate.parameters)).byteLength >
				limits.maxParameterBytes)
	)
		return "PostgreSQL parameters are not bounded scalar material.";
	if (
		candidate.parameterRefs !== undefined &&
		(!Array.isArray(candidate.parameterRefs) ||
			candidate.parameterRefs.length > 64 ||
			!dense(candidate.parameterRefs) ||
			candidate.parameterRefs.some(
				(ref) =>
					ref === null ||
					typeof ref !== "object" ||
					Array.isArray(ref) ||
					!Object.keys(ref).every((key) => key === "kind" || key === "id") ||
					typeof ref.kind !== "string" ||
					!SAFE.test(ref.kind) ||
					typeof ref.id !== "string" ||
					!SAFE.test(ref.id),
			))
	)
		return "PostgreSQL parameter refs are not bounded source refs.";
	return undefined;
}

function snapshotAdapterInput(
	input: ToolProviderAdapterInput<PostgresqlQueryToolArguments>,
): ToolProviderAdapterInput<PostgresqlQueryToolArguments> {
	const toolCall = input.toolCall;
	if (toolCall === undefined) return Object.freeze({ ...input });
	const rawArguments = toolCall.arguments;
	const argumentsSnapshot =
		rawArguments === undefined || hasAccessorOrExoticObject(rawArguments)
			? undefined
			: structuredClone(rawArguments);
	return Object.freeze({
		...input,
		toolCall: Object.freeze({ ...toolCall, arguments: argumentsSnapshot }),
	});
}

function hasAccessorOrExoticObject(value: unknown, seen = new Set<object>()): boolean {
	if (value === null || typeof value !== "object") return false;
	if (seen.has(value)) return false;
	seen.add(value);
	const prototype = Object.getPrototypeOf(value);
	if (prototype !== Object.prototype && prototype !== Array.prototype && prototype !== null)
		return true;
	const descriptors = Object.getOwnPropertyDescriptors(value);
	for (const descriptor of Object.values(descriptors)) {
		if (descriptor.get !== undefined || descriptor.set !== undefined) return true;
		if ("value" in descriptor && hasAccessorOrExoticObject(descriptor.value, seen)) return true;
	}
	return false;
}
function dense(values: readonly unknown[]): boolean {
	for (let index = 0; index < values.length; index += 1) if (!(index in values)) return false;
	return true;
}
function coordinate(value: unknown): boolean {
	if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
	const c = value as Partial<PostgresqlCoordinate>;
	return (
		Object.keys(c).every((key) => key === "id" || key === "revision") &&
		typeof c.id === "string" &&
		SAFE.test(c.id) &&
		typeof c.revision === "string" &&
		SAFE.test(c.revision)
	);
}
function denseStrings(values: readonly string[], max: number): string[] | undefined {
	if (
		!Array.isArray(values) ||
		values.length > max ||
		values.some(
			(value, index) => !(index in values) || typeof value !== "string" || !SAFE.test(value),
		)
	)
		return undefined;
	return [...values];
}
function denseRows(
	values: readonly (readonly PostgresqlParameter[])[],
	limits: Limits,
): PostgresqlParameter[][] | null | undefined {
	if (!Array.isArray(values) || values.length > limits.maxRows) return null;
	const rows: PostgresqlParameter[][] = [];
	for (let index = 0; index < values.length; index += 1) {
		if (!(index in values) || !Array.isArray(values[index])) return null;
		const row = values[index]!;
		if (row.length > limits.maxColumns) return null;
		const copy: PostgresqlParameter[] = [];
		for (let cell = 0; cell < row.length; cell += 1) {
			if (!(cell in row)) return null;
			const value = row[cell];
			if (value !== null && !["string", "number", "boolean"].includes(typeof value)) return null;
			if (typeof value === "string" && value.length > limits.maxCellChars) return null;
			if (typeof value === "number" && !Number.isFinite(value)) return null;
			copy.push(value as PostgresqlParameter);
		}
		rows.push(copy);
	}
	return rows;
}

function snapshotSourceRef(ref: SourceRef | undefined): SourceRef | undefined {
	return snapshotSourceRefs(ref === undefined ? undefined : [ref])?.[0];
}
function classifyError(error: unknown): {
	kind: PostgresqlFailureKind;
	message: string;
	retryable: boolean;
} {
	if (error instanceof Error) {
		const provider = error as PostgresqlProviderError;
		const kind = isFailureKind(provider.kind) ? provider.kind : "provider-unknown";
		return {
			kind,
			message: `PostgreSQL provider ${kind} failure.`,
			retryable:
				provider.retryable ??
				["connectivity", "server-resource-limit", "provider-unknown"].includes(kind),
		};
	}
	return {
		kind: "provider-unknown",
		message: "PostgreSQL provider unknown failure.",
		retryable: true,
	};
}

const failureKindSet = new Set<PostgresqlFailureKind>([
	"credential-unavailable",
	"authentication",
	"authorization",
	"read-only-violation",
	"connectivity",
	"server-resource-limit",
	"timeout",
	"canceled",
	"user-canceled",
	"shutdown-canceled",
	"schema-drift",
	"incompatible-plan",
	"unsafe-plan",
	"result-limit",
	"artifact-failure",
	"adapter-driver-mismatch",
	"provider-unknown",
]);
function isFailureKind(value: unknown): value is PostgresqlFailureKind {
	return typeof value === "string" && failureKindSet.has(value as PostgresqlFailureKind);
}

function snapshotSourceRefs(
	refs: readonly SourceRef[] | undefined,
): readonly SourceRef[] | undefined {
	if (refs === undefined) return undefined;
	if (!Array.isArray(refs) || refs.length > 64) return undefined;
	const result: SourceRef[] = [];
	for (let index = 0; index < refs.length; index += 1) {
		const ref = refs[index];
		if (
			!(index in refs) ||
			ref === null ||
			typeof ref !== "object" ||
			Array.isArray(ref) ||
			hasAccessorOrExoticObject(ref) ||
			!boundedIdentity(ref.kind) ||
			!boundedIdentity(ref.id)
		)
			return undefined;
		result.push(Object.freeze({ kind: ref.kind, id: ref.id }));
	}
	return Object.freeze(result);
}
