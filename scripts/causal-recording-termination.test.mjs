/** Real process exit, stub factories only. No Graph consumer or performance sampling. */
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { derive } from "./derive-causal-recording-driver.mjs";

const original = fs.readFileSync(process.argv[2], "utf8");
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "recording-exit-"));
try {
	fs.copyFileSync(
		new URL("./causal-workload-observation.mjs", import.meta.url),
		path.join(tmp, "observation.mjs"),
	);
	for (const condition of ["EAGER", "DEFERRED"]) {
		const dir = path.join(tmp, condition);
		fs.mkdirSync(dir);
		const source = derive(original, condition).output,
			recipe = JSON.parse(source.match(/const originalRecipe = (.*);/)[1]);
		const driver = path.join(tmp, condition + ".mjs");
		fs.writeFileSync(driver, source);
		const config = {
			row: { id: "cold-P2-summary", group: "cold", profile: "P2", mode: "summary" },
			kind: "control",
			control: true,
			condition,
			orientation: "U",
			output: dir,
			scenarioPath: path.join(dir, "scenario.json"),
		};
		fs.writeFileSync(config.scenarioPath, "{}");
		fs.writeFileSync(path.join(dir, "config.json"), JSON.stringify(config));
		fs.writeFileSync(
			path.join(dir, "entry.mjs"),
			`import {runRow} from ${JSON.stringify(pathToFileURL(driver).href)};
let count=0;
const arms=[0,1].map(()=>({RECIPE:${JSON.stringify(recipe)},preflight:()=>({ok:true}),measurementArm(){if(++count===1200)process.kill(process.pid,'SIGKILL');return {cleanup(){}};}}));
await runRow(${JSON.stringify(path.join(dir, "config.json"))},arms);`,
		);
		const result = spawnSync(process.execPath, [path.join(dir, "entry.mjs")], {
			timeout: 5000,
			env: { PATH: "/usr/bin:/bin", TMPDIR: "/tmp" },
		});
		assert.equal(result.signal, "SIGKILL");
		assert.ok(!fs.existsSync(path.join(dir, "completion.json")));
		assert.equal(
			fs.existsSync(path.join(dir, "samples.jsonl"))
				? fs.readFileSync(path.join(dir, "samples.jsonl"), "utf8").trim().split("\n").length
				: 0,
			condition === "EAGER" ? 1199 : 0,
		);
	}
} finally {
	fs.rmSync(tmp, { recursive: true, force: true });
}
console.log(
	JSON.stringify({
		passed: true,
		stubProcesses: 2,
		killedAtFactory: 1200,
		eagerPrefix: 1199,
		deferredPrefix: 0,
		consumerExecutions: 0,
	}),
);
