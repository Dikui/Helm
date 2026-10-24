export interface OperationFailure { code: string; reason: string; allowedOperations: string[] }
export class OperationError extends Error {
  constructor(readonly failure: OperationFailure) { super(failure.reason); }
}
export type Fetch = typeof fetch;
export class ApiClient {
  constructor(readonly baseUrl = '', readonly transport: Fetch = fetch) {}
  async call<T>(name: string, params: object = {}, signal?: AbortSignal): Promise<T> {
    const response = await this.transport(`${this.baseUrl}/api/${encodeURIComponent(name)}`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(params), signal,
    });
    const body = await response.json();
    if (!response.ok || !body.ok) throw new OperationError(body.error ?? {
      code: 'HTTP_ERROR', reason: response.statusText, allowedOperations: [],
    });
    return body.result as T;
  }
}
