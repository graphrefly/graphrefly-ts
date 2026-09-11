/** Offline replay only: reads an existing capture; never imports or launches the fixture. */
import assert from "node:assert/strict";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { isAbsolute, relative, resolve } from "node:path";
import { correlateTrace, hash } from "./causal-event-correlation.mjs";

const [inputArg, outputArg] = process.argv.slice(2);
assert.ok(inputArg && outputArg && process.argv.length === 4, "CAPTURE FRESH_OUTPUT required");
const input = resolve(inputArg),
	output = resolve(outputArg);
assert.ok(!existsSync(output), "fresh replay output required");
const rel = relative(input, output);
assert.ok(rel.startsWith("../") || isAbsolute(rel), "replay output must be outside capture");
const read = (name) => readFileSync(resolve(input, name));
const manifest = JSON.parse(read("manifest.json"));
assert.deepEqual(manifest.traceFiles, ["trace-1.json"]);
assert.equal(hash(read("fixture.mjs")), manifest.identity.sourceDigest, "captured fixture binding");
const result = correlateTrace(
	read("trace-1.json").toString(),
	read("evidence.json").toString(),
	manifest,
);
mkdirSync(output, { recursive: true });
writeFileSync(resolve(output, "correlation.json"), JSON.stringify(result, null, 2) + "\n");
writeFileSync(
	resolve(output, "replay.json"),
	JSON.stringify(
		{
			kind: "retained-trace offline replay; not a new capture or performance qualification",
			input,
			newCaptureProcesses: 0,
			consumerMeasurements: 0,
			inputs: Object.fromEntries(
				["manifest.json", "trace-1.json", "evidence.json", "fixture.mjs", "correlation.json"].map(
					(name) => [name, hash(read(name))],
				),
			),
			sources: Object.fromEntries(
				[
					"replay-causal-event-clock.mjs",
					"causal-event-correlation.mjs",
					"verify-causal-event-clock.py",
				].map((name) => [name, hash(readFileSync(new URL(name, import.meta.url)))]),
			),
			outputDigest: hash(readFileSync(resolve(output, "correlation.json"))),
			status: result.status,
			independentVerification: "separate verifier required",
		},
		null,
		2,
	) + "\n",
);
console.log("CLOCK_REPLAY_DONE", result.status);
if (result.status !== "calibrated") process.exitCode = 1;
