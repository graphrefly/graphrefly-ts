/** D667 Node rootless-Podman Libpod API v0 broker. */
import { execFile } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { lstat, realpath } from "node:fs/promises";
import { request as httpRequest } from "node:http";
import { promisify } from "node:util";
import { strictCanonicalJsonBytes } from "../../json/codec.js";
import type {
	LocalUntrustedJsComputeArguments,
	LocalUntrustedJsComputeDriver,
	LocalUntrustedJsComputeDriverContext,
	LocalUntrustedJsComputeDriverOutcome,
	LocalUntrustedJsComputeManifest,
	LocalUntrustedJsComputeMaterial,
	LocalUntrustedJsComputeReadiness,
	LocalUntrustedJsComputeRunnerControl,
	LocalUntrustedJsComputeRunnerResult,
	LocalUntrustedJsJson,
} from "../local-untrusted-js-compute.js";
import {
	LOCAL_UNTRUSTED_JS_COMPUTE_COMPATIBILITY,
	localUntrustedJsComputeArguments,
	localUntrustedJsComputeDriverOutcome,
	localUntrustedJsComputeManifest,
	localUntrustedJsComputeReadiness,
} from "../local-untrusted-js-compute.js";

declare const __GRAPHREFLY_TS_PACKAGE_REVISION__: string;

const execFileAsync = promisify(execFile);
const API_REVISION = "5.0.3";
const RUNNER_ENTRYPOINT = [
	"/nodejs/bin/node",
	"--experimental-vm-modules",
	"--no-addons",
	"--disable-proto=throw",
	"/opt/graphrefly/local-untrusted-js-runner.mjs",
];
const BOUNDARY_LABEL = "d667-local-untrusted-js-compute";
const DEFAULT_REQUEST_TIMEOUT_MS = 10_000;
const MAX_ENGINE_RESPONSE_BYTES = 512 * 1024;
const MAX_LOG_BYTES = 1024 * 1024 + 8 * 1024;
const MAX_CONTROL_BYTES = 32 * 1024;
const MEMORY_LIMIT_BYTES = 256 * 1024 * 1024;
const TMPFS_LIMIT_BYTES = 16 * 1024 * 1024;
const PIDS_LIMIT = 64;
const CPU_PERIOD = 100_000;
const CPU_QUOTA = 100_000;
const FILE_SIZE_LIMIT_BYTES = 16 * 1024 * 1024;
const NOFILE_LIMIT = 128;
const ID = /^[a-f0-9]{64}$/;
const SAFE_IMAGE = /^[A-Za-z0-9][A-Za-z0-9._:/@+-]{0,254}$/;
const NAMED_DIGEST_IMAGE = /^[A-Za-z0-9][A-Za-z0-9._:/+-]{0,190}@sha256:[a-f0-9]{64}$/;
const CERTIFICATION_TTL_MS = 5 * 60_000;
const CERTIFICATION_CANCEL_DELAY_MS = 500;

export const NODE_LOCAL_UNTRUSTED_JS_RUNNER_REVISION = "graphrefly-local-js-runner-v0" as const;
export const NODE_LOCAL_UNTRUSTED_JS_GRAPHREFLY_PACKAGE_REVISION: string =
	__GRAPHREFLY_TS_PACKAGE_REVISION__;
export const NODE_LOCAL_UNTRUSTED_JS_ALLOWED_API_REVISION =
	"graphrefly-source-derive-api-v0" as const;
export const NODE_LOCAL_UNTRUSTED_JS_SANDBOX_POLICY_REVISION = "podman-vm-no-imports-v0" as const;
export const NODE_LOCAL_UNTRUSTED_JS_RESOURCE_POLICY_REVISION =
	"podman-256m-1cpu-64pids-v0" as const;
export const NODE_LOCAL_UNTRUSTED_JS_OUTPUT_POLICY_REVISION =
	"strict-json-topology-provenance-v0" as const;

interface PodmanBinding {
	readonly socketPath: string;
	readonly containerId?: string;
	readonly containerName: string;
	readonly runLabel: string;
	readonly manifestFingerprint: string;
	readonly capabilityDrop: readonly string[];
}

interface PodmanHostBinding {
	readonly socketPath: string;
	readonly hostBindingDigest: string;
	readonly capabilityDrop: readonly string[];
}

interface RawResponse {
	readonly status: number;
	readonly body: Uint8Array;
}

export interface NodeLocalUntrustedJsComputeDriverOptions {
	readonly imageRef: string;
}

export interface NodeLocalUntrustedJsComputeHostBindingAttestation {
	readonly kind: "node-local-untrusted-js-compute-host-binding";
	readonly hostBindingDigest: string;
	readonly apiRevision: typeof API_REVISION;
	readonly rootless: true;
}

export interface NodeLocalUntrustedJsComputeCertificationOptions {
	readonly manifest: LocalUntrustedJsComputeManifest;
	readonly imageRef: string;
	readonly signal?: AbortSignal;
	readonly now?: () => number;
}

/**
 * Returns only a digest-bound host attestation. Socket paths and engine handles
 * remain private; the broker rechecks the same digest before every allocation.
 */
export async function nodeLocalUntrustedJsComputeHostBindingAttestation(
	signal?: AbortSignal,
): Promise<NodeLocalUntrustedJsComputeHostBindingAttestation> {
	const binding = await discoverRootlessPodmanBinding(signal);
	if (binding === undefined)
		throw new TypeError("D667 rootless Podman host binding is unavailable.");
	return Object.freeze({
		kind: "node-local-untrusted-js-compute-host-binding",
		hostBindingDigest: binding.hostBindingDigest,
		apiRevision: API_REVISION,
		rootless: true,
	});
}

/**
 * Mints D667 readiness only after the fixed image executes a real Graph, denies
 * ambient module authority, honors cancellation and verifies terminal removal.
 */
