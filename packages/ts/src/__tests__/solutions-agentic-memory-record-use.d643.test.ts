import { describe, expect, expectTypeOf, it } from "vitest";
import { graph } from "../graph/graph.js";
import * as packageRoot from "../index.js";
import { strictCanonicalJsonBytes } from "../json/codec.js";
import type { Node } from "../node/node.js";
import type { MemoryAnswer, MemoryFragment } from "../patterns/semantic-memory.js";
import type { Message } from "../protocol/messages.js";
import * as focusedAgenticMemory from "../solutions/agentic-memory/index.js";
import {
	AGENTIC_MEMORY_RECORD_USE_V1_LIMITS,
	type AgenticMemoryBundle,
	type AgenticMemoryRecord,
	type AgenticMemoryRecordUseDecision,
	type AgenticMemoryRecordUseGateBundle,
	type AgenticMemoryRecordUseRequest,
	type AgenticMemoryRecordUseSnapshot,
	agenticMemoryBundle,
	agenticMemoryRecordUseDecisionCoordinate,
	agenticMemoryRecordUseGateBundle,
	agenticMemoryRecordUseRecordIdentity,
	agenticMemoryRecordUseRequestIdentity,
	assertAgenticMemoryRecordUseDecision,
	assertAgenticMemoryRecordUseRequest,
	createAgenticMemoryRecordUseDecision,
	projectAgenticMemoryRecordUseGate,
	type StrictJsonValue,
} from "../solutions/agentic-memory/index.js";
import * as solutionsAggregate from "../solutions/index.js";

const decoder = new TextDecoder();

function fragment<TJson extends StrictJsonValue>(
	payload: TJson,
	patch: Partial<MemoryFragment<TJson>> = {},
): MemoryFragment<TJson> {
	return {
		id: "fragment-1",
		payload,
		tNs: 10n,
		confidence: 0.8,
		tags: ["memory", "relevant"],
		sources: ["derived-source"],
		...patch,
	};
}

function record<TJson extends StrictJsonValue = string>(
	payload: TJson = "private-marker" as TJson,
	patch: Partial<AgenticMemoryRecord<TJson>> = {},
): AgenticMemoryRecord<TJson> {
	return {
		id: "record-1",
		kind: "semantic",
		persistenceLevel: "project",
		artifactKind: "insight",
		scope: { projectId: "project-1" },
		fragment: fragment(payload),
		...patch,
	};
}

function request(
	patch: Partial<AgenticMemoryRecordUseRequest> = {},
): AgenticMemoryRecordUseRequest {
	return {
		format: "graphrefly.agenticMemoryRecordUseRequest",
		version: 1,
		requestId: "request-1",
		subject: { kind: "actor", id: "subject-1" },
		purpose: { kind: "purpose", id: "assist" },
		scope: { kind: "workspace", id: "workspace-1" },
		sourceRevisions: [{ kind: "sqlite-domain", id: "domain-1", revision: "rev-1" }],
		policyCoordinates: [{ kind: "use-policy", id: "policy-1", revision: "policy-rev-1" }],
		authorityCoordinates: [
			{ kind: "application-authority", id: "authority-1", revision: "authority-rev-1" },
		],
		...patch,
	};
}

function decision<TJson extends StrictJsonValue>(
	useRequest: AgenticMemoryRecordUseRequest,
	currentRecord: AgenticMemoryRecord<TJson>,
	state: "allowed" | "denied" = "allowed",
	decisionId = "decision-1",
): AgenticMemoryRecordUseDecision {
	return createAgenticMemoryRecordUseDecision(useRequest, currentRecord, {
		decisionId,
		state,
	});
}

function collect<T>(node: Node<T>): {
	readonly values: T[];
	readonly unsubscribe: () => void;
} {
	const values: T[] = [];
	const unsubscribe = node.subscribe((messages: Message) => {
		if (messages[0] === "DATA") values.push(messages[1] as T);
	});
	return { values, unsubscribe };
}

function canonicalText(value: unknown): string {
	return decoder.decode(strictCanonicalJsonBytes(value));
}

