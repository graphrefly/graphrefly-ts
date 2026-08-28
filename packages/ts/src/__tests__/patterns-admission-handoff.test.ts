import { describe, expect, it } from "vitest";
import { graph, type Message, type Node } from "../index.js";
import {
	type AdmissionHandoffCandidate,
	type AdmissionHandoffDecision,
	admissionHandoff,
} from "../patterns/admission-handoff.js";

interface CandidateValue {
	readonly workItemId: string;
}

type DecisionReason = { readonly policy: string };

function collect<T>(node: Node<T>): Message[] {
	const messages: Message[] = [];
	node.subscribe((message) => messages.push(message));
	return messages;
}

function candidate(
	candidateId = "work-item-1",
	candidateFingerprint = "candidate-fingerprint-1",
): AdmissionHandoffCandidate<CandidateValue> {
	return {
		kind: "admission-handoff-candidate",
		candidateId,
		candidateFingerprint,
		value: { workItemId: candidateId },
	};
}

function decision(
	state: "admitted" | "rejected",
	candidateId = "work-item-1",
	candidateFingerprint = "candidate-fingerprint-1",
	decisionId = `decision-${candidateId}`,
	decisionFingerprint = `${state}-fingerprint-${candidateId}`,
): AdmissionHandoffDecision<DecisionReason> {
	return {
		kind: "admission-handoff-decision",
		decisionId,
		decisionFingerprint,
		candidateId,
		candidateFingerprint,
		state,
		reason: { policy: "verified" },
	};
}

function fixture(maxPending = 4, maxRecent = 4) {
	const owner = graph();
	const candidates = owner.node<AdmissionHandoffCandidate<CandidateValue>>([], null, {
		name: "candidate-input",
	});
	const decisions = owner.node<AdmissionHandoffDecision<DecisionReason>>([], null, {
		name: "decision-input",
	});
	const handoff = admissionHandoff(owner, {
		name: "verified-work",
		candidates,
		decisions,
		maxPending,
		maxRecent,
	});
	return { owner, candidates, decisions, handoff };
}