export async function certifyNodeLocalUntrustedJsCompute(
	opts: NodeLocalUntrustedJsComputeCertificationOptions,
): Promise<LocalUntrustedJsComputeReadiness> {
	const manifest = localUntrustedJsComputeManifest(opts.manifest);
	if (
		manifest.runnerRevision !== NODE_LOCAL_UNTRUSTED_JS_RUNNER_REVISION ||
		manifest.allowedApiRevision !== NODE_LOCAL_UNTRUSTED_JS_ALLOWED_API_REVISION ||
		manifest.sandboxPolicyRevision !== NODE_LOCAL_UNTRUSTED_JS_SANDBOX_POLICY_REVISION ||
		manifest.resourcePolicyRevision !== NODE_LOCAL_UNTRUSTED_JS_RESOURCE_POLICY_REVISION ||
		manifest.outputPolicyRevision !== NODE_LOCAL_UNTRUSTED_JS_OUTPUT_POLICY_REVISION ||
		manifest.graphreflyPackageRevision !== NODE_LOCAL_UNTRUSTED_JS_GRAPHREFLY_PACKAGE_REVISION ||
		manifest.executionTimeoutMs < 2_000 ||
		!opts.imageRef.endsWith(`@${manifest.runnerImageDigest}`)
	)
		throw new TypeError("D667 certifier requires the package-owned fixed runner profile.");
	const host = await nodeLocalUntrustedJsComputeHostBindingAttestation(opts.signal);
	const driver = nodeLocalUntrustedJsComputeDriver({ imageRef: opts.imageRef });
	const probeSuffix = randomUUID();
	const runProbe = (
		label: string,
		bundleSource: string,
		input: LocalUntrustedJsJson,
		signal: AbortSignal,
	): Promise<{
		readonly outcome: LocalUntrustedJsComputeDriverOutcome;
		readonly args: LocalUntrustedJsComputeArguments;
		readonly runAdmissionId: string;
	}> => {
		const bundle = new TextEncoder().encode(bundleSource);
		const args = localUntrustedJsComputeArguments(
			{
				contractVersion: "1",
				runId: `certify:d667:${probeSuffix}:${label}`,
				attempt: 1,
				epoch: "certification:1",
				sourceRevision: `certification-source:${label}`,
				sourceDigest: `sha256:${createHash("sha256").update(bundleSource).digest("hex")}`,
				bundleRevision: `certification-bundle:${label}`,
				bundleDigest: `sha256:${createHash("sha256").update(bundle).digest("hex")}`,
				compilerRevision: manifest.compilerRevision,
				allowedApiRevision: manifest.allowedApiRevision,
				graphreflyPackageRevision: manifest.graphreflyPackageRevision,
				runnerRevision: manifest.runnerRevision,
				runnerImageDigest: manifest.runnerImageDigest,
				sandboxPolicyRevision: manifest.sandboxPolicyRevision,
				networkPolicyRevision: manifest.networkPolicyRevision,
				filesystemPolicyRevision: manifest.filesystemPolicyRevision,
				resourcePolicyRevision: manifest.resourcePolicyRevision,
				outputPolicyRevision: manifest.outputPolicyRevision,
				admittedInputRefs: [`certification-input:${label}`],
				inputDigest: `sha256:${createHash("sha256")
					.update(strictCanonicalJsonBytes(input))
					.digest("hex")}`,
			},
			manifest,
		);
		const runAdmissionId = `certification-admission:${probeSuffix}:${label}`;
		return Promise.resolve(
			driver.execute(
				{
					runId: args.runId,
					attempt: args.attempt,
					epoch: args.epoch,
					manifestFingerprint: manifest.fingerprint,
					hostBindingDigest: host.hostBindingDigest,
					runAdmissionId,
					signal,
				},
				args,
				{ bundle, input },
				manifest,
			),
		).then((outcome) => ({ outcome, args, runAdmissionId }));
	};
	const positiveProbe = await runProbe(
		"positive",
		`export default async ({ graphrefly, input }) => {
			graphrefly.graph("certified-runner-graph");
			const rows = graphrefly.source("rows", input.rows);
			let graphRuntimeComputeCount = 0;
			const count = graphrefly.derive("count", [rows], function (value) {
				if (this !== undefined) throw new TypeError("Derived callback receiver is not empty.");
				graphRuntimeComputeCount += 1;
				return value.length;
			});
			const blocked = (attempt) => {
				try {
					attempt();
					return true;
				} catch {
					return false;
				}
			};
			let caughtDynamicImportConstructorEscape = true;
			let caughtDynamicImportBuiltinEscape = true;
			try {
				await import("node:child_process");
			} catch (error) {
				caughtDynamicImportConstructorEscape = blocked(() =>
					error.constructor.constructor("return process")(),
				);
				caughtDynamicImportBuiltinEscape = blocked(() =>
					error.constructor
						.constructor("return process")()
						.getBuiltinModule("node:fs"),
				);
			}
			const answer = graphrefly.derive("answer", [count], (value) => {
				graphRuntimeComputeCount += 1;
				return {
					count: value,
					graphRuntimeComputeCount,
					ambient: {
						process: typeof process !== "undefined",
						require: typeof require !== "undefined",
						fetch: typeof fetch !== "undefined",
						apiConstructorEscape: blocked(() =>
							graphrefly.source.constructor("return process")(),
						),
						globalConstructorEscape: blocked(() =>
							globalThis.constructor.constructor("return process")(),
						),
						inputConstructorEscape: blocked(() =>
							input.constructor.constructor("return process")(),
						),
						legacyHostInputGlobal: typeof __graphreflyAdmittedInput !== "undefined",
						runnerBridgeGlobal: typeof __graphreflyRunnerRun !== "undefined",
						userMainBridgeGlobal: typeof __graphreflyUserMain !== "undefined",
						inputJsonBridgeGlobal: typeof __graphreflyAdmittedInputJson !== "undefined",
						caughtDynamicImportConstructorEscape,
						caughtDynamicImportBuiltinEscape,
						stringEval: blocked(() => eval("1")),
					},
				};
			});
			return answer;
		};`,
		{ rows: [{ id: 1 }, { id: 2 }] },
		opts.signal ?? new AbortController().signal,
	);
	const positive = localUntrustedJsComputeDriverOutcome(
		positiveProbe.outcome,
		positiveProbe.args,
		manifest,
		positiveProbe.runAdmissionId,
	);
	if (positive.outcome !== "succeeded" || positive.cleanup !== "succeeded")
		throw new TypeError("D667 fixed runner positive Graph probe failed.");
	const positiveAnswer = positive.result.answer;
	if (!localJsonRecord(positiveAnswer))
		throw new TypeError("D667 fixed runner answer probe failed.");
	const positiveAmbient = positiveAnswer.ambient;
	if (!localJsonRecord(positiveAmbient))
		throw new TypeError("D667 fixed runner ambient probe failed.");
	if (
		positiveAnswer.count !== 2 ||
		positiveAnswer.graphRuntimeComputeCount !== 2 ||
		Object.values(positiveAmbient).some((entry) => entry !== false) ||
		positive.result.topology.name !== "certified-runner-graph" ||
		positive.result.topology.nodes.length !== 3 ||
		positive.result.topology.edges.length !== 2 ||
		positive.result.describe.nodes.length !== 3 ||
		positive.result.cleanup.graphNodesAfterDispose !== 0 ||
		positive.result.cleanup.graphEdgesAfterDispose !== 0
	)
		throw new TypeError("D667 fixed runner positive Graph probe failed.");
	const deniedStaticImport = (
		await runProbe(
			"static-import-denied",
			`import fs from "node:fs"; export default () => fs.readFileSync("/etc/passwd", "utf8");`,
			{ admitted: true },
			opts.signal ?? new AbortController().signal,
		)
	).outcome;
	if (
		deniedStaticImport.outcome !== "failed" ||
		deniedStaticImport.code !== "local-untrusted-js-compute-runner-failed" ||
		deniedStaticImport.cleanup !== "succeeded"
	)
		throw new TypeError("D667 fixed runner static-import denial probe failed.");
	const deniedDynamicImport = (
		await runProbe(
			"dynamic-import-denied",
			`export default async () => import("node:child_process");`,
			{ admitted: true },
			opts.signal ?? new AbortController().signal,
		)
	).outcome;
	if (
		deniedDynamicImport.outcome !== "failed" ||
		deniedDynamicImport.code !== "local-untrusted-js-compute-runner-failed" ||
		deniedDynamicImport.cleanup !== "succeeded"
	)
		throw new TypeError("D667 fixed runner dynamic-import denial probe failed.");
	const deniedDetachedAnswer = (
		await runProbe(
			"detached-answer-denied",
			`export default () => ({ answer: "not-a-graph-node" });`,
			{ admitted: true },
			opts.signal ?? new AbortController().signal,
		)
	).outcome;
	if (
		deniedDetachedAnswer.outcome !== "failed" ||
		deniedDetachedAnswer.code !== "local-untrusted-js-compute-runner-failed" ||
		deniedDetachedAnswer.cleanup !== "succeeded"
	)
		throw new TypeError("D667 fixed runner Graph-node answer probe failed.");
	const cancellation = new AbortController();
	const cancelSignal =
		opts.signal === undefined
			? cancellation.signal
			: AbortSignal.any([opts.signal, cancellation.signal]);
	const timer = setTimeout(() => cancellation.abort(), CERTIFICATION_CANCEL_DELAY_MS);
	let canceled: LocalUntrustedJsComputeDriverOutcome;
	try {
		canceled = (
			await runProbe(
				"cancellation",
				`export default () => { while (true) {} };`,
				{ admitted: true },
				cancelSignal,
			)
		).outcome;
	} finally {
		clearTimeout(timer);
	}
	if (canceled.outcome !== "canceled" || canceled.cleanup !== "succeeded")
		throw new TypeError(
			`D667 fixed runner cancellation and cleanup probe failed (${canceled.outcome}/${"code" in canceled ? canceled.code : "none"}/${canceled.cleanup}).`,
		);
	const observedAtMs = (opts.now ?? Date.now)();
	if (!Number.isSafeInteger(observedAtMs))
		throw new TypeError("D667 certification clock is invalid.");
	return localUntrustedJsComputeReadiness(
		{
			kind: "local-untrusted-js-compute-readiness",
			manifestFingerprint: manifest.fingerprint,
			state: "ready",
			observedAtMs,
			expiresAtMs: observedAtMs + CERTIFICATION_TTL_MS,
			rootlessVerified: true,
			imageDigestVerified: true,
			runnerVerified: true,
			nonRootVerified: true,
			readOnlyRootFilesystemVerified: true,
			noNewPrivilegesVerified: true,
			capabilitiesDroppedVerified: true,
			noEngineSocketMountVerified: true,
			noHostBindMountVerified: true,
			denyNetworkVerified: true,
			resourceBoundsVerified: true,
			cancellationVerified: true,
			cleanupVerified: true,
			hostBindingDigest: host.hostBindingDigest,
			attestationRefs: [
				"d667:fixed-runner-positive-graph",
				"d667:actual-graph-runtime-computation-and-node-answer",
				"d667:static-and-dynamic-import-denied",
				"d667:ambient-process-require-fetch-and-host-realm-constructors-absent",
				"d667:rootless-containment-inspected",
				"d667:cancellation-and-terminal-removal",
			],
		},
		manifest,
		observedAtMs,
	);
}

