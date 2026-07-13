import { describe, expect, it } from "vitest";
import {
	type PostgresqlDriverQueryRequest,
	type PostgresqlDriverQueryResult,
	type PostgresqlParameter,
	type PostgresqlQueryToolArguments,
	type PostgresqlRunCancellationDecision,
	type PostgresqlRunCancellationRequested,
	type PostgresqlToolProviderDriver,
	postgresqlQueryToolArgumentsFromIntent,
	postgresqlToolProviderCatalog,
	postgresqlToolProviderInputFromIntent,
	postgresqlToolProviderRuntime,
} from "../executors/postgresql-tool-provider.js";
import { graph } from "../graph/graph.js";
import { compoundTupleKey } from "../identity.js";
import type {
	ExecutorOutcome,
	ToolProviderAdapterInput,
	ToolProviderAdapterRunRequested,
	ToolProviderExecutionPolicy,
	ToolProviderRunAdmissionDecision,
} from "../orchestration/index.js";
import {
	requestToolProviderAdapterRun,
	toolProviderRunAdmissionProjector,
} from "../orchestration/index.js";

const catalogOptions = {
	adapterVersion: "1.0.0",
	driverCompatibility: "postgresql-wire>=14<18",
	argumentSchemaRef: "schema:postgresql-query-args:v1",
	resultSchemaRef: "schema:postgresql-query-result:v1",
	supportTier: "certified" as const,
	limitations: ["read-only", "single-statement"],
	rolloutCohort: "cohort:stable",
	maxRows: 3,
	maxColumns: 3,
	maxCellChars: 20,
	maxInlineRows: 2,
	maxResultBytes: 1000,
	statementTimeoutMs: 50,
};

const coordinate = (id: string) => ({ id, revision: "rev:1" });

function args(): PostgresqlQueryToolArguments {
	const canvasIntent = {
		kind: "workspace-production-data-query-intent",
		contractVersion: "1",
		intentId: "intent:orders",
		idempotencyKey: "idem:orders:1",
		source: coordinate("source:orders"),
		sourceProfile: coordinate("source-profile:postgresql"),
		queryPlan: coordinate("query-plan:weekly-orders"),
		executorProfile: coordinate("executor-profile:postgresql-read-only"),
		schemaRef: "schema:orders:v1",
		parameters: ["west", 7],
	} as const;
	return postgresqlQueryToolArgumentsFromIntent(canvasIntent);
}

function input(
	overrides: Partial<ToolProviderAdapterInput<PostgresqlQueryToolArguments>> = {},
): ToolProviderAdapterInput<PostgresqlQueryToolArguments> {
	return {
		...postgresqlToolProviderInputFromIntent(
			{
				...args(),
				intentId: "intent:orders",
				idempotencyKey: "idem:orders:1",
			},
			{
				requestId: "request:1",
				operationId: "operation:1",
				effectRunId: "effect-run:1",
				routeId: "route:postgresql:1",
				executorId: "postgresql:tool-executor",
				profileId: "postgresql:read-only:1.0.0",
			},
		),
		requestId: "request:1",
		operationId: "operation:1",
		effectRunId: "effect-run:1",
		routeId: "route:postgresql:1",
		providerId: "postgresql",
		executorId: "postgresql:tool-executor",
		profileId: "postgresql:read-only:1.0.0",
		toolName: "postgresql.query",
		operation: "read-query",
		toolCall: {
			kind: "tool-call",
			toolName: "postgresql.query",
			operation: "read-query",
			arguments: args(),
		},
		sourceRefs: [{ kind: "query-plan", id: "query-plan:weekly-orders@rev:1" }],
		...overrides,
	};
}

const defaultAdapterInputId = input().adapterInputId;

