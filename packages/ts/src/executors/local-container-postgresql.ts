/** Concrete, host-injected local-container PostgreSQL binding (D604). */
import type { DataIssue } from "../data/index.js";
import type { Graph } from "../graph/graph.js";
import { canonicalTupleKey } from "../identity.js";
import type { Node } from "../node/node.js";
import type {
	AgentRuntimeAuditRecord,
	ExecutorOutcome,
	ExecutorUsage,
	SourceRef,
	ToolProviderAdapterInput,
	ToolProviderAdapterRunRequested,
	ToolProviderAdapterRunStatus,
} from "../orchestration/index.js";
import type {
	PostgresqlDriverQueryResult,
	PostgresqlQueryToolArguments,
} from "./postgresql-tool-provider.js";
import { postgresqlQueryToolArgumentsFromIntent } from "./postgresql-tool-provider.js";

export const LOCAL_CONTAINER_POSTGRESQL_COMPATIBILITY =
	"graphrefly-local-container-postgresql-v1" as const;
export const LOCAL_CONTAINER_POSTGRESQL_BACKEND_FAMILY = "docker-engine-api-v0" as const;

export interface LocalContainerPostgresqlManifest {
	readonly kind: "local-container-postgresql-manifest";
	readonly manifestId: string;
	readonly revision: string;
	readonly fingerprint: string;
	readonly imageDigest: string;
	readonly engineCompatibilityRevision: typeof LOCAL_CONTAINER_POSTGRESQL_COMPATIBILITY;
	readonly backendFamily: typeof LOCAL_CONTAINER_POSTGRESQL_BACKEND_FAMILY;
	readonly backendCertificationRevision: string;
	readonly recipeRevision: "postgresql-read-only-query-v1";
	readonly sandboxRevision: string;
	readonly mountPolicyRevision: string;
	readonly networkPolicyRevision: string;
	readonly resourcePolicyRevision: string;
	readonly stopGraceMs: number;
	readonly attestationRefs: readonly SourceRef[];
}

export interface LocalContainerPostgresqlReadiness {
	readonly kind: "local-container-postgresql-readiness";
	readonly manifestFingerprint: string;
	readonly backendCertificationRevision: string;
	readonly state: "ready" | "stale" | "unavailable";
	readonly observedAtMs: number;
	readonly expiresAtMs: number;
	readonly backendFamily: typeof LOCAL_CONTAINER_POSTGRESQL_BACKEND_FAMILY;
	readonly hostPlatform: string;
	readonly engineApiRevision: string;
	readonly engineRevision: string;
	readonly runtimeRevision: string;
	readonly guestPlatform: string;
	readonly vmRuntimeRevision?: string;
	readonly engineReachable: boolean;
	readonly compatibilityVerified: boolean;
	readonly backendFamilyVerified: boolean;
	readonly hostPlatformVerified: boolean;
	readonly imageDigestPresent: boolean;
	readonly imageDigestVerified: boolean;
	readonly recipeVerified: boolean;
	readonly isolationVerified: boolean;
	readonly noEngineSocketMountVerified: boolean;
	readonly noHostNetworkVerified: boolean;
	readonly noHostBindMountVerified: boolean;
	readonly destinationPinnedEgressDenyVerified: boolean;
	readonly metadataEgressDenyVerified: boolean;
	readonly dnsRebindingResistanceVerified: boolean;
	readonly quotaReady: boolean;
	readonly cancellationVerified: boolean;
	readonly cleanupVerified: boolean;
	readonly artifactResolverReady: boolean;
	readonly credentialResolverReady: boolean;
	readonly secretDestructionVerified: boolean;
	readonly limitationRefs: readonly SourceRef[];
	readonly attestationRefs: readonly SourceRef[];
}

export interface LocalContainerPostgresqlDockerEngineApiV0Preflight {
	readonly kind: "local-container-postgresql-docker-engine-api-v0-preflight";
	readonly manifestFingerprint: string;
	readonly backendCertificationRevision: string;
	readonly detectedBackend: "docker-engine" | "podman" | "unknown" | "unavailable";
	readonly observedAtMs: number;
	readonly expiresAtMs: number;
	readonly hostPlatform: string;
	readonly engineApiRevision: string;
	readonly engineRevision: string;
	readonly runtimeRevision: string;
	readonly guestPlatform: string;
	readonly vmRuntimeRevision?: string;
	readonly engineReachable: boolean;
	readonly compatibilityVerified: boolean;
	readonly hostPlatformVerified: boolean;
	readonly imageDigestPresent: boolean;
	readonly imageDigestVerified: boolean;
	readonly recipeVerified: boolean;
	readonly isolationVerified: boolean;
	readonly noEngineSocketMountVerified: boolean;
	readonly noHostNetworkVerified: boolean;
	readonly noHostBindMountVerified: boolean;
	readonly destinationPinnedEgressDenyVerified: boolean;
	readonly metadataEgressDenyVerified: boolean;
	readonly dnsRebindingResistanceVerified: boolean;
	readonly quotaReady: boolean;
	readonly cancellationVerified: boolean;
	readonly cleanupVerified: boolean;
	readonly artifactResolverReady: boolean;
	readonly credentialResolverReady: boolean;
	readonly secretDestructionVerified: boolean;
	readonly limitationRefs: readonly SourceRef[];
	readonly attestationRefs: readonly SourceRef[];
}

export type LocalContainerPostgresqlPhase =
	| "preparing"
	| "creating"
	| "starting"
	| "running"
	| "stop-requested"
	| "kill-requested"
	| "waiting"
	| "removing"
	| "cleaning"
	| "settled";

export interface LocalContainerPostgresqlPhaseDetail {
	readonly kind: "local-container-postgresql-phase-detail";
	readonly runId: string;
	readonly attempt: number;
	readonly environmentRevision: string;
	readonly manifestFingerprint: string;
	readonly sessionEpoch: string;
	readonly phase: LocalContainerPostgresqlPhase;
	readonly occurredAtMs?: number;
}

export interface LocalContainerPostgresqlCleanupStatus {
	readonly kind: "local-container-postgresql-cleanup-status";
	readonly runId: string;
	readonly attempt: number;
	readonly state: "succeeded" | "failed" | "unverifiable";
	readonly issue?: DataIssue;
}

export interface LocalContainerPostgresqlMovementEvidence {
	readonly kind: "local-container-postgresql-movement-evidence";
	readonly runId: string;
	readonly direction: "container-to-host";
	readonly classification: "postgresql-query-result";
	readonly bytes: number;
	readonly truncated: boolean;
	readonly artifactRefs?: readonly SourceRef[];
}

export interface LocalContainerPostgresqlDriverContext {
	readonly runId: string;
	readonly attempt: number;
	readonly sessionEpoch: string;
	readonly manifestFingerprint: string;
	readonly signal: AbortSignal;
}

