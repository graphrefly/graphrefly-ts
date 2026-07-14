import { describe, expect, it } from "vitest";
import {
	POSTGRESQL_SHARED_CONTROL_PANEL_COMPATIBILITY,
	POSTGRESQL_SHARED_CONTROL_PANEL_SCHEMA,
	postgresql16SharedControlPanelStore,
	type SharedControlPanelGrant,
	type SharedControlPanelRevision,
	type SharedControlPanelSqlClient,
	type SharedControlPanelSqlResult,
	type SharedControlPanelSubscriptionRevision,
	sharedControlPanelAdmissionFingerprint,
	sharedControlPanelAdmitCanvasSubscriptionIntent,
	sharedControlPanelCapabilitySupported,
	sharedControlPanelCompletedOccurrenceCorrelates,
	sharedControlPanelConditionMatches,
	sharedControlPanelRecordedOutcomeMatchesCompleted,
} from "../executors/postgresql-shared-control-panel.js";

const pins = {
	tenantId: "tenant",
	workspaceId: "workspace",
	workGraphId: "work-graph",
	panelId: "panel",
	panelRevision: "panel-v1",
	queryRevision: "query-v1",
	specRevision: "spec-v1",
	sourceRevision: "source-v1",
	schemaRevision: "schema-v1",
	artifactRevision: "artifact-v1",
	inputRevision: "input-v1",
	topologyFingerprint: "topology-v1",
	policyRevision: "policy-v1",
	redactionRevision: "redaction-v1",
	environmentId: "environment",
	environmentRevision: "environment-v1",
	runId: "run",
	requestId: "request",
	attempt: 1,
	outcomeId: "outcome",
	runHighWater: 4,
	evidenceHighWater: 3,
	freshnessHighWater: 2,
};
const revision: SharedControlPanelRevision = {
	kind: "shared-control-panel-revision",
	pins,
	previousRevision: null,
	title: "Operations",
	frames: [{ frameId: "main", x: 0, y: 0, width: 12, height: 8 }],
	widgets: [
		{
			widgetId: "answer",
			frameId: "main",
			bindingKind: "answer",
			bindingRef: "outcome",
			displayRevision: "display-v1",
		},
	],
	immutableRefs: [{ kind: "outcome", id: "outcome" }],
	createdBy: "owner",
	createdAtMs: 100,
};
const canonicalTruth = {
	kind: "shared-control-panel-canonical-truth" as const,
	pins,
	recordedAtMs: 100,
};
const grant: SharedControlPanelGrant = {
	kind: "shared-control-panel-grant",
	grantId: "grant",
	tenantId: "tenant",
	panelId: "panel",
	panelRevision: "panel-v1",
	subjectId: "viewer",
	capability: "view",
	capabilityRevision: "cap-v1",
	policyRevision: "policy-v1",
	redactionRevision: "redaction-v1",
	issuedAtMs: 100,
	expiresAtMs: 1_000,
	revokedAtMs: null,
	actorSessionRevision: "session-v1",
};
const subscription: SharedControlPanelSubscriptionRevision = {
	kind: "shared-control-panel-subscription-revision",
	tenantId: "tenant",
	subscriptionId: "subscription",
	subscriptionRevision: "subscription-v1",
	previousRevision: null,
	panelId: "panel",
	panelRevision: "panel-v1",
	subjectId: "viewer",
	pins,
	grantId: "grant",
	capabilityRevision: "cap-v1",
	actorSessionRevision: "session-v1",
	intervalMs: 60_000,
	scheduleAnchorMs: 100,
	expiresAtMs: 1_000_000,
	condition: "stale",
	conditionRevision: "condition-v1",
	staleAfterMs: 120_000,
	anomalyThreshold: 10,
	cooldownMs: 60_000,
	rateCap: 4,
	policyRevision: "policy-v1",
	redactionRevision: "redaction-v1",
	active: true,
	effectiveAtMs: 100,
};
const coordinate = (id: string, revision = `${id}:revision`) => ({ id, revision });
const subscriptionBinding = {
	capability: "subscribe" as const,
	tenant: coordinate(pins.tenantId),
	workspace: coordinate(pins.workspaceId),
	workGraph: coordinate(pins.workGraphId),
	panel: coordinate(pins.panelId),
	panelHead: coordinate("panel-head"),
	panelRevision: coordinate("panel-revision", pins.panelRevision),
	sourceRequest: coordinate(pins.requestId),
	sourceRun: coordinate(pins.runId),
	sourceOutcome: coordinate(pins.outcomeId),
	queryPlan: coordinate("query-plan", pins.queryRevision),
	spec: coordinate("spec", pins.specRevision),
	input: coordinate("input", pins.inputRevision),
	source: coordinate("source", pins.sourceRevision),
	schema: coordinate("schema", pins.schemaRevision),
	evidence: coordinate("evidence"),
	artifact: coordinate("artifact", pins.artifactRevision),
	actorSession: coordinate("actor-session", subscription.actorSessionRevision),
	actorSubject: coordinate(subscription.subjectId),
	actorGrant: coordinate(subscription.grantId, subscription.capabilityRevision),
	actorCapabilitySet: coordinate("capability", subscription.capabilityRevision),
	capabilityRevision: coordinate("capability", subscription.capabilityRevision),
	actorAdmission: coordinate("actor-admission"),
	issuedAt: coordinate("issued-at"),
	expiresAt: coordinate("expires-at"),
	policy: coordinate("policy", subscription.policyRevision),
	redaction: coordinate("redaction", subscription.redactionRevision),
	attempt: pins.attempt,
	topologyFingerprint: pins.topologyFingerprint,
	terminalHighWater: String(pins.runHighWater),
	evidenceHighWater: String(pins.evidenceHighWater),
	artifactHighWater: "artifact-high-water",
	freshnessHighWater: String(pins.freshnessHighWater),
};