/**
 * Creates the exact D667 Node broker. The caller selects no endpoint, command,
 * entrypoint, network, mount, user or containment option.
 */
export function nodeLocalUntrustedJsComputeDriver(
	opts: NodeLocalUntrustedJsComputeDriverOptions,
): LocalUntrustedJsComputeDriver {
	if (!SAFE_IMAGE.test(opts.imageRef) || !NAMED_DIGEST_IMAGE.test(opts.imageRef))
		throw new TypeError("D667 runner image must be digest pinned.");
	return Object.freeze({
		compatibility: LOCAL_UNTRUSTED_JS_COMPUTE_COMPATIBILITY,
		execute: async (
			context: LocalUntrustedJsComputeDriverContext,
			args: LocalUntrustedJsComputeArguments,
			material: LocalUntrustedJsComputeMaterial,
			manifest: LocalUntrustedJsComputeManifest,
		): Promise<LocalUntrustedJsComputeDriverOutcome> =>
			executeAttempt(opts.imageRef, context, args, material, manifest),
	});
}

async function executeAttempt(
	imageRef: string,
	context: LocalUntrustedJsComputeDriverContext,
	args: LocalUntrustedJsComputeArguments,
	material: LocalUntrustedJsComputeMaterial,
	manifest: LocalUntrustedJsComputeManifest,
): Promise<LocalUntrustedJsComputeDriverOutcome> {
	let binding: PodmanBinding | undefined;
	let outcome: LocalUntrustedJsComputeDriverOutcome | undefined;
	let createRequestSettled = true;
	const attemptDeadline = Date.now() + manifest.executionTimeoutMs;
	const timeoutSignal = AbortSignal.timeout(manifest.executionTimeoutMs);
	const attemptSignal = AbortSignal.any([context.signal, timeoutSignal]);
	try {
		if (!imageRef.endsWith(`@${manifest.runnerImageDigest}`))
			throw new TypeError("D667 runner image does not match the admitted manifest digest.");
		if (
			manifest.graphreflyPackageRevision !== NODE_LOCAL_UNTRUSTED_JS_GRAPHREFLY_PACKAGE_REVISION ||
			args.graphreflyPackageRevision !== NODE_LOCAL_UNTRUSTED_JS_GRAPHREFLY_PACKAGE_REVISION
		)
			throw new TypeError("D667 package revision does not match the fixed runner profile.");
		const observedBundleDigest = `sha256:${createHash("sha256").update(material.bundle).digest("hex")}`;
		if (observedBundleDigest !== args.bundleDigest)
			throw new TypeError("D667 bundle bytes do not match the admitted digest.");
		const host = await discoverRootlessPodmanBinding(attemptSignal);
		if (host === undefined)
			return failed("local-untrusted-js-compute-podman-unavailable", "unverifiable");
		if (host.hostBindingDigest !== context.hostBindingDigest)
			return failed("local-untrusted-js-compute-host-binding-mismatch", "unverifiable");
		const socketPath = host.socketPath;
		const image = await jsonRequest(
			socketPath,
			`/v${API_REVISION}/libpod/images/${encodeURIComponent(imageRef)}/json`,
			attemptSignal,
			"GET",
			undefined,
			remainingMs(attemptDeadline),
		);
		if (
			image.status !== 200 ||
			!record(image.body) ||
			image.body.Digest !== manifest.runnerImageDigest ||
			!Array.isArray(image.body.RepoDigests) ||
			!image.body.RepoDigests.includes(imageRef)
		)
			return failed("local-untrusted-js-compute-runner-image-unverified", "unverifiable");
		const suffix = randomUUID();
		const containerName = `graphrefly-d667-${suffix}`;
		const runLabel = labelValue({
			runId: context.runId,
			attempt: context.attempt,
			epoch: context.epoch,
			manifestFingerprint: context.manifestFingerprint,
			runAdmissionId: context.runAdmissionId,
		});
		binding = {
			socketPath,
			containerName,
			runLabel,
			manifestFingerprint: context.manifestFingerprint,
			capabilityDrop: host.capabilityDrop,
		};
		createRequestSettled = false;
		const created = await jsonRequest(
			socketPath,
			`/v${API_REVISION}/libpod/containers/create`,
			attemptSignal,
			"POST",
			containerRequest(containerName, imageRef, manifest, runLabel),
			remainingMs(attemptDeadline),
		);
		createRequestSettled = true;
		if (
			created.status !== 201 ||
			!record(created.body) ||
			typeof created.body.Id !== "string" ||
			!ID.test(created.body.Id) ||
			!Array.isArray(created.body.Warnings) ||
			created.body.Warnings.length !== 0
		) {
			outcome = failed("local-untrusted-js-compute-container-create-failed", "unverifiable");
			return outcome;
		}
		binding = { ...binding, containerId: created.body.Id };
		const inspected = await jsonRequest(
			socketPath,
			`/v${API_REVISION}/libpod/containers/${binding.containerId}/json`,
			attemptSignal,
			"GET",
			undefined,
			remainingMs(attemptDeadline),
		);
		if (!inspectMatches(inspected, binding, imageRef, manifest)) {
			outcome = failed("local-untrusted-js-compute-containment-mismatch", "unverifiable");
			return outcome;
		}
		const input = strictCanonicalJsonBytes(material.input);
		const control: LocalUntrustedJsComputeRunnerControl = {
			contractVersion: "1",
			compatibilityRevision: LOCAL_UNTRUSTED_JS_COMPUTE_COMPATIBILITY,
			runnerApiRevision: "graphrefly-runner-api-v1",
			manifestFingerprint: manifest.fingerprint,
			args,
			runAdmissionId: context.runAdmissionId,
		};
		const controlBytes = strictCanonicalJsonBytes(control);
		if (controlBytes.byteLength > MAX_CONTROL_BYTES)
			throw new TypeError("D667 runner control exceeds its byte bound.");
		const archive = tarArchive([
			{ path: "input/bundle.mjs", bytes: material.bundle, mode: 0o444 },
			{ path: "input/input.json", bytes: input, mode: 0o444 },
			{ path: "input/control.json", bytes: controlBytes, mode: 0o444 },
		]);
		const uploaded = await rawRequest(
			socketPath,
			`/v${API_REVISION}/libpod/containers/${binding.containerId}/archive?path=/`,
			attemptSignal,
			"PUT",
			archive,
			"application/x-tar",
			remainingMs(attemptDeadline),
		);
		if (uploaded.status !== 200) {
			outcome = failed("local-untrusted-js-compute-input-upload-failed", "unverifiable");
			return outcome;
		}
		const started = await rawRequest(
			socketPath,
			`/v${API_REVISION}/libpod/containers/${binding.containerId}/start`,
			attemptSignal,
			"POST",
			undefined,
			undefined,
			remainingMs(attemptDeadline),
		);
		if (started.status !== 204) {
			outcome = failed("local-untrusted-js-compute-container-start-failed", "unverifiable");
			return outcome;
		}
		let waited: RawResponse;
		try {
			waited = await rawRequest(
				socketPath,
				`/v${API_REVISION}/libpod/containers/${binding.containerId}/wait?condition=exited`,
				attemptSignal,
				"POST",
				undefined,
				undefined,
				remainingMs(attemptDeadline),
			);
		} catch (error) {
			if (context.signal.aborted) {
				outcome = failed("local-untrusted-js-compute-canceled", "unverifiable", "canceled");
			} else if (timeoutSignal.aborted || Date.now() >= attemptDeadline) {
				outcome = failed("local-untrusted-js-compute-timeout", "unverifiable", "timeout");
			} else {
				throw error;
			}
			return outcome;
		}
		const exitCode = parseExitCode(waited);
		let logs: RawResponse;
		try {
			logs = await rawRequest(
				socketPath,
				`/v${API_REVISION}/libpod/containers/${binding.containerId}/logs?stdout=true&stderr=false`,
				attemptSignal,
				"GET",
				undefined,
				undefined,
				remainingMs(attemptDeadline),
				Math.min(MAX_LOG_BYTES, manifest.maxOutputBytes + 8 * 1024),
			);
		} catch (error) {
			if (error instanceof ResponseBoundError) {
				outcome = failed("local-untrusted-js-compute-output-overflow", "unverifiable");
				return outcome;
			}
			throw error;
		}
		if (logs.status !== 200 || exitCode !== 0) {
			outcome = failed("local-untrusted-js-compute-runner-failed", "unverifiable");
			return outcome;
		}
		const result = parseRunnerResult(logs.body);
		outcome = { outcome: "succeeded", result, cleanup: "unverifiable" };
		return outcome;
	} catch (error) {
		if (context.signal.aborted)
			outcome = failed("local-untrusted-js-compute-canceled", "unverifiable", "canceled");
		else if (timeoutSignal.aborted || Date.now() >= attemptDeadline)
			outcome = failed("local-untrusted-js-compute-timeout", "unverifiable", "timeout");
		else
			outcome = failed(
				error instanceof TypeError
					? "local-untrusted-js-compute-invalid-private-material"
					: "local-untrusted-js-compute-driver-failed",
				"unverifiable",
			);
		return outcome;
	} finally {
		if (binding !== undefined) {
			const cleanup: "succeeded" | "unverifiable" | false = await removeAndVerify(
				binding,
				manifest.killGraceMs,
				manifest.cleanupTimeoutMs,
				createRequestSettled,
			).catch((): false => false);
			if (outcome !== undefined)
				(outcome as { cleanup: "succeeded" | "failed" | "unverifiable" }).cleanup =
					cleanup === false ? "failed" : cleanup;
		}
	}
}

