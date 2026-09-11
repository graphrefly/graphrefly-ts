"""Read frozen files only. No worker imports, measurement, subprocess or network."""
import hashlib
import json
import math
from pathlib import Path
import sys
import tarfile


def digest(data):
    return "sha256:" + hashlib.sha256(data).hexdigest()


def quantile(rows, q):
    return sorted(row["ms"] for row in rows)[math.ceil(len(rows) * q) - 1]


base = Path(sys.argv[1])
receipt = json.loads((base / "receipt.json").read_text())
archive = base / "evidence.tar.gz"
assert digest(archive.read_bytes()) == receipt["rawEvidence"]["digest"]
index_bytes = (base / "artifact-index.json").read_bytes()
assert digest(index_bytes) == receipt["rawEvidence"]["indexDigest"]
index = json.loads(index_bytes)["files"]
with tarfile.open(archive) as tar:
    materials = {}
    for member in tar.getmembers():
        assert member.isfile() and member.name not in materials
        data = tar.extractfile(member).read()
        assert digest(data) == index[member.name]
        materials[member.name] = data
assert set(materials) == set(index)


def raw(name):
    return materials["method-validation/" + name]


def read(name):
    return json.loads(raw(name))


assert raw("worker.mjs") == raw("worker-copy.mjs")
report = read("report.json")
worker_lines = raw("worker.mjs").decode().splitlines()
completion_line = next(i + 1 for i, line in enumerate(worker_lines)
                       if 'put("completion.json", { completed: true, samples: samples.length });' in line)
controls = []
for n in range(4):
    name = f"control-{n}"
    samples = [json.loads(line) for line in raw(name + "/samples.jsonl").splitlines()]
    assert len(samples) == 2400
    metadata = read(name + "/worker.json")
    assert metadata["control"] is True
    old = next(job for job in report["jobs"] if job["id"] == name)
    events = [line for line in raw(name + "/v8.log").decode().splitlines()
              if line.startswith("code-deopt,")]
    batches = []
    for batch in range(3):
        arms = {}
        for arm in ["candidate", "reference"]:
            rows = [s for s in samples if s["arm"] == arm and s["batch"] == batch
                    and s["phase"] == "measured"]
            assert len(rows) == 300
            assert sorted(s["index"] for s in rows) == list(range(100, 400))
            p95 = quantile(rows, .95)
            assert p95 == old["summary"]["arms"][arm]["batches"][batch]["p95Ms"]
            arms[arm] = {
                "p50Us": quantile(rows, .5) * 1000, "p95Us": p95 * 1000,
                "p95SampleIndex": sorted(rows, key=lambda s: s["ms"])[284]["index"],
                "windows100": [{"firstIndex": rows[i]["index"],
                                "p50Us": quantile(rows[i:i + 100], .5) * 1000,
                                "p95Us": quantile(rows[i:i + 100], .95) * 1000}
                               for i in [0, 100, 200]],
            }
        batches.append({"batch": batch, "arms": arms,
                        "pairedBatchP95RatioDescriptiveOnly":
                            arms["candidate"]["p95Us"] / arms["reference"]["p95Us"]})
    medians = {arm: sorted(b["arms"][arm]["p95Us"] / 1000 for b in batches)[1]
               for arm in ["candidate", "reference"]}
    # Conversion to displayed microseconds is not part of the original estimator.
    original_ratio = old["summary"]["ratio"]
    assert abs(medians["candidate"] / medians["reference"] - original_ratio) < 1e-12
    completion_events = [line for line in events if f"worker.mjs:{completion_line}:" in line]
    assert len(completion_events) == 1
    event = completion_events[0]
    at = int(event.split(",")[1]) / 1000
    last_uptime = samples[-1]["end"] + metadata["uptimeOffsetMs"]
    tenuring = [e for e in events if e.endswith("dependent allocation site tenuring changed")]
    controls.append({
        "id": name, "batches": batches, "originalFrozenRatio": original_ratio,
        "allocationSiteDependencyChanges": {
            "copy": sum("/worker-copy.mjs:" in e for e in tenuring),
            "original": sum("/worker.mjs:" in e for e in tenuring),
            "rawEvents": tenuring,
        },
        "clockOrderCheck": {
            "completionSourceLine": completion_line, "completionEvent": event,
            "completionLoggerMs": at, "lastSamplePerformanceMs": samples[-1]["end"],
            "recordedUptimeOffsetMs": metadata["uptimeOffsetMs"],
            "lastSampleMappedUptimeMs": last_uptime,
            "apparentCompletionBeforeLastSampleMs": last_uptime - at,
            "meaning": "Order sanity check under old mapping; NOT a calibrated offset estimate",
        },
    })
result = {
    "kind": "read-only analysis of retained evidence; not a measurement or qualification",
    "sourceArchiveDigest": receipt["rawEvidence"]["digest"],
    "sourceIndexDigest": receipt["rawEvidence"]["indexDigest"],
    "verifiedArchiveFiles": len(materials), "newMeasurementProcesses": 0,
    "controlsRead": 4, "rawControlSamplesRead": 9600,
    "sameBundleBytes": True, "controls": controls,
    "originalDecision": report["decision"],
    "diagnosticOverlapStatus": "uncalibrated; old GC/deopt overlap arrays are not trusted",
    "causeOfLatencyDifference": "not established",
}
print(json.dumps(result, ensure_ascii=False, indent=2))
