import { chmod, mkdtemp, readFile, realpath, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { empiricalSha256 } from "../../evals/empirical-memory-rerun-avoidance/canonical.js";
import { runCurrentGraphNativeNoNetworkQualification as runD5Qualification } from "../../evals/empirical-memory-rerun-avoidance/d5-inspection-batch-qualification.js";
import {
	CURRENT_GRAPH_LIVE_IMPLEMENTATION_MANIFEST_DIGEST as D8_IMPLEMENTATION_MANIFEST_DIGEST,
	measureCurrentGraphLiveImplementation as measureD8Implementation,
} from "../../evals/empirical-memory-rerun-avoidance/d8-current-implementation-manifest.js";
import { CURRENT_GRAPH_LIVE_D5_QUALIFICATION_ARTIFACT_DIGEST } from "../../evals/empirical-memory-rerun-avoidance/d8-current-live-coordinates.js";
import {
	persistCurrentGraphLiveQualification as persistD8Qualification,
	runCurrentGraphLiveNoNetworkQualification as runD8Qualification,
	validateCurrentGraphLiveQualificationBundle as validateD8Qualification,
} from "../../evals/empirical-memory-rerun-avoidance/d8-current-pre-live-qualification.js";
import { strictJsonCodec } from "../../src/json/codec.js";

const roots: string[] = [];

afterEach(async () => {
	await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("graphrefly-ts:D8 current Graph-native provider pre-live", () => {
	it("qualifies the D5 four-read Graph through the provider-capable six-arm composition", async () => {
		const repositoryRoot = resolve(import.meta.dirname, "../../../..");
		const d5Bundle = await runD5Qualification();
		const d5Bytes = strictJsonCodec.encode(d5Bundle);
		expect(empiricalSha256(d5Bytes)).toBe(CURRENT_GRAPH_LIVE_D5_QUALIFICATION_ARTIFACT_DIGEST);
		expect(await measureD8Implementation(repositoryRoot)).toBe(D8_IMPLEMENTATION_MANIFEST_DIGEST);

		const tampered = d5Bytes.slice();
		tampered[tampered.length - 1] ^= 1;
		await expect(
			runD8Qualification({
				repositoryRoot,
				d5QualificationBundleBytes: tampered,
				implementationManifestDigest: D8_IMPLEMENTATION_MANIFEST_DIGEST,
			}),
		).rejects.toThrow("D5 qualification artifact drifted");

		const constructed = await runD8Qualification({
			repositoryRoot,
			d5QualificationBundleBytes: d5Bytes,
			implementationManifestDigest: D8_IMPLEMENTATION_MANIFEST_DIGEST,
		});
		const bundle = validateD8Qualification(constructed);
		expect(bundle.qualification).toMatchObject({
			decisionRef: "graphrefly-ts:D8",
			fullSixArmIntegrationPassed: true,
			fourReadInspectionBatchCount: 6,
			serialReadEffectCount: 24,
			providerAttempts: 13,
			retryWaits: 1,
			maxActiveTransport: 1,
			providerNetworkCalls: 0,
			workspaceResidueCount: 0,
			causalAttribution: "undetermined",
			efficacyClaim: "none",
		});
		expect(bundle.graphBundle.graphEvidence?.workflowEvidence.runs).toHaveLength(6);
		expect(
			bundle.graphBundle.graphEvidence?.workflowEvidence.runs.every(
				(run) => run.cleanupStatus === "completed",
			),
		).toBe(true);

		const privateRoot = await mkdtemp(join(tmpdir(), "graphrefly-d8-pre-live-"));
		await chmod(privateRoot, 0o700);
		const canonicalRoot = await realpath(privateRoot);
		roots.push(canonicalRoot);
		const receipt = await persistD8Qualification({
			privateRoot: canonicalRoot,
			bundle: constructed,
		});
		const artifactRoot = join(canonicalRoot, receipt.generationRef, "artifacts");
		expect((await stat(join(artifactRoot, "bundle.v1.json"))).mode & 0o777).toBe(0o600);
		expect(await readFile(join(artifactRoot, "bundle.v1.json"))).not.toHaveLength(0);

		const replayRoot = await mkdtemp(join(tmpdir(), "graphrefly-d8-replay-"));
		await chmod(replayRoot, 0o700);
		roots.push(await realpath(replayRoot));
		await expect(
			persistD8Qualification({ privateRoot: replayRoot, bundle: constructed }),
		).rejects.toThrow("same-process and single-use");
	}, 300_000);
});
