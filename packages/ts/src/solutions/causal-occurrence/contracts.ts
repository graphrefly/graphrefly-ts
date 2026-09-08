import type { DataIssue, DataResult } from "../../data/index.js";
import type { StartupFact } from "../../graph/construction-scope.js";
import type { Node } from "../../node/node.js";
export interface CausalSourceRef {
	readonly kind: string;
	readonly id: string;
}

export interface CausalOccurrenceRef {
	readonly revisionDomain: string;
	readonly occurrenceId: string;
	readonly revision: number;
	readonly digest: string;
	readonly sourceRefs: readonly CausalSourceRef[];
}

export interface CausalOccurrence<T> extends CausalOccurrenceRef {
	readonly value: T;
}

export interface CausalOccurrenceAdmission {
	readonly occurrence: CausalOccurrenceRef;
	readonly decisionId: string;
	readonly decisionDigest: string;
	readonly state: "admitted" | "rejected";
}

export interface CausalBranchTerminal<T = unknown, E extends DataIssue = DataIssue> {
	readonly occurrence: CausalOccurrenceRef;
	readonly branch: string;
	readonly state: "completed" | "failed" | "skipped";
	readonly result: DataResult<T, E>;
}

export interface CausalEffectProposal {
	readonly occurrence: CausalOccurrenceRef;
	readonly effectId: string;
	readonly requestRef: CausalSourceRef;
	readonly proposalDigest: string;
}

export interface CausalEffectAdmission {
	readonly occurrence: CausalOccurrenceRef;
	readonly effectId: string;
	readonly requestRef: CausalSourceRef;
	readonly admissionRef: CausalSourceRef;
	readonly proposalDigest: string;
	readonly state: "admitted" | "rejected";
}

export type CausalEffectOutcomeState =
	| "succeeded"
	| "failed"
	| "cancelled"
	| "reconcile-required"
	| "unknown";

export interface CausalEffectOutcome<T = unknown, E extends DataIssue = DataIssue> {
	readonly occurrence: CausalOccurrenceRef;
	readonly effectId: string;
	readonly requestRef: CausalSourceRef;
	readonly admissionRef: CausalSourceRef;
	readonly proposalDigest: string;
	readonly state: CausalEffectOutcomeState;
	/** D184 passive DATA result. Failure never travels as protocol ERROR. */
	readonly result: DataResult<T, E>;
}

export type CausalEvidenceCoverageState =
	| "included"
	| "excluded"
	| "redacted"
	| "sampled"
	| "external-only"
	| "stale"
	| "unavailable"
	| "retention-gap"
	| "skipped-revision";

export interface CausalEvidence {
	readonly occurrence: CausalOccurrenceRef;
	readonly evidenceKind: string;
	readonly evidenceId: string;
	readonly evidenceDigest: string;
	readonly coverage: CausalEvidenceCoverageState;
	readonly refs?: readonly string[];
}

export interface CausalWatermark {
	readonly revisionDomain: string;
	readonly revision: number;
}

export interface CausalCurrentness {
	readonly kind: "causal-currentness";
	readonly occurrence: CausalOccurrenceRef;
	readonly evaluatedThroughRevision: number;
	readonly state: "current" | "superseded" | "stale" | "unverifiable";
	readonly supersededBy?: CausalOccurrenceRef;
	readonly missingRevision?: number;
	readonly gapRef?: Readonly<{
		readonly revisionDomain: string;
		readonly afterRevision: number;
		readonly beforeRevision?: number;
		readonly reason: "skipped-revision" | "retention-gap";
		readonly evidenceRef?: CausalSourceRef;
	}>;
}

export interface CausalTerminalFanIn {
	readonly kind: "causal-terminal-fan-in";
	readonly occurrence: CausalOccurrenceRef;
	readonly terminals: readonly CausalBranchTerminal[];
}

export interface CausalEffectConservation {
	readonly kind: "causal-effect-conservation";
	readonly occurrence: CausalOccurrenceRef;
	readonly proposed: number;
	readonly pendingAdmission: number;
	readonly rejected: number;
	readonly admitted: number;
	readonly active: number;
	readonly succeeded: number;
	readonly failed: number;
	readonly cancelled: number;
	readonly reconcileRequired: number;
	readonly unknown: number;
}

export interface CausalEvidenceCoverage {
	readonly kind: "causal-evidence-coverage";
	readonly occurrence: CausalOccurrenceRef;
	readonly complete: boolean;
	readonly entries: readonly CausalEvidence[];
	readonly missingKinds: readonly string[];
	readonly terminalGapKinds: readonly string[];
}

export interface CausalQuiescence {
	readonly kind: "causal-quiescence";
	readonly revisionDomain: string;
	readonly evaluatedThroughRevision: number;
	readonly lifecycle: boolean;
	readonly retainedEvidence: boolean;
	readonly pendingOccurrenceRefs: readonly CausalOccurrenceRef[];
	readonly pendingEffectIds: readonly string[];
}

