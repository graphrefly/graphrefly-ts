import { describe, expect, it } from "vitest";
import {
	LOCAL_CONTAINER_POSTGRESQL_BACKEND_FAMILY,
	LOCAL_CONTAINER_POSTGRESQL_COMPATIBILITY,
	type LocalContainerPostgresqlManifest,
	localContainerPostgresqlDockerEngineApiV0PreflightReadiness,
	localContainerPostgresqlManifest,
} from "../executors/local-container-postgresql.js";
import {
	certifyDockerEngineApiV0LocalContainerPostgresql,
	type DockerEngineApiV0CertifiedHostMatrixEntry,
	type DockerEngineApiV0ContainmentEvidence,
	type DockerEngineApiV0HostResult,
	type DockerEngineApiV0LocalContainerPostgresqlHost,
	type DockerEngineApiV0NetworkDenialEvidence,
	dockerEngineApiV0LocalContainerPostgresqlDriver,
} from "../executors/local-container-postgresql-docker-engine-api-v0.js";

const digest = `sha256:${"b".repeat(64)}`;
const imageRef = `registry.example.test/graphrefly/postgresql@${digest}`;

const manifest = (): LocalContainerPostgresqlManifest =>
	localContainerPostgresqlManifest({
		kind: "local-container-postgresql-manifest",
		manifestId: "manifest:pg-d624",
		revision: "revision:d624",
		fingerprint: "fingerprint:pg-d624",
		imageDigest: digest,
		engineCompatibilityRevision: LOCAL_CONTAINER_POSTGRESQL_COMPATIBILITY,
		backendFamily: LOCAL_CONTAINER_POSTGRESQL_BACKEND_FAMILY,
		backendCertificationRevision: "docker-certification:d624-v0",
		recipeRevision: "postgresql-read-only-query-v1",
		sandboxRevision: "sandbox:d624",
		mountPolicyRevision: "mount:d624",
		networkPolicyRevision: "network:deny:d624",
		resourcePolicyRevision: "resources:d624",
		stopGraceMs: 5,
		attestationRefs: [{ kind: "attestation", id: "manifest:d624" }],
	});