function run(
	overrides: Partial<ToolProviderAdapterRunRequested> = {},
): ToolProviderAdapterRunRequested {
	return {
		kind: "tool-provider-adapter-run-requested",
		runId: "run:1",
		adapterInputId: defaultAdapterInputId,
		requestId: "request:1",
		operationId: "operation:1",
		routeId: "route:postgresql:1",
		providerId: "postgresql",
		executorId: "postgresql:tool-executor",
		profileId: "postgresql:read-only:1.0.0",
		attempt: 1,
		reason: "initial",
		sourceRefs: [{ kind: "run-admission", id: "admission:1" }],
		...overrides,
	};
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

const settle = async (): Promise<void> => {
	await Promise.resolve();
	await Promise.resolve();
	await new Promise<void>((resolve) => setTimeout(resolve, 0));
};

describe("PostgreSQL-compatible tool provider (D602)", () => {
	it("publishes a version-pinned focused catalog while public arguments remain coordinate-only", () => {
		const catalog = postgresqlToolProviderCatalog(catalogOptions);
		expect(catalog).toMatchObject({
			providerKind: "postgresql",
			status: "ready",
			profiles: [expect.objectContaining({ profileId: "postgresql:read-only:1.0.0" })],
			tools: [
				expect.objectContaining({
					toolName: "postgresql.query",
					operation: "read-query",
					inputKind: "tool-call",
					capabilities: expect.objectContaining({
						adapterVersion: "1.0.0",
						driverCompatibility: "postgresql-wire>=14<18",
						supportTier: "certified",
						rolloutCohort: "cohort:stable",
						readOnly: true,
					}),
				}),
			],
		});
		expect(Object.keys(args())).not.toEqual(
			expect.arrayContaining(["sql", "statement", "credential", "client", "pool"]),
		);
		expect(JSON.stringify(catalog)).not.toMatch(/credential|connectionString|client|pool/i);
	});

	it("executes only explicit admitted runs, dedupes exact replay, and keeps private SQL out of graph evidence", async () => {
		const g = graph({ name: "postgresql-success" });
		const inputs = g.node<ToolProviderAdapterInput<PostgresqlQueryToolArguments>>([], null, {
			name: "inputs",
		});
		const admitted = g.node<ToolProviderAdapterRunRequested>([], null, {
			name: "approvedRunRequests",
		});
		const calls: PostgresqlDriverQueryRequest[] = [];
		const runtime = postgresqlToolProviderRuntime(g, {
			...catalogOptions,
			inputs,
			admittedRunRequests: [admitted],
			resolvePlan(received) {
				expect(received).toEqual(args());
				return {
					statement: "SELECT secret_private_sql",
					parameters: received.parameters,
					readOnly: true,
					schemaRef: received.schemaRef,
				};
			},
			driver: checkedDriver((request) => {
				calls.push(request);
				return Promise.resolve({
					columns: ["region", "count"],
					rows: [["west", 7]],
					byteLength: 12,
				});
			}),
		});
		const outcomes = collect<ExecutorOutcome>(runtime.outcomes);
		const issues = collect<{ code: string }>(runtime.issues);
		const audits = collect<unknown>(runtime.audit);

		inputs.down([["DATA", input()]]);
		await settle();
		expect(calls).toHaveLength(0);
		admitted.down([
			["DATA", run()],
			["DATA", run()],
		]);
		await settle();

		expect(calls).toHaveLength(1);
		expect(outcomes).toEqual([
			expect.objectContaining({
				kind: "result",
				attempt: 1,
				metadata: expect.objectContaining({ adapterVersion: "1.0.0" }),
				result: expect.objectContaining({
					value: expect.objectContaining({ dataMode: "inline", rows: [["west", 7]] }),
					artifacts: [expect.objectContaining({ dataMode: "inline", byteLength: 12 })],
				}),
			}),
		]);
		expect(issues).toEqual([]);
		expect(JSON.stringify({ outcomes, audits, topology: g.topology() })).not.toContain(
			"secret_private_sql",
		);
		await runtime.dispose();
	});

	it("waits behind the real D419 admission projector before executing", async () => {
		const g = graph({ name: "postgresql-d419-admission" });
		const inputs = g.node<ToolProviderAdapterInput<PostgresqlQueryToolArguments>>([], null);
		const candidates = g.node<ToolProviderAdapterRunRequested>([], null);
		const decisions = g.node<ToolProviderRunAdmissionDecision>([], null);
		const admission = toolProviderRunAdmissionProjector(g, {
			inputs,
			runRequests: [candidates],
			decisions: [decisions],
		});
		let calls = 0;
		const runtime = postgresqlToolProviderRuntime(g, {
			...catalogOptions,
			inputs,
			admittedRunRequests: [admission.approvedRunRequests],
			resolvePlan(value) {
				return { statement: "SELECT 1", readOnly: true, schemaRef: value.schemaRef };
			},
			driver: checkedDriver((request) => {
				expect(request.readOnly).toBe(true);
				calls += 1;
				return Promise.resolve({ columns: ["value"], rows: [[1]] });
			}),
		});
		const policy = {
			kind: "tool-provider-execution-policy",
			policyId: "policy:postgresql:human-admission",
			providerId: "postgresql",
			approval: { mode: "require" },
		} satisfies ToolProviderExecutionPolicy;
		const ready = input({ policies: [policy] });
		const candidate = requestToolProviderAdapterRun(ready, {
			runId: "candidate:postgresql:1",
			reason: "manual",
		});
		inputs.down([["DATA", ready]]);
		candidates.down([["DATA", candidate]]);
		await settle();
		expect(calls).toBe(0);
		decisions.down([
			[
				"DATA",
				{
					kind: "tool-provider-run-admission-decision",
					decisionId: "decision:postgresql:1",
					proposalId: compoundTupleKey("tool-provider-run-admission-proposal", [candidate.runId]),
					admissionId: "admission:postgresql:1",
					outcome: "admit",
					approvedRunId: "run:postgresql:approved:1",
				},
			],
		]);
		await settle();
		expect(calls).toBe(1);
		await runtime.dispose();
	});

	it("rejects admitted runs with omitted exact route, provider, executor, or profile coordinates", async () => {
		for (const field of ["routeId", "providerId", "executorId", "profileId"] as const) {
			const g = graph();
			const inputs = g.node<ToolProviderAdapterInput<PostgresqlQueryToolArguments>>([], null);
			const admitted = g.node<ToolProviderAdapterRunRequested>([], null);
			let calls = 0;
			const runtime = postgresqlToolProviderRuntime(g, {
				...catalogOptions,
				inputs,
				admittedRunRequests: [admitted],
				resolvePlan(value) {
					return { statement: "SELECT 1", readOnly: true, schemaRef: value.schemaRef };
				},
				driver: checkedDriver(() => {
					calls += 1;
					return Promise.resolve({ columns: ["value"], rows: [[1]] });
				}),
			});
			const incomplete = { ...run(), [field]: undefined };
			inputs.down([["DATA", input()]]);
			admitted.down([["DATA", incomplete]]);
			await settle();
			expect(calls, field).toBe(0);
			await runtime.dispose();
		}
	});

	it("rejects conflicting run fingerprints, SQL-bearing arguments, and over-capacity results", async () => {
		const g = graph();
		const inputs = g.node<ToolProviderAdapterInput<PostgresqlQueryToolArguments>>([], null, {
			name: "inputs",
		});
		const admitted = g.node<ToolProviderAdapterRunRequested>([], null, { name: "admitted" });
		const runtime = postgresqlToolProviderRuntime(g, {
			...catalogOptions,
			inputs,
			admittedRunRequests: [admitted],
			resolvePlan(received) {
				return { statement: "SELECT 1", readOnly: true, schemaRef: received.schemaRef };
			},
			driver: checkedDriver(() => {
				return Promise.resolve({
					columns: ["value"],
					rows: [["this cell is far too long for the admitted bound"]],
				});
			}),
		});
		const outcomes = collect<ExecutorOutcome>(runtime.outcomes);
		const issues = collect<{ code: string }>(runtime.issues);
		inputs.down([["DATA", input()]]);
		admitted.down([
			["DATA", run()],
			["DATA", run({ requestId: "request:conflict" })],
			[
				"DATA",
				run({
					runId: "run:environment-conflict",
					metadata: {
						executionEnvironmentId: "environment:local",
						executionEnvironmentRevision: "revision:1",
						executionEnvironmentLocality: "local",
						executionEnvironmentBindingKind: "local-host-process",
						executionSessionEpoch: "session:1",
					},
				}),
			],
			[
				"DATA",
				run({
					runId: "run:environment-conflict",
					metadata: {
						executionEnvironmentId: "environment:local",
						executionEnvironmentRevision: "revision:2",
						executionEnvironmentLocality: "local",
						executionEnvironmentBindingKind: "local-host-process",
						executionSessionEpoch: "session:2",
					},
				}),
			],
		]);
		await settle();
		expect(
			issues.filter((entry) => entry.code === "postgresql-run-coordinate-conflict"),
		).toHaveLength(2);
		expect(outcomes).toHaveLength(2);
		expect(outcomes).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					kind: "failure",
					error: expect.objectContaining({ code: "postgresql-result-limit" }),
				}),
			]),
		);

		const sqlBearing = input({
			adapterInputId: "adapter-input:sql",
			requestId: "request:sql",
			toolCall: {
				kind: "tool-call",
				toolName: "postgresql.query",
				arguments: { ...args(), sql: "SELECT leaked" } as never,
			},
		});
		inputs.down([["DATA", sqlBearing]]);
		admitted.down([
			[
				"DATA",
				run({ runId: "run:sql", adapterInputId: "adapter-input:sql", requestId: "request:sql" }),
			],
		]);
		await settle();
		expect(outcomes.at(-1)).toEqual(
			expect.objectContaining({
				kind: "failure",
				error: expect.objectContaining({ code: "postgresql-unsafe-plan" }),
			}),
		);
		await runtime.dispose();
	});

	it("rejects dishonest driver counts, unbounded parameters, and unverifiable read-only sessions", async () => {
		for (const scenario of ["counts", "parameter", "read-only"] as const) {
			const g = graph();
			const inputs = g.node<ToolProviderAdapterInput<PostgresqlQueryToolArguments>>([], null);
			const admitted = g.node<ToolProviderAdapterRunRequested>([], null);
			let queried = 0;
			const driver: PostgresqlToolProviderDriver = {
				compatibility: catalogOptions.driverCompatibility,
				acquire() {
					return Promise.resolve({
						readOnlyEnforced: scenario === "read-only" ? (false as never) : true,
						query() {
							queried += 1;
							return Promise.resolve({
								columns: ["value"],
								rows: [[1], [2]],
								rowCount: 1,
								byteLength: 1,
							});
						},
						release() {},
					});
				},
			};
			const runtime = postgresqlToolProviderRuntime(g, {
				...catalogOptions,
				inputs,
				admittedRunRequests: [admitted],
				resolvePlan(value) {
					return { statement: "SELECT 1", readOnly: true, schemaRef: value.schemaRef };
				},
				driver,
			});
			const outcomes = collect<ExecutorOutcome>(runtime.outcomes);
			const nextArgs =
				scenario === "parameter" ? { ...args(), parameters: ["x".repeat(5000)] } : args();
			inputs.down([["DATA", input({ toolCall: { ...input().toolCall!, arguments: nextArgs } })]]);
			admitted.down([["DATA", run()]]);
			await settle();
			expect(outcomes.at(-1)).toEqual(expect.objectContaining({ kind: "failure" }));
			if (scenario === "parameter") expect(queried).toBe(0);
			await runtime.dispose();
		}
	});

	it("releases its graph topology on quiescent idempotent dispose", async () => {
		const g = graph();
		const inputs = g.node<ToolProviderAdapterInput<PostgresqlQueryToolArguments>>([], null);
		const admitted = g.node<ToolProviderAdapterRunRequested>([], null);
		const runtime = postgresqlToolProviderRuntime(g, {
			...catalogOptions,
			name: "postgresql:quiescent-release",
			inputs,
			admittedRunRequests: [admitted],
			resolvePlan(value) {
				return { statement: "SELECT 1", readOnly: true, schemaRef: value.schemaRef };
			},
			driver: checkedDriver(() => Promise.resolve({ columns: ["value"], rows: [[1]] })),
		});
		expect(g.find("postgresql:quiescent-release/outcomes")).toBeDefined();
		const unsubscribe = runtime.outcomes.subscribe(() => {});
		await runtime.dispose();
		expect(g.find("postgresql:quiescent-release/outcomes")).toBeDefined();
		unsubscribe();
		await runtime.dispose();
		expect(g.find("postgresql:quiescent-release/outcomes")).toBeUndefined();
	});

	it("publishes artifact failure when checked-out client release rejects", async () => {
		const g = graph();
		const inputs = g.node<ToolProviderAdapterInput<PostgresqlQueryToolArguments>>([], null);
		const admitted = g.node<ToolProviderAdapterRunRequested>([], null);
		const runtime = postgresqlToolProviderRuntime(g, {
			...catalogOptions,
			inputs,
			admittedRunRequests: [admitted],
			resolvePlan(value) {
				return { statement: "SELECT 1", readOnly: true, schemaRef: value.schemaRef };
			},
			driver: {
				compatibility: catalogOptions.driverCompatibility,
				acquire() {
					return Promise.resolve({
						readOnlyEnforced: true,
						query: () => Promise.resolve({ columns: ["value"], rows: [[1]] }),
						release: () => Promise.reject(new Error("private release failure")),
					});
				},
			},
		});
		const outcomes = collect<ExecutorOutcome>(runtime.outcomes);
		inputs.down([["DATA", input()]]);
		admitted.down([["DATA", run()]]);
		await settle();
		expect(outcomes).toEqual([
			expect.objectContaining({
				kind: "failure",
				error: expect.objectContaining({ code: "postgresql-artifact-failure" }),
			}),
		]);
		expect(JSON.stringify(outcomes)).not.toContain("private release failure");
		await runtime.dispose();
	});

	it("snapshots admitted arguments and rejects accessor-bearing material without invoking it", async () => {
		const g = graph();
		const inputs = g.node<ToolProviderAdapterInput<PostgresqlQueryToolArguments>>([], null);
		const admitted = g.node<ToolProviderAdapterRunRequested>([], null);
		const received: PostgresqlQueryToolArguments[] = [];
		const runtime = postgresqlToolProviderRuntime(g, {
			...catalogOptions,
			inputs,
			admittedRunRequests: [admitted],
			resolvePlan(value) {
				received.push(value);
				return { statement: "SELECT 1", readOnly: true, schemaRef: value.schemaRef };
			},
			driver: checkedDriver(() => {
				return Promise.resolve({ columns: ["value"], rows: [[1]] });
			}),
		});
		const mutable = structuredClone(args());
		inputs.down([
			[
				"DATA",
				input({
					toolCall: { kind: "tool-call", toolName: "postgresql.query", arguments: mutable },
				}),
			],
		]);
		(mutable.parameters as PostgresqlParameter[])[0] = "mutated";
		admitted.down([["DATA", run()]]);
		await settle();
		expect(received[0]?.parameters).toEqual(["west", 7]);

		let getterCalled = false;
		const hostile = structuredClone(args()) as PostgresqlQueryToolArguments & { secret?: string };
		Object.defineProperty(hostile, "secret", {
			enumerable: true,
			get() {
				getterCalled = true;
				return "SELECT leaked";
			},
		});
		inputs.down([
			[
				"DATA",
				input({
					adapterInputId: "adapter-input:hostile",
					requestId: "request:hostile",
					toolCall: { kind: "tool-call", toolName: "postgresql.query", arguments: hostile },
				}),
			],
		]);
		admitted.down([
			[
				"DATA",
				run({
					runId: "run:hostile",
					adapterInputId: "adapter-input:hostile",
					requestId: "request:hostile",
				}),
			],
		]);
		await settle();
		expect(getterCalled).toBe(false);
		expect(received).toHaveLength(1);
		await runtime.dispose();
	});

	it.each([
		["authentication", false],
		["authorization", false],
		["connectivity", true],
		["server-resource-limit", true],
		["schema-drift", false],
		["adapter-driver-mismatch", false],
		["provider-unknown", true],
	] as const)("classifies %s without hidden retry", async (kind, retryable) => {
		const g = graph();
		const inputs = g.node<ToolProviderAdapterInput<PostgresqlQueryToolArguments>>([], null);
		const admitted = g.node<ToolProviderAdapterRunRequested>([], null);
		let calls = 0;
		const runtime = postgresqlToolProviderRuntime(g, {
			...catalogOptions,
			inputs,
			admittedRunRequests: [admitted],
			resolvePlan(received) {
				return { statement: "SELECT 1", readOnly: true, schemaRef: received.schemaRef };
			},
			driver: checkedDriver(() => {
				calls += 1;
				return Promise.reject(Object.assign(new Error("private"), { kind, retryable }));
			}),
		});
		const outcomes = collect<ExecutorOutcome>(runtime.outcomes);
		inputs.down([["DATA", input()]]);
		admitted.down([["DATA", run()]]);
		await settle();
		expect(calls).toBe(1);
		expect(outcomes).toEqual([
			expect.objectContaining({
				kind: "failure",
				retryable,
				error: expect.objectContaining({ code: `postgresql-${kind}` }),
			}),
		]);
		expect(JSON.stringify(outcomes)).not.toContain("private");
		await runtime.dispose();
	});

	it("requires exact graph-visible cancellation admission before aborting the private driver", async () => {
		const g = graph();
		const inputs = g.node<ToolProviderAdapterInput<PostgresqlQueryToolArguments>>([], null);
		const admitted = g.node<ToolProviderAdapterRunRequested>([], null);
		const cancellationRequests = g.node<PostgresqlRunCancellationRequested>([], null);
		const cancellationDecisions = g.node<PostgresqlRunCancellationDecision>([], null);
		const runtime = postgresqlToolProviderRuntime(g, {
			...catalogOptions,
			inputs,
			admittedRunRequests: [admitted],
			cancellationRequests: [cancellationRequests],
			cancellationDecisions: [cancellationDecisions],
			resolvePlan(received) {
				return { statement: "SELECT pg_sleep(10)", readOnly: true, schemaRef: received.schemaRef };
			},
			driver: abortableDriver(),
		});
		const outcomes = collect<ExecutorOutcome>(runtime.outcomes);
		const proposals = collect<{ proposalId: string }>(runtime.cancellationProposals);
		const admissions = collect<{ state: string }>(runtime.cancellationAdmissions);
		inputs.down([["DATA", input()]]);
		admitted.down([["DATA", run()]]);
		await settle();
		cancellationRequests.down([["DATA", cancellation("operation:wrong")]]);
		await settle();
		expect(proposals).toHaveLength(0);
		let leakedGetter = false;
		const exactCancellation = cancellation("operation:1") as PostgresqlRunCancellationRequested & {
			readonly connectionString?: string;
		};
		Object.defineProperty(exactCancellation, "connectionString", {
			enumerable: true,
			get() {
				leakedGetter = true;
				return "private";
			},
		});
		cancellationRequests.down([["DATA", exactCancellation]]);
		await settle();
		expect(proposals).toHaveLength(0);
		expect(leakedGetter).toBe(false);
		expect(JSON.stringify(proposals)).not.toContain("connectionString");
		cancellationRequests.down([["DATA", cancellation("operation:1")]]);
		await settle();
		expect(proposals).toHaveLength(1);
		expect(outcomes).toHaveLength(0);
		cancellationDecisions.down([
			[
				"DATA",
				{
					kind: "postgresql-run-cancellation-decision",
					decisionId: "cancel-decision:1",
					proposalId: proposals[0]!.proposalId,
					outcome: "admit",
				},
			],
		]);
		await settle();
		expect(admissions).toEqual([expect.objectContaining({ state: "admitted" })]);
		expect(outcomes).toEqual([
			expect.objectContaining({ kind: "canceled", reason: "admitted-user-cancellation" }),
		]);
		await runtime.dispose();
	});

	it("separates timeout from user cancellation and honors runtime-owned versus shared driver lifecycle", async () => {
		const owned = await timeoutRuntime("runtime-owned");
		expect(owned.outcomes).toEqual([expect.objectContaining({ kind: "timeout", timeoutMs: 5 })]);
		await owned.runtime.dispose();
		await owned.runtime.dispose();
		expect(owned.closed()).toBe(1);
		expect(owned.released()).toBe(1);

		const shared = await timeoutRuntime("caller-owned");
		await shared.runtime.dispose();
		expect(shared.closed()).toBe(0);
		expect(shared.released()).toBe(1);
	});
});

