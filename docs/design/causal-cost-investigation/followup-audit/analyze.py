"""Derive phase shares from the retained report; never execute a consumer."""
import hashlib
import json
import math
from pathlib import Path

ROOT = Path(__file__).resolve().parents[4]
REPORT = "archive/evals/causal-currentness-comparison-v1/report.json"
RECEIPT = "docs/design/causal-cost-investigation/performance-comparison/receipt.json"
raw = (ROOT / REPORT).read_bytes()
digest = "sha256:" + hashlib.sha256(raw).hexdigest()
receipt = json.loads((ROOT / RECEIPT).read_text())
assert digest == receipt["archives"][REPORT], "Retained report binding changed"
report = json.loads(raw)
assert report["passed"] and report["formalAcceptance"] is False
phases = ("construction", "initial", "duplicate", "cleanup")
blocks = []
for block in report["absoluteBlocks"]:
    if block["row"] != "P2-lifecycle" or block["kind"] != "main":
        continue
    metrics = block["metrics"]
    total = metrics["actionSum"]["sum"]
    assert total > 0 and all(math.isfinite(metrics[p]["sum"]) and metrics[p]["sum"] >= 0 for p in phases)
    assert math.isclose(sum(metrics[p]["sum"] for p in phases), total, rel_tol=1e-10, abs_tol=1e-8)
    blocks.append({
        **{key: block[key] for key in ("id", "pair", "rep", "variant", "position", "slot")},
        "shares": {p: metrics[p]["sum"] / total for p in phases},
        "p95Ms": {p: metrics[p]["p95"] for p in phases},
    })
summary = {}
for slot, name in ((0, "before"), (1, "after")):
    selected = [b for b in blocks if b["slot"] == slot]
    assert len(selected) == 16
    assert len({(b["id"], b["position"]) for b in selected}) == 16
    summary[name] = {
        p: {"shareRange": [min(b["shares"][p] for b in selected), max(b["shares"][p] for b in selected)],
            "absoluteP95MsRange": [min(b["p95Ms"][p] for b in selected), max(b["p95Ms"][p] for b in selected)]}
        for p in phases
    }
    values = [b["shares"]["initial"] + b["shares"]["duplicate"] for b in selected]
    summary[name]["initialPlusDuplicateShareRange"] = [min(values), max(values)]
print(json.dumps({"source": REPORT, "sourceSha256": digest, "consumerExecutions": 0,
                  "metric": "phase measured-duration sum / same-block actionSum measured-duration sum; not p95 share",
                  "formalAcceptance": False, "summary": summary, "blocks": blocks}, indent=2))
