import { afterEach, describe, expect, it, vi } from "vitest";
import numericVectors from "../../../../docs/design/causal-preset-numeric-contract-v1.vectors.json";
import type {
	Assessment,
	BusinessFrame,
} from "../../../../examples/spending-alerts/causal-business.js";
import type { Publication } from "../../../../examples/spending-alerts/causal-publication.js";
import { referenceNumbers } from "../../../../scripts/fixtures/spending-numeric-oracle.js";
import {
	evaluationFixture,
	evaluationPack,
	evaluationWithAmounts,
	policyFacts,
	presetBinding,
	presetRun,
} from "../../../../scripts/fixtures/spending-preset-harness.js";
import {
	oracleCanonical,
	oracleHash,
	verifyBusiness,
} from "../../../../scripts/fixtures/spending-preset-oracle.js";
import {
	PlainSpending,
	plainBusiness,
} from "../../../../scripts/fixtures/spending-preset-plain.js";
import { assertCausalCapabilities } from "../solutions/causal-occurrence/capabilities.js";
import type { CausalEvidence } from "../solutions/causal-occurrence/contracts.js";

const extraStops: (() => void)[] = [];
const runs: ReturnType<typeof presetRun>[] = [];
afterEach(() => {
	for (const stop of extraStops.splice(0)) stop();
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
	it("correctly verifies ill-conditioned finite inputs under D166", () => {
		const r = run(),
			e = evaluationWithAmounts([999999999.9999999, 1000000000, 999999999.9999999]);
		r.send("pack", evaluationPack([e]));
		r.send("arrivals", { packRef: presetBinding.packRef, evaluationRefs: [e.evaluationRef] });
		const observed = (r.events.assessment as BusinessFrame<Assessment>[])
			.flatMap((f) => f.rows)
			.at(-1)!;
		expect(observed).toBeDefined();
		expect(verifyBusiness(e, observed.value)).toBe(true);
		expect(observed.value.score.zScore).toBe(-0.5773502691896257);
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
		expect(seen.flatMap((f) => f.value.receipts)).toHaveLength(2);
		expect(seen.at(-1).value.receipts).toHaveLength(1);
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

function evidenceOf(r: ReturnType<typeof presetRun>) {
	const rows: CausalEvidence[] = [];
	extraStops.push(
		r.built.admission.evidence.subscribe((m) => {
			if (m[0] === "DATA") rows.push(m[1] as CausalEvidence);
		}),
	);
	return rows;
}
describe("D165 exact request evidence and private authorization", () => {
	it.each([
		"before",
		"after",
	])("correlates actual material with receipt arriving %s business", (order) => {
		const r = run(),
			e = evaluationFixture(),
			facts = policyFacts(e),
			evidence = evidenceOf(r);
		r.send("pack", evaluationPack([e]));
		if (order === "before") r.send("verification", facts.verification);
		expect(evidence.filter((x) => x.evidenceKind === "spending-verification")).toHaveLength(0);
		r.send("arrivals", { packRef: presetBinding.packRef, evaluationRefs: [e.evaluationRef] });
		if (order === "after") r.send("verification", facts.verification);
		expect(
			evidence.filter((x) => x.evidenceKind === "spending-verification").at(-1)?.coverage,
		).toBe("included");
		expect(r.built.admission.evidence.deps).toEqual([
			r.built.business.evaluationSelections,
			r.built.materials.materialStore,
			r.built.admission.verificationFacts,
		]);
	});
	it.each([
		"requestDigest",
		"sourceDigest",
		"runtimeDigest",
		"inputDigest",
		"policyDigest",
		"verifierRevision",
		"numericDomainRef",
	] as const)("wrong %s is stale and cannot admit", (field) => {
		const r = run(),
			e = evaluationFixture(),
			f = policyFacts(e),
			evidence = evidenceOf(r);
		r.send("pack", evaluationPack([e]));
		r.send("verification", {
			...f.verification,
			receipts: [
				{
					...f.verification.receipts[0],
					[field]: field.endsWith("Digest") ? `sha256:${"0".repeat(64)}` : "wrong",
				},
			],
		});
		r.send("current", f.current);
		r.send("local", f.local);
		r.send("inbox", f.inbox);
		r.send("arrivals", { packRef: presetBinding.packRef, evaluationRefs: [e.evaluationRef] });
		expect(
			evidence.filter((x) => x.evidenceKind === "spending-verification").at(-1)?.coverage,
		).toBe("stale");
		expect([...r.state().effects.values()].some((x) => x.admission?.state === "admitted")).toBe(
			false,
		);
	});
	it("normal has exact no-publish verification and no proposal", () => {
		const r = run(),
			e = evaluationFixture(0, "coffee", 1, false),
			evidence = evidenceOf(r);
		r.send("pack", evaluationPack([e]));
		r.drive(e);
		expect(
			evidence.filter((x) => x.evidenceKind === "spending-verification").at(-1)?.coverage,
		).toBe("included");
		expect(r.state().effects.size).toBe(0);
	});
	it.each(["fail", "unavailable"] as const)("%s receipt cannot produce admission", (verdict) => {
		const r = run(),
			e = evaluationFixture(),
			f = policyFacts(e),
			evidence = evidenceOf(r);
		r.send("pack", evaluationPack([e]));
		r.send("current", f.current);
		r.send("local", f.local);
		r.send("inbox", f.inbox);
		r.send("verification", {
			...f.verification,
			receipts: [{ ...f.verification.receipts[0], verdict }],
		});
		r.send("arrivals", { packRef: presetBinding.packRef, evaluationRefs: [e.evaluationRef] });
		expect(
			evidence.filter((x) => x.evidenceKind === "spending-verification").at(-1)?.coverage,
		).toBe(verdict === "fail" ? "included" : "unavailable");
		expect([...r.state().effects.values()].some((x) => x.admission?.state === "admitted")).toBe(
			false,
		);
	});
	it.each([
		"expired",
		"revoked",
		"stop",
		"destination",
		"epoch",
		"request",
		"unready",
		"stale-inbox",
		"policy",
		"watermark",
	])("%s boundary facts cannot authorize", (kind) => {
		const r = run(),
			e = evaluationFixture(),
			f = JSON.parse(JSON.stringify(policyFacts(e)));
		if (kind === "expired") {
			f.local.tick = 101;
			f.inbox.readiness.validThrough = 200;
		}
		if (kind === "revoked") f.local.grants[0].revoked = true;
		if (kind === "stop") f.local.stop = true;
		if (kind === "destination") f.local.grants[0].destinationRef.id = "different";
		if (kind === "epoch") f.local.grants[0].hostEpoch++;
		if (kind === "request") f.local.grants[0].requestDigest = `sha256:${"0".repeat(64)}`;
		if (kind === "unready") f.inbox.readiness.ready = false;
		if (kind === "stale-inbox") f.inbox.readiness.validThrough = 0;
		if (kind === "policy") f.current.current[0].policyDigest = `sha256:${"0".repeat(64)}`;
		if (kind === "watermark") f.current.current[0].watermark = 0;
		r.send("pack", evaluationPack([e]));
		r.send("current", f.current);
		r.send("verification", f.verification);
		r.send("local", f.local);
		r.send("inbox", f.inbox);
		r.send("arrivals", { packRef: presetBinding.packRef, evaluationRefs: [e.evaluationRef] });
		expect([...r.state().effects.values()].some((x) => x.admission?.state === "admitted")).toBe(
			false,
		);
	});
	it("replay preserves exact retained material and a single active obligation", () => {
		const r = run(),
			e = evaluationFixture();
		r.send("pack", evaluationPack([e]));
		r.drive(e);
		const record = [...r.state().effects.values()][0],
			request = record.proposal.requestRef;
		r.drive(e);
		r.disconnect();
		r.connect();
		expect(r.state().effects.size).toBe(1);
		expect([...r.state().effects.values()][0].proposal.requestRef).toEqual(request);
		expect([...r.state().effects.values()][0].outcome).toBeUndefined();
	});
	it("all 64 declared evaluations survive two DATA frames including exact duplicate arrivals", () => {
		const r = run(),
			es = Array.from({ length: 64 }, (_, i) => evaluationFixture(i));
		r.send("pack", evaluationPack(es));
		r.send(
			"arrivals",
			{
				packRef: presetBinding.packRef,
				evaluationRefs: es.slice(0, 32).map((x) => x.evaluationRef),
			},
			{ packRef: presetBinding.packRef, evaluationRefs: es.map((x) => x.evaluationRef) },
		);
		const actual = (r.events.assessment as BusinessFrame<Assessment>[])
			.flatMap((f) => f.rows)
			.map((x) => x.evaluation.evaluationRef);
		expect(new Set(actual).size).toBe(64);
	});
});

describe("D164 complete frame availability", () => {
	it.each([
		"local",
		"verification",
		"current",
	] as const)("empty %s replacement does not reuse omitted permission facts", (lane) => {
		const r = run(),
			e = evaluationFixture(),
			f = policyFacts(e);
		r.send("pack", evaluationPack([e]));
		r.send("current", f.current);
		r.send("verification", f.verification);
		r.send("local", f.local);
		r.send("inbox", f.inbox);
		const empty =
			lane === "local"
				? { ...f.local, grants: [] }
				: lane === "verification"
					? { ...f.verification, receipts: [] }
					: { ...f.current, current: [] };
		r.send(lane, empty);
		r.send("arrivals", { packRef: presetBinding.packRef, evaluationRefs: [e.evaluationRef] });
		expect([...r.state().effects.values()].some((x) => x.admission?.state === "admitted")).toBe(
			false,
		);
	});
	it("conflicting grants in one frame cannot be resolved by array order", () => {
		const r = run(),
			e = evaluationFixture(),
			f = policyFacts(e);
		r.send("pack", evaluationPack([e]));
		r.send("current", f.current);
		r.send("verification", f.verification);
		r.send("inbox", f.inbox);
		r.send("local", {
			...f.local,
			grants: [{ ...f.local.grants[0], revoked: true }, f.local.grants[0]],
		});
		r.send("arrivals", { packRef: presetBinding.packRef, evaluationRefs: [e.evaluationRef] });
		expect([...r.state().effects.values()].some((x) => x.admission?.state === "admitted")).toBe(
			false,
		);
	});
	it("both same-domain current DATA frames reach occurrence admission", () => {
		const r = run(),
			a = evaluationFixture(0, "coffee", 1, false),
			b = evaluationFixture(1, "coffee", 1, false),
			seen: unknown[] = [];
		extraStops.push(
			r.built.admission.occurrenceAdmissions.subscribe((m) => {
				if (m[0] === "DATA") seen.push(m[1]);
			}),
		);
		r.send("pack", evaluationPack([a, b]));
		r.send("arrivals", {
			packRef: presetBinding.packRef,
			evaluationRefs: [a.evaluationRef, b.evaluationRef],
		});
		r.send("current", policyFacts(a).current, policyFacts(b).current);
		expect(seen).toEqual(
			expect.arrayContaining([
				expect.objectContaining({ occurrence: a.occurrence, state: "admitted" }),
				expect.objectContaining({ occurrence: b.occurrence, state: "admitted" }),
			]),
		);
	});
});

describe("D165 actual dependency removal", () => {
	it.each([
		"policy",
		"verificationFacts",
		"materialStore",
		"assessment",
		"evidence",
	])("removing %s dependency blocks progress with original function", (name) => {
		let calls: import("vitest").MockInstance<
			import("../graph/construction-scope.js").ConstructionScope["node"]
		>;
		const r = presetRun("off", presetBinding, (scope) => {
			calls = vi.spyOn(scope, "node");
		});
		runs.push(r);
		const node = r.graph.find(`spending/${name}`)!;
		const fn = calls!.mock.calls.find(
			(c) => (c[2] as { name?: string })?.name === `spending/${name}`,
		)?.[1];
		calls!.mockRestore();
		expect(fn).toBeTypeOf("function");
		const errors: unknown[] = [];
		extraStops.push(
			node.subscribe((m) => {
				if (m[0] === "ERROR") errors.push(m[1]);
			}),
		);
		node.unsubscribeDep(node.deps[0], fn as import("../ctx/types.js").NodeFn);
		const e = evaluationFixture();
		r.send("pack", evaluationPack([e]));
		r.drive(e);
		if (node.deps.length)
			expect(errors.some((e) => String(e).includes(`spending dependency mismatch: ${name}`))).toBe(
				true,
			);
		// Removing the only dep has no subsequent fn invocation. Absence still cannot admit.
		expect(
			[...(r.state()?.effects.values() ?? [])].some((x) => x.admission?.state === "admitted"),
		).toBe(false);
	});
});

describe("D165 pending evidence is independent from current permission", () => {
	it("retains both early receipts across complete replacement before materials arrive", () => {
		const r = run(),
			a = evaluationFixture(),
			b = evaluationFixture(0, "tea"),
			seen = evidenceOf(r);
		r.send("verification", policyFacts(a).verification);
		r.send("verification", policyFacts(b).verification);
		r.send("pack", evaluationPack([a, b]));
		r.send("arrivals", {
			packRef: presetBinding.packRef,
			evaluationRefs: [a.evaluationRef, b.evaluationRef],
		});
		const included = seen.filter(
			(x) => x.evidenceKind === "spending-verification" && x.coverage === "included",
		);
		expect(new Set(included.map((x) => x.occurrence.occurrenceId)).size).toBe(2);
		r.send("current", policyFacts(a).current);
		r.send("local", policyFacts(a).local);
		r.send("inbox", policyFacts(a).inbox);
		expect(
			[...r.state().effects.values()]
				.filter((x) => x.proposal.occurrence.occurrenceId === a.occurrence.occurrenceId)
				.some((x) => x.admission?.state === "admitted"),
		).toBe(false);
	});
	it("full receipt reference kind and id survive evidence identity", () => {
		const r = run(),
			e = evaluationFixture(),
			f = policyFacts(e),
			seen = evidenceOf(r);
		const old = {
			...f.verification.receipts[0],
			receiptRef: { kind: "old-verifier", id: "r" },
			verifierRevision: "old",
		};
		const good = { ...f.verification.receipts[0], receiptRef: { kind: "new-verifier", id: "r" } };
		r.send("pack", evaluationPack([e]));
		r.send("verification", { ...f.verification, receipts: [old, good] });
		r.send("current", f.current);
		r.send("local", f.local);
		r.send("inbox", f.inbox);
		r.send("arrivals", { packRef: presetBinding.packRef, evaluationRefs: [e.evaluationRef] });
		const ids = seen
			.filter((x) => x.evidenceKind === "spending-verification")
			.map((x) => x.evidenceId);
		expect(new Set(ids).size).toBe(2);
		expect(
			[...r.state().evidence.values()]
				.filter((x) => x.evidenceKind === "spending-verification")
				.map((x) => x.coverage)
				.sort(),
		).toEqual(["included", "stale"]);
	});
});

describe("independent finite plain-code comparison", () => {
	it.each([
		"pass",
		"late-receipt",
		"expired",
		"empty-local",
		"conflicting-grant",
		"replay",
		"wrong-outcome",
		"unknown-outcome",
		"early-outcome",
		"invalid-ok",
		"invalid-error",
		"wrong-then-exact",
	])("same material and obligation transitions: %s", (scenario) => {
		const r = run(),
			e = evaluationFixture(),
			f = policyFacts(e),
			plain = new PlainSpending(presetBinding);
		const send = (
			lane: import("../../../../scripts/fixtures/spending-preset-plain.js").PlainLane,
			value: unknown,
		) => {
			r.send(lane, value);
			plain.push(lane, value);
			const actual = [...(r.state()?.effects.values() ?? [])].map((x) => ({
				proposal: x.proposal,
				admission: x.admission ?? null,
				outcome: x.outcome ?? null,
			}));
			expect(actual).toEqual(plain.snapshot());
		};
		send("pack", evaluationPack([e]));
		send("current", f.current);
		if (scenario !== "late-receipt" && scenario !== "early-outcome")
			send("verification", f.verification);
		send(
			"local",
			scenario === "expired"
				? { ...f.local, tick: 101 }
				: scenario === "conflicting-grant"
					? { ...f.local, grants: [{ ...f.local.grants[0], revoked: true }, f.local.grants[0]] }
					: f.local,
		);
		if (scenario === "empty-local") send("local", { ...f.local, grants: [] });
		send("inbox", f.inbox);
		send("arrivals", { packRef: presetBinding.packRef, evaluationRefs: [e.evaluationRef] });
		if (scenario === "early-outcome") {
			const proposal = plain.snapshot()[0].proposal;
			const outcome = {
				...proposal,
				admissionRef: {
					kind: "spending-admission",
					id: oracleHash(
						oracleCanonical({
							proposal,
							receiptRef: f.verification.receipts[0].receiptRef,
							grantRef: f.local.grants[0].grantRef,
							binding: presetBinding,
						}),
					),
				},
				state: "succeeded",
				result: { kind: "ok", value: { source: "fixture", io: false } },
			};
			send("inbox", { ...f.inbox, outcomes: [outcome] });
			send("inbox", { ...f.inbox, outcomes: [] });
			send("verification", f.verification);
			expect(plain.snapshot()[0].outcome?.state).toBe("succeeded");
		}
		if (scenario === "wrong-then-exact") {
			const outcome = r.outcome();
			send("inbox", {
				...f.inbox,
				outcomes: [{ ...outcome, admissionRef: { kind: "wrong", id: "wrong" } }, outcome],
			});
			expect(plain.snapshot()[0].outcome?.state).toBe("succeeded");
		}
		if (scenario === "invalid-ok" || scenario === "invalid-error") {
			const outcome = r.outcome();
			send("inbox", {
				...f.inbox,
				outcomes: [
					{
						...outcome,
						state: scenario === "invalid-ok" ? "succeeded" : "failed",
						result: scenario === "invalid-ok" ? { kind: "ok" } : { kind: "error", error: null },
					},
				],
			});
			expect(plain.snapshot()[0].outcome).toBeNull();
			send("inbox", { ...f.inbox, outcomes: [outcome] });
			expect(plain.snapshot()[0].outcome?.state).toBe("succeeded");
		}
		if (scenario === "late-receipt") send("verification", f.verification);
		if (scenario === "replay")
			send("arrivals", { packRef: presetBinding.packRef, evaluationRefs: [e.evaluationRef] });
		if (scenario === "wrong-outcome" || scenario === "unknown-outcome") {
			r.disconnect();
			const outcome = r.outcome(scenario === "unknown-outcome" ? "unknown" : "succeeded");
			send("inbox", {
				...f.inbox,
				outcomes: [scenario === "wrong-outcome" ? { ...outcome, effectId: "wrong" } : outcome],
			});
			r.connect();
			send("inbox", { ...f.inbox, outcomes: [r.outcome()] });
		}
		expect(verifyBusiness(e, plainBusiness(e))).toBe(true);
	});
});

for (const mode of ["off", "summary"] as const)
	describe(`D166 numeric graph ${mode}`, () => {
		for (const vector of numericVectors.vectors)
			it(`numeric contract ${vector.id}`, () => {
				const i = vector.input,
					expected = vector.proposedReference;
				const e = evaluationWithAmounts(i.amounts, {
					policy: { zThreshold: i.zThreshold, dailyRatioThreshold: i.dailyRatioThreshold },
					profile: { dailyAverage: i.dailyAverage, typicalCategories: ["coffee"] },
				});
				const r = run(mode);
				r.send("pack", evaluationPack([e]));
				r.drive(e);
				const observed = (r.events.assessment as BusinessFrame<Assessment>[])
					.flatMap((f) => f.rows)
					.at(-1)!.value;
				expect(observed.score.zScore).toBe(expected.zScore);
				expect(observed.score.dailyRatio).toBe(expected.dailyRatio);
				expect(observed.flagged).toBe(expected.flagged);
				expect(verifyBusiness(e, observed)).toBe(true);
				expect(verifyBusiness(e, plainBusiness(e))).toBe(true);
				const independent = referenceNumbers(i.amounts, i.dailyAverage);
				expect(independent.zScore).toBe(expected.zScore);
				expect(independent.std).toBe(expected.std);
				expect(independent.varianceNonzero).toBe(expected.varianceNonzero);
				const records = [...r.state().effects.values()];
				expect(records.length).toBe(expected.flagged ? 1 : 0);
				if (expected.flagged) expect(records[0].admission?.state).toBe("admitted");
				expect(records.every((x) => x.outcome === undefined)).toBe(true);
			});
		it("old verifier revision cannot authorize current numeric results", () => {
			const r = run(mode),
				e = evaluationFixture(),
				f = policyFacts(e);
			r.send("pack", evaluationPack([e]));
			r.send("current", f.current);
			r.send("local", f.local);
			r.send("inbox", f.inbox);
			r.send("verification", {
				...f.verification,
				receipts: f.verification.receipts.map((v) => ({
					...v,
					verifierRevision: "spending-oracle-v1",
				})),
			});
			r.send("arrivals", { packRef: presetBinding.packRef, evaluationRefs: [e.evaluationRef] });
			expect([...r.state().effects.values()]).toHaveLength(1);
			expect([...r.state().effects.values()][0].admission?.state).not.toBe("admitted");
		});
	});

describe("D166 verifier self-consistency and signed zero", () => {
	for (const amounts of [[-0], [-0, 0], [0, -0]])
		it(`canonical zero ${amounts.length}:${Object.is(amounts[0], -0)}`, () => {
			const e = evaluationWithAmounts(amounts),
				plain = plainBusiness(e);
			expect(Object.is(plain.score.zScore, 0)).toBe(true);
			expect(Object.is(plain.score.dailyRatio, 0)).toBe(true);
			expect(verifyBusiness(e, plain)).toBe(true);
			const r = run();
			r.send("pack", evaluationPack([e]));
			r.drive(e);
			const actual = (r.events.assessment as BusinessFrame<Assessment>[])
				.flatMap((f) => f.rows)
				.at(-1)!.value;
			expect(Object.is(actual.score.zScore, 0)).toBe(true);
			expect(Object.is(actual.score.dailyRatio, 0)).toBe(true);
			expect(actual.flagged).toBe(false);
		});
	it("tolerance does not excuse an actual predicate inconsistent with copied reference consequences", () => {
		const e = evaluationWithAmounts([999999999.9999999, 999999999.9999999, 1e9], {
			policy: { zThreshold: 1.1547005383792515, dailyRatioThreshold: 5 },
			profile: { dailyAverage: 1e9, typicalCategories: ["coffee"] },
		});
		const p = plainBusiness(e);
		expect(verifyBusiness(e, p)).toBe(true);
		expect(verifyBusiness(e, { ...p, score: { ...p.score, zScore: 1.1547005383792517 } })).toBe(
			false,
		);
		for (const zScore of [NaN, Infinity, -Infinity])
			expect(verifyBusiness(e, { ...p, score: { ...p.score, zScore } })).toBe(false);
	});
});

it("D166 retains historical v1 receipt while a distinct v2 receipt recovers admission", () => {
	const r = run(),
		e = evaluationFixture(),
		f = policyFacts(e);
	const old = {
		...f.verification.receipts[0],
		receiptRef: { kind: "fixture-verification", id: e.evaluationRef },
		verifierRevision: "spending-oracle-v1",
	};
	expect(old.receiptRef).not.toEqual(f.verification.receipts[0].receiptRef);
	r.send("pack", evaluationPack([e]));
	r.send("current", f.current);
	r.send("local", f.local);
	r.send("inbox", f.inbox);
	r.send("verification", { ...f.verification, receipts: [old] });
	r.send("arrivals", { packRef: presetBinding.packRef, evaluationRefs: [e.evaluationRef] });
	expect([...r.state().effects.values()][0].admission?.state).not.toBe("admitted");
	r.send("verification", f.verification);
	expect([...r.state().effects.values()][0].admission?.state).toBe("admitted");
});

it("D165 receipt association preserves complete occurrence identity and ordered evidence", () => {
	const r = run(),
		e = evaluationFixture(),
		facts = policyFacts(e),
		seen = evidenceOf(r);
	const base = facts.verification.receipts[0];
	const occurrences = [
		{ ...e.occurrence, revisionDomain: `${e.occurrence.revisionDomain}-other` },
		{ ...e.occurrence, revision: e.occurrence.revision + 1 },
		{ ...e.occurrence, digest: `sha256:${"0".repeat(64)}` },
		{ ...e.occurrence, sourceRefs: [{ kind: "different", id: "source" }] },
		e.occurrence,
		e.occurrence,
	];
	const receipts = occurrences.map((occurrence, i) => ({
		...base,
		occurrence,
		receiptRef: { kind: "association-test", id: String(i) },
	}));
	r.send("verification", { ...facts.verification, receipts });
	expect(seen.filter((x) => x.evidenceKind === "spending-verification")).toEqual([]);
	r.send("pack", evaluationPack([e]));
	const arrival = { packRef: presetBinding.packRef, evaluationRefs: [e.evaluationRef] };
	const expected = receipts.slice(-2).map((v) => ({
		occurrence: e.occurrence,
		evidenceKind: "spending-verification",
		evidenceId: oracleHash(oracleCanonical(v.receiptRef)),
		evidenceDigest: oracleHash(oracleCanonical(v)),
		coverage: "included",
		refs: [v.artifactRef.id],
	}));
	for (let repeat = 0; repeat < 2; repeat++) {
		seen.length = 0;
		r.send("arrivals", arrival);
		const actual = seen.filter((x) => x.evidenceKind === "spending-verification");
		expect(actual.length).toBeGreaterThan(0);
		expect(actual.length % 2).toBe(0);
		for (let i = 0; i < actual.length; i += 2) expect(actual.slice(i, i + 2)).toEqual(expected);
	}
});

it("D160 policy comparison keeps exact grants and ordered recovery across frames", () => {
	const r = run();
	const a = evaluationFixture(0, "coffee");
	const b = evaluationFixture(0, "tea");
	const fa = policyFacts(a),
		fb = policyFacts(b);
	const seen: any[] = [];
	extraStops.push(
		r.built.admission.publicationPolicy.subscribe((m) => {
			if (m[0] === "DATA") seen.push(...(m[1] as any).rows);
		}),
	);
	const local = structuredClone({
		...fa.local,
		grants: [...fa.local.grants, ...fb.local.grants].map((g) => ({
			...g,
			occurrence: { ...g.occurrence, sourceRefs: [...g.occurrence.sourceRefs] },
		})),
	});
	local.grants[1].occurrence.sourceRefs = [{ kind: "wrong", id: "same-id-is-insufficient" }];
	r.send("pack", evaluationPack([a, b]));
	r.send("current", { ...fa.current, current: [...fa.current.current, ...fb.current.current] });
	r.send("verification", {
		...fa.verification,
		receipts: [...fa.verification.receipts, ...fb.verification.receipts],
	});
	r.send("local", local);
	r.send("inbox", fa.inbox);
	const arrival = {
		packRef: presetBinding.packRef,
		evaluationRefs: [a.evaluationRef, b.evaluationRef],
	};
	r.send("arrivals", arrival);
	expect(seen.map((x) => [x.evaluation.evaluationRef, x.value.admission?.state])).toEqual([
		[a.evaluationRef, "admitted"],
	]);
	// Mutating the caller's original frame cannot alter its parsed retained snapshot.
	local.grants[1].occurrence.sourceRefs = structuredClone([...b.occurrence.sourceRefs]);
	r.send("arrivals", arrival);
	expect(seen).toHaveLength(1);
	// A replacement frame must be read afresh, with no cross-invocation memo.
	r.send("local", local);
	expect(seen.map((x) => [x.evaluation.evaluationRef, x.value.admission?.state])).toEqual([
		[a.evaluationRef, "admitted"],
		[b.evaluationRef, "admitted"],
	]);
	r.send("arrivals", arrival);
	expect(seen).toHaveLength(2);
});
