# First team test

Start the app and create your own administrator on the initial setup screen. Add two ordinary
accounts from Team, then use separate browser profiles for the assignee and reviewer. An
incognito window can hold one of the accounts; ordinary tabs in the same profile share a session.

1. Create a task with a title, clear expected result and two different people as assignee and reviewer.
2. As the assignee, open My tasks, start the task, then submit a written result.
3. As the reviewer, open My reviews. Return the task with a concrete correction reason.
4. As the assignee, read the feedback, start corrections and submit a new result.
5. As the reviewer, approve the result. Check that the completed task is read-only and all rounds remain in history.
6. Sign in as a fourth, unrelated user. The task must be absent from the list and inaccessible by its direct URL.
7. Open a task in two browser profiles. Change it in one, then act on the old version in the other. The second action must ask you to review the latest data.
8. Restart the server. Confirm that tasks, accounts and history remain.
9. Run through the same steps on a phone using the configured LAN or HTTPS address. Check the menu, cards, forms, long descriptions and on-screen keyboard.
10. Make a backup and restore it into a separate test database before relying on backups for company work.

Please record the step, account role, device and expected/actual result when reporting a problem.
Do not include passwords in screenshots or bug reports.
