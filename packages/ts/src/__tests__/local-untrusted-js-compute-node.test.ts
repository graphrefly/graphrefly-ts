import { createHash } from "node:crypto";
import { once } from "node:events";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { createServer, type ServerResponse } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
	nodeLocalUntrustedJsComputeDriver,
	nodeLocalUntrustedJsComputeHostBindingAttestation,
} from "../executors/local-untrusted-js-compute/node.js";
import {
	LOCAL_UNTRUSTED_JS_COMPUTE_BACKEND,
	LOCAL_UNTRUSTED_JS_COMPUTE_COMPATIBILITY,
	LOCAL_UNTRUSTED_JS_COMPUTE_RUNNER_API,
	type LocalUntrustedJsComputeArguments,
	type LocalUntrustedJsComputeManifest,
} from "../executors/local-untrusted-js-compute.js";
import { strictCanonicalJsonBytes } from "../json/codec.js";

const imageDigest = `sha256:${"1".repeat(64)}`;
const imageRef = `registry.example.test/graphrefly/local-js@${imageDigest}`;
const containerId = "a".repeat(64);
const bundle = new TextEncoder().encode("export default ({ input }) => input;");
const input = { rows: [] };
const digest = (bytes: Uint8Array): string =>
	`sha256:${createHash("sha256").update(bytes).digest("hex")}`;
const capabilities = [
	"CAP_CHOWN",
	"CAP_DAC_OVERRIDE",
	"CAP_FOWNER",
	"CAP_FSETID",
	"CAP_KILL",
	"CAP_NET_BIND_SERVICE",
	"CAP_SETFCAP",
	"CAP_SETGID",
	"CAP_SETPCAP",
	"CAP_SETUID",
	"CAP_SYS_CHROOT",
];

interface HarnessState {
	mode:
		| "ambiguous-create"
		| "containment-mismatch"
		| "timeout"
		| "output-overflow"
		| "residue"
		| "strict-exit"
		| "delayed-create"
		| "delayed-create-transient-control"
		| "unrelated-list";
	created: boolean;
	deleted: boolean;
	hangInfo: boolean;
	containerName?: string;
	labels?: Record<string, string>;
	readonly createdRunLabels: string[];
	readonly deletePaths: string[];
	readonly stopPaths: string[];
	transientDeleteFailures: number;
	transientListFailures: number;
}

const cleanupTasks: Array<() => Promise<void>> = [];

afterEach(async () => {
	for (const cleanup of cleanupTasks.splice(0).reverse()) await cleanup();
	vi.unstubAllEnvs();
});

const manifest = (overrides: Partial<LocalUntrustedJsComputeManifest> = {}) =>
	({
		kind: "local-untrusted-js-compute-manifest",
		manifestId: "manifest:d667:node-harness",
		revision: "manifest-revision:1",
		fingerprint: "manifest-fingerprint:d667-node-harness",
		compatibilityRevision: LOCAL_UNTRUSTED_JS_COMPUTE_COMPATIBILITY,
		backend: LOCAL_UNTRUSTED_JS_COMPUTE_BACKEND,
		runnerApiRevision: LOCAL_UNTRUSTED_JS_COMPUTE_RUNNER_API,
		runnerImageDigest: imageDigest,
		runnerRevision: "runner:harness",
		compilerRevision: "compiler:harness",
		allowedApiRevision: "api:harness",
		graphreflyPackageRevision: "graphrefly-ts:0.7.0",
		sandboxPolicyRevision: "sandbox:d667-v0",
		networkPolicyRevision: "deny-all-v1",
		filesystemPolicyRevision: "read-only-input-bounded-tmp-v1",
		resourcePolicyRevision: "resource:d667-v0",
		outputPolicyRevision: "output:d667-v0",
		executionTimeoutMs: 1_000,
		killGraceMs: 1_000,
		cleanupTimeoutMs: 1_000,
		maxBundleBytes: 8_192,
		maxInputBytes: 1_024,
		maxOutputBytes: 1_024,
		maxTopologyNodes: 8,
		maxTopologyEdges: 8,
		...overrides,
	}) satisfies LocalUntrustedJsComputeManifest;

