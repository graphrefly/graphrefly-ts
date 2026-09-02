import { describe, expect, expectTypeOf, it } from "vitest";
import { depBatch } from "../ctx/types.js";
import { graph } from "../graph/graph.js";
import * as packageRoot from "../index.js";
import { strictCanonicalJsonBytes } from "../json/codec.js";
import type { Node } from "../node/node.js";
import type { MemoryFragment } from "../patterns/semantic-memory.js";
import type { Message } from "../protocol/messages.js";
import * as focusedAgenticMemory from "../solutions/agentic-memory/index.js";
import {
	AGENTIC_MEMORY_RECORD_USE_V1_LIMITS,
	type AgenticMemoryBundle,
	type AgenticMemoryRecord,
	type AgenticMemoryRecordUseDecision,
	type AgenticMemoryRecordUseGateBundle,
	type AgenticMemoryRecordUseOccurrence,
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
import type { SolutionOccurrence } from "../solutions/occurrence.js";

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
		for (const occurrenceName of [
			"agenticMemoryRecordAdmissionOccurrenceNode",
			"agenticMemoryRecordApplicationOccurrenceNode",
			"agenticMemoryRecordUseOccurrenceNode",
		]) {
			expect(occurrenceName in focusedAgenticMemory).toBe(false);
			expect(occurrenceName in packageRoot).toBe(false);
			expect(occurrenceName in solutionsAggregate).toBe(false);
		}
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

function useOccurrence(id: string, revision = 1): AgenticMemoryRecordUseOccurrence<string> {
	const currentRecord = record(`private-${id}`, { id: `record-${id}` });
	const currentRequest = request({ requestId: `request-${id}` });
	return Object.freeze({
		occurrenceId: id,
		occurrenceRevision: revision,
		occurrenceDigest: `sha256:${String(revision).padStart(64, "0")}`,
		occurrenceSourceRefs: Object.freeze([{ kind: "work-item", id: `work-${id}` }]),
		value: Object.freeze({
			records: Object.freeze([currentRecord]),
			request: currentRequest,
			decisions: Object.freeze([decision(currentRequest, currentRecord)]),
		}),
	});
}

describe("AgenticMemory D789 real keyed exact-use lifecycle", () => {
	it("does not invoke rejected permission getters or leak Proxy exceptions across uses", () => {
		const g = graph();
		const input = g.node<AgenticMemoryRecordUseOccurrence<string>>([], null);
		const gate = agenticMemoryRecordUseGateBundle(g, { occurrences: input, maxOccurrences: 3 });
		const observed = collect(gate.snapshot);
		let getterCalls = 0;
		const a = useOccurrence("getter");
		const hostileRequest = { ...a.value.request };
		Object.defineProperty(hostileRequest, "purpose", {
			enumerable: true,
			get() {
				getterCalls += 1;
				throw new Error("PRIVATE-GETTER");
			},
		});
		const b = useOccurrence("proxy");
		const hostileRecords = new Proxy([...b.value.records], {
			get(target, key, receiver) {
				if (key === "0") throw new Error("PRIVATE-PROXY");
				return Reflect.get(target, key, receiver);
			},
		});
		expect(() =>
			input.down([
				["DATA", { ...a, value: { ...a.value, request: hostileRequest } }],
				["DATA", { ...b, value: { ...b.value, records: hostileRecords } }],
				["DATA", useOccurrence("valid")],
			]),
		).not.toThrow();
		expect(getterCalls).toBe(0);
		expect(observed.values.map((value) => value.value.status.state)).toEqual([
			"invalid",
			"invalid",
			"ready",
		]);
		expect(JSON.stringify(observed.values.slice(0, 2))).not.toContain("PRIVATE-");
		observed.unsubscribe();
	});

	it("does not confuse bigint material with a tagged-looking plain object on replay", () => {
		const g = graph();
		const input = g.node<AgenticMemoryRecordUseOccurrence<string>>([], null);
		const gate = agenticMemoryRecordUseGateBundle(g, { occurrences: input, maxOccurrences: 1 });
		const observed = collect(gate.snapshot);
		const a = useOccurrence("a");
		input.down([["DATA", a]]);
		const changed = {
			...a,
			value: {
				...a.value,
				records: a.value.records.map((record) => ({
					...record,
					fragment: { ...record.fragment, tNs: { bigint: "10" } },
				})),
			},
		} as unknown as AgenticMemoryRecordUseOccurrence<string>;
		expect(() => input.down([["DATA", changed]])).toThrow(/conflicted/u);
		expect(observed.values).toHaveLength(1);
		observed.unsubscribe();
	});

	it("detaches immutable provenance and rejects extra ref fields and accessors", () => {
		const g = graph();
		const input = g.node<AgenticMemoryRecordUseOccurrence<string>>([], null);
		const gate = agenticMemoryRecordUseGateBundle(g, { occurrences: input, maxOccurrences: 1 });
		const observed = collect(gate.audit);
		const source = { kind: "work-item", id: "original" };
		const a = { ...useOccurrence("a"), occurrenceSourceRefs: [source] };
		input.down([["DATA", a]]);
		source.id = "mutated";
		expect(observed.values[0]?.occurrenceSourceRefs).toEqual([
			{ kind: "work-item", id: "original" },
		]);
		expect(Object.isFrozen(observed.values[0]?.occurrenceSourceRefs[0])).toBe(true);
		expect(() =>
			input.down([
				[
					"DATA",
					{
						...a,
						occurrenceSourceRefs: [{ kind: "work-item", id: "original", privatePayload: "secret" }],
					},
				],
			]),
		).toThrow(/only data kind\/id/u);
		observed.unsubscribe();
		const accessorGraph = graph();
		const accessorInput = accessorGraph.node<AgenticMemoryRecordUseOccurrence<string>>([], null);
		const accessorGate = agenticMemoryRecordUseGateBundle(accessorGraph, {
			occurrences: accessorInput,
			maxOccurrences: 1,
		});
		const accessorObserved = collect(accessorGate.audit);
		let called = false;
		const ref = {
			kind: "work-item",
			get id() {
				called = true;
				return "PRIVATE";
			},
		};
		expect(() => accessorInput.down([["DATA", { ...a, occurrenceSourceRefs: [ref] }]])).toThrow(
			/only data kind\/id/u,
		);
		expect(called).toBe(false);
		accessorObserved.unsubscribe();
	});

	it("never rereads reference Proxy values or coerces a digest object", () => {
		const g = graph();
		const input = g.node<AgenticMemoryRecordUseOccurrence<string>>([], null);
		const gate = agenticMemoryRecordUseGateBundle(g, { occurrences: input, maxOccurrences: 1 });
		const observed = collect(gate.audit);
		let getCalls = 0;
		const source = new Proxy(
			{ kind: "work-item", id: "original" },
			{
				get() {
					getCalls += 1;
					throw new Error("PRIVATE-PROXY");
				},
			},
		);
		const a = { ...useOccurrence("a"), occurrenceSourceRefs: [source] };
		expect(() => input.down([["DATA", a]])).not.toThrow();
		expect(getCalls).toBe(0);
		expect(observed.values[0]?.occurrenceSourceRefs).toEqual([
			{ kind: "work-item", id: "original" },
		]);
		let coercions = 0;
		const bad = {
			...a,
			occurrenceDigest: {
				toString() {
					coercions += 1;
					throw new Error("PRIVATE-DIGEST");
				},
			},
		} as unknown as AgenticMemoryRecordUseOccurrence<string>;
		expect(() => input.down([["DATA", bad]])).toThrow(/canonical sha256/u);
		expect(coercions).toBe(0);
		observed.unsubscribe();
	});

	it("preserves two revisions of one use within a single wave", () => {
		const g = graph();
		const input = g.node<AgenticMemoryRecordUseOccurrence<string>>([], null);
		const gate = agenticMemoryRecordUseGateBundle(g, { occurrences: input, maxOccurrences: 1 });
		const observed = collect(gate.allowedRecords);
		input.down([
			["DATA", useOccurrence("same", 1)],
			["DATA", useOccurrence("same", 2)],
		]);
		expect(observed.values.map((value) => value.occurrenceRevision)).toEqual([1, 2]);
		observed.unsubscribe();
	});
	it.each([
		"batched",
		"split",
		"reordered",
	] as const)("preserves every independent use: %s", (delivery) => {
		const g = graph();
		const input = g.node<AgenticMemoryRecordUseOccurrence<string>>([], null, { name: "uses" });
		const gate = agenticMemoryRecordUseGateBundle(g, {
			name: "gate",
			occurrences: input,
			maxOccurrences: 2,
		});
		const observed = collect(gate.snapshot);
		const allowed = collect(gate.allowedRecords);
		const a = useOccurrence("a");
		const b = useOccurrence("b");
		const order = delivery === "reordered" ? [b, a] : [a, b];
		if (delivery === "batched") input.down(order.map((value) => ["DATA", value]));
		else for (const value of order) input.down([["DATA", value]]);
		expect(observed.values.map((value) => value.occurrenceId)).toEqual(
			order.map((value) => value.occurrenceId),
		);
		expect(allowed.values.map((value) => value.value[0]?.id)).toEqual(
			order.map((value) => value.value.records[0]?.id),
		);
		for (const [index, value] of allowed.values.entries()) {
			expect(value.occurrenceSourceRefs).toEqual(order[index]?.occurrenceSourceRefs);
			expect(value.occurrenceDigest).toBe(order[index]?.occurrenceDigest);
			expect(value.value).toBe(observed.values[index]?.value.allowedRecords);
		}
		input.down(order.map((value) => ["DATA", value]));
		expect(observed.values).toHaveLength(2);
		expect(allowed.values).toHaveLength(2);
		expectTypeOf(gate).toMatchTypeOf<AgenticMemoryRecordUseGateBundle<string>>();
		expect(
			g.describe().nodes.filter((node) => node.factory === "agenticMemoryRecordUseGate"),
		).toHaveLength(1);
		observed.unsubscribe();
		allowed.unsubscribe();
	});

	it("keeps denial, missing and duplicate decisions local to one use, including the same record", () => {
		const g = graph();
		const input = g.node<AgenticMemoryRecordUseOccurrence<string>>([], null);
		const gate = agenticMemoryRecordUseGateBundle(g, { occurrences: input, maxOccurrences: 4 });
		const observed = collect(gate.snapshot);
		const allow = useOccurrence("allow");
		const currentRecord = allow.value.records[0]!;
		const make = (id: string, mode: "denied" | "missing" | "duplicate") => {
			const frame = useOccurrence(id);
			const exact = decision(
				frame.value.request,
				currentRecord,
				mode === "denied" ? "denied" : "allowed",
			);
			return {
				...frame,
				value: {
					...frame.value,
					records: [currentRecord],
					decisions: mode === "missing" ? [] : mode === "duplicate" ? [exact, exact] : [exact],
				},
			};
		};
		input.down([
			["DATA", make("deny", "denied")],
			["DATA", make("missing", "missing")],
			["DATA", make("duplicate", "duplicate")],
			["DATA", allow],
		]);
		expect(observed.values.map((value) => value.value.allowedRecords.length)).toEqual([0, 0, 0, 1]);
		expect(observed.values.map((value) => value.value.status.state)).toEqual([
			"ready",
			"invalid",
			"invalid",
			"ready",
		]);
		expect(observed.values[1]?.value.exclusions[0]?.reason).toBe("missing-decision");
		expect(observed.values[2]?.value.exclusions[0]?.reason).toBe("duplicate-decision");
		observed.unsubscribe();
	});

	it.each([
		"digest",
		"provenance",
		"value",
		"stale",
		"overflow",
	] as const)("fails closed on %s without delivering a bad batch prefix", (fault) => {
		const g = graph();
		const input = g.node<AgenticMemoryRecordUseOccurrence<string>>([], null);
		const gate = agenticMemoryRecordUseGateBundle(g, { occurrences: input, maxOccurrences: 2 });
		const messages: Message[] = [];
		const unsubscribe = gate.allowedRecords.subscribe((message) => messages.push(message));
		const a = useOccurrence("a", 2);
		input.down([["DATA", a]]);
		const bad =
			fault === "digest"
				? { ...a, occurrenceDigest: `sha256:${"f".repeat(64)}` }
				: fault === "provenance"
					? { ...a, occurrenceSourceRefs: [{ kind: "work-item", id: "wrong" }] }
					: fault === "value"
						? { ...a, value: { ...a.value, decisions: [] } }
						: fault === "stale"
							? useOccurrence("a", 1)
							: useOccurrence("c");
		expect(() =>
			input.down([
				["DATA", useOccurrence("b")],
				["DATA", bad],
			]),
		).toThrow(/solution occurrence/u);
		expect(messages.filter((message) => message[0] === "DATA")).toHaveLength(1);
		unsubscribe();
	});

	it("stays quiet until an input exists and propagates terminal failure to every projection", () => {
		const g = graph();
		const input = g.node<AgenticMemoryRecordUseOccurrence<string>>([], null, { name: "uses" });
		const gate = agenticMemoryRecordUseGateBundle(g, { occurrences: input, maxOccurrences: 2 });
		const terminals: string[] = [];
		const releases = Object.entries(gate)
			.filter(([key]) => key !== "input")
			.map(([key, node]) =>
				node.subscribe((message: Message) => {
					if (message[0] === "ERROR") terminals.push(key);
				}),
			);
		const allowed = collect(gate.allowedRecords);
		expect(allowed.values).toEqual([]);
		input.down([["DATA", useOccurrence("a")]]);
		expect(allowed.values).toHaveLength(1);
		input.down([["ERROR", new Error("upstream failed")]]);
		expect(terminals.sort()).toEqual(
			["snapshot", "allowedRecords", "exclusions", "status", "issues", "audit", "cursor"].sort(),
		);
		expect(allowed.values).toHaveLength(1);
		for (const release of releases) release();
		allowed.unsubscribe();
	});

	it("resets bounded replay state at a fresh activation, not on ordinary replay", () => {
		const g = graph();
		const input = g.node<AgenticMemoryRecordUseOccurrence<string>>([], null);
		const gate = agenticMemoryRecordUseGateBundle(g, { occurrences: input, maxOccurrences: 1 });
		const a = useOccurrence("a");
		const first = collect(gate.snapshot);
		input.down([
			["DATA", a],
			["DATA", a],
		]);
		expect(first.values).toHaveLength(1);
		first.unsubscribe();
		const second = collect(gate.snapshot);
		input.down([["DATA", a]]);
		expect(second.values).toHaveLength(1);
		second.unsubscribe();
	});

	it.each([
		"sqlite-domain",
		"work-item",
	])("uses exact %s revisions before governed retrieval", (kind) => {
		const g = graph();
		const a = useOccurrence(kind);
		const input = g.state(a, { name: "complete-use" });
		const gate = agenticMemoryRecordUseGateBundle(g, {
			name: "gate",
			occurrences: input,
			maxOccurrences: 1,
		});
		// This consumer selects one declared use; it cannot expose another use's latest records.
		const selected = g.node<readonly AgenticMemoryRecord<string>[]>(
			[gate.allowedRecords],
			(ctx) => {
				for (const raw of depBatch(ctx, 0) ?? []) {
					const occurrence = raw as SolutionOccurrence<readonly AgenticMemoryRecord<string>[]>;
					if (occurrence.occurrenceId === kind) ctx.down([["DATA", occurrence.value]]);
				}
			},
			{ name: "selected-use" },
		);
		const governed = agenticMemoryBundle(g, {
			name: "governed",
			records: selected,
			query: g.state({ tags: ["relevant"] }),
		});
		const topology = g.describe();
		const snapshots = collect(gate.snapshot);
		const ranked = collect(governed.ranked);
		expectTypeOf(governed).toMatchTypeOf<AgenticMemoryBundle<string>>();
		expect(ranked.values.at(-1)?.results).toHaveLength(1);
		const changed = {
			...useOccurrence(kind, 2),
			value: {
				...a.value,
				request: { ...a.value.request, sourceRevisions: [{ kind, id: kind, revision: "changed" }] },
			},
		};
		input.set(changed);
		expect(snapshots.values.at(-1)?.value.status.state).toBe("invalid");
		expect(snapshots.values.at(-1)?.value.exclusions[0]?.reason).toBe("request-mismatch");
		expect(ranked.values.at(-1)?.results).toEqual([]);
		for (const suffix of ["allowedRecords", "exclusions", "status", "issues", "audit", "cursor"])
			expect(topology.edges).toContainEqual({ from: "gate/snapshot", to: `gate/${suffix}` });
		expect(topology.edges).toContainEqual({ from: "complete-use", to: "gate/snapshot" });
		expect(topology.edges).toContainEqual({ from: "gate/allowedRecords", to: "selected-use" });
		expect(topology.edges).toContainEqual({ from: "selected-use", to: "governed/projection" });
		expect(topology.edges).not.toContainEqual({ from: "complete-use", to: "governed/projection" });
		// Generic describe includes user DATA caches. Privacy of the material-free
		// Eval is tested on that application graph, not on this raw-record fixture.
		snapshots.unsubscribe();
		ranked.unsubscribe();
	});
});

expectTypeOf<AgenticMemoryRecordUseSnapshot>().toBeObject();
