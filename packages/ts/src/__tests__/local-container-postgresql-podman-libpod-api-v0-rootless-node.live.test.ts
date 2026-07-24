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

describe.runIf(live)("Node-local Podman Libpod API v0 rootless candidate (D645 live)", () => {
	it("proves containment, secret destruction, and both cancellation paths without claiming full readiness", async () => {
		const manifest = localContainerPostgresqlManifest({
			kind: "local-container-postgresql-manifest",
			manifestId: "manifest:pg-d645-live",
			revision: "revision:d645-live",
			fingerprint: "fingerprint:pg-d645-live",
			imageDigest: digest,
			engineCompatibilityRevision: LOCAL_CONTAINER_POSTGRESQL_COMPATIBILITY,
			backendFamily: LOCAL_CONTAINER_POSTGRESQL_PODMAN_LIBPOD_API_V0_ROOTLESS_BACKEND_FAMILY,
			backendCertificationRevision: "podman-certification:d645-candidate-v0",
			recipeRevision: "postgresql-read-only-query-v1",
			sandboxRevision: "sandbox:d645-live",
			mountPolicyRevision: "mount:d645-live",
			networkPolicyRevision: "network:deny:d645-live",
			resourcePolicyRevision: "resources:d645-live",
			stopGraceMs: 5,
			attestationRefs: [{ kind: "attestation", id: "manifest:d645-live" }],
		});
		const preflight = await certifyPodmanLibpodApiV0RootlessLocalContainerPostgresqlWithNode({
			manifest,
			imageRef,
			observedAtMs: 100,
			ttlMs: 1_000,
		});
		const readiness =
			localContainerPostgresqlPodmanLibpodApiV0RootlessPreflightReadiness(preflight);

		expect(readiness).toMatchObject({
			state: "unavailable",
			backendFamily: "podman-libpod-api-v0-rootless",
			engineReachable: true,
			backendFamilyVerified: true,
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
			dnsRebindingResistanceVerified: false,
			cancellationVerified: true,
		});
		expect(JSON.stringify(preflight)).not.toContain("podman-machine-default-api.sock");
		expect(JSON.stringify(preflight)).not.toContain("d645-canary-value");
		expect(JSON.stringify(preflight)).not.toContain("/var/folders/");
	}, 30_000);
});
