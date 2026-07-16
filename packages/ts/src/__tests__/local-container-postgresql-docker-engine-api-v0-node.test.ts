import { EventEmitter } from "node:events";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
	LOCAL_CONTAINER_POSTGRESQL_BACKEND_FAMILY,
	LOCAL_CONTAINER_POSTGRESQL_COMPATIBILITY,
	type LocalContainerPostgresqlManifest,
	localContainerPostgresqlDockerEngineApiV0PreflightReadiness,
	localContainerPostgresqlManifest,
} from "../executors/local-container-postgresql.js";
import type {
	DockerEngineApiV0CancellationSecretEvidence,
	DockerEngineApiV0ContainmentEvidence,
	DockerEngineApiV0HostResult,
	DockerEngineApiV0NetworkDenialEvidence,
} from "../executors/local-container-postgresql-docker-engine-api-v0.js";

const digest = `sha256:${"c".repeat(64)}`;
const imageRef = `registry.example.test/graphrefly/postgresql@${digest}`;
const containerId = "a".repeat(64);
const networkId = "b".repeat(64);

interface NodeLocalDockerTestHooksModule {
	readonly certifyDockerEngineApiV0LocalContainerPostgresqlWithNodeLocalDocker: {
		readonly __graphreflyTestHooks: {
			readonly boundContainmentEvidenceToProbeRequest: (
				value: DockerEngineApiV0ContainmentEvidence,
				policy: DockerProbeContainerRequestPolicyForTest,
			) => DockerEngineApiV0ContainmentEvidence;
			readonly boundCancellationSecretEvidenceToProbeRequest: (
				value: DockerEngineApiV0CancellationSecretEvidence,
				policy: DockerProbeContainerRequestPolicyForTest,
			) => DockerEngineApiV0CancellationSecretEvidence;
			readonly boundNetworkEvidenceToProbeRequest: (
				value: DockerEngineApiV0NetworkDenialEvidence,
				policy: DockerProbeNetworkRequestPolicyForTest,
			) => DockerEngineApiV0NetworkDenialEvidence;
		};
	};
}

interface DockerProbeNetworkRequestPolicyForTest {
	readonly internalNetworkRequested: boolean;
	readonly noAttachableNetworkRequested: boolean;
	readonly noIngressNetworkRequested: boolean;
	readonly noIpv6NetworkRequested: boolean;
}

interface DockerProbeContainerRequestPolicyForTest {
	readonly nonRootUserRequested: boolean;
	readonly rootUserProbeFails: boolean;
	readonly noPrivilegedModeRequested: boolean;
	readonly noNewPrivilegesRequested: boolean;
	readonly capabilitiesDroppedRequested: boolean;
	readonly readOnlyRootFilesystemRequested: boolean;
	readonly boundedFilesystemImportRequested: boolean;
	readonly noEngineSocketMountRequested: boolean;
	readonly noHostNetworkRequested: boolean;
	readonly noHostBindMountRequested: boolean;
	readonly noPortPublicationRequested: boolean;
	readonly noEnvironmentMaterialRequested: boolean;
	readonly cpuMemoryPidsTimeBoundsRequested: boolean;
}

