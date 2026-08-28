import { type Ctx, depBatch } from "../ctx/types.js";
import type { Graph } from "../graph/graph.js";
import type { Node } from "../node/node.js";

/** A value proposed for a correlated admission handoff (graphrefly-ts:D147). */
export interface AdmissionHandoffCandidate<T> {
	readonly kind: "admission-handoff-candidate";
	readonly candidateId: string;
	readonly candidateFingerprint: string;
	readonly value: T;
}

/** The one terminal admission decision for a candidate (graphrefly-ts:D147). */
export interface AdmissionHandoffDecision<R = unknown> {
	readonly kind: "admission-handoff-decision";
	readonly decisionId: string;
	readonly decisionFingerprint: string;
	readonly candidateId: string;
	readonly candidateFingerprint: string;
	readonly state: "admitted" | "rejected";
	readonly reason?: R;
}

/** A candidate released through the quiet accepted port. */
export interface AdmissionHandoffAccepted<T, R = unknown> {
	readonly kind: "admission-handoff-accepted";
	readonly candidateId: string;
	readonly candidateFingerprint: string;
	readonly decisionId: string;
	readonly decisionFingerprint: string;
	readonly value: T;
	readonly reason?: R;
}

/** A candidate and its correlated rejection. */
export interface AdmissionHandoffRejected<T, R = unknown> {
	readonly kind: "admission-handoff-rejected";
	readonly candidateId: string;
	readonly candidateFingerprint: string;
	readonly decisionId: string;
	readonly decisionFingerprint: string;
	readonly value: T;
	readonly reason?: R;
}

export type AdmissionHandoffIssueCode =
	| "malformed-candidate"
	| "malformed-decision"
	| "candidate-identity-conflict"
	| "decision-identity-conflict"
	| "candidate-fingerprint-mismatch"
	| "terminal-decision-conflict"
	| "pending-capacity-exceeded";

export interface AdmissionHandoffIssue {
	readonly kind: "admission-handoff-issue";
	readonly issueId: string;
	readonly code: AdmissionHandoffIssueCode;
	readonly message: string;
	readonly candidateId?: string;
	readonly decisionId?: string;
}

export type AdmissionHandoffStatusState =
	| "candidate-pending"
	| "decision-pending"
	| "accepted"
	| "rejected"
	| "replayed"
	| "issue";

export interface AdmissionHandoffStatus {
	readonly kind: "admission-handoff-status";
	readonly statusId: string;
	readonly state: AdmissionHandoffStatusState;
	readonly candidateId?: string;
	readonly decisionId?: string;
	readonly issueCode?: AdmissionHandoffIssueCode;
}

/** Bounded, material-free correlation progress. */
export interface AdmissionHandoffCursor {
	readonly kind: "admission-handoff-cursor";
	readonly sequence: number;
	readonly pendingCandidates: number;
	readonly pendingDecisions: number;
	readonly recentTerminals: number;
	readonly recentDecisions: number;
}

export interface AdmissionHandoffOptions<T, R = unknown> {
	readonly name?: string;
	readonly candidates: Node<AdmissionHandoffCandidate<T>>;
	readonly decisions: Node<AdmissionHandoffDecision<R>>;
	/** Maximum unmatched candidates plus decisions retained at once. */
	readonly maxPending: number;
	/** Maximum recent terminal candidates and decision identities retained for replay checks. */
	readonly maxRecent: number;
}

export interface AdmissionHandoffBundle<T, R = unknown> {
	readonly candidates: Node<AdmissionHandoffCandidate<T>>;
	readonly decisions: Node<AdmissionHandoffDecision<R>>;
	readonly accepted: Node<AdmissionHandoffAccepted<T, R>>;
	readonly rejected: Node<AdmissionHandoffRejected<T, R>>;
	readonly status: Node<AdmissionHandoffStatus>;
	readonly issues: Node<AdmissionHandoffIssue>;
	readonly cursor: Node<AdmissionHandoffCursor>;
	/** Release the graph-owned controller keepalive. Idempotent; the bundle is final after release. */
	release(): void;
}