const args = (): LocalUntrustedJsComputeArguments => ({
	contractVersion: "1",
	runId: "run:node-harness",
	attempt: 1,
	epoch: "epoch:1",
	sourceRevision: "source:1",
	sourceDigest: `sha256:${"2".repeat(64)}`,
	bundleRevision: "bundle:1",
	bundleDigest: digest(bundle),
	compilerRevision: "compiler:harness",
	allowedApiRevision: "api:harness",
	graphreflyPackageRevision: "graphrefly-ts:0.7.0",
	runnerRevision: "runner:harness",
	runnerImageDigest: imageDigest,
	sandboxPolicyRevision: "sandbox:d667-v0",
	networkPolicyRevision: "deny-all-v1",
	filesystemPolicyRevision: "read-only-input-bounded-tmp-v1",
	resourcePolicyRevision: "resource:d667-v0",
	outputPolicyRevision: "output:d667-v0",
	admittedInputRefs: ["input:harness"],
	inputDigest: digest(strictCanonicalJsonBytes(input)),
});

function sendJson(response: ServerResponse, status: number, value: unknown): void {
	response.writeHead(status, { "content-type": "application/json" });
	response.end(JSON.stringify(value));
}

async function harness(mode: HarnessState["mode"]): Promise<{
	state: HarnessState;
	hostBindingDigest: string;
}> {
	const directory = await mkdtemp(join(tmpdir(), "graphrefly-d667-node-test-"));
	const podmanDirectory = join(directory, "podman");
	await mkdir(podmanDirectory);
	const socketPath = join(podmanDirectory, "podman.sock");
	const state: HarnessState = {
		mode,
		created: false,
		deleted: false,
		hangInfo: false,
		createdRunLabels: [],
		deletePaths: [],
		stopPaths: [],
		transientDeleteFailures: 0,
		transientListFailures: 0,
	};
	const previousRuntimeDirectory = process.env.XDG_RUNTIME_DIR;
	vi.stubEnv("XDG_RUNTIME_DIR", directory);
	const server = createServer((request, response) => {
		const path = request.url ?? "";
		if (path.endsWith("/libpod/info")) {
			if (state.hangInfo) return;
			sendJson(response, 200, {
				host: {
					arch: "arm64",
					os: "linux",
					security: { rootless: true, capabilities: capabilities.join(",") },
				},
				version: { APIVersion: "5.0.3", Version: "5.0.3", OsArch: "linux/arm64" },
			});
			return;
		}
		if (path.includes("/libpod/images/")) {
			sendJson(response, 200, { Digest: imageDigest, RepoDigests: [imageRef] });
			return;
		}
		if (path.endsWith("/libpod/containers/create")) {
			const chunks: Buffer[] = [];
			request.on("data", (chunk: Buffer) => chunks.push(chunk));
			request.on("end", () => {
				const body = JSON.parse(Buffer.concat(chunks).toString("utf8")) as {
					name?: string;
					labels?: Record<string, string>;
				};
				const finishCreate = () => {
					state.containerName = body.name;
					state.labels = body.labels;
					state.createdRunLabels.push(body.labels?.["dev.graphrefly.run"] ?? "missing");
					state.created = true;
					state.deleted = false;
					if (mode === "ambiguous-create") sendJson(response, 500, { message: "response lost" });
					else sendJson(response, 201, { Id: containerId, Warnings: [] });
				};
				if (mode === "delayed-create" || mode === "delayed-create-transient-control")
					setTimeout(finishCreate, 160);
				else finishCreate();
			});
			return;
		}
		if (path.includes("/libpod/containers/json?")) {
			if (mode === "delayed-create-transient-control" && state.transientListFailures < 2) {
				state.transientListFailures += 1;
				sendJson(response, 503, { message: "transient list failure" });
				return;
			}
			if (mode === "unrelated-list") {
				sendJson(response, 200, [
					{
						Id: "b".repeat(64),
						Labels: state.labels,
						Names: [state.containerName],
					},
				]);
				return;
			}
			sendJson(
				response,
				200,
				state.created && !state.deleted
					? [
							{
								Id: containerId,
								Labels: state.labels,
								Names: [state.containerName],
							},
						]
					: [],
			);
			return;
		}
		if (path.endsWith("/json")) {
			if (state.deleted || !state.created) {
				sendJson(response, 404, { message: "absent" });
				return;
			}
			sendJson(
				response,
				200,
				inspectBody(state.containerName ?? "", mode === "containment-mismatch", state.labels ?? {}),
			);
			return;
		}
		if (path.includes("/archive?")) {
			response.writeHead(200).end();
			return;
		}
		if (path.endsWith("/start")) {
			if (mode === "residue") response.writeHead(500).end();
			else response.writeHead(204).end();
			return;
		}
		if (path.includes("/wait?")) {
			if (mode === "timeout") return;
			response.writeHead(200).end(mode === "strict-exit" ? "0junk" : "0");
			return;
		}
		if (path.includes("/logs?")) {
			response.writeHead(200);
			if (mode === "output-overflow") response.end(Buffer.alloc(20_000, 120));
			else response.end("{}");
			return;
		}
		if (path.includes("/stop?") || path.includes("/kill?")) {
			if (path.includes("/stop?")) state.stopPaths.push(path);
			response.writeHead(204).end();
			return;
		}
		if (request.method === "DELETE") {
			state.deletePaths.push(path);
			if (mode === "delayed-create-transient-control" && state.transientDeleteFailures < 1) {
				state.transientDeleteFailures += 1;
				response.writeHead(503).end();
			} else if (mode === "residue") response.writeHead(500).end();
			else {
				if (!path.includes("b".repeat(64))) state.deleted = true;
				response.writeHead(204).end();
			}
			return;
		}
		sendJson(response, 404, { message: "unexpected harness path", path });
	});
	server.listen(socketPath);
	await once(server, "listening");
	cleanupTasks.push(async () => {
		server.closeAllConnections();
		await new Promise<void>((resolve) => server.close(() => resolve()));
		if (previousRuntimeDirectory === undefined) delete process.env.XDG_RUNTIME_DIR;
		else process.env.XDG_RUNTIME_DIR = previousRuntimeDirectory;
		await rm(directory, { recursive: true, force: true });
	});
	const attestation = await nodeLocalUntrustedJsComputeHostBindingAttestation();
	return { state, hostBindingDigest: attestation.hostBindingDigest };
}

