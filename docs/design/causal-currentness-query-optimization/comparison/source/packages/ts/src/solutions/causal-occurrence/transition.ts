import type { DataIssue } from "../../data/index.js";
import type {
	Arrival,
	AuthorityFact,
	CausalEvidence,
	CausalQuiescence,
	RetainedOccurrence,
	RuntimeState,
	TransitionOptions,
} from "./contracts.js";
import * as evidence from "./evidence.js";
import * as identity from "./identity.js";
import {
	canonicalSnapshot,
	causalOccurrenceDigest,
	dataKey,
	issue,
	pushIssue,
	refKey,
	revisionKey,
	sameRef,
	validRef,
} from "./identity.js";
import * as execution from "./lifecycle.js";

function emptyState<T>(): RuntimeState<T> {
	return {
		domains: new Set(),
		highWaterByDomain: new Map(),
		retentionFloorByDomain: new Map(),
		byRevision: new Map(),
		pending: new Map(),
		admissions: new Map(),
		released: new Set(),
		terminals: new Map(),
		emittedTerminals: new Set(),
		effects: new Map(),
		evidence: new Map(),
		pendingTerminals: new Map(),
		pendingEffectProposals: new Map(),
		pendingEffectAdmissions: new Map(),
		pendingEffectOutcomes: new Map(),
		pendingEvidence: new Map(),
		coverageGaps: new Map(),
		watermarks: new Map(),
		currentness: new Map(),
		quiescence: new Map(),
		retentionGapThroughByDomain: new Map(),
		occurrenceRetentionGaps: new Map(),
	};
}

function cloneState<T>(prior: RuntimeState<T> | undefined): RuntimeState<T> {
	if (prior === undefined) return emptyState();
	return {
		...prior,
		domains: new Set(prior.domains),
		highWaterByDomain: new Map(prior.highWaterByDomain),
		retentionFloorByDomain: new Map(prior.retentionFloorByDomain),
		byRevision: new Map(prior.byRevision),
		pending: new Map(prior.pending),
		admissions: new Map(prior.admissions),
		released: new Set(prior.released),
		terminals: new Map([...prior.terminals].map(([key, value]) => [key, new Map(value)])),
		emittedTerminals: new Set(prior.emittedTerminals),
		effects: new Map(prior.effects),
		evidence: new Map(prior.evidence),
		pendingTerminals: new Map(prior.pendingTerminals),
		pendingEffectProposals: new Map(prior.pendingEffectProposals),
		pendingEffectAdmissions: new Map(prior.pendingEffectAdmissions),
		pendingEffectOutcomes: new Map(prior.pendingEffectOutcomes),
		pendingEvidence: new Map(prior.pendingEvidence),
		coverageGaps: new Map(prior.coverageGaps),
		watermarks: new Map(prior.watermarks),
		currentness: new Map(prior.currentness),
		quiescence: new Map(prior.quiescence),
		retentionGapThroughByDomain: new Map(prior.retentionGapThroughByDomain),
		occurrenceRetentionGaps: new Map(prior.occurrenceRetentionGaps),
	};
}

