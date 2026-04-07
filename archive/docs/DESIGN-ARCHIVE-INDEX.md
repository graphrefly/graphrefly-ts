# Design Decision Archive

This directory preserves detailed design discussions from key sessions. These are not casual notes — they capture the reasoning chains, rejected alternatives, and insights that shaped the architecture.

## Index

The machine-readable index is **`design-archive-index.jsonl`** (one JSON object per session). The markdown session files remain unchanged.

### JSONL schema

**Predecessor entries** (callbag-recharge sessions that informed GraphReFly):

```json
{"id": "predecessor-*", "origin": "callbag-recharge", "date": "YYYY-MM-DD", "title": "...", "commit": "...", "established": "..."}
```

**GraphReFly entries:**

```json
{
  "id": "kebab-case-slug",
  "origin": "graphrefly",
  "date": "YYYY-MM-DD",
  "title": "Short title",
  "file": "SESSION-*.md",
  "topic": "What was discussed",
  "decisions": ["Key decision 1", "..."],
  "roadmap_impact": "Optional — what changed in docs/roadmap.md",
  "related_files": ["Optional — other files produced"],
  "missing_pieces": ["Optional — identified gaps"],
  "research_findings": ["Optional — external research results"],
  "structural_gaps": ["Optional — architectural gaps found"]
}
```

### Querying

```bash
# Search for a topic across all sessions
grep -i "snapshot" archive/docs/design-archive-index.jsonl

# Pretty-print all entries
cat archive/docs/design-archive-index.jsonl | python3 -m json.tool --json-lines

# List all session titles and dates
cat archive/docs/design-archive-index.jsonl | python3 -c "
import sys, json
for line in sys.stdin:
    e = json.loads(line)
    print(f\"{e['date']}  {e['title']}\")
"

# Find sessions that affected the roadmap
grep '"roadmap_impact"' archive/docs/design-archive-index.jsonl | python3 -m json.tool --json-lines
```

## Predecessor: callbag-recharge

GraphReFly is the successor to [callbag-recharge](https://github.com/nicepkg/callbag-recharge) (TS, 170+ modules) and [callbag-recharge-py](https://github.com/nicepkg/callbag-recharge-py) (Python, Phase 0-1). The full design history of callbag-recharge is preserved in those repos under `src/archive/docs/DESIGN-ARCHIVE-INDEX.md`.

Predecessor sessions that directly informed GraphReFly are included in the JSONL file with `"origin": "callbag-recharge"`.

## Reading Guide

**For architecture newcomers:** Start with the spec (`~/src/graphrefly/GRAPHREFLY-SPEC.md`), then read the `graphrefly-spec-design` session.

**For callbag-recharge context:** Read the predecessor archive index in the callbag-recharge repo, focusing on the predecessor entries listed in the JSONL.

## Session File Format

Each `SESSION-*.md` file contains:
- SESSION ID and DATE
- TOPIC
- KEY DISCUSSION (reasoning, code examples, decisions)
- REJECTED ALTERNATIVES (what was considered, why not)
- KEY INSIGHTS (main takeaways)
- FILES CHANGED (implementation side effects)

---

**Created:** March 27, 2026
**Updated:** April 7, 2026
