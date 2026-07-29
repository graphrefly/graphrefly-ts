import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
	certifyNodeLocalUntrustedJsCompute,
	NODE_LOCAL_UNTRUSTED_JS_ALLOWED_API_REVISION,
	NODE_LOCAL_UNTRUSTED_JS_OUTPUT_POLICY_REVISION,
	NODE_LOCAL_UNTRUSTED_JS_RESOURCE_POLICY_REVISION,
	NODE_LOCAL_UNTRUSTED_JS_RUNNER_REVISION,
	NODE_LOCAL_UNTRUSTED_JS_SANDBOX_POLICY_REVISION,
	nodeLocalUntrustedJsComputeDriver,
	nodeLocalUntrustedJsComputeHostBindingAttestation,
} from "../executors/local-untrusted-js-compute/node.js";
import {
	LOCAL_UNTRUSTED_JS_COMPUTE_BACKEND,
	LOCAL_UNTRUSTED_JS_COMPUTE_COMPATIBILITY,
	LOCAL_UNTRUSTED_JS_COMPUTE_RUNNER_API,
	type LocalUntrustedJsComputeArguments,
	type LocalUntrustedJsComputeManifest,
} from "../executors/local-untrusted-js-compute.js";
import { strictCanonicalJsonBytes } from "../json/codec.js";

const live = process.env.GRAPHREFLY_D667_LIVE_NEGATIVE === "1";
const imageDigest = "sha256:d13105efe29040feb046f1c5fc9f0a98e58d8980c85300306a325c80df9a45c4";
const imageRef = `docker.io/library/postgres@${imageDigest}`;
const bundle = new TextEncoder().encode("export default ({ input }) => input;");
const bundleDigest = `sha256:${createHash("sha256").update(bundle).digest("hex")}`;
const input = { rows: [] };
const inputDigest = `sha256:${createHash("sha256")
	.update(strictCanonicalJsonBytes(input))
	.digest("hex")}`;
const positiveImageRef = process.env.GRAPHREFLY_D667_RUNNER_IMAGE_REF ?? "";
const positiveLive =
	process.env.GRAPHREFLY_D667_LIVE_POSITIVE === "1" &&
	/^[A-Za-z0-9][A-Za-z0-9._:/+-]{0,190}@sha256:[a-f0-9]{64}$/.test(positiveImageRef);

function positiveManifest(runnerImageDigest: string): LocalUntrustedJsComputeManifest {
	return {
		kind: "local-untrusted-js-compute-manifest",
		manifestId: "manifest:d667:live-positive",
		revision: "manifest-revision:runner-v0",
		fingerprint: "manifest-fingerprint:d667-live-positive-runner-v0",
		compatibilityRevision: LOCAL_UNTRUSTED_JS_COMPUTE_COMPATIBILITY,
		backend: LOCAL_UNTRUSTED_JS_COMPUTE_BACKEND,
		runnerApiRevision: LOCAL_UNTRUSTED_JS_COMPUTE_RUNNER_API,
		runnerImageDigest,
		runnerRevision: NODE_LOCAL_UNTRUSTED_JS_RUNNER_REVISION,
		compilerRevision: "compiler:esbuild-fixed-v0",
		allowedApiRevision: NODE_LOCAL_UNTRUSTED_JS_ALLOWED_API_REVISION,
		graphreflyPackageRevision: "graphrefly-ts:0.7.0",
		sandboxPolicyRevision: NODE_LOCAL_UNTRUSTED_JS_SANDBOX_POLICY_REVISION,
		networkPolicyRevision: "deny-all-v1",
		filesystemPolicyRevision: "read-only-input-bounded-tmp-v1",
		resourcePolicyRevision: NODE_LOCAL_UNTRUSTED_JS_RESOURCE_POLICY_REVISION,
		outputPolicyRevision: NODE_LOCAL_UNTRUSTED_JS_OUTPUT_POLICY_REVISION,
		executionTimeoutMs: 10_000,
		killGraceMs: 1_000,
		cleanupTimeoutMs: 5_000,
		maxBundleBytes: 16_384,
		maxInputBytes: 4_096,
		maxOutputBytes: 64_000,
		maxTopologyNodes: 8,
		maxTopologyEdges: 8,
	};
}

