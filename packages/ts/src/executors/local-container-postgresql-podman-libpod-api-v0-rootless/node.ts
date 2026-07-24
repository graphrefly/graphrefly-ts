/** Node-local D645 candidate certifier over the native, versioned Libpod API. */
import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { lstat } from "node:fs/promises";
import { request as httpRequest } from "node:http";
import { promisify } from "node:util";
import type {
	LocalContainerPostgresqlManifest,
	LocalContainerPostgresqlPodmanLibpodApiV0RootlessPreflight,
} from "../local-container-postgresql.js";
import {
	LOCAL_CONTAINER_POSTGRESQL_PODMAN_LIBPOD_API_V0_ROOTLESS_BACKEND_FAMILY,
	localContainerPostgresqlManifest,
	localContainerPostgresqlPodmanLibpodApiV0RootlessPreflightReadiness,
} from "../local-container-postgresql.js";

const execFileAsync = promisify(execFile);
const API_REVISION = "5.0.3";
const BOUNDARY_LABEL = "d645-podman-libpod-api-v0-rootless-certifier";
const DEFAULT_TTL_MS = 5 * 60 * 1000;
const DEFAULT_TIMEOUT_MS = 10_000;
const MAX_RESPONSE_BYTES = 256 * 1024;
const ID = /^[a-f0-9]{64}$/;
const SECRET_ID = /^[a-f0-9]{24,64}$/;
const DIGEST = /^sha256:[a-f0-9]{64}$/;
const SAFE_IMAGE = /^[A-Za-z0-9][A-Za-z0-9._:/@+-]{0,254}$/;
const IPV4 = /^(?:\d{1,3}\.){3}\d{1,3}$/;
const PROBE_ENTRYPOINT = ["/bin/bash", "-ec"] as const;
const PEER_PORT = 15432;
const PEER_COMMAND = `exec nc -l -p ${PEER_PORT} >/dev/null`;

const LIMITATION_REFS = Object.freeze([
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
]);
const ATTESTATION_REFS = Object.freeze([
	{ kind: "attestation", id: "podman-libpod-api-v0-rootless:readiness:d645-v0" },
	{ kind: "attestation", id: "podman-libpod-api-v0-rootless:containment:d645-v0" },
	{ kind: "attestation", id: "podman-libpod-api-v0-rootless:network:d645-v0" },
	{
		kind: "attestation",
		id: "podman-libpod-api-v0-rootless:cancellation-cleanup:d645-v0",
	},
]);

export interface NodeLocalPodmanLibpodApiV0RootlessCertificationOptions {
	readonly manifest: LocalContainerPostgresqlManifest;
	readonly imageRef: string;
	readonly observedAtMs?: number;
	readonly ttlMs?: number;
	readonly signal?: AbortSignal;
}

/**
 * Certifies only the package-owned exact D645 host profile after every bounded
 * live effect probe succeeds. No caller can expand or override that profile.
 */
