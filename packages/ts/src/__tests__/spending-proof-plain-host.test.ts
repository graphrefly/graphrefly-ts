/** Independent plain execution boundary, simulated transport only. */
import { expect, it, vi } from "vitest";
import {
	evaluationFixture,
	evaluationPack,
	policyFacts,
	presetBinding,
} from "../../../../scripts/fixtures/spending-preset-harness.js";
import { oracleRequest } from "../../../../scripts/fixtures/spending-preset-oracle.js";
import {
	type PlainHostStep,
	PlainSpendingProofHost,
} from "../../../../scripts/fixtures/spending-proof-plain-host.js";

async function drain() {
	for (let i = 0; i < 12; i++) await Promise.resolve();
}
function setup(write?: (payload: string) => Promise<{ bytesWritten: number }>) {
	const calls: string[] = [];
	let resolve!: (value: { bytesWritten: number }) => void;
	const pending = new Promise<{ bytesWritten: number }>((yes) => {
		resolve = yes;
	});
	const host = new PlainSpendingProofHost(presetBinding, (payload) => {
		calls.push(payload);
		return write ? write(payload) : pending;
	});
	return { host, calls, resolve };
}
function factsFor(e = evaluationFixture()): PlainHostStep[] {
	const f = policyFacts(e);
	return [
		{ lane: "current", value: f.current },
		{ lane: "verification", value: f.verification },
		{ lane: "local", value: f.local },
		{
			lane: "arrivals",
			value: { packRef: presetBinding.packRef, evaluationRefs: [e.evaluationRef] },
		},
	];
}
it("plain host writes independent oracle bytes, retains exact completion and replays once", async () => {
	const { host, calls, resolve } = setup();
	await drain();
	const e = evaluationFixture();
	host.feed("pack", evaluationPack([e]));
	host.feedMany(factsFor(e));
	expect(calls).toEqual([`${oracleRequest(e, presetBinding)!.body.payloadText}\n`]);
	expect(host.inspect().inFlight).toBe(1);
	expect(host.observations().effects[0].outcome).toBeNull();
	resolve({ bytesWritten: Buffer.byteLength(calls[0]) });
	await drain();
	const r = host.inspect().records[0];
	expect(r.outcome).toMatchObject({
		...host.observations().effects[0].proposal,
		admissionRef: r.admission.admissionRef,
		state: "succeeded",
	});
	host.feedMany(factsFor(e));
	await drain();
	expect(calls).toHaveLength(1);
	host.feed("local", { ...policyFacts(e).local, stop: true });
	await drain();
	expect(host.inspect().normalEndReady).toBe(true);
});
it("two actual admissions reserve one write and retain exact busy refusal without queue", async () => {
	const { host, calls, resolve } = setup();
	await drain();
	const es = [evaluationFixture(), evaluationFixture(0, "tea")],
		fs = es.map((e) => policyFacts(e));
	host.feed("pack", evaluationPack(es));
	host.feedMany([
		{ lane: "current", value: { ...fs[0].current, current: fs.flatMap((f) => f.current.current) } },
		{
			lane: "verification",
			value: { ...fs[0].verification, receipts: fs.flatMap((f) => f.verification.receipts) },
		},
		{ lane: "local", value: { ...fs[0].local, grants: fs.flatMap((f) => f.local.grants) } },
		{
			lane: "arrivals",
			value: { packRef: presetBinding.packRef, evaluationRefs: es.map((e) => e.evaluationRef) },
		},
	]);
	expect(host.inspect().records).toHaveLength(2);
	expect(calls).toHaveLength(1);
	await drain();
	expect(host.observations().effects[1].outcome?.state).toBe("cancelled");
	resolve({ bytesWritten: Buffer.byteLength(calls[0]) });
	await drain();
	expect(calls).toHaveLength(1);
});
for (const change of ["stop", "revoke", "expire", "receipt"] as const)
	it(`final plain guard blocks ${change} after sticky admission`, async () => {
		const { host, calls } = setup();
		await drain();
		const e = evaluationFixture(),
			f = policyFacts(e);
		host.feed("pack", evaluationPack([e]));
		const last: PlainHostStep =
			change === "receipt"
				? { lane: "verification", value: { ...f.verification, receipts: [] } }
				: {
						lane: "local",
						value: {
							...f.local,
							stop: change === "stop",
							grants: f.local.grants.map((g) => ({
								...g,
								revoked: change === "revoke",
								validThrough: change === "expire" ? 0 : g.validThrough,
							})),
						},
					};
		host.feedMany([...factsFor(e), last]);
		await drain();
		expect(calls).toHaveLength(0);
		expect(host.inspect().records[0].outcome?.state).toBe("cancelled");
		expect(host.observations().effects[0].outcome?.state).toBe("cancelled");
	});
