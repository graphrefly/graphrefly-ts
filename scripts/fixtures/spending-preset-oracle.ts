/** Independent two-pass business oracle. Type-only shared passive formats; no candidate helpers. */
import type { Evaluation, SpendingBinding } from "../../examples/spending-alerts/causal-inputs.js";
import {
	oracleCanonical,
	oracleFreeze,
	oracleHash,
	oracleMaterial,
} from "./spending-publication-oracle.js";
export { oracleCanonical, oracleFreeze, oracleHash };
export function oracleBusiness(e: Evaluation) {
	const amounts = e.prefix.map((t) => t.amount),
		n = amounts.length,
		mean = amounts.reduce((a, b) => a + b, 0) / n;
	const variance =
		n > 1 ? amounts.map((x) => (x - mean) ** 2).reduce((a, b) => a + b, 0) / (n - 1) : 0;
	const std = Math.sqrt(variance),
		txn = e.prefix[n - 1],
		zScore = (txn.amount - mean) / (std > 0 ? std : Math.max(mean, 1)),
		dailyRatio = txn.amount / Math.max(e.profile.dailyAverage, 1);
	const known = e.profile.typicalCategories.indexOf(txn.category) !== -1;
	const flags = [zScore > e.policy.zThreshold, dailyRatio > e.policy.dailyRatioThreshold, !known],
		flagged = flags.some(Boolean);
	const factors = [
		`Amount is ${zScore.toFixed(2)}σ above this vendor's historical mean.`,
		`Amount is ${dailyRatio.toFixed(1)}× the user's daily average.`,
		"Category is outside the user's typical spend profile.",
	].filter((_, i) => flags[i]);
	const severity = factors.length > 2 ? "high" : factors.length === 2 ? "medium" : "low";
	const message = flagged
		? [
				`Transaction ${txn.id} flagged — severity: ${severity}.`,
				`Vendor: ${txn.vendor}  Amount: $${txn.amount.toFixed(2)}  Category: ${txn.category}`,
				"Reasoning:",
				...factors.map((f) => `  • ${f}`),
			].join("\n")
		: `Transaction ${txn.id} ($${txn.amount.toFixed(2)} at ${txn.vendor}) — normal.`;
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
	const expected = oracleBusiness(e),
		close = (a: number, b: number) =>
			Number.isFinite(a) && Math.abs(a - b) <= 1e-10 * Math.max(1, Math.abs(b));
	return (
		close(observed.score.zScore, expected.zScore) &&
		close(observed.score.dailyRatio, expected.dailyRatio) &&
		observed.flagged === expected.flagged &&
		observed.reason.severity === expected.severity &&
		oracleCanonical(observed.reason.factors) === oracleCanonical(expected.factors) &&
		observed.message === expected.message
	);
}