export async function certifyPodmanLibpodApiV0RootlessLocalContainerPostgresqlWithNode(
	opts: NodeLocalPodmanLibpodApiV0RootlessCertificationOptions,
): Promise<LocalContainerPostgresqlPodmanLibpodApiV0RootlessPreflight> {
	const manifest = localContainerPostgresqlManifest(opts.manifest);
	const observedAtMs = opts.observedAtMs ?? Date.now();
	const ttlMs = opts.ttlMs ?? DEFAULT_TTL_MS;
	if (!Number.isSafeInteger(observedAtMs) || observedAtMs < 0)
		throw new TypeError("Invalid Podman observation time.");
	if (!Number.isSafeInteger(ttlMs) || ttlMs < 1 || ttlMs > 60 * 60 * 1000)
		throw new TypeError("Invalid Podman readiness TTL.");
	if (
		manifest.backendFamily !==
		LOCAL_CONTAINER_POSTGRESQL_PODMAN_LIBPOD_API_V0_ROOTLESS_BACKEND_FAMILY
	)
		throw new TypeError("Podman certifier requires the Podman rootless backend family.");
	if (!SAFE_IMAGE.test(opts.imageRef) || !imageRefPinsDigest(opts.imageRef, manifest.imageDigest))
		throw new TypeError("Podman certifier requires the manifest digest-pinned image.");

	const base = (): LocalContainerPostgresqlPodmanLibpodApiV0RootlessPreflight => ({
		kind: "local-container-postgresql-podman-libpod-api-v0-rootless-preflight",
		manifestFingerprint: manifest.fingerprint,
		backendCertificationRevision: manifest.backendCertificationRevision,
		observedAtMs,
		expiresAtMs: observedAtMs + ttlMs,
		hostPlatform: `${process.platform}/${process.arch}`,
		engineApiRevision: "libpod-api:unavailable",
		engineRevision: "podman:unavailable",
		runtimeRevision: "oci-runtime:unavailable",
		guestPlatform: "linux/unknown",
		...(process.platform === "darwin" ? { vmRuntimeRevision: "podman-machine:unavailable" } : {}),
		engineReachable: false,
		compatibilityVerified: false,
		rootlessVerified: false,
		hostPlatformVerified: false,
		imageDigestPresent: false,
		imageDigestVerified: false,
		recipeVerified: false,
		isolationVerified: false,
		nonRootUserVerified: false,
		noNewPrivilegesVerified: false,
		readOnlyRootFilesystemVerified: false,
		boundedFilesystemImportVerified: false,
		noEngineSocketMountVerified: false,
		noHostNetworkVerified: false,
		noHostBindMountVerified: false,
		destinationPinnedEgressDenyVerified: false,
		metadataEgressDenyVerified: false,
		linkLocalEgressDenyVerified: false,
		loopbackEgressDenyVerified: false,
		hostGatewayEgressDenyVerified: false,
		dnsRebindingResistanceVerified: false,
		cpuMemoryPidsTimeBoundsVerified: false,
		cancellationVerified: false,
		cleanupVerified: false,
		artifactResolverReady: false,
		credentialResolverReady: false,
		secretDestructionVerified: false,
		limitationRefs: LIMITATION_REFS,
		attestationRefs: ATTESTATION_REFS,
	});
	const finish = (
		patch: Partial<LocalContainerPostgresqlPodmanLibpodApiV0RootlessPreflight>,
	): LocalContainerPostgresqlPodmanLibpodApiV0RootlessPreflight => {
		const value = Object.freeze({ ...base(), ...patch });
		localContainerPostgresqlPodmanLibpodApiV0RootlessPreflightReadiness(value);
		return value;
	};
	if (opts.signal?.aborted) return finish({});

	let socketPath: string | undefined;
	let networkName: string | undefined;
	let secretName: string | undefined;
	let containerId: string | undefined;
	let peerContainerId: string | undefined;
	let patch: Partial<LocalContainerPostgresqlPodmanLibpodApiV0RootlessPreflight> = {};
	try {
		const discovered = await discoverRootlessPodmanSocket(opts.signal);
		if (discovered === undefined) return finish({});
		socketPath = discovered.socketPath;
		const version = await jsonRequest(socketPath, `/v${API_REVISION}/libpod/version`, opts.signal);
		const info = await jsonRequest(socketPath, `/v${API_REVISION}/libpod/info`, opts.signal);
		const facts = exactCandidateFacts(version, info, discovered);
		if (facts === undefined) return finish({});
		patch = {
			engineReachable: true,
			engineApiRevision: `libpod-api:${API_REVISION}`,
			engineRevision: `podman:${facts.engineRevision}`,
			runtimeRevision: `crun:${facts.runtimeRevision}`,
			guestPlatform: facts.guestPlatform,
			vmRuntimeRevision: facts.vmRuntimeRevision,
			rootlessVerified: true,
			hostPlatformVerified: true,
		};

		const image = await jsonRequest(
			socketPath,
			`/v${API_REVISION}/libpod/images/${encodeURIComponent(opts.imageRef)}/json`,
			opts.signal,
		);
		const imageVerified =
			image.status === 200 &&
			isRecord(image.body) &&
			image.body.Digest === manifest.imageDigest &&
			Array.isArray(image.body.RepoDigests) &&
			image.body.RepoDigests.includes(opts.imageRef);
		patch = {
			...patch,
			imageDigestPresent: image.status === 200,
			imageDigestVerified: imageVerified,
		};
		if (!imageVerified) return finish(patch);

		const suffix = randomUUID();
		networkName = `graphrefly-d645-${suffix}-network`;
		secretName = `graphrefly-d645-${suffix}-secret`;
		const containerName = `graphrefly-d645-${suffix}-container`;
		const peerContainerName = `graphrefly-d645-${suffix}-peer`;
		const network = await jsonRequest(
			socketPath,
			`/v${API_REVISION}/libpod/networks/create`,
			opts.signal,
			"POST",
			{
				name: networkName,
				internal: true,
				labels: { "dev.graphrefly.boundary": BOUNDARY_LABEL },
			},
		);
		if (
			network.status !== 200 ||
			!isRecord(network.body) ||
			network.body.name !== networkName ||
			network.body.internal !== true
		)
			return finish({
				...patch,
				cleanupVerified: await cleanup(socketPath, containerId, secretName, networkName),
			});

		const secret = await rawRequest(
			socketPath,
			`/v${API_REVISION}/libpod/secrets/create?name=${encodeURIComponent(secretName)}`,
			opts.signal,
			"POST",
			"d645-canary-value",
			"application/octet-stream",
		);
		const secretBody = parseJson(secret.body);
		if (
			secret.status !== 200 ||
			!isRecord(secretBody) ||
			typeof secretBody.ID !== "string" ||
			!SECRET_ID.test(secretBody.ID)
		)
			return finish({
				...patch,
				cleanupVerified: await cleanup(socketPath, containerId, secretName, networkName),
			});

		const peerCreated = await jsonRequest(
			socketPath,
			`/v${API_REVISION}/libpod/containers/create`,
			opts.signal,
			"POST",
			peerContainerRequest(peerContainerName, networkName, opts.imageRef),
		);
		if (
			peerCreated.status !== 201 ||
			!isRecord(peerCreated.body) ||
			typeof peerCreated.body.Id !== "string" ||
			!ID.test(peerCreated.body.Id) ||
			!Array.isArray(peerCreated.body.Warnings) ||
			peerCreated.body.Warnings.length !== 0
		)
			return finish({
				...patch,
				cleanupVerified: await cleanup(socketPath, containerId, secretName, networkName),
			});
		peerContainerId = peerCreated.body.Id;
		const peerStarted = await rawRequest(
			socketPath,
			`/v${API_REVISION}/libpod/containers/${peerContainerId}/start`,
			opts.signal,
			"POST",
		);
		if (peerStarted.status !== 204)
			return finish({
				...patch,
				cleanupVerified: await cleanup(
					socketPath,
					containerId,
					secretName,
					networkName,
					peerContainerId,
				),
			});
		const peerInspected = await jsonRequest(
			socketPath,
			`/v${API_REVISION}/libpod/containers/${peerContainerId}/json`,
			opts.signal,
		);
		const peerIp = runningPeerIp(
			peerInspected,
			peerContainerId,
			peerContainerName,
			networkName,
			opts.imageRef,
		);
		if (peerIp === undefined)
			return finish({
				...patch,
				cleanupVerified: await cleanup(
					socketPath,
					containerId,
					secretName,
					networkName,
					peerContainerId,
				),
			});
		const probeCommand = probeCommandForPeer(peerIp);
		const created = await jsonRequest(
			socketPath,
			`/v${API_REVISION}/libpod/containers/create`,
			opts.signal,
			"POST",
			probeContainerRequest(containerName, networkName, secretName, opts.imageRef, probeCommand),
		);
		if (
			created.status !== 201 ||
			!isRecord(created.body) ||
			typeof created.body.Id !== "string" ||
			!ID.test(created.body.Id) ||
			!Array.isArray(created.body.Warnings) ||
			created.body.Warnings.length !== 0
		)
			return finish({
				...patch,
				cleanupVerified: await cleanup(
					socketPath,
					containerId,
					secretName,
					networkName,
					peerContainerId,
				),
			});
		containerId = created.body.Id;

		const inspected = await jsonRequest(
			socketPath,
			`/v${API_REVISION}/libpod/containers/${containerId}/json`,
			opts.signal,
		);
		if (
			!inspectMatches(
				inspected,
				containerId,
				containerName,
				networkName,
				opts.imageRef,
				probeCommand,
			)
		)
			return finish({
				...patch,
				cleanupVerified: await cleanup(
					socketPath,
					containerId,
					secretName,
					networkName,
					peerContainerId,
				),
			});
		patch = {
			...patch,
			isolationVerified: true,
			nonRootUserVerified: true,
			noNewPrivilegesVerified: true,
			readOnlyRootFilesystemVerified: true,
			boundedFilesystemImportVerified: true,
			noEngineSocketMountVerified: true,
			noHostNetworkVerified: true,
			noHostBindMountVerified: true,
			cpuMemoryPidsTimeBoundsVerified: true,
		};

		const started = await rawRequest(
			socketPath,
			`/v${API_REVISION}/libpod/containers/${containerId}/start`,
			opts.signal,
			"POST",
		);
		if (started.status !== 204)
			return finish({
				...patch,
				cleanupVerified: await cleanup(
					socketPath,
					containerId,
					secretName,
					networkName,
					peerContainerId,
				),
			});
		const waited = await rawRequest(
			socketPath,
			`/v${API_REVISION}/libpod/containers/${containerId}/wait?condition=exited`,
			opts.signal,
			"POST",
		);
		if (waited.status !== 200 || waited.body.trim() !== "0")
			return finish({
				...patch,
				cleanupVerified: await cleanup(
					socketPath,
					containerId,
					secretName,
					networkName,
					peerContainerId,
				),
			});
		const peerWaited = await rawRequest(
			socketPath,
			`/v${API_REVISION}/libpod/containers/${peerContainerId}/wait?condition=exited`,
			opts.signal,
			"POST",
		);
		if (peerWaited.status !== 200 || peerWaited.body.trim() !== "0")
			return finish({
				...patch,
				cleanupVerified: await cleanup(
					socketPath,
					containerId,
					secretName,
					networkName,
					peerContainerId,
				),
			});
		patch = {
			...patch,
			destinationPinnedEgressDenyVerified: true,
			metadataEgressDenyVerified: true,
			linkLocalEgressDenyVerified: true,
			loopbackEgressDenyVerified: true,
			hostGatewayEgressDenyVerified: true,
			dnsRebindingResistanceVerified: true,
		};
		const cancellationVerified = await verifyCancellationCanaries(
			socketPath,
			networkName,
			opts.imageRef,
			suffix,
			opts.signal,
		);
		patch = { ...patch, cancellationVerified };

		const cleanupVerified = await cleanup(
			socketPath,
			containerId,
			secretName,
			networkName,
			peerContainerId,
		);
		containerId = undefined;
		peerContainerId = undefined;
		secretName = undefined;
		networkName = undefined;
		patch = {
			...patch,
			compatibilityVerified: true,
			recipeVerified: manifest.recipeRevision === "postgresql-read-only-query-v1",
			artifactResolverReady: true,
			credentialResolverReady: true,
			secretDestructionVerified: cleanupVerified,
			cleanupVerified,
		};
		return finish(patch);
	} catch {
		const cleanupVerified =
			socketPath === undefined
				? false
				: await cleanup(socketPath, containerId, secretName, networkName, peerContainerId);
		return finish({
			...patch,
			secretDestructionVerified: cleanupVerified && patch.isolationVerified === true,
			cleanupVerified,
		});
	}
}

