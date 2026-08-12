import { describe, expect, it } from "vitest";
import { empiricalStrictJsonDigest } from "../../evals/empirical-memory-rerun-avoidance/canonical.js";
import {
	admitD724TerminalHttpEvidence,
	createD724TerminalHttpAuthority,
	createD724TerminalHttpEvidence,
	snapshotD724TerminalHttpGraphEvidence,
	validateD724TerminalHttpEvidence,
	validateD724TerminalHttpGraphEvidence,
} from "../../evals/empirical-memory-rerun-avoidance/d724-terminal-http-evidence.js";

const digest = (value: unknown) => empiricalStrictJsonDigest(value);

describe("D724 Graph-native terminal HTTP evidence", () => {
	it("sanitizes a non-retryable HTTP response without retaining raw body material", () => {
		const body = new TextEncoder().encode(
			JSON.stringify({ error: { code: "invalid_request", message: "private detail" } }),
		);
		const evidence = createD724TerminalHttpEvidence({
			httpStatus: 400,
			mediaTypeDisposition: "application-json",
			retryAfterDisposition: "absent",
			responseBytes: body,
		});
		expect(evidence).toMatchObject({
			httpStatus: 400,
			statusClass: "4xx",
			mediaTypeDisposition: "application-json",
			bodyShape: "error-envelope",
			recognizedTypePresent: false,
			recognizedCodePresent: true,
			retryAfterDisposition: "absent",
		});
		expect(JSON.stringify(evidence)).not.toContain("private detail");
		validateD724TerminalHttpEvidence(evidence);
	});

	it("rejects substituted terminal and accessor evidence before Graph admission", () => {
		const terminalHttpEvidence = createD724TerminalHttpEvidence({
			httpStatus: 404,
			mediaTypeDisposition: "application-json",
			retryAfterDisposition: "absent",
			responseBytes: new TextEncoder().encode('{"error":{"type":"not_found"}}'),
		});
		expect(() =>
			validateD724TerminalHttpEvidence({ ...terminalHttpEvidence, statusClass: "5xx" }),
		).toThrow(/statusClass/);
		let getterHits = 0;
		const facts: unknown[] = [];
		Object.defineProperty(facts, "0", {
			enumerable: true,
			get() {
				getterHits += 1;
				return {};
			},
		});
		facts.length = 1;
		expect(() =>
			validateD724TerminalHttpGraphEvidence({
				schemaVersion: "graphrefly.b112.d724.terminal-http-graph-evidence.v1",
				facts,
				evidenceDigest: digest({ facts: [] }),
			}),
		).toThrow();
		expect(getterHits).toBe(0);
	});

	it("persists the discriminator only after Graph admission", () => {
		const terminalHttpEvidence = createD724TerminalHttpEvidence({
			httpStatus: 400,
			mediaTypeDisposition: "unavailable",
			retryAfterDisposition: "absent",
			responseBytes: new TextEncoder().encode('{"error":{"code":"bad_request"}}'),
		});
		const authority = createD724TerminalHttpAuthority();
		const admitted = admitD724TerminalHttpEvidence(authority, {
			effectRequestDigest: digest({ request: "d724" }),
			effectAdmissionDigest: digest({ admission: "d724" }),
			providerResultDigest: digest({ result: "d724" }),
			terminalHttpEvidence,
		});
		expect(admitted.terminalHttpEvidence).toEqual(terminalHttpEvidence);
		const graphEvidence = snapshotD724TerminalHttpGraphEvidence(authority);
		expect(graphEvidence.facts).toEqual([admitted]);
		validateD724TerminalHttpGraphEvidence(graphEvidence);
		expect(() =>
			admitD724TerminalHttpEvidence(authority, {
				effectRequestDigest: digest({ request: "second" }),
				effectAdmissionDigest: admitted.effectAdmissionDigest,
				providerResultDigest: digest({ result: "second" }),
				terminalHttpEvidence,
			}),
		).toThrow(/already admitted/);
	});

	it("admits an identical provider result for distinct Graph admissions while rejecting replay", () => {
		const terminalHttpEvidence = createD724TerminalHttpEvidence({
			httpStatus: 404,
			mediaTypeDisposition: "application-json",
			retryAfterDisposition: "absent",
			responseBytes: new TextEncoder().encode('{"error":{"code":"endpoint_not_found"}}'),
		});
		const authority = createD724TerminalHttpAuthority();
		const providerResultDigest = digest({ status: 404, body: "identical" });
		const first = admitD724TerminalHttpEvidence(authority, {
			effectRequestDigest: digest({ request: 1 }),
			effectAdmissionDigest: digest({ admission: 1 }),
			providerResultDigest,
			terminalHttpEvidence,
		});
		const secondInput = {
			effectRequestDigest: digest({ request: 2 }),
			effectAdmissionDigest: digest({ admission: 2 }),
			providerResultDigest,
			terminalHttpEvidence,
		};
		const second = admitD724TerminalHttpEvidence(authority, secondInput);
		expect(first.providerResultDigest).toBe(second.providerResultDigest);
		expect(first.effectAdmissionDigest).not.toBe(second.effectAdmissionDigest);
		expect(snapshotD724TerminalHttpGraphEvidence(authority).facts).toHaveLength(2);
		expect(() => admitD724TerminalHttpEvidence(authority, secondInput)).toThrow(/already admitted/);
	});
});
