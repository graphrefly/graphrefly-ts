/** D624 host-runtime Docker Engine API v0 broker/certifier for D604 PostgreSQL containers. */
import type { SourceRef } from "../orchestration/index.js";
import type {
	LocalContainerPostgresqlDockerEngineApiV0Preflight,
	LocalContainerPostgresqlDriver,
	LocalContainerPostgresqlDriverContext,
	LocalContainerPostgresqlManifest,
} from "./local-container-postgresql.js";
import {
	LOCAL_CONTAINER_POSTGRESQL_COMPATIBILITY,
	localContainerPostgresqlDockerEngineApiV0PreflightReadiness,
} from "./local-container-postgresql.js";
import type {
	PostgresqlDriverQueryResult,
	PostgresqlQueryToolArguments,
} from "./postgresql-tool-provider.js";

export const DOCKER_ENGINE_API_V0_BROKER_COMPATIBILITY =
	"graphrefly-local-container-postgresql-docker-engine-api-v0-broker-v1" as const;
export const DOCKER_ENGINE_API_V0_CERTIFIER_COMPATIBILITY =
	"graphrefly-local-container-postgresql-docker-engine-api-v0-certifier-v1" as const;

export type DockerEngineApiV0DetectedBackend =
	| "docker-engine"
	| "podman"
	| "unknown"
	| "unavailable";

export type DockerEngineApiV0HostResult<T> =
	| { readonly ok: true; readonly value: T }
	| {
			readonly ok: false;
			readonly detectedBackend?: DockerEngineApiV0DetectedBackend;
	  };

export interface DockerEngineApiV0VersionEvidence {
	readonly detectedBackend: DockerEngineApiV0DetectedBackend;
	readonly engineReachable: boolean;
	readonly engineApiRevision: string;
	readonly engineRevision: string;
}

export interface DockerEngineApiV0ImageDigestEvidence {
	readonly imageDigestPresent: boolean;
	readonly imageDigestVerified: boolean;
}

export interface DockerEngineApiV0ContainmentEvidence {
	readonly isolationVerified: boolean;
	readonly containerUser: string;
	readonly noNewPrivilegesVerified: boolean;
	readonly readOnlyRootFilesystemVerified: boolean;
	readonly boundedFilesystemImportVerified: boolean;
	readonly noEngineSocketMountVerified: boolean;
	readonly noHostNetworkVerified: boolean;
	readonly noHostBindMountVerified: boolean;
	readonly cpuMemoryPidsTimeBoundsVerified: boolean;
}

export interface DockerEngineApiV0NetworkDenialEvidence {
	readonly destinationPinnedEgressDenyVerified: boolean;
	readonly metadataEgressDenyVerified: boolean;
	readonly linkLocalEgressDenyVerified: boolean;
	readonly loopbackEgressDenyVerified: boolean;
	readonly hostGatewayEgressDenyVerified: boolean;
	readonly dnsRebindingResistanceVerified: boolean;
}

export interface DockerEngineApiV0CancellationSecretEvidence {
	readonly cancellationVerified: boolean;
	readonly cleanupVerified: boolean;
	readonly artifactResolverReady: boolean;
	readonly credentialResolverReady: boolean;
	readonly secretDestructionVerified: boolean;
}

export interface DockerEngineApiV0CertifiedHostMatrixEntry {
	readonly hostPlatform: string;
	readonly guestPlatform: string;
	readonly runtimeRevision: string;
	readonly engineApiRevision: string;
	readonly engineRevision: string;
	readonly vmRuntimeRevision?: string;
	readonly proofRefs: readonly SourceRef[];
}

