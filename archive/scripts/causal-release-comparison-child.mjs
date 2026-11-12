import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { appendFileSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { performance } from "node:perf_hooks";
import { pathToFileURL } from "node:url";
import { coordinates, sample } from "./causal-release-comparison-driver.mjs";

const digest = (value) => createHash("sha256").update(value).digest("hex");
const canonical = (value) =>
	Array.isArray(value)
		? value.map(canonical)
		: value && typeof value === "object"
			? Object.fromEntries(
					Object.keys(value)
						.sort()
						.map((key) => [key, canonical(value[key])]),
				)
			: value;
const [entryPath] = process.argv.slice(2);
const entryBytes = readFileSync(entryPath),
	entry = JSON.parse(entryBytes);
const root = path.resolve(path.dirname(entryPath), "../..");
const output = path.dirname(entryPath);
const put = (name, x) =>
	writeFileSync(path.join(output, name), `${JSON.stringify(x)}\n`, { flag: "wx" });
let count = 0;
try {
	assert.deepEqual(process.execArgv, []);
	for (const key of ["NODE_OPTIONS", "NODE_V8_COVERAGE", "NODE_COMPILE_CACHE"])
		assert.equal(process.env[key], undefined);
	const metadata = {
		pid: process.pid,
		node: process.version,
		v8: process.versions.v8,
		platform: process.platform,
		arch: process.arch,
		execPath: process.execPath,
		argv: process.argv,
		entryDigest: digest(entryBytes),
		env: process.env,
	};
	put("identity.json", metadata);
	const scenarioBytes = readFileSync(path.join(root, "P2-inputs.json"));
	assert.equal(digest(scenarioBytes), entry.inputDigest);
	const scenario = JSON.parse(scenarioBytes);
	const modules = [];
	for (const name of entry.modules) {
		const file = path.join(root, name);
		assert.equal(digest(readFileSync(file)), entry.moduleDigests[name]);
		modules.push(await import(pathToFileURL(file).href));
	}
	const expected = [],
		checks = [];
	for (const mod of modules) {
		if (entry.row === "P2-lifecycle") {
			const pre = mod.preflights(scenario);
			expected.push(pre.expected);
			// Untimed exact path: fake clock, excluded from performance samples.
			sample(mod, entry.row, scenario, pre.expected, () => 0);
			checks.push(pre);
		} else {
			sample(mod, entry.row, scenario, undefined, () => 0);
			expected.push(undefined);
			checks.push({ passed: true, instances: 1 });
		}
	}
	if (entry.row === "P2-lifecycle") assert.deepEqual(expected[0], expected[1]);
	put("preflight.json", {
		instances: entry.row === "P2-lifecycle" ? 14 : 2,
		checks,
		expected,
		expectedJSON: expected.map((x) => JSON.stringify(canonical(x)) ?? null),
	});
	for (const coordinate of coordinates(entry.variant)) {
		const result = sample(
			modules[coordinate.slot],
			entry.row,
			scenario,
			expected[coordinate.slot],
			() => performance.now(),
		);
		const snapshotDigest =
			result.snapshot === undefined ? null : digest(JSON.stringify(canonical(result.snapshot)));
		delete result.snapshot;
		appendFileSync(
			path.join(output, "samples.jsonl"),
			`${JSON.stringify({ ...coordinate, ...result, snapshotDigest })}\n`,
		);
		count++;
	}
	put("completion.json", { completed: true, samples: count, pid: process.pid });
} catch (error) {
	put("failure.json", {
		completed: false,
		samples: count,
		error: String(error),
		stack: error.stack,
		causes: error.errors?.map((e) => ({ error: String(e), stack: e.stack })),
	});
	process.exitCode = 1;
}