describe("Node-local Docker Engine API v0 certifier entry (D624)", () => {
	beforeEach(() => {
		vi.resetModules();
		vi.doUnmock("node:http");
	});

	it("uses Node-local Docker API lifecycle while keeping proof and resource handles private", async () => {
		const docker = installDockerApiMock();
		const mod = await import(
			"../executors/local-container-postgresql-docker-engine-api-v0/node.js"
		);
		const preflight = await mod.certifyDockerEngineApiV0LocalContainerPostgresqlWithNodeLocalDocker(
			{
				manifest: manifest(),
				imageRef,
				hostPlatform: "linux/amd64",
				guestPlatform: "linux/amd64",
				runtimeRevision: "docker-engine:24.0.7",
				certifiedHostMatrix: certifiedHostMatrix(),
				observedAtMs: 20,
				ttlMs: 100,
				probeLabel: "/var/run/docker.sock",
				requestTimeoutMs: Number.MAX_SAFE_INTEGER,
				maxResponseBytes: Number.MAX_SAFE_INTEGER,
				proofs: proofAdapter({
					expectedProbeJson: '{"kind":"docker-engine-api-v0-node-local-probe-container"}',
				}),
			},
		);
		expect(localContainerPostgresqlDockerEngineApiV0PreflightReadiness(preflight)).toMatchObject({
			state: "ready",
			backendFamilyVerified: true,
			imageDigestVerified: true,
			cleanupVerified: true,
		});
		expect(docker.calls.map((c) => `${c.method} ${c.path}`)).toEqual([
			"GET /version",
			`GET /images/${encodeURIComponent(imageRef)}/json`,
			"POST /networks/create",
			expect.stringMatching(/^POST \/containers\/create\?name=graphrefly-d624-/),
			`GET /containers/${containerId}/json`,
			`POST /containers/${containerId}/start`,
			`POST /containers/${containerId}/wait`,
			`GET /networks/${networkId}`,
			`GET /containers/${containerId}/json`,
			`DELETE /containers/${containerId}?force=true&v=true`,
			`DELETE /networks/${networkId}`,
		]);
		expect(JSON.stringify(preflight)).not.toContain(containerId);
		expect(JSON.stringify(preflight)).not.toContain(networkId);
		expect(JSON.stringify(preflight)).not.toContain("socketPath");
		expect(docker.calls[2]?.body).not.toContain("/var/run/docker.sock");
		const networkBody = JSON.parse(docker.calls[2]?.body ?? "{}");
		expect(networkBody).toMatchObject({
			CheckDuplicate: false,
			Internal: true,
			Attachable: false,
			Ingress: false,
			EnableIPv6: false,
		});
		const createBody = JSON.parse(
			docker.calls.find((c) => c.method === "POST" && c.path.startsWith("/containers/create"))
				?.body ?? "{}",
		);
		expect(createBody).toMatchObject({
			Image: imageRef,
			User: "65532:65532",
			Cmd: ["sh", "-ec", 'test "$(id -u)" != "0"'],
			Env: [],
			StopTimeout: 5,
			HostConfig: {
				ReadonlyRootfs: true,
				Privileged: false,
				PublishAllPorts: false,
				SecurityOpt: ["no-new-privileges"],
				CapDrop: ["ALL"],
				Memory: 128 * 1024 * 1024,
				CpuPeriod: 100_000,
				CpuQuota: 50_000,
				PidsLimit: 64,
			},
		});
		expect(createBody.HostConfig).not.toHaveProperty("PortBindings");
		expect(createBody).not.toHaveProperty("ExposedPorts");
		expect(JSON.stringify(createBody)).not.toContain("/var/run/docker.sock");
	});

	it("binds privileged and port-publication request policy into isolation evidence", async () => {
		const mod = (await import(
			"../executors/local-container-postgresql-docker-engine-api-v0/node.js"
		)) as unknown as NodeLocalDockerTestHooksModule;
		const bind =
			mod.certifyDockerEngineApiV0LocalContainerPostgresqlWithNodeLocalDocker.__graphreflyTestHooks
				.boundContainmentEvidenceToProbeRequest;
		const policy = fullContainerRequestPolicyForTest();

		expect(bind(containmentEvidence(), policy).isolationVerified).toBe(true);
		expect(bind(containmentEvidence(), policy).containerUser).toBe("999");
		expect(
			bind(containmentEvidence(), {
				...policy,
				nonRootUserRequested: false,
			}),
		).toMatchObject({
			isolationVerified: false,
			containerUser: "0",
		});
		expect(
			bind(containmentEvidence(), {
				...policy,
				rootUserProbeFails: false,
			}),
		).toMatchObject({
			isolationVerified: false,
			containerUser: "0",
		});
		expect(
			bind(containmentEvidence(), {
				...policy,
				noPrivilegedModeRequested: false,
			}).isolationVerified,
		).toBe(false);
		expect(
			bind(containmentEvidence(), {
				...policy,
				noPortPublicationRequested: false,
			}).isolationVerified,
		).toBe(false);
	});

	it("binds network request policy into every network-denial evidence field", async () => {
		const mod = (await import(
			"../executors/local-container-postgresql-docker-engine-api-v0/node.js"
		)) as unknown as NodeLocalDockerTestHooksModule;
		const bind =
			mod.certifyDockerEngineApiV0LocalContainerPostgresqlWithNodeLocalDocker.__graphreflyTestHooks
				.boundNetworkEvidenceToProbeRequest;
		const policy = fullNetworkRequestPolicyForTest();

		expect(bind(networkDenialEvidence(), policy)).toEqual(networkDenialEvidence());
		for (const [policyField, evidenceField] of [
			["internalNetworkRequested", "destinationPinnedEgressDenyVerified"],
			["noAttachableNetworkRequested", "metadataEgressDenyVerified"],
			["noIngressNetworkRequested", "linkLocalEgressDenyVerified"],
			["noIpv6NetworkRequested", "dnsRebindingResistanceVerified"],
		] as const) {
			const bounded = bind(networkDenialEvidence(), {
				...policy,
				[policyField]: false,
			});
			expect(bounded[evidenceField], policyField).toBe(false);
			expect(
				Object.values(bounded).every((value) => value === false),
				policyField,
			).toBe(true);
		}
	});

	it("binds cancellation and secret proof readiness to bounded probe request policy", async () => {
		const mod = (await import(
			"../executors/local-container-postgresql-docker-engine-api-v0/node.js"
		)) as unknown as NodeLocalDockerTestHooksModule;
		const bind =
			mod.certifyDockerEngineApiV0LocalContainerPostgresqlWithNodeLocalDocker.__graphreflyTestHooks
				.boundCancellationSecretEvidenceToProbeRequest;
		const policy = fullContainerRequestPolicyForTest();

		expect(bind(cancellationSecretEvidence(), policy)).toEqual(cancellationSecretEvidence());
		for (const [policyField, evidenceFields] of [
			["noPrivilegedModeRequested", ["cancellationVerified", "credentialResolverReady"]],
			["noNewPrivilegesRequested", ["cancellationVerified", "secretDestructionVerified"]],
			["capabilitiesDroppedRequested", ["cancellationVerified", "credentialResolverReady"]],
			["readOnlyRootFilesystemRequested", ["artifactResolverReady", "secretDestructionVerified"]],
			["noHostNetworkRequested", ["credentialResolverReady", "secretDestructionVerified"]],
			["noPortPublicationRequested", ["credentialResolverReady", "secretDestructionVerified"]],
			["noEnvironmentMaterialRequested", ["credentialResolverReady", "secretDestructionVerified"]],
		] as const) {
			const bounded = bind(cancellationSecretEvidence(), {
				...policy,
				[policyField]: false,
			});
			for (const evidenceField of evidenceFields)
				expect(bounded[evidenceField], `${policyField}:${evidenceField}`).toBe(false);
		}
	});

	it("fails closed and removes allocated network when Docker create is not accepted", async () => {
		const docker = installDockerApiMock({ createContainerStatus: 500 });
		const mod = await import(
			"../executors/local-container-postgresql-docker-engine-api-v0/node.js"
		);
		const preflight = await mod.certifyDockerEngineApiV0LocalContainerPostgresqlWithNodeLocalDocker(
			{
				manifest: manifest(),
				imageRef,
				hostPlatform: "linux/amd64",
				guestPlatform: "linux/amd64",
				runtimeRevision: "docker-engine:24.0.7",
				certifiedHostMatrix: certifiedHostMatrix(),
				observedAtMs: 20,
				ttlMs: 100,
				proofs: proofAdapter(),
			},
		);

		expect(localContainerPostgresqlDockerEngineApiV0PreflightReadiness(preflight).state).toBe(
			"unavailable",
		);
		expect(docker.calls.map((c) => `${c.method} ${c.path}`)).toEqual([
			"GET /version",
			`GET /images/${encodeURIComponent(imageRef)}/json`,
			"POST /networks/create",
			expect.stringMatching(/^POST \/containers\/create\?name=graphrefly-d624-/),
			`DELETE /networks/${networkId}`,
		]);
	});

	it("fails closed when Docker version response is not a JSON object", async () => {
		const docker = installDockerApiMock({ rawVersionBody: '"/var/run/docker.sock"' });
		const mod = await import(
			"../executors/local-container-postgresql-docker-engine-api-v0/node.js"
		);
		const preflight = await mod.certifyDockerEngineApiV0LocalContainerPostgresqlWithNodeLocalDocker(
			{
				manifest: manifest(),
				imageRef,
				hostPlatform: "linux/amd64",
				guestPlatform: "linux/amd64",
				runtimeRevision: "docker-engine:24.0.7",
				certifiedHostMatrix: certifiedHostMatrix(),
				observedAtMs: 20,
				ttlMs: 100,
				proofs: proofAdapter(),
			},
		);

		expect(localContainerPostgresqlDockerEngineApiV0PreflightReadiness(preflight)).toMatchObject({
			state: "unavailable",
			engineReachable: false,
		});
		expect(docker.calls.map((c) => `${c.method} ${c.path}`)).toEqual(["GET /version"]);
		expect(JSON.stringify(preflight)).not.toContain("docker.sock");
	});

	it("fails closed when image digest response carries private repository material", async () => {
		const docker = installDockerApiMock({
			rawImageBody: JSON.stringify({
				RepoDigests: [`registry.example.test/private-socket@${digest}`],
			}),
		});
		const mod = await import(
			"../executors/local-container-postgresql-docker-engine-api-v0/node.js"
		);
		const preflight = await mod.certifyDockerEngineApiV0LocalContainerPostgresqlWithNodeLocalDocker(
			{
				manifest: manifest(),
				imageRef,
				hostPlatform: "linux/amd64",
				guestPlatform: "linux/amd64",
				runtimeRevision: "docker-engine:24.0.7",
				certifiedHostMatrix: certifiedHostMatrix(),
				observedAtMs: 20,
				ttlMs: 100,
				proofs: proofAdapter(),
			},
		);

		expect(localContainerPostgresqlDockerEngineApiV0PreflightReadiness(preflight)).toMatchObject({
			state: "unavailable",
			imageDigestPresent: false,
			imageDigestVerified: false,
		});
		expect(docker.calls.map((c) => `${c.method} ${c.path}`)).toEqual([
			"GET /version",
			`GET /images/${encodeURIComponent(imageRef)}/json`,
		]);
		expect(JSON.stringify(preflight)).not.toContain("private-socket");
		expect(JSON.stringify(preflight)).not.toContain("registry.example.test");
	});

	it("fails closed when image digest response mixes valid digest with malformed private material", async () => {
		const docker = installDockerApiMock({
			rawImageBody: JSON.stringify({
				RepoDigests: [imageRef, { socketPath: "/var/run/docker.sock" }],
			}),
		});
		const mod = await import(
			"../executors/local-container-postgresql-docker-engine-api-v0/node.js"
		);
		const preflight = await mod.certifyDockerEngineApiV0LocalContainerPostgresqlWithNodeLocalDocker(
			{
				manifest: manifest(),
				imageRef,
				hostPlatform: "linux/amd64",
				guestPlatform: "linux/amd64",
				runtimeRevision: "docker-engine:24.0.7",
				certifiedHostMatrix: certifiedHostMatrix(),
				observedAtMs: 20,
				ttlMs: 100,
				proofs: proofAdapter(),
			},
		);

		expect(localContainerPostgresqlDockerEngineApiV0PreflightReadiness(preflight)).toMatchObject({
			state: "unavailable",
			imageDigestPresent: false,
			imageDigestVerified: false,
		});
		expect(docker.calls.map((c) => `${c.method} ${c.path}`)).toEqual([
			"GET /version",
			`GET /images/${encodeURIComponent(imageRef)}/json`,
		]);
		expect(JSON.stringify(preflight)).not.toContain("docker.sock");
		expect(JSON.stringify(preflight)).not.toContain("socketPath");
	});

	it("fails closed when Docker version coordinates contain private material", async () => {
		for (const scenario of [
			{
				name: "private engine version",
				body: { Version: "/var/run/docker.sock", ApiVersion: "1.44" },
				privateText: "docker.sock",
			},
			{
				name: "private API version",
				body: { Version: "24.0.7", ApiVersion: "private-token" },
				privateText: "private-token",
			},
		] as const) {
			vi.resetModules();
			vi.doUnmock("node:http");
			const docker = installDockerApiMock({ rawVersionBody: JSON.stringify(scenario.body) });
			const mod = await import(
				"../executors/local-container-postgresql-docker-engine-api-v0/node.js"
			);
			const preflight =
				await mod.certifyDockerEngineApiV0LocalContainerPostgresqlWithNodeLocalDocker({
					manifest: manifest(),
					imageRef,
					hostPlatform: "linux/amd64",
					guestPlatform: "linux/amd64",
					runtimeRevision: "docker-engine:24.0.7",
					certifiedHostMatrix: certifiedHostMatrix(),
					observedAtMs: 20,
					ttlMs: 100,
					proofs: proofAdapter(),
				});

			expect(
				localContainerPostgresqlDockerEngineApiV0PreflightReadiness(preflight).state,
				scenario.name,
			).toBe("unavailable");
			expect(
				docker.calls.map((c) => `${c.method} ${c.path}`),
				scenario.name,
			).toEqual(["GET /version"]);
			expect(JSON.stringify(preflight), scenario.name).not.toContain(scenario.privateText);
		}
	});

	it("does not let unrelated Docker version fields decide backend identity", async () => {
		const docker = installDockerApiMock({
			rawVersionBody: JSON.stringify({
				Version: "24.0.7",
				ApiVersion: "1.44",
				Notes: "podman socket private-token",
			}),
		});
		const mod = await import(
			"../executors/local-container-postgresql-docker-engine-api-v0/node.js"
		);
		const preflight = await mod.certifyDockerEngineApiV0LocalContainerPostgresqlWithNodeLocalDocker(
			{
				manifest: manifest(),
				imageRef,
				hostPlatform: "linux/amd64",
				guestPlatform: "linux/amd64",
				runtimeRevision: "docker-engine:24.0.7",
				certifiedHostMatrix: certifiedHostMatrix(),
				observedAtMs: 20,
				ttlMs: 100,
				proofs: proofAdapter(),
			},
		);

		expect(localContainerPostgresqlDockerEngineApiV0PreflightReadiness(preflight)).toMatchObject({
			state: "ready",
			engineReachable: true,
			backendFamilyVerified: true,
		});
		expect(JSON.stringify(preflight)).not.toContain("private-token");
		expect(docker.calls[0]).toMatchObject({ method: "GET", path: "/version" });
	});

	it("detects Podman only from bounded Docker version identity fields", async () => {
		const docker = installDockerApiMock({
			rawVersionBody: JSON.stringify({
				Version: "4.9.0",
				ApiVersion: "1.41",
				Components: [{ Name: "Podman Engine" }],
			}),
		});
		const mod = await import(
			"../executors/local-container-postgresql-docker-engine-api-v0/node.js"
		);
		const preflight = await mod.certifyDockerEngineApiV0LocalContainerPostgresqlWithNodeLocalDocker(
			{
				manifest: manifest(),
				imageRef,
				hostPlatform: "linux/amd64",
				guestPlatform: "linux/amd64",
				runtimeRevision: "docker-engine:24.0.7",
				certifiedHostMatrix: certifiedHostMatrix(),
				observedAtMs: 20,
				ttlMs: 100,
				proofs: proofAdapter(),
			},
		);

		expect(localContainerPostgresqlDockerEngineApiV0PreflightReadiness(preflight)).toMatchObject({
			state: "unavailable",
			engineReachable: false,
			backendFamilyVerified: false,
		});
		expect(docker.calls.map((c) => `${c.method} ${c.path}`)).toEqual(["GET /version"]);
	});

	it("fails closed when Docker version response exceeds the byte budget", async () => {
		const docker = installDockerApiMock({
			rawVersionBody: JSON.stringify({
				Version: "24.0.7",
				ApiVersion: "1.44",
				padding: "x".repeat(64),
			}),
		});
		const mod = await import(
			"../executors/local-container-postgresql-docker-engine-api-v0/node.js"
		);
		const preflight = await mod.certifyDockerEngineApiV0LocalContainerPostgresqlWithNodeLocalDocker(
			{
				manifest: manifest(),
				imageRef,
				hostPlatform: "linux/amd64",
				guestPlatform: "linux/amd64",
				runtimeRevision: "docker-engine:24.0.7",
				certifiedHostMatrix: certifiedHostMatrix(),
				observedAtMs: 20,
				ttlMs: 100,
				maxResponseBytes: 16,
				proofs: proofAdapter(),
			},
		);

		expect(localContainerPostgresqlDockerEngineApiV0PreflightReadiness(preflight)).toMatchObject({
			state: "unavailable",
			engineReachable: false,
		});
		expect(docker.calls.map((c) => `${c.method} ${c.path}`)).toEqual(["GET /version"]);
		expect(JSON.stringify(preflight)).not.toContain("padding");
	});

	it("fails closed without a Docker request when the signal is already aborted", async () => {
		const docker = installDockerApiMock();
		const controller = new AbortController();
		controller.abort();
		const mod = await import(
			"../executors/local-container-postgresql-docker-engine-api-v0/node.js"
		);
		const preflight = await mod.certifyDockerEngineApiV0LocalContainerPostgresqlWithNodeLocalDocker(
			{
				manifest: manifest(),
				imageRef,
				hostPlatform: "linux/amd64",
				guestPlatform: "linux/amd64",
				runtimeRevision: "docker-engine:24.0.7",
				certifiedHostMatrix: certifiedHostMatrix(),
				observedAtMs: 20,
				ttlMs: 100,
				signal: controller.signal,
				proofs: proofAdapter(),
			},
		);

		expect(localContainerPostgresqlDockerEngineApiV0PreflightReadiness(preflight)).toMatchObject({
			state: "unavailable",
			engineReachable: false,
		});
		expect(docker.calls).toEqual([]);
	});

	it("fails closed when the Docker version request times out", async () => {
		const docker = installDockerApiMock({ hangPath: "/version" });
		const mod = await import(
			"../executors/local-container-postgresql-docker-engine-api-v0/node.js"
		);
		const preflight = await mod.certifyDockerEngineApiV0LocalContainerPostgresqlWithNodeLocalDocker(
			{
				manifest: manifest(),
				imageRef,
				hostPlatform: "linux/amd64",
				guestPlatform: "linux/amd64",
				runtimeRevision: "docker-engine:24.0.7",
				certifiedHostMatrix: certifiedHostMatrix(),
				observedAtMs: 20,
				ttlMs: 100,
				requestTimeoutMs: 1,
				proofs: proofAdapter(),
			},
		);

		expect(localContainerPostgresqlDockerEngineApiV0PreflightReadiness(preflight)).toMatchObject({
			state: "unavailable",
			engineReachable: false,
		});
		expect(docker.calls.map((c) => `${c.method} ${c.path}`)).toEqual(["GET /version"]);
	});

	it("fails closed and removes allocated network when Docker create returns non-object JSON", async () => {
		const docker = installDockerApiMock({ rawCreateContainerBody: '"/var/run/docker.sock"' });
		const mod = await import(
			"../executors/local-container-postgresql-docker-engine-api-v0/node.js"
		);
		const preflight = await mod.certifyDockerEngineApiV0LocalContainerPostgresqlWithNodeLocalDocker(
			{
				manifest: manifest(),
				imageRef,
				hostPlatform: "linux/amd64",
				guestPlatform: "linux/amd64",
				runtimeRevision: "docker-engine:24.0.7",
				certifiedHostMatrix: certifiedHostMatrix(),
				observedAtMs: 20,
				ttlMs: 100,
				proofs: proofAdapter(),
			},
		);

		expect(localContainerPostgresqlDockerEngineApiV0PreflightReadiness(preflight)).toMatchObject({
			state: "unavailable",
			cleanupVerified: true,
		});
		expect(docker.calls.map((c) => `${c.method} ${c.path}`)).toEqual([
			"GET /version",
			`GET /images/${encodeURIComponent(imageRef)}/json`,
			"POST /networks/create",
			expect.stringMatching(/^POST \/containers\/create\?name=graphrefly-d624-/),
			`DELETE /networks/${networkId}`,
		]);
		expect(JSON.stringify(preflight)).not.toContain("docker.sock");
	});

	it("fails closed and removes an allocated network when Docker network create returns warnings", async () => {
		const docker = installDockerApiMock({
			rawCreateNetworkBody: JSON.stringify({
				Id: networkId,
				Warnings: ["private-token ignored network option"],
				socketPath: "/var/run/docker.sock",
			}),
		});
		const mod = await import(
			"../executors/local-container-postgresql-docker-engine-api-v0/node.js"
		);
		const preflight = await mod.certifyDockerEngineApiV0LocalContainerPostgresqlWithNodeLocalDocker(
			{
				manifest: manifest(),
				imageRef,
				hostPlatform: "linux/amd64",
				guestPlatform: "linux/amd64",
				runtimeRevision: "docker-engine:24.0.7",
				certifiedHostMatrix: certifiedHostMatrix(),
				observedAtMs: 20,
				ttlMs: 100,
				proofs: proofAdapter(),
			},
		);

		expect(localContainerPostgresqlDockerEngineApiV0PreflightReadiness(preflight)).toMatchObject({
			state: "unavailable",
			cleanupVerified: true,
		});
		expect(docker.calls.map((c) => `${c.method} ${c.path}`)).toEqual([
			"GET /version",
			`GET /images/${encodeURIComponent(imageRef)}/json`,
			"POST /networks/create",
			`DELETE /networks/${networkId}`,
		]);
		expect(JSON.stringify(preflight)).not.toContain("private-token");
		expect(JSON.stringify(preflight)).not.toContain("docker.sock");
	});

	it("fails closed when Docker network create returns extra fields despite empty warnings", async () => {
		const docker = installDockerApiMock({
			rawCreateNetworkBody: JSON.stringify({
				Id: networkId,
				Warnings: [],
				socketPath: "/var/run/docker.sock",
			}),
		});
		const mod = await import(
			"../executors/local-container-postgresql-docker-engine-api-v0/node.js"
		);
		const preflight = await mod.certifyDockerEngineApiV0LocalContainerPostgresqlWithNodeLocalDocker(
			{
				manifest: manifest(),
				imageRef,
				hostPlatform: "linux/amd64",
				guestPlatform: "linux/amd64",
				runtimeRevision: "docker-engine:24.0.7",
				certifiedHostMatrix: certifiedHostMatrix(),
				observedAtMs: 20,
				ttlMs: 100,
				proofs: proofAdapter(),
			},
		);

		expect(localContainerPostgresqlDockerEngineApiV0PreflightReadiness(preflight)).toMatchObject({
			state: "unavailable",
			cleanupVerified: true,
		});
		expect(docker.calls.map((c) => `${c.method} ${c.path}`)).toEqual([
			"GET /version",
			`GET /images/${encodeURIComponent(imageRef)}/json`,
			"POST /networks/create",
			`DELETE /networks/${networkId}`,
		]);
		expect(JSON.stringify(preflight)).not.toContain("socketPath");
		expect(JSON.stringify(preflight)).not.toContain("docker.sock");
	});

	it("fails closed and removes allocated resources when Docker container create returns warnings", async () => {
		const docker = installDockerApiMock({
			rawCreateContainerBody: JSON.stringify({
				Id: containerId,
				Warnings: ["private-token ignored container option"],
				socketPath: "/var/run/docker.sock",
			}),
		});
		const mod = await import(
			"../executors/local-container-postgresql-docker-engine-api-v0/node.js"
		);
		const preflight = await mod.certifyDockerEngineApiV0LocalContainerPostgresqlWithNodeLocalDocker(
			{
				manifest: manifest(),
				imageRef,
				hostPlatform: "linux/amd64",
				guestPlatform: "linux/amd64",
				runtimeRevision: "docker-engine:24.0.7",
				certifiedHostMatrix: certifiedHostMatrix(),
				observedAtMs: 20,
				ttlMs: 100,
				proofs: proofAdapter(),
			},
		);

		expect(localContainerPostgresqlDockerEngineApiV0PreflightReadiness(preflight)).toMatchObject({
			state: "unavailable",
			cleanupVerified: true,
		});
		expect(docker.calls.map((c) => `${c.method} ${c.path}`)).toEqual([
			"GET /version",
			`GET /images/${encodeURIComponent(imageRef)}/json`,
			"POST /networks/create",
			expect.stringMatching(/^POST \/containers\/create\?name=graphrefly-d624-/),
			`DELETE /containers/${containerId}?force=true&v=true`,
			`DELETE /networks/${networkId}`,
		]);
		expect(JSON.stringify(preflight)).not.toContain("private-token");
		expect(JSON.stringify(preflight)).not.toContain("docker.sock");
	});

	it("fails closed and removes allocated resources when Docker container create warnings are malformed", async () => {
		const docker = installDockerApiMock({
			rawCreateContainerBody: JSON.stringify({
				Id: containerId,
				Warnings: "private-token",
			}),
		});
		const mod = await import(
			"../executors/local-container-postgresql-docker-engine-api-v0/node.js"
		);
		const preflight = await mod.certifyDockerEngineApiV0LocalContainerPostgresqlWithNodeLocalDocker(
			{
				manifest: manifest(),
				imageRef,
				hostPlatform: "linux/amd64",
				guestPlatform: "linux/amd64",
				runtimeRevision: "docker-engine:24.0.7",
				certifiedHostMatrix: certifiedHostMatrix(),
				observedAtMs: 20,
				ttlMs: 100,
				proofs: proofAdapter(),
			},
		);

		expect(localContainerPostgresqlDockerEngineApiV0PreflightReadiness(preflight)).toMatchObject({
			state: "unavailable",
			cleanupVerified: true,
		});
		expect(docker.calls.map((c) => `${c.method} ${c.path}`)).toEqual([
			"GET /version",
			`GET /images/${encodeURIComponent(imageRef)}/json`,
			"POST /networks/create",
			expect.stringMatching(/^POST \/containers\/create\?name=graphrefly-d624-/),
			`DELETE /containers/${containerId}?force=true&v=true`,
			`DELETE /networks/${networkId}`,
		]);
		expect(JSON.stringify(preflight)).not.toContain("private-token");
	});

	it("cleans allocated probe resources when Docker wait response exceeds the byte budget", async () => {
		const docker = installDockerApiMock({
			rawWaitBody: JSON.stringify({ StatusCode: 0, padding: "x".repeat(4096) }),
		});
		const mod = await import(
			"../executors/local-container-postgresql-docker-engine-api-v0/node.js"
		);
		const preflight = await mod.certifyDockerEngineApiV0LocalContainerPostgresqlWithNodeLocalDocker(
			{
				manifest: manifest(),
				imageRef,
				hostPlatform: "linux/amd64",
				guestPlatform: "linux/amd64",
				runtimeRevision: "docker-engine:24.0.7",
				certifiedHostMatrix: certifiedHostMatrix(),
				observedAtMs: 20,
				ttlMs: 100,
				maxResponseBytes: 1024,
				proofs: proofAdapter(),
			},
		);

		expect(localContainerPostgresqlDockerEngineApiV0PreflightReadiness(preflight)).toMatchObject({
			state: "unavailable",
			cleanupVerified: true,
		});
		expect(docker.calls.map((c) => `${c.method} ${c.path}`)).toEqual(
			expect.arrayContaining([
				`POST /containers/${containerId}/wait`,
				`DELETE /containers/${containerId}?force=true&v=true`,
				`DELETE /networks/${networkId}`,
			]),
		);
		expect(JSON.stringify(preflight)).not.toContain("padding");
	});

	it("fails closed when Docker inspect cannot corroborate containment policy", async () => {
		const docker = installDockerApiMock({
			rawInspectContainerBody: JSON.stringify({
				Name: "/__GRAPHREFLY_PROBE_CONTAINER_NAME__",
				Config: {
					User: "65532:65532",
					OpenStdin: false,
					Labels: {
						"dev.graphrefly.boundary": "d624-docker-engine-api-v0-certifier",
					},
					Tty: false,
					Volumes: null,
				},
				HostConfig: {
					NetworkMode: "host",
					Privileged: true,
					ReadonlyRootfs: false,
					SecurityOpt: [],
					CapDrop: [],
					AutoRemove: false,
					PublishAllPorts: true,
					Memory: 128 * 1024 * 1024,
					CpuPeriod: 100_000,
					CpuQuota: 50_000,
					PidsLimit: 64,
					Binds: ["/var/run/docker.sock:/var/run/docker.sock"],
				},
				Mounts: [{ Source: "/var/run/docker.sock", Destination: "/var/run/docker.sock" }],
			}),
		});
		const mod = await import(
			"../executors/local-container-postgresql-docker-engine-api-v0/node.js"
		);
		const preflight = await mod.certifyDockerEngineApiV0LocalContainerPostgresqlWithNodeLocalDocker(
			{
				manifest: manifest(),
				imageRef,
				hostPlatform: "linux/amd64",
				guestPlatform: "linux/amd64",
				runtimeRevision: "docker-engine:24.0.7",
				certifiedHostMatrix: certifiedHostMatrix(),
				observedAtMs: 20,
				ttlMs: 100,
				proofs: proofAdapter(),
			},
		);

		expect(localContainerPostgresqlDockerEngineApiV0PreflightReadiness(preflight)).toMatchObject({
			state: "unavailable",
			isolationVerified: false,
			cleanupVerified: true,
		});
		expect(docker.calls.map((c) => `${c.method} ${c.path}`)).toEqual(
			expect.arrayContaining([
				`GET /containers/${containerId}/json`,
				`DELETE /containers/${containerId}?force=true&v=true`,
				`DELETE /networks/${networkId}`,
			]),
		);
		expect(docker.calls.map((c) => `${c.method} ${c.path}`)).not.toContain(
			`POST /containers/${containerId}/start`,
		);
		expect(JSON.stringify(preflight)).not.toContain("docker.sock");
		expect(JSON.stringify(preflight)).not.toContain("Mounts");
	});

	it("fails closed when Docker inspect cannot corroborate the private probe container identity", async () => {
		const inspected = safeInspectContainerBody(
			"__GRAPHREFLY_PROBE_NETWORK_NAME__",
			"__GRAPHREFLY_PROBE_CONTAINER_NAME__",
		);
		const inspectedConfig = inspected.Config as Record<string, unknown>;
		const docker = installDockerApiMock({
			rawInspectContainerBody: JSON.stringify({
				...inspected,
				Name: "/graphrefly-d624-unrelated",
				Config: {
					...inspectedConfig,
					Labels: {
						"dev.graphrefly.boundary": "unexpected-boundary",
					},
				},
			}),
		});
		const mod = await import(
			"../executors/local-container-postgresql-docker-engine-api-v0/node.js"
		);
		const preflight = await mod.certifyDockerEngineApiV0LocalContainerPostgresqlWithNodeLocalDocker(
			{
				manifest: manifest(),
				imageRef,
				hostPlatform: "linux/amd64",
				guestPlatform: "linux/amd64",
				runtimeRevision: "docker-engine:24.0.7",
				certifiedHostMatrix: certifiedHostMatrix(),
				observedAtMs: 20,
				ttlMs: 100,
				proofs: proofAdapter(),
			},
		);

		expect(localContainerPostgresqlDockerEngineApiV0PreflightReadiness(preflight)).toMatchObject({
			state: "unavailable",
			isolationVerified: false,
			cleanupVerified: true,
		});
		expect(docker.calls.map((c) => `${c.method} ${c.path}`)).toEqual(
			expect.arrayContaining([
				`GET /containers/${containerId}/json`,
				`DELETE /containers/${containerId}?force=true&v=true`,
				`DELETE /networks/${networkId}`,
			]),
		);
		expect(docker.calls.map((c) => `${c.method} ${c.path}`)).not.toContain(
			`POST /containers/${containerId}/start`,
		);
		expect(JSON.stringify(preflight)).not.toContain("graphrefly-d624-unrelated");
		expect(JSON.stringify(preflight)).not.toContain("unexpected-boundary");
	});

	it("fails closed when Docker inspect body does not match the private probe container id", async () => {
		const docker = installDockerApiMock({
			rawInspectContainerBody: JSON.stringify({
				...safeInspectContainerBody(
					"__GRAPHREFLY_PROBE_NETWORK_NAME__",
					"__GRAPHREFLY_PROBE_CONTAINER_NAME__",
				),
				Id: "d".repeat(64),
			}),
		});
		const mod = await import(
			"../executors/local-container-postgresql-docker-engine-api-v0/node.js"
		);
		const preflight = await mod.certifyDockerEngineApiV0LocalContainerPostgresqlWithNodeLocalDocker(
			{
				manifest: manifest(),
				imageRef,
				hostPlatform: "linux/amd64",
				guestPlatform: "linux/amd64",
				runtimeRevision: "docker-engine:24.0.7",
				certifiedHostMatrix: certifiedHostMatrix(),
				observedAtMs: 20,
				ttlMs: 100,
				proofs: proofAdapter(),
			},
		);

		expect(localContainerPostgresqlDockerEngineApiV0PreflightReadiness(preflight)).toMatchObject({
			state: "unavailable",
			isolationVerified: false,
			cleanupVerified: true,
		});
		expect(docker.calls.map((c) => `${c.method} ${c.path}`)).toEqual(
			expect.arrayContaining([
				`GET /containers/${containerId}/json`,
				`DELETE /containers/${containerId}?force=true&v=true`,
				`DELETE /networks/${networkId}`,
			]),
		);
		expect(docker.calls.map((c) => `${c.method} ${c.path}`)).not.toContain(
			`POST /containers/${containerId}/start`,
		);
		expect(JSON.stringify(preflight)).not.toContain("d".repeat(64));
		expect(JSON.stringify(preflight)).not.toContain(containerId);
	});

	it("fails closed when Docker wait response carries private material", async () => {
		const docker = installDockerApiMock({
			rawWaitBody: JSON.stringify({
				StatusCode: 0,
				socketPath: "/var/run/docker.sock",
				probeContainerId: containerId,
			}),
		});
		const mod = await import(
			"../executors/local-container-postgresql-docker-engine-api-v0/node.js"
		);
		const preflight = await mod.certifyDockerEngineApiV0LocalContainerPostgresqlWithNodeLocalDocker(
			{
				manifest: manifest(),
				imageRef,
				hostPlatform: "linux/amd64",
				guestPlatform: "linux/amd64",
				runtimeRevision: "docker-engine:24.0.7",
				certifiedHostMatrix: certifiedHostMatrix(),
				observedAtMs: 20,
				ttlMs: 100,
				proofs: proofAdapter(),
			},
		);

		expect(localContainerPostgresqlDockerEngineApiV0PreflightReadiness(preflight)).toMatchObject({
			state: "unavailable",
			cleanupVerified: true,
			destinationPinnedEgressDenyVerified: false,
			credentialResolverReady: false,
		});
		expect(docker.calls.map((c) => `${c.method} ${c.path}`)).toEqual(
			expect.arrayContaining([
				`POST /containers/${containerId}/wait`,
				`DELETE /containers/${containerId}?force=true&v=true`,
				`DELETE /networks/${networkId}`,
			]),
		);
		expect(JSON.stringify(preflight)).not.toContain("docker.sock");
		expect(JSON.stringify(preflight)).not.toContain("probeContainerId");
		expect(JSON.stringify(preflight)).not.toContain(containerId);
	});

	it("fails closed when Docker network inspect cannot corroborate deny-by-default policy", async () => {
		const docker = installDockerApiMock({
			rawInspectNetworkBody: JSON.stringify({
				Name: "__GRAPHREFLY_PROBE_NETWORK_NAME__",
				Internal: false,
				Attachable: true,
				Ingress: true,
				EnableIPv6: true,
				Labels: {
					"dev.graphrefly.boundary": "d624-docker-engine-api-v0-certifier",
				},
				Containers: {
					[containerId]: {
						Name: "private-probe-container",
					},
				},
			}),
		});
		const mod = await import(
			"../executors/local-container-postgresql-docker-engine-api-v0/node.js"
		);
		const preflight = await mod.certifyDockerEngineApiV0LocalContainerPostgresqlWithNodeLocalDocker(
			{
				manifest: manifest(),
				imageRef,
				hostPlatform: "linux/amd64",
				guestPlatform: "linux/amd64",
				runtimeRevision: "docker-engine:24.0.7",
				certifiedHostMatrix: certifiedHostMatrix(),
				observedAtMs: 20,
				ttlMs: 100,
				proofs: proofAdapter(),
			},
		);

		expect(localContainerPostgresqlDockerEngineApiV0PreflightReadiness(preflight)).toMatchObject({
			state: "unavailable",
			destinationPinnedEgressDenyVerified: false,
			metadataEgressDenyVerified: false,
			dnsRebindingResistanceVerified: false,
			cleanupVerified: true,
		});
		expect(docker.calls.map((c) => `${c.method} ${c.path}`)).toEqual(
			expect.arrayContaining([
				`GET /networks/${networkId}`,
				`DELETE /containers/${containerId}?force=true&v=true`,
				`DELETE /networks/${networkId}`,
			]),
		);
		expect(JSON.stringify(preflight)).not.toContain(containerId);
		expect(JSON.stringify(preflight)).not.toContain("private-probe-container");
		expect(JSON.stringify(preflight)).not.toContain("Containers");
	});

	it("fails closed when Docker network inspect id does not match the private probe network", async () => {
		const unrelatedNetworkId = "d".repeat(64);
		const docker = installDockerApiMock({
			rawInspectNetworkBody: JSON.stringify({
				Id: unrelatedNetworkId,
				Name: "__GRAPHREFLY_PROBE_NETWORK_NAME__",
				Internal: true,
				Attachable: false,
				Ingress: false,
				EnableIPv6: false,
				Labels: {
					"dev.graphrefly.boundary": "d624-docker-engine-api-v0-certifier",
				},
			}),
		});
		const mod = await import(
			"../executors/local-container-postgresql-docker-engine-api-v0/node.js"
		);
		const preflight = await mod.certifyDockerEngineApiV0LocalContainerPostgresqlWithNodeLocalDocker(
			{
				manifest: manifest(),
				imageRef,
				hostPlatform: "linux/amd64",
				guestPlatform: "linux/amd64",
				runtimeRevision: "docker-engine:24.0.7",
				certifiedHostMatrix: certifiedHostMatrix(),
				observedAtMs: 20,
				ttlMs: 100,
				proofs: proofAdapter(),
			},
		);

		expect(localContainerPostgresqlDockerEngineApiV0PreflightReadiness(preflight)).toMatchObject({
			state: "unavailable",
			destinationPinnedEgressDenyVerified: false,
			metadataEgressDenyVerified: false,
			dnsRebindingResistanceVerified: false,
			cleanupVerified: true,
		});
		expect(docker.calls.map((c) => `${c.method} ${c.path}`)).toEqual(
			expect.arrayContaining([
				`GET /networks/${networkId}`,
				`DELETE /containers/${containerId}?force=true&v=true`,
				`DELETE /networks/${networkId}`,
			]),
		);
		expect(JSON.stringify(preflight)).not.toContain(unrelatedNetworkId);
		expect(JSON.stringify(preflight)).not.toContain(networkId);
	});

	it("fails closed when Docker post-wait inspect carries private credential material", async () => {
		const docker = installDockerApiMock({
			rawPostWaitInspectContainerBody: JSON.stringify({
				...safeInspectContainerBody("__GRAPHREFLY_PROBE_NETWORK_NAME__"),
				Config: {
					User: "65532:65532",
					OpenStdin: false,
					Volumes: null,
					Env: ["GRAPHREFLY_PASSWORD=private-token"],
				},
			}),
		});
		const mod = await import(
			"../executors/local-container-postgresql-docker-engine-api-v0/node.js"
		);
		const preflight = await mod.certifyDockerEngineApiV0LocalContainerPostgresqlWithNodeLocalDocker(
			{
				manifest: manifest(),
				imageRef,
				hostPlatform: "linux/amd64",
				guestPlatform: "linux/amd64",
				runtimeRevision: "docker-engine:24.0.7",
				certifiedHostMatrix: certifiedHostMatrix(),
				observedAtMs: 20,
				ttlMs: 100,
				proofs: proofAdapter(),
			},
		);

		expect(localContainerPostgresqlDockerEngineApiV0PreflightReadiness(preflight)).toMatchObject({
			state: "unavailable",
			credentialResolverReady: false,
			secretDestructionVerified: false,
			cleanupVerified: true,
		});
		expect(docker.calls.map((c) => `${c.method} ${c.path}`)).toEqual(
			expect.arrayContaining([
				`GET /networks/${networkId}`,
				`GET /containers/${containerId}/json`,
				`DELETE /containers/${containerId}?force=true&v=true`,
				`DELETE /networks/${networkId}`,
			]),
		);
		expect(
			docker.calls.filter((c) => `${c.method} ${c.path}` === `GET /containers/${containerId}/json`),
		).toHaveLength(2);
		expect(JSON.stringify(preflight)).not.toContain("GRAPHREFLY_PASSWORD");
		expect(JSON.stringify(preflight)).not.toContain("private-token");
	});

	it("cleans allocated probe resources when Docker wait request times out", async () => {
		const docker = installDockerApiMock({ hangPath: `/containers/${containerId}/wait` });
		const mod = await import(
			"../executors/local-container-postgresql-docker-engine-api-v0/node.js"
		);
		const preflight = await mod.certifyDockerEngineApiV0LocalContainerPostgresqlWithNodeLocalDocker(
			{
				manifest: manifest(),
				imageRef,
				hostPlatform: "linux/amd64",
				guestPlatform: "linux/amd64",
				runtimeRevision: "docker-engine:24.0.7",
				certifiedHostMatrix: certifiedHostMatrix(),
				observedAtMs: 20,
				ttlMs: 100,
				requestTimeoutMs: 1,
				proofs: proofAdapter(),
			},
		);

		expect(localContainerPostgresqlDockerEngineApiV0PreflightReadiness(preflight)).toMatchObject({
			state: "unavailable",
			cleanupVerified: true,
		});
		expect(docker.calls.map((c) => `${c.method} ${c.path}`)).toEqual(
			expect.arrayContaining([
				`POST /containers/${containerId}/wait`,
				`DELETE /containers/${containerId}?force=true&v=true`,
				`DELETE /networks/${networkId}`,
			]),
		);
	});

	it("cleans allocated probe resources when the signal aborts during Docker wait", async () => {
		const controller = new AbortController();
		const docker = installDockerApiMock({
			abortPath: `POST /containers/${containerId}/wait`,
			abortController: controller,
		});
		const mod = await import(
			"../executors/local-container-postgresql-docker-engine-api-v0/node.js"
		);
		const preflight = await mod.certifyDockerEngineApiV0LocalContainerPostgresqlWithNodeLocalDocker(
			{
				manifest: manifest(),
				imageRef,
				hostPlatform: "linux/amd64",
				guestPlatform: "linux/amd64",
				runtimeRevision: "docker-engine:24.0.7",
				certifiedHostMatrix: certifiedHostMatrix(),
				observedAtMs: 20,
				ttlMs: 100,
				signal: controller.signal,
				proofs: proofAdapter(),
			},
		);

		expect(localContainerPostgresqlDockerEngineApiV0PreflightReadiness(preflight)).toMatchObject({
			state: "unavailable",
			cleanupVerified: true,
		});
		expect(docker.calls.map((c) => `${c.method} ${c.path}`)).toEqual(
			expect.arrayContaining([
				`POST /containers/${containerId}/wait`,
				`DELETE /containers/${containerId}?force=true&v=true`,
				`DELETE /networks/${networkId}`,
			]),
		);
		const cleanupCalls = docker.calls.filter((c) => c.method === "DELETE");
		expect(cleanupCalls.map((c) => c.hasSignal)).toEqual([false, false]);
	});

	it("fails closed without substituting invalid cleanup targets when Docker returns unsafe IDs", async () => {
		const docker = installDockerApiMock({ containerId: "../private-container-id" });
		const mod = await import(
			"../executors/local-container-postgresql-docker-engine-api-v0/node.js"
		);
		const preflight = await mod.certifyDockerEngineApiV0LocalContainerPostgresqlWithNodeLocalDocker(
			{
				manifest: manifest(),
				imageRef,
				hostPlatform: "linux/amd64",
				guestPlatform: "linux/amd64",
				runtimeRevision: "docker-engine:24.0.7",
				certifiedHostMatrix: certifiedHostMatrix(),
				observedAtMs: 20,
				ttlMs: 100,
				proofs: proofAdapter(),
			},
		);

		expect(localContainerPostgresqlDockerEngineApiV0PreflightReadiness(preflight).state).toBe(
			"unavailable",
		);
		expect(docker.calls.map((c) => `${c.method} ${c.path}`).join("\n")).not.toContain("/invalid");
		expect(docker.calls.map((c) => `${c.method} ${c.path}`)).toEqual(
			expect.arrayContaining([
				"GET /version",
				`GET /images/${encodeURIComponent(imageRef)}/json`,
				"POST /networks/create",
				expect.stringMatching(/^POST \/containers\/create\?name=graphrefly-d624-/),
				expect.stringMatching(/^DELETE \/containers\/graphrefly-d624-/),
				`DELETE /networks/${networkId}`,
			]),
		);
	});

	it("marks cleanup unverifiable when unsafe resource IDs require generated-name cleanup that fails", async () => {
		for (const scenario of [
			{
				name: "unsafe container id cleanup fails",
				docker: {
					containerId: "../private-container-id",
					deleteGeneratedContainerStatus: 500,
				},
				expectedCleanup: /^DELETE \/containers\/graphrefly-d624-/,
			},
			{
				name: "unsafe network id cleanup fails",
				docker: {
					networkId: "../private-network-id",
					deleteGeneratedNetworkStatus: 500,
				},
				expectedCleanup: /^DELETE \/networks\/graphrefly-d624-/,
			},
		] as const) {
			vi.resetModules();
			const docker = installDockerApiMock(scenario.docker);
			const mod = await import(
				"../executors/local-container-postgresql-docker-engine-api-v0/node.js"
			);
			const preflight =
				await mod.certifyDockerEngineApiV0LocalContainerPostgresqlWithNodeLocalDocker({
					manifest: manifest(),
					imageRef,
					hostPlatform: "linux/amd64",
					guestPlatform: "linux/amd64",
					runtimeRevision: "docker-engine:24.0.7",
					certifiedHostMatrix: certifiedHostMatrix(),
					observedAtMs: 20,
					ttlMs: 100,
					proofs: proofAdapter(),
				});

			const readiness = localContainerPostgresqlDockerEngineApiV0PreflightReadiness(preflight);
			expect(readiness.state, scenario.name).toBe("unavailable");
			expect(readiness.cleanupVerified, scenario.name).toBe(false);
			expect(docker.calls.map((c) => `${c.method} ${c.path}`)).toEqual(
				expect.arrayContaining([expect.stringMatching(scenario.expectedCleanup)]),
			);
		}
	});

	it("fails closed when containment proof does not corroborate the private probe request policy", async () => {
		const docker = installDockerApiMock();
		const mod = await import(
			"../executors/local-container-postgresql-docker-engine-api-v0/node.js"
		);
		const preflight = await mod.certifyDockerEngineApiV0LocalContainerPostgresqlWithNodeLocalDocker(
			{
				manifest: manifest(),
				imageRef,
				hostPlatform: "linux/amd64",
				guestPlatform: "linux/amd64",
				runtimeRevision: "docker-engine:24.0.7",
				certifiedHostMatrix: certifiedHostMatrix(),
				observedAtMs: 20,
				ttlMs: 100,
				proofs: proofAdapter({
					containment: {
						noNewPrivilegesVerified: false,
					},
				}),
			},
		);

		expect(localContainerPostgresqlDockerEngineApiV0PreflightReadiness(preflight)).toMatchObject({
			state: "unavailable",
			noNewPrivilegesVerified: false,
			cleanupVerified: true,
		});
		expect(docker.calls.map((c) => `${c.method} ${c.path}`)).toEqual(
			expect.arrayContaining([
				`DELETE /containers/${containerId}?force=true&v=true`,
				`DELETE /networks/${networkId}`,
			]),
		);
		expect(JSON.stringify(preflight)).not.toContain("requestPolicy");
	});

	it("fails closed when network proof does not corroborate the private probe network policy", async () => {
		const docker = installDockerApiMock();
		const mod = await import(
			"../executors/local-container-postgresql-docker-engine-api-v0/node.js"
		);
		const preflight = await mod.certifyDockerEngineApiV0LocalContainerPostgresqlWithNodeLocalDocker(
			{
				manifest: manifest(),
				imageRef,
				hostPlatform: "linux/amd64",
				guestPlatform: "linux/amd64",
				runtimeRevision: "docker-engine:24.0.7",
				certifiedHostMatrix: certifiedHostMatrix(),
				observedAtMs: 20,
				ttlMs: 100,
				proofs: proofAdapter({
					network: {
						destinationPinnedEgressDenyVerified: false,
					},
				}),
			},
		);

		expect(localContainerPostgresqlDockerEngineApiV0PreflightReadiness(preflight)).toMatchObject({
			state: "unavailable",
			destinationPinnedEgressDenyVerified: false,
			cleanupVerified: true,
		});
		expect(docker.calls.map((c) => `${c.method} ${c.path}`)).toEqual(
			expect.arrayContaining([
				`DELETE /containers/${containerId}?force=true&v=true`,
				`DELETE /networks/${networkId}`,
			]),
		);
		expect(JSON.stringify(preflight)).not.toContain("requestPolicy");
	});

	it("fails closed when containment proof carries private fields", async () => {
		const docker = installDockerApiMock();
		const mod = await import(
			"../executors/local-container-postgresql-docker-engine-api-v0/node.js"
		);
		const preflight = await mod.certifyDockerEngineApiV0LocalContainerPostgresqlWithNodeLocalDocker(
			{
				manifest: manifest(),
				imageRef,
				hostPlatform: "linux/amd64",
				guestPlatform: "linux/amd64",
				runtimeRevision: "docker-engine:24.0.7",
				certifiedHostMatrix: certifiedHostMatrix(),
				observedAtMs: 20,
				ttlMs: 100,
				proofs: proofAdapter({
					containment: {
						socketPath: "/var/run/docker.sock",
						requestPolicy: "private-policy",
					},
				}),
			},
		);

		expect(localContainerPostgresqlDockerEngineApiV0PreflightReadiness(preflight)).toMatchObject({
			state: "unavailable",
			isolationVerified: false,
		});
		expect(JSON.stringify(preflight)).not.toContain("docker.sock");
		expect(JSON.stringify(preflight)).not.toContain("requestPolicy");
		expect(docker.calls.map((c) => `${c.method} ${c.path}`)).toEqual(
			expect.arrayContaining([
				`DELETE /containers/${containerId}?force=true&v=true`,
				`DELETE /networks/${networkId}`,
			]),
		);
	});

	it("fails closed when network proof carries private fields", async () => {
		const docker = installDockerApiMock();
		const mod = await import(
			"../executors/local-container-postgresql-docker-engine-api-v0/node.js"
		);
		const preflight = await mod.certifyDockerEngineApiV0LocalContainerPostgresqlWithNodeLocalDocker(
			{
				manifest: manifest(),
				imageRef,
				hostPlatform: "linux/amd64",
				guestPlatform: "linux/amd64",
				runtimeRevision: "docker-engine:24.0.7",
				certifiedHostMatrix: certifiedHostMatrix(),
				observedAtMs: 20,
				ttlMs: 100,
				proofs: proofAdapter({
					network: {
						containerId,
						socketPath: "/var/run/docker.sock",
					},
				}),
			},
		);

		expect(localContainerPostgresqlDockerEngineApiV0PreflightReadiness(preflight)).toMatchObject({
			state: "unavailable",
			destinationPinnedEgressDenyVerified: false,
		});
		expect(JSON.stringify(preflight)).not.toContain("docker.sock");
		expect(JSON.stringify(preflight)).not.toContain(containerId);
		expect(docker.calls.map((c) => `${c.method} ${c.path}`)).toEqual(
			expect.arrayContaining([
				`DELETE /containers/${containerId}?force=true&v=true`,
				`DELETE /networks/${networkId}`,
			]),
		);
	});

	it("fails closed when proof-adapter cancellation material carries private fields", async () => {
		const docker = installDockerApiMock();
		const mod = await import(
			"../executors/local-container-postgresql-docker-engine-api-v0/node.js"
		);
		const preflight = await mod.certifyDockerEngineApiV0LocalContainerPostgresqlWithNodeLocalDocker(
			{
				manifest: manifest(),
				imageRef,
				hostPlatform: "linux/amd64",
				guestPlatform: "linux/amd64",
				runtimeRevision: "docker-engine:24.0.7",
				certifiedHostMatrix: certifiedHostMatrix(),
				observedAtMs: 20,
				ttlMs: 100,
				proofs: proofAdapter({
					cancellation: {
						socketPath: "/var/run/docker.sock",
						privateCleanupHandle: "private-cleanup-handle",
					},
				}),
			},
		);

		const readiness = localContainerPostgresqlDockerEngineApiV0PreflightReadiness(preflight);
		expect(readiness).toMatchObject({
			state: "unavailable",
			cancellationVerified: false,
			secretDestructionVerified: false,
		});
		expect(JSON.stringify(preflight)).not.toContain("docker.sock");
		expect(JSON.stringify(preflight)).not.toContain("private-cleanup-handle");
		expect(JSON.stringify(preflight)).not.toContain("socketPath");
		expect(docker.calls.map((c) => `${c.method} ${c.path}`)).toEqual(
			expect.arrayContaining([
				`DELETE /containers/${containerId}?force=true&v=true`,
				`DELETE /networks/${networkId}`,
			]),
		);
	});

	it("fails closed when Docker inspect cannot corroborate cancellation and secret posture", async () => {
		const docker = installDockerApiMock({
			rawPostWaitInspectContainerBody: JSON.stringify({
				Config: {
					User: "65532:65532",
					OpenStdin: false,
					Env: ["PGPASSWORD=private-token"],
					Volumes: null,
				},
				HostConfig: {
					NetworkMode: "__GRAPHREFLY_PROBE_NETWORK_NAME__",
					Privileged: false,
					ReadonlyRootfs: true,
					SecurityOpt: ["no-new-privileges"],
					CapDrop: ["ALL"],
					AutoRemove: false,
					Binds: [],
					Memory: 128 * 1024 * 1024,
					CpuPeriod: 100_000,
					CpuQuota: 50_000,
					PidsLimit: 64,
				},
				Mounts: [],
				State: {
					Running: true,
					ExitCode: 0,
				},
			}),
		});
		const mod = await import(
			"../executors/local-container-postgresql-docker-engine-api-v0/node.js"
		);
		const preflight = await mod.certifyDockerEngineApiV0LocalContainerPostgresqlWithNodeLocalDocker(
			{
				manifest: manifest(),
				imageRef,
				hostPlatform: "linux/amd64",
				guestPlatform: "linux/amd64",
				runtimeRevision: "docker-engine:24.0.7",
				certifiedHostMatrix: certifiedHostMatrix(),
				observedAtMs: 20,
				ttlMs: 100,
				proofs: proofAdapter(),
			},
		);

		const readiness = localContainerPostgresqlDockerEngineApiV0PreflightReadiness(preflight);
		expect(readiness).toMatchObject({
			state: "unavailable",
			cancellationVerified: false,
			credentialResolverReady: false,
			secretDestructionVerified: false,
			cleanupVerified: true,
		});
		expect(docker.calls.map((c) => `${c.method} ${c.path}`)).toEqual(
			expect.arrayContaining([
				`POST /containers/${containerId}/wait`,
				`GET /containers/${containerId}/json`,
				`DELETE /containers/${containerId}?force=true&v=true`,
				`DELETE /networks/${networkId}`,
			]),
		);
		expect(JSON.stringify(preflight)).not.toContain("PGPASSWORD");
		expect(JSON.stringify(preflight)).not.toContain("private-token");
		expect(JSON.stringify(preflight)).not.toContain("Env");
	});

	it("fails closed when Docker post-wait inspect body does not match the private probe container id", async () => {
		const docker = installDockerApiMock({
			rawPostWaitInspectContainerBody: JSON.stringify({
				...safeInspectContainerBody(
					"__GRAPHREFLY_PROBE_NETWORK_NAME__",
					"__GRAPHREFLY_PROBE_CONTAINER_NAME__",
				),
				Id: "d".repeat(64),
			}),
		});
		const mod = await import(
			"../executors/local-container-postgresql-docker-engine-api-v0/node.js"
		);
		const preflight = await mod.certifyDockerEngineApiV0LocalContainerPostgresqlWithNodeLocalDocker(
			{
				manifest: manifest(),
				imageRef,
				hostPlatform: "linux/amd64",
				guestPlatform: "linux/amd64",
				runtimeRevision: "docker-engine:24.0.7",
				certifiedHostMatrix: certifiedHostMatrix(),
				observedAtMs: 20,
				ttlMs: 100,
				proofs: proofAdapter(),
			},
		);

		expect(localContainerPostgresqlDockerEngineApiV0PreflightReadiness(preflight)).toMatchObject({
			state: "unavailable",
			cancellationVerified: false,
			credentialResolverReady: false,
			secretDestructionVerified: false,
			cleanupVerified: true,
		});
		expect(
			docker.calls.filter((c) => `${c.method} ${c.path}` === `GET /containers/${containerId}/json`),
		).toHaveLength(2);
		expect(docker.calls.map((c) => `${c.method} ${c.path}`)).toEqual(
			expect.arrayContaining([
				`POST /containers/${containerId}/wait`,
				`GET /containers/${containerId}/json`,
				`DELETE /containers/${containerId}?force=true&v=true`,
				`DELETE /networks/${networkId}`,
			]),
		);
		expect(JSON.stringify(preflight)).not.toContain("d".repeat(64));
		expect(JSON.stringify(preflight)).not.toContain(containerId);
	});

	it("fails closed when cancellation and secret proof is not ready for the private probe request", async () => {
		const docker = installDockerApiMock();
		const mod = await import(
			"../executors/local-container-postgresql-docker-engine-api-v0/node.js"
		);
		const preflight = await mod.certifyDockerEngineApiV0LocalContainerPostgresqlWithNodeLocalDocker(
			{
				manifest: manifest(),
				imageRef,
				hostPlatform: "linux/amd64",
				guestPlatform: "linux/amd64",
				runtimeRevision: "docker-engine:24.0.7",
				certifiedHostMatrix: certifiedHostMatrix(),
				observedAtMs: 20,
				ttlMs: 100,
				proofs: proofAdapter({
					cancellation: {
						credentialResolverReady: false,
						secretDestructionVerified: false,
					},
				}),
			},
		);

		expect(localContainerPostgresqlDockerEngineApiV0PreflightReadiness(preflight)).toMatchObject({
			state: "unavailable",
			credentialResolverReady: false,
			secretDestructionVerified: false,
			cleanupVerified: true,
		});
		expect(docker.calls.map((c) => `${c.method} ${c.path}`)).toEqual(
			expect.arrayContaining([
				`DELETE /containers/${containerId}?force=true&v=true`,
				`DELETE /networks/${networkId}`,
			]),
		);
		expect(JSON.stringify(preflight)).not.toContain("requestPolicy");
		expect(JSON.stringify(preflight)).not.toContain(containerId);
		expect(JSON.stringify(preflight)).not.toContain(networkId);
	});

	it("cleans container and network after post-create Docker or proof failures", async () => {
		for (const scenario of [
			{
				name: "start failure",
				docker: { startStatus: 500 },
				proofs: proofAdapter(),
				expectCleanupFalse: false,
			},
			{
				name: "wait nonzero",
				docker: { waitStatusCode: 7 },
				proofs: proofAdapter(),
				expectCleanupFalse: false,
			},
			{
				name: "proof failure",
				docker: {},
				proofs: proofAdapter({ fail: true }),
				expectCleanupFalse: false,
			},
			{
				name: "delete failure",
				docker: { deleteContainerStatus: 500 },
				proofs: proofAdapter(),
				expectCleanupFalse: true,
			},
		] as const) {
			vi.resetModules();
			const docker = installDockerApiMock(scenario.docker);
			const mod = await import(
				"../executors/local-container-postgresql-docker-engine-api-v0/node.js"
			);
			const preflight =
				await mod.certifyDockerEngineApiV0LocalContainerPostgresqlWithNodeLocalDocker({
					manifest: manifest(),
					imageRef,
					hostPlatform: "linux/amd64",
					guestPlatform: "linux/amd64",
					runtimeRevision: "docker-engine:24.0.7",
					certifiedHostMatrix: certifiedHostMatrix(),
					observedAtMs: 20,
					ttlMs: 100,
					proofs: scenario.proofs,
				});

			const readiness = localContainerPostgresqlDockerEngineApiV0PreflightReadiness(preflight);
			expect(readiness.state, scenario.name).toBe("unavailable");
			if (scenario.expectCleanupFalse) expect(readiness.cleanupVerified).toBe(false);
			expect(docker.calls.map((c) => `${c.method} ${c.path}`)).toContain(
				`DELETE /containers/${containerId}?force=true&v=true`,
			);
			expect(docker.calls.map((c) => `${c.method} ${c.path}`)).toContain(
				`DELETE /networks/${networkId}`,
			);
		}
	});

	it("fails closed when Docker accepted-status responses carry raw body material", async () => {
		for (const scenario of [
			{
				name: "start accepted body",
				docker: { startBody: "private-start-body" },
				expectCleanupFalse: false,
			},
			{
				name: "delete accepted body",
				docker: { deleteContainerBody: "private-delete-body" },
				expectCleanupFalse: true,
			},
		] as const) {
			vi.resetModules();
			const docker = installDockerApiMock(scenario.docker);
			const mod = await import(
				"../executors/local-container-postgresql-docker-engine-api-v0/node.js"
			);
			const preflight =
				await mod.certifyDockerEngineApiV0LocalContainerPostgresqlWithNodeLocalDocker({
					manifest: manifest(),
					imageRef,
					hostPlatform: "linux/amd64",
					guestPlatform: "linux/amd64",
					runtimeRevision: "docker-engine:24.0.7",
					certifiedHostMatrix: certifiedHostMatrix(),
					observedAtMs: 20,
					ttlMs: 100,
					proofs: proofAdapter(),
				});

			const readiness = localContainerPostgresqlDockerEngineApiV0PreflightReadiness(preflight);
			expect(readiness.state, scenario.name).toBe("unavailable");
			if (scenario.expectCleanupFalse) expect(readiness.cleanupVerified).toBe(false);
			expect(docker.calls.map((c) => `${c.method} ${c.path}`)).toContain(
				`DELETE /containers/${containerId}?force=true&v=true`,
			);
			expect(JSON.stringify(preflight)).not.toContain("private-start-body");
			expect(JSON.stringify(preflight)).not.toContain("private-delete-body");
		}
	});

	it("fails closed at the certified host-matrix gate before creating Docker probe resources", async () => {
		const docker = installDockerApiMock();
		const mod = await import(
			"../executors/local-container-postgresql-docker-engine-api-v0/node.js"
		);
		const preflight = await mod.certifyDockerEngineApiV0LocalContainerPostgresqlWithNodeLocalDocker(
			{
				manifest: manifest(),
				imageRef,
				hostPlatform: "linux/amd64",
				guestPlatform: "linux/amd64",
				runtimeRevision: "docker-engine:24.0.7",
				certifiedHostMatrix: [],
				observedAtMs: 20,
				ttlMs: 100,
				proofs: proofAdapter(),
			},
		);

		expect(localContainerPostgresqlDockerEngineApiV0PreflightReadiness(preflight)).toMatchObject({
			state: "unavailable",
			hostPlatformVerified: false,
		});
		expect(docker.calls.map((c) => `${c.method} ${c.path}`)).toEqual(["GET /version"]);
	});
});

