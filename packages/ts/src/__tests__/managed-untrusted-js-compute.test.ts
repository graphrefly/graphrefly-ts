import { describe, expect, it } from "vitest";
import {
	MANAGED_UNTRUSTED_JS_COMPUTE_BACKEND,
	MANAGED_UNTRUSTED_JS_COMPUTE_COMPATIBILITY,
	type ManagedUntrustedJsComputeArguments,
	type ManagedUntrustedJsComputeCancellationRequested,
	type ManagedUntrustedJsComputeCleanupStatus,
	type ManagedUntrustedJsComputeDriver,
	type ManagedUntrustedJsComputeLifecycleFact,
	type ManagedUntrustedJsComputeManifest,
	type ManagedUntrustedJsComputeMovementEvidence,
	type ManagedUntrustedJsComputeReadiness,
	managedUntrustedJsComputeArguments,
	managedUntrustedJsComputeManifest,
	managedUntrustedJsComputeReadiness,
	managedUntrustedJsComputeRuntime,
} from "../executors/managed-untrusted-js-compute.js";
import { graph } from "../graph/graph.js";
import type {
	ExecutorOutcome,
	SourceRef,
	ToolProviderAdapterInput,
	ToolProviderAdapterRunRequested,
} from "../orchestration/index.js";

const digest = `sha256:${"b".repeat(64)}`;
const ref = (kind: string, id: string): SourceRef => ({ kind, id });

const args = (
	patch: Partial<ManagedUntrustedJsComputeArguments> = {},
): ManagedUntrustedJsComputeArguments =>
	managedUntrustedJsComputeArguments({
		contractVersion: "1",
		bundleDigest: digest,
		bundleRevision: "bundle:orders:1",
		templateBuildId: "e2b-template:orders:1",
		runnerRevision: "runner:js:1",
		inputRefs: [ref("artifact", "compute-input-1")],
		artifactRefs: [ref("artifact", "compute-support-1")],
		resourcePolicyRevision: "resource-policy:js:1",
		outputPolicyRevision: "output-policy:js:1",
		networkPolicyRevision: "deny-all-external-v1",
		...patch,
	});

const manifest = (
	patch: Partial<ManagedUntrustedJsComputeManifest> = {},
): ManagedUntrustedJsComputeManifest =>
	managedUntrustedJsComputeManifest({
		kind: "managed-untrusted-js-compute-manifest",
		manifestId: "manifest:js-compute",
		revision: "revision:1",
		fingerprint: "fingerprint:js-compute:1",
		compatibilityRevision: MANAGED_UNTRUSTED_JS_COMPUTE_COMPATIBILITY,
		backend: MANAGED_UNTRUSTED_JS_COMPUTE_BACKEND,
		templateBuildId: "e2b-template:orders:1",
		runnerRevision: "runner:js:1",
		resourcePolicyRevision: "resource-policy:js:1",
		outputPolicyRevision: "output-policy:js:1",
		networkPolicyRevision: "deny-all-external-v1",
		sandboxPolicyRevision: "sandbox-policy:js:1",
		cleanupPolicyRevision: "cleanup-policy:js:1",
		executionTimeoutMs: 30_000,
		killGraceMs: 1,
		attestationRefs: [ref("attestation", "js-compute:1")],
		...patch,
	});

const readiness = (
	patch: Partial<ManagedUntrustedJsComputeReadiness> = {},
): ManagedUntrustedJsComputeReadiness =>
	managedUntrustedJsComputeReadiness({
		kind: "managed-untrusted-js-compute-readiness",
		manifestFingerprint: "fingerprint:js-compute:1",
		state: "ready",
		observedAtMs: 1,
		expiresAtMs: 1_000,
		e2bReachable: true,
		templateVerified: true,
		runnerVerified: true,
		denyNetworkVerified: true,
		freshSandboxReady: true,
		artifactResolverReady: true,
		quotaReady: true,
		attestationRefs: [ref("attestation", "js-compute-ready:1")],
		...patch,
	});

const input = (
	patch: Partial<ToolProviderAdapterInput<ManagedUntrustedJsComputeArguments>> = {},
): ToolProviderAdapterInput<ManagedUntrustedJsComputeArguments> => ({
	kind: "tool-provider-adapter-input",
	adapterInputId: "adapter-input:js-compute:1",
	status: "ready",
	requestId: "request:js-compute:1",
	operationId: "operation:js-compute:1",
	routeId: "route:js-compute:1",
	providerId: "managed-untrusted-js-compute",
	executorId: "executor:e2b:1",
	profileId: "profile:js-compute:1",
	toolCall: { toolName: "managed-untrusted-js-compute", arguments: args() },
	sourceRefs: [ref("query-result", "trusted-connector-output:1")],
	...patch,
});

const run = (
	patch: Partial<ToolProviderAdapterRunRequested> = {},
): ToolProviderAdapterRunRequested => ({
	kind: "tool-provider-adapter-run-requested",
	runId: "run:js-compute:1",
	adapterInputId: "adapter-input:js-compute:1",
	requestId: "request:js-compute:1",
	operationId: "operation:js-compute:1",
	routeId: "route:js-compute:1",
	providerId: "managed-untrusted-js-compute",
	executorId: "executor:e2b:1",
	profileId: "profile:js-compute:1",
	attempt: 1,
	reason: "manual",
	sourceRefs: [ref("admission", "admission:js-compute:1")],
	metadata: {
		executionEnvironmentId: "environment:managed-js-compute",
		executionEnvironmentRevision: "environment-revision:js-compute:1",
		executionEnvironmentLocality: "managed-cloud",
		executionEnvironmentBindingKind: "remote-session",
		executionSessionEpoch: "epoch:js-compute:1",
		executionManifestFingerprint: "fingerprint:js-compute:1",
	},
	...patch,
});

const movement = (): ManagedUntrustedJsComputeMovementEvidence => ({
	kind: "managed-untrusted-js-compute-movement-evidence",
	runId: "run:js-compute:1",
	attempt: 1,
	epoch: "epoch:js-compute:1",
	direction: "sandbox-to-host",
	classification: "result-artifact",
	bytes: 42,
	truncated: false,
	artifactRefs: [ref("artifact", "compute-result-1")],
});

const collect = <T>(node: {
	subscribe(cb: (m: readonly [string, unknown]) => void): () => void;
}) => {
	const values: T[] = [];
	node.subscribe((m) => {
		if (m[0] === "DATA") values.push(m[1] as T);
	});
	return values;
};

const settle = async () => {
	await Promise.resolve();
	await Promise.resolve();
	await new Promise((resolve) => setTimeout(resolve, 0));
};

