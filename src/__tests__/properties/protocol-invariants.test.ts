/**
 * Property-based protocol invariant suite (Project 1 from
 * `archive/docs/SESSION-rigor-infrastructure-plan.md`).
 *
 * This file is a thin runner — every invariant lives in `_invariants.ts`,
 * registered in the `INVARIANTS` array. To add a new property, append to that
 * registry; this file picks it up automatically.
 *
 * The deliberate split (registry + iterator) makes the invariant list
 * **enumerable** — LLMs composing higher-level blocks can read `_invariants.ts`
 * and answer "does my composition break any of these?" from a finite list,
 * not from operator-by-operator narrative docs.
 *
 * Reproducing a failure: set `FC_SEED=<seed>` (fast-check prints the seed in
 * every failure report) to replay the exact counterexample path.
 */

import * as fc from "fast-check";
import { describe, it } from "vitest";
import { INVARIANTS } from "./_invariants.js";

const SEED_FROM_ENV = process.env.FC_SEED ? Number(process.env.FC_SEED) : undefined;
/**
 * Force-run invariants marked `openUntilSubstrateFix` in the registry. They
 * are skipped in normal CI runs because they encode behavior the substrate
 * does NOT yet guarantee (e.g. clean multi-dep push-on-subscribe). Set
 * `RUN_OPEN_INVARIANTS=1` locally to run them — failures are the documented
 * outcome until the referenced substrate fix lands.
 */
const FORCE_RUN_OPEN = process.env.RUN_OPEN_INVARIANTS === "1";

describe("protocol invariants (property-based)", () => {
	for (const inv of INVARIANTS) {
		const title = inv.openUntilSubstrateFix
			? `${inv.name} — ${inv.specRef} (open until: ${inv.openUntilSubstrateFix})`
			: `${inv.name} — ${inv.specRef}`;
		const runner = inv.openUntilSubstrateFix && !FORCE_RUN_OPEN ? it.skip : it;
		runner(title, () => {
			fc.assert(inv.property(), {
				numRuns: inv.numRuns ?? 100,
				...(SEED_FROM_ENV !== undefined ? { seed: SEED_FROM_ENV } : {}),
			});
		});
	}
});
