import { deliveryDetails } from './delivery.js';
import type { HelmEvent, TaskStore, Work } from './store.js';

export function readWork(store: TaskStore, id: string) {
  const work = store.work(id);
  const message = store.db.prepare(`SELECT body FROM messages WHERE work_id = ? AND sender = 'user' ORDER BY sequence LIMIT 1`).get(id);
  const firstLine = Array.from(String(message?.body ?? '').split(/\r?\n/, 1)[0]!.trim());
  const title = firstLine.length > 80 ? firstLine.slice(0, 79).join('') + '…' : firstLine.join('');
  return { ...work, title, delivery: deliveryDetails(store, id) };
}

const eventLabels: Record<string, string> = {
  'work-created': '开始对齐', 'work-description-drafted': '工作说明草稿已更新',
  'round-started': '调度者正在处理', 'round-ended': '调度轮次结束',
  'round-step': '调度者正在处理',
  'round-agent-loaded': '调度者已就绪', 'coordinator-notes-written': '调度笔记已更新',
  'gate-created': '有待决定的关卡', 'gate-updated': '关卡已更新', 'gate-decided': '关卡已决定', 'gate-withdrawn': '关卡已撤回',
  'card-created': '卡片已创建', 'card-updated': '卡片已更新', 'card-ready': '卡片等待派单',
  'card-completed': '卡片已完成', 'card-cancelled': '卡片已取消', 'card-paused': '卡片已暂停', 'card-resumed': '卡片已恢复',
  'dispatch-created': '派单正在排队', 'dispatch-started': '执行者开始处理', 'dispatch-ended': '派单已结束',
  'dispatch-revoked': '派单已撤销', 'dispatch-timed-out': '派单已超时', 'conclusion-submitted': '执行者已提交结论',
  'work-paused': '工作已暂停', 'work-stalled': '工作没有在推进', 'work-resumed': '工作已恢复', 'work-cancelled': '工作已取消', 'work-completed': '工作已完成',
  'needs-user-attention': '等你处理', 'operation-rejected': '操作被拒绝', 'round-interrupted': '调度轮次已打断',
  'coordinator-agent-changed': '调度者 Agent 已更换', 'dependency-added': '卡片依赖已添加', 'dependency-removed': '卡片依赖已移除',
  'artifact-saved': '成果已保存', 'outputs-exported': '输出已导出', 'outputs-deleted': '输出已删除', 'work-deleted': '工作已删除',
  'context-compacted': '上下文已压缩', 'process-started': 'Agent 已启动', 'browser-started': '浏览器已启动', 'browser-stopped': '浏览器已停止',
};

function eventSummary(event?: HelmEvent) {
  if (!event) return '开始对齐';
  const details = event.details as Record<string, unknown>;
  const text = details.summary ?? details.question ?? (['operation-rejected', 'work-paused', 'work-stalled', 'needs-user-attention'].includes(event.action) ? details.reason : undefined) ?? (event.action === 'message-sent' ? details.body : undefined);
  // Agent/user text stays in its original language; never expose raw JSON or action names.
  return String(text || eventLabels[event.action] || '工作记录已更新').split(/\r?\n/, 1)[0]!.slice(0, 160);
}

function statusSince(store: TaskStore, work: Work) {
  // Derive only the timestamp from transition facts. Current state remains authoritative in works.
  const transitions = store.db.prepare(`SELECT e.time, e.action, e.details, g.kind FROM events e
    LEFT JOIN gates g ON e.object_type = 'gate' AND g.id = e.object_id
    WHERE e.work_id = ? AND e.action IN ('work-created', 'work-paused', 'work-resumed',
      'work-completed', 'work-cancelled', 'gate-created', 'gate-decided', 'acceptance-withdrawn', 'delivery-status-changed', 'base-merge-result', 'base-push-result') ORDER BY e.id`).all(work.id);
  let status = 'aligning';
  let since = work.createdAt;
  let confirmed = false;
  let review = false;
  for (const row of transitions) {
    const details = JSON.parse(String(row.details));
    let next = status;
    if (row.action === 'gate-created' && row.kind === 'review') { review = true; next = 'awaiting-review'; }
    if (row.action === 'gate-decided') {
      if (row.kind === 'work-confirmation') confirmed = true;
      if (row.kind === 'review' && details.decision === 'return') review = false;
      if (status !== 'paused') next = confirmed ? review ? 'awaiting-review' : 'executing' : 'aligning';
    }
    if (row.action === 'gate-decided' && row.kind === 'review' && details.decision === 'accept') next = 'accepted';
    if (row.action === 'acceptance-withdrawn') next = 'awaiting-review';
    if (row.action === 'delivery-status-changed') next = details.status;
    if (row.action === 'base-merge-result') next = ['merged', 'already-contained'].includes(details.status) ? 'merged' : 'accepted';
    if (row.action === 'base-push-result') next = details.status === 'pushed' ? 'completed' : 'merged';
    if (row.action === 'work-paused') next = 'paused';
    if (row.action === 'work-resumed') next = confirmed ? review ? 'awaiting-review' : 'executing' : 'aligning';
    if (row.action === 'work-completed') next = 'completed';
    if (row.action === 'work-cancelled') next = 'cancelled';
    if (next !== status) { status = next; since = String(row.time); }
  }
  return since;
}

export function listWorks(store: TaskStore, projectId?: string) {
  return store.db.prepare(`SELECT id FROM works WHERE (? IS NULL OR project_id = ?) ORDER BY created_at, id`)
    .all(projectId ?? null, projectId ?? null).map(row => {
      const work = readWork(store, String(row.id));
      const ended = ['completed', 'cancelled'].includes(work.status);
      const pendingGates = ended ? [] : store.gates(work.id).filter(gate => gate.status === 'pending')
        .map(({ id, kind, question }) => ({ id, kind, question }));
      const counts = store.db.prepare(`SELECT count(*) AS totalCards,
        COALESCE(SUM(status = 'completed'), 0) AS completedCards FROM cards WHERE work_id = ?`).get(work.id)!;
      const latest = store.db.prepare(`SELECT id FROM events WHERE work_id = ? ORDER BY id DESC LIMIT 1`).get(work.id);
      const event = latest ? store.events({ workId: work.id, after: Number(latest.id) - 1 })[0] : undefined;
      return { ...work, summary: eventSummary(event), statusSince: statusSince(store, work),
        ...counts, hasPendingGate: pendingGates.length > 0, pendingGates };
    });
}