export function dockerEngineApiV0CertifiedHostMatrixEntry(
	value: unknown,
): DockerEngineApiV0CertifiedHostMatrixEntry | undefined {
	if (typeof value !== "object" || value === null) return undefined;
	const entry = value as Partial<DockerEngineApiV0CertifiedHostMatrixEntry>;
	const hostPlatform = certifiablePlatform(entry.hostPlatform);
	const guestPlatform = certifiablePlatform(entry.guestPlatform);
	const runtimeRevision = certifiablePublicCoordinate(entry.runtimeRevision);
	const engineApiRevision = certifiablePublicCoordinate(entry.engineApiRevision);
	const engineRevision = certifiablePublicCoordinate(entry.engineRevision);
	const proofRefs = publicMatrixProofRefs(entry.proofRefs);
	if (
		hostPlatform === undefined ||
		guestPlatform === undefined ||
		!guestPlatform.startsWith("linux/") ||
		runtimeRevision === undefined ||
		engineApiRevision === undefined ||
		engineRevision === undefined ||
		proofRefs === undefined
	)
		return undefined;
	const vmRequired = hostPlatform.startsWith("darwin/") || hostPlatform.startsWith("windows/");
	const vmRuntimeRevision =
		entry.vmRuntimeRevision === undefined
			? undefined
			: certifiablePublicCoordinate(entry.vmRuntimeRevision);
	if (vmRequired && vmRuntimeRevision === undefined) return undefined;
	if (!vmRequired && entry.vmRuntimeRevision !== undefined) return undefined;
	return Object.freeze({
		hostPlatform,
		guestPlatform,
		runtimeRevision,
		engineApiRevision,
		engineRevision,
		...(vmRuntimeRevision === undefined ? {} : { vmRuntimeRevision }),
		proofRefs,
	});
}

export interface DockerEngineApiV0CertificationProbeOptions {
	readonly imageRef: string;
	readonly hostPlatform: string;
	readonly guestPlatform: string;
	readonly runtimeRevision: string;
	readonly certifiedHostMatrix: readonly DockerEngineApiV0CertifiedHostMatrixEntry[];
	readonly vmRuntimeRevision?: string;
	readonly observedAtMs?: number;
	readonly ttlMs?: number;
	readonly probeLabel?: string;
	readonly signal?: AbortSignal;
}

export interface DockerEngineApiV0BrokerOptions extends DockerEngineApiV0CertificationProbeOptions {
	readonly manifest: LocalContainerPostgresqlManifest;
	readonly host: DockerEngineApiV0LocalContainerPostgresqlCertificationHost;
}

export interface DockerEngineApiV0LocalContainerPostgresqlDriverOptions {
	readonly host: DockerEngineApiV0LocalContainerPostgresqlHost;
	readonly imageRef: string;
}

export interface DockerEngineApiV0LocalContainerPostgresqlCertificationHost {
	readVersion(opts: {
		readonly signal?: AbortSignal;
	}):
		| DockerEngineApiV0HostResult<DockerEngineApiV0VersionEvidence>
		| PromiseLike<DockerEngineApiV0HostResult<DockerEngineApiV0VersionEvidence>>;
	inspectImageDigest(opts: {
		readonly imageRef: string;
		readonly imageDigest: string;
		readonly signal?: AbortSignal;
	}):
		| DockerEngineApiV0HostResult<DockerEngineApiV0ImageDigestEvidence>
		| PromiseLike<DockerEngineApiV0HostResult<DockerEngineApiV0ImageDigestEvidence>>;
	createProbeNetwork(opts: {
		readonly probeLabel?: string;
		readonly signal?: AbortSignal;
	}): DockerEngineApiV0HostResult<unknown> | PromiseLike<DockerEngineApiV0HostResult<unknown>>;
	createProbeContainer(opts: {
		readonly imageRef: string;
		readonly network: unknown;
		readonly probeLabel?: string;
		readonly signal?: AbortSignal;
	}): DockerEngineApiV0HostResult<unknown> | PromiseLike<DockerEngineApiV0HostResult<unknown>>;
	inspectProbeContainment(
		container: unknown,
		opts: { readonly signal?: AbortSignal },
	):
		| DockerEngineApiV0HostResult<DockerEngineApiV0ContainmentEvidence>
		| PromiseLike<DockerEngineApiV0HostResult<DockerEngineApiV0ContainmentEvidence>>;
	verifyProbeNetworkDenials(
		container: unknown,
		opts: { readonly signal?: AbortSignal },
	):
		| DockerEngineApiV0HostResult<DockerEngineApiV0NetworkDenialEvidence>
		| PromiseLike<DockerEngineApiV0HostResult<DockerEngineApiV0NetworkDenialEvidence>>;
	verifyProbeCancellationAndSecretDestruction(
		container: unknown,
		opts: { readonly signal?: AbortSignal },
	):
		| DockerEngineApiV0HostResult<DockerEngineApiV0CancellationSecretEvidence>
		| PromiseLike<DockerEngineApiV0HostResult<DockerEngineApiV0CancellationSecretEvidence>>;
	startProbeContainer(
		container: unknown,
		opts: { readonly signal?: AbortSignal },
	): DockerEngineApiV0HostResult<void> | PromiseLike<DockerEngineApiV0HostResult<void>>;
	waitProbeContainer(
		container: unknown,
		opts: { readonly signal?: AbortSignal },
	): DockerEngineApiV0HostResult<void> | PromiseLike<DockerEngineApiV0HostResult<void>>;
	removeProbeContainer(
		container: unknown,
		opts?: { readonly signal?: AbortSignal },
	): DockerEngineApiV0HostResult<void> | PromiseLike<DockerEngineApiV0HostResult<void>>;
	removeProbeNetwork(
		network: unknown,
		opts?: { readonly signal?: AbortSignal },
	): DockerEngineApiV0HostResult<void> | PromiseLike<DockerEngineApiV0HostResult<void>>;
}

