import { describe, expect, it } from "vitest";
import { empiricalStrictJsonDigest } from "../../evals/graph-native-rerun-avoidance/canonical.js";
import { D65_D64_BASELINE_PROJECTION } from "../../evals/graph-native-rerun-avoidance/frozen-baseline-fixture.js";
import {
	admitD45EffectResult,
	createD45GraphToolAuthority,
	D68_RESPONSE_REJECTION_CODES,
	takeD45AdmittedEffect,
} from "../../evals/graph-native-rerun-avoidance/graph-tool-authority.js";
import {
	D45_ASSIGNMENT,
	D45_READABLE_PATHS,
	D45_TASK_MATERIAL,
	D45_WRITABLE_PATH,
} from "../../evals/graph-native-rerun-avoidance/graph-tool-qualification.js";
import { createD65InjectedReplicateExecutor } from "../../evals/graph-native-rerun-avoidance/injected-replicate-executor.js";
import {
	lowerD45ProviderEffect,
	parseD45ChatProviderResponse,
} from "../../evals/graph-native-rerun-avoidance/mechanical-chat-adapter.js";
import { createD43PolicyCatalog } from "../../evals/graph-native-rerun-avoidance/model-harness-policy.js";
import { runD65ReplicateMeasurement } from "../../evals/graph-native-rerun-avoidance/replicate-measurement.js";
import {
	createD65GraphCampaignAuthority,
	createD65ReplicatePolicy,
	D65_D64_ARTIFACT_DIGEST,
	D65_D64_BUNDLE_DIGEST,
	startD65ReplicateExecution,
	takeD65AdmittedReplicate,
} from "../../evals/graph-native-rerun-avoidance/replicated-campaign-authority.js";

const pricing = Object.freeze({
	inputMicrousdPerMillionTokens: 80_000,
	outputMicrousdPerMillionTokens: 180_000,
	cacheReadMicrousdPerMillionTokens: 16_000,
});
const wireDigest = empiricalStrictJsonDigest("current-response-wire");

function response(status: number, value: string | Uint8Array) {
	return parseD45ChatProviderResponse({
		status,
		bytes: typeof value === "string" ? new TextEncoder().encode(value) : value,
		elapsedMs: 7,
		wireDigest,
		pricing,
	});
}

describe("current Graph-native rerun-avoidance eval", () => {
	it("classifies every bounded 2xx response defect without forging executor failure", () => {
		const cases = [
			response(200, new Uint8Array(2 * 1024 * 1024 + 1)),
			response(99, "{}"),
			response(200, new Uint8Array([0xff])),
			response(200, "{"),
			response(200, "[]"),
			response(200, '{"choices":[]}'),
			response(200, '{"usage":{"prompt_tokens":-1,"completion_tokens":1},"choices":[]}'),
			response(
				200,
				'{"usage":{"prompt_tokens":1,"completion_tokens":1,"prompt_tokens_details":{"cached_tokens":2}},"choices":[]}',
			),
			response(200, '{"usage":{"prompt_tokens":1,"completion_tokens":1},"choices":[]}'),
		];
		expect(cases.map((item) => item.outcome)).toEqual(
			D68_RESPONSE_REJECTION_CODES.map(() => "schema-rejected"),
		);
		expect(cases.map((item) => item.responseRejectionCode)).toEqual(D68_RESPONSE_REJECTION_CODES);
		expect(cases.every((item) => item.proposal === null)).toBe(true);
	});

	it("admits response-schema evidence and releases a bounded Graph correction", () => {
		const campaign = createD65GraphCampaignAuthority({
			baselineArtifactDigest: D65_D64_ARTIFACT_DIGEST,
			baselineBundleDigest: D65_D64_BUNDLE_DIGEST,
			baselineProjection: D65_D64_BASELINE_PROJECTION,
			campaignMode: { executionClass: "qualification", liveClaimDigest: null },
		});
		const replicate = takeD65AdmittedReplicate(campaign);
		if (replicate === null) throw new TypeError("current test omitted replicate admission");
		const policy = createD65ReplicatePolicy(replicate);
		const authority = createD45GraphToolAuthority({
			catalog: createD43PolicyCatalog([policy]),
			assignment: {
				...D45_ASSIGNMENT,
				assignmentRef: replicate.assignmentRef,
				campaignRef: replicate.campaignRef,
			},
			readablePaths: D45_READABLE_PATHS,
			writablePath: D45_WRITABLE_PATH,
			taskMaterial: D45_TASK_MATERIAL,
			routeProfile: { reasoningEffort: "high", requireParameters: true },
			campaign: policy.campaign,
		});
		const materialization = takeD45AdmittedEffect(authority);
		if (materialization?.sourceD43EffectKind !== "materialization")
			throw new TypeError("current test omitted materialization");
		const workspaceStateDigest = empiricalStrictJsonDigest("current-workspace");
		admitD45EffectResult(authority, materialization, {
			effectKind: "local-effect",
			outcome: "success",
			elapsedMs: 1,
			evidenceDigest: empiricalStrictJsonDigest("current-materialization"),
			workspaceStateDigest,
			criteria: null,
		});
		const inspection = takeD45AdmittedEffect(authority);
		if (inspection?.effectKind !== "provider-proposal" || inspection.phase !== "inspection")
			throw new TypeError("current test omitted inspection");
		const wire = lowerD45ProviderEffect(authority, inspection);
		admitD45EffectResult(
			authority,
			inspection,
			parseD45ChatProviderResponse({
				status: 200,
				bytes: new TextEncoder().encode('{"choices":[]}'),
				elapsedMs: 4,
				wireDigest: wire.wireDigest,
				pricing,
			}),
		);
		const correction = takeD45AdmittedEffect(authority);
		expect(correction?.effectKind).toBe("provider-proposal");
		expect(correction?.phase).toBe("inspection");
		const correctionWire = lowerD45ProviderEffect(authority, correction!);
		expect(correctionWire.body).toContain("Graph rejected the previous phase response");
	});

	it("emits monotonic material-free Graph progress through all six arms", async () => {
		const campaign = createD65GraphCampaignAuthority({
			baselineArtifactDigest: D65_D64_ARTIFACT_DIGEST,
			baselineBundleDigest: D65_D64_BUNDLE_DIGEST,
			baselineProjection: D65_D64_BASELINE_PROJECTION,
			campaignMode: { executionClass: "qualification", liveClaimDigest: null },
		});
		const admitted = takeD65AdmittedReplicate(campaign);
		if (admitted === null) throw new TypeError("current test omitted replicate admission");
		const execution = startD65ReplicateExecution(campaign, admitted);
		const injected = createD65InjectedReplicateExecutor();
		const progress: Array<{
			factSequence: number;
			completedArmCount: number;
			serialized: string;
		}> = [];
		const measurement = await runD65ReplicateMeasurement({
			executor: injected.executor,
			injectedNoNetwork: true,
			replicateExecution: execution,
			onProgress(value) {
				progress.push({
					factSequence: value.factSequence,
					completedArmCount: value.completedArmCount,
					serialized: JSON.stringify(value),
				});
			},
		});
		expect(measurement.disposition).toBe("success");
		expect(progress.length).toBeGreaterThan(12);
		expect(
			progress.every(
				(item, index) => index === 0 || item.factSequence >= progress[index - 1]!.factSequence,
			),
		).toBe(true);
		expect(progress.at(-1)?.completedArmCount).toBe(6);
		expect(
			progress.every(
				(item) => !/(oldText|newText|content|body|header|stack|error)/u.test(item.serialized),
			),
		).toBe(true);
	});
});