type Terminal<T, R> =
	| { readonly state: "accepted"; readonly value: AdmissionHandoffAccepted<T, R> }
	| { readonly state: "rejected"; readonly value: AdmissionHandoffRejected<T, R> };

interface RecentDecision {
	readonly decisionId: string;
	readonly decisionFingerprint: string;
	readonly candidateId: string;
}

interface AdmissionHandoffRuntimeState<T, R> {
	pendingCandidates: Map<string, AdmissionHandoffCandidate<T>>;
	pendingDecisions: Map<string, AdmissionHandoffDecision<R>>;
	pendingDecisionOwners: Map<string, string>;
	terminals: Map<string, Terminal<T, R>>;
	terminalOrder: string[];
	recentDecisions: Map<string, RecentDecision>;
	recentDecisionOrder: string[];
	sequence: number;
	issueSequence: number;
	statusSequence: number;
}

type AdmissionHandoffRuntimeFact<T, R> =
	| { readonly kind: "accepted"; readonly value: AdmissionHandoffAccepted<T, R> }
	| { readonly kind: "rejected"; readonly value: AdmissionHandoffRejected<T, R> }
	| { readonly kind: "status"; readonly value: AdmissionHandoffStatus }
	| { readonly kind: "issue"; readonly value: AdmissionHandoffIssue }
	| { readonly kind: "cursor"; readonly value: AdmissionHandoffCursor };

type DownCtx<T, R> = Pick<Ctx, "down"> & {
	down(msgs: readonly (readonly ["DATA", AdmissionHandoffRuntimeFact<T, R>])[]): void;
};

/**
 * Build a bounded admission-gated hub-to-hub handoff.
 *
 * The accepted port is a pull-quiet causal boundary: rejected, unmatched and replayed inputs do
 * not preflight downstream work. A first correlated admission is released as one fresh ordinary
 * DIRTY-to-DATA wave. The factory owns every internal lifecycle flag; callers cannot override them.
 *
 * @param graph - Graph that owns the visible correlation and release topology.
 * @param opts - Candidate/decision inputs and explicit memory bounds.
 * @returns The accepted/rejected/status/issue/cursor ports and controller release handle.
 * @category patterns
 * @example
 * ```ts
 * import { admissionHandoff } from "@graphrefly/ts/patterns";
 *
 * const handoff = admissionHandoff(graph, {
 *   candidates,
 *   decisions,
 *   maxPending: 128,
 *   maxRecent: 256,
 * });
 * ```
 */
