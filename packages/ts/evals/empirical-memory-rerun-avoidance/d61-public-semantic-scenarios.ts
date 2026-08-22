import { spawn } from "node:child_process";
import { cp, lstat, mkdir, mkdtemp, readdir, readFile, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { empiricalSha256, empiricalStrictJsonDigest } from "./canonical.js";

export const D61_PUBLIC_SEMANTIC_REVISION =
	"graphrefly-ts.d61.public-semantic-scenarios.v1" as const;

export type D61PublicSemanticCauseCode =
	| "canonical-proposal-not-admitted"
	| "malformed-provenance-mutated-store"
	| "reconstructed-provenance-admitted"
	| "claim-invariant-regression";

export interface D61PublicSemanticObservationV1 {
	readonly passed: boolean;
	readonly causeCode: D61PublicSemanticCauseCode | null;
}

export const D61_PUBLIC_SEMANTIC_SCENARIO_IDS = Object.freeze([
	"canonical-proposal",
	"malformed-provenance",
	"reconstructed-provenance",
	"claim-invariants",
] as const);

export type D61PublicSemanticScenarioId = (typeof D61_PUBLIC_SEMANTIC_SCENARIO_IDS)[number];

export const D63_WITHHELD_SEMANTIC_SCENARIO_ID = "withheld-canonical-variant" as const;
export type D61WorkerSemanticScenarioId =
	| D61PublicSemanticScenarioId
	| typeof D63_WITHHELD_SEMANTIC_SCENARIO_ID;

const D61_PUBLIC_SEMANTIC_CAUSES = Object.freeze([
	"canonical-proposal-not-admitted",
	"malformed-provenance-mutated-store",
	"reconstructed-provenance-admitted",
	"claim-invariant-regression",
] as const);

export interface D61PublicSemanticScenarioResultV1 {
	readonly observations: readonly D61PublicSemanticObservationV1[];
	readonly sourceSnapshotDigest: string;
}

export function validateD61PublicSemanticObservation(
	scenarioId: D61WorkerSemanticScenarioId,
	value: unknown,
): D61PublicSemanticObservationV1 {
	if (
		value === null ||
		typeof value !== "object" ||
		Array.isArray(value) ||
		Object.keys(value).sort().join(",") !== "causeCode,passed" ||
		typeof (value as { passed?: unknown }).passed !== "boolean"
	)
		throw new TypeError("D61 isolated semantic worker result shape drifted");
	const expectedCause =
		scenarioId === D63_WITHHELD_SEMANTIC_SCENARIO_ID
			? "canonical-proposal-not-admitted"
			: D61_PUBLIC_SEMANTIC_CAUSES[D61_PUBLIC_SEMANTIC_SCENARIO_IDS.indexOf(scenarioId)]!;
	const passed = (value as { passed: boolean }).passed;
	const causeCode = (value as { causeCode?: unknown }).causeCode;
	if ((passed && causeCode !== null) || (!passed && causeCode !== expectedCause))
		throw new TypeError("D61 isolated semantic worker disposition drifted");
	return Object.freeze({ passed, causeCode }) as D61PublicSemanticObservationV1;
}

export function qualifyD61PublicSemanticTruthTables(): true {
	for (const [index, scenarioId] of D61_PUBLIC_SEMANTIC_SCENARIO_IDS.entries()) {
		validateD61PublicSemanticObservation(scenarioId, { passed: true, causeCode: null });
		validateD61PublicSemanticObservation(scenarioId, {
			passed: false,
			causeCode: D61_PUBLIC_SEMANTIC_CAUSES[index],
		});
		let substitutionRejected = false;
		try {
			validateD61PublicSemanticObservation(scenarioId, {
				passed: false,
				causeCode: D61_PUBLIC_SEMANTIC_CAUSES[(index + 1) % D61_PUBLIC_SEMANTIC_CAUSES.length],
			});
		} catch {
			substitutionRejected = true;
		}
		if (!substitutionRejected) throw new TypeError("D61 semantic cause substitution was admitted");
	}
	return true;
}

type DataNode = {
	down(messages: readonly (readonly ["DATA", unknown])[]): void;
	subscribe(callback: (message: readonly [string, unknown]) => void): () => void;
};

export interface D61RuntimeModule {
	readonly MANAGED_CLOUD_POSTGRESQL_COMPATIBILITY: string;
	readonly MANAGED_CLOUD_POSTGRESQL_CONTROL_STORE: string;
	readonly MANAGED_CLOUD_POSTGRESQL_DEPLOYMENT_PROFILE: string;
	readonly MANAGED_CLOUD_POSTGRESQL_PROTOCOL: string;
	readonly MANAGED_CLOUD_POSTGRESQL_SCHEMA_REVISION: string;
	readonly managedCloudPostgresqlManifest: (value: Record<string, unknown>) => unknown;
	readonly managedCloudPostgresqlReadiness: (value: Record<string, unknown>) => unknown;
	readonly managedCloudPostgresqlRuntime: (
		graph: unknown,
		input: Record<string, unknown>,
	) => {
		readonly admittedEnvelopes: DataNode;
		readonly issues: DataNode;
		readonly lifecycle: DataNode;
		readonly dispose: () => Promise<void>;
	};
}

export interface D61GraphModule {
	readonly graph: () => {
		readonly node: (dependencies: readonly unknown[], compute: null) => DataNode;
		readonly topology: () => unknown;
	};
}

export interface D61IdentityModule {
	readonly compoundTupleKey: (kind: string, values: readonly unknown[]) => string;
}

export interface D61ProviderInputModule {
	readonly postgresqlToolProviderInputFromIntent: (
		intent: Record<string, unknown>,
		coordinates: Record<string, unknown>,
	) => Readonly<Record<string, unknown>>;
}

function collect(node: DataNode): unknown[] {
	const values: unknown[] = [];
	node.subscribe((message) => {
		if (message[0] === "DATA") values.push(message[1]);
	});
	return values;
}

async function settle(): Promise<void> {
	await Promise.resolve();
	await Promise.resolve();
	await new Promise((resolve) => setTimeout(resolve, 0));
}

function observation(
	passed: boolean,
	causeCode: D61PublicSemanticCauseCode,
): D61PublicSemanticObservationV1 {
	return Object.freeze({ passed, causeCode: passed ? null : causeCode });
}

function data(node: DataNode, value: unknown): void {
	node.down([["DATA", value]]);
}

export async function executeD61PublicSemanticScenarioInWorker(input: {
	readonly workspaceRoot: string;
	readonly workspaceStateDigest: string;
	readonly writeScopePreserved: boolean;
	readonly scenarioId: D61PublicSemanticScenarioId;
}): Promise<D61PublicSemanticObservationV1> {
	const cacheKey = encodeURIComponent(input.workspaceStateDigest);
	const runtime = (await import(
		`${pathToFileURL(join(input.workspaceRoot, "packages/ts/src/executors/managed-cloud-postgresql.ts")).href}?d61=${cacheKey}`
	)) as D61RuntimeModule;
	const graphModule = (await import(
		`${pathToFileURL(join(input.workspaceRoot, "packages/ts/src/graph/graph.ts")).href}?d61=${cacheKey}`
	)) as D61GraphModule;
	const identity = (await import(
		`${pathToFileURL(join(input.workspaceRoot, "packages/ts/src/identity.ts")).href}?d61=${cacheKey}`
	)) as D61IdentityModule;
	const providerInput = (await import(
		`${pathToFileURL(join(input.workspaceRoot, "packages/ts/src/executors/postgresql-tool-provider.ts")).href}?d61=${cacheKey}`
	)) as D61ProviderInputModule;
	return executeD61PublicSemanticScenarioWithModules(input, {
		runtime,
		graphModule,
		identity,
		providerInput,
	});
}

export async function executeD61PublicSemanticScenarioWithModules(
	input: {
		readonly workspaceRoot: string;
		readonly workspaceStateDigest: string;
		readonly writeScopePreserved: boolean;
		readonly scenarioId: D61WorkerSemanticScenarioId;
	},
	modules: Readonly<{
		readonly runtime: D61RuntimeModule;
		readonly graphModule: D61GraphModule;
		readonly identity: D61IdentityModule;
		readonly providerInput: D61ProviderInputModule;
	}>,
): Promise<D61PublicSemanticObservationV1> {
	const { runtime, graphModule, identity, providerInput } = modules;

	const canonicalProposalId = identity.compoundTupleKey("tool-provider-run-admission-proposal", [
		input.scenarioId === D63_WITHHELD_SEMANTIC_SCENARIO_ID
			? "candidate:run:withheld:2"
			: "candidate:run:1",
	]);
	const adapterInput = providerInput.postgresqlToolProviderInputFromIntent(
		{
			contractVersion: "1",
			intentId: "intent:1",
			idempotencyKey: "idem:1",
			source: { id: "source:1", revision: "r:1" },
			sourceProfile: { id: "source-profile:1", revision: "r:1" },
			queryPlan: { id: "plan:1", revision: "r:1" },
			executorProfile: { id: "profile-ref:1", revision: "r:1" },
			schemaRef: "schema:1",
		},
		{
			requestId: "request:1",
			operationId: "operation:1",
			effectRunId: "effect:1",
			routeId: "route:1",
			executorId: "executor:pg",
			profileId: "profile:pg",
		},
	);
	const authorityCoordinates = {
		principalId: "principal:1",
		principalSessionRevision: "principal-session:1",
		tenantId: "tenant:1",
		workspaceId: "workspace:1",
		resourceKind: "managed-postgresql-connection",
		resourceId: "connection:1",
		resourceRevision: "connection-revision:1",
		policyRevision: "policy:1",
		modelRevision: "model:1",
	} as const;
	const run = () => ({
		kind: "tool-provider-adapter-run-requested",
		runId: "run:1",
		adapterInputId: adapterInput.adapterInputId,
		requestId: "request:1",
		operationId: "operation:1",
		routeId: "route:1",
		providerId: "postgresql",
		executorId: "executor:pg",
		profileId: "profile:pg",
		attempt: 1,
		reason: "manual",
		sourceRefs: [
			{ kind: "tool-provider-run-admission-proposal", id: canonicalProposalId },
			{ kind: "tool-provider-run-admission", id: "admission:1" },
			{ kind: "tool-provider-run-admission-decision", id: "admission-decision:1" },
		],
		metadata: {
			...authorityCoordinates,
			admissionId: "admission:1",
			proposalId: canonicalProposalId,
			decisionId: "admission-decision:1",
			executionEnvironmentId: "environment:managed",
			executionEnvironmentRevision: "environment-revision:1",
			executionEnvironmentLocality: "managed-cloud",
			executionEnvironmentBindingKind: "remote-session",
			executionSessionEpoch: "epoch:admission:1",
			executionManifestFingerprint: "fingerprint:cloud:pg:1",
		},
	});
	const manifest = runtime.managedCloudPostgresqlManifest({
		kind: "managed-cloud-postgresql-manifest",
		manifestId: "manifest:cloud:pg",
		revision: "revision:1",
		fingerprint: "fingerprint:cloud:pg:1",
		compatibilityRevision: runtime.MANAGED_CLOUD_POSTGRESQL_COMPATIBILITY,
		controlStoreCompatibility: runtime.MANAGED_CLOUD_POSTGRESQL_CONTROL_STORE,
		controlStoreSchemaRevision: runtime.MANAGED_CLOUD_POSTGRESQL_SCHEMA_REVISION,
		workerProtocolRevision: runtime.MANAGED_CLOUD_POSTGRESQL_PROTOCOL,
		recipeRevision: "postgresql-read-only-query-v1",
		queuePolicyRevision: "queue:fifo:1",
		leasePolicyRevision: "lease:1",
		credentialBindingRevision: "credential-binding:1",
		deploymentRevision: "deployment:1",
		deploymentProfile: runtime.MANAGED_CLOUD_POSTGRESQL_DEPLOYMENT_PROFILE,
		workerRevision: "worker-runtime:1",
		leaseDurationMs: 1000,
		heartbeatDurationMs: 500,
		attestationRefs: [{ kind: "attestation", id: "attestation:cloud:1" }],
	});
	const readiness = runtime.managedCloudPostgresqlReadiness({
		kind: "managed-cloud-postgresql-readiness",
		manifestFingerprint: "fingerprint:cloud:pg:1",
		state: "ready",
		observedAtMs: 1,
		expiresAtMs: 1000,
		deploymentProfile: runtime.MANAGED_CLOUD_POSTGRESQL_DEPLOYMENT_PROFILE,
		controlStoreReachable: true,
		schemaVerified: true,
		transportReady: true,
		workerPoolReady: true,
		quotaReady: true,
		artifactResolverReady: true,
		credentialResolverReady: true,
		attestationRefs: [{ kind: "attestation", id: "attestation:ready:1" }],
	});

	const calls: string[] = [];
	let admittedEnvelope: Readonly<Record<string, unknown>> | null = null;
	const lifecycle = (state: string) => ({
		kind: "managed-cloud-postgresql-lifecycle-fact",
		state,
		runId: "run:1",
		attempt: 1,
		leaseId: "lease:1",
		fencingToken: 1,
		workerId: "worker:1",
		sessionEpoch: "epoch:worker:1",
		environmentRevision: "environment-revision:1",
		manifestFingerprint: "fingerprint:cloud:pg:1",
		deploymentRevision: "deployment:1",
		workerRevision: "worker-runtime:1",
		occurredAtMs: 10,
	});
	const store = {
		compatibility: runtime.MANAGED_CLOUD_POSTGRESQL_CONTROL_STORE,
		schemaRevision: runtime.MANAGED_CLOUD_POSTGRESQL_SCHEMA_REVISION,
		async admit(envelope: Readonly<Record<string, unknown>>) {
			calls.push("admit");
			admittedEnvelope = envelope;
			return { accepted: true, code: "admitted", lifecycle: lifecycle("queued") };
		},
		async claim() {
			calls.push("claim");
			return {
				accepted: true,
				code: "claimed",
				lifecycle: lifecycle("claimed"),
				lease: {
					...lifecycle("claimed"),
					envelope: admittedEnvelope,
					leaseExpiresAtMs: 1010,
					heartbeatExpiresAtMs: 510,
				},
			};
		},
		async close() {},
	};
	const sent: unknown[] = [];
	let onMessage: (message: unknown) => void = () => {
		throw new TypeError("D61 semantic transport was not started");
	};
	const transport = {
		protocolRevision: runtime.MANAGED_CLOUD_POSTGRESQL_PROTOCOL,
		async start(messageHandler: (message: unknown) => void) {
			onMessage = messageHandler;
		},
		async send(_workerId: string, _epoch: string, message: unknown) {
			sent.push(message);
		},
		async close() {},
	};
	let claimAuthorizationCalls = 0;
	const authorizationRecheck = {
		compatibility: runtime.MANAGED_CLOUD_POSTGRESQL_COMPATIBILITY,
		async authorizeClaim() {
			claimAuthorizationCalls += 1;
			return {
				kind: "managed-cloud-postgresql-authorization-recheck-result",
				stage: "claim",
				state: "allowed",
				...authorityCoordinates,
				runId: "run:1",
				attempt: 1,
				environmentRevision: "environment-revision:1",
				manifestFingerprint: "fingerprint:cloud:pg:1",
				leaseId: "lease:1",
				fencingToken: 1,
				workerId: "worker:1",
				sessionEpoch: "epoch:worker:1",
				deploymentRevision: "deployment:1",
				workerRevision: "worker-runtime:1",
				requestId: "request:1",
				operationId: "operation:1",
				routeId: "route:1",
				executorId: "executor:pg",
				profileId: "profile:pg",
				adapterInputId: adapterInput.adapterInputId,
				admissionId: "admission:1",
				admissionProposalId: canonicalProposalId,
				admissionDecisionId: "admission-decision:1",
				decisionRef: "authorization-decision:claim:1",
				authorizationRevisionRef: "authorization-revision:31",
				authorizationExpiresAtMs: 10_100,
				grantGeneration: 11,
				grantHighWater: 31,
				observedAtMs: 10,
				issueRefs: [],
				auditRefs: [{ kind: "audit", id: "authorization-audit:claim:1" }],
			};
		},
		async authorizeCredentialIssuance() {
			throw new TypeError("credential issuance is not reached by public admission scenarios");
		},
	};

	const graph = graphModule.graph();
	const inputs = graph.node([], null);
	const admitted = graph.node([], null);
	const manifests = graph.node([], null);
	const postures = graph.node([], null);
	const composed = runtime.managedCloudPostgresqlRuntime(graph, {
		inputs,
		admittedRunRequests: [admitted],
		manifests: [manifests],
		readiness: [postures],
		store,
		transport,
		authorizationRecheck,
		now: () => 10,
	});
	const envelopes = collect(composed.admittedEnvelopes);
	const issues = collect(composed.issues);
	const facts = collect(composed.lifecycle);
	try {
		data(inputs, adapterInput);
		data(manifests, manifest);
		data(postures, readiness);
		if (
			input.scenarioId === "canonical-proposal" ||
			input.scenarioId === "claim-invariants" ||
			input.scenarioId === D63_WITHHELD_SEMANTIC_SCENARIO_ID
		)
			data(admitted, run());
		else if (input.scenarioId === "malformed-provenance") {
			const malformedProposalId =
				'tool-provider-run-admission-proposal:["candidate:run:1",{"private":"value"}]';
			data(admitted, {
				...run(),
				runId: "run:malformed-proposal",
				sourceRefs: [
					{ kind: "tool-provider-run-admission-proposal", id: malformedProposalId },
					{ kind: "tool-provider-run-admission", id: "admission:1" },
					{ kind: "tool-provider-run-admission-decision", id: "admission-decision:1" },
				],
				metadata: { ...run().metadata, proposalId: malformedProposalId },
			});
		} else {
			const reconstructedProposalId = 'tool-provider-run-admission-proposal:[ "candidate:run:1" ]';
			data(admitted, {
				...run(),
				runId: "run:reconstructed-proposal",
				sourceRefs: [
					{ kind: "tool-provider-run-admission-proposal", id: reconstructedProposalId },
					{ kind: "tool-provider-run-admission", id: "admission:1" },
					{ kind: "tool-provider-run-admission-decision", id: "admission-decision:1" },
				],
				metadata: { ...run().metadata, proposalId: reconstructedProposalId },
			});
		}
		await settle();
		if (
			input.scenarioId === "canonical-proposal" ||
			input.scenarioId === D63_WITHHELD_SEMANTIC_SCENARIO_ID
		) {
			const freshEnvelope = envelopes[0] as Record<string, unknown> | undefined;
			return observation(
				envelopes.length === 1 &&
					calls.join(",") === "admit" &&
					sent.length === 0 &&
					facts.map((value) => (value as Record<string, unknown>).state).join(",") === "queued" &&
					freshEnvelope?.runId === "run:1" &&
					freshEnvelope.admissionId === "admission:1" &&
					freshEnvelope.admissionProposalId === canonicalProposalId &&
					freshEnvelope.admissionDecisionId === "admission-decision:1" &&
					freshEnvelope.credentialBindingRevision === "credential-binding:1" &&
					freshEnvelope.deploymentRevision === "deployment:1" &&
					freshEnvelope.workerRevision === "worker-runtime:1",
				"canonical-proposal-not-admitted",
			);
		}
		if (input.scenarioId === "malformed-provenance")
			return observation(
				calls.length === 0 && envelopes.length === 0,
				"malformed-provenance-mutated-store",
			);
		if (input.scenarioId === "reconstructed-provenance")
			return observation(
				calls.length === 0 && envelopes.length === 0,
				"reconstructed-provenance-admitted",
			);

		onMessage({
			kind: "claim",
			messageId: "message:claim:1",
			protocolRevision: runtime.MANAGED_CLOUD_POSTGRESQL_PROTOCOL,
			workerId: "worker:1",
			sessionEpoch: "epoch:worker:1",
			environmentRevision: "environment-revision:1",
			deploymentRevision: "deployment:1",
			workerRevision: "worker-runtime:1",
			authAttestationRef: { kind: "attestation", id: "auth:1" },
		});
		await settle();
		const serialized = JSON.stringify({ envelopes, facts, sent, topology: graph.topology() });
		const claimPassed =
			input.writeScopePreserved &&
			calls.join(",") === "admit,claim" &&
			claimAuthorizationCalls === 1 &&
			facts.map((value) => (value as Record<string, unknown>).state).join(",") ===
				"queued,claimed" &&
			sent.some(
				(value) =>
					(value as Record<string, unknown>).kind === "claim-granted" &&
					(value as Record<string, unknown>).leaseId === "lease:1",
			) &&
			!/(connectionString|password|secret-value|socketHandle)/u.test(serialized) &&
			issues.length === 0;

		return observation(claimPassed, "claim-invariant-regression");
	} finally {
		await composed.dispose();
	}
}

const D61_WORKER_OUTPUT_MAX_BYTES = 4_096;

function remainingDeadlineMs(deadlineAt: number): number {
	const remaining = Math.floor(deadlineAt - performance.now());
	if (remaining < 1) throw new TypeError("D61 public semantic Graph deadline elapsed");
	return remaining;
}

function assertWithinDeadline(deadlineAt: number): void {
	remainingDeadlineMs(deadlineAt);
}

async function sourceTreeDigest(root: string): Promise<string> {
	const entries: Array<Readonly<{ path: string; digest: string; bytes: number }>> = [];
	const visit = async (directory: string, prefix: string): Promise<void> => {
		const names = (await readdir(directory)).sort();
		for (const name of names) {
			const path = join(directory, name);
			const relative = prefix === "" ? name : `${prefix}/${name}`;
			const metadata = await lstat(path);
			if (metadata.isSymbolicLink())
				throw new TypeError("D61 scenario source snapshot contained a symlink");
			if (metadata.isDirectory()) await visit(path, relative);
			else if (metadata.isFile()) {
				const bytes = await readFile(path);
				entries.push(
					Object.freeze({
						path: relative,
						digest: empiricalSha256(bytes),
						bytes: bytes.byteLength,
					}),
				);
			} else throw new TypeError("D61 scenario source snapshot contained a special file");
		}
	};
	await visit(root, "");
	return empiricalStrictJsonDigest(entries);
}

async function runIsolatedScenario(input: {
	readonly workerBundlePath: string;
	readonly workerRoot: string;
	readonly sourceSnapshotDigest: string;
	readonly writeScopePreserved: boolean;
	readonly scenarioId: D61WorkerSemanticScenarioId;
	readonly deadlineAt: number;
}): Promise<D61PublicSemanticObservationV1> {
	if (/["\\\n\r]/u.test(process.execPath) || /["\\\n\r]/u.test(input.workerRoot))
		throw new TypeError("D61 node sandbox coordinate is invalid");
	const sandboxProfile = `(version 1)(allow default)(deny network*)(deny process-fork)(deny signal)(deny process-exec)(allow process-exec (literal "${process.execPath}"))`;
	const args = [
		"-p",
		sandboxProfile,
		process.execPath,
		"--permission",
		`--allow-fs-read=${input.workerRoot}`,
		input.workerBundlePath,
		input.sourceSnapshotDigest,
		input.writeScopePreserved ? "1" : "0",
		input.scenarioId,
	] as const;
	const timeoutMs = remainingDeadlineMs(input.deadlineAt);
	return await new Promise((resolvePromise, rejectPromise) => {
		const child = spawn("/usr/bin/sandbox-exec", [...args], {
			cwd: dirname(input.workerBundlePath),
			env: Object.freeze({
				HOME: dirname(input.workerBundlePath),
				LANG: "C",
				LC_ALL: "C",
				NO_COLOR: "1",
				NODE_NO_WARNINGS: "1",
				PATH: "/usr/bin:/bin",
				TMPDIR: dirname(input.workerBundlePath),
			}),
			stdio: ["ignore", "pipe", "pipe"],
			shell: false,
		});
		const stdout: Buffer[] = [];
		const stderr: Buffer[] = [];
		let bytes = 0;
		let settled = false;
		let terminalError: Error | undefined;
		let timer: NodeJS.Timeout | undefined;
		const finish = (error?: Error, code?: number) => {
			if (settled) return;
			settled = true;
			if (timer !== undefined) clearTimeout(timer);
			if (terminalError !== undefined || error !== undefined)
				return rejectPromise(terminalError ?? error);
			const output = Buffer.concat(stdout).toString("utf8");
			if (
				code !== 0 ||
				stderr.length !== 0 ||
				!output.endsWith("\n") ||
				output.indexOf("\n") !== output.length - 1
			)
				return rejectPromise(new TypeError("D61 isolated semantic worker failed closed"));
			let parsed: unknown;
			try {
				parsed = JSON.parse(output);
			} catch {
				return rejectPromise(new TypeError("D61 isolated semantic worker returned invalid JSON"));
			}
			try {
				resolvePromise(validateD61PublicSemanticObservation(input.scenarioId, parsed));
			} catch (error) {
				rejectPromise(error);
			}
		};
		const collect = (target: Buffer[], chunk: Buffer) => {
			if (terminalError !== undefined) return;
			bytes += chunk.byteLength;
			if (bytes > D61_WORKER_OUTPUT_MAX_BYTES) {
				terminalError = new TypeError("D61 isolated semantic worker output exceeded bound");
				child.kill("SIGKILL");
			} else target.push(chunk);
		};
		child.stdout.on("data", (chunk: Buffer) => collect(stdout, chunk));
		child.stderr.on("data", (chunk: Buffer) => collect(stderr, chunk));
		child.once("error", (error) => {
			terminalError ??= error;
		});
		child.once("close", (code) => finish(undefined, code ?? 1));
		timer = setTimeout(() => {
			terminalError = new TypeError("D61 isolated semantic worker exceeded Graph deadline");
			child.kill("SIGKILL");
		}, timeoutMs);
	});
}

async function buildIsolatedWorkerBundle(input: {
	readonly repositoryRoot: string;
	readonly snapshotRoot: string;
	readonly outputPath: string;
	readonly deadlineAt: number;
}): Promise<void> {
	const entry = fileURLToPath(new URL("./d61-public-semantic-bundle-entry.ts", import.meta.url));
	const esbuild = await realpath(join(input.repositoryRoot, "node_modules/.bin/esbuild"));
	const metafilePath = `${input.outputPath}.meta.json`;
	const args = [
		entry,
		"--bundle",
		"--platform=node",
		"--format=esm",
		"--target=node24",
		"--log-level=error",
		`--outfile=${input.outputPath}`,
		`--metafile=${metafilePath}`,
		`--alias:d61-candidate-runtime=${join(input.snapshotRoot, "packages/ts/src/executors/managed-cloud-postgresql.ts")}`,
		`--alias:d61-candidate-graph=${join(input.snapshotRoot, "packages/ts/src/graph/graph.ts")}`,
		`--alias:d61-candidate-identity=${join(input.snapshotRoot, "packages/ts/src/identity.ts")}`,
		`--alias:d61-candidate-provider-input=${join(input.snapshotRoot, "packages/ts/src/executors/postgresql-tool-provider.ts")}`,
	] as const;
	const timeoutMs = remainingDeadlineMs(input.deadlineAt);
	await new Promise<void>((resolvePromise, rejectPromise) => {
		const child = spawn(esbuild, [...args], {
			cwd: input.repositoryRoot,
			env: Object.freeze({ HOME: "/var/empty", LANG: "C", LC_ALL: "C", PATH: "/usr/bin:/bin" }),
			stdio: ["ignore", "ignore", "pipe"],
			shell: false,
		});
		let stderrBytes = 0;
		let settled = false;
		let terminalError: Error | undefined;
		let timer: NodeJS.Timeout | undefined;
		const finish = (error?: Error, code?: number) => {
			if (settled) return;
			settled = true;
			if (timer !== undefined) clearTimeout(timer);
			if (terminalError !== undefined || error !== undefined || code !== 0)
				rejectPromise(terminalError ?? error ?? new TypeError("D61 isolated worker bundle failed"));
			else resolvePromise();
		};
		child.stderr.on("data", (chunk: Buffer) => {
			if (terminalError !== undefined) return;
			stderrBytes += chunk.byteLength;
			if (stderrBytes > D61_WORKER_OUTPUT_MAX_BYTES) {
				terminalError = new TypeError("D61 isolated worker bundle diagnostics exceeded bound");
				child.kill("SIGKILL");
			}
		});
		child.once("error", (error) => {
			terminalError ??= error;
		});
		child.once("close", (code) => finish(undefined, code ?? 1));
		timer = setTimeout(() => {
			terminalError = new TypeError("D61 isolated worker bundle exceeded Graph deadline");
			child.kill("SIGKILL");
		}, timeoutMs);
	});
	assertWithinDeadline(input.deadlineAt);
	const metafile = JSON.parse(await readFile(metafilePath, "utf8")) as {
		readonly inputs?: Readonly<Record<string, unknown>>;
	};
	if (metafile.inputs === undefined) throw new TypeError("D61 esbuild metafile omitted inputs");
	const trustedEvaluatorFiles = new Set(
		await Promise.all(
			[
				entry,
				fileURLToPath(import.meta.url),
				fileURLToPath(new URL("./canonical.ts", import.meta.url)),
				join(input.repositoryRoot, "packages/ts/src/json/codec.ts"),
			].map((path) => realpath(path)),
		),
	);
	const snapshotPrefix = `${await realpath(input.snapshotRoot)}/`;
	for (const path of Object.keys(metafile.inputs)) {
		const resolvedInput = await realpath(resolve(input.repositoryRoot, path));
		if (!resolvedInput.startsWith(snapshotPrefix) && !trustedEvaluatorFiles.has(resolvedInput))
			throw new TypeError("D61 esbuild input escaped the frozen semantic closure");
	}
	assertWithinDeadline(input.deadlineAt);
}

async function executeD61PublicSemanticScenariosInCoordinator(input: {
	readonly workspaceRoot: string;
	readonly workspaceStateDigest: string;
	readonly writeScopePreserved: boolean;
	readonly timeoutMs: number;
	readonly temporaryRoot: string;
	readonly scenarioMode: "public" | "withheld";
}): Promise<D61PublicSemanticScenarioResultV1> {
	if (!Number.isSafeInteger(input.timeoutMs) || input.timeoutMs < 1_000)
		throw new TypeError("D61 public semantic deadline is invalid");
	const deadlineAt = performance.now() + input.timeoutMs;
	const repositoryRoot = resolve(import.meta.dirname, "../../../..");
	const temporaryRoot = input.temporaryRoot;
	const resolvedTemporaryRoot = await realpath(temporaryRoot);
	const snapshotRoot = join(resolvedTemporaryRoot, "workspace");
	const workerBundlePath = join(resolvedTemporaryRoot, "semantic-worker.mjs");
	try {
		assertWithinDeadline(deadlineAt);
		await mkdir(join(snapshotRoot, "packages/ts"), { recursive: true, mode: 0o700 });
		const originalSource = join(input.workspaceRoot, "packages/ts/src");
		const snapshotSource = join(snapshotRoot, "packages/ts/src");
		const beforeDigest = await sourceTreeDigest(originalSource);
		await cp(originalSource, snapshotSource, { recursive: true, errorOnExist: true });
		await cp(
			join(input.workspaceRoot, "packages/ts/package.json"),
			join(snapshotRoot, "packages/ts/package.json"),
		);
		await cp(join(input.workspaceRoot, "package.json"), join(snapshotRoot, "package.json"));
		const snapshotDigest = await sourceTreeDigest(snapshotSource);
		const afterCopyDigest = await sourceTreeDigest(originalSource);
		if (snapshotDigest !== beforeDigest || afterCopyDigest !== beforeDigest)
			throw new TypeError("D61 public semantic source changed during snapshot");
		assertWithinDeadline(deadlineAt);
		await buildIsolatedWorkerBundle({
			repositoryRoot,
			snapshotRoot,
			outputPath: workerBundlePath,
			deadlineAt,
		});
		const scenarioIds: readonly D61WorkerSemanticScenarioId[] =
			input.scenarioMode === "public"
				? D61_PUBLIC_SEMANTIC_SCENARIO_IDS
				: [D63_WITHHELD_SEMANTIC_SCENARIO_ID];
		const observations: D61PublicSemanticObservationV1[] = [];
		for (const scenarioId of scenarioIds)
			observations.push(
				await runIsolatedScenario({
					workerBundlePath,
					workerRoot: resolvedTemporaryRoot,
					sourceSnapshotDigest: empiricalStrictJsonDigest({
						workspaceStateDigest: input.workspaceStateDigest,
						sourceTreeDigest: snapshotDigest,
					}),
					writeScopePreserved: input.writeScopePreserved,
					scenarioId,
					deadlineAt,
				}),
			);
		assertWithinDeadline(deadlineAt);
		if ((await sourceTreeDigest(originalSource)) !== beforeDigest)
			throw new TypeError("D61 public semantic source changed during execution");
		return Object.freeze({
			observations: Object.freeze(observations),
			sourceSnapshotDigest: empiricalStrictJsonDigest({
				workspaceStateDigest: input.workspaceStateDigest,
				sourceTreeDigest: snapshotDigest,
			}),
		});
	} finally {
		await rm(temporaryRoot, { recursive: true, force: true });
	}
}

const D61_COORDINATOR_MARKER = "graphrefly-ts.d61.semantic-coordinator.v1";
const D61_COORDINATOR_OUTPUT_MAX_BYTES = 16_384;
const D61_COORDINATOR_CLEANUP_TIMEOUT_MS = 1_000;

function validateCoordinatorTemporaryRoot(value: unknown): string {
	if (
		value === null ||
		typeof value !== "object" ||
		Array.isArray(value) ||
		Object.keys(value).join(",") !== "temporaryRoot"
	)
		throw new TypeError("D61 semantic coordinator handshake shape drifted");
	const temporaryRoot = (value as { readonly temporaryRoot?: unknown }).temporaryRoot;
	const prefix = join(tmpdir(), "graphrefly-d61-semantic-");
	if (
		typeof temporaryRoot !== "string" ||
		!temporaryRoot.startsWith(prefix) ||
		temporaryRoot.slice(prefix.length).length < 1 ||
		temporaryRoot.slice(prefix.length).includes("/")
	)
		throw new TypeError("D61 semantic coordinator handshake coordinate drifted");
	return temporaryRoot;
}

function validateD61SemanticScenarioResult(
	value: unknown,
	scenarioIds: readonly D61WorkerSemanticScenarioId[],
): D61PublicSemanticScenarioResultV1 {
	if (
		value === null ||
		typeof value !== "object" ||
		Array.isArray(value) ||
		Object.keys(value).sort().join(",") !== "observations,sourceSnapshotDigest"
	)
		throw new TypeError("D61 semantic coordinator result shape drifted");
	const candidate = value as {
		readonly observations?: unknown;
		readonly sourceSnapshotDigest?: unknown;
	};
	if (
		!Array.isArray(candidate.observations) ||
		candidate.observations.length !== scenarioIds.length ||
		typeof candidate.sourceSnapshotDigest !== "string" ||
		!/^sha256:[0-9a-f]{64}$/u.test(candidate.sourceSnapshotDigest)
	)
		throw new TypeError("D61 semantic coordinator result coordinates drifted");
	const observations = candidate.observations as readonly unknown[];
	return Object.freeze({
		observations: Object.freeze(
			scenarioIds.map((scenarioId, index) =>
				validateD61PublicSemanticObservation(scenarioId, observations[index]),
			),
		),
		sourceSnapshotDigest: candidate.sourceSnapshotDigest,
	});
}

function killProcessGroup(child: ReturnType<typeof spawn>): void {
	if (child.pid !== undefined) {
		try {
			process.kill(-child.pid, "SIGKILL");
			return;
		} catch {
			// The group may already have exited between observation and termination.
		}
	}
	child.kill("SIGKILL");
}

async function cleanupCoordinatorTemporaryRoot(temporaryRoot: string): Promise<void> {
	let timer: ReturnType<typeof setTimeout> | undefined;
	try {
		await Promise.race([
			rm(temporaryRoot, { recursive: true, force: true }),
			new Promise<never>((_, reject) => {
				timer = setTimeout(
					() => reject(new TypeError("D61 semantic coordinator cleanup exceeded bound")),
					D61_COORDINATOR_CLEANUP_TIMEOUT_MS,
				);
			}),
		]);
	} finally {
		if (timer !== undefined) clearTimeout(timer);
	}
}

async function executeD61SemanticScenarios(input: {
	readonly workspaceRoot: string;
	readonly workspaceStateDigest: string;
	readonly writeScopePreserved: boolean;
	readonly timeoutMs: number;
	readonly scenarioMode: "public" | "withheld";
}): Promise<D61PublicSemanticScenarioResultV1> {
	if (!Number.isSafeInteger(input.timeoutMs) || input.timeoutMs < 1_000)
		throw new TypeError("D61 public semantic deadline is invalid");
	const coordinatorPath = fileURLToPath(import.meta.url);
	const coordinatorTemporaryRoot = await mkdtemp(join(tmpdir(), "graphrefly-d61-semantic-"));
	validateCoordinatorTemporaryRoot({ temporaryRoot: coordinatorTemporaryRoot });
	const payload = JSON.stringify({ ...input, temporaryRoot: coordinatorTemporaryRoot });
	const timeoutMs = input.timeoutMs;
	try {
		return await new Promise((resolvePromise, rejectPromise) => {
			const child = spawn(process.execPath, ["--import", "tsx", coordinatorPath, payload], {
				cwd: resolve(import.meta.dirname, "../../../.."),
				detached: true,
				env: Object.freeze({
					GRAPHREFLY_D61_SEMANTIC_COORDINATOR: D61_COORDINATOR_MARKER,
					HOME: "/var/empty",
					LANG: "C",
					LC_ALL: "C",
					NO_COLOR: "1",
					NODE_NO_WARNINGS: "1",
					PATH: "/usr/bin:/bin",
					TMPDIR: tmpdir(),
				}),
				stdio: ["ignore", "pipe", "pipe"],
				shell: false,
			});
			const stdout: Buffer[] = [];
			const stderr: Buffer[] = [];
			let bytes = 0;
			let terminalError: Error | undefined;
			let settled = false;
			const timer = setTimeout(() => {
				terminalError = new TypeError("D61 semantic coordinator exceeded Graph deadline");
				killProcessGroup(child);
			}, timeoutMs);
			const collect = (target: Buffer[], chunk: Buffer) => {
				if (terminalError !== undefined) return;
				bytes += chunk.byteLength;
				if (bytes > D61_COORDINATOR_OUTPUT_MAX_BYTES) {
					terminalError = new TypeError("D61 semantic coordinator output exceeded bound");
					killProcessGroup(child);
				} else target.push(chunk);
			};
			child.stdout.on("data", (chunk: Buffer) => collect(stdout, chunk));
			child.stderr.on("data", (chunk: Buffer) => collect(stderr, chunk));
			child.once("error", (error) => {
				terminalError ??= error;
			});
			child.once("close", (code) => {
				void (async () => {
					if (settled) return;
					settled = true;
					clearTimeout(timer);
					if (terminalError !== undefined || code !== 0 || stderr.length !== 0) {
						if (code !== 0) killProcessGroup(child);
						rejectPromise(terminalError ?? new TypeError("D61 semantic coordinator failed closed"));
						return;
					}
					const output = Buffer.concat(stdout).toString("utf8");
					const lines = output.endsWith("\n") ? output.slice(0, -1).split("\n") : [];
					if (lines.length !== 1) {
						rejectPromise(new TypeError("D61 semantic coordinator IPC drifted"));
						return;
					}
					try {
						resolvePromise(
							validateD61SemanticScenarioResult(
								JSON.parse(lines[0]!),
								input.scenarioMode === "public"
									? D61_PUBLIC_SEMANTIC_SCENARIO_IDS
									: [D63_WITHHELD_SEMANTIC_SCENARIO_ID],
							),
						);
					} catch (error) {
						rejectPromise(error);
					}
				})().catch(rejectPromise);
			});
		});
	} finally {
		await cleanupCoordinatorTemporaryRoot(coordinatorTemporaryRoot);
	}
}

export async function executeD61PublicSemanticScenarios(input: {
	readonly workspaceRoot: string;
	readonly workspaceStateDigest: string;
	readonly writeScopePreserved: boolean;
	readonly timeoutMs: number;
}): Promise<D61PublicSemanticScenarioResultV1> {
	return executeD61SemanticScenarios({ ...input, scenarioMode: "public" });
}

export async function executeD63WithheldSemanticScenario(input: {
	readonly workspaceRoot: string;
	readonly workspaceStateDigest: string;
	readonly writeScopePreserved: boolean;
	readonly timeoutMs: number;
}): Promise<
	Readonly<{
		readonly passed: boolean;
		readonly sourceSnapshotDigest: string;
	}>
> {
	const result = await executeD61SemanticScenarios({ ...input, scenarioMode: "withheld" });
	const observation = result.observations[0];
	if (observation === undefined)
		throw new TypeError("D63 withheld semantic observation was absent");
	return Object.freeze({
		passed: observation.passed,
		sourceSnapshotDigest: result.sourceSnapshotDigest,
	});
}

if (process.env.GRAPHREFLY_D61_SEMANTIC_COORDINATOR === D61_COORDINATOR_MARKER) {
	const payload = process.argv[2];
	if (payload === undefined) throw new TypeError("D61 semantic coordinator input was absent");
	const candidate = JSON.parse(payload) as {
		readonly workspaceRoot: string;
		readonly workspaceStateDigest: string;
		readonly writeScopePreserved: boolean;
		readonly timeoutMs: number;
		readonly temporaryRoot: string;
		readonly scenarioMode: "public" | "withheld";
	};
	if (candidate.scenarioMode !== "public" && candidate.scenarioMode !== "withheld")
		throw new TypeError("D61 semantic coordinator mode drifted");
	const temporaryRoot = validateCoordinatorTemporaryRoot({
		temporaryRoot: candidate.temporaryRoot,
	});
	const result = await executeD61PublicSemanticScenariosInCoordinator({
		...candidate,
		temporaryRoot,
	});
	process.stdout.write(`${JSON.stringify(result)}\n`);
}
