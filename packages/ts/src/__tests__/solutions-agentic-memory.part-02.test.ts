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
	type AgenticMemoryContextAttribution,
	type AgenticMemoryContextPackingError,
	type AgenticMemoryContextPackingPolicy,
	type AgenticMemoryContextPackingStatus,
	type AgenticMemoryContextText,
	type AgenticMemoryKgAssertionDraft,
	type AgenticMemoryKgProjectionError,
	type AgenticMemoryPackedContext,
	type AgenticMemoryProposalAdmissionDecision,
	type AgenticMemoryProposalAdmissionPolicy,
	type AgenticMemoryRecord,
	type AgenticMemoryRecordAdmission,
	type AgenticMemoryRecordAdmissionPolicy,
	type AgenticMemoryRecordAdmissionStatus,
	type AgenticMemoryRecordApplicationDecision,
	type AgenticMemoryRecordApplicationEvidence,
	type AgenticMemoryRecordApplicationPolicy,
	type AgenticMemoryRecordApplicationStatus,
	type AgenticMemoryRecordProposal,
	type AgenticMemoryRetentionCommand,
	type AgenticMemoryRetentionError,
	type AgenticMemorySourceProjection,
	admitAgenticMemoryRecordProposals,
	agenticMemoryBundle,
	agenticMemoryConsolidationApplicationBundle,
	agenticMemoryConsolidationBundle,
	agenticMemoryContextPackingBundle,
	agenticMemoryKgProjectionBundle,
	agenticMemoryRecordAdmissionBundle,
	agenticMemoryRecordApplicationBundle,
	agenticMemoryRetentionBundle,
	applyAgenticMemoryRecordAdmissions,
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

const admitted = <T = string>(
	patch: Partial<AgenticMemoryRecordAdmission<T>> = {},
): AgenticMemoryRecordAdmission<T> => ({
	kind: "agentic-memory-record-admission",
	admissionId: "admission-1",
	proposalId: "proposal-1",
	state: "admitted",
	candidateMaterial: {
		kind: "agentic-memory-record-candidate-material",
		record: record({ id: "record-new", fragment: fragment({ id: "fragment-new" }) }),
		sourceRefs: [{ kind: "import", id: "import-1" }],
	},
	sourceRefs: [{ kind: "review", id: "review-1" }],
	policyRefs: [{ kind: "admission-policy", id: "policy-1" }],
	...patch,
});

