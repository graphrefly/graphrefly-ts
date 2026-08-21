import { empiricalStrictJsonDigest } from "./canonical.js";
import type { D44LiveExecutorV1 } from "./d44-d45-live-composition.js";
import {
	admitD46EffectResult,
	admitD46FailureCleanupResult,
	createD46BoundedInspectionAuthority,
	type D46CanonicalEvidenceV1,
	type D46PartialCanonicalEvidenceV1,
	snapshotD46CanonicalEvidence,
	snapshotD46PartialCanonicalEvidence,
	takeD46AdmittedEffect,
	takeD46FailureCleanupEffect,
	validateD46CanonicalEvidence,
	validateD46PartialCanonicalEvidence,
} from "./d46-bounded-inspection-authority.js";

export const D46_COMPOSITION_REVISION =
	"graphrefly-ts.d46.bounded-inspection-composition.v2" as const;

export async function runD46BoundedInspectionMeasurement(input: {
	readonly executor: D44LiveExecutorV1;
	readonly injectedNoNetwork: boolean;
}): Promise<
	| Readonly<{
			disposition: "success";
			evidence: D46CanonicalEvidenceV1;
			providerCalls: number;
	  }>
	| Readonly<{
			disposition: "partial-failure";
			partialEvidence: D46PartialCanonicalEvidenceV1;
			providerCalls: number;
	  }>
> {
	const authority = createD46BoundedInspectionAuthority();
	let providerCalls = 0;
	let disposed = false;
	let pendingRetry: Readonly<{ logicalRequestDigest: string; delayMs: number }> | null = null;
	try {
		for (;;) {
			const effect = takeD46AdmittedEffect(authority);
			if (effect === null) break;
			if (effect.effectKind === "provider-proposal") {
				if (pendingRetry !== null) {
					if (effect.logicalRequestDigest !== pendingRetry.logicalRequestDigest)
						throw new TypeError("D46 Graph retry identity drifted");
					if (!input.injectedNoNetwork && pendingRetry.delayMs > 0)
						await new Promise((resolvePromise) =>
							setTimeout(resolvePromise, pendingRetry!.delayMs),
						);
					pendingRetry = null;
				}
				providerCalls += 1;
			}
			const executed = await input.executor.execute(authority, effect);
			admitD46EffectResult(authority, effect, executed.result);
			if (
				effect.effectKind === "provider-proposal" &&
				executed.result.effectKind === "provider-proposal" &&
				executed.result.retryClass !== null
			)
				pendingRetry = Object.freeze({
					logicalRequestDigest: effect.logicalRequestDigest,
					delayMs: executed.retryDelayMs,
				});
		}
		return Object.freeze({
			disposition: "success",
			evidence: validateD46CanonicalEvidence(snapshotD46CanonicalEvidence(authority)),
			providerCalls,
		});
	} catch (error) {
		if (input.injectedNoNetwork) throw error;
		const cleanup = takeD46FailureCleanupEffect(authority);
		const started = performance.now();
		let cleanupStatus: "completed" | "failed" = "completed";
		let cleanupCauseCode: null | "dispose-rejected" = null;
		disposed = true;
		try {
			await input.executor.dispose();
		} catch {
			cleanupStatus = "failed";
			cleanupCauseCode = "dispose-rejected";
		}
		admitD46FailureCleanupResult(authority, cleanup, {
			status: cleanupStatus,
			causeCode: cleanupCauseCode,
			elapsedMs: Math.min(30_000, Math.ceil(performance.now() - started)),
			evidenceDigest: empiricalStrictJsonDigest({
				cleanupAdmissionDigest: cleanup.cleanupAdmissionDigest,
				disposition: cleanupStatus === "completed" ? "disposed" : "dispose-rejected",
			}),
		});
		return Object.freeze({
			disposition: "partial-failure",
			partialEvidence: validateD46PartialCanonicalEvidence(
				snapshotD46PartialCanonicalEvidence(authority),
			),
			providerCalls,
		});
	} finally {
		if (!disposed) await input.executor.dispose();
	}
}