function cancellation(operationId: string): PostgresqlRunCancellationRequested {
	return {
		kind: "postgresql-run-cancellation-requested",
		cancellationId: "cancel:1",
		runId: "run:1",
		adapterInputId: defaultAdapterInputId,
		requestId: "request:1",
		operationId,
		attempt: 1,
	};
}

function checkedDriver(
	query: (request: PostgresqlDriverQueryRequest) => PromiseLike<PostgresqlDriverQueryResult>,
	close?: () => void,
	release: () => void = () => {},
): PostgresqlToolProviderDriver {
	return {
		compatibility: catalogOptions.driverCompatibility,
		acquire(request) {
			expect(request.readOnly).toBe(true);
			return Promise.resolve({
				readOnlyEnforced: true,
				query,
				release,
			});
		},
		close,
	};
}

function abortableDriver(close?: () => void, release?: () => void): PostgresqlToolProviderDriver {
	return checkedDriver(
		(request) => {
			return new Promise<PostgresqlDriverQueryResult>((_resolve, reject) => {
				request.signal.addEventListener(
					"abort",
					() => reject(Object.assign(new Error("aborted"), { name: "AbortError" })),
					{ once: true },
				);
			});
		},
		close,
		release,
	);
}

async function timeoutRuntime(ownership: "runtime-owned" | "caller-owned") {
	const g = graph();
	const inputs = g.node<ToolProviderAdapterInput<PostgresqlQueryToolArguments>>([], null);
	const admitted = g.node<ToolProviderAdapterRunRequested>([], null);
	let closeCount = 0;
	let releaseCount = 0;
	const runtime = postgresqlToolProviderRuntime(g, {
		...catalogOptions,
		statementTimeoutMs: 5,
		inputs,
		admittedRunRequests: [admitted],
		driverOwnership: ownership,
		resolvePlan(received) {
			return { statement: "SELECT pg_sleep(10)", readOnly: true, schemaRef: received.schemaRef };
		},
		driver: abortableDriver(
			() => {
				closeCount += 1;
			},
			() => {
				releaseCount += 1;
			},
		),
	});
	const outcomes = collect<ExecutorOutcome>(runtime.outcomes);
	inputs.down([["DATA", input()]]);
	admitted.down([["DATA", run()]]);
	await new Promise<void>((resolve) => setTimeout(resolve, 15));
	await settle();
	return { runtime, outcomes, closed: () => closeCount, released: () => releaseCount };
}
