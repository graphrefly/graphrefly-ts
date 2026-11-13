import { deepStrictEqual, strictEqual } from "node:assert";
import { readFileSync } from "node:fs";
import { graph } from "../packages/ts/src/index.js";
import { runNodeNamingProbes } from "./fixtures/node-naming-probes.js";

const path = process.argv[2];
if (!path) throw new Error("usage: tsx scripts/probe-node-naming.ts <root fixture JSON>");
const fixture = JSON.parse(readFileSync(path, "utf8"));
strictEqual(fixture.schema, "graphrefly/node-naming@1");
let error: string | undefined;
try {
	graph().state(1, { name: "bad::name" });
} catch (cause) {
	error = (cause as Error).message;
}
strictEqual(error, fixture.error);
try {
	graph().state(1, { name: "bad:" });
} catch (cause) {
	error = (cause as Error).message;
}
strictEqual(error, fixture.boundaryError);
const actual = runNodeNamingProbes();
deepStrictEqual(
	actual,
	Object.fromEntries(
		Object.entries(fixture.modules).map(([name, module]) => [
			name,
			(module as { runtimes: { ts: unknown } }).runtimes.ts,
		]),
	),
);
console.log(JSON.stringify(actual, null, 2));
