import { describe, expect, it } from "vitest";
import { graph } from "../graph/graph.js";
import { compoundTupleKey } from "../identity.js";
import type { MemoryAnswer, MemoryFragment } from "../patterns/index.js";
import type { Message } from "../protocol/messages.js";
import {
	type AgenticMemoryConsolidationCommand,
	type AgenticMemoryConsolidationError,
	type AgenticMemoryConsolidationOutcome,
	type AgenticMemoryConsolidationRequest,
	type AgenticMemoryConsolidationStatus,
	type AgenticMemoryContext,
	type AgenticMemoryContextPackingError,
	type AgenticMemoryContextPackingPolicy,
	type AgenticMemoryContextPackingStatus,
	type AgenticMemoryContextText,
	type AgenticMemoryKgAssertionDraft,
	type AgenticMemoryKgProjectionError,
	type AgenticMemoryPackedContext,
	type AgenticMemoryRecord,
	type AgenticMemoryRecordAdmission,
	type AgenticMemoryRecordAdmissionPolicy,
	type AgenticMemoryRecordAdmissionStatus,
	type AgenticMemoryRecordProposal,
	type AgenticMemoryRetentionCommand,
	type AgenticMemoryRetentionError,
	type AgenticMemorySourceProjection,
	agenticMemoryBundle,
	agenticMemoryConsolidationBundle,
	agenticMemoryContextPackingBundle,
	agenticMemoryKgProjectionBundle,
	agenticMemoryRecordAdmissionBundle,
	agenticMemoryRetentionBundle,
} from "../solutions/index.js";

const fragment = <T = string>(patch: Partial<MemoryFragment<T>> = {}): MemoryFragment<T> => ({
	id: "fact-1",
	payload: "payload" as T,
	tNs: 10n,
	confidence: 0.8,
	tags: ["project", "policy"],
	sources: [],
	...patch,
});

const record = <T = string>(
	patch: Partial<AgenticMemoryRecord<T>> = {},
): AgenticMemoryRecord<T> => ({
	id: "record-1",
	kind: "semantic",
	persistenceLevel: "project",
	artifactKind: "insight",
	scope: { sessionId: "session-1", projectId: "project-1" },
	fragment: fragment<T>(),
	...patch,
});

const data = <T>(messages: Message[]): T[] =>
	messages.filter((m) => m[0] === "DATA").map((m) => (m as readonly ["DATA", T])[1]);

function collect(node: { subscribe(sink: (messages: Message) => void): () => void }) {
	const messages: Message[] = [];
	const unsubscribe = node.subscribe((message) => messages.push(message));
	return { messages, unsubscribe };
}

