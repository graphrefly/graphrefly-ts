/** D163 finite independent plain-code differential and descriptive workload measurements. */
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
	cpSync,
	existsSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const index = process.argv.indexOf("--output");
assert.ok(index >= 0 && process.argv[index + 1], "fresh --output required");
const output = resolve(process.argv[index + 1]);
assert.equal(existsSync(output), false, "refuse to reuse evidence path");
const src = join(root, "packages/ts/src");
const digest = (s) => `sha256:${createHash("sha256").update(s).digest("hex")}`;
const temp = mkdtempSync(join(tmpdir(), "causal-committed-comparison-"));
const fixture = readFileSync(join(root, "scripts/fixtures/causal-committed-oracle.mjs"), "utf8");
const results = [];
try {
	for (const instrumented of [true, false]) {
		const runtime = join(temp, instrumented ? "instrumented" : "actual");
		cpSync(src, runtime, { recursive: true });
		if (instrumented) {
			const path = join(runtime, "solutions/causal-occurrence/committed-view.ts");
			const text = readFileSync(path, "utf8");
			assert.equal(text.split("const effects = Object.freeze(").length, 2);
			writeFileSync(
				path,
				text.replace(
					"const effects = Object.freeze(",
					"globalThis.__viewBuilds = (globalThis.__viewBuilds ?? 0) + 1; const effects = Object.freeze(",
				),
			);
		}
		const resultPath = join(temp, `result-${instrumented}.json`);
		const runner = `
import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
import { performance } from 'node:perf_hooks';
import { Graph } from '${runtime}/graph/graph.ts';
import { Dispatcher } from '${runtime}/dispatcher/index.ts';
import { prepareConstruction, startConstruction } from '${runtime}/graph/construction-scope.ts';
import { buildCausalNodes, causalColdNodeNames, prepareCausalOptions } from '${runtime}/solutions/causal-occurrence/construction.ts';
${fixture}
const instrumented=${instrumented};
const binding={contract:'contract-v2',implementationRevision:'construction-v1',scope:'full',epoch:1};
const lanes=['occurrences','admissions','branchTerminals','effectProposals','effectAdmissions','effectOutcomes','evidence','watermarks'];
const h='sha256:'+'b'.repeat(64);
const normalize=v=>({effects:[...(v?.effects??[])].sort((a,b)=>canonical(a.proposal).localeCompare(canonical(b.proposal))),retention:v?.retention??[]});
function instance(capacity=64, hot=[], first=false, observe=false) {
 const g=new Graph({profile:instrumented,dispatcher:new Dispatcher()}); const sources=Object.fromEntries(lanes.map(k=>[k,g.node([],null,{name:'in/'+k})]));
 for(const [k,v] of hot)sources[k].down([['DATA',v]]);
 const scope=prepareConstruction(g,{name:'run',epoch:1,names:['run/startup',...causalColdNodeNames('causal')],inputs:Object.values(sources)});
 const startup=scope.startupSource();
 const built=buildCausalNodes(g,scope,startup,prepareCausalOptions({...sources,name:'causal',requiredBranches:['one'],requiredEvidenceKinds:[],maxOccurrences:capacity,maxPending:512,maxEffects:capacity,maxEvidence:512}),binding);
 const owner=scope.seal(startup,first?[built.committedEffects,...built.roots]:built.roots);scope.transferToGraph(owner);startConstruction(g,owner);
 let latest, ui, views=0, emissions=0, extra=0, serialized=0, envelopeBytes=0, graphEvents=0;const refs=new Set(),quiescence=new Set();const messages={},viewMessages={};let observeStop;
 if(observe)observeStop=g.observe(observe==='whole-graph'?undefined:'causal/authority').subscribe(event=>{envelopeBytes+=Buffer.byteLength(JSON.stringify(event));graphEvents++;if(event.path!=='causal/authority')return;const m=event.msg;messages[m[0]]=(messages[m[0]]??0)+1;if(m[0]==='DATA'){emissions++;if(m[1].kind==='fact' && m[1].fact.kind==='quiescence')quiescence.add(m[1].fact.value.evaluatedThroughRevision);extra+=m[1].kind==='view-change'?1:0;serialized+=Buffer.byteLength(JSON.stringify(m[1]));refs.add(m[1].committedEffects);}});
 const connect=()=>{ui=built.committedEffects.subscribe(m=>{viewMessages[m[0]]=(viewMessages[m[0]]??0)+1;if(m[0]==='DATA'){latest=m[1];views++;}});};
 connect();
 return {g, sources, built, owner, connect,disconnect(){ui?.();},get view(){return latest;},send(k,v){sources[k].down([['DATA',v]]);},stats(){return {views,emissions,extra,serialized,envelopeBytes,graphEvents,retainedVersions:refs.size,quiescenceVersions:quiescence.size,messages:{...messages},viewMessages:{...viewMessages}};},close(){ui?.();observeStop?.();for(const lease of owner.roots)lease.unsubscribe?.();const group=g.topologyGroup();for(const n of g.describe().nodes)group.add(g.find(n.id));group.release();assert.equal(g.describe().nodes.length,0);}};
}
function release(f){return [['occurrences',f.occurrence],['admissions',{occurrence:f.occurrence,state:'admitted',decisionId:'d',decisionDigest:h}],['watermarks',{revisionDomain:'d',revision:f.occurrence.revision}]];}
function terminal(f){return ['branchTerminals',{occurrence:f.occurrence,branch:'one',state:'completed',result:{kind:'ok',value:1}}];}
function flow(f){return [...release(f),['effectProposals',f.proposal],['effectAdmissions',f.admission],['effectOutcomes',f.outcome],terminal(f)];}
const a=frozenFacts(1), b=frozenFacts(1,'b'), c=frozenFacts(2);
const scenarios=[
 {name:'direct',cap:2,trace:[...flow(a),...flow(c)]},
 {name:'deferred',cap:2,trace:flow(a).toReversed()},
 {name:'interleaved-exact-and-conflict',cap:3,trace:[...release(a),['effectProposals',a.proposal],['effectProposals',b.proposal],['effectAdmissions',a.admission],['effectOutcomes',{...a.outcome,admissionRef:{kind:'admission',id:'wrong'}}],['effectAdmissions',a.admission],['effectAdmissions',{...a.admission,admissionRef:{kind:'admission',id:'conflict'}}],['effectOutcomes',a.outcome]]},
 {name:'retention',cap:1,trace:[...flow(a),...flow(c)]},
 {name:'active-capacity',cap:1,trace:[...release(a),['effectProposals',a.proposal],['effectAdmissions',a.admission],['occurrences',c.occurrence],['effectOutcomes',{...a.outcome,state:'unknown',result:{kind:'error',error:{kind:'issue',code:'uncertain',message:'uncertain'}}}]]},
 {name:'no-effects',cap:1,trace:release(a)},
];
const comparisons=[];
for(const scenario of scenarios)for(const first of [false,true]){
 const f=instance(scenario.cap,[],first);const plain=new PlainCommitted(scenario.cap);let pview;let stop=plain.subscribe(v=>pview=v);const checkpoints=[];
 for(const [i,[lane,value]] of scenario.trace.entries()){
  if(i%3===0){f.disconnect();stop();}
  f.send(lane,value);plain.push(lane,value);
  if(i%3===0){f.connect();stop=plain.subscribe(v=>pview=v);}
  assert.deepEqual(normalize(f.view),normalize(pview),scenario.name+':'+i);
  checkpoints.push({lane,input:value,expected:normalize(pview),actual:normalize(f.view)});
 }
 comparisons.push({name:scenario.name,first,checkpoints,graph:f.g.describe()});stop();f.close();
}
// Separate frozen expectations ensure the independent arm isn't merely matching an implementation bug.
const resultByName=name=>comparisons.find(x=>x.name===name).checkpoints.at(-1).actual;
assert.deepEqual(resultByName('interleaved-exact-and-conflict').effects,[{proposal:a.proposal,admission:a.admission,outcome:a.outcome},{proposal:b.proposal}].sort((x,y)=>canonical(x.proposal).localeCompare(canonical(y.proposal))));
assert.deepEqual(resultByName('retention'),{effects:[],retention:[{revisionDomain:'d',floor:1,gapThrough:1}]});
assert.deepEqual(resultByName('no-effects'),{effects:[],retention:[]});
for(const first of [false,true]){
 const hot=flow(a).filter(([k])=>k!=='branchTerminals');const f=instance(2,hot,first);
 assert.deepEqual(normalize(f.view).effects,[{proposal:a.proposal,admission:a.admission,outcome:a.outcome}]);f.close();
}
const measures=[];
const rows=[...[1,16,64].flatMap(e=>[0,1,100].map(rate=>({e,rate,bytes:32}))),...[4096,65536].map(bytes=>({e:16,rate:100,bytes}))];
for(const row of rows)for(const observe of [false,"authority","whole-graph"]){
 const f=instance(row.e,[],false,observe);const facts=Array.from({length:row.e},(_,i)=>frozenFacts(1,'e'+i,row.bytes));
 for(const event of release(facts[0]))f.send(...event);
 for(const fact of facts){f.send('effectProposals',fact.proposal);f.send('effectAdmissions',fact.admission);}
 const builds=globalThis.__viewBuilds??0;const before=f.stats();const profileBefore=instrumented?f.g.profile():null;const heapBefore=process.memoryUsage().heapUsed;const samples=[];let accepted=0,total=0;
 for(const fact of facts){
  const repeats=row.rate===100?1:100;
  for(let i=0;i<repeats;i++){
   const exact=row.rate>0 && i===repeats-1;const outcome=fact.outcome;
   const t=performance.now();if(exact)f.send('effectOutcomes',outcome);else f.send('watermarks',{revisionDomain:'d',revision:total+2});samples.push((performance.now()-t)*1e6);accepted+=exact?1:0;total++;
  }
 }
 const after=f.stats();const profileAfter=instrumented?f.g.profile():null;const viewBuilds=(globalThis.__viewBuilds??0)-builds;
 if(instrumented)assert.equal(viewBuilds,accepted,'one build per actual accepted outcome; none per changing watermark');
 assert.equal(after.views-before.views,accepted);assert.equal(after.extra-before.extra,0);if(observe)assert.equal(after.quiescenceVersions-before.quiescenceVersions,total-accepted);
 const old=f.view, bytesBefore=JSON.stringify(old);for(let i=0;i<20;i++){f.disconnect();f.connect();assert.equal(f.view,old);}assert.equal(JSON.stringify(old),bytesBefore);
 const ps=[...samples].sort((a,b)=>a-b);measures.push({...row,observe,accepted,total,actualPhaseChangePercent:100*accepted/total,unrelatedFacts:"strictly advancing watermark; every value emits a distinct quiescence coordinate without effect/retention change",viewBuilds:instrumented?viewBuilds:null,medianNs:ps[Math.floor(ps.length/2)],p95Ns:ps[Math.ceil(ps.length*.95)-1],samples,viewBytes:Buffer.byteLength(bytesBefore),serializedAuthorityBytes:after.serialized-before.serialized,serializedObserveEnvelopeBytes:after.envelopeBytes-before.envelopeBytes,observeEvents:after.graphEvents-before.graphEvents,describeBytes:Buffer.byteLength(JSON.stringify(f.g.describe())),observerRetainedVersions:after.retainedVersions,heapDeltaBytes:process.memoryUsage().heapUsed-heapBefore,heapMeaning:'descriptive process heap delta including samples/observer, not isolated retained heap',messages:{authorityBefore:before.messages,authorityAfter:after.messages,viewBefore:before.viewMessages,viewAfter:after.viewMessages},profileBefore,profileAfter,reconnections:20});f.close();
}
writeFileSync(${JSON.stringify(resultPath)},JSON.stringify({instrumented,comparisons,hotOrders:2,measures,limitations:['Finite one-domain oracle for admitted/success/unknown fixture vocabulary, not all malformed-input diagnostics.','Requested change ratio is the measured phase mixing fresh accepted outcomes and strictly advancing watermarks; setup transitions are explicitly outside it. Each accepted outcome is fresh; replay saturation is not counted as work.','Reference-sharing saves in-process allocations, not authority observer JSON bytes. Instrumented counts and unmodified runtime times are separate.','No materializer, public preset or actual dispatch authorization proven.']}));
`;
		const outfile = join(temp, `run-${instrumented}.mjs`);
		const compiled = await build({
			stdin: { contents: runner, resolveDir: root, loader: "ts" },
			outfile,
			bundle: true,
			platform: "node",
			format: "esm",
			metafile: true,
			define: { __GRAPHREFLY_TS_PACKAGE_REVISION__: '"graphrefly-ts:0.9.0"' },
		});
		const child = spawnSync(process.execPath, ["--expose-gc", outfile], {
			encoding: "utf8",
			timeout: 600000,
			stdio: "inherit",
		});
		assert.ifError(child.error);
		assert.equal(child.status, 0);
		results.push({
			...JSON.parse(readFileSync(resultPath, "utf8")),
			bundleDigest: digest(readFileSync(outfile)),
			closure: Object.fromEntries(
				Object.keys(compiled.metafile.inputs)
					.filter((p) => p !== "<stdin>")
					.map((p) => [p, digest(readFileSync(resolve(root, p)))]),
			),
		});
	}
	mkdirSync(dirname(output), { recursive: true });
	writeFileSync(
		output,
		JSON.stringify(
			{
				schema: "graphrefly-ts/causal-committed-view-comparison/v1",
				runnerDigest: digest(readFileSync(fileURLToPath(import.meta.url))),
				oracleDigest: digest(fixture),
				passed: true,
				results,
			},
			null,
			2,
		) + "\n",
	);
	console.log("COMMITTED_COMPARISON_DONE");
} finally {
	rmSync(temp, { recursive: true, force: true });
}
