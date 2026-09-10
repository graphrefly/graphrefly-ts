import { createRequire } from 'node:module';
import { readFileSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import path from 'node:path';
const root=process.argv[2]??process.cwd();
const output=process.argv[3]??'/tmp/graphrefly-registration-audit/inventory.json';
const require=createRequire(path.join(root,'package.json'));
const ts=require('typescript');
const paths=execFileSync('rg',['--files','packages/ts/src','-g','*.ts','-g','!**/__tests__/**','-g','!**/__bench__/**','-g','!*.test.ts','-g','!*.bench.ts','-g','!*.d.ts'],{cwd:root,encoding:'utf8'}).trim().split('\n').sort();
const allocations=[],namedRegistrationMethods=[],bindings=[];
const sha=b=>'sha256:'+createHash('sha256').update(b).digest('hex');
for(const file of paths){const code=readFileSync(path.join(root,file),'utf8');bindings.push({file,digest:sha(code)});const sf=ts.createSourceFile(file,code,ts.ScriptTarget.Latest,true);const visit=n=>{
if(ts.isNewExpression(n)&&['Map','Set','WeakMap','WeakSet','WeakRef','FinalizationRegistry'].includes(n.expression.getText(sf))){let a=n.parent,owner='',scope='module';while(a&&!ts.isSourceFile(a)){if(!owner&&a.name)owner=a.name.getText(sf);if(ts.isFunctionLike(a)){scope='function';break;}if(ts.isPropertyDeclaration(a)){scope='instance';break;}a=a.parent;}allocations.push({file,line:sf.getLineAndCharacterOfPosition(n.getStart(sf)).line+1,kind:n.expression.getText(sf),owner,scope});}
if((ts.isFunctionDeclaration(n)||ts.isMethodDeclaration(n)||ts.isPropertyAssignment(n))&&n.name&&/register|registry|subscribe|listener|observer/i.test(n.name.getText(sf)))namedRegistrationMethods.push({file,line:sf.getLineAndCharacterOfPosition(n.getStart(sf)).line+1,name:n.name.getText(sf),syntax:ts.SyntaxKind[n.kind]});ts.forEachChild(n,visit);};visit(sf);}
const result={baseline:execFileSync('git',['rev-parse','HEAD'],{cwd:root,encoding:'utf8'}).trim(),scope:'packages/ts/src/**/*.ts excluding __tests__, __bench__, *.test.ts, *.bench.ts, *.d.ts; excludes generated runners, qualifications, examples and other language packages',method:'TypeScript AST allocation and named registration declaration census; not escape analysis or behavioral qualification. Includes transient working collections; arrays and callback wiring also require manual review.',typescript:ts.version,scannerDigest:sha(readFileSync(new URL(import.meta.url))),files:paths.length,counts:allocations.reduce((o,r)=>(o[r.kind]=(o[r.kind]??0)+1,o),{}),allocations,namedRegistrationMethods,sourceBindings:bindings};writeFileSync(output,JSON.stringify(result,null,2)+'\n');console.log(JSON.stringify({files:paths.length,counts:result.counts,namedDeclarations:namedRegistrationMethods.length,weakPersistent:allocations.filter(r=>r.kind.startsWith('Weak')&&!(r.scope==='function'&&r.owner!=='bindDeps'&&r.owner!=='releaseDrains')).length}));