function failed(
	code: string,
	cleanup: "failed" | "unverifiable",
	outcome: "failed" | "timeout" | "canceled" = "failed",
): LocalUntrustedJsComputeDriverOutcome {
	return { outcome, code, cleanup };
}

function containerRequest(
	name: string,
	image: string,
	manifest: LocalUntrustedJsComputeManifest,
	runLabel: string,
): Record<string, unknown> {
	return {
		name,
		image,
		entrypoint: [...RUNNER_ENTRYPOINT],
		command: ["/input/bundle.mjs", "/input/input.json", "/input/control.json"],
		user: "65532:65532",
		env: {},
		unsetenvall: true,
		env_host: false,
		httpproxy: false,
		image_volume_mode: "ignore",
		read_only_filesystem: true,
		read_write_tmpfs: false,
		mounts: [
			{
				destination: "/tmp",
				type: "tmpfs",
				source: "tmpfs",
				options: ["rw", "nosuid", "nodev", "noexec", `size=${TMPFS_LIMIT_BYTES}`, "mode=0700"],
			},
		],
		r_limits: [
			{ type: "FSIZE", hard: FILE_SIZE_LIMIT_BYTES, soft: FILE_SIZE_LIMIT_BYTES },
			{ type: "NOFILE", hard: NOFILE_LIMIT, soft: NOFILE_LIMIT },
		],
		privileged: false,
		cap_drop: ["all"],
		no_new_privileges: true,
		terminal: false,
		stdin: false,
		remove: false,
		stop_signal: 15,
		publish_image_ports: false,
		netns: { nsmode: "none" },
		labels: {
			"dev.graphrefly.boundary": BOUNDARY_LABEL,
			"dev.graphrefly.manifest": manifest.fingerprint,
			"dev.graphrefly.run": runLabel,
		},
		resource_limits: {
			memory: { limit: MEMORY_LIMIT_BYTES },
			cpu: { period: CPU_PERIOD, quota: CPU_QUOTA },
			pids: { limit: PIDS_LIMIT },
		},
	};
}

