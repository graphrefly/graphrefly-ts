import { expect, it } from "vitest";
import {
	OfflineAlertResource,
	prepareLocalSpendingProofResource,
	prepareLocalSpendingResource,
	prepareSpendingProofResourceWithIO,
	prepareSpendingResourceWithIO,
	SpendingResource,
} from "../../../../examples/spending-alerts/causal-resource.js";
import { drain, runHost } from "../../../../scripts/fixtures/spending-focused-host-harness.js";
import {
	evaluationFixture,
	evaluationPack,
	policyFacts,
	presetBinding,
} from "../../../../scripts/fixtures/spending-preset-harness.js";
import { batch } from "../batch/batch.js";

it("exclusive injected preparation binds one handle without claiming actual-file evidence", async () => {
	const opens: unknown[] = [],
		writes: string[] = [];
	let closed = 0;
	const resource = await prepareSpendingResourceWithIO("/memory/case", presetBinding, {
		async open(...args) {
			opens.push(args);
			return {
				async write(payload) {
					writes.push(payload);
					return { bytesWritten: Buffer.byteLength(payload) };
				},
				async close() {
					closed++;
				},
			};
		},
	});
	expect(opens).toEqual([["/memory/case", "wx+", 0o600]]);
	expect(resource.mode).toBe("in-memory-local-file");
	const abandoned = resource.claim();
	abandoned.abort();
	const lease = resource.claim();
	expect(() => abandoned.transfer()).toThrow();
	expect(() => abandoned.write("wrong")).toThrow();
	abandoned.abort();
	expect(() => resource.claim()).toThrow();
	lease.transfer();
	expect(await lease.write("exact\n")).toEqual({ bytesWritten: 6 });
	expect(writes).toEqual(["exact\n"]);
	await resource.close();
	await resource.close();
	expect(closed).toBe(1);
	expect(() => lease.write("late")).toThrow();
	expect(() => resource.claim()).toThrow();
});
it("close rejects busy and never resets the transferred ownership", async () => {
	let finish!: (v: { bytesWritten: number }) => void;
	let closes = 0;
	const resource = await prepareSpendingResourceWithIO("/memory/pending", presetBinding, {
		async open() {
			return {
				write: () =>
					new Promise((resolve) => {
						finish = resolve;
					}),
				async close() {
					closes++;
				},
			};
		},
	});
	const lease = resource.claim();
	lease.transfer();
	const pending = lease.write("x");
	await expect(resource.close()).rejects.toThrow(/busy/);
	expect(closes).toBe(0);
	finish({ bytesWritten: 1 });
	await pending;
	await resource.close();
	expect(closes).toBe(1);
	lease.abort();
	expect(() => resource.claim()).toThrow();
});
it("runtime brand rejects prototype fakes and arbitrary construction tokens", () => {
	const fake = Object.create(SpendingResource.prototype);
	expect(SpendingResource.is(fake)).toBe(false);
	expect(
		() =>
			new SpendingResource(
				Symbol(),
				presetBinding,
				"prepared-local-file",
				async () => ({ bytesWritten: 0 }),
				async () => {},
			),
	).toThrow(/unprepared/);
	const offline = new OfflineAlertResource(presetBinding, async () => ({ bytesWritten: 0 }));
	expect(SpendingResource.is(offline)).toBe(true);
	expect(offline.mode).toBe("offline-simulation");
	expect(() => Object.defineProperty(offline, "mode", { value: "prepared-local-file" })).toThrow();
});
it("exclusive open failure never falls back to an existing path", async () => {
	let opens = 0;
	await expect(
		prepareSpendingResourceWithIO("/memory/existing", presetBinding, {
			async open() {
				opens++;
				throw new Error("EEXIST");
			},
		}),
	).rejects.toThrow("EEXIST");
	expect(opens).toBe(1);
});

