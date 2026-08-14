import { chmod, mkdtemp, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { empiricalStrictJsonDigest } from "../../evals/empirical-memory-rerun-avoidance/canonical.js";
import {
	D781_BASELINE_COMMIT,
	D781_BUDGET_LIMITS,
	D781_D780_FORENSIC_ARTIFACT_SHA256,
	D781_DECISION_REF,
	D781_HISTORICAL_ARTIFACT_SHA256,
	D781_HISTORICAL_IMPLEMENTATION_MANIFEST_DIGEST,
	D781_QUALIFIED_IMPLEMENTATION_MANIFEST_DIGEST,
} from "../../evals/empirical-memory-rerun-avoidance/d781-coordinates.js";
import {
	isD781GraphSynthesizedToolFailureForTest,
	validateD781D780ForensicBytes,
} from "../../evals/empirical-memory-rerun-avoidance/d781-graph-native-live.js";
import {
	D781_IMPLEMENTATION_MANIFEST_DIGEST,
	measureD781Implementation,
} from "../../evals/empirical-memory-rerun-avoidance/d781-implementation-manifest.js";
import {
	createD781D780ForensicBytesForTest,
	runD781InjectedNoNetworkQualification,
} from "../../evals/empirical-memory-rerun-avoidance/d781-pre-live-qualification.js";
import { acquireD781SingleUseDispatchClaimAtRootForTest } from "../../evals/empirical-memory-rerun-avoidance/d781-single-use-dispatch-claim.js";

const sha = (label: string) => empiricalStrictJsonDigest({ label });

describe("D781 D780-forensic-bound Graph-native replacement", () => {
	it("freezes the approved D780 implementation and consumed failure boundary", () => {
		expect(D781_DECISION_REF).toBe("decision.D781");
		expect(D781_BASELINE_COMMIT).toBe("835e10a1");
		expect(D781_HISTORICAL_ARTIFACT_SHA256).toBe(
			"sha256:f75987d6854ff8212020d0c9749b4de285ad4f48eecc6f1d97cd6a4ff081beec",
		);
		expect(D781_QUALIFIED_IMPLEMENTATION_MANIFEST_DIGEST).toBe(
			"sha256:4b3f23f9b6b42e977dcb15869d76617ebaedb85724290fd8e7919ac2ff273328",
		);
		expect(D781_HISTORICAL_IMPLEMENTATION_MANIFEST_DIGEST).toBe(
			"sha256:5900a0b65b488370e498f4ed953329522e4585e44070b09e014f6269e675a066",
		);
		expect(D781_HISTORICAL_IMPLEMENTATION_MANIFEST_DIGEST).not.toBe(
			D781_QUALIFIED_IMPLEMENTATION_MANIFEST_DIGEST,
		);
		expect(D781_D780_FORENSIC_ARTIFACT_SHA256).toBe(
			"sha256:fe8d65bd3d05a88e9ac3d57096a6c8a3951cc4c0e2688044ac9a80394317ff6b",
		);
		expect(D781_BUDGET_LIMITS.maxCostMicrousd).toBe(6_000_000);
	});

	it("accepts only the exact material-free D780 consumed-failure forensic", () => {
		const bytes = createD781D780ForensicBytesForTest();
		validateD781D780ForensicBytes(bytes);
		const tampered = new Uint8Array(bytes);
		tampered[32] ^= 1;
		expect(() => validateD781D780ForensicBytes(tampered)).toThrow();
	});

	it("replays the complete injected six-arm D779 provider-envelope qualification", async () => {
		const qualification = await runD781InjectedNoNetworkQualification({
			d780ForensicBytes: createD781D780ForensicBytesForTest(),
		});
		expect(qualification.completedArms).toBe(6);
		expect(qualification.maxActiveArms).toBe(1);
		expect(qualification.providerNetworkCalls).toBe(0);
		expect(qualification.credentialReads).toBe(0);
		expect(qualification.workspaceResidueCount).toBe(0);
		expect(qualification.realRejectionBijectionPassed).toBe(true);
		expect(qualification.wrongToolSyntheticFailureWithoutProposalPassed).toBe(true);
	}, 30_000);

	it("binds the current implementation and makes the durable claim exclusive", async () => {
		expect(await measureD781Implementation()).toBe(D781_IMPLEMENTATION_MANIFEST_DIGEST);
		const root = await mkdtemp(join(tmpdir(), "graphrefly-d781-claim-"));
		await chmod(root, 0o700);
		try {
			const input = {
				pricingReadDigest: sha("pricing"),
				zeroByokObservationDigest: sha("zero-byok"),
				implementationManifestDigest: D781_IMPLEMENTATION_MANIFEST_DIGEST,
			};
			await acquireD781SingleUseDispatchClaimAtRootForTest(await realpath(root), input);
			await expect(
				acquireD781SingleUseDispatchClaimAtRootForTest(await realpath(root), input),
			).rejects.toThrow();
		} finally {
			await rm(root, { recursive: true, force: true });
		}
	});

	it("keeps Graph-synthesized failed tool effects separate from sanitized tool rejections", () => {
		for (const cause of ["executor-threw", "graph-admission-denied"] as const) {
			const requestDigest = sha(`request-${cause}`);
			expect(
				isD781GraphSynthesizedToolFailureForTest({
					kind: "graph-effect-result-admitted",
					request: { effectKind: "tool-action", requestDigest },
					result: {
						effectKind: "tool-action",
						status: "failed",
						evidenceDigest: empiricalStrictJsonDigest({ requestDigest, cause }),
					},
				}),
			).toBe(true);
		}
		const requestDigest = sha("sanitized-rejection");
		expect(
			isD781GraphSynthesizedToolFailureForTest({
				kind: "graph-effect-result-admitted",
				request: { effectKind: "tool-action", requestDigest },
				result: {
					effectKind: "tool-action",
					status: "failed",
					evidenceDigest: sha("sanitized-rejection-evidence"),
				},
			}),
		).toBe(false);
	});
});