/** Values and handles accepted/returned here are runtime-private and are never graph DATA. */
export interface LocalContainerPostgresqlDriver {
	readonly compatibility: typeof LOCAL_CONTAINER_POSTGRESQL_COMPATIBILITY;
	prepare(context: LocalContainerPostgresqlDriverContext): void | PromiseLike<void>;
	create(
		context: LocalContainerPostgresqlDriverContext,
		args: PostgresqlQueryToolArguments,
	): unknown | PromiseLike<unknown>;
	start(binding: unknown, context: LocalContainerPostgresqlDriverContext): void | PromiseLike<void>;
	wait(
		binding: unknown,
		context: LocalContainerPostgresqlDriverContext,
	): PostgresqlDriverQueryResult | PromiseLike<PostgresqlDriverQueryResult>;
	stop(
		binding: unknown,
		context: LocalContainerPostgresqlDriverContext,
		graceMs: number,
	): void | PromiseLike<void>;
	kill(binding: unknown, context: LocalContainerPostgresqlDriverContext): void | PromiseLike<void>;
	remove(
		binding: unknown,
		context: LocalContainerPostgresqlDriverContext,
	): void | PromiseLike<void>;
	cleanup(context: LocalContainerPostgresqlDriverContext): void | PromiseLike<void>;
}

export interface LocalContainerPostgresqlCancellationRequested {
	readonly kind: "local-container-postgresql-cancellation-requested";
	readonly cancellationId: string;
	readonly runId: string;
	readonly attempt: number;
	readonly environmentRevision: string;
	readonly manifestFingerprint: string;
	readonly sessionEpoch: string;
}
export interface LocalContainerPostgresqlCancellationDecision {
	readonly kind: "local-container-postgresql-cancellation-decision";
	readonly decisionId: string;
	readonly proposalId: string;
	readonly outcome: "admit" | "block";
}
export interface LocalContainerPostgresqlCancellationProposal
	extends Omit<LocalContainerPostgresqlCancellationRequested, "kind"> {
	readonly kind: "local-container-postgresql-cancellation-proposal";
	readonly proposalId: string;
}
export interface LocalContainerPostgresqlCancellationAdmission {
	readonly kind: "local-container-postgresql-cancellation-admission";
	readonly proposalId: string;
	readonly decisionId: string;
	readonly runId: string;
	readonly state: "admitted" | "blocked";
}
export interface LocalContainerPostgresqlCancellationAcknowledgement {
	readonly kind: "local-container-postgresql-cancellation-acknowledgement";
	readonly proposalId: string;
	readonly runId: string;
	readonly state: "stop-requested";
}

export interface LocalContainerPostgresqlRuntimeOptions {
	readonly name?: string;
	readonly inputs: Node<ToolProviderAdapterInput<PostgresqlQueryToolArguments>>;
	readonly admittedRunRequests: readonly Node<ToolProviderAdapterRunRequested>[];
	readonly manifests: readonly Node<LocalContainerPostgresqlManifest>[];
	readonly readiness: readonly Node<LocalContainerPostgresqlReadiness>[];
	readonly cancellationRequests?: readonly Node<LocalContainerPostgresqlCancellationRequested>[];
	readonly cancellationDecisions?: readonly Node<LocalContainerPostgresqlCancellationDecision>[];
	readonly driver: LocalContainerPostgresqlDriver;
	readonly now?: () => number;
}

export interface LocalContainerPostgresqlRuntimeBundle {
	readonly admittedRunRequests: Node<ToolProviderAdapterRunRequested>;
	readonly runStatus: Node<ToolProviderAdapterRunStatus>;
	readonly outcomes: Node<ExecutorOutcome>;
	readonly phases: Node<LocalContainerPostgresqlPhaseDetail>;
	readonly cleanup: Node<LocalContainerPostgresqlCleanupStatus>;
	readonly issues: Node<DataIssue>;
	readonly audit: Node<AgentRuntimeAuditRecord>;
	readonly usage: Node<ExecutorUsage & { readonly runId: string }>;
	readonly movement: Node<LocalContainerPostgresqlMovementEvidence>;
	readonly cancellationProposals: Node<LocalContainerPostgresqlCancellationProposal>;
	readonly cancellationAdmissions: Node<LocalContainerPostgresqlCancellationAdmission>;
	readonly cancellationAcknowledgements: Node<LocalContainerPostgresqlCancellationAcknowledgement>;
	dispose(): Promise<void>;
}

interface Active {
	readonly request: ToolProviderAdapterRunRequested;
	readonly context: LocalContainerPostgresqlDriverContext;
	readonly manifest: LocalContainerPostgresqlManifest;
	readonly abortController: AbortController;
	binding?: unknown;
	cancelled: boolean;
	settled: boolean;
	readonly startedAtMs: number;
	cleanupPromise?: Promise<void>;
	terminationPromise?: Promise<void>;
}

const SAFE = /^[A-Za-z0-9][A-Za-z0-9._:/@+-]{0,255}$/;
const DIGEST = /^sha256:[a-f0-9]{64}$/;
const PRIVATE_COMPACT_MATERIAL = [
	"containerid",
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
	"socket",
	"token",
];

export function localContainerPostgresqlManifest(
	value: LocalContainerPostgresqlManifest,
): LocalContainerPostgresqlManifest {
	if (!plain(value) || value.kind !== "local-container-postgresql-manifest")
		throw new TypeError("Invalid local-container manifest.");
	if (
		!Object.keys(value).every((key) =>
			[
				"kind",
				"manifestId",
				"revision",
				"fingerprint",
				"imageDigest",
				"engineCompatibilityRevision",
				"backendFamily",
				"backendCertificationRevision",
				"recipeRevision",
				"sandboxRevision",
				"mountPolicyRevision",
				"networkPolicyRevision",
				"resourcePolicyRevision",
				"stopGraceMs",
				"attestationRefs",
			].includes(key),
		)
	)
		throw new TypeError("Manifest contains private or unsupported material.");
	for (const coordinate of [
		value.manifestId,
		value.revision,
		value.fingerprint,
		value.sandboxRevision,
		value.mountPolicyRevision,
		value.networkPolicyRevision,
		value.resourcePolicyRevision,
	])
		if (!publicCoordinate(coordinate))
			throw new TypeError("Invalid local-container manifest coordinate.");
	if (
		!DIGEST.test(value.imageDigest) ||
		value.engineCompatibilityRevision !== LOCAL_CONTAINER_POSTGRESQL_COMPATIBILITY ||
		value.backendFamily !== LOCAL_CONTAINER_POSTGRESQL_BACKEND_FAMILY ||
		!publicCoordinate(value.backendCertificationRevision) ||
		value.recipeRevision !== "postgresql-read-only-query-v1" ||
		!Number.isSafeInteger(value.stopGraceMs) ||
		value.stopGraceMs < 1 ||
		value.stopGraceMs > 60_000
	)
		throw new TypeError("Invalid local-container manifest contract.");
	return Object.freeze({
		kind: value.kind,
		manifestId: value.manifestId,
		revision: value.revision,
		fingerprint: value.fingerprint,
		imageDigest: value.imageDigest,
		engineCompatibilityRevision: value.engineCompatibilityRevision,
		backendFamily: value.backendFamily,
		backendCertificationRevision: value.backendCertificationRevision,
		recipeRevision: value.recipeRevision,
		sandboxRevision: value.sandboxRevision,
		mountPolicyRevision: value.mountPolicyRevision,
		networkPolicyRevision: value.networkPolicyRevision,
		resourcePolicyRevision: value.resourcePolicyRevision,
		stopGraceMs: value.stopGraceMs,
		attestationRefs: refs(value.attestationRefs),
	});
}

