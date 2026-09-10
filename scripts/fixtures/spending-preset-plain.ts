/** Independent finite plain-code consumer. No candidate computation, validation, or authority imports. */
import type {
	ArrivalFrame,
	CurrentFrame,
	Evaluation,
	EvaluationPack,
	InboxObservationFrame,
	LocalAuthorityFrame,
	SpendingBinding,
	VerificationFrame,
} from "../../examples/spending-alerts/causal-inputs.js";
import type {
	CausalEffectAdmission,
	CausalEffectOutcome,
	CausalEffectProposal,
	CausalEvidence,
} from "../../packages/ts/src/solutions/causal-occurrence/contracts.js";
import { plainNumbers } from "./spending-numeric-plain.js";
import { referenceBinding, referenceInput } from "./spending-preset-reference-input.js";
import {
	oracleCanonical as canonical,
	oracleHash,
	oracleMaterial,
	oracleSnapshot,
} from "./spending-publication-oracle.js";

const digest = (x: unknown) => oracleHash(canonical(x));
const equal = (a: unknown, b: unknown) => canonical(a) === canonical(b);
export function plainBusiness(e: Evaluation) {
	const txn = e.prefix[e.prefix.length - 1];
	const { zScore, dailyRatio } = plainNumbers(
		e.prefix.map((t) => t.amount),
		e.profile.dailyAverage,
	);
	const factors: string[] = [];
	if (zScore > e.policy.zThreshold)
		factors.push(`Amount is ${zScore.toFixed(2)}σ above this vendor's historical mean.`);
	if (dailyRatio > e.policy.dailyRatioThreshold)
		factors.push(`Amount is ${dailyRatio.toFixed(1)}× the user's daily average.`);
	if (!e.profile.typicalCategories.includes(txn.category))
		factors.push("Category is outside the user's typical spend profile.");
	const severity = factors.length >= 3 ? "high" : factors.length === 2 ? "medium" : "low",
		flagged = factors.length > 0;
	const message = flagged
		? `Transaction ${txn.id} flagged — severity: ${severity}.\nVendor: ${txn.vendor}  Amount: $${txn.amount.toFixed(2)}  Category: ${txn.category}\nReasoning:\n${factors.map((f) => `  • ${f}`).join("\n")}`
		: `Transaction ${txn.id} ($${txn.amount.toFixed(2)} at ${txn.vendor}) — normal.`;
	return {
		score: {
			zScore,
			dailyRatio,
			categoryFamiliarity: e.profile.typicalCategories.includes(txn.category) ? "known" : "unknown",
			txn,
		},
		flagged,
		reason: { factors, severity, txn },
		message,
	};
}
export type PlainBusiness = ReturnType<typeof plainBusiness>;
export function plainMaterial(e: Evaluation, b: SpendingBinding, result: PlainBusiness) {
	const payloadText = canonical({
		transactionId: result.score.txn.id,
		vendor: result.score.txn.vendor,
		severity: result.reason.severity,
		message: result.message,
	});
	if (Buffer.byteLength(payloadText) + 1 > 4096) throw Error("payload capacity");
	return oracleMaterial({
		schema: "spending-alerts/request-material/v1" as const,
		occurrence: e.occurrence,
		effectId: `alert:${e.evaluationRef}`,
		inputDigest: e.inputDigest,
		policyDigest: e.policyDigest,
		payloadText,
		payloadDigest: oracleHash(payloadText),
		sourceDigest: b.sourceDigest,
		runtimeDigest: b.runtimeDigest,
		destinationRef: b.destinationRef,
		compositionEpoch: b.compositionEpoch,
		hostEpoch: b.hostEpoch,
	});
}
export interface PlainEffect {
	proposal: CausalEffectProposal;
	admission?: CausalEffectAdmission;
	outcome?: CausalEffectOutcome;
}
export type PlainLane = "pack" | "arrivals" | "current" | "verification" | "local" | "inbox";
/** State owns all retained bytes and obligations, independently of observers. */
export class PlainSpending {
	readonly evaluations = new Map<string, Evaluation>();
	readonly assessments = new Map<string, PlainBusiness>();
	readonly materials = new Map<string, ReturnType<typeof plainMaterial>>();
	readonly effects = new Map<string, PlainEffect>();
	readonly issues: string[] = [];
	readonly pending: string[] = [];
	readonly eligible = new Set<string>();
	readonly occurrenceAdmissions = new Set<string>();
	readonly released = new Set<string>();
	readonly watermarks = new Map<string, number>();
	readonly identity = new Map<string, Map<number, Evaluation>>();
	readonly domains = new Set<string>();
	readonly evidenceReceipts = new Map<string, VerificationFrame["receipts"][number]>();
	readonly evidenceRecords = new Map<string, CausalEvidence>();
	readonly branches = new Map<string, Set<string>>();
	readonly pendingTerminals = new Map<string, { id: string; branch: string }>();
	readonly issuedPolicy = new Set<string>();
	private terminal(id: string, branch: string) {
		const e = this.evaluations.get(id)!;
		if (!this.retainDomain(e.occurrence.revisionDomain)) return;
		const retained = this.identity.get(e.occurrence.revisionDomain)?.get(e.occurrence.revision);
		if (retained && !equal(retained.occurrence, e.occurrence)) return;
		if (this.released.has(id)) {
			this.branches.get(id)?.add(branch);
			return;
		}
		const key = canonical([id, branch]);
		if (!this.pendingTerminals.has(key) && this.pendingTerminals.size < 64)
			this.pendingTerminals.set(key, { id, branch });
	}
	private retainDomain(domain: string) {
		if (this.domains.has(domain)) return true;
		if (this.domains.size === 64) {
			this.issues.push("domain capacity");
			return false;
		}
		this.domains.add(domain);
		return true;
	}
	readonly receiptHistory = new Map<string, string>();
	readonly receiptConflicts = new Set<string>();
	readonly pendingOutcomes = new Map<string, CausalEffectOutcome>();
	private pack?: EvaluationPack;
	private packText?: string;
	private facts: Partial<{
		current: CurrentFrame;
		verification: VerificationFrame;
		local: LocalAuthorityFrame;
		inbox: InboxObservationFrame;
	}> = {};
	constructor(readonly binding: SpendingBinding) {
		this.binding = referenceBinding(binding);
	}
	private prepare(lane: PlainLane, raw: unknown): unknown {
		const v = referenceInput<any>(lane, raw, this.binding);
		if (lane === "verification")
			for (const receipt of v.receipts) {
				const key = canonical(receipt.receiptRef),
					prior = this.receiptHistory.get(key),
					content = canonical(receipt);
				if (prior !== undefined && prior !== content) this.receiptConflicts.add(key);
				if (this.receiptConflicts.has(key)) throw Error("receipt conflict");
				if (prior === undefined && this.receiptHistory.size >= 64) throw Error("receipt capacity");
				this.receiptHistory.set(key, content);
			}
		return v;
	}
	push(lane: PlainLane, raw: unknown) {
		const arrived: string[] = [];
		let value: unknown;
		try {
			value = this.prepare(lane, raw);
		} catch (e) {
			if (lane === "pack") this.pack = undefined;
			else if (lane === "arrivals") this.pending.length = 0;
			else delete this.facts[lane];
			if (lane === "pack" || lane === "arrivals") this.eligible.clear();
			this.issues.push(String(e));
			return;
		}
		if (lane === "pack") {
			const pack = value as EvaluationPack,
				text = canonical(pack, 4 * 1048576);
			if (this.packText !== undefined && text !== this.packText) {
				this.pack = undefined;
				this.eligible.clear();
				this.issues.push("pack conflict");
				return;
			}
			this.pack = pack;
			this.packText = text;
		} else if (lane === "arrivals") {
			for (const ref of (value as ArrivalFrame).evaluationRefs) {
				if (this.pending.length >= 64) {
					this.issues.push("pending capacity");
					break;
				}
				this.pending.push(ref);
			}
		} else {
			Object.assign(this.facts, { [lane]: value });
			if (lane === "current")
				for (const c of (value as CurrentFrame).current) {
					const prior = this.watermarks.get(c.revisionDomain) ?? 0;
					if (this.retainDomain(c.revisionDomain) && c.watermark >= prior)
						this.watermarks.set(c.revisionDomain, c.watermark);
				}
		}
		if (this.pack) {
			for (const id of this.pending.splice(0)) {
				const e = this.pack.evaluations.find((e) => e.evaluationRef === id);
				if (!e) {
					this.issues.push("unknown evaluation");
					continue;
				}
				this.eligible.add(id);
				arrived.push(id);
				if (this.evaluations.has(id)) continue;
				this.evaluations.set(id, e);
				const { occurrence, ...body } = e,
					{ digest: claimed, ...coordinates } = occurrence;
				if (
					this.retainDomain(occurrence.revisionDomain) &&
					claimed ===
						digest({
							schemaRevision: "graphrefly/causal-occurrence-contract/v1@contract-v2",
							...coordinates,
							value: body,
						})
				) {
					let domain = this.identity.get(occurrence.revisionDomain);
					if (!domain) {
						domain = new Map();
						this.identity.set(occurrence.revisionDomain, domain);
					}
					if (!domain.has(occurrence.revision)) domain.set(occurrence.revision, e);
				}
				const result = plainBusiness(e);
				if (this.retainDomain(e.occurrence.revisionDomain)) this.branches.set(id, new Set());
				this.assessments.set(id, result);
				if (!result.flagged) continue;
				try {
					if (this.materials.size >= 64) throw Error("material capacity");
					const material = plainMaterial(e, this.binding, result);
					const { runRef: _run, evidenceMode: _mode, ...profile } = this.binding;
					oracleSnapshot(profile, [...this.materials.values(), material]);
					this.materials.set(id, material);
					this.effects.set(id, {
						proposal: {
							occurrence: e.occurrence,
							effectId: material.body.effectId,
							requestRef: material.requestRef,
							proposalDigest: material.proposalDigest,
						},
					});
				} catch (error) {
					this.issues.push(String(error));
				}
			}
		}
		if (lane === "verification")
			for (const receipt of (value as VerificationFrame).receipts) {
				const key = canonical(receipt.receiptRef);
				if (!this.evidenceReceipts.has(key) && this.evidenceReceipts.size < 64)
					this.evidenceReceipts.set(key, receipt);
			}
		this.reconcile(lane === "inbox" ? (value as InboxObservationFrame).outcomes : [], arrived);
	}
	private reconcile(incomingOutcomes: readonly CausalEffectOutcome[], arrived: readonly string[]) {
		const { current, verification, local, inbox } = this.facts;
		// Admission and contiguous watermark release are sticky authority facts. A pending
		// proposal remains retained independently of whether it is visible as a released effect.
		for (const id of this.eligible) {
			const e = this.evaluations.get(id)!;
			if (
				current?.current.some(
					(c) =>
						equal(c.occurrence, e.occurrence) &&
						equal(c.policyRef, e.policyRef) &&
						c.policyDigest === e.policyDigest,
				)
			)
				if (this.retainDomain(e.occurrence.revisionDomain)) this.occurrenceAdmissions.add(id);
		}
		for (const [name, domain] of this.identity) {
			const through = this.watermarks.get(name);
			if (through === undefined) continue;
			const ordered = [...domain].filter(([n]) => n <= through).sort(([a], [b]) => a - b);
			if (
				ordered.length !== through ||
				ordered.some(([n, e], i) => n !== i + 1 || !this.occurrenceAdmissions.has(e.evaluationRef))
			)
				continue;
			const latest = new Map<string, Evaluation>();
			for (const [, e] of ordered) latest.set(e.occurrence.occurrenceId, e);
			for (const e of latest.values()) this.released.add(e.evaluationRef);
		}
		for (const [key, { id, branch }] of this.pendingTerminals) {
			const occurrence = this.evaluations.get(id)!.occurrence;
			const retained = this.identity.get(occurrence.revisionDomain)?.get(occurrence.revision);
			if (retained && !equal(retained.occurrence, occurrence)) {
				this.pendingTerminals.delete(key);
				continue;
			}
			if (this.released.has(id)) {
				this.branches.get(id)?.add(branch);
				this.pendingTerminals.delete(key);
			}
		}
		for (const branch of ["assessment", "explanation"])
			for (const id of arrived) this.terminal(id, branch);
		for (const [id, record] of this.effects) {
			if (record.admission || !this.eligible.has(id)) continue;
			const e = this.evaluations.get(id)!,
				material = this.materials.get(id)!;
			const receipts =
				verification?.receipts.filter(
					(v) =>
						equal(v.occurrence, e.occurrence) &&
						v.inputDigest === e.inputDigest &&
						v.policyDigest === e.policyDigest &&
						v.sourceDigest === this.binding.sourceDigest &&
						v.runtimeDigest === this.binding.runtimeDigest &&
						v.requestDigest === material.body.payloadDigest &&
						v.verifierRevision === "spending-oracle-v2" &&
						v.numericDomainRef === "spending-finite-v1",
				) ?? [];
			if (receipts.length !== 1 || receipts[0].verdict === "unavailable") continue;
			const receipt = receipts[0];
			if (receipt.verdict === "fail") {
				record.admission = {
					...record.proposal,
					state: "rejected",
					admissionRef: {
						kind: "spending-admission",
						id: digest({
							proposal: record.proposal,
							receiptRef: receipt.receiptRef,
							verdict: "fail",
							binding: this.binding,
						}),
					},
				};
				continue;
			}
			if (!current || !local || !inbox) continue;
			if (
				!current.current.some(
					(c) =>
						equal(c.occurrence, e.occurrence) &&
						equal(c.policyRef, e.policyRef) &&
						c.policyDigest === e.policyDigest &&
						c.watermark >= e.occurrence.revision,
				)
			)
				continue;
			const grants = local.grants.filter(
				(g) =>
					equal(g.occurrence, e.occurrence) &&
					g.requestDigest === material.body.payloadDigest &&
					equal(g.destinationRef, this.binding.destinationRef) &&
					g.hostEpoch === this.binding.hostEpoch &&
					g.replayScope.hostEpoch === this.binding.hostEpoch &&
					g.replayScope.compositionEpoch === this.binding.compositionEpoch,
			);
			if (grants.length !== 1) continue;
			const g = grants[0],
				refused =
					g.revoked || local.stop || local.tick < g.validFrom || local.tick > g.validThrough;
			if (
				!refused &&
				(!inbox.readiness.ready ||
					inbox.readiness.availableSlots !== 1 ||
					local.tick < inbox.readiness.observedAt ||
					local.tick > inbox.readiness.validThrough)
			)
				continue;
			record.admission = {
				...record.proposal,
				state: refused ? "rejected" : "admitted",
				admissionRef: {
					kind: "spending-admission",
					id: digest({
						proposal: record.proposal,
						receiptRef: receipt.receiptRef,
						grantRef: g.grantRef,
						binding: this.binding,
					}),
				},
			};
		}
		const applyOutcome = (o: CausalEffectOutcome): boolean => {
			const e = [...this.effects.values()].find(
				(e) => equal(e.proposal.occurrence, o.occurrence) && e.proposal.effectId === o.effectId,
			);
			if (
				!e?.admission ||
				![...this.effects].some(([id, record]) => record === e && this.released.has(id))
			)
				return false;
			if (
				e.admission.state === "admitted" &&
				equal(e.proposal.requestRef, o.requestRef) &&
				e.proposal.proposalDigest === o.proposalDigest &&
				equal(e.admission.admissionRef, o.admissionRef) &&
				!e.outcome
			)
				e.outcome = o;
			// A known admission makes mismatches definitive; don't let them block a later exact item.
			// The first exact outcome (including unknown) remains immutable.
			return true;
		};
		for (const [key, o] of this.pendingOutcomes)
			if (applyOutcome(o)) this.pendingOutcomes.delete(key);
		for (const o of incomingOutcomes) {
			const result = o.result;
			if (!result || typeof result !== "object") continue;
			if (o.state === "succeeded") {
				if (result.kind !== "ok" || !Object.hasOwn(result, "value")) continue;
			} else {
				if (!["failed", "cancelled", "unknown", "reconcile-required"].includes(o.state)) continue;
				if (
					result.kind !== "error" ||
					!result.error ||
					result.error.kind !== "issue" ||
					typeof result.error.code !== "string" ||
					!result.error.code ||
					typeof result.error.message !== "string" ||
					!result.error.message
				)
					continue;
			}
			if (!this.retainDomain(o.occurrence.revisionDomain)) continue;
			const key = digest({ occurrence: o.occurrence, effectId: o.effectId });
			if (!applyOutcome(o) && !this.pendingOutcomes.has(key) && this.pendingOutcomes.size < 64)
				this.pendingOutcomes.set(key, o);
		}

		for (const id of this.eligible) {
			const e = this.evaluations.get(id)!,
				b = this.assessments.get(id)!;
			if (!this.domains.has(e.occurrence.revisionDomain)) continue;
			if (
				(!b.flagged || this.effects.get(id)?.admission || !this.materials.has(id)) &&
				!this.issuedPolicy.has(id)
			) {
				this.issuedPolicy.add(id);
				this.terminal(id, "publication-policy");
			}
			const retain = (v: CausalEvidence) => {
				const key = canonical([v.occurrence, v.evidenceKind, v.evidenceId]);
				if (!this.evidenceRecords.has(key) && this.evidenceRecords.size < 512)
					this.evidenceRecords.set(key, v);
			};
			for (const [kind, value] of [
				["spending-input", e.inputDigest],
				[
					"spending-code-binding",
					digest({
						sourceDigest: this.binding.sourceDigest,
						runtimeDigest: this.binding.runtimeDigest,
					}),
				],
			])
				retain({
					occurrence: e.occurrence,
					evidenceKind: kind,
					evidenceId: `${id}:${kind}`,
					evidenceDigest: value,
					coverage: "included",
					refs: [this.binding.runRef],
				});
			const request = b.flagged
				? this.materials.get(id)?.body.payloadDigest
				: digest({ kind: "no-publish", evaluationRef: id });
			for (const receipt of this.evidenceReceipts.values())
				if (equal(receipt.occurrence, e.occurrence)) {
					const stale =
						receipt.sourceDigest !== this.binding.sourceDigest ||
						receipt.runtimeDigest !== this.binding.runtimeDigest ||
						receipt.inputDigest !== e.inputDigest ||
						receipt.policyDigest !== e.policyDigest ||
						receipt.verifierRevision !== "spending-oracle-v2" ||
						receipt.numericDomainRef !== "spending-finite-v1" ||
						(request !== undefined && receipt.requestDigest !== request);
					retain({
						occurrence: e.occurrence,
						evidenceKind: "spending-verification",
						evidenceId: digest(receipt.receiptRef),
						evidenceDigest: digest(receipt),
						coverage: stale
							? "stale"
							: receipt.verdict === "unavailable" || request === undefined
								? "unavailable"
								: "included",
						refs: [receipt.artifactRef.id],
					});
				}
		}
	}
	evidenceSnapshot() {
		return [...this.evidenceRecords.values()].filter((v) => {
			const domain = this.identity.get(v.occurrence.revisionDomain);
			return (
				domain &&
				equal(domain.get(v.occurrence.revision)?.occurrence ?? null, v.occurrence) &&
				[...domain.keys()].filter((n) => n <= v.occurrence.revision).length ===
					v.occurrence.revision
			);
		});
	}
	obligationSnapshot() {
		const evidence = this.evidenceSnapshot();
		return [...this.watermarks].map(([domain, through]) => {
			const rows = [...(this.identity.get(domain)?.values() ?? [])].filter(
				(e) => e.occurrence.revision <= through,
			);
			const sequence =
				rows.length === through &&
				rows.every((e) => this.occurrenceAdmissions.has(e.evaluationRef));
			const lifecycle =
				sequence &&
				![...this.pendingTerminals.values()].some((t) => {
					const ref = this.evaluations.get(t.id)!.occurrence;
					return ref.revisionDomain === domain && ref.revision <= through;
				}) &&
				![...this.pendingOutcomes.values()].some(
					(o) => o.occurrence.revisionDomain === domain && o.occurrence.revision <= through,
				) &&
				rows.every((e) => {
					const effect = this.effects.get(e.evaluationRef);
					return (
						this.released.has(e.evaluationRef) &&
						this.branches.get(e.evaluationRef)?.size === 3 &&
						(!effect || effect.admission?.state === "rejected" || !!effect.outcome)
					);
				});
			const retainedEvidence =
				lifecycle &&
				rows.every((e) =>
					["spending-input", "spending-code-binding", "spending-verification"].every((kind) =>
						evidence.some((v) => equal(v.occurrence, e.occurrence) && v.evidenceKind === kind),
					),
				);
			return {
				revisionDomain: domain,
				evaluatedThroughRevision: through,
				lifecycle,
				retainedEvidence,
			};
		});
	}

	invalidate(lane: PlainLane) {
		if (lane === "pack" || lane === "arrivals") this.eligible.clear();
		if (lane === "pack") this.pack = undefined;
		else if (lane === "arrivals") this.pending.length = 0;
		else delete this.facts[lane];
	}
	snapshot() {
		return [...this.effects]
			.filter(([id]) => this.released.has(id))
			.map(([, e]) => ({
				proposal: e.proposal,
				admission: e.admission ?? null,
				outcome: e.outcome ?? null,
			}));
	}
}
