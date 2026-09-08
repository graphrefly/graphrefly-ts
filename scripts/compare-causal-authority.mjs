/** D160 offline differential qualification against immutable ts-v3, not a business oracle. */
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const src = join(root, "packages/ts/src");
const frozenPath = join(root, "packages/ts/qualification/causal-occurrence/ts-v3-inputs.json");
const frozen = JSON.parse(readFileSync(frozenPath, "utf8"));
const name = "packages/ts/src/solutions/causal-occurrence.ts";
const old = frozen.files[name].text;
const digest = (value) => `sha256:${createHash("sha256").update(value).digest("hex")}`;
assert.equal(digest(old), frozen.files[name].digest);
const receipt = readFileSync(
	join(root, "packages/ts/qualification/causal-occurrence/ts-v3-receipt.json"),
);
assert.equal(digest(receipt), frozen.receiptDigest);
assert.equal(JSON.parse(receipt).files[name], digest(old));
const candidatePaths = [
	"solutions/causal-occurrence.ts",
	...["contracts", "identity", "lifecycle", "evidence", "transition"].map(
		(name) => `solutions/causal-occurrence/${name}.ts`,
	),
];
const candidateFiles = Object.fromEntries(
	candidatePaths.map((name) => [name, digest(readFileSync(join(src, name)))]),
);
const runnerBytes = readFileSync(fileURLToPath(import.meta.url));
const frozenBytes = readFileSync(frozenPath);
const sf = ts.createSourceFile(name, old, ts.ScriptTarget.Latest, true);
const bundle = sf.statements.find((node) => node.name?.text === "causalOccurrenceBundle");
const authority = bundle.body.statements.find(
	(node) => node.declarationList?.declarations[0].name.getText(sf) === "authority",
);
const body = authority.declarationList.declarations[0].initializer.arguments[1].body.getText(sf);
const pureBody = body
	.replace("cloneState(ctx.state.get<RuntimeState<T>>())", "cloneState(prior)")
	.replaceAll("depBatch(ctx, 0) ?? []", "arrivals")
	.replace("ctx.state.set(state);", "")
	.replace(
		'for (const output of outputs) ctx.down([["DATA", Object.freeze(output)]]);',
		"return {state, outputs};",
	);