describe("AgenticMemory D643 record-use identity and strict data", () => {
	it("exports the focused API only through the existing agentic-memory subpath", () => {
		expect(focusedAgenticMemory.agenticMemoryRecordUseGateBundle).toBe(
			agenticMemoryRecordUseGateBundle,
		);
		expect("agenticMemoryRecordUseGateBundle" in packageRoot).toBe(false);
		expect("agenticMemoryRecordUseGateBundle" in solutionsAggregate).toBe(false);
	});

	it("builds deterministic complete request/record identities without handwritten encoding", () => {
		const currentRequest = request({
			sourceRevisions: [
				{ kind: "source", id: "b", revision: "2" },
				{ kind: "source", id: "a", revision: "1" },
			],
		});
		const reordered = request({
			sourceRevisions: [
				{ kind: "source", id: "a", revision: "1" },
				{ kind: "source", id: "b", revision: "2" },
			],
		});
		const currentRecord = record({ nested: ["secret", 1, true] });
		const requestIdentity = agenticMemoryRecordUseRequestIdentity(currentRequest);
		const recordIdentity = agenticMemoryRecordUseRecordIdentity(currentRecord);
		const externalDecision = decision(currentRequest, currentRecord);

		expect(requestIdentity).toEqual(agenticMemoryRecordUseRequestIdentity(reordered));
		expect(recordIdentity).toEqual(agenticMemoryRecordUseRecordIdentity(currentRecord));
		expect(agenticMemoryRecordUseDecisionCoordinate(currentRequest, currentRecord)).toBe(
			agenticMemoryRecordUseDecisionCoordinate(reordered, currentRecord),
		);
		expect(assertAgenticMemoryRecordUseDecision(externalDecision)).toEqual(externalDecision);
		expect(assertAgenticMemoryRecordUseRequest(JSON.parse(JSON.stringify(currentRequest)))).toEqual(
			assertAgenticMemoryRecordUseRequest(currentRequest),
		);
		expect(canonicalText(JSON.parse(requestIdentity.key))).toBe(requestIdentity.key);
		expect(canonicalText(JSON.parse(recordIdentity.key))).toBe(recordIdentity.key);
	});

	it("changes currentness when any authority-relevant request coordinate changes", () => {
		const currentRecord = record();
		const originalRequest = request();
		const originalDecision = decision(originalRequest, currentRecord);
		const changedRequests = [
			request({ subject: { kind: "actor", id: "subject-2" } }),
			request({ purpose: { kind: "purpose", id: "different-purpose" } }),
			request({ scope: { kind: "workspace", id: "workspace-2" } }),
			request({
				sourceRevisions: [{ kind: "sqlite-domain", id: "domain-1", revision: "rev-2" }],
			}),
			request({
				policyCoordinates: [{ kind: "use-policy", id: "policy-1", revision: "policy-rev-2" }],
			}),
			request({
				authorityCoordinates: [
					{
						kind: "application-authority",
						id: "authority-1",
						revision: "authority-rev-2",
					},
				],
			}),
		];

		for (const changed of changedRequests) {
			expect(changed.requestId).toBe(originalRequest.requestId);
			expect(agenticMemoryRecordUseRequestIdentity(changed)).not.toEqual(
				agenticMemoryRecordUseRequestIdentity(originalRequest),
			);
			const snapshot = projectAgenticMemoryRecordUseGate([currentRecord], changed, [
				originalDecision,
			]);
			expect(snapshot.allowedRecords).toEqual([]);
			expect(snapshot.status.state).toBe("invalid");
			expect(snapshot.exclusions).toEqual(
				expect.arrayContaining([expect.objectContaining({ reason: "request-mismatch" })]),
			);
		}
	});

	it("rejects unknown fields, runtime-shaped values, functions, BigInt payloads, and accessors", () => {
		const currentRequest = request();
		const currentRecord = record();
		const validDecision = decision(currentRequest, currentRecord);
		const getterRequest = { ...currentRequest } as Record<string, unknown>;
		Object.defineProperty(getterRequest, "subject", {
			enumerable: true,
			get() {
				throw new Error("secret getter message");
			},
		});

		expect(() =>
			assertAgenticMemoryRecordUseRequest({ ...currentRequest, runtimeHandle: "not-data" }),
		).toThrow(/unexpected/);
		expect(() =>
			assertAgenticMemoryRecordUseRequest({
				...currentRequest,
				subject: { kind: "actor", id: () => "subject" },
			}),
		).toThrow();
		expect(() =>
			assertAgenticMemoryRecordUseRequest({
				...currentRequest,
				sourceRevisions: [{ kind: "source", id: "id", revision: 1n }],
			}),
		).toThrow();
		expect(() => assertAgenticMemoryRecordUseRequest(getterRequest)).toThrow(/plain data object/);
		expect(() => assertAgenticMemoryRecordUseDecision({ ...validDecision, confidence: 1 })).toThrow(
			/unexpected/,
		);
		expect(
			projectAgenticMemoryRecordUseGate(
				[{ ...currentRecord, providerHandle: "forbidden" }],
				currentRequest,
				[validDecision],
			).status.state,
		).toBe("invalid");
		expect(
			projectAgenticMemoryRecordUseGate([record({ invalid: 1n } as never)], currentRequest, [])
				.status.state,
		).toBe("invalid");
	});

	it("rejects record accessors without executing them", () => {
		let getterRuns = 0;
		const recordAccessor = record();
		Object.defineProperty(recordAccessor, "id", {
			enumerable: true,
			get() {
				getterRuns += 1;
				return "record-1";
			},
		});
		const fragmentAccessor = record();
		Object.defineProperty(fragmentAccessor.fragment, "payload", {
			enumerable: true,
			get() {
				getterRuns += 1;
				return "private-getter-material";
			},
		});

		for (const hostile of [recordAccessor, fragmentAccessor]) {
			const snapshot = projectAgenticMemoryRecordUseGate([hostile], request(), []);
			expect(snapshot.allowedRecords).toEqual([]);
			expect(snapshot.status.state).toBe("invalid");
			expect(snapshot.issues).toEqual(
				expect.arrayContaining([expect.objectContaining({ code: "invalid-record" })]),
			);
		}
		expect(getterRuns).toBe(0);
	});

	it("normalizes invalid Proxy array lengths into strict invalid-input DATA", () => {
		for (const hostileLength of [-1, -0, 0.5, "1", Number.NaN]) {
			const hostileRecords = new Proxy([], {
				get(target, property, receiver) {
					if (property === "length") return hostileLength;
					return Reflect.get(target, property, receiver);
				},
			});
			const snapshot = projectAgenticMemoryRecordUseGate(hostileRecords, request(), []);

			expect(snapshot.allowedRecords).toEqual([]);
			expect(snapshot.status.state).toBe("invalid");
			expect(snapshot.issues).toEqual(
				expect.arrayContaining([expect.objectContaining({ code: "invalid-input" })]),
			);
			expect(snapshot.cursor.inputRecords).toBe(0);
			expect(() => canonicalText(snapshot)).not.toThrow();
		}
	});

	it("rejects hostile lengths before revision coordinates can disappear from currentness", () => {
		for (const field of ["sourceRevisions", "policyCoordinates", "authorityCoordinates"] as const) {
			let ownKeysCalls = 0;
			const hiddenCoordinate = new Proxy(
				[{ kind: "authority", id: field, revision: "current-revision" }],
				{
					get(target, property, receiver) {
						if (property === "length") return -0;
						return Reflect.get(target, property, receiver);
					},
					ownKeys() {
						ownKeysCalls += 1;
						throw new Error("invalid coordinate length must short-circuit");
					},
				},
			);
			const hostileRequest = request({ [field]: hiddenCoordinate });

			expect(() => agenticMemoryRecordUseRequestIdentity(hostileRequest)).toThrow(
				/length is not canonical/,
			);
			expect(projectAgenticMemoryRecordUseGate([record()], hostileRequest, []).issues).toEqual(
				expect.arrayContaining([expect.objectContaining({ code: "invalid-request" })]),
			);
			expect(ownKeysCalls).toBe(0);
		}
	});

	it("short-circuits count overflow before whole-container enumeration", () => {
		let ownKeysCalls = 0;
		const overflowRecords = new Proxy(new Array(AGENTIC_MEMORY_RECORD_USE_V1_LIMITS.records + 1), {
			ownKeys() {
				ownKeysCalls += 1;
				throw new Error("overflow input must not be enumerated");
			},
		});
		const snapshot = projectAgenticMemoryRecordUseGate(overflowRecords, request(), []);

		expect(ownKeysCalls).toBe(0);
		expect(snapshot.allowedRecords).toEqual([]);
		expect(snapshot.status.state).toBe("invalid");
		expect(snapshot.issues).toEqual(
			expect.arrayContaining([expect.objectContaining({ code: "input-overflow" })]),
		);
		expect(snapshot.cursor.unevaluatedRecords).toBe(
			AGENTIC_MEMORY_RECORD_USE_V1_LIMITS.records + 1,
		);
	});
});

