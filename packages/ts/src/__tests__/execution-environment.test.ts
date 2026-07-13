import { describe, expect, it } from "vitest";
import { subscribeNodeValues } from "../adapters/store.js";
import {
	type EnvironmentPinnedExecutorProfile,
	type EnvironmentPinnedExecutorRoute,
	environmentPinnedExecutorProfile,
	environmentPinnedExecutorRoute,
	executionEnvironmentTarget,
	localHostExecutionGate,
	requestEnvironmentPinnedToolProviderRun,
} from "../executors/execution-environment.js";
import {
	type PostgresqlDriverQueryRequest,
	type PostgresqlRunCancellationDecision,
	type PostgresqlRunCancellationRequested,
	postgresqlToolProviderInputFromIntent,
	postgresqlToolProviderRuntime,
} from "../executors/postgresql-tool-provider.js";
import { topologyDiff } from "../graph/composition.js";
import { graph } from "../graph/graph.js";
import { compoundTupleKey } from "../identity.js";
import {
	type ToolProviderAdapterInput,
	type ToolProviderAdapterRunRequested,
	type ToolProviderExecutionPolicy,
	type ToolProviderRunAdmissionDecision,
	toolProviderRunAdmissionProjector,
} from "../orchestration/index.js";

const target = (overrides = {}) =>
	executionEnvironmentTarget({
		kind: "execution-environment-target",
		environmentId: "environment:local-primary",
		revision: "environment-revision:1",
		locality: "local",
		bindingKind: "local-host-process",
		capabilities: ["postgresql-read-only"],
		limits: { concurrency: 4 },
		policyRefs: [{ kind: "environment-policy", id: "policy:local-primary" }],
		movementPolicyRefs: [{ kind: "movement-policy", id: "movement:local-only" }],
		readiness: {
			state: "ready",
			observedAtMs: 100,
			expiresAtMs: 1_000,
			attestationRefs: [{ kind: "environment-attestation", id: "attestation:local:1" }],
		},
		...overrides,
	});

const profile = (overrides = {}): EnvironmentPinnedExecutorProfile =>
	environmentPinnedExecutorProfile({
		profileId: "postgresql:read-only:1.0.0",
		executorId: "postgresql:tool-executor",
		kind: "tool",
		acceptedInputKinds: ["tool-call"],
		requiredEnvironmentCapabilities: ["postgresql-read-only"],
		executionEnvironment: target(),
		...overrides,
	});

const route = (overrides = {}): EnvironmentPinnedExecutorRoute =>
	environmentPinnedExecutorRoute({
		kind: "executor-route",
		routeId: "route:postgresql:local:1",
		requestId: "request:1",
		operationId: "operation:1",
		inputId: input().adapterInputId,
		inputKind: "tool-call",
		executorId: "postgresql:tool-executor",
		profileId: "postgresql:read-only:1.0.0",
		executionEnvironment: {
			environmentId: "environment:local-primary",
			revision: "environment-revision:1",
		},
		...overrides,
	});

function input(): ToolProviderAdapterInput {
	return postgresqlToolProviderInputFromIntent(
		{
			contractVersion: "1",
			intentId: "intent:orders",
			idempotencyKey: "idem:orders:1",
			source: { id: "source:orders", revision: "revision:1" },
			sourceProfile: { id: "source-profile:postgresql", revision: "revision:1" },
			queryPlan: { id: "query-plan:orders", revision: "revision:1" },
			executorProfile: { id: "executor-profile:postgresql", revision: "revision:1" },
			schemaRef: "schema:orders:v1",
		},
		{
			requestId: "request:1",
			operationId: "operation:1",
			effectRunId: "effect-run:1",
			routeId: "route:postgresql:local:1",
			executorId: "postgresql:tool-executor",
			profileId: "postgresql:read-only:1.0.0",
		},
	);
}

function collect<T>(node: {
	subscribe(callback: (message: readonly [string, unknown]) => void): () => void;
}): T[] {
	const values: T[] = [];
	node.subscribe((message) => {
		if (message[0] === "DATA") values.push(message[1] as T);
	});
	return values;
}

const settle = async () => {
	await Promise.resolve();
	await Promise.resolve();
	await new Promise<void>((resolve) => setTimeout(resolve, 0));
};

