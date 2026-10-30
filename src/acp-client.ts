import { spawn } from 'node:child_process';
import { Readable, Writable } from 'node:stream';
import { client, ndJsonStream, type ClientConnection, type RequestPermissionRequest, type RequestPermissionResponse, type SessionNotification } from '@agentclientprotocol/sdk';
import type { SessionOptions } from './driver.js';
import { managedProcess } from './processes.js';

export interface AcpCommand { file: string; args: string[] }

function protocolStdout(input: ReadableStream<Uint8Array>, log: (text: string) => void) {
  let mode: 'prefix' | 'json' | 'log' = 'prefix';
  let pending: Uint8Array[] = [];
  let decoder = new TextDecoder();
  return input.pipeThrough(new TransformStream<Uint8Array, Uint8Array>({
    transform(chunk, controller) {
      let start = 0;
      while (start < chunk.length) {
        const newline = chunk.indexOf(10, start);
        const end = newline < 0 ? chunk.length : newline + 1;
        const part = chunk.subarray(start, end);
        if (mode === 'json') controller.enqueue(part);
        else {
          pending.push(part);
          if (mode === 'prefix') {
            const text = decoder.decode(part, { stream: true }).trimStart();
            if (text) mode = text.startsWith('{') ? 'json' : 'log';
            if (mode === 'json') {
              // Preserve bytes (including split UTF-8) and stream JSON as soon
              // as its first non-whitespace character is known.
              for (const bytes of pending) controller.enqueue(bytes);
              pending = [];
            }
          }
        }
        if (newline >= 0) {
          if (mode !== 'json') log(Buffer.concat(pending).toString('utf8'));
          mode = 'prefix';
          pending = [];
          decoder = new TextDecoder();
        }
        start = end;
      }
    },
    flush() {
      if (pending.length) log(Buffer.concat(pending).toString('utf8'));
    },
  }));
}

// Official SDK stable v1 over CLI stdio. The command is the replaceable boundary.
export class AcpClient {
  readonly connection: ClientConnection;
  private child;
  private exited: Promise<void>;
  private closing?: Promise<void>;

  constructor(command: AcpCommand, options: Pick<SessionOptions, 'cwd' | 'onProcess'>, env: Record<string, string>, handlers: {
    notifications?: string[];
    update(notification: SessionNotification): void;
    permission(request: RequestPermissionRequest): RequestPermissionResponse;
    output(message: { method: string; params?: unknown }): void;
  }) {
    this.child = spawn(command.file, command.args, { cwd: options.cwd, env, detached: true, stdio: ['pipe', 'pipe', 'pipe'] });
    this.exited = new Promise(resolve => this.child.once('close', () => resolve()));
    const app = client({ name: 'helm' })
      .onNotification('session/update', ({ params }) => handlers.update(params))
      .onNotification('*', ({ method, params }) => handlers.output({ method, params }))
      .onRequest('session/request_permission', ({ params }) => handlers.permission(params));
    // Do not expose client filesystem or terminal handlers: all writes must go
    // through the agent's own sandbox, never through unsandboxed helmd.
    // @types/node 22 and lib.dom describe the same Web Streams differently.
    const input = protocolStdout(Readable.toWeb(this.child.stdout) as ReadableStream<Uint8Array>,
      text => handlers.output({ method: 'agent/stdout-log', params: { text } }));
    const writer = Writable.toWeb(this.child.stdin).getWriter();
    const stream = ndJsonStream(new WritableStream<Uint8Array>({
      write(chunk) {
        // The SDK normally answers malformed JSON and keeps reading. A broken
        // agent protocol must instead fail this dispatch, rather than hang it.
        const message = JSON.parse(new TextDecoder().decode(chunk));
        if (message.id === null && message.error) throw new Error(`ACP protocol error: ${message.error.message}`);
        return writer.write(chunk);
      },
    }), input);
    this.connection = app.connect({ ...stream, readable: stream.readable.pipeThrough(new TransformStream({
      transform(message, controller) {
        // SDK fallback handlers are asynchronous. Consume known extensions in
        // wire order so an adjacent prompt response cannot overtake them.
        if ('method' in message && !('id' in message) && handlers.notifications?.includes(message.method)) {
          handlers.output({ method: message.method, params: message.params });
        } else controller.enqueue(message);
      },
    })) });
    this.child.on('error', error => this.connection.close(error));
    this.child.stdin.on('error', error => this.connection.close(error));
    this.child.on('close', (code, signal) => this.connection.close(new Error(`ACP agent exited (${signal ?? code})`)));
    this.child.stderr.on('data', chunk => handlers.output({ method: 'agent/stderr', params: { text: String(chunk) } }));
    if (this.child.pid) {
      try { options.onProcess?.(managedProcess(this.child.pid)); }
      catch (error) { void this.close(); throw error; }
    }
  }

  close(): Promise<void> {
    if (this.closing) return this.closing;
    this.connection.close();
    this.child.stdin.destroy();
    this.child.kill('SIGTERM');
    const timer = setTimeout(() => this.child.kill('SIGKILL'), 1000);
    this.closing = this.exited.finally(() => clearTimeout(timer));
    return this.closing;
  }
}
