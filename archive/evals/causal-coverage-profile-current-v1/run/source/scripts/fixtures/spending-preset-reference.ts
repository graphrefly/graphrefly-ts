/** Independent private Graph control for D164/D166. Shares only the qualified C/runtime floor.
 * Consumer selection, math, joining, material and permission code do not import candidate helpers.
 */

import type {
	Assessment,
	BusinessFrame,
	Item,
} from "../../examples/spending-alerts/causal-business.js";
import type {
	ArrivalFrame,
	CurrentFrame,
	Evaluation,
	EvaluationPack,
	InboxObservationFrame,
	LocalAuthorityFrame,
	SpendingBinding,
	SpendingInputs,
	VerificationFrame,
	VerificationReceipt,
} from "../../examples/spending-alerts/causal-inputs.js";
import type {
	MaterialSnapshot,
	RequestMaterial,
} from "../../examples/spending-alerts/causal-publication.js";
import type {
	Flagged,
	ReasonFactors,
	Transaction,
	UserProfile,
} from "../../examples/spending-alerts/pipeline.js";
import { depBatch, depLatest, depWaves, type NodeFn } from "../../packages/ts/src/ctx/types.js";
import type {
	ConstructionScope,
	StartupFact,
} from "../../packages/ts/src/graph/construction-scope.js";
import type { Graph } from "../../packages/ts/src/graph/graph.js";
import type { Node } from "../../packages/ts/src/node/node.js";
import type { Message } from "../../packages/ts/src/protocol/messages.js";
import { SENTINEL } from "../../packages/ts/src/protocol/messages.js";
import {
	assertCausalOccurrenceTopology,
	prepareCausalOptions,
} from "../../packages/ts/src/solutions/causal-occurrence/construction.js";
import type {
	CausalBranchTerminal,
	CausalEffectAdmission,
	CausalEffectOutcome,
	CausalEffectProposal,
	CausalEvidence,
	CausalOccurrence,
	CausalOccurrenceAdmission,
	CausalWatermark,
} from "../../packages/ts/src/solutions/causal-occurrence/contracts.js";
import { plainMoments, plainScore } from "./spending-numeric-plain.js";
import {
	type ReferenceLane,
	referenceBinding,
	referenceInput,
} from "./spending-preset-reference-input.js";
import {
	oracleCanonical as canonical,
	oracleHash,
	oracleMaterial,
	oracleSnapshot,
} from "./spending-publication-oracle.js";
import { buildReferencePublication } from "./spending-publication-reference.js";

// Inputs are recursively frozen by the independent decoder. Only newly owned output
// containers need freezing here; revisiting immutable prefixes would pad reference work.
function freeze<T>(value: T): T {
	if (value !== null && typeof value === "object" && !Object.isFrozen(value)) {
		Object.values(value).forEach(freeze);
		Object.freeze(value);
	}
	return value;
}
const digest = (x: unknown) => oracleHash(canonical(x));
const equal = (a: unknown, b: unknown) => canonical(a) === canonical(b);
const issue = (code: string, subjectId?: string) =>
	freeze({
		kind: "issue" as const,
		code: `spending/${code}`,
		message: code,
		...(subjectId ? { subjectId } : {}),
	});
