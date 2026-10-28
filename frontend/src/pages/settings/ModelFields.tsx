import { useResource } from '../../shared/data.js';
import { useI18n } from '../../shared/i18n.js';
import type { AgentSettings } from './types.js';

interface ModelOption { id: string | null; label: string; efforts: string[]; defaultEffort: string | null; unavailableReason?: string }
const modelsAffected = () => false;
type FieldProps = (name: string) => object;

// Options come from the driver's CLI; when it cannot be asked, the fields fall back to free text.
export function ModelFields({ settings, agentId, change, fieldProps, fieldError }: {
  settings: AgentSettings; agentId: string; change: (next: Pick<AgentSettings, 'model' | 'reasoningEffort'>) => void;
  fieldProps: FieldProps; fieldError: (name: string) => React.ReactNode;
}) {
  const { t } = useI18n();
  const models = useResource<ModelOption[]>('list-agent-models', { driver: settings.driver,
    ...(settings.driver === 'deepseek' ? { agent: { id: agentId, home: settings.home } } : {}),
  }, settings.driver === 'deepseek' ? modelsAffected : undefined);
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
  const allowsDefaultEffort = allowsDefault || settings.driver === 'deepseek' && !efforts.length;
  const pickModel = (id: string | null) => {
    const next = options.find(option => option.id === id);
    // Keep the effort when the new model offers it; otherwise take the model's default.
    change({ model: id, reasoningEffort: effort && next?.efforts.includes(effort) ? effort : next?.defaultEffort ?? (allowsDefault ? null : next?.efforts[0] ?? null) });
  };
  return <>
    <label htmlFor="agent-model">{t('model')}<select {...fieldProps('model')} value={model ?? ''} onChange={event => pickModel(event.target.value || null)}>
      {allowsDefault ? <option value="">{t('driverDefault')}</option> : model === null && <option value="" disabled>{t('chooseModel')}</option>}
      {model !== null && !current && <option value={model}>{model} · {t('notOffered')}</option>}
      {options.filter(option => option.id !== null).map(option => <option key={option.id} value={option.id!}>{settings.driver === 'deepseek' || option.label === option.id ? option.label : `${option.label} (${option.id})`}</option>)}
    </select>{current?.unavailableReason && <small className="settings-reason">{current.unavailableReason}</small>}{fieldError('model')}</label>
    <fieldset className="settings-efforts" {...fieldProps('reasoningEffort')} tabIndex={-1}><legend>{t('reasoning')}</legend>
      <div className="seg settings-effort-options">
        {allowsDefaultEffort && <label><input type="radio" name="agent-effort" value="" checked={effort === null} onChange={() => change({ model, reasoningEffort: null })} /><span>{t('driverDefault')}</span></label>}
        {effort !== null && !efforts.includes(effort) && <label><input type="radio" name="agent-effort" value={effort} checked readOnly /><span>{effort} · {t('notOffered')}</span></label>}
        {efforts.map(option => <label key={option}><input type="radio" name="agent-effort" value={option} checked={effort === option} onChange={() => change({ model, reasoningEffort: option })} /><span>{option}</span></label>)}
      </div>{effort === null && !allowsDefaultEffort && <p className="muted">{t('chooseEffort')}</p>}{fieldError('reasoningEffort')}
    </fieldset>
  </>;
}