function installDockerApiMock(
	opts: {
		readonly createContainerStatus?: number;
		readonly containerId?: string;
		readonly networkId?: string;
		readonly rawVersionBody?: string;
		readonly rawImageBody?: string;
		readonly rawCreateNetworkBody?: string;
		readonly rawCreateContainerBody?: string;
		readonly rawInspectContainerBody?: string;
		readonly rawPostWaitInspectContainerBody?: string;
		readonly rawInspectNetworkBody?: string;
		readonly rawWaitBody?: string;
		readonly hangPath?: string;
		readonly abortPath?: string;
		readonly abortController?: AbortController;
		readonly startStatus?: number;
		readonly startBody?: string;
		readonly waitStatusCode?: number;
		readonly deleteContainerStatus?: number;
		readonly deleteContainerBody?: string;
		readonly deleteGeneratedContainerStatus?: number;
		readonly deleteGeneratedContainerBody?: string;
		readonly deleteGeneratedNetworkStatus?: number;
		readonly deleteGeneratedNetworkBody?: string;
	} = {},
): {
	readonly calls: Array<{
		readonly method: string;
		readonly path: string;
		readonly socketPath?: string;
		readonly hasSignal: boolean;
		readonly body: string;
	}>;
} {
	const calls: Array<{
		method: string;
		path: string;
		socketPath?: string;
		hasSignal: boolean;
		body: string;
	}> = [];
	let probeNetworkName = "graphrefly-d624-mock-network";
	let probeContainerName = "graphrefly-d624-mock-container";
	let containerInspectReads = 0;
	vi.doMock("node:http", () => ({
		request(
			requestOptions: {
				readonly method?: string;
				readonly path?: string;
				readonly socketPath?: string;
				readonly signal?: AbortSignal;
			},
			callback: (res: EventEmitter & { statusCode?: number }) => void,
		) {
			let body = "";
			const req = new EventEmitter() as EventEmitter & {
				write(chunk: string): void;
				end(): void;
				destroy(): void;
			};
			req.write = (chunk: string) => {
				body += chunk;
			};
			req.destroy = () => {};
			req.end = () => {
				const method = requestOptions.method ?? "GET";
				const path = requestOptions.path ?? "/";
				calls.push({
					method,
					path,
					socketPath: requestOptions.socketPath,
					hasSignal: requestOptions.signal !== undefined,
					body,
				});
				if (method === "POST" && path === "/networks/create") {
					const parsed = JSON.parse(body) as { readonly Name?: unknown };
					if (typeof parsed.Name === "string") probeNetworkName = parsed.Name;
				}
				if (method === "POST" && path.startsWith("/containers/create?name=")) {
					const [, rawName] = path.match(/^\/containers\/create\?name=([^&]+)$/) ?? [];
					if (rawName !== undefined) probeContainerName = decodeURIComponent(rawName);
				}
				if (opts.abortPath === `${method} ${path}`) {
					opts.abortController?.abort();
					req.emit("error", new Error("aborted"));
					return;
				}
				if (opts.hangPath === path) return;
				const containerInspectRead =
					method === "GET" && path === `/containers/${containerId}/json`
						? ++containerInspectReads
						: containerInspectReads;
				const response = route(
					method,
					path,
					opts,
					probeNetworkName,
					probeContainerName,
					containerInspectRead,
				);
				const res = new EventEmitter() as EventEmitter & { statusCode?: number };
				res.statusCode = response.status;
				callback(res);
				if (response.body !== "") res.emit("data", response.body);
				res.emit("end");
			};
			return req;
		},
	}));
	return { calls };
}

