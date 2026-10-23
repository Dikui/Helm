import type { DriverRegistry, TemplateAvailability } from './driver.js';
import type { TaskStore } from './store.js';

const runtime = { type: 'runtime', id: 'helmd' } as const;

export function monitorTemplateAvailability(store: TaskStore, drivers: DriverRegistry) {
  store.templates.monitor(template => drivers[template.driver]!.checkAvailability(template), (id, result) => {
    // Persist transitions in the event log so restart does not repeat an unchanged notice.
    const previous = store.db.prepare(`SELECT details FROM events WHERE object_type = 'agent-template' AND object_id = ?
      AND action = 'template-availability-changed' ORDER BY id DESC LIMIT 1`).get(id);
    const last = previous ? JSON.parse(String(previous.details)) as TemplateAvailability : { available: true };
    if (last.available === result.available && last.reason === result.reason && last.command === result.command) return;
    store.transaction(() => {
      const details = { templateId: id, ...result };
      store.appendEvent(runtime, { type: 'agent-template', id }, 'template-availability-changed', details);
      if (!result.available && (last.available || last.reason !== result.reason)) store.appendEvent(runtime, { type: 'agent-template', id }, 'needs-user-attention',
        { kind: 'template-unavailable', ...details });
    });
  });
}

export async function pendingTemplates(store: TaskStore) {
  return (await store.templates.refresh()).filter(template => !template.available)
    .map(template => ({ type: 'agent-template', kind: 'template-unavailable', templateId: template.id,
      reason: template.reason, command: 'command' in template ? template.command : undefined }));
}