it("unknown submission is published and stops a subsequent independent request", async () => {
	const run = runHost("off", async () => ({ bytesWritten: 0 }));
	try {
		await drain();
		const a = evaluationFixture(0, "coffee"),
			b = evaluationFixture(0, "tea");
		run.send("pack", evaluationPack([a, b]));
		for (const e of [a, b]) {
			const f = policyFacts(e);
			batch(() => {
				run.send("current", f.current);
				run.send("verification", f.verification);
				run.send("local", f.local);
				run.send("arrivals", { packRef: presetBinding.packRef, evaluationRefs: [e.evaluationRef] });
			});
			await drain();
		}
		expect(run.calls).toHaveLength(1);
		expect(run.host.inspect()).toMatchObject({ dispatchStopped: true, normalEndReady: false });
		expect(run.host.inspect().records[0].outcome?.state).toBe("unknown");
		expect([...run.state().effects.values()].some((e) => e.outcome?.state === "unknown")).toBe(
			true,
		);
		expect(run.host.source.cache?.readiness.ready).toBe(false);
	} finally {
		run.teardown();
	}
});

it("local preparation rejects an unrelated or noncanonical destination before opening", async () => {
	for (const prepare of [prepareLocalSpendingResource, prepareLocalSpendingProofResource]) {
		await expect(prepare("/must-not-open", presetBinding)).rejects.toThrow(/destination/);
		await expect(
			prepare("/memory/../must-not-open", {
				...presetBinding,
				destinationRef: { kind: "local-inbox", id: "/memory/../must-not-open" },
			}),
		).rejects.toThrow(/canonical/);
	}
});
it("failed close remains the same failure on concurrent and later attempts without retry", async () => {
	const failure = new Error("close failed");
	let count = 0;
	const resource = await prepareSpendingResourceWithIO("/memory/close", presetBinding, {
		async open() {
			return {
				async write() {
					return { bytesWritten: 0 };
				},
				async close() {
					count++;
					throw failure;
				},
			};
		},
	});
	const attempts = [resource.close(), resource.close()];
	for (const attempt of attempts) await expect(attempt).rejects.toBe(failure);
	await expect(resource.close()).rejects.toBe(failure);
	expect(count).toBe(1);
	expect(() => resource.claim()).toThrow();
});
for (const action of ["full", "short1", "reject-before-write", "pending"] as const) {
	it(`proof transport holds actual bytes until ${action} settlement`, async () => {
		const bytes: Uint8Array[] = [];
		const proof = await prepareSpendingProofResourceWithIO("/memory/proof", presetBinding, {
			async open() {
				return {
					async writeBytes(payload) {
						bytes.push(payload);
						return { bytesWritten: payload.length };
					},
					async close() {},
				};
			},
		});
		expect(proof.resource.mode).toBe("in-memory-local-file-proof");
		const lease = proof.resource.claim();
		lease.transfer();
		const result = lease.write("éx");
		const observed = result.then(
			(value) => ({ value }),
			(error) => ({ error }),
		);
		expect(bytes).toHaveLength(0);
		expect(proof.attemptedPayloads).toEqual(["éx"]);
		expect(proof.transportAttempts).toEqual([]);
		await expect(proof.resource.close()).rejects.toThrow(/busy/);
		await proof.settle(0, action);
		await expect(proof.settle(0, "full")).rejects.toThrow(/already/);
		if (action === "pending") {
			expect(bytes).toHaveLength(0);
			await expect(proof.resource.close()).rejects.toThrow(/busy/);
			return;
		}
		const completion = await observed;
		if (action === "reject-before-write") {
			expect(completion).toHaveProperty("error");
			expect(bytes).toHaveLength(0);
		} else {
			expect(completion).toEqual({ value: { bytesWritten: action === "full" ? 3 : 1 } });
			expect([...bytes[0]]).toEqual(action === "full" ? [195, 169, 120] : [195]);
		}
		await proof.resource.close();
	});
}
