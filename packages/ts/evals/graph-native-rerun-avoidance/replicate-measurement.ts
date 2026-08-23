import {
	admitD45EffectResult,
	createD45GraphToolAuthority,
	type D68GraphProgressV1,
	snapshotD45CanonicalEvidence,
	snapshotD45PartialCanonicalEvidence,
	snapshotD68GraphProgress,
	takeD45AdmittedEffect,
	validateD45CanonicalEvidence,
	validateD45PartialCanonicalEvidence,
} from "./graph-tool-authority.js";
import {
	createExactModelHarnessProfileInput,
	D45_READABLE_PATHS,
	D45_TASK_MATERIAL,
	D45_WRITABLE_PATH,
} from "./graph-tool-qualification.js";
import type { D44LiveExecutorV1 } from "./live-effect-executor.js";
import {
	consumeD65ReplicateExecution,
	createD65ReplicateCampaign,
	type D65AdmittedReplicateV1,
	type D65ReplicateExecutionV1,
} from "./replicated-campaign-authority.js";

export const D65_REPLICATE_MEASUREMENT_REVISION =
	"graphrefly-ts.d65.replicate-measurement.v1" as const;

export async function runD65ReplicateMeasurement(input: {
	readonly executor: D44LiveExecutorV1;
	readonly injectedNoNetwork: boolean;
	readonly replicateExecution: D65ReplicateExecutionV1;
	readonly onProgress?: (progress: D68GraphProgressV1) => void;
}): Promise<
	| Readonly<{
			disposition: "success";
			evidence: ReturnType<typeof validateD45CanonicalEvidence>;
			providerCalls: number;
			retryWaitElapsedMs: number;
	  }>
	| Readonly<{
			disposition: "partial-failure";
			partialEvidence: ReturnType<typeof validateD45PartialCanonicalEvidence>;
			providerCalls: number;
			retryWaitElapsedMs: number;
	  }>
> {
	let replicateAdmission: D65AdmittedReplicateV1;
	try {
		replicateAdmission = consumeD65ReplicateExecution(input.replicateExecution);
	} catch (error) {
		await input.executor.dispose();
		throw error;
	}
	const campaign = createD65ReplicateCampaign(replicateAdmission);
	const authority = createD45GraphToolAuthority({
		profileInput: createExactModelHarnessProfileInput(),
		assignmentRef: replicateAdmission.assignmentRef,
		readablePaths: D45_READABLE_PATHS,
		writablePath: D45_WRITABLE_PATH,
		taskMaterial: D45_TASK_MATERIAL,
		routeProfile: { reasoningEffort: "high", requireParameters: true },
		campaign,
	});
	let providerCalls = 0;
	let retryWaitElapsedMs = 0;
	let pendingRetry: Readonly<{ logicalRequestDigest: string; delayMs: number }> | null = null;
	let result:
		| Readonly<{
				disposition: "success";
				evidence: ReturnType<typeof validateD45CanonicalEvidence>;
				providerCalls: number;
				retryWaitElapsedMs: number;
		  }>
		| Readonly<{
				disposition: "partial-failure";
				partialEvidence: ReturnType<typeof validateD45PartialCanonicalEvidence>;
				providerCalls: number;
				retryWaitElapsedMs: number;
		  }>;
	try {
		for (;;) {
			const effect = takeD45AdmittedEffect(authority);
			if (effect === null) break;
			input.onProgress?.(snapshotD68GraphProgress(authority));
			if (
				snapshotD45PartialCanonicalEvidence(authority).budget.confirmedElapsedMs +
					retryWaitElapsedMs >
				campaign.maxElapsedMs
			)
				throw new TypeError("D65 admitted effect exceeded retry-adjusted elapsed headroom");
			if (effect.effectKind === "provider-proposal") {
				if (pendingRetry !== null) {
					if (effect.logicalRequestDigest !== pendingRetry.logicalRequestDigest)
						throw new TypeError("D65 Graph retry identity drifted");
					const currentElapsed =
						snapshotD45PartialCanonicalEvidence(authority).budget.confirmedElapsedMs;
					if (currentElapsed + retryWaitElapsedMs + pendingRetry.delayMs > campaign.maxElapsedMs)
						throw new TypeError("D65 retry wait exceeded its Graph-admitted elapsed headroom");
					if (!input.injectedNoNetwork && pendingRetry.delayMs > 0)
						await new Promise((resolvePromise) =>
							setTimeout(resolvePromise, pendingRetry!.delayMs),
						);
					retryWaitElapsedMs += pendingRetry.delayMs;
					pendingRetry = null;
				}
				providerCalls += 1;
			}
			const executed = await input.executor.execute(authority, effect);
			admitD45EffectResult(authority, effect, executed.result);
			input.onProgress?.(snapshotD68GraphProgress(authority));
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
		const evidence = validateD45CanonicalEvidence(snapshotD45CanonicalEvidence(authority));
		result = Object.freeze({ disposition: "success", evidence, providerCalls, retryWaitElapsedMs });
	} catch (error) {
		if (input.injectedNoNetwork) {
			await input.executor.dispose();
			throw error;
		}
		const partialEvidence = validateD45PartialCanonicalEvidence(
			snapshotD45PartialCanonicalEvidence(authority),
		);
		result = Object.freeze({
			disposition: "partial-failure",
			partialEvidence,
			providerCalls,
			retryWaitElapsedMs,
		});
	}
	try {
		await input.executor.dispose();
	} catch {
		const partialEvidence = validateD45PartialCanonicalEvidence(
			snapshotD45PartialCanonicalEvidence(authority),
		);
		return Object.freeze({
			disposition: "partial-failure",
			partialEvidence,
			providerCalls,
			retryWaitElapsedMs,
		});
	}
	return result;
}