function route(
	method: string,
	path: string,
	opts: {
		readonly createContainerStatus?: number;
		readonly containerId?: string;
		readonly networkId?: string;
		readonly rawVersionBody?: string;
		readonly rawImageBody?: string;
		readonly rawCreateNetworkBody?: string;
		readonly rawCreateContainerBody?: string;
		readonly rawInspectContainerBody?: string;
		readonly rawPostWaitInspectContainerBody?: string;
		readonly rawInspectNetworkBody?: string;
		readonly rawWaitBody?: string;
		readonly hangPath?: string;
		readonly abortPath?: string;
		readonly abortController?: AbortController;
		readonly startStatus?: number;
		readonly startBody?: string;
		readonly waitStatusCode?: number;
		readonly deleteContainerStatus?: number;
		readonly deleteContainerBody?: string;
		readonly deleteGeneratedContainerStatus?: number;
		readonly deleteGeneratedContainerBody?: string;
		readonly deleteGeneratedNetworkStatus?: number;
		readonly deleteGeneratedNetworkBody?: string;
	},
	probeNetworkName: string,
	probeContainerName: string,
	containerInspectRead: number,
): { readonly status: number; readonly body: string } {
	if (method === "GET" && path === "/version" && opts.rawVersionBody !== undefined)
		return { status: 200, body: opts.rawVersionBody };
	if (method === "GET" && path === "/version")
		return json(200, { Version: "24.0.7", ApiVersion: "1.44" });
	if (
		method === "GET" &&
		path === `/images/${encodeURIComponent(imageRef)}/json` &&
		opts.rawImageBody !== undefined
	)
		return { status: 200, body: opts.rawImageBody };
	if (method === "GET" && path === `/images/${encodeURIComponent(imageRef)}/json`)
		return json(200, { RepoDigests: [imageRef] });
	if (method === "POST" && path === "/networks/create" && opts.rawCreateNetworkBody !== undefined)
		return { status: 201, body: opts.rawCreateNetworkBody };
	if (method === "POST" && path === "/networks/create")
		return json(201, { Id: opts.networkId ?? networkId });
	if (
		method === "POST" &&
		path.startsWith("/containers/create?name=") &&
		opts.rawCreateContainerBody !== undefined
	)
		return { status: 201, body: opts.rawCreateContainerBody };
	if (method === "POST" && path.startsWith("/containers/create?name="))
		return (opts.createContainerStatus ?? 201) === 201
			? json(201, { Id: opts.containerId ?? containerId, Warnings: [] })
			: json(opts.createContainerStatus ?? 500, { message: "failed" });
	if (
		method === "GET" &&
		path === `/containers/${containerId}/json` &&
		containerInspectRead >= 2 &&
		opts.rawPostWaitInspectContainerBody !== undefined
	)
		return {
			status: 200,
			body: inspectContainerBody(
				opts.rawPostWaitInspectContainerBody,
				probeNetworkName,
				probeContainerName,
			),
		};
	if (
		method === "GET" &&
		path === `/containers/${containerId}/json` &&
		opts.rawInspectContainerBody !== undefined
	)
		return {
			status: 200,
			body: inspectContainerBody(
				opts.rawInspectContainerBody,
				probeNetworkName,
				probeContainerName,
			),
		};
	if (method === "GET" && path === `/containers/${containerId}/json`)
		return json(200, safeInspectContainerBody(probeNetworkName, probeContainerName));
	if (
		method === "GET" &&
		path === `/networks/${networkId}` &&
		opts.rawInspectNetworkBody !== undefined
	)
		return { status: 200, body: inspectNetworkBody(opts.rawInspectNetworkBody, probeNetworkName) };
	if (method === "GET" && path.startsWith("/networks/") && opts.rawInspectNetworkBody !== undefined)
		return { status: 200, body: inspectNetworkBody(opts.rawInspectNetworkBody, probeNetworkName) };
	if (method === "GET" && path === `/networks/${networkId}`)
		return json(200, safeInspectNetworkBody(probeNetworkName));
	if (method === "GET" && path.startsWith("/networks/graphrefly-d624-"))
		return json(200, safeInspectNetworkBody(probeNetworkName));
	if (method === "POST" && path === `/containers/${containerId}/start`)
		return { status: opts.startStatus ?? 204, body: opts.startBody ?? "" };
	if (
		method === "POST" &&
		path === `/containers/${containerId}/wait` &&
		opts.rawWaitBody !== undefined
	)
		return { status: 200, body: opts.rawWaitBody };
	if (method === "POST" && path === `/containers/${containerId}/wait`)
		return json(200, { StatusCode: opts.waitStatusCode ?? 0 });
	if (method === "DELETE" && path === `/containers/${containerId}?force=true&v=true`)
		return { status: opts.deleteContainerStatus ?? 204, body: opts.deleteContainerBody ?? "" };
	if (method === "DELETE" && path.startsWith("/containers/graphrefly-d624-"))
		return {
			status: opts.deleteGeneratedContainerStatus ?? 204,
			body: opts.deleteGeneratedContainerBody ?? "",
		};
	if (method === "DELETE" && path === `/networks/${networkId}`) return { status: 204, body: "" };
	if (method === "DELETE" && path.startsWith("/networks/graphrefly-d624-"))
		return {
			status: opts.deleteGeneratedNetworkStatus ?? 204,
			body: opts.deleteGeneratedNetworkBody ?? "",
		};
	return json(404, { message: "not-found" });
}