export interface DockerEngineApiV0LocalContainerPostgresqlHost
	extends DockerEngineApiV0LocalContainerPostgresqlCertificationHost {
	createRunContainer(opts: {
		readonly imageRef: string;
		readonly args: PostgresqlQueryToolArguments;
		readonly context: LocalContainerPostgresqlDriverContext;
	}): DockerEngineApiV0HostResult<unknown> | PromiseLike<DockerEngineApiV0HostResult<unknown>>;
	startRunContainer(
		binding: unknown,
		context: LocalContainerPostgresqlDriverContext,
	): DockerEngineApiV0HostResult<void> | PromiseLike<DockerEngineApiV0HostResult<void>>;
	waitRunContainer(
		binding: unknown,
		context: LocalContainerPostgresqlDriverContext,
	):
		| DockerEngineApiV0HostResult<PostgresqlDriverQueryResult>
		| PromiseLike<DockerEngineApiV0HostResult<PostgresqlDriverQueryResult>>;
	stopRunContainer(
		binding: unknown,
		context: LocalContainerPostgresqlDriverContext,
		graceMs: number,
	): DockerEngineApiV0HostResult<void> | PromiseLike<DockerEngineApiV0HostResult<void>>;
	killRunContainer(
		binding: unknown,
		context: LocalContainerPostgresqlDriverContext,
	): DockerEngineApiV0HostResult<void> | PromiseLike<DockerEngineApiV0HostResult<void>>;
	removeRunContainer(
		binding: unknown,
		context: LocalContainerPostgresqlDriverContext,
	): DockerEngineApiV0HostResult<void> | PromiseLike<DockerEngineApiV0HostResult<void>>;
}

const DIGEST = /^sha256:[a-f0-9]{64}$/;
const SAFE = /^[A-Za-z0-9][A-Za-z0-9._:/@+-]{0,255}$/;
const D624_DEFAULT_TTL_MS = 5 * 60 * 1000;
const PRIVATE_COMPACT_MATERIAL = [
	"containerid",
	"dockersock",
	"engineclient",
	"hostpath",
	"mountsource",
	"secrethandle",
	"vmid",
];
const PRIVATE_TOKEN_MATERIAL = [
	"client",
	"credential",
	"daemon",
	"endpoint",
	"handle",
	"password",
	"private",
	"secret",
	"sock",
	"socket",
	"token",
];
const D613_DOCKER_ENGINE_API_V0_PROOF_REFS = Object.freeze([
	{ kind: "limitation", id: "docker-engine-api-v0-only" },
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
] satisfies readonly SourceRef[]);
const D624_ATTESTATION_REFS = Object.freeze([
	{ kind: "attestation", id: "docker-engine-api-v0:readiness:d624-v0" },
	{ kind: "attestation", id: "docker-engine-api-v0:containment:d624-v0" },
	{ kind: "attestation", id: "docker-engine-api-v0:network:d624-v0" },
	{ kind: "attestation", id: "docker-engine-api-v0:cancellation-cleanup:d624-v0" },
] satisfies readonly SourceRef[]);

