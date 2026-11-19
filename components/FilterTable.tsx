'use client';
import { Fragment, useState } from 'react';

export type FRow = { id: string; tab: string; search: string; node: React.ReactNode };
export type FTab = { key: string; label: string };

const norm = (s: string) => s.toLowerCase().replace(/\s+/g, '');

/**
 * A table with status tabs (with counts) and a search box, so a long history of campaigns / codes stays easy to scan.
 * The page passes ready-made <tr> rows; with text in the search box every row is searched, whatever the tab.
 * The tab with key "all" shows everything.
 */
export function FilterTable({ tabs, rows, head, searchPlaceholder, empty }: {
  tabs: FTab[]; rows: FRow[]; head: React.ReactNode; searchPlaceholder: string; empty: string;
}) {
  const count = (k: string) => (k === 'all' ? rows.length : rows.filter((r) => r.tab === k).length);
  const [tab, setTab] = useState(() => tabs.find((t) => t.key !== 'all' && count(t.key) > 0)?.key ?? 'all');
  const [q, setQ] = useState('');
  const query = norm(q);
  const shown = rows.filter((r) => (query ? norm(r.search).includes(query) : tab === 'all' || r.tab === tab));

  if (!rows.length) return <p className="empty">{empty}</p>;
  return (
    <>
      <div className="ftools">
        <div className="ftabs" role="tablist">
          {tabs.map((t) => (
            <button key={t.key} type="button" role="tab" aria-selected={!query && tab === t.key} className={!query && tab === t.key ? 'on' : ''} onClick={() => { setTab(t.key); setQ(''); }}>
              {t.label} <i>{count(t.key)}</i>
            </button>
          ))}
        </div>
        <input className="fsearch" type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder={searchPlaceholder} aria-label="ค้นหา" />
      </div>
      {query && <p className="hint" style={{ margin: '6px 0' }}>ค้นหา “{q.trim()}” ในทุกสถานะ · พบ {shown.length} รายการ</p>}
      {shown.length === 0 ? <p className="empty">{query ? 'ไม่พบรายการที่ค้นหา' : 'ไม่มีรายการในแท็บนี้ (ที่ปิดหรือจบแล้วอยู่แท็บ “จบแล้ว / ปิด”)'}</p> : (
        <table className="tbl">
          <thead>{head}</thead>
          <tbody>{shown.map((r) => <Fragment key={r.id}>{r.node}</Fragment>)}</tbody>
        </table>
      )}
    </>
  );
}