async function verifyCancellationCanaries(
	socketPath: string,
	networkName: string,
	imageRef: string,
	suffix: string,
	signal?: AbortSignal,
): Promise<boolean> {
	const cooperative = await runCancellationCanary({
		socketPath,
		networkName,
		imageRef,
		name: `graphrefly-d645-${suffix}-cooperative-cancel`,
		command: "trap 'exit 0' TERM; while :; do :; done",
		expectedExitCode: "0",
		signal,
	});
	if (!cooperative) return false;
	return runCancellationCanary({
		socketPath,
		networkName,
		imageRef,
		name: `graphrefly-d645-${suffix}-forced-cancel`,
		command: "trap '' TERM; while :; do sleep 1; done",
		expectedExitCode: "137",
		signal,
	});
}

async function runCancellationCanary(opts: {
	readonly socketPath: string;
	readonly networkName: string;
	readonly imageRef: string;
	readonly name: string;
	readonly command: string;
	readonly expectedExitCode: string;
	readonly signal?: AbortSignal;
}): Promise<boolean> {
	let containerId: string | undefined;
	try {
		const created = await jsonRequest(
			opts.socketPath,
			`/v${API_REVISION}/libpod/containers/create`,
			opts.signal,
			"POST",
			cancellationContainerRequest(opts.name, opts.networkName, opts.imageRef, opts.command),
		);
		if (
			created.status !== 201 ||
			!isRecord(created.body) ||
			typeof created.body.Id !== "string" ||
			!ID.test(created.body.Id) ||
			!Array.isArray(created.body.Warnings) ||
			created.body.Warnings.length !== 0
		)
			return false;
		containerId = created.body.Id;
		const inspected = await jsonRequest(
			opts.socketPath,
			`/v${API_REVISION}/libpod/containers/${containerId}/json`,
			opts.signal,
		);
		if (
			!cancellationInspectMatches(
				inspected,
				containerId,
				opts.name,
				opts.networkName,
				opts.imageRef,
				opts.command,
			)
		)
			return false;
		const started = await rawRequest(
			opts.socketPath,
			`/v${API_REVISION}/libpod/containers/${containerId}/start`,
			opts.signal,
			"POST",
		);
		if (started.status !== 204) return false;
		const stopped = await rawRequest(
			opts.socketPath,
			`/v${API_REVISION}/libpod/containers/${containerId}/stop?timeout=2`,
			opts.signal,
			"POST",
		);
		if (stopped.status !== 200 && stopped.status !== 204) return false;
		const waited = await rawRequest(
			opts.socketPath,
			`/v${API_REVISION}/libpod/containers/${containerId}/wait?condition=exited`,
			opts.signal,
			"POST",
		);
		if (waited.status !== 200) return false;
		const settled = await jsonRequest(
			opts.socketPath,
			`/v${API_REVISION}/libpod/containers/${containerId}/json`,
			opts.signal,
		);
		if (settled.status !== 200 || !isRecord(settled.body)) return false;
		const state = isRecord(settled.body.State) ? settled.body.State : undefined;
		return (
			!!state &&
			state.Running === false &&
			state.ExitCode === Number.parseInt(opts.expectedExitCode, 10)
		);
	} catch {
		return false;
	} finally {
		if (containerId !== undefined) {
			await rawRequest(
				opts.socketPath,
				`/v${API_REVISION}/libpod/containers/${containerId}?force=true&v=true`,
				undefined,
				"DELETE",
			).catch(() => undefined);
		}
	}
}

