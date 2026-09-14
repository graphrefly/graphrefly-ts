/** Offline installed-layout public-entry probe. Never modifies the package or its source. */
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
	cpSync,
	mkdirSync,
	mkdtempSync,
	readdirSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "../../..");
const pkg = join(root, "packages/ts");
const sha = (bytes) => createHash("sha256").update(bytes).digest("hex");
const temp = mkdtempSync(join(tmpdir(), "graphrefly-entry-probe-"));
const installed = join(temp, "node_modules/@graphrefly/ts");
const body = `
function exercise(Graph, batch) {
 const graph=new Graph();
 const left=graph.node([],null,{name:'left'}),right=graph.node([],null,{name:'right'});
 const total=graph.derived([left,right],(a,b)=>a+b,{name:'total'});
 const values=[]; const stop=total.subscribe(m=>{if(m[0]==='DATA')values.push(m[1]);});
 left.down([['DATA',1]]);right.down([['DATA',2]]);values.length=0;
 batch(()=>{left.down([['DATA',10]]);right.down([['DATA',20]]);});
 stop(); return values;
}
console.log(JSON.stringify({
 sameGraphConstructor:root.Graph===graph.Graph,
 sameBatchFunction:root.batch===core.batch,
 controlRoot:exercise(root.Graph,root.batch),
 crossGraphCore:exercise(graph.Graph,core.batch),
 crossRootCore:exercise(root.Graph,core.batch)
}));
`;
try {
	mkdirSync(installed, { recursive: true });
	cpSync(join(pkg, "dist"), join(installed, "dist"), { recursive: true });
	cpSync(join(pkg, "package.json"), join(installed, "package.json"));
	const results = [];
	for (const format of ["esm", "cjs"]) {
		const imports =
			format === "esm"
				? "import * as root from '@graphrefly/ts';\nimport * as graph from '@graphrefly/ts/graph';\nimport * as core from '@graphrefly/ts/core';\n"
				: "const root=require('@graphrefly/ts'), graph=require('@graphrefly/ts/graph'), core=require('@graphrefly/ts/core');\n";
		const file = join(temp, format === "esm" ? "consumer.mjs" : "consumer.cjs");
		writeFileSync(file, imports + body);
		const run = spawnSync(process.execPath, [file], { cwd: temp, encoding: "utf8" });
		assert.equal(run.status, 0, run.stderr);
		const observed = JSON.parse(run.stdout);
		assert.deepEqual(observed.controlRoot, [30], `${format} control must work`);
		results.push({
			format,
			workerSha256: sha(imports + body),
			...observed,
			crossGraphCoreConforms: JSON.stringify(observed.crossGraphCore) === "[30]",
			crossRootCoreConforms: JSON.stringify(observed.crossRootCore) === "[30]",
		});
	}
	const artifacts = [];
	function walk(dir) {
		for (const e of readdirSync(dir, { withFileTypes: true })) {
			const p = join(dir, e.name);
			if (e.isDirectory()) walk(p);
			else if (/\.(js|cjs)$/.test(p))
				artifacts.push({ path: p.slice(pkg.length + 1), sha256: sha(readFileSync(p)) });
		}
	}
	walk(join(pkg, "dist"));
	const result = {
		kind: "public-entry-batch-reproduction",
		node: process.version,
		packageJsonSha256: sha(readFileSync(join(pkg, "package.json"))),
		method:
			"Fresh copied dist and package.json under temporary node_modules; public package export resolution in separate ESM/CJS processes. No generated future entrypoints.",
		expected: [30],
		results,
		artifacts,
		scope:
			"Tests shared batch context, not direct evidence of private causal issued/graphRegistrations failure; no performance measurement and no proposed global fix.",
	};
	writeFileSync(join(here, "result.json"), `${JSON.stringify(result, null, 2)}\n`);
	console.log(JSON.stringify({ probeCompleted: true, results }));
} finally {
	rmSync(temp, { recursive: true, force: true });
}
