import { afterAll, bench, describe } from "vitest";
import { batch } from "../core/batch.js";
import { DATA, DIRTY } from "../core/messages.js";
import { node } from "../core/node.js";

/**
 * Bench mode does not run `beforeAll` before Tinybench (Vitest runs hooks differently than tests).
 * Build graphs at module load so each `bench` closure sees initialized nodes.
 */
let n = 0;

const linearHead = node<number>({ initial: 0 });
let cur: ReturnType<typeof node<number>> = linearHead;
for (let i = 0; i < 9; i++) {
	const prev = cur;
	cur = node([prev], ([v]) => (v as number) + 1);
}
const linearTail = cur;
const linearUnsub = linearTail.subscribe(() => undefined);

const diamondA = node<number>({ initial: 0 });
const diamondB = node([diamondA], ([v]) => (v as number) + 1);
const diamondC = node([diamondA], ([v]) => (v as number) + 2);
const diamondD = node([diamondB, diamondC], ([bv, cv]) => (bv as number) + (cv as number));
const diamondUnsub = diamondD.subscribe(() => undefined);

const fan1 = node<number>({ initial: 0 });
const fan2 = node<number>({ initial: 0 });
const fanSum = node([fan1, fan2], ([x, y]) => (x as number) + (y as number));
const fanUnsub = fanSum.subscribe(() => undefined);

/**
 * Baseline micro-benchmarks (vitest bench / tinybench). CI runs this as a smoke execution only;
 * there is no strict wall-clock threshold here. For parity with graphrefly-py, the loose
 * local-only timing guard lives in `perf-smoke.test.ts` (skipped on `CI`, e.g. GitHub Actions).
 */
describe("GraphReFly core baseline", () => {
	afterAll(() => {
		linearUnsub();
		diamondUnsub();
		fanUnsub();
	});

	bench("linear 10-node chain: DIRTY+DATA", () => {
		n += 1;
		linearHead.down([[DIRTY], [DATA, n]]);
	});

	bench("diamond: single source update", () => {
		n += 1;
		diamondA.down([[DIRTY], [DATA, n]]);
	});

	bench("fan-in: batched DIRTY+DATA on two sources", () => {
		n += 1;
		batch(() => {
			fan1.down([[DIRTY], [DATA, n]]);
			fan2.down([[DIRTY], [DATA, n + 1]]);
		});
	});
});