interface DiscoveredPodman {
	readonly socketPath: string;
	readonly machineName: string;
	readonly clientRevision: string;
}

async function discoverRootlessPodmanSocket(
	signal?: AbortSignal,
): Promise<DiscoveredPodman | undefined> {
	if (process.platform !== "darwin" || process.arch !== "arm64" || signal?.aborted)
		return undefined;
	const execution = await execFileAsync("podman", ["machine", "inspect"], {
		encoding: "utf8",
		timeout: DEFAULT_TIMEOUT_MS,
		maxBuffer: 128 * 1024,
		signal,
	});
	const parsed = parseJson(execution.stdout);
	if (!Array.isArray(parsed) || parsed.length !== 1 || !isRecord(parsed[0])) return undefined;
	const machine = parsed[0];
	const configDir = isRecord(machine.ConfigDir) ? machine.ConfigDir : undefined;
	const connection = isRecord(machine.ConnectionInfo) ? machine.ConnectionInfo : undefined;
	const socket =
		connection && isRecord(connection.PodmanSocket) ? connection.PodmanSocket : undefined;
	if (
		machine.Name !== "podman-machine-default" ||
		machine.State !== "running" ||
		machine.Rootful !== false ||
		machine.UserModeNetworking !== true ||
		!configDir ||
		typeof configDir.Path !== "string" ||
		!configDir.Path.endsWith("/podman/machine/applehv") ||
		!socket ||
		typeof socket.Path !== "string" ||
		!socket.Path.startsWith("/var/folders/")
	)
		return undefined;
	const metadata = await lstat(socket.Path);
	const uid = process.getuid?.();
	if (
		!metadata.isSocket() ||
		uid === undefined ||
		metadata.uid !== uid ||
		(metadata.mode & 0o077) !== 0
	)
		return undefined;
	const versionExecution = await execFileAsync("podman", ["version", "--format", "{{json .}}"], {
		encoding: "utf8",
		timeout: DEFAULT_TIMEOUT_MS,
		maxBuffer: 128 * 1024,
		signal,
	});
	const version = parseJson(versionExecution.stdout);
	const client = isRecord(version) && isRecord(version.Client) ? version.Client : undefined;
	const server = isRecord(version) && isRecord(version.Server) ? version.Server : undefined;
	if (
		!client ||
		!server ||
		client.APIVersion !== "5.7.1" ||
		client.Version !== "5.7.1" ||
		client.OsArch !== "darwin/arm64" ||
		server.APIVersion !== API_REVISION ||
		server.Version !== API_REVISION ||
		server.OsArch !== "linux/arm64"
	)
		return undefined;
	return {
		socketPath: socket.Path,
		machineName: machine.Name,
		clientRevision: client.Version,
	};
}

