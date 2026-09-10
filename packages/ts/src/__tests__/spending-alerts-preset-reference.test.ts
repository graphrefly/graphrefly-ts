import { setImmediate } from "node:timers/promises";
import { describe, expect, it, vi } from "vitest";
import type {
	Assessment,
	BusinessFrame,
} from "../../../../examples/spending-alerts/causal-business.js";
import { checkInput } from "../../../../examples/spending-alerts/causal-inputs.js";
import {
	evaluationFixture,
	evaluationPack,
	policyFacts,
	presetBinding,
	presetRun,
} from "../../../../scripts/fixtures/spending-preset-harness.js";
import {
	oracleCanonical,
	verifyBusiness,
} from "../../../../scripts/fixtures/spending-preset-oracle.js";
import { PlainSpending } from "../../../../scripts/fixtures/spending-preset-plain.js";
import {
	type ReferenceLane,
	referenceInput,
} from "../../../../scripts/fixtures/spending-preset-reference-input.js";
import { referenceRun } from "../../../../scripts/fixtures/spending-preset-reference-run.js";
import {
	PERF_PROFILES,
	profileScenario,
	rebindEvaluation,
} from "../../../../scripts/fixtures/spending-preset-scenarios.js";

type Mutable<T> = { -readonly [K in keyof T]: Mutable<T[K]> };
type Run = ReturnType<typeof presetRun> | ReturnType<typeof referenceRun>;
function snapshot(r: Run) {
	const rows = new Map<string, Assessment>();
	for (const f of r.events.assessment as BusinessFrame<Assessment>[])
		for (const row of f.rows) rows.set(row.evaluation.evaluationRef, row.value);
	return {
		assessments: [...rows.values()],
		effects: [...(r.state()?.effects.values() ?? [])].map((x) => ({
			proposal: x.proposal,
			admission: x.admission ?? null,
			outcome: x.outcome ?? null,
		})),
		publication: r.events.publication.at(-1),
		coverage: r.events.coverage.at(-1),
		conservation: r.events.conservation.at(-1),
	};
}
function checkPlain(plain: PlainSpending, run: Run, label: string) {
	expect(plain.snapshot(), label).toEqual(snapshot(run).effects);
	const sort = (rows: unknown[]) => rows.map((v) => oracleCanonical(v)).sort();
	expect(sort(plain.evidenceSnapshot()), `${label} retained evidence`).toEqual(
		sort([...(run.state()?.evidence.values() ?? [])]),
	);
	const quiescence = [...(run.state()?.quiescence.values() ?? [])].map(
		({ revisionDomain, evaluatedThroughRevision, lifecycle, retainedEvidence }) => ({
			revisionDomain,
			evaluatedThroughRevision,
			lifecycle,
			retainedEvidence,
		}),
	);
	expect(sort(plain.obligationSnapshot()), `${label} lifecycle/evidence`).toEqual(sort(quiescence));
}
for (const mode of ["off", "summary"] as const)
	describe(`D164 reference ${mode}`, () => {
		for (const profile of PERF_PROFILES)
			it(`matches ${profile.id} after every input stage`, async () => {
				const scenario = profileScenario(profile.id),
					a = presetRun(mode),
					b = referenceRun(mode, presetBinding),
					plain = new PlainSpending(presetBinding);
				try {
					expect(a.owner.nodes.length).toBe(b.owner.nodes.length);
					expect(a.owner.roots.length).toBe(b.owner.roots.length);
					for (const step of scenario.steps) {
						await setImmediate();
						a.send(step.lane, ...step.values);
						b.send(step.lane, ...step.values);
						for (const v of step.values) plain.push(step.lane, v);
						expect(snapshot(b), step.lane).toEqual(snapshot(a));
						checkPlain(plain, a, step.lane);
					}
					for (const e of scenario.evaluations) {
						const observed = snapshot(b).assessments.find(
							(x) => x.evaluationRef === e.evaluationRef,
						)!;
						expect(verifyBusiness(e, observed)).toBe(true);
					}
					a.disconnect();
					b.disconnect();
					a.connect();
					b.connect();
					expect(snapshot(b)).toEqual(snapshot(a));
					for (const r of [a, b]) {
						const before = r.state().effects.size;
						r.send("arrivals", scenario.arrivals, scenario.arrivals);
						expect(r.state().effects.size).toBe(before);
					}
					expect(snapshot(b)).toEqual(snapshot(a));
				} finally {
					a.cleanup();
					b.cleanup();
				}
			}, 60000);
		it("retains admitted obligations and rejects wrong outcomes across detach", () => {
			const a = presetRun(mode),
				b = referenceRun(mode, presetBinding),
				e = evaluationFixture(),
				f = policyFacts(e);
			try {
				for (const r of [a, b]) {
					r.send("pack", evaluationPack([e]));
					for (const lane of ["current", "verification", "local", "inbox"] as const)
						r.send(lane, f[lane]);
					r.send("arrivals", { packRef: presetBinding.packRef, evaluationRefs: [e.evaluationRef] });
					r.disconnect();
				}
				const outcome = a.outcome();
				for (const r of [a, b]) {
					r.send("inbox", { ...f.inbox, outcomes: [{ ...outcome, effectId: "wrong" }] });
					expect([...(r.state()?.effects.values() ?? [])][0].outcome).toBeUndefined();
					r.connect();
				}
				expect(snapshot(b)).toEqual(snapshot(a));
				for (const r of [a, b]) r.send("inbox", { ...f.inbox, outcomes: [outcome] });
				expect(snapshot(b)).toEqual(snapshot(a));
			} finally {
				a.cleanup();
				b.cleanup();
			}
		});
	});