function inspectBody(
	name: string,
	mismatch: boolean,
	labels: Record<string, string>,
): Record<string, unknown> {
	return {
		Id: containerId,
		Name: name,
		Config: {
			Image: imageRef,
			User: "65532:65532",
			Entrypoint: [
				"/nodejs/bin/node",
				"--experimental-vm-modules",
				"--no-addons",
				"--disable-proto=throw",
				"/opt/graphrefly/local-untrusted-js-runner.mjs",
			],
			Cmd: ["/input/bundle.mjs", "/input/input.json", "/input/control.json"],
			Env: mismatch ? ["SECRET=ambient"] : [],
			Labels: labels,
		},
		HostConfig: {
			ReadonlyRootfs: true,
			Privileged: false,
			SecurityOpt: ["no-new-privileges"],
			CapDrop: capabilities,
			CapAdd: [],
			Memory: 256 * 1024 * 1024,
			CpuPeriod: 100_000,
			CpuQuota: 100_000,
			PidsLimit: 64,
			NetworkMode: "none",
			PublishAllPorts: false,
			PortBindings: {},
			Tmpfs: {
				"/tmp": "rw,nosuid,nodev,noexec,size=16777216,mode=0700,rprivate,tmpcopyup",
			},
			Ulimits: [
				{ Name: "RLIMIT_FSIZE", Soft: 16 * 1024 * 1024, Hard: 16 * 1024 * 1024 },
				{ Name: "RLIMIT_NOFILE", Soft: 128, Hard: 128 },
			],
		},
		Mounts: [],
	};
}

async function execute(
	hostBindingDigest: string,
	manifestValue: LocalUntrustedJsComputeManifest,
	signal = new AbortController().signal,
	attempt = 1,
) {
	return nodeLocalUntrustedJsComputeDriver({ imageRef }).execute(
		{
			runId: "run:node-harness",
			attempt,
			epoch: "epoch:1",
			manifestFingerprint: manifestValue.fingerprint,
			hostBindingDigest,
			runAdmissionId: "run-admission:node-harness",
			signal,
		},
		{ ...args(), attempt },
		{ bundle, input },
		manifestValue,
	);
}

