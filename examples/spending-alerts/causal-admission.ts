/** D164 consumer facts. Admission candidates never replace the sole causal authority. */
import { type Ctx, depBatch, depLatest, depWaves } from "../../packages/ts/src/ctx/types.js";
import type { Node } from "../../packages/ts/src/node/node.js";
import { type Message, SENTINEL } from "../../packages/ts/src/protocol/messages.js";
import type {
	CausalBranchTerminal,
	CausalEffectAdmission,
	CausalEffectOutcome,
	CausalEvidence,
	CausalOccurrence,
	CausalOccurrenceAdmission,
	CausalWatermark,
} from "../../packages/ts/src/solutions/causal-occurrence/contracts.js";
import {
	type Assessment,
	type BusinessFrame,
	checked,
	frame,
	type Item,
	type MakeNode,
	type MessageValue,
} from "./causal-business.js";
import {
	type Checked,
	type CurrentFrame,
	type Evaluation,
	frozen,
	hash,
	type InboxObservationFrame,
	issue,
	type LocalAuthorityFrame,
	NUMERIC_DOMAIN,
	occurrenceKey,
	type SpendingBinding,
	type SpendingInputs,
	same,
	VERIFIER_REVISION,
	type VerificationFrame,
	type VerificationReceipt,
} from "./causal-inputs.js";
import type { MaterialResult, StoredFrame } from "./causal-material-owner.js";
import { proposalForMaterial } from "./causal-publication.js";
import type { Flagged } from "./pipeline.js";

