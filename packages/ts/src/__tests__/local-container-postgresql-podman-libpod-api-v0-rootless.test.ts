import { describe, expect, it, vi } from "vitest";
import {
	LOCAL_CONTAINER_POSTGRESQL_COMPATIBILITY,
	LOCAL_CONTAINER_POSTGRESQL_PODMAN_LIBPOD_API_V0_ROOTLESS_BACKEND_FAMILY,
	type LocalContainerPostgresqlManifest,
	type LocalContainerPostgresqlPodmanLibpodApiV0RootlessPreflight,
	localContainerPostgresqlManifest,
	localContainerPostgresqlPodmanLibpodApiV0RootlessPreflightReadiness,
} from "../executors/local-container-postgresql.js";
import {
	type PodmanLibpodApiV0RootlessLocalContainerPostgresqlHost,
	podmanLibpodApiV0RootlessLocalContainerPostgresqlDriver,
} from "../executors/local-container-postgresql-podman-libpod-api-v0-rootless.js";

const digest = `sha256:${"d".repeat(64)}`;
const imageRef = `registry.example.test/graphrefly/postgresql@${digest}`;
const refs = [
	{ kind: "limitation", id: "podman-libpod-api-v0-rootless-only" },
	{ kind: "limitation", id: "digest-pinned-image" },
	{ kind: "limitation", id: "host-injected-runtime-driver" },
	{ kind: "limitation", id: "non-root-no-new-privileges" },
	{ kind: "limitation", id: "read-only-bounded-filesystem" },
	{ kind: "limitation", id: "cpu-memory-pids-time-bounds" },
	{ kind: "policy", id: "deny-by-default-isolation" },
	{ kind: "policy", id: "destination-pinned-egress" },
	{ kind: "policy", id: "runtime-ephemeral-auth-material-mount" },
	{ kind: "policy", id: "remove-on-terminal-cleanup" },
	{ kind: "policy", id: "engine-api-not-mounted" },
	{ kind: "policy", id: "host-mounts-denied" },
	{ kind: "policy", id: "metadata-link-local-loopback-host-gateway-denied" },
	{ kind: "policy", id: "dns-rebinding-resistance" },
	{ kind: "readiness", id: "local-container-cleanup-removal-verified" },
	{ kind: "readiness", id: "local-container-cancellation-verified" },
	{ kind: "readiness", id: "ephemeral-auth-material-destruction-verified" },
] as const;
const attestations = [
	{ kind: "attestation", id: "podman-libpod-api-v0-rootless:readiness:test" },
	{ kind: "attestation", id: "podman-libpod-api-v0-rootless:containment:test" },
	{ kind: "attestation", id: "podman-libpod-api-v0-rootless:network:test" },
	{ kind: "attestation", id: "podman-libpod-api-v0-rootless:cancellation-cleanup:test" },
] as const;

function manifest(): LocalContainerPostgresqlManifest {
	return localContainerPostgresqlManifest({
		kind: "local-container-postgresql-manifest",
		manifestId: "manifest:pg-d645",
		revision: "revision:d645",
		fingerprint: "fingerprint:pg-d645",
		imageDigest: digest,
		engineCompatibilityRevision: LOCAL_CONTAINER_POSTGRESQL_COMPATIBILITY,
		backendFamily: LOCAL_CONTAINER_POSTGRESQL_PODMAN_LIBPOD_API_V0_ROOTLESS_BACKEND_FAMILY,
		backendCertificationRevision: "podman-certification:d645-v0",
		recipeRevision: "postgresql-read-only-query-v1",
		sandboxRevision: "sandbox:d645",
		mountPolicyRevision: "mount:d645",
		networkPolicyRevision: "network:deny:d645",
		resourcePolicyRevision: "resources:d645",
		stopGraceMs: 5,
		attestationRefs: [{ kind: "attestation", id: "manifest:d645" }],
	});
}

