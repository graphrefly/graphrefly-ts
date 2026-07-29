import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
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