function json(
	status: number,
	body: Record<string, unknown>,
): { readonly status: number; readonly body: string } {
	return { status, body: JSON.stringify(body) };
}

function safeInspectContainerBody(
	networkName: string,
	containerName = "__GRAPHREFLY_PROBE_CONTAINER_NAME__",
): Record<string, unknown> {
	return {
		Id: containerId,
		Name: `/${containerName}`,
		Config: {
			User: "65532:65532",
			OpenStdin: false,
			Env: ["PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin"],
			Labels: {
				"dev.graphrefly.boundary": "d624-docker-engine-api-v0-certifier",
			},
			Volumes: null,
		},
		HostConfig: {
			NetworkMode: networkName,
			Privileged: false,
			ReadonlyRootfs: true,
			SecurityOpt: ["no-new-privileges"],
			CapDrop: ["ALL"],
			AutoRemove: false,
			Binds: [],
			Memory: 128 * 1024 * 1024,
			CpuPeriod: 100_000,
			CpuQuota: 50_000,
			PidsLimit: 64,
		},
		Mounts: [],
		State: {
			Running: false,
			ExitCode: 0,
		},
	};
}

function safeInspectNetworkBody(networkName: string): Record<string, unknown> {
	return {
		Id: networkId,
		Name: networkName,
		Internal: true,
		Attachable: false,
		Ingress: false,
		EnableIPv6: false,
		Labels: {
			"dev.graphrefly.boundary": "d624-docker-engine-api-v0-certifier",
		},
	};
}

