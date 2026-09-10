/** D164: bounded business nodes. Each named computation executes through its own dispatcher. */
import { depLatest, depWaves, type NodeFn } from "../../packages/ts/src/ctx/types.js";
import type { DataIssue } from "../../packages/ts/src/data/index.js";
import type { ConstructionScope } from "../../packages/ts/src/graph/construction-scope.js";
import type { Node } from "../../packages/ts/src/node/node.js";
import { SENTINEL } from "../../packages/ts/src/protocol/messages.js";
import {
	type ArrivalFrame,
	type Checked,
	checkInput,
	type Evaluation,
	type EvaluationPack,
	frozen,
	issue,
	occurrenceKey,
	type SpendingBinding,
	type SpendingInputs,
	type SpendingPolicy,
} from "./causal-inputs.js";
import { type ExactVendorStats, exactVendorStats, exactZScore } from "./causal-numeric.js";
import { canonicalMaterial } from "./causal-publication.js";
import type { AnomalyScore, Flagged, ReasonFactors, Transaction, UserProfile } from "./pipeline.js";

export interface Item<T> {
	readonly evaluation: Evaluation;
	readonly value: T;
}
export interface BusinessFrame<T> {
	readonly valid: boolean;
	readonly rows: readonly Item<T>[];
	readonly issues: readonly DataIssue[];
}
export function frame<T>(
	rows: readonly Item<T>[],
	issues: readonly DataIssue[] = [],
	valid = true,
): BusinessFrame<T> {
	return frozen({ valid, rows, issues });
}
export type MakeNode = <T>(name: string, deps: readonly Node<unknown>[], fn: NodeFn) => Node<T>;
/** Mechanical wrapper only; never runs another named node's business function inline. */
export function nodeMaker(
	scope: ConstructionScope,
	prefix: string,
	edges: Map<Node<unknown>, readonly Node<unknown>[]>,
): MakeNode {
	return <T>(name: string, deps: readonly Node<unknown>[], fn: NodeFn) => {
		const expected = Object.freeze([...deps]);
		const node = scope.node<T>(
			expected,
			(ctx) => {
				if (node.deps.length !== expected.length || node.deps.some((d, i) => d !== expected[i])) {
					ctx.down([["ERROR", new TypeError(`spending dependency mismatch: ${name}`)]]);
					return;
				}
				fn(ctx);
			},
			{
				name: `${prefix}/${name}`,
				factory: `spending/${name}`,
				partial: true,
				errorWhenDepsError: true,
			},
		);
		edges.set(node, expected);
		return node;
	};
}
export function project<T, U>(
	make: MakeNode,
	name: string,
	input: Node<BusinessFrame<T>>,
	fn: (v: T, e: Evaluation) => U,
): Node<BusinessFrame<U>> {
	return make(name, [input], (ctx) => {
		for (const raw of depWaves(ctx, 0).flat()) {
			if (raw === SENTINEL) {
				ctx.down([["DATA", frame([], [], false)]]);
				continue;
			}
			const f = raw as BusinessFrame<T>;
			ctx.down([
				[
					"DATA",
					frame(
						f.rows.map((r) => ({ evaluation: r.evaluation, value: fn(r.value, r.evaluation) })),
						f.issues,
						f.valid,
					),
				],
			]);
		}
	});
}
/** Finite exact-key join; invalid DATA and native invalidation revoke the corresponding input. */
export function join<T>(
	make: MakeNode,
	name: string,
	deps: readonly Node<BusinessFrame<unknown>>[],
	fn: (values: readonly unknown[], e: Evaluation) => T,
): Node<BusinessFrame<T>> {
	return make(name, deps, (ctx) => {
		let state = ctx.state.get<{ maps: Map<string, Item<unknown>>[]; valid: boolean[] }>();
		if (!state) {
			state = { maps: deps.map(() => new Map()), valid: deps.map(() => false) };
			ctx.state.set(state);
		}
		const touched = new Set<string>(),
			issues: DataIssue[] = [];
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
				const f = raw as BusinessFrame<unknown>;
				state.valid[i] = f.valid;
				issues.push(...f.issues);
				if (!f.valid) {
					state.maps[i].clear();
					continue;
				}
				for (const row of f.rows) {
					const k = occurrenceKey(row.evaluation.occurrence);
					if (!state.maps[i].has(k) && state.maps[i].size >= 64) {
						issues.push(issue("join-capacity", row.evaluation.evaluationRef));
						continue;
					}
					state.maps[i].set(k, row);
					touched.add(k);
				}
			}
		}
		if (!state.valid.every(Boolean)) {
			ctx.down([["DATA", frame([], issues, false)]]);
			return;
		}
		const rows: Item<T>[] = [];
		for (const k of touched) {
			const parts = state.maps.map((m) => m.get(k));
			if (parts.every((p) => p !== undefined)) {
				const e = parts[0]!.evaluation;
				if (
					parts.some(
						(p) => p!.evaluation !== e && canonicalMaterial(p!.evaluation) !== canonicalMaterial(e),
					)
				) {
					issues.push(issue("join-conflict", e.evaluationRef));
					continue;
				}
				rows.push({
					evaluation: e,
					value: fn(
						parts.map((p) => p!.value),
						e,
					),
				});
			}
		}
		if (rows.length || issues.length) ctx.down([["DATA", frame(rows, issues)]]);
	});
}
export function checked<T>(
	make: MakeNode,
	name: string,
	source: Node<unknown>,
	kind: Parameters<typeof checkInput>[0],
	binding: SpendingBinding,
): Node<Checked<T>> {
	return make(name, [source], (ctx) => {
		let state = ctx.state.get<{ seen: Map<string, string>; conflicts: Set<string> }>();
		if (!state) {
			state = { seen: new Map(), conflicts: new Set() };
			ctx.state.set(state);
		}
		for (const raw of depWaves(ctx, 0).flat()) {
			let result: Checked<T> =
				raw === SENTINEL
					? { valid: false, issue: issue(`invalidated-${kind}`) }
					: checkInput<T>(kind, raw, binding);
			// Each valid DATA is a complete available frame, never a patch over old permissions.
			// Only receipt identity/conflict evidence survives replacement and invalidation.
			if (result.valid && kind === "verification") {
				for (const entry of (result.value as { receipts: unknown[] }).receipts) {
					const key = canonicalMaterial((entry as { receiptRef: unknown }).receiptRef),
						text = canonicalMaterial(entry),
						prior = state.seen.get(key);
					if (prior !== undefined && prior !== text) state.conflicts.add(key);
					if (state.conflicts.has(key)) {
						result = { valid: false, issue: issue("receipt-identity-conflict") };
						break;
					}
					if (prior === undefined && state.seen.size >= 64) {
						result = { valid: false, issue: issue("receipt-lifetime-capacity") };
						break;
					}
					state.seen.set(key, text);
				}
			}
			ctx.state.set(state);
			ctx.down([["DATA", result]]);
		}
	});
}
export interface MessageValue {
	readonly message: string;
	readonly severity: ReasonFactors["severity"];
}
export interface Assessment {
	readonly kind: "spending-alerts/assessment";
	readonly evidenceMode: "fixture-observations";
	readonly binding: SpendingBinding;
	readonly evaluationRef: string;
	readonly occurrence: Evaluation["occurrence"];
	readonly inputDigest: string;
	readonly policyDigest: string;
	readonly flagged: boolean;
	readonly score: AnomalyScore;
	readonly reason: ReasonFactors;
	readonly message: string;
}
export function buildBusiness(make: MakeNode, inputs: SpendingInputs, binding: SpendingBinding) {
	const evaluationSelections = make<BusinessFrame<Evaluation>>(
		"evaluationSelections",
		[inputs.evaluations.pack, inputs.evaluations.arrivals],
		(ctx) => {
			let state = ctx.state.get<{
				pack?: EvaluationPack;
				text?: string;
				available: boolean;
				pending: string[];
			}>();
			if (!state) {
				state = { available: false, pending: [] };
				ctx.state.set(state);
			}
			const problems: DataIssue[] = [];
			if (depLatest(ctx, 0) === undefined) state.available = false;
			for (const raw of depWaves(ctx, 0).flat()) {
				const result: Checked<EvaluationPack> =
					raw === SENTINEL
						? { valid: false, issue: issue("invalidated-pack") }
						: checkInput<EvaluationPack>("pack", raw, binding);
				if (!result.valid) {
					state.available = false;
					problems.push(result.issue);
					continue;
				}
				const text = canonicalMaterial(result.value, 4 * 1048576);
				if (state.text !== undefined && state.text !== text) {
					state.available = false;
					problems.push(issue("pack-conflict"));
					continue;
				}
				state.pack = result.value;
				state.text = text;
				state.available = true;
			}
			const emitPending = () => {
				if (!state.available || !state.pack) return;
				const byRef = new Map(state.pack.evaluations.map((e) => [e.evaluationRef, e])),
					rows: Item<Evaluation>[] = [];
				for (const ref of state.pending) {
					const e = byRef.get(ref);
					if (e) rows.push({ evaluation: e, value: e });
					else problems.push(issue("unknown-evaluation", ref));
				}
				state.pending = [];
				if (rows.length || problems.length) ctx.down([["DATA", frame(rows, problems.splice(0))]]);
			};
			emitPending();
			for (const raw of depWaves(ctx, 1).flat()) {
				const result: Checked<ArrivalFrame> =
					raw === SENTINEL
						? { valid: false, issue: issue("invalidated-arrivals") }
						: checkInput<ArrivalFrame>("arrivals", raw, binding);
				if (!result.valid) {
					problems.push(result.issue);
					state.pending = [];
					ctx.down([["DATA", frame([], problems.splice(0), false)]]);
					continue;
				}
				for (const ref of result.value.evaluationRefs) {
					if (state.pending.length >= 64) {
						problems.push(issue("arrival-capacity", ref));
						break;
					}
					state.pending.push(ref);
				}
				// The bound is pending-before-pack, not an artificial cap across several ready frames.
				emitPending();
			}
			if (problems.length) ctx.down([["DATA", frame([], problems, false)]]);
		},
	);
	const transaction = project(
		make,
		"transaction",
		evaluationSelections,
		(e) => e.prefix[e.prefix.length - 1],
	);
	const vendorStats = project(make, "vendorStats", evaluationSelections, (e) =>
		exactVendorStats(e.prefix.map((t) => t.amount)),
	);
	const userProfile = project(make, "userProfile", evaluationSelections, (e) => e.profile);
	const policy = project(make, "policy", evaluationSelections, (e) => e.policy);
	const anomalyScore = join<AnomalyScore>(
		make,
		"anomalyScore",
		[transaction, vendorStats, userProfile],
		([rawTxn, rawStats, rawProfile]) => {
			const txn = rawTxn as Transaction,
				stats = rawStats as ExactVendorStats,
				prof = rawProfile as UserProfile;
			return {
				zScore: exactZScore(txn.amount, stats),
				dailyRatio: txn.amount / Math.max(prof.dailyAverage, 1),
				categoryFamiliarity: prof.typicalCategories.includes(txn.category) ? "known" : "unknown",
				txn,
			};
		},
	);
	const thresholdGate = join<Flagged>(make, "thresholdGate", [anomalyScore, policy], ([a, p]) => {
		const score = a as AnomalyScore,
			policy = p as SpendingPolicy;
		return {
			flagged:
				score.zScore > policy.zThreshold ||
				score.dailyRatio > policy.dailyRatioThreshold ||
				score.categoryFamiliarity === "unknown",
			threshold: policy.zThreshold,
			txn: score.txn,
			score,
		};
	});
	const reasonFactors = join<ReasonFactors>(
		make,
		"reasonFactors",
		[thresholdGate, policy],
		([g, p]) => {
			const gate = g as Flagged,
				policy = p as SpendingPolicy,
				{ score, txn } = gate,
				factors: string[] = [];
			if (gate.flagged) {
				if (score.zScore > policy.zThreshold)
					factors.push(
						`Amount is ${score.zScore.toFixed(2)}σ above this vendor's historical mean.`,
					);
				if (score.dailyRatio > policy.dailyRatioThreshold)
					factors.push(`Amount is ${score.dailyRatio.toFixed(1)}× the user's daily average.`);
				if (score.categoryFamiliarity === "unknown")
					factors.push("Category is outside the user's typical spend profile.");
			}
			return {
				factors,
				severity: factors.length >= 3 ? "high" : factors.length === 2 ? "medium" : "low",
				txn,
			};
		},
	);
	const alertMessage = project(make, "alertMessage", reasonFactors, (reason) => {
		const txn = reason.txn;
		if (!reason.factors.length)
			return {
				message: `Transaction ${txn.id} ($${txn.amount.toFixed(2)} at ${txn.vendor}) — normal.`,
				severity: reason.severity,
			};
		return {
			message: [
				`Transaction ${txn.id} flagged — severity: ${reason.severity}.`,
				`Vendor: ${txn.vendor}  Amount: $${txn.amount.toFixed(2)}  Category: ${txn.category}`,
				"Reasoning:",
				reason.factors.map((f) => `  • ${f}`).join("\n"),
			].join("\n"),
			severity: reason.severity,
		};
	});
	const assessment = join<Assessment>(
		make,
		"assessment",
		[thresholdGate, reasonFactors, alertMessage],
		([g, r, m], e) => ({
			kind: "spending-alerts/assessment",
			evidenceMode: "fixture-observations",
			binding,
			evaluationRef: e.evaluationRef,
			occurrence: e.occurrence,
			inputDigest: e.inputDigest,
			policyDigest: e.policyDigest,
			flagged: (g as Flagged).flagged,
			score: (g as Flagged).score,
			reason: r as ReasonFactors,
			message: (m as MessageValue).message,
		}),
	);
	return {
		evaluationSelections,
		transaction,
		vendorStats,
		userProfile,
		policy,
		anomalyScore,
		thresholdGate,
		reasonFactors,
		alertMessage,
		assessment,
	};
}
