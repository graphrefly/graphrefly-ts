import { canonicalTupleKey } from "../../identity.js";
import type {
	Arrival,
	CausalEvidence,
	CausalOccurrenceRef,
	IdentityDomain,
	TransitionContext,
} from "./contracts.js";
import {
	canonicalEntry,
	canonicalSnapshot,
	dataKey,
	digestPattern,
	exactOccurrence,
	issue,
	pushIssue,
	refKey,
	rejectDefinitiveMissingRef,
	retainDomain,
	retainPending,
	sameRef,
	terminalCoverage,
	validRef,
	validToken,
} from "./identity.js";

/** D160: fixed evidence transition helper; no graph control or retained closure. */
export function emitCoverage<T>(context: TransitionContext<T>, occurrence: CausalOccurrenceRef) {
	const { state, opts, outputs } = context;

	const entries = [...state.evidence.values(), ...state.coverageGaps.values()].filter((value) =>
		sameRef(value.occurrence, occurrence),
	);
	const byKind = new Map(entries.map((value) => [value.evidenceKind, value]));
	const missingKinds = opts.requiredEvidenceKinds.filter((kind) => !byKind.has(kind));
	const terminalGapKinds = opts.requiredEvidenceKinds.filter((kind) => {
		const value = byKind.get(kind);
		return (
			value !== undefined && value.coverage !== "included" && value.coverage !== "external-only"
		);
	});
	outputs.push({
		kind: "coverage",
		value: {
			kind: "causal-evidence-coverage",
			occurrence,
			complete:
				missingKinds.length === 0 &&
				entries.every(
					(value) => value.coverage !== "retention-gap" && value.coverage !== "skipped-revision",
				),
			entries: Object.freeze(entries),
			missingKinds: Object.freeze(missingKinds),
			terminalGapKinds: Object.freeze(terminalGapKinds),
		},
	});
}

/** D160: fixed evidence transition helper; no graph control or retained closure. */
export function retainEvidence<T>(
	context: TransitionContext<T>,
	key: string,
	evidence: CausalEvidence,
) {
	const { state, opts, outputs } = context;

	const prior = state.evidence.get(key);
	if (prior !== undefined) {
		if (dataKey(prior) !== dataKey(evidence))
			pushIssue(
				outputs,
				issue("causal-occurrence/evidence-conflict", "Evidence replay conflicts.", [key]),
			);
		return;
	}
	if (state.evidence.size >= opts.maxEvidence) {
		pushIssue(
			outputs,
			issue("causal-occurrence/evidence-bound", "Evidence retention bound was reached.", [key]),
		);
		// One persistent gap per occurrence/required kind, plus one optional-kind
		// representative: bounded by maxOccurrences * (required kinds + 1).
		// Overflow details cannot consume maxPending or erase a known coverage gap.
		const gapKey = JSON.stringify([
			refKey(evidence.occurrence),
			opts.requiredEvidenceKinds.includes(evidence.evidenceKind) ? evidence.evidenceKind : null,
		]);
		if (!state.coverageGaps.has(gapKey))
			state.coverageGaps.set(
				gapKey,
				canonicalSnapshot({ ...evidence, coverage: "retention-gap" as const }),
			);
	} else {
		state.evidence.set(key, evidence);
	}
	emitCoverage(context, evidence.occurrence);
}

/** D160: fixed evidence transition helper; no graph control or retained closure. */
export function flushEvidence<T>(context: TransitionContext<T>) {
	const { state } = context;

	for (const [key, evidence] of state.pendingEvidence) {
		if (exactOccurrence(context, evidence.occurrence) === undefined) {
			if (rejectDefinitiveMissingRef(context, evidence.occurrence, "evidence"))
				state.pendingEvidence.delete(key);
			continue;
		}
		retainEvidence(context, key, evidence);
		state.pendingEvidence.delete(key);
	}
}

/** D160: fixed evidence transition helper; no graph control or retained closure. */
export function receiveEvidence<T>(
	context: TransitionContext<T>,
	arrival: Extract<Arrival<T>, { lane: "evidence" }>,
) {
	const { state, opts, outputs } = context;

	for (const evidence of arrival.values) {
		if (
			evidence === null ||
			typeof evidence !== "object" ||
			!validRef(evidence.occurrence) ||
			!validToken(evidence.evidenceKind) ||
			!validToken(evidence.evidenceId) ||
			typeof evidence.evidenceDigest !== "string" ||
			!digestPattern.test(evidence.evidenceDigest) ||
			!terminalCoverage.has(evidence.coverage) ||
			(evidence.coverage === "external-only" &&
				(!Array.isArray(evidence.refs) ||
					evidence.refs.length === 0 ||
					!evidence.refs.every(validToken)))
		) {
			pushIssue(
				outputs,
				issue(
					"causal-occurrence/evidence-mismatch",
					"Evidence does not match retained occurrence authority.",
				),
			);
			continue;
		}
		const canonical = canonicalEntry(evidence);
		if (canonical === undefined) {
			pushIssue(
				outputs,
				issue("causal-occurrence/non-data-evidence", "Evidence must be canonical DATA."),
			);
			continue;
		}
		if (!retainDomain(context, evidence.occurrence.revisionDomain)) continue;
		const key = canonicalTupleKey([
			refKey(evidence.occurrence),
			evidence.evidenceKind,
			evidence.evidenceId,
		]);
		if (exactOccurrence(context, evidence.occurrence) === undefined) {
			if (rejectDefinitiveMissingRef(context, evidence.occurrence, "evidence")) continue;
			retainPending(opts, outputs, state.pendingEvidence, key, canonical.snapshot, "evidence");
			continue;
		}
		retainEvidence(context, key, canonical.snapshot);
	}
}

/** D160: fixed evidence transition helper; no graph control or retained closure. */
export function isEvidenceTerminal<T>(
	context: TransitionContext<T>,
	revisionDomain: string,
	domain: IdentityDomain<T>,
) {
	const { state, opts } = context;

	const { watermark, occurrences } = domain;
	const evidenceTerminal =
		![...state.pendingEvidence.values()].some(
			(evidence) =>
				evidence.occurrence.revisionDomain === revisionDomain &&
				evidence.occurrence.revision <= watermark,
		) &&
		occurrences.every((occurrence) =>
			opts.requiredEvidenceKinds.every((kind) =>
				[...state.evidence.values(), ...state.coverageGaps.values()].some(
					(entry) =>
						sameRef(entry.occurrence, occurrence) &&
						entry.evidenceKind === kind &&
						terminalCoverage.has(entry.coverage),
				),
			),
		);
	return evidenceTerminal;
}