describe("execution environment targeting and local host gate (D603)", () => {
	it("snapshots bounded inert target/profile/route material and rejects private or remote-binding claims", () => {
		const rawCapabilities = ["postgresql-read-only"];
		const value = target({ capabilities: rawCapabilities });
		rawCapabilities.push("mutated");
		expect(value.capabilities).toEqual(["postgresql-read-only"]);
		expect(Object.isFrozen(value)).toBe(true);
		expect(() => target({ limits: { credentialToken: 1 } })).toThrow(
			/forbidden material|Invalid environment limit/,
		);
		expect(() => target({ locality: "managed-cloud", bindingKind: "local-host-process" })).toThrow(
			/A remote target must use a remote-session binding/,
		);
		expect(() =>
			environmentPinnedExecutorProfile({
				...profile(),
				metadata: { callback: () => "forbidden" },
			}),
		).toThrow(/inert data/);
		const projected = environmentPinnedExecutorRoute({
			...route(),
			metadata: { harmlessExtra: "not-authority" },
		});
		expect("metadata" in projected).toBe(false);
	});

	it.each([
		["local container", { bindingKind: "local-container" }],
		["managed cloud", { locality: "managed-cloud", bindingKind: "remote-session" }],
		["customer hosted", { locality: "customer-hosted", bindingKind: "remote-session" }],
	])("keeps %s targets explicitly unavailable to the local-host-process binding", async (_label, patch) => {
		const g = graph();
		const inputs = g.node<ToolProviderAdapterInput>([], null);
		const profiles = g.node<EnvironmentPinnedExecutorProfile>([], null);
		const routes = g.node<EnvironmentPinnedExecutorRoute>([], null);
		const admitted = g.node<ToolProviderAdapterRunRequested>([], null);
		const gate = localHostExecutionGate(g, {
			inputs,
			profiles: [profiles],
			routes: [routes],
			admittedRunRequests: [admitted],
			now: () => 200,
		});
		const statuses = collect<{ state: string; code: string }>(gate.status);
		const patchedProfile = profile({ executionEnvironment: target(patch) });
		const candidate = requestEnvironmentPinnedToolProviderRun(input(), patchedProfile, route(), {
			runId: "run:unavailable",
		});
		inputs.down([["DATA", input()]]);
		profiles.down([["DATA", patchedProfile]]);
		routes.down([["DATA", route()]]);
		admitted.down([["DATA", candidate]]);
		await settle();
		expect(statuses.at(-1)).toMatchObject({
			state: "blocked",
			code: "execution-environment-unavailable",
		});
	});

	it("fails stale and exact revision mismatch before releasing a run", async () => {
		for (const mode of ["stale", "mismatch"] as const) {
			const g = graph();
			const inputs = g.node<ToolProviderAdapterInput>([], null);
			const profiles = g.node<EnvironmentPinnedExecutorProfile>([], null);
			const routes = g.node<EnvironmentPinnedExecutorRoute>([], null);
			const admitted = g.node<ToolProviderAdapterRunRequested>([], null);
			const gate = localHostExecutionGate(g, {
				inputs,
				profiles: [profiles],
				routes: [routes],
				admittedRunRequests: [admitted],
				now: () => 2_000,
			});
			const released = collect(gate.admittedRunRequests);
			const statuses = collect<{ code: string }>(gate.status);
			const safeProfile = profile();
			const safeRoute = route();
			const request = requestEnvironmentPinnedToolProviderRun(input(), safeProfile, safeRoute, {
				runId: `run:${mode}`,
			});
			inputs.down([["DATA", input()]]);
			profiles.down([["DATA", safeProfile]]);
			routes.down([
				[
					"DATA",
					mode === "mismatch"
						? route({
								executionEnvironment: {
									environmentId: "environment:local-primary",
									revision: "environment-revision:2",
								},
							})
						: safeRoute,
				],
			]);
			admitted.down([["DATA", request]]);
			await settle();
			expect(released).toEqual([]);
			expect(statuses.at(-1)?.code).toBe(
				mode === "stale" ? "execution-environment-stale" : "execution-environment-mismatch",
			);
		}
	});

	it("fails closed on route input identity, kind, profile compatibility, sparse, and oversized material", async () => {
		for (const badRoute of [
			route({ inputId: "adapter-input:other" }),
			route({ inputKind: "prompt" }),
		]) {
			expect(() => requestEnvironmentPinnedToolProviderRun(input(), profile(), badRoute)).toThrow(
				/exactly match/,
			);
		}
		expect(() =>
			requestEnvironmentPinnedToolProviderRun(
				input(),
				profile({ acceptedInputKinds: ["prompt"] }),
				route(),
			),
		).toThrow(/exactly match/);
		expect(() =>
			requestEnvironmentPinnedToolProviderRun(
				input(),
				profile({ acceptedSchemaRefs: ["schema:other"] }),
				route(),
			),
		).toThrow(/exactly match/);
		expect(() =>
			requestEnvironmentPinnedToolProviderRun(
				input(),
				profile({
					executionEnvironment: target({ capabilities: ["another-capability"] }),
				}),
				route(),
			),
		).toThrow(/exactly match/);
		const sparse: unknown[] = [];
		sparse.length = 2;
		expect(() => target({ capabilities: sparse })).toThrow(
			/invalid collection|Invalid capabilities/,
		);
		expect(() =>
			target({ capabilities: Array.from({ length: 257 }, (_, i) => `capability:${i}`) }),
		).toThrow();
	});

	it("declares exact gate topology, suppresses duplicate emissions, and retries release", async () => {
		const g = graph({ name: "environment-gate-topology" });
		const inputs = g.node<ToolProviderAdapterInput>([], null, { name: "inputs" });
		const profiles = g.node<EnvironmentPinnedExecutorProfile>([], null, { name: "profiles" });
		const routes = g.node<EnvironmentPinnedExecutorRoute>([], null, { name: "routes" });
		const admitted = g.node<ToolProviderAdapterRunRequested>([], null, { name: "admitted" });
		const before = g.describe();
		const gate = localHostExecutionGate(g, {
			name: "localEnvironmentGate",
			inputs,
			profiles: [profiles],
			routes: [routes],
			admittedRunRequests: [admitted],
			now: () => 200,
		});
		const after = g.describe();
		const delta = topologyDiff(before, after).events;
		expect(delta.filter((event) => event.type === "node-added")).toHaveLength(5);
		expect(delta.filter((event) => event.type === "edge-added")).toHaveLength(8);
		expect(
			after.nodes
				.filter((node) => node.id.startsWith("localEnvironmentGate/"))
				.map((node) => [node.id, node.factory])
				.sort(),
		).toEqual(
			[
				["localEnvironmentGate/admittedRunRequests", "localHostExecutionGateRequests"],
				["localEnvironmentGate/audit", "localHostExecutionGateAudit"],
				["localEnvironmentGate/issues", "localHostExecutionGateIssues"],
				["localEnvironmentGate/runtime", "localHostExecutionGateRuntime"],
				["localEnvironmentGate/status", "localHostExecutionGateStatus"],
			].sort(),
		);
		expect(
			after.edges
				.filter(
					(edge) =>
						edge.from.startsWith("localEnvironmentGate/") ||
						edge.to.startsWith("localEnvironmentGate/"),
				)
				.map((edge) => [edge.from, edge.to])
				.sort(),
		).toEqual(
			[
				["inputs", "localEnvironmentGate/runtime"],
				["profiles", "localEnvironmentGate/runtime"],
				["routes", "localEnvironmentGate/runtime"],
				["admitted", "localEnvironmentGate/runtime"],
				["localEnvironmentGate/runtime", "localEnvironmentGate/admittedRunRequests"],
				["localEnvironmentGate/runtime", "localEnvironmentGate/status"],
				["localEnvironmentGate/runtime", "localEnvironmentGate/issues"],
				["localEnvironmentGate/runtime", "localEnvironmentGate/audit"],
			].sort(),
		);
		let emissions = 0;
		const unsubscribe = subscribeNodeValues(gate.admittedRunRequests, () => {
			emissions += 1;
		});
		const candidate = requestEnvironmentPinnedToolProviderRun(input(), profile(), route(), {
			runId: "run:topology",
		});
		inputs.down([["DATA", input()]]);
		profiles.down([["DATA", profile()]]);
		routes.down([["DATA", route()]]);
		admitted.down([
			["DATA", candidate],
			["DATA", candidate],
		]);
		await settle();
		expect(emissions).toBe(1);
		gate.dispose();
		expect(g.find("localEnvironmentGate/runtime")).toBeDefined();
		unsubscribe();
		gate.dispose();
		expect(g.find("localEnvironmentGate/runtime")).toBeUndefined();
	});

	it("runs the canonical Canvas-coordinate lowerer through real D419 admission, local gate, and PostgreSQL runtime", async () => {
		const g = graph({ name: "m11-local-postgresql" });
		const inputs = g.node<ToolProviderAdapterInput>([], null, { name: "adapterInputs" });
		const profiles = g.node<EnvironmentPinnedExecutorProfile>([], null, {
			name: "environmentProfiles",
		});
		const routes = g.node<EnvironmentPinnedExecutorRoute>([], null, { name: "environmentRoutes" });
		const candidates = g.node<ToolProviderAdapterRunRequested>([], null, { name: "candidateRuns" });
		const decisions = g.node<ToolProviderRunAdmissionDecision>([], null, {
			name: "runAdmissionDecisions",
		});
		const cancellations = g.node<PostgresqlRunCancellationRequested>([], null, {
			name: "cancellationRequests",
		});
		const cancellationDecisions = g.node<PostgresqlRunCancellationDecision>([], null, {
			name: "cancellationDecisions",
		});
		const admission = toolProviderRunAdmissionProjector(g, {
			inputs,
			runRequests: [candidates],
			decisions: [decisions],
		});
		const gate = localHostExecutionGate(g, {
			name: "postgresqlLocalEnvironmentGate",
			inputs,
			profiles: [profiles],
			routes: [routes],
			admittedRunRequests: [admission.approvedRunRequests],
			now: () => 200,
		});
		let calls = 0;
		const runtime = postgresqlToolProviderRuntime(g, {
			adapterVersion: "1.0.0",
			driverCompatibility: "postgresql-wire>=14<18",
			argumentSchemaRef: "schema:postgresql-query-args:v1",
			resultSchemaRef: "schema:postgresql-query-result:v1",
			supportTier: "certified",
			rolloutCohort: "cohort:stable",
			inputs,
			admittedRunRequests: [gate.admittedRunRequests],
			cancellationRequests: [cancellations],
			cancellationDecisions: [cancellationDecisions],
			resolvePlan(value) {
				return { statement: "SELECT host_private", readOnly: true, schemaRef: value.schemaRef };
			},
			driver: {
				compatibility: "postgresql-wire>=14<18",
				acquire() {
					return Promise.resolve({
						readOnlyEnforced: true as const,
						query(request: PostgresqlDriverQueryRequest) {
							calls += 1;
							return new Promise((_resolve, reject) => {
								request.signal.addEventListener("abort", () => {
									const error = new Error("canceled") as Error & { kind: string };
									error.kind = "canceled";
									reject(error);
								});
							});
						},
						release() {},
					});
				},
			},
		});
		const safeInput = {
			...input(),
			policies: [
				{
					kind: "tool-provider-execution-policy",
					policyId: "policy:manual",
					providerId: "postgresql",
					approval: { mode: "require" },
				} satisfies ToolProviderExecutionPolicy,
			],
		};
		const safeProfile = profile();
		const safeRoute = route();
		const candidate = requestEnvironmentPinnedToolProviderRun(safeInput, safeProfile, safeRoute, {
			runId: "candidate:local-postgresql:1",
			reason: "manual",
		});
		inputs.down([["DATA", safeInput]]);
		profiles.down([["DATA", safeProfile]]);
		routes.down([["DATA", safeRoute]]);
		candidates.down([["DATA", candidate]]);
		await settle();
		expect(calls).toBe(0);
		decisions.down([
			[
				"DATA",
				{
					kind: "tool-provider-run-admission-decision",
					decisionId: "decision:local-postgresql:1",
					proposalId: compoundTupleKey("tool-provider-run-admission-proposal", [candidate.runId]),
					admissionId: "admission:local-postgresql:1",
					outcome: "admit",
					approvedRunId: "run:local-postgresql:1",
				},
			],
		]);
		await settle();
		expect(calls).toBe(1);
		const proposals = collect<{ proposalId: string }>(runtime.cancellationProposals);
		const issues = collect<{ code: string }>(runtime.issues);
		const outcomes = collect<{ kind: string }>(runtime.outcomes);
		const cancellationBase = {
			kind: "postgresql-run-cancellation-requested" as const,
			cancellationId: "cancel:local-postgresql:1",
			runId: "run:local-postgresql:1",
			adapterInputId: safeInput.adapterInputId,
			requestId: safeInput.requestId,
			operationId: safeInput.operationId,
			attempt: 1,
			executionEnvironmentId: "environment:local-primary",
			executionEnvironmentRevision: "environment-revision:1",
			sessionEpoch: "session:local-host-process",
		};
		cancellations.down([
			["DATA", { ...cancellationBase, executionEnvironmentRevision: "environment-revision:stale" }],
		]);
		await settle();
		expect(proposals).toHaveLength(0);
		expect(issues.at(-1)?.code).toBe("postgresql-cancellation-coordinate-mismatch");
		for (const mismatch of [{ sessionEpoch: "session:stale" }, { attempt: 2 }]) {
			cancellations.down([["DATA", { ...cancellationBase, ...mismatch }]]);
			await settle();
			expect(proposals).toHaveLength(0);
			expect(issues.at(-1)?.code).toBe("postgresql-cancellation-coordinate-mismatch");
		}
		cancellations.down([["DATA", cancellationBase]]);
		await settle();
		expect(proposals).toHaveLength(1);
		cancellationDecisions.down([
			[
				"DATA",
				{
					kind: "postgresql-run-cancellation-decision",
					decisionId: "cancel-decision:local-postgresql:1",
					proposalId: proposals[0].proposalId,
					outcome: "admit",
				},
			],
		]);
		await settle();
		expect(outcomes.at(-1)?.kind).toBe("canceled");
		expect(JSON.stringify(g.topology())).not.toContain("host_private");
		await runtime.dispose();
		gate.dispose();
		gate.dispose();
	});
});
