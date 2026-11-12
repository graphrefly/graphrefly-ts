/** ONE standalone diagnostic fixture; never imported by the library or benchmark. */
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { performance } from "node:perf_hooks";

const [output, run] = process.argv.slice(2);
const identity = {
	run,
	pid: process.pid,
	node: process.version,
	v8: process.versions.v8,
	sourceDigest: createHash("sha256")
		.update(readFileSync(new URL(import.meta.url)))
		.digest("hex"),
};
const anchors = [],
	windows = [];
function anchor() {
	const p0 = performance.now(),
		h = process.hrtime.bigint().toString(),
		p1 = performance.now();
	anchors.push({ p0, h, p1 });
}
function window(name, fn) {
	const start = performance.now();
	const b0 = process.hrtime.bigint().toString();
	console.time(`${run}:${name}`);
	const b1 = process.hrtime.bigint().toString();
	fn();
	const e0 = process.hrtime.bigint().toString();
	console.timeEnd(`${run}:${name}`);
	const e1 = process.hrtime.bigint().toString();
	const end = performance.now();
	windows.push({ name, start, end, begin: [b0, b1], finish: [e0, e1] });
}
anchor();
window("empty", () => 1 + 1);
window("gc", () => global.gc());
anchor();
// Native intrinsics are confined to this explicit diagnostic process.
const prepare = new Function("fn", "%PrepareFunctionForOptimization(fn);");
const optimize = new Function("fn", "%OptimizeFunctionOnNextCall(fn);");
function readX(value) {
	return value.x + 1;
}
prepare(readX);
for (let i = 0; i < 16; i++) readX({ x: i });
optimize(readX);
readX({ x: 17 });
window("deopt", () => readX({ x: 18, changed: true }));
anchor();
writeFileSync(
	output,
	JSON.stringify(
		{ identity, units: "performance-ms/hrtime-ns/trace-us", anchors, windows },
		null,
		2,
	),
);
