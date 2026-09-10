/** Independent pairwise business oracle. Type-only shared passive formats; no candidate helpers. */
import type { Evaluation, SpendingBinding } from "../../examples/spending-alerts/causal-inputs.js";
import { referenceFixed, referenceNumbers } from "./spending-numeric-oracle.js";
import {
	oracleCanonical,
	oracleFreeze,
	oracleHash,
	oracleMaterial,
} from "./spending-publication-oracle.js";
export { oracleCanonical, oracleFreeze, oracleHash };
export function oracleBusiness(e: Evaluation) {
	const { mean, std, zScore, dailyRatio } = referenceNumbers(
		e.prefix.map((t) => t.amount),
		e.profile.dailyAverage,
	);
	const txn = e.prefix[e.prefix.length - 1];
	const known = e.profile.typicalCategories.indexOf(txn.category) !== -1;
	const flags = [zScore > e.policy.zThreshold, dailyRatio > e.policy.dailyRatioThreshold, !known],
		flagged = flags.some(Boolean);
	const factors = [
		`Amount is ${referenceFixed(zScore, 2)}σ above this vendor's historical mean.`,
		`Amount is ${referenceFixed(dailyRatio, 1)}× the user's daily average.`,
		"Category is outside the user's typical spend profile.",
	].filter((_, i) => flags[i]);
	const severity = factors.length > 2 ? "high" : factors.length === 2 ? "medium" : "low";
	const message = flagged
		? [
				`Transaction ${txn.id} flagged — severity: ${severity}.`,
				`Vendor: ${txn.vendor}  Amount: $${referenceFixed(txn.amount, 2)}  Category: ${txn.category}`,
				"Reasoning:",
				...factors.map((f) => `  • ${f}`),
			].join("\n")
		: `Transaction ${txn.id} ($${referenceFixed(txn.amount, 2)} at ${txn.vendor}) — normal.`;
	return oracleFreeze({ mean, std, zScore, dailyRatio, flagged, factors, severity, message, txn });
}
export function oracleRequest(e: Evaluation, b: SpendingBinding) {
	const result = oracleBusiness(e);
	if (!result.flagged) return undefined;
	const payloadText = oracleCanonical({
		transactionId: result.txn.id,
		vendor: result.txn.vendor,
		severity: result.severity,
		message: result.message,
	});
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
export function verifyBusiness(
	e: Evaluation,
	observed: {
		score: { zScore: number; dailyRatio: number };
		flagged: boolean;
		reason: { factors: readonly string[]; severity: string };
		message: string;
	},
): boolean {
	if (!Number.isFinite(observed.score.zScore) || !Number.isFinite(observed.score.dailyRatio))
		return false;
	const expected = oracleBusiness(e),
		close = (a: number, b: number) =>
			Number.isFinite(a) && Math.abs(a - b) <= 1e-10 * Math.max(1, Math.abs(b));
	const actualFlags = [
		observed.score.zScore > e.policy.zThreshold,
		observed.score.dailyRatio > e.policy.dailyRatioThreshold,
		!e.profile.typicalCategories.includes(expected.txn.category),
	];
	const actualFactors = [
		`Amount is ${referenceFixed(observed.score.zScore, 2)}σ above this vendor's historical mean.`,
		`Amount is ${referenceFixed(observed.score.dailyRatio, 1)}× the user's daily average.`,
		"Category is outside the user's typical spend profile.",
	].filter((_, i) => actualFlags[i]);
	return (
		observed.flagged === actualFlags.some(Boolean) &&
		oracleCanonical(observed.reason.factors) === oracleCanonical(actualFactors) &&
		close(observed.score.zScore, expected.zScore) &&
		close(observed.score.dailyRatio, expected.dailyRatio) &&
		observed.flagged === expected.flagged &&
		observed.reason.severity === expected.severity &&
		oracleCanonical(observed.reason.factors) === oracleCanonical(expected.factors) &&
		observed.message === expected.message
	);
}