function inspectNetworkBody(body: string, networkName: string): string {
	return body.replaceAll("__GRAPHREFLY_PROBE_NETWORK_NAME__", networkName);
}

function inspectContainerBody(body: string, networkName: string, containerName: string): string {
	return body
		.replaceAll("__GRAPHREFLY_PROBE_NETWORK_NAME__", networkName)
		.replaceAll("__GRAPHREFLY_PROBE_CONTAINER_NAME__", containerName);
}

function proofAdapter(
	opts: {
		readonly expectedProbeJson?: string;
		readonly fail?: boolean;
		readonly containment?: Partial<DockerEngineApiV0ContainmentEvidence> & Record<string, unknown>;
		readonly network?: Partial<DockerEngineApiV0NetworkDenialEvidence> & Record<string, unknown>;
		readonly cancellation?: Partial<DockerEngineApiV0CancellationSecretEvidence> &
			Record<string, unknown>;
	} = {},
) {
	return {
		inspectProbeContainment: (probe: unknown) =>
			acceptProbe(probe, opts)
				? ok(containmentEvidence(opts.containment))
				: ({ ok: false } as const),
		verifyProbeNetworkDenials: (probe: unknown) =>
			acceptProbe(probe, opts) ? ok(networkDenialEvidence(opts.network)) : ({ ok: false } as const),
		verifyProbeCancellationAndSecretDestruction: (probe: unknown) =>
			acceptProbe(probe, opts)
				? ok(cancellationSecretEvidence(opts.cancellation))
				: ({ ok: false } as const),
	};
}

