/** Admission does not freeze authorization at the actual offline execution boundary. */
import { expect, it, vi } from "vitest";
import { drain, runHost } from "../../../../scripts/fixtures/spending-focused-host-harness.js";
import {
	evaluationFixture,
	evaluationPack,
	policyFacts,
} from "../../../../scripts/fixtures/spending-preset-harness.js";

for (const mode of ["off", "summary"] as const) {
	for (const change of ["stop", "revoke", "expire-grant", "remove-receipt"] as const) {
		it(`${mode}: ${change} after admission prevents actual execution and returns exact no-submit`, async () => {
			const run = runHost(mode);
			const lock = Symbol("hold-execution");
			try {
				await drain();
				run.host.guard.up([["PAUSE", lock]]);
				const e = evaluationFixture();
				const f = policyFacts(e);
				run.drive([e]);
				const admitted = [...run.state().effects.values()][0];
				expect(admitted.admission?.state).toBe("admitted");
				expect(run.calls).toHaveLength(0);
				if (change === "remove-receipt") {
					run.send("verification", { ...f.verification, receipts: [] });
				} else {
					run.send("local", {
						...f.local,
						stop: change === "stop",
						grants: f.local.grants.map((g) => ({
							...g,
							revoked: change === "revoke",
							validThrough: change === "expire-grant" ? 0 : g.validThrough,
						})),
					});
				}
				run.host.guard.up([["RESUME", lock]]);
				await drain();
				expect(run.calls).toHaveLength(0);
				const retained = run.host.inspect();
				expect(retained.records).toHaveLength(1);
				expect(retained.writes).toBe(0);
				expect(retained.fault).toBeUndefined();
				const record = [...run.state().effects.values()][0];
				expect(record.outcome).toMatchObject({
					...admitted.proposal,
					admissionRef: admitted.admission!.admissionRef,
					state: "cancelled",
					result: { kind: "error", error: { code: "spending-host/final-guard" } },
				});
				expect(retained.records[0].outcome).toEqual(record.outcome);
			} finally {
				run.teardown();
			}
		});
	}
	it(`${mode}: revocation after submission retains obligation until the exact completion`, async () => {
		const run = runHost(mode);
		try {
			await drain();
			const e = evaluationFixture();
			run.drive([e]);
			expect(run.calls).toHaveLength(1);
			const local = policyFacts(e).local;
			run.disconnect();
			run.send("local", {
				...local,
				stop: true,
				grants: local.grants.map((g) => ({ ...g, revoked: true })),
			});
			await drain();
			expect(run.host.inspect().records).toHaveLength(1);
			expect(run.host.inspect().records[0].outcome).toBeUndefined();
			expect([...run.state().effects.values()][0].outcome).toBeUndefined();
			expect(run.host.inspect().normalEndReady).toBe(false);
			run.pending.resolve({ bytesWritten: Buffer.byteLength(run.calls[0]) });
			await drain();
			run.connect();
			expect(run.calls).toHaveLength(1);
			expect([...run.state().effects.values()][0].outcome?.state).toBe("succeeded");
			expect(run.host.inspect().normalEndReady).toBe(true);
		} finally {
			run.teardown();
		}
	});
}

for (const mode of ["off", "summary"] as const) {
	it(`${mode}: completion produced during source delivery gets one subsequent full snapshot`, async () => {
		let writes = 0;
		const run = runHost(mode, (payload) => {
			writes++;
			if (writes === 2) throw new Error("possible second submission");
			return Promise.resolve({ bytesWritten: Buffer.byteLength(payload) });
		});
		let spy: ReturnType<typeof vi.spyOn> | undefined;
		try {
			await drain();
			const evaluations = [evaluationFixture(), evaluationFixture(0, "tea")];
			run.send("pack", evaluationPack(evaluations));
			const send = (e: (typeof evaluations)[number]) => {
				const f = policyFacts(e);
				run.send("current", f.current);
				run.send("verification", f.verification);
				run.send("local", f.local);
				run.send("arrivals", {
					packRef: f.local.binding.packRef,
					evaluationRefs: [e.evaluationRef],
				});
			};
			const original = run.host.source.down.bind(run.host.source);
			let injected = false;
			const snapshots: string[][] = [];
			// Execute after the actual source wave returns, still within host delivery.
			// This hook does not fabricate an outcome: the second actual resource call throws.
			spy = vi.spyOn(run.host.source, "down").mockImplementation((messages) => {
				original(messages);
				const data = messages.find((m) => m[0] === "DATA");
				if (!data) return;
				const frame = data[1] as { outcomes: { state: string }[] };
				snapshots.push(frame.outcomes.map((o) => o.state));
				if (!injected && frame.outcomes.some((o) => o.state === "succeeded")) {
					injected = true;
					send(evaluations[1]);
				}
			});
			send(evaluations[0]);
			await drain();
			expect(injected).toBe(true);
			expect(run.calls).toHaveLength(2);
			expect(run.host.inspect().records.map((r) => r.outcome?.state)).toEqual([
				"succeeded",
				"unknown",
			]);
			expect([...run.state().effects.values()].map((r) => r.outcome?.state)).toEqual([
				"succeeded",
				"unknown",
			]);
			const successful = snapshots.findIndex((s) => s.includes("succeeded"));
			expect(snapshots.slice(successful)).toEqual([["succeeded"], ["succeeded", "unknown"]]);
			const count = run.host.inspect().notifications;
			await drain();
			expect(run.host.inspect().notifications).toBe(count);
			expect(run.host.inspect().fault).toBeUndefined();
			expect(run.host.inspect().normalEndReady).toBe(false);
		} finally {
			spy?.mockRestore();
			run.teardown();
		}
	});
}
