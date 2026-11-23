# Add or change a task type

The task type catalog in [lib/task-types.mjs](../lib/task-types.mjs) describes fields, states
and transitions. The store uses it to validate edits and actions, persist task data and
record history. The browser and the [REST API](rest-api.md) use the same catalog and
server-computed permissions to display fields and action controls.

Add an entry under `TASK_TYPES`. For example, this type starts in `awaiting_delivery`.
Its assignee records a note when the package is delivered and the task becomes read-only.

```js
delivery: {
  label: 'Package delivery',
  initialStatus: 'awaiting_delivery',
  fields: {
    tracking: { label: 'Tracking code', maxLength: 30, required: true }
  },
  statuses: {
    awaiting_delivery: { label: 'Ready to deliver' },
    delivered: { label: 'Delivered', terminal: true }
  },
  actions: {
    deliver: {
      label: 'Record delivery',
      eventLabel: 'recorded the delivery',
      from: ['awaiting_delivery'],
      to: 'delivered',
      role: 'assignee',
      noteRequired: true
    }
  }
}
```

Use a stable type ID, state IDs and action IDs of up to 30 characters. IDs start with a
lowercase English letter and can contain lowercase letters, digits and underscores. Reuse a
state ID across types only if the state has the same meaning, since the browser's status
filter groups work by that ID. Use Persian labels for the Persian workspace. The browser
shows a type picker once more than one type is registered.

All types share the core task fields and can add required or optional text fields.
`maxLength` is required. A transition's role is `assignee` or `reviewer`, based on the
people assigned to that task. `from` lists the source states, `to` names the destination,
and `noteRequired` requires a written note. Any additional task roles or field formats
need changes to the shared server model and the client forms.

A state marked `review` appears in the reviewer's queue and freezes edits. Only the
reviewer can move a task out of it. Moving into review requires an active reviewer.
`terminal` freezes edits and ends the workflow. A state marked `locked` freezes edits
while leaving its transitions available. `revision` adds the task to the assignee's
corrections queue.

## Change the standard workflow

The `standard` entry contains the existing work, review and correction cycle. Change
its transition rules there. The browser uses the server's allowed action list for the
detail controls and provides shortcuts and feedback for the standard workflow.

Existing tasks keep their type and current status when you deploy a definition change.
Retain IDs used by stored tasks and clients. If you need to retire a stored type or
state, migrate the current rows or add a new type and keep the previous definition.
Verify required field changes against existing tasks before rollout. Old event snapshots
keep their saved values and notes. Changing a display label changes how old entries are
rendered, so keep the same meaning for an action ID over time.

The first startup with this feature upgrades a version 1 database in one transaction.
Existing tasks become `standard` and keep their IDs, state, version and history.
Back up the database before updating an installation. To return to the older server,
restore its pre-upgrade backup. The older server uses the version 1 task schema.
