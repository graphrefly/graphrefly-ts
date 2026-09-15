import { canonicalTupleKey } from "../../identity.js";
import type {
	Arrival,
	CausalBranchTerminal,
	CausalEffectOutcomeState,
	CausalEffectProposal,
	CausalOccurrence,
	CausalOccurrenceRef,
	IdentityDomain,
	TransitionContext,
} from "./contracts.js";
import {
	canonicalEntry,
	dataKey,
	digestPattern,
	effectKey,
	exactAdmission,
	exactOccurrence,
	issue,
	occurrenceIdKey,
	pushIssue,
	refKey,
	rejectDefinitiveMissingRef,
	retainDomain,
	retainPending,
	sameRef,
	validAdmissionState,
	validOutcomeState,
	validRef,
	validResult,
	validSourceRef,
	validTerminal,
	validToken,
} from "./identity.js";

/** D160: fixed lifecycle transition helper; no graph control or retained closure. */
export function settledForEviction<T>(
	context: TransitionContext<T>,
	occurrence: CausalOccurrence<T>,
) {
	const { state } = context;

	const key = refKey(occurrence);
	const admission = state.admissions.get(key);
	if (admission?.state === "rejected") return true;
	if (
		admission?.state !== "admitted" ||
		!state.released.has(key) ||
		!state.emittedTerminals.has(key)
	)
		return false;
	if (
		[
			...state.pendingEffectProposals.values(),
			...state.pendingEffectAdmissions.values(),
			...state.pendingEffectOutcomes.values(),
		].some((fact) => sameRef(fact.occurrence, occurrence))
	)
		return false;
	return [...state.effects.values()]
		.filter((record) => sameRef(record.proposal.occurrence, occurrence))
		.every(
			(record) =>
				record.admission?.state === "rejected" ||
				(record.admission?.state === "admitted" && record.outcome !== undefined),
		);
}

/** D160: fixed lifecycle transition helper; no graph control or retained closure. */
export function emitConservation<T>(
	context: TransitionContext<T>,
	occurrence: CausalOccurrenceRef,
) {
	const { state, outputs } = context;

	const records = [...state.effects.values()].filter((record) =>
		sameRef(record.proposal.occurrence, occurrence),
	);
	const admitted = records.filter((record) => record.admission?.state === "admitted");
	const count = (value: CausalEffectOutcomeState) =>
		admitted.filter((record) => record.outcome?.state === value).length;
	outputs.push({
		kind: "conservation",
		value: {
			kind: "causal-effect-conservation",
			occurrence,
			proposed: records.length,
			pendingAdmission: records.filter((record) => record.admission === undefined).length,
			rejected: records.filter((record) => record.admission?.state === "rejected").length,
			admitted: admitted.length,
			active: admitted.filter((record) => record.outcome === undefined).length,
			succeeded: count("succeeded"),
			failed: count("failed"),
			cancelled: count("cancelled"),
			reconcileRequired: count("reconcile-required"),
			unknown: count("unknown"),
		},
	});
}

/** D160: fixed lifecycle transition helper; no graph control or retained closure. */
export function retainEffectProposal<T>(
	context: TransitionContext<T>,
	key: string,
	proposal: CausalEffectProposal,
) {
	const { state, opts, outputs } = context;

	const pending = state.pendingEffectProposals.get(key);
	if (pending !== undefined && dataKey(pending) !== dataKey(proposal)) {
		pushIssue(
			outputs,
			issue(
				"causal-occurrence/effect-proposal-conflict",
				"Effect proposal conflicts with its retained pending snapshot.",
				[key],
			),
		);
		return true;
	}
	const prior = state.effects.get(key);
	if (prior !== undefined) {
		if (prior.key !== dataKey(proposal))
			pushIssue(
				outputs,
				issue("causal-occurrence/effect-proposal-conflict", "Effect proposal replay conflicts.", [
					key,
				]),
			);
		return true;
	}
	if (state.effects.size >= opts.maxEffects) {
		pushIssue(
			outputs,
			issue("causal-occurrence/effect-bound", "Effect retention bound was reached.", [key]),
		);
		return false;
	}
	state.effects.set(key, { proposal, key: dataKey(proposal) });
	context.committedViewChanged = true;
	emitConservation(context, proposal.occurrence);
	return true;
}