describe.runIf(live)("D667 Node rootless-Podman broker live negative", () => {
	it("creates the exact contained attempt, fails on a non-runner image, and still removes it", async () => {
		const host = await nodeLocalUntrustedJsComputeHostBindingAttestation();
		const manifest: LocalUntrustedJsComputeManifest = {
			kind: "local-untrusted-js-compute-manifest",
			manifestId: "manifest:d667:live-negative",
			revision: "manifest-revision:1",
			fingerprint: "manifest-fingerprint:d667-live-negative",
			compatibilityRevision: LOCAL_UNTRUSTED_JS_COMPUTE_COMPATIBILITY,
			backend: LOCAL_UNTRUSTED_JS_COMPUTE_BACKEND,
			runnerApiRevision: LOCAL_UNTRUSTED_JS_COMPUTE_RUNNER_API,
			runnerImageDigest: imageDigest,
			runnerRevision: "runner:missing-negative-control",
			compilerRevision: "compiler:negative-control",
			allowedApiRevision: "api:negative-control",
			graphreflyPackageRevision: "graphrefly-ts:0.7.0",
			sandboxPolicyRevision: "sandbox:d667-v0",
			networkPolicyRevision: "deny-all-v1",
			filesystemPolicyRevision: "read-only-input-bounded-tmp-v1",
			resourcePolicyRevision: "resource:d667-v0",
			outputPolicyRevision: "output:d667-v0",
			executionTimeoutMs: 5_000,
			killGraceMs: 1_000,
			cleanupTimeoutMs: 5_000,
			maxBundleBytes: 8_192,
			maxInputBytes: 1_024,
			maxOutputBytes: 16_384,
			maxTopologyNodes: 8,
			maxTopologyEdges: 8,
		};
		const args: LocalUntrustedJsComputeArguments = {
			contractVersion: "1",
			runId: "run:d667-live-negative",
			attempt: 1,
			epoch: "epoch:1",
			sourceRevision: "source:1",
			sourceDigest: `sha256:${"2".repeat(64)}`,
			bundleRevision: "bundle:1",
			bundleDigest,
			compilerRevision: manifest.compilerRevision,
			allowedApiRevision: manifest.allowedApiRevision,
			graphreflyPackageRevision: manifest.graphreflyPackageRevision,
			runnerRevision: manifest.runnerRevision,
			runnerImageDigest: manifest.runnerImageDigest,
			sandboxPolicyRevision: manifest.sandboxPolicyRevision,
			networkPolicyRevision: manifest.networkPolicyRevision,
			filesystemPolicyRevision: manifest.filesystemPolicyRevision,
			resourcePolicyRevision: manifest.resourcePolicyRevision,
			outputPolicyRevision: manifest.outputPolicyRevision,
			admittedInputRefs: ["input:negative-control"],
			inputDigest,
		};
		const outcome = await nodeLocalUntrustedJsComputeDriver({ imageRef }).execute(
			{
				runId: args.runId,
				attempt: args.attempt,
				epoch: args.epoch,
				manifestFingerprint: manifest.fingerprint,
				hostBindingDigest: host.hostBindingDigest,
				runAdmissionId: "run-admission:d667-live-negative",
				signal: new AbortController().signal,
			},
			args,
			{ bundle, input },
			manifest,
		);
		expect(outcome).toMatchObject({
			outcome: "failed",
			code: "local-untrusted-js-compute-container-start-failed",
			cleanup: "succeeded",
		});
	});
});

