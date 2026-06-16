import { describe, expect, it } from "vitest";
import { graph } from "../graph/graph.js";
import type { BoundaryCapabilityRef } from "../inspection/boundary.js";
import {
	type CapabilityAdmission,
	type CapabilityAdmissionDecision,
	type CapabilityAdmissionPolicy,
	type CapabilityAdmissionProposal,
	type CapabilityAdmissionStatus,
	capabilityAdmissionProjector,
	capabilityAdmissionProposal,
} from "../solutions/capability-admission.js";

describe("solution capability admission (D357)", () => {
	it("projects product-owned capability admission facts instead of AutoPanel security", () => {
		const setup = admissionSetup();

		setup.policies.down([
			[
				"DATA",
				{
					kind: "capability-admission-policy",
					policyId: "github-auth-policy",
					capabilityKinds: ["auth"],
					requiredOnly: true,
					allowedOutcomes: ["allow", "block"],
				},
			],
		]);
		setup.proposals.down([
			[
				"DATA",
				capabilityAdmissionProposal({
					proposalId: "proposal-1",
					subjectId: "boundary:token",
					boundaryName: "token",
					role: "input",
					capability: authCapability,
					sourceRefs: [{ kind: "boundary-node", id: "token" }],
				}),
			],
		]);
		setup.decisions.down([
			[
				"DATA",
				{
					kind: "capability-admission-decision",
					decisionId: "decision-1",
					admissionId: "admission-1",
					proposalId: "proposal-1",
					outcome: "block",
					policyId: "github-auth-policy",
					reason: "Product registry says OAuth is not ready",
					decidedAtMs: 123,
				},
			],
		]);

		expect(setup.issues).toEqual([]);
		expect(setup.admissions).toEqual([
			expect.objectContaining({
				kind: "capability-admission",
				admissionId: "admission-1",
				proposalId: "proposal-1",
				subjectId: "boundary:token",
				state: "blocked",
				policyId: "github-auth-policy",
				admittedAtMs: 123,
			}),
		]);
		expect(setup.status.at(-1)).toMatchObject({
			kind: "capability-admission-status",
			state: "capability-admission-blocked",
			capabilityId: "github-oauth",
			capabilityKind: "auth",
		});
		expect(setup.views.at(-1)?.admissionsByProposal.get("proposal-1")?.state).toBe("blocked");
		expect(setup.views.at(-1)?.admissionsBySubject.get("boundary:token")?.[0].state).toBe(
			"blocked",
		);
	});

	it("surfaces missing policy/proposal as DATA-level issues, not protocol ERROR", () => {
		const setup = admissionSetup();
		const issueMsgs = collectMessages(setup.bundle.issues);
		const statusMsgs = collectMessages(setup.bundle.status);

		setup.proposals.down([
			[
				"DATA",
				capabilityAdmissionProposal({
					proposalId: "proposal-1",
					subjectId: "boundary:token",
					capability: authCapability,
				}),
			],
		]);
		setup.decisions.down([
			[
				"DATA",
				{
					kind: "capability-admission-decision",
					decisionId: "decision-missing-policy",
					admissionId: "admission-missing-policy",
					proposalId: "proposal-1",
					outcome: "allow",
					policyId: "missing-policy",
				},
			],
			[
				"DATA",
				{
					kind: "capability-admission-decision",
					decisionId: "decision-missing-proposal",
					admissionId: "admission-missing-proposal",
					proposalId: "missing-proposal",
					outcome: "block",
				},
			],
		]);

		expect(setup.admissions).toEqual([]);
		expect(setup.issues.map((issue) => issue.code)).toEqual([
			"missing-capability-admission-policy",
			"missing-capability-admission-proposal",
		]);
		expect(issueMsgs.filter((msg) => msg[0] === "DATA")).toHaveLength(2);
		expect(statusMsgs.filter((msg) => msg[0] === "DATA")).toHaveLength(2);
		expect([...issueMsgs, ...statusMsgs].some((msg) => msg[0] === "ERROR")).toBe(false);
	});

	it("keeps provider/OAuth/config-form registry data out of capability policy vocabulary", () => {
		const setup = admissionSetup();

		setup.policies.down([
			[
				"DATA",
				{
					kind: "capability-admission-policy",
					policyId: "resource-only",
					capabilityKinds: ["resource"],
					allowedOutcomes: ["allow"],
					metadata: {
						// Product-owned evidence may be referenced, but this helper does not interpret it
						// as a provider registry, OAuth flow, or config form schema.
						productRegistryRef: "registry:github",
					},
				},
			],
		]);
		setup.proposals.down([
			[
				"DATA",
				capabilityAdmissionProposal({
					proposalId: "proposal-1",
					subjectId: "boundary:token",
					capability: authCapability,
				}),
			],
		]);
		setup.decisions.down([
			[
				"DATA",
				{
					kind: "capability-admission-decision",
					decisionId: "decision-1",
					admissionId: "admission-1",
					proposalId: "proposal-1",
					outcome: "allow",
					policyId: "resource-only",
				},
			],
		]);

		expect(setup.admissions).toEqual([]);
		expect(setup.issues.at(-1)).toMatchObject({
			code: "capability-admission-policy-mismatch",
		});
		expect(setup.status.at(-1)).toMatchObject({
			state: "capability-admission-issue",
		});
	});

	it("rejects malformed and duplicate policy/decision facts as visible DataIssue records", () => {
		const setup = admissionSetup();

		setup.proposals.down([
			[
				"DATA",
				{
					kind: "capability-admission-proposal",
					subjectId: "boundary:token-a",
					capability: authCapability,
				} as unknown as CapabilityAdmissionProposal,
			],
			[
				"DATA",
				{
					kind: "capability-admission-proposal",
					subjectId: "boundary:token-b",
					capability: authCapability,
				} as unknown as CapabilityAdmissionProposal,
			],
			[
				"DATA",
				capabilityAdmissionProposal({
					proposalId: "proposal-1",
					subjectId: "boundary:token",
					capability: authCapability,
				}),
			],
		]);
		setup.policies.down([
			[
				"DATA",
				{
					kind: "capability-admission-policy",
					policyId: "auth-policy",
					capabilityKinds: ["auth"],
					allowedOutcomes: ["allow"],
				},
			],
			[
				"DATA",
				{
					kind: "capability-admission-policy",
					policyId: "auth-policy",
					capabilityKinds: ["resource"],
					allowedOutcomes: ["block"],
				},
			],
			[
				"DATA",
				{
					kind: "capability-admission-policy",
					policyId: "",
					capabilityKinds: ["provider"],
				} as unknown as CapabilityAdmissionPolicy,
			],
		]);
		setup.decisions.down([
			[
				"DATA",
				{
					kind: "capability-admission-decision",
					decisionId: "",
					admissionId: "bad-admission",
					proposalId: "proposal-1",
					outcome: "allow",
				} as unknown as CapabilityAdmissionDecision,
			],
			[
				"DATA",
				{
					kind: "capability-admission-decision",
					decisionId: "decision-ok",
					admissionId: "admission-ok",
					proposalId: "proposal-1",
					outcome: "allow",
					policyId: "auth-policy",
				},
			],
		]);

		expect(setup.issues.map((issue) => issue.code)).toEqual([
			"malformed-capability-admission-proposal",
			"malformed-capability-admission-proposal",
			"duplicate-capability-admission-policy",
			"malformed-capability-admission-policy",
			"malformed-capability-admission-decision",
		]);
		expect(setup.admissions).toEqual([
			expect.objectContaining({
				admissionId: "admission-ok",
				state: "allowed",
				policyId: "auth-policy",
			}),
		]);
	});
});