interface RowsState {
	maps: Map<string, Item<unknown>>[];
	valid: boolean[];
}
function collect(ctx: Ctx, count: number): RowsState {
	let s = ctx.state.get<RowsState>();
	if (!s) {
		s = {
			maps: Array.from({ length: count }, () => new Map()),
			valid: Array.from({ length: count }, () => false),
		};
		ctx.state.set(s);
	}
	for (let i = 0; i < count; i++) {
		if (depLatest(ctx, i) === undefined) {
			s.maps[i].clear();
			s.valid[i] = false;
		}
		for (const raw of depWaves(ctx, i).flat()) {
			if (raw === SENTINEL) {
				s.maps[i].clear();
				s.valid[i] = false;
				continue;
			}
			const f = raw as BusinessFrame<unknown>;
			s.valid[i] = f.valid;
			if (!f.valid) {
				s.maps[i].clear();
				continue;
			}
			for (const row of f.rows) {
				const k = occurrenceKey(row.evaluation.occurrence);
				if (s.maps[i].has(k) || s.maps[i].size < 64) s.maps[i].set(k, row);
			}
		}
	}
	return s;
}
function latest<T>(ctx: Ctx, i: number): T | undefined {
	const c = depLatest(ctx, i) as Checked<T> | undefined;
	return c?.valid ? c.value : undefined;
}
export interface PolicyDecision {
	readonly terminal: CausalBranchTerminal;
	readonly admission?: CausalEffectAdmission;
}
export function buildAdmission(
	make: MakeNode,
	inputs: SpendingInputs,
	binding: SpendingBinding,
	business: {
		evaluationSelections: Node<BusinessFrame<Evaluation>>;
		thresholdGate: Node<BusinessFrame<Flagged>>;
		assessment: Node<BusinessFrame<Assessment>>;
		alertMessage: Node<BusinessFrame<MessageValue>>;
	},
	materials: { materialStore: Node<StoredFrame> },
) {
	const currentFacts = checked<CurrentFrame>(
		make,
		"currentFacts",
		inputs.evaluations.current,
		"current",
		binding,
	);
	const verificationFacts = checked<VerificationFrame>(
		make,
		"verificationFacts",
		inputs.verification.receipts,
		"verification",
		binding,
	);
	const localFacts = checked<LocalAuthorityFrame>(
		make,
		"localFacts",
		inputs.localAuthority.facts,
		"local",
		binding,
	);
	const inboxFacts = checked<InboxObservationFrame>(
		make,
		"inboxFacts",
		inputs.inbox.facts,
		"inbox",
		binding,
	);
	const publicationPolicy = make<BusinessFrame<PolicyDecision>>(
		"publicationPolicy",
		[
			business.evaluationSelections,
			business.thresholdGate,
			materials.materialStore,
			currentFacts,
			verificationFacts,
			localFacts,
			inboxFacts,
		],
		(ctx) => {
			const s = collect(ctx, 3) as RowsState & { issued?: Map<string, PolicyDecision> };
			s.issued ??= new Map();
			const current = latest<CurrentFrame>(ctx, 3),
				verification = latest<VerificationFrame>(ctx, 4),
				local = latest<LocalAuthorityFrame>(ctx, 5),
				inbox = latest<InboxObservationFrame>(ctx, 6);
			const rows: Item<PolicyDecision>[] = [],
				problems = [];
			if (!s.valid.every(Boolean)) {
				ctx.down([["DATA", frame([], [], false)]]);
				return;
			}
			// The current immutable verification frame is unchanged throughout this invocation.
			let receiptConflict: boolean | undefined;
			for (const [k, r] of s.maps[0]) {
				const e = r.evaluation,
					gate = s.maps[1].get(k)?.value as Flagged | undefined,
					material = s.maps[2].get(k)?.value as MaterialResult | undefined;
				if (!gate || !material) continue;
				const prior = s.issued.get(k);
				if (prior) continue;
				let state: "completed" | "failed" = "completed",
					admission: CausalEffectAdmission | undefined,
					reason = "no-publish";
				if (gate.flagged) {
					if (material.kind === "rejected") {
						state = "failed";
						reason = material.issue.code;
					} else if (material.kind !== "retained") continue;
					else {
						const p = proposalForMaterial(material.material),
							requestDigest = material.material.body.payloadDigest;
						if (!verification) {
							problems.push(issue("policy-input-pending", e.evaluationRef));
							continue;
						}
						const candidates = verification.receipts.filter(
							(v) =>
								same(v.occurrence, e.occurrence) &&
								v.inputDigest === e.inputDigest &&
								v.policyDigest === e.policyDigest &&
								v.sourceDigest === binding.sourceDigest &&
								v.runtimeDigest === binding.runtimeDigest &&
								v.requestDigest === requestDigest &&
								v.verifierRevision === VERIFIER_REVISION &&
								v.numericDomainRef === NUMERIC_DOMAIN,
						);
						if (receiptConflict === undefined) {
							const receipts = new Map<string, string>();
							receiptConflict = false;
							for (const v of verification.receipts) {
								const key = hash(v.receiptRef),
									digest = hash(v);
								if (receipts.has(key) && receipts.get(key) !== digest) receiptConflict = true;
								receipts.set(key, digest);
							}
						}
						if (
							receiptConflict ||
							candidates.length !== 1 ||
							candidates[0].verdict === "unavailable"
						) {
							problems.push(issue("verification-pending-or-conflict", e.evaluationRef));
							continue;
						}
						const receipt = candidates[0];
						if (receipt.verdict === "fail") {
							reason = "verification-rejected";
							state = "failed";
							admission = frozen({
								...p,
								admissionRef: {
									kind: "spending-admission",
									id: hash({
										proposal: p,
										receiptRef: receipt.receiptRef,
										verdict: "fail",
										binding,
									}),
								},
								state: "rejected",
							});
						} else {
							if (!current || !local || !inbox) {
								problems.push(issue("policy-input-pending", e.evaluationRef));
								continue;
							}
							const c = current.current.find((f) => same(f.occurrence, e.occurrence));
							if (
								!c ||
								!same(c.policyRef, e.policyRef) ||
								c.policyDigest !== e.policyDigest ||
								c.watermark < e.occurrence.revision
							) {
								problems.push(issue("policy-current-mismatch", e.evaluationRef));
								continue;
							}
							const grants = local.grants.filter(
								(g) =>
									same(g.occurrence, e.occurrence) &&
									g.requestDigest === requestDigest &&
									same(g.destinationRef, binding.destinationRef) &&
									g.hostEpoch === binding.hostEpoch &&
									g.replayScope.hostEpoch === binding.hostEpoch &&
									g.replayScope.compositionEpoch === binding.compositionEpoch,
							);
							if (grants.length !== 1) {
								problems.push(issue("grant-pending-or-conflict", e.evaluationRef));
								continue;
							}
							const grant = grants[0];
							const refused =
								grant.revoked ||
								local.stop ||
								local.tick < grant.validFrom ||
								local.tick > grant.validThrough;
							if (
								!refused &&
								(!inbox.readiness.ready ||
									inbox.readiness.availableSlots !== 1 ||
									local.tick < inbox.readiness.observedAt ||
									local.tick > inbox.readiness.validThrough)
							) {
								problems.push(issue("inbox-not-ready", e.evaluationRef));
								continue;
							}
							reason = refused ? "publication-rejected" : "fixture-admission";
							state = refused ? "failed" : "completed";
							admission = frozen({
								...p,
								admissionRef: {
									kind: "spending-admission",
									id: hash({
										proposal: p,
										receiptRef: receipt.receiptRef,
										grantRef: grant.grantRef,
										binding,
									}),
								},
								state: refused ? "rejected" : "admitted",
							});
						}
					}
				}
				const terminal: CausalBranchTerminal = {
					occurrence: e.occurrence,
					branch: "publication-policy",
					state,
					result:
						state === "failed"
							? { kind: "error", error: issue(reason, e.evaluationRef) }
							: { kind: "ok", value: { reason, evidenceMode: "fixture-observations" } },
				};
				if (s.issued.size >= 64) {
					problems.push(issue("policy-capacity", e.evaluationRef));
					continue;
				}
				const value = frozen({ terminal, ...(admission ? { admission } : {}) });
				s.issued.set(k, value);
				rows.push({ evaluation: e, value });
			}
			ctx.state.set(s);
			if (rows.length || problems.length) ctx.down([["DATA", frame(rows, problems)]]);
		},
	);
	const occurrences = make<CausalOccurrence<Omit<Evaluation, "occurrence">>>(
		"occurrences",
		[business.evaluationSelections],
		(ctx) => {
			const outputs: Message[] = [];
			const emit = (messages: Message[]) => outputs.push(...messages);
			for (const f of (depBatch(ctx, 0) ?? []) as BusinessFrame<Evaluation>[])
				if (f.valid)
					for (const { evaluation: e } of f.rows) {
						const { occurrence, ...value } = e;
						emit([["DATA", { ...occurrence, value }]]);
					}
			if (outputs.length) ctx.down(outputs);
		},
	);
	const occurrenceAdmissions = make<CausalOccurrenceAdmission>(
		"occurrenceAdmissions",
		[business.evaluationSelections, currentFacts],
		(ctx) => {
			const outputs: Message[] = [];
			const emit = (messages: Message[]) => outputs.push(...messages);
			const s = collect(ctx, 1);
			if (!s.valid[0]) return;
			const frames = (depBatch(ctx, 1) ?? [depLatest(ctx, 1)]) as (
				| Checked<CurrentFrame>
				| undefined
			)[];
			for (const checked of frames) {
				if (!checked?.valid) continue;
				const current = checked.value;
				for (const { evaluation: e } of s.maps[0].values()) {
					const c = current.current.find(
						(c) =>
							same(c.occurrence, e.occurrence) &&
							same(c.policyRef, e.policyRef) &&
							c.policyDigest === e.policyDigest,
					);
					if (c)
						emit([
							[
								"DATA",
								{
									occurrence: e.occurrence,
									decisionId: `evaluation:${e.evaluationRef}`,
									decisionDigest: hash({ occurrence: e.occurrence, inputDigest: e.inputDigest }),
									state: "admitted",
								},
							],
						]);
				}
			}
			if (outputs.length) ctx.down(outputs);
		},
	);
	const branchTerminals = make<CausalBranchTerminal>(
		"branchTerminals",
		[business.assessment, business.alertMessage, publicationPolicy],
		(ctx) => {
			const outputs: Message[] = [];
			const emit = (messages: Message[]) => outputs.push(...messages);
			for (let i = 0; i < 3; i++)
				for (const f of (depBatch(ctx, i) ?? []) as BusinessFrame<unknown>[])
					if (f.valid)
						for (const row of f.rows) {
							const value =
								i === 2
									? (row.value as PolicyDecision).terminal
									: {
											occurrence: row.evaluation.occurrence,
											branch: i === 0 ? "assessment" : "explanation",
											state: "completed",
											result: { kind: "ok", value: row.value },
										};
							emit([["DATA", value]]);
						}
			if (outputs.length) ctx.down(outputs);
		},
	);
	const effectAdmissions = make<CausalEffectAdmission>(
		"effectAdmissions",
		[publicationPolicy],
		(ctx) => {
			const outputs: Message[] = [];
			const emit = (messages: Message[]) => outputs.push(...messages);
			for (const f of (depBatch(ctx, 0) ?? []) as BusinessFrame<PolicyDecision>[])
				if (f.valid)
					for (const row of f.rows) if (row.value.admission) emit([["DATA", row.value.admission]]);
			if (outputs.length) ctx.down(outputs);
		},
	);
	const effectOutcomes = make<CausalEffectOutcome>("effectOutcomes", [inboxFacts], (ctx) => {
		const outputs: Message[] = [];
		const emit = (messages: Message[]) => outputs.push(...messages);
		for (const f of (depBatch(ctx, 0) ?? []) as Checked<InboxObservationFrame>[])
			if (f.valid) for (const outcome of f.value.outcomes) emit([["DATA", outcome]]);
		if (outputs.length) ctx.down(outputs);
	});
	// D165: verification evidence is correlated to actual retained or no-publish material.
	const evidence = make<CausalEvidence>(
		"evidence",
		[business.evaluationSelections, materials.materialStore, verificationFacts],
		(ctx) => {
			const outputs: Message[] = [];
			const emit = (messages: Message[]) => outputs.push(...messages);
			const s = collect(ctx, 2) as RowsState & { receipts?: Map<string, VerificationReceipt> };
			s.receipts ??= new Map();
			const verificationFrames = (depBatch(ctx, 2) ?? [depLatest(ctx, 2)]) as (
				| Checked<VerificationFrame>
				| undefined
			)[];
			for (const f of verificationFrames)
				if (f?.valid)
					for (const receipt of f.value.receipts) {
						const key = hash(receipt.receiptRef);
						if (!s.receipts.has(key) && s.receipts.size < 64) s.receipts.set(key, receipt);
					}
			if (!s.valid[0]) return;
			// Allocate only when material permits matching; reuse only within this invocation.
			let verification: { receipt: VerificationReceipt; occurrence: string }[] | undefined;
			for (const { evaluation: e } of s.maps[0].values()) {
				const exactOccurrence = occurrenceKey(e.occurrence);
				for (const [kind, digest] of [
					["spending-input", e.inputDigest],
					[
						"spending-code-binding",
						hash({ sourceDigest: binding.sourceDigest, runtimeDigest: binding.runtimeDigest }),
					],
				])
					emit([
						[
							"DATA",
							{
								occurrence: e.occurrence,
								evidenceKind: kind,
								evidenceId: `${e.evaluationRef}:${kind}`,
								evidenceDigest: digest,
								coverage: "included",
								refs: [binding.runRef],
							},
						],
					]);
				const material = s.valid[1]
					? (s.maps[1].get(exactOccurrence)?.value as MaterialResult | undefined)
					: undefined;
				// Do not finalize a receipt classification while its material dependency is absent.
				if (!material) continue;
				verification ??= [...s.receipts.values()].map((receipt) => ({
					receipt,
					occurrence: occurrenceKey(receipt.occurrence),
				}));
				const expectedRequest =
					material.kind === "retained"
						? material.material.body.payloadDigest
						: material.kind === "normal"
							? hash({ kind: "no-publish", evaluationRef: e.evaluationRef })
							: undefined;
				for (const { receipt: v, occurrence } of verification)
					if (occurrence === exactOccurrence)
						emit([
							[
								"DATA",
								{
									occurrence: e.occurrence,
									evidenceKind: "spending-verification",
									evidenceId: hash(v.receiptRef),
									evidenceDigest: hash(v),
									coverage:
										v.sourceDigest !== binding.sourceDigest ||
										v.runtimeDigest !== binding.runtimeDigest ||
										v.inputDigest !== e.inputDigest ||
										v.policyDigest !== e.policyDigest ||
										v.verifierRevision !== VERIFIER_REVISION ||
										v.numericDomainRef !== NUMERIC_DOMAIN ||
										(expectedRequest !== undefined && v.requestDigest !== expectedRequest)
											? "stale"
											: v.verdict === "unavailable" || expectedRequest === undefined
												? "unavailable"
												: "included",
									refs: [v.artifactRef.id],
								},
							],
						]);
			}
			if (outputs.length) ctx.down(outputs);
		},
	);
	const watermarks = make<CausalWatermark>("watermarks", [currentFacts], (ctx) => {
		const outputs: Message[] = [];
		const emit = (messages: Message[]) => outputs.push(...messages);
		for (const f of (depBatch(ctx, 0) ?? []) as Checked<CurrentFrame>[])
			if (f.valid)
				for (const c of f.value.current)
					emit([["DATA", { revisionDomain: c.revisionDomain, revision: c.watermark }]]);
		if (outputs.length) ctx.down(outputs);
	});
	return {
		currentFacts,
		verificationFacts,
		localFacts,
		inboxFacts,
		publicationPolicy,
		occurrences,
		occurrenceAdmissions,
		branchTerminals,
		effectAdmissions,
		effectOutcomes,
		evidence,
		watermarks,
	};
}