/** D160: fixed lifecycle transition helper; no graph control or retained closure. */
export function flushEffectsAndTerminals<T>(context: TransitionContext<T>) {
	const { state, opts, outputs } = context;

	for (const [key, proposal] of state.pendingEffectProposals) {
		if (
			exactOccurrence(context, proposal.occurrence) === undefined &&
			rejectDefinitiveMissingRef(context, proposal.occurrence, "effect-proposal")
		) {
			state.pendingEffectProposals.delete(key);
			continue;
		}
		if (
			exactOccurrence(context, proposal.occurrence) === undefined ||
			!state.released.has(refKey(proposal.occurrence))
		)
			continue;
		if (retainEffectProposal(context, key, proposal)) state.pendingEffectProposals.delete(key);
	}
	for (const [key, admission] of state.pendingEffectAdmissions) {
		const record = state.effects.get(key);
		if (record === undefined) {
			if (rejectDefinitiveMissingRef(context, admission.occurrence, "effect-admission"))
				state.pendingEffectAdmissions.delete(key);
			continue;
		}
		if (
			record.proposal.proposalDigest !== admission.proposalDigest ||
			dataKey(record.proposal.requestRef) !== dataKey(admission.requestRef) ||
			!sameRef(record.proposal.occurrence, admission.occurrence)
		) {
			pushIssue(
				outputs,
				issue(
					"causal-occurrence/effect-admission-mismatch",
					"Deferred effect admission does not match its proposal.",
					[key],
				),
			);
			state.pendingEffectAdmissions.delete(key);
			continue;
		}
		if (record.admission === undefined) {
			state.effects.set(key, { ...record, admission });
			context.committedViewChanged = true;
		} else if (dataKey(record.admission) !== dataKey(admission))
			pushIssue(
				outputs,
				issue(
					"causal-occurrence/effect-admission-conflict",
					"Deferred effect admission conflicts with retained admission.",
					[key],
				),
			);
		state.pendingEffectAdmissions.delete(key);
		emitConservation(context, admission.occurrence);
	}
	for (const [key, outcome] of state.pendingEffectOutcomes) {
		const record = state.effects.get(key);
		if (record?.admission === undefined) {
			if (rejectDefinitiveMissingRef(context, outcome.occurrence, "effect-outcome"))
				state.pendingEffectOutcomes.delete(key);
			continue;
		}
		const matches =
			record.admission.state === "admitted" &&
			record.proposal.proposalDigest === outcome.proposalDigest &&
			dataKey(record.proposal.requestRef) === dataKey(outcome.requestRef) &&
			dataKey(record.admission.admissionRef) === dataKey(outcome.admissionRef) &&
			sameRef(record.proposal.occurrence, outcome.occurrence) &&
			(outcome.state === "succeeded") === (outcome.result.kind === "ok");
		if (!matches) {
			pushIssue(
				outputs,
				issue(
					"causal-occurrence/effect-outcome-mismatch",
					"Deferred effect outcome lacks exact admitted authority.",
					[key],
				),
			);
			state.pendingEffectOutcomes.delete(key);
			continue;
		}
		if (record.outcome === undefined) {
			state.effects.set(key, { ...record, outcome });
			context.committedViewChanged = true;
		} else if (dataKey(record.outcome) !== dataKey(outcome))
			pushIssue(
				outputs,
				issue(
					"causal-occurrence/effect-outcome-conflict",
					"Deferred effect outcome conflicts with retained outcome.",
					[key],
				),
			);
		state.pendingEffectOutcomes.delete(key);
		emitConservation(context, outcome.occurrence);
	}
	for (const [pendingKey, terminal] of state.pendingTerminals) {
		const key = refKey(terminal.occurrence);
		if (
			exactOccurrence(context, terminal.occurrence) === undefined &&
			rejectDefinitiveMissingRef(context, terminal.occurrence, "terminal")
		) {
			state.pendingTerminals.delete(pendingKey);
			continue;
		}
		if (exactOccurrence(context, terminal.occurrence) === undefined || !state.released.has(key))
			continue;
		const branches = state.terminals.get(key) ?? new Map<string, CausalBranchTerminal>();
		const prior = branches.get(terminal.branch);
		if (prior === undefined) branches.set(terminal.branch, terminal);
		else if (dataKey(prior) !== dataKey(terminal))
			pushIssue(
				outputs,
				issue(
					"causal-occurrence/terminal-conflict",
					"Deferred branch terminal conflicts with retained terminal.",
					[key, terminal.branch],
				),
			);
		state.terminals.set(key, branches);
		state.pendingTerminals.delete(pendingKey);
		if (
			!state.emittedTerminals.has(key) &&
			opts.requiredBranches.every((branch) => branches.has(branch))
		) {
			state.emittedTerminals.add(key);
			outputs.push({
				kind: "terminal",
				value: {
					kind: "causal-terminal-fan-in",
					occurrence: terminal.occurrence,
					terminals: Object.freeze(opts.requiredBranches.map((branch) => branches.get(branch)!)),
				},
			});
		}
	}
}

