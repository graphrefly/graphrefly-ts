"""Verify archived bytes and reproduce report in fresh extraction. No consumer execution."""
import hashlib,json,os,pathlib,subprocess,sys,tarfile,tempfile
base=pathlib.Path(sys.argv[1]);index=json.loads((base/'artifact-index.json').read_text())
def sha(b):return hashlib.sha256(b).hexdigest()
archive=base/'evidence.tar.gz';assert sha(archive.read_bytes())==index['archiveSha256']
with tempfile.TemporaryDirectory() as temp:
 target=pathlib.Path(temp)
 with tarfile.open(archive) as tar:
  members=tar.getmembers();assert len(members)==len(index['files'])
  assert len({m.name for m in members})==len(members)
  for m in members:
   p=pathlib.PurePosixPath(m.name);assert m.isfile() and not p.is_absolute() and '..' not in p.parts and p.parts[0]=='run'
   data=tar.extractfile(m).read();assert sha(data)==index['files'][m.name]
   dest=target/p;dest.parent.mkdir(parents=True,exist_ok=True);dest.write_bytes(data)
 root=target/'run'
 verifier=root/'continuation/verify_continuation.py' if (root/'continuation.json').exists() else root/'tools/verify.py'
 report=subprocess.check_output([sys.executable,'-B',str(verifier),str(root)],timeout=60)
 assert json.loads(report)==json.loads((base/'report.json').read_text()),'archive report differs'
 if '--rebuild' in sys.argv:
  for f,h in json.loads((root/'build-tools.json').read_text()).items():assert sha(pathlib.Path(f).read_bytes())==h,'local rebuild tool drift'
  rebuilt=json.loads(subprocess.check_output(['node',str(root/'tools/rebuild.mjs'),str(root)],env={'PATH':os.environ['PATH'],'LANG':'C','TZ':'UTC'},timeout=60))
  assert rebuilt==json.loads((root/'rebuild.json').read_text())
 print(json.dumps({'passed':True,'files':len(members),'reportMatches':True,'independentRebuild':'--rebuild' in sys.argv,'newConsumerExecutions':0}))