function inspectMatches(
	response: { readonly status: number; readonly body: unknown },
	binding: PodmanBinding,
	imageRef: string,
	manifest: LocalUntrustedJsComputeManifest,
): boolean {
	if (response.status !== 200 || !record(response.body)) return false;
	const config = record(response.body.Config) ? response.body.Config : undefined;
	const host = record(response.body.HostConfig) ? response.body.HostConfig : undefined;
	const labels = config && record(config.Labels) ? config.Labels : undefined;
	const mounts = Array.isArray(response.body.Mounts) ? response.body.Mounts : undefined;
	return (
		response.body.Id === binding.containerId &&
		response.body.Name === binding.containerName &&
		config?.Image === imageRef &&
		config?.User === "65532:65532" &&
		exactStrings(config?.Entrypoint, RUNNER_ENTRYPOINT) &&
		exactStrings(config?.Cmd, ["/input/bundle.mjs", "/input/input.json", "/input/control.json"]) &&
		labels?.["dev.graphrefly.boundary"] === BOUNDARY_LABEL &&
		labels?.["dev.graphrefly.manifest"] === manifest.fingerprint &&
		labels?.["dev.graphrefly.run"] === binding.runLabel &&
		exactStrings(config?.Env, []) &&
		host?.ReadonlyRootfs === true &&
		host?.Privileged === false &&
		exactUnorderedStrings(host?.SecurityOpt, ["no-new-privileges"]) &&
		Array.isArray(host?.CapDrop) &&
		exactUnorderedStrings(host.CapDrop, binding.capabilityDrop) &&
		Array.isArray(host?.CapAdd) &&
		host.CapAdd.length === 0 &&
		host.Memory === MEMORY_LIMIT_BYTES &&
		host.CpuPeriod === CPU_PERIOD &&
		host.CpuQuota === CPU_QUOTA &&
		host.PidsLimit === PIDS_LIMIT &&
		host.NetworkMode === "none" &&
		host.PublishAllPorts === false &&
		record(host.PortBindings) &&
		Object.keys(host.PortBindings).length === 0 &&
		tmpfsMatches(host.Tmpfs) &&
		rlimitsMatch(host.Ulimits) &&
		mountsMatch(mounts)
	);
}

