import { useState, type FormEvent } from 'react';
import { useData, useResource } from '../../shared/data.js';
import { ErrorNotice } from '../../shared/feedback.js';
import { useI18n, type MessageKey } from '../../shared/i18n.js';
import type { RuntimeSettings } from './types.js';
import { SaveFeedback } from './SaveFeedback.js';
import { useSettingsSave } from './useSettingsSave.js';

type NumberField = { name: keyof RuntimeSettings; label: MessageKey; factor: number; min: number; max: number; unit?: MessageKey | 'GB' };
const fields = {
  concurrency: [{ name: 'concurrencyLimit', label: 'concurrencyLimit', factor: 1, min: 1, max: Number.MAX_SAFE_INTEGER }],
  dispatch: [
    { name: 'dispatchWallTimeoutMs', label: 'dispatchWall', factor: 60_000, min: 1, max: 2147483647, unit: 'minutes' },
    { name: 'dispatchIdleTimeoutMs', label: 'dispatchIdle', factor: 60_000, min: 1, max: 2147483647, unit: 'minutes' },
  ],
  round: [
    { name: 'roundTotalTimeoutMs', label: 'roundTotal', factor: 60_000, min: 1, max: 2147483647, unit: 'minutes' },
    { name: 'roundIdleTimeoutMs', label: 'roundIdle', factor: 60_000, min: 1, max: 2147483647, unit: 'minutes' },
  ],
  output: [{ name: 'outputThresholdBytes', label: 'outputThreshold', factor: 1_000_000_000, min: 0, max: Number.MAX_SAFE_INTEGER, unit: 'GB' }],
} satisfies Record<string, NumberField[]>;
export function RuntimeSection() {
  const { t } = useI18n();
  const { data, error, reload } = useResource<RuntimeSettings>('get-settings');
  return <section className="settings-simple" aria-label={t('runtime')}><h2>{t('runtime')}</h2><p className="muted">{t('runtimeHelp')}</p>
    {error && <ErrorNotice error={error} retry={reload} />}{!data && !error && <p role="status">{t('loading')}</p>}
    {data && <>
      <RuntimeForm title="concurrencyLimit" hint="concurrencyHint" fields={fields.concurrency} settings={data} operation="set-concurrency" params={value => ({ limit: value.concurrencyLimit })} />
      <RuntimeForm title="dispatchWatchdog" fields={fields.dispatch} settings={data} operation="set-dispatch-watchdog" params={value => ({ wallTimeoutMs: value.dispatchWallTimeoutMs, idleTimeoutMs: value.dispatchIdleTimeoutMs })} />
      <RuntimeForm title="roundWatchdog" fields={fields.round} settings={data} operation="set-round-watchdog" params={value => ({ totalTimeoutMs: value.roundTotalTimeoutMs, idleTimeoutMs: value.roundIdleTimeoutMs })} />
      <RuntimeForm title="outputThreshold" hint="outputHint" fields={fields.output} settings={data} operation="set-output-threshold" params={value => ({ thresholdBytes: value.outputThresholdBytes })} />
    </>}
  </section>;
}
function RuntimeForm({ title, hint, fields, settings, operation, params }: {
  title: MessageKey; hint?: MessageKey; fields: NumberField[]; settings: RuntimeSettings;
  operation: string; params: (values: Record<string, number>) => object;
}) {
  const { t } = useI18n();
  const { api } = useData();
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [errors, setErrors] = useState<string[]>([]);
  const save = useSettingsSave();
  async function submit(event: FormEvent) {
    event.preventDefault(); save.clear();
    const values: Record<string, number> = {};
    const invalid: string[] = [];
    for (const field of fields) {
      const text = draft[field.name] ?? String(settings[field.name] / field.factor);
      const number = Number(text) * field.factor;
      if (!text.trim() || !Number.isSafeInteger(number) || number < field.min || number > field.max) invalid.push(field.name);
      values[field.name] = number;
    }
    setErrors(invalid);
    if (invalid.length) { document.getElementById(`runtime-${invalid[0]}`)?.focus(); return; }
    await save.run(async () => { await api.call(operation, params(values)); });
  }
  return <form className="settings-box settings-runtime-group" aria-label={t(title)} onSubmit={submit} noValidate aria-busy={save.pending}><h3>{t(title)}</h3>{hint && <p className="muted">{t(hint)}</p>}
    {fields.map(field => <div key={field.name}><div className="settings-numeric"><label htmlFor={`runtime-${field.name}`}>{t(field.label)}</label><span className="settings-unit"><input id={`runtime-${field.name}`} type="number" step="any" min={field.min / field.factor} max={field.max / field.factor}
      disabled={save.pending} value={draft[field.name] ?? String(settings[field.name] / field.factor)} aria-invalid={errors.includes(field.name)} aria-describedby={errors.includes(field.name) ? `runtime-${field.name}-error` : undefined}
      onChange={event => { setDraft({ ...draft, [field.name]: event.target.value }); setErrors(errors.filter(name => name !== field.name)); save.clear(); }} />{field.unit && <span>{field.unit === 'GB' ? 'GB' : t(field.unit)}</span>}</span></div>
      {errors.includes(field.name) && <small className="settings-reason" id={`runtime-${field.name}-error`}>{t('invalidNumber')}</small>}</div>)}
    <SaveFeedback {...save} /><div className="row"><button className="btn primary" disabled={save.pending}>{t('save')}</button></div>
  </form>;
}