assert.equal(pureBody.includes("ctx."), false);
const temporary = mkdtempSync(join(tmpdir(), "causal-comparison-"));
const reference = join(temporary, "reference.ts");
const runner = join(temporary, "compare.ts");
const resultPath = join(temporary, "result.json");
writeFileSync(
	reference,
	`${old}\nexport function referenceTransition<T>(prior: RuntimeState<T> | undefined, arrivals: readonly Arrival<T>[], opts: CausalOccurrenceBundleOptions<T>) ${pureBody}`.replaceAll(
		'from "../',
		`from "${src}/`,
	),
);
const scaffoldOnly = process.argv.includes("--scaffold-only");
const fixture = `
import assert from 'node:assert/strict';
import { performance } from 'node:perf_hooks';
import { writeFileSync } from 'node:fs';
import { Graph } from '${src}/graph/graph.ts';
import { causalOccurrenceBundle as referenceBundle, referenceTransition } from '${reference}';
import { causalOccurrenceBundle, causalOccurrenceDigest } from '${src}/solutions/causal-occurrence.ts';
import { transitionCausalAuthority } from '${src}/solutions/causal-occurrence/transition.ts';
const lanes = ['occurrences','admissions','branch-terminals','effect-proposals','effect-admissions','effect-outcomes','evidence','watermarks'];
const props = ['occurrences','admissions','branchTerminals','effectProposals','effectAdmissions','effectOutcomes','evidence','watermarks'];
const opts = {name:'causal',requiredBranches:['a','b'],requiredEvidenceKinds:['proof'],maxOccurrences:64,maxPending:512,maxEffects:64,maxEvidence:512};
const ok = value => ({kind:'ok',value});
const issue = {kind:'issue',code:'failed',message:'failed'};
function trace(count, evidenceCount, reverse, capacity = 64) {
 const arrivals=[];
 const send=(lane, ...values)=>arrivals.push({lane,values});
 for(let i=1;i<=count;i++) {
  const raw={revisionDomain:'run',occurrenceId:'occ-'+i,revision:i,sourceRefs:[{kind:'input',id:'input-'+i}],value:i};
  const occurrence={...raw,digest:causalOccurrenceDigest(raw)};
  const decision={occurrence,decisionId:'decision-'+i,decisionDigest:'sha256:'+'a'.repeat(64),state:'admitted'};
  const proposal={occurrence,effectId:'effect-'+i,requestRef:{kind:'request',id:'request-'+i},proposalDigest:'sha256:'+'b'.repeat(64)};
  const admission={...proposal,state:'admitted',admissionRef:{kind:'admission',id:'admission-'+i}};
  send('occurrences',occurrence); send('admissions',decision);
  send('watermarks',{revisionDomain:'run',revision:i});
  send('branch-terminals',...['a','b'].map(branch=>({occurrence,branch,state:'completed',result:ok(branch)})));
  send('effect-proposals',proposal); send('effect-admissions',admission);
  send('effect-outcomes',{...admission,admissionRef:{kind:'admission',id:'wrong'},state:'failed',result:{kind:'error',error:issue}});
  send('effect-outcomes',{...admission,state:'succeeded',result:ok(i)});
  for(let j=0;j<Math.floor(evidenceCount/count);j++)send('evidence',{occurrence,evidenceKind:'proof',evidenceId:'proof-'+i+'-'+j,evidenceDigest:'sha256:'+'c'.repeat(64),coverage:'included'});
  send('occurrences',occurrence); send('admissions',decision);
 }
 if(reverse)arrivals.reverse();
 return {arrivals,options:{...opts,maxOccurrences:capacity,maxEvidence:Math.max(1,evidenceCount)},count,evidenceCount,reverse,capacity};
}
function graphRun(make, scenario) {
 const graph = new Graph(); const releases=[]; const originalRetain=graph.retain.bind(graph);
 graph.retain=(node, options)=>{const stop=originalRetain(node,options);releases.push(stop);return stop;};
 const inputs=Object.fromEntries(props.map(prop=>[prop,graph.node([],null,{name:'source/'+prop})]));
 const output=make(graph,{...scenario.options,...inputs}); const events=[]; const timings=[];
 for(const [port,node] of Object.entries(output))releases.push(node.subscribe(message=>{if(message[0]!=='START')events.push([port,message[0],message[0]==='DATA'||message[0]==='ERROR'?message[1]:null]);}));
 const shape=graph.describe().nodes.map(({id,factory,deps})=>({id,factory,deps}));
 try {
  for(const arrival of scenario.arrivals) {const start=performance.now(); inputs[props[lanes.indexOf(arrival.lane)]].down(arrival.values.map(value=>['DATA',value]));timings.push((performance.now()-start)*1e6);}
  return {events,shape,timings};
 } finally {
  for(const stop of releases.reverse())stop();
  const group=graph.topologyGroup({name:'comparison-cleanup'});
  for(const entry of graph.describe().nodes)group.add(graph.find(entry.id));
  group.release();assert.equal(graph.describe().nodes.length,0);
 }
}
function reduce(run, scenario) { let state;const outputs=[];for(const arrival of scenario.arrivals){const next=run(state,[arrival],scenario.options); state=next.state;outputs.push(...next.outputs);}return {state,outputs}; }
const scenarios=[trace(1,0,false),trace(16,128,false),trace(64,512,false),trace(16,128,true),trace(64,512,true),trace(16,128,false,2)].filter(()=>${!scaffoldOnly});
const percentile=(values,p)=>[...values].sort((a,b)=>a-b)[Math.max(0,Math.ceil(values.length*p)-1)];
const comparisons=[];
const prepared=[];
for(const scenario of scenarios){
 console.log('compare',scenario.count,scenario.evidenceCount,scenario.reverse,scenario.capacity);
 const before=graphRun(referenceBundle,scenario); const after=graphRun(causalOccurrenceBundle,scenario);assert.deepEqual({events:after.events,shape:after.shape},{events:before.events,shape:before.shape});
 const baseline=reduce(referenceTransition,scenario), candidate=reduce(transitionCausalAuthority,scenario);
 assert.deepEqual(candidate,baseline); prepared.push({baseline:baseline.state,candidate:candidate.state});
 comparisons.push({count:scenario.count,evidenceCount:scenario.evidenceCount,reverse:scenario.reverse,capacity:scenario.capacity,inputBatches:scenario.arrivals.length,events:after.events.length,nodes:after.shape.length,edges:after.shape.reduce((sum,n)=>sum+n.deps.length,0),matched:true,syncPath:{measurement:"single-pass baseline-first observation; no equivalent warmup; not a budget qualification",baselineP95Ns:percentile(before.timings,.95),candidateP95Ns:percentile(after.timings,.95),p95Ratio:percentile(after.timings,.95)/percentile(before.timings,.95),baselineTotalNs:before.timings.reduce((a,b)=>a+b,0),candidateTotalNs:after.timings.reduce((a,b)=>a+b,0)}});
}
// Prepared state avoids repeatedly rebuilding the large history. This measures one
// retained-state replay transition, not a whole occurrence lifecycle or full graph p95.
const performanceRows=[];
for(const [index,scenario] of scenarios.entries()){
 const arrival=scenario.arrivals.at(-1); const prior=prepared[index];
 const invoke=which=>which==='baseline'?referenceTransition(prior.baseline,[arrival],scenario.options):transitionCausalAuthority(prior.candidate,[arrival],scenario.options);
 for(let i=0;i<4;i++){invoke('baseline');invoke('candidate');}
 const before=[],after=[];
 const measure=which=>{const start=performance.now();invoke(which);return (performance.now()-start)*1e6;};
 for(let i=0;i<15;i++){if(i%2){after.push(measure('candidate'));before.push(measure('baseline'));}else{before.push(measure('baseline'));after.push(measure('candidate'));}}
 performanceRows.push({count:scenario.count,evidenceCount:scenario.evidenceCount,reverse:scenario.reverse,capacity:scenario.capacity,measurement:'retained-state replay transition',baselineMedianNs:percentile(before,.5),candidateMedianNs:percentile(after,.5),deltaNsPerTransition:percentile(after,.5)-percentile(before,.5),baselineP95Ns:percentile(before,.95),candidateP95Ns:percentile(after,.95),baselineSamplesNs:before,candidateSamplesNs:after});
 console.log('sampled',scenario.count,scenario.evidenceCount,scenario.reverse);
}
// The empty coordination case isolates the cost of creating transition-local helpers.
const scaffoldSamples=[];
for(let pass=0;pass<11;pass++){
 const times={};for(const which of pass%2?['candidate','baseline']:['baseline','candidate']){
  const run=which==='baseline'?referenceTransition:transitionCausalAuthority;
  const start=performance.now();for(let i=0;i<10000;i++)run(undefined,[],opts);
  times[which]=(performance.now()-start)*1e6/10000;
 }
 if(pass>0)scaffoldSamples.push(times);
}
const scaffold={measurement:'empty transition setup; no identity/hash/graph/I/O',samples:scaffoldSamples,medianDeltaNs:percentile(scaffoldSamples.map(x=>x.candidate-x.baseline),.5)};
// Resolve the small cold-trace outlier with warmed, alternating whole-path runs.
const small=trace(1,0,false); const smallBefore=[],smallAfter=[];
const smallMeasure=make=>graphRun(make,small).timings.reduce((a,b)=>a+b,0);
for(let i=0;i<6;i++){smallMeasure(referenceBundle);smallMeasure(causalOccurrenceBundle);}
for(let i=0;i<21;i++){if(i%2){smallAfter.push(smallMeasure(causalOccurrenceBundle));smallBefore.push(smallMeasure(referenceBundle));}else{smallBefore.push(smallMeasure(referenceBundle));smallAfter.push(smallMeasure(causalOccurrenceBundle));}}
const smallGraph={measurement:'warmed alternating total synchronous input-to-output path; construction/cleanup excluded',baselineSamplesNs:smallBefore,candidateSamplesNs:smallAfter,baselineP95Ns:percentile(smallBefore,.95),candidateP95Ns:percentile(smallAfter,.95),p95Ratio:percentile(smallAfter,.95)/percentile(smallBefore,.95)};
writeFileSync('${resultPath}',JSON.stringify({comparisons,performance:performanceRows,scaffold,smallGraph,memoryScope:"aggregate process only; not a comparative allocation claim",percentileEstimator:"nearest-rank; 15 replay samples per arm; graph p95 across input batches",memory:process.memoryUsage(),resourceUsage:process.resourceUsage(),cleanup:true}));
`;
writeFileSync(runner, fixture);
const arg = process.argv.indexOf("--output");
try {
	const child = spawnSync(
		process.execPath,
		["--import", join(root, "node_modules/tsx/dist/loader.mjs"), runner],
		{ cwd: root, encoding: "utf8", timeout: 300000, stdio: "inherit", maxBuffer: 2 * 1024 * 1024 },
	);
	assert.ifError(child.error);
	assert.equal(child.status, 0, child.stdout + child.stderr);
	for (const [name, hash] of Object.entries(candidateFiles))
		assert.equal(
			digest(readFileSync(join(src, name))),
			hash,
			`Candidate changed during comparison: ${name}`,
		);
	assert.equal(
		digest(readFileSync(fileURLToPath(import.meta.url))),
		digest(runnerBytes),
		"Runner changed during execution",
	);
	assert.equal(
		digest(readFileSync(frozenPath)),
		digest(frozenBytes),
		"Frozen inputs changed during execution",
	);
	const report = {
		complete: !scaffoldOnly,
		candidateFiles,
		schema: "graphrefly-ts/causal-authority-comparison/v1",
		baselineDigest: digest(old),
		frozenInputsDigest: digest(frozenBytes),
		runnerDigest: digest(runnerBytes),
		derivedHarnessDigest: digest(fixture),
		runtime: { node: process.version, platform: process.platform, arch: process.arch },
		...JSON.parse(readFileSync(resultPath, "utf8")),
	};
	if (arg >= 0)
		writeFileSync(resolve(process.argv[arg + 1]), JSON.stringify(report, null, "\t") + "\n");
	console.log(
		JSON.stringify({
			scaffold: report.scaffold,
			smallGraph: report.smallGraph,
			syncPath: report.comparisons.map((x) => x.syncPath),
		}),
	);
	console.log(`COMPARISON_DONE matched=${report.comparisons.length}`);
} finally {
	rmSync(temporary, { recursive: true, force: true });
}