describe.runIf(positiveLive)("D667 fixed runner positive rootless-Podman execution", () => {
	it("executes admitted logic into a real 3N/2E Graph result and removes the container", async () => {
		const runnerImageDigest = positiveImageRef.slice(positiveImageRef.lastIndexOf("@") + 1);
		const admittedBundle = new TextEncoder().encode(`
export default ({ graphrefly, input }) => {
	graphrefly.graph("trusted-data-answer");
	const rows = graphrefly.source("admitted-rows", input.rows, { role: "admitted-input" });
	let graphRuntimeComputeCount = 0;
	const count = graphrefly.derive("row-count", [rows], function (value) {
		if (this !== undefined) throw new TypeError("Derived callback receiver is not empty.");
		graphRuntimeComputeCount += 1;
		return value.length;
	});
	const answer = graphrefly.derive(
		"answer",
		[count],
		(value) => {
			graphRuntimeComputeCount += 1;
			return {
				rowCount: value,
				question: input.question,
				graphRuntimeComputeCount,
			};
		},
		{ role: "answer" },
	);
	return answer;
};
`);
		const admittedInput = {
			question: "How many admitted rows are present?",
			rows: [{ id: 1 }, { id: 2 }, { id: 3 }],
		};
		const admittedBundleDigest = `sha256:${createHash("sha256")
			.update(admittedBundle)
			.digest("hex")}`;
		const admittedInputDigest = `sha256:${createHash("sha256")
			.update(strictCanonicalJsonBytes(admittedInput))
			.digest("hex")}`;
		const host = await nodeLocalUntrustedJsComputeHostBindingAttestation();
		const manifest = positiveManifest(runnerImageDigest);
		const args: LocalUntrustedJsComputeArguments = {
			contractVersion: "1",
			runId: "run:d667-live-positive",
			attempt: 1,
			epoch: "epoch:1",
			sourceRevision: "source:1",
			sourceDigest: `sha256:${"3".repeat(64)}`,
			bundleRevision: "bundle:1",
			bundleDigest: admittedBundleDigest,
			compilerRevision: manifest.compilerRevision,
			allowedApiRevision: manifest.allowedApiRevision,
			graphreflyPackageRevision: manifest.graphreflyPackageRevision,
			runnerRevision: manifest.runnerRevision,
			runnerImageDigest: manifest.runnerImageDigest,
			sandboxPolicyRevision: manifest.sandboxPolicyRevision,
			networkPolicyRevision: manifest.networkPolicyRevision,
			filesystemPolicyRevision: manifest.filesystemPolicyRevision,
			resourcePolicyRevision: manifest.resourcePolicyRevision,
			outputPolicyRevision: manifest.outputPolicyRevision,
			admittedInputRefs: ["input:rows", "input:question"],
			inputDigest: admittedInputDigest,
		};
		const outcome = await nodeLocalUntrustedJsComputeDriver({ imageRef: positiveImageRef }).execute(
			{
				runId: args.runId,
				attempt: args.attempt,
				epoch: args.epoch,
				manifestFingerprint: manifest.fingerprint,
				hostBindingDigest: host.hostBindingDigest,
				runAdmissionId: "run-admission:d667-live-positive",
				signal: new AbortController().signal,
			},
			args,
			{ bundle: admittedBundle, input: admittedInput },
			manifest,
		);
		expect(
			outcome.outcome === "failed" ? outcome.code : "",
			JSON.stringify(outcome, undefined, 2),
		).toBe("");
		expect(outcome).toMatchObject({
			outcome: "succeeded",
			cleanup: "succeeded",
			result: {
				answer: {
					rowCount: 3,
					question: "How many admitted rows are present?",
					graphRuntimeComputeCount: 2,
				},
				topology: {
					name: "trusted-data-answer",
					edges: expect.arrayContaining([
						{ from: "admitted-rows", to: "row-count" },
						{ from: "row-count", to: "answer" },
					]),
				},
				provenance: {
					runId: args.runId,
					runAdmissionId: "run-admission:d667-live-positive",
					runnerImageDigest,
					graphName: "trusted-data-answer",
					answerNodeId: "answer",
					admittedInputRefs: ["input:rows", "input:question"],
				},
				cleanup: {
					graphNodesAfterDispose: 0,
					graphEdgesAfterDispose: 0,
				},
			},
		});
		if (outcome.outcome !== "succeeded") throw new Error("Expected successful runner outcome.");
		expect(outcome.result.topology.nodes).toHaveLength(3);
		expect(outcome.result.topology.edges).toHaveLength(2);
		expect(outcome.result.describe.nodes).toHaveLength(3);
	});

	it("independently certifies Graph execution, ambient denial, cancellation and cleanup", async () => {
		const runnerImageDigest = positiveImageRef.slice(positiveImageRef.lastIndexOf("@") + 1);
		const observedAtMs = Date.now();
		const readiness = await certifyNodeLocalUntrustedJsCompute({
			manifest: positiveManifest(runnerImageDigest),
			imageRef: positiveImageRef,
			now: () => observedAtMs,
		});
		expect(readiness).toMatchObject({
			kind: "local-untrusted-js-compute-readiness",
			state: "ready",
			observedAtMs,
			rootlessVerified: true,
			imageDigestVerified: true,
			runnerVerified: true,
			nonRootVerified: true,
			readOnlyRootFilesystemVerified: true,
			noNewPrivilegesVerified: true,
			capabilitiesDroppedVerified: true,
			noEngineSocketMountVerified: true,
			noHostBindMountVerified: true,
			denyNetworkVerified: true,
			resourceBoundsVerified: true,
			cancellationVerified: true,
			cleanupVerified: true,
		});
		expect(readiness.attestationRefs).toHaveLength(6);
	}, 20_000);
});
