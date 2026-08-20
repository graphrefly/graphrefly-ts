import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
	empiricalStrictJsonDigest,
	strictSnapshot,
} from "../../evals/empirical-memory-rerun-avoidance/canonical.js";
import {
	CURRENT_GRAPH_LIVE_BUGGY_ADMISSION_BLOCK,
	CURRENT_GRAPH_LIVE_FIXED_ADMISSION_BLOCK,
} from "../../evals/empirical-memory-rerun-avoidance/d8-current-openrouter-adapter.js";
import { validateD36LiveBundle } from "../../evals/empirical-memory-rerun-avoidance/d36-retained-span-live.js";
import {
	D36_IMPLEMENTATION_MANIFEST_DIGEST,
	measureD36Implementation,
} from "../../evals/empirical-memory-rerun-avoidance/d36-retained-span-live-implementation-manifest.js";
import {
	createD36QualificationInjectedBaselineForTest,
	persistD36Qualification,
	runD36InjectedNoNetworkQualification,
	validateD36QualificationBundle,
} from "../../evals/empirical-memory-rerun-avoidance/d36-retained-span-live-qualification.js";

describe("graphrefly-ts:D36 retained-span live replacement", () => {
	it("binds the exact D36 decision-bearing implementation closure", async () => {
		const repositoryRoot = resolve(import.meta.dirname, "../../../..");
		expect(await measureD36Implementation(repositoryRoot)).toBe(D36_IMPLEMENTATION_MANIFEST_DIGEST);
	});

	it("qualifies six serial arms, retained retry identity, cleanup and partial persistence offline", async () => {
		const repositoryRoot = resolve(import.meta.dirname, "../../../..");
		const root = await mkdtemp(join(tmpdir(), "graphrefly-d36-test-"));
		const materializationRoot = join(root, "workspaces");
		try {
			const constructed = await runD36InjectedNoNetworkQualification({
				baseline: createD36QualificationInjectedBaselineForTest(),
				baselineBasis: "injected-test",
				repositoryRoot,
				materializationRoot,
			});
			const bundle = validateD36QualificationBundle(constructed);
			expect(bundle.qualification.exactSixArmsCompleted).toBe(true);
			expect(bundle.qualification.providerTransportCalls).toBe(25);
			expect(bundle.qualification.retainedSpanTransportCalls).toBe(7);
			expect(bundle.qualification.retryWaitCount).toBe(1);
			expect(bundle.qualification.maxActiveTransport).toBe(1);
			expect(bundle.qualification.providerNetworkCalls).toBe(0);
			expect(bundle.qualification.partialFailurePersistencePassed).toBe(true);
			expect(bundle.qualification.workspaceResidueCount).toBe(0);
			expect(bundle.mainBundle.gate.evaluated).toBe(false);
			expect(bundle.mainBundle.efficacyClaim).toBe("none");
			const serialized = JSON.stringify(bundle);
			expect(serialized).not.toContain(CURRENT_GRAPH_LIVE_BUGGY_ADMISSION_BLOCK);
			expect(serialized).not.toContain(CURRENT_GRAPH_LIVE_FIXED_ADMISSION_BLOCK);
			await expect(
				persistD36Qualification({ privateRoot: join(root, "private"), bundle: constructed }),
			).rejects.toThrow("requires consumed D35 artifact bytes");
		} finally {
			await rm(root, { recursive: true, force: true });
		}
	}, 120_000);

	it("rejects a redigested live-gate substitution", () => {
		const forgedGateBase = strictSnapshot({
			schemaVersion: "graphrefly-ts.d36.positive-differential-gate.v1",
			definitionDigest: "sha256:0000000000000000000000000000000000000000000000000000000000000000",
			evaluated: true,
			passed: true,
			failureCodes: [],
		});
		const forged = {
			schemaVersion: "graphrefly-ts.d36.retained-span-live-bundle.v1",
			decisionRef: "graphrefly-ts:D36",
			executionClass: "live-provider",
			disposition: "partial-failure",
			coordinatesDigest: "sha256:0000000000000000000000000000000000000000000000000000000000000000",
			implementationManifestDigest: D36_IMPLEMENTATION_MANIFEST_DIGEST,
			gate: { ...forgedGateBase, gateDigest: empiricalStrictJsonDigest(forgedGateBase) },
		};
		expect(() => validateD36LiveBundle(forged)).toThrow();
	});
});
