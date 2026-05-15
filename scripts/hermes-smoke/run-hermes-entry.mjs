/**
 * Hermes-engine entry. esbuild bundles this (+ @graphrefly/pure-ts)
 * into one Hermes-safe file. The bare `hermes` CLI has no `console`
 * (only `print`) and no `process`; a banner shims `console`, and we
 * signal pass/fail purely via the `RESULT:` stdout marker that the
 * Node orchestrator greps.
 */
import { probes, runSpike } from "./spike-core.mjs";

const say = (s) =>
	typeof print === "function" ? print(`[spike] ${s}`) : console.log(`[spike] ${s}`);

const { pass, lines } = runSpike();
for (const l of lines) say(l);
for (const l of probes()) say(l);
say(`RESULT: ${pass ? "PASS" : "FAIL"}`);
