import { chmod, lstat, mkdtemp, readdir, readFile, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { runD729InjectedNoNetworkQualification } from "../../evals/empirical-memory-rerun-avoidance/d729-graph-native-live.js";
import { attestD731ImplementationBytes } from "../../evals/empirical-memory-rerun-avoidance/d731-implementation-manifest.js";
import {
	createD731EndpointEligibilityFixtureBytes,
	createD731RepeatedTerminalInjectedFixture,
} from "../../evals/empirical-memory-rerun-avoidance/d731-injected-route-repair-fixture.js";
import {
	createD731RouteParameterEligibility,
	validateD731RouteParameterEligibility,
} from "../../evals/empirical-memory-rerun-avoidance/d731-route-parameter-eligibility.js";
import {
	createD731PersistenceFaultForTest,
	createD731PreLiveQualification,
	D731_GENERATION_REF,
	persistD731PreLiveBundle,
	validateD731PreLiveBundle,
} from "../../evals/empirical-memory-rerun-avoidance/d731-route-repair-pre-live.js";

async function qualificationBundle() {
	const trackedRoot = join(import.meta.dirname, "../../evals/empirical-memory-rerun-avoidance");
	const privateRoot = join(
		import.meta.dirname,
		"../../evals/.private/empirical-memory-rerun-avoidance",
	);
	const bytes = async (path: string) => new Uint8Array(await readFile(path));
	const implementationAttestation = attestD731ImplementationBytes({
		tracked: {
			graphLedger: await bytes(join(trackedRoot, "d719-clean-graph-ledger.ts")),
			graphRuntime: await bytes(join(trackedRoot, "d722-graph-native-effect-runtime.ts")),
			graphEval: await bytes(join(trackedRoot, "d722-graph-native-eval.ts")),
			providerTurn: await bytes(join(trackedRoot, "d723-openrouter-graph-turn.ts")),
			terminalHttp: await bytes(join(trackedRoot, "d724-terminal-http-evidence.ts")),
			providerCore: await bytes(join(trackedRoot, "d729-provider-block-core.ts")),
			liveBundle: await bytes(join(trackedRoot, "d729-graph-native-live.ts")),
			routeEligibility: await bytes(join(trackedRoot, "d731-route-parameter-eligibility.ts")),
			injectedFixture: await bytes(join(trackedRoot, "d731-injected-route-repair-fixture.ts")),
			preLive: await bytes(join(trackedRoot, "d731-route-repair-pre-live.ts")),
		},
		private: {
			noNetworkRunner: await bytes(join(privateRoot, "run-d731-no-network-pre-live.ts")),
		},
	});
	const fixture = createD731RepeatedTerminalInjectedFixture();
	const repeatedTerminalBundle = await runD729InjectedNoNetworkQualification({
		adapter: fixture.adapter,
		providerTransportCalls: fixture.providerCalls,
		signal: new AbortController().signal,
	});
	expect(fixture.providerCalls()).toBe(6);
	expect(fixture.activeRunCount()).toBe(0);
	const bundle = createD731PreLiveQualification({
		implementationAttestation,
		routeEligibility: createD731RouteParameterEligibility({
			responseBytes: createD731EndpointEligibilityFixtureBytes(),
		}),
		capturedWireBody: fixture.capturedWireBody(),
		repeatedTerminalBundle,
	});
	return { bundle, repeatedTerminalBundle };
}

describe("D731 Graph-native route evidence repair", () => {
	it("requires every actual wire parameter and omits parallel_tool_calls", () => {
		const eligibility = createD731RouteParameterEligibility({
			responseBytes: createD731EndpointEligibilityFixtureBytes(),
		});
		expect(validateD731RouteParameterEligibility(eligibility)).toMatchObject({
			requireParameters: true,
			parallelToolCallsFieldPresent: false,
			eligible: true,
		});
		for (const missing of ["reasoning", "tool_choice", "tools"])
			expect(() =>
				createD731RouteParameterEligibility({
					responseBytes: createD731EndpointEligibilityFixtureBytes(
						["reasoning", "tool_choice", "tools"].filter((value) => value !== missing),
					),
				}),
			).toThrow(/does not support/);
	});

	it("records identical HTTP 404 results for all six distinct Graph admissions", async () => {
		const { bundle, repeatedTerminalBundle } = await qualificationBundle();
		const facts = repeatedTerminalBundle.terminalHttpGraphEvidence.facts;
		expect(repeatedTerminalBundle.graphEvidence.ledger.completedArms).toHaveLength(6);
		expect(facts).toHaveLength(6);
		expect(new Set(facts.map((fact) => fact.effectAdmissionDigest)).size).toBe(6);
		expect(new Set(facts.map((fact) => fact.providerResultDigest)).size).toBe(1);
		expect(repeatedTerminalBundle.executorFailureFacts).toEqual([]);
		expect(validateD731PreLiveBundle(bundle).bundleDigest).toBe(bundle.bundleDigest);
	});

	it("persists atomically and removes every injected partial generation", async () => {
		for (const stage of ["after-write", "after-rename"] as const) {
			const root = await mkdtemp(join(tmpdir(), `graphrefly-d731-${stage}-`));
			await chmod(root, 0o700);
			try {
				const { bundle } = await qualificationBundle();
				await expect(
					persistD731PreLiveBundle({
						privateRoot: await realpath(root),
						bundle,
						fault: createD731PersistenceFaultForTest(stage),
					}),
				).rejects.toThrow(/injected/);
				expect(await readdir(root)).toEqual([]);
			} finally {
				await rm(root, { recursive: true, force: true });
			}
		}
		const root = await mkdtemp(join(tmpdir(), "graphrefly-d731-success-"));
		await chmod(root, 0o700);
		try {
			const { bundle } = await qualificationBundle();
			const receipt = await persistD731PreLiveBundle({
				privateRoot: await realpath(root),
				bundle,
			});
			expect(receipt.generationRef).toBe(D731_GENERATION_REF);
			for (const name of [
				"route-eligibility.v1.json",
				"qualification.v1.json",
				"generation.v1.json",
				"bundle.v1.json",
			])
				expect((await lstat(join(root, D731_GENERATION_REF, "artifacts", name))).mode & 0o777).toBe(
					0o600,
				);
		} finally {
			await rm(root, { recursive: true, force: true });
		}
	}, 30_000);
});
