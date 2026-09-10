import { createRequire } from 'node:module';
import { readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
const root = process.argv[2] ?? process.cwd();
const output = process.argv[3] ?? '/tmp/graphrefly-registration-audit/result.json';
const require = createRequire(path.join(root, 'package.json'));
const { buildSync, version } = require('esbuild');
const probe = `
import assert from 'node:assert/strict';
import { Graph } from './packages/ts/src/graph/graph.ts';
import { Dispatcher } from './packages/ts/src/dispatcher/index.ts';
import { messageBus } from './packages/ts/src/messaging/index.ts';
import { attachMessageBusCommandSource, getMessageBusState } from './packages/ts/src/messaging/internal.ts';
import { Node } from './packages/ts/src/node/node.ts';
import { registerBackendStateContributor, checkpointBackendStateOfNode } from './packages/ts/src/graph/checkpoint.ts';
import { releaseRuntimeOfNode, isNodeRuntimeReleased } from './packages/ts/src/node/runtime-accessors.ts';
import { reactiveList } from './packages/ts/src/graph/data-structures/reactive-list.ts';
const results = {};
const g = new Graph(); const h = new Graph();
const bus = messageBus(g, { name: 'bus' });
const foreign = h.node([], null, { name: 'foreign' });
const local = g.node([], null, { name: 'local' });
const errorOf = fn => {try {fn();return null;}catch(e){return String(e.message);}};
const firstError = errorOf(() => attachMessageBusCommandSource(g, bus, foreign));
const afterFailure = { list: getMessageBusState(bus).commandSources.length, deps: bus.commands.deps.length };
const nextError = errorOf(() => attachMessageBusCommandSource(g, bus, local));
const control = messageBus(g, { name: 'control' });
const controlError = errorOf(() => attachMessageBusCommandSource(g, control, local));
assert(firstError);assert.deepEqual(afterFailure,{list:1,deps:0});assert(nextError);assert.equal(controlError,null);
results.failedAttach = {firstError,afterFailure,nextError,controlError,controlDeps:control.commands.deps.length};
const n = new Node([], null); let reads = 0;
registerBackendStateContributor(n, () => {reads++; return { marker:'retained-backend' };});
releaseRuntimeOfNode(n);
const afterRelease = checkpointBackendStateOfNode(n);
assert(isNodeRuntimeReleased(n));assert.equal(reads,1);
results.backendContributor = {released:isNodeRuntimeReleased(n),reads,afterRelease,note:'Internal accessor probe; no GC measurement or public Graph checkpoint exposure claimed.'};
const cg = new Graph(); const source = cg.state(1,{name:'source'});
const list = reactiveList([], { graph:cg, name:'list' });
const before = cg.describe().nodes.length;
for(let i=0;i<3;i++){const detach=list.appendFrom(source);detach();}
const afterDetach = cg.describe().nodes.length;
list.dispose();
const afterDispose = cg.describe().nodes.length;
assert(afterDetach>before);assert.equal(afterDispose,afterDetach);
results.collectionBind = {before,afterDetach,afterDispose,remainingBindNodes:cg.describe().nodes.filter(n=>n.factory==='reactiveList.bindSource').length,note:'Public detach/dispose leaves registered helper nodes; no normative disposal-scope change assumed.'};
class CountingDispatcher extends Dispatcher {
  registered=0; unregistered=0;
  register(fn,pool){this.registered++;return super.register(fn,pool);}
  unregister(handle){this.unregistered++;return super.unregister(handle);}
}
const dispatcher=new CountingDispatcher();
const dg=new Graph({dispatcher});
dg.node([],()=>{}, {name:'same'});
const beforeDuplicate={registered:dispatcher.registered,unregistered:dispatcher.unregistered,nodes:dg.describe().nodes.length};
const duplicateError=errorOf(()=>dg.node([],()=>{}, {name:'same'}));
const afterDuplicate={registered:dispatcher.registered,unregistered:dispatcher.unregistered,nodes:dg.describe().nodes.length};
assert(duplicateError);assert.equal(afterDuplicate.registered-beforeDuplicate.registered,1);assert.equal(afterDuplicate.unregistered-beforeDuplicate.unregistered,0);assert.equal(afterDuplicate.nodes,beforeDuplicate.nodes);
results.duplicateGraphName={beforeDuplicate,duplicateError,afterDuplicate,note:'Actual ordinary Graph.node construction; one extra pool registration survives failed graph registration. No heap-size estimate.'};
export default results;
`;
const built = buildSync({stdin:{contents:probe,resolveDir:root,loader:'ts'},bundle:true,platform:'node',format:'esm',write:false,metafile:true});
const results = (await import('data:text/javascript;base64,'+Buffer.from(built.outputFiles[0].text).toString('base64'))).default;
const sha = bytes => 'sha256:'+createHash('sha256').update(bytes).digest('hex');
const receipt={baseline:execFileSync('git',['rev-parse','HEAD'],{cwd:root,encoding:'utf8'}).trim(),node:process.version,esbuild:version,kind:'finite offline inspection; no benchmark, source mutation, provider or qualification run',results,probeDigest:sha(readFileSync(new URL(import.meta.url))),bundleDigest:sha(built.outputFiles[0].contents),sourceBindings:Object.keys(built.metafile.inputs).filter(f=>!f.startsWith('<')).sort().map(file=>({file,digest:sha(readFileSync(path.resolve(root,file)))}))};
writeFileSync(output,JSON.stringify(receipt,null,2)+'\n');
console.log(JSON.stringify(results,null,2));
