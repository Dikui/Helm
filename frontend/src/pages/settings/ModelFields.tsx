import { useResource } from '../../shared/data.js';
import { useI18n } from '../../shared/i18n.js';
import type { AgentSettings } from './types.js';

interface ModelOption { id: string | null; label: string; efforts: string[]; defaultEffort: string | null }
type FieldProps = (name: string) => object;

// Options come from the driver's CLI; when it cannot be asked, the fields fall back to free text.
export function ModelFields({ settings, change, fieldProps, fieldError }: {
  settings: AgentSettings; change: (next: Pick<AgentSettings, 'model' | 'reasoningEffort'>) => void;
  fieldProps: FieldProps; fieldError: (name: string) => React.ReactNode;
}) {
  const { t } = useI18n();
  const models = useResource<ModelOption[]>('list-agent-models', { driver: settings.driver });
  const { model, reasoningEffort: effort } = settings;
  if (!models.data) return <>
    <p className="muted">{models.error ? <>{models.error.message} <button type="button" className="btn sm" onClick={models.reload}>{t('recheck')}</button></> : t('loadingModels')}</p>
    <label htmlFor="agent-model">{t('model')}<input {...fieldProps('model')} value={model ?? ''} placeholder={t('driverDefault')}
      onChange={event => change({ model: event.target.value, reasoningEffort: effort })} />{fieldError('model')}</label>
    <label htmlFor="agent-reasoningEffort">{t('reasoning')}<input {...fieldProps('reasoningEffort')} value={effort ?? ''} placeholder={t('driverDefault')}
      onChange={event => change({ model, reasoningEffort: event.target.value || null })} />{fieldError('reasoningEffort')}</label>
  </>;
  const options = models.data;
  const allowsDefault = options.some(option => option.id === null);
  const current = options.find(option => option.id === model);
  const efforts = current?.efforts ?? [];
  const pickModel = (id: string | null) => {
    const next = options.find(option => option.id === id);
    // Keep the effort when the new model offers it; otherwise take the model's default.
    change({ model: id, reasoningEffort: effort && next?.efforts.includes(effort) ? effort : next?.defaultEffort ?? (allowsDefault ? null : next?.efforts[0] ?? null) });
  };
  return <>
    <label htmlFor="agent-model">{t('model')}<select {...fieldProps('model')} value={model ?? ''} onChange={event => pickModel(event.target.value || null)}>
      {allowsDefault ? <option value="">{t('driverDefault')}</option> : model === null && <option value="" disabled>{t('chooseModel')}</option>}
      {model !== null && !current && <option value={model}>{model} · {t('notOffered')}</option>}
      {options.filter(option => option.id !== null).map(option => <option key={option.id} value={option.id!}>{option.label === option.id ? option.id : `${option.label} (${option.id})`}</option>)}
    </select>{fieldError('model')}</label>
    <label htmlFor="agent-reasoningEffort">{t('reasoning')}<select {...fieldProps('reasoningEffort')} value={effort ?? ''} onChange={event => change({ model, reasoningEffort: event.target.value || null })}>
      {allowsDefault ? <option value="">{t('driverDefault')}</option> : effort === null && <option value="" disabled>{t('chooseEffort')}</option>}
      {effort !== null && !efforts.includes(effort) && <option value={effort}>{effort} · {t('notOffered')}</option>}
      {efforts.map(option => <option key={option}>{option}</option>)}
    </select>{fieldError('reasoningEffort')}</label>
  </>;
}
