import { describe, expect, it } from "vitest";
import {
	LOCAL_CONTAINER_POSTGRESQL_BACKEND_FAMILY,
	LOCAL_CONTAINER_POSTGRESQL_COMPATIBILITY,
	type LocalContainerPostgresqlCancellationDecision,
	type LocalContainerPostgresqlCancellationRequested,
	type LocalContainerPostgresqlDriver,
	type LocalContainerPostgresqlManifest,
	type LocalContainerPostgresqlReadiness,
	localContainerPostgresqlManifest,
	localContainerPostgresqlReadiness,
	localContainerPostgresqlRuntime,
} from "../executors/local-container-postgresql.js";
import { postgresqlToolProviderInputFromIntent } from "../executors/postgresql-tool-provider.js";
import { graph } from "../graph/graph.js";
import type { ToolProviderAdapterRunRequested } from "../orchestration/index.js";

const digest = `sha256:${"a".repeat(64)}`;
const manifest = (): LocalContainerPostgresqlManifest =>
	localContainerPostgresqlManifest({
		kind: "local-container-postgresql-manifest",
		manifestId: "manifest:pg",
		revision: "revision:1",
		fingerprint: "fingerprint:pg:1",
		imageDigest: digest,
		engineCompatibilityRevision: LOCAL_CONTAINER_POSTGRESQL_COMPATIBILITY,
		backendFamily: LOCAL_CONTAINER_POSTGRESQL_BACKEND_FAMILY,
		backendCertificationRevision: "docker-certification:linux-desktop:v0",
		recipeRevision: "postgresql-read-only-query-v1",
		sandboxRevision: "sandbox:1",
		mountPolicyRevision: "mount:1",
		networkPolicyRevision: "network:deny:1",
		resourcePolicyRevision: "resources:1",
		stopGraceMs: 10,
		attestationRefs: [{ kind: "attestation", id: "attestation:1" }],
	});
const readiness = (
	patch: Partial<LocalContainerPostgresqlReadiness> = {},
): LocalContainerPostgresqlReadiness => ({
	kind: "local-container-postgresql-readiness",
	manifestFingerprint: "fingerprint:pg:1",
	backendCertificationRevision: "docker-certification:linux-desktop:v0",
	state: "ready",
	observedAtMs: 1,
	expiresAtMs: 1000,
	backendFamily: LOCAL_CONTAINER_POSTGRESQL_BACKEND_FAMILY,
	hostPlatform: "darwin/arm64",
	engineApiRevision: "docker-api:1.44",
	engineRevision: "docker-engine:24.0",
	runtimeRevision: "docker-desktop:4.27",
	guestPlatform: "linux/arm64",
	vmRuntimeRevision: "docker-desktop-vm:linuxkit:1",
	engineReachable: true,
	compatibilityVerified: true,
	backendFamilyVerified: true,
	hostPlatformVerified: true,
	imageDigestPresent: true,
	imageDigestVerified: true,
	recipeVerified: true,
	isolationVerified: true,
	noEngineSocketMountVerified: true,
	noHostNetworkVerified: true,
	noHostBindMountVerified: true,
	destinationPinnedEgressDenyVerified: true,
	metadataEgressDenyVerified: true,
	dnsRebindingResistanceVerified: true,
	quotaReady: true,
	cancellationVerified: true,
	cleanupVerified: true,
	artifactResolverReady: true,
	credentialResolverReady: true,
	secretDestructionVerified: true,
	limitationRefs: [
		{ kind: "limitation", id: "docker-engine-api-v0-only" },
		{ kind: "limitation", id: "docker-desktop-vm-backed" },
	],
	attestationRefs: [{ kind: "attestation", id: "attestation:ready:1" }],
	...patch,
});
const input = () =>
	postgresqlToolProviderInputFromIntent(
		{
			contractVersion: "1",
			intentId: "intent:1",
			idempotencyKey: "idem:1",
			source: { id: "source:1", revision: "r:1" },
			sourceProfile: { id: "source-profile:1", revision: "r:1" },
			queryPlan: { id: "plan:1", revision: "r:1" },
			executorProfile: { id: "profile-ref:1", revision: "r:1" },
			schemaRef: "schema:1",
		},
		{
			requestId: "request:1",
			operationId: "operation:1",
			effectRunId: "effect:1",
			routeId: "route:1",
			executorId: "executor:pg",
			profileId: "profile:pg",
		},
	);