export async function certifyDockerEngineApiV0LocalContainerPostgresql(
	opts: DockerEngineApiV0BrokerOptions,
): Promise<LocalContainerPostgresqlDockerEngineApiV0Preflight> {
	const observedAtMs = opts.observedAtMs ?? Date.now();
	const expiresAtMs = observedAtMs + (opts.ttlMs ?? D624_DEFAULT_TTL_MS);
	const baseHostPlatform = boundedPlatform(opts.hostPlatform, "linux/unknown");
	const baseVmRuntimeRevision =
		baseHostPlatform.startsWith("darwin/") || baseHostPlatform.startsWith("windows/")
			? boundedPublicCoordinate(opts.vmRuntimeRevision, "vm:unavailable")
			: undefined;
	const base = (): LocalContainerPostgresqlDockerEngineApiV0Preflight => ({
		kind: "local-container-postgresql-docker-engine-api-v0-preflight",
		manifestFingerprint: opts.manifest.fingerprint,
		backendCertificationRevision: opts.manifest.backendCertificationRevision,
		detectedBackend: "unavailable",
		observedAtMs,
		expiresAtMs,
		hostPlatform: baseHostPlatform,
		engineApiRevision: "docker-api:unavailable",
		engineRevision: "docker-engine:unavailable",
		runtimeRevision: boundedPublicCoordinate(opts.runtimeRevision, "runtime:unavailable"),
		guestPlatform: boundedPlatform(opts.guestPlatform, "linux/unknown"),
		...(baseVmRuntimeRevision === undefined ? {} : { vmRuntimeRevision: baseVmRuntimeRevision }),
		engineReachable: false,
		compatibilityVerified: false,
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
		limitationRefs: D613_DOCKER_ENGINE_API_V0_PROOF_REFS,
		attestationRefs: D624_ATTESTATION_REFS,
	});
	const preflight = (
		patch: Partial<LocalContainerPostgresqlDockerEngineApiV0Preflight>,
	): LocalContainerPostgresqlDockerEngineApiV0Preflight => {
		const value = { ...base(), ...patch };
		localContainerPostgresqlDockerEngineApiV0PreflightReadiness(value);
		return value;
	};
	const fail = (
		patch: Partial<LocalContainerPostgresqlDockerEngineApiV0Preflight> = {},
	): LocalContainerPostgresqlDockerEngineApiV0Preflight => preflight(patch);
	if (
		!DIGEST.test(opts.manifest.imageDigest) ||
		!imageRefPinsDigest(opts.imageRef, opts.manifest.imageDigest)
	)
		return fail({ detectedBackend: "unknown" });

	let probeContainer: unknown;
	let probeNetwork: unknown;
	let lastFailurePatch: Partial<LocalContainerPostgresqlDockerEngineApiV0Preflight> | undefined;
	const failAndCleanup = async (
		patch: Partial<LocalContainerPostgresqlDockerEngineApiV0Preflight> = {},
	): Promise<LocalContainerPostgresqlDockerEngineApiV0Preflight> => {
		const cleanupVerified = await cleanupProbeResources(opts.host, probeContainer, probeNetwork);
		probeContainer = undefined;
		probeNetwork = undefined;
		return fail({
			...(lastFailurePatch ?? {}),
			...patch,
			cleanupVerified: cleanupVerified && patch.cleanupVerified !== false,
		});
	};
	try {
		const version = await opts.host.readVersion({ signal: opts.signal });
		if (!version.ok || version.value.detectedBackend !== "docker-engine")
			return fail(
				version.ok ? versionPatch(version.value) : { detectedBackend: version.detectedBackend },
			);
		lastFailurePatch = versionPatch(version.value);
		const matrixProofRefs = certifiedHostMatrixProofRefs(opts, version.value);
		if (matrixProofRefs === undefined) return fail(versionPatch(version.value));
		const image = await opts.host.inspectImageDigest({
			imageRef: opts.imageRef,
			imageDigest: opts.manifest.imageDigest,
			signal: opts.signal,
		});
		if (!image.ok || !image.value.imageDigestPresent || !image.value.imageDigestVerified)
			return fail({
				...versionPatch(version.value),
				...(image.ok ? imageDigestEvidencePatch(image.value) : {}),
			});
		const imagePatch = imageDigestEvidencePatch(image.value);
		lastFailurePatch = { ...lastFailurePatch, ...imagePatch };
		const network = await opts.host.createProbeNetwork({
			probeLabel: opts.probeLabel,
			signal: opts.signal,
		});
		if (!network.ok) return fail(versionPatch(version.value));
		probeNetwork = network.value;
		const container = await opts.host.createProbeContainer({
			imageRef: opts.imageRef,
			network: probeNetwork,
			probeLabel: opts.probeLabel,
			signal: opts.signal,
		});
		if (!container.ok) return failAndCleanup(versionPatch(version.value));
		probeContainer = container.value;
		const containment = await opts.host.inspectProbeContainment(probeContainer, {
			signal: opts.signal,
		});
		if (!containment.ok) return failAndCleanup(versionPatch(version.value));
		const containmentPatch = containmentEvidencePatch(containment.value);
		lastFailurePatch = { ...lastFailurePatch, ...containmentPatch };
		const start = await opts.host.startProbeContainer(probeContainer, { signal: opts.signal });
		if (!start.ok) return failAndCleanup(versionPatch(version.value));
		const wait = await opts.host.waitProbeContainer(probeContainer, { signal: opts.signal });
		if (!wait.ok) return failAndCleanup(versionPatch(version.value));
		const networkDenial = await opts.host.verifyProbeNetworkDenials(probeContainer, {
			signal: opts.signal,
		});
		if (!networkDenial.ok) return failAndCleanup(versionPatch(version.value));
		const networkDenialPatch = networkDenialEvidencePatch(networkDenial.value);
		lastFailurePatch = { ...lastFailurePatch, ...networkDenialPatch };
		const cancellationSecret = await opts.host.verifyProbeCancellationAndSecretDestruction(
			probeContainer,
			{ signal: opts.signal },
		);
		if (!cancellationSecret.ok) return failAndCleanup(versionPatch(version.value));
		const cleanupVerified = await cleanupProbeResources(opts.host, probeContainer, probeNetwork);
		probeContainer = undefined;
		probeNetwork = undefined;
		const cancellationSecretPatch = cancellationSecretEvidencePatch(cancellationSecret.value);
		const readyPatch = {
			...versionPatch(version.value),
			...imagePatch,
			...containmentPatch,
			...networkDenialPatch,
			...cancellationSecretPatch,
			cleanupVerified: cleanupVerified && cancellationSecretPatch.cleanupVerified,
			compatibilityVerified: true,
			hostPlatformVerified: true,
			recipeVerified: opts.manifest.recipeRevision === "postgresql-read-only-query-v1",
			attestationRefs: Object.freeze([...D624_ATTESTATION_REFS, ...matrixProofRefs]),
		};
		return preflight(readyPatch);
	} catch {
		const cleanupAttempted = probeContainer !== undefined || probeNetwork !== undefined;
		const cleanupVerified = await cleanupProbeResources(opts.host, probeContainer, probeNetwork);
		return fail({
			...(lastFailurePatch ?? { detectedBackend: "unavailable" }),
			...(cleanupAttempted ? { cleanupVerified } : {}),
		});
	}
}

