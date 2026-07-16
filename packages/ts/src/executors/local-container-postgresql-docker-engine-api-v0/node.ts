/** Node-local D624 Docker Engine API v0 certification entry. */
import { Buffer } from "node:buffer";
import { randomUUID } from "node:crypto";
import { request as httpRequest } from "node:http";
import type {
	LocalContainerPostgresqlDockerEngineApiV0Preflight,
	LocalContainerPostgresqlManifest,
} from "../local-container-postgresql.js";
import {
	certifyDockerEngineApiV0LocalContainerPostgresql,
	type DockerEngineApiV0CancellationSecretEvidence,
	type DockerEngineApiV0CertificationProbeOptions,
	type DockerEngineApiV0ContainmentEvidence,
	type DockerEngineApiV0HostResult,
	type DockerEngineApiV0ImageDigestEvidence,
	type DockerEngineApiV0LocalContainerPostgresqlCertificationHost,
	type DockerEngineApiV0NetworkDenialEvidence,
	type DockerEngineApiV0VersionEvidence,
} from "../local-container-postgresql-docker-engine-api-v0.js";

export const DOCKER_ENGINE_API_V0_NODE_LOCAL_CERTIFIER_COMPATIBILITY =
	"graphrefly-local-container-postgresql-docker-engine-api-v0-node-local-certifier-v1" as const;

export interface DockerEngineApiV0NodeLocalCertificationProofs {
	inspectProbeContainment(
		probe: unknown,
		opts: { readonly signal?: AbortSignal },
	):
		| DockerEngineApiV0HostResult<DockerEngineApiV0ContainmentEvidence>
		| PromiseLike<DockerEngineApiV0HostResult<DockerEngineApiV0ContainmentEvidence>>;
	verifyProbeNetworkDenials(
		probe: unknown,
		opts: { readonly signal?: AbortSignal },
	):
		| DockerEngineApiV0HostResult<DockerEngineApiV0NetworkDenialEvidence>
		| PromiseLike<DockerEngineApiV0HostResult<DockerEngineApiV0NetworkDenialEvidence>>;
	verifyProbeCancellationAndSecretDestruction(
		probe: unknown,
		opts: { readonly signal?: AbortSignal },
	):
		| DockerEngineApiV0HostResult<DockerEngineApiV0CancellationSecretEvidence>
		| PromiseLike<DockerEngineApiV0HostResult<DockerEngineApiV0CancellationSecretEvidence>>;
}

export interface DockerEngineApiV0NodeLocalCertificationOptions
	extends DockerEngineApiV0CertificationProbeOptions {
	readonly manifest: LocalContainerPostgresqlManifest;
	readonly imageRef: string;
	readonly proofs: DockerEngineApiV0NodeLocalCertificationProofs;
	readonly requestTimeoutMs?: number;
	readonly maxResponseBytes?: number;
}

interface DockerHttpOptions {
	readonly requestTimeoutMs: number;
	readonly maxResponseBytes: number;
}

interface DockerProbeNetworkPublicHandle {
	readonly kind: "docker-engine-api-v0-node-local-probe-network";
}

interface DockerProbeNetworkPrivateHandle {
	/** Docker resource id when it is safely bounded; otherwise the generated private resource name. */
	readonly id: string;
	readonly name: string;
	readonly requestPolicy: DockerProbeNetworkRequestPolicy;
	readonly createEnvelopeVerified: boolean;
}

interface DockerProbeNetworkRequest {
	readonly body: Record<string, unknown>;
	readonly policy: DockerProbeNetworkRequestPolicy;
}

interface DockerProbeNetworkRequestPolicy {
	readonly internalNetworkRequested: boolean;
	readonly noAttachableNetworkRequested: boolean;
	readonly noIngressNetworkRequested: boolean;
	readonly noIpv6NetworkRequested: boolean;
}

interface DockerProbeContainerPublicHandle {
	readonly kind: "docker-engine-api-v0-node-local-probe-container";
}

interface DockerProbeContainerPrivateHandle {
	/** Docker resource id when it is safely bounded; otherwise the generated private resource name. */
	readonly id: string;
	readonly name: string;
	readonly network: DockerProbeNetworkPrivateHandle;
	readonly requestPolicy: DockerProbeContainerRequestPolicy;
	readonly createEnvelopeVerified: boolean;
}

interface DockerProbeContainerRequest {
	readonly body: Record<string, unknown>;
	readonly policy: DockerProbeContainerRequestPolicy;
}