describe("admissionHandoff pattern (graphrefly-ts:D147)", () => {
	it("fails closed unless both explicit memory bounds are positive safe integers", () => {
		const owner = graph();
		const candidates = owner.node<AdmissionHandoffCandidate<CandidateValue>>([], null);
		const decisions = owner.node<AdmissionHandoffDecision<DecisionReason>>([], null);

		expect(() =>
			admissionHandoff(owner, { candidates, decisions, maxPending: 0, maxRecent: 1 }),
		).toThrow(/maxPending/);
		expect(() =>
			admissionHandoff(owner, { candidates, decisions, maxPending: 1, maxRecent: 1.5 }),
		).toThrow(/maxRecent/);
	});

	it.each([
		"candidate-first",
		"decision-first",
	] as const)("keeps the accepted boundary completely quiet for a rejection (%s)", (order) => {
		const { candidates, decisions, handoff } = fixture();
		const accepted = collect(handoff.accepted);
		const rejected = collect(handoff.rejected);
		accepted.length = 0;
		rejected.length = 0;

		if (order === "candidate-first") {
			candidates.down([["DATA", candidate()]]);
			decisions.down([["DATA", decision("rejected")]]);
		} else {
			decisions.down([["DATA", decision("rejected")]]);
			candidates.down([["DATA", candidate()]]);
		}

		expect(accepted).toEqual([]);
		expect(rejected.filter((message) => message[0] === "DATA")).toEqual([
			[
				"DATA",
				expect.objectContaining({
					kind: "admission-handoff-rejected",
					candidateId: "work-item-1",
					decisionId: "decision-work-item-1",
				}),
			],
		]);
	});

	it.each([
		"candidate-only",
		"decision-only",
	] as const)("keeps accepted completely quiet for an unmatched %s occurrence", (side) => {
		const { candidates, decisions, handoff } = fixture();
		const accepted = collect(handoff.accepted);
		accepted.length = 0;

		if (side === "candidate-only") candidates.down([["DATA", candidate()]]);
		else decisions.down([["DATA", decision("admitted")]]);

		expect(accepted).toEqual([]);
	});

	it.each([
		"candidate-first",
		"decision-first",
	] as const)("releases a first admission as exactly one fresh DIRTY-to-DATA wave (%s)", (order) => {
		const { candidates, decisions, handoff } = fixture();
		const accepted = collect(handoff.accepted);
		accepted.length = 0;

		if (order === "candidate-first") {
			candidates.down([["DATA", candidate()]]);
			decisions.down([["DATA", decision("admitted")]]);
		} else {
			decisions.down([["DATA", decision("admitted")]]);
			candidates.down([["DATA", candidate()]]);
		}

		expect(accepted.map((message) => message[0])).toEqual(["DIRTY", "DATA"]);
		expect(accepted[1]).toEqual([
			"DATA",
			expect.objectContaining({
				kind: "admission-handoff-accepted",
				candidateId: "work-item-1",
				decisionId: "decision-work-item-1",
				value: { workItemId: "work-item-1" },
			}),
		]);
	});

	it("deduplicates exact candidate and decision replay without touching accepted", () => {
		const { candidates, decisions, handoff } = fixture();
		const accepted = collect(handoff.accepted);
		const statuses = collect(handoff.status);
		accepted.length = 0;
		statuses.length = 0;

		candidates.down([["DATA", candidate()]]);
		decisions.down([["DATA", decision("admitted")]]);
		expect(accepted.map((message) => message[0])).toEqual(["DIRTY", "DATA"]);
		accepted.length = 0;

		candidates.down([["DATA", candidate()]]);
		decisions.down([["DATA", decision("admitted")]]);

		expect(accepted).toEqual([]);
		expect(
			statuses
				.filter((message) => message[0] === "DATA")
				.map((message) => (message[1] as { state: string }).state),
		).toEqual(["candidate-pending", "accepted", "replayed", "replayed"]);
	});

	it("conserves multiple admissions correlated in one input wave", () => {
		const { candidates, decisions, handoff } = fixture();
		const accepted = collect(handoff.accepted);
		accepted.length = 0;

		candidates.down([
			["DATA", candidate("one", "fp-one")],
			["DATA", candidate("two", "fp-two")],
		]);
		decisions.down([
			["DATA", decision("admitted", "one", "fp-one")],
			["DATA", decision("admitted", "two", "fp-two")],
		]);

		expect(accepted.map((message) => message[0])).toEqual(["DIRTY", "DATA", "DIRTY", "DATA"]);
		expect(
			accepted
				.filter((message) => message[0] === "DATA")
				.map((message) => (message[1] as { candidateId: string }).candidateId),
		).toEqual(["one", "two"]);
	});

	it("fails closed on fingerprint and terminal-decision conflicts", () => {
		const { candidates, decisions, handoff } = fixture();
		const accepted = collect(handoff.accepted);
		const issues = collect(handoff.issues);
		accepted.length = 0;
		issues.length = 0;

		candidates.down([["DATA", candidate()]]);
		decisions.down([["DATA", decision("admitted", "work-item-1", "wrong")]]);
		expect(accepted).toEqual([]);
		expect(
			issues
				.filter((message) => message[0] === "DATA")
				.map((message) => (message[1] as { code: string }).code),
		).toContain("candidate-fingerprint-mismatch");

		decisions.down([
			["DATA", decision("admitted", "work-item-1", "candidate-fingerprint-1", "decision-good")],
		]);
		expect(accepted.map((message) => message[0])).toEqual(["DIRTY", "DATA"]);
		accepted.length = 0;
		decisions.down([
			["DATA", decision("rejected", "work-item-1", "candidate-fingerprint-1", "other")],
		]);

		expect(accepted).toEqual([]);
		expect(
			issues
				.filter((message) => message[0] === "DATA")
				.map((message) => (message[1] as { code: string }).code),
		).toContain("terminal-decision-conflict");
	});

	it("enforces bounded pending correlation and exposes a material-free cursor", () => {
		const { candidates, handoff } = fixture(1, 1);
		const accepted = collect(handoff.accepted);
		const issues = collect(handoff.issues);
		const cursors = collect(handoff.cursor);
		accepted.length = 0;
		issues.length = 0;
		cursors.length = 0;

		candidates.down([["DATA", candidate("one", "fp-one")]]);
		candidates.down([["DATA", candidate("two", "fp-two")]]);

		expect(accepted).toEqual([]);
		expect(
			issues.some(
				(message) =>
					message[0] === "DATA" &&
					(message[1] as { code: string }).code === "pending-capacity-exceeded",
			),
		).toBe(true);
		expect(cursors.at(-1)?.[1]).toEqual(
			expect.objectContaining({
				kind: "admission-handoff-cursor",
				pendingCandidates: 1,
				pendingDecisions: 0,
			}),
		);
	});

	it("describes the complete correlation and quiet-release topology", () => {
		const { owner, handoff } = fixture();
		const description = owner.describe();
		const nodes = Object.fromEntries(
			description.nodes.map((node) => [node.id, { deps: node.deps, factory: node.factory }]),
		);

		expect(nodes).toMatchObject({
			"verified-work/correlation": {
				deps: ["candidate-input", "decision-input"],
				factory: "admissionHandoffCorrelation",
			},
			"verified-work/admitted": {
				deps: ["verified-work/correlation"],
				factory: "admissionHandoffAdmitted",
			},
			"verified-work/accepted": {
				deps: ["verified-work/admitted"],
				factory: "admissionHandoffAccepted",
			},
			"verified-work/release-controller": {
				deps: ["verified-work/admitted", "verified-work/accepted"],
				factory: "admissionHandoffReleaseController",
			},
			"verified-work/rejected": {
				deps: ["verified-work/correlation"],
				factory: "admissionHandoffRejected",
			},
			"verified-work/status": {
				deps: ["verified-work/correlation"],
				factory: "admissionHandoffStatus",
			},
			"verified-work/issues": {
				deps: ["verified-work/correlation"],
				factory: "admissionHandoffIssues",
			},
			"verified-work/cursor": {
				deps: ["verified-work/correlation"],
				factory: "admissionHandoffCursor",
			},
		});

		expect(() => {
			handoff.release();
			handoff.release();
		}).not.toThrow();
	});

	it("release tears down the retained admission controller and is idempotent", () => {
		const { candidates, decisions, handoff } = fixture();
		const accepted = collect(handoff.accepted);
		accepted.length = 0;
		handoff.release();
		handoff.release();

		candidates.down([["DATA", candidate()]]);
		decisions.down([["DATA", decision("admitted")]]);

		expect(accepted).toEqual([]);
	});
});