function exactCandidateFacts(
	version: JsonResponse,
	info: JsonResponse,
	discovered: DiscoveredPodman,
):
	| {
			readonly engineRevision: string;
			readonly runtimeRevision: string;
			readonly guestPlatform: string;
			readonly vmRuntimeRevision: string;
	  }
	| undefined {
	if (
		version.status !== 200 ||
		info.status !== 200 ||
		!isRecord(version.body) ||
		!isRecord(info.body) ||
		version.body.Version !== API_REVISION ||
		discovered.clientRevision !== "5.7.1"
	)
		return undefined;
	const host = isRecord(info.body.host) ? info.body.host : undefined;
	const security = host && isRecord(host.security) ? host.security : undefined;
	const oci = host && isRecord(host.ociRuntime) ? host.ociRuntime : undefined;
	const network = host && isRecord(host.networkBackendInfo) ? host.networkBackendInfo : undefined;
	const networkDns = network && isRecord(network.dns) ? network.dns : undefined;
	const infoVersion = isRecord(info.body.version) ? info.body.version : undefined;
	if (
		!host ||
		!security ||
		!oci ||
		!infoVersion ||
		infoVersion.APIVersion !== API_REVISION ||
		infoVersion.Version !== API_REVISION ||
		infoVersion.OsArch !== "linux/arm64" ||
		host.os !== "linux" ||
		host.arch !== "arm64" ||
		security.rootless !== true ||
		security.seccompEnabled !== true ||
		security.selinuxEnabled !== true ||
		host.cgroupVersion !== "v2" ||
		host.cgroupManager !== "systemd" ||
		host.networkBackend !== "netavark" ||
		!network ||
		network.backend !== "netavark" ||
		network.version !== "netavark 1.10.3" ||
		!networkDns ||
		networkDns.version !== "aardvark-dns 1.10.0" ||
		oci.name !== "crun" ||
		typeof oci.version !== "string" ||
		!oci.version.startsWith("crun version 1.14.4")
	)
		return undefined;
	return {
		engineRevision: API_REVISION,
		runtimeRevision: "1.14.4",
		guestPlatform: "linux/arm64",
		vmRuntimeRevision: `${discovered.machineName}:applehv-v1`,
	};
}