export function localContainerPostgresqlReadiness(
	value: LocalContainerPostgresqlReadiness,
): LocalContainerPostgresqlReadiness {
	if (
		!plain(value) ||
		value.kind !== "local-container-postgresql-readiness" ||
		!publicCoordinate(value.manifestFingerprint) ||
		!publicCoordinate(value.backendCertificationRevision) ||
		!["ready", "stale", "unavailable"].includes(value.state) ||
		!Number.isSafeInteger(value.observedAtMs) ||
		!Number.isSafeInteger(value.expiresAtMs) ||
		value.observedAtMs < 0 ||
		value.expiresAtMs <= value.observedAtMs ||
		value.backendFamily !== LOCAL_CONTAINER_POSTGRESQL_BACKEND_FAMILY ||
		!publicCoordinate(value.hostPlatform) ||
		!publicCoordinate(value.engineApiRevision) ||
		!publicCoordinate(value.engineRevision) ||
		!publicCoordinate(value.runtimeRevision) ||
		!publicCoordinate(value.guestPlatform) ||
		!value.guestPlatform.startsWith("linux/") ||
		!["linux/", "darwin/", "windows/"].some((prefix) => value.hostPlatform.startsWith(prefix)) ||
		["darwin/", "windows/"].some((prefix) => value.hostPlatform.startsWith(prefix)) !==
			(value.vmRuntimeRevision !== undefined) ||
		(value.vmRuntimeRevision !== undefined && !publicCoordinate(value.vmRuntimeRevision))
	)
		throw new TypeError("Invalid local-container readiness.");
	if (
		!Object.keys(value).every((key) =>
			[
				"kind",
				"manifestFingerprint",
				"backendCertificationRevision",
				"state",
				"observedAtMs",
				"expiresAtMs",
				"backendFamily",
				"hostPlatform",
				"engineApiRevision",
				"engineRevision",
				"runtimeRevision",
				"guestPlatform",
				"vmRuntimeRevision",
				"engineReachable",
				"compatibilityVerified",
				"backendFamilyVerified",
				"hostPlatformVerified",
				"imageDigestPresent",
				"imageDigestVerified",
				"recipeVerified",
				"isolationVerified",
				"noEngineSocketMountVerified",
				"noHostNetworkVerified",
				"noHostBindMountVerified",
				"destinationPinnedEgressDenyVerified",
				"metadataEgressDenyVerified",
				"dnsRebindingResistanceVerified",
				"quotaReady",
				"cancellationVerified",
				"cleanupVerified",
				"artifactResolverReady",
				"credentialResolverReady",
				"secretDestructionVerified",
				"limitationRefs",
				"attestationRefs",
			].includes(key),
		)
	)
		throw new TypeError("Readiness contains private or unsupported material.");
	for (const field of [
		"engineReachable",
		"compatibilityVerified",
		"backendFamilyVerified",
		"hostPlatformVerified",
		"imageDigestPresent",
		"imageDigestVerified",
		"recipeVerified",
		"isolationVerified",
		"noEngineSocketMountVerified",
		"noHostNetworkVerified",
		"noHostBindMountVerified",
		"destinationPinnedEgressDenyVerified",
		"metadataEgressDenyVerified",
		"dnsRebindingResistanceVerified",
		"quotaReady",
		"cancellationVerified",
		"cleanupVerified",
		"artifactResolverReady",
		"credentialResolverReady",
		"secretDestructionVerified",
	] as const)
		if (typeof value[field] !== "boolean")
			throw new TypeError("Invalid local-container readiness proof.");
	return Object.freeze({
		kind: value.kind,
		manifestFingerprint: value.manifestFingerprint,
		backendCertificationRevision: value.backendCertificationRevision,
		state: value.state,
		observedAtMs: value.observedAtMs,
		expiresAtMs: value.expiresAtMs,
		backendFamily: value.backendFamily,
		hostPlatform: value.hostPlatform,
		engineApiRevision: value.engineApiRevision,
		engineRevision: value.engineRevision,
		runtimeRevision: value.runtimeRevision,
		guestPlatform: value.guestPlatform,
		...(value.vmRuntimeRevision === undefined
			? {}
			: { vmRuntimeRevision: value.vmRuntimeRevision }),
		engineReachable: value.engineReachable,
		compatibilityVerified: value.compatibilityVerified,
		backendFamilyVerified: value.backendFamilyVerified,
		hostPlatformVerified: value.hostPlatformVerified,
		imageDigestPresent: value.imageDigestPresent,
		imageDigestVerified: value.imageDigestVerified,
		recipeVerified: value.recipeVerified,
		isolationVerified: value.isolationVerified,
		noEngineSocketMountVerified: value.noEngineSocketMountVerified,
		noHostNetworkVerified: value.noHostNetworkVerified,
		noHostBindMountVerified: value.noHostBindMountVerified,
		destinationPinnedEgressDenyVerified: value.destinationPinnedEgressDenyVerified,
		metadataEgressDenyVerified: value.metadataEgressDenyVerified,
		dnsRebindingResistanceVerified: value.dnsRebindingResistanceVerified,
		quotaReady: value.quotaReady,
		cancellationVerified: value.cancellationVerified,
		cleanupVerified: value.cleanupVerified,
		artifactResolverReady: value.artifactResolverReady,
		credentialResolverReady: value.credentialResolverReady,
		secretDestructionVerified: value.secretDestructionVerified,
		limitationRefs: refs(value.limitationRefs),
		attestationRefs: refs(value.attestationRefs),
	});
}