async function stopAndKill(
	binding: PodmanBinding,
	graceMs: number,
	signal: AbortSignal,
	deadline: number,
): Promise<void> {
	const seconds = graceMs / 1_000;
	const identifier = binding.containerId ?? binding.containerName;
	const stopDeadline = Math.min(deadline, Date.now() + graceMs + 1_000);
	const stopped = await rawRequest(
		binding.socketPath,
		`/v${API_REVISION}/libpod/containers/${identifier}/stop?timeout=${seconds}`,
		signal,
		"POST",
		undefined,
		undefined,
		remainingMs(stopDeadline),
	).catch(() => undefined);
	if (stopped?.status === 204 || stopped?.status === 304 || stopped?.status === 404) return;
	await rawRequest(
		binding.socketPath,
		`/v${API_REVISION}/libpod/containers/${identifier}/kill?signal=KILL`,
		signal,
		"POST",
		undefined,
		undefined,
		remainingMs(deadline),
	).catch(() => undefined);
}

async function removeAndVerify(
	binding: PodmanBinding,
	graceMs: number,
	cleanupTimeoutMs: number,
	createRequestSettled: boolean,
): Promise<"succeeded" | "unverifiable" | false> {
	const deadline = Date.now() + cleanupTimeoutMs;
	const signal = AbortSignal.timeout(cleanupTimeoutMs);
	const identifier = binding.containerId ?? binding.containerName;
	let absentSince: number | undefined;
	await stopAndKill(binding, graceMs, signal, deadline);
	while (Date.now() < deadline) {
		await rawRequest(
			binding.socketPath,
			`/v${API_REVISION}/libpod/containers/${identifier}?force=true&v=true`,
			signal,
			"DELETE",
			undefined,
			undefined,
			remainingMs(deadline),
		).catch(() => undefined);
		const residues = await labeledResidues(binding, signal, deadline);
		if (residues === undefined) {
			absentSince = undefined;
			await delay(20, signal).catch(() => undefined);
			continue;
		}
		for (const id of residues) {
			await stopAndKill({ ...binding, containerId: id }, graceMs, signal, deadline);
			await rawRequest(
				binding.socketPath,
				`/v${API_REVISION}/libpod/containers/${id}?force=true&v=true`,
				signal,
				"DELETE",
				undefined,
				undefined,
				remainingMs(deadline),
			).catch(() => undefined);
		}
		if (residues.length > 0) {
			absentSince = undefined;
			await delay(20, signal).catch(() => undefined);
			continue;
		}
		const absent = await rawRequest(
			binding.socketPath,
			`/v${API_REVISION}/libpod/containers/${identifier}/json`,
			signal,
			"GET",
			undefined,
			undefined,
			remainingMs(deadline),
		).catch(() => undefined);
		if (absent?.status !== 404) {
			absentSince = undefined;
			await delay(20, signal).catch(() => undefined);
			continue;
		}
		absentSince ??= Date.now();
		if (Date.now() - absentSince >= 100 && createRequestSettled) return "succeeded";
		await delay(20, signal).catch(() => undefined);
	}
	return createRequestSettled ? false : "unverifiable";
}

async function labeledResidues(
	binding: PodmanBinding,
	signal: AbortSignal,
	deadline: number,
): Promise<readonly string[] | undefined> {
	const filters = encodeURIComponent(
		JSON.stringify({
			label: [
				`dev.graphrefly.boundary=${BOUNDARY_LABEL}`,
				`dev.graphrefly.run=${binding.runLabel}`,
				`dev.graphrefly.manifest=${binding.manifestFingerprint}`,
			],
		}),
	);
	const response = await jsonRequest(
		binding.socketPath,
		`/v${API_REVISION}/libpod/containers/json?all=true&filters=${filters}`,
		signal,
		"GET",
		undefined,
		remainingMs(deadline),
	).catch(() => undefined);
	if (response?.status !== 200 || !Array.isArray(response.body)) return undefined;
	const ids: string[] = [];
	for (const entry of response.body) {
		if (
			!record(entry) ||
			typeof entry.Id !== "string" ||
			!ID.test(entry.Id) ||
			(binding.containerId !== undefined && entry.Id !== binding.containerId) ||
			!record(entry.Labels) ||
			entry.Labels["dev.graphrefly.boundary"] !== BOUNDARY_LABEL ||
			entry.Labels["dev.graphrefly.run"] !== binding.runLabel ||
			entry.Labels["dev.graphrefly.manifest"] !== binding.manifestFingerprint ||
			!Array.isArray(entry.Names) ||
			!entry.Names.includes(binding.containerName)
		)
			return undefined;
		ids.push(entry.Id);
	}
	return ids;
}

async function discoverRootlessPodmanBinding(
	signal?: AbortSignal,
): Promise<PodmanHostBinding | undefined> {
	if (signal?.aborted) throw signal.reason;
	const runtimeDirectoryValue = Reflect.get(process.env, "XDG_RUNTIME_DIR");
	const runtimeDirectory =
		typeof runtimeDirectoryValue === "string" && runtimeDirectoryValue.length > 0
			? runtimeDirectoryValue
			: undefined;
	const homeDirectoryValue = Reflect.get(process.env, "HOME");
	const candidates = (
		runtimeDirectory !== undefined
			? [`${runtimeDirectory}/podman/podman.sock`]
			: [
					process.platform === "darwin"
						? `${typeof homeDirectoryValue === "string" ? homeDirectoryValue : ""}/.local/share/containers/podman/machine/podman.sock`
						: undefined,
				]
	).filter((entry): entry is string => typeof entry === "string" && entry.length > 0);
	for (const candidate of candidates) {
		const socketPath = await verifiedSocketPath(candidate);
		if (socketPath !== undefined) {
			const binding = await attestSocket(socketPath, signal);
			if (binding !== undefined) return binding;
		}
	}
	let connectionStdout: string;
	try {
		({ stdout: connectionStdout } = await execFileAsync(
			"podman",
			["system", "connection", "list", "--format", "json"],
			{ encoding: "utf8", maxBuffer: MAX_ENGINE_RESPONSE_BYTES, signal },
		));
	} catch (error) {
		if (signal?.aborted) throw error;
		return undefined;
	}
	const connections = parseJson(new TextEncoder().encode(connectionStdout));
	if (!Array.isArray(connections)) return undefined;
	for (const connection of connections) {
		if (
			record(connection) &&
			connection.Default === true &&
			typeof connection.URI === "string" &&
			connection.URI.startsWith("unix://")
		) {
			const candidate = connection.URI.slice("unix://".length);
			const socketPath = await verifiedSocketPath(candidate);
			if (socketPath !== undefined) {
				const binding = await attestSocket(socketPath, signal);
				if (binding !== undefined) return binding;
			}
		}
	}
	return undefined;
}