function probeContainerRequest(
	name: string,
	network: string,
	secret: string,
	image: string,
	command: string,
): Record<string, unknown> {
	return {
		name,
		image,
		entrypoint: [...PROBE_ENTRYPOINT],
		command: [command],
		user: "65532:65532",
		env: {},
		env_host: false,
		httpproxy: false,
		image_volume_mode: "ignore",
		read_only_filesystem: true,
		read_write_tmpfs: false,
		privileged: false,
		cap_drop: ["all"],
		no_new_privileges: true,
		terminal: false,
		stdin: false,
		remove: false,
		stop_signal: 15,
		publish_image_ports: false,
		networks: { [network]: {} },
		secrets: [{ source: secret, target: "d645-canary", uid: 65532, gid: 65532, mode: 0o444 }],
		labels: { "dev.graphrefly.boundary": BOUNDARY_LABEL },
		resource_limits: {
			memory: { limit: 128 * 1024 * 1024 },
			cpu: { period: 100_000, quota: 50_000 },
			pids: { limit: 64 },
		},
	};
}

function peerContainerRequest(
	name: string,
	network: string,
	image: string,
): Record<string, unknown> {
	return {
		name,
		image,
		entrypoint: [...PROBE_ENTRYPOINT],
		command: [PEER_COMMAND],
		user: "65532:65532",
		env: {},
		env_host: false,
		httpproxy: false,
		image_volume_mode: "ignore",
		read_only_filesystem: true,
		read_write_tmpfs: false,
		privileged: false,
		cap_drop: ["all"],
		no_new_privileges: true,
		terminal: false,
		stdin: false,
		remove: false,
		stop_signal: 15,
		publish_image_ports: false,
		networks: { [network]: {} },
		labels: { "dev.graphrefly.boundary": BOUNDARY_LABEL },
		resource_limits: {
			memory: { limit: 128 * 1024 * 1024 },
			cpu: { period: 100_000, quota: 50_000 },
			pids: { limit: 64 },
		},
	};
}

function probeCommandForPeer(peerIp: string): string {
	if (!validIpv4(peerIp)) throw new TypeError("Invalid private Podman probe peer address.");
	return [
		'test "$(id -u)" != "0"',
		'test "$(cat /run/secrets/d645-canary)" = "d645-canary-value"',
		`printf d645 | timeout 2 nc -w 2 ${peerIp} ${PEER_PORT}`,
		"! grep -Eq '^[^[:space:]]+[[:space:]]+00000000[[:space:]]' /proc/net/route",
		"! timeout 1 nc -z -w 1 1.1.1.1 53",
		"! timeout 1 nc -z -w 1 169.254.169.254 80",
		"! timeout 1 nc -z -w 1 127.0.0.1 15432",
		"! timeout 1 nc -z -w 1 host.containers.internal 15432",
		'test -z "$(timeout 2 getent hosts example.com || true)"',
	].join(" && ");
}

function cancellationContainerRequest(
	name: string,
	network: string,
	image: string,
	command: string,
): Record<string, unknown> {
	return {
		name,
		image,
		entrypoint: [...PROBE_ENTRYPOINT],
		command: [command],
		user: "65532:65532",
		env: {},
		env_host: false,
		httpproxy: false,
		image_volume_mode: "ignore",
		read_only_filesystem: true,
		read_write_tmpfs: false,
		privileged: false,
		cap_drop: ["all"],
		no_new_privileges: true,
		terminal: false,
		stdin: false,
		remove: false,
		stop_signal: 15,
		publish_image_ports: false,
		networks: { [network]: {} },
		labels: { "dev.graphrefly.boundary": BOUNDARY_LABEL },
		resource_limits: {
			memory: { limit: 128 * 1024 * 1024 },
			cpu: { period: 100_000, quota: 50_000 },
			pids: { limit: 64 },
		},
	};
}