class ScriptedSql implements SharedControlPanelSqlClient {
	readonly calls: { text: string; values: readonly unknown[] }[] = [];
	constructor(private readonly results: SharedControlPanelSqlResult[]) {}
	async query(text: string, values: readonly unknown[] = []) {
		this.calls.push({ text, values });
		return this.results.shift() ?? { rowCount: 1, rows: [] };
	}
	async transaction<T>(run: (client: SharedControlPanelSqlClient) => Promise<T>) {
		return run(this);
	}
}
const noOutcomeAuthority = { lookup: async () => null };
const noSubscriptionBindingAuthority = { lookup: async () => null };
const store = (sql: SharedControlPanelSqlClient) =>
	postgresql16SharedControlPanelStore(
		sql,
		{ now: () => 100 },
		noOutcomeAuthority,
		noSubscriptionBindingAuthority,
	);

describe("D608 PostgreSQL shared control-panel authority", () => {
	it("keeps the focused compatibility and all six capabilities explicit", () => {
		expect(POSTGRESQL_SHARED_CONTROL_PANEL_COMPATIBILITY).toBe(
			"postgresql-shared-control-panel-v1",
		);
		expect(POSTGRESQL_SHARED_CONTROL_PANEL_SCHEMA).toContain("shared_control_panel");
		expect(
			["view", "query-rerun", "download", "input", "subscribe", "action"].map(
				sharedControlPanelCapabilitySupported,
			),
		).toEqual([true, true, false, false, true, false]);
	});

	it("admits only an exact inert Canvas subscription intent before PostgreSQL writes", async () => {
		const intent = {
			kind: "workspace-shared-control-panel-subscription-intent" as const,
			contractVersion: "1" as const,
			intentId: "subscription-intent",
			idempotencyKey: "subscription-key",
			action: "create" as const,
			intervalSeconds: subscription.intervalMs / 1_000,
			condition: subscription.condition,
			binding: subscriptionBinding,
		};
		const request = sharedControlPanelAdmitCanvasSubscriptionIntent(
			intent,
			subscription,
			100,
			subscriptionBinding,
		);
		expect(request).toMatchObject({
			kind: "shared-control-panel-host-subscription-request",
			intent: { action: "create", binding: { capability: "subscribe" } },
			revision: { subscriptionRevision: "subscription-v1" },
		});
		expect(Object.isFrozen(request)).toBe(true);
		let intentBindingGetterCalls = 0;
		const accessorIntent = { ...intent };
		Object.defineProperty(accessorIntent, "binding", {
			enumerable: true,
			get: () => {
				intentBindingGetterCalls++;
				return subscriptionBinding;
			},
		});
		expect(() =>
			sharedControlPanelAdmitCanvasSubscriptionIntent(
				accessorIntent,
				subscription,
				100,
				subscriptionBinding,
			),
		).toThrow("accessor-shared-control-panel-material");
		expect(intentBindingGetterCalls).toBe(0);
		let nestedRequestGetterCalls = 0;
		const nestedActorSession = { ...request.intent.binding.actorSession };
		Object.defineProperty(nestedActorSession, "revision", {
			enumerable: true,
			get: () => {
				nestedRequestGetterCalls++;
				return subscription.actorSessionRevision;
			},
		});
		const manualRequest = {
			...request,
			intent: {
				...request.intent,
				binding: { ...request.intent.binding, actorSession: nestedActorSession },
			},
		};
		const nestedRequestSql = new ScriptedSql([]);
		await expect(store(nestedRequestSql).createSubscription(manualRequest)).rejects.toThrow(
			"accessor-shared-control-panel-material",
		);
		expect(nestedRequestGetterCalls).toBe(0);
		expect(nestedRequestSql.calls).toEqual([]);
		let authoritativeGetterCalls = 0;
		const accessorAuthority = { ...subscriptionBinding };
		Object.defineProperty(accessorAuthority, "artifactHighWater", {
			enumerable: true,
			get: () => {
				authoritativeGetterCalls++;
				return "artifact-high-water";
			},
		});
		expect(() =>
			sharedControlPanelAdmitCanvasSubscriptionIntent(intent, subscription, 100, accessorAuthority),
		).toThrow("accessor-shared-control-panel-material");
		expect(authoritativeGetterCalls).toBe(0);
		const coordinateFields = [
			"tenant",
			"workspace",
			"workGraph",
			"panel",
			"panelHead",
			"panelRevision",
			"sourceRequest",
			"sourceRun",
			"sourceOutcome",
			"queryPlan",
			"spec",
			"input",
			"source",
			"schema",
			"evidence",
			"artifact",
			"actorSession",
			"actorSubject",
			"actorGrant",
			"actorCapabilitySet",
			"capabilityRevision",
			"actorAdmission",
			"issuedAt",
			"expiresAt",
			"policy",
			"redaction",
		] as const;
		for (const field of coordinateFields) {
			for (const coordinateField of ["id", "revision"] as const) {
				const mutated = structuredClone(subscriptionBinding);
				(mutated[field] as { id: string; revision: string })[coordinateField] += ":mutated";
				expect(() =>
					sharedControlPanelAdmitCanvasSubscriptionIntent(intent, subscription, 100, mutated),
				).toThrow(/canvas-subscription-binding/);
			}
		}
		for (const field of [
			"attempt",
			"topologyFingerprint",
			"terminalHighWater",
			"evidenceHighWater",
			"artifactHighWater",
			"freshnessHighWater",
		] as const) {
			const mutated = structuredClone(subscriptionBinding) as Record<string, unknown>;
			mutated[field] = field === "attempt" ? 2 : `${String(mutated[field])}:mutated`;
			expect(() =>
				sharedControlPanelAdmitCanvasSubscriptionIntent(
					intent,
					subscription,
					100,
					mutated as typeof subscriptionBinding,
				),
			).toThrow(/canvas-subscription-binding/);
		}
		expect(() =>
			sharedControlPanelAdmitCanvasSubscriptionIntent(intent, subscription, 100, {
				...subscriptionBinding,
				capability: "view",
			} as unknown as typeof subscriptionBinding),
		).toThrow("subscribe-binding-required");
		for (const [action, active, previousRevision] of [
			["pause", false, "subscription-v1"],
			["resume", true, "subscription-v2"],
			["revoke", false, "subscription-v3"],
		] as const) {
			const revision = {
				...subscription,
				subscriptionRevision: `${previousRevision}:${action}`,
				previousRevision,
				active,
			};
			expect(
				sharedControlPanelAdmitCanvasSubscriptionIntent(
					{
						...intent,
						intentId: `intent:${action}`,
						idempotencyKey: `key:${action}`,
						action,
						subscription: coordinate(subscription.subscriptionId, previousRevision),
						intervalSeconds: undefined,
						condition: undefined,
					},
					revision,
					100,
					subscriptionBinding,
				).intent.action,
			).toBe(action);
		}

		const sql = new ScriptedSql([]);
		await expect(
			store(sql).createSubscription({
				...request,
				intent: {
					...request.intent,
					binding: {
						...request.intent.binding,
						actorSession: coordinate("actor-session", "forged-session"),
					},
				},
			}),
		).rejects.toThrow("canvas-subscription-binding-mismatch");
		expect(sql.calls).toEqual([]);

		const storeTruthSql = new ScriptedSql([]);
		const unverified = await postgresql16SharedControlPanelStore(
			storeTruthSql,
			{ now: () => 100 },
			noOutcomeAuthority,
			{ lookup: async () => ({ ...subscriptionBinding, artifactHighWater: "forged" }) },
		).createSubscription(request);
		expect(unverified).toEqual({ accepted: false, code: "subscription-binding-unverified" });
		expect(storeTruthSql.calls).toEqual([]);
		let lookupResultGetterCalls = 0;
		const lookupAccessor = { ...subscriptionBinding };
		Object.defineProperty(lookupAccessor, "panelHead", {
			enumerable: true,
			get: () => {
				lookupResultGetterCalls++;
				return subscriptionBinding.panelHead;
			},
		});
		const lookupAccessorSql = new ScriptedSql([]);
		expect(
			await postgresql16SharedControlPanelStore(
				lookupAccessorSql,
				{ now: () => 100 },
				noOutcomeAuthority,
				{ lookup: async () => lookupAccessor },
			).createSubscription(request),
		).toEqual({ accepted: false, code: "subscription-binding-unverified" });
		expect(lookupResultGetterCalls).toBe(0);
		expect(lookupAccessorSql.calls).toEqual([]);
		const authorityDriftSql = new ScriptedSql([]);
		expect(
			await postgresql16SharedControlPanelStore(
				authorityDriftSql,
				{ now: () => 100 },
				noOutcomeAuthority,
				{
					lookup: async () => ({
						...subscriptionBinding,
						actorSession: coordinate("actor-session", "forged-session"),
					}),
				},
			).createSubscription(request),
		).toEqual({ accepted: false, code: "subscription-binding-unverified" });
		expect(authorityDriftSql.calls).toEqual([]);
	});

	it("installs separate PG16 revision, grant, subscription, occurrence, alert, delivery and audit tables", async () => {
		const sql = new ScriptedSql([]);
		await store(sql).install();
		const ddl = sql.calls[0]?.text ?? "";
		for (const table of [
			"panel_revisions",
			"panel_heads",
			"grants",
			"subscriptions",
			"subscription_requests",
			"occurrences",
			"alerts",
			"deliveries",
			"audit",
		])
			expect(ddl).toContain(table);
	});

	it("creates an immutable revision only against the exact locked head", async () => {
		const sql = new ScriptedSql([
			{ rowCount: 0, rows: [] },
			{ rowCount: 0, rows: [] },
			{ rowCount: 1, rows: [] },
			{ rowCount: 1, rows: [] },
			{ rowCount: 1, rows: [] },
		]);
		const result = await store(sql).createRevision(revision, "create-v1");
		expect(result).toMatchObject({ accepted: true, code: "panel-revision-created" });
		expect(sql.calls.map((call) => call.text)).toEqual(
			expect.arrayContaining([
				expect.stringContaining("idempotency_key=$3 FOR UPDATE"),
				expect.stringContaining("panel_heads"),
				expect.stringContaining("IS NOT DISTINCT FROM $4"),
			]),
		);
		expect(Object.isFrozen(result.value)).toBe(true);
	});

	it("returns the same immutable body for exact idempotency and rejects body drift", async () => {
		const exact = new ScriptedSql([{ rowCount: 1, rows: [{ body: revision }] }]);
		expect(await store(exact).createRevision(revision, "key")).toMatchObject({
			accepted: true,
			code: "idempotent-panel-revision",
		});
		const drifted = { ...revision, title: "Changed" };
		const conflict = new ScriptedSql([{ rowCount: 1, rows: [{ body: revision }] }]);
		expect(await store(conflict).createRevision(drifted, "key")).toEqual({
			accepted: false,
			code: "idempotency-conflict",
		});
	});

	it("allows canonical truth only as exact rereference or monotonic high-water advance", async () => {
		const exactSql = new ScriptedSql([{ rowCount: 1, rows: [{ body: canonicalTruth }] }]);
		expect(await store(exactSql).recordCanonicalTruth(canonicalTruth)).toMatchObject({
			accepted: true,
			code: "canonical-truth-rereferenced",
		});
		expect(exactSql.calls).toHaveLength(1);
		const drift = { ...canonicalTruth, pins: { ...pins, runId: "other-run" } };
		const driftSql = new ScriptedSql([{ rowCount: 1, rows: [{ body: canonicalTruth }] }]);
		expect(await store(driftSql).recordCanonicalTruth(drift)).toEqual({
			accepted: false,
			code: "canonical-truth-cas-conflict",
		});
		expect(driftSql.calls).toHaveLength(1);
		const advanced = {
			...canonicalTruth,
			recordedAtMs: 200,
			pins: {
				...pins,
				runId: "run-2",
				attempt: 2,
				outcomeId: "outcome-2",
				runHighWater: 5,
				evidenceHighWater: 4,
				freshnessHighWater: 3,
			},
		};
		const advanceSql = new ScriptedSql([
			{ rowCount: 1, rows: [{ body: canonicalTruth }] },
			{ rowCount: 1, rows: [] },
		]);
		expect(
			await postgresql16SharedControlPanelStore(
				advanceSql,
				{ now: () => 200 },
				noOutcomeAuthority,
				noSubscriptionBindingAuthority,
			).recordCanonicalTruth(advanced),
		).toMatchObject({ accepted: true, code: "canonical-truth-recorded" });
	});

	it("refuses stale heads and unsupported capability grants without writes", async () => {
		const stale = new ScriptedSql([
			{ rowCount: 0, rows: [] },
			{ rowCount: 1, rows: [{ panel_revision: "panel-v0" }] },
		]);
		expect(await store(stale).createRevision(revision, "key")).toEqual({
			accepted: false,
			code: "stale-panel-head",
		});
		const sql = new ScriptedSql([]);
		expect(
			await store(sql).issueGrant({
				...grant,
				capability: "download",
			}),
		).toEqual({ accepted: false, code: "capability-unsupported-v1" });
		expect(sql.calls).toHaveLength(0);
	});

	it("revalidates the current panel, subject, capability, policy, redaction, revoke and expiry", async () => {
		const truth = {
			kind: "shared-control-panel-current-truth" as const,
			pins,
			subjectId: "viewer",
			grantId: "grant",
			capability: "view" as const,
			capabilityRevision: "cap-v1",
			currentPolicyRevision: "policy-v1",
			currentRedactionRevision: "redaction-v1",
			actorSessionRevision: "session-v1",
			observedAtMs: 200,
		};
		const current = new ScriptedSql([
			{
				rowCount: 1,
				rows: [{ grant_body: grant, panel_body: revision, truth_body: canonicalTruth }],
			},
		]);
		expect(await store(current).authorize(truth, 200)).toMatchObject({
			accepted: true,
			code: "authorized",
		});
		for (const bad of [
			{ ...truth, subjectId: "intruder" },
			{ ...truth, currentPolicyRevision: "policy-v2" },
			{ ...truth, currentRedactionRevision: "redaction-v2" },
		]) {
			const sql = new ScriptedSql([
				{
					rowCount: 1,
					rows: [{ grant_body: grant, panel_body: revision, truth_body: canonicalTruth }],
				},
			]);
			expect(await store(sql).authorize(bad, 200)).toEqual({
				accepted: false,
				code: "authorization-stale-or-denied",
			});
		}
		const crossPanelSql = new ScriptedSql([
			{
				rowCount: 1,
				rows: [
					{
						grant_body: { ...grant, panelId: "other-panel" },
						panel_body: revision,
						truth_body: canonicalTruth,
					},
				],
			},
		]);
		expect(await store(crossPanelSql).authorize(truth, 999)).toEqual({
			accepted: false,
			code: "authorization-stale-or-denied",
		});
		expect(crossPanelSql.calls).toHaveLength(1);
	});

	it("uses bounded deterministic stale/anomaly evaluation and rejects unsafe schedules", () => {
		const signal = {
			observedAtMs: 240_100,
			lastSuccessfulRunAtMs: 100,
			value: 25,
			baseline: 10,
			evidenceFingerprint: "fingerprint",
			evidenceRefs: [{ kind: "run", id: "run-1" }],
		};
		expect(sharedControlPanelConditionMatches(subscription, signal, 240_100)).toBe(true);
		expect(
			sharedControlPanelConditionMatches(
				{ ...subscription, condition: "anomaly" },
				signal,
				240_100,
			),
		).toBe(true);
		expect(() =>
			sharedControlPanelConditionMatches({ ...subscription, intervalMs: 999 }, signal, 240_100),
		).toThrow("unsafe-subscription-bounds");
	});

	it("keeps schedule anchor independent from effective time and claims only at an aligned host due", async () => {
		const phased = {
			...subscription,
			scheduleAnchorMs: 0,
			effectiveAtMs: 100,
			expiresAtMs: 1_000_000,
		};
		expect(
			sharedControlPanelConditionMatches(
				phased,
				{
					observedAtMs: 100,
					lastSuccessfulRunAtMs: 0,
					value: 0,
					baseline: 0,
					evidenceFingerprint: "evidence",
					evidenceRefs: [],
				},
				100,
			),
		).toBe(false);
		const earlySql = new ScriptedSql([]);
		const early = await postgresql16SharedControlPanelStore(
			earlySql,
			{ now: () => 59_999 },
			noOutcomeAuthority,
			noSubscriptionBindingAuthority,
		).claimDue(phased, "occurrence", 60_000, 1, "admission-fp");
		expect(early).toEqual({ accepted: false, code: "occurrence-not-due" });
		expect(earlySql.calls).toHaveLength(0);
		const subscribeGrant = { ...grant, capability: "subscribe" as const, expiresAtMs: 1_000_000 };
		const dueSql = new ScriptedSql([
			{ rowCount: 1, rows: [{ subscription_revision: "subscription-v1", body: phased }] },
			{
				rowCount: 1,
				rows: [{ grant_body: subscribeGrant, panel_body: revision, truth_body: canonicalTruth }],
			},
			{ rowCount: 1, rows: [] },
			{ rowCount: 1, rows: [] },
		]);
		const due = await postgresql16SharedControlPanelStore(
			dueSql,
			{ now: () => 60_000 },
			noOutcomeAuthority,
			noSubscriptionBindingAuthority,
		).claimDue(phased, "occurrence", 60_000, 0, "admission-fp");
		expect(due).toMatchObject({
			accepted: true,
			code: "occurrence-claimed",
			value: { dueAtMs: 60_000, claimedAtMs: 60_000 },
		});
	});

	it("correlates the persisted candidate through D419 without equating candidate and approved run ids", () => {
		const occurrence = {
			kind: "shared-control-panel-occurrence" as const,
			tenantId: "tenant",
			occurrenceId: "occurrence",
			subscriptionId: "subscription",
			subscriptionRevision: "subscription-v1",
			conditionRevision: "condition-v1",
			panelId: "panel",
			panelRevision: "panel-v1",
			dueAtMs: 100,
			claimedAtMs: 100,
			admissionFingerprint: "pre-run",
			state: "candidate-created" as const,
			reason: "fresh-d419-candidate",
			candidate: {
				kind: "shared-control-panel-run-candidate" as const,
				occurrenceId: "occurrence",
				createdAtMs: 110,
				request: {
					kind: "tool-provider-adapter-run-requested" as const,
					runId: "candidate:run",
					adapterInputId: "input",
					requestId: "candidate:request",
					operationId: "operation",
					attempt: 1,
					reason: "initial" as const,
					metadata: {
						executionEnvironmentId: "environment",
						executionEnvironmentRevision: "environment-v1",
						executionEnvironmentLocality: "local",
						executionEnvironmentBindingKind: "local-host-process",
						executionSessionEpoch: "session:1",
					},
				},
			},
			completed: null,
			evaluation: null,
		};
		const completed = {
			kind: "shared-control-panel-completed-occurrence" as const,
			occurrenceId: "occurrence",
			candidateRequestId: "candidate:request",
			candidateRunId: "candidate:run",
			admissionId: "admission",
			admissionSourceRefs: [{ kind: "tool-provider-run-admission", id: "admission" }],
			runId: "approved:run",
			attempt: 1,
			outcomeId: "outcome",
			terminalHighWater: 7,
			outcomeEvidenceFingerprint: "outcome-evidence",
			evidenceRefs: [{ kind: "executor-outcome", id: "outcome" }],
			completedAtMs: 200,
		};
		expect(sharedControlPanelCompletedOccurrenceCorrelates(occurrence, completed)).toBe(true);
		expect(
			sharedControlPanelCompletedOccurrenceCorrelates(occurrence, {
				...completed,
				candidateRunId: "approved:run",
			}),
		).toBe(false);
		const recorded = {
			kind: "shared-control-panel-recorded-terminal-outcome" as const,
			tenantId: "tenant",
			occurrenceId: "occurrence",
			runId: "approved:run",
			attempt: 1,
			outcomeId: "outcome",
			terminalHighWater: 7,
			outcomeEvidenceFingerprint: "outcome-evidence",
			evidenceRefs: [{ kind: "executor-outcome", id: "outcome" }],
			recordedAtMs: 200,
		};
		expect(sharedControlPanelRecordedOutcomeMatchesCompleted(recorded, completed)).toBe(true);
		expect(
			sharedControlPanelRecordedOutcomeMatchesCompleted(
				{ ...recorded, outcomeEvidenceFingerprint: "forged" },
				completed,
			),
		).toBe(false);
		const hostile = {
			...occurrence,
			candidate: {
				...occurrence.candidate,
				request: {
					...occurrence.candidate.request,
					metadata: { ...occurrence.candidate.request.metadata, apiKey: "secret" },
				},
			},
		};
		expect(() => sharedControlPanelCompletedOccurrenceCorrelates(hostile, completed)).toThrow(
			"unknown-shared-control-panel-field:apiKey",
		);
		const accessorMetadata = { ...occurrence.candidate.request.metadata };
		Object.defineProperty(accessorMetadata, "executionEnvironmentId", {
			enumerable: true,
			get: () => "environment",
		});
		expect(() =>
			sharedControlPanelCompletedOccurrenceCorrelates(
				{
					...occurrence,
					candidate: {
						...occurrence.candidate,
						request: { ...occurrence.candidate.request, metadata: accessorMetadata },
					},
				},
				completed,
			),
		).toThrow("accessor-shared-control-panel-material");
	});

	it("accepts only bounded canonical D419 admission metadata", () => {
		const admission = {
			kind: "tool-provider-run-admission" as const,
			admissionId: "admission",
			proposalId: "proposal",
			runId: "candidate:run",
			adapterInputId: "input",
			requestId: "request",
			operationId: "operation",
			state: "admitted" as const,
			decisionId: "decision",
			approvedRunId: "approved:run",
			sourceRefs: [{ kind: "decision", id: "decision" }],
			metadata: { approvalMode: "require", occurredAtMs: 100 },
		};
		expect(sharedControlPanelAdmissionFingerprint(admission)).toMatch(/^fnv1a64:[a-f0-9]{16}$/);
		expect(() =>
			sharedControlPanelAdmissionFingerprint({
				...admission,
				metadata: { ...admission.metadata, rawSql: "SELECT secret" },
			}),
		).toThrow("unknown-shared-control-panel-field:rawSql");
		const metadata = { ...admission.metadata };
		Object.defineProperty(metadata, "approvalMode", { enumerable: true, get: () => "require" });
		expect(() => sharedControlPanelAdmissionFingerprint({ ...admission, metadata })).toThrow(
			"accessor-shared-control-panel-material",
		);
	});

	it("records only the host-authoritative terminal outcome", async () => {
		const admission = {
			kind: "tool-provider-run-admission" as const,
			admissionId: "admission",
			proposalId: "proposal",
			runId: "candidate:run",
			adapterInputId: "input",
			requestId: "candidate:request",
			operationId: "operation",
			state: "admitted" as const,
			decisionId: "decision",
			approvedRunId: "approved:run",
			sourceRefs: [{ kind: "decision", id: "decision" }],
			metadata: { approvalMode: "require", occurredAtMs: 100 },
		};
		const recordedAdmission = {
			kind: "shared-control-panel-recorded-admission" as const,
			tenantId: "tenant",
			occurrenceId: "occurrence",
			admission,
			bodyFingerprint: sharedControlPanelAdmissionFingerprint(admission),
			recordedAtMs: 100,
		};
		const occurrence = {
			kind: "shared-control-panel-occurrence" as const,
			tenantId: "tenant",
			occurrenceId: "occurrence",
			subscriptionId: "subscription",
			subscriptionRevision: "subscription-v1",
			conditionRevision: "condition-v1",
			panelId: "panel",
			panelRevision: "panel-v1",
			dueAtMs: 100,
			claimedAtMs: 100,
			admissionFingerprint: "admission-fingerprint",
			state: "candidate-created" as const,
			reason: "candidate-created",
			candidate: {
				kind: "shared-control-panel-run-candidate" as const,
				occurrenceId: "occurrence",
				createdAtMs: 100,
				request: {
					kind: "tool-provider-adapter-run-requested" as const,
					runId: "candidate:run",
					adapterInputId: "input",
					requestId: "candidate:request",
					operationId: "operation",
					attempt: 1,
					reason: "initial" as const,
					metadata: {
						executionEnvironmentId: "environment",
						executionEnvironmentRevision: "environment-v1",
						executionEnvironmentLocality: "local",
						executionEnvironmentBindingKind: "local-host-process",
						executionSessionEpoch: "session:1",
					},
				},
			},
			completed: null,
			evaluation: null,
		};
		const sql = new ScriptedSql([
			{ rowCount: 1, rows: [{ body: recordedAdmission }] },
			{ rowCount: 1, rows: [{ body: occurrence }] },
		]);
		const authority = {
			lookup: async () => ({
				runId: "approved:run",
				attempt: 1,
				outcomeId: "authoritative-outcome",
				terminalHighWater: 7,
				outcomeEvidenceFingerprint: "authoritative-evidence",
				evidenceRefs: [{ kind: "executor-outcome", id: "authoritative-outcome" }],
			}),
		};
		const result = await postgresql16SharedControlPanelStore(
			sql,
			{ now: () => 100 },
			authority,
			noSubscriptionBindingAuthority,
		).recordTerminalOutcome({
			kind: "shared-control-panel-recorded-terminal-outcome",
			tenantId: "tenant",
			occurrenceId: "occurrence",
			runId: "approved:run",
			attempt: 1,
			outcomeId: "forged-outcome",
			terminalHighWater: 7,
			outcomeEvidenceFingerprint: "forged-evidence",
			evidenceRefs: [{ kind: "executor-outcome", id: "forged-outcome" }],
			recordedAtMs: 100,
		});
		expect(result).toMatchObject({ accepted: false, code: "terminal-outcome-expected-mismatch" });
		expect(
			sql.calls.some(
				(call) => call.text.includes("INSERT INTO") && call.text.includes("terminal_outcomes"),
			),
		).toBe(false);
	});

	it("materializes a delivery from the exact stored alert schema", async () => {
		const truth = {
			kind: "shared-control-panel-current-truth" as const,
			pins,
			subjectId: "viewer",
			grantId: "grant",
			capability: "view" as const,
			capabilityRevision: "cap-v1",
			currentPolicyRevision: "policy-v1",
			currentRedactionRevision: "redaction-v1",
			actorSessionRevision: "session-v1",
			observedAtMs: 200,
		};
		const alert = {
			kind: "shared-control-panel-alert" as const,
			alertId: "alert",
			tenantId: "tenant",
			occurrenceId: "occurrence",
			subscriptionId: "subscription",
			subscriptionRevision: "subscription-v1",
			conditionRevision: "condition-v1",
			panelId: "panel",
			panelRevision: "panel-v1",
			condition: "stale" as const,
			evidenceFingerprint: "evidence",
			evidenceRefs: [{ kind: "outcome", id: "outcome" }],
			createdAtMs: 190,
		};
		const delivery = {
			kind: "shared-control-panel-inbox-delivery" as const,
			deliveryId: "delivery",
			tenantId: "tenant",
			alertId: "alert",
			recipientId: "viewer",
			redactionRevision: "redaction-v1",
			state: "pending" as const,
			createdAtMs: 200,
			deliveredAtMs: null,
			terminalAtMs: null,
		};
		const sql = new ScriptedSql([
			{
				rowCount: 1,
				rows: [{ grant_body: grant, panel_body: revision, truth_body: canonicalTruth }],
			},
			{ rowCount: 1, rows: [{ body: alert }] },
			{ rowCount: 1, rows: [] },
			{ rowCount: 1, rows: [] },
		]);
		expect(
			await postgresql16SharedControlPanelStore(
				sql,
				{ now: () => 200 },
				noOutcomeAuthority,
				noSubscriptionBindingAuthority,
			).createDelivery(delivery, truth),
		).toMatchObject({ accepted: true, code: "delivery-created" });
		const hostileSql = new ScriptedSql([]);
		await expect(
			postgresql16SharedControlPanelStore(
				hostileSql,
				{ now: () => 200 },
				noOutcomeAuthority,
				noSubscriptionBindingAuthority,
			).createDelivery({ ...delivery, deliveredAtMs: 199 }, truth),
		).rejects.toThrow("invalid-delivery-timestamps");
		expect(hostileSql.calls).toHaveLength(0);
	});

	it("rejects accessor-hostile material before SQL", async () => {
		const hostile = { ...revision } as SharedControlPanelRevision;
		Object.defineProperty(hostile, "title", { enumerable: true, get: () => "leak" });
		const sql = new ScriptedSql([]);
		await expect(store(sql).createRevision(hostile, "key")).rejects.toThrow(
			"accessor-shared-control-panel-material",
		);
		expect(sql.calls).toHaveLength(0);
		const sparseFrames = new Array<(typeof revision.frames)[number]>(1);
		const sparseSql = new ScriptedSql([]);
		await expect(
			store(sparseSql).createRevision({ ...revision, frames: sparseFrames }, "sparse"),
		).rejects.toThrow("sparse-frames");
		expect(sparseSql.calls).toHaveLength(0);
		const privateSql = new ScriptedSql([]);
		await expect(
			store(privateSql).createRevision(
				{
					...revision,
					frames: [
						{ ...revision.frames[0]!, apiKey: "secret" } as (typeof revision.frames)[number],
					],
				},
				"private",
			),
		).rejects.toThrow("unknown-shared-control-panel-field:apiKey");
		expect(privateSql.calls).toHaveLength(0);
	});
});