it("independent decoder rejects malformed frames across every lane", () => {
	const e = evaluationFixture(),
		f = policyFacts(e),
		values = {
			pack: evaluationPack([e]),
			arrivals: { packRef: presetBinding.packRef, evaluationRefs: [e.evaluationRef] },
			...f,
		};
	for (const lane of [
		"pack",
		"arrivals",
		"current",
		"verification",
		"local",
		"inbox",
	] as ReferenceLane[]) {
		for (const raw of [
			values[lane],
			{ ...values[lane], unexpected: true },
			{},
			null,
			{ ...values[lane], binding: {} },
		]) {
			const expected = checkInput(lane, raw, presetBinding).valid;
			let actual = true;
			try {
				referenceInput(lane, raw, presetBinding);
			} catch {
				actual = false;
			}
			expect(actual, lane + oracleCanonical(raw)).toBe(expected);
		}
	}
});

for (const mode of ["off", "summary"] as const) {
	it(`D164 ${mode}: invalidation revokes pending rows but preserves obligations`, () => {
		const a = presetRun(mode),
			b = referenceRun(mode, presetBinding),
			plain = new PlainSpending(presetBinding);
		const first = evaluationFixture(),
			second = rebindEvaluation(evaluationFixture(1), {}, "second", 1),
			facts = policyFacts(first);
		const send = (lane: ReferenceLane, value: unknown) => {
			a.send(lane, value);
			b.send(lane, value);
			plain.push(lane, value);
			expect(snapshot(b), lane).toEqual(snapshot(a));
			checkPlain(plain, a, lane);
		};
		try {
			send("pack", evaluationPack([first, second]));
			send("arrivals", { packRef: presetBinding.packRef, evaluationRefs: [first.evaluationRef] });
			send("arrivals", {});
			send("arrivals", { packRef: presetBinding.packRef, evaluationRefs: [second.evaluationRef] });
			for (const lane of ["current", "verification", "local", "inbox"] as const)
				send(lane, facts[lane]);
			expect([...a.state().effects.values()].every((x) => !x.admission)).toBe(true);
			send("arrivals", { packRef: presetBinding.packRef, evaluationRefs: [first.evaluationRef] });
			expect(
				[...a.state().effects.values()].filter((x) => x.admission?.state === "admitted"),
			).toHaveLength(1);
			send("arrivals", {});
			expect(
				[...a.state().effects.values()].filter((x) => x.admission?.state === "admitted"),
			).toHaveLength(1);
		} finally {
			a.cleanup();
			b.cleanup();
		}
	});
	for (const change of [
		"stale-receipt",
		"unavailable",
		"verifier-fail",
		"old-current",
		"watermark-gap",
		"revoked",
		"expired",
		"stop",
		"not-ready",
	] as const) {
		it(`D164 ${mode}: ${change} has equivalent admission consequences`, () => {
			const a = presetRun(mode),
				b = referenceRun(mode, presetBinding),
				plain = new PlainSpending(presetBinding),
				e = evaluationFixture(),
				f = structuredClone(policyFacts(e)) as Mutable<ReturnType<typeof policyFacts>>;
			switch (change) {
				case "stale-receipt":
					f.verification.receipts[0].sourceDigest = `sha256:${"f".repeat(64)}`;
					break;
				case "unavailable":
					f.verification.receipts[0].verdict = "unavailable";
					break;
				case "verifier-fail":
					f.verification.receipts[0].verdict = "fail";
					break;
				case "old-current":
					f.current.current[0].occurrence.revision++;
					break;
				case "watermark-gap":
					f.current.current[0].watermark = 0;
					break;
				case "revoked":
					f.local.grants[0].revoked = true;
					break;
				case "expired":
					f.local.tick = f.local.grants[0].validThrough + 1;
					break;
				case "stop":
					f.local.stop = true;
					break;
				case "not-ready":
					f.inbox.readiness.ready = false;
					break;
			}
			try {
				const steps = [
					{ lane: "pack" as const, value: evaluationPack([e]) },
					...(["current", "verification", "local", "inbox"] as const).map((lane) => ({
						lane,
						value: f[lane],
					})),
					{
						lane: "arrivals" as const,
						value: { packRef: presetBinding.packRef, evaluationRefs: [e.evaluationRef] },
					},
				];
				for (const { lane, value } of steps) {
					a.send(lane, value);
					b.send(lane, value);
					plain.push(lane, value);
					expect(snapshot(b), lane).toEqual(snapshot(a));
					checkPlain(plain, a, lane);
				}
				expect([...a.state().effects.values()].some((x) => x.admission?.state === "admitted")).toBe(
					false,
				);
			} finally {
				a.cleanup();
				b.cleanup();
			}
		});
	}
}
it("D164: independent pack decoding accepts a legal pack above 1 MiB", () => {
	const evaluations = Array.from({ length: 32 }, (_, i) => {
		const e = evaluationFixture(i, i % 2 ? "tea" : "coffee", 64);
		return rebindEvaluation(
			e,
			{
				prefix: e.prefix.map((t) => ({
					...t,
					id: t.id.padEnd(128, "x"),
					category: "c".repeat(256),
					vendor: t.vendor.padEnd(256, "v"),
				})),
			},
			`large-${i}`,
			1,
		);
	});
	const pack = evaluationPack(evaluations),
		bytes = Buffer.byteLength(oracleCanonical(pack, 4 * 1048576));
	expect(bytes).toBeGreaterThan(1048576);
	expect(bytes).toBeLessThan(4 * 1048576);
	expect(checkInput("pack", pack, presetBinding).valid).toBe(true);
	expect(referenceInput("pack", pack, presetBinding)).toEqual(pack);
	const plain = new PlainSpending(presetBinding);
	plain.push("pack", pack);
	expect(plain.issues).toEqual([]);
	for (const r of [presetRun("off"), referenceRun("off", presetBinding)]) {
		try {
			r.send("pack", pack);
			r.send("arrivals", {
				packRef: presetBinding.packRef,
				evaluationRefs: [evaluations[0].evaluationRef],
			});
			expect(snapshot(r).assessments).toHaveLength(1);
		} finally {
			r.cleanup();
		}
	}
}, 60000);