export function admissionHandoff<T, R = unknown>(
	graph: Graph,
	opts: AdmissionHandoffOptions<T, R>,
): AdmissionHandoffBundle<T, R> {
	assertPositiveBound(opts.maxPending, "maxPending");
	assertPositiveBound(opts.maxRecent, "maxRecent");
	const name = opts.name ?? "admissionHandoff";
	const runtime = graph.node<AdmissionHandoffRuntimeFact<T, R>>(
		[opts.candidates, opts.decisions],
		(ctx) => {
			const state =
				ctx.state.get<AdmissionHandoffRuntimeState<T, R>>() ?? admissionHandoffState<T, R>();
			ctx.state.persist(true);
			let observed = false;
			for (const raw of depBatch(ctx, 0) ?? []) {
				observed = true;
				ingestCandidate(ctx as DownCtx<T, R>, state, raw, name, opts.maxPending, opts.maxRecent);
			}
			for (const raw of depBatch(ctx, 1) ?? []) {
				observed = true;
				ingestDecision(ctx as DownCtx<T, R>, state, raw, name, opts.maxPending, opts.maxRecent);
			}
			if (observed) emitCursor(ctx as DownCtx<T, R>, state);
			ctx.state.set(state);
		},
		{
			name: `${name}/correlation`,
			factory: "admissionHandoffCorrelation",
			partial: true,
			completeWhenDepsComplete: false,
			errorWhenDepsError: false,
			meta: {
				pattern: "admission-handoff",
				role: "correlation-authority",
				maxPending: opts.maxPending,
				maxRecent: opts.maxRecent,
			},
		},
	);

	const admitted = projectRuntimeFact(
		graph,
		runtime,
		`${name}/admitted`,
		"admissionHandoffAdmitted",
		(fact) => (fact.kind === "accepted" ? fact.value : undefined),
	);
	const pullId = Symbol(`${name}/accepted`);
	const accepted = graph.node<AdmissionHandoffAccepted<T, R>>([admitted], null, {
		name: `${name}/accepted`,
		factory: "admissionHandoffAccepted",
		pullId,
		pausable: "resumeAll",
		meta: { pattern: "admission-handoff", role: "quiet-causal-boundary" },
	});
	const releaseController = graph.node(
		[admitted, accepted],
		(ctx) => {
			const state = ctx.state.get<{ seen: Set<string>; order: string[] }>() ?? {
				seen: new Set<string>(),
				order: [],
			};
			let fresh = false;
			for (const raw of depBatch(ctx, 0) ?? []) {
				const admittedValue = raw as AdmissionHandoffAccepted<T, R>;
				const key = JSON.stringify([
					admittedValue.candidateFingerprint,
					admittedValue.decisionFingerprint,
				]);
				if (state.seen.has(key)) continue;
				state.seen.add(key);
				state.order.push(key);
				fresh = true;
			}
			while (state.order.length > opts.maxRecent) {
				const expired = state.order.shift();
				if (expired !== undefined) state.seen.delete(expired);
			}
			ctx.state.set(state);
			if (fresh) ctx.upNext([["PULL", { pullId }]], 1);
		},
		{
			name: `${name}/release-controller`,
			factory: "admissionHandoffReleaseController",
			partial: true,
			completeWhenDepsComplete: false,
			errorWhenDepsError: false,
			meta: { pattern: "admission-handoff", role: "admission-release" },
		},
	);
	let releaseKeepalive: (() => void) | undefined = graph.retain(releaseController, {
		reason: `${name}.release-controller`,
	});

	return {
		candidates: opts.candidates,
		decisions: opts.decisions,
		accepted,
		rejected: projectRuntimeFact(
			graph,
			runtime,
			`${name}/rejected`,
			"admissionHandoffRejected",
			(fact) => (fact.kind === "rejected" ? fact.value : undefined),
		),
		status: projectRuntimeFact(
			graph,
			runtime,
			`${name}/status`,
			"admissionHandoffStatus",
			(fact) => (fact.kind === "status" ? fact.value : undefined),
		),
		issues: projectRuntimeFact(
			graph,
			runtime,
			`${name}/issues`,
			"admissionHandoffIssues",
			(fact) => (fact.kind === "issue" ? fact.value : undefined),
		),
		cursor: projectRuntimeFact(
			graph,
			runtime,
			`${name}/cursor`,
			"admissionHandoffCursor",
			(fact) => (fact.kind === "cursor" ? fact.value : undefined),
		),
		release(): void {
			releaseKeepalive?.();
			releaseKeepalive = undefined;
		},
	};
}

function admissionHandoffState<T, R>(): AdmissionHandoffRuntimeState<T, R> {
	return {
		pendingCandidates: new Map(),
		pendingDecisions: new Map(),
		pendingDecisionOwners: new Map(),
		terminals: new Map(),
		terminalOrder: [],
		recentDecisions: new Map(),
		recentDecisionOrder: [],
		sequence: 0,
		issueSequence: 0,
		statusSequence: 0,
	};
}

