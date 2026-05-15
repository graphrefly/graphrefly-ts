/**
 * Node sanity runner for the RN/Hermes spike (graphrefly-ts#4).
 * Fast dev-loop check that the pure-ts API translation is correct
 * before involving the real Hermes engine. CI uses run-hermes instead.
 */
import { probes, runSpike } from "./spike-core.mjs";

const { pass, lines } = runSpike();
for (const l of lines) console.log(`[spike] ${l}`);
for (const l of probes()) console.log(`[spike] ${l}`);
console.log(`[spike] RESULT: ${pass ? "PASS" : "FAIL"}`);
process.exit(pass ? 0 : 1);