export function localContainerPostgresqlDockerEngineApiV0PreflightReadiness(
	value: LocalContainerPostgresqlDockerEngineApiV0Preflight,
): LocalContainerPostgresqlReadiness {
	if (
		!plain(value) ||
		value.kind !== "local-container-postgresql-docker-engine-api-v0-preflight" ||
		!["docker-engine", "podman", "unknown", "unavailable"].includes(value.detectedBackend) ||
		!Object.keys(value).every((key) =>
			[
				"kind",
				"manifestFingerprint",
				"backendCertificationRevision",
				"detectedBackend",
				"observedAtMs",
				"expiresAtMs",
				"hostPlatform",
				"engineApiRevision",
				"engineRevision",
				"runtimeRevision",
				"guestPlatform",
				"vmRuntimeRevision",
				"engineReachable",
				"compatibilityVerified",
				"hostPlatformVerified",
				"imageDigestPresent",
				"imageDigestVerified",
				"recipeVerified",
				"isolationVerified",
				"noEngineSocketMountVerified",
				"noHostNetworkVerified",
				"noHostBindMountVerified",
				"destinationPinnedEgressDenyVerified",
				"metadataEgressDenyVerified",
				"dnsRebindingResistanceVerified",
				"quotaReady",
				"cancellationVerified",
				"cleanupVerified",
				"artifactResolverReady",
				"credentialResolverReady",
				"secretDestructionVerified",
				"limitationRefs",
				"attestationRefs",
			].includes(key),
		)
	)
		throw new TypeError("Invalid Docker Engine API v0 preflight.");
	for (const field of [
		"engineReachable",
		"compatibilityVerified",
		"hostPlatformVerified",
		"imageDigestPresent",
		"imageDigestVerified",
		"recipeVerified",
		"isolationVerified",
		"noEngineSocketMountVerified",
		"noHostNetworkVerified",
		"noHostBindMountVerified",
		"destinationPinnedEgressDenyVerified",
		"metadataEgressDenyVerified",
		"dnsRebindingResistanceVerified",
		"quotaReady",
		"cancellationVerified",
		"cleanupVerified",
		"artifactResolverReady",
		"credentialResolverReady",
		"secretDestructionVerified",
	] as const)
		if (typeof value[field] !== "boolean")
			throw new TypeError("Invalid Docker Engine API v0 preflight proof.");
	const backendVerified = value.detectedBackend === "docker-engine";
	const allRequiredProofsVerified =
		value.engineReachable &&
		value.compatibilityVerified &&
		value.hostPlatformVerified &&
		value.imageDigestPresent &&
		value.imageDigestVerified &&
		value.recipeVerified &&
		value.isolationVerified &&
		value.noEngineSocketMountVerified &&
		value.noHostNetworkVerified &&
		value.noHostBindMountVerified &&
		value.destinationPinnedEgressDenyVerified &&
		value.metadataEgressDenyVerified &&
		value.dnsRebindingResistanceVerified &&
		value.quotaReady &&
		value.cancellationVerified &&
		value.cleanupVerified &&
		value.artifactResolverReady &&
		value.credentialResolverReady &&
		value.secretDestructionVerified;
	const ready = backendVerified && allRequiredProofsVerified;
	const limitationRefs =
		value.detectedBackend === "docker-engine"
			? value.limitationRefs
			: [
					...value.limitationRefs,
					{
						kind: "limitation",
						id: `unsupported-${value.detectedBackend}-backend`,
					} satisfies SourceRef,
				];
	return localContainerPostgresqlReadiness({
		kind: "local-container-postgresql-readiness",
		manifestFingerprint: value.manifestFingerprint,
		backendCertificationRevision: value.backendCertificationRevision,
		state: ready ? "ready" : "unavailable",
		observedAtMs: value.observedAtMs,
		expiresAtMs: value.expiresAtMs,
		backendFamily: LOCAL_CONTAINER_POSTGRESQL_BACKEND_FAMILY,
		hostPlatform: value.hostPlatform,
		engineApiRevision: value.engineApiRevision,
		engineRevision: value.engineRevision,
		runtimeRevision: value.runtimeRevision,
		guestPlatform: value.guestPlatform,
		...(value.vmRuntimeRevision === undefined
			? {}
			: { vmRuntimeRevision: value.vmRuntimeRevision }),
		engineReachable: value.engineReachable && backendVerified,
		compatibilityVerified: value.compatibilityVerified && backendVerified,
		backendFamilyVerified: backendVerified,
		hostPlatformVerified: value.hostPlatformVerified && backendVerified,
		imageDigestPresent: value.imageDigestPresent && backendVerified,
		imageDigestVerified: value.imageDigestVerified && backendVerified,
		recipeVerified: value.recipeVerified && backendVerified,
		isolationVerified: value.isolationVerified && backendVerified,
		noEngineSocketMountVerified: value.noEngineSocketMountVerified && backendVerified,
		noHostNetworkVerified: value.noHostNetworkVerified && backendVerified,
		noHostBindMountVerified: value.noHostBindMountVerified && backendVerified,
		destinationPinnedEgressDenyVerified:
			value.destinationPinnedEgressDenyVerified && backendVerified,
		metadataEgressDenyVerified: value.metadataEgressDenyVerified && backendVerified,
		dnsRebindingResistanceVerified: value.dnsRebindingResistanceVerified && backendVerified,
		quotaReady: value.quotaReady && backendVerified,
		cancellationVerified: value.cancellationVerified && backendVerified,
		cleanupVerified: value.cleanupVerified && backendVerified,
		artifactResolverReady: value.artifactResolverReady && backendVerified,
		credentialResolverReady: value.credentialResolverReady && backendVerified,
		secretDestructionVerified: value.secretDestructionVerified && backendVerified,
		limitationRefs,
		attestationRefs: value.attestationRefs,
	});
}

