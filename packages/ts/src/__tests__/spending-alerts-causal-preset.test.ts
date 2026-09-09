import { afterEach, describe, expect, it } from "vitest";
import type {
	Assessment,
	BusinessFrame,
} from "../../../../examples/spending-alerts/causal-business.js";
import type { Publication } from "../../../../examples/spending-alerts/causal-publication.js";
import {
	evaluationFixture,
	evaluationPack,
	evaluationWithAmounts,
	policyFacts,
	presetBinding,
	presetRun,
} from "../../../../scripts/fixtures/spending-preset-harness.js";
import { verifyBusiness } from "../../../../scripts/fixtures/spending-preset-oracle.js";
import { assertCausalCapabilities } from "../solutions/causal-occurrence/capabilities.js";

const runs: ReturnType<typeof presetRun>[] = [];
afterEach(() => {
	for (const r of runs.splice(0)) r.cleanup();
});
function run(mode: "off" | "summary" = "off") {
	const r = presetRun(mode);
	runs.push(r);
	return r;
}
for (const mode of ["off", "summary"] as const)
	describe(`D164 spending preset ${mode}`, () => {
		it("owns exact cold topology and five real view fields", () => {
			const r = run(mode),
				{ view, capabilities } = r.built.consume;
			expect(r.owner.nodes).toHaveLength(mode === "off" ? 53 : 54);
			expect(r.owner.roots).toHaveLength(2);
			expect(r.owner.phase).toBe("started");
			expect(Object.keys(view)).toEqual([
				"assessment",
				"publication",
				"coverage",
				"issues",
				"startup",
			]);
			expect(Object.isFrozen(view)).toBe(true);
			expect(capabilities.execution.identity).toBe(capabilities.identity);
			expect(capabilities.retained.execution).toBe(capabilities.execution);
			assertCausalCapabilities(r.graph, capabilities, {
				contract: "contract-v2",
				implementationRevision: "construction-v1",
				scope: "full",
				epoch: 1,
			});
			expect(r.events.assessment).toEqual([]);
		});
		it("executes real business, independent sample oracle and exact admitted publication", () => {
			const r = run(mode),
				e = evaluationFixture();
			r.send("pack", evaluationPack([e]));
			r.drive(e);
			const frames = r.events.assessment as BusinessFrame<Assessment>[];
			expect(frames.flatMap((f) => f.rows).some((row) => verifyBusiness(e, row.value))).toBe(true);
			const p = r.events.publication.at(-1) as Publication;
			expect(p?.rows).toHaveLength(1);
			expect(p.rows[0].material).toBe("matched");
			expect(p.rows[0].recorded).toBe("admitted-no-outcome");
		});
		it("retains material and active obligation when UI disconnects, settles only exact outcome", () => {
			const r = run(mode),
				e = evaluationFixture();
			r.send("pack", evaluationPack([e]));
			r.drive(e);
			const f = policyFacts(e),
				outcome = r.outcome();
			r.disconnect();
			r.send("inbox", { ...f.inbox, outcomes: [{ ...outcome, effectId: "wrong" }] });
			expect([...r.state().effects.values()][0].outcome).toBeUndefined();
			r.connect();
			const p = r.events.publication.at(-1) as Publication;
			expect(p.rows[0].material).toBe("matched");
			expect(p.rows[0].recorded).toBe("admitted-no-outcome");
			r.send("inbox", { ...f.inbox, outcomes: [outcome] });
			expect((r.events.publication.at(-1) as Publication).rows[0].recorded).toBe("succeeded");
		});
		it("normal transaction makes no proposal", () => {
			const r = run(mode),
				e = evaluationFixture(0, "coffee", 1, false);
			r.send("pack", evaluationPack([e]));
			r.drive(e);
			expect(r.state().effects.size).toBe(0);
			expect((r.events.assessment.at(-1) as BusinessFrame<Assessment>).rows[0].value.flagged).toBe(
				false,
			);
		});
		it("missing verification waits and recovery uses actual receipt DATA", () => {
			const r = run(mode),
				e = evaluationFixture(),
				f = policyFacts(e);
			r.send("pack", evaluationPack([e]));
			r.send("current", f.current);
			r.send("local", f.local);
			r.send("inbox", f.inbox);
			r.send("arrivals", { packRef: presetBinding.packRef, evaluationRefs: [e.evaluationRef] });
			expect([...r.state().effects.values()].every((x) => x.admission === undefined)).toBe(true);
			r.send("verification", f.verification);
			expect((r.events.publication.at(-1) as Publication).rows[0].recorded).toBe(
				"admitted-no-outcome",
			);
		});
	});