describe("agentic memory consolidation bundle (D171)", () => {
	it("projects external consolidation outcomes into result, draft, and command DATA facts", () => {
		const g = graph();
		const records = g.state<readonly AgenticMemoryRecord<string>[]>(
			[
				record({ id: "record-a", fragment: fragment({ id: "a" }) }),
				record({ id: "record-b", fragment: fragment({ id: "b" }) }),
			],
			{ name: "records" },
		);
		const requests = g.state<readonly AgenticMemoryConsolidationRequest[]>(
			[
				{
					id: "request-1",
					commandId: "cmd-1",
					recordIds: ["record-a", "record-b"],
					reason: "merge",
				},
			],
			{ name: "requests" },
		);
		const outcomes = g.state<readonly AgenticMemoryConsolidationOutcome<string>[]>(
			[
				{
					id: "outcome-1",
					requestId: "request-1",
					kind: "proposedRecords",
					records: [
						record({
							id: "record-merged",
							artifactKind: "insight",
							fragment: fragment({ id: "merged", payload: "merged insight" }),
						}),
					],
					provenance: "external-executor",
				},
			],
			{ name: "outcomes" },
		);
		const bundle = agenticMemoryConsolidationBundle(g, {
			name: "consolidation",
			records,
			requests,
			outcomes,
		});
		const drafts = collect(bundle.proposedRecordDrafts);
		const commands = collect(bundle.commands);
		const status = collect(bundle.status);
		const errors = collect(bundle.errors);

		expect(g.describe().edges).toEqual(
			expect.arrayContaining([
				{ from: "records", to: "consolidation/projection" },
				{ from: "requests", to: "consolidation/projection" },
				{ from: "outcomes", to: "consolidation/projection" },
				{ from: "consolidation/projection", to: "consolidation/results" },
				{ from: "consolidation/projection", to: "consolidation/proposedRecordDrafts" },
				{ from: "consolidation/projection", to: "consolidation/commands" },
			]),
		);
		expect(data(errors.messages).at(-1)).toEqual([]);
		expect(data(status.messages).at(-1)).toMatchObject({
			state: "ready",
			cursor: { validOutcomes: 1, invalidOutcomes: 0, proposedRecordDrafts: 1 },
		});
		expect(data(drafts.messages).at(-1)).toEqual([
			expect.objectContaining({
				id: compoundTupleKey("agentic-memory-record-draft", [
					"request-1",
					"outcome-1",
					"record-merged",
				]),
				requestId: "request-1",
				outcomeId: "outcome-1",
				record: expect.objectContaining({ id: "record-merged" }),
			}),
		]);
		expect(data<readonly AgenticMemoryConsolidationCommand[]>(commands.messages).at(-1)).toEqual([
			{
				id: compoundTupleKey("agentic-memory-consolidation-command", [
					compoundTupleKey("agentic-memory-consolidation-result", ["request-1", "outcome-1"]),
					"proposeRecords",
				]),
				kind: "proposeRecords",
				requestId: "request-1",
				outcomeId: "outcome-1",
				draftIds: [
					compoundTupleKey("agentic-memory-record-draft", [
						"request-1",
						"outcome-1",
						"record-merged",
					]),
				],
			},
		]);
	});

	it("keeps invalid consolidation outcomes on the DATA error path", () => {
		const g = graph();
		const records = g.state<readonly AgenticMemoryRecord<string>[]>(
			[record({ id: "record-a", fragment: fragment({ id: "a" }) })],
			{ name: "records" },
		);
		const requests = g.state<readonly AgenticMemoryConsolidationRequest[]>(
			[{ id: "request-1", commandId: "cmd-1", recordIds: ["record-a"] }],
			{ name: "requests" },
		);
		const outcomes = g.state(
			[
				{ id: "missing", requestId: "missing-request", kind: "failed", message: "nope" },
				{
					id: "bad-record",
					requestId: "request-1",
					kind: "proposedRecords",
					records: [record({ id: "", fragment: fragment({ id: "" }) })],
				},
			] as never,
			{ name: "outcomes" },
		);
		const bundle = agenticMemoryConsolidationBundle(g, {
			name: "consolidation",
			records,
			requests,
			outcomes,
		});
		const errors = collect(bundle.errors);
		const status = collect(bundle.status);

		expect(
			data<readonly AgenticMemoryConsolidationError[]>(errors.messages)
				.at(-1)
				?.map((error) => error.code),
		).toEqual(["missing-request-ref", "invalid-proposed-record"]);
		expect(data<AgenticMemoryConsolidationStatus>(status.messages).at(-1)).toMatchObject({
			state: "error",
			cursor: { validOutcomes: 0, invalidOutcomes: 2 },
		});
		expect(errors.messages.some((message) => message[0] === "ERROR")).toBe(false);
	});

	it("rejects duplicate proposed record ids and hostile outcome arrays as DATA errors", () => {
		const g = graph();
		const records = g.state<readonly AgenticMemoryRecord<string>[]>(
			[record({ id: "record-a", fragment: fragment({ id: "a" }) })],
			{ name: "records" },
		);
		const requests = g.state<readonly AgenticMemoryConsolidationRequest[]>(
			[{ id: "request-1", commandId: "cmd-1", recordIds: ["record-a"] }],
			{ name: "requests" },
		);
		const outcomes = [
			{
				id: "dupe-records",
				requestId: "request-1",
				kind: "proposedRecords",
				records: [
					record({ id: "record-merged", fragment: fragment({ id: "merged-a" }) }),
					record({ id: "record-merged", fragment: fragment({ id: "merged-b" }) }),
				],
			},
			{
				id: "unreadable",
				requestId: "request-1",
				kind: "failed",
				message: "unreachable",
			},
		] as unknown[];
		Object.defineProperty(outcomes, "1", {
			get() {
				throw new Error("outcome getter exploded");
			},
		});
		const outcomeNode = g.state(outcomes as never, { name: "outcomes" });
		const bundle = agenticMemoryConsolidationBundle(g, {
			name: "consolidation",
			records,
			requests,
			outcomes: outcomeNode,
		});
		const errors = collect(bundle.errors);
		const status = collect(bundle.status);

		expect(
			data<readonly AgenticMemoryConsolidationError[]>(errors.messages)
				.at(-1)
				?.map((error) => error.code),
		).toEqual(["invalid-proposed-record", "invalid-outcome"]);
		expect(
			data<readonly AgenticMemoryConsolidationError[]>(errors.messages).at(-1)?.[0]
				?.validationErrors,
		).toEqual(["records[1]: duplicate proposed record id 'record-merged'"]);
		expect(data<AgenticMemoryConsolidationStatus>(status.messages).at(-1)).toMatchObject({
			state: "error",
			cursor: { validOutcomes: 0, invalidOutcomes: 2, proposedRecordDrafts: 0 },
		});
		expect(errors.messages.some((message) => message[0] === "ERROR")).toBe(false);
	});
});