for (const kind of ["throw", "reject", "short", "null", "getter"] as const)
	it(`${kind} retains unknown, delivers it, and blocks later writes`, async () => {
		const { host, calls } = setup(() => {
			if (kind === "throw") throw Error("maybe submitted");
			if (kind === "reject") return Promise.reject(Error("maybe submitted"));
			if (kind === "short") return Promise.resolve({ bytesWritten: 1 });
			if (kind === "null") return Promise.resolve(null as unknown as { bytesWritten: number });
			return Promise.resolve(
				Object.defineProperty({}, "bytesWritten", {
					get() {
						throw Error("getter");
					},
				}) as { bytesWritten: number },
			);
		});
		await drain();
		const es = [evaluationFixture(), evaluationFixture(0, "tea")];
		host.feed("pack", evaluationPack(es));
		host.feedMany(factsFor(es[0]));
		await drain();
		expect(host.inspect().records[0].outcome?.state).toBe("unknown");
		expect(host.observations().effects[0].outcome?.state).toBe("unknown");
		host.feedMany(factsFor(es[1]));
		await drain();
		expect(calls).toHaveLength(1);
		expect(host.inspect().normalEndReady).toBe(false);
		expect(host.inspect().unknown).toBe(true);
	});
it("source scheduling failure before write retains known no-submit and faults", async () => {
	const { host, calls } = setup();
	await drain();
	const e = evaluationFixture();
	host.feed("pack", evaluationPack([e]));
	const spy = vi.spyOn(globalThis, "queueMicrotask").mockImplementation(() => {
		throw Error("scheduler");
	});
	try {
		host.feedMany(factsFor(e));
	} finally {
		spy.mockRestore();
	}
	expect(calls).toHaveLength(0);
	expect(host.inspect().fault).toBe("schedule-failed");
	expect(host.inspect().records[0].outcome?.state).toBe("cancelled");
	expect(host.observations().effects[0].outcome).toBeNull();
});
it("observer detachment preserves pending write and retained results", async () => {
	const { host, calls, resolve } = setup();
	await drain();
	let observed = 0;
	const stop = host.observe(() => {
		observed++;
	});
	const e = evaluationFixture();
	host.feed("pack", evaluationPack([e]));
	host.feedMany(factsFor(e));
	stop();
	const count = observed;
	host.feed("local", { ...policyFacts(e).local, stop: true });
	resolve({ bytesWritten: Buffer.byteLength(calls[0]) });
	await drain();
	expect(observed).toBe(count);
	expect(host.inspect().normalEndReady).toBe(true);
	expect(host.inspect().records[0].outcome?.state).toBe("succeeded");
});
it("normal branch, stale verification and missing pack frontier remain honest", async () => {
	const { host, calls } = setup();
	await drain();
	const normal = evaluationFixture(0, "coffee", 2, false),
		future = evaluationFixture(0, "tea");
	host.feed("pack", evaluationPack([normal, future]));
	host.feedMany(factsFor(normal));
	await drain();
	expect(calls).toHaveLength(0);
	expect(host.inspect().records).toHaveLength(0);
	const f = policyFacts(future);
	host.feedMany(
		factsFor(future).map((step) =>
			step.lane === "verification"
				? {
						...step,
						value: {
							...f.verification,
							receipts: f.verification.receipts.map((r) => ({
								...r,
								sourceDigest: `sha256:${"0".repeat(64)}`,
							})),
						},
					}
				: step,
		),
	);
	await drain();
	expect(calls).toHaveLength(0);
	host.feed("local", { ...f.local, stop: true });
	await drain();
	expect(host.inspect().normalEndReady).toBe(false);
});
it("64 sequential writes retain lifetime capacity; changed pack cannot add a 65th", async () => {
	const { host, calls } = setup(async (payload) => ({ bytesWritten: Buffer.byteLength(payload) }));
	await drain();
	const es = Array.from({ length: 32 }, (_, i) => [
		evaluationFixture(i),
		evaluationFixture(i, "tea"),
	]).flat();
	host.feed("pack", evaluationPack(es));
	for (const e of es) {
		host.feedMany(factsFor(e));
		await drain();
	}
	expect(calls).toHaveLength(64);
	expect(host.inspect().records).toHaveLength(64);
	expect(host.inspect().records.every((r) => r.outcome?.state === "succeeded")).toBe(true);
	const latest = es.slice(-2).map((e) => policyFacts(e));
	host.feedMany([
		{
			lane: "current",
			value: { ...latest[0].current, current: latest.flatMap((f) => f.current.current) },
		},
		{
			lane: "local",
			value: { ...latest[0].local, stop: true, grants: latest.flatMap((f) => f.local.grants) },
		},
	]);
	await drain();
	expect(host.inspect().normalEndReady).toBe(true);
	const extra = evaluationFixture(32);
	host.feed("pack", evaluationPack([extra]));
	host.feedMany(factsFor(extra));
	await drain();
	expect(calls).toHaveLength(64);
	expect(host.inspect().records).toHaveLength(64);
	expect(host.inspect().normalEndReady).toBe(false);
}, 20000);