async function verifiedSocketPath(candidate: string): Promise<string | undefined> {
	if (!candidate.startsWith("/")) return undefined;
	const direct = await lstat(candidate).catch(() => undefined);
	const resolved = direct?.isSocket()
		? candidate
		: await realpath(candidate).catch(() => undefined);
	if (resolved === undefined || !resolved.startsWith("/")) return undefined;
	const stat = direct?.isSocket() ? direct : await lstat(resolved).catch(() => undefined);
	const currentUid = typeof process.getuid === "function" ? process.getuid() : undefined;
	return stat?.isSocket() && (currentUid === undefined || stat.uid === currentUid)
		? resolved
		: undefined;
}

async function attestSocket(
	socketPath: string,
	signal?: AbortSignal,
): Promise<PodmanHostBinding | undefined> {
	const response = await jsonRequest(socketPath, `/v${API_REVISION}/libpod/info`, signal).catch(
		(error) => {
			if (signal?.aborted) throw error;
			return undefined;
		},
	);
	if (
		response?.status !== 200 ||
		!record(response.body) ||
		!record(response.body.host) ||
		!record(response.body.host.security) ||
		response.body.host.security.rootless !== true ||
		typeof response.body.host.security.capabilities !== "string" ||
		!record(response.body.version) ||
		response.body.version.APIVersion !== API_REVISION
	)
		return undefined;
	const capabilityDrop = response.body.host.security.capabilities
		.split(",")
		.filter((entry): entry is string => /^CAP_[A-Z0-9_]+$/.test(entry));
	if (capabilityDrop.length === 0 || new Set(capabilityDrop).size !== capabilityDrop.length)
		return undefined;
	const stat = await lstat(socketPath);
	const material = JSON.stringify({
		socket: { path: socketPath, device: String(stat.dev), inode: String(stat.ino), uid: stat.uid },
		apiRevision: response.body.version.APIVersion,
		version: response.body.version.Version,
		osArch: response.body.version.OsArch,
		hostArch: response.body.host.arch,
		hostOs: response.body.host.os,
		capabilities: [...capabilityDrop].sort(),
	});
	return Object.freeze({
		socketPath,
		hostBindingDigest: `sha256:${createHash("sha256").update(material).digest("hex")}`,
		capabilityDrop: Object.freeze(capabilityDrop),
	});
}

async function jsonRequest(
	socketPath: string,
	path: string,
	signal?: AbortSignal,
	method = "GET",
	body?: unknown,
	timeoutMs = DEFAULT_REQUEST_TIMEOUT_MS,
): Promise<{ readonly status: number; readonly body: unknown }> {
	const response = await rawRequest(
		socketPath,
		path,
		signal,
		method,
		body === undefined ? undefined : new TextEncoder().encode(JSON.stringify(body)),
		body === undefined ? undefined : "application/json",
		timeoutMs,
	);
	return { status: response.status, body: parseJson(response.body) };
}

function rawRequest(
	socketPath: string,
	path: string,
	signal?: AbortSignal,
	method = "GET",
	body?: Uint8Array,
	contentType?: string,
	timeoutMs = DEFAULT_REQUEST_TIMEOUT_MS,
	maxResponseBytes = MAX_ENGINE_RESPONSE_BYTES,
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
								"content-length": String(body.byteLength),
								...(contentType === undefined ? {} : { "content-type": contentType }),
							},
			},
			(response) => {
				const chunks: Uint8Array[] = [];
				let total = 0;
				response.on("data", (chunk: Buffer) => {
					total += chunk.byteLength;
					if (total > maxResponseBytes) {
						request.destroy(new ResponseBoundError());
						return;
					}
					chunks.push(chunk);
				});
				response.on("end", () =>
					resolve({
						status: response.statusCode ?? 0,
						body: new Uint8Array(Buffer.concat(chunks)),
					}),
				);
				response.on("error", reject);
			},
		);
		request.setTimeout(timeoutMs, () => request.destroy(new Error("Podman request timed out.")));
		request.on("error", reject);
		if (body !== undefined) request.write(body);
		request.end();
	});
}

class ResponseBoundError extends Error {
	constructor() {
		super("Podman response exceeded its byte bound.");
		this.name = "ResponseBoundError";
	}
}

function parseRunnerResult(bytes: Uint8Array): LocalUntrustedJsComputeRunnerResult {
	const raw = demultiplex(bytes);
	const value = parseJson(raw);
	if (!record(value)) throw new TypeError("D667 runner returned an invalid result.");
	return value as unknown as LocalUntrustedJsComputeRunnerResult;
}

function demultiplex(bytes: Uint8Array): Uint8Array {
	if (bytes.byteLength < 8 || (bytes[0] !== 1 && bytes[0] !== 2)) return bytes;
	const chunks: Uint8Array[] = [];
	let offset = 0;
	while (offset + 8 <= bytes.byteLength) {
		if (
			(bytes[offset] !== 1 && bytes[offset] !== 2) ||
			bytes[offset + 1] !== 0 ||
			bytes[offset + 2] !== 0 ||
			bytes[offset + 3] !== 0
		)
			throw new TypeError("D667 runner log framing is invalid.");
		const length =
			((bytes[offset + 4] ?? 0) << 24) |
			((bytes[offset + 5] ?? 0) << 16) |
			((bytes[offset + 6] ?? 0) << 8) |
			(bytes[offset + 7] ?? 0);
		if (length < 0 || offset + 8 + length > bytes.byteLength)
			throw new TypeError("D667 runner log framing is invalid.");
		if (bytes[offset] === 1) chunks.push(bytes.slice(offset + 8, offset + 8 + length));
		offset += 8 + length;
	}
	if (offset !== bytes.byteLength) throw new TypeError("D667 runner log framing is incomplete.");
	return new Uint8Array(Buffer.concat(chunks.map((chunk) => Buffer.from(chunk))));
}