export function localContainerPostgresqlRuntime(
	graph: Graph,
	opts: LocalContainerPostgresqlRuntimeOptions,
): LocalContainerPostgresqlRuntimeBundle {
	if (!opts.admittedRunRequests.length || !opts.manifests.length || !opts.readiness.length)
		throw new TypeError("Container runtime requires admitted runs, manifests, and readiness.");
	if (opts.driver.compatibility !== LOCAL_CONTAINER_POSTGRESQL_COMPATIBILITY)
		throw new TypeError("Incompatible local-container driver.");
	const name = opts.name ?? "localContainerPostgresqlRuntime";
	const group = graph.topologyGroup({ name });
	const node = <T>(suffix: string) => group.node<T>([], null, { name: `${name}/${suffix}` });
	const admittedRunRequests = node<ToolProviderAdapterRunRequested>("admittedRunRequests");
	const runStatus = node<ToolProviderAdapterRunStatus>("runStatus");
	const outcomes = node<ExecutorOutcome>("outcomes");
	const phases = node<LocalContainerPostgresqlPhaseDetail>("phases");
	const cleanup = node<LocalContainerPostgresqlCleanupStatus>("cleanup");
	const issues = node<DataIssue>("issues");
	const audit = node<AgentRuntimeAuditRecord>("audit");
	const usage = node<ExecutorUsage & { readonly runId: string }>("usage");
	const movement = node<LocalContainerPostgresqlMovementEvidence>("movement");
	const cancellationProposals =
		node<LocalContainerPostgresqlCancellationProposal>("cancellationProposals");
	const cancellationAdmissions =
		node<LocalContainerPostgresqlCancellationAdmission>("cancellationAdmissions");
	const cancellationAcknowledgements = node<LocalContainerPostgresqlCancellationAcknowledgement>(
		"cancellationAcknowledgements",
	);
	const inputs = new Map<string, ToolProviderAdapterInput<PostgresqlQueryToolArguments>>();
	const manifests = new Map<string, LocalContainerPostgresqlManifest>();
	const ready = new Map<string, LocalContainerPostgresqlReadiness>();
	const active = new Map<string, Active>();
	const fingerprints = new Map<string, string>();
	const sessionOwners = new Map<string, string>();
	const proposals = new Map<string, LocalContainerPostgresqlCancellationProposal>();
	const pending = new Set<Promise<void>>();
	let disposed = false;
	let releasePending = false;
	const emitIssue = (code: string, message: string) =>
		issues.down([["DATA", Object.freeze({ kind: "issue", code, message, severity: "error" })]]);
	const phase = (run: Active, value: LocalContainerPostgresqlPhase) => {
		phases.down([
			[
				"DATA",
				Object.freeze({
					kind: "local-container-postgresql-phase-detail",
					runId: run.request.runId,
					attempt: run.request.attempt,
					environmentRevision: String(run.request.metadata?.executionEnvironmentRevision),
					manifestFingerprint: run.manifest.fingerprint,
					sessionEpoch: run.context.sessionEpoch,
					phase: value,
					occurredAtMs: opts.now?.(),
				}),
			],
		]);
		audit.down([
			[
				"DATA",
				Object.freeze({
					id: canonicalTupleKey([
						"local-container-postgresql-audit",
						run.request.runId,
						String(run.request.attempt),
						value,
					]),
					kind: `local-container-postgresql-${value}`,
					subjectId: run.request.runId,
					metadata: Object.freeze({
						attempt: run.request.attempt,
						environmentRevision: run.request.metadata?.executionEnvironmentRevision,
						manifestFingerprint: run.manifest.fingerprint,
						sessionEpoch: run.context.sessionEpoch,
					}),
				}),
			],
		]);
	};
	const cleanupOnce = (run: Active): Promise<void> => {
		if (run.cleanupPromise) return run.cleanupPromise;
		run.cleanupPromise = (async () => {
			phase(run, "removing");
			let failed = false;
			try {
				if (run.binding !== undefined) await opts.driver.remove(run.binding, run.context);
			} catch {
				failed = true;
			}
			phase(run, "cleaning");
			try {
				await opts.driver.cleanup(run.context);
			} catch {
				failed = true;
			}
			const issue = failed
				? Object.freeze({
						kind: "issue",
						code: "local-container-cleanup-failed",
						message: "Container cleanup could not be verified.",
						severity: "error",
					} satisfies DataIssue)
				: undefined;
			cleanup.down([
				[
					"DATA",
					Object.freeze({
						kind: "local-container-postgresql-cleanup-status",
						runId: run.request.runId,
						attempt: run.request.attempt,
						state: failed ? "failed" : "succeeded",
						...(issue ? { issue } : {}),
					}),
				],
			]);
			if (issue) issues.down([["DATA", issue]]);
		})();
		return run.cleanupPromise;
	};
	const terminateOnce = (run: Active): Promise<void> => {
		if (run.terminationPromise) return run.terminationPromise;
		run.cancelled = true;
		run.abortController.abort("local-container-termination");
		phase(run, "stop-requested");
		run.terminationPromise = (async () => {
			void Promise.resolve()
				.then(() => opts.driver.stop(run.binding, run.context, run.manifest.stopGraceMs))
				.catch(() => emitIssue("local-container-stop-failed", "Container stop request failed."));
			await new Promise<void>((resolve) => setTimeout(resolve, run.manifest.stopGraceMs));
			if (!run.settled) {
				phase(run, "kill-requested");
				try {
					await opts.driver.kill(run.binding, run.context);
				} catch {
					emitIssue("local-container-kill-failed", "Container kill request failed.");
				}
			}
			await cleanupOnce(run);
		})();
		return run.terminationPromise;
	};
	const settleDisposed = (run: Active) => {
		if (run.settled) return;
		run.settled = true;
		phase(run, "settled");
		const outcome = Object.freeze({
			kind: "canceled" as const,
			outcomeId: canonicalTupleKey([
				"local-container-postgresql-outcome",
				run.request.runId,
				String(run.request.attempt),
			]),
			requestId: run.request.requestId,
			operationId: run.request.operationId,
			routeId: run.request.routeId ?? "route:unavailable",
			executorId: run.request.executorId ?? "postgresql:tool-executor",
			profileId: run.request.profileId ?? "postgresql:local-container",
			attempt: run.request.attempt,
			inputId: run.request.adapterInputId,
			inputKind: "tool-call" as const,
			reason: "runtime-disposed",
			metadata: Object.freeze({
				runId: run.request.runId,
				executionEnvironmentRevision: run.request.metadata?.executionEnvironmentRevision,
				manifestFingerprint: run.manifest.fingerprint,
				sessionEpoch: run.context.sessionEpoch,
			}),
		} satisfies ExecutorOutcome);
		outcomes.down([["DATA", outcome]]);
		runStatus.down([
			[
				"DATA",
				Object.freeze({
					kind: "tool-provider-adapter-run-status",
					runId: run.request.runId,
					adapterInputId: run.request.adapterInputId,
					requestId: run.request.requestId,
					operationId: run.request.operationId,
					status: "canceled",
					attempt: run.request.attempt,
					outcomeId: outcome.outcomeId,
				}),
			],
		]);
		active.delete(run.request.runId);
	};
	const execute = (raw: ToolProviderAdapterRunRequested) => {
		if (disposed) return;
		if (!plain(raw)) {
			emitIssue("local-container-run-invalid", "Admitted run was not inert plain data.");
			return;
		}
		if (
			![
				raw.runId,
				raw.adapterInputId,
				raw.requestId,
				raw.operationId,
				raw.providerId,
				raw.executorId,
				raw.profileId,
				raw.reason,
			].every(boundedText) ||
			(raw.routeId !== undefined && !boundedText(raw.routeId)) ||
			!Number.isSafeInteger(raw.attempt) ||
			raw.attempt < 1
		) {
			emitIssue("local-container-run-invalid", "Admitted run coordinates were invalid.");
			return;
		}
		const metadata = raw.metadata;
		const manifestFingerprint = metadata?.executionManifestFingerprint;
		const sessionEpoch = metadata?.executionSessionEpoch;
		const environmentId = metadata?.executionEnvironmentId;
		const environmentRevision = metadata?.executionEnvironmentRevision;
		const fingerprint = JSON.stringify([
			raw.kind,
			raw.runId,
			raw.adapterInputId,
			raw.requestId,
			raw.operationId,
			raw.routeId,
			raw.providerId,
			raw.executorId,
			raw.profileId,
			raw.attempt,
			raw.reason,
			metadata?.executionEnvironmentId,
			environmentRevision,
			metadata?.executionEnvironmentLocality,
			metadata?.executionEnvironmentBindingKind,
			manifestFingerprint,
			sessionEpoch,
		]);
		const input = inputs.get(raw.adapterInputId);
		const manifest =
			typeof manifestFingerprint === "string" ? manifests.get(manifestFingerprint) : undefined;
		const posture =
			typeof manifestFingerprint === "string" ? ready.get(manifestFingerprint) : undefined;
		if (
			!input ||
			!manifest ||
			!posture ||
			metadata?.executionEnvironmentLocality !== "local" ||
			metadata?.executionEnvironmentBindingKind !== "local-container" ||
			!publicCoordinate(environmentId) ||
			!publicCoordinate(sessionEpoch) ||
			!publicCoordinate(environmentRevision) ||
			manifest.backendFamily !== LOCAL_CONTAINER_POSTGRESQL_BACKEND_FAMILY ||
			posture.backendFamily !== LOCAL_CONTAINER_POSTGRESQL_BACKEND_FAMILY ||
			posture.backendCertificationRevision !== manifest.backendCertificationRevision ||
			posture.state !== "ready" ||
			posture.observedAtMs > (opts.now?.() ?? Date.now()) ||
			posture.expiresAtMs <= (opts.now?.() ?? Date.now()) ||
			![
				posture.engineReachable,
				posture.compatibilityVerified,
				posture.backendFamilyVerified,
				posture.hostPlatformVerified,
				posture.imageDigestPresent,
				posture.imageDigestVerified,
				posture.recipeVerified,
				posture.isolationVerified,
				posture.noEngineSocketMountVerified,
				posture.noHostNetworkVerified,
				posture.noHostBindMountVerified,
				posture.destinationPinnedEgressDenyVerified,
				posture.metadataEgressDenyVerified,
				posture.dnsRebindingResistanceVerified,
				posture.quotaReady,
				posture.cancellationVerified,
				posture.cleanupVerified,
				posture.artifactResolverReady,
				posture.credentialResolverReady,
				posture.secretDestructionVerified,
			].every(Boolean)
		) {
			emitIssue(
				"local-container-admission-blocked",
				"Exact ready local-container evidence was not available.",
			);
			return;
		}
		if (
			!plain(input) ||
			input.requestId !== raw.requestId ||
			input.operationId !== raw.operationId ||
			input.routeId !== raw.routeId ||
			input.providerId !== raw.providerId ||
			input.executorId !== raw.executorId ||
			input.profileId !== raw.profileId ||
			input.status !== "ready" ||
			input.toolName !== "postgresql.query"
		) {
			emitIssue(
				"local-container-input-mismatch",
				"Admitted run did not match a ready PostgreSQL input.",
			);
			return;
		}
		let safeArguments: PostgresqlQueryToolArguments;
		try {
			safeArguments = postgresqlQueryToolArgumentsFromIntent(
				input.toolCall?.arguments as PostgresqlQueryToolArguments,
			);
		} catch {
			emitIssue(
				"local-container-input-invalid",
				"PostgreSQL arguments were not bounded coordinate-only data.",
			);
			return;
		}
		const prior = fingerprints.get(raw.runId);
		if (prior !== undefined) {
			if (prior !== fingerprint)
				emitIssue(
					"local-container-run-conflict",
					"Run identity was reused with different immutable coordinates.",
				);
			return;
		}
		fingerprints.set(raw.runId, fingerprint);
		const sessionOwner = sessionOwners.get(sessionEpoch);
		if (sessionOwner !== undefined && sessionOwner !== fingerprint) {
			emitIssue(
				"local-container-session-reused",
				"Container session epoch was already owned by another admitted attempt.",
			);
			return;
		}
		sessionOwners.set(sessionEpoch, fingerprint);
		const abortController = new AbortController();
		const context: LocalContainerPostgresqlDriverContext = Object.freeze({
			runId: raw.runId,
			attempt: raw.attempt,
			sessionEpoch,
			manifestFingerprint: manifest.fingerprint,
			signal: abortController.signal,
		});
		const safeRequest: ToolProviderAdapterRunRequested = Object.freeze({
			kind: "tool-provider-adapter-run-requested",
			runId: raw.runId,
			adapterInputId: raw.adapterInputId,
			requestId: raw.requestId,
			operationId: raw.operationId,
			routeId: raw.routeId,
			providerId: raw.providerId,
			executorId: raw.executorId,
			profileId: raw.profileId,
			attempt: raw.attempt,
			reason: raw.reason,
			metadata: Object.freeze({
				executionEnvironmentId: environmentId,
				executionEnvironmentRevision: environmentRevision,
				executionEnvironmentLocality: "local",
				executionEnvironmentBindingKind: "local-container",
				executionSessionEpoch: sessionEpoch,
				executionManifestFingerprint: manifest.fingerprint,
			}),
		});
		const run: Active = {
			request: safeRequest,
			context,
			manifest,
			abortController,
			cancelled: false,
			settled: false,
			startedAtMs: opts.now?.() ?? Date.now(),
		};
		active.set(raw.runId, run);
		admittedRunRequests.down([["DATA", run.request]]);
		runStatus.down([
			[
				"DATA",
				Object.freeze({
					kind: "tool-provider-adapter-run-status",
					runId: raw.runId,
					adapterInputId: raw.adapterInputId,
					requestId: raw.requestId,
					operationId: raw.operationId,
					status: "started",
					attempt: raw.attempt,
				}),
			],
		]);
		phase(run, "preparing");
		const task = (async () => {
			let result: PostgresqlDriverQueryResult | undefined;
			let failure: DataIssue | undefined;
			try {
				await opts.driver.prepare(context);
				phase(run, "creating");
				run.binding = await opts.driver.create(context, safeArguments);
				phase(run, "starting");
				await opts.driver.start(run.binding, context);
				phase(run, "running");
				phase(run, "waiting");
				result = safeDriverResult(await opts.driver.wait(run.binding, context));
			} catch {
				failure = Object.freeze({
					kind: "issue",
					code: run.cancelled ? "local-container-canceled" : "local-container-execution-failed",
					message: run.cancelled
						? "Container execution was canceled."
						: "Container execution failed.",
					severity: "error",
				});
			}
			await cleanupOnce(run);
			if (run.settled || disposed) {
				active.delete(raw.runId);
				return;
			}
			run.settled = true;
			phase(run, "settled");
			const base = {
				outcomeId: canonicalTupleKey([
					"local-container-postgresql-outcome",
					raw.runId,
					String(raw.attempt),
				]),
				requestId: raw.requestId,
				operationId: raw.operationId,
				routeId: raw.routeId ?? "route:unavailable",
				executorId: raw.executorId ?? "postgresql:tool-executor",
				profileId: raw.profileId ?? "postgresql:local-container",
				attempt: raw.attempt,
				inputId: raw.adapterInputId,
				inputKind: "tool-call",
				metadata: Object.freeze({
					runId: raw.runId,
					executionEnvironmentRevision: environmentRevision,
					manifestFingerprint,
					sessionEpoch,
				}),
			} as const;
			const outcome: ExecutorOutcome = run.cancelled
				? Object.freeze({ ...base, kind: "canceled", reason: "admitted-user-cancellation" })
				: failure
					? Object.freeze({
							...base,
							kind: "failure",
							error: failure,
							retryable: false,
							issues: [failure],
						})
					: Object.freeze({
							...base,
							kind: "result",
							result: {
								kind: "postgresql-query-result",
								value: Object.freeze({
									columns: Object.freeze([...(result?.columns ?? [])]),
									rowCount: result?.rowCount ?? result?.rows?.length ?? 0,
								}),
							},
						});
			outcomes.down([["DATA", outcome]]);
			runStatus.down([
				[
					"DATA",
					{
						kind: "tool-provider-adapter-run-status",
						runId: raw.runId,
						adapterInputId: raw.adapterInputId,
						requestId: raw.requestId,
						operationId: raw.operationId,
						status: outcome.kind,
						attempt: raw.attempt,
						outcomeId: outcome.outcomeId,
					},
				],
			]);
			const bytes = result?.byteLength ?? 0;
			usage.down([
				[
					"DATA",
					Object.freeze({
						runId: raw.runId,
						latencyMs: Math.max(0, (opts.now?.() ?? Date.now()) - run.startedAtMs),
					}),
				],
			]);
			movement.down([
				[
					"DATA",
					Object.freeze({
						kind: "local-container-postgresql-movement-evidence",
						runId: raw.runId,
						direction: "container-to-host",
						classification: "postgresql-query-result",
						bytes,
						truncated: false,
						...(result?.resultRef ? { artifactRefs: [result.resultRef] } : {}),
					}),
				],
			]);
			active.delete(raw.runId);
		})().finally(() => pending.delete(task));
		pending.add(task);
	};
	const requestCancel = (request: LocalContainerPostgresqlCancellationRequested) => {
		if (
			!plain(request) ||
			!Object.keys(request).every((key) =>
				[
					"kind",
					"cancellationId",
					"runId",
					"attempt",
					"environmentRevision",
					"manifestFingerprint",
					"sessionEpoch",
				].includes(key),
			) ||
			request.kind !== "local-container-postgresql-cancellation-requested" ||
			![
				request.cancellationId,
				request.runId,
				request.environmentRevision,
				request.manifestFingerprint,
				request.sessionEpoch,
			].every((value) => typeof value === "string" && SAFE.test(value)) ||
			!Number.isSafeInteger(request.attempt) ||
			request.attempt < 1
		) {
			emitIssue(
				"local-container-cancellation-invalid",
				"Cancellation request was not strict inert data.",
			);
			return;
		}
		const run = active.get(request.runId);
		if (
			!run ||
			request.attempt !== run.request.attempt ||
			request.environmentRevision !== run.request.metadata?.executionEnvironmentRevision ||
			request.manifestFingerprint !== run.manifest.fingerprint ||
			request.sessionEpoch !== run.context.sessionEpoch ||
			!SAFE.test(request.cancellationId)
		) {
			emitIssue(
				"local-container-cancellation-coordinate-mismatch",
				"Cancellation did not exactly match the active container attempt.",
			);
			return;
		}
		const proposal = Object.freeze({
			...request,
			kind: "local-container-postgresql-cancellation-proposal" as const,
			proposalId: canonicalTupleKey([
				"local-container-postgresql-cancel",
				request.cancellationId,
				request.runId,
			]),
		});
		proposals.set(proposal.proposalId, proposal);
		cancellationProposals.down([["DATA", proposal]]);
	};
	const decideCancel = (decision: LocalContainerPostgresqlCancellationDecision) => {
		if (
			!plain(decision) ||
			!Object.keys(decision).every((key) =>
				["kind", "decisionId", "proposalId", "outcome"].includes(key),
			) ||
			decision.kind !== "local-container-postgresql-cancellation-decision" ||
			![decision.decisionId, decision.proposalId].every(
				(value) => typeof value === "string" && value.length > 0 && value.length <= 512,
			) ||
			!(["admit", "block"] as const).includes(decision.outcome)
		) {
			emitIssue(
				"local-container-cancellation-decision-invalid",
				"Cancellation decision was not strict inert data.",
			);
			return;
		}
		const proposal = proposals.get(decision.proposalId);
		if (!proposal) {
			emitIssue(
				"local-container-cancellation-decision-missing",
				"Cancellation decision had no proposal.",
			);
			return;
		}
		proposals.delete(decision.proposalId);
		const run = active.get(proposal.runId);
		const admitted =
			decision.outcome === "admit" &&
			run &&
			!run.terminationPromise &&
			proposal.attempt === run.request.attempt &&
			proposal.manifestFingerprint === run.manifest.fingerprint &&
			proposal.sessionEpoch === run.context.sessionEpoch;
		cancellationAdmissions.down([
			[
				"DATA",
				Object.freeze({
					kind: "local-container-postgresql-cancellation-admission",
					proposalId: proposal.proposalId,
					decisionId: decision.decisionId,
					runId: proposal.runId,
					state: admitted ? "admitted" : "blocked",
				}),
			],
		]);
		if (admitted && run) {
			cancellationAcknowledgements.down([
				[
					"DATA",
					Object.freeze({
						kind: "local-container-postgresql-cancellation-acknowledgement",
						proposalId: proposal.proposalId,
						runId: proposal.runId,
						state: "stop-requested",
					}),
				],
			]);
			void terminateOnce(run);
		}
	};
	const unsubs = [
		opts.inputs.subscribe((m) => {
			if (m[0] === "DATA") {
				try {
					const v = snapshotInput(m[1] as ToolProviderAdapterInput<PostgresqlQueryToolArguments>);
					inputs.set(v.adapterInputId, v);
				} catch {
					emitIssue("local-container-input-invalid", "PostgreSQL input was not strict inert data.");
				}
			}
		}),
		...opts.manifests.map((n) =>
			n.subscribe((m) => {
				if (m[0] === "DATA") {
					try {
						const v = localContainerPostgresqlManifest(m[1] as LocalContainerPostgresqlManifest);
						const prior = manifests.get(v.fingerprint);
						if (prior && JSON.stringify(prior) !== JSON.stringify(v)) {
							emitIssue(
								"local-container-manifest-conflict",
								"Manifest fingerprint was reused with different immutable content.",
							);
							return;
						}
						manifests.set(v.fingerprint, v);
					} catch {
						emitIssue("local-container-manifest-invalid", "Manifest was invalid.");
					}
				}
			}),
		),
		...opts.readiness.map((n) =>
			n.subscribe((m) => {
				if (m[0] === "DATA") {
					try {
						const v = localContainerPostgresqlReadiness(m[1] as LocalContainerPostgresqlReadiness);
						ready.set(v.manifestFingerprint, v);
					} catch {
						emitIssue("local-container-readiness-invalid", "Readiness was invalid.");
					}
				}
			}),
		),
		...opts.admittedRunRequests.map((n) =>
			n.subscribe((m) => {
				if (m[0] === "DATA") execute(m[1] as ToolProviderAdapterRunRequested);
			}),
		),
		...(opts.cancellationRequests ?? []).map((n) =>
			n.subscribe((m) => {
				if (m[0] === "DATA") requestCancel(m[1] as LocalContainerPostgresqlCancellationRequested);
			}),
		),
		...(opts.cancellationDecisions ?? []).map((n) =>
			n.subscribe((m) => {
				if (m[0] === "DATA") decideCancel(m[1] as LocalContainerPostgresqlCancellationDecision);
			}),
		),
	];
	return Object.freeze({
		admittedRunRequests,
		runStatus,
		outcomes,
		phases,
		cleanup,
		issues,
		audit,
		usage,
		movement,
		cancellationProposals,
		cancellationAdmissions,
		cancellationAcknowledgements,
		async dispose() {
			if (!disposed) {
				disposed = true;
				for (const unsubscribe of unsubs) unsubscribe();
				const disposingRuns = [...active.values()];
				await Promise.allSettled(disposingRuns.map((run) => terminateOnce(run)));
				for (const run of disposingRuns) settleDisposed(run);
				pending.clear();
				inputs.clear();
				manifests.clear();
				ready.clear();
				proposals.clear();
				fingerprints.clear();
				sessionOwners.clear();
			}
			if (!releasePending) {
				try {
					group.release({ reason: `${name}:dispose` });
					releasePending = true;
				} catch {}
			}
		},
	});
}

