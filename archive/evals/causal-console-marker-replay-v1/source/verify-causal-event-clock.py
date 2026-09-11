"""Independent retained-trace verifier: no reporter import, execution or network."""
import hashlib
import json
import sys
from fractions import Fraction as F
from pathlib import Path


def verify(directory, report_path=None):
    root = Path(directory)
    read = lambda name: (root / name).read_bytes()
    m = json.loads(read('manifest.json'))
    assert m['exitCode'] == 0 and m['timedOut'] is False and m['traceFiles'] == ['trace-1.json']
    tb, eb = read(m['traceFiles'][0]), read('evidence.json')
    assert len(tb) <= 16 * 1024 * 1024
    assert hashlib.sha256(tb).hexdigest() == m['traceDigest']
    assert hashlib.sha256(eb).hexdigest() == m['evidenceDigest']
    e = json.loads(eb)
    ident = e['identity']
    assert ident == m['identity']
    assert ident['node'] == 'v24.18.0' and ident['v8'] == '13.6.233.17-node.50'
    assert hashlib.sha256(read('fixture.mjs')).hexdigest() == ident['sourceDigest']
    assert e['units'] == 'performance-ms/hrtime-ns/trace-us'
    anchors, windows = e['anchors'], e['windows']
    assert len(anchors) == 3 and [w['name'] for w in windows] == ['empty','gc','deopt']
    floor = lambda x: x.numerator // x.denominator
    ceil = lambda x: -floor(-x)
    ms = lambda x: F(str(x)) * 1000
    lows, highs = [], []
    for i, a in enumerate(anchors):
        h = F(int(a['h']),1000)
        assert a['p0'] <= a['p1']
        if i: assert a['p0'] > anchors[i-1]['p1'] and int(a['h']) > int(anchors[i-1]['h'])
        lows.append(floor(h)-ceil(ms(a['p1'])))
        highs.append(ceil(h)-floor(ms(a['p0'])))
    dl, du = max(lows), min(highs)
    assert dl <= du
    for i, w in enumerate(windows):
        assert anchors[0]['p1'] < w['start'] <= w['end'] < anchors[2]['p0']
        assert all(a['p1'] < w['start'] or a['p0'] > w['end'] for a in anchors)
        if i: assert windows[i-1]['end'] < w['start']
    raw = json.loads(tb)['traceEvents']
    tids = {r['tid'] for r in raw if r['ph']=='M' and r['pid']==ident['pid'] and r['name']=='thread_name' and r.get('args',{}).get('name')=='JavaScriptMainThread'}
    assert len(tids)==1
    tid = tids.pop()
    stack, spans, seen, last = [], [], set(), -1
    supported = {'MinorGC','MajorGC','V8.DeoptimizeCode'}
    marker_names = {'time::'+ident['run']+':'+w['name'] for w in windows}
    opened, markers = {}, []
    for i,r in enumerate(raw):
        if r['ph']=='M': continue
        if 'node.console' in r.get('cat','').split(',') or r.get('name','').startswith('time::'):
            assert r['pid']==ident['pid'] and r['tid']==tid, 'console process/thread'
            assert r['name'] in marker_names and r['cat']=='node,node.console', 'console name/category'
            marker_id=r.get('id')
            assert isinstance(marker_id,str) and marker_id.startswith('0x') and len(marker_id)>2
            assert all(c in '0123456789abcdef' for c in marker_id[2:])
            assert 'id2' not in r and 'scope' not in r
            assert r['ph'] in ['b','e'] and r['ts']>=last, 'console phase/time'
            last=r['ts']
            coordinate=(r['pid'],r['tid'],r['cat'],r['name'],marker_id)
            if r['ph']=='b':
                assert coordinate not in opened, 'duplicate console begin'
                opened[coordinate]=(i,r)
            else:
                assert coordinate in opened, 'orphan console end'
                j,b=opened.pop(coordinate)
                markers.append((b['name'],b['cat'],b['ts'],r['ts'],[j,i],marker_id))
            continue
        if r['pid']!=ident['pid']:
            assert r['name'] not in supported
            continue
        if r['tid']!=tid: continue
        assert r['ts']>=last
        last=r['ts']
        if r['ph'] not in ['B','E','X']:
            assert r['name'] not in supported
            continue
        key=json.dumps(r,sort_keys=True)
        assert key not in seen
        seen.add(key)
        if r['ph']=='B': stack.append((i,r))
        elif r['ph']=='E':
            j,b=stack.pop()
            assert (not r.get('name') or r['name']==b['name']) and r['cat']==b['cat']
            spans.append((b['name'],b['cat'],b['ts'],r['ts'],[j,i]))
        else:
            assert r['dur']>=0
            spans.append((r['name'],r['cat'],r['ts'],r['ts']+r['dur'],[i]))
    assert not stack and not opened
    events=[s for s in spans if s[0] in supported and 'v8' in s[1].split(',')]
    output=[]
    enclosure_low, enclosure_high = dl, du
    for w in windows:
        matched=[s for s in markers if s[0]=='time::'+ident['run']+':'+w['name']]
        assert len(matched)==1
        assert int(w['begin'][1]) <= int(w['finish'][0])
        for anchor in anchors:
            if anchor['p1'] < w['start']: assert int(anchor['h']) < int(w['begin'][0])
            if anchor['p0'] > w['end']: assert int(anchor['h']) > int(w['finish'][1])
        enclosure_low=max(enclosure_low,matched[0][3]-1-ceil(ms(w['end'])))
        enclosure_high=min(enclosure_high,matched[0][2]+1-floor(ms(w['start'])))
        assert enclosure_low <= enclosure_high
        for ts,bracket in zip(matched[0][2:4],[w['begin'],w['finish']]):
            lo,hi=map(int,bracket)
            assert lo<=hi and floor(F(lo,1000))-1<=ts<=ceil(F(hi,1000))+1
        row=[]
        for name,_,a,b,refs in events:
            if a < floor(F(int(anchors[0]['h']),1000)) or b > ceil(F(int(anchors[2]['h']),1000)):
                row.append({'name':name,'refs':refs,'status':'unknown','reason':'outside calibration coverage','start':None,'end':None})
                continue
            starts=[a-1-du,a+1-dl];ends=[b-1-du,b+1-dl]
            ss,se=ms(w['start']),ms(w['end'])
            if ends[1]<floor(ss) or starts[0]>ceil(se): status='disjoint'
            elif a<b and w['start']<w['end'] and starts[1]<floor(se) and ends[0]>ceil(ss): status='overlap'
            else: status='possible'
            row.append({'name':name,'refs':refs,'status':status,'start':starts,'end':ends})
        output.append({'name':w['name'],'events':row})
    assert any(r['status']=='overlap' and r['name'] in ['MinorGC','MajorGC'] for r in output[1]['events'])
    assert any(r['status']=='overlap' and r['name']=='V8.DeoptimizeCode' for r in output[2]['events'])
    assert any(r['status']=='disjoint' for r in output[0]['events'])
    report=json.loads(Path(report_path).read_bytes() if report_path else read('correlation.json'))
    expected_markers=[{'name':name,'cat':cat,'pid':ident['pid'],'tid':tid,'id':marker_id,'start':a,'end':b,'refs':refs} for name,cat,a,b,refs,marker_id in markers]
    assert report['markers']==expected_markers
    assert report['status']=='calibrated' and report['deltaUs']==[dl,du] and report['samples']==output
    return {'qualified':True,'meaning':'clock/recorded-event path only; no consumer performance or cause proof','deltaUs':[dl,du],'events':len(events),'windows':len(output),'markers':len(markers)}

if __name__=='__main__':
    try: print(json.dumps(verify(sys.argv[1],sys.argv[2] if len(sys.argv)>2 else None),indent=2))
    except Exception as error:
        print(json.dumps({'qualified':False,'error':str(error),'type':type(error).__name__}))
        sys.exit(1)