export function dockerEngineApiV0LocalContainerPostgresqlDriver(
	opts: DockerEngineApiV0LocalContainerPostgresqlDriverOptions,
): LocalContainerPostgresqlDriver {
	return Object.freeze({
		compatibility: LOCAL_CONTAINER_POSTGRESQL_COMPATIBILITY,
		prepare: () => undefined,
		create: async (
			context: LocalContainerPostgresqlDriverContext,
			args: PostgresqlQueryToolArguments,
		): Promise<unknown> => {
			if (!imageRefPinsDigest(opts.imageRef))
				throw new TypeError("Docker image must be digest pinned.");
			const created = await opts.host.createRunContainer({
				imageRef: opts.imageRef,
				args,
				context,
			});
			if (!created.ok) throw new Error("Docker Engine API v0 run container create failed.");
			return created.value;
		},
		start: async (binding: unknown, context: LocalContainerPostgresqlDriverContext) => {
			const result = await opts.host.startRunContainer(binding, context);
			if (!result.ok) throw new Error("Docker Engine API v0 run container start failed.");
		},
		wait: async (
			binding: unknown,
			context: LocalContainerPostgresqlDriverContext,
		): Promise<PostgresqlDriverQueryResult> => {
			const result = await opts.host.waitRunContainer(binding, context);
			if (!result.ok) throw new Error("Docker Engine API v0 run container wait failed.");
			return result.value;
		},
		stop: async (
			binding: unknown,
			context: LocalContainerPostgresqlDriverContext,
			graceMs: number,
		) => {
			const result = await opts.host.stopRunContainer(
				binding,
				terminationContext(context),
				graceMs,
			);
			if (!result.ok) throw new Error("Docker Engine API v0 run container stop failed.");
		},
		kill: async (binding: unknown, context: LocalContainerPostgresqlDriverContext) => {
			const result = await opts.host.killRunContainer(binding, terminationContext(context));
			if (!result.ok) throw new Error("Docker Engine API v0 run container kill failed.");
		},
		remove: async (binding: unknown, context: LocalContainerPostgresqlDriverContext) => {
			const result = await opts.host.removeRunContainer(binding, terminationContext(context));
			if (!result.ok) throw new Error("Docker Engine API v0 run container remove failed.");
		},
		cleanup: () => undefined,
	});
}