const frame = <T>(
	rows: readonly Item<T>[],
	issues: readonly ReturnType<typeof issue>[] = [],
	valid = true,
): BusinessFrame<T> => freeze({ rows, issues, valid });
type Checked<T> = { valid: true; value: T } | { valid: false; issue: ReturnType<typeof issue> };
type Make = <T>(name: string, deps: readonly Node<any>[], fn: NodeFn) => Node<T>;
const key = (e: Evaluation) => canonical(e.occurrence);
function map<T, U>(
	make: Make,
	name: string,
	input: Node<BusinessFrame<T>>,
	fn: (x: T, e: Evaluation) => U,
) {
	return make<BusinessFrame<U>>(name, [input], (ctx) => {
		for (const f of depWaves(ctx, 0).flat()) {
			if (f === SENTINEL) {
				ctx.down([["DATA", frame([], [], false)]]);
				continue;
			}
			const data = f as BusinessFrame<T>;
			ctx.down([
				[
					"DATA",
					frame(
						data.rows.map((r) => ({ evaluation: r.evaluation, value: fn(r.value, r.evaluation) })),
						data.issues,
						data.valid,
					),
				],
			]);
		}
	});
}
/** Exact occurrence join with bounded retained rows and no external cache reads. */
function join<T>(
	make: Make,
	name: string,
	deps: readonly Node<BusinessFrame<any>>[],
	fn: (xs: any[], e: Evaluation) => T,
) {
	return make<BusinessFrame<T>>(name, deps, (ctx) => {
		const state = ctx.state.get<{ maps: Map<string, Item<any>>[]; valid: boolean[] }>() ?? {
			maps: deps.map(() => new Map()),
			valid: deps.map(() => false),
		};
		const touched = new Set<string>(),
			problems: ReturnType<typeof issue>[] = [];
		for (let i = 0; i < deps.length; i++) {
			if (depLatest(ctx, i) === undefined) {
				state.maps[i].clear();
				state.valid[i] = false;
			}
			for (const raw of depWaves(ctx, i).flat()) {
				if (raw === SENTINEL) {
					state.maps[i].clear();
					state.valid[i] = false;
					continue;
				}
				const f = raw as BusinessFrame<any>;
				state.valid[i] = f.valid;
				problems.push(...f.issues);
				if (!f.valid) {
					state.maps[i].clear();
					continue;
				}
				for (const row of f.rows) {
					const k = key(row.evaluation);
					if (!state.maps[i].has(k) && state.maps[i].size >= 64) {
						problems.push(issue("join-capacity"));
						continue;
					}
					state.maps[i].set(k, row);
					touched.add(k);
				}
			}
		}
		ctx.state.set(state);
		const ready = state.valid.every(Boolean),
			rows: Item<T>[] = [];
		if (ready)
			for (const k of touched) {
				const rs = state.maps.map((m) => m.get(k));
				if (rs.some((r) => !r)) continue;
				rows.push({
					evaluation: rs[0]!.evaluation,
					value: fn(
						rs.map((r) => r!.value),
						rs[0]!.evaluation,
					),
				});
			}
		ctx.down([["DATA", frame(rows, problems, ready)]]);
	});
}
function checked<T>(
	make: Make,
	name: string,
	input: Node<any>,
	lane: ReferenceLane,
	binding: SpendingBinding,
) {
	return make<Checked<T>>(name, [input], (ctx) => {
		const state = ctx.state.get<{ receipts: Map<string, string>; conflicts: Set<string> }>() ?? {
			receipts: new Map(),
			conflicts: new Set(),
		};
		for (const raw of depWaves(ctx, 0).flat()) {
			let result: Checked<T>;
			try {
				if (raw === SENTINEL) throw Error(`invalidated-${lane}`);
				const value = referenceInput<T>(lane, raw, binding);
				if (lane === "verification")
					for (const v of (value as VerificationFrame).receipts) {
						const id = canonical(v.receiptRef),
							text = canonical(v),
							before = state.receipts.get(id);
						if (before !== undefined && before !== text) state.conflicts.add(id);
						if (state.conflicts.has(id)) throw Error("receipt-identity-conflict");
						if (before === undefined && state.receipts.size === 64)
							throw Error("receipt-lifetime-capacity");
						state.receipts.set(id, text);
					}
				result = { valid: true, value };
			} catch (error) {
				result = {
					valid: false,
					issue: issue(
						error instanceof Error &&
							(error.message.startsWith("receipt-") || error.message.startsWith("invalidated-"))
							? error.message
							: `invalid-${lane}`,
					),
				};
			}
			ctx.state.set(state);
			ctx.down([["DATA", freeze(result)]]);
		}
	});
}
const available = <T>(ctx: Parameters<NodeFn>[0], index: number): T | undefined => {
	const f = depLatest(ctx, index) as Checked<T> | undefined;
	return f?.valid ? f.value : undefined;
};
const proposal = (material: RequestMaterial): CausalEffectProposal => ({
	occurrence: material.body.occurrence,
	effectId: material.body.effectId,
	requestRef: material.requestRef,
	proposalDigest: material.proposalDigest,
});
type MaterialResult =
	| { kind: "normal" }
	| { kind: "retained"; material: RequestMaterial }
	| { kind: "rejected"; issue: ReturnType<typeof issue> };
