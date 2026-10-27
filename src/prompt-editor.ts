import { execFile } from 'node:child_process';
import { lstatSync } from 'node:fs';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { saveAgentSchema, type AgentCatalog } from './agents.js';
import { RuleError } from './store.js';

export interface PromptEditor {
  platform: string;
  launch(command: string, args: string[]): Promise<void>;
}
const systemEditor: PromptEditor = {
  platform: process.platform,
  async launch(command, args) { await promisify(execFile)(command, args, { timeout: 10_000 }); },
};

export async function openAgentPrompt(agents: AgentCatalog, agentId: string, editor = systemEditor) {
  if (!saveAgentSchema.shape.id.safeParse(agentId).success) throw new RuleError('INVALID_PARAMS', 'Agent id 格式无效。', 400);
  const command = editor.platform === 'darwin' ? 'open' : editor.platform === 'linux' ? 'xdg-open' : undefined;
  if (!command) throw new RuleError('EDITOR_UNSUPPORTED_PLATFORM', `此平台不支持打开外部编辑器：${editor.platform}。`, 409);
  const directory = join(agents.directory, agentId);
  const path = join(directory, 'prompt.md');
  try {
    if (!lstatSync(directory).isDirectory() || !lstatSync(path).isFile()) {
      throw new RuleError('INVALID_AGENT_PATH', 'Agent 目录和 prompt.md 必须是实际目录和文件，不能是符号链接。', 400);
    }
  } catch (error) {
    if (error instanceof RuleError) throw error;
    const code = (error as NodeJS.ErrnoException).code;
    throw new RuleError(code === 'ENOENT' ? 'AGENT_PROMPT_NOT_FOUND' : 'AGENT_PROMPT_UNREADABLE', `无法打开 Agent 提示词：${(error as Error).message}`, code === 'ENOENT' ? 404 : 409);
  }
  try { await editor.launch(command, editor.platform === 'darwin' ? ['-t', path] : [path]); }
  catch (error) { throw new RuleError('EDITOR_OPEN_FAILED', `启动编辑器失败：${error instanceof Error ? error.message : String(error)}`, 409); }
  return { agentId, path, opened: true };
}
