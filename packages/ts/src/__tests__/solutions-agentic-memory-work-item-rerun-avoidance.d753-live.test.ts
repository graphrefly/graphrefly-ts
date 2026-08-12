import { chmod, mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { empiricalStrictJsonDigest } from "../../evals/empirical-memory-rerun-avoidance/canonical.js";
import { deriveD722CanonicalGraphEvidence } from "../../evals/empirical-memory-rerun-avoidance/d722-graph-completion-memory-insight.js";
import {
	createD726ArmLocalTerminalProviderPolicy,
	createD748GraphForwardPhaseContinuationPolicy,
} from "../../evals/empirical-memory-rerun-avoidance/d722-graph-native-effect-runtime.js";
import { D733_DEEPSEEK_V4_FLASH_0731_PROFILE } from "../../evals/empirical-memory-rerun-avoidance/d733-coordinates.js";
import {
	createD733GraphNativeRouteAdmission,
	createD733RouteAccessProjection,
	createD733RouteEligibility,
} from "../../evals/empirical-memory-rerun-avoidance/d733-graph-native-route-profile.js";
import { createD734InjectedRouteProfileFixture } from "../../evals/empirical-memory-rerun-avoidance/d734-injected-route-profile-fixture.js";
import {
	persistD753LiveBundle,
	runD753InjectedNoNetworkQualification,
	validateD753LiveBundle,
} from "../../evals/empirical-memory-rerun-avoidance/d753-graph-native-live.js";
import {
	D753_IMPLEMENTATION_MANIFEST_DIGEST,
	type D753_PRIVATE_SOURCE_SHA256,
	type D753_TRACKED_SOURCE_SHA256,
	validateD753ImplementationBytes,
} from "../../evals/empirical-memory-rerun-avoidance/d753-implementation-manifest.js";
import {
	D753_TRANSPORT_EVIDENCE_SCHEMA,
	validateD753TransportDiagnosticGraphEvidence,
} from "../../evals/empirical-memory-rerun-avoidance/d753-transport-diagnostic-route-adapter.js";

const root = join(
	import.meta.dirname,
	"../../evals/.private/empirical-memory-rerun-avoidance/.d752-private/d752-transport-diagnostic-provider-integration-pre-live-2026-08-12-v1/artifacts",
);

function admission() {
	const profile = D733_DEEPSEEK_V4_FLASH_0731_PROFILE;
	const responseBytes = new TextEncoder().encode(
		JSON.stringify({
			data: {
				id: profile.requestModel,
				endpoints: [
					{
						name: `${profile.providerName} | ${profile.selectedEndpointModel}`,
						provider_name: profile.providerName,
						tag: profile.providerTag,
						quantization: profile.quantization,
						model: profile.selectedEndpointModel,
						supported_parameters: ["reasoning", "tool_choice", "tools"],
						pricing: {
							prompt: profile.pricing.promptUsdPerToken,
							completion: profile.pricing.completionUsdPerToken,
							input_cache_read: profile.pricing.cacheReadUsdPerToken,
						},
					},
				],
			},
		}),
	);
	return createD733GraphNativeRouteAdmission({
		profile,
		access: createD733RouteAccessProjection({
			profile,
			observationRevision: "d753.test.v1",
			allowedModels: [profile.requestModel],
			allowedProviders: [profile.providerName],
		}),
		eligibility: createD733RouteEligibility({ profile, responseBytes }),
	});
}

async function sourceBytes() {
	const trackedRoot = join(import.meta.dirname, "../../evals/empirical-memory-rerun-avoidance");
	const privateRoot = join(
		import.meta.dirname,
		"../../evals/.private/empirical-memory-rerun-avoidance",
	);
	const trackedNames: Readonly<Record<keyof typeof D753_TRACKED_SOURCE_SHA256, string>> = {
		cleanGraphLedger: "d719-clean-graph-ledger.ts",
		graphRuntime: "d722-graph-native-effect-runtime.ts",
		graphProjection: "d722-graph-completion-memory-insight.ts",
		graphEval: "d722-graph-native-eval.ts",
		providerCore: "d729-provider-block-core.ts",
		providerTurn: "d723-openrouter-graph-turn.ts",
		routeIntegration: "d734-route-profile-provider-integration.ts",
		transportDiagnostic: "d751-sanitized-transport-diagnostic.ts",
		transportIntegration: "d752-provider-transport-diagnostic-integration.ts",
		transportRouteAdapter: "d753-transport-diagnostic-route-adapter.ts",
		coordinates: "d753-coordinates.ts",
		claim: "d753-single-use-dispatch-claim.ts",
		live: "d753-graph-native-live.ts",
	};
	const privateNames: Readonly<Record<keyof typeof D753_PRIVATE_SOURCE_SHA256, string>> = {
		realRouteAdapter: "d753-private-real-route-adapter.ts",
		noNetworkRunner: "run-d753-no-network-pre-live.ts",
		liveRunner: "run-d753-live.ts",
	};
	return {
		tracked: Object.fromEntries(
			await Promise.all(
				Object.entries(trackedNames).map(async ([key, file]) => [
					key,
					await readFile(join(trackedRoot, file)),
				]),
			),
		) as Record<keyof typeof D753_TRACKED_SOURCE_SHA256, Uint8Array>,
		private: Object.fromEntries(
			await Promise.all(
				Object.entries(privateNames).map(async ([key, file]) => [
					key,
					await readFile(join(privateRoot, file)),
				]),
			),
		) as Record<keyof typeof D753_PRIVATE_SOURCE_SHA256, Uint8Array>,
	};
}

describe("D753 D752-qualified Graph-native live replacement", () => {
	it("runs and atomically persists the complete injected six-arm block", async () => {
		const fixture = createD734InjectedRouteProfileFixture({
			profile: D733_DEEPSEEK_V4_FLASH_0731_PROFILE,
			routeAdmission: admission(),
			executionClass: "live-provider",
			forwardPhaseContinuation: true,
		});
		const bundle = await runD753InjectedNoNetworkQualification({
			historicalBundleBytes: await readFile(join(root, "bundle.v1.json")),
			implementationManifestDigest: validateD753ImplementationBytes(await sourceBytes()),
			adapter: fixture.adapter,
			providerTransportCalls: fixture.providerCalls,
			signal: AbortSignal.timeout(30_000),
		});
		expect(validateD753LiveBundle(bundle)).toEqual(bundle);
		expect(bundle.disposition).toBe("success");
		expect(bundle.graphEvidence.ledger.completedArms).toHaveLength(6);
		expect(bundle.transportDiagnosticGraphEvidence.facts).toEqual([]);
		expect(fixture.maxActiveInvocations()).toBe(1);
		expect(fixture.networkCalls()).toBe(0);
		expect(fixture.activeWorkspaceCount()).toBe(0);

		const privateRoot = await mkdtemp(join(tmpdir(), "graphrefly-d753-persist-"));
		await chmod(privateRoot, 0o700);
		try {
			const receipt = await persistD753LiveBundle({ privateRoot, bundle });
			expect(receipt.disposition).toBe("success");
			const committed = await stat(join(privateRoot, receipt.generationRef));
			expect(committed.mode & 0o777).toBe(0o700);
		} finally {
			await rm(privateRoot, { recursive: true, force: true });
		}
	}, 30_000);

	it("rejects diagnostic evidence that is not derived from the canonical Graph facts", async () => {
		const fixture = createD734InjectedRouteProfileFixture({
			profile: D733_DEEPSEEK_V4_FLASH_0731_PROFILE,
			routeAdmission: admission(),
			executionClass: "live-provider",
			forwardPhaseContinuation: true,
		});
		const integration = await runD753InjectedNoNetworkQualification({
			historicalBundleBytes: await readFile(join(root, "bundle.v1.json")),
			implementationManifestDigest: D753_IMPLEMENTATION_MANIFEST_DIGEST,
			adapter: fixture.adapter,
			providerTransportCalls: fixture.providerCalls,
			signal: AbortSignal.timeout(30_000),
		});
		const graph = deriveD722CanonicalGraphEvidence(
			integration.graphEvidence.ledger,
			integration.graphEvidence.effectRuns,
			createD726ArmLocalTerminalProviderPolicy(),
			createD748GraphForwardPhaseContinuationPolicy(),
		);
		const forgedMaterial = {
			schemaVersion: D753_TRANSPORT_EVIDENCE_SCHEMA,
			facts: [
				{
					schemaVersion: "graphrefly.b112.d753.graph-admitted-transport-diagnostic-fact.v1",
					runSequence: 0,
					effectSequence: 0,
					effectRequestDigest: empiricalStrictJsonDigest({ forged: "request" }),
					effectAdmissionDigest: empiricalStrictJsonDigest({ forged: "admission" }),
					providerResultDigest: empiricalStrictJsonDigest({ forged: "result" }),
					reconciliationDigest: empiricalStrictJsonDigest({ forged: "reconciliation" }),
					phase: "request",
					causeCode: "econnreset",
					factDigest: empiricalStrictJsonDigest({ forged: "fact" }),
				},
			],
		};
		expect(() =>
			validateD753TransportDiagnosticGraphEvidence(
				{ ...forgedMaterial, evidenceDigest: empiricalStrictJsonDigest(forgedMaterial) },
				graph,
			),
		).toThrow(/transport/);
	}, 30_000);
});
