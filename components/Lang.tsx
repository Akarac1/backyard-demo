'use client';
import { createContext, useContext, useEffect, useMemo, useState } from 'react';
import { tr, LANGS, type Lang } from '@/lib/i18nDict';

const LOCALE: Record<Lang, string> = { th: 'th-TH', en: 'en-GB', zh: 'zh-CN' };
const TZ = 'Asia/Bangkok';
export const LANG_KEY = 'by_lang';

function pickInitial(): Lang {
  try {
    const saved = localStorage.getItem(LANG_KEY) as Lang | null;
    if (saved && LANGS.includes(saved)) return saved;
  } catch { /* storage blocked */ }
  const nav = (typeof navigator !== 'undefined' ? navigator.language : 'th').toLowerCase();
  return nav.startsWith('zh') ? 'zh' : nav.startsWith('th') ? 'th' : nav.startsWith('en') ? 'en' : 'th';
}

type Ctx = {
  lang: Lang;
  setLang: (l: Lang) => void;
  t: (key: string, vars?: Record<string, string | number>) => string;
  /** '2026-12-12' -> 'ส. 12 ธ.ค. 69' / 'Sat 12 Dec 26' / '12月12日周六' */
  day: (d: string) => string;
  /** '2026-12-12T09:30' (Bangkok) -> date · time */
  dayTime: (dt: string) => string;
  /** timestamp -> short date */
  short: (ts: string) => string;
  /** timestamp -> HH:MM (Bangkok) */
  time: (ts: string) => string;
  /** 1200 -> '1,200 บาท' / '1,200 THB' / '1,200 泰铢' */
  money: (n: number) => string;
  num: (n: number) => string;
};

const LangCtx = createContext<Ctx | null>(null);

export function LangProvider({ children }: { children: React.ReactNode }) {
  const [lang, setLangState] = useState<Lang>('th');
  useEffect(() => { setLangState(pickInitial()); }, []);
  useEffect(() => { document.documentElement.lang = lang === 'zh' ? 'zh-CN' : lang; }, [lang]);
  const value = useMemo<Ctx>(() => {
    const loc = LOCALE[lang];
    const t = (key: string, vars?: Record<string, string | number>) => tr(lang, key, vars);
    const day = (d: string) => (d ? new Date(`${d.slice(0, 10)}T12:00:00+07:00`).toLocaleDateString(loc, { timeZone: TZ, weekday: 'short', day: 'numeric', month: 'short', year: '2-digit' }) : '—');
    return {
      lang,
      setLang: (l) => { setLangState(l); try { localStorage.setItem(LANG_KEY, l); } catch { /* ignore */ } },
      t,
      day,
      dayTime: (dt) => (dt ? `${day(dt.slice(0, 10))} · ${dt.slice(11, 16)}${lang === 'th' ? ' น.' : ''}` : '—'),
      short: (ts) => new Date(ts).toLocaleDateString(loc, { timeZone: TZ, day: 'numeric', month: 'short', year: '2-digit' }),
      time: (ts) => new Date(ts).toLocaleTimeString(loc, { timeZone: TZ, hour: '2-digit', minute: '2-digit', hour12: false }),
      money: (n) => t('{n} บาท', { n: n.toLocaleString(loc) }),
      num: (n) => n.toLocaleString(loc),
    };
  }, [lang]);
  return <LangCtx.Provider value={value}>{children}<LangSwitch /></LangCtx.Provider>;
}

export function useT(): Ctx {
  const c = useContext(LangCtx);
  if (!c) throw new Error('useT outside LangProvider');
  return c;
}

const LABEL: Record<Lang, string> = { th: 'ไทย', en: 'EN', zh: '中文' };

/** Language switch, fixed at the top right of every customer page. */
function LangSwitch() {
  const { lang, setLang } = useT();
  return (
    <div className="lang-switch" role="group" aria-label="Language / ภาษา / 语言">
      {LANGS.map((l) => (
        <button key={l} type="button" className={l === lang ? 'on' : ''} aria-pressed={l === lang} onClick={() => setLang(l)}>{LABEL[l]}</button>
      ))}
    </div>
  );
}
