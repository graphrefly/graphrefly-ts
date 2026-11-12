"""Offline independent-verifier cases; never execute a captured fixture."""
import copy
import hashlib
import importlib.util
import json
import shutil
import sys
import tempfile
import unittest
from pathlib import Path

sys.dont_write_bytecode = True
spec = importlib.util.spec_from_file_location('clock_verifier', Path(__file__).with_name('verify-causal-event-clock.py'))
verifier = importlib.util.module_from_spec(spec)
spec.loader.exec_module(verifier)
CAPTURE = Path('archive/evals/causal-event-clock-repair-v1/capture')
REPORT = Path('archive/evals/causal-console-marker-replay-v1/replay/correlation.json')

class VerifyTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix='clock-verifier-')
        self.root = Path(self.temp.name)
        for name in ['manifest.json','trace-1.json','evidence.json','fixture.mjs']:
            shutil.copyfile(CAPTURE/name, self.root/name)
        shutil.copyfile(REPORT,self.root/'correlation.json')

    def tearDown(self):
        self.temp.cleanup()

    def test_real_positive(self):
        result=verifier.verify(self.root)
        self.assertTrue(result['qualified'])
        self.assertEqual((result['events'],result['markers'],result['windows']),(3,3,3))

    def test_report_forgery(self):
        report=json.loads((self.root/'correlation.json').read_text())
        report['samples'][1]['events'][0]['status']='disjoint'
        (self.root/'correlation.json').write_text(json.dumps(report))
        with self.assertRaises(AssertionError):verifier.verify(self.root)

    def reject_trace(self, kind):
        path=self.root/'trace-1.json'
        trace=json.loads(path.read_text())
        rows=trace['traceEvents']
        b=next(i for i,r in enumerate(rows) if r['ph']=='b')
        e=next(i for i,r in enumerate(rows) if r['ph']=='e')
        if kind=='duplicate_begin':rows.insert(b,copy.deepcopy(rows[b]))
        elif kind=='orphan_end':rows.pop(b)
        elif kind=='unclosed_begin':rows.pop(e)
        elif kind=='id':rows[e]['id']='0x1'
        elif kind=='missing_id':del rows[e]['id']
        elif kind=='run':rows[e]['name']='time::wrong:empty'
        elif kind=='window':rows[e]['name']=rows[e]['name'].replace(':empty',':gc')
        elif kind=='category':rows[e]['cat']='node.console'
        elif kind=='pid':rows[e]['pid']+=1
        elif kind=='tid':rows[e]['tid']+=1
        elif kind=='phase':rows[e]['ph']='E'
        elif kind=='scope':rows[e]['scope']='other'
        elif kind=='id2':rows[e]['id2']={'global':'0x0'}
        elif kind=='duplicate_pair':
            rows.extend([copy.deepcopy(rows[b]),copy.deepcopy(rows[e])])
            rows.sort(key=lambda r:r['ts'])
        path.write_text(json.dumps(trace))
        manifest=json.loads((self.root/'manifest.json').read_text())
        manifest['traceDigest']=hashlib.sha256(path.read_bytes()).hexdigest()
        (self.root/'manifest.json').write_text(json.dumps(manifest))
        with self.assertRaises(AssertionError):verifier.verify(self.root)

for kind in ['duplicate_begin','orphan_end','unclosed_begin','id','missing_id','run','window','category','pid','tid','phase','scope','id2','duplicate_pair']:
    def case(self, kind=kind):self.reject_trace(kind)
    setattr(VerifyTests,'test_reject_'+kind,case)

if __name__=='__main__':unittest.main()
