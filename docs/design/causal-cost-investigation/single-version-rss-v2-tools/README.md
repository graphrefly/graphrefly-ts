# RSS exit-settlement repair — qualified

Extends the first [RSS observation repair](../single-version-rss-tools/README.md) using retained
`?Es` evidence. [RSS-POLICY.md](RSS-POLICY.md) specifies one0.5s wait for same-PID E/Z zero when exit
is not yet available; terminal observation requires matching confirmed exit. Raw ps and settlement
remain retained. Independent verifier checks eligibility, duration, error/code and final exit consistency.
Positive RSS cap, last-positive-to-exit gap, child/attempt/continuity limits all remain unchanged.
Signal errors remain failures, but no longer skip the bounded cleanup wait.

14RSS cases pass, including exiting settlement success/timeout/error, malformed/live zero, wrong PID,
positive over-limit, and terminal zero/empty. Fake settlement/code/interval corruption is rejected.
Existing14failure paths,23evidence corruptions,4clock cases,70balanced schedules and32fakeprocess/
3840sample pipeline pass. Node fake module import/release test remains green. No real consumer in
preparation. Independent reviewer confirmed the bounded change with no remaining blocker.

196-file preparation archive hash-verified, fresh-extraction fake replay byte-identical:
[archive](../../../../archive/evals/causal-single-version-rss-v2-preparation-v1/artifact-index.json).
177assets frozen at dd577b1d1f033268c923c3097d4450a4d434ddefada85dc90861e707cab0931a.
B/C/input/order/child/sample remain byte-identical to the original single-version preparation.
[Actual capture](../single-version-rss-v2-capture/README.md) is separately bound to the user's continued
repair-and-collection authorization, not inferred from readiness. No library/API/wave changes.
