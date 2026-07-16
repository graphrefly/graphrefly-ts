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
}

interface DockerProbeContainerPublicHandle {
	readonly kind: "docker-engine-api-v0-node-local-probe-container";
}

interface DockerProbeContainerPrivateHandle {
	/** Docker resource id when it is safely bounded; otherwise the generated private resource name. */
	readonly id: string;
	readonly name: string;
	readonly network: DockerProbeNetworkPrivateHandle;
}

const DOCKER_ENGINE_SOCKET_PATH = "/var/run/docker.sock";
const DEFAULT_REQUEST_TIMEOUT_MS = 10_000;
const MAX_REQUEST_TIMEOUT_MS = 30_000;
const DEFAULT_MAX_RESPONSE_BYTES = 128 * 1024;
const MAX_RESPONSE_BYTES = 1024 * 1024;
const DOCKER_PATH_SAFE = /^[A-Za-z0-9._~:/@+-]+$/;
const DOCKER_ID_SAFE = /^[a-f0-9]{12,64}$/i;
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
			const response = await dockerJsonRequest<Record<string, unknown>>(
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
			const response = await dockerJsonRequest<Record<string, unknown>>(
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
			const response = await dockerJsonRequest<Record<string, unknown>>(
				"POST",
				"/networks/create",
				{
					Name: name,
					CheckDuplicate: false,
					Internal: true,
					Labels: probeDockerLabels(opts.probeLabel),
				},
				http,
				opts.signal,
			);
			const id = response.ok ? stringValue(response.value.Id) : undefined;
			if (!response.ok) return { ok: false };
			return ok(probeNetworkToken({ id: dockerIdSafe(id) ? id : name, name }));
		},
		createProbeContainer: async (opts) => {
			const network = probeNetworkPrivate(opts.network);
			if (network === undefined) return { ok: false };
			const name = `graphrefly-d624-${randomUUID()}`;
			const response = await dockerJsonRequest<Record<string, unknown>>(
				"POST",
				`/containers/create?name=${dockerQueryValue(name)}`,
				{
					Image: opts.imageRef,
					User: "65532:65532",
					Cmd: ["sh", "-ec", 'test "$(id -u)" != "0"'],
					AttachStdout: false,
					AttachStderr: false,
					OpenStdin: false,
					Tty: false,
					StopTimeout: 5,
					HostConfig: {
						NetworkMode: network.name,
						ReadonlyRootfs: true,
						SecurityOpt: ["no-new-privileges"],
						CapDrop: ["ALL"],
						AutoRemove: false,
						Memory: 128 * 1024 * 1024,
						CpuPeriod: 100_000,
						CpuQuota: 50_000,
						PidsLimit: 64,
					},
					NetworkingConfig: {
						EndpointsConfig: {
							[network.name]: {},
						},
					},
					Labels: probeDockerLabels(opts.probeLabel),
				},
				http,
				opts.signal,
			);
			const id = response.ok ? stringValue(response.value.Id) : undefined;
			if (!response.ok) return { ok: false };
			return ok(probeContainerToken({ id: dockerIdSafe(id) ? id : name, name, network }));
		},
		inspectProbeContainment: (container, opts) =>
			isProbeContainer(container) ? proofs.inspectProbeContainment(container, opts) : { ok: false },
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
			const response = await dockerJsonRequest<Record<string, unknown>>(
				"POST",
				`/containers/${dockerPathSegment(privateContainer.id)}/wait`,
				undefined,
				http,
				opts.signal,
			);
			return response.ok && response.value.StatusCode === 0 ? ok(undefined) : { ok: false };
		},
		verifyProbeNetworkDenials: (container, opts) =>
			isProbeContainer(container)
				? proofs.verifyProbeNetworkDenials(container, opts)
				: { ok: false },
		verifyProbeCancellationAndSecretDestruction: (container, opts) =>
			isProbeContainer(container)
				? proofs.verifyProbeCancellationAndSecretDestruction(container, opts)
				: { ok: false },
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
	const engineRevision = stringValue(value.Version) ?? "docker-engine:unavailable";
	const engineApiRevision = stringValue(value.ApiVersion) ?? "docker-api:unavailable";
	const detectedBackend = backendName(value);
	return {
		detectedBackend,
		engineReachable: detectedBackend !== "unavailable",
		engineApiRevision: engineApiRevision.startsWith("docker-api:")
			? engineApiRevision
			: `docker-api:${engineApiRevision}`,
		engineRevision: engineRevision.startsWith("docker-engine:")
			? engineRevision
			: `${detectedBackend}:${engineRevision}`,
	};
}

function imageDigestEvidence(
	value: Record<string, unknown>,
	imageDigest: string,
): DockerEngineApiV0ImageDigestEvidence {
	const repoDigests = Array.isArray(value.RepoDigests)
		? value.RepoDigests.filter((v): v is string => typeof v === "string")
		: [];
	const imageDigestPresent = repoDigests.some(
		(ref) => ref === imageDigest || ref.endsWith(`@${imageDigest}`),
	);
	return { imageDigestPresent, imageDigestVerified: imageDigestPresent };
}

function backendName(
	value: Record<string, unknown>,
): DockerEngineApiV0VersionEvidence["detectedBackend"] {
	const text = JSON.stringify(value).toLowerCase();
	if (text.includes("podman")) return "podman";
	return typeof value.ApiVersion === "string" ? "docker-engine" : "unknown";
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
	return result.ok && accepted.includes(result.statusCode) ? ok(undefined) : { ok: false };
}

async function dockerJsonRequest<T>(
	method: "GET" | "POST",
	path: string,
	body: Record<string, unknown> | undefined,
	http: DockerHttpOptions,
	signal?: AbortSignal,
): Promise<DockerEngineApiV0HostResult<T>> {
	const result = await dockerRequest(method, path, body, http, signal);
	if (!result.ok || result.statusCode < 200 || result.statusCode >= 300) return { ok: false };
	if (result.body === "") return { ok: true, value: {} as T };
	try {
		return { ok: true, value: JSON.parse(result.body) as T };
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
	return new Promise((resolve) => {
		let settled = false;
		const finish = (
			value:
				| { readonly ok: true; readonly statusCode: number; readonly body: string }
				| { readonly ok: false },
		) => {
			if (settled) return;
			settled = true;
			clearTimeout(timer);
			resolve(value);
		};
		const payload = body === undefined ? undefined : JSON.stringify(body);
		const req = httpRequest(
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
		const timer = setTimeout(() => {
			req.destroy();
			finish({ ok: false });
		}, http.requestTimeoutMs);
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
	const lower = value.toLowerCase();
	const compact = lower.replace(/[^a-z0-9]+/g, "");
	const tokens = lower.split(/[^a-z0-9]+/u).filter(Boolean);
	if (
		PRIVATE_COMPACT_MATERIAL.some((term) => compact.includes(term)) ||
		tokens.some((token) => PRIVATE_TOKEN_MATERIAL.includes(token))
	)
		return undefined;
	return value;
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
