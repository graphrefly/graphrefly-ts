/** One approved native fixture. No Graph/consumer imports. */

import { readFileSync, writeFileSync } from "node:fs";
import { setTimeout } from "node:timers/promises";
import { createObserver } from "../causal-cpu-observer.mjs";

const config = JSON.parse(readFileSync(process.argv[2], "utf8"));
const observer = createObserver(config);
let primary = null;
try {
	observer.start("empty");
	observer.end("empty");
	observer.start("cpu");
	let h = 2166136261;
	for (let i = 0; i < 2000000; i++) h = Math.imul(h ^ i, 16777619) >>> 0;
	observer.end("cpu");
	observer.start("yield");
	await setTimeout(50);
	observer.end("yield");
	writeFileSync(
		`${config.output}/fixture-result.json`,
		JSON.stringify({ checksum: h, pid: process.pid }),
	);
} catch (error) {
	primary = error;
}
try {
	observer.finish(primary);
} catch (error) {
	if (primary) throw new AggregateError([primary, error], "fixture and observer finalization");
	throw error;
}
if (primary) throw primary;
console.log("CPU_OBSERVER_FIXTURE_DONE");
