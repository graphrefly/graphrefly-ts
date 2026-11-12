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
	evaluationWithAmounts,
	policyFacts,
	presetBinding,
	presetRun,
} from "./spending-preset-harness.js";
import {
	oracleBusiness,
	oracleCanonical,
	oracleHash,
	oracleRequest,
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
for (const scenario of ["flagged", "root-negative"] as const)
	for (const mode of ["off", "summary"] as const) {
		const r = presetRun(mode, binding),
			e =
				scenario === "flagged"
					? evaluationFixture()
					: evaluationWithAmounts([100, 200], {
							policy: { zThreshold: 0.8, dailyRatioThreshold: 5 },
						});
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
				expectedRequest = oracleRequest(e, binding);
			const actualMaterial = snapshot!.body.materials[0];
			const verdict =
				verifyBusiness(e, observed) &&
				oracleCanonical(actualMaterial ?? null) === oracleCanonical(expectedRequest ?? null)
					? "pass"
					: "fail";
			assert.equal(
				verdict,
				manifest.variant === "population" ||
					(manifest.variant === "payload-only" && scenario === "flagged")
					? "fail"
					: "pass",
			);
			assert.equal(
				Boolean(actualMaterial),
				observed.flagged,
				"actual material must match actual branch before receipt issuance",
			);
			const actualRequestDigest =
				actualMaterial?.body.payloadDigest ??
				oracleHash(oracleCanonical({ kind: "no-publish", evaluationRef: e.evaluationRef }));
			const artifact = {
				sourceDigest: binding.sourceDigest,
				bundleDigest: binding.runtimeDigest,
				evaluation: e,
				observed,
				expected,
				verdict,
				actualRequestDigest,
				actualRequest: actualMaterial ?? null,
				expectedRequest: expectedRequest ?? null,
				numericContractDigest: manifest.numericContractDigest,
				verifierRevision: manifest.verifierRevision,
				loadedSources: manifest.sources,
			};
			const artifactDigest = oracleHash(oracleCanonical(artifact));
			const facts = policyFacts(e, binding);
			const receipt = {
				...facts.verification.receipts[0],
				receiptRef: { kind: "offline-verification", id: artifactDigest },
				issuerRef: { kind: "offline-independent-verifier", id: "pairwise-rn64-v2" },
				requestDigest: actualRequestDigest,
				verdict,
				artifactRef: { kind: "offline-verifier-artifact", id: artifactDigest },
				artifactDigest,
			};
			r.send("current", facts.current);
			r.send("local", {
				...facts.local,
				grants: facts.local.grants.map((g) => ({
					...g,
					requestDigest: actualRequestDigest,
				})),
			});
			r.send("inbox", facts.inbox);
			r.send("verification", { binding, receipts: [receipt] });
			const records = [...r.state().effects.values()];
			assert.equal(records.length, observed.flagged ? 1 : 0, "exact proposal count");
			const record = records[0];
			assert.equal(
				record?.admission?.state,
				observed.flagged ? (verdict === "pass" ? "admitted" : "rejected") : undefined,
			);
			assert.equal(record?.outcome, undefined);
			const topology = r.graph.topology();
			const publication = r.events.publication.at(-1) as Publication;
			result.push({
				mode,
				scenario,
				artifact,
				receipt,
				topology,
				publication,
				admitted: record?.admission?.state ?? "no-proposal",
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