function ingestCandidate<T, R>(
	ctx: DownCtx<T, R>,
	state: AdmissionHandoffRuntimeState<T, R>,
	raw: unknown,
	name: string,
	maxPending: number,
	maxRecent: number,
): void {
	if (!isCandidate<T>(raw)) {
		emitIssue(ctx, state, name, "malformed-candidate", "Candidate DATA is malformed.");
		return;
	}
	const candidate = raw;
	const terminal = state.terminals.get(candidate.candidateId);
	if (terminal !== undefined) {
		if (terminal.value.candidateFingerprint === candidate.candidateFingerprint) {
			emitStatus(ctx, state, name, "replayed", candidate.candidateId);
		} else {
			emitIssue(
				ctx,
				state,
				name,
				"candidate-identity-conflict",
				"Candidate identity was replayed with a different fingerprint.",
				candidate.candidateId,
			);
		}
		return;
	}
	const existing = state.pendingCandidates.get(candidate.candidateId);
	if (existing !== undefined) {
		if (existing.candidateFingerprint === candidate.candidateFingerprint)
			emitStatus(ctx, state, name, "replayed", candidate.candidateId);
		else
			emitIssue(
				ctx,
				state,
				name,
				"candidate-identity-conflict",
				"Pending candidate identity was reused with a different fingerprint.",
				candidate.candidateId,
			);
		return;
	}
	const decision = state.pendingDecisions.get(candidate.candidateId);
	if (decision !== undefined) {
		state.pendingDecisions.delete(candidate.candidateId);
		state.pendingDecisionOwners.delete(decision.decisionId);
		if (decision.candidateFingerprint !== candidate.candidateFingerprint) {
			rememberDecision(state, decision, maxRecent);
			emitIssue(
				ctx,
				state,
				name,
				"candidate-fingerprint-mismatch",
				"Decision candidate fingerprint does not match the candidate.",
				candidate.candidateId,
				decision.decisionId,
			);
			storeCandidate(ctx, state, candidate, name, maxPending);
			return;
		}
		settle(ctx, state, candidate, decision, name, maxRecent);
		return;
	}
	storeCandidate(ctx, state, candidate, name, maxPending);
}

function ingestDecision<T, R>(
	ctx: DownCtx<T, R>,
	state: AdmissionHandoffRuntimeState<T, R>,
	raw: unknown,
	name: string,
	maxPending: number,
	maxRecent: number,
): void {
	if (!isDecision<R>(raw)) {
		emitIssue(ctx, state, name, "malformed-decision", "Decision DATA is malformed.");
		return;
	}
	const decision = raw;
	const terminal = state.terminals.get(decision.candidateId);
	if (terminal !== undefined) {
		if (
			terminal.value.decisionId === decision.decisionId &&
			terminal.value.decisionFingerprint === decision.decisionFingerprint &&
			terminal.value.candidateFingerprint === decision.candidateFingerprint
		)
			emitStatus(ctx, state, name, "replayed", decision.candidateId, decision.decisionId);
		else
			emitIssue(
				ctx,
				state,
				name,
				"terminal-decision-conflict",
				"Candidate already has a different terminal decision.",
				decision.candidateId,
				decision.decisionId,
			);
		return;
	}
	const recent = state.recentDecisions.get(decision.decisionId);
	if (recent !== undefined) {
		if (
			recent.decisionFingerprint === decision.decisionFingerprint &&
			recent.candidateId === decision.candidateId
		)
			emitStatus(ctx, state, name, "replayed", decision.candidateId, decision.decisionId);
		else
			emitIssue(
				ctx,
				state,
				name,
				"decision-identity-conflict",
				"Decision identity was reused with different coordinates.",
				decision.candidateId,
				decision.decisionId,
			);
		return;
	}
	const owner = state.pendingDecisionOwners.get(decision.decisionId);
	if (owner !== undefined) {
		const existing = state.pendingDecisions.get(owner);
		if (
			existing?.decisionFingerprint === decision.decisionFingerprint &&
			existing.candidateId === decision.candidateId
		)
			emitStatus(ctx, state, name, "replayed", decision.candidateId, decision.decisionId);
		else
			emitIssue(
				ctx,
				state,
				name,
				"decision-identity-conflict",
				"Pending decision identity was reused with different coordinates.",
				decision.candidateId,
				decision.decisionId,
			);
		return;
	}
	const existingForCandidate = state.pendingDecisions.get(decision.candidateId);
	if (existingForCandidate !== undefined) {
		emitIssue(
			ctx,
			state,
			name,
			"terminal-decision-conflict",
			"Candidate already has a different pending decision.",
			decision.candidateId,
			decision.decisionId,
		);
		return;
	}
	const candidate = state.pendingCandidates.get(decision.candidateId);
	if (candidate !== undefined) {
		if (decision.candidateFingerprint !== candidate.candidateFingerprint) {
			rememberDecision(state, decision, maxRecent);
			emitIssue(
				ctx,
				state,
				name,
				"candidate-fingerprint-mismatch",
				"Decision candidate fingerprint does not match the candidate.",
				candidate.candidateId,
				decision.decisionId,
			);
			return;
		}
		state.pendingCandidates.delete(candidate.candidateId);
		settle(ctx, state, candidate, decision, name, maxRecent);
		return;
	}
	if (pendingSize(state) >= maxPending) {
		emitIssue(
			ctx,
			state,
			name,
			"pending-capacity-exceeded",
			"Admission handoff pending capacity was exhausted; decision failed closed.",
			decision.candidateId,
			decision.decisionId,
		);
		return;
	}
	state.pendingDecisions.set(decision.candidateId, decision);
	state.pendingDecisionOwners.set(decision.decisionId, decision.candidateId);
	emitStatus(ctx, state, name, "decision-pending", decision.candidateId, decision.decisionId);
}

