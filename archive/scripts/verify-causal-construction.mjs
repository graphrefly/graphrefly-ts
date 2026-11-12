/** D161 independent finite resource oracle + actual-runtime snapshots. No provider or host I/O. */
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const outputArg = process.argv.indexOf("--output");
if (outputArg >= 0 && !process.argv[outputArg + 1]) throw new TypeError("--output requires a path");
const reportPath =
	outputArg < 0
		? join(root, "packages/ts/qualification/causal-occurrence/ts-v5-construction-verifier.json")
		: resolve(process.argv[outputArg + 1]);
const src = join(root, "packages/ts/src");
const tests = readFileSync(join(src, "__tests__/graph-construction.d161.test.ts"), "utf8");
// Fixtures supply inputs only. The oracle below imports no runtime transition/release/phase reducer.
const fixture = tests.slice(
	tests.indexOf("class CountingDispatcher"),
	tests.indexOf("// Independent finite ownership oracle"),
);
const temporary = mkdtempSync(join(tmpdir(), "construction-verifier-"));
const output = join(temporary, "result.json");
const digest = (x) => `sha256:${createHash("sha256").update(x).digest("hex")}`;
const runner = `
import assert from 'node:assert/strict';
import {writeFileSync} from 'node:fs';
import {Graph} from '${src}/graph/graph.ts';
import {Dispatcher} from '${src}/dispatcher/index.ts';
import {depLatest} from '${src}/ctx/types.ts';
import {nodeRuntimeHost} from '${src}/node/node-runtime-host.ts';
import {checkpointStateOfNode,subscriberCountOfNode} from '${src}/node/runtime-accessors.ts';
import {prepareConstruction,startConstruction,constructionOf} from '${src}/graph/construction-scope.ts';
import {causalComposition,causalOccurrenceDigest} from '${src}/solutions/causal-occurrence.ts';
${fixture}
// Plain code model: finite ownership/obligation meaning, no Graph, scheduler, or production reducer.
class ResourceModel {
 phase='cold'; resources=new Map(); obligations=new Set(); deliveries=0;
 acquire(id){assert.equal(this.phase,'cold');assert.ok(!this.resources.has(id));this.resources.set(id,'cold');}
 transfer(){assert.equal(this.phase,'cold');this.phase='owned';for(const id of this.resources.keys())this.resources.set(id,'graph');}
 lease(id){assert.ok(['owned','starting'].includes(this.phase));this.resources.set(id,'graph');}
 deliver(){assert.ok(['owned','starting'].includes(this.phase));this.phase='starting';this.deliveries++;}
 finish(failed){assert.equal(this.phase,'starting');this.phase=failed?'faulted':'started';}
 admit(id){assert.ok(['starting','started'].includes(this.phase));this.obligations.add(id);}
 outcome(id){this.obligations.delete(id);}
 detach(){ /* presentation has no ownership or settlement authority */ }
 abort(failed=[]){assert.equal(this.phase,'cold');for(const id of this.resources.keys())if(!failed.includes(id))this.resources.delete(id);this.phase='aborted';}
 snapshot(){return {phase:this.phase,resources:[...this.resources].sort(([a],[b])=>a.localeCompare(b)),obligations:[...this.obligations].sort(),deliveries:this.deliveries};}
}
const snapshots=[];
function physical(g,dispatcher,nodes){return {registrations:g.describe().nodes.map(n=>n.id).sort(),handles:dispatcher?[...dispatcher.live].map(h=>({...h})):null,slots:nodes.map(([name,host])=>{try{host._core.get(host._id);return [name,true];}catch{return [name,false];}}),subscriptions:nodes.map(([name,host])=>[name,host._lifecycle.subscribers.size]),dependencyLeases:nodes.map(([name,host])=>[name,host._dep.unsubs.filter(x=>typeof x==='function').length])};}
for(const coldFailure of [false,true]){
 const f=simple();const model=new ResourceModel();const records=[['a',f.a],['b',f.b],['view/startup',f.startup],['view/left',f.left],['view/right',f.right],['view/join',f.join]];const hosts=records.map(([id,n])=>[id,nodeRuntimeHost(n)]);
 for(const [id]of records.slice(2))model.acquire(id);
 const borrowed=[];const borrow=f.a.subscribe(m=>{if(m[0]==='DATA')borrowed.push(m[1]);});
 const cold=physical(f.graph,f.dispatcher,hosts);assert.deepEqual(cold.registrations.filter(id=>id.startsWith('view/')), [...model.resources.keys()].sort());assert.equal(cold.handles.length,3);assert.equal(cold.slots.filter(x=>x[1]).length,6);assert.equal(subscriberCountOfNode(f.a),1);
 snapshots.push({scenario:coldFailure?'cold-abort':'normal',at:'cold',expected:model.snapshot(),actual:cold});
 if(coldFailure){model.abort();assert.throws(()=>f.scope.abort(new Error('fixture cold failure')),/cleanup complete/);const actual=physical(f.graph,f.dispatcher,hosts);assert.deepEqual(actual.registrations,['a','b',...model.resources.keys()].sort());assert.equal(actual.handles.length,0);assert.equal(actual.slots.filter(x=>x[1]).length,2);assert.equal(subscriberCountOfNode(f.a),1);f.a.set(4);assert.deepEqual(borrowed,[2,4]);snapshots.push({scenario:'cold-abort',at:'aborted',expected:model.snapshot(),actual,borrowed});borrow();continue;}
 const owner=f.scope.seal(f.startup,[f.join]);f.scope.transferToGraph(owner);model.transfer();
 const original=nodeRuntimeHost(f.join)._subscribeOwned.bind(nodeRuntimeHost(f.join));
 nodeRuntimeHost(f.join)._subscribeOwned=(sink,acquisition)=>original((m,d)=>{assert.equal(constructionOf(f.graph,'view'),owner);assert.ok(owner.roots.find(r=>r.node===f.join)?.unsubscribe);model.deliver();sink(m,d);},acquisition);
 model.lease('lease/startup');model.lease('lease/join');startConstruction(f.graph,owner);model.finish(false);
 const actual=physical(f.graph,f.dispatcher,hosts);assert.deepEqual(actual.registrations.filter(id=>id.startsWith('view/')), [...model.resources.keys()].filter(id=>!id.startsWith('lease/')).sort());assert.equal(owner.roots.filter(r=>typeof r.unsubscribe==='function').length,[...model.resources.keys()].filter(id=>id.startsWith('lease/')).length);assert.equal(owner.phase,model.phase);assert.deepEqual(actual.subscriptions,[['a',3],['b',1],['view/startup',1],['view/left',1],['view/right',1],['view/join',1]]);assert.deepEqual(actual.dependencyLeases,[['a',0],['b',0],['view/startup',0],['view/left',1],['view/right',2],['view/join',2]]);
 // Stop instrumentation after initial handshake: steady deliveries do not re-enter the startup model.
 nodeRuntimeHost(f.join)._subscribeOwned=original;
 // Existing subscribed sink still wraps deliver; avoid pushing this source again in this scenario.
 assert.equal(f.join.cache,9);assert.equal(2*2+(2+3),f.join.cache);
 snapshots.push({scenario:'normal',at:'started',expected:model.snapshot(),actual,describe:f.graph.describe(),borrowed});
 for(const lease of owner.roots)lease.unsubscribe?.();borrow();const group=f.graph.topologyGroup();for(const [,n]of records)group.add(n);group.release();assert.equal(f.dispatcher.live.size,0);
}
for(const fault of [false,true]){
 const dispatcher=new CountingDispatcher();const f=causal(new Graph({dispatcher}),fault);const model=new ResourceModel();model.acquire('authority');model.transfer();model.deliver();model.admit('effect/admission');
 const full=causalComposition(f.graph).composeFull(f.options,binding);model.finish(fault);const authority=f.graph.find('causal/authority');const host=nodeRuntimeHost(authority);const owner=constructionOf(f.graph,'causal');
 const facts=()=>{const state=checkpointStateOfNode(authority).ctxState.value;return [...state.effects.values()].filter(x=>x.admission?.state==='admitted'&&!x.outcome).map(()=> 'effect/admission');};
 function snap(at){const registeredHandles=f.graph.describe().nodes.map(n=>f.graph.find(n.id).handle).filter(h=>h!==null);assert.equal(new Set(registeredHandles).size,dispatcher.live.size);for(const h of registeredHandles)assert.ok(dispatcher.live.has(h));assert.equal(full.startup.cache.state,model.phase);assert.deepEqual(facts(),[...model.obligations]);assert.equal(f.graph.find('causal/authority'),authority);assert.equal(nodeRuntimeHost(authority),host);snapshots.push({scenario:fault?'activation-fault':'causal-normal',at,expected:model.snapshot(),actual:{startup:full.startup.cache,activeObligations:facts(),ownerPhase:owner.phase,rootLeases:owner.roots.map(r=>({id:f.graph.describe().nodes.find(n=>f.graph.find(n.id)===r.node)?.id,recorded:typeof r.unsubscribe==='function'})),resources:physical(f.graph,dispatcher,f.graph.describe().nodes.map(n=>[n.id,nodeRuntimeHost(f.graph.find(n.id))]))}});}
 snap('admitted');const stop=full.execution.conservation.subscribe(()=>{});stop();model.detach();snap('UI-detached');
 const outcome={...f.admitted,state:'failed',result:{kind:'error',error:{kind:'issue',code:'failed',message:'failed'}}};f.outcomes.down([['DATA',{...outcome,admissionRef:{kind:'admission',id:'wrong'}}]]);model.outcome('effect/wrong');snap('wrong-outcome');
 f.outcomes.down([['DATA',outcome]]);model.outcome('effect/admission');snap('exact-outcome');
}
// Independent negative controls: the oracle rejects delivery before transfer and post-start cold abort.
assert.throws(()=>new ResourceModel().deliver());const invalid=new ResourceModel();invalid.transfer();assert.throws(()=>invalid.abort());
writeFileSync(${JSON.stringify(output)},JSON.stringify({snapshots,negativeControls:2,passed:true},null,2));
`;
try {
	const bundle = join(temporary, "verify.mjs");
	const compiled = await build({
		stdin: { contents: runner, resolveDir: root, loader: "ts" },
		outfile: bundle,
		bundle: true,
		platform: "node",
		format: "esm",
		metafile: true,
		nodePaths: [join(root, "node_modules")],
		define: { __GRAPHREFLY_TS_PACKAGE_REVISION__: '"graphrefly-ts:0.9.0"' },
	});
	const child = spawnSync(process.execPath, [bundle], { encoding: "utf8", timeout: 30000 });
	assert.ifError(child.error);
	assert.equal(child.status, 0, child.stdout + child.stderr);
	const report = {
		schema: "graphrefly-ts/causal-construction-verifier/v1",
		runnerDigest: digest(readFileSync(fileURLToPath(import.meta.url))),
		fixtureDigest: digest(fixture),
		closure: Object.fromEntries(
			Object.keys(compiled.metafile.inputs)
				.filter((p) => p !== "<stdin>")
				.map((p) => [p, digest(readFileSync(resolve(root, p)))]),
		),
		...JSON.parse(readFileSync(output, "utf8")),
	};
	writeFileSync(reportPath, JSON.stringify(report, null, 2) + "\n");
	console.log("VERIFIER_DONE snapshots=" + report.snapshots.length + " negativeControls=2");
} finally {
	rmSync(temporary, { recursive: true, force: true });
}