/** D160: fixed lifecycle transition helper; no graph control or retained closure. */
export function receiveTerminals<T>(
	context: TransitionContext<T>,
	arrival: Extract<Arrival<T>, { lane: "branch-terminals" }>,
) {
	const { state, opts, outputs } = context;

	for (const terminal of arrival.values) {
		if (
			terminal === null ||
			typeof terminal !== "object" ||
			!validRef(terminal.occurrence) ||
			!validToken(terminal.branch) ||
			!opts.requiredBranches.includes(terminal.branch) ||
			!validTerminal(terminal)
		) {
			pushIssue(
				outputs,
				issue(
					"causal-occurrence/terminal-mismatch",
					"Terminal does not match an admitted branch occurrence.",
				),
			);
			continue;
		}
		const canonical = canonicalEntry(terminal);
		if (canonical === undefined) {
			pushIssue(
				outputs,
				issue("causal-occurrence/non-data-terminal", "Terminal must be canonical DATA."),
			);
			continue;
		}
		if (!retainDomain(context, terminal.occurrence.revisionDomain)) continue;
		const key = refKey(terminal.occurrence);
		const pendingKey = canonicalTupleKey([key, terminal.branch]);
		if (
			exactOccurrence(context, terminal.occurrence) === undefined &&
			rejectDefinitiveMissingRef(context, terminal.occurrence, "terminal")
		)
			continue;
		if (exactOccurrence(context, terminal.occurrence) === undefined || !state.released.has(key)) {
			retainPending(
				opts,
				outputs,
				state.pendingTerminals,
				pendingKey,
				canonical.snapshot,
				"terminal",
			);
			continue;
		}
		const branches = state.terminals.get(key) ?? new Map<string, CausalBranchTerminal>();
		const prior = branches.get(terminal.branch);
		if (prior !== undefined && dataKey(prior) !== canonical.key)
			pushIssue(
				outputs,
				issue(
					"causal-occurrence/terminal-conflict",
					"Branch terminal replay conflicts with retained terminal.",
					[key, terminal.branch],
				),
			);
		else if (prior === undefined) branches.set(terminal.branch, canonical.snapshot);
		state.terminals.set(key, branches);
		if (
			!state.emittedTerminals.has(key) &&
			opts.requiredBranches.every((branch) => branches.has(branch))
		) {
			state.emittedTerminals.add(key);
			outputs.push({
				kind: "terminal",
				value: {
					kind: "causal-terminal-fan-in",
					occurrence: terminal.occurrence,
					terminals: Object.freeze(opts.requiredBranches.map((branch) => branches.get(branch)!)),
				},
			});
		}
	}
}

/** D160: fixed lifecycle transition helper; no graph control or retained closure. */
export function receiveProposals<T>(
	context: TransitionContext<T>,
	arrival: Extract<Arrival<T>, { lane: "effect-proposals" }>,
) {
	const { state, opts, outputs } = context;

	for (const proposal of arrival.values) {
		if (
			proposal === null ||
			typeof proposal !== "object" ||
			!validRef(proposal.occurrence) ||
			!validToken(proposal.effectId) ||
			!validSourceRef(proposal.requestRef) ||
			typeof proposal.proposalDigest !== "string" ||
			!digestPattern.test(proposal.proposalDigest)
		) {
			pushIssue(
				outputs,
				issue(
					"causal-occurrence/effect-proposal-mismatch",
					"Effect proposal lacks exact occurrence authority.",
				),
			);
			continue;
		}
		const canonical = canonicalEntry(proposal);
		if (canonical === undefined) {
			pushIssue(
				outputs,
				issue(
					"causal-occurrence/non-data-effect-proposal",
					"Effect proposal must be canonical DATA.",
				),
			);
			continue;
		}
		if (!retainDomain(context, proposal.occurrence.revisionDomain)) continue;
		const key = effectKey(proposal);
		if (
			exactOccurrence(context, proposal.occurrence) === undefined &&
			rejectDefinitiveMissingRef(context, proposal.occurrence, "effect-proposal")
		)
			continue;
		if (
			exactOccurrence(context, proposal.occurrence) === undefined ||
			!state.released.has(refKey(proposal.occurrence))
		) {
			retainPending(
				opts,
				outputs,
				state.pendingEffectProposals,
				key,
				canonical.snapshot,
				"effect-proposal",
			);
			continue;
		}
		if (!retainEffectProposal(context, key, canonical.snapshot))
			retainPending(
				opts,
				outputs,
				state.pendingEffectProposals,
				key,
				canonical.snapshot,
				"effect-proposal",
			);
	}
}

