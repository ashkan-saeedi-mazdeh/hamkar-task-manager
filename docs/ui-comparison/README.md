# Hamkar before and after

Open [the comparison viewer](index.html) in a browser or use the original PNGs in `before/`
and `after/` as source material for a video. The filenames and framing match across both folders.

The before images use the app at Git revision `dd61b6d`. The after images use the updated app.
Both use the current `tests/preview.mjs --comparison` fixture with the same four synthetic accounts,
five tasks, workflow events and deterministic timestamps. The browser clock is fixed at 08:30 UTC
on 2026-11-13 with the Asia/Tehran timezone and reduced motion enabled. The Chromium screenshots
are at 1x scale and show the initial viewport, with no scrolling added. The fixture runs on
127.0.0.1:4311, uses a temporary database and never reads the app's regular data. Password fields
are empty in the login image; generated credentials and session state are not saved with the images.

| Frame | Dimensions | Account and view |
| --- | --- | --- |
| `01-desktop-login` | 1440 x 960 | Signed out, blank sign-in form |
| `02-desktop-dashboard` | 1440 x 960 | Assignee dashboard |
| `03-desktop-my-tasks` | 1440 x 960 | Assignee task list |
| `04-desktop-task-feedback` | 1440 x 960 | Task returned for revision |
| `05-desktop-submit-result` | 1440 x 960 | Revised result form, with a sample note |
| `06-desktop-new-task` | 1440 x 960 | New task form, with the same unsaved fields |
| `07-desktop-review-queue` | 1440 x 960 | Reviewer's queue |
| `08-desktop-review-detail` | 1440 x 960 | Reviewer opening the submitted task |
| `09-desktop-team` | 1440 x 960 | Administrator viewing team accounts |
| `10-phone-dashboard` | 390 x 844 | Assignee dashboard |
| `11-phone-my-tasks` | 390 x 844 | Assignee task list |
| `12-phone-task-feedback` | 390 x 844 | Task returned for revision |

To recapture, install the browser test dependencies from the app folder and make sure port 4311
is free. For the baseline, extract the app from `dd61b6d` into a temporary directory and copy
the current `tests/preview.mjs` over the baseline copy. Run these commands from the current
app folder, replacing the second argument with the baseline app directory:

```powershell
npm ci
npx playwright install chromium --only-shell
node scripts/capture-ui-comparison.mjs before C:/path/to/baseline/TaskManager
node scripts/capture-ui-comparison.mjs after
```

Baseline text uses the operating system's installed fonts. Use the same Windows environment
and Chromium version for a close recreation. The updated app ships its Persian font locally.