describe("agentic memory record proposal admission (D572/D573)", () => {
	it("admits proposal facts without applying AgenticMemoryRecord truth", () => {
		const g = graph();
		const records = g.state<readonly AgenticMemoryRecord<string>[]>(
			[record({ id: "record-existing", fragment: fragment({ id: "existing" }) })],
			{ name: "records" },
		);
		const proposals = g.state<readonly AgenticMemoryRecordProposal<string>[]>(
			[
				{
					kind: "agentic-memory-record-proposal",
					proposalId: "proposal-1",
					candidateRecord: record({
						id: "record-new",
						fragment: fragment({ id: "new", payload: "new insight" }),
					}),
					reason: "human-approved import",
					sourceRefs: [{ kind: "review", id: "review-1" }],
					policyRefs: [{ kind: "policy", id: "mapper-1" }],
					idempotencyKey: "idem-1",
					correlationId: "corr-1",
				},
			],
			{ name: "proposals" },
		);
		const policy = g.state<AgenticMemoryRecordAdmissionPolicy>(
			{
				kind: "agentic-memory-record-admission-policy",
				policyId: "admission-policy",
				defaultState: "admitted",
				requireSourceRefs: true,
				policyRefs: [{ kind: "policy", id: "admission-policy" }],
			},
			{ name: "policy" },
		);
		const bundle = agenticMemoryRecordAdmissionBundle(g, {
			name: "admission",
			records,
			proposals,
			policy,
		});
		const admitted = collect(bundle.admitted);
		const status = collect(bundle.status);
		const audit = collect(bundle.audit);

		expect(g.describe().edges).toEqual(
			expect.arrayContaining([
				{ from: "records", to: "admission/projection" },
				{ from: "proposals", to: "admission/projection" },
				{ from: "policy", to: "admission/projection" },
				{ from: "admission/projection", to: "admission/admitted" },
				{ from: "admission/projection", to: "admission/audit" },
			]),
		);
		expect(Object.hasOwn(bundle, "records")).toBe(false);
		expect(data<AgenticMemoryRecordAdmissionStatus>(status.messages).at(-1)).toMatchObject({
			state: "ready",
			cursor: { admitted: 1, rejected: 0, needsReview: 0, invalidProposals: 0 },
		});
		expect(data<readonly AgenticMemoryRecordAdmission<string>[]>(admitted.messages).at(-1)).toEqual(
			[
				expect.objectContaining({
					kind: "agentic-memory-record-admission",
					admissionId: 'admission:["admission-policy","proposal-1"]',
					proposalId: "proposal-1",
					state: "admitted",
					candidateRecord: expect.objectContaining({ id: "record-new" }),
					sourceRefs: expect.arrayContaining([{ kind: "review", id: "review-1" }]),
					policyRefs: expect.arrayContaining([
						{ kind: "agentic-memory-record-admission-policy", id: "admission-policy" },
					]),
					idempotencyKey: "idem-1",
					correlationId: "corr-1",
				}),
			],
		);
		expect(data(audit.messages).at(-1)).toEqual([
			expect.objectContaining({
				kind: "agentic-memory-record-admission-audit",
				proposalId: "proposal-1",
				state: "admitted",
			}),
		]);
		expect(records.cache?.map((item) => item.id)).toEqual(["record-existing"]);
	});

	it("rejects duplicate candidate ids and routes missing provenance to needs-review", () => {
		const g = graph();
		const records = g.state<readonly AgenticMemoryRecord<string>[]>(
			[record({ id: "record-existing", fragment: fragment({ id: "existing" }) })],
			{ name: "records" },
		);
		const proposals = g.state<readonly AgenticMemoryRecordProposal<string>[]>(
			[
				{
					kind: "agentic-memory-record-proposal",
					proposalId: "duplicate",
					candidateRecord: record({
						id: "record-existing",
						fragment: fragment({ id: "replacement" }),
					}),
					sourceRefs: [{ kind: "import", id: "import-1" }],
				},
				{
					kind: "agentic-memory-record-proposal",
					proposalId: "missing-source",
					candidateRecord: record({
						id: "record-new",
						fragment: fragment({ id: "new" }),
					}),
				},
			],
			{ name: "proposals" },
		);
		const policy = g.state<AgenticMemoryRecordAdmissionPolicy>(
			{
				kind: "agentic-memory-record-admission-policy",
				policyId: "admission-policy",
				defaultState: "admitted",
				requireSourceRefs: true,
			},
			{ name: "policy" },
		);
		const bundle = agenticMemoryRecordAdmissionBundle(g, {
			name: "admission",
			records,
			proposals,
			policy,
		});
		const rejected = collect(bundle.rejected);
		const needsReview = collect(bundle.needsReview);
		const status = collect(bundle.status);

		expect(data<readonly AgenticMemoryRecordAdmission<string>[]>(rejected.messages).at(-1)).toEqual(
			[
				expect.objectContaining({
					proposalId: "duplicate",
					state: "rejected",
					reason: "candidate record id already exists",
				}),
			],
		);
		expect(
			data<readonly AgenticMemoryRecordAdmission<string>[]>(needsReview.messages).at(-1),
		).toEqual([
			expect.objectContaining({
				proposalId: "missing-source",
				state: "needs-review",
				reason: "policy requires sourceRefs",
			}),
		]);
		expect(data<AgenticMemoryRecordAdmissionStatus>(status.messages).at(-1)).toMatchObject({
			state: "blocked",
			cursor: { admitted: 0, rejected: 1, needsReview: 1 },
		});
	});

	it("keeps malformed proposals on the DATA issue path", () => {
		const g = graph();
		const records = g.state<readonly AgenticMemoryRecord<string>[]>([], { name: "records" });
		const proposals = [
			{
				kind: "agentic-memory-record-proposal",
				proposalId: "bad-candidate",
				candidateRecord: record({ id: "", fragment: fragment({ id: "" }) }),
				sourceRefs: [{ kind: "import", id: "import-1" }],
			},
			{
				kind: "agentic-memory-record-proposal",
				proposalId: "unreadable",
				candidateRecord: record({ id: "unreadable", fragment: fragment({ id: "unreadable" }) }),
			},
			{
				kind: "agentic-memory-record-proposal",
				proposalId: "runtime-field",
				candidateRecord: record({
					id: "runtime-field",
					fragment: fragment({ id: "runtime-field" }),
				}),
				sourceRefs: [
					{
						kind: "import",
						id: "import-1",
						callback: () => undefined,
						metadata: { note: "invalid ref field" },
					},
				],
				storageKey: "private-storage-key",
				metadata: { ok: true },
			},
		] as unknown[];
		Object.defineProperty(proposals, "1", {
			get() {
				throw new Error("proposal getter exploded");
			},
		});
		const proposalNode = g.state(proposals as never, { name: "proposals" });
		const policy = g.state<AgenticMemoryRecordAdmissionPolicy>(
			{ kind: "agentic-memory-record-admission-policy", policyId: "admission-policy" },
			{ name: "policy" },
		);
		const bundle = agenticMemoryRecordAdmissionBundle(g, {
			name: "admission",
			records,
			proposals: proposalNode,
			policy,
		});
		const issues = collect(bundle.issues);
		const status = collect(bundle.status);

		const latestIssues = data<
			readonly {
				readonly code: string;
				readonly details?: unknown;
				readonly refs?: readonly string[];
			}[]
		>(issues.messages).at(-1);
		expect(latestIssues?.map((issue) => issue.code)).toEqual([
			"agentic-memory.proposal.invalid",
			"agentic-memory.proposal.invalid",
			"agentic-memory.proposal.invalid",
		]);
		expect(latestIssues?.every((issue) => !Object.hasOwn(issue, "details"))).toBe(true);
		expect(latestIssues?.[2]?.refs).toEqual(
			expect.arrayContaining([
				"proposal.storageKey is not graph-visible DATA",
				"proposal.sourceRefs: [0] has unexpected fields callback",
			]),
		);
		expect(data<AgenticMemoryRecordAdmissionStatus>(status.messages).at(-1)).toMatchObject({
			state: "error",
			cursor: { validProposals: 0, invalidProposals: 3 },
		});
		expect(issues.messages.some((message) => message[0] === "ERROR")).toBe(false);
	});

	it("keeps malformed admission policies on the DATA issue path", () => {
		const g = graph();
		const records = g.state<readonly AgenticMemoryRecord<string>[]>([], { name: "records" });
		const proposals = g.state<readonly AgenticMemoryRecordProposal<string>[]>(
			[
				{
					kind: "agentic-memory-record-proposal",
					proposalId: "proposal-1",
					candidateRecord: record({ id: "record-new", fragment: fragment({ id: "new" }) }),
					sourceRefs: [{ kind: "import", id: "import-1" }],
				},
			],
			{ name: "proposals" },
		);
		const hostilePolicy = {
			kind: "agentic-memory-record-admission-policy",
			policyId: "hostile-policy",
		};
		Object.defineProperty(hostilePolicy, "sourceRefs", {
			get() {
				throw new Error("policy getter exploded");
			},
			enumerable: true,
		});
		const policy = g.state(hostilePolicy as never, { name: "policy" });
		const bundle = agenticMemoryRecordAdmissionBundle(g, {
			name: "admission",
			records,
			proposals,
			policy,
		});
		const needsReview = collect(bundle.needsReview);
		const issues = collect(bundle.issues);
		const status = collect(bundle.status);

		expect(
			data<readonly AgenticMemoryRecordAdmission<string>[]>(needsReview.messages).at(-1),
		).toEqual([expect.objectContaining({ proposalId: "proposal-1", state: "needs-review" })]);
		const latestIssues = data<readonly { readonly code: string; readonly details?: unknown }[]>(
			issues.messages,
		).at(-1);
		expect(latestIssues).toEqual([
			expect.objectContaining({ code: "agentic-memory.admission-policy.invalid" }),
		]);
		expect(latestIssues?.every((issue) => !Object.hasOwn(issue, "details"))).toBe(true);
		expect(data<AgenticMemoryRecordAdmissionStatus>(status.messages).at(-1)).toMatchObject({
			state: "partial",
			cursor: { validProposals: 1, invalidProposals: 0, invalidPolicies: 1 },
		});
		expect(issues.messages.some((message) => message[0] === "ERROR")).toBe(false);
	});

	it("snapshots refs and preserves colon-distinct policy refs", () => {
		const g = graph();
		const records = g.state<readonly AgenticMemoryRecord<string>[]>([], { name: "records" });
		const sourceRef = { kind: "review", id: "review-1", metadata: { rank: 1 } };
		const proposals = g.state<readonly AgenticMemoryRecordProposal<string>[]>(
			[
				{
					kind: "agentic-memory-record-proposal",
					proposalId: "proposal-1",
					candidateRecord: record({ id: "record-new", fragment: fragment({ id: "new" }) }),
					sourceRefs: [sourceRef],
					policyRefs: [
						{ kind: "a:b", id: "c" },
						{ kind: "a", id: "b:c" },
					],
				},
			],
			{ name: "proposals" },
		);
		const policy = g.state<AgenticMemoryRecordAdmissionPolicy>(
			{
				kind: "agentic-memory-record-admission-policy",
				policyId: "admission-policy",
				defaultState: "admitted",
			},
			{ name: "policy" },
		);
		const bundle = agenticMemoryRecordAdmissionBundle(g, {
			name: "admission",
			records,
			proposals,
			policy,
		});
		const admitted = collect(bundle.admitted);
		sourceRef.metadata.rank = 99;

		const admission = data<readonly AgenticMemoryRecordAdmission<string>[]>(admitted.messages).at(
			-1,
		)?.[0];
		expect(admission?.sourceRefs).toEqual([
			{ kind: "review", id: "review-1", metadata: { rank: 1 } },
		]);
		expect(admission?.policyRefs).toEqual(
			expect.arrayContaining([
				{ kind: "a:b", id: "c" },
				{ kind: "a", id: "b:c" },
				{ kind: "agentic-memory-record-admission-policy", id: "admission-policy" },
			]),
		);
	});

	it("rejects duplicate candidate record ids within one proposal batch", () => {
		const g = graph();
		const records = g.state<readonly AgenticMemoryRecord<string>[]>([], { name: "records" });
		const proposals = g.state<readonly AgenticMemoryRecordProposal<string>[]>(
			[
				{
					kind: "agentic-memory-record-proposal",
					proposalId: "first",
					candidateRecord: record({ id: "record-dupe", fragment: fragment({ id: "dupe-a" }) }),
					sourceRefs: [{ kind: "import", id: "import-a" }],
				},
				{
					kind: "agentic-memory-record-proposal",
					proposalId: "second",
					candidateRecord: record({ id: "record-dupe", fragment: fragment({ id: "dupe-b" }) }),
					sourceRefs: [{ kind: "import", id: "import-b" }],
				},
			],
			{ name: "proposals" },
		);
		const policy = g.state<AgenticMemoryRecordAdmissionPolicy>(
			{
				kind: "agentic-memory-record-admission-policy",
				policyId: "admission-policy",
				defaultState: "admitted",
				requireSourceRefs: true,
			},
			{ name: "policy" },
		);
		const bundle = agenticMemoryRecordAdmissionBundle(g, {
			name: "admission",
			records,
			proposals,
			policy,
		});
		const admitted = collect(bundle.admitted);
		const issues = collect(bundle.issues);
		const status = collect(bundle.status);

		expect(data<readonly AgenticMemoryRecordAdmission<string>[]>(admitted.messages).at(-1)).toEqual(
			[expect.objectContaining({ proposalId: "first", state: "admitted" })],
		);
		expect(
			data<readonly { readonly code: string }[]>(issues.messages)
				.at(-1)
				?.map((issue) => issue.code),
		).toEqual(["agentic-memory.proposal.duplicate-candidate-record-id"]);
		expect(data<AgenticMemoryRecordAdmissionStatus>(status.messages).at(-1)).toMatchObject({
			state: "partial",
			cursor: { validProposals: 1, invalidProposals: 1, admitted: 1 },
		});
		expect(issues.messages.some((message) => message[0] === "ERROR")).toBe(false);
	});
});