function acceptProbe(
	probe: unknown,
	opts: { readonly expectedProbeJson?: string; readonly fail?: boolean },
): boolean {
	if (opts.fail) return false;
	const visible = JSON.stringify(probe);
	if (opts.expectedProbeJson !== undefined) expect(visible).toBe(opts.expectedProbeJson);
	expect(visible).not.toContain(containerId);
	expect(visible).not.toContain(networkId);
	return visible === '{"kind":"docker-engine-api-v0-node-local-probe-container"}';
}

function containmentEvidence(
	patch: Partial<DockerEngineApiV0ContainmentEvidence> & Record<string, unknown> = {},
): DockerEngineApiV0ContainmentEvidence {
	return {
		isolationVerified: true,
		containerUser: "999",
		noNewPrivilegesVerified: true,
		readOnlyRootFilesystemVerified: true,
		boundedFilesystemImportVerified: true,
		noEngineSocketMountVerified: true,
		noHostNetworkVerified: true,
		noHostBindMountVerified: true,
		cpuMemoryPidsTimeBoundsVerified: true,
		...patch,
	} as DockerEngineApiV0ContainmentEvidence;
}

function fullNetworkRequestPolicyForTest(): DockerProbeNetworkRequestPolicyForTest {
	return {
		internalNetworkRequested: true,
		noAttachableNetworkRequested: true,
		noIngressNetworkRequested: true,
		noIpv6NetworkRequested: true,
	};
}

