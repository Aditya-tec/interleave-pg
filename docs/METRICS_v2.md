# Metrics: changes since METRICS.md (Phase 4)

`docs/METRICS.md` was written before the first measurement and is not edited. These are the changes made since, none of which alters a definition of hit, mismatch, miss, false positive, confirmation or the gates.

* **Small sets print counts.** For a set with fewer than 20 scenarios the table shows counts ("3 of 3 in-scope buggy hit", "0 of 2 in-scope safe flagged") and states that the sample is small; percentages are printed only from 20 scenarios up. The numbers published earlier for `heldout-human` (n = 5) are the counts.
* **Observed preemption counts are recorded.** Each row stores the preemption count of the first schedule that showed the expected finding next to the author's derived minimum (`minPreemptions`). It is reported, not a gate.
* **Honest-limit scenarios** (`scope: out`) are judged by `message`, `notice`, `warning` and `stoppedBy` (`judgeLimit`, introduced in Phase 3b); `message` may also match the printed report text when the run ends without an error.
* **Oracle status.** From Phase 4 each report carries `oracle: ok | unreliable | off`. A scenario whose oracle is unreliable still counts for recall and false positives, but its ANOMALY findings no longer exist, so a hit there must come from an invariant.
