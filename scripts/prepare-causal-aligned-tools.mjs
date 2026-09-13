/** Source preparation only. Reading/copying bundles never evaluates consumer modules. */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { check } from "./check-causal-aligned-source.mjs";
import { derive } from "./derive-causal-aligned-driver.mjs";

const [prior, qualification, target] = process.argv.slice(2);
const q = JSON.parse(fs.readFileSync(qualification, "utf8"));
const sha = (p) => createHash("sha256").update(fs.readFileSync(p)).digest("hex");
for (const [file, digest] of Object.entries(q.preparedDigests))
	assert.equal(sha(path.join(prior, file)), digest);
for (const [file, digest] of Object.entries(q.toolDigests)) assert.equal(sha(file), digest);
const build = JSON.parse(fs.readFileSync(path.join(prior, "build.json"), "utf8"));
const raw = build.priorBuild.rawSourceHashes;
assert.equal(Object.keys(raw).length, 60);
for (const [file, digest] of Object.entries(raw)) assert.equal(sha(file), digest, file);
fs.mkdirSync(target, { recursive: false });
for (const file of ["worker.mjs", "worker-copy.mjs", "frozen-driver-source.mjs", "P2-inputs.json"])
	fs.copyFileSync(path.join(prior, file), path.join(target, file));
fs.cpSync(path.join(prior, "sources"), path.join(target, "sources"), { recursive: true });
for (const file of ["causal-aligned-observation.mjs", "causal-workload-observation.mjs"])
	fs.copyFileSync("scripts/" + file, path.join(target, file));
const original = fs.readFileSync(path.join(prior, "frozen-driver-source.mjs"), "utf8"),
	proofs = {};
for (const condition of ["CONTROL", "GC", "GC_CPU"]) {
	const source = derive(original, condition);
	proofs[condition] = check(original, source, condition);
	fs.writeFileSync(path.join(target, condition + ".mjs"), source, { flag: "wx" });
}
fs.writeFileSync(
	path.join(target, "build.json"),
	JSON.stringify({ rawSourceHashes: raw, proofs, consumerExecutions: 0 }, null, 2),
);
console.log(
	JSON.stringify({ prepared: true, conditions: 3, sourceFiles: 60, consumerExecutions: 0, proofs }),
);

fs.mkdirSync(path.join(target, "tools"));
const tools = fs
	.readdirSync("scripts")
	.filter(
		(n) =>
			(n.includes("causal-aligned") ||
				n.includes("causal-anchor") ||
				n.includes("causal-workload") ||
				n.includes("causal-position") ||
				n.includes("causal-block")) &&
			(n.endsWith(".py") || n.endsWith(".mjs")),
	);
for (const n of tools) fs.copyFileSync("scripts/" + n, path.join(target, "tools", n));
// Frozen anchor verifier's structural dependency.
fs.copyFileSync(
	"scripts/verify-causal-aligned-clock.py",
	path.join(target, "tools/verify-causal-aligned-clock.py"),
);
