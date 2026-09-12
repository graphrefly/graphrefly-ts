/** Reuse byte-bound prior consumer bundle; derive new private drivers. Never imports consumer. */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { check } from "./check-causal-recording-source.mjs";
import { derive } from "./derive-causal-recording-driver.mjs";

const [prior, qualification, target] = process.argv.slice(2);
const q = JSON.parse(fs.readFileSync(qualification, "utf8"));
const sha = (x) => createHash("sha256").update(x).digest("hex");
for (const [file, digest] of Object.entries(q.preparedDigests))
	assert.equal(sha(fs.readFileSync(path.join(prior, file))), digest, file);
for (const [file, digest] of Object.entries(q.toolDigests))
	assert.equal(sha(fs.readFileSync(file)), digest, file);
const build = JSON.parse(fs.readFileSync(path.join(prior, "build.json"), "utf8"));
for (const [file, digest] of Object.entries(build.rawSourceHashes))
	assert.equal(sha(fs.readFileSync(file)), digest, file);
assert.equal(Object.keys(build.rawSourceHashes).length, 60);
fs.mkdirSync(target, { recursive: false });
for (const name of [
	"worker.mjs",
	"worker-copy.mjs",
	"frozen-driver-source.mjs",
	"observation.mjs",
	"P2-inputs.json",
])
	fs.copyFileSync(path.join(prior, name), path.join(target, name));
fs.cpSync(path.join(prior, "sources"), path.join(target, "sources"), { recursive: true });
const original = fs.readFileSync(path.join(prior, "frozen-driver-source.mjs"), "utf8"),
	proofs = {};
for (const condition of ["EAGER", "DEFERRED"]) {
	const d = derive(original, condition);
	proofs[condition] = check(original, d.output, condition);
	fs.writeFileSync(path.join(target, condition + ".mjs"), d.output);
}
const coordinates = Array.from({ length: 4 }, (_, round) =>
	["EAGER", "DEFERRED"].flatMap((condition) =>
		["U", "V"].map((orientation) => ({ round, condition, orientation })),
	),
).flat();
fs.writeFileSync(
	path.join(target, "coordinates.json"),
	JSON.stringify({ dispatchAuthorized: false, randomOrderNotDrawn: true, coordinates }, null, 2),
);
fs.writeFileSync(
	path.join(target, "build.json"),
	JSON.stringify({ priorBuild: build, proofs, consumerExecutions: 0 }, null, 2),
);
fs.mkdirSync(path.join(target, "tools"));
const files = [
	...new Set([
		...Object.keys(q.toolDigests),
		...fs
			.readdirSync("scripts")
			.filter((n) => n.includes("causal-recording") && (n.endsWith(".mjs") || n.endsWith(".py")))
			.map((n) => "scripts/" + n),
	]),
];
for (const file of files) fs.copyFileSync(file, path.join(target, "tools", path.basename(file)));
console.log(
	JSON.stringify({
		prepared: true,
		coordinates: 16,
		sourceFiles: 60,
		consumerExecutions: 0,
		toolFiles: files.length,
		proofs,
	}),
);
