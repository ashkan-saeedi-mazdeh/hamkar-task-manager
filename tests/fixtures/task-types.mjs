import { TASK_TYPES } from '../../lib/task-types.mjs';

export const testTaskTypes = {
  ...TASK_TYPES,
  delivery: {
    label: 'تحویل بسته',
    initialStatus: 'awaiting_delivery',
    fields: {
      tracking: { label: 'کد رهگیری', maxLength: 30, required: true },
      destination: { label: 'مقصد تحویل', maxLength: 100 }
    },
    statuses: {
      awaiting_delivery: { label: 'آماده تحویل' },
      delivered: { label: 'تحویل داده شد', terminal: true }
    },
    actions: {
      deliver: {
        label: 'ثبت تحویل', eventLabel: 'تحویل را ثبت کرد', from: ['awaiting_delivery'],
        to: 'delivered', role: 'assignee', noteRequired: true
      }
    }
  }
};
