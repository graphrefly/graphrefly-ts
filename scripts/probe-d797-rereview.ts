import { deepStrictEqual } from "node:assert";
import { readFileSync } from "node:fs";
import { runCheckpointReasonProbes, runRereviewProbes } from "./fixtures/d797-rereview-probes.js";

const fixturePath = process.argv[2];
if (!fixturePath) throw new Error("usage: tsx scripts/probe-d797-rereview.ts <root fixture JSON>");
const fixture = JSON.parse(readFileSync(fixturePath, "utf8"));
const actual = runRereviewProbes();
deepStrictEqual(actual, fixture.probeExpected);
const reasons = runCheckpointReasonProbes();
deepStrictEqual(
	reasons,
	Object.fromEntries(
		Object.entries(fixture.checkpointReasons).map(([key, reason]) => [
			key,
			`not restorable: n: ${reason}`,
		]),
	),
);
console.log(JSON.stringify(process.argv.includes("--reasons") ? reasons : actual, null, 2));
