/** Offline generated-source checks only: never loads or executes any consumer module. */
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { check } from "./check-causal-workload-source.mjs";
import { derive } from "./derive-causal-workload-driver.mjs";

const archive = fileURLToPath(
	new URL("../archive/evals/causal-performance-repetition-v2/evidence.tar.gz", import.meta.url),
);
const original = execFileSync(
	"python3",
	[
		"-c",
		'import tarfile,hashlib,sys; t=tarfile.open(sys.argv[1]); matches=[b for m in t.getmembers() if m.isfile() for b in [t.extractfile(m).read()] if hashlib.sha256(b).hexdigest()=="d9d8606d73e1bcfad66097f027d63c99fc409571042c5f1e7efffaa645356fb2"]; assert matches; assert all(b==matches[0] for b in matches); sys.stdout.buffer.write(matches[0])',
		archive,
	],
	{ encoding: "utf8", timeout: 30000, maxBuffer: 16 * 1024 * 1024 },
);
const mutations = [
	["extra top-level", (s) => s + "\nprocess.cpuUsage();"],
	[
		"CPU within timer",
		(s) =>
			s.replace(
				"const start = performance2.now();",
				"const start = performance2.now(); process.cpuUsage();",
			),
	],
	[
		"observer within timer",
		(s) =>
			s.replace(
				"const end = performance2.now();",
				"new PerformanceObserver(() => {}); const end = performance2.now();",
			),
	],
	["extra loop work", (s) => s.replace("const total =", "process.cpuUsage(); const total =")],
	["library import", (s) => 'import {} from "../packages/ts/src/index.ts";\n' + s],
	[
		"main condition",
		(s) => s.replace('assert.equal(config.kind, "control");', 'assert.equal(config.kind, "main");'),
	],
	["changed sample count", (s) => s.replace("RECIPE.warmup + RECIPE.measured", "1")],
	["omitted cleanup", (s) => s.replace("cleanupAll([run], sampleFailure)", "cleanupAll([])")],
	[
		"changed arm order",
		(s) => s.replace("for (const arm of arms)", "for (const arm of arms.slice(1))"),
	],
	["changed completion", (s) => s.replace('"PRESET_PERFORMANCE_ROW_DONE"', '"not done"')],
];
const observedMutations = [
	["omitted fault check", (s) => s.replace("observation.check();", "")],
	[
		"omitted warmup checkpoint",
		(s) => s.replace('observation.checkpoint(batch2, arm, "warmup");', ""),
	],
	[
		"changed measured checkpoint",
		(s) =>
			s.replace(
				'observation.checkpoint(batch2, arm, "measured");',
				'observation.checkpoint(batch2, arm, "end");',
			),
	],
	["omitted end checkpoint", (s) => s.replace('observation.checkpoint(batch2, arm, "end");', "")],
	["omitted finish await", (s) => s.replace("await observation.finish()", "observation.finish()")],
	[
		"discarded workload failure",
		(s) => s.replace("workloadFailure = error", "workloadFailure = undefined"),
	],
	["discarded write failure", (s) => s.replace("writeFailure = error", "writeFailure = undefined")],
	[
		"discarded observed fault",
		(s) =>
			s.replace("workloadFailure, observed.fault, writeFailure", "workloadFailure, writeFailure"),
	],
];
for (const condition of ["BASE", "CPU", "CPU_GC"]) {
	const output = derive(original, condition).output;
	test(`${condition}: exact permitted source passes`, () =>
		assert.equal(check(original, output, condition).valid, true));
	for (const [name, mutate] of [...mutations, ...(condition === "BASE" ? [] : observedMutations)]) {
		test(`${condition}: reject ${name}`, () => {
			const changed = mutate(output);
			assert.notEqual(changed, output);
			assert.throws(() => check(original, changed, condition));
		});
	}
	test(`${condition}: reject wrong declared condition`, () =>
		assert.throws(() => check(original, output, condition === "BASE" ? "CPU" : "BASE")));
	test(`${condition}: reject altered frozen original`, () =>
		assert.throws(() => check(original + "\n", output, condition)));
}
test("checker has no derivation import", () => {
	const source = readFileSync(
		new URL("./check-causal-workload-source.mjs", import.meta.url),
		"utf8",
	);
	assert.doesNotMatch(source, /from\s+['"][^'"]*derive-/);
});