function runningPeerIp(
	response: JsonResponse,
	containerId: string,
	containerName: string,
	networkName: string,
	imageRef: string,
): string | undefined {
	if (response.status !== 200 || !isRecord(response.body)) return undefined;
	const body = response.body;
	const config = isRecord(body.Config) ? body.Config : undefined;
	const host = isRecord(body.HostConfig) ? body.HostConfig : undefined;
	const state = isRecord(body.State) ? body.State : undefined;
	const settings = isRecord(body.NetworkSettings) ? body.NetworkSettings : undefined;
	const networks = settings && isRecord(settings.Networks) ? settings.Networks : undefined;
	const network = networks && isRecord(networks[networkName]) ? networks[networkName] : undefined;
	const labels = config && isRecord(config.Labels) ? config.Labels : undefined;
	const ip = network?.IPAddress;
	if (
		body.Id !== containerId ||
		body.Name !== containerName ||
		body.Path !== PROBE_ENTRYPOINT[0] ||
		!exactStrings(body.Args, [PROBE_ENTRYPOINT[1], PEER_COMMAND]) ||
		!config ||
		config.Image !== imageRef ||
		config.User !== "65532:65532" ||
		!exactStrings(config.Entrypoint, PROBE_ENTRYPOINT) ||
		!exactStrings(config.Cmd, [PEER_COMMAND]) ||
		!labels ||
		labels["dev.graphrefly.boundary"] !== BOUNDARY_LABEL ||
		!host ||
		host.ReadonlyRootfs !== true ||
		host.Privileged !== false ||
		!Array.isArray(host.SecurityOpt) ||
		!host.SecurityOpt.includes("no-new-privileges") ||
		host.Memory !== 128 * 1024 * 1024 ||
		host.CpuPeriod !== 100_000 ||
		host.CpuQuota !== 50_000 ||
		host.PidsLimit !== 64 ||
		!state ||
		state.Running !== true ||
		!networks ||
		Object.keys(networks).length !== 1 ||
		!network ||
		typeof ip !== "string" ||
		!validIpv4(ip) ||
		!Array.isArray(body.Mounts) ||
		body.Mounts.length !== 0
	)
		return undefined;
	return ip;
}

function inspectMatches(
	response: JsonResponse,
	containerId: string,
	containerName: string,
	networkName: string,
	imageRef: string,
	command: string,
): boolean {
	if (response.status !== 200 || !isRecord(response.body)) return false;
	const body = response.body;
	const config = isRecord(body.Config) ? body.Config : undefined;
	const host = isRecord(body.HostConfig) ? body.HostConfig : undefined;
	const settings = isRecord(body.NetworkSettings) ? body.NetworkSettings : undefined;
	const networks = settings && isRecord(settings.Networks) ? settings.Networks : undefined;
	const labels = config && isRecord(config.Labels) ? config.Labels : undefined;
	const mounts = Array.isArray(body.Mounts) ? body.Mounts : undefined;
	return (
		body.Id === containerId &&
		body.Name === containerName &&
		body.Path === PROBE_ENTRYPOINT[0] &&
		exactStrings(body.Args, [PROBE_ENTRYPOINT[1], command]) &&
		!!config &&
		config.Image === imageRef &&
		config.User === "65532:65532" &&
		exactStrings(config.Entrypoint, PROBE_ENTRYPOINT) &&
		exactStrings(config.Cmd, [command]) &&
		!!labels &&
		labels["dev.graphrefly.boundary"] === BOUNDARY_LABEL &&
		!!host &&
		host.ReadonlyRootfs === true &&
		host.Privileged === false &&
		Array.isArray(host.SecurityOpt) &&
		host.SecurityOpt.includes("no-new-privileges") &&
		host.Memory === 128 * 1024 * 1024 &&
		host.CpuPeriod === 100_000 &&
		host.CpuQuota === 50_000 &&
		host.PidsLimit === 64 &&
		!!networks &&
		Object.keys(networks).length === 1 &&
		networkName in networks &&
		!!mounts &&
		mounts.length === 0
	);
}

function cancellationInspectMatches(
	response: JsonResponse,
	containerId: string,
	containerName: string,
	networkName: string,
	imageRef: string,
	command: string,
): boolean {
	if (response.status !== 200 || !isRecord(response.body)) return false;
	const body = response.body;
	const config = isRecord(body.Config) ? body.Config : undefined;
	const host = isRecord(body.HostConfig) ? body.HostConfig : undefined;
	const settings = isRecord(body.NetworkSettings) ? body.NetworkSettings : undefined;
	const networks = settings && isRecord(settings.Networks) ? settings.Networks : undefined;
	const labels = config && isRecord(config.Labels) ? config.Labels : undefined;
	return (
		body.Id === containerId &&
		body.Name === containerName &&
		body.Path === PROBE_ENTRYPOINT[0] &&
		exactStrings(body.Args, [PROBE_ENTRYPOINT[1], command]) &&
		!!config &&
		config.Image === imageRef &&
		config.User === "65532:65532" &&
		exactStrings(config.Entrypoint, PROBE_ENTRYPOINT) &&
		exactStrings(config.Cmd, [command]) &&
		!!labels &&
		labels["dev.graphrefly.boundary"] === BOUNDARY_LABEL &&
		!!host &&
		host.ReadonlyRootfs === true &&
		host.Privileged === false &&
		Array.isArray(host.SecurityOpt) &&
		host.SecurityOpt.includes("no-new-privileges") &&
		host.Memory === 128 * 1024 * 1024 &&
		host.CpuPeriod === 100_000 &&
		host.CpuQuota === 50_000 &&
		host.PidsLimit === 64 &&
		!!networks &&
		Object.keys(networks).length === 1 &&
		networkName in networks &&
		Array.isArray(body.Mounts) &&
		body.Mounts.length === 0
	);
}