function parseExitCode(response: RawResponse): number | undefined {
	if (response.status !== 200) return undefined;
	const text = new TextDecoder().decode(response.body).trim();
	if (!/^(?:0|[1-9][0-9]*)$/.test(text)) return undefined;
	const value = Number(text);
	return Number.isSafeInteger(value) && value >= 0 ? value : undefined;
}

function tarArchive(
	entries: readonly { path: string; bytes: Uint8Array; mode: number }[],
): Uint8Array {
	const blocks: Uint8Array[] = [];
	for (const entry of entries) {
		if (!/^[A-Za-z0-9][A-Za-z0-9._/-]{0,99}$/.test(entry.path) || entry.path.includes(".."))
			throw new TypeError("D667 archive path is invalid.");
		const header = new Uint8Array(512);
		writeAscii(header, 0, 100, entry.path);
		writeOctal(header, 100, 8, entry.mode);
		writeOctal(header, 108, 8, 0);
		writeOctal(header, 116, 8, 0);
		writeOctal(header, 124, 12, entry.bytes.byteLength);
		writeOctal(header, 136, 12, 0);
		header.fill(0x20, 148, 156);
		header[156] = "0".charCodeAt(0);
		writeAscii(header, 257, 6, "ustar");
		writeAscii(header, 263, 2, "00");
		let sum = 0;
		for (const byte of header) sum += byte;
		writeOctal(header, 148, 8, sum);
		blocks.push(header, entry.bytes);
		const padding = (512 - (entry.bytes.byteLength % 512)) % 512;
		if (padding > 0) blocks.push(new Uint8Array(padding));
	}
	blocks.push(new Uint8Array(1024));
	return new Uint8Array(Buffer.concat(blocks.map((block) => Buffer.from(block))));
}

function writeAscii(target: Uint8Array, offset: number, length: number, value: string): void {
	const bytes = new TextEncoder().encode(value);
	if (bytes.byteLength > length) throw new TypeError("D667 tar field is too long.");
	target.set(bytes, offset);
}

function writeOctal(target: Uint8Array, offset: number, length: number, value: number): void {
	const text = value.toString(8).padStart(length - 2, "0");
	writeAscii(target, offset, length, `${text}\0`);
}

function parseJson(bytes: Uint8Array): unknown {
	try {
		return JSON.parse(new TextDecoder().decode(bytes));
	} catch {
		return undefined;
	}
}

function record(value: unknown): value is Record<string, any> {
	if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
	const proto = Object.getPrototypeOf(value);
	return proto === Object.prototype || proto === null;
}

function localJsonRecord(
	value: LocalUntrustedJsJson,
): value is { readonly [key: string]: LocalUntrustedJsJson } {
	return record(value);
}

function exactStrings(value: unknown, expected: readonly string[]): boolean {
	return (
		Array.isArray(value) &&
		value.length === expected.length &&
		value.every((entry, index) => entry === expected[index])
	);
}

function exactUnorderedStrings(value: unknown, expected: readonly string[]): boolean {
	return (
		Array.isArray(value) &&
		value.every((entry) => typeof entry === "string") &&
		exactStrings([...value].sort(), [...expected].sort())
	);
}

function tmpfsMatches(value: unknown): boolean {
	if (!record(value) || Object.keys(value).length !== 1) return false;
	const options = value["/tmp"];
	if (typeof options !== "string") return false;
	const parts = options.split(",");
	const fields = new Set(parts);
	if (fields.size !== parts.length) return false;
	const size = [...fields].filter((field) => field.startsWith("size="));
	const mode = [...fields].filter((field) => field.startsWith("mode="));
	const allowed = new Set([
		"rw",
		"nosuid",
		"nodev",
		"noexec",
		`size=${TMPFS_LIMIT_BYTES}`,
		`size=${TMPFS_LIMIT_BYTES}b`,
		"mode=0700",
		"mode=700",
		"rprivate",
		"tmpcopyup",
	]);
	return (
		parts.every((field) => allowed.has(field)) &&
		fields.has("rw") &&
		fields.has("nosuid") &&
		fields.has("nodev") &&
		fields.has("noexec") &&
		size.length === 1 &&
		(fields.has(`size=${TMPFS_LIMIT_BYTES}`) || fields.has(`size=${TMPFS_LIMIT_BYTES}b`)) &&
		mode.length === 1 &&
		(fields.has("mode=0700") || fields.has("mode=700"))
	);
}

function mountsMatch(value: unknown): boolean {
	return Array.isArray(value) && value.length === 0;
}

function rlimitsMatch(value: unknown): boolean {
	if (!Array.isArray(value) || value.length !== 2) return false;
	const normalized = value
		.map((entry) =>
			record(entry) ? { name: entry.Name, hard: entry.Hard, soft: entry.Soft } : undefined,
		)
		.filter(
			(entry): entry is { name: unknown; hard: unknown; soft: unknown } => entry !== undefined,
		);
	return (
		normalized.length === 2 &&
		normalized.some(
			(entry) =>
				entry.name === "RLIMIT_FSIZE" &&
				entry.hard === FILE_SIZE_LIMIT_BYTES &&
				entry.soft === FILE_SIZE_LIMIT_BYTES,
		) &&
		normalized.some(
			(entry) =>
				entry.name === "RLIMIT_NOFILE" &&
				entry.hard === NOFILE_LIMIT &&
				entry.soft === NOFILE_LIMIT,
		)
	);
}

function remainingMs(deadline: number): number {
	return Math.max(1, Math.min(DEFAULT_REQUEST_TIMEOUT_MS, deadline - Date.now()));
}

function labelValue(value: {
	readonly runId: string;
	readonly attempt: number;
	readonly epoch: string;
	readonly manifestFingerprint: string;
	readonly runAdmissionId: string;
}): string {
	return `sha256:${createHash("sha256").update(JSON.stringify(value)).digest("hex")}`;
}

function delay(ms: number, signal: AbortSignal): Promise<void> {
	return new Promise((resolve, reject) => {
		const timeout = setTimeout(resolve, ms);
		signal.addEventListener(
			"abort",
			() => {
				clearTimeout(timeout);
				reject(signal.reason);
			},
			{ once: true },
		);
	});
}