describe("Docker Engine API v0 local-container PostgreSQL broker (D624)", () => {
	it("certifies ready only after every explicit host proof succeeds", async () => {
		const host = dockerHost();
		const preflight = await certifyDockerEngineApiV0LocalContainerPostgresql({
			manifest: manifest(),
			host,
			imageRef,
			hostPlatform: "darwin/arm64",
			guestPlatform: "linux/arm64",
			runtimeRevision: "docker-desktop:4.27",
			certifiedHostMatrix: certifiedHostMatrix("desktop"),
			vmRuntimeRevision: "docker-desktop-vm:linuxkit:1",
			observedAtMs: 10,
			ttlMs: 100,
			probeLabel: "opaque-probe-label",
		});
		const readiness = localContainerPostgresqlDockerEngineApiV0PreflightReadiness(preflight);

		expect(readiness).toMatchObject({
			state: "ready",
			backendFamilyVerified: true,
			imageDigestVerified: true,
			noEngineSocketMountVerified: true,
			destinationPinnedEgressDenyVerified: true,
			cleanupVerified: true,
		});
		expect(host.calls).toEqual([
			"readVersion",
			"inspectImageDigest",
			"createProbeNetwork",
			"createProbeContainer",
			"inspectProbeContainment",
			"startProbeContainer",
			"waitProbeContainer",
			"verifyProbeNetworkDenials",
			"verifyProbeCancellationAndSecretDestruction",
			"removeProbeContainer",
			"removeProbeNetwork",
		]);
		const visible = JSON.stringify(preflight);
		expect(visible).not.toContain("opaque-probe-binding");
		expect(visible).not.toContain("opaque-network-binding");
		expect(visible).not.toContain("docker.sock");
		expect(visible).not.toContain("registry.example.test");
	});

	it("fails closed for Podman, daemon-only reachability, and each missing network proof", async () => {
		const podman = await certifyDockerEngineApiV0LocalContainerPostgresql({
			manifest: manifest(),
			host: dockerHost({
				version: {
					detectedBackend: "podman",
					engineReachable: true,
					engineApiRevision: "podman-api:4.9",
					engineRevision: "podman:4.9",
				},
			}),
			imageRef,
			hostPlatform: "linux/amd64",
			guestPlatform: "linux/amd64",
			runtimeRevision: "podman:4.9",
			certifiedHostMatrix: certifiedHostMatrix("linux"),
			observedAtMs: 10,
			ttlMs: 100,
		});
		expect(localContainerPostgresqlDockerEngineApiV0PreflightReadiness(podman)).toMatchObject({
			state: "unavailable",
			backendFamilyVerified: false,
		});

		const daemonOnlyHost = dockerHost({ failCall: "createProbeContainer" });
		const daemonOnly = await certifyDockerEngineApiV0LocalContainerPostgresql({
			manifest: manifest(),
			host: daemonOnlyHost,
			imageRef,
			hostPlatform: "linux/amd64",
			guestPlatform: "linux/amd64",
			runtimeRevision: "docker-engine:24",
			certifiedHostMatrix: certifiedHostMatrix("linux"),
			observedAtMs: 10,
			ttlMs: 100,
		});
		expect(localContainerPostgresqlDockerEngineApiV0PreflightReadiness(daemonOnly).state).toBe(
			"unavailable",
		);
		expect(daemonOnlyHost.calls).toContain("removeProbeNetwork");

		for (const field of [
			"destinationPinnedEgressDenyVerified",
			"metadataEgressDenyVerified",
			"linkLocalEgressDenyVerified",
			"loopbackEgressDenyVerified",
			"hostGatewayEgressDenyVerified",
			"dnsRebindingResistanceVerified",
		] as const) {
			const preflight = await certifyDockerEngineApiV0LocalContainerPostgresql({
				manifest: manifest(),
				host: dockerHost({
					networkDenial: { ...networkDenialEvidence(), [field]: false },
				}),
				imageRef,
				hostPlatform: "linux/amd64",
				guestPlatform: "linux/amd64",
				runtimeRevision: "docker-engine:24",
				certifiedHostMatrix: certifiedHostMatrix("linux"),
				observedAtMs: 10,
				ttlMs: 100,
			});
			expect(localContainerPostgresqlDockerEngineApiV0PreflightReadiness(preflight).state).toBe(
				"unavailable",
			);
		}
	});

	it("cleans allocated probe resources after every fail-closed host result", async () => {
		for (const failCall of [
			"createProbeContainer",
			"inspectProbeContainment",
			"startProbeContainer",
			"waitProbeContainer",
			"verifyProbeNetworkDenials",
			"verifyProbeCancellationAndSecretDestruction",
		] as const) {
			const host = dockerHost({ failCall });
			const preflight = await certifyDockerEngineApiV0LocalContainerPostgresql({
				manifest: manifest(),
				host,
				imageRef,
				hostPlatform: "linux/amd64",
				guestPlatform: "linux/amd64",
				runtimeRevision: "docker-engine:24",
				certifiedHostMatrix: certifiedHostMatrix("linux"),
				observedAtMs: 10,
				ttlMs: 100,
			});

			expect(localContainerPostgresqlDockerEngineApiV0PreflightReadiness(preflight).state).toBe(
				"unavailable",
			);
			expect(host.calls).toContain("removeProbeNetwork");
			if (failCall !== "createProbeContainer") expect(host.calls).toContain("removeProbeContainer");
		}
	});

	it("rejects root user aliases and records cleanup failure as unavailable", async () => {
		for (const containerUser of ["0", "0:0", "0:65532", "root"]) {
			const preflight = await certifyDockerEngineApiV0LocalContainerPostgresql({
				manifest: manifest(),
				host: dockerHost({
					containment: { ...containmentEvidence(), containerUser },
				}),
				imageRef,
				hostPlatform: "linux/amd64",
				guestPlatform: "linux/amd64",
				runtimeRevision: "docker-engine:24",
				certifiedHostMatrix: certifiedHostMatrix("linux"),
				observedAtMs: 10,
				ttlMs: 100,
			});
			expect(localContainerPostgresqlDockerEngineApiV0PreflightReadiness(preflight).state).toBe(
				"unavailable",
			);
		}

		const host = dockerHost({ removeProbeContainer: { ok: false } });
		const preflight = await certifyDockerEngineApiV0LocalContainerPostgresql({
			manifest: manifest(),
			host,
			imageRef,
			hostPlatform: "linux/amd64",
			guestPlatform: "linux/amd64",
			runtimeRevision: "docker-engine:24",
			certifiedHostMatrix: certifiedHostMatrix("linux"),
			observedAtMs: 10,
			ttlMs: 100,
		});

		const readiness = localContainerPostgresqlDockerEngineApiV0PreflightReadiness(preflight);
		expect(readiness.state).toBe("unavailable");
		expect(readiness.cleanupVerified).toBe(false);
		expect(host.calls).toContain("removeProbeContainer");
		expect(host.calls).toContain("removeProbeNetwork");
	});

	it("maps local-container driver lifecycle through exact host methods without arbitrary create body", async () => {
		const host = dockerHost({ failOnAbortedRunCleanupContext: true });
		const driver = dockerEngineApiV0LocalContainerPostgresqlDriver({
			host,
			imageRef,
		});
		const abortController = new AbortController();
		const context = {
			runId: "run:d624",
			attempt: 1,
			sessionEpoch: "epoch:d624",
			manifestFingerprint: "fingerprint:pg-d624",
			signal: abortController.signal,
		};
		const binding = await driver.create(context, {
			contractVersion: "1",
			source: { id: "source:1", revision: "r:1" },
			sourceProfile: { id: "profile:source", revision: "r:1" },
			queryPlan: { id: "plan:1", revision: "r:1" },
			executorProfile: { id: "profile:executor", revision: "r:1" },
			schemaRef: "schema:1",
		});
		await driver.start(binding, context);
		const result = await driver.wait(binding, context);
		abortController.abort("user-cancel");
		await driver.stop(binding, context, 5);
		await driver.kill(binding, context);
		await driver.remove(binding, context);

		expect(result).toEqual({
			columns: ["answer"],
			rows: [[42]],
			rowCount: 1,
			byteLength: 2,
		});
		expect(host.calls).toEqual([
			"createRunContainer",
			"startRunContainer",
			"waitRunContainer",
			"stopRunContainer",
			"killRunContainer",
			"removeRunContainer",
		]);
		expect(JSON.stringify(result)).not.toContain("opaque-run-binding");
		expect(host.runCreateImageRefs).toEqual([imageRef]);
	});

	it("requires an explicit public certified host matrix before reporting ready", async () => {
		const hostWithoutMatrix = dockerHost();
		const withoutMatrix = await certifyDockerEngineApiV0LocalContainerPostgresql({
			manifest: manifest(),
			host: hostWithoutMatrix,
			imageRef,
			hostPlatform: "linux/amd64",
			guestPlatform: "linux/amd64",
			runtimeRevision: "docker-engine:24",
			certifiedHostMatrix: [],
			observedAtMs: 10,
			ttlMs: 100,
		});
		expect(
			localContainerPostgresqlDockerEngineApiV0PreflightReadiness(withoutMatrix),
		).toMatchObject({
			state: "unavailable",
			hostPlatformVerified: false,
		});
		expect(hostWithoutMatrix.calls).toEqual(["readVersion"]);

		const hostWithPrivateMatrixRef = dockerHost();
		const privateMatrixRef = await certifyDockerEngineApiV0LocalContainerPostgresql({
			manifest: manifest(),
			host: hostWithPrivateMatrixRef,
			imageRef,
			hostPlatform: "linux/amd64",
			guestPlatform: "linux/amd64",
			runtimeRevision: "docker-engine:24",
			certifiedHostMatrix: [
				{
					...certifiedHostMatrix("linux")[0],
					proofRefs: [
						{ kind: "attestation", id: "docker-engine-api-v0:host-matrix:private-socket" },
					],
				},
			],
			observedAtMs: 10,
			ttlMs: 100,
		});
		expect(
			localContainerPostgresqlDockerEngineApiV0PreflightReadiness(privateMatrixRef),
		).toMatchObject({
			state: "unavailable",
			hostPlatformVerified: false,
		});
		expect(JSON.stringify(privateMatrixRef)).not.toContain("private-socket");
		expect(hostWithPrivateMatrixRef.calls).toEqual(["readVersion"]);
	});
});