const applicationPolicy = (
	patch: Partial<AgenticMemoryRecordApplicationPolicy> = {},
): AgenticMemoryRecordApplicationPolicy => ({
	kind: "agentic-memory-record-application-policy",
	policyId: "application-policy",
	...patch,
});

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
		const proposals = collect(bundle.recordProposals);
		const commands = collect(bundle.commands);
		const results = collect(bundle.results);
		const status = collect(bundle.status);
		const errors = collect(bundle.errors);
		const draftId = compoundTupleKey("agentic-memory-record-draft", [
			"request-1",
			"outcome-1",
			"record-merged",
		]);
		const proposalId = compoundTupleKey("agentic-memory-record-proposal", [
			"request-1",
			"outcome-1",
			"record-merged",
		]);
		const consolidationRefs = [
			{ kind: "agentic-memory-consolidation-request", id: "request-1" },
			{ kind: "agentic-memory-consolidation-outcome", id: "outcome-1" },
			{ kind: "agentic-memory-consolidation-record-draft", id: draftId },
		];

		expect(g.describe().edges).toEqual(
			expect.arrayContaining([
				{ from: "records", to: "consolidation/projection" },
				{ from: "requests", to: "consolidation/projection" },
				{ from: "outcomes", to: "consolidation/projection" },
				{ from: "consolidation/projection", to: "consolidation/results" },
				{ from: "consolidation/projection", to: "consolidation/proposedRecordDrafts" },
				{ from: "consolidation/projection", to: "consolidation/recordProposals" },
				{ from: "consolidation/projection", to: "consolidation/commands" },
			]),
		);
		expect(data(errors.messages).at(-1)).toEqual([]);
		expect(data(status.messages).at(-1)).toMatchObject({
			state: "ready",
			cursor: {
				validOutcomes: 1,
				invalidOutcomes: 0,
				proposedRecordDrafts: 1,
				recordProposals: 1,
			},
		});
		expect(data(drafts.messages).at(-1)).toEqual([
			expect.objectContaining({
				id: draftId,
				requestId: "request-1",
				outcomeId: "outcome-1",
				record: expect.objectContaining({ id: "record-merged" }),
				proposalId,
				candidateMaterial: expect.objectContaining({
					kind: "agentic-memory-record-candidate-material",
					record: expect.objectContaining({ id: "record-merged" }),
					sourceRefs: consolidationRefs,
					evidenceRefs: consolidationRefs,
				}),
			}),
		]);
		expect(data<readonly AgenticMemoryRecordProposal<string>[]>(proposals.messages).at(-1)).toEqual(
			[
				{
					kind: "agentic-memory-record-proposal",
					proposalId,
					candidateMaterial: expect.objectContaining({
						kind: "agentic-memory-record-candidate-material",
						record: expect.objectContaining({
							id: "record-merged",
							fragment: expect.objectContaining({ id: "merged", payload: "merged insight" }),
						}),
						sourceRefs: consolidationRefs,
						evidenceRefs: consolidationRefs,
					}),
					reason: "merge",
					proposalStatus: "consolidation-proposed",
					sourceRefs: consolidationRefs,
					evidenceRefs: consolidationRefs,
					idempotencyKey: proposalId,
					correlationId: "request-1",
					causationId: "outcome-1",
				},
			],
		);
		expect(data(results.messages).at(-1)).toEqual([
			expect.objectContaining({
				state: "proposed",
				proposedRecordIds: ["record-merged"],
				proposalIds: [proposalId],
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
				draftIds: [draftId],
				proposalIds: [proposalId],
			},
		]);
	});

	it("composes consolidation proposals through admission and application into record truth", () => {
		const g = graph();
		const records = g.state<readonly AgenticMemoryRecord<string>[]>(
			[
				record({ id: "record-a", fragment: fragment({ id: "a" }) }),
				record({ id: "record-b", fragment: fragment({ id: "b" }) }),
			],
			{ name: "records" },
		);
		const requests = g.state<readonly AgenticMemoryConsolidationRequest[]>(
			[{ id: "request-1", commandId: "cmd-1", recordIds: ["record-a", "record-b"] }],
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
							fragment: fragment({ id: "merged", payload: "merged insight" }),
						}),
					],
				},
			],
			{ name: "outcomes" },
		);
		const admissionPolicy = g.state<AgenticMemoryRecordAdmissionPolicy>(
			{
				kind: "agentic-memory-record-admission-policy",
				policyId: "admission-policy",
				defaultState: "admitted",
				requireSourceRefs: true,
			},
			{ name: "admissionPolicy" },
		);
		const applicationPolicyNode = g.state<AgenticMemoryRecordApplicationPolicy>(
			applicationPolicy(),
			{ name: "applicationPolicy" },
		);
		const bundle = agenticMemoryConsolidationApplicationBundle(g, {
			name: "consolidationApplication",
			records,
			requests,
			outcomes,
			admissionPolicy,
			applicationPolicy: applicationPolicyNode,
		});
		const nextRecords = collect(bundle.records);
		const admitted = collect(bundle.admission.admitted);
		const decisions = collect(bundle.applicationDecisions);
		const status = collect(bundle.applicationStatus);
		const issues = collect(bundle.applicationIssues);

		expect(g.describe().edges).toEqual(
			expect.arrayContaining([
				{
					from: "consolidationApplication/consolidation/recordProposals",
					to: "consolidationApplication/admission/projection",
				},
				{
					from: "consolidationApplication/admission/admissions",
					to: "consolidationApplication/application/projection",
				},
				{ from: "records", to: "consolidationApplication/application/projection" },
				{
					from: "consolidationApplication/application/projection",
					to: "consolidationApplication/application/records",
				},
			]),
		);
		expect(data<readonly AgenticMemoryRecordAdmission<string>[]>(admitted.messages).at(-1)).toEqual(
			[expect.objectContaining({ proposalId: expect.stringContaining("record-merged") })],
		);
		expect(
			data<readonly AgenticMemoryRecord<string>[]>(nextRecords.messages)
				.at(-1)
				?.map((r) => r.id),
		).toEqual(["record-a", "record-b", "record-merged"]);
		expect(
			data<readonly AgenticMemoryRecordApplicationDecision<string>[]>(decisions.messages)
				.at(-1)
				?.map((decision) => decision.state),
		).toEqual(["applied"]);
		expect(data<AgenticMemoryRecordApplicationStatus>(status.messages).at(-1)).toMatchObject({
			state: "ready",
			cursor: { applied: 1, rejected: 0, skipped: 0 },
		});
		expect(data(issues.messages).at(-1)).toEqual([]);
		expect(records.cache?.map((item) => item.id)).toEqual(["record-a", "record-b"]);
	});

	it("does not apply consolidation proposals that admission rejects", () => {
		const g = graph();
		const records = g.state<readonly AgenticMemoryRecord<string>[]>(
			[record({ id: "record-a", fragment: fragment({ id: "a" }) })],
			{ name: "records" },
		);
		const requests = g.state<readonly AgenticMemoryConsolidationRequest[]>(
			[{ id: "request-1", commandId: "cmd-1", recordIds: ["record-a"] }],
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
							fragment: fragment({ id: "merged", payload: "merged insight" }),
						}),
					],
				},
			],
			{ name: "outcomes" },
		);
		const admissionPolicy = g.state<AgenticMemoryRecordAdmissionPolicy>(
			{
				kind: "agentic-memory-record-admission-policy",
				policyId: "admission-policy",
				defaultState: "rejected",
			},
			{ name: "admissionPolicy" },
		);
		const applicationPolicyNode = g.state<AgenticMemoryRecordApplicationPolicy>(
			applicationPolicy(),
			{ name: "applicationPolicy" },
		);
		const bundle = agenticMemoryConsolidationApplicationBundle(g, {
			name: "consolidationApplication",
			records,
			requests,
			outcomes,
			admissionPolicy,
			applicationPolicy: applicationPolicyNode,
		});
		const nextRecords = collect(bundle.records);
		const admissions = collect(bundle.admission.admissions);
		const decisions = collect(bundle.applicationDecisions);
		const status = collect(bundle.applicationStatus);

		expect(
			data<readonly AgenticMemoryRecordAdmission<string>[]>(admissions.messages).at(-1),
		).toEqual([expect.objectContaining({ state: "rejected" })]);
		expect(
			data<readonly AgenticMemoryRecord<string>[]>(nextRecords.messages)
				.at(-1)
				?.map((r) => r.id),
		).toEqual(["record-a"]);
		expect(
			data<readonly AgenticMemoryRecordApplicationDecision<string>[]>(decisions.messages)
				.at(-1)
				?.map((decision) => decision.state),
		).toEqual(["skipped"]);
		expect(data<AgenticMemoryRecordApplicationStatus>(status.messages).at(-1)).toMatchObject({
			state: "blocked",
			cursor: { applied: 0, skipped: 1 },
		});
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
		const proposals = collect(bundle.recordProposals);

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
			cursor: { validOutcomes: 0, invalidOutcomes: 2, proposedRecordDrafts: 0, recordProposals: 0 },
		});
		expect(data<readonly AgenticMemoryRecordProposal[]>(proposals.messages).at(-1)).toEqual([]);
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
					candidateMaterial: {
						kind: "agentic-memory-record-candidate-material",
						record: record({
							id: "record-new",
							fragment: fragment({ id: "new", payload: "new insight" }),
						}),
					},
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
					candidateMaterial: expect.objectContaining({
						record: expect.objectContaining({ id: "record-new" }),
					}),
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
					candidateMaterial: {
						kind: "agentic-memory-record-candidate-material",
						record: record({
							id: "record-existing",
							fragment: fragment({ id: "replacement" }),
						}),
					},
					sourceRefs: [{ kind: "import", id: "import-1" }],
				},
				{
					kind: "agentic-memory-record-proposal",
					proposalId: "missing-source",
					candidateMaterial: {
						kind: "agentic-memory-record-candidate-material",
						record: record({
							id: "record-new",
							fragment: fragment({ id: "new" }),
						}),
					},
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
				candidateMaterial: {
					kind: "agentic-memory-record-candidate-material",
					record: record({ id: "", fragment: fragment({ id: "" }) }),
				},
				sourceRefs: [{ kind: "import", id: "import-1" }],
			},
			{
				kind: "agentic-memory-record-proposal",
				proposalId: "unreadable",
				candidateMaterial: {
					kind: "agentic-memory-record-candidate-material",
					record: record({ id: "unreadable", fragment: fragment({ id: "unreadable" }) }),
				},
			},
			{
				kind: "agentic-memory-record-proposal",
				proposalId: "runtime-field",
				candidateMaterial: {
					kind: "agentic-memory-record-candidate-material",
					record: record({
						id: "runtime-field",
						fragment: fragment({ id: "runtime-field" }),
					}),
					attribution: {
						fragmentId: "runtime-field",
						recordId: "runtime-field",
						permission: "nope",
						graph: "nope",
					},
				},
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
				"candidateMaterial: candidateMaterial.attribution.permission is not graph-visible DATA",
				"candidateMaterial: candidateMaterial.attribution.graph is not graph-visible DATA",
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
					candidateMaterial: {
						kind: "agentic-memory-record-candidate-material",
						record: record({ id: "record-new", fragment: fragment({ id: "new" }) }),
					},
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
		const rejected = collect(bundle.rejected);
		const issues = collect(bundle.issues);
		const status = collect(bundle.status);

		expect(data<readonly AgenticMemoryRecordAdmission<string>[]>(rejected.messages).at(-1)).toEqual(
			[
				expect.objectContaining({
					proposalId: "proposal-1",
					state: "rejected",
					reason: "policy:invalid-policy",
				}),
			],
		);
		const latestIssues = data<readonly { readonly code: string; readonly details?: unknown }[]>(
			issues.messages,
		).at(-1);
		expect(latestIssues).toEqual([
			expect.objectContaining({ code: "agentic-memory.admission-policy.invalid" }),
		]);
		expect(latestIssues?.every((issue) => !Object.hasOwn(issue, "details"))).toBe(true);
		expect(data<AgenticMemoryRecordAdmissionStatus>(status.messages).at(-1)).toMatchObject({
			state: "partial",
			cursor: { validProposals: 1, invalidProposals: 0, invalidPolicies: 1, rejected: 1 },
		});
		expect(issues.messages.some((message) => message[0] === "ERROR")).toBe(false);
	});

	it("exposes a deterministic pure proposal admission helper", () => {
		const proposals: readonly AgenticMemoryRecordProposal<string>[] = [
			{
				kind: "agentic-memory-record-proposal",
				proposalId: "proposal:a",
				candidateMaterial: {
					kind: "agentic-memory-record-candidate-material",
					record: record({ id: "record:a", fragment: fragment({ id: "fragment:a" }) }),
					sourceRefs: [{ kind: "candidate", id: "source:a" }],
				},
				sourceRefs: [{ kind: "proposal", id: "source:b" }],
				policyRefs: [{ kind: "proposal-policy", id: "policy:a" }],
				evidenceRefs: [{ kind: "evidence", id: "evidence:a" }],
				idempotencyKey: "idem:a",
				correlationId: "corr:a",
			},
			{
				kind: "agentic-memory-record-proposal",
				proposalId: "proposal:b",
				candidateMaterial: {
					kind: "agentic-memory-record-candidate-material",
					record: record({ id: "record:b", fragment: fragment({ id: "fragment:b" }) }),
				},
				sourceRefs: [{ kind: "proposal", id: "source:c" }],
			},
		];
		const policy: AgenticMemoryProposalAdmissionPolicy = {
			kind: "agentic-memory-record-admission-policy",
			policyId: "policy:a",
			defaultState: "admitted",
			requireSourceRefs: true,
			policyRefs: [{ kind: "policy", id: "policy:b" }],
		};

		const snapshot = admitAgenticMemoryRecordProposals(proposals, policy, {
			records: [record({ id: "record:b", fragment: fragment({ id: "existing-b" }) })],
			evaluation: 7,
		});

		expect(snapshot.admissions.map((admission) => admission.proposalId)).toEqual([
			"proposal:a",
			"proposal:b",
		]);
		expect(snapshot.admitted).toEqual([
			expect.objectContaining<Partial<AgenticMemoryProposalAdmissionDecision<string>>>({
				admissionId: 'admission:["policy:a","proposal:a"]',
				state: "admitted",
				idempotencyKey: "idem:a",
				correlationId: "corr:a",
				sourceRefs: [
					{ kind: "candidate", id: "source:a" },
					{ kind: "proposal", id: "source:b" },
				],
				evidenceRefs: [{ kind: "evidence", id: "evidence:a" }],
			}),
		]);
		expect(snapshot.rejected).toEqual([
			expect.objectContaining({
				admissionId: 'admission:["policy:a","proposal:b"]',
				proposalId: "proposal:b",
				state: "rejected",
				reason: "candidate record id already exists",
			}),
		]);
		expect(snapshot.status).toMatchObject({
			state: "ready",
			cursor: { evaluation: 7, admitted: 1, rejected: 1, needsReview: 0, issues: 0 },
		});
		expect(snapshot.audit.map((entry) => entry.admissionId)).toEqual([
			'admission:["policy:a","proposal:a"]',
			'admission:["policy:a","proposal:b"]',
		]);
	});

	it("freezes malformed proposal input snapshots", () => {
		const snapshot = admitAgenticMemoryRecordProposals("not-proposals", {
			kind: "agentic-memory-record-admission-policy",
			policyId: "policy:a",
			defaultState: "admitted",
		});

		expect(snapshot.status).toMatchObject({
			state: "error",
			cursor: { invalidProposals: 1, validProposals: 0 },
		});
		expect(Object.isFrozen(snapshot.admissions)).toBe(true);
		expect(Object.isFrozen(snapshot.admitted)).toBe(true);
		expect(Object.isFrozen(snapshot.rejected)).toBe(true);
		expect(Object.isFrozen(snapshot.needsReview)).toBe(true);
		expect(Object.isFrozen(snapshot.issues)).toBe(true);
		expect(Object.isFrozen(snapshot.audit)).toBe(true);
	});

	it("reports malformed helper records as DATA issues without throwing", () => {
		const hostileRecord = Object.defineProperty({}, "id", {
			get() {
				throw new Error("hostile id");
			},
		}) as AgenticMemoryRecord<string>;

		const snapshot = admitAgenticMemoryRecordProposals(
			[
				{
					kind: "agentic-memory-record-proposal",
					proposalId: "proposal:a",
					candidateMaterial: {
						kind: "agentic-memory-record-candidate-material",
						record: record({ id: "record:a", fragment: fragment({ id: "fragment:a" }) }),
					},
					sourceRefs: [{ kind: "import", id: "import:a" }],
				},
			],
			{
				kind: "agentic-memory-record-admission-policy",
				policyId: "policy:a",
				defaultState: "admitted",
				requireSourceRefs: true,
			},
			{ records: [hostileRecord] },
		);

		expect(snapshot.admitted).toEqual([expect.objectContaining({ proposalId: "proposal:a" })]);
		expect(snapshot.issues).toEqual([
			expect.objectContaining({
				code: "agentic-memory.record.invalid",
				message: "agenticMemoryBundle: record access failed: hostile id",
			}),
		]);
		expect(snapshot.status).toMatchObject({
			state: "partial",
			cursor: { admitted: 1, issues: 1 },
		});
	});

	it("fails closed when admission policy material is missing", () => {
		const snapshot = admitAgenticMemoryRecordProposals(
			[
				{
					kind: "agentic-memory-record-proposal",
					proposalId: "proposal-1",
					candidateMaterial: {
						kind: "agentic-memory-record-candidate-material",
						record: record({ id: "record-new", fragment: fragment({ id: "new" }) }),
					},
				},
			],
			undefined,
		);

		expect(snapshot.rejected).toEqual([
			expect.objectContaining({
				proposalId: "proposal-1",
				state: "rejected",
				admissionId: 'admission:["invalid-policy","proposal-1"]',
			}),
		]);
		expect(snapshot.issues).toEqual([
			expect.objectContaining({ code: "agentic-memory.admission-policy.invalid" }),
		]);
		expect(snapshot.status).toMatchObject({
			state: "partial",
			cursor: { invalidPolicies: 1, rejected: 1, admitted: 0 },
		});
	});

	it("fails closed when proposal and candidate target ids conflict", () => {
		const snapshot = admitAgenticMemoryRecordProposals(
			[
				{
					kind: "agentic-memory-record-proposal",
					proposalId: "proposal-1",
					targetRecordId: "record-target-a",
					candidateMaterial: {
						kind: "agentic-memory-record-candidate-material",
						record: record({ id: "record-new", fragment: fragment({ id: "new" }) }),
						targetRecordId: "record-target-b",
					},
					sourceRefs: [{ kind: "import", id: "import-1" }],
				},
			],
			{
				kind: "agentic-memory-record-admission-policy",
				policyId: "policy-1",
				defaultState: "admitted",
			},
		);

		expect(snapshot.admissions).toEqual([]);
		expect(snapshot.issues).toEqual([
			expect.objectContaining({
				code: "agentic-memory.proposal.invalid",
				refs: expect.arrayContaining([
					"proposal.targetRecordId conflicts with candidateMaterial.targetRecordId",
				]),
			}),
		]);
		expect(snapshot.status).toMatchObject({
			state: "error",
			cursor: { validProposals: 0, invalidProposals: 1, admitted: 0 },
		});
	});

	it("rejects duplicate target record ids within one proposal batch", () => {
		const snapshot = admitAgenticMemoryRecordProposals(
			[
				{
					kind: "agentic-memory-record-proposal",
					proposalId: "first",
					targetRecordId: "record-target",
					candidateMaterial: {
						kind: "agentic-memory-record-candidate-material",
						record: record({ id: "candidate-a", fragment: fragment({ id: "candidate-a" }) }),
					},
					sourceRefs: [{ kind: "import", id: "import-a" }],
				},
				{
					kind: "agentic-memory-record-proposal",
					proposalId: "second",
					targetRecordId: "record-target",
					candidateMaterial: {
						kind: "agentic-memory-record-candidate-material",
						record: record({ id: "candidate-b", fragment: fragment({ id: "candidate-b" }) }),
					},
					sourceRefs: [{ kind: "import", id: "import-b" }],
				},
			],
			{
				kind: "agentic-memory-record-admission-policy",
				policyId: "policy-1",
				defaultState: "admitted",
				requireSourceRefs: true,
			},
		);

		expect(snapshot.admitted).toEqual([
			expect.objectContaining({ proposalId: "first", targetRecordId: "record-target" }),
		]);
		expect(snapshot.issues).toEqual([
			expect.objectContaining({
				code: "agentic-memory.proposal.duplicate-target-record-id",
				subjectId: "second",
				refs: ["record-target"],
			}),
		]);
		expect(snapshot.status).toMatchObject({
			state: "partial",
			cursor: { validProposals: 1, invalidProposals: 1, admitted: 1 },
		});
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
					candidateMaterial: {
						kind: "agentic-memory-record-candidate-material",
						record: record({ id: "record-new", fragment: fragment({ id: "new" }) }),
					},
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

	it("preserves candidateMaterial attribution through bundle and pure admission", () => {
		const attribution: AgenticMemoryContextAttribution = {
			kind: "agentic-memory-context-attribution",
			fragmentId: "new",
			recordId: "record-new",
			queryId: "query-1",
			rank: 3,
			score: 12.5,
			truncated: true,
			truncation: {
				originalChars: 100,
				packedChars: 40,
				omittedChars: 60,
				originalCost: 50,
				packedCost: 20,
				omittedCost: 30,
				reason: "budget",
				metadata: { mode: "fixture" },
			},
			sourceRefs: [{ kind: "context-entry", id: "context-1", metadata: { rank: 3 } }],
			policyRefs: [{ kind: "context-policy", id: "policy-1" }],
			metadata: { nested: { retained: true } },
		};
		const proposals: readonly AgenticMemoryRecordProposal<string>[] = [
			{
				kind: "agentic-memory-record-proposal",
				proposalId: "proposal-1",
				candidateMaterial: {
					kind: "agentic-memory-record-candidate-material",
					record: record({
						id: "record-new",
						scope: { projectId: "project-1" },
						fragment: fragment({ id: "new", payload: "new insight" }),
					}),
					attribution,
					sourceRefs: [{ kind: "candidate-source", id: "candidate-source-1" }],
					policyRefs: [{ kind: "candidate-policy", id: "candidate-policy-1" }],
					evidenceRefs: [{ kind: "candidate-evidence", id: "candidate-evidence-1" }],
					metadata: { candidate: { ok: true } },
				},
				sourceRefs: [{ kind: "proposal-source", id: "proposal-source-1" }],
			},
		];
		const policy: AgenticMemoryProposalAdmissionPolicy = {
			kind: "agentic-memory-record-admission-policy",
			policyId: "admission-policy",
			defaultState: "admitted",
		};
		const helperSnapshot = admitAgenticMemoryRecordProposals(proposals, policy);
		expect(helperSnapshot.admitted[0]?.candidateMaterial.attribution).toEqual(attribution);
		expect(helperSnapshot.admitted[0]?.candidateMaterial.record.scope).toEqual({
			projectId: "project-1",
		});
		expect(Object.isFrozen(helperSnapshot.admitted[0]?.candidateMaterial.attribution)).toBe(true);
		expect(
			Object.isFrozen(helperSnapshot.admitted[0]?.candidateMaterial.attribution?.metadata?.nested),
		).toBe(true);

		const g = graph();
		const records = g.state<readonly AgenticMemoryRecord<string>[]>([], { name: "records" });
		const proposalNode = g.state(proposals, { name: "proposals" });
		const policyNode = g.state(policy, { name: "policy" });
		const bundle = agenticMemoryRecordAdmissionBundle(g, {
			name: "admission",
			records,
			proposals: proposalNode,
			policy: policyNode,
		});
		const admitted = collect(bundle.admitted);

		expect(
			data<readonly AgenticMemoryRecordAdmission<string>[]>(admitted.messages).at(-1)?.[0]
				?.candidateMaterial,
		).toEqual(
			expect.objectContaining({
				attribution,
				sourceRefs: [{ kind: "candidate-source", id: "candidate-source-1" }],
				policyRefs: [{ kind: "candidate-policy", id: "candidate-policy-1" }],
				evidenceRefs: [{ kind: "candidate-evidence", id: "candidate-evidence-1" }],
				metadata: { candidate: { ok: true } },
			}),
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
					candidateMaterial: {
						kind: "agentic-memory-record-candidate-material",
						record: record({ id: "record-dupe", fragment: fragment({ id: "dupe-a" }) }),
					},
					sourceRefs: [{ kind: "import", id: "import-a" }],
				},
				{
					kind: "agentic-memory-record-proposal",
					proposalId: "second",
					candidateMaterial: {
						kind: "agentic-memory-record-candidate-material",
						record: record({ id: "record-dupe", fragment: fragment({ id: "dupe-b" }) }),
					},
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

describe("agentic memory record application projector (D577)", () => {
	it("applies admitted create proposals and emits a full next records snapshot", () => {
		const current = [record({ id: "record-existing", fragment: fragment({ id: "existing" }) })];
		const admission = admitted({
			admissionId: "admission-create",
			proposalId: "proposal-create",
			candidateMaterial: {
				kind: "agentic-memory-record-candidate-material",
				record: record({
					id: "record-created",
					fragment: fragment({ id: "created", payload: "created insight" }),
				}),
				metadata: { nested: { ok: true } },
			},
			idempotencyKey: "idem-create",
		});

		const snapshot = applyAgenticMemoryRecordAdmissions([admission], applicationPolicy(), {
			records: current,
			evaluation: 9,
		});

		expect(snapshot.records.map((item) => item.id)).toEqual(["record-existing", "record-created"]);
		expect(snapshot.appliedRecords.map((item) => item.id)).toEqual(["record-created"]);
		expect(snapshot.applicationDecisions).toEqual([
			expect.objectContaining<Partial<AgenticMemoryRecordApplicationDecision<string>>>({
				applicationId:
					'agentic-memory-record-application:["application-policy","admission-create"]',
				admissionId: "admission-create",
				proposalId: "proposal-create",
				state: "applied",
				reasonCode: "applied-create",
				record: expect.objectContaining({ id: "record-created" }),
				idempotencyKey: "idem-create",
			}),
		]);
		expect(snapshot.status).toMatchObject({
			state: "ready",
			cursor: { evaluation: 9, applied: 1, skipped: 0, rejected: 0, issues: 0 },
		});
		expect(snapshot.issues).toEqual([]);
		expect(Object.isFrozen(snapshot.records)).toBe(true);
		expect(Object.isFrozen(snapshot.appliedRecords)).toBe(true);
		expect(Object.isFrozen(snapshot.applicationDecisions)).toBe(true);
		expect(Object.isFrozen(snapshot.applicationDecisions[0]?.candidateMaterial)).toBe(true);
		expect(Object.isFrozen(snapshot.audit[0])).toBe(true);
		expect(current.map((item) => item.id)).toEqual(["record-existing"]);
	});

	it("exposes graph-visible topology and projection subnodes", () => {
		const g = graph();
		const records = g.state<readonly AgenticMemoryRecord<string>[]>([], { name: "records" });
		const admissions = g.state<readonly AgenticMemoryRecordAdmission<string>[]>(
			[admitted({ admissionId: "admission-create" })],
			{ name: "admissions" },
		);
		const policy = g.state<AgenticMemoryRecordApplicationPolicy>(applicationPolicy(), {
			name: "policy",
		});
		const history = g.state<readonly AgenticMemoryRecordApplicationEvidence[]>([], {
			name: "history",
		});
		const bundle = agenticMemoryRecordApplicationBundle(g, {
			name: "application",
			records,
			admissions,
			policy,
			history,
		});
		const nextRecords = collect(bundle.records);
		const appliedRecords = collect(bundle.appliedRecords);
		const status = collect(bundle.status);
		const decisions = collect(bundle.applicationDecisions);

		expect(g.describe().edges).toEqual(
			expect.arrayContaining([
				{ from: "records", to: "application/projection" },
				{ from: "admissions", to: "application/projection" },
				{ from: "policy", to: "application/projection" },
				{ from: "history", to: "application/projection" },
				{ from: "application/projection", to: "application/records" },
				{ from: "application/projection", to: "application/appliedRecords" },
				{ from: "application/projection", to: "application/applicationDecisions" },
				{ from: "application/projection", to: "application/status" },
			]),
		);
		expect(data<readonly AgenticMemoryRecord<string>[]>(nextRecords.messages).at(-1)).toEqual([
			expect.objectContaining({ id: "record-new" }),
		]);
		expect(data<readonly AgenticMemoryRecord<string>[]>(appliedRecords.messages).at(-1)).toEqual([
			expect.objectContaining({ id: "record-new" }),
		]);
		expect(
			data<readonly AgenticMemoryRecordApplicationDecision<string>[]>(decisions.messages).at(-1),
		).toEqual([expect.objectContaining({ state: "applied" })]);
		expect(data<AgenticMemoryRecordApplicationStatus>(status.messages).at(-1)).toMatchObject({
			state: "ready",
			cursor: { applied: 1 },
		});
	});

	it("keeps admission as proposal-only until the application projector consumes it", () => {
		const g = graph();
		const records = g.state<readonly AgenticMemoryRecord<string>[]>(
			[record({ id: "record-existing", fragment: fragment({ id: "existing" }) })],
			{ name: "records" },
		);
		const proposals = g.state<readonly AgenticMemoryRecordProposal<string>[]>(
			[
				{
					kind: "agentic-memory-record-proposal",
					proposalId: "proposal-create",
					candidateMaterial: {
						kind: "agentic-memory-record-candidate-material",
						record: record({ id: "record-created", fragment: fragment({ id: "created" }) }),
					},
					sourceRefs: [{ kind: "import", id: "import-1" }],
				},
			],
			{ name: "proposals" },
		);
		const admissionPolicy = g.state<AgenticMemoryRecordAdmissionPolicy>(
			{
				kind: "agentic-memory-record-admission-policy",
				policyId: "admission-policy",
				defaultState: "admitted",
			},
			{ name: "admission-policy" },
		);
		const admissionBundle = agenticMemoryRecordAdmissionBundle(g, {
			name: "admission",
			records,
			proposals,
			policy: admissionPolicy,
		});
		const admittedFacts = collect(admissionBundle.admitted);

		expect(records.cache?.map((item) => item.id)).toEqual(["record-existing"]);
		expect(Object.hasOwn(admissionBundle, "records")).toBe(false);

		const applicationPolicyNode = g.state<AgenticMemoryRecordApplicationPolicy>(
			applicationPolicy(),
			{ name: "application-policy" },
		);
		const application = agenticMemoryRecordApplicationBundle(g, {
			name: "application",
			records,
			admissions: admissionBundle.admitted,
			policy: applicationPolicyNode,
		});
		const nextRecords = collect(application.records);

		expect(
			data<readonly AgenticMemoryRecordAdmission<string>[]>(admittedFacts.messages)
				.at(-1)
				?.map((item) => item.proposalId),
		).toEqual(["proposal-create"]);
		expect(
			data<readonly AgenticMemoryRecord<string>[]>(nextRecords.messages)
				.at(-1)
				?.map((item) => item.id),
		).toEqual(["record-existing", "record-created"]);
		expect(records.cache?.map((item) => item.id)).toEqual(["record-existing"]);
	});

	it("skips rejected and needs-review admissions without protocol ERROR", () => {
		const g = graph();
		const records = g.state<readonly AgenticMemoryRecord<string>[]>([], { name: "records" });
		const admissions = g.state<readonly AgenticMemoryRecordAdmission<string>[]>(
			[
				admitted({
					admissionId: "admission-rejected",
					proposalId: "proposal-rejected",
					state: "rejected",
				}),
				admitted({
					admissionId: "admission-review",
					proposalId: "proposal-review",
					state: "needs-review",
				}),
			],
			{ name: "admissions" },
		);
		const policy = g.state<AgenticMemoryRecordApplicationPolicy>(applicationPolicy(), {
			name: "policy",
		});
		const bundle = agenticMemoryRecordApplicationBundle(g, { records, admissions, policy });
		const decisions = collect(bundle.applicationDecisions);
		const issues = collect(bundle.issues);
		const status = collect(bundle.status);

		expect(
			data<readonly AgenticMemoryRecordApplicationDecision<string>[]>(decisions.messages)
				.at(-1)
				?.map((decision) => [decision.proposalId, decision.state, decision.reasonCode]),
		).toEqual([
			["proposal-rejected", "skipped", "skipped-non-admitted"],
			["proposal-review", "skipped", "skipped-non-admitted"],
		]);
		expect(data(issues.messages).at(-1)).toEqual([]);
		expect(data<AgenticMemoryRecordApplicationStatus>(status.messages).at(-1)).toMatchObject({
			state: "blocked",
			cursor: { applied: 0, skipped: 2, rejected: 0, issues: 0 },
		});
		expect(decisions.messages.some((message) => message[0] === "ERROR")).toBe(false);
		expect(issues.messages.some((message) => message[0] === "ERROR")).toBe(false);
	});

	it("reports invalid policy, history, admission, and candidate material as DATA issues", () => {
		const hostileHistory = {
			kind: "agentic-memory-record-application-history",
			entries: [
				{
					kind: "agentic-memory-record-application-evidence",
					admissionId: "admission-1",
					recordId: "record-new",
					fragmentId: "fragment-new",
					storageKey: "nope",
				},
			],
			providerHandle: "nope",
		};
		const snapshot = applyAgenticMemoryRecordAdmissions(
			[
				{
					kind: "agentic-memory-record-admission",
					admissionId: "bad-admission",
					proposalId: "proposal-1",
					state: "admitted",
					candidateMaterial: {
						kind: "agentic-memory-record-candidate-material",
						record: record({ id: "bad-record", fragment: fragment({ id: "bad-record" }) }),
						attribution: { graph: "nope" },
					},
				},
			],
			{
				kind: "agentic-memory-record-application-policy",
				policyId: "bad-policy",
				requireAdmittedState: false,
				rejectDuplicateRecordIds: false,
				rejectDuplicateFragmentIds: false,
				storageKey: "nope",
			},
			{ history: hostileHistory as never },
		);

		expect(snapshot.records).toEqual([]);
		expect(snapshot.appliedRecords).toEqual([]);
		expect(snapshot.applicationDecisions).toEqual([]);
		expect(snapshot.issues.map((issue) => issue.code)).toEqual([
			"agentic-memory.application-policy.invalid",
			"agentic-memory.application-history.invalid",
			"agentic-memory.application-history.invalid-entry",
			"agentic-memory.application.invalid-admission",
		]);
		expect(snapshot.status).toMatchObject({
			state: "error",
			cursor: { applied: 0, validAdmissions: 0, invalidAdmissions: 1 },
		});
	});

	it("keeps hostile history getters and unsafe input lengths on the DATA issue path", () => {
		const hostileHistory = {
			kind: "agentic-memory-record-application-history",
			entries: [],
		};
		Object.defineProperty(hostileHistory, "entries", {
			get() {
				throw new Error("history getter exploded");
			},
			enumerable: true,
		});
		const hostileAdmissions = new Proxy([], {
			get(target, prop, receiver) {
				if (prop === "length") throw new Error("admissions length exploded");
				return Reflect.get(target, prop, receiver);
			},
		});
		const hostileRecords = new Proxy([], {
			get(target, prop, receiver) {
				if (prop === "length") throw new Error("records length exploded");
				return Reflect.get(target, prop, receiver);
			},
		});

		const snapshot = applyAgenticMemoryRecordAdmissions(hostileAdmissions, applicationPolicy(), {
			records: hostileRecords,
			history: hostileHistory,
		});

		expect(snapshot.issues.map((issue) => issue.code)).toEqual([
			"agentic-memory.record.invalid",
			"agentic-memory.application-history.invalid",
			"agentic-memory.application.invalid-admissions-input",
		]);
		expect(snapshot.status).toMatchObject({
			state: "error",
			cursor: { records: 0, admissions: 0, invalidAdmissions: 1, invalidHistoryEntries: 1 },
		});
	});

	it("rejects unsupported update targets and duplicate record or fragment ids as DATA issues", () => {
		const current = [
			record({ id: "record-existing", fragment: fragment({ id: "fragment-existing" }) }),
		];
		const snapshot = applyAgenticMemoryRecordAdmissions(
			[
				admitted({
					admissionId: "target-update",
					proposalId: "target-update",
					targetRecordId: "other-record",
					candidateMaterial: {
						kind: "agentic-memory-record-candidate-material",
						record: record({ id: "record-target", fragment: fragment({ id: "fragment-target" }) }),
					},
				}),
				admitted({
					admissionId: "duplicate-record",
					proposalId: "duplicate-record",
					candidateMaterial: {
						kind: "agentic-memory-record-candidate-material",
						record: record({ id: "record-existing", fragment: fragment({ id: "fragment-new" }) }),
					},
				}),
				admitted({
					admissionId: "duplicate-fragment",
					proposalId: "duplicate-fragment",
					candidateMaterial: {
						kind: "agentic-memory-record-candidate-material",
						record: record({
							id: "record-with-duplicate-fragment",
							fragment: fragment({ id: "fragment-existing" }),
						}),
					},
				}),
				admitted({
					admissionId: "first-create",
					proposalId: "first-create",
					idempotencyKey: "first-create",
					candidateMaterial: {
						kind: "agentic-memory-record-candidate-material",
						record: record({ id: "record-created", fragment: fragment({ id: "created" }) }),
					},
				}),
				admitted({
					admissionId: "second-create",
					proposalId: "second-create",
					idempotencyKey: "second-create",
					candidateMaterial: {
						kind: "agentic-memory-record-candidate-material",
						record: record({
							id: "record-created",
							fragment: fragment({ id: "created-again" }),
						}),
					},
				}),
			],
			applicationPolicy(),
			{ records: current },
		);

		expect(snapshot.records.map((item) => item.id)).toEqual(["record-existing", "record-created"]);
		expect(
			snapshot.applicationDecisions.map((decision) => [
				decision.proposalId,
				decision.state,
				decision.reasonCode,
			]),
		).toEqual([
			["target-update", "rejected", "target-record-id-mismatch"],
			["duplicate-record", "rejected", "record-id-conflict"],
			["duplicate-fragment", "rejected", "fragment-id-conflict"],
			["first-create", "applied", "applied-create"],
			["second-create", "rejected", "record-id-conflict"],
		]);
		expect(snapshot.issues.map((issue) => issue.code)).toEqual([
			"agentic-memory.application.target-record-id-mismatch",
			"agentic-memory.application.record-id-conflict",
			"agentic-memory.application.fragment-id-conflict",
			"agentic-memory.application.record-id-conflict",
		]);
		expect(snapshot.status).toMatchObject({
			state: "partial",
			cursor: { applied: 1, rejected: 4, issues: 4 },
		});
	});

	it("does not let policy markers disable D577 create-only duplicate gates", () => {
		const snapshot = applyAgenticMemoryRecordAdmissions(
			[
				admitted({
					admissionId: "duplicate-record",
					proposalId: "duplicate-record",
					candidateMaterial: {
						kind: "agentic-memory-record-candidate-material",
						record: record({
							id: "record-existing",
							fragment: fragment({ id: "fragment-existing" }),
						}),
					},
				}),
			],
			{
				kind: "agentic-memory-record-application-policy",
				policyId: "application-policy",
				rejectDuplicateRecordIds: false,
				rejectDuplicateFragmentIds: false,
			},
			{
				records: [
					record({
						id: "record-existing",
						fragment: fragment({ id: "fragment-existing" }),
					}),
				],
			},
		);

		expect(snapshot.records.map((item) => item.id)).toEqual(["record-existing"]);
		expect(snapshot.applicationDecisions).toEqual([]);
		expect(snapshot.issues).toEqual([
			expect.objectContaining({
				code: "agentic-memory.application-policy.invalid",
				refs: expect.arrayContaining([
					"policy.rejectDuplicateRecordIds must be true when present",
					"policy.rejectDuplicateFragmentIds must be true when present",
				]),
			}),
		]);
		expect(snapshot.status).toMatchObject({ state: "error" });
	});

	it("skips matching idempotency replay and rejects conflicting reuse", () => {
		const history: readonly AgenticMemoryRecordApplicationEvidence[] = [
			{
				kind: "agentic-memory-record-application-evidence",
				admissionId: "admission-mixed",
				proposalId: "proposal-mixed",
				recordId: "record-mixed",
				fragmentId: "fragment-mixed",
				targetRecordId: "record-mixed",
			},
			{
				kind: "agentic-memory-record-application-evidence",
				admissionId: "admission-mixed-conflict",
				proposalId: "proposal-mixed-conflict",
				idempotencyKey: "idem-mixed",
				recordId: "record-mixed-conflict",
				fragmentId: "fragment-mixed-conflict",
				targetRecordId: "record-mixed-conflict",
			},
			{
				kind: "agentic-memory-record-application-evidence",
				admissionId: "admission-history",
				proposalId: "proposal-history",
				idempotencyKey: "idem-history",
				recordId: "record-history",
				fragmentId: "fragment-history",
				targetRecordId: "record-history",
			},
		];
		const snapshot = applyAgenticMemoryRecordAdmissions(
			[
				admitted({
					admissionId: "admission-mixed",
					proposalId: "proposal-mixed",
					idempotencyKey: "idem-mixed",
					candidateMaterial: {
						kind: "agentic-memory-record-candidate-material",
						record: record({ id: "record-mixed", fragment: fragment({ id: "fragment-mixed" }) }),
					},
				}),
				admitted({
					admissionId: "admission-history",
					proposalId: "proposal-history",
					idempotencyKey: "idem-history",
					candidateMaterial: {
						kind: "agentic-memory-record-candidate-material",
						record: record({
							id: "record-history",
							fragment: fragment({ id: "fragment-history" }),
						}),
					},
				}),
				admitted({
					admissionId: "admission-conflict",
					proposalId: "proposal-conflict",
					idempotencyKey: "idem-history",
					candidateMaterial: {
						kind: "agentic-memory-record-candidate-material",
						record: record({ id: "record-other", fragment: fragment({ id: "fragment-other" }) }),
					},
				}),
				admitted({
					admissionId: "admission-current",
					proposalId: "proposal-current",
					idempotencyKey: "idem-current",
					candidateMaterial: {
						kind: "agentic-memory-record-candidate-material",
						record: record({
							id: "record-current",
							fragment: fragment({ id: "fragment-current" }),
						}),
					},
				}),
				admitted({
					admissionId: "admission-current",
					proposalId: "proposal-current-repeat",
					idempotencyKey: "idem-current",
					candidateMaterial: {
						kind: "agentic-memory-record-candidate-material",
						record: record({
							id: "record-current",
							fragment: fragment({ id: "fragment-current" }),
						}),
					},
				}),
			],
			applicationPolicy(),
			{ history },
		);

		expect(snapshot.records.map((item) => item.id)).toEqual(["record-current"]);
		expect(
			snapshot.applicationDecisions.map((decision) => [
				decision.proposalId,
				decision.state,
				decision.reasonCode,
			]),
		).toEqual([
			["proposal-mixed", "rejected", "idempotency-conflict"],
			["proposal-history", "skipped", "already-applied"],
			["proposal-conflict", "rejected", "idempotency-conflict"],
			["proposal-current", "applied", "applied-create"],
			["proposal-current-repeat", "skipped", "already-applied"],
		]);
		expect(snapshot.issues).toEqual([
			expect.objectContaining({
				code: "agentic-memory.application.idempotency-conflict",
				subjectId: "admission-mixed",
			}),
			expect.objectContaining({
				code: "agentic-memory.application.idempotency-conflict",
				subjectId: "admission-conflict",
			}),
		]);
	});

	it("does not index skipped decisions as same-evaluation application evidence", () => {
		const snapshot = applyAgenticMemoryRecordAdmissions(
			[
				admitted({
					admissionId: "admission-replay",
					proposalId: "proposal-skipped",
					state: "needs-review",
					idempotencyKey: "idem-replay",
					candidateMaterial: {
						kind: "agentic-memory-record-candidate-material",
						record: record({ id: "record-replay", fragment: fragment({ id: "fragment-replay" }) }),
					},
				}),
				admitted({
					admissionId: "admission-replay",
					proposalId: "proposal-applied",
					idempotencyKey: "idem-replay",
					candidateMaterial: {
						kind: "agentic-memory-record-candidate-material",
						record: record({ id: "record-replay", fragment: fragment({ id: "fragment-replay" }) }),
					},
				}),
			],
			applicationPolicy(),
		);

		expect(snapshot.records.map((item) => item.id)).toEqual(["record-replay"]);
		expect(
			snapshot.applicationDecisions.map((decision) => [
				decision.proposalId,
				decision.state,
				decision.reasonCode,
			]),
		).toEqual([
			["proposal-skipped", "skipped", "skipped-non-admitted"],
			["proposal-applied", "applied", "applied-create"],
		]);
		expect(snapshot.issues).toEqual([]);
	});

	it("scopes application history evidence by applicationId when present", () => {
		const admission = admitted({
			admissionId: "admission-scoped",
			proposalId: "proposal-scoped",
			idempotencyKey: "idem-scoped",
			candidateMaterial: {
				kind: "agentic-memory-record-candidate-material",
				record: record({ id: "record-scoped", fragment: fragment({ id: "fragment-scoped" }) }),
			},
		});
		const snapshot = applyAgenticMemoryRecordAdmissions([admission], applicationPolicy(), {
			history: [
				{
					kind: "agentic-memory-record-application-evidence",
					applicationId: "other-application",
					admissionId: "admission-scoped",
					proposalId: "proposal-scoped",
					idempotencyKey: "idem-scoped",
					recordId: "record-other",
					fragmentId: "fragment-other",
					targetRecordId: "record-other",
				},
			],
		});

		expect(snapshot.records.map((item) => item.id)).toEqual(["record-scoped"]);
		expect(snapshot.applicationDecisions).toEqual([
			expect.objectContaining({
				applicationId:
					'agentic-memory-record-application:["application-policy","admission-scoped"]',
				state: "applied",
				reasonCode: "applied-create",
			}),
		]);
		expect(snapshot.issues).toEqual([]);
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
					scope: { projectId: "project-1" },
				},
				attribution: {
					kind: "agentic-memory-context-attribution",
					fragmentId: "f1",
					recordId: "r1",
					queryId: "query-1",
					rank: 1,
					score: 0.42,
					truncated: true,
					truncation: {
						originalChars: 10,
						packedChars: 3,
						omittedChars: 7,
						reason: "budget",
						metadata: { lane: "fixture" },
					},
					sourceRefs: [{ kind: "retrieval", id: "retrieval-1", metadata: { rank: 1 } }],
					policyRefs: [{ kind: "policy", id: "packing-policy" }],
					metadata: { nested: { ok: true } },
				},
				fragment: fragment({ id: "f1", payload: "one" }),
			},
			{
				fragmentId: "f2",
				payload: "two",
				confidence: 0.8,
				tags: ["a"],
				sources: [],
				attribution: { fragmentId: "f2", rank: 2 },
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
				{
					fragmentId: "f1",
					metadata: { role: "evidence" },
					record: { recordId: "r1", scope: { projectId: "project-1" } },
					attribution: {
						kind: "agentic-memory-context-attribution",
						fragmentId: "f1",
						recordId: "r1",
						queryId: "query-1",
						rank: 1,
						score: 0.42,
						truncated: true,
						truncation: {
							originalChars: 10,
							packedChars: 3,
							omittedChars: 7,
							reason: "budget",
							metadata: { lane: "fixture" },
						},
						sourceRefs: [{ kind: "retrieval", id: "retrieval-1", metadata: { rank: 1 } }],
						policyRefs: [{ kind: "policy", id: "packing-policy" }],
						metadata: { nested: { ok: true } },
					},
				},
				{
					fragmentId: "f2",
					metadata: { role: "procedure" },
					attribution: { fragmentId: "f2", rank: 2 },
				},
			],
		});
		const latestPacked = data<AgenticMemoryPackedContext>(packed.messages).at(-1);
		expect(Object.isFrozen(latestPacked?.entries)).toBe(true);
		expect(Object.isFrozen(latestPacked?.entries[0])).toBe(true);
		expect(Object.isFrozen(latestPacked?.entries[0]?.attribution)).toBe(true);
		expect(Object.isFrozen(latestPacked?.entries[0]?.attribution?.truncation)).toBe(true);
		expect(Object.isFrozen(latestPacked?.entries[0]?.attribution?.metadata?.nested)).toBe(true);
		expect(Object.isFrozen(latestPacked?.entries[0]?.metadata)).toBe(true);
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

	it("rejects invalid context attribution as DATA errors", () => {
		const g = graph();
		const context = g.state(
			{
				...contextFact(),
				entries: [
					{
						...contextFact().entries[0],
						attribution: {
							fragmentId: "wrong-fragment",
							recordId: "wrong-record",
							rank: 0,
							score: Number.POSITIVE_INFINITY,
							truncated: false,
							truncation: new Date("2026-07-03T00:00:00.000Z"),
							sourceRefs: [{ kind: "source", id: "source-1", providerHandle: "nope" }],
							metadata: { bad: undefined },
							graph: "nope",
						},
					},
				],
			} as never,
			{ name: "context" },
		);
		const texts = g.state<readonly AgenticMemoryContextText[]>([{ fragmentId: "f1", text: "ok" }], {
			name: "texts",
		});
		const policy = g.state({}, { name: "policy" });
		const bundle = agenticMemoryContextPackingBundle(g, {
			name: "packing",
			context,
			texts,
			policy,
		});
		const packed = collect(bundle.packedContext);
		const errors = collect(bundle.errors);

		expect(data<AgenticMemoryPackedContext>(packed.messages).at(-1)?.entries).toEqual([]);
		const validationErrors = data<readonly AgenticMemoryContextPackingError[]>(errors.messages).at(
			-1,
		)?.[0]?.validationErrors;
		expect(
			data<readonly AgenticMemoryContextPackingError[]>(errors.messages).at(-1)?.[0],
		).not.toHaveProperty("value");
		expect(validationErrors).toEqual(
			expect.arrayContaining([
				"attribution.graph is not graph-visible DATA",
				"attribution.fragmentId must match the containing fragmentId",
				"attribution.recordId must match the containing record.recordId",
				"attribution.rank must be a 1-based safe integer when present",
				"attribution.score must be a finite number when present",
				"attribution.truncation must be a plain data object",
				"attribution.truncation requires attribution.truncated to be true or omitted",
				"attribution.sourceRefs: [0] has unexpected fields providerHandle",
				"attribution.sourceRefs: [0].providerHandle is not graph-visible DATA",
				"attribution.metadata must be a strict JSON object",
			]),
		);
		expect(errors.messages.some((message) => message[0] === "ERROR")).toBe(false);
	});

	it("rejects non-data attribution fact refs as DATA errors", () => {
		const sourceRefs = [{ kind: "source", id: "source-1" }] as Array<Record<PropertyKey, unknown>>;
		sourceRefs[Symbol("array-secret") as never] = true;
		Object.defineProperty(sourceRefs, "graph", {
			value: "nope",
			enumerable: true,
		});
		const policyRef = { kind: "policy" } as Record<PropertyKey, unknown>;
		policyRef[Symbol("ref-secret")] = true;
		Object.defineProperty(policyRef, "id", {
			get() {
				throw new Error("id getter should not run");
			},
			enumerable: true,
		});
		const g = graph();
		const context = g.state(
			{
				...contextFact(),
				entries: [
					{
						...contextFact().entries[0],
						attribution: {
							fragmentId: "f1",
							recordId: "r1",
							sourceRefs,
							policyRefs: [policyRef],
						},
					},
				],
			} as never,
			{ name: "context" },
		);
		const texts = g.state<readonly AgenticMemoryContextText[]>([{ fragmentId: "f1", text: "ok" }], {
			name: "texts",
		});
		const policy = g.state({}, { name: "policy" });
		const bundle = agenticMemoryContextPackingBundle(g, {
			name: "packing",
			context,
			texts,
			policy,
		});
		const errors = collect(bundle.errors);

		const validationErrors = data<readonly AgenticMemoryContextPackingError[]>(errors.messages).at(
			-1,
		)?.[0]?.validationErrors;
		expect(validationErrors).toEqual(
			expect.arrayContaining([
				"attribution.sourceRefs: refs must not carry symbol keys",
				"attribution.sourceRefs: refs.graph must be an indexed data property",
				"attribution.policyRefs: [0] must not carry symbol keys",
				"attribution.policyRefs: [0].id must be a data property",
			]),
		);
		expect(errors.messages.some((message) => message[0] === "ERROR")).toBe(false);
	});

	it("rejects non-data attribution containers as DATA errors", () => {
		const symbolKey = Symbol("secret");
		const attribution = { fragmentId: "f1" } as Record<PropertyKey, unknown>;
		attribution[symbolKey] = true;
		Object.defineProperty(attribution, "rank", {
			get: () => 1,
			enumerable: true,
		});
		const g = graph();
		const context = g.state(
			{
				...contextFact(),
				entries: [
					{
						...contextFact().entries[0],
						attribution,
					},
				],
			} as never,
			{ name: "context" },
		);
		const texts = g.state<readonly AgenticMemoryContextText[]>([{ fragmentId: "f1", text: "ok" }], {
			name: "texts",
		});
		const policy = g.state({}, { name: "policy" });
		const bundle = agenticMemoryContextPackingBundle(g, {
			name: "packing",
			context,
			texts,
			policy,
		});
		const errors = collect(bundle.errors);

		const validationErrors = data<readonly AgenticMemoryContextPackingError[]>(errors.messages).at(
			-1,
		)?.[0]?.validationErrors;
		expect(validationErrors).toEqual(
			expect.arrayContaining([
				"attribution must not carry symbol keys",
				"attribution.rank must be a data property",
			]),
		);
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