function storeCandidate<T, R>(
	ctx: DownCtx<T, R>,
	state: AdmissionHandoffRuntimeState<T, R>,
	candidate: AdmissionHandoffCandidate<T>,
	name: string,
	maxPending: number,
): void {
	if (pendingSize(state) >= maxPending) {
		emitIssue(
			ctx,
			state,
			name,
			"pending-capacity-exceeded",
			"Admission handoff pending capacity was exhausted; candidate failed closed.",
			candidate.candidateId,
		);
		return;
	}
	state.pendingCandidates.set(candidate.candidateId, candidate);
	emitStatus(ctx, state, name, "candidate-pending", candidate.candidateId);
}

function settle<T, R>(
	ctx: DownCtx<T, R>,
	state: AdmissionHandoffRuntimeState<T, R>,
	candidate: AdmissionHandoffCandidate<T>,
	decision: AdmissionHandoffDecision<R>,
	name: string,
	maxRecent: number,
): void {
	state.pendingCandidates.delete(candidate.candidateId);
	state.pendingDecisions.delete(candidate.candidateId);
	state.pendingDecisionOwners.delete(decision.decisionId);
	rememberDecision(state, decision, maxRecent);
	const common = {
		candidateId: candidate.candidateId,
		candidateFingerprint: candidate.candidateFingerprint,
		decisionId: decision.decisionId,
		decisionFingerprint: decision.decisionFingerprint,
		value: candidate.value,
		...(decision.reason === undefined ? {} : { reason: decision.reason }),
	};
	const terminal: Terminal<T, R> =
		decision.state === "admitted"
			? {
					state: "accepted",
					value: Object.freeze({ kind: "admission-handoff-accepted" as const, ...common }),
				}
			: {
					state: "rejected",
					value: Object.freeze({ kind: "admission-handoff-rejected" as const, ...common }),
				};
	state.terminals.set(candidate.candidateId, terminal);
	state.terminalOrder.push(candidate.candidateId);
	while (state.terminalOrder.length > maxRecent) {
		const expiredCandidateId = state.terminalOrder.shift();
		if (expiredCandidateId === undefined) break;
		state.terminals.delete(expiredCandidateId);
	}
	ctx.down([["DATA", { kind: terminal.state, value: terminal.value }]]);
	emitStatus(ctx, state, name, terminal.state, candidate.candidateId, decision.decisionId);
}

function rememberDecision<T, R>(
	state: AdmissionHandoffRuntimeState<T, R>,
	decision: AdmissionHandoffDecision<R>,
	maxRecent: number,
): void {
	if (state.recentDecisions.has(decision.decisionId)) return;
	state.recentDecisions.set(decision.decisionId, {
		decisionId: decision.decisionId,
		decisionFingerprint: decision.decisionFingerprint,
		candidateId: decision.candidateId,
	});
	state.recentDecisionOrder.push(decision.decisionId);
	while (state.recentDecisionOrder.length > maxRecent) {
		const expired = state.recentDecisionOrder.shift();
		if (expired === undefined) break;
		state.recentDecisions.delete(expired);
	}
}

