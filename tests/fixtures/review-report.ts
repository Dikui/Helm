export function reviewReport(summary = '工作已完成，标准均有验收证据。') {
  return {
    verdict: 'accept' as const, summary, exceptions: [],
    criteria: [{ criterion: '工作说明中的标准', status: 'passed' as const,
      evidence: [{ label: '验收证据', kind: 'file' as const, ref: 'shared.txt' }] }],
    cards: [], suggestions: [],
  };
}
