"""Freeze sources and build only; no consumer execution."""
import hashlib,json,os,pathlib,shutil,subprocess,tarfile
HERE=pathlib.Path(__file__).resolve().parent
REPO=HERE.parents[3]
OUT=REPO/'archive/evals/causal-currentness-comparison-v1/run'
def sha(b):return hashlib.sha256(b).hexdigest()
def write(p,x):p.write_text(json.dumps(x,separators=(',',':'))+'\n')
def cmd(args):return subprocess.check_output(args,cwd=REPO,env={"PATH":os.environ["PATH"],"LANG":"C","TZ":"UTC"},timeout=90)
if __name__=='__main__':
 OUT.mkdir(parents=True,exist_ok=False);tools=OUT/'tools';tools.mkdir()
 for f in ['build.mjs','child.mjs','driver.mjs','verify.py','collect.py','PLAN.md','prepare.py']:shutil.copyfile(HERE/f,tools/f)
 for f in ['causal-release-comparison.ts','causal-release-comparison-oracle.ts']:shutil.copyfile(REPO/'scripts/fixtures'/f,tools/f)
 shutil.copyfile(REPO/'scripts/rebuild-causal-release-comparison.mjs',tools/'rebuild.mjs')
 archive=REPO/'archive/evals/causal-release-cost-comparison-v2/evidence.tar.gz'
 require=lambda ok: None if ok else (_ for _ in ()).throw(ValueError('archive binding'))
 require(sha(archive.read_bytes())=='f34215ed4797ca9a8848638f0df177fbe04b7860025e06180804a9d162435dd2')
 with tarfile.open(archive) as t:data=t.extractfile('run/P2-inputs.json').read()
 require(sha(data)=='44f1165557fc1444540731a73846233ce3d71da7a0af3a3d4fa2137e249c2079');(OUT/'P2-inputs.json').write_bytes(data)
 paths=json.loads(cmd(['node','-e',"const{createRequire}=require('node:module');const e=require.resolve('esbuild'),r=createRequire(e);console.log(JSON.stringify([process.execPath,e,r.resolve('@esbuild/'+process.platform+'-'+process.arch+'/bin/esbuild'),require.resolve('typescript')]))"]))
 write(OUT/'build-tools.json',{p:sha(pathlib.Path(p).read_bytes()) for p in paths})
 (OUT/'build.log').write_bytes(cmd(['node',str(tools/'build.mjs'),str(OUT),str(REPO)]))
 (OUT/'rebuild.json').write_bytes(cmd(['node',str(tools/'rebuild.mjs'),str(OUT)]))
 b=json.loads((OUT/'build.json').read_text());objects=OUT/'git-objects';objects.mkdir()
 for arm in b['arms'].values():
  rev=arm['commit'];(objects/rev).write_bytes(cmd(['git','cat-file','commit',rev]))
  for f,e in arm['closure'].items():
   if e['gitBlob'] is None:continue
   parents=list(pathlib.PurePosixPath(f).parents)
   for parent in parents:
    ref=rev+'^{tree}' if str(parent)=='.' else rev+':'+str(parent)
    oid=cmd(['git','rev-parse',ref]).decode().strip()
    if not (objects/oid).exists():(objects/oid).write_bytes(cmd(['git','cat-file','tree',oid]))
 print(json.dumps({'built':True,'output':str(OUT),'consumerExecutions':0}),flush=True)