describe("AgenticMemory D643 exact-one cardinality and status", () => {
	it("allows one exact valid decision and returns a deeply immutable canonical snapshot", () => {
		const mutablePayload = { nested: { value: "before" }, tags: ["x"] };
		const currentRecord = record(mutablePayload);
		const currentRequest = request();
		const snapshot = projectAgenticMemoryRecordUseGate([currentRecord], currentRequest, [
			decision(currentRequest, currentRecord),
		]);
		mutablePayload.nested.value = "after";
		mutablePayload.tags.push("mutated");

		expect(snapshot).toMatchObject({
			format: "graphrefly.agenticMemoryRecordUseSnapshot",
			version: 1,
			status: {
				kind: "agentic-memory-record-use-status",
				version: 1,
				state: "ready",
				evaluated: true,
			},
		});
		expect(snapshot.allowedRecords).toHaveLength(1);
		expect(snapshot.allowedRecords[0]?.fragment.payload).toEqual({
			nested: { value: "before" },
			tags: ["x"],
		});
		expect(Object.isFrozen(snapshot)).toBe(true);
		expect(Object.isFrozen(snapshot.allowedRecords)).toBe(true);
		expect(Object.isFrozen(snapshot.allowedRecords[0]?.fragment.payload)).toBe(true);
		expect(snapshot.cursor).toMatchObject({
			inputRecords: 1,
			validRecords: 1,
			invalidRecords: 0,
			inputDecisions: 1,
			validDecisions: 1,
			invalidDecisions: 0,
			allowedRecords: 1,
			deniedRecords: 0,
			excludedRecords: 0,
		});
	});

	it("treats one exact denial as a ready evaluation, not a gate implementation error", () => {
		const currentRecord = record();
		const currentRequest = request();
		const snapshot = projectAgenticMemoryRecordUseGate([currentRecord], currentRequest, [
			decision(currentRequest, currentRecord, "denied"),
		]);

		expect(snapshot.allowedRecords).toEqual([]);
		expect(snapshot.status.state).toBe("ready");
		expect(snapshot.issues).toEqual([]);
		expect(snapshot.exclusions).toEqual([
			{
				kind: "agentic-memory-record-use-exclusion",
				version: 1,
				reason: "denied",
			},
		]);
		expect(snapshot.cursor).toMatchObject({
			allowedRecords: 0,
			deniedRecords: 1,
			excludedRecords: 1,
		});
	});

	it("fails closed for missing, identical duplicate, conflicting, and orphan decisions", () => {
		const currentRecord = record();
		const currentRequest = request();
		const allow = decision(currentRequest, currentRecord);
		const cases = [
			{ decisions: [], reason: "missing-decision" },
			{ decisions: [allow, allow], reason: "duplicate-decision" },
			{
				decisions: [allow, decision(currentRequest, currentRecord, "denied", "decision-2")],
				reason: "ambiguous-decision",
			},
			{
				decisions: [
					allow,
					decision(
						currentRequest,
						record("orphan", {
							id: "record-that-is-not-current",
							fragment: fragment("orphan", { id: "orphan-fragment" }),
						}),
						"allowed",
						"orphan",
					),
				],
				reason: "orphan-decision",
			},
		] as const;

		for (const current of cases) {
			const snapshot = projectAgenticMemoryRecordUseGate(
				[currentRecord],
				currentRequest,
				current.decisions,
			);
			expect(snapshot.allowedRecords).toEqual([]);
			expect(snapshot.status.state).toBe("invalid");
			expect(snapshot.exclusions).toEqual(
				expect.arrayContaining([expect.objectContaining({ reason: current.reason })]),
			);
		}
	});

	it("does not let a malformed duplicate claimant disappear through validation", () => {
		const currentRecord = record();
		const currentRequest = request();
		const allow = decision(currentRequest, currentRecord);
		const malformedDuplicate = { ...allow, modelAllowed: true };
		const snapshot = projectAgenticMemoryRecordUseGate([currentRecord], currentRequest, [
			allow,
			malformedDuplicate,
		]);

		expect(snapshot.allowedRecords).toEqual([]);
		expect(snapshot.status.state).toBe("invalid");
		expect(snapshot.cursor.invalidDecisions).toBe(1);
		expect(snapshot.exclusions).toEqual(
			expect.arrayContaining([expect.objectContaining({ reason: "invalid-decision" })]),
		);
	});

	it("does not let an exact allow mask an additional mismatched or stale claimant", () => {
		const currentRecord = record("current");
		const currentRequest = request();
		const exactAllow = decision(currentRequest, currentRecord);
		const oldRequest = request({
			purpose: { kind: "purpose", id: "old-purpose" },
		});
		const staleRecord = record("stale", {
			fragment: fragment("stale", { id: currentRecord.fragment.id }),
		});
		const cases = [
			{
				decisions: [exactAllow, decision(oldRequest, currentRecord, "allowed", "old-request")],
				reason: "request-mismatch",
			},
			{
				decisions: [exactAllow, decision(currentRequest, staleRecord, "allowed", "stale-record")],
				reason: "stale-record",
			},
		] as const;

		for (const current of cases) {
			const snapshot = projectAgenticMemoryRecordUseGate(
				[currentRecord],
				currentRequest,
				current.decisions,
			);
			expect(snapshot.allowedRecords).toEqual([]);
			expect(snapshot.status.state).toBe("invalid");
			expect(snapshot.exclusions).toEqual(
				expect.arrayContaining([expect.objectContaining({ reason: current.reason })]),
			);
		}
	});

	it("counts a withheld exact allow separately from the root invalid reason", () => {
		const allowedRecord = record("allowed", {
			id: "record-a",
			fragment: fragment("allowed", { id: "fragment-a" }),
		});
		const missingRecord = record("missing", {
			id: "record-b",
			fragment: fragment("missing", { id: "fragment-b" }),
		});
		const currentRequest = request();
		const snapshot = projectAgenticMemoryRecordUseGate(
			[allowedRecord, missingRecord],
			currentRequest,
			[decision(currentRequest, allowedRecord)],
		);

		expect(snapshot.allowedRecords).toEqual([]);
		expect(snapshot.cursor.reasonCounts["missing-decision"]).toBe(1);
		expect(snapshot.cursor.reasonCounts["evaluation-invalid"]).toBe(1);
		expect(snapshot.exclusions).toEqual(
			expect.arrayContaining([
				expect.objectContaining({ reason: "evaluation-invalid" }),
				expect.objectContaining({ reason: "missing-decision" }),
			]),
		);
	});

	it("fails closed when a record id is reused with changed canonical material", () => {
		const original = record("original-private-material");
		const changedRecords = [
			record("changed-private-material"),
			record("original-private-material", {
				scope: { projectId: "project-2" },
			}),
			record("original-private-material", {
				fragment: fragment("original-private-material", {
					confidence: 0.99,
					tags: ["changed"],
					sources: ["changed-source"],
				}),
			}),
		];
		const currentRequest = request();
		const oldDecision = decision(currentRequest, original);

		for (const changed of changedRecords) {
			expect(changed.id).toBe(original.id);
			expect(agenticMemoryRecordUseRecordIdentity(changed)).not.toEqual(
				agenticMemoryRecordUseRecordIdentity(original),
			);
			const snapshot = projectAgenticMemoryRecordUseGate([changed], currentRequest, [oldDecision]);
			expect(snapshot.allowedRecords).toEqual([]);
			expect(snapshot.exclusions).toEqual(
				expect.arrayContaining([expect.objectContaining({ reason: "stale-record" })]),
			);
		}
	});

	it("fails closed for duplicate current record occurrences", () => {
		const currentRecord = record();
		const currentRequest = request();
		const snapshot = projectAgenticMemoryRecordUseGate(
			[currentRecord, currentRecord],
			currentRequest,
			[decision(currentRequest, currentRecord)],
		);

		expect(snapshot.allowedRecords).toEqual([]);
		expect(snapshot.status.state).toBe("invalid");
		expect(snapshot.cursor).toMatchObject({
			inputRecords: 2,
			validRecords: 2,
			invalidRecords: 0,
			excludedRecords: 2,
		});
		expect(snapshot.cursor.reasonCounts["duplicate-record"]).toBe(2);
	});

	it("does not allow similarity, confidence, tags, ranking, or model-shaped data to widen", () => {
		const currentRecord = record("highly relevant", {
			fragment: fragment("highly relevant", {
				confidence: 1,
				tags: ["perfect-match", "model-approved"],
				embedding: [1, 0],
			}),
		});
		const currentRequest = request();
		const modelShaped = {
			...decision(currentRequest, currentRecord),
			similarity: 1,
			rank: 1,
			modelAllowed: true,
		};
		const snapshot = projectAgenticMemoryRecordUseGate([currentRecord], currentRequest, [
			modelShaped,
		]);

		expect(snapshot.allowedRecords).toEqual([]);
		expect(snapshot.status.state).toBe("invalid");
		expect(snapshot.cursor.invalidDecisions).toBe(1);
	});

	it("bounds diagnostics while preserving untruncated totals and deterministic output", () => {
		const currentRequest = request();
		const overflowRecords = Array.from(
			{ length: AGENTIC_MEMORY_RECORD_USE_V1_LIMITS.records + 1 },
			(_, index) =>
				record(`payload-${index}`, {
					id: `record-${index}`,
					fragment: fragment(`payload-${index}`, { id: `fragment-${index}` }),
				}),
		);
		const first = projectAgenticMemoryRecordUseGate(overflowRecords, currentRequest, []);
		const second = projectAgenticMemoryRecordUseGate(
			[...overflowRecords].reverse(),
			currentRequest,
			[],
		);

		expect(first.allowedRecords).toEqual([]);
		expect(first.cursor.exclusions).toMatchObject({
			total: overflowRecords.length,
			emitted: AGENTIC_MEMORY_RECORD_USE_V1_LIMITS.exclusions,
			truncated: true,
		});
		expect(first.cursor.audit).toMatchObject({
			total: overflowRecords.length,
			emitted: AGENTIC_MEMORY_RECORD_USE_V1_LIMITS.audit,
			truncated: true,
		});
		expect(first.cursor).toMatchObject({
			validRecords: 0,
			invalidRecords: 0,
			unevaluatedRecords: overflowRecords.length,
			validDecisions: 0,
			invalidDecisions: 0,
			unevaluatedDecisions: 0,
		});
		expect(first.exclusions).toHaveLength(AGENTIC_MEMORY_RECORD_USE_V1_LIMITS.exclusions);
		expect(first.audit).toHaveLength(AGENTIC_MEMORY_RECORD_USE_V1_LIMITS.audit);
		expect(canonicalText(first)).toBe(canonicalText(second));
	});

	it("bounds exclusions, issues, and audit independently after counting all malformed decisions", () => {
		const currentRecord = record();
		const currentRequest = request();
		const base = decision(currentRequest, currentRecord);
		const malformed = Array.from({ length: 200 }, (_, index) => ({
			...base,
			decisionId: `malformed-${index}`,
			modelOutput: true,
		}));
		const snapshot = projectAgenticMemoryRecordUseGate([currentRecord], currentRequest, malformed);

		expect(snapshot.allowedRecords).toEqual([]);
		expect(snapshot.cursor.issues).toMatchObject({
			total: 200,
			emitted: AGENTIC_MEMORY_RECORD_USE_V1_LIMITS.issues,
			truncated: true,
		});
		expect(snapshot.cursor.exclusions.total).toBe(201);
		expect(snapshot.cursor.exclusions.emitted).toBe(AGENTIC_MEMORY_RECORD_USE_V1_LIMITS.exclusions);
		expect(snapshot.cursor.exclusions.truncated).toBe(true);
		expect(snapshot.cursor.audit).toMatchObject({
			total: 201,
			emitted: AGENTIC_MEMORY_RECORD_USE_V1_LIMITS.audit,
			truncated: true,
		});
		expect(snapshot.cursor.validDecisions + snapshot.cursor.invalidDecisions).toBe(
			snapshot.cursor.inputDecisions,
		);
		expect(snapshot.cursor.allowedRecords + snapshot.cursor.excludedRecords).toBe(
			snapshot.cursor.inputRecords,
		);
	});

	it("never leaks canonical identity keys, record material, or thrown getter text in diagnostics", () => {
		const marker = "PRIVATE-MATERIAL-MUST-NOT-LEAK";
		const currentRecord = record(marker);
		const currentRequest = request();
		const requestIdentity = agenticMemoryRecordUseRequestIdentity(currentRequest);
		const recordIdentity = agenticMemoryRecordUseRecordIdentity(currentRecord);
		const hostileDecision = decision(currentRequest, currentRecord, "denied", recordIdentity.key);
		const snapshot = projectAgenticMemoryRecordUseGate([currentRecord], currentRequest, [
			hostileDecision,
		]);
		const malformedRecordSnapshot = projectAgenticMemoryRecordUseGate(
			[{ ...currentRecord, id: marker, providerHandle: "forbidden" }],
			currentRequest,
			[],
		);
		const diagnostics = JSON.stringify({
			exclusions: snapshot.exclusions,
			issues: snapshot.issues,
			audit: snapshot.audit,
			malformedRecordExclusions: malformedRecordSnapshot.exclusions,
			malformedRecordIssues: malformedRecordSnapshot.issues,
			malformedRecordAudit: malformedRecordSnapshot.audit,
		});

		expect(snapshot.status.state).toBe("ready");
		expect(malformedRecordSnapshot.status.state).toBe("invalid");
		expect(diagnostics).not.toContain(marker);
		expect(diagnostics).not.toContain(requestIdentity.key);
		expect(diagnostics).not.toContain(recordIdentity.key);
		expect(diagnostics).not.toContain("fragment-1");
		expect(diagnostics).not.toContain("derived-source");
	});

	it("turns hostile or revoked array inputs into bounded pure-DATA invalid snapshots", () => {
		const currentRequest = request();
		const trapText = "HOSTILE-ARRAY-TRAP-MUST-NOT-LEAK";
		const hostileRecords = new Proxy([record()], {
			get(target, property, receiver) {
				if (property === "0") throw new Error(trapText);
				return Reflect.get(target, property, receiver);
			},
		});
		const revokedRecords = Proxy.revocable([record()], {});
		const revokedDecisions = Proxy.revocable<readonly AgenticMemoryRecordUseDecision[]>([], {});
		revokedRecords.revoke();
		revokedDecisions.revoke();
		const snapshots = [
			projectAgenticMemoryRecordUseGate(hostileRecords, currentRequest, []),
			projectAgenticMemoryRecordUseGate(revokedRecords.proxy, currentRequest, []),
			projectAgenticMemoryRecordUseGate([], currentRequest, revokedDecisions.proxy),
		];

		for (const snapshot of snapshots) {
			expect(snapshot.allowedRecords).toEqual([]);
			expect(snapshot.status.state).toBe("invalid");
			expect(snapshot.issues).toEqual(
				expect.arrayContaining([expect.objectContaining({ code: "invalid-input" })]),
			);
			expect(JSON.stringify(snapshot)).not.toContain(trapText);
		}
	});
});

