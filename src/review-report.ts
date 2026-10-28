import { z } from 'zod';

const shortText = (name: string, max = 500) => z.string({ error: `缺少${name}` }).trim()
  .min(1, `缺少${name}`).max(max, `${name}不能超过 ${max} 字`);
const evidenceSchema = z.array(z.object({
  label: shortText('证据名称', 80),
  kind: z.enum(['file', 'artifact', 'dispatch']),
  ref: shortText('证据引用', 1000),
}).strict(), { error: '缺少证据链接' }).min(1, '至少填写一个证据链接');

export const reviewReportSchema = z.object({
  verdict: z.enum(['accept', 'reservations', 'return'], { error: '结论须为 accept（建议接受）、reservations（有保留）或 return（建议退回）' }),
  summary: shortText('结论说明'),
  exceptions: z.array(z.object({
    kind: z.enum(['unmet', 'unverified', 'truncated']),
    what: shortText('例外内容'), why: shortText('例外影响接受的原因'), evidence: evidenceSchema,
  }).strict(), { error: '缺少例外列表；没有例外请填 []' }),
  criteria: z.array(z.object({
    criterion: shortText('标准内容'),
    status: z.enum(['passed', 'unmet', 'unverified', 'not-applicable']),
    evidence: evidenceSchema,
  }).strict(), { error: '缺少标准表' }).min(1, '至少填写一条标准'),
  cards: z.array(z.object({
    cardId: shortText('卡片 id', 100), title: shortText('卡片标题'), result: shortText('卡片结果'),
    verification: z.enum(['passed', 'failed', 'unverified', 'not-applicable']), evidence: evidenceSchema,
    dispatches: z.array(z.object({ agentId: shortText('Agent id', 100), dispatchId: shortText('派单 id', 100) }).strict()),
  }).strict(), { error: '缺少卡片表；没有卡片请填 []' }),
  suggestions: z.array(shortText('建议'), { error: '缺少建议列表；没有建议请填 []' }),
}, { error: '缺少结构化汇总报告 report，请填写结论、例外、标准表、卡片表和建议' }).strict();

export type ReviewReport = z.infer<typeof reviewReportSchema>;