for (const name of ["score", "material", "store", "assessment", "evidence"] as const) {
	it(`D164 reference removing ${name} dependency blocks admission`, () => {
		let calls: import("vitest").MockInstance<
			import("../graph/construction-scope.js").ConstructionScope["node"]
		>;
		const r = referenceRun("off", presetBinding, (scope) => {
			calls = vi.spyOn(scope, "node");
		});
		const node = r.built.nodes.get(name)!;
		const fn = calls!.mock.calls.find(
			(c) => (c[2] as { name?: string })?.name === `spending/reference/${name}`,
		)?.[1];
		calls!.mockRestore();
		expect(fn).toBeTypeOf("function");
		const errors: unknown[] = [];
		const stop = node.subscribe((m) => {
			if (m[0] === "ERROR") errors.push(m[1]);
		});
		try {
			node.unsubscribeDep(node.deps[0], fn as import("../ctx/types.js").NodeFn);
			const e = evaluationFixture(),
				f = policyFacts(e);
			r.send("pack", evaluationPack([e]));
			for (const lane of ["current", "verification", "local", "inbox"] as const)
				r.send(lane, f[lane]);
			r.send("arrivals", { packRef: presetBinding.packRef, evaluationRefs: [e.evaluationRef] });
			if (node.deps.length)
				expect(errors.some((e) => String(e).includes(`reference dependency ${name}`))).toBe(true);
			expect(snapshot(r).effects.some((x) => x.admission?.state === "admitted")).toBe(false);
		} finally {
			stop();
			r.cleanup();
		}
	});
}