describe("AgenticMemory D643 graph topology and consumer fixtures", () => {
	it("revokes cached allowed records when any declared dependency errors", () => {
		for (const target of ["records", "request", "decisions"] as const) {
			const g = graph();
			const currentRecord = record(`allowed-before-${target}-error`);
			const currentRequest = request({ requestId: `${target}-error-use` });
			const records = g.state<readonly AgenticMemoryRecord<string>[]>([currentRecord], {
				name: `${target}-error/records`,
			});
			const useRequest = g.state(currentRequest, {
				name: `${target}-error/request`,
			});
			const decisions = g.state<readonly AgenticMemoryRecordUseDecision[]>(
				[decision(currentRequest, currentRecord)],
				{ name: `${target}-error/decisions` },
			);
			const gate = agenticMemoryRecordUseGateBundle(g, {
				name: `${target}-error/gate`,
				records,
				request: useRequest,
				decisions,
			});
			const governed = agenticMemoryBundle(g, {
				name: `${target}-error/governed`,
				records: gate.allowedRecords,
				query: g.state({ tags: ["relevant"] }, { name: `${target}-error/query` }),
			});
			const snapshots = collect(gate.snapshot);
			const ranked = collect(governed.ranked);

			expect(snapshots.values.at(-1)?.allowedRecords).toHaveLength(1);
			expect(ranked.values.at(-1)?.results).toHaveLength(1);
			const dependencyError = new Error(`private-${target}-dependency-error`);
			if (target === "records") records.down([["ERROR", dependencyError]]);
			else if (target === "request") useRequest.down([["ERROR", dependencyError]]);
			else decisions.down([["ERROR", dependencyError]]);

			expect(snapshots.values.at(-1)?.allowedRecords).toEqual([]);
			expect(snapshots.values.at(-1)?.status.state).toBe("invalid");
			expect(snapshots.values.at(-1)?.issues).toEqual(
				expect.arrayContaining([expect.objectContaining({ code: "invalid-input" })]),
			);
			expect(ranked.values.at(-1)?.results).toEqual([]);
			expect(JSON.stringify(snapshots.values.at(-1))).not.toContain(dependencyError.message);
			const failedEvaluation = snapshots.values.at(-1)?.cursor.evaluation ?? 0;
			if (target === "request") {
				decisions.set([decision(currentRequest, currentRecord)]);
			} else {
				useRequest.set(currentRequest);
			}
			expect(snapshots.values.at(-1)?.cursor.evaluation).toBeGreaterThan(failedEvaluation);
			expect(snapshots.values.at(-1)?.allowedRecords).toEqual([]);
			expect(snapshots.values.at(-1)?.status.state).toBe("invalid");
			expect(ranked.values.at(-1)?.results).toEqual([]);
			snapshots.unsubscribe();
			ranked.unsubscribe();
		}
	});

	it("uses one snapshot and declared projections with no raw-record governed retrieval bypass", () => {
		const g = graph();
		const currentRecord = record("governed");
		const currentRequest = request();
		const rawRecords = g.state<readonly AgenticMemoryRecord<string>[]>([currentRecord], {
			name: "raw-records",
		});
		const useRequest = g.state(currentRequest, { name: "use-request" });
		const decisions = g.state<readonly AgenticMemoryRecordUseDecision[]>(
			[decision(currentRequest, currentRecord)],
			{ name: "use-decisions" },
		);
		const gate = agenticMemoryRecordUseGateBundle(g, {
			name: "use-gate",
			records: rawRecords,
			request: useRequest,
			decisions,
		});
		const query = g.state({ tags: ["relevant"] }, { name: "governed-query" });
		const governed = agenticMemoryBundle(g, {
			name: "governed-memory",
			records: gate.allowedRecords,
			query,
		});
		const snapshots = collect(gate.snapshot);
		const allowed = collect(gate.allowedRecords);

		expectTypeOf(gate).toMatchTypeOf<AgenticMemoryRecordUseGateBundle<string>>();
		expectTypeOf(governed).toMatchTypeOf<AgenticMemoryBundle<string>>();
		expect(allowed.values.at(-1)).toBe(snapshots.values.at(-1)?.allowedRecords);
		const topology = g.describe();
		expect(topology.nodes).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					id: "use-gate/snapshot",
					factory: "agenticMemoryRecordUseGate",
				}),
				expect.objectContaining({
					id: "use-gate/allowedRecords",
					factory: "agenticMemoryRecordUseAllowedRecords",
				}),
			]),
		);
		expect(topology.edges).toEqual(
			expect.arrayContaining([
				{ from: "raw-records", to: "use-gate/snapshot" },
				{ from: "use-request", to: "use-gate/snapshot" },
				{ from: "use-decisions", to: "use-gate/snapshot" },
				{ from: "use-gate/snapshot", to: "use-gate/allowedRecords" },
				{ from: "use-gate/allowedRecords", to: "governed-memory/projection" },
				{
					from: "governed-memory/fragments",
					to: "governed-memory/retrieval/snapshot",
				},
			]),
		);
		expect(topology.edges).not.toContainEqual({
			from: "raw-records",
			to: "governed-memory/projection",
		});
		expect(topology.edges).not.toContainEqual({
			from: "raw-records",
			to: "governed-memory/retrieval/snapshot",
		});
		snapshots.unsubscribe();
		allowed.unsubscribe();
	});

	it("keeps two explicit use gates independent for the same record", () => {
		const g = graph();
		const currentRecord = record("same-record");
		const allowRequest = request({ requestId: "allow-use" });
		const denyRequest = request({
			requestId: "deny-use",
			purpose: { kind: "purpose", id: "different-use" },
		});
		const rawRecords = g.state<readonly AgenticMemoryRecord<string>[]>([currentRecord], {
			name: "shared-raw-records",
		});
		const allowGate = agenticMemoryRecordUseGateBundle(g, {
			name: "allow-gate",
			records: rawRecords,
			request: g.state(allowRequest, { name: "allow-request" }),
			decisions: g.state([decision(allowRequest, currentRecord, "allowed", "allow")], {
				name: "allow-decisions",
			}),
		});
		const denyGate = agenticMemoryRecordUseGateBundle(g, {
			name: "deny-gate",
			records: rawRecords,
			request: g.state(denyRequest, { name: "deny-request" }),
			decisions: g.state([decision(denyRequest, currentRecord, "denied", "deny")], {
				name: "deny-decisions",
			}),
		});
		const allow = collect(allowGate.snapshot);
		const deny = collect(denyGate.snapshot);

		expect(allow.values.at(-1)?.allowedRecords.map((item) => item.id)).toEqual(["record-1"]);
		expect(deny.values.at(-1)?.allowedRecords).toEqual([]);
		expect(deny.values.at(-1)?.status.state).toBe("ready");
		expect(
			g.describe().nodes.filter((node) => node.factory === "agenticMemoryRecordUseGate"),
		).toEqual(
			expect.arrayContaining([
				expect.objectContaining({ id: "allow-gate/snapshot" }),
				expect.objectContaining({ id: "deny-gate/snapshot" }),
			]),
		);
		allow.unsubscribe();
		deny.unsubscribe();
	});

	it("proves an Another Hello-shaped derived/rebuildable fixture with opaque SQLite revision", () => {
		type AnotherHelloRow = {
			readonly displayName: string;
			readonly sqliteRevision: string;
		};
		const derivedRecord = (row: AnotherHelloRow): AgenticMemoryRecord<string> =>
			record(`derived greeting preference for ${row.displayName}`, {
				id: "another-hello-derived",
				scope: { userId: "local-user" },
				fragment: fragment(`derived greeting preference for ${row.displayName}`, {
					id: "another-hello-fragment",
					sources: ["another-hello-domain-projection"],
				}),
			});
		const useRequest = (revision: string): AgenticMemoryRecordUseRequest =>
			request({
				requestId: "another-hello-use",
				subject: { kind: "local-profile", id: "local-user" },
				purpose: { kind: "feature", id: "greeting-continuity" },
				scope: { kind: "application", id: "another-hello" },
				sourceRevisions: [{ kind: "sqlite-domain", id: "profile", revision }],
			});

		const g = graph();
		const initialRow = { displayName: "Ada", sqliteRevision: "sqlite-rev-1" };
		const domainRows = g.state<AnotherHelloRow>(initialRow, {
			name: "another-hello/sqlite-domain-row",
		});
		const derivedRecords = g.derived([domainRows], (row) => Object.freeze([derivedRecord(row)]), {
			name: "another-hello/derived-records",
		});
		const requestState = g.state(useRequest(initialRow.sqliteRevision), {
			name: "another-hello/use-request",
		});
		const decisions = g.state<readonly AgenticMemoryRecordUseDecision[]>(
			[
				decision(
					useRequest(initialRow.sqliteRevision),
					derivedRecord(initialRow),
					"allowed",
					"another-hello-decision",
				),
			],
			{ name: "another-hello/external-decisions" },
		);
		const gate = agenticMemoryRecordUseGateBundle(g, {
			name: "another-hello/use-gate",
			records: derivedRecords,
			request: requestState,
			decisions,
		});
		const governed = agenticMemoryBundle(g, {
			name: "another-hello/governed-memory",
			records: gate.allowedRecords,
			query: g.state({ tags: ["relevant"] }, { name: "another-hello/query" }),
		});
		const snapshots = collect(gate.snapshot);
		const ranked = collect(governed.ranked);

		expect(snapshots.values.at(-1)?.allowedRecords).toHaveLength(1);
		expect(ranked.values.at(-1)?.results).toHaveLength(1);
		requestState.set(useRequest("sqlite-rev-2"));
		expect(snapshots.values.at(-1)?.allowedRecords).toEqual([]);
		expect(snapshots.values.at(-1)?.exclusions).toEqual(
			expect.arrayContaining([expect.objectContaining({ reason: "request-mismatch" })]),
		);
		expect(g.describe().edges).toContainEqual({
			from: "another-hello/use-gate/allowedRecords",
			to: "another-hello/governed-memory/projection",
		});
		expect(g.describe().edges).not.toContainEqual({
			from: "another-hello/derived-records",
			to: "another-hello/governed-memory/projection",
		});
		snapshots.unsubscribe();
		ranked.unsubscribe();
	});

	it("makes a WorkItem scope/source-revision change stale before governed retrieval", () => {
		const workItemRecord = (workItemId: string): AgenticMemoryRecord<string> =>
			record(`rebuildable guidance for ${workItemId}`, {
				id: "work-item-memory",
				scope: { projectId: "project-1" },
				fragment: fragment(`rebuildable guidance for ${workItemId}`, {
					id: "work-item-fragment",
					sources: ["work-item-projection"],
				}),
			});
		const workItemRequest = (workItemId: string, revision: string): AgenticMemoryRecordUseRequest =>
			request({
				requestId: "work-item-use",
				subject: { kind: "work-item-agent", id: "agent-1" },
				purpose: { kind: "work-item-operation", id: "rerun-avoidance" },
				scope: { kind: "work-item", id: workItemId },
				sourceRevisions: [{ kind: "work-item", id: workItemId, revision }],
			});

		const g = graph();
		const currentRecord = workItemRecord("WI-1");
		const originalRequest = workItemRequest("WI-1", "work-item-rev-1");
		const rawRecords = g.state<readonly AgenticMemoryRecord<string>[]>([currentRecord], {
			name: "work-item/raw-records",
		});
		const requestState = g.state(originalRequest, { name: "work-item/use-request" });
		const gate = agenticMemoryRecordUseGateBundle(g, {
			name: "work-item/use-gate",
			records: rawRecords,
			request: requestState,
			decisions: g.state([decision(originalRequest, currentRecord)], {
				name: "work-item/external-decisions",
			}),
		});
		const governed = agenticMemoryBundle(g, {
			name: "work-item/governed-memory",
			records: gate.allowedRecords,
			query: g.state({ tags: ["relevant"] }, { name: "work-item/query" }),
		});
		const snapshots = collect(gate.snapshot);
		const ranked = collect<Node<MemoryAnswer<string>> extends Node<infer T> ? T : never>(
			governed.ranked,
		);

		expect(snapshots.values.at(-1)?.allowedRecords).toHaveLength(1);
		expect(ranked.values.at(-1)?.results).toHaveLength(1);
		requestState.set(workItemRequest("WI-2", "work-item-rev-2"));
		expect(snapshots.values.at(-1)?.allowedRecords).toEqual([]);
		expect(snapshots.values.at(-1)?.status.state).toBe("invalid");
		expect(g.describe().edges).toContainEqual({
			from: "work-item/use-gate/allowedRecords",
			to: "work-item/governed-memory/projection",
		});
		expect(g.describe().edges).not.toContainEqual({
			from: "work-item/raw-records",
			to: "work-item/governed-memory/projection",
		});
		snapshots.unsubscribe();
		ranked.unsubscribe();
	});
});

expectTypeOf<AgenticMemoryRecordUseSnapshot>().toBeObject();
