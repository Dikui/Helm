const drivers: Record<string, { name: string; letter: string; color: string }> = {
  'claude-sdk': { name: 'Claude', letter: 'C', color: 'claude' },
  codex: { name: 'Codex', letter: 'X', color: 'codex' },
  grok: { name: 'Grok', letter: 'G', color: 'grok' },
  deepseek: { name: 'DeepSeek', letter: 'D', color: 'deepseek' },
};

export function AgentMark({ driver }: { driver: string | null | undefined }) {
  const mark = driver ? drivers[driver] : undefined;
  return <span className="agent-mark" data-driver={mark?.color} role="img" aria-label={mark?.name ?? driver ?? 'Agent'}>{mark?.letter ?? '?'}</span>;
}