it("exposes actual immutable business material before any verification receipt", async () => {
	const { host, calls } = setup();
	await drain();
	const e = evaluationFixture();
	host.feed("pack", evaluationPack([e]));
	host.feed("arrivals", { packRef: presetBinding.packRef, evaluationRefs: [e.evaluationRef] });
	const observed = host.observations();
	expect(observed.materials).toHaveLength(1);
	expect(observed.materials[0][1]).toEqual(oracleRequest(e, presetBinding));
	expect(Object.isFrozen(observed.materials[0][1])).toBe(true);
	expect(calls).toHaveLength(0);
	expect(host.inspect().records).toHaveLength(0);
});
it("observer delivery failure retains completed write and stops later dispatch", async () => {
	const { host, calls, resolve } = setup();
	await drain();
	const es = [evaluationFixture(), evaluationFixture(0, "tea")];
	host.feed("pack", evaluationPack(es));
	host.feedMany(factsFor(es[0]));
	await drain();
	const detach = host.observe((observation) => {
		if (observation.effects.some((effect) => effect.outcome?.state === "succeeded"))
			throw Error("delivery observer failed");
	});
	resolve({ bytesWritten: Buffer.byteLength(calls[0]) });
	await drain();
	expect(host.inspect().records[0].outcome?.state).toBe("succeeded");
	expect(host.inspect().fault).toBe("delivery-failed");
	expect(host.inspect().dispatchStopped).toBe(true);
	detach();
	host.feedMany(factsFor(es[1]));
	await drain();
	expect(calls).toHaveLength(1);
	expect(host.inspect().normalEndReady).toBe(false);
});

it("unknown completion reserves an exact cancellation for a fresh admission before readiness delivery", async () => {
	const { host, calls, resolve } = setup();
	await drain();
	const first = evaluationFixture(),
		second = evaluationFixture(0, "tea");
	host.feed("pack", evaluationPack([first, second]));
	const queued: (() => void)[] = [];
	const schedule = vi.spyOn(globalThis, "queueMicrotask").mockImplementation((callback) => {
		queued.push(callback);
	});
	try {
		host.feedMany(factsFor(first));
		resolve({ bytesWritten: 0 });
		await drain();
		expect(host.inspect().unknown).toBe(true);
		expect(host.inspect().records).toHaveLength(1);
		host.feedMany(factsFor(second));
		expect(
			host.observations().effects.filter((e) => e.admission?.state === "admitted"),
		).toHaveLength(2);
		expect(calls).toHaveLength(1);
		expect(host.inspect().records).toHaveLength(2);
		const rejected = host
			.inspect()
			.records.find(
				(r) => r.request.body.occurrence.revisionDomain === second.occurrence.revisionDomain,
			)!;
		expect(rejected.outcome).toMatchObject({
			admissionRef: rejected.admission.admissionRef,
			state: "cancelled",
		});
		while (queued.length) queued.shift()!();
		expect(
			host
				.observations()
				.effects.find(
					(e) => e.proposal.occurrence.revisionDomain === second.occurrence.revisionDomain,
				)?.outcome,
		).toEqual(rejected.outcome);
		expect(host.inspect().normalEndReady).toBe(false);
	} finally {
		schedule.mockRestore();
	}
});