function terminationContext(
	context: LocalContainerPostgresqlDriverContext,
): LocalContainerPostgresqlDriverContext {
	return Object.freeze({
		runId: context.runId,
		attempt: context.attempt,
		sessionEpoch: context.sessionEpoch,
		manifestFingerprint: context.manifestFingerprint,
		signal: new AbortController().signal,
	});
}

function versionPatch(
	value: DockerEngineApiV0VersionEvidence,
): Pick<
	LocalContainerPostgresqlDockerEngineApiV0Preflight,
	"detectedBackend" | "engineReachable" | "engineApiRevision" | "engineRevision"
> {
	return {
		detectedBackend: value.detectedBackend,
		engineReachable: value.engineReachable && value.detectedBackend === "docker-engine",
		engineApiRevision: boundedPublicCoordinate(value.engineApiRevision, "docker-api:unavailable"),
		engineRevision: boundedPublicCoordinate(value.engineRevision, "docker-engine:unavailable"),
	};
}

function imageDigestEvidencePatch(
	value: DockerEngineApiV0ImageDigestEvidence,
): Pick<
	LocalContainerPostgresqlDockerEngineApiV0Preflight,
	"imageDigestPresent" | "imageDigestVerified"
> {
	return {
		imageDigestPresent: value.imageDigestPresent === true,
		imageDigestVerified: value.imageDigestVerified === true,
	};
}

function containmentEvidencePatch(
	value: DockerEngineApiV0ContainmentEvidence,
): Pick<
	LocalContainerPostgresqlDockerEngineApiV0Preflight,
	| "isolationVerified"
	| "nonRootUserVerified"
	| "noNewPrivilegesVerified"
	| "readOnlyRootFilesystemVerified"
	| "boundedFilesystemImportVerified"
	| "noEngineSocketMountVerified"
	| "noHostNetworkVerified"
	| "noHostBindMountVerified"
	| "cpuMemoryPidsTimeBoundsVerified"
> {
	return {
		isolationVerified: value.isolationVerified,
		nonRootUserVerified: nonRootUser(value.containerUser),
		noNewPrivilegesVerified: value.noNewPrivilegesVerified,
		readOnlyRootFilesystemVerified: value.readOnlyRootFilesystemVerified,
		boundedFilesystemImportVerified: value.boundedFilesystemImportVerified,
		noEngineSocketMountVerified: value.noEngineSocketMountVerified,
		noHostNetworkVerified: value.noHostNetworkVerified,
		noHostBindMountVerified: value.noHostBindMountVerified,
		cpuMemoryPidsTimeBoundsVerified: value.cpuMemoryPidsTimeBoundsVerified,
	};
}

