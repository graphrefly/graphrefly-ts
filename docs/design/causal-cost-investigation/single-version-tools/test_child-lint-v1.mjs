import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { transformSync } from "esbuild";
import { coordinates } from "./driver-lint-v1.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const normalized = (text) => transformSync(text, { minify: true, format: "esm" }).code;
assert.equal(
	normalized(
		readFileSync(path.join(here, "driver-lint-v1.mjs"), "utf8").split(
			"export function coordinates",
		)[0],
	),
	normalized(
		readFileSync(path.join(here, "../dependency-comparison-tools/driver.mjs"), "utf8").split(
			"export function coordinates",
		)[0],
	),
);
assert.deepEqual(
	coordinates(),
	Array.from({ length: 120 }, (_, index) => ({
		block: 0,
		position: 0,
		slot: 0,
		index,
		phase: index < 20 ? "warmup" : "measured",
	})),
);
const sha = (x) => createHash("sha256").update(x).digest("hex");
for (const wrong of [false, true]) {
	const root = mkdtempSync(path.join(tmpdir(), "grf-single-fake-"));
	try {
		for (const dir of ["tools", "jobs/00", "run-slot"])
			mkdirSync(path.join(root, dir), { recursive: true });
		for (const name of ["child-lint-v1.mjs", "driver-lint-v1.mjs"])
			copyFileSync(path.join(here, name), path.join(root, "tools", name));
		const bundle = `import {appendFileSync} from 'node:fs';
const log=new URL('./fake-events.log',import.meta.url);
appendFileSync(log,'import\\n');
export const preflights=()=>({expected:{},cold:{passed:true},steady:{passed:true}});
export const duplicate=()=>[];
export const candidate=()=>{appendFileSync(log,'construct\\n');return {send(){},cleanup(){appendFileSync(log,'cleanup\\n')}}};
export const occurrence=()=>1;
export const graphSnapshot=()=>({});
export function validate(){}
`;
		writeFileSync(path.join(root, "run-slot/bundle.mjs"), bundle);
		const input = '{"steps":[]}';
		writeFileSync(path.join(root, "P2-inputs.json"), input);
		const entry = {
			row: "P2-lifecycle",
			modules: wrong ? ["run-slot/bundle.mjs", "B.mjs"] : ["run-slot/bundle.mjs"],
			moduleDigests: { "run-slot/bundle.mjs": sha(bundle) },
			inputDigest: sha(input),
		};
		const e = path.join(root, "jobs/00/entry.json");
		writeFileSync(e, JSON.stringify(entry));
		const r = spawnSync(process.execPath, [path.join(root, "tools/child-lint-v1.mjs"), e], {
			env: { PATH: path.dirname(process.execPath) + ":/usr/bin:/bin", LANG: "C", TZ: "UTC" },
			encoding: "utf8",
			timeout: 10000,
		});
		assert.equal(r.status, wrong ? 1 : 0, r.stderr);
		if (!wrong) {
			const events = readFileSync(path.join(root, "run-slot/fake-events.log"), "utf8")
				.trim()
				.split("\n");
			assert.equal(events.filter((x) => x === "import").length, 1);
			assert.equal(events.filter((x) => x === "construct").length, 121);
			assert.equal(events.filter((x) => x === "cleanup").length, 121);
			const samples = readFileSync(path.join(root, "jobs/00/samples.jsonl"), "utf8")
				.trim()
				.split("\n")
				.map(JSON.parse);
			assert.equal(samples.length, 120);
			assert.equal(samples.filter((s) => s.phase === "measured").length, 100);
		}
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
}
console.log(
	JSON.stringify({
		passed: true,
		singleFakeModuleImport: 1,
		fakeConstructions: 121,
		fakeReleases: 121,
		secondModuleRejected: true,
		unchangedSampleBody: true,
		realConsumerExecutions: 0,
	}),
);
