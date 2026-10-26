import { useRef, useState } from 'react';
import { OperationError } from '../../shared/api.js';
import { useData } from '../../shared/data.js';
import type { Work } from '../../shared/types.js';
import type { AttachmentUpload } from '../../shared/attachments.js';

type MessageInput = { body: string; attachments?: AttachmentUpload[] } & ({ projectId: string; coordinatorAgentId: string } | { workId: string; cardId?: string; gateId?: string });
export function useSendMessage() {
  const { api } = useData();
  const attempt = useRef<{ params: MessageInput; key: string } | undefined>(undefined);
  const busy = useRef(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<Error>();
  const uncertain = Boolean(error && !(error instanceof OperationError));
  const send = async (input: MessageInput) => {
    if (busy.current) return;
    // A lost response may already have created the work/message. Freeze its entire request.
    if (!attempt.current || (!uncertain && JSON.stringify(input) !== JSON.stringify(attempt.current.params))) {
      attempt.current = { params: input, key: crypto.randomUUID() };
    }
    busy.current = true; setPending(true); setError(undefined);
    try {
      const result = await api.call<{ work: Work }>('send-message', { ...attempt.current.params, key: attempt.current.key });
      attempt.current = undefined;
      return result;
    } catch (error) { setError(error as Error); }
    finally { busy.current = false; setPending(false); }
  };
  return { send, pending, error, uncertain };
}