function refs(value: readonly SourceRef[]): readonly SourceRef[] {
	if (!Array.isArray(value) || value.length === 0 || value.length > 32)
		throw new TypeError("Invalid attestation refs.");
	return Object.freeze(
		value.map((ref) => {
			if (
				!plain(ref) ||
				!publicCoordinate(ref.kind) ||
				!publicCoordinate(ref.id) ||
				ref.metadata !== undefined
			)
				throw new TypeError("Invalid attestation ref.");
			return Object.freeze({ kind: ref.kind, id: ref.id });
		}),
	);
}

function publicCoordinate(value: unknown): value is string {
	if (typeof value !== "string" || !SAFE.test(value)) return false;
	const lower = value.toLowerCase();
	const compact = lower.replace(/[^a-z0-9]+/g, "");
	const tokens = lower.split(/[^a-z0-9]+/u).filter(Boolean);
	return (
		!PRIVATE_COMPACT_MATERIAL.some((term) => compact.includes(term)) &&
		!tokens.some((token) => PRIVATE_TOKEN_MATERIAL.includes(token))
	);
}
function plain(value: unknown, seen = new Set<object>()): boolean {
	if (value === null || ["string", "boolean", "undefined"].includes(typeof value)) return true;
	if (typeof value === "number") return Number.isFinite(value);
	if (
		typeof value !== "object" ||
		(Array.isArray(value) &&
			(value.length > 256 ||
				Object.keys(value).length !== value.length ||
				!value.every((v) => plain(v, seen))))
	)
		return false;
	if (seen.has(value as object)) return false;
	seen.add(value as object);
	const proto = Object.getPrototypeOf(value);
	if (!Array.isArray(value) && proto !== Object.prototype && proto !== null) return false;
	const descriptors = Object.values(Object.getOwnPropertyDescriptors(value));
	if (descriptors.length > 256) return false;
	for (const descriptor of descriptors) {
		if (
			descriptor.get ||
			descriptor.set ||
			!("value" in descriptor) ||
			!plain(descriptor.value, seen)
		)
			return false;
	}
	seen.delete(value as object);
	return true;
}

