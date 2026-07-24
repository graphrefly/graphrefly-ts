import { describe, expect, it } from "vitest";
import {
	LOCAL_CONTAINER_POSTGRESQL_COMPATIBILITY,
	LOCAL_CONTAINER_POSTGRESQL_PODMAN_LIBPOD_API_V0_ROOTLESS_BACKEND_FAMILY,
	localContainerPostgresqlManifest,
	localContainerPostgresqlPodmanLibpodApiV0RootlessPreflightReadiness,
} from "../executors/local-container-postgresql.js";
import { certifyPodmanLibpodApiV0RootlessLocalContainerPostgresqlWithNode } from "../executors/local-container-postgresql-podman-libpod-api-v0-rootless/node.js";

const live = process.env.GRAPHREFLY_D645_LIVE_PODMAN === "1";
const digest = "sha256:d13105efe29040feb046f1c5fc9f0a98e58d8980c85300306a325c80df9a45c4";
const imageRef = `docker.io/library/postgres@${digest}`;

function manifest(backendCertificationRevision = "podman-certification:d645-v0") {
	return localContainerPostgresqlManifest({
		kind: "local-container-postgresql-manifest",
		manifestId: "manifest:pg-d645-live",
		revision: "revision:d645-live",
		fingerprint: "fingerprint:pg-d645-live",
		imageDigest: digest,
		engineCompatibilityRevision: LOCAL_CONTAINER_POSTGRESQL_COMPATIBILITY,
		backendFamily: LOCAL_CONTAINER_POSTGRESQL_PODMAN_LIBPOD_API_V0_ROOTLESS_BACKEND_FAMILY,
		backendCertificationRevision,
		recipeRevision: "postgresql-read-only-query-v1",
		sandboxRevision: "sandbox:d645-live",
		mountPolicyRevision: "mount:d645-live",
		networkPolicyRevision: "network:deny:d645-live",
		resourcePolicyRevision: "resources:d645-live",
		stopGraceMs: 5,
		attestationRefs: [{ kind: "attestation", id: "manifest:d645-live" }],
	});
}

describe("Node-local Podman Libpod API v0 rootless certifier package policy", () => {
	it("rejects caller-selected certification revisions before host effects", async () => {
		await expect(
			certifyPodmanLibpodApiV0RootlessLocalContainerPostgresqlWithNode({
				manifest: manifest("podman-certification:caller-selected"),
				imageRef,
			}),
		).rejects.toThrow("package-owned certification revision");
	});

	it("does not expose caller-selected observation time or freshness", () => {
		const callerObservedAt = () =>
			certifyPodmanLibpodApiV0RootlessLocalContainerPostgresqlWithNode({
				manifest: manifest(),
				imageRef,
				// @ts-expect-error D645 observation time is package-owned.
				observedAtMs: 1,
			});
		const callerTtl = () =>
			certifyPodmanLibpodApiV0RootlessLocalContainerPostgresqlWithNode({
				manifest: manifest(),
				imageRef,
				// @ts-expect-error D645 freshness is package-owned.
				ttlMs: 1,
			});
		expect([callerObservedAt, callerTtl]).toHaveLength(2);
	});
});

describe.runIf(live)("Node-local Podman Libpod API v0 rootless certifier (D645 live)", () => {
	it("certifies the exact host only after every containment, network, secret, cancellation, and cleanup proof", async () => {
		const preflight = await certifyPodmanLibpodApiV0RootlessLocalContainerPostgresqlWithNode({
			manifest: manifest(),
			imageRef,
		});
		const readiness =
			localContainerPostgresqlPodmanLibpodApiV0RootlessPreflightReadiness(preflight);

		expect(readiness).toMatchObject({
			state: "ready",
			backendFamily: "podman-libpod-api-v0-rootless",
			engineReachable: true,
			backendFamilyVerified: true,
			compatibilityVerified: true,
			imageDigestVerified: true,
			isolationVerified: true,
			nonRootUserVerified: true,
			noNewPrivilegesVerified: true,
			readOnlyRootFilesystemVerified: true,
			noEngineSocketMountVerified: true,
			noHostNetworkVerified: true,
			noHostBindMountVerified: true,
			cpuMemoryPidsTimeBoundsVerified: true,
			secretDestructionVerified: true,
			cleanupVerified: true,
			destinationPinnedEgressDenyVerified: true,
			metadataEgressDenyVerified: true,
			linkLocalEgressDenyVerified: true,
			loopbackEgressDenyVerified: true,
			hostGatewayEgressDenyVerified: true,
			dnsRebindingResistanceVerified: true,
			cancellationVerified: true,
		});
		expect(JSON.stringify(preflight)).not.toContain("podman-machine-default-api.sock");
		expect(JSON.stringify(preflight)).not.toContain("d645-canary-value");
		expect(JSON.stringify(preflight)).not.toContain("/var/folders/");
		expect(JSON.stringify(preflight)).not.toContain("podman-machine-default");
	}, 30_000);
});