interface DockerProbeContainerRequestPolicy {
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

const DOCKER_ENGINE_SOCKET_PATH = "/var/run/docker.sock";
const DEFAULT_REQUEST_TIMEOUT_MS = 10_000;
const MAX_REQUEST_TIMEOUT_MS = 30_000;
const DEFAULT_MAX_RESPONSE_BYTES = 128 * 1024;
const MAX_RESPONSE_BYTES = 1024 * 1024;
const PROBE_CONTAINER_USER = "65532:65532";
const PROBE_CONTAINER_STOP_TIMEOUT_SECONDS = 5;
const PROBE_CONTAINER_MEMORY_BYTES = 128 * 1024 * 1024;
const PROBE_CONTAINER_CPU_PERIOD = 100_000;
const PROBE_CONTAINER_CPU_QUOTA = 50_000;
const PROBE_CONTAINER_PIDS_LIMIT = 64;
const DOCKER_PATH_SAFE = /^[A-Za-z0-9._~:/@+-]+$/;
const DOCKER_ID_SAFE = /^[a-f0-9]{12,64}$/i;
const DOCKER_PUBLIC_REVISION_SAFE = /^[A-Za-z0-9][A-Za-z0-9._:+-]{0,127}$/;
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
const probeNetworks = new WeakMap<object, DockerProbeNetworkPrivateHandle>();
const probeContainers = new WeakMap<object, DockerProbeContainerPrivateHandle>();
const CONTAINMENT_EVIDENCE_KEYS = [
	"isolationVerified",
	"containerUser",
	"noNewPrivilegesVerified",
	"readOnlyRootFilesystemVerified",
	"boundedFilesystemImportVerified",
	"noEngineSocketMountVerified",
	"noHostNetworkVerified",
	"noHostBindMountVerified",
	"cpuMemoryPidsTimeBoundsVerified",
] as const;
const NETWORK_DENIAL_EVIDENCE_KEYS = [
	"destinationPinnedEgressDenyVerified",
	"metadataEgressDenyVerified",
	"linkLocalEgressDenyVerified",
	"loopbackEgressDenyVerified",
	"hostGatewayEgressDenyVerified",
	"dnsRebindingResistanceVerified",
] as const;
const CANCELLATION_SECRET_EVIDENCE_KEYS = [
	"cancellationVerified",
	"cleanupVerified",
	"artifactResolverReady",
	"credentialResolverReady",
	"secretDestructionVerified",
] as const;

export async function certifyDockerEngineApiV0LocalContainerPostgresqlWithNodeLocalDocker(
	opts: DockerEngineApiV0NodeLocalCertificationOptions,
): Promise<LocalContainerPostgresqlDockerEngineApiV0Preflight> {
	const http = {
		requestTimeoutMs: boundedIntegerRange(
			opts.requestTimeoutMs,
			DEFAULT_REQUEST_TIMEOUT_MS,
			1,
			MAX_REQUEST_TIMEOUT_MS,
		),
		maxResponseBytes: boundedIntegerRange(
			opts.maxResponseBytes,
			DEFAULT_MAX_RESPONSE_BYTES,
			1,
			MAX_RESPONSE_BYTES,
		),
	};
	const host = nodeLocalCertificationHost(opts.proofs, http);
	return certifyDockerEngineApiV0LocalContainerPostgresql({
		manifest: opts.manifest,
		host,
		imageRef: opts.imageRef,
		hostPlatform: opts.hostPlatform,
		guestPlatform: opts.guestPlatform,
		runtimeRevision: opts.runtimeRevision,
		certifiedHostMatrix: opts.certifiedHostMatrix,
		...(opts.vmRuntimeRevision === undefined ? {} : { vmRuntimeRevision: opts.vmRuntimeRevision }),
		observedAtMs: opts.observedAtMs,
		ttlMs: opts.ttlMs,
		probeLabel: opts.probeLabel,
		signal: opts.signal,
	});
}

function nodeLocalCertificationHost(
	proofs: DockerEngineApiV0NodeLocalCertificationProofs,
	http: DockerHttpOptions,
): DockerEngineApiV0LocalContainerPostgresqlCertificationHost {
	return {
		readVersion: async (opts) => {
			const response = await dockerJsonObjectRequest(
				"GET",
				"/version",
				undefined,
				http,
				opts.signal,
			);
			if (!response.ok) return { ok: false, detectedBackend: "unavailable" };
			return ok(versionEvidence(response.value));
		},
		inspectImageDigest: async (opts) => {
			const response = await dockerJsonObjectRequest(
				"GET",
				`/images/${dockerPathSegment(opts.imageRef)}/json`,
				undefined,
				http,
				opts.signal,
			);
			if (!response.ok) return { ok: false };
			return ok(imageDigestEvidence(response.value, opts.imageDigest));
		},
		createProbeNetwork: async (opts) => {
			const name = `graphrefly-d624-${randomUUID()}`;
			const request = probeNetworkCreateRequest(name, opts.probeLabel);
			const response = await dockerJsonObjectRequest(
				"POST",
				"/networks/create",
				request.body,
				http,
				opts.signal,
			);
			if (!response.ok) return { ok: false };
			const resource = dockerCreateResourceResponse(response.value, name);
			return ok(
				probeNetworkToken({
					id: resource.ok ? resource.id : resource.cleanupId,
					name,
					requestPolicy: request.policy,
					createEnvelopeVerified: resource.ok,
				}),
			);
		},
		createProbeContainer: async (opts) => {
			const network = probeNetworkPrivate(opts.network);
			if (network === undefined || !network.createEnvelopeVerified) return { ok: false };
			const name = `graphrefly-d624-${randomUUID()}`;
			const request = probeContainerCreateRequest(opts.imageRef, network.name, opts.probeLabel);
			const response = await dockerJsonObjectRequest(
				"POST",
				`/containers/create?name=${dockerQueryValue(name)}`,
				request.body,
				http,
				opts.signal,
			);
			if (!response.ok) return { ok: false };
			const resource = dockerCreateResourceResponse(response.value, name);
			return ok(
				probeContainerToken({
					id: resource.ok ? resource.id : resource.cleanupId,
					name,
					network,
					requestPolicy: request.policy,
					createEnvelopeVerified: resource.ok,
				}),
			);
		},
		inspectProbeContainment: async (container, opts) => {
			const privateContainer = probeContainerPrivate(container);
			if (privateContainer === undefined || !privateContainer.createEnvelopeVerified)
				return { ok: false };
			const inspected = await dockerJsonObjectRequest(
				"GET",
				`/containers/${dockerPathSegment(privateContainer.id)}/json`,
				undefined,
				http,
				opts.signal,
			);
			const inspectedEvidence = inspected.ok
				? dockerInspectContainmentEvidence(inspected.value, privateContainer)
				: undefined;
			if (inspectedEvidence === undefined) return { ok: false };
			const proof = await proofs.inspectProbeContainment(container, opts);
			if (!proof.ok) return proof;
			const evidence = dockerEngineApiV0ContainmentEvidence(proof.value);
			return evidence === undefined
				? { ok: false }
				: ok(
						boundContainmentEvidenceToProbeRequest(
							combineContainmentEvidence(evidence, inspectedEvidence),
							privateContainer.requestPolicy,
						),
					);
		},
		startProbeContainer: async (container, opts) => {
			const privateContainer = probeContainerPrivate(container);
			return privateContainer !== undefined
				? dockerAcceptedRequest(
						"POST",
						`/containers/${dockerPathSegment(privateContainer.id)}/start`,
						undefined,
						[204],
						http,
						opts.signal,
					)
				: { ok: false };
		},
		waitProbeContainer: async (container, opts) => {
			const privateContainer = probeContainerPrivate(container);
			if (privateContainer === undefined) return { ok: false };
			const response = await dockerJsonObjectRequest(
				"POST",
				`/containers/${dockerPathSegment(privateContainer.id)}/wait`,
				undefined,
				http,
				opts.signal,
			);
			return response.ok && waitProbeContainerSucceeded(response.value)
				? ok(undefined)
				: { ok: false };
		},
		verifyProbeNetworkDenials: async (container, opts) => {
			const privateContainer = probeContainerPrivate(container);
			if (privateContainer === undefined) return { ok: false };
			const inspected = await dockerJsonObjectRequest(
				"GET",
				`/networks/${dockerPathSegment(privateContainer.network.id)}`,
				undefined,
				http,
				opts.signal,
			);
			const inspectedPolicy = inspected.ok
				? dockerInspectNetworkRequestPolicy(inspected.value, privateContainer.network)
				: undefined;
			if (inspectedPolicy === undefined) return { ok: false };
			const proof = await proofs.verifyProbeNetworkDenials(container, opts);
			if (!proof.ok) return proof;
			const evidence = dockerEngineApiV0NetworkDenialEvidence(proof.value);
			return evidence === undefined
				? { ok: false }
				: ok(
						boundNetworkEvidenceToProbeRequest(
							evidence,
							combineNetworkRequestPolicy(privateContainer.network.requestPolicy, inspectedPolicy),
						),
					);
		},
		verifyProbeCancellationAndSecretDestruction: async (container, opts) => {
			const privateContainer = probeContainerPrivate(container);
			if (privateContainer === undefined) return { ok: false };
			const inspected = await dockerJsonObjectRequest(
				"GET",
				`/containers/${dockerPathSegment(privateContainer.id)}/json`,
				undefined,
				http,
				opts.signal,
			);
			const inspectedEvidence = inspected.ok
				? dockerInspectCancellationSecretEvidence(inspected.value, privateContainer)
				: undefined;
			if (inspectedEvidence === undefined) return { ok: false };
			const proof = await proofs.verifyProbeCancellationAndSecretDestruction(container, opts);
			if (!proof.ok) return proof;
			const evidence = dockerEngineApiV0CancellationSecretEvidence(proof.value);
			return evidence === undefined
				? { ok: false }
				: ok(
						boundCancellationSecretEvidenceToProbeRequest(
							combineCancellationSecretEvidence(evidence, inspectedEvidence),
							privateContainer.requestPolicy,
						),
					);
		},
		removeProbeContainer: (container, opts) => {
			const privateContainer = probeContainerPrivate(container);
			return privateContainer !== undefined
				? dockerAcceptedRequest(
						"DELETE",
						`/containers/${dockerPathSegment(privateContainer.id)}?force=true&v=true`,
						undefined,
						[204, 404],
						http,
						opts?.signal,
					)
				: { ok: false };
		},
		removeProbeNetwork: (network, opts) => {
			const privateNetwork = probeNetworkPrivate(network);
			return privateNetwork !== undefined
				? dockerAcceptedRequest(
						"DELETE",
						`/networks/${dockerPathSegment(privateNetwork.id)}`,
						undefined,
						[204, 404],
						http,
						opts?.signal,
					)
				: { ok: false };
		},
	};
}

function versionEvidence(value: Record<string, unknown>): DockerEngineApiV0VersionEvidence {
	const engineVersion = publicDockerRevisionValue(value.Version);
	const engineApiVersion = publicDockerRevisionValue(value.ApiVersion);
	const detectedBackend = backendName(value, engineApiVersion !== undefined);
	return {
		detectedBackend,
		engineReachable: engineApiVersion !== undefined && detectedBackend !== "unavailable",
		engineApiRevision: prefixedDockerRevision("docker-api", engineApiVersion),
		engineRevision: prefixedDockerRevision(detectedBackend, engineVersion),
	};
}

function imageDigestEvidence(
	value: Record<string, unknown>,
	imageDigest: string,
): DockerEngineApiV0ImageDigestEvidence {
	const repoDigests = Array.isArray(value.RepoDigests) ? value.RepoDigests : [];
	if (!repoDigests.every((v): v is string => typeof v === "string"))
		return { imageDigestPresent: false, imageDigestVerified: false };
	if (repoDigests.some((ref) => containsPrivateMaterial(ref)))
		return { imageDigestPresent: false, imageDigestVerified: false };
	const imageDigestPresent = repoDigests.some(
		(ref) => ref === imageDigest || ref.endsWith(`@${imageDigest}`),
	);
	return { imageDigestPresent, imageDigestVerified: imageDigestPresent };
}

function waitProbeContainerSucceeded(value: Record<string, unknown>): boolean {
	if (!Object.keys(value).every((key) => key === "StatusCode" || key === "Error")) return false;
	if (value.StatusCode !== 0) return false;
	return !("Error" in value) || value.Error === null;
}

function dockerCreateResourceResponse(
	value: Record<string, unknown>,
	fallbackName: string,
): { readonly ok: true; readonly id: string } | { readonly ok: false; readonly cleanupId: string } {
	const rawId = stringValue(value.Id);
	const id = dockerIdSafe(rawId) ? rawId : undefined;
	const cleanupId = id ?? fallbackName;
	const warnings = value.Warnings;
	const warningsAccepted =
		warnings === undefined ||
		warnings === null ||
		(Array.isArray(warnings) && warnings.length === 0);
	const envelopeAccepted =
		id !== undefined &&
		Object.keys(value).every((key) => key === "Id" || key === "Warnings") &&
		warningsAccepted;
	return envelopeAccepted ? { ok: true, id } : { ok: false, cleanupId };
}

function probeNetworkCreateRequest(
	name: string,
	probeLabel: string | undefined,
): DockerProbeNetworkRequest {
	const body = {
		Name: name,
		CheckDuplicate: false,
		Internal: true,
		Attachable: false,
		Ingress: false,
		EnableIPv6: false,
		Labels: probeDockerLabels(probeLabel),
	} as const satisfies Record<string, unknown>;
	return {
		body,
		policy: Object.freeze({
			internalNetworkRequested: body.Internal === true,
			noAttachableNetworkRequested: body.Attachable === false,
			noIngressNetworkRequested: body.Ingress === false,
			noIpv6NetworkRequested: body.EnableIPv6 === false,
		}),
	};
}

function probeContainerCreateRequest(
	imageRef: string,
	networkName: string,
	probeLabel: string | undefined,
): DockerProbeContainerRequest {
	const body = {
		Image: imageRef,
		User: PROBE_CONTAINER_USER,
		Cmd: ["sh", "-ec", 'test "$(id -u)" != "0"'],
		Env: [],
		AttachStdout: false,
		AttachStderr: false,
		OpenStdin: false,
		Tty: false,
		StopTimeout: PROBE_CONTAINER_STOP_TIMEOUT_SECONDS,
		HostConfig: {
			NetworkMode: networkName,
			Privileged: false,
			ReadonlyRootfs: true,
			SecurityOpt: ["no-new-privileges"],
			CapDrop: ["ALL"],
			AutoRemove: false,
			PublishAllPorts: false,
			Memory: PROBE_CONTAINER_MEMORY_BYTES,
			CpuPeriod: PROBE_CONTAINER_CPU_PERIOD,
			CpuQuota: PROBE_CONTAINER_CPU_QUOTA,
			PidsLimit: PROBE_CONTAINER_PIDS_LIMIT,
		},
		NetworkingConfig: {
			EndpointsConfig: {
				[networkName]: {},
			},
		},
		Labels: probeDockerLabels(probeLabel),
	} as const satisfies Record<string, unknown>;
	return {
		body,
		policy: Object.freeze(probeContainerRequestPolicy(body, networkName)),
	};
}

function probeContainerRequestPolicy(
	body: Record<string, unknown>,
	networkName: string,
): DockerProbeContainerRequestPolicy {
	const hostConfig = plainObject(body.HostConfig);
	const cmd = Array.isArray(body.Cmd) ? body.Cmd : [];
	const securityOpt = Array.isArray(hostConfig?.SecurityOpt) ? hostConfig.SecurityOpt : [];
	const capDrop = Array.isArray(hostConfig?.CapDrop) ? hostConfig.CapDrop : [];
	const bodyJson = JSON.stringify(body);
	return {
		nonRootUserRequested: body.User === PROBE_CONTAINER_USER,
		rootUserProbeFails:
			cmd.length === 3 &&
			cmd[0] === "sh" &&
			cmd[1] === "-ec" &&
			cmd[2] === 'test "$(id -u)" != "0"',
		noNewPrivilegesRequested: securityOpt.includes("no-new-privileges"),
		capabilitiesDroppedRequested: capDrop.length === 1 && capDrop[0] === "ALL",
		noPrivilegedModeRequested: hostConfig?.Privileged === false,
		readOnlyRootFilesystemRequested: hostConfig?.ReadonlyRootfs === true,
		boundedFilesystemImportRequested:
			body.OpenStdin === false &&
			hostConfig?.AutoRemove === false &&
			!("Volumes" in body) &&
			!("Mounts" in body),
		noEngineSocketMountRequested: !bodyJson.includes(DOCKER_ENGINE_SOCKET_PATH),
		noHostNetworkRequested: hostConfig?.NetworkMode === networkName && networkName !== "host",
		noHostBindMountRequested:
			hostConfig !== undefined &&
			!("Binds" in hostConfig) &&
			!bodyJson.includes(DOCKER_ENGINE_SOCKET_PATH),
		noPortPublicationRequested:
			hostConfig?.PublishAllPorts === false &&
			!("PortBindings" in hostConfig) &&
			!("ExposedPorts" in body),
		noEnvironmentMaterialRequested: Array.isArray(body.Env) && body.Env.length === 0,
		cpuMemoryPidsTimeBoundsRequested:
			hostConfig?.Memory === PROBE_CONTAINER_MEMORY_BYTES &&
			hostConfig?.CpuPeriod === PROBE_CONTAINER_CPU_PERIOD &&
			hostConfig?.CpuQuota === PROBE_CONTAINER_CPU_QUOTA &&
			hostConfig?.PidsLimit === PROBE_CONTAINER_PIDS_LIMIT &&
			body.StopTimeout === PROBE_CONTAINER_STOP_TIMEOUT_SECONDS,
	};
}

function boundContainmentEvidenceToProbeRequest(
	value: DockerEngineApiV0ContainmentEvidence,
	policy: DockerProbeContainerRequestPolicy,
): DockerEngineApiV0ContainmentEvidence {
	const nonRootRequestBounded = policy.nonRootUserRequested && policy.rootUserProbeFails;
	const isolationVerified =
		value.isolationVerified &&
		nonRootRequestBounded &&
		policy.noPrivilegedModeRequested &&
		policy.noNewPrivilegesRequested &&
		policy.capabilitiesDroppedRequested &&
		policy.readOnlyRootFilesystemRequested &&
		policy.boundedFilesystemImportRequested &&
		policy.noEngineSocketMountRequested &&
		policy.noHostNetworkRequested &&
		policy.noHostBindMountRequested &&
		policy.noPortPublicationRequested &&
		policy.cpuMemoryPidsTimeBoundsRequested;
	return {
		isolationVerified,
		containerUser: nonRootRequestBounded ? value.containerUser : "0",
		noNewPrivilegesVerified: value.noNewPrivilegesVerified && policy.noNewPrivilegesRequested,
		readOnlyRootFilesystemVerified:
			value.readOnlyRootFilesystemVerified && policy.readOnlyRootFilesystemRequested,
		boundedFilesystemImportVerified:
			value.boundedFilesystemImportVerified && policy.boundedFilesystemImportRequested,
		noEngineSocketMountVerified:
			value.noEngineSocketMountVerified && policy.noEngineSocketMountRequested,
		noHostNetworkVerified: value.noHostNetworkVerified && policy.noHostNetworkRequested,
		noHostBindMountVerified: value.noHostBindMountVerified && policy.noHostBindMountRequested,
		cpuMemoryPidsTimeBoundsVerified:
			value.cpuMemoryPidsTimeBoundsVerified && policy.cpuMemoryPidsTimeBoundsRequested,
	};
}

function combineContainmentEvidence(
	proof: DockerEngineApiV0ContainmentEvidence,
	inspected: DockerEngineApiV0ContainmentEvidence,
): DockerEngineApiV0ContainmentEvidence {
	return {
		isolationVerified: proof.isolationVerified && inspected.isolationVerified,
		containerUser: proof.containerUser,
		noNewPrivilegesVerified: proof.noNewPrivilegesVerified && inspected.noNewPrivilegesVerified,
		readOnlyRootFilesystemVerified:
			proof.readOnlyRootFilesystemVerified && inspected.readOnlyRootFilesystemVerified,
		boundedFilesystemImportVerified:
			proof.boundedFilesystemImportVerified && inspected.boundedFilesystemImportVerified,
		noEngineSocketMountVerified:
			proof.noEngineSocketMountVerified && inspected.noEngineSocketMountVerified,
		noHostNetworkVerified: proof.noHostNetworkVerified && inspected.noHostNetworkVerified,
		noHostBindMountVerified: proof.noHostBindMountVerified && inspected.noHostBindMountVerified,
		cpuMemoryPidsTimeBoundsVerified:
			proof.cpuMemoryPidsTimeBoundsVerified && inspected.cpuMemoryPidsTimeBoundsVerified,
	};
}

function combineCancellationSecretEvidence(
	proof: DockerEngineApiV0CancellationSecretEvidence,
	inspected: DockerEngineApiV0CancellationSecretEvidence,
): DockerEngineApiV0CancellationSecretEvidence {
	return {
		cancellationVerified: proof.cancellationVerified && inspected.cancellationVerified,
		cleanupVerified: proof.cleanupVerified,
		artifactResolverReady: proof.artifactResolverReady && inspected.artifactResolverReady,
		credentialResolverReady: proof.credentialResolverReady && inspected.credentialResolverReady,
		secretDestructionVerified:
			proof.secretDestructionVerified && inspected.secretDestructionVerified,
	};
}

if (process.env.VITEST !== undefined) {
	Object.defineProperty(
		certifyDockerEngineApiV0LocalContainerPostgresqlWithNodeLocalDocker,
		"__graphreflyTestHooks",
		{
			value: Object.freeze({
				boundContainmentEvidenceToProbeRequest,
				boundCancellationSecretEvidenceToProbeRequest,
				boundNetworkEvidenceToProbeRequest,
			}),
		},
	);
}

function boundCancellationSecretEvidenceToProbeRequest(
	value: DockerEngineApiV0CancellationSecretEvidence,
	policy: DockerProbeContainerRequestPolicy,
): DockerEngineApiV0CancellationSecretEvidence {
	const cancellationRequestBounded =
		policy.nonRootUserRequested &&
		policy.noPrivilegedModeRequested &&
		policy.noNewPrivilegesRequested &&
		policy.capabilitiesDroppedRequested &&
		policy.cpuMemoryPidsTimeBoundsRequested;
	const artifactResolverRequestBounded =
		policy.boundedFilesystemImportRequested &&
		policy.readOnlyRootFilesystemRequested &&
		policy.noEngineSocketMountRequested &&
		policy.noHostBindMountRequested;
	const secretMaterialRequestBounded =
		cancellationRequestBounded &&
		artifactResolverRequestBounded &&
		policy.boundedFilesystemImportRequested &&
		policy.noEngineSocketMountRequested &&
		policy.noHostBindMountRequested &&
		policy.noHostNetworkRequested &&
		policy.noPortPublicationRequested &&
		policy.noEnvironmentMaterialRequested &&
		policy.cpuMemoryPidsTimeBoundsRequested;
	return {
		cancellationVerified: value.cancellationVerified && cancellationRequestBounded,
		cleanupVerified: value.cleanupVerified,
		artifactResolverReady: value.artifactResolverReady && artifactResolverRequestBounded,
		credentialResolverReady: value.credentialResolverReady && secretMaterialRequestBounded,
		secretDestructionVerified: value.secretDestructionVerified && secretMaterialRequestBounded,
	};
}

function boundNetworkEvidenceToProbeRequest(
	value: DockerEngineApiV0NetworkDenialEvidence,
	policy: DockerProbeNetworkRequestPolicy,
): DockerEngineApiV0NetworkDenialEvidence {
	const denyByDefaultNetworkRequested =
		policy.internalNetworkRequested &&
		policy.noAttachableNetworkRequested &&
		policy.noIngressNetworkRequested &&
		policy.noIpv6NetworkRequested;
	return {
		destinationPinnedEgressDenyVerified:
			value.destinationPinnedEgressDenyVerified && denyByDefaultNetworkRequested,
		metadataEgressDenyVerified: value.metadataEgressDenyVerified && denyByDefaultNetworkRequested,
		linkLocalEgressDenyVerified: value.linkLocalEgressDenyVerified && denyByDefaultNetworkRequested,
		loopbackEgressDenyVerified: value.loopbackEgressDenyVerified && denyByDefaultNetworkRequested,
		hostGatewayEgressDenyVerified:
			value.hostGatewayEgressDenyVerified && denyByDefaultNetworkRequested,
		dnsRebindingResistanceVerified:
			value.dnsRebindingResistanceVerified && denyByDefaultNetworkRequested,
	};
}

function combineNetworkRequestPolicy(
	requested: DockerProbeNetworkRequestPolicy,
	inspected: DockerProbeNetworkRequestPolicy,
): DockerProbeNetworkRequestPolicy {
	return Object.freeze({
		internalNetworkRequested:
			requested.internalNetworkRequested && inspected.internalNetworkRequested,
		noAttachableNetworkRequested:
			requested.noAttachableNetworkRequested && inspected.noAttachableNetworkRequested,
		noIngressNetworkRequested:
			requested.noIngressNetworkRequested && inspected.noIngressNetworkRequested,
		noIpv6NetworkRequested: requested.noIpv6NetworkRequested && inspected.noIpv6NetworkRequested,
	});
}

function dockerEngineApiV0ContainmentEvidence(
	value: unknown,
): DockerEngineApiV0ContainmentEvidence | undefined {
	const record = plainObject(value);
	if (record === undefined || !onlyKeys(record, CONTAINMENT_EVIDENCE_KEYS)) return undefined;
	if (
		!booleanFields(record, [
			"isolationVerified",
			"noNewPrivilegesVerified",
			"readOnlyRootFilesystemVerified",
			"boundedFilesystemImportVerified",
			"noEngineSocketMountVerified",
			"noHostNetworkVerified",
			"noHostBindMountVerified",
			"cpuMemoryPidsTimeBoundsVerified",
		] as const) ||
		typeof record.containerUser !== "string" ||
		record.containerUser.length === 0 ||
		record.containerUser.length > 64 ||
		!DOCKER_PATH_SAFE.test(record.containerUser) ||
		publicProbeLabel(record.containerUser) !== record.containerUser
	)
		return undefined;
	return Object.freeze({
		isolationVerified: record.isolationVerified,
		containerUser: record.containerUser,
		noNewPrivilegesVerified: record.noNewPrivilegesVerified,
		readOnlyRootFilesystemVerified: record.readOnlyRootFilesystemVerified,
		boundedFilesystemImportVerified: record.boundedFilesystemImportVerified,
		noEngineSocketMountVerified: record.noEngineSocketMountVerified,
		noHostNetworkVerified: record.noHostNetworkVerified,
		noHostBindMountVerified: record.noHostBindMountVerified,
		cpuMemoryPidsTimeBoundsVerified: record.cpuMemoryPidsTimeBoundsVerified,
	});
}

function dockerInspectContainmentEvidence(
	value: unknown,
	privateContainer: DockerProbeContainerPrivateHandle,
): DockerEngineApiV0ContainmentEvidence | undefined {
	const record = plainObject(value);
	const config = plainObject(record?.Config);
	const hostConfig = plainObject(record?.HostConfig);
	const mounts = Array.isArray(record?.Mounts) ? record.Mounts : undefined;
	const securityOpt = stringArray(hostConfig?.SecurityOpt);
	const capDrop = stringArray(hostConfig?.CapDrop);
	const binds = optionalStringArray(hostConfig?.Binds);
	if (
		record === undefined ||
		config === undefined ||
		hostConfig === undefined ||
		!dockerInspectContainerIdentityVerified(record, config, privateContainer) ||
		mounts === undefined ||
		!mounts.every((mount) => plainObject(mount) !== undefined) ||
		securityOpt === undefined ||
		capDrop === undefined ||
		binds === undefined
	)
		return undefined;
	const inspectedJson = JSON.stringify({
		Config: config,
		HostConfig: hostConfig,
		Mounts: mounts,
	});
	if (inspectedJson.includes(DOCKER_ENGINE_SOCKET_PATH)) return undefined;
	const user = stringValue(config.User);
	if (user === undefined || publicProbeLabel(user) !== user) return undefined;
	const noHostBindMountVerified =
		binds.length === 0 && mounts.length === 0 && !("Mounts" in hostConfig);
	const boundedFilesystemImportVerified =
		config.OpenStdin === false &&
		hostConfig.AutoRemove === false &&
		(config.Volumes === undefined || config.Volumes === null) &&
		noHostBindMountVerified;
	const noEngineSocketMountVerified =
		!inspectedJson.includes(DOCKER_ENGINE_SOCKET_PATH) && noHostBindMountVerified;
	const noHostNetworkVerified =
		hostConfig.NetworkMode === privateContainer.network.name &&
		privateContainer.network.name !== "host";
	const noNewPrivilegesVerified = securityOpt.includes("no-new-privileges");
	const readOnlyRootFilesystemVerified = hostConfig.ReadonlyRootfs === true;
	const cpuMemoryPidsTimeBoundsVerified =
		hostConfig.Memory === PROBE_CONTAINER_MEMORY_BYTES &&
		hostConfig.CpuPeriod === PROBE_CONTAINER_CPU_PERIOD &&
		hostConfig.CpuQuota === PROBE_CONTAINER_CPU_QUOTA &&
		hostConfig.PidsLimit === PROBE_CONTAINER_PIDS_LIMIT;
	const isolationVerified =
		user === PROBE_CONTAINER_USER &&
		hostConfig.Privileged === false &&
		noNewPrivilegesVerified &&
		capDrop.length === 1 &&
		capDrop[0] === "ALL" &&
		readOnlyRootFilesystemVerified &&
		boundedFilesystemImportVerified &&
		noEngineSocketMountVerified &&
		noHostNetworkVerified &&
		noHostBindMountVerified &&
		cpuMemoryPidsTimeBoundsVerified;
	return Object.freeze({
		isolationVerified,
		containerUser: user,
		noNewPrivilegesVerified,
		readOnlyRootFilesystemVerified,
		boundedFilesystemImportVerified,
		noEngineSocketMountVerified,
		noHostNetworkVerified,
		noHostBindMountVerified,
		cpuMemoryPidsTimeBoundsVerified,
	});
}

function dockerInspectCancellationSecretEvidence(
	value: unknown,
	privateContainer: DockerProbeContainerPrivateHandle,
): DockerEngineApiV0CancellationSecretEvidence | undefined {
	const record = plainObject(value);
	const config = plainObject(record?.Config);
	const hostConfig = plainObject(record?.HostConfig);
	const state = plainObject(record?.State);
	const mounts = Array.isArray(record?.Mounts) ? record.Mounts : undefined;
	const binds = optionalStringArray(hostConfig?.Binds);
	const env = optionalStringArray(config?.Env);
	if (
		record === undefined ||
		config === undefined ||
		hostConfig === undefined ||
		state === undefined ||
		!dockerInspectContainerIdentityVerified(record, config, privateContainer) ||
		mounts === undefined ||
		!mounts.every((mount) => plainObject(mount) !== undefined) ||
		binds === undefined ||
		env === undefined
	)
		return undefined;
	const inspectedJson = JSON.stringify({
		Config: config,
		HostConfig: hostConfig,
		Mounts: mounts,
		State: state,
	});
	if (inspectedJson.includes(DOCKER_ENGINE_SOCKET_PATH)) return undefined;
	const noHostBindMountVerified =
		binds.length === 0 && mounts.length === 0 && !("Mounts" in hostConfig);
	const boundedArtifactMaterial =
		config.OpenStdin === false &&
		hostConfig.AutoRemove === false &&
		(config.Volumes === undefined || config.Volumes === null) &&
		noHostBindMountVerified;
	const noPrivateEnvMaterial = env.every((entry) => !containsPrivateMaterial(entry));
	const boundedCredentialMaterial =
		noPrivateEnvMaterial &&
		boundedArtifactMaterial &&
		hostConfig.NetworkMode === privateContainer.network.name &&
		privateContainer.network.name !== "host";
	const stoppedSuccessfully = state.Running === false && state.ExitCode === 0;
	return Object.freeze({
		cancellationVerified:
			stoppedSuccessfully &&
			hostConfig.Memory === PROBE_CONTAINER_MEMORY_BYTES &&
			hostConfig.CpuPeriod === PROBE_CONTAINER_CPU_PERIOD &&
			hostConfig.CpuQuota === PROBE_CONTAINER_CPU_QUOTA &&
			hostConfig.PidsLimit === PROBE_CONTAINER_PIDS_LIMIT,
		cleanupVerified: true,
		artifactResolverReady: boundedArtifactMaterial,
		credentialResolverReady: boundedCredentialMaterial,
		secretDestructionVerified: boundedCredentialMaterial && stoppedSuccessfully,
	});
}

function dockerEngineApiV0NetworkDenialEvidence(
	value: unknown,
): DockerEngineApiV0NetworkDenialEvidence | undefined {
	const record = plainObject(value);
	if (
		record === undefined ||
		!onlyKeys(record, NETWORK_DENIAL_EVIDENCE_KEYS) ||
		!booleanFields(record, NETWORK_DENIAL_EVIDENCE_KEYS)
	)
		return undefined;
	return Object.freeze({
		destinationPinnedEgressDenyVerified: record.destinationPinnedEgressDenyVerified,
		metadataEgressDenyVerified: record.metadataEgressDenyVerified,
		linkLocalEgressDenyVerified: record.linkLocalEgressDenyVerified,
		loopbackEgressDenyVerified: record.loopbackEgressDenyVerified,
		hostGatewayEgressDenyVerified: record.hostGatewayEgressDenyVerified,
		dnsRebindingResistanceVerified: record.dnsRebindingResistanceVerified,
	});
}

function dockerInspectContainerIdentityVerified(
	record: Record<string, unknown>,
	config: Record<string, unknown>,
	privateContainer: DockerProbeContainerPrivateHandle,
): boolean {
	const inspectedId = stringValue(record.Id);
	const inspectedName = stringValue(record.Name);
	const labels = plainObject(config.Labels);
	return (
		inspectedId === privateContainer.id &&
		(inspectedName === privateContainer.name || inspectedName === `/${privateContainer.name}`) &&
		labels?.["dev.graphrefly.boundary"] === "d624-docker-engine-api-v0-certifier"
	);
}

function dockerInspectNetworkRequestPolicy(
	value: unknown,
	privateNetwork: DockerProbeNetworkPrivateHandle,
): DockerProbeNetworkRequestPolicy | undefined {
	const record = plainObject(value);
	const labels = plainObject(record?.Labels);
	if (
		record === undefined ||
		stringValue(record.Name) !== privateNetwork.name ||
		labels?.["dev.graphrefly.boundary"] !== "d624-docker-engine-api-v0-certifier"
	)
		return undefined;
	return Object.freeze({
		internalNetworkRequested: record.Internal === true,
		noAttachableNetworkRequested: record.Attachable === false,
		noIngressNetworkRequested: record.Ingress === false,
		noIpv6NetworkRequested: record.EnableIPv6 === false,
	});
}

function dockerEngineApiV0CancellationSecretEvidence(
	value: unknown,
): DockerEngineApiV0CancellationSecretEvidence | undefined {
	const record = plainObject(value);
	if (
		record === undefined ||
		!onlyKeys(record, CANCELLATION_SECRET_EVIDENCE_KEYS) ||
		!booleanFields(record, CANCELLATION_SECRET_EVIDENCE_KEYS)
	)
		return undefined;
	return Object.freeze({
		cancellationVerified: record.cancellationVerified,
		cleanupVerified: record.cleanupVerified,
		artifactResolverReady: record.artifactResolverReady,
		credentialResolverReady: record.credentialResolverReady,
		secretDestructionVerified: record.secretDestructionVerified,
	});
}

function onlyKeys(record: Record<string, unknown>, keys: readonly string[]): boolean {
	return Object.keys(record).every((key) => keys.includes(key));
}

function booleanFields<const T extends readonly string[]>(
	record: Record<string, unknown>,
	keys: T,
): record is Record<T[number], boolean> & Record<string, unknown> {
	return keys.every((key) => typeof record[key] === "boolean");
}

function backendName(
	value: Record<string, unknown>,
	hasPublicApiVersion: boolean,
): DockerEngineApiV0VersionEvidence["detectedBackend"] {
	if (dockerVersionBackendTexts(value).some((text) => text.includes("podman"))) return "podman";
	return hasPublicApiVersion ? "docker-engine" : "unknown";
}

function publicDockerRevisionValue(value: unknown): string | undefined {
	const raw = stringValue(value);
	if (raw === undefined) return undefined;
	const revision = raw.trim();
	if (
		revision.length === 0 ||
		!DOCKER_PUBLIC_REVISION_SAFE.test(revision) ||
		containsPrivateMaterial(revision)
	)
		return undefined;
	const lower = revision.toLowerCase();
	return lower.includes("unavailable") || lower.includes("unknown") ? undefined : revision;
}

function prefixedDockerRevision(
	prefix: DockerEngineApiV0VersionEvidence["detectedBackend"] | "docker-api",
	value: string | undefined,
): string {
	if (value === undefined) return `${prefix}:unavailable`;
	return value.startsWith(`${prefix}:`) ? value : `${prefix}:${value}`;
}

function dockerVersionBackendTexts(value: Record<string, unknown>): readonly string[] {
	const components = Array.isArray(value.Components) ? value.Components : [];
	return [
		publicDockerBackendText(value.Version),
		publicDockerBackendText(plainObject(value.Platform)?.Name),
		...components.map((component) => publicDockerBackendText(plainObject(component)?.Name)),
	].filter((text): text is string => text !== undefined);
}

function publicDockerBackendText(value: unknown): string | undefined {
	const text = stringValue(value)?.trim();
	if (text === undefined || text.length === 0 || text.length > 128) return undefined;
	return containsPrivateMaterial(text) ? undefined : text.toLowerCase();
}

async function dockerAcceptedRequest(
	method: "POST" | "DELETE",
	path: string,
	body: Record<string, unknown> | undefined,
	accepted: readonly number[],
	http: DockerHttpOptions,
	signal?: AbortSignal,
): Promise<DockerEngineApiV0HostResult<void>> {
	const result = await dockerRequest(method, path, body, http, signal);
	return result.ok && accepted.includes(result.statusCode) && result.body === ""
		? ok(undefined)
		: { ok: false };
}

async function dockerJsonObjectRequest(
	method: "GET" | "POST",
	path: string,
	body: Record<string, unknown> | undefined,
	http: DockerHttpOptions,
	signal?: AbortSignal,
): Promise<DockerEngineApiV0HostResult<Record<string, unknown>>> {
	const result = await dockerRequest(method, path, body, http, signal);
	if (!result.ok || result.statusCode < 200 || result.statusCode >= 300) return { ok: false };
	if (result.body === "") return ok(Object.freeze({}));
	try {
		const value = plainObject(JSON.parse(result.body));
		return value === undefined ? { ok: false } : ok(value);
	} catch {
		return { ok: false };
	}
}

function dockerRequest(
	method: "GET" | "POST" | "DELETE",
	path: string,
	body: Record<string, unknown> | undefined,
	http: DockerHttpOptions,
	signal?: AbortSignal,
): Promise<
	{ readonly ok: true; readonly statusCode: number; readonly body: string } | { readonly ok: false }
> {
	if (signal?.aborted) return Promise.resolve({ ok: false });
	return new Promise((resolve) => {
		let settled = false;
		let req: ReturnType<typeof httpRequest>;
		let timer: ReturnType<typeof setTimeout>;
		const onAbort = () => {
			req.destroy();
			finish({ ok: false });
		};
		const finish = (
			value:
				| { readonly ok: true; readonly statusCode: number; readonly body: string }
				| { readonly ok: false },
		) => {
			if (settled) return;
			settled = true;
			clearTimeout(timer);
			signal?.removeEventListener("abort", onAbort);
			resolve(value);
		};
		const payload = body === undefined ? undefined : JSON.stringify(body);
		req = httpRequest(
			{
				method,
				path,
				socketPath: DOCKER_ENGINE_SOCKET_PATH,
				headers:
					payload === undefined
						? undefined
						: {
								"content-type": "application/json",
								"content-length": Buffer.byteLength(payload),
							},
				signal,
			},
			(res) => {
				let bytes = 0;
				const chunks: Buffer[] = [];
				res.on("data", (chunk: Buffer | string) => {
					const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
					bytes += buffer.byteLength;
					if (bytes > http.maxResponseBytes) {
						req.destroy();
						finish({ ok: false });
						return;
					}
					chunks.push(buffer);
				});
				res.on("end", () =>
					finish({
						ok: true,
						statusCode: res.statusCode ?? 0,
						body: Buffer.concat(chunks).toString("utf8"),
					}),
				);
			},
		);
		timer = setTimeout(() => {
			req.destroy();
			finish({ ok: false });
		}, http.requestTimeoutMs);
		signal?.addEventListener("abort", onAbort, { once: true });
		req.on("error", () => finish({ ok: false }));
		if (payload !== undefined) req.write(payload);
		req.end();
	});
}

function dockerPathSegment(value: string): string {
	return DOCKER_PATH_SAFE.test(value) ? encodeURIComponent(value) : "invalid";
}

function dockerQueryValue(value: string): string {
	return encodeURIComponent(value);
}

function stringValue(value: unknown): string | undefined {
	return typeof value === "string" && value.length > 0 ? value : undefined;
}

function stringArray(value: unknown): readonly string[] | undefined {
	return Array.isArray(value) && value.every((entry) => typeof entry === "string")
		? value
		: undefined;
}

function optionalStringArray(value: unknown): readonly string[] | undefined {
	return value === undefined || value === null ? [] : stringArray(value);
}

function plainObject(value: unknown): Record<string, unknown> | undefined {
	return typeof value === "object" && value !== null && !Array.isArray(value)
		? (value as Record<string, unknown>)
		: undefined;
}

function boundedIntegerRange(value: unknown, fallback: number, min: number, max: number): number {
	return typeof value === "number" && Number.isInteger(value) && value >= min && value <= max
		? value
		: fallback;
}

function probeDockerLabels(probeLabel: string | undefined): Record<string, string> {
	const safeProbeLabel = publicProbeLabel(probeLabel);
	return {
		"dev.graphrefly.boundary": "d624-docker-engine-api-v0-certifier",
		...(safeProbeLabel === undefined ? {} : { "dev.graphrefly.probe": safeProbeLabel }),
	};
}

function publicProbeLabel(value: string | undefined): string | undefined {
	if (value === undefined || value.length > 96 || !DOCKER_PATH_SAFE.test(value)) return undefined;
	return containsPrivateMaterial(value) ? undefined : value;
}

function containsPrivateMaterial(value: string): boolean {
	const lower = value.toLowerCase();
	const compact = lower.replace(/[^a-z0-9]+/g, "");
	const tokens = lower.split(/[^a-z0-9]+/u).filter(Boolean);
	return (
		PRIVATE_COMPACT_MATERIAL.some((term) => compact.includes(term)) ||
		tokens.some((token) => PRIVATE_TOKEN_MATERIAL.includes(token))
	);
}

function dockerIdSafe(value: string | undefined): value is string {
	return value !== undefined && DOCKER_ID_SAFE.test(value);
}

function probeNetworkToken(value: DockerProbeNetworkPrivateHandle): DockerProbeNetworkPublicHandle {
	const token = Object.freeze({
		kind: "docker-engine-api-v0-node-local-probe-network" as const,
	});
	probeNetworks.set(token, value);
	return token;
}

function probeContainerToken(
	value: DockerProbeContainerPrivateHandle,
): DockerProbeContainerPublicHandle {
	const token = Object.freeze({
		kind: "docker-engine-api-v0-node-local-probe-container" as const,
	});
	probeContainers.set(token, value);
	return token;
}

function probeNetworkPrivate(value: unknown): DockerProbeNetworkPrivateHandle | undefined {
	if (!isProbeNetwork(value)) return undefined;
	return probeNetworks.get(value);
}

function probeContainerPrivate(value: unknown): DockerProbeContainerPrivateHandle | undefined {
	if (!isProbeContainer(value)) return undefined;
	return probeContainers.get(value);
}

function isProbeNetwork(value: unknown): value is DockerProbeNetworkPublicHandle & object {
	return (
		typeof value === "object" &&
		value !== null &&
		(value as DockerProbeNetworkPublicHandle).kind ===
			"docker-engine-api-v0-node-local-probe-network" &&
		probeNetworks.has(value)
	);
}

function isProbeContainer(value: unknown): value is DockerProbeContainerPublicHandle & object {
	return (
		typeof value === "object" &&
		value !== null &&
		(value as DockerProbeContainerPublicHandle).kind ===
			"docker-engine-api-v0-node-local-probe-container" &&
		probeContainers.has(value)
	);
}

function ok<T>(value: T): DockerEngineApiV0HostResult<T> {
	return { ok: true, value };
}