// These input/business proofs do not depend on the separately diagnosed existing lane adapter.
describe("D164 finite passive input and business edges", () => {
	it("processes valid recovery after invalid arrival in one DATA batch", () => {
		const r = run(),
			e = evaluationFixture();
		r.send("pack", evaluationPack([e]));
		r.send(
			"arrivals",
			{ wrong: true },
			{ packRef: presetBinding.packRef, evaluationRefs: [e.evaluationRef] },
		);
		expect(
			(r.events.assessment as BusinessFrame<Assessment>[])
				.flatMap((f) => f.rows)
				.some((x) => verifyBusiness(e, x.value)),
		).toBe(true);
	});
	it("does not fabricate a verifier pass for ill-conditioned finite inputs", () => {
		const r = run(),
			e = evaluationWithAmounts([999999999.9999999, 1000000000, 999999999.9999999]);
		r.send("pack", evaluationPack([e]));
		r.send("arrivals", { packRef: presetBinding.packRef, evaluationRefs: [e.evaluationRef] });
		const observed = (r.events.assessment as BusinessFrame<Assessment>[])
			.flatMap((f) => f.rows)
			.at(-1)!;
		expect(observed).toBeDefined();
		expect(verifyBusiness(e, observed.value)).toBe(false);
		// This is a verifier-domain limitation, not permission to relax its tolerance.
	});
	it("processes two independent vendors in one arrival frame", () => {
		const r = run(),
			a = evaluationFixture(),
			b = evaluationFixture(0, "tea");
		r.send("pack", evaluationPack([a, b]));
		r.send("arrivals", {
			packRef: presetBinding.packRef,
			evaluationRefs: [a.evaluationRef, b.evaluationRef],
		});
		const rows = (r.events.assessment as BusinessFrame<Assessment>[]).flatMap((f) => f.rows);
		expect(new Set(rows.map((r) => r.evaluation.evaluationRef))).toEqual(
			new Set([a.evaluationRef, b.evaluationRef]),
		);
		for (const row of rows) expect(verifyBusiness(row.evaluation, row.value)).toBe(true);
	});
	it("native INVALIDATE blocks new admission until verification DATA recovers", () => {
		const r = run(),
			e = evaluationFixture(),
			f = policyFacts(e),
			seen: any[] = [];
		const stop = r.built.admission.publicationPolicy.subscribe((m) => {
			if (m[0] === "DATA") seen.push(m[1]);
		});
		try {
			r.send("pack", evaluationPack([e]));
			r.send("verification", f.verification);
			r.sources.verification.down([["INVALIDATE"]]);
			// A different receipt must not resurrect the invalidated receipt from private history.
			r.send("verification", policyFacts(evaluationFixture(0, "tea")).verification);
			r.send("current", f.current);
			r.send("local", f.local);
			r.send("inbox", f.inbox);
			r.send("arrivals", { packRef: presetBinding.packRef, evaluationRefs: [e.evaluationRef] });
			expect(seen.flatMap((f) => f.rows).some((r) => r.value.admission?.state === "admitted")).toBe(
				false,
			);
			r.send("verification", f.verification);
			expect(seen.flatMap((f) => f.rows).at(-1)?.value.admission?.state).toBe("admitted");
		} finally {
			stop();
		}
	});
	it("retains conflicting receipt identity across distinct frames", () => {
		const r = run(),
			e = evaluationFixture(),
			f = policyFacts(e),
			seen: unknown[] = [];
		const stop = r.built.admission.verificationFacts.subscribe((m) => {
			if (m[0] === "DATA") seen.push(m[1]);
		});
		r.send("verification", f.verification);
		r.send("verification", {
			...f.verification,
			receipts: [{ ...f.verification.receipts[0], verdict: "fail" }],
		});
		expect(seen.at(-1)).toMatchObject({
			valid: false,
			issue: { code: "spending/receipt-identity-conflict" },
		});
		r.send("verification", f.verification);
		expect(seen.at(-1)).toMatchObject({ valid: false });
		stop();
	});
	it("retains both same-wave receipt frames by exact identity", () => {
		const r = run(),
			a = policyFacts(evaluationFixture()),
			b = policyFacts(evaluationFixture(0, "tea")),
			seen: any[] = [];
		const stop = r.built.admission.verificationFacts.subscribe((m) => {
			if (m[0] === "DATA") seen.push(m[1]);
		});
		r.send("verification", a.verification, b.verification);
		expect(seen.at(-1).value.receipts).toHaveLength(2);
		stop();
	});
	it("rejects an exact failed verifier without grant or inbox observations", () => {
		const r = run(),
			e = evaluationFixture(),
			f = policyFacts(e),
			seen: any[] = [];
		const stop = r.built.admission.publicationPolicy.subscribe((m) => {
			if (m[0] === "DATA") seen.push(m[1]);
		});
		r.send("pack", evaluationPack([e]));
		r.send("verification", {
			...f.verification,
			receipts: [{ ...f.verification.receipts[0], verdict: "fail" }],
		});
		r.send("arrivals", { packRef: presetBinding.packRef, evaluationRefs: [e.evaluationRef] });
		expect(seen.flatMap((f) => f.rows).at(-1)?.value).toMatchObject({
			admission: { state: "rejected" },
			terminal: { state: "failed" },
		});
		stop();
	});
});
