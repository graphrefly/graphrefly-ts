"""Synthetic checks only. No inspector or consumer process."""
import importlib.util
import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

HERE = Path(__file__).resolve().parent

def load(name):
    spec = importlib.util.spec_from_file_location(name, HERE/name)
    m = importlib.util.module_from_spec(spec); spec.loader.exec_module(m)
    return m

v = load('verify-causal-anchor-clock.py')

def fixture():
    profile = dict(startTime=1000000, endTime=1000300,
                   nodes=[dict(id=i+1, callFrame=dict(functionName=n)) for i,n in enumerate(v.NAMES)],
                   samples=[1,2], timeDeltas=[40,110])
    probe = dict(kind='CPU', bounds=dict(startBefore=9.99,startAfter=10,stopBefore=10.29,stopAfter=10.31),
                 anchors=[dict(before=10.001,after=10.002,h='1010001500',pid=12),dict(before=10.201,after=10.202,h='1010201500',pid=12)],
                 windows=[dict(name=v.NAMES[0],start=10.02,end=10.095),dict(name=v.NAMES[1],start=10.1,end=10.199)])
    platform = dict(timebase=dict(numer=125,denom=3))
    native = dict(before=dict(absoluteBefore=23976000,absoluteAfter=23976002,continuous=24216001),
                  after=dict(absoluteBefore=24024000,absoluteAfter=24024002,continuous=24264001))
    return profile,probe,platform,native,dict(pid=12)

class AnchorTests(unittest.TestCase):
    def test_correct_and_wrong_mapping(self):
        args=fixture(); r=v.verify(*args)
        self.assertTrue(r['qualified']); self.assertLess(r['widthMs'],.05)
        args[0]['samples']=[2,1]
        r=v.verify(*args); self.assertTrue(r['alignmentQualified']);self.assertFalse(r['mappingQualified'])
        self.assertEqual(r['failure'],'known-function-mapping')

    def test_sleep_and_parent_scheduling(self):
        for field,delta in [('continuous',2400),('absoluteBefore',-2400)]:
            args=fixture();args[3]['after'][field]+=delta
            r=v.verify(*args);self.assertFalse(r['qualified']);self.assertGreater(r['widthMs'],.1)

    def test_reject_corruption(self):
        changes=[lambda a:a[1]['anchors'][0].update(pid=13),
                 lambda a:a[1]['anchors'][0].update(h=1010001500),
                 lambda a:a[1]['anchors'][0].update(h='01010001500'),
                 lambda a:a[1]['anchors'][0].update(h='1010001'),
                 lambda a:a[1]['anchors'][0].update(h=str(2**64)),
                 lambda a:a[1]['anchors'][0].update(after=0),
                 lambda a:a[1]['anchors'][1].update(h='1010301500'),
                 lambda a:a[1].update(anchors=a[1]['anchors'][:1]),
                 lambda a:a[0].update(startTime=1000000.0),
                 lambda a:a[0].update(timeDeltas=[-1,110]),
                 lambda a:a[0].update(samples=[1,3]),
                 lambda a:a[1]['windows'][0].update(name='wrong'),
                 lambda a:a[3]['after'].update(absoluteBefore=1),
                 lambda a:a[1]['anchors'][0].update(before=float('nan'))]
        for change in changes:
            args=fixture();change(args)
            with self.assertRaises(ValueError):v.verify(*args)

    def test_gc_functionality(self):
        _,p,platform,native,meta=fixture();p['kind']='GC'
        p['events']=[dict(startTime=w['start'],duration=.001,receivedAt=11) for w in p['windows']]
        self.assertTrue(v.verify_gc(p,meta,platform,native)['qualified'])
        for a in p['anchors']:a['h']=str(int(a['h'])+1000000000)
        with self.assertRaises(ValueError):v.verify_gc(p,meta,platform,native)
        for a in p['anchors']:a['h']=str(int(a['h'])-1000000000)
        p['events'].pop()
        with self.assertRaises(ValueError):v.verify_gc(p,meta,platform,native)

    def test_single_use_and_stop_no_process(self):
        launcher=load('run-causal-anchor-probes.py');calls=[]
        def fake(argv,folder,*unused):
            calls.append(argv)
            for name,value in [('probe.json',dict(anchors=[dict(pid=12)])),('profile.json',{}),('process.json',dict(pid=12,node='v24.18.0',platform='darwin',arch='arm64'))]:launcher.put(folder/name,value)
            return dict(reason=None,pid=12)
        with tempfile.TemporaryDirectory() as d:
            root=Path(d);plan=root/'plan.json';output=root/'output'
            launcher.put(plan,dict(files={},node=__file__,nodeSha256=launcher.sha(Path(__file__)),jobs=['CPU','CPU','CPU','GC'],consumerExecutions=0,explicitEnvironment={},platform=dict(timebase=dict(numer=125,denom=3))))
            with patch.object(launcher.supervisor,'supervise',fake),patch.object(launcher.verifier,'verify',return_value=dict(qualified=False,failure='clock-interval-width')):
                launcher.run(plan,output)
                with self.assertRaises(FileExistsError):launcher.run(plan,root/'retry')
            result=json.loads((output/'result.json').read_text())
            self.assertEqual(len(calls),1);self.assertEqual(len(result['notRun']),3)
            self.assertFalse(result['probesQualified'])
        for args,reason in [((41,0,0,0,0),'preparation-deadline'),((0,11,0,0,0),'probe-deadline'),((0,0,2,0,0),'observation-gap'),((0,0,0,257*1024**2,0),'observed-rss')]:
            self.assertEqual(launcher.violation(*args),reason)

if __name__ == '__main__':unittest.main()