async function cleanup(
	socketPath: string,
	containerId?: string,
	secretName?: string,
	networkName?: string,
	peerContainerId?: string,
): Promise<boolean> {
	let verified = true;
	for (const privateContainerId of [containerId, peerContainerId]) {
		if (privateContainerId === undefined) continue;
		const response = await rawRequest(
			socketPath,
			`/v${API_REVISION}/libpod/containers/${privateContainerId}?force=true&v=true`,
			undefined,
			"DELETE",
		).catch(() => undefined);
		const absent = await rawRequest(
			socketPath,
			`/v${API_REVISION}/libpod/containers/${privateContainerId}/json`,
		).catch(() => undefined);
		verified =
			(response?.status === 200 || response?.status === 404) && absent?.status === 404 && verified;
	}
	if (secretName !== undefined) {
		const removed = await rawRequest(
			socketPath,
			`/v${API_REVISION}/libpod/secrets/${encodeURIComponent(secretName)}`,
			undefined,
			"DELETE",
		).catch(() => undefined);
		const absent = await rawRequest(
			socketPath,
			`/v${API_REVISION}/libpod/secrets/${encodeURIComponent(secretName)}/json`,
		).catch(() => undefined);
		verified =
			(removed?.status === 204 || removed?.status === 404) && absent?.status === 404 && verified;
	}
	if (networkName !== undefined) {
		const response = await rawRequest(
			socketPath,
			`/v${API_REVISION}/libpod/networks/${encodeURIComponent(networkName)}?force=true`,
			undefined,
			"DELETE",
		).catch(() => undefined);
		const absent = await rawRequest(
			socketPath,
			`/v${API_REVISION}/libpod/networks/${encodeURIComponent(networkName)}/json`,
		).catch(() => undefined);
		verified =
			(response?.status === 200 || response?.status === 404) && absent?.status === 404 && verified;
	}
	return verified;
}

interface RawResponse {
	readonly status: number;
	readonly body: string;
}
interface JsonResponse {
	readonly status: number;
	readonly body: unknown;
}

async function jsonRequest(
	socketPath: string,
	path: string,
	signal?: AbortSignal,
	method = "GET",
	body?: Record<string, unknown>,
): Promise<JsonResponse> {
	const response = await rawRequest(
		socketPath,
		path,
		signal,
		method,
		body === undefined ? undefined : JSON.stringify(body),
		"application/json",
	);
	return { status: response.status, body: parseJson(response.body) };
}

function rawRequest(
	socketPath: string,
	path: string,
	signal?: AbortSignal,
	method = "GET",
	body?: string,
	contentType?: string,
): Promise<RawResponse> {
	return new Promise((resolve, reject) => {
		const request = httpRequest(
			{
				socketPath,
				path,
				method,
				signal,
				headers:
					body === undefined
						? undefined
						: {
								"content-type": contentType ?? "application/octet-stream",
								"content-length": Buffer.byteLength(body),
							},
			},
			(response) => {
				let bytes = 0;
				const chunks: Buffer[] = [];
				response.on("data", (chunk: Buffer) => {
					bytes += chunk.length;
					if (bytes > MAX_RESPONSE_BYTES) {
						request.destroy(new Error("Podman response exceeded byte budget."));
						return;
					}
					chunks.push(chunk);
				});
				response.on("end", () =>
					resolve({
						status: response.statusCode ?? 0,
						body: Buffer.concat(chunks).toString("utf8"),
					}),
				);
			},
		);
		request.setTimeout(DEFAULT_TIMEOUT_MS, () =>
			request.destroy(new Error("Podman request timed out.")),
		);
		request.on("error", reject);
		if (body !== undefined) request.write(body);
		request.end();
	});
}

function parseJson(value: string): unknown {
	try {
		return JSON.parse(value);
	} catch {
		return undefined;
	}
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function exactStrings(value: unknown, expected: readonly string[]): boolean {
	return (
		Array.isArray(value) &&
		value.length === expected.length &&
		value.every((item, index) => item === expected[index])
	);
}

function validIpv4(value: string): boolean {
	if (!IPV4.test(value)) return false;
	return value.split(".").every((part) => {
		const numeric = Number(part);
		return Number.isInteger(numeric) && numeric >= 0 && numeric <= 255;
	});
}

function imageRefPinsDigest(imageRef: string, digest: string): boolean {
	return DIGEST.test(digest) && (imageRef === digest || imageRef.endsWith(`@${digest}`));
}
