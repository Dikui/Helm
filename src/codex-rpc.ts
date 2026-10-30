import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import type { SessionOptions } from './driver.js';
import { managedProcess } from './processes.js';

export interface CodexCommand { file: string; args: string[] }
export interface RpcNotification { method: string; params?: any }

// JSON-RPC over app-server stdio. The command is the replaceable CLI boundary.
export class CodexRpc {
  private child;
  private sequence = 0;
  private pending = new Map<number, { resolve: (value: any) => void; reject: (error: Error) => void }>();
  private queue: RpcNotification[] = [];
  private wake?: () => void;
  private failure?: Error;
  private closed = false;

  constructor(command: CodexCommand, options: Pick<SessionOptions, 'cwd' | 'onProcess'>, env: Record<string, string>) {
    this.child = spawn(command.file, command.args, { cwd: options.cwd, env, detached: true, stdio: ['pipe', 'pipe', 'pipe'] });
    this.child.on('error', error => this.fail(error));
    this.child.stdin.on('error', error => this.fail(error));
    this.child.on('close', (code, signal) => this.fail(new Error(`Codex app-server exited without turn/completed (${signal ?? code})`)));
    this.child.stderr.on('data', chunk => this.push({ method: 'app-server/stderr', params: { text: String(chunk) } }));
    createInterface({ input: this.child.stdout }).on('line', line => {
      try {
        const message = JSON.parse(line);
        if (message.id !== undefined && message.method) {
          // Never grant a server-initiated filesystem or command escalation.
          const response = ['item/commandExecution/requestApproval', 'item/fileChange/requestApproval'].includes(message.method)
            ? { result: { decision: 'decline' } } : { error: { code: -32601, message: 'Helm has no interactive approval handler' } };
          this.write({ id: message.id, ...response });
        } else if (message.id !== undefined) {
          const pending = this.pending.get(message.id);
          if (!pending) return;
          this.pending.delete(message.id);
          if (message.error) pending.reject(new Error(`Codex RPC error: ${JSON.stringify(message.error)}`));
          else pending.resolve(message.result);
        } else if (typeof message.method === 'string') this.push(message);
        else throw new Error('Invalid Codex JSON-RPC message');
      } catch (error) { this.fail(error instanceof Error ? error : new Error(String(error))); }
    });
    if (this.child.pid) {
      try { options.onProcess?.(managedProcess(this.child.pid)); }
      catch (error) { this.close(); throw error; }
    }
  }

  private write(message: object) {
    if (this.failure) throw this.failure;
    if (this.closed) throw new Error('Codex app-server closed');
    this.child.stdin.write(`${JSON.stringify(message)}\n`);
  }

  request(method: string, params: object): Promise<any> {
    const id = ++this.sequence;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      try { this.write({ id, method, params }); }
      catch (error) { this.pending.delete(id); reject(error); }
    });
  }

  notify(method: string, params: object) { this.write({ method, params }); }

  private push(notification: RpcNotification) {
    if (this.closed) return;
    this.queue.push(notification);
    this.wake?.();
  }

  private fail(error: Error) {
    this.failure ??= error;
    for (const pending of this.pending.values()) pending.reject(error);
    this.pending.clear();
    this.wake?.();
  }

  async *notifications(): AsyncGenerator<RpcNotification> {
    for (;;) {
      const notification = this.queue.shift();
      if (notification) { yield notification; continue; }
      if (this.closed) return;
      if (this.failure) throw this.failure;
      await new Promise<void>(resolve => { this.wake = resolve; });
      this.wake = undefined;
    }
  }

  close() {
    if (this.closed) return;
    this.closed = true;
    this.fail(new Error('Codex app-server cancelled'));
    this.child.stdin.destroy();
    this.child.kill('SIGTERM');
  }
}