for (const mode of ["off", "summary"] as const) {
	it(`D165 ${mode}: normal lifecycle closes independently from retained evidence`, () => {
		const a = presetRun(mode),
			b = referenceRun(mode, presetBinding),
			plain = new PlainSpending(presetBinding),
			e = evaluationFixture(0, "coffee", 1, false),
			f = policyFacts(e);
		try {
			const send = (lane: ReferenceLane, value: unknown) => {
				a.send(lane, value);
				b.send(lane, value);
				plain.push(lane, value);
				expect(snapshot(b)).toEqual(snapshot(a));
				checkPlain(plain, a, lane);
			};
			send("pack", evaluationPack([e]));
			send("current", f.current);
			send("arrivals", { packRef: presetBinding.packRef, evaluationRefs: [e.evaluationRef] });
			expect(plain.obligationSnapshot()[0]).toMatchObject({
				lifecycle: true,
				retainedEvidence: false,
			});
			send("verification", f.verification);
			expect(plain.obligationSnapshot()[0]).toMatchObject({
				lifecycle: true,
				retainedEvidence: true,
			});
			send("verification", {});
			expect(plain.obligationSnapshot()[0]).toMatchObject({
				lifecycle: true,
				retainedEvidence: true,
			});
		} finally {
			a.cleanup();
			b.cleanup();
		}
	});
	it(`D164 ${mode}: prior inbox DATA is not replayed during admission`, () => {
		const a = presetRun(mode),
			b = referenceRun(mode, presetBinding),
			plain = new PlainSpending(presetBinding),
			e = evaluationFixture(),
			f = policyFacts(e),
			qualified = presetRun(mode);
		qualified.send("pack", evaluationPack([e]));
		qualified.drive(e);
		const exact = qualified.outcome();
		qualified.cleanup();
		const send = (lane: ReferenceLane, value: unknown) => {
			a.send(lane, value);
			b.send(lane, value);
			plain.push(lane, value);
			expect(snapshot(b)).toEqual(snapshot(a));
			checkPlain(plain, a, lane);
		};
		try {
			send("pack", evaluationPack([e]));
			send("current", f.current);
			send("local", f.local);
			send("inbox", {
				...f.inbox,
				outcomes: [{ ...exact, admissionRef: { kind: "wrong", id: "wrong" } }, exact],
			});
			send("arrivals", { packRef: presetBinding.packRef, evaluationRefs: [e.evaluationRef] });
			send("verification", f.verification);
			expect(plain.snapshot()[0].outcome).toBeNull();
			send("inbox", { ...f.inbox, outcomes: [exact] });
			expect(plain.snapshot()[0].outcome?.state).toBe("succeeded");
		} finally {
			a.cleanup();
			b.cleanup();
		}
	});
	it(`D164 ${mode}: lifetime domain capacity includes unrelated current facts`, () => {
		const a = presetRun(mode),
			b = referenceRun(mode, presetBinding),
			plain = new PlainSpending(presetBinding),
			e = evaluationFixture(),
			f = policyFacts(e);
		try {
			const foreign = {
				...f.current,
				current: Array.from({ length: 64 }, (_, i) => ({
					...f.current.current[0],
					revisionDomain: `foreign-${i}`,
					occurrence: { ...e.occurrence, revisionDomain: `foreign-${i}` },
				})),
			};
			for (const [lane, value] of [
				["current", foreign],
				["pack", evaluationPack([e])],
				["current", f.current],
				["verification", f.verification],
				["local", f.local],
				["inbox", f.inbox],
				["arrivals", { packRef: presetBinding.packRef, evaluationRefs: [e.evaluationRef] }],
			] as [ReferenceLane, unknown][]) {
				a.send(lane, value);
				b.send(lane, value);
				plain.push(lane, value);
				expect(snapshot(b)).toEqual(snapshot(a));
				checkPlain(plain, a, lane);
			}
			expect(plain.domains.size).toBe(64);
			expect(plain.snapshot()).toEqual([]);
		} finally {
			a.cleanup();
			b.cleanup();
		}
	});
}

