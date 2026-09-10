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
} from "../../packages/ts/src/solutions/causal-occurrence/contracts.js";
import { plainNumbers } from "./spending-numeric-plain.js";
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
	constructor(readonly binding: SpendingBinding) {}
	private prepare(lane: PlainLane, raw: unknown): unknown {
		const text = canonical(raw);
		const v = JSON.parse(text);
		if (text.length > 1048576) throw Error("frame capacity");
		if (lane === "arrivals") {
			if (
				Object.keys(v).sort().join() !== "evaluationRefs,packRef" ||
				!equal(v.packRef, this.binding.packRef) ||
				!Array.isArray(v.evaluationRefs) ||
				v.evaluationRefs.length > 64
			)
				throw Error("arrival shape");
			return v;
		}
		if (!equal(v.binding, this.binding)) throw Error("binding");
		const fields = {
			pack: "binding,evaluations,format",
			current: "binding,current",
			verification: "binding,receipts",
			local: "binding,grants,stop,tick",
			inbox: "artifactDigest,artifactRef,binding,issuerRef,outcomes,readiness",
		};
		if (Object.keys(v).sort().join() !== fields[lane]) throw Error("frame fields");
		const list =
			lane === "pack"
				? v.evaluations
				: lane === "current"
					? v.current
					: lane === "verification"
						? v.receipts
						: lane === "local"
							? v.grants
							: v.outcomes;
		if (!Array.isArray(list) || list.length > 64) throw Error("frame entries");
		if (lane === "pack") {
			if (
				v.format !== "spending-input-v1" ||
				new Set(list.map((e: Evaluation) => e.evaluationRef)).size !== list.length
			)
				throw Error("pack shape");
			for (const e of list as Evaluation[]) {
				if (
					!e.prefix.length ||
					e.prefix.length > 64 ||
					e.prefix.some((t) => !Number.isFinite(t.amount) || t.amount < 0 || t.amount > 1e9)
				)
					throw Error("numeric domain");
				if (
					e.inputDigest !==
						digest({ profileRef: e.profileRef, profile: e.profile, prefix: e.prefix }) ||
					e.policyDigest !== digest(e.policy)
				)
					throw Error("input digest");
			}
		}
		if (lane === "verification")
			for (const receipt of list) {
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
		let value: unknown;
		try {
			value = this.prepare(lane, raw);
		} catch (e) {
			if (lane === "pack") this.pack = undefined;
			else if (lane === "arrivals") this.pending.length = 0;
			else delete this.facts[lane];
			this.issues.push(String(e));
			return;
		}
		if (lane === "pack") {
			const pack = value as EvaluationPack,
				text = canonical(pack);
			if (this.packText !== undefined && text !== this.packText) {
				this.pack = undefined;
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
		} else Object.assign(this.facts, { [lane]: value });
		if (this.pack) {
			for (const id of this.pending.splice(0)) {
				const e = this.pack.evaluations.find((e) => e.evaluationRef === id);
				if (!e) {
					this.issues.push("unknown evaluation");
					continue;
				}
				if (this.evaluations.has(id)) continue;
				this.evaluations.set(id, e);
				const result = plainBusiness(e);
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
		this.reconcile();
	}
	private reconcile() {
		const { current, verification, local, inbox } = this.facts;
		for (const [id, record] of this.effects) {
			if (record.admission) continue;
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
			if (!e?.admission) return false;
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
		for (const o of inbox?.outcomes ?? []) {
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
			const key = digest({ occurrence: o.occurrence, effectId: o.effectId });
			if (!applyOutcome(o) && !this.pendingOutcomes.has(key) && this.pendingOutcomes.size < 64)
				this.pendingOutcomes.set(key, o);
		}
	}
	invalidate(lane: Exclude<PlainLane, "arrivals">) {
		if (lane === "pack") this.pack = undefined;
		else delete this.facts[lane];
	}
	snapshot() {
		return [...this.effects.values()].map((e) => ({
			proposal: e.proposal,
			admission: e.admission ?? null,
			outcome: e.outcome ?? null,
		}));
	}
}
