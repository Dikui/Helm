import { useState } from 'react';
export function useSettingsSave() {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<Error>();
  const [saved, setSaved] = useState(false);
  async function run(task: () => Promise<void>) {
    if (pending) return;
    setPending(true); setError(undefined); setSaved(false);
    try { await task(); setSaved(true); }
    catch (failure) { setError(failure as Error); }
    finally { setPending(false); }
  }
  return { pending, error, saved, run, clear: () => { setSaved(false); setError(undefined); } };
}