export function transitionCausalAuthority<T>(
	prior: RuntimeState<T> | undefined,
	arrivals: readonly Arrival<T>[],
	opts: TransitionOptions,
): { state: RuntimeState<T>; outputs: AuthorityFact<T>[]; committedViewChanged: boolean } {
	const state = cloneState(prior);
	const outputs: AuthorityFact<T>[] = [];
	const emitIssue = (value: DataIssue) => pushIssue(outputs, value);
	const context = { state, opts, outputs, committedViewChanged: false };
	const acceptOccurrence = (entry: RetainedOccurrence<T>): boolean => {
		const occurrence = entry.value;
		if (state.byRevision.size >= opts.maxOccurrences) {
			const oldest = [...state.byRevision.entries()]
				.sort(([, left], [, right]) => left.value.revision - right.value.revision)
				.find(([, retained]) => execution.settledForEviction(context, retained.value));
			if (oldest === undefined) {
				emitIssue(
					issue(
						"causal-occurrence/retention-capacity",
						"Occurrence retention is full of unsettled causal obligations.",
						[refKey(occurrence)],
					),
				);
				return false;
			}
			state.byRevision.delete(oldest[0]);
			const evicted = oldest[1].value;
			const evictedRefKey = refKey(evicted);
			state.admissions.delete(evictedRefKey);
			state.released.delete(evictedRefKey);
			state.terminals.delete(evictedRefKey);
			state.emittedTerminals.delete(evictedRefKey);
			state.currentness.delete(evictedRefKey);
			for (const [key, record] of state.effects) {
				if (sameRef(record.proposal.occurrence, evicted)) {
					state.effects.delete(key);
					context.committedViewChanged = true;
				}
			}
			for (const [key, evidence] of state.evidence) {
				if (sameRef(evidence.occurrence, evicted)) state.evidence.delete(key);
			}
			for (const map of [
				state.pendingTerminals,
				state.pendingEffectProposals,
				state.pendingEffectAdmissions,
				state.pendingEffectOutcomes,
				state.pendingEvidence,
				state.coverageGaps,
			]) {
				for (const [key, value] of map) {
					if (sameRef(value.occurrence, evicted)) map.delete(key);
				}
			}
			const priorFloor = state.retentionFloorByDomain.get(evicted.revisionDomain) ?? 0;
			const priorGap = state.retentionGapThroughByDomain.get(evicted.revisionDomain) ?? 0;
			if (evicted.revision > priorFloor || evicted.revision > priorGap)
				context.committedViewChanged = true;
			state.retentionFloorByDomain.set(
				evicted.revisionDomain,
				Math.max(state.retentionFloorByDomain.get(evicted.revisionDomain) ?? 0, evicted.revision),
			);
			state.retentionGapThroughByDomain.set(
				evicted.revisionDomain,
				Math.max(
					state.retentionGapThroughByDomain.get(evicted.revisionDomain) ?? 0,
					evicted.revision,
				),
			);
			const retentionGap = canonicalSnapshot<CausalEvidence>({
				occurrence: evicted,
				evidenceKind: "occurrence-retention",
				evidenceId: `retention-gap/${evicted.revisionDomain}/${evicted.revision}`,
				evidenceDigest: evicted.digest,
				coverage: "retention-gap",
				refs: Object.freeze([`causal-occurrence:${refKey(evicted)}`]),
			});
			state.occurrenceRetentionGaps.set(evicted.revisionDomain, retentionGap);
			outputs.push({
				kind: "coverage",
				value: {
					kind: "causal-evidence-coverage",
					occurrence: evicted,
					complete: false,
					entries: Object.freeze([retentionGap]),
					missingKinds: Object.freeze([...opts.requiredEvidenceKinds]),
					terminalGapKinds: Object.freeze([...opts.requiredEvidenceKinds]),
				},
			});
		}
		state.byRevision.set(revisionKey(occurrence.revisionDomain, occurrence.revision), entry);
		state.highWaterByDomain.set(occurrence.revisionDomain, occurrence.revision);
		return true;
	};
	const receiveOccurrences = (arrival: Extract<Arrival<T>, { lane: "occurrences" }>) => {
		for (const occurrence of arrival.values) {
			if (!validRef(occurrence)) {
				emitIssue(issue("causal-occurrence/invalid-identity", "Occurrence identity is invalid."));
				continue;
			}
			let key: string;
			try {
				key = dataKey(occurrence);
			} catch {
				emitIssue(issue("causal-occurrence/non-data", "Occurrence must be canonical DATA."));
				continue;
			}
			const { digest, ...digestMaterial } = occurrence;
			if (causalOccurrenceDigest(digestMaterial) !== digest) {
				emitIssue(
					issue(
						"causal-occurrence/digest-mismatch",
						"Occurrence digest does not bind contract-v2 identity and value material.",
						[refKey(occurrence)],
					),
				);
				continue;
			}
			if (!identity.retainDomain(context, occurrence.revisionDomain)) continue;
			const domainKey = revisionKey(occurrence.revisionDomain, occurrence.revision);
			const existing = state.byRevision.get(domainKey) ?? state.pending.get(domainKey);
			if (existing !== undefined) {
				if (existing.key !== key)
					emitIssue(
						issue(
							"causal-occurrence/replay-conflict",
							"Revision replay conflicts with retained identity.",
							[refKey(occurrence)],
						),
					);
				continue;
			}
			const highWater = state.highWaterByDomain.get(occurrence.revisionDomain) ?? 0;
			const floor = state.retentionFloorByDomain.get(occurrence.revisionDomain) ?? 0;
			if (occurrence.revision <= highWater) {
				emitIssue(
					issue(
						occurrence.revision <= floor
							? "causal-occurrence/retention-gap"
							: "causal-occurrence/stale-revision",
						"Revision cannot regain causal authority.",
						[refKey(occurrence)],
					),
				);
				outputs.push({
					kind: "currentness",
					value: {
						kind: "causal-currentness",
						occurrence,
						evaluatedThroughRevision: highWater,
						state: occurrence.revision <= floor ? "unverifiable" : "stale",
					},
				});
				continue;
			}
			const entry = { value: canonicalSnapshot(occurrence), key };
			if (occurrence.revision > highWater + 1) {
				if (state.pending.size >= opts.maxPending) {
					emitIssue(
						issue(
							"causal-occurrence/pending-bound",
							"Skipped revision exceeded bounded pending retention.",
							[refKey(occurrence)],
						),
					);
					continue;
				}
				state.pending.set(domainKey, entry);
				emitIssue(
					issue("causal-occurrence/skipped-revision", `Revision ${highWater + 1} is missing.`, [
						refKey(occurrence),
					]),
				);
				outputs.push({
					kind: "currentness",
					value: {
						kind: "causal-currentness",
						occurrence,
						evaluatedThroughRevision: highWater,
						state: "unverifiable",
						missingRevision: highWater + 1,
						gapRef: {
							revisionDomain: occurrence.revisionDomain,
							afterRevision: highWater,
							beforeRevision: occurrence.revision,
							reason: "skipped-revision",
						},
					},
				});
				outputs.push({
					kind: "coverage",
					value: {
						kind: "causal-evidence-coverage",
						occurrence,
						complete: false,
						entries: Object.freeze([
							{
								occurrence,
								evidenceKind: "revision-sequence",
								evidenceId: `${occurrence.revisionDomain}/${occurrence.revision}`,
								evidenceDigest: occurrence.digest,
								coverage: "skipped-revision",
							},
						]),
						missingKinds: Object.freeze([...opts.requiredEvidenceKinds]),
						terminalGapKinds: Object.freeze(["revision-sequence"]),
					},
				});
				continue;
			}
			if (!acceptOccurrence(entry)) {
				if (state.pending.size < opts.maxPending) state.pending.set(domainKey, entry);
				continue;
			}
			for (;;) {
				const nextRevision = (state.highWaterByDomain.get(occurrence.revisionDomain) ?? 0) + 1;
				const pending = state.pending.get(revisionKey(occurrence.revisionDomain, nextRevision));
				if (pending === undefined) break;
				if (!acceptOccurrence(pending)) break;
				state.pending.delete(revisionKey(occurrence.revisionDomain, nextRevision));
			}
		}
	};
	const recomputeDomain = (revisionDomain: string) => {
		const domain = identity.recomputeCurrentness(context, revisionDomain);
		if (domain === undefined) return;
		const { watermark, sequenceComplete } = domain;
		const { pendingOccurrenceRefs, pendingEffectIds } = execution.pendingObligations(
			context,
			revisionDomain,
			domain,
		);
		const evidenceTerminal = evidence.isEvidenceTerminal(context, revisionDomain, domain);
		const lifecycle =
			sequenceComplete && pendingOccurrenceRefs.length === 0 && pendingEffectIds.size === 0;
		const value: CausalQuiescence = {
			kind: "causal-quiescence",
			revisionDomain,
			evaluatedThroughRevision: watermark,
			lifecycle,
			retainedEvidence:
				lifecycle &&
				evidenceTerminal &&
				(state.retentionGapThroughByDomain.get(revisionDomain) ?? 0) === 0,
			pendingOccurrenceRefs,
			pendingEffectIds: Object.freeze([...pendingEffectIds]),
		};
		const prior = state.quiescence.get(revisionDomain);
		state.quiescence.set(revisionDomain, value);
		if (prior === undefined || dataKey(prior) !== dataKey(value))
			outputs.push({ kind: "quiescence", value });
	};
	const flushPending = () => {
		let promoted = false;
		identity.flushAdmissions(context);
		execution.flushEffectsAndTerminals(context);
		evidence.flushEvidence(context);
		for (const revisionDomain of state.domains) {
			for (;;) {
				const revision = (state.highWaterByDomain.get(revisionDomain) ?? 0) + 1;
				const key = revisionKey(revisionDomain, revision);
				const pending = state.pending.get(key);
				if (pending === undefined || !acceptOccurrence(pending)) break;
				state.pending.delete(key);
				promoted = true;
			}
		}
		return promoted;
	};
	for (const arrival of arrivals) {
		if (arrival.lane === "occurrences") receiveOccurrences(arrival);
		if (arrival.lane === "admissions") identity.receiveAdmissions(context, arrival);
		if (arrival.lane === "branch-terminals") execution.receiveTerminals(context, arrival);
		if (arrival.lane === "effect-proposals") execution.receiveProposals(context, arrival);
		if (arrival.lane === "effect-admissions") execution.receiveEffectAdmissions(context, arrival);
		if (arrival.lane === "effect-outcomes") execution.receiveOutcomes(context, arrival);
		if (arrival.lane === "evidence") evidence.receiveEvidence(context, arrival);
		if (arrival.lane === "watermarks") identity.receiveWatermarks(context, arrival);
	}
	for (const revisionDomain of state.watermarks.keys()) recomputeDomain(revisionDomain);
	// Repeat only on finite progress. Commit remains in the authority node, after this drain.
	for (;;) {
		const promoted = flushPending();
		const releasedBefore = state.released.size;
		for (const revisionDomain of state.watermarks.keys()) recomputeDomain(revisionDomain);
		if (!promoted && state.released.size === releasedBefore) break;
	}
	return { state, outputs, committedViewChanged: context.committedViewChanged };
}