/** D160: fixed lifecycle transition helper; no graph control or retained closure. */
export function receiveEffectAdmissions<T>(
	context: TransitionContext<T>,
	arrival: Extract<Arrival<T>, { lane: "effect-admissions" }>,
) {
	const { state, opts, outputs } = context;

	for (const admission of arrival.values) {
		if (
			admission === null ||
			typeof admission !== "object" ||
			!validRef(admission.occurrence) ||
			!validToken(admission.effectId) ||
			!validSourceRef(admission.requestRef) ||
			!validSourceRef(admission.admissionRef) ||
			typeof admission.proposalDigest !== "string" ||
			!digestPattern.test(admission.proposalDigest) ||
			!validAdmissionState(admission.state)
		) {
			pushIssue(
				outputs,
				issue(
					"causal-occurrence/invalid-effect-admission",
					"Effect admission identity or state is invalid.",
				),
			);
			continue;
		}
		const canonical = canonicalEntry(admission);
		if (canonical === undefined) {
			pushIssue(
				outputs,
				issue(
					"causal-occurrence/non-data-effect-admission",
					"Effect admission must be canonical DATA.",
				),
			);
			continue;
		}
		if (!retainDomain(context, admission.occurrence.revisionDomain)) continue;
		const key = effectKey(admission);
		const record = state.effects.get(key);
		if (record === undefined) {
			if (rejectDefinitiveMissingRef(context, admission.occurrence, "effect-admission")) continue;
			retainPending(
				opts,
				outputs,
				state.pendingEffectAdmissions,
				key,
				canonical.snapshot,
				"effect-admission",
			);
			continue;
		}
		if (
			record.proposal.proposalDigest !== admission.proposalDigest ||
			dataKey(record.proposal.requestRef) !== dataKey(canonical.snapshot.requestRef) ||
			!sameRef(record.proposal.occurrence, admission.occurrence)
		) {
			pushIssue(
				outputs,
				issue(
					"causal-occurrence/effect-admission-mismatch",
					"Effect admission has no exact proposal.",
					[key],
				),
			);
			continue;
		}
		if (record.admission !== undefined) {
			if (dataKey(record.admission) !== canonical.key)
				pushIssue(
					outputs,
					issue(
						"causal-occurrence/effect-admission-conflict",
						"Effect admission replay conflicts.",
						[key],
					),
				);
			continue;
		}
		state.effects.set(key, { ...record, admission: canonical.snapshot });
		context.committedViewChanged = true;
		emitConservation(context, admission.occurrence);
	}
}