it("D164 pending branch capacity is shared across all three roles", () => {
	const a = presetRun("off"),
		b = referenceRun("off", presetBinding),
		plain = new PlainSpending(presetBinding);
	const evaluations = Array.from({ length: 22 }, (_, i) =>
		rebindEvaluation(evaluationFixture(i, "coffee", 1, false), {}, `branch-${i}`, 1),
	);
	const send = (lane: ReferenceLane, value: unknown) => {
		a.send(lane, value);
		b.send(lane, value);
		plain.push(lane, value);
		expect(snapshot(b)).toEqual(snapshot(a));
		checkPlain(plain, a, lane);
	};
	try {
		send("pack", evaluationPack(evaluations));
		send("arrivals", {
			packRef: presetBinding.packRef,
			evaluationRefs: evaluations.map((e) => e.evaluationRef),
		});
		expect(a.state().pendingTerminals.size).toBe(64);
		expect(plain.pendingTerminals.size).toBe(64);
		send("current", {
			binding: presetBinding,
			current: evaluations.flatMap((e) => policyFacts(e).current.current),
		});
		expect(plain.obligationSnapshot().some((q) => !q.lifecycle)).toBe(true);
	} finally {
		a.cleanup();
		b.cleanup();
	}
}, 60000);
it("D164 evidence cannot claim a conflicting retained occurrence", () => {
	const a = presetRun("off"),
		b = referenceRun("off", presetBinding),
		plain = new PlainSpending(presetBinding),
		first = evaluationFixture(0, "coffee", 1, false),
		second = rebindEvaluation(
			evaluationFixture(1, "coffee", 1, false),
			{},
			first.occurrence.revisionDomain,
			1,
		),
		f = policyFacts(first);
	try {
		for (const [lane, value] of [
			["pack", evaluationPack([first, second])],
			["current", f.current],
			[
				"arrivals",
				{
					packRef: presetBinding.packRef,
					evaluationRefs: [first.evaluationRef, second.evaluationRef],
				},
			],
		] as [ReferenceLane, unknown][]) {
			a.send(lane, value);
			b.send(lane, value);
			plain.push(lane, value);
			expect(snapshot(b)).toEqual(snapshot(a));
			checkPlain(plain, a, lane);
		}
		expect(
			plain
				.evidenceSnapshot()
				.every((e) => e.occurrence.occurrenceId === first.occurrence.occurrenceId),
		).toBe(true);
	} finally {
		a.cleanup();
		b.cleanup();
	}
});
it("D164 malformed result consumes no causal domain capacity", () => {
	const a = presetRun("off"),
		b = referenceRun("off", presetBinding),
		plain = new PlainSpending(presetBinding),
		e = evaluationFixture(),
		f = policyFacts(e),
		qualified = presetRun("off");
	qualified.send("pack", evaluationPack([e]));
	qualified.drive(e);
	const outcome = qualified.outcome();
	qualified.cleanup();
	const send = (lane: ReferenceLane, value: unknown) => {
		a.send(lane, value);
		b.send(lane, value);
		plain.push(lane, value);
		expect(snapshot(b)).toEqual(snapshot(a));
		checkPlain(plain, a, lane);
	};
	try {
		send("inbox", {
			...f.inbox,
			outcomes: Array.from({ length: 64 }, (_, i) => ({
				...outcome,
				occurrence: { ...e.occurrence, revisionDomain: `invalid-result-${i}` },
				result: { kind: "ok" },
			})),
		});
		expect(plain.domains.size).toBe(0);
		send("pack", evaluationPack([e]));
		for (const lane of ["current", "verification", "local", "inbox"] as const) send(lane, f[lane]);
		send("arrivals", { packRef: presetBinding.packRef, evaluationRefs: [e.evaluationRef] });
		expect(plain.snapshot()[0].admission?.state).toBe("admitted");
	} finally {
		a.cleanup();
		b.cleanup();
	}
});
it("D164 later exact identity discards conflicting pending terminals", () => {
	const a = presetRun("off"),
		b = referenceRun("off", presetBinding),
		plain = new PlainSpending(presetBinding),
		first = evaluationFixture(0, "coffee", 1, false),
		bad = { ...first, occurrence: { ...first.occurrence, digest: `sha256:${"f".repeat(64)}` } },
		second = rebindEvaluation(
			evaluationFixture(1, "coffee", 1, false),
			{},
			first.occurrence.revisionDomain,
			1,
		),
		f = policyFacts(second);
	try {
		for (const [lane, value] of [
			["pack", evaluationPack([bad, second])],
			["current", f.current],
			["arrivals", { packRef: presetBinding.packRef, evaluationRefs: [bad.evaluationRef] }],
			["arrivals", { packRef: presetBinding.packRef, evaluationRefs: [second.evaluationRef] }],
		] as [ReferenceLane, unknown][]) {
			a.send(lane, value);
			b.send(lane, value);
			plain.push(lane, value);
			expect(snapshot(b)).toEqual(snapshot(a));
			checkPlain(plain, a, lane);
		}
		expect(plain.pendingTerminals.size).toBe(0);
		expect(plain.obligationSnapshot()[0].lifecycle).toBe(true);
	} finally {
		a.cleanup();
		b.cleanup();
	}
});