type Stored = BusinessFrame<MaterialResult> & { snapshot: MaterialSnapshot };
type Decision = { terminal: CausalBranchTerminal; admission?: CausalEffectAdmission };
export const REFERENCE_BUSINESS_NAMES = [
	"selection",
	"transaction",
	"moments",
	"profile",
	"policy",
	"current",
	"verification",
	"local",
	"inbox",
	"score",
	"gate",
	"reason",
	"message",
	"assessment",
	"material",
	"store",
	"snapshot",
	"proposals",
	"permission",
	"occurrences",
	"occurrenceAdmissions",
	"terminals",
	"effectAdmissions",
	"outcomes",
	"evidence",
	"watermarks",
	"issues",
] as const;
export function buildReferencePreset(
	graph: Graph,
	scope: ConstructionScope,
	startup: Node<StartupFact>,
	inputs: SpendingInputs,
	rawBinding: SpendingBinding,
	diagnostics: "off" | "summary",
) {
	const binding = referenceBinding(rawBinding);
	if (diagnostics !== "off" && diagnostics !== "summary")
		throw new TypeError("reference diagnostics");
	const shape = (value: object, keys: string[]) => {
		if (!value || Object.keys(value).sort().join() !== keys.sort().join())
			throw new TypeError("reference input groups");
	};
	shape(inputs, ["evaluations", "verification", "localAuthority", "inbox"]);
	shape(inputs.evaluations, ["pack", "arrivals", "current"]);
	shape(inputs.verification, ["receipts"]);
	shape(inputs.localAuthority, ["facts"]);
	shape(inputs.inbox, ["facts"]);
	const inputNodes = [
		inputs.evaluations.pack,
		inputs.evaluations.arrivals,
		inputs.evaluations.current,
		inputs.verification.receipts,
		inputs.localAuthority.facts,
		inputs.inbox.facts,
	];
	if (inputNodes.some((n) => !n) || new Set(inputNodes).size !== 6)
		throw new TypeError("reference distinct inputs");
	scope.assertContext(graph, startup, binding.compositionEpoch);
	const nodes = new Map<string, Node<any>>();
	const edges = new Map<Node<any>, readonly Node<any>[]>();
	const make: Make = <T>(name: string, deps: readonly Node<any>[], fn: NodeFn) => {
		const expected = [...deps];
		const node = scope.node<T>(
			deps,
			(ctx) => {
				if (node.deps.length !== expected.length || node.deps.some((d, i) => d !== expected[i])) {
					ctx.down([["ERROR", Error(`reference dependency ${name}`)]]);
					return;
				}
				fn(ctx);
			},
			{
				name: `spending/reference/${name}`,
				factory: `spendingReference/${name}`,
				partial: true,
				errorWhenDepsError: true,
			},
		);
		nodes.set(name, node);
		edges.set(node, expected);
		return node;
	};
	const selection = make<BusinessFrame<Evaluation>>(
		"selection",
		[inputs.evaluations.pack, inputs.evaluations.arrivals],
		(ctx) => {
			const s = ctx.state.get<{
				pack?: EvaluationPack;
				bytes?: string;
				available: boolean;
				waiting: string[];
			}>() ?? { available: false, waiting: [] };
			const errors: ReturnType<typeof issue>[] = [];
			if (depLatest(ctx, 0) === undefined) s.available = false;
			for (const v of depWaves(ctx, 0).flat())
				try {
					const pack = referenceInput<EvaluationPack>("pack", v, binding),
						bytes = canonical(pack, 4 * 1048576);
					if (s.bytes !== undefined && s.bytes !== bytes) throw Error("pack-conflict");
					s.pack = pack;
					s.bytes = bytes;
					s.available = true;
				} catch (e) {
					s.available = false;
					errors.push(
						issue(
							e instanceof Error && e.message === "pack-conflict"
								? "pack-conflict"
								: "invalid-pack",
						),
					);
				}
			const drain = () => {
				if (!s.available || !s.pack) return;
				const rows: Item<Evaluation>[] = [];
				for (const id of s.waiting.splice(0)) {
					const e = s.pack.evaluations.find((x) => x.evaluationRef === id);
					if (e) rows.push({ evaluation: e, value: e });
					else errors.push(issue("unknown-evaluation", id));
				}
				if (rows.length || errors.length) ctx.down([["DATA", frame(rows, errors.splice(0))]]);
			};
			drain();
			for (const v of depWaves(ctx, 1).flat()) {
				try {
					const arrivals = referenceInput<ArrivalFrame>("arrivals", v, binding);
					for (const id of arrivals.evaluationRefs) {
						if (s.waiting.length === 64) {
							errors.push(issue("arrival-capacity", id));
							break;
						}
						s.waiting.push(id);
					}
					drain();
				} catch {
					s.waiting = [];
					errors.push(issue("invalid-arrivals"));
					ctx.down([["DATA", frame([], errors.splice(0), false)]]);
				}
			}
			ctx.state.set(s);
			if (errors.length) ctx.down([["DATA", frame([], errors, false)]]);
		},
	);
	const transaction = map(make, "transaction", selection, (e) => e.prefix[e.prefix.length - 1]);
	const moments = map(make, "moments", selection, (e) =>
		plainMoments(e.prefix.map((t) => t.amount)),
	);
	const profile = map(make, "profile", selection, (e) => e.profile),
		policy = map(make, "policy", selection, (e) => e.policy);
	const score = join(make, "score", [transaction, moments, profile], ([txn, stats, p]) => ({
		zScore: plainScore(stats),
		dailyRatio: txn.amount / Math.max(p.dailyAverage, 1),
		categoryFamiliarity: p.typicalCategories.includes(txn.category) ? "known" : "unknown",
		txn,
	}));
	const gate = join<Flagged>(make, "gate", [score, policy], ([score, p]) => ({
		score,
		txn: score.txn,
		threshold: p.zThreshold,
		flagged:
			score.zScore > p.zThreshold ||
			score.dailyRatio > p.dailyRatioThreshold ||
			score.categoryFamiliarity === "unknown",
	}));
	const reason = join<ReasonFactors>(make, "reason", [gate, policy], ([g, p]) => {
		const factors: string[] = [];
		if (g.flagged) {
			if (g.score.zScore > p.zThreshold)
				factors.push(
					`Amount is ${g.score.zScore.toFixed(2)}σ above this vendor's historical mean.`,
				);
			if (g.score.dailyRatio > p.dailyRatioThreshold)
				factors.push(`Amount is ${g.score.dailyRatio.toFixed(1)}× the user's daily average.`);
			if (g.score.categoryFamiliarity === "unknown")
				factors.push("Category is outside the user's typical spend profile.");
		}
		return {
			factors,
			severity: factors.length > 2 ? "high" : factors.length === 2 ? "medium" : "low",
			txn: g.txn,
		};
	});
	const message = map(make, "message", reason, (r) => ({
		severity: r.severity,
		message: r.factors.length
			? `Transaction ${r.txn.id} flagged — severity: ${r.severity}.\nVendor: ${r.txn.vendor}  Amount: $${r.txn.amount.toFixed(2)}  Category: ${r.txn.category}\nReasoning:\n${r.factors.map((f) => `  • ${f}`).join("\n")}`
			: `Transaction ${r.txn.id} ($${r.txn.amount.toFixed(2)} at ${r.txn.vendor}) — normal.`,
	}));
	const assessment = join<Assessment>(
		make,
		"assessment",
		[gate, reason, message],
		([g, r, m], e) => ({
			kind: "spending-alerts/assessment",
			evidenceMode: "fixture-observations",
			binding,
			evaluationRef: e.evaluationRef,
			occurrence: e.occurrence,
			inputDigest: e.inputDigest,
			policyDigest: e.policyDigest,
			flagged: g.flagged,
			score: g.score,
			reason: r,
			message: m.message,
		}),
	);
	const current = checked<CurrentFrame>(
			make,
			"current",
			inputs.evaluations.current,
			"current",
			binding,
		),
		verification = checked<VerificationFrame>(
			make,
			"verification",
			inputs.verification.receipts,
			"verification",
			binding,
		),
		local = checked<LocalAuthorityFrame>(
			make,
			"local",
			inputs.localAuthority.facts,
			"local",
			binding,
		),
		inbox = checked<InboxObservationFrame>(make, "inbox", inputs.inbox.facts, "inbox", binding);
	const { runRef: _run, evidenceMode: _mode, ...materialProfile } = binding;
	const material = join<MaterialResult>(
		make,
		"material",
		[selection, gate, message],
		([, g, m], e) => {
			if (!g.flagged) return { kind: "normal" };
			try {
				const payloadText = canonical({
					transactionId: g.txn.id,
					vendor: g.txn.vendor,
					severity: m.severity,
					message: m.message,
				});
				if (Buffer.byteLength(payloadText) + 1 > 4096) throw Error();
				return {
					kind: "retained",
					material: oracleMaterial({
						schema: "spending-alerts/request-material/v1",
						occurrence: e.occurrence,
						effectId: `alert:${e.evaluationRef}`,
						inputDigest: e.inputDigest,
						policyDigest: e.policyDigest,
						payloadText,
						payloadDigest: oracleHash(payloadText),
						sourceDigest: binding.sourceDigest,
						runtimeDigest: binding.runtimeDigest,
						destinationRef: binding.destinationRef,
						compositionEpoch: binding.compositionEpoch,
						hostEpoch: binding.hostEpoch,
					}),
				};
			} catch {
				return { kind: "rejected", issue: issue("material-format-or-capacity", e.evaluationRef) };
			}
		},
	);
	const store = make<Stored>("store", [material], (ctx) => {
		const s = ctx.state.get<{
			materials: Map<string, RequestMaterial>;
			snapshot: MaterialSnapshot;
		}>() ?? { materials: new Map(), snapshot: oracleSnapshot(materialProfile, []) };
		for (const raw of depBatch(ctx, 0) ?? []) {
			const f = raw as BusinessFrame<MaterialResult>,
				rows: Item<MaterialResult>[] = [],
				errors = [...f.issues];
			for (const row of f.rows) {
				let result = row.value;
				if (result.kind === "retained") {
					const id = key(row.evaluation),
						prior = s.materials.get(id);
					let failure: string | undefined;
					if (prior) {
						if (!equal(prior, result.material)) failure = "material-conflict";
						else result = { kind: "retained", material: prior };
					} else if (s.materials.size >= 64) failure = "material-count-capacity";
					else
						try {
							const next = oracleSnapshot(materialProfile, [
								...s.materials.values(),
								result.material,
							]);
							if (Buffer.byteLength(canonical(next)) > 1048576) throw Error();
							s.materials.set(id, result.material);
							s.snapshot = next;
						} catch {
							failure = "material-byte-capacity";
						}
					if (failure)
						result = { kind: "rejected", issue: issue(failure, row.evaluation.evaluationRef) };
				}
				if (result.kind === "rejected") errors.push(result.issue);
				rows.push({ evaluation: row.evaluation, value: result });
			}
			ctx.state.set(s);
			ctx.down([["DATA", freeze({ ...frame(rows, errors, f.valid), snapshot: s.snapshot })]]);
		}
	});
	const snapshot = make<MaterialSnapshot>("snapshot", [store], (ctx) => {
		for (const f of depBatch(ctx, 0) ?? []) ctx.down([["DATA", (f as Stored).snapshot]]);
	});
	const proposals = make<CausalEffectProposal>("proposals", [store], (ctx) => {
		const out: Message[] = [];
		for (const f of (depBatch(ctx, 0) ?? []) as Stored[])
			if (f.valid)
				for (const r of f.rows)
					if (r.value.kind === "retained") out.push(["DATA", proposal(r.value.material)]);
		if (out.length) ctx.down(out);
	});
	const permission = make<BusinessFrame<Decision>>(
		"permission",
		[selection, gate, store, current, verification, local, inbox],
		(ctx) => {
			const s = collect(ctx, 3);
			s.issued ??= new Map<string, Decision>();
			const rows: Item<Decision>[] = [],
				errors: ReturnType<typeof issue>[] = [];
			if (!s.valid.every(Boolean)) {
				ctx.down([["DATA", frame([], [], false)]]);
				return;
			}
			const c = available<CurrentFrame>(ctx, 3),
				v = available<VerificationFrame>(ctx, 4),
				l = available<LocalAuthorityFrame>(ctx, 5),
				i = available<InboxObservationFrame>(ctx, 6);
			for (const [id, row] of s.maps[0]) {
				if (s.issued.has(id)) continue;
				const e = row.evaluation,
					g = s.maps[1].get(id)?.value as Flagged | undefined,
					m = s.maps[2].get(id)?.value as MaterialResult | undefined;
				if (!g || !m) continue;
				let why = "no-publish",
					failed = false,
					admission: CausalEffectAdmission | undefined;
				if (g.flagged) {
					if (m.kind === "rejected") {
						failed = true;
						why = m.issue.code;
					} else if (m.kind !== "retained") continue;
					else {
						const p = proposal(m.material),
							rd = m.material.body.payloadDigest;
						if (!v) {
							errors.push(issue("policy-input-pending", e.evaluationRef));
							continue;
						}
						const receipts = v.receipts.filter(
							(x) =>
								equal(x.occurrence, e.occurrence) &&
								x.inputDigest === e.inputDigest &&
								x.policyDigest === e.policyDigest &&
								x.sourceDigest === binding.sourceDigest &&
								x.runtimeDigest === binding.runtimeDigest &&
								x.requestDigest === rd &&
								x.verifierRevision === "spending-oracle-v2" &&
								x.numericDomainRef === "spending-finite-v1",
						);
						if (receipts.length !== 1 || receipts[0].verdict === "unavailable") {
							errors.push(issue("verification-pending-or-conflict", e.evaluationRef));
							continue;
						}
						const receipt = receipts[0];
						if (receipt.verdict === "fail") {
							failed = true;
							why = "verification-rejected";
							admission = {
								...p,
								state: "rejected",
								admissionRef: {
									kind: "spending-admission",
									id: digest({
										proposal: p,
										receiptRef: receipt.receiptRef,
										verdict: "fail",
										binding,
									}),
								},
							};
						} else {
							if (!c || !l || !i) {
								errors.push(issue("policy-input-pending", e.evaluationRef));
								continue;
							}
							const current = c.current.find((x) => equal(x.occurrence, e.occurrence));
							if (
								!current ||
								!equal(current.policyRef, e.policyRef) ||
								current.policyDigest !== e.policyDigest ||
								current.watermark < e.occurrence.revision
							) {
								errors.push(issue("policy-current-mismatch", e.evaluationRef));
								continue;
							}
							const grants = l.grants.filter(
								(x) =>
									equal(x.occurrence, e.occurrence) &&
									x.requestDigest === rd &&
									equal(x.destinationRef, binding.destinationRef) &&
									x.hostEpoch === binding.hostEpoch &&
									x.replayScope.hostEpoch === binding.hostEpoch &&
									x.replayScope.compositionEpoch === binding.compositionEpoch,
							);
							if (grants.length !== 1) {
								errors.push(issue("grant-pending-or-conflict", e.evaluationRef));
								continue;
							}
							const grant = grants[0];
							failed =
								grant.revoked || l.stop || l.tick < grant.validFrom || l.tick > grant.validThrough;
							if (
								!failed &&
								(!i.readiness.ready ||
									i.readiness.availableSlots !== 1 ||
									l.tick < i.readiness.observedAt ||
									l.tick > i.readiness.validThrough)
							) {
								errors.push(issue("inbox-not-ready", e.evaluationRef));
								continue;
							}
							why = failed ? "publication-rejected" : "fixture-admission";
							admission = {
								...p,
								state: failed ? "rejected" : "admitted",
								admissionRef: {
									kind: "spending-admission",
									id: digest({
										proposal: p,
										receiptRef: receipt.receiptRef,
										grantRef: grant.grantRef,
										binding,
									}),
								},
							};
						}
					}
				}
				const terminal: CausalBranchTerminal = {
					occurrence: e.occurrence,
					branch: "publication-policy",
					state: failed ? "failed" : "completed",
					result: failed
						? { kind: "error", error: issue(why, e.evaluationRef) }
						: { kind: "ok", value: { reason: why, evidenceMode: "fixture-observations" } },
				};
				const value = freeze({ terminal, ...(admission ? { admission } : {}) });
				s.issued.set(id, value);
				rows.push({ evaluation: e, value });
			}
			ctx.state.set(s);
			if (rows.length || errors.length) ctx.down([["DATA", frame(rows, errors)]]);
		},
	);
	const occurrences = make<CausalOccurrence<any>>("occurrences", [selection], (ctx) => {
		const out: Message[] = [];
		for (const f of (depBatch(ctx, 0) ?? []) as BusinessFrame<Evaluation>[])
			if (f.valid)
				for (const row of f.rows) {
					const { occurrence, ...value } = row.evaluation;
					out.push(["DATA", { ...occurrence, value }]);
				}
		if (out.length) ctx.down(out);
	});
	const occurrenceAdmissions = make<CausalOccurrenceAdmission>(
		"occurrenceAdmissions",
		[selection, current],
		(ctx) => {
			const s = collect(ctx, 1),
				out: Message[] = [];
			if (!s.valid[0]) return;
			for (const checked of (depBatch(ctx, 1) ?? [depLatest(ctx, 1)]) as (
				| Checked<CurrentFrame>
				| undefined
			)[])
				if (checked?.valid)
					for (const row of s.maps[0].values()) {
						const e = row.evaluation;
						if (
							checked.value.current.some(
								(c) =>
									equal(c.occurrence, e.occurrence) &&
									equal(c.policyRef, e.policyRef) &&
									c.policyDigest === e.policyDigest,
							)
						)
							out.push([
								"DATA",
								{
									occurrence: e.occurrence,
									decisionId: `evaluation:${e.evaluationRef}`,
									decisionDigest: digest({ occurrence: e.occurrence, inputDigest: e.inputDigest }),
									state: "admitted",
								},
							]);
					}
			if (out.length) ctx.down(out);
		},
	);
	const terminals = make<CausalBranchTerminal>(
		"terminals",
		[assessment, message, permission],
		(ctx) => {
			const out: Message[] = [];
			for (let branch = 0; branch < 3; branch++)
				for (const f of (depBatch(ctx, branch) ?? []) as BusinessFrame<any>[])
					if (f.valid)
						for (const row of f.rows)
							out.push([
								"DATA",
								branch === 2
									? row.value.terminal
									: {
											occurrence: row.evaluation.occurrence,
											branch: branch === 0 ? "assessment" : "explanation",
											state: "completed",
											result: { kind: "ok", value: row.value },
										},
							]);
			if (out.length) ctx.down(out);
		},
	);
	const effectAdmissions = make<CausalEffectAdmission>("effectAdmissions", [permission], (ctx) => {
		const out: Message[] = [];
		for (const f of (depBatch(ctx, 0) ?? []) as BusinessFrame<Decision>[])
			if (f.valid)
				for (const r of f.rows) if (r.value.admission) out.push(["DATA", r.value.admission]);
		if (out.length) ctx.down(out);
	});
	const outcomes = make<CausalEffectOutcome>("outcomes", [inbox], (ctx) => {
		const out: Message[] = [];
		for (const f of (depBatch(ctx, 0) ?? []) as Checked<InboxObservationFrame>[])
			if (f.valid) for (const o of f.value.outcomes) out.push(["DATA", o]);
		if (out.length) ctx.down(out);
	});
	const evidence = make<CausalEvidence>("evidence", [selection, store, verification], (ctx) => {
		const s = collect(ctx, 2);
		s.receipts ??= new Map<string, VerificationReceipt>();
		for (const f of (depBatch(ctx, 2) ?? [depLatest(ctx, 2)]) as (
			| Checked<VerificationFrame>
			| undefined
		)[])
			if (f?.valid)
				for (const r of f.value.receipts) {
					const id = digest(r.receiptRef);
					if (!s.receipts.has(id) && s.receipts.size < 64) s.receipts.set(id, r);
				}
		if (!s.valid[0]) return;
		const out: Message[] = [];
		for (const row of s.maps[0].values()) {
			const e = row.evaluation;
			for (const [kind, d] of [
				["spending-input", e.inputDigest],
				[
					"spending-code-binding",
					digest({ sourceDigest: binding.sourceDigest, runtimeDigest: binding.runtimeDigest }),
				],
			])
				out.push([
					"DATA",
					{
						occurrence: e.occurrence,
						evidenceKind: kind,
						evidenceId: `${e.evaluationRef}:${kind}`,
						evidenceDigest: d,
						coverage: "included",
						refs: [binding.runRef],
					},
				]);
			const m = s.valid[1]
				? (s.maps[1].get(key(e))?.value as MaterialResult | undefined)
				: undefined;
			if (!m) continue;
			const rd =
				m.kind === "retained"
					? m.material.body.payloadDigest
					: m.kind === "normal"
						? digest({ kind: "no-publish", evaluationRef: e.evaluationRef })
						: undefined;
			for (const v of s.receipts.values())
				if (equal(v.occurrence, e.occurrence)) {
					const stale =
						v.sourceDigest !== binding.sourceDigest ||
						v.runtimeDigest !== binding.runtimeDigest ||
						v.inputDigest !== e.inputDigest ||
						v.policyDigest !== e.policyDigest ||
						v.verifierRevision !== "spending-oracle-v2" ||
						v.numericDomainRef !== "spending-finite-v1" ||
						(rd !== undefined && v.requestDigest !== rd);
					out.push([
						"DATA",
						{
							occurrence: e.occurrence,
							evidenceKind: "spending-verification",
							evidenceId: digest(v.receiptRef),
							evidenceDigest: digest(v),
							coverage: stale
								? "stale"
								: v.verdict === "unavailable" || rd === undefined
									? "unavailable"
									: "included",
							refs: [v.artifactRef.id],
						},
					]);
				}
		}
		ctx.state.set(s);
		if (out.length) ctx.down(out);
	});
	const watermarks = make<CausalWatermark>("watermarks", [current], (ctx) => {
		const out: Message[] = [];
		for (const f of (depBatch(ctx, 0) ?? []) as Checked<CurrentFrame>[])
			if (f.valid)
				for (const c of f.value.current)
					out.push(["DATA", { revisionDomain: c.revisionDomain, revision: c.watermark }]);
		if (out.length) ctx.down(out);
	});
	const publication = buildReferencePublication(
		graph,
		scope,
		startup,
		prepareCausalOptions({
			name: "spending/causal",
			occurrences,
			admissions: occurrenceAdmissions,
			branchTerminals: terminals,
			effectProposals: proposals,
			effectAdmissions,
			effectOutcomes: outcomes,
			evidence,
			watermarks,
			requiredBranches: ["assessment", "explanation", "publication-policy"],
			requiredEvidenceKinds: ["spending-input", "spending-code-binding", "spending-verification"],
			maxOccurrences: 64,
			maxPending: 64,
			maxEffects: 64,
			maxEvidence: 512,
		}),
		{
			contract: "contract-v2",
			implementationRevision: "construction-v1",
			scope: "full",
			epoch: binding.compositionEpoch,
		},
		snapshot,
		materialProfile,
	);
	const issues = make(
		"issues",
		[
			selection,
			current,
			verification,
			local,
			inbox,
			material,
			store,
			permission,
			publication.causal.ports.issues,
		],
		(ctx) => {
			for (let i = 0; i < 9; i++)
				for (const raw of depBatch(ctx, i) ?? []) {
					const f = raw as any;
					if (f.kind === "issue") ctx.down([["DATA", f]]);
					else {
						if (f.issue) ctx.down([["DATA", f.issue]]);
						for (const x of f.issues ?? []) ctx.down([["DATA", x]]);
					}
				}
		},
	);
	const view = Object.freeze({
		assessment,
		publication: publication.publication,
		coverage: publication.causal.ports.coverage,
		issues,
		startup,
	});
	const summary =
		diagnostics === "summary"
			? make("summary", Object.values(view).slice(0, 4), (ctx) =>
					ctx.down([
						[
							"DATA",
							freeze({
								kind: "spending-diagnostic-summary",
								arrivals: ctx.waveData.map((_, i) => depBatch(ctx, i)?.length ?? 0),
							}),
						],
					]),
				)
			: undefined;
	for (const [node, deps] of edges)
		if (node.deps.length !== deps.length || node.deps.some((dep, i) => dep !== deps[i]))
			throw new TypeError("reference cold topology mismatch");
	assertCausalOccurrenceTopology(scope.readIncoming(), "spending/causal");
	return {
		view,
		capabilities: publication.causal.full,
		roots: publication.causal.roots,
		summary,
		nodes,
		store,
		snapshot,
		publication,
	};
}
type Rows = {
	maps: Map<string, Item<any>>[];
	valid: boolean[];
	issued?: Map<string, Decision>;
	receipts?: Map<string, VerificationReceipt>;
};
function collect(ctx: Parameters<NodeFn>[0], count: number): Rows {
	const s = ctx.state.get<Rows>() ?? {
		maps: Array.from({ length: count }, () => new Map()),
		valid: Array(count).fill(false),
	};
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
			const f = raw as BusinessFrame<any>;
			s.valid[i] = f.valid;
			if (!f.valid) {
				s.maps[i].clear();
				continue;
			}
			for (const row of f.rows) {
				const id = key(row.evaluation);
				if (s.maps[i].has(id) || s.maps[i].size < 64) s.maps[i].set(id, row);
			}
		}
	}
	ctx.state.set(s);
	return s;
}
