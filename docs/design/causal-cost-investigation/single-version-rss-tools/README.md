# RSS observer repair — qualified

User authorized repair through complete evidence collection after f967f265. This version preserves
old failed evidence and copies B/C, P2 input, child/sample bodies, and the previously frozen balanced
order byte-for-byte. It changes only private parent RSS observation and independent evidence validation.
[RSS-POLICY.md](RSS-POLICY.md) defines terminal versus memory observations and unchanged limits.

Each ps call retains raw PID/state/RSS, stdout/stderr/exit code, timestamps, and child poll before/after.
Positive memory values always retain the256MiB cap. Zero needs same-PID Z state and confirmed exit;
empty rc1 needs confirmed exit and empty stderr. Other invalid observations still stop. Terminal raw
records remain in evidence, and last-positive-to-exit gaps remain in the maximum polling interval.
Independent verifier reconstructs the positive series and enforces sticky/final exit consistency.

Qualification: actual collector with32fakeprocesses/3840fakesamples;23previous evidence mutations,
14failure paths,4clock cases and70balanced schedules retained. Eleven RSS cases cover normal positive,
terminal zero/empty, active zero, zero with running state, unreaped zombie, wrong PID, negative,
malformed, ps failure and over-limit; exit-code and post-exit evidence corruptions are rejected.
Node fake module still imports once and performs121fakeconstruct/release pairs. Real consumers during
preparation:0. A Node fake-module process is not a library performance run.

Independent reviewer rss_terminal_review found and prompted repair of inconsistent terminal poll
receipts; final read-only review found no remaining blocker. Executable checks and logs are retained.
196-file preparation archive hash-verified and fake pipeline replayed byte-identically in a fresh
extraction. See [archive](../../../../archive/evals/causal-single-version-rss-preparation-v1/artifact-index.json).

177 frozen assets; manifest SHA256
106d8c8186f6df00afded9573c1ed57a7debc4f0b987b85ed2585b0e0d8752e3.
The user's continued collection authorization is bound separately in
[single-version-rss-capture](../single-version-rss-capture/README.md); readiness alone is not dispatch.
No library/API/wave change, no performance threshold relaxation, no old result rewritten.