describe("D667 Node rootless-Podman broker lifecycle", () => {
	it("reconciles an ambiguous create response by exact name and labels", async () => {
		const { state, hostBindingDigest } = await harness("ambiguous-create");
		const result = await execute(hostBindingDigest, manifest());
		expect(result).toMatchObject({
			outcome: "failed",
			code: "local-untrusted-js-compute-container-create-failed",
			cleanup: "succeeded",
		});
		expect(state).toMatchObject({ created: true, deleted: true });
	});

	it("keeps an aborted create unverifiable while reconciling a delayed allocation", async () => {
		const { state, hostBindingDigest } = await harness("delayed-create");
		await expect(
			execute(hostBindingDigest, manifest({ executionTimeoutMs: 25, cleanupTimeoutMs: 350 })),
		).resolves.toMatchObject({
			outcome: "timeout",
			code: "local-untrusted-js-compute-timeout",
			cleanup: "unverifiable",
		});
		expect(state).toMatchObject({ created: true, deleted: true });
	});

	it("uses the full cleanup window when delayed create reconciliation has transient control failures", async () => {
		const { state, hostBindingDigest } = await harness("delayed-create-transient-control");
		await expect(
			execute(hostBindingDigest, manifest({ executionTimeoutMs: 25, cleanupTimeoutMs: 400 })),
		).resolves.toMatchObject({
			outcome: "timeout",
			code: "local-untrusted-js-compute-timeout",
			cleanup: "unverifiable",
		});
		expect(state).toMatchObject({
			created: true,
			deleted: true,
			transientDeleteFailures: 1,
			transientListFailures: 2,
		});
	});

	it("refuses an unrelated ID even when an ignored filter returns matching labels and name", async () => {
		const { state, hostBindingDigest } = await harness("unrelated-list");
		await expect(execute(hostBindingDigest, manifest())).resolves.toMatchObject({
			outcome: "succeeded",
			cleanup: "failed",
		});
		expect(state.deletePaths.some((path) => path.includes("b".repeat(64)))).toBe(false);
	});

	it("isolates the ownership label across attempts that share one run id", async () => {
		const { state, hostBindingDigest } = await harness("strict-exit");
		await execute(hostBindingDigest, manifest(), new AbortController().signal, 1);
		await execute(hostBindingDigest, manifest(), new AbortController().signal, 2);
		expect(state.createdRunLabels).toHaveLength(2);
		expect(state.createdRunLabels[0]).not.toBe(state.createdRunLabels[1]);
	});

	it("fails closed and cleans up on containment mismatch", async () => {
		const { state, hostBindingDigest } = await harness("containment-mismatch");
		await expect(execute(hostBindingDigest, manifest())).resolves.toMatchObject({
			outcome: "failed",
			code: "local-untrusted-js-compute-containment-mismatch",
			cleanup: "succeeded",
		});
		expect(state.deleted).toBe(true);
		expect(state.stopPaths).toEqual([expect.stringContaining("/stop?timeout=1")]);
	});

	it("classifies one attempt-wide deadline as timeout and still cleans up", async () => {
		const { state, hostBindingDigest } = await harness("timeout");
		await expect(
			execute(hostBindingDigest, manifest({ executionTimeoutMs: 40 })),
		).resolves.toMatchObject({
			outcome: "timeout",
			code: "local-untrusted-js-compute-timeout",
			cleanup: "succeeded",
		});
		expect(state.deleted).toBe(true);
	});

	it("fails closed on bounded log overflow and strict exit-code parsing", async () => {
		for (const mode of ["output-overflow", "strict-exit"] as const) {
			const { state, hostBindingDigest } = await harness(mode);
			await expect(execute(hostBindingDigest, manifest())).resolves.toMatchObject({
				outcome: "failed",
				code:
					mode === "output-overflow"
						? "local-untrusted-js-compute-output-overflow"
						: "local-untrusted-js-compute-runner-failed",
				cleanup: "succeeded",
			});
			expect(state.deleted).toBe(true);
			await cleanupTasks.pop()?.();
		}
	});

	it("reports residue separately when label-scoped cleanup cannot remove the attempt", async () => {
		const { hostBindingDigest } = await harness("residue");
		await expect(
			execute(hostBindingDigest, manifest({ cleanupTimeoutMs: 100 })),
		).resolves.toMatchObject({
			outcome: "failed",
			code: "local-untrusted-js-compute-container-start-failed",
			cleanup: "failed",
		});
	});

	it("preserves cancellation during actual-socket discovery", async () => {
		const { state, hostBindingDigest } = await harness("timeout");
		state.hangInfo = true;
		const controller = new AbortController();
		const running = execute(hostBindingDigest, manifest(), controller.signal);
		setTimeout(() => controller.abort(), 10);
		await expect(running).resolves.toMatchObject({
			outcome: "canceled",
			code: "local-untrusted-js-compute-canceled",
			cleanup: "unverifiable",
		});
	});
});