const authCapability = {
	id: "github-oauth",
	kind: "auth",
	required: true,
	sourceRefs: ["github"],
} satisfies BoundaryCapabilityRef;

function admissionSetup() {
	const g = graph();
	const proposals = g.node<CapabilityAdmissionProposal>([], null, { name: "proposals" });
	const decisions = g.node<CapabilityAdmissionDecision>([], null, { name: "decisions" });
	const policies = g.node<CapabilityAdmissionPolicy>([], null, { name: "policies" });
	const bundle = capabilityAdmissionProjector(g, {
		proposals,
		decisions,
		admissionPolicies: [policies],
		now: () => 456,
	});
	return {
		proposals,
		decisions,
		policies,
		bundle,
		admissions: collectData<CapabilityAdmission>(bundle.admissions),
		status: collectData<CapabilityAdmissionStatus>(bundle.status),
		issues: collectData(bundle.issues),
		audit: collectData(bundle.audit),
		views: collectData(bundle.views),
	};
}

function collectData<T>(node: {
	subscribe(sink: (msg: readonly [string, unknown]) => void): () => void;
}) {
	const values: T[] = [];
	node.subscribe((msg) => {
		if (msg[0] === "DATA") values.push(msg[1] as T);
	});
	return values;
}

function collectMessages<T>(node: {
	subscribe(sink: (msg: readonly [string, T?]) => void): () => void;
}) {
	const messages: readonly [string, T?][] = [];
	node.subscribe((msg) => {
		messages.push(msg);
	});
	return messages;
}
