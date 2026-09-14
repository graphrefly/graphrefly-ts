/** Characterizes existing admission; no host reservation, I/O or quota qualification. */
import { expect, it } from "vitest";
import {
	evaluationFixture,
	evaluationPack,
	policyFacts,
	presetRun,
} from "../../../../scripts/fixtures/spending-preset-harness.js";
import { batch } from "../batch/batch.js";

for (const mode of ["off", "summary"] as const) {
	it(`two exact requests can share one readiness observation (${mode})`, () => {
		const run = presetRun(mode);
		try {
			const evaluations = [evaluationFixture(0, "coffee"), evaluationFixture(0, "tea")];
			const facts = evaluations.map((e) => policyFacts(e));
			run.send("pack", evaluationPack(evaluations));
			batch(() => {
				run.send("current", {
					...facts[0].current,
					current: facts.flatMap((f) => f.current.current),
				});
				run.send("verification", {
					...facts[0].verification,
					receipts: facts.flatMap((f) => f.verification.receipts),
				});
				run.send("local", { ...facts[0].local, grants: facts.flatMap((f) => f.local.grants) });
				run.send("inbox", facts[0].inbox);
				run.send("arrivals", {
					packRef: facts[0].inbox.binding.packRef,
					evaluationRefs: evaluations.map((e) => e.evaluationRef),
				});
			});
			const records = [...run.state().effects.values()];
			expect(facts[0].inbox.readiness.availableSlots).toBe(1);
			expect(records).toHaveLength(2);
			expect(records.every((r) => r.admission?.state === "admitted")).toBe(true);
			expect(new Set(records.map((r) => r.proposal.requestRef.id)).size).toBe(2);
			expect(records.every((r) => r.outcome === undefined)).toBe(true);
			// Repeated facts do not mint another request or settle the existing obligations.
			run.send("inbox", facts[0].inbox);
			const repeated = [...run.state().effects.values()];
			expect(repeated).toHaveLength(2);
			expect(repeated.every((r) => r.outcome === undefined)).toBe(true);
		} finally {
			run.cleanup();
		}
	});
}