/** D160: fixed lifecycle transition helper; no graph control or retained closure. */
export function receiveOutcomes<T>(
	context: TransitionContext<T>,
	arrival: Extract<Arrival<T>, { lane: "effect-outcomes" }>,
) {
	const { state, opts, outputs } = context;

	for (const outcome of arrival.values) {
		if (
			outcome === null ||
			typeof outcome !== "object" ||
			!validRef(outcome.occurrence) ||
			!validToken(outcome.effectId) ||
			!validSourceRef(outcome.requestRef) ||
			!validSourceRef(outcome.admissionRef) ||
			typeof outcome.proposalDigest !== "string" ||
			!digestPattern.test(outcome.proposalDigest) ||
			!validOutcomeState(outcome.state) ||
			!validResult(outcome.result)
		) {
			pushIssue(
				outputs,
				issue(
					"causal-occurrence/invalid-effect-outcome",
					"Effect outcome identity, state, or D184 result is invalid.",
				),
			);
			continue;
		}
		const canonical = canonicalEntry(outcome);
		if (canonical === undefined) {
			pushIssue(
				outputs,
				issue(
					"causal-occurrence/non-data-effect-outcome",
					"Effect outcome must be canonical DATA.",
				),
			);
			continue;
		}
		const resultMatchesState =
			validResult(outcome.result) &&
			(outcome.state === "succeeded") === (outcome.result.kind === "ok");
		if (!resultMatchesState) {
			pushIssue(
				outputs,
				issue(
					"causal-occurrence/effect-outcome-mismatch",
					"Effect outcome D184 result must match its terminal state.",
				),
			);
			continue;
		}
		if (!retainDomain(context, outcome.occurrence.revisionDomain)) continue;
		const key = effectKey(outcome);
		const record = state.effects.get(key);
		if (record === undefined || record.admission === undefined) {
			if (rejectDefinitiveMissingRef(context, outcome.occurrence, "effect-outcome")) continue;
			retainPending(
				opts,
				outputs,
				state.pendingEffectOutcomes,
				key,
				canonical.snapshot,
				"effect-outcome",
			);
			continue;
		}
		if (
			record.admission.state !== "admitted" ||
			record.proposal.proposalDigest !== outcome.proposalDigest ||
			dataKey(record.proposal.requestRef) !== dataKey(canonical.snapshot.requestRef) ||
			dataKey(record.admission.admissionRef) !== dataKey(canonical.snapshot.admissionRef) ||
			!sameRef(record.proposal.occurrence, outcome.occurrence)
		) {
			pushIssue(
				outputs,
				issue(
					"causal-occurrence/effect-outcome-mismatch",
					"Effect outcome requires exact admitted authority and a D184 result matching its state.",
					[key],
				),
			);
			continue;
		}
		if (record.outcome !== undefined) {
			if (dataKey(record.outcome) !== canonical.key)
				pushIssue(
					outputs,
					issue("causal-occurrence/effect-outcome-conflict", "Effect outcome replay conflicts.", [
						key,
					]),
				);
			continue;
		}
		state.effects.set(key, { ...record, outcome: canonical.snapshot });
		context.committedViewChanged = true;
		emitConservation(context, outcome.occurrence);
	}
}

/** D160: fixed lifecycle transition helper; no graph control or retained closure. */
export function pendingObligations<T>(
	context: TransitionContext<T>,
	revisionDomain: string,
	domain: IdentityDomain<T>,
) {
	const { state } = context;

	const { watermark, occurrences, latestAdmitted } = domain;
	const pending = new Map<string, CausalOccurrenceRef>();
	for (const occurrence of occurrences) {
		const key = refKey(occurrence);
		const admission = exactAdmission(context, occurrence);
		const isLatest = latestAdmitted.get(occurrenceIdKey(occurrence)) === occurrence;
		if (
			admission === undefined ||
			(admission.state === "admitted" && isLatest && !state.released.has(key)) ||
			(state.released.has(key) && !state.emittedTerminals.has(key))
		)
			pending.set(key, occurrence);
	}
	for (const admission of state.admissions.values()) {
		if (
			admission.occurrence.revisionDomain === revisionDomain &&
			admission.occurrence.revision <= watermark &&
			exactOccurrence(context, admission.occurrence) === undefined
		)
			pending.set(refKey(admission.occurrence), admission.occurrence);
	}
	for (const terminal of state.pendingTerminals.values()) {
		if (
			terminal.occurrence.revisionDomain === revisionDomain &&
			terminal.occurrence.revision <= watermark
		)
			pending.set(refKey(terminal.occurrence), terminal.occurrence);
	}
	const pendingEffects = [...state.effects.values()].filter(
		(record) =>
			record.proposal.occurrence.revisionDomain === revisionDomain &&
			record.proposal.occurrence.revision <= watermark &&
			(record.admission === undefined ||
				(record.admission.state === "admitted" && record.outcome === undefined)),
	);
	const pendingEffectIds = new Set(pendingEffects.map((record) => record.proposal.effectId));
	for (const effect of [
		...state.pendingEffectProposals.values(),
		...state.pendingEffectAdmissions.values(),
		...state.pendingEffectOutcomes.values(),
	]) {
		if (
			effect.occurrence.revisionDomain === revisionDomain &&
			effect.occurrence.revision <= watermark
		)
			pendingEffectIds.add(effect.effectId);
	}
	return { pendingOccurrenceRefs: Object.freeze([...pending.values()]), pendingEffectIds };
}