const run = (): ToolProviderAdapterRunRequested => ({
	kind: "tool-provider-adapter-run-requested",
	runId: "run:1",
	adapterInputId: input().adapterInputId,
	requestId: "request:1",
	operationId: "operation:1",
	routeId: "route:1",
	providerId: "postgresql",
	executorId: "executor:pg",
	profileId: "profile:pg",
	attempt: 1,
	reason: "manual",
	metadata: {
		executionEnvironmentId: "environment:container",
		executionEnvironmentRevision: "environment-revision:1",
		executionEnvironmentLocality: "local",
		executionEnvironmentBindingKind: "local-container",
		executionSessionEpoch: "epoch:1",
		executionManifestFingerprint: "fingerprint:pg:1",
	},
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
	await new Promise((r) => setTimeout(r, 0));
};

describe("local-container PostgreSQL runtime (D604)", () => {
	it("rejects mutable image identity and private manifest/readiness material", () => {
		expect(() =>
			localContainerPostgresqlManifest({ ...manifest(), imageDigest: "postgres:latest" }),
		).toThrow();
		expect(() =>
			localContainerPostgresqlManifest({ ...manifest(), backendFamily: "podman" } as never),
		).toThrow();
		expect(() =>
			localContainerPostgresqlManifest({
				...manifest(),
				backendCertificationRevision: "docker-socket-/var/run/docker.sock",
			}),
		).toThrow();
		expect(() =>
			localContainerPostgresqlManifest({
				...manifest(),
				backendCertificationRevision: "secretHandle:abc",
			}),
		).toThrow();
		expect(() =>
			localContainerPostgresqlManifest({ ...manifest(), argv: ["private"] } as never),
		).toThrow(/private|unsupported/);
		expect(() =>
			localContainerPostgresqlReadiness({ ...readiness(), credential: "private" } as never),
		).toThrow(/private|unsupported/);
		expect(() =>
			localContainerPostgresqlReadiness({
				...readiness(),
				backendFamily: "podman" as never,
			}),
		).toThrow();
		expect(() =>
			localContainerPostgresqlReadiness({
				...readiness(),
				hostPlatform: "docker-socket-/var/run/docker.sock",
			}),
		).toThrow();
		expect(() =>
			localContainerPostgresqlReadiness({
				...readiness(),
				hostPlatform: "darwin/arm64",
				vmRuntimeRevision: undefined,
			}),
		).toThrow();
		expect(() =>
			localContainerPostgresqlReadiness({
				...readiness(),
				hostPlatform: "linux/amd64",
				vmRuntimeRevision: "docker-desktop-vm:linuxkit:1",
			}),
		).toThrow();
		expect(() =>
			localContainerPostgresqlReadiness({
				...readiness(),
				hostPlatform: "freebsd/amd64",
				vmRuntimeRevision: "docker-desktop-vm:linuxkit:1",
			}),
		).toThrow();
		expect(() =>
			localContainerPostgresqlReadiness({
				...readiness(),
				guestPlatform: "windows/amd64",
			}),
		).toThrow();
		expect(() =>
			localContainerPostgresqlReadiness({
				...readiness(),
				limitationRefs: [{ kind: "limitation", id: "host-path-var-run-docker-sock" }],
			}),
		).toThrow();
		expect(() =>
			localContainerPostgresqlReadiness({
				...readiness(),
				limitationRefs: [{ kind: "limitation", id: "handle:abc" }],
			}),
		).toThrow();
		expect(() =>
			localContainerPostgresqlReadiness({
				...readiness(),
				limitationRefs: [{ kind: "limitation", id: "vm-id:abc" }],
			}),
		).toThrow();
	});
	it("runs ordered fresh lifecycle, settles only after exactly-once cleanup, and leaks no private material", async () => {
		const g = graph({ name: "container-success" });
		const inputs = g.node([], null);
		const admitted = g.node<ToolProviderAdapterRunRequested>([], null);
		const manifests = g.node<LocalContainerPostgresqlManifest>([], null);
		const postures = g.node<LocalContainerPostgresqlReadiness>([], null);
		const calls: string[] = [];
		const privateBinding = { containerId: "private-container-id", argv: ["private-sql"] };
		const driver: LocalContainerPostgresqlDriver = {
			compatibility: LOCAL_CONTAINER_POSTGRESQL_COMPATIBILITY,
			prepare() {
				calls.push("prepare");
			},
			create() {
				calls.push("create");
				return privateBinding;
			},
			start(binding) {
				expect(binding).toBe(privateBinding);
				calls.push("start");
			},
			wait() {
				calls.push("wait");
				return { columns: ["id"], rows: [[1]], rowCount: 1, byteLength: 3 };
			},
			stop() {
				calls.push("stop");
			},
			kill() {
				calls.push("kill");
			},
			remove() {
				calls.push("remove");
			},
			cleanup() {
				calls.push("cleanup");
			},
		};
		const runtime = localContainerPostgresqlRuntime(g, {
			inputs: inputs as never,
			admittedRunRequests: [admitted],
			manifests: [manifests],
			readiness: [postures],
			driver,
			now: () => 10,
		});
		const outcomes = collect(runtime.outcomes);
		const cleanup = collect<{ state: string }>(runtime.cleanup);
		inputs.down([["DATA", input()]]);
		manifests.down([["DATA", manifest()]]);
		postures.down([["DATA", readiness()]]);
		admitted.down([["DATA", run()]]);
		await settle();
		expect(calls).toEqual(["prepare", "create", "start", "wait", "remove", "cleanup"]);
		expect(outcomes).toHaveLength(1);
		expect(cleanup).toEqual([expect.objectContaining({ state: "succeeded" })]);
		const visible = JSON.stringify({ topology: g.topology(), outcomes, cleanup });
		expect(visible).not.toContain("private-container-id");
		expect(visible).not.toContain("private-sql");
		await runtime.dispose();
		await runtime.dispose();
		expect(calls.filter((v) => v === "remove")).toHaveLength(1);
	});

	it("fails closed before driver preparation when digest readiness is missing or stale", async () => {
		for (const patch of [
			{ engineReachable: false },
			{ compatibilityVerified: false },
			{ backendFamilyVerified: false },
			{ hostPlatformVerified: false },
			{ imageDigestPresent: false },
			{ imageDigestVerified: false },
			{ recipeVerified: false },
			{ isolationVerified: false },
			{ noEngineSocketMountVerified: false },
			{ noHostNetworkVerified: false },
			{ noHostBindMountVerified: false },
			{ destinationPinnedEgressDenyVerified: false },
			{ metadataEgressDenyVerified: false },
			{ dnsRebindingResistanceVerified: false },
			{ quotaReady: false },
			{ cancellationVerified: false },
			{ cleanupVerified: false },
			{ artifactResolverReady: false },
			{ credentialResolverReady: false },
			{ secretDestructionVerified: false },
			{ state: "stale" as const },
			{ expiresAtMs: 10 },
			{ observedAtMs: 11 },
		]) {
			const g = graph();
			const inputs = g.node([], null);
			const admitted = g.node<ToolProviderAdapterRunRequested>([], null);
			const manifests = g.node<LocalContainerPostgresqlManifest>([], null);
			const postures = g.node<LocalContainerPostgresqlReadiness>([], null);
			let prepared = 0;
			const driver = inertDriver(() => {
				prepared++;
			});
			const runtime = localContainerPostgresqlRuntime(g, {
				inputs: inputs as never,
				admittedRunRequests: [admitted],
				manifests: [manifests],
				readiness: [postures],
				driver,
				now: () => 10,
			});
			const issues = collect<{ code: string }>(runtime.issues);
			inputs.down([["DATA", input()]]);
			manifests.down([["DATA", manifest()]]);
			postures.down([["DATA", readiness(patch)]]);
			admitted.down([["DATA", run()]]);
			await settle();
			expect(prepared).toBe(0);
			expect(issues.at(-1)?.code).toBe("local-container-admission-blocked");
			await runtime.dispose();
		}
	});

	it("fails closed before driver preparation when admitted metadata contains private Docker material", async () => {
		const g = graph();
		const inputs = g.node([], null);
		const admitted = g.node<ToolProviderAdapterRunRequested>([], null);
		const manifests = g.node<LocalContainerPostgresqlManifest>([], null);
		const postures = g.node<LocalContainerPostgresqlReadiness>([], null);
		let prepared = 0;
		const runtime = localContainerPostgresqlRuntime(g, {
			inputs: inputs as never,
			admittedRunRequests: [admitted],
			manifests: [manifests],
			readiness: [postures],
			driver: inertDriver(() => {
				prepared++;
			}),
			now: () => 10,
		});
		const issues = collect<{ code: string }>(runtime.issues);
		inputs.down([["DATA", input()]]);
		manifests.down([["DATA", manifest()]]);
		postures.down([["DATA", readiness()]]);
		admitted.down([
			[
				"DATA",
				{
					...run(),
					metadata: {
						...run().metadata,
						executionEnvironmentId: "docker-socket-var-run",
					},
				},
			],
		]);
		await settle();
		expect(prepared).toBe(0);
		expect(issues.at(-1)?.code).toBe("local-container-admission-blocked");
		await runtime.dispose();
	});

	it("fails closed when readiness belongs to a different certified backend revision", async () => {
		const g = graph();
		const inputs = g.node([], null);
		const admitted = g.node<ToolProviderAdapterRunRequested>([], null);
		const manifests = g.node<LocalContainerPostgresqlManifest>([], null);
		const postures = g.node<LocalContainerPostgresqlReadiness>([], null);
		let prepared = 0;
		const runtime = localContainerPostgresqlRuntime(g, {
			inputs: inputs as never,
			admittedRunRequests: [admitted],
			manifests: [manifests],
			readiness: [postures],
			driver: inertDriver(() => {
				prepared++;
			}),
			now: () => 10,
		});
		const issues = collect<{ code: string }>(runtime.issues);
		inputs.down([["DATA", input()]]);
		manifests.down([["DATA", manifest()]]);
		postures.down([
			["DATA", readiness({ backendCertificationRevision: "docker-certification:other:v0" })],
		]);
		admitted.down([["DATA", run()]]);
		await settle();
		expect(prepared).toBe(0);
		expect(issues.at(-1)?.code).toBe("local-container-admission-blocked");
		await runtime.dispose();
	});

	it("requires exact cancellation admission and distinguishes acknowledgement from settlement", async () => {
		const g = graph();
		const inputs = g.node([], null);
		const admitted = g.node<ToolProviderAdapterRunRequested>([], null);
		const manifests = g.node<LocalContainerPostgresqlManifest>([], null);
		const postures = g.node<LocalContainerPostgresqlReadiness>([], null);
		const cancels = g.node<LocalContainerPostgresqlCancellationRequested>([], null);
		const decisions = g.node<LocalContainerPostgresqlCancellationDecision>([], null);
		let resolveWait!: (v: { columns: string[]; rows: never[] }) => void;
		const calls: string[] = [];
		const driver: LocalContainerPostgresqlDriver = {
			...inertDriver(),
			wait() {
				calls.push("wait");
				return new Promise((r) => {
					resolveWait = r;
				});
			},
			stop() {
				calls.push("stop");
			},
			kill() {
				calls.push("kill");
			},
		};
		const runtime = localContainerPostgresqlRuntime(g, {
			inputs: inputs as never,
			admittedRunRequests: [admitted],
			manifests: [manifests],
			readiness: [postures],
			cancellationRequests: [cancels],
			cancellationDecisions: [decisions],
			driver,
			now: () => 10,
		});
		const proposals = collect<{ proposalId: string }>(runtime.cancellationProposals);
		const admissions = collect<{ state: string }>(runtime.cancellationAdmissions);
		const acks = collect(runtime.cancellationAcknowledgements);
		const outcomes = collect(runtime.outcomes);
		inputs.down([["DATA", input()]]);
		manifests.down([["DATA", manifest()]]);
		postures.down([["DATA", readiness()]]);
		admitted.down([["DATA", run()]]);
		await settle();
		const base = {
			kind: "local-container-postgresql-cancellation-requested" as const,
			cancellationId: "cancel:1",
			runId: "run:1",
			attempt: 1,
			environmentRevision: "environment-revision:1",
			manifestFingerprint: "fingerprint:pg:1",
			sessionEpoch: "epoch:1",
		};
		cancels.down([["DATA", { ...base, sessionEpoch: "epoch:stale" }]]);
		await settle();
		expect(proposals).toHaveLength(0);
		cancels.down([["DATA", base]]);
		await settle();
		decisions.down([
			[
				"DATA",
				{
					kind: "local-container-postgresql-cancellation-decision",
					decisionId: "decision:1",
					proposalId: proposals[0]!.proposalId,
					outcome: "admit",
				},
			],
		]);
		await settle();
		expect(acks).toHaveLength(1);
		expect(outcomes).toHaveLength(0);
		expect(calls).toContain("stop");
		cancels.down([["DATA", { ...base, cancellationId: "cancel:2" }]]);
		await settle();
		decisions.down([
			[
				"DATA",
				{
					kind: "local-container-postgresql-cancellation-decision",
					decisionId: "decision:2",
					proposalId: proposals[1]!.proposalId,
					outcome: "admit",
				},
			],
		]);
		await settle();
		expect(admissions.map((entry) => entry.state)).toEqual(["admitted", "blocked"]);
		expect(acks).toHaveLength(1);
		expect(calls.filter((call) => call === "stop")).toHaveLength(1);
		resolveWait({ columns: [], rows: [] });
		await settle();
		expect(outcomes.at(-1)).toMatchObject({ kind: "canceled" });
		await runtime.dispose();
	});

	it("rejects manifest replacement and exact provider/session conflicts before driver work", async () => {
		const g = graph();
		const inputs = g.node([], null);
		const admitted = g.node<ToolProviderAdapterRunRequested>([], null);
		const manifests = g.node<LocalContainerPostgresqlManifest>([], null);
		const postures = g.node<LocalContainerPostgresqlReadiness>([], null);
		let prepared = 0;
		const runtime = localContainerPostgresqlRuntime(g, {
			inputs: inputs as never,
			admittedRunRequests: [admitted],
			manifests: [manifests],
			readiness: [postures],
			driver: inertDriver(() => prepared++),
			now: () => 10,
		});
		const issues = collect<{ code: string }>(runtime.issues);
		inputs.down([["DATA", input()]]);
		manifests.down([["DATA", manifest()]]);
		manifests.down([["DATA", { ...manifest(), imageDigest: `sha256:${"b".repeat(64)}` }]]);
		postures.down([["DATA", readiness()]]);
		admitted.down([["DATA", { ...run(), providerId: "other-provider" }]]);
		await settle();
		expect(prepared).toBe(0);
		expect(issues.map((issue) => issue.code)).toEqual(
			expect.arrayContaining([
				"local-container-manifest-conflict",
				"local-container-input-mismatch",
			]),
		);
		admitted.down([["DATA", run()]]);
		await settle();
		expect(prepared).toBe(1);
		admitted.down([["DATA", { ...run(), runId: "run:2" }]]);
		await settle();
		expect(prepared).toBe(1);
		expect(issues.at(-1)?.code).toBe("local-container-session-reused");
		await runtime.dispose();
	});

	it("preserves a provider outcome when exactly-once cleanup fails", async () => {
		const g = graph();
		const inputs = g.node([], null);
		const admitted = g.node<ToolProviderAdapterRunRequested>([], null);
		const manifests = g.node<LocalContainerPostgresqlManifest>([], null);
		const postures = g.node<LocalContainerPostgresqlReadiness>([], null);
		const driver = inertDriver();
		let cleanupCalls = 0;
		const runtime = localContainerPostgresqlRuntime(g, {
			inputs: inputs as never,
			admittedRunRequests: [admitted],
			manifests: [manifests],
			readiness: [postures],
			driver: {
				...driver,
				cleanup() {
					cleanupCalls++;
					throw new Error("private cleanup detail");
				},
			},
			now: () => 10,
		});
		const outcomes = collect<{ kind: string }>(runtime.outcomes);
		const cleanup = collect<{ state: string }>(runtime.cleanup);
		const issues = collect<{ code: string; message: string }>(runtime.issues);
		inputs.down([["DATA", input()]]);
		manifests.down([["DATA", manifest()]]);
		postures.down([["DATA", readiness()]]);
		admitted.down([["DATA", run()]]);
		await settle();
		expect(outcomes).toEqual([expect.objectContaining({ kind: "result" })]);
		expect(cleanup).toEqual([expect.objectContaining({ state: "failed" })]);
		expect(cleanupCalls).toBe(1);
		expect(JSON.stringify({ outcomes, cleanup, issues })).not.toContain("private cleanup detail");
		await runtime.dispose();
		expect(cleanupCalls).toBe(1);
	});

	it("bounds dispose through one stop-kill-cleanup owner even when wait and stop never settle", async () => {
		const g = graph();
		const inputs = g.node([], null);
		const admitted = g.node<ToolProviderAdapterRunRequested>([], null);
		const manifests = g.node<LocalContainerPostgresqlManifest>([], null);
		const postures = g.node<LocalContainerPostgresqlReadiness>([], null);
		const calls: string[] = [];
		let signal: AbortSignal | undefined;
		const runtime = localContainerPostgresqlRuntime(g, {
			inputs: inputs as never,
			admittedRunRequests: [admitted],
			manifests: [manifests],
			readiness: [postures],
			driver: {
				...inertDriver(),
				prepare(context) {
					signal = context.signal;
				},
				wait() {
					return new Promise(() => {});
				},
				stop() {
					calls.push("stop");
					return new Promise(() => {});
				},
				kill() {
					calls.push("kill");
				},
				remove() {
					calls.push("remove");
				},
				cleanup() {
					calls.push("cleanup");
				},
			},
			now: () => 10,
		});
		const outcomes = collect<{ kind: string; reason?: string }>(runtime.outcomes);
		const statuses = collect<{ status: string }>(runtime.runStatus);
		inputs.down([["DATA", input()]]);
		manifests.down([["DATA", manifest()]]);
		postures.down([["DATA", readiness()]]);
		admitted.down([["DATA", run()]]);
		await settle();
		await runtime.dispose();
		expect(calls).toEqual(["stop", "kill", "remove", "cleanup"]);
		expect(signal?.aborted).toBe(true);
		expect(outcomes).toEqual([
			expect.objectContaining({ kind: "canceled", reason: "runtime-disposed" }),
		]);
		expect(statuses.at(-1)).toMatchObject({ status: "canceled" });
		await runtime.dispose();
		expect(calls).toEqual(["stop", "kill", "remove", "cleanup"]);
	});
});

function inertDriver(onPrepare: () => void = () => {}): LocalContainerPostgresqlDriver {
	return {
		compatibility: LOCAL_CONTAINER_POSTGRESQL_COMPATIBILITY,
		prepare: onPrepare,
		create() {
			return {};
		},
		start() {},
		wait() {
			return { columns: [], rows: [] };
		},
		stop() {},
		kill() {},
		remove() {},
		cleanup() {},
	};
}
