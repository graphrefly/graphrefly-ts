/** Untimed actual DATA counts; diagnostic subscribers are outside the product. */
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { build } from "esbuild";
import { batch } from "../packages/ts/src/batch/batch.ts";
import { drain, runHost } from "./fixtures/spending-focused-host-harness.ts";
import {
	evaluationFixture,
	evaluationPack,
	policyFacts,
	presetBinding,
} from "./fixtures/spending-preset-harness.ts";
import { oracleRequest } from "./fixtures/spending-preset-oracle.ts";

const sha = (value) => createHash("sha256").update(value).digest("hex");
const root = new URL("../", import.meta.url);
const compiled = await build({
	entryPoints: [import.meta.filename],
	bundle: true,
	platform: "node",
	format: "esm",
	write: false,
	metafile: true,
	packages: "external",
});
const sources = Object.keys(compiled.metafile.inputs)
	.sort()
	.map((path) => ({ path, sha256: sha(readFileSync(new URL(path, root))) }));
const baseline = execFileSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" }).trim();
const modes = [];
for (const mode of ["off", "summary"]) {
	const run = runHost(mode, async (payload) => ({ bytesWritten: Buffer.byteLength(payload) }));
	const frames = [],
		rows = [];
	let outcomeData = 0;
	const ends = [
		run.host.source.subscribe((m) => {
			if (m[0] === "DATA") frames.push(m[1].outcomes.length);
		}),
		run.graph.find("spending/effectOutcomes").subscribe((m) => {
			if (m[0] === "DATA") outcomeData++;
		}),
	];
	try {
		await drain();
		const evaluations = Array.from({ length: 32 }, (_, i) => [
			evaluationFixture(i, "coffee"),
			evaluationFixture(i, "tea"),
		]).flat();
		run.send("pack", evaluationPack(evaluations));
		for (const e of evaluations) {
			const before = outcomeData,
				start = frames.length,
				f = policyFacts(e);
			batch(() => {
				run.send("current", f.current);
				run.send("verification", f.verification);
				run.send("local", f.local);
				run.send("arrivals", { packRef: presetBinding.packRef, evaluationRefs: [e.evaluationRef] });
			});
			await drain();
			assert.equal(run.calls.at(-1), oracleRequest(e, presetBinding).body.payloadText + "\n");
			rows.push({
				frontier: rows.length + 1,
				frameOutcomeCounts: frames.slice(start),
				outcomeData: outcomeData - before,
			});
		}
		const latest = evaluations.slice(-2).map((e) => policyFacts(e));
		batch(() => {
			run.send("current", {
				...latest[0].current,
				current: latest.flatMap((f) => f.current.current),
			});
			run.send("local", {
				...latest[0].local,
				stop: true,
				grants: latest.flatMap((f) => f.local.grants),
			});
		});
		await drain();
		assert.equal(run.host.inspect().normalEndReady, true);
		assert.equal(run.calls.length, 64);
		assert.equal(run.host.inspect().records.length, 64);
		assert.equal(
			outcomeData,
			frames.reduce((a, b) => a + b, 0),
		);
		assert.equal(outcomeData, 4096);
		for (const r of rows) {
			assert.deepEqual(r.frameOutcomeCounts, [r.frontier - 1, r.frontier]);
			assert.equal(r.outcomeData, 2 * r.frontier - 1);
		}
		modes.push({
			mode,
			rows,
			totalFrames: frames.length,
			frameLengths: frames,
			totalOutcomeDATA: outcomeData,
			uniqueSucceeded: 64,
			normalEndReady: true,
		});
	} finally {
		for (const stop of ends) stop();
		run.teardown();
	}
}
const output = new URL("../docs/design/causal-lifetime-profile/counts.json", import.meta.url);
for (const source of sources)
	assert.equal(sha(readFileSync(new URL(source.path, root))), source.sha256);
if (existsSync(output)) {
	let i = 1;
	let previous;
	do {
		previous = new URL(
			`../docs/design/causal-lifetime-profile/counts-attempt${i++}.json`,
			import.meta.url,
		);
	} while (existsSync(previous));
	writeFileSync(previous, readFileSync(output));
}
writeFileSync(
	output,
	JSON.stringify(
		{
			kind: "untimed-source-and-outcome-data-counts",
			baseline,
			sources,
			sourceChangesDuringRun: [],
			command: "node --import tsx scripts/count-spending-host-lifetime.mjs",
			scriptSha256: createHash("sha256")
				.update(readFileSync(import.meta.filename))
				.digest("hex"),
			limitations: [
				"Extra diagnostic subscribers; not a latency measurement.",
				"Full-snapshot and outcome DATA counts, not exact CPU cost or removable work proof.",
			],
			modes,
		},
		null,
		2,
	) + "\n",
);
console.log("Verified 4096 outcome DATA /64 unique successful outcomes in each mode");
