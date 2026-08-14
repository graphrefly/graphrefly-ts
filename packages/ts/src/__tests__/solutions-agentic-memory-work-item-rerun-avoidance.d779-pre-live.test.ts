import { chmod, mkdtemp, readdir, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { empiricalStrictJsonDigest } from "../../evals/empirical-memory-rerun-avoidance/canonical.js";
import {
	createD779InjectedBaselineForTest,
	persistD779InjectedBundleForTest,
	runD779InjectedNoNetworkQualification,
	validateD779QualificationBundle,
} from "../../evals/empirical-memory-rerun-avoidance/d779-pre-live-qualification.js";
import { executeD779ToolBoundary } from "../../evals/empirical-memory-rerun-avoidance/d779-provider-capable-composition.js";

const sha = (label: string) => empiricalStrictJsonDigest({ label });

describe("D779 real provider-capable task/tool composition", () => {
	it("qualifies six serial arms with exact task and sanitized rejection Graph bijections", async () => {
		const baseline = createD779InjectedBaselineForTest();
		const bundle = await runD779InjectedNoNetworkQualification(baseline);
		await expect(runD779InjectedNoNetworkQualification(baseline)).rejects.toThrow(/replayed/);
		const validated = validateD779QualificationBundle(bundle);
		expect(validated.qualification.completedArms).toBe(6);
		expect(validated.qualification.maxActiveEffects).toBe(1);
		expect(validated.taskExposureFacts.length).toBeGreaterThan(6);
		expect(validated.diagnosticToolRejectionFacts.map((fact) => fact.causeCode).sort()).toEqual([
			"exact-replacement-not-applicable",
			"focused-validation-failed",
			"malformed-arguments",
			"path-not-allowed",
			"unexpected-arguments",
		]);
		expect(validated.qualification.adapterSideLedgerCount).toBe(0);

		const forged = structuredClone(bundle) as any;
		forged.taskExposureFacts[0].reconciliationDigest = sha("substituted-reconciliation");
		const { factDigest: _factDigest, ...factMaterial } = forged.taskExposureFacts[0];
		forged.taskExposureFacts[0].factDigest = empiricalStrictJsonDigest(factMaterial);
		const { bundleDigest: _bundleDigest, ...bundleMaterial } = forged;
		forged.bundleDigest = empiricalStrictJsonDigest(bundleMaterial);
		expect(() => validateD779QualificationBundle(forged)).toThrow(/not exact/);

		for (const stage of ["after-claim", "after-write", "after-rename", "after-marker"] as const) {
			const privateRoot = await realpath(
				await mkdtemp(join(tmpdir(), `graphrefly-d779-${stage}-`)),
			);
			await chmod(privateRoot, 0o700);
			try {
				await expect(
					persistD779InjectedBundleForTest({ privateRoot, bundle }, stage),
				).rejects.toThrow(/injected/);
				expect(await readdir(privateRoot)).toEqual([]);
			} finally {
				await rm(privateRoot, { recursive: true, force: true });
			}
		}
	}, 60_000);

	it("rejects bounded-tool state drift instead of minting a sanitized proposal", async () => {
		const workspaceStates = [sha("before"), sha("after")];
		let snapshot = 0;
		await expect(
			executeD779ToolBoundary({
				input: {
					request: {} as never,
					admission: {} as never,
					effectRequest: {
						kind: "graph-effect-request",
						effectKind: "tool-action",
						runSequence: 0,
						effectSequence: 1,
						attemptOrdinal: 1,
						requestDigest: sha("tool-request"),
						logicalRequestDigest: sha("logical"),
						issuedRequestDigest: sha("issued"),
						workspaceStateDigest: workspaceStates[0]!,
						phaseBefore: "inspection",
						toolIntent: {
							toolRef: "read-file",
							intentDigest: sha("intent"),
						},
						retryReason: "none",
						retryAfterMs: null,
					} as never,
				},
				execute: async () => {
					throw new TypeError("D779 read path is not allowed");
				},
				snapshotWorkspaceState: async () => workspaceStates[snapshot++]!,
				elapsedOnRejectionMs: () => 1,
			}),
		).rejects.toThrow(/changed workspace state/);
	});
});