function certifiedHostMatrix(
	kind: "desktop" | "linux",
): readonly DockerEngineApiV0CertifiedHostMatrixEntry[] {
	return [
		kind === "desktop"
			? {
					hostPlatform: "darwin/arm64",
					guestPlatform: "linux/arm64",
					runtimeRevision: "docker-desktop:4.27",
					engineApiRevision: "docker-api:1.44",
					engineRevision: "docker-engine:24.0.7",
					vmRuntimeRevision: "docker-desktop-vm:linuxkit:1",
					proofRefs: [
						{ kind: "attestation", id: "docker-engine-api-v0:host-matrix:desktop-arm64-v1" },
					],
				}
			: {
					hostPlatform: "linux/amd64",
					guestPlatform: "linux/amd64",
					runtimeRevision: "docker-engine:24",
					engineApiRevision: "docker-api:1.44",
					engineRevision: "docker-engine:24.0.7",
					proofRefs: [
						{ kind: "attestation", id: "docker-engine-api-v0:host-matrix:linux-amd64-v1" },
					],
				},
	];
}

function dockerHost(
	opts: {
		readonly version?: DockerEngineApiV0HostResultParameters["version"];
		readonly containment?: DockerEngineApiV0ContainmentEvidence;
		readonly networkDenial?: DockerEngineApiV0NetworkDenialEvidence;
		readonly failCall?:
			| "createProbeContainer"
			| "inspectProbeContainment"
			| "startProbeContainer"
			| "waitProbeContainer"
			| "verifyProbeNetworkDenials"
			| "verifyProbeCancellationAndSecretDestruction";
		readonly removeProbeContainer?: DockerEngineApiV0HostResult<void>;
		readonly failOnAbortedRunCleanupContext?: boolean;
	} = {},
): DockerEngineApiV0LocalContainerPostgresqlHost & {
	readonly calls: string[];
	readonly runCreateImageRefs: string[];
} {
	const calls: string[] = [];
	const runCreateImageRefs: string[] = [];
	return {
		calls,
		runCreateImageRefs,
		readVersion: () => {
			calls.push("readVersion");
			return ok(
				opts.version ?? {
					detectedBackend: "docker-engine",
					engineReachable: true,
					engineApiRevision: "docker-api:1.44",
					engineRevision: "docker-engine:24.0.7",
				},
			);
		},
		inspectImageDigest: () => {
			calls.push("inspectImageDigest");
			return ok({ imageDigestPresent: true, imageDigestVerified: true });
		},
		createProbeNetwork: () => {
			calls.push("createProbeNetwork");
			return ok({ opaqueNetworkBinding: "opaque-network-binding" });
		},
		createProbeContainer: () => {
			calls.push("createProbeContainer");
			return opts.failCall === "createProbeContainer"
				? ({ ok: false } as const)
				: ok({ opaqueProbeBinding: "opaque-probe-binding" });
		},
		inspectProbeContainment: () => {
			calls.push("inspectProbeContainment");
			return opts.failCall === "inspectProbeContainment"
				? ({ ok: false } as const)
				: ok(opts.containment ?? containmentEvidence());
		},
		startProbeContainer: () => {
			calls.push("startProbeContainer");
			return opts.failCall === "startProbeContainer" ? ({ ok: false } as const) : ok(undefined);
		},
		waitProbeContainer: () => {
			calls.push("waitProbeContainer");
			return opts.failCall === "waitProbeContainer" ? ({ ok: false } as const) : ok(undefined);
		},
		verifyProbeNetworkDenials: () => {
			calls.push("verifyProbeNetworkDenials");
			return opts.failCall === "verifyProbeNetworkDenials"
				? ({ ok: false } as const)
				: ok(opts.networkDenial ?? networkDenialEvidence());
		},
		verifyProbeCancellationAndSecretDestruction: () => {
			calls.push("verifyProbeCancellationAndSecretDestruction");
			if (opts.failCall === "verifyProbeCancellationAndSecretDestruction")
				return { ok: false } as const;
			return ok({
				cancellationVerified: true,
				cleanupVerified: true,
				artifactResolverReady: true,
				credentialResolverReady: true,
				secretDestructionVerified: true,
			});
		},
		removeProbeContainer: () => {
			calls.push("removeProbeContainer");
			return opts.removeProbeContainer ?? ok(undefined);
		},
		removeProbeNetwork: () => {
			calls.push("removeProbeNetwork");
			return ok(undefined);
		},
		createRunContainer: ({ imageRef: nextImageRef }) => {
			calls.push("createRunContainer");
			runCreateImageRefs.push(nextImageRef);
			return ok({ opaqueRunBinding: "opaque-run-binding" });
		},
		startRunContainer: () => {
			calls.push("startRunContainer");
			return ok(undefined);
		},
		waitRunContainer: () => {
			calls.push("waitRunContainer");
			return ok({
				columns: ["answer"],
				rows: [[42]],
				rowCount: 1,
				byteLength: 2,
			});
		},
		stopRunContainer: (_binding, context) => {
			calls.push("stopRunContainer");
			if (opts.failOnAbortedRunCleanupContext && context.signal.aborted) return { ok: false };
			return ok(undefined);
		},
		killRunContainer: (_binding, context) => {
			calls.push("killRunContainer");
			if (opts.failOnAbortedRunCleanupContext && context.signal.aborted) return { ok: false };
			return ok(undefined);
		},
		removeRunContainer: (_binding, context) => {
			calls.push("removeRunContainer");
			if (opts.failOnAbortedRunCleanupContext && context.signal.aborted) return { ok: false };
			return ok(undefined);
		},
	};
}

interface DockerEngineApiV0HostResultParameters {
	readonly version: {
		readonly detectedBackend: "docker-engine" | "podman" | "unknown" | "unavailable";
		readonly engineReachable: boolean;
		readonly engineApiRevision: string;
		readonly engineRevision: string;
	};
}

function containmentEvidence(): DockerEngineApiV0ContainmentEvidence {
	return {
		isolationVerified: true,
		containerUser: "65532:65532",
		noNewPrivilegesVerified: true,
		readOnlyRootFilesystemVerified: true,
		boundedFilesystemImportVerified: true,
		noEngineSocketMountVerified: true,
		noHostNetworkVerified: true,
		noHostBindMountVerified: true,
		cpuMemoryPidsTimeBoundsVerified: true,
	};
}

function networkDenialEvidence(): DockerEngineApiV0NetworkDenialEvidence {
	return {
		destinationPinnedEgressDenyVerified: true,
		metadataEgressDenyVerified: true,
		linkLocalEgressDenyVerified: true,
		loopbackEgressDenyVerified: true,
		hostGatewayEgressDenyVerified: true,
		dnsRebindingResistanceVerified: true,
	};
}

function ok<T>(value: T): DockerEngineApiV0HostResult<T> {
	return { ok: true, value };
}