function networkDenialEvidencePatch(
	value: DockerEngineApiV0NetworkDenialEvidence,
): Pick<
	LocalContainerPostgresqlDockerEngineApiV0Preflight,
	| "destinationPinnedEgressDenyVerified"
	| "metadataEgressDenyVerified"
	| "linkLocalEgressDenyVerified"
	| "loopbackEgressDenyVerified"
	| "hostGatewayEgressDenyVerified"
	| "dnsRebindingResistanceVerified"
> {
	return {
		destinationPinnedEgressDenyVerified: value.destinationPinnedEgressDenyVerified === true,
		metadataEgressDenyVerified: value.metadataEgressDenyVerified === true,
		linkLocalEgressDenyVerified: value.linkLocalEgressDenyVerified === true,
		loopbackEgressDenyVerified: value.loopbackEgressDenyVerified === true,
		hostGatewayEgressDenyVerified: value.hostGatewayEgressDenyVerified === true,
		dnsRebindingResistanceVerified: value.dnsRebindingResistanceVerified === true,
	};
}

function cancellationSecretEvidencePatch(
	value: DockerEngineApiV0CancellationSecretEvidence,
): Pick<
	LocalContainerPostgresqlDockerEngineApiV0Preflight,
	| "cancellationVerified"
	| "cleanupVerified"
	| "artifactResolverReady"
	| "credentialResolverReady"
	| "secretDestructionVerified"
> {
	return {
		cancellationVerified: value.cancellationVerified === true,
		cleanupVerified: value.cleanupVerified === true,
		artifactResolverReady: value.artifactResolverReady === true,
		credentialResolverReady: value.credentialResolverReady === true,
		secretDestructionVerified: value.secretDestructionVerified === true,
	};
}

function imageRefPinsDigest(imageRef: string, digest?: string): boolean {
	if (!SAFE.test(imageRef)) return false;
	if (digest !== undefined) return imageRef.endsWith(`@${digest}`) || imageRef === digest;
	return /sha256:[a-f0-9]{64}$/.test(imageRef);
}

function boundedPublicCoordinate(value: unknown, fallback: string): string {
	return typeof value === "string" && SAFE.test(value) && publicMaterialCoordinate(value)
		? value
		: fallback;
}

function boundedPlatform(value: unknown, fallback: string): string {
	const coordinate = boundedPublicCoordinate(value, fallback);
	return coordinate.startsWith("linux/") ||
		coordinate.startsWith("darwin/") ||
		coordinate.startsWith("windows/")
		? coordinate
		: fallback;
}

function certifiedHostMatrixProofRefs(
	opts: DockerEngineApiV0CertificationProbeOptions,
	version: DockerEngineApiV0VersionEvidence,
): readonly SourceRef[] | undefined {
	if (
		!Array.isArray(opts.certifiedHostMatrix) ||
		opts.certifiedHostMatrix.length === 0 ||
		opts.certifiedHostMatrix.length > 32
	)
		return undefined;
	const hostPlatform = certifiablePlatform(opts.hostPlatform);
	const guestPlatform = certifiablePlatform(opts.guestPlatform);
	const runtimeRevision = certifiablePublicCoordinate(opts.runtimeRevision);
	const engineApiRevision = certifiablePublicCoordinate(version.engineApiRevision);
	const engineRevision = certifiablePublicCoordinate(version.engineRevision);
	if (
		hostPlatform === undefined ||
		guestPlatform === undefined ||
		runtimeRevision === undefined ||
		engineApiRevision === undefined ||
		engineRevision === undefined
	)
		return undefined;
	const vmRequired = hostPlatform.startsWith("darwin/") || hostPlatform.startsWith("windows/");
	const vmRuntimeRevision =
		opts.vmRuntimeRevision === undefined
			? undefined
			: certifiablePublicCoordinate(opts.vmRuntimeRevision);
	if (vmRequired && vmRuntimeRevision === undefined) return undefined;
	if (!vmRequired && opts.vmRuntimeRevision !== undefined) return undefined;
	for (const entry of opts.certifiedHostMatrix) {
		const matrixEntry = dockerEngineApiV0CertifiedHostMatrixEntry(entry);
		if (matrixEntry === undefined) continue;
		if (
			matrixEntry.hostPlatform !== hostPlatform ||
			matrixEntry.guestPlatform !== guestPlatform ||
			matrixEntry.runtimeRevision !== runtimeRevision ||
			matrixEntry.engineApiRevision !== engineApiRevision ||
			matrixEntry.engineRevision !== engineRevision
		)
			continue;
		if (vmRequired) {
			if (
				matrixEntry.vmRuntimeRevision === undefined ||
				matrixEntry.vmRuntimeRevision !== vmRuntimeRevision
			)
				continue;
		} else if (matrixEntry.vmRuntimeRevision !== undefined) {
			continue;
		}
		return matrixEntry.proofRefs;
	}
	return undefined;
}