function emitStatus<T, R>(
	ctx: DownCtx<T, R>,
	state: AdmissionHandoffRuntimeState<T, R>,
	name: string,
	statusState: AdmissionHandoffStatusState,
	candidateId?: string,
	decisionId?: string,
	issueCode?: AdmissionHandoffIssueCode,
): void {
	state.sequence += 1;
	state.statusSequence += 1;
	ctx.down([
		[
			"DATA",
			{
				kind: "status",
				value: Object.freeze({
					kind: "admission-handoff-status" as const,
					statusId: `${name}/status/${state.statusSequence}`,
					state: statusState,
					...(candidateId === undefined ? {} : { candidateId }),
					...(decisionId === undefined ? {} : { decisionId }),
					...(issueCode === undefined ? {} : { issueCode }),
				}),
			},
		],
	]);
}

function emitIssue<T, R>(
	ctx: DownCtx<T, R>,
	state: AdmissionHandoffRuntimeState<T, R>,
	name: string,
	code: AdmissionHandoffIssueCode,
	message: string,
	candidateId?: string,
	decisionId?: string,
): void {
	state.sequence += 1;
	state.issueSequence += 1;
	ctx.down([
		[
			"DATA",
			{
				kind: "issue",
				value: Object.freeze({
					kind: "admission-handoff-issue" as const,
					issueId: `${name}/issue/${state.issueSequence}`,
					code,
					message,
					...(candidateId === undefined ? {} : { candidateId }),
					...(decisionId === undefined ? {} : { decisionId }),
				}),
			},
		],
	]);
	emitStatus(ctx, state, name, "issue", candidateId, decisionId, code);
}

function emitCursor<T, R>(ctx: DownCtx<T, R>, state: AdmissionHandoffRuntimeState<T, R>): void {
	ctx.down([
		[
			"DATA",
			{
				kind: "cursor",
				value: Object.freeze({
					kind: "admission-handoff-cursor" as const,
					sequence: state.sequence,
					pendingCandidates: state.pendingCandidates.size,
					pendingDecisions: state.pendingDecisions.size,
					recentTerminals: state.terminals.size,
					recentDecisions: state.recentDecisions.size,
				}),
			},
		],
	]);
}

function projectRuntimeFact<T, R, TOut>(
	graph: Graph,
	runtime: Node<AdmissionHandoffRuntimeFact<T, R>>,
	name: string,
	factory: string,
	pick: (fact: AdmissionHandoffRuntimeFact<T, R>) => TOut | undefined,
): Node<TOut> {
	return graph.node<TOut>(
		[runtime],
		(ctx) => {
			for (const raw of depBatch(ctx, 0) ?? []) {
				const value = pick(raw as AdmissionHandoffRuntimeFact<T, R>);
				if (value !== undefined) ctx.down([["DATA", value]]);
			}
		},
		{ name, factory, completeWhenDepsComplete: false, errorWhenDepsError: false },
	);
}

function pendingSize<T, R>(state: AdmissionHandoffRuntimeState<T, R>): number {
	return state.pendingCandidates.size + state.pendingDecisions.size;
}

function isCandidate<T>(raw: unknown): raw is AdmissionHandoffCandidate<T> {
	if (typeof raw !== "object" || raw === null) return false;
	const value = raw as Partial<AdmissionHandoffCandidate<T>>;
	return (
		value.kind === "admission-handoff-candidate" &&
		isIdentity(value.candidateId) &&
		isIdentity(value.candidateFingerprint) &&
		Object.hasOwn(raw, "value")
	);
}

function isDecision<R>(raw: unknown): raw is AdmissionHandoffDecision<R> {
	if (typeof raw !== "object" || raw === null) return false;
	const value = raw as Partial<AdmissionHandoffDecision<R>>;
	return (
		value.kind === "admission-handoff-decision" &&
		isIdentity(value.decisionId) &&
		isIdentity(value.decisionFingerprint) &&
		isIdentity(value.candidateId) &&
		isIdentity(value.candidateFingerprint) &&
		(value.state === "admitted" || value.state === "rejected")
	);
}

function isIdentity(value: unknown): value is string {
	return typeof value === "string" && value.length > 0;
}

function assertPositiveBound(value: number, label: string): void {
	if (!Number.isSafeInteger(value) || value < 1)
		throw new RangeError(`admissionHandoff: ${label} must be a positive safe integer`);
}
