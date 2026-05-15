/**
 * Unit tests for `autoSolidify` — the VERIFY-success → durable-artifact
 * promotion primitive. Covers:
 *   - happy path (verified=true → write called → node emits artifact)
 *   - skips verified=false
 *   - skips when extract returns null
 *   - predicate gates beyond verified flag
 *   - write throw surfaces as ERROR but does not break the loop
 *   - completes when verifyResults completes
 */

import { DATA, ERROR } from "@graphrefly/pure-ts/core/messages.js";
import { node } from "@graphrefly/pure-ts/core/node.js";
import { describe, expect, it } from "vitest";

import { autoSolidify } from "../../patterns/harness/auto-solidify.js";
import type { ExecutionResult, TriagedItem, VerifyResult } from "../../patterns/harness/types.js";

const SAMPLE_ITEM: TriagedItem = {
	source: "eval",
	summary: "needs catalog fn",
	evidence: "fixture",
	affectsAreas: ["catalog"],
	rootCause: "missing-fn",
	intervention: "catalog-fn",
	route: "auto-fix",
	priority: 80,
};

function makeVR<R>(opts: {
	verified: boolean;
	artifact?: R;
	intervention?: TriagedItem["intervention"];
	findings?: string[];
}): VerifyResult<R> {
	const item: TriagedItem = {
		...SAMPLE_ITEM,
		intervention: opts.intervention ?? SAMPLE_ITEM.intervention,
	};
	const execution: ExecutionResult<R> = {
		item,
		outcome: opts.verified ? "success" : "failure",
		detail: "test",
		artifact: opts.artifact,
	};
	return {
		item,
		execution,
		verified: opts.verified,
		findings: opts.findings ?? [],
	};
}

describe("autoSolidify — happy path", () => {
	it("invokes write and emits the artifact for verified=true", () => {
		const verifyResults = node<VerifyResult<string> | null>([], { initial: null });
		const writes: { artifact: string; vr: VerifyResult<string> }[] = [];
		const emitted: string[] = [];
		const solidifyNode = autoSolidify<string>({
			verifyResults,
			write: (artifact, vr) => writes.push({ artifact, vr }),
		});
		solidifyNode.subscribe((batch) => {
			for (const m of batch) {
				if (m[0] === DATA && m[1] != null) emitted.push(m[1] as string);
			}
		});
		verifyResults.emit(makeVR({ verified: true, artifact: "promoted" }));
		expect(writes).toHaveLength(1);
		expect(writes[0].artifact).toBe("promoted");
		expect(writes[0].vr.item.intervention).toBe("catalog-fn");
		expect(emitted).toEqual(["promoted"]);
	});

	it("skips verified=false runs", () => {
		const verifyResults = node<VerifyResult<string> | null>([], { initial: null });
		const writes: string[] = [];
		const solidifyNode = autoSolidify<string>({
			verifyResults,
			write: (artifact) => writes.push(artifact),
		});
		solidifyNode.subscribe(() => {});
		verifyResults.emit(makeVR({ verified: false, artifact: "should-not-promote" }));
		expect(writes).toEqual([]);
	});

	it("skips when extract returns null", () => {
		const verifyResults = node<VerifyResult<string> | null>([], { initial: null });
		const writes: string[] = [];
		const solidifyNode = autoSolidify<string, string>({
			verifyResults,
			extract: () => null,
			write: (artifact) => writes.push(artifact),
		});
		solidifyNode.subscribe(() => {});
		verifyResults.emit(makeVR({ verified: true, artifact: "ignored-by-extract" }));
		expect(writes).toEqual([]);
	});

	it("transforms the artifact via custom extract", () => {
		const verifyResults = node<VerifyResult<{ raw: number }> | null>([], { initial: null });
		const writes: number[] = [];
		const solidifyNode = autoSolidify<{ raw: number }, number>({
			verifyResults,
			extract: (vr) => vr.execution.artifact?.raw ?? null,
			write: (n) => writes.push(n),
		});
		solidifyNode.subscribe(() => {});
		verifyResults.emit(makeVR({ verified: true, artifact: { raw: 7 } }));
		expect(writes).toEqual([7]);
	});
});

describe("autoSolidify — predicate gating", () => {
	it("predicate=false suppresses the promotion", () => {
		const verifyResults = node<VerifyResult<string> | null>([], { initial: null });
		const writes: string[] = [];
		const solidifyNode = autoSolidify<string>({
			verifyResults,
			predicate: (vr) => vr.item.intervention === "template",
			write: (a) => writes.push(a),
		});
		solidifyNode.subscribe(() => {});
		// catalog-fn is verified but predicate rejects.
		verifyResults.emit(makeVR({ verified: true, artifact: "no", intervention: "catalog-fn" }));
		expect(writes).toEqual([]);
		// template intervention passes both gates.
		verifyResults.emit(makeVR({ verified: true, artifact: "yes", intervention: "template" }));
		expect(writes).toEqual(["yes"]);
	});
});

describe("autoSolidify — error surfaces", () => {
	it("write throw emits terminal ERROR; later verifies do NOT solidify", () => {
		// Spec-conforming behavior: `[[ERROR]]` is a terminal frame.
		// `autoSolidify` tears down its upstream subscription on first
		// user-callback throw. Callers who want the solidify node to stay
		// live across throws must wrap their `write` with try/catch
		// internally.
		const verifyResults = node<VerifyResult<string> | null>([], { initial: null });
		const errors: unknown[] = [];
		const writes: string[] = [];
		const datas: string[] = [];
		const solidifyNode = autoSolidify<string>({
			verifyResults,
			write: (a) => {
				if (a === "boom") throw new Error("write boom");
				writes.push(a);
			},
		});
		solidifyNode.subscribe((batch) => {
			for (const m of batch) {
				if (m[0] === ERROR) errors.push(m[1]);
				if (m[0] === DATA && m[1] != null) datas.push(m[1] as string);
			}
		});
		verifyResults.emit(makeVR({ verified: true, artifact: "boom" }));
		verifyResults.emit(makeVR({ verified: true, artifact: "ok" }));
		expect(errors).toHaveLength(1);
		expect((errors[0] as Error).message).toBe("write boom");
		// Second verify did NOT trigger a write — node is terminal.
		expect(writes).toEqual([]);
		expect(datas).toEqual([]);
	});

	it("predicate throw emits terminal ERROR (mirrors write semantics)", () => {
		const verifyResults = node<VerifyResult<string> | null>([], { initial: null });
		const errors: unknown[] = [];
		const solidifyNode = autoSolidify<string>({
			verifyResults,
			predicate: () => {
				throw new Error("predicate boom");
			},
			write: () => {},
		});
		solidifyNode.subscribe((batch) => {
			for (const m of batch) if (m[0] === ERROR) errors.push(m[1]);
		});
		verifyResults.emit(makeVR({ verified: true, artifact: "x" }));
		expect(errors).toHaveLength(1);
		expect((errors[0] as Error).message).toBe("predicate boom");
	});

	it("extract throw emits terminal ERROR", () => {
		const verifyResults = node<VerifyResult<string> | null>([], { initial: null });
		const errors: unknown[] = [];
		const solidifyNode = autoSolidify<string, string>({
			verifyResults,
			extract: () => {
				throw new Error("extract boom");
			},
			write: () => {},
		});
		solidifyNode.subscribe((batch) => {
			for (const m of batch) if (m[0] === ERROR) errors.push(m[1]);
		});
		verifyResults.emit(makeVR({ verified: true, artifact: "x" }));
		expect(errors).toHaveLength(1);
		expect((errors[0] as Error).message).toBe("extract boom");
	});
});
