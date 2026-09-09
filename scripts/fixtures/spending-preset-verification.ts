/** Offline runner: independent verdicts over actual loaded graph outputs, no effect host. */
import assert from "node:assert/strict";
import { readFileSync, writeFileSync } from "node:fs";
import type { Assessment, BusinessFrame } from "../../examples/spending-alerts/causal-business.js";
import type {
	MaterialSnapshot,
	Publication,
} from "../../examples/spending-alerts/causal-publication.js";
import {
	evaluationFixture,
	evaluationPack,
	policyFacts,
	presetBinding,
	presetRun,
} from "./spending-preset-harness.js";
import {
	oracleBusiness,
	oracleCanonical,
	oracleHash,
	verifyBusiness,
} from "./spending-preset-oracle.js";

const manifest = JSON.parse(readFileSync(process.argv[2], "utf8"));
const binding = {
	...presetBinding,
	sourceDigest: manifest.sourceDigest,
	runtimeDigest: manifest.bundleDigest,
	runRef: `loaded-${manifest.variant}`,
};
const result = [];
for (const mode of ["off", "summary"] as const) {
	const r = presetRun(mode, binding),
		e = evaluationFixture();
	let snapshot: MaterialSnapshot | undefined;
	const stop = r.built.materials.materialSnapshot.subscribe((m) => {
		if (m[0] === "DATA") snapshot = m[1] as MaterialSnapshot;
	});
	try {
		r.send("pack", evaluationPack([e], binding));
		r.send("arrivals", { packRef: binding.packRef, evaluationRefs: [e.evaluationRef] });
		const observed = (r.events.assessment as BusinessFrame<Assessment>[])
			.flatMap((f) => f.rows)
			.find((x) => x.evaluation.evaluationRef === e.evaluationRef)!.value;
		const expected = oracleBusiness(e),
			verdict = verifyBusiness(e, observed) ? "pass" : "fail";
		assert.equal(verdict, manifest.variant === "population" ? "fail" : "pass");
		const actualMaterial = snapshot!.body.materials[0];
		assert.ok(actualMaterial, "actual material must precede receipt issuance");
		const artifact = {
			sourceDigest: binding.sourceDigest,
			bundleDigest: binding.runtimeDigest,
			evaluation: e,
			observed,
			expected,
			verdict,
			actualRequestDigest: actualMaterial.body.payloadDigest,
		};
		const artifactDigest = oracleHash(oracleCanonical(artifact));
		const facts = policyFacts(e, binding);
		const receipt = {
			...facts.verification.receipts[0],
			issuerRef: { kind: "offline-independent-verifier", id: "two-pass-v1" },
			requestDigest: actualMaterial.body.payloadDigest,
			verdict,
			artifactRef: { kind: "offline-verifier-artifact", id: artifactDigest },
			artifactDigest,
		};
		r.send("current", facts.current);
		r.send("local", {
			...facts.local,
			grants: facts.local.grants.map((g) => ({
				...g,
				requestDigest: actualMaterial.body.payloadDigest,
			})),
		});
		r.send("inbox", facts.inbox);
		r.send("verification", { binding, receipts: [receipt] });
		const record = [...r.state().effects.values()][0];
		assert.equal(record.admission?.state, verdict === "pass" ? "admitted" : "rejected");
		assert.equal(record.outcome, undefined);
		const topology = r.graph.topology();
		const publication = r.events.publication.at(-1) as Publication;
		result.push({
			mode,
			artifact,
			receipt,
			topology,
			publication,
			admitted: record.admission?.state,
			effectExecuted: false,
			actor: "unknown",
		});
	} finally {
		stop();
		r.cleanup();
	}
}
writeFileSync(
	process.argv[3],
	JSON.stringify(
		{
			variant: manifest.variant,
			sourceDigest: binding.sourceDigest,
			bundleDigest: binding.runtimeDigest,
			result,
		},
		null,
		2,
	),
);
console.log("PRESET_LOADED_VERIFICATION_DONE", manifest.variant);
