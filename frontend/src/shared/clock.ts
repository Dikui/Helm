import { useEffect, useState } from 'react';
export function useClock() {
  const [now, setNow] = useState(Date.now);
  useEffect(() => { const timer = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(timer); }, []);
  return now;
}
export function elapsed(since: string, now: number) {
  const seconds = Math.max(0, Math.floor((now - Date.parse(since)) / 1000)) || 0;
  const hours = Math.floor(seconds / 3600);
  return `${hours ? `${hours}:` : ''}${String(Math.floor(seconds / 60) % 60).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`;
}

// 收件箱时间线用：多久以前（"3 分钟前" / "3m ago"）
export function ago(since: string, now: number, language: string) {
  const seconds = Math.round((Date.parse(since) - now) / 1000);
  const format = new Intl.RelativeTimeFormat(language === 'zh' ? 'zh-CN' : 'en', { numeric: 'auto', style: 'narrow' });
  for (const [unit, size] of [['day', 86400], ['hour', 3600], ['minute', 60]] as const) if (Math.abs(seconds) >= size) return format.format(Math.round(seconds / size), unit);
  return format.format(0, 'second');
}