function snapshotInput(
	value: ToolProviderAdapterInput<PostgresqlQueryToolArguments>,
): ToolProviderAdapterInput<PostgresqlQueryToolArguments> {
	if (
		!plain(value) ||
		!boundedText(value.adapterInputId) ||
		value.toolCall?.kind !== "tool-call" ||
		!boundedText(value.toolCall.toolName) ||
		!boundedText(value.toolCall.operation) ||
		value.toolCall.arguments === undefined
	)
		throw new TypeError("Invalid input.");
	const args = postgresqlQueryToolArgumentsFromIntent(value.toolCall.arguments);
	return Object.freeze({
		...value,
		toolCall: Object.freeze({
			...value.toolCall,
			kind: "tool-call",
			toolName: value.toolCall.toolName,
			operation: value.toolCall.operation,
			arguments: args,
		}),
		policies: Object.freeze(
			[...(value.policies ?? [])].map((policy) => Object.freeze({ ...policy })),
		),
	});
}

function boundedText(value: unknown): value is string {
	if (typeof value !== "string" || value.length === 0 || value.length > 512) return false;
	for (let index = 0; index < value.length; index++) {
		const code = value.charCodeAt(index);
		if (code < 32 || code === 127) return false;
	}
	return true;
}

function safeDriverResult(value: PostgresqlDriverQueryResult): PostgresqlDriverQueryResult {
	if (!plain(value) || !Array.isArray(value.columns) || value.columns.length > 128)
		throw new TypeError("Invalid PostgreSQL driver result.");
	const columns = value.columns.map((column) => {
		if (typeof column !== "string" || column.length === 0 || column.length > 255)
			throw new TypeError("Invalid PostgreSQL result column.");
		return column;
	});
	const rowCount = value.rowCount ?? value.rows?.length ?? 0;
	const byteLength = value.byteLength ?? 0;
	if (
		!Number.isSafeInteger(rowCount) ||
		rowCount < 0 ||
		!Number.isSafeInteger(byteLength) ||
		byteLength < 0 ||
		byteLength > 1_000_000_000
	)
		throw new TypeError("Invalid PostgreSQL result measures.");
	let resultRef: SourceRef | undefined;
	if (value.resultRef !== undefined) resultRef = refs([value.resultRef])[0];
	return Object.freeze({
		columns: Object.freeze(columns),
		rowCount,
		byteLength,
		...(resultRef ? { resultRef } : {}),
	});
}
