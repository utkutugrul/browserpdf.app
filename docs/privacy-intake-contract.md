# Privacy chosen-file intake

This is the accepted narrow annotation continuation dependency. Rich Privacy
page actions, cleanup
adoption and the broader Phase 4 continuity plan remain separate.

The retryable optional `privacy-scan-intake.js` module exports
`createPrivacyIntake()`. Its returned
`stage(file, { signal, isCurrent, expectedOwner })` resolves
`{ name, size, bytes, owner }` only after its own guarded synchronous canonical
`begin`. `expectedOwner` is the exact prior task/revision/generation. No caller
may rebase it across an unrelated change. Cancellation/staleness throws
`AbortError`; a validation failure leaves the previous task and selected
report untouched.

Admission has one active drained File read/parser job and one latest pending
File descriptor. Replacing or aborting a pending job allocates no bytes. A
noncancelable `arrayBuffer()` or parser cleanup drains before the latest job
can start. The initial IndexedDB descriptor read is outside this lane, so an
old held handoff read cannot block newer native intake. The entry captures its
local intent before that read and checks it before importing/reading the File.
An empty or unrelated URL requests no optional intake/handoff/session module.
An owned pending descriptor has a visible restoring status and reachable native
Clear while the native file input remains enabled. Clear and successful native
replacement remove the old workflow/file URL; rejected replacements retain the
last good URL. These rules apply before any late descriptor File read.

Candidate type, declared and actual 250,000,000-byte size, PDF magic and
positive PDF.js page count validate before canonical replacement. Reusing
`withPdfDocument` preserves scanner task/document destruction on success,
failure and abort. Only an actual `PasswordException` admits a locked PDF and
sets `encrypted: true`; other unknown capabilities remain unknown. Inherited
known capabilities, boundary, original, history, scene and resources pass to
the session's existing joint-limit validation. Chosen current bytes are used
directly; `getWorkspaceInput` and scene baking are not part of this intake.

The UI retains the old selection, report and cleaned output until a candidate
successfully validates and begins. Scan, cleanup and download check the exact
accepted owner. Their finally recovery uses the local operation identity so a
same-task canonical change cannot strand busy controls. Clear invalidates the
local intake and clears a canonical task only while the selection still owns
that exact task/revision/generation. WebMCP keeps metadata-only summaries.

Before edits, the Privacy entry was 10,946 bytes and its static entry graph
93,124 bytes (`/tmp/browserpdf-privacy-intake-pre-edit-static.json`). The
existing verified full idle graph was about 94,752 bytes. The stable entry is
13,384 bytes, an increase of 2,438; the static entry graph is 95,562 bytes and
the prediction from that verified full graph is 97,190. The optional helper is
4,022 bytes and is excluded from the empty-route graph. These are static
historical accounting figures, not a browser measurement; details/hashes remain at
`/tmp/browserpdf-privacy-intake-stable-static-20261019.json`. At that point, the
existing Phase 9 initial graph/request test still had to prove `<100000`
first-party JS bytes and `<=16` idle requests without threshold changes. The
actual acceptance and corrected accounting are recorded below.

The original affected gate discovered 17 tests: seven new portable intake cases
(chosen SHA/inherited facts plus malformed/inherited rejection, held initial
READ versus native B and Clear, actual encrypted fixture, latest pending read
admission/Clear, optional-module retry, and exact scan/cleanup publication);
seven retained Phase 5 lifecycle/encryption/cleanup/WebMCP cases; the existing
Phase 9 idle graph; and both migrated annotation smoke flows. The existing
delayed-runtime cancellation case now holds a real scanner metadata await,
because intake intentionally validates PDF.js before enabling Scan. Its native
handler Promise settles before the cancellation assertions. No new browser
result was claimed at that proposal.

The independent first gate returned **15 pass / 2 fail**, zero skipped/flaky or
top-level errors, in **29,110.533 ms** at
`/tmp/browserpdf-privacy-dependency-first17-20261019.json`. All seven new intake
cases and both annotation smokes passed. Its actual Privacy idle graph was
**102,025 bytes**, invalidating the earlier prediction. The current pre-entry
delta graph was 99,587 bytes; the historical 94,752-byte reference was no longer
the current complete graph. The exact browser graph included global theme,
PWA and consent scripts plus the eagerly imported 4,063-byte cleanup core and
its 899-byte metadata dependency. No budget threshold changed.

Cleanup now has a retryable optional import requested only by a native owned
cleanup operation. Runtime/module completion checks the same exact owner
before cleaning; cancellation and finally recovery retain their previous
contract. The resulting complete static idle graph totals **97,304 bytes**,
4,721 fewer than the failed actual graph. This was a static prediction before
the focused browser verification below.

The other first-gate failure was the migrated metadata hold: it delayed the
native `getMetadata` call itself until after Clear had started destroying that
PDF task. The corrected test starts and completes the actual native metadata
request first, records that completion, and holds its result. It still requires
the real native click-handler Promise to settle after release, with every stale
output/error/tool-registration assertion retained. A new native cleanup-import
rejection/retry case must download and reopen the actually verified clean PDF.
The focused proposal discovered five tests: those two failed cases, existing
explicit cleanup, exact same-task cleanup ownership, and the new retry case.

The focused five passed **5/5**, zero skipped/flaky or top-level errors, in
**7,599.822 ms** at
`/tmp/browserpdf-privacy-dependency-corrections-first5-20261019.json`. Together
with the retained first-gate passes, all **18 unique tests** have aggregate
passing evidence; this is not one clean 17-test invocation. The native idle
budget passed without threshold changes. Its exact successful byte/request
measurement was not attached to that gate's JSON, so the 97,304-byte static
prediction is not presented as its browser result. The later accepted shared
display-name idle gate observed **12 Privacy script requests** whose unchanged
local source lengths total **97,413 bytes**. These are browser-observed paths
and counts plus local file lengths, not captured response-body or wire bytes;
the source/trace comparison is retained at
`/tmp/browserpdf-root-display-name-idle-trace-review.json`.

Independent Root native B and Clear cases also passed at
`/tmp/browserpdf-root-privacy-initial-B-first/report.json` and
`/tmp/browserpdf-root-privacy-initial-Clear-first/report.json`. Both held an
actually completed initial handoff READ, allowed the newer native action, then
released the old consumer and awaited its real handler Promise. The old A File
was never read. B retained its exact chosen bytes, task and report; Clear left
null current/original/task state and removed the workflow URL before a fresh B
intake. Each case then scanned and cleaned an actual two-page B PDF, downloaded
it once and independently reopened it: both B page texts survived, old A text
was absent, and title/author metadata was removed. Both reports record complete
execution, zero page errors and zero non-GET requests. This closes the narrow
annotation dependency; the broader Phase 4 Privacy work remains open.