function certifiablePublicCoordinate(value: unknown): string | undefined {
	if (typeof value !== "string" || !SAFE.test(value) || !publicMaterialCoordinate(value))
		return undefined;
	const lower = value.toLowerCase();
	return lower.includes("unavailable") || lower.includes("unknown") ? undefined : value;
}

function certifiablePlatform(value: unknown): string | undefined {
	const coordinate = certifiablePublicCoordinate(value);
	if (
		coordinate === undefined ||
		!(
			coordinate.startsWith("linux/") ||
			coordinate.startsWith("darwin/") ||
			coordinate.startsWith("windows/")
		)
	)
		return undefined;
	return coordinate;
}

function publicMatrixProofRefs(value: unknown): readonly SourceRef[] | undefined {
	if (!Array.isArray(value) || value.length === 0 || value.length > 8) return undefined;
	const refs: SourceRef[] = [];
	const seen = new Set<string>();
	for (const ref of value) {
		if (
			!plainPublicRef(ref) ||
			ref.kind !== "attestation" ||
			!ref.id.startsWith("docker-engine-api-v0:host-matrix:")
		)
			return undefined;
		const key = `${ref.kind}:${ref.id}`;
		if (seen.has(key)) return undefined;
		seen.add(key);
		refs.push(Object.freeze({ kind: ref.kind, id: ref.id }));
	}
	return Object.freeze(refs);
}

function plainPublicRef(value: SourceRef): boolean {
	return (
		typeof value === "object" &&
		value !== null &&
		typeof value.kind === "string" &&
		typeof value.id === "string" &&
		!("metadata" in value) &&
		publicMaterialCoordinate(value.kind) &&
		publicMaterialCoordinate(value.id)
	);
}

function publicMaterialCoordinate(value: unknown): value is string {
	if (typeof value !== "string" || !SAFE.test(value)) return false;
	const lower = value.toLowerCase();
	const compact = lower.replace(/[^a-z0-9]+/g, "");
	const tokens = lower.split(/[^a-z0-9]+/u).filter(Boolean);
	return (
		!PRIVATE_COMPACT_MATERIAL.some((term) => compact.includes(term)) &&
		!tokens.some((token) => PRIVATE_TOKEN_MATERIAL.includes(token))
	);
}

function nonRootUser(value: string): boolean {
	const lower = value.trim().toLowerCase();
	if (lower === "" || lower === "root" || lower === "0") return false;
	const first = lower.split(":")[0];
	return first !== "0" && first !== "root";
}

async function cleanupProbeResources(
	host: DockerEngineApiV0LocalContainerPostgresqlCertificationHost,
	container: unknown,
	network: unknown,
): Promise<boolean> {
	let ok = true;
	if (container !== undefined) {
		try {
			const removed = await host.removeProbeContainer(container);
			ok = ok && removed.ok;
		} catch {
			ok = false;
		}
	}
	if (network !== undefined) {
		try {
			const removed = await host.removeProbeNetwork(network);
			ok = ok && removed.ok;
		} catch {
			ok = false;
		}
	}
	return ok;
}