describe("agentic memory context packing (D168)", () => {
	const contextFact = (): AgenticMemoryContext<string> => ({
		state: "ready",
		query: {},
		entries: [
			{
				fragmentId: "f1",
				payload: "one",
				confidence: 0.9,
				tags: ["a"],
				sources: [],
				record: {
					recordId: "r1",
					kind: "semantic",
					persistenceLevel: "project",
					artifactKind: "insight",
				},
				fragment: fragment({ id: "f1", payload: "one" }),
			},
			{
				fragmentId: "f2",
				payload: "two",
				confidence: 0.8,
				tags: ["a"],
				sources: [],
				fragment: fragment({ id: "f2", payload: "two" }),
			},
			{
				fragmentId: "f3",
				payload: "three",
				confidence: 0.7,
				tags: ["a"],
				sources: [],
				fragment: fragment({ id: "f3", payload: "three" }),
			},
		],
		cursor: { evaluation: 1, validFragments: 3, invalidFragments: 0, resultCount: 3 },
		errors: [],
		retrievalErrors: [],
		contextReady: true,
	});

	it("packs explicit text in context order with maxEntries/maxChars/maxCost and metadata inclusion", () => {
		const g = graph();
		const context = g.state(contextFact(), { name: "context" });
		const texts = g.state<readonly AgenticMemoryContextText[]>(
			[
				{ fragmentId: "f1", text: "aaa", cost: 1, metadata: { role: "evidence" } },
				{ fragmentId: "f2", text: "bbbb", cost: 3, metadata: { role: "procedure" } },
			],
			{ name: "texts" },
		);
		const policy = g.state<AgenticMemoryContextPackingPolicy>(
			{ maxEntries: 2, maxChars: 9, maxCost: 4, includeMetadata: true },
			{ name: "policy" },
		);
		const bundle = agenticMemoryContextPackingBundle(g, {
			name: "packing",
			context,
			texts,
			policy,
		});
		const packed = collect(bundle.packedContext);
		const errors = collect(bundle.errors);
		const status = collect(bundle.status);

		expect(g.describe().edges).toEqual(
			expect.arrayContaining([
				{ from: "context", to: "packing/projection" },
				{ from: "texts", to: "packing/projection" },
				{ from: "policy", to: "packing/projection" },
				{ from: "packing/projection", to: "packing/packedContext" },
				{ from: "packing/projection", to: "packing/status" },
				{ from: "packing/projection", to: "packing/errors" },
				{ from: "packing/projection", to: "packing/cursor" },
			]),
		);
		expect(data<AgenticMemoryPackedContext>(packed.messages).at(-1)).toMatchObject({
			text: "aaa\n\nbbbb",
			totalChars: 9,
			totalCost: 4,
			truncated: true,
			entries: [
				{ fragmentId: "f1", metadata: { role: "evidence" }, record: { recordId: "r1" } },
				{ fragmentId: "f2", metadata: { role: "procedure" } },
			],
		});
		expect(data<readonly AgenticMemoryContextPackingError[]>(errors.messages).at(-1)).toEqual([
			expect.objectContaining({ code: "missing-text", fragmentId: "f3" }),
		]);
		expect(data<AgenticMemoryContextPackingStatus>(status.messages).at(-1)).toMatchObject({
			state: "partial",
			cursor: { packedEntries: 2, omittedEntries: 1, totalChars: 9, totalCost: 4 },
		});

		policy.set({ maxEntries: 1, includeMetadata: true });
		expect(
			data<AgenticMemoryPackedContext>(packed.messages)
				.at(-1)
				?.entries.map((entry) => entry.fragmentId),
		).toEqual(["f1"]);
		policy.set({ maxChars: 6 });
		expect(
			data<AgenticMemoryPackedContext>(packed.messages)
				.at(-1)
				?.entries.map((entry) => entry.fragmentId),
		).toEqual(["f1"]);
		policy.set({ maxCost: 3 });
		expect(
			data<AgenticMemoryPackedContext>(packed.messages)
				.at(-1)
				?.entries.map((entry) => entry.fragmentId),
		).toEqual(["f1"]);
	});

	it("turns malformed context and text metadata into DATA errors", () => {
		const g = graph();
		const context = g.state(
			{
				...contextFact(),
				entries: [null, { fragmentId: "" }, { fragmentId: "f1", record: { recordId: "r1" } }],
			} as never,
			{ name: "context" },
		);
		const texts = g.state<readonly AgenticMemoryContextText[]>(
			[{ fragmentId: "f1", text: "ok", metadata: ["not", "a", "record"] as never }],
			{ name: "texts" },
		);
		const policy = g.state({ includeMetadata: true }, { name: "policy" });
		const bundle = agenticMemoryContextPackingBundle(g, {
			name: "packing",
			context,
			texts,
			policy,
		});
		const packed = collect(bundle.packedContext);
		const errors = collect(bundle.errors);

		expect(data<AgenticMemoryPackedContext>(packed.messages).at(-1)?.entries).toEqual([]);
		expect(
			data<readonly AgenticMemoryContextPackingError[]>(errors.messages)
				.at(-1)
				?.map((error) => error.code),
		).toEqual(["invalid-context", "invalid-context", "invalid-context", "invalid-text"]);
		expect(errors.messages.some((message) => message[0] === "ERROR")).toBe(false);
	});

	it("keeps throwing context and policy getters on the DATA error path", () => {
		const g = graph();
		const hostileContext = { entries: [{ fragmentId: "f1" }] };
		Object.defineProperty(hostileContext, "query", {
			get() {
				throw new Error("query boom");
			},
			enumerable: true,
		});
		const hostilePolicy = {};
		Object.defineProperty(hostilePolicy, "maxChars", {
			get() {
				throw new Error("policy boom");
			},
			enumerable: true,
		});
		const context = g.state(hostileContext as never, { name: "context" });
		const texts = g.state<readonly AgenticMemoryContextText[]>([{ fragmentId: "f1", text: "ok" }], {
			name: "texts",
		});
		const policy = g.state<AgenticMemoryContextPackingPolicy>(hostilePolicy as never, {
			name: "policy",
		});
		const bundle = agenticMemoryContextPackingBundle(g, {
			name: "packing",
			context,
			texts,
			policy,
		});
		const packed = collect(bundle.packedContext);
		const errors = collect(bundle.errors);

		expect(data<AgenticMemoryPackedContext>(packed.messages).at(-1)?.entries).toEqual([]);
		expect(
			data<readonly AgenticMemoryContextPackingError[]>(errors.messages)
				.at(-1)
				?.map((error) => error.code),
		).toEqual(["invalid-policy"]);
		expect(errors.messages.some((message) => message[0] === "ERROR")).toBe(false);

		policy.set({ includeMetadata: true });
		expect(data<AgenticMemoryPackedContext>(packed.messages).at(-1)?.text).toBe("ok");
	});
});

