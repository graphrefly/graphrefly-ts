// Diagnostic only: fresh Node processes, uncontrolled OS cache, no qualification threshold.
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

const [baseline, candidate, output] = process.argv.slice(2).map((value) => resolve(value));
function files(dir) {
	return readdirSync(dir).flatMap((name) => {
		const path = join(dir, name);
		return statSync(path).isDirectory() ? files(path) : [path];
	});
}
function footprint(pkg) {
	const all = files(join(pkg, "dist"));
	const sum = (suffix) =>
		all.filter((path) => path.endsWith(suffix)).reduce((n, path) => n + statSync(path).size, 0);
	return {
		jsBytes: sum(".js") + sum(".cjs"),
		cjsFiles: all.filter((path) => path.endsWith(".cjs")).length,
		cjsBytes: sum(".cjs"),
		sourceMapsBytes: sum(".map"),
		packageJsonSha256: createHash("sha256")
			.update(readFileSync(join(pkg, "package.json")))
			.digest("hex"),
	};
}
const worker = `
const {performance} = require('node:perf_hooks');
const path = require('node:path');
const pkg = require('node:fs').realpathSync(process.argv[1]);
const manifest = require(path.join(pkg, 'package.json'));
const start = performance.now();
for (const entry of ['.', './graph', './core']) require(path.resolve(pkg, manifest.exports[entry].require.default));
const elapsedMs = performance.now() - start;
console.log(JSON.stringify({elapsedMs, modules: Object.keys(require.cache).filter(p => p.startsWith(pkg + path.sep)).length, rssBytes: process.memoryUsage().rss}));
`;
const samples = [];
for (let pair = 0; pair < 12; pair++) {
	for (const name of pair % 2 ? ["candidate", "baseline"] : ["baseline", "candidate"]) {
		const run = spawnSync(
			process.execPath,
			["-e", worker, name === "baseline" ? baseline : candidate],
			{ encoding: "utf8", timeout: 30000 },
		);
		if (run.error || run.status !== 0) throw new Error(String(run.error ?? run.stderr));
		samples.push({ pair, name, ...JSON.parse(run.stdout) });
	}
}
function summary(name) {
	const times = samples
		.filter((s) => s.name === name)
		.map((s) => s.elapsedMs)
		.sort((a, b) => a - b);
	return {
		p50Ms: times[Math.ceil(times.length * 0.5) - 1],
		p95Ms: times[Math.ceil(times.length * 0.95) - 1],
	};
}
writeFileSync(
	output,
	`${JSON.stringify(
		{
			node: process.version,
			method:
				"12 alternating pairs; fresh Node processes requiring root/graph/core built CJS entry paths; OS cache uncontrolled; diagnostic only",
			baseline: footprint(baseline),
			candidate: footprint(candidate),
			summary: { baseline: summary("baseline"), candidate: summary("candidate") },
			samples,
		},
		null,
		"\t",
	)}\n`,
);