function preflight(
	patch: Partial<LocalContainerPostgresqlPodmanLibpodApiV0RootlessPreflight> = {},
): LocalContainerPostgresqlPodmanLibpodApiV0RootlessPreflight {
	return {
		kind: "local-container-postgresql-podman-libpod-api-v0-rootless-preflight",
		manifestFingerprint: manifest().fingerprint,
		backendCertificationRevision: manifest().backendCertificationRevision,
		observedAtMs: 1,
		expiresAtMs: 100,
		hostPlatform: "darwin/arm64",
		engineApiRevision: "libpod-api:5.0.3",
		engineRevision: "podman:5.0.3",
		runtimeRevision: "crun:1.14.4",
		guestPlatform: "linux/arm64",
		vmRuntimeRevision: "podman-machine:applehv-v1",
		engineReachable: true,
		compatibilityVerified: true,
		rootlessVerified: true,
		hostPlatformVerified: true,
		imageDigestPresent: true,
		imageDigestVerified: true,
		recipeVerified: true,
		isolationVerified: true,
		nonRootUserVerified: true,
		noNewPrivilegesVerified: true,
		readOnlyRootFilesystemVerified: true,
		boundedFilesystemImportVerified: true,
		noEngineSocketMountVerified: true,
		noHostNetworkVerified: true,
		noHostBindMountVerified: true,
		destinationPinnedEgressDenyVerified: true,
		metadataEgressDenyVerified: true,
		linkLocalEgressDenyVerified: true,
		loopbackEgressDenyVerified: true,
		hostGatewayEgressDenyVerified: true,
		dnsRebindingResistanceVerified: true,
		cpuMemoryPidsTimeBoundsVerified: true,
		cancellationVerified: true,
		cleanupVerified: true,
		artifactResolverReady: true,
		credentialResolverReady: true,
		secretDestructionVerified: true,
		limitationRefs: refs,
		attestationRefs: attestations,
		...patch,
	};
}

describe("Podman native Libpod API v0 rootless PostgreSQL contract (D645)", () => {
	it("accepts the Podman family without weakening Docker-family validation", () => {
		expect(manifest().backendFamily).toBe("podman-libpod-api-v0-rootless");
		expect(() =>
			localContainerPostgresqlManifest({
				...manifest(),
				backendFamily: "podman-docker-compat" as "podman-libpod-api-v0-rootless",
			}),
		).toThrow(/manifest contract/i);
	});

	it("requires every family-specific live proof before ready", () => {
		expect(
			localContainerPostgresqlPodmanLibpodApiV0RootlessPreflightReadiness(preflight()),
		).toMatchObject({
			state: "ready",
			backendFamily: "podman-libpod-api-v0-rootless",
			backendFamilyVerified: true,
		});
		expect(
			localContainerPostgresqlPodmanLibpodApiV0RootlessPreflightReadiness(
				preflight({ dnsRebindingResistanceVerified: false }),
			),
		).toMatchObject({ state: "unavailable", dnsRebindingResistanceVerified: false });
	});

	it("keeps runtime effects behind the focused host contract", async () => {
		const binding = Object.freeze({ private: true });
		const host: PodmanLibpodApiV0RootlessLocalContainerPostgresqlHost = {
			createRunContainer: vi.fn(async () => ({ ok: true, value: binding })),
			startRunContainer: vi.fn(async () => ({ ok: true, value: undefined })),
			waitRunContainer: vi.fn(async () => ({
				ok: true,
				value: { columns: [], rows: [], rowCount: 0 },
			})),
			stopRunContainer: vi.fn(async () => ({ ok: true, value: undefined })),
			killRunContainer: vi.fn(async () => ({ ok: true, value: undefined })),
			removeRunContainer: vi.fn(async () => ({ ok: true, value: undefined })),
		};
		const driver = podmanLibpodApiV0RootlessLocalContainerPostgresqlDriver({ host, imageRef });
		const context = {
			runId: "run:1",
			attempt: 1,
			sessionEpoch: "epoch:1",
			manifestFingerprint: manifest().fingerprint,
			signal: new AbortController().signal,
		};
		const created = await driver.create(context, {
			kind: "postgresql-query-tool-arguments",
			sourceBindingId: "source:1",
			statement: "SELECT 1",
			parameters: [],
			readOnly: true,
			maxRows: 1,
		});
		expect(created).toBe(binding);
		await driver.remove(created, context);
		expect(host.removeRunContainer).toHaveBeenCalledOnce();
	});

	it("does not expose caller matrix, socket, endpoint, or proof injection", async () => {
		const surface = await import(
			"../executors/local-container-postgresql-podman-libpod-api-v0-rootless.js"
		);
		const nodeSurface = await import(
			"../executors/local-container-postgresql-podman-libpod-api-v0-rootless/node.js"
		);
		expect(Object.keys(surface).sort()).toEqual([
			"PODMAN_LIBPOD_API_V0_ROOTLESS_BROKER_COMPATIBILITY",
			"PODMAN_LIBPOD_API_V0_ROOTLESS_CERTIFIER_COMPATIBILITY",
			"podmanLibpodApiV0RootlessLocalContainerPostgresqlDriver",
		]);
		expect(Object.keys(nodeSurface)).toEqual([
			"certifyPodmanLibpodApiV0RootlessLocalContainerPostgresqlWithNode",
		]);
	});
});