describe("agentic memory duplicate fragment ownership (D169)", () => {
	it("excludes duplicate fragment records from retrieval, context, metadata, and downstream bundles", () => {
		const g = graph();
		const records = g.state<readonly AgenticMemoryRecord<string>[]>(
			[
				record({ id: "record-a", fragment: fragment({ id: "same", payload: "kept" }) }),
				record({ id: "record-b", fragment: fragment({ id: "same", payload: "dropped" }) }),
			],
			{ name: "records" },
		);
		const query = g.state({}, { name: "query" });
		const memory = agenticMemoryBundle(g, { name: "memory", records, query });
		const drafts = g.state<readonly AgenticMemoryKgAssertionDraft[]>(
			[
				{
					id: "assert-kept",
					recordId: "record-a",
					fragmentId: "same",
					subject: { id: "s" },
					predicate: "p",
					object: { kind: "value", value: "kept" },
				},
				{
					id: "assert-dropped",
					recordId: "record-b",
					fragmentId: "same",
					subject: { id: "s" },
					predicate: "p",
					object: { kind: "value", value: "dropped" },
				},
			],
			{ name: "drafts" },
		);
		const kg = agenticMemoryKgProjectionBundle(g, { name: "kg", records, drafts });
		const commands = g.state<readonly AgenticMemoryRetentionCommand[]>(
			[
				{ id: "archive-dropped", kind: "archive", recordId: "record-b" },
				{ id: "consolidate-dropped", kind: "requestConsolidation", recordIds: ["record-b"] },
			],
			{ name: "commands" },
		);
		const retention = agenticMemoryRetentionBundle(g, { name: "retention", records, commands });
		const projected = collect(memory.fragments);
		const ranked = collect(memory.ranked);
		const context = collect(memory.context);
		const sources = collect(memory.sources);
		const kgAssertions = collect(kg.assertions);
		const kgErrors = collect(kg.errors);
		const active = collect(retention.activeRecords);
		const retentionErrors = collect(retention.errors);

		query.set({});

		expect(
			data<readonly MemoryFragment<string>[]>(projected.messages)
				.at(-1)
				?.map((item) => [item.id, item.payload]),
		).toEqual([["same", "kept"]]);
		expect(
			data<MemoryAnswer<string>>(ranked.messages)
				.at(-1)
				?.results.map((item) => [item.id, item.payload]),
		).toEqual([["same", "kept"]]);
		expect(
			data<AgenticMemoryContext<string>>(context.messages)
				.at(-1)
				?.entries.map((entry) => [entry.fragmentId, entry.payload, entry.record?.recordId]),
		).toEqual([["same", "kept", "record-a"]]);
		expect(data<AgenticMemorySourceProjection[]>(sources.messages).at(-1)).toMatchObject([
			{ fragmentId: "same", record: { recordId: "record-a" } },
		]);
		expect(
			data<readonly unknown[]>(kgAssertions.messages)
				.at(-1)
				?.map((item) => (item as { id: string }).id),
		).toEqual(["assert-kept"]);
		expect(
			data<readonly AgenticMemoryKgProjectionError[]>(kgErrors.messages)
				.at(-1)
				?.map((error) => error.code),
		).toEqual(["duplicate-fragment-id", "missing-record-ref"]);
		expect(
			data<readonly AgenticMemoryRecord<string>[]>(active.messages)
				.at(-1)
				?.map((item) => item.id),
		).toEqual(["record-a"]);
		expect(
			data<readonly AgenticMemoryRetentionError[]>(retentionErrors.messages)
				.at(-1)
				?.map((error) => error.code),
		).toEqual(["duplicate-fragment-id", "missing-record-ref", "missing-record-ref"]);
	});
});