function fullContainerRequestPolicyForTest(): DockerProbeContainerRequestPolicyForTest {
	return {
		nonRootUserRequested: true,
		rootUserProbeFails: true,
		noPrivilegedModeRequested: true,
		noNewPrivilegesRequested: true,
		capabilitiesDroppedRequested: true,
		readOnlyRootFilesystemRequested: true,
		boundedFilesystemImportRequested: true,
		noEngineSocketMountRequested: true,
		noHostNetworkRequested: true,
		noHostBindMountRequested: true,
		noPortPublicationRequested: true,
		noEnvironmentMaterialRequested: true,
		cpuMemoryPidsTimeBoundsRequested: true,
	};
}

function networkDenialEvidence(
	patch: Partial<DockerEngineApiV0NetworkDenialEvidence> & Record<string, unknown> = {},
): DockerEngineApiV0NetworkDenialEvidence {
	return {
		destinationPinnedEgressDenyVerified: true,
		metadataEgressDenyVerified: true,
		linkLocalEgressDenyVerified: true,
		loopbackEgressDenyVerified: true,
		hostGatewayEgressDenyVerified: true,
		dnsRebindingResistanceVerified: true,
		...patch,
	} as DockerEngineApiV0NetworkDenialEvidence;
}

function cancellationSecretEvidence(
	patch: Partial<DockerEngineApiV0CancellationSecretEvidence> & Record<string, unknown> = {},
): DockerEngineApiV0CancellationSecretEvidence {
	return {
		cancellationVerified: true,
		cleanupVerified: true,
		artifactResolverReady: true,
		credentialResolverReady: true,
		secretDestructionVerified: true,
		...patch,
	} as DockerEngineApiV0CancellationSecretEvidence;
}

function manifest(): LocalContainerPostgresqlManifest {
	return localContainerPostgresqlManifest({
		kind: "local-container-postgresql-manifest",
		manifestId: "manifest:pg-d624-node",
		revision: "revision:d624-node",
		fingerprint: "fingerprint:pg-d624-node",
		imageDigest: digest,
		engineCompatibilityRevision: LOCAL_CONTAINER_POSTGRESQL_COMPATIBILITY,
		backendFamily: LOCAL_CONTAINER_POSTGRESQL_BACKEND_FAMILY,
		backendCertificationRevision: "docker-certification:d624-node-v0",
		recipeRevision: "postgresql-read-only-query-v1",
		sandboxRevision: "sandbox:d624-node",
		mountPolicyRevision: "mount:d624-node",
		networkPolicyRevision: "network:deny:d624-node",
		resourcePolicyRevision: "resources:d624-node",
		stopGraceMs: 5,
		attestationRefs: [{ kind: "attestation", id: "manifest:d624-node" }],
	});
}

function certifiedHostMatrix() {
	return [
		{
			hostPlatform: "linux/amd64",
			guestPlatform: "linux/amd64",
			runtimeRevision: "docker-engine:24.0.7",
			engineApiRevision: "docker-api:1.44",
			engineRevision: "docker-engine:24.0.7",
			proofRefs: [
				{ kind: "attestation", id: "docker-engine-api-v0:host-matrix:node-linux-amd64-v1" },
			],
		},
	] as const;
}

function ok<T>(value: T): DockerEngineApiV0HostResult<T> {
	return { ok: true, value };
}