describe("managed untrusted JS compute runtime (D612)", () => {
	it("rejects non-deny-all network and private material before runtime execution", () => {
		expect(() =>
			managedUntrustedJsComputeArguments({
				...args(),
				networkPolicyRevision: "allow-all" as never,
			}),
		).toThrow();
		expect(() =>
			managedUntrustedJsComputeArguments({
				...args(),
				inputRefs: [ref("credential", "openbao-vault-path")],
			}),
		).toThrow(/private material/);
		expect(() =>
			managedUntrustedJsComputeManifest({
				...manifest(),
				backend: "generic-sandbox-provider" as never,
			}),
		).toThrow();
		expect(() =>
			managedUntrustedJsComputeReadiness({
				...readiness(),
				e2bApiKey: "private-token",
			} as never),
		).toThrow();
		expect(() =>
			managedUntrustedJsComputeManifest({
				...manifest(),
				fingerprint: "fingerprint:private-sandbox-id",
			}),
		).toThrow();
		expect(() =>
			managedUntrustedJsComputeReadiness({
				...readiness(),
				manifestFingerprint: "fingerprint:private-sandbox-id",
			}),
		).toThrow();
	});

	it("runs one fresh E2B-backed sandbox lifecycle after exact D419 admission without leaking handles", async () => {
		const g = graph({ name: "managed-js-compute-success" });
		const inputs = g.node<ToolProviderAdapterInput<ManagedUntrustedJsComputeArguments>>([], null);
		const admitted = g.node<ToolProviderAdapterRunRequested>([], null);
		const manifests = g.node<ManagedUntrustedJsComputeManifest>([], null);
		const postures = g.node<ManagedUntrustedJsComputeReadiness>([], null);
		const calls: string[] = [];
		const privateSandbox = {
			sandboxId: "e2b-private-sandbox-id",
			url: "https://private.e2b.test",
			token: "private-token",
			pty: "private-pty",
		};
		const driver: ManagedUntrustedJsComputeDriver = {
			compatibility: MANAGED_UNTRUSTED_JS_COMPUTE_COMPATIBILITY,
			createSandbox(context, computeArgs) {
				expect(computeArgs.networkPolicyRevision).toBe("deny-all-external-v1");
				expect(context.epoch).toBe("epoch:js-compute:1");
				calls.push("create");
				return privateSandbox;
			},
			upload(sandbox) {
				expect(sandbox).toBe(privateSandbox);
				calls.push("upload");
			},
			run(sandbox) {
				expect(sandbox).toBe(privateSandbox);
				calls.push("run");
				return {
					outcome: "succeeded",
					resultRefs: [ref("artifact", "compute-result-1")],
					movement: [movement()],
					usage: { latencyMs: 5 },
				};
			},
			kill() {
				calls.push("kill");
			},
			destroy(sandbox) {
				expect(sandbox).toBe(privateSandbox);
				calls.push("destroy");
				return "succeeded";
			},
		};
		const runtime = managedUntrustedJsComputeRuntime(g, {
			inputs,
			admittedRunRequests: [admitted],
			manifests: [manifests],
			readiness: [postures],
			driver,
			now: () => 10,
		});
		const lifecycle = collect<ManagedUntrustedJsComputeLifecycleFact>(runtime.lifecycle);
		const cleanup = collect<ManagedUntrustedJsComputeCleanupStatus>(runtime.cleanup);
		const outcomes = collect<ExecutorOutcome>(runtime.outcomes);
		const movements = collect<ManagedUntrustedJsComputeMovementEvidence>(runtime.movement);
		inputs.down([["DATA", input()]]);
		manifests.down([["DATA", manifest()]]);
		postures.down([["DATA", readiness()]]);
		admitted.down([["DATA", run()]]);
		await settle();
		expect(calls).toEqual(["create", "upload", "run", "destroy"]);
		expect(lifecycle.map((fact) => fact.state)).toEqual([
			"admitted",
			"creating",
			"uploading",
			"running",
			"destroying",
			"settled",
		]);
		expect(cleanup).toEqual([expect.objectContaining({ state: "succeeded" })]);
		expect(outcomes).toEqual([expect.objectContaining({ kind: "result" })]);
		expect(movements).toEqual([expect.objectContaining({ classification: "result-artifact" })]);
		const visible = JSON.stringify({
			topology: g.topology(),
			lifecycle,
			cleanup,
			outcomes,
			movements,
		});
		for (const privateNeedle of [
			"e2b-private-sandbox-id",
			"private.e2b.test",
			"private-token",
			"private-pty",
		])
			expect(visible).not.toContain(privateNeedle);
		await runtime.dispose();
		await runtime.dispose();
		expect(calls.filter((call) => call === "destroy")).toHaveLength(1);
	});

	it("releases graph-built runtime topology on dispose when inspection consumers are quiescent", async () => {
		const g = graph({ name: "managed-js-compute-release" });
		const inputs = g.node<ToolProviderAdapterInput<ManagedUntrustedJsComputeArguments>>([], null);
		const admitted = g.node<ToolProviderAdapterRunRequested>([], null);
		const manifests = g.node<ManagedUntrustedJsComputeManifest>([], null);
		const postures = g.node<ManagedUntrustedJsComputeReadiness>([], null);
		const runtime = managedUntrustedJsComputeRuntime(g, {
			inputs,
			admittedRunRequests: [admitted],
			manifests: [manifests],
			readiness: [postures],
			driver: {
				compatibility: MANAGED_UNTRUSTED_JS_COMPUTE_COMPATIBILITY,
				createSandbox() {
					return {};
				},
				upload() {},
				run() {
					return {
						outcome: "succeeded",
						resultRefs: [ref("artifact", "compute-result-1")],
						movement: [movement()],
					};
				},
				kill() {},
				destroy() {
					return "succeeded";
				},
			},
			now: () => 10,
		});
		expect(g.describe().nodes.map((node) => node.id)).toEqual(
			expect.arrayContaining([
				"managedUntrustedJsCompute/lifecycle",
				"managedUntrustedJsCompute/cleanup",
				"managedUntrustedJsCompute/outcomes",
			]),
		);
		inputs.down([["DATA", input()]]);
		manifests.down([["DATA", manifest()]]);
		postures.down([["DATA", readiness()]]);
		admitted.down([["DATA", run()]]);
		await settle();
		await runtime.dispose();
		await runtime.dispose();
		expect(g.describe().nodes.map((node) => node.id)).not.toContain(
			"managedUntrustedJsCompute/lifecycle",
		);
	});

	it("retries topology release after a live inspection consumer unsubscribes", async () => {
		const g = graph({ name: "managed-js-compute-release-retry" });
		const inputs = g.node<ToolProviderAdapterInput<ManagedUntrustedJsComputeArguments>>([], null);
		const admitted = g.node<ToolProviderAdapterRunRequested>([], null);
		const manifests = g.node<ManagedUntrustedJsComputeManifest>([], null);
		const postures = g.node<ManagedUntrustedJsComputeReadiness>([], null);
		const runtime = managedUntrustedJsComputeRuntime(g, {
			inputs,
			admittedRunRequests: [admitted],
			manifests: [manifests],
			readiness: [postures],
			driver: {
				compatibility: MANAGED_UNTRUSTED_JS_COMPUTE_COMPATIBILITY,
				createSandbox() {
					return {};
				},
				upload() {},
				run() {
					return { outcome: "canceled" };
				},
				kill() {},
				destroy() {
					return "succeeded";
				},
			},
			now: () => 10,
		});
		const unsubscribe = runtime.outcomes.subscribe(() => {});
		await runtime.dispose();
		expect(g.describe().nodes.map((node) => node.id)).toContain(
			"managedUntrustedJsCompute/outcomes",
		);
		unsubscribe();
		await runtime.dispose();
		expect(g.describe().nodes.map((node) => node.id)).not.toContain(
			"managedUntrustedJsCompute/outcomes",
		);
	});

	it("rechecks dispose authority after uploading and running lifecycle publication", async () => {
		for (const state of ["uploading", "running"] as const) {
			const g = graph({ name: `managed-js-compute-${state}-dispose-reentrancy` });
			const inputs = g.node<ToolProviderAdapterInput<ManagedUntrustedJsComputeArguments>>([], null);
			const admitted = g.node<ToolProviderAdapterRunRequested>([], null);
			const manifests = g.node<ManagedUntrustedJsComputeManifest>([], null);
			const postures = g.node<ManagedUntrustedJsComputeReadiness>([], null);
			const events: string[] = [];
			const runtime = managedUntrustedJsComputeRuntime(g, {
				inputs,
				admittedRunRequests: [admitted],
				manifests: [manifests],
				readiness: [postures],
				driver: {
					compatibility: MANAGED_UNTRUSTED_JS_COMPUTE_COMPATIBILITY,
					createSandbox() {
						events.push("create");
						return {};
					},
					upload() {
						events.push("upload");
					},
					run() {
						events.push("run-unexpected");
						return { outcome: "canceled" };
					},
					kill() {
						events.push("kill");
					},
					destroy() {
						events.push("destroy");
						return "succeeded";
					},
				},
				now: () => 10,
			});
			let disposed: Promise<void> | undefined;
			const unsubscribe = runtime.lifecycle.subscribe((message) => {
				if (message[0] === "DATA" && message[1].state === state) disposed = runtime.dispose();
			});
			inputs.down([["DATA", input()]]);
			manifests.down([["DATA", manifest()]]);
			postures.down([["DATA", readiness()]]);
			admitted.down([["DATA", run()]]);
			await settle();
			await disposed;
			expect(events).toEqual(
				state === "uploading"
					? ["create", "kill", "destroy"]
					: ["create", "upload", "kill", "destroy"],
			);
			unsubscribe();
			await runtime.dispose();
		}
	});

	it("fails closed before sandbox creation when readiness or exact execution coordinates drift", async () => {
		for (const [label, posture, request] of [
			["network", readiness({ denyNetworkVerified: false }), run()],
			[
				"manifest",
				readiness(),
				run({
					metadata: {
						...run().metadata,
						executionManifestFingerprint: "fingerprint:other",
					},
				}),
			],
			[
				"private-epoch",
				readiness(),
				run({
					metadata: {
						...run().metadata,
						executionSessionEpoch: "private-sandbox-id",
					},
				}),
			],
			[
				"private-environment",
				readiness(),
				run({
					metadata: {
						...run().metadata,
						executionEnvironmentRevision: "environment:private-sandbox-id",
					},
				}),
			],
		] as const) {
			const g = graph({ name: `managed-js-compute-${label}` });
			const inputs = g.node<ToolProviderAdapterInput<ManagedUntrustedJsComputeArguments>>([], null);
			const admitted = g.node<ToolProviderAdapterRunRequested>([], null);
			const manifests = g.node<ManagedUntrustedJsComputeManifest>([], null);
			const postures = g.node<ManagedUntrustedJsComputeReadiness>([], null);
			let created = 0;
			const runtime = managedUntrustedJsComputeRuntime(g, {
				inputs,
				admittedRunRequests: [admitted],
				manifests: [manifests],
				readiness: [postures],
				driver: {
					compatibility: MANAGED_UNTRUSTED_JS_COMPUTE_COMPATIBILITY,
					createSandbox() {
						created++;
						return {};
					},
					upload() {},
					run() {
						return { outcome: "succeeded", resultRefs: [ref("artifact", "unexpected")] };
					},
					kill() {},
					destroy() {
						return "succeeded";
					},
				},
				now: () => 10,
			});
			const issues = collect<{ code: string }>(runtime.issues);
			inputs.down([["DATA", input()]]);
			manifests.down([["DATA", manifest()]]);
			postures.down([["DATA", posture]]);
			admitted.down([["DATA", request]]);
			await settle();
			expect(created).toBe(0);
			expect(issues.length).toBeGreaterThan(0);
			await runtime.dispose();
		}
	});

	it("publishes cleanup uncertainty separately instead of hiding it behind a successful outcome", async () => {
		const g = graph({ name: "managed-js-compute-cleanup-unverifiable" });
		const inputs = g.node<ToolProviderAdapterInput<ManagedUntrustedJsComputeArguments>>([], null);
		const admitted = g.node<ToolProviderAdapterRunRequested>([], null);
		const manifests = g.node<ManagedUntrustedJsComputeManifest>([], null);
		const postures = g.node<ManagedUntrustedJsComputeReadiness>([], null);
		const runtime = managedUntrustedJsComputeRuntime(g, {
			inputs,
			admittedRunRequests: [admitted],
			manifests: [manifests],
			readiness: [postures],
			driver: {
				compatibility: MANAGED_UNTRUSTED_JS_COMPUTE_COMPATIBILITY,
				createSandbox() {
					return { sandboxId: "private-sandbox" };
				},
				upload() {},
				run() {
					return {
						outcome: "succeeded",
						resultRefs: [ref("artifact", "compute-result-1")],
						movement: [movement()],
					};
				},
				kill() {},
				destroy() {
					return "unverifiable";
				},
			},
			now: () => 10,
		});
		const outcomes = collect<ExecutorOutcome>(runtime.outcomes);
		const cleanup = collect<ManagedUntrustedJsComputeCleanupStatus>(runtime.cleanup);
		const issues = collect<{ code: string }>(runtime.issues);
		inputs.down([["DATA", input()]]);
		manifests.down([["DATA", manifest()]]);
		postures.down([["DATA", readiness()]]);
		admitted.down([["DATA", run()]]);
		await settle();
		expect(outcomes).toEqual([expect.objectContaining({ kind: "result" })]);
		expect(cleanup).toEqual([expect.objectContaining({ state: "unverifiable" })]);
		expect(issues).toEqual([
			expect.objectContaining({ code: "managed-untrusted-js-compute-cleanup-unverifiable" }),
		]);
		await runtime.dispose();
	});

	it("bounds driver-visible issue, reason, and usage material before graph publication", async () => {
		for (const [label, result] of [
			[
				"failed",
				{
					outcome: "failed",
					issue: {
						kind: "issue",
						code: "private-sandbox-id",
						message: "leaked https://private.e2b.test e2b-api-key-private",
						severity: "error",
						refs: ["sandboxId:private-sandbox-id"],
						metadata: { token: "e2b-api-key-private" },
					},
					usage: { latencyMs: 5 },
				},
			],
			[
				"canceled",
				{
					outcome: "canceled",
					reason: "private-sandbox-id e2b-api-key-private",
					usage: { latencyMs: 5, cacheMode: "private-token" },
				},
			],
		] as const) {
			const g = graph({ name: `managed-js-compute-bounds-${label}` });
			const inputs = g.node<ToolProviderAdapterInput<ManagedUntrustedJsComputeArguments>>([], null);
			const admitted = g.node<ToolProviderAdapterRunRequested>([], null);
			const manifests = g.node<ManagedUntrustedJsComputeManifest>([], null);
			const postures = g.node<ManagedUntrustedJsComputeReadiness>([], null);
			const runtime = managedUntrustedJsComputeRuntime(g, {
				inputs,
				admittedRunRequests: [admitted],
				manifests: [manifests],
				readiness: [postures],
				driver: {
					compatibility: MANAGED_UNTRUSTED_JS_COMPUTE_COMPATIBILITY,
					createSandbox() {
						return {};
					},
					upload() {},
					run() {
						return result as never;
					},
					kill() {},
					destroy() {
						return "succeeded";
					},
				},
				now: () => 10,
			});
			const outcomes = collect<ExecutorOutcome>(runtime.outcomes);
			inputs.down([["DATA", input()]]);
			manifests.down([["DATA", manifest()]]);
			postures.down([["DATA", readiness()]]);
			admitted.down([["DATA", run()]]);
			await settle();
			expect(outcomes).toHaveLength(1);
			expect(JSON.stringify(outcomes)).not.toMatch(
				/private-sandbox-id|private\\.e2b|e2b-api-key-private|sandboxId|apiKey|token|url|pty|command/i,
			);
			await runtime.dispose();
		}
	});

	it("rejects duplicate active and replayed terminal run attempts without another sandbox", async () => {
		const g = graph({ name: "managed-js-compute-duplicate-run" });
		const inputs = g.node<ToolProviderAdapterInput<ManagedUntrustedJsComputeArguments>>([], null);
		const admitted = g.node<ToolProviderAdapterRunRequested>([], null);
		const manifests = g.node<ManagedUntrustedJsComputeManifest>([], null);
		const postures = g.node<ManagedUntrustedJsComputeReadiness>([], null);
		let release: (() => void) | undefined;
		let created = 0;
		const runtime = managedUntrustedJsComputeRuntime(g, {
			inputs,
			admittedRunRequests: [admitted],
			manifests: [manifests],
			readiness: [postures],
			driver: {
				compatibility: MANAGED_UNTRUSTED_JS_COMPUTE_COMPATIBILITY,
				createSandbox() {
					created++;
					return {};
				},
				upload() {},
				async run() {
					await new Promise<void>((resolve) => {
						release = resolve;
					});
					return {
						outcome: "succeeded",
						resultRefs: [ref("artifact", "compute-result-1")],
						movement: [movement()],
					};
				},
				kill() {},
				destroy() {
					return "succeeded";
				},
			},
			now: () => 10,
		});
		const issues = collect<{ code: string }>(runtime.issues);
		inputs.down([["DATA", input()]]);
		manifests.down([["DATA", manifest()]]);
		postures.down([["DATA", readiness()]]);
		admitted.down([["DATA", run()]]);
		await settle();
		admitted.down([["DATA", run()]]);
		await settle();
		expect(created).toBe(1);
		expect(issues).toEqual([
			expect.objectContaining({ code: "managed-untrusted-js-compute-duplicate-run" }),
		]);
		release?.();
		await settle();
		admitted.down([["DATA", run()]]);
		await settle();
		expect(created).toBe(1);
		expect(issues).toEqual([
			expect.objectContaining({ code: "managed-untrusted-js-compute-duplicate-run" }),
			expect.objectContaining({ code: "managed-untrusted-js-compute-duplicate-run" }),
		]);
		await runtime.dispose();
	});

	it("times out a noncooperative driver and publishes cleanup separately", async () => {
		const g = graph({ name: "managed-js-compute-timeout" });
		const inputs = g.node<ToolProviderAdapterInput<ManagedUntrustedJsComputeArguments>>([], null);
		const admitted = g.node<ToolProviderAdapterRunRequested>([], null);
		const manifests = g.node<ManagedUntrustedJsComputeManifest>([], null);
		const postures = g.node<ManagedUntrustedJsComputeReadiness>([], null);
		const calls: string[] = [];
		const runtime = managedUntrustedJsComputeRuntime(g, {
			inputs,
			admittedRunRequests: [admitted],
			manifests: [manifests],
			readiness: [postures],
			driver: {
				compatibility: MANAGED_UNTRUSTED_JS_COMPUTE_COMPATIBILITY,
				createSandbox() {
					return {};
				},
				upload() {},
				async run() {
					await new Promise(() => {});
					return { outcome: "canceled" };
				},
				kill() {
					calls.push("kill");
				},
				destroy() {
					calls.push("destroy");
					return "succeeded";
				},
			},
			now: () => 10,
		});
		const outcomes = collect<ExecutorOutcome>(runtime.outcomes);
		const cleanup = collect<ManagedUntrustedJsComputeCleanupStatus>(runtime.cleanup);
		inputs.down([["DATA", input()]]);
		manifests.down([["DATA", manifest({ executionTimeoutMs: 1 })]]);
		postures.down([["DATA", readiness()]]);
		admitted.down([["DATA", run()]]);
		await new Promise((resolve) => setTimeout(resolve, 10));
		await settle();
		expect(outcomes).toEqual([expect.objectContaining({ kind: "timeout" })]);
		expect(cleanup).toEqual([expect.objectContaining({ state: "succeeded" })]);
		expect(calls).toEqual(["kill", "destroy"]);
		await runtime.dispose();
	});

	it("destroys a sandbox that is created after the timeout cleanup fact", async () => {
		const g = graph({ name: "managed-js-compute-late-create-timeout" });
		const inputs = g.node<ToolProviderAdapterInput<ManagedUntrustedJsComputeArguments>>([], null);
		const admitted = g.node<ToolProviderAdapterRunRequested>([], null);
		const manifests = g.node<ManagedUntrustedJsComputeManifest>([], null);
		const postures = g.node<ManagedUntrustedJsComputeReadiness>([], null);
		const lateSandbox = { sandbox: "late" };
		let releaseCreate: (() => void) | undefined;
		const calls: string[] = [];
		const runtime = managedUntrustedJsComputeRuntime(g, {
			inputs,
			admittedRunRequests: [admitted],
			manifests: [manifests],
			readiness: [postures],
			driver: {
				compatibility: MANAGED_UNTRUSTED_JS_COMPUTE_COMPATIBILITY,
				async createSandbox() {
					await new Promise<void>((resolve) => {
						releaseCreate = resolve;
					});
					calls.push("create-resolved");
					return lateSandbox;
				},
				upload() {
					calls.push("upload-unexpected");
				},
				run() {
					return { outcome: "canceled" };
				},
				kill() {
					calls.push("kill");
				},
				destroy(sandbox) {
					expect(sandbox).toBe(lateSandbox);
					calls.push("destroy-late");
					return "succeeded";
				},
			},
			now: () => 10,
		});
		const cleanup = collect<ManagedUntrustedJsComputeCleanupStatus>(runtime.cleanup);
		inputs.down([["DATA", input()]]);
		manifests.down([["DATA", manifest({ executionTimeoutMs: 1 })]]);
		postures.down([["DATA", readiness()]]);
		admitted.down([["DATA", run()]]);
		await new Promise((resolve) => setTimeout(resolve, 10));
		await settle();
		expect(cleanup).toEqual([expect.objectContaining({ state: "unverifiable" })]);
		releaseCreate?.();
		await settle();
		expect(calls).toEqual(["create-resolved", "kill", "destroy-late"]);
		await runtime.dispose();
	});

	it("requires bounded result movement evidence for successful compute output", async () => {
		for (const [label, result] of [
			["missing", { outcome: "succeeded", resultRefs: [ref("artifact", "compute-result-1")] }],
			[
				"oversized",
				{
					outcome: "succeeded",
					resultRefs: [ref("artifact", "compute-result-1")],
					movement: [{ ...movement(), bytes: Number.MAX_SAFE_INTEGER }],
				},
			],
		] as const) {
			const g = graph({ name: `managed-js-compute-movement-${label}` });
			const inputs = g.node<ToolProviderAdapterInput<ManagedUntrustedJsComputeArguments>>([], null);
			const admitted = g.node<ToolProviderAdapterRunRequested>([], null);
			const manifests = g.node<ManagedUntrustedJsComputeManifest>([], null);
			const postures = g.node<ManagedUntrustedJsComputeReadiness>([], null);
			const runtime = managedUntrustedJsComputeRuntime(g, {
				inputs,
				admittedRunRequests: [admitted],
				manifests: [manifests],
				readiness: [postures],
				driver: {
					compatibility: MANAGED_UNTRUSTED_JS_COMPUTE_COMPATIBILITY,
					createSandbox() {
						return {};
					},
					upload() {},
					run() {
						return result as never;
					},
					kill() {},
					destroy() {
						return "succeeded";
					},
				},
				now: () => 10,
			});
			const outcomes = collect<ExecutorOutcome>(runtime.outcomes);
			inputs.down([["DATA", input()]]);
			manifests.down([["DATA", manifest()]]);
			postures.down([["DATA", readiness()]]);
			admitted.down([["DATA", run()]]);
			await settle();
			expect(outcomes).toEqual([expect.objectContaining({ kind: "failure" })]);
			await runtime.dispose();
		}
	});

	it("keeps cancellation acknowledgement separate from terminal outcome", async () => {
		const g = graph({ name: "managed-js-compute-cancel" });
		const inputs = g.node<ToolProviderAdapterInput<ManagedUntrustedJsComputeArguments>>([], null);
		const admitted = g.node<ToolProviderAdapterRunRequested>([], null);
		const manifests = g.node<ManagedUntrustedJsComputeManifest>([], null);
		const postures = g.node<ManagedUntrustedJsComputeReadiness>([], null);
		const cancellations = g.node<ManagedUntrustedJsComputeCancellationRequested>([], null);
		let release: (() => void) | undefined;
		const runtime = managedUntrustedJsComputeRuntime(g, {
			inputs,
			admittedRunRequests: [admitted],
			manifests: [manifests],
			readiness: [postures],
			cancellationRequests: [cancellations],
			driver: {
				compatibility: MANAGED_UNTRUSTED_JS_COMPUTE_COMPATIBILITY,
				createSandbox() {
					return {};
				},
				upload() {},
				async run() {
					await new Promise<void>((resolve) => {
						release = resolve;
					});
					return {
						outcome: "succeeded",
						resultRefs: [ref("artifact", "compute-result-1")],
						movement: [movement()],
					};
				},
				kill() {},
				destroy() {
					return "succeeded";
				},
			},
			now: () => 10,
		});
		const acknowledgements = collect(runtime.cancellations);
		const outcomes = collect<ExecutorOutcome>(runtime.outcomes);
		inputs.down([["DATA", input()]]);
		manifests.down([["DATA", manifest()]]);
		postures.down([["DATA", readiness()]]);
		admitted.down([["DATA", run()]]);
		await settle();
		cancellations.down([
			[
				"DATA",
				{
					kind: "managed-untrusted-js-compute-cancellation-requested",
					cancellationId: "cancel:js-compute:wrong-manifest",
					runId: "run:js-compute:1",
					attempt: 1,
					environmentRevision: "environment-revision:js-compute:1",
					manifestFingerprint: "fingerprint:other",
					epoch: "epoch:js-compute:1",
				},
			],
		]);
		await settle();
		expect(acknowledgements).toEqual([expect.objectContaining({ state: "rejected" })]);
		cancellations.down([
			[
				"DATA",
				{
					kind: "managed-untrusted-js-compute-cancellation-requested",
					cancellationId: "cancel:js-compute:1",
					runId: "run:js-compute:1",
					attempt: 1,
					environmentRevision: "environment-revision:js-compute:1",
					manifestFingerprint: "fingerprint:js-compute:1",
					epoch: "epoch:js-compute:1",
				},
			],
		]);
		await settle();
		expect(acknowledgements).toEqual([
			expect.objectContaining({ state: "rejected" }),
			expect.objectContaining({ state: "kill-requested" }),
		]);
		expect(outcomes).toHaveLength(0);
		release?.();
		await settle();
		expect(outcomes).toEqual([expect.objectContaining({ kind: "canceled" })]);
		await runtime.dispose();
	});

	it("serializes cooperative abort, one kill, canceled outcome, and destroy", async () => {
		const g = graph({ name: "managed-js-compute-cooperative-cancel" });
		const inputs = g.node<ToolProviderAdapterInput<ManagedUntrustedJsComputeArguments>>([], null);
		const admitted = g.node<ToolProviderAdapterRunRequested>([], null);
		const manifests = g.node<ManagedUntrustedJsComputeManifest>([], null);
		const postures = g.node<ManagedUntrustedJsComputeReadiness>([], null);
		const cancellations = g.node<ManagedUntrustedJsComputeCancellationRequested>([], null);
		const events: string[] = [];
		let releaseKill: (() => void) | undefined;
		const runtime = managedUntrustedJsComputeRuntime(g, {
			inputs,
			admittedRunRequests: [admitted],
			manifests: [manifests],
			readiness: [postures],
			cancellationRequests: [cancellations],
			driver: {
				compatibility: MANAGED_UNTRUSTED_JS_COMPUTE_COMPATIBILITY,
				createSandbox() {
					events.push("create");
					return {};
				},
				upload() {
					events.push("upload");
				},
				run(_sandbox, context) {
					events.push("run");
					return new Promise((_, reject) => {
						context.signal.addEventListener(
							"abort",
							() => {
								events.push("run-aborted");
								reject(new Error("cooperative abort"));
							},
							{ once: true },
						);
					});
				},
				async kill() {
					events.push("kill-start");
					await new Promise<void>((resolve) => {
						releaseKill = resolve;
					});
					events.push("kill-end");
				},
				destroy() {
					events.push("destroy");
					return "succeeded";
				},
			},
			now: () => 10,
		});
		const acknowledgements = collect(runtime.cancellations);
		const outcomes = collect<ExecutorOutcome>(runtime.outcomes);
		const cleanups = collect<ManagedUntrustedJsComputeCleanupStatus>(runtime.cleanup);
		const lifecycle = collect<ManagedUntrustedJsComputeLifecycleFact>(runtime.lifecycle);
		inputs.down([["DATA", input()]]);
		manifests.down([["DATA", manifest()]]);
		postures.down([["DATA", readiness()]]);
		admitted.down([["DATA", run()]]);
		await settle();
		cancellations.down([
			[
				"DATA",
				{
					kind: "managed-untrusted-js-compute-cancellation-requested",
					cancellationId: "cancel:js-compute:cooperative",
					runId: "run:js-compute:1",
					attempt: 1,
					environmentRevision: "environment-revision:js-compute:1",
					manifestFingerprint: "fingerprint:js-compute:1",
					epoch: "epoch:js-compute:1",
				},
			],
		]);
		await settle();
		expect(events).toEqual(["create", "upload", "run", "run-aborted", "kill-start"]);
		expect(acknowledgements).toHaveLength(0);
		expect(outcomes).toHaveLength(0);
		expect(cleanups).toHaveLength(0);
		releaseKill?.();
		await settle();
		expect(events).toEqual([
			"create",
			"upload",
			"run",
			"run-aborted",
			"kill-start",
			"kill-end",
			"destroy",
		]);
		expect(events.filter((event) => event === "kill-start")).toHaveLength(1);
		expect(acknowledgements).toEqual([expect.objectContaining({ state: "kill-requested" })]);
		expect(outcomes).toEqual([expect.objectContaining({ kind: "canceled" })]);
		expect(cleanups).toEqual([expect.objectContaining({ state: "succeeded" })]);
		expect(lifecycle.filter((fact) => fact.state === "destroying")).toHaveLength(1);
		await runtime.dispose();
	});

	it("deduplicates kill and destroy when cancel races dispose", async () => {
		const g = graph({ name: "managed-js-compute-cancel-dispose-race" });
		const inputs = g.node<ToolProviderAdapterInput<ManagedUntrustedJsComputeArguments>>([], null);
		const admitted = g.node<ToolProviderAdapterRunRequested>([], null);
		const manifests = g.node<ManagedUntrustedJsComputeManifest>([], null);
		const postures = g.node<ManagedUntrustedJsComputeReadiness>([], null);
		const cancellations = g.node<ManagedUntrustedJsComputeCancellationRequested>([], null);
		const events: string[] = [];
		let releaseKill: (() => void) | undefined;
		const runtime = managedUntrustedJsComputeRuntime(g, {
			inputs,
			admittedRunRequests: [admitted],
			manifests: [manifests],
			readiness: [postures],
			cancellationRequests: [cancellations],
			driver: {
				compatibility: MANAGED_UNTRUSTED_JS_COMPUTE_COMPATIBILITY,
				createSandbox() {
					return {};
				},
				upload() {},
				run(_sandbox, context) {
					return new Promise((_, reject) =>
						context.signal.addEventListener("abort", () => reject(new Error("abort")), {
							once: true,
						}),
					);
				},
				async kill() {
					events.push("kill-start");
					await new Promise<void>((resolve) => {
						releaseKill = resolve;
					});
					events.push("kill-end");
				},
				destroy() {
					events.push("destroy");
					return "succeeded";
				},
			},
			now: () => 10,
		});
		inputs.down([["DATA", input()]]);
		manifests.down([["DATA", manifest()]]);
		postures.down([["DATA", readiness()]]);
		admitted.down([["DATA", run()]]);
		await settle();
		cancellations.down([
			[
				"DATA",
				{
					kind: "managed-untrusted-js-compute-cancellation-requested",
					cancellationId: "cancel:js-compute:dispose-race",
					runId: "run:js-compute:1",
					attempt: 1,
					environmentRevision: "environment-revision:js-compute:1",
					manifestFingerprint: "fingerprint:js-compute:1",
					epoch: "epoch:js-compute:1",
				},
			],
		]);
		await settle();
		const disposed = runtime.dispose();
		await settle();
		expect(events).toEqual(["kill-start"]);
		releaseKill?.();
		await disposed;
		expect(events).toEqual(["kill-start", "kill-end", "destroy"]);
		expect(events.filter((event) => event === "kill-start")).toHaveLength(1);
		expect(events.filter((event) => event === "destroy")).toHaveLength(1);
		await runtime.dispose();
	});

	it("settles before synchronous outcome reentrancy can dispose the runtime", async () => {
		const g = graph({ name: "managed-js-compute-outcome-dispose-reentrancy" });
		const inputs = g.node<ToolProviderAdapterInput<ManagedUntrustedJsComputeArguments>>([], null);
		const admitted = g.node<ToolProviderAdapterRunRequested>([], null);
		const manifests = g.node<ManagedUntrustedJsComputeManifest>([], null);
		const postures = g.node<ManagedUntrustedJsComputeReadiness>([], null);
		const events: string[] = [];
		const runtime = managedUntrustedJsComputeRuntime(g, {
			inputs,
			admittedRunRequests: [admitted],
			manifests: [manifests],
			readiness: [postures],
			driver: {
				compatibility: MANAGED_UNTRUSTED_JS_COMPUTE_COMPATIBILITY,
				createSandbox() {
					return {};
				},
				upload() {},
				run() {
					return {
						outcome: "succeeded",
						resultRefs: [ref("artifact", "compute-result-1")],
						movement: [movement()],
					};
				},
				kill() {
					events.push("kill-unexpected");
				},
				destroy() {
					events.push("destroy");
					return "succeeded";
				},
				close() {
					events.push("close");
				},
			},
			now: () => 10,
		});
		let reentrantDispose: Promise<void> | undefined;
		runtime.outcomes.subscribe((message) => {
			if (message[0] === "DATA") reentrantDispose = runtime.dispose();
		});
		inputs.down([["DATA", input()]]);
		manifests.down([["DATA", manifest()]]);
		postures.down([["DATA", readiness()]]);
		admitted.down([["DATA", run()]]);
		await settle();
		await reentrantDispose;
		expect(events).toEqual(["destroy", "close"]);
	});

	it("waits for a late sandbox allocation before kill, destroy, close, and dispose settlement", async () => {
		const g = graph({ name: "managed-js-compute-late-allocation-dispose" });
		const inputs = g.node<ToolProviderAdapterInput<ManagedUntrustedJsComputeArguments>>([], null);
		const admitted = g.node<ToolProviderAdapterRunRequested>([], null);
		const manifests = g.node<ManagedUntrustedJsComputeManifest>([], null);
		const postures = g.node<ManagedUntrustedJsComputeReadiness>([], null);
		const events: string[] = [];
		let releaseCreate: (() => void) | undefined;
		const runtime = managedUntrustedJsComputeRuntime(g, {
			inputs,
			admittedRunRequests: [admitted],
			manifests: [manifests],
			readiness: [postures],
			driver: {
				compatibility: MANAGED_UNTRUSTED_JS_COMPUTE_COMPATIBILITY,
				async createSandbox() {
					events.push("create-start");
					await new Promise<void>((resolve) => {
						releaseCreate = resolve;
					});
					events.push("create-end");
					return {};
				},
				upload() {
					events.push("upload-unexpected");
				},
				run() {
					return { outcome: "canceled" };
				},
				kill() {
					events.push("kill");
				},
				destroy() {
					events.push("destroy");
					return "succeeded";
				},
				close() {
					events.push("close");
				},
			},
			now: () => 10,
		});
		inputs.down([["DATA", input()]]);
		manifests.down([["DATA", manifest()]]);
		postures.down([["DATA", readiness()]]);
		admitted.down([["DATA", run()]]);
		await settle();
		let disposeSettled = false;
		const disposed = runtime.dispose().then(() => {
			disposeSettled = true;
		});
		await new Promise((resolve) => setTimeout(resolve, 25));
		expect(disposeSettled).toBe(false);
		expect(events).toEqual(["create-start"]);
		releaseCreate?.();
		await disposed;
		expect(events).toEqual(["create-start", "create-end", "kill", "destroy", "close"]);
	});

	it("bounds disposal when sandbox allocation never settles and closes as its allocation fence", async () => {
		const g = graph({ name: "managed-js-compute-never-allocation-dispose" });
		const inputs = g.node<ToolProviderAdapterInput<ManagedUntrustedJsComputeArguments>>([], null);
		const admitted = g.node<ToolProviderAdapterRunRequested>([], null);
		const manifests = g.node<ManagedUntrustedJsComputeManifest>([], null);
		const postures = g.node<ManagedUntrustedJsComputeReadiness>([], null);
		const events: string[] = [];
		const runtime = managedUntrustedJsComputeRuntime(g, {
			inputs,
			admittedRunRequests: [admitted],
			manifests: [manifests],
			readiness: [postures],
			driver: {
				compatibility: MANAGED_UNTRUSTED_JS_COMPUTE_COMPATIBILITY,
				async createSandbox() {
					events.push("create-start");
					await new Promise(() => {});
					return {};
				},
				upload() {
					events.push("upload-unexpected");
				},
				run() {
					return { outcome: "canceled" };
				},
				kill() {
					events.push("kill-unexpected");
				},
				destroy() {
					events.push("destroy-unexpected");
					return "succeeded";
				},
				close() {
					events.push("close");
				},
			},
			now: () => 10,
		});
		const cleanups = collect<ManagedUntrustedJsComputeCleanupStatus>(runtime.cleanup);
		inputs.down([["DATA", input()]]);
		manifests.down([["DATA", manifest()]]);
		postures.down([["DATA", readiness()]]);
		admitted.down([["DATA", run()]]);
		await settle();
		const startedAt = Date.now();
		await runtime.dispose();
		expect(Date.now() - startedAt).toBeLessThan(500);
		expect(events).toEqual(["create-start", "close"]);
		expect(cleanups).toEqual([expect.objectContaining({ state: "unverifiable" })]);
	});

	it("bounds hanging kill, destroy, and allocation-fence provider work as unverifiable", async () => {
		for (const phase of ["kill", "destroy", "close"] as const) {
			const g = graph({ name: `managed-js-compute-hanging-${phase}-dispose` });
			const inputs = g.node<ToolProviderAdapterInput<ManagedUntrustedJsComputeArguments>>([], null);
			const admitted = g.node<ToolProviderAdapterRunRequested>([], null);
			const manifests = g.node<ManagedUntrustedJsComputeManifest>([], null);
			const postures = g.node<ManagedUntrustedJsComputeReadiness>([], null);
			const events: string[] = [];
			const runtime = managedUntrustedJsComputeRuntime(g, {
				inputs,
				admittedRunRequests: [admitted],
				manifests: [manifests],
				readiness: [postures],
				driver: {
					compatibility: MANAGED_UNTRUSTED_JS_COMPUTE_COMPATIBILITY,
					async createSandbox() {
						if (phase === "close") {
							events.push("create-start");
							await new Promise(() => {});
						}
						return {};
					},
					upload() {},
					async run() {
						if (phase === "destroy")
							return {
								outcome: "succeeded",
								resultRefs: [ref("artifact", "compute-result-1")],
								movement: [movement()],
							};
						await new Promise(() => {});
						return { outcome: "canceled" };
					},
					async kill() {
						events.push("kill-start");
						if (phase === "kill") await new Promise(() => {});
					},
					async destroy() {
						events.push("destroy-start");
						if (phase === "destroy") await new Promise(() => {});
						return "succeeded";
					},
					async close() {
						events.push("close-start");
						if (phase === "close") await new Promise(() => {});
					},
				},
				now: () => 10,
			});
			const cleanups = collect<ManagedUntrustedJsComputeCleanupStatus>(runtime.cleanup);
			inputs.down([["DATA", input()]]);
			manifests.down([["DATA", manifest()]]);
			postures.down([["DATA", readiness()]]);
			admitted.down([["DATA", run()]]);
			await settle();
			const startedAt = Date.now();
			await runtime.dispose();
			expect(Date.now() - startedAt).toBeLessThan(500);
			expect(cleanups).toEqual([expect.objectContaining({ state: "unverifiable" })]);
			expect(events).toContain(
				phase === "kill" ? "kill-start" : phase === "destroy" ? "destroy-start" : "close-start",
			);
			if (phase === "kill") expect(events).not.toContain("destroy-start");
		}
	});

	it("starts detached destroy only after a timed-out kill actually settles", async () => {
		const g = graph({ name: "managed-js-compute-late-kill-settlement" });
		const inputs = g.node<ToolProviderAdapterInput<ManagedUntrustedJsComputeArguments>>([], null);
		const admitted = g.node<ToolProviderAdapterRunRequested>([], null);
		const manifests = g.node<ManagedUntrustedJsComputeManifest>([], null);
		const postures = g.node<ManagedUntrustedJsComputeReadiness>([], null);
		const events: string[] = [];
		let releaseKill: (() => void) | undefined;
		const runtime = managedUntrustedJsComputeRuntime(g, {
			inputs,
			admittedRunRequests: [admitted],
			manifests: [manifests],
			readiness: [postures],
			driver: {
				compatibility: MANAGED_UNTRUSTED_JS_COMPUTE_COMPATIBILITY,
				createSandbox() {
					return {};
				},
				upload() {},
				async run() {
					await new Promise(() => {});
					return { outcome: "canceled" };
				},
				async kill() {
					events.push("kill-start");
					await new Promise<void>((resolve) => {
						releaseKill = resolve;
					});
					events.push("kill-end");
				},
				destroy() {
					events.push("destroy");
					return "succeeded";
				},
			},
			now: () => 10,
		});
		const cleanups = collect<ManagedUntrustedJsComputeCleanupStatus>(runtime.cleanup);
		inputs.down([["DATA", input()]]);
		manifests.down([["DATA", manifest()]]);
		postures.down([["DATA", readiness()]]);
		admitted.down([["DATA", run()]]);
		await settle();
		await runtime.dispose();
		expect(events).toEqual(["kill-start"]);
		expect(cleanups).toEqual([expect.objectContaining({ state: "unverifiable" })]);
		releaseKill?.();
		await settle();
		expect(events).toEqual(["kill-start", "kill-end", "destroy"]);
	});

	it("retains exactly-once late cleanup after an allocation fence times out", async () => {
		const g = graph({ name: "managed-js-compute-late-allocation-fence-timeout" });
		const inputs = g.node<ToolProviderAdapterInput<ManagedUntrustedJsComputeArguments>>([], null);
		const admitted = g.node<ToolProviderAdapterRunRequested>([], null);
		const manifests = g.node<ManagedUntrustedJsComputeManifest>([], null);
		const postures = g.node<ManagedUntrustedJsComputeReadiness>([], null);
		const events: string[] = [];
		let releaseCreate: (() => void) | undefined;
		let releaseClose: (() => void) | undefined;
		const runtime = managedUntrustedJsComputeRuntime(g, {
			inputs,
			admittedRunRequests: [admitted],
			manifests: [manifests],
			readiness: [postures],
			driver: {
				compatibility: MANAGED_UNTRUSTED_JS_COMPUTE_COMPATIBILITY,
				async createSandbox() {
					events.push("create-start");
					await new Promise<void>((resolve) => {
						releaseCreate = resolve;
					});
					events.push("create-end");
					return {};
				},
				upload() {
					events.push("upload-unexpected");
				},
				run() {
					return { outcome: "canceled" };
				},
				kill() {
					events.push("kill");
				},
				destroy() {
					events.push("destroy");
					return "succeeded";
				},
				async close() {
					events.push("close-start");
					await new Promise<void>((resolve) => {
						releaseClose = resolve;
					});
					events.push("close-end");
				},
			},
			now: () => 10,
		});
		const issues = collect<{ code: string }>(runtime.issues);
		inputs.down([["DATA", input()]]);
		manifests.down([["DATA", manifest()]]);
		postures.down([["DATA", readiness()]]);
		admitted.down([["DATA", run()]]);
		await settle();
		await runtime.dispose();
		expect(events).toEqual(["create-start", "close-start"]);
		expect(issues).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					code: "managed-untrusted-js-compute-allocation-fence-unavailable",
				}),
				expect.objectContaining({
					code: "managed-untrusted-js-compute-driver-close-unverifiable",
				}),
			]),
		);
		releaseCreate?.();
		await settle();
		expect(events).toEqual(["create-start", "close-start", "create-end", "kill", "destroy"]);
		expect(events.filter((event) => event === "kill")).toHaveLength(1);
		expect(events.filter((event) => event === "destroy")).toHaveLength(1);
		releaseClose?.();
		await settle();
	});

	it("shares one concurrent dispose lifecycle through cleanup and topology release", async () => {
		const g = graph({ name: "managed-js-compute-concurrent-dispose" });
		const inputs = g.node<ToolProviderAdapterInput<ManagedUntrustedJsComputeArguments>>([], null);
		const admitted = g.node<ToolProviderAdapterRunRequested>([], null);
		const manifests = g.node<ManagedUntrustedJsComputeManifest>([], null);
		const postures = g.node<ManagedUntrustedJsComputeReadiness>([], null);
		const events: string[] = [];
		let releaseKill: (() => void) | undefined;
		const runtime = managedUntrustedJsComputeRuntime(g, {
			inputs,
			admittedRunRequests: [admitted],
			manifests: [manifests],
			readiness: [postures],
			driver: {
				compatibility: MANAGED_UNTRUSTED_JS_COMPUTE_COMPATIBILITY,
				createSandbox() {
					return {};
				},
				upload() {},
				run() {
					return new Promise(() => {});
				},
				async kill() {
					events.push("kill-start");
					await new Promise<void>((resolve) => {
						releaseKill = resolve;
					});
					events.push("kill-end");
				},
				destroy() {
					events.push("destroy");
					return "succeeded";
				},
				close() {
					events.push("close");
				},
			},
			now: () => 10,
		});
		inputs.down([["DATA", input()]]);
		manifests.down([["DATA", manifest()]]);
		postures.down([["DATA", readiness()]]);
		admitted.down([["DATA", run()]]);
		await settle();
		const first = runtime.dispose();
		const second = runtime.dispose();
		expect(second).toBe(first);
		await settle();
		expect(events).toEqual(["kill-start"]);
		releaseKill?.();
		await Promise.all([first, second]);
		expect(events).toEqual(["kill-start", "kill-end", "destroy", "close"]);
	});

	it("deduplicates timeout kill against dispose and suppresses late timeout truth", async () => {
		const g = graph({ name: "managed-js-compute-timeout-dispose-race" });
		const inputs = g.node<ToolProviderAdapterInput<ManagedUntrustedJsComputeArguments>>([], null);
		const admitted = g.node<ToolProviderAdapterRunRequested>([], null);
		const manifests = g.node<ManagedUntrustedJsComputeManifest>([], null);
		const postures = g.node<ManagedUntrustedJsComputeReadiness>([], null);
		const events: string[] = [];
		let releaseKill: (() => void) | undefined;
		const runtime = managedUntrustedJsComputeRuntime(g, {
			inputs,
			admittedRunRequests: [admitted],
			manifests: [manifests],
			readiness: [postures],
			driver: {
				compatibility: MANAGED_UNTRUSTED_JS_COMPUTE_COMPATIBILITY,
				createSandbox() {
					return {};
				},
				upload() {},
				async run() {
					await new Promise(() => {});
					return { outcome: "canceled" };
				},
				async kill() {
					events.push("kill-start");
					await new Promise<void>((resolve) => {
						releaseKill = resolve;
					});
					events.push("kill-end");
				},
				destroy() {
					events.push("destroy");
					return "succeeded";
				},
			},
			now: () => 10,
		});
		const outcomes = collect<ExecutorOutcome>(runtime.outcomes);
		inputs.down([["DATA", input()]]);
		manifests.down([["DATA", manifest({ executionTimeoutMs: 10 })]]);
		postures.down([["DATA", readiness()]]);
		admitted.down([["DATA", run()]]);
		await new Promise((resolve) => setTimeout(resolve, 20));
		expect(events).toEqual(["kill-start"]);
		const disposed = runtime.dispose();
		await settle();
		releaseKill?.();
		await disposed;
		expect(events).toEqual(["kill-start", "kill-end", "destroy"]);
		expect(events.filter((event) => event === "kill-start")).toHaveLength(1);
		expect(events.filter((event) => event === "destroy")).toHaveLength(1);
		expect(outcomes).toHaveLength(0);
		await runtime.dispose();
	});

	it("keeps cooperative timeout canonical and publishes cleanup after the same kill", async () => {
		const g = graph({ name: "managed-js-compute-cooperative-timeout" });
		const inputs = g.node<ToolProviderAdapterInput<ManagedUntrustedJsComputeArguments>>([], null);
		const admitted = g.node<ToolProviderAdapterRunRequested>([], null);
		const manifests = g.node<ManagedUntrustedJsComputeManifest>([], null);
		const postures = g.node<ManagedUntrustedJsComputeReadiness>([], null);
		const events: string[] = [];
		let releaseKill: (() => void) | undefined;
		const runtime = managedUntrustedJsComputeRuntime(g, {
			inputs,
			admittedRunRequests: [admitted],
			manifests: [manifests],
			readiness: [postures],
			driver: {
				compatibility: MANAGED_UNTRUSTED_JS_COMPUTE_COMPATIBILITY,
				createSandbox() {
					return {};
				},
				upload() {},
				run(_sandbox, context) {
					return new Promise((_, reject) =>
						context.signal.addEventListener("abort", () => reject(new Error("timeout abort")), {
							once: true,
						}),
					);
				},
				async kill() {
					events.push("kill-start");
					await new Promise<void>((resolve) => {
						releaseKill = resolve;
					});
					events.push("kill-end");
				},
				destroy() {
					events.push("destroy");
					return "succeeded";
				},
			},
			now: () => 10,
		});
		const outcomes = collect<ExecutorOutcome>(runtime.outcomes);
		const cleanups = collect<ManagedUntrustedJsComputeCleanupStatus>(runtime.cleanup);
		const lifecycle = collect<ManagedUntrustedJsComputeLifecycleFact>(runtime.lifecycle);
		inputs.down([["DATA", input()]]);
		manifests.down([["DATA", manifest({ executionTimeoutMs: 10 })]]);
		postures.down([["DATA", readiness()]]);
		admitted.down([["DATA", run()]]);
		await new Promise((resolve) => setTimeout(resolve, 20));
		await settle();
		expect(events).toEqual(["kill-start"]);
		expect(outcomes).toHaveLength(0);
		expect(cleanups).toHaveLength(0);
		releaseKill?.();
		await settle();
		expect(events).toEqual(["kill-start", "kill-end", "destroy"]);
		expect(events.filter((event) => event === "kill-start")).toHaveLength(1);
		expect(outcomes).toEqual([expect.objectContaining({ kind: "timeout" })]);
		expect(JSON.stringify(outcomes)).toContain("managed-untrusted-js-compute-timeout");
		expect(cleanups).toEqual([expect.objectContaining({ state: "succeeded" })]);
		expect(lifecycle.filter((fact) => fact.state === "destroying")).toHaveLength(1);
		await runtime.dispose();
	});

	it("does not start a dispose kill after terminal settlement has started destroy", async () => {
		const g = graph({ name: "managed-js-compute-terminal-dispose-race" });
		const inputs = g.node<ToolProviderAdapterInput<ManagedUntrustedJsComputeArguments>>([], null);
		const admitted = g.node<ToolProviderAdapterRunRequested>([], null);
		const manifests = g.node<ManagedUntrustedJsComputeManifest>([], null);
		const postures = g.node<ManagedUntrustedJsComputeReadiness>([], null);
		const events: string[] = [];
		let releaseDestroy: (() => void) | undefined;
		const runtime = managedUntrustedJsComputeRuntime(g, {
			inputs,
			admittedRunRequests: [admitted],
			manifests: [manifests],
			readiness: [postures],
			driver: {
				compatibility: MANAGED_UNTRUSTED_JS_COMPUTE_COMPATIBILITY,
				createSandbox() {
					return {};
				},
				upload() {},
				run() {
					return {
						outcome: "succeeded",
						resultRefs: [ref("artifact", "compute-result-1")],
						movement: [movement()],
					};
				},
				kill() {
					events.push("kill-unexpected");
				},
				async destroy() {
					events.push("destroy-start");
					await new Promise<void>((resolve) => {
						releaseDestroy = resolve;
					});
					events.push("destroy-end");
					return "succeeded";
				},
			},
			now: () => 10,
		});
		const outcomes = collect<ExecutorOutcome>(runtime.outcomes);
		inputs.down([["DATA", input()]]);
		manifests.down([["DATA", manifest()]]);
		postures.down([["DATA", readiness()]]);
		admitted.down([["DATA", run()]]);
		await settle();
		expect(outcomes).toEqual([expect.objectContaining({ kind: "result" })]);
		expect(events).toEqual(["destroy-start"]);
		const disposed = runtime.dispose();
		await settle();
		expect(events).toEqual(["destroy-start"]);
		releaseDestroy?.();
		await disposed;
		expect(events).toEqual(["destroy-start", "destroy-end"]);
		await runtime.dispose();
	});

	it("publishes a rejected cancellation acknowledgement when exact kill delivery fails", async () => {
		const g = graph({ name: "managed-js-compute-cancel-kill-failed" });
		const inputs = g.node<ToolProviderAdapterInput<ManagedUntrustedJsComputeArguments>>([], null);
		const admitted = g.node<ToolProviderAdapterRunRequested>([], null);
		const manifests = g.node<ManagedUntrustedJsComputeManifest>([], null);
		const postures = g.node<ManagedUntrustedJsComputeReadiness>([], null);
		const cancellations = g.node<ManagedUntrustedJsComputeCancellationRequested>([], null);
		let release: (() => void) | undefined;
		const runtime = managedUntrustedJsComputeRuntime(g, {
			inputs,
			admittedRunRequests: [admitted],
			manifests: [manifests],
			readiness: [postures],
			cancellationRequests: [cancellations],
			driver: {
				compatibility: MANAGED_UNTRUSTED_JS_COMPUTE_COMPATIBILITY,
				createSandbox() {
					return {};
				},
				upload() {},
				async run() {
					await new Promise<void>((resolve) => {
						release = resolve;
					});
					return {
						outcome: "succeeded",
						resultRefs: [ref("artifact", "compute-result-1")],
						movement: [movement()],
					};
				},
				kill() {
					throw new Error("driver-private kill failure");
				},
				destroy() {
					return "succeeded";
				},
			},
			now: () => 10,
		});
		const acknowledgements = collect(runtime.cancellations);
		const issues = collect<{ code: string }>(runtime.issues);
		const outcomes = collect<ExecutorOutcome>(runtime.outcomes);
		inputs.down([["DATA", input()]]);
		manifests.down([["DATA", manifest()]]);
		postures.down([["DATA", readiness()]]);
		admitted.down([["DATA", run()]]);
		await settle();
		cancellations.down([
			[
				"DATA",
				{
					kind: "managed-untrusted-js-compute-cancellation-requested",
					cancellationId: "cancel:js-compute:kill-failed",
					runId: "run:js-compute:1",
					attempt: 1,
					environmentRevision: "environment-revision:js-compute:1",
					manifestFingerprint: "fingerprint:js-compute:1",
					epoch: "epoch:js-compute:1",
				},
			],
		]);
		await settle();
		expect(acknowledgements).toEqual([
			expect.objectContaining({ state: "rejected", code: "kill-failed" }),
		]);
		expect(issues).toEqual([
			expect.objectContaining({ code: "managed-untrusted-js-compute-cancellation-kill-failed" }),
		]);
		expect(outcomes).toHaveLength(0);
		release?.();
		await settle();
		expect(outcomes).toEqual([expect.objectContaining({ kind: "result" })]);
		await runtime.dispose();
	});

	it("suppresses late timeout publication after dispose", async () => {
		const g = graph({ name: "managed-js-compute-dispose-before-timeout" });
		const inputs = g.node<ToolProviderAdapterInput<ManagedUntrustedJsComputeArguments>>([], null);
		const admitted = g.node<ToolProviderAdapterRunRequested>([], null);
		const manifests = g.node<ManagedUntrustedJsComputeManifest>([], null);
		const postures = g.node<ManagedUntrustedJsComputeReadiness>([], null);
		const runtime = managedUntrustedJsComputeRuntime(g, {
			inputs,
			admittedRunRequests: [admitted],
			manifests: [manifests],
			readiness: [postures],
			driver: {
				compatibility: MANAGED_UNTRUSTED_JS_COMPUTE_COMPATIBILITY,
				createSandbox() {
					return {};
				},
				upload() {},
				async run() {
					await new Promise(() => {});
					return { outcome: "canceled" };
				},
				kill() {},
				destroy() {
					return "succeeded";
				},
			},
			now: () => 10,
		});
		const outcomes = collect<ExecutorOutcome>(runtime.outcomes);
		const statuses = collect(runtime.runStatus);
		inputs.down([["DATA", input()]]);
		manifests.down([["DATA", manifest({ executionTimeoutMs: 150 })]]);
		postures.down([["DATA", readiness()]]);
		admitted.down([["DATA", run()]]);
		await settle();
		await runtime.dispose();
		await new Promise((resolve) => setTimeout(resolve, 180));
		await settle();
		expect(outcomes).toHaveLength(0);
		expect(JSON.stringify(statuses)).not.toContain("timeout");
		await runtime.dispose();
	});
});