export interface CausalOccurrenceBundle<T> {
	readonly startup: Node<StartupFact>;
	readonly released: Node<CausalOccurrence<T>>;
	readonly currentness: Node<CausalCurrentness>;
	readonly terminals: Node<CausalTerminalFanIn>;
	readonly conservation: Node<CausalEffectConservation>;
	readonly coverage: Node<CausalEvidenceCoverage>;
	readonly quiescence: Node<CausalQuiescence>;
	readonly issues: Node<DataIssue>;
}

export interface CausalOccurrenceBundleOptions<T> {
	readonly name: string;
	readonly occurrences: Node<CausalOccurrence<T>>;
	readonly admissions: Node<CausalOccurrenceAdmission>;
	readonly branchTerminals: Node<CausalBranchTerminal>;
	readonly effectProposals: Node<CausalEffectProposal>;
	readonly effectAdmissions: Node<CausalEffectAdmission>;
	readonly effectOutcomes: Node<CausalEffectOutcome>;
	readonly evidence: Node<CausalEvidence>;
	readonly watermarks: Node<CausalWatermark>;
	readonly requiredBranches: readonly string[];
	readonly requiredEvidenceKinds: readonly string[];
	readonly maxOccurrences: number;
	readonly maxPending: number;
	readonly maxEffects: number;
	readonly maxEvidence: number;
}

export type Arrival<T> =
	| Readonly<{ lane: "occurrences"; values: readonly CausalOccurrence<T>[] }>
	| Readonly<{ lane: "admissions"; values: readonly CausalOccurrenceAdmission[] }>
	| Readonly<{ lane: "branch-terminals"; values: readonly CausalBranchTerminal[] }>
	| Readonly<{ lane: "effect-proposals"; values: readonly CausalEffectProposal[] }>
	| Readonly<{ lane: "effect-admissions"; values: readonly CausalEffectAdmission[] }>
	| Readonly<{ lane: "effect-outcomes"; values: readonly CausalEffectOutcome[] }>
	| Readonly<{ lane: "evidence"; values: readonly CausalEvidence[] }>
	| Readonly<{ lane: "watermarks"; values: readonly CausalWatermark[] }>;

export type AuthorityFact<T> =
	| Readonly<{ kind: "release"; value: CausalOccurrence<T> }>
	| Readonly<{ kind: "currentness"; value: CausalCurrentness }>
	| Readonly<{ kind: "terminal"; value: CausalTerminalFanIn }>
	| Readonly<{ kind: "conservation"; value: CausalEffectConservation }>
	| Readonly<{ kind: "coverage"; value: CausalEvidenceCoverage }>
	| Readonly<{ kind: "quiescence"; value: CausalQuiescence }>
	| Readonly<{ kind: "issue"; value: DataIssue }>;

export interface RetainedOccurrence<T> {
	readonly value: CausalOccurrence<T>;
	readonly key: string;
}

export interface EffectRecord {
	readonly proposal: CausalEffectProposal;
	readonly key: string;
	readonly admission?: CausalEffectAdmission;
	readonly outcome?: CausalEffectOutcome;
}

export interface IdentityState<T> {
	domains: Set<string>;
	highWaterByDomain: Map<string, number>;
	retentionFloorByDomain: Map<string, number>;
	byRevision: Map<string, RetainedOccurrence<T>>;
	pending: Map<string, RetainedOccurrence<T>>;
	admissions: Map<string, CausalOccurrenceAdmission>;
	released: Set<string>;
	watermarks: Map<string, number>;
	currentness: Map<string, CausalCurrentness>;
	retentionGapThroughByDomain: Map<string, number>;
}

export interface LifecycleState {
	terminals: Map<string, Map<string, CausalBranchTerminal>>;
	emittedTerminals: Set<string>;
	effects: Map<string, EffectRecord>;
	pendingTerminals: Map<string, CausalBranchTerminal>;
	pendingEffectProposals: Map<string, CausalEffectProposal>;
	pendingEffectAdmissions: Map<string, CausalEffectAdmission>;
	pendingEffectOutcomes: Map<string, CausalEffectOutcome>;
}

export interface EvidenceState {
	evidence: Map<string, CausalEvidence>;
	pendingEvidence: Map<string, CausalEvidence>;
	coverageGaps: Map<string, CausalEvidence>;
	occurrenceRetentionGaps: Map<string, CausalEvidence>;
}

export interface CoordinationState {
	quiescence: Map<string, CausalQuiescence>;
}

export interface RuntimeState<T>
	extends IdentityState<T>,
		LifecycleState,
		EvidenceState,
		CoordinationState {}
export type TransitionOptions = Pick<
	CausalOccurrenceBundleOptions<unknown>,
	| "requiredBranches"
	| "requiredEvidenceKinds"
	| "maxOccurrences"
	| "maxPending"
	| "maxEffects"
	| "maxEvidence"
>;
export interface IdentityDomain<T> {
	readonly watermark: number;
	readonly occurrences: CausalOccurrence<T>[];
	readonly sequenceComplete: boolean;
	readonly latestAdmitted: Map<string, CausalOccurrence<T>>;
}

/** Private synchronous transition context. No Graph, dispatcher, subscription or I/O capability. */
export interface TransitionContext<T> {
	readonly state: RuntimeState<T>;
	readonly opts: TransitionOptions;
	readonly outputs: AuthorityFact<T>[];
}
