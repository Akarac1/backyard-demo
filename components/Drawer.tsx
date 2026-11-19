'use client';
import { createContext, useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

type Toast = { msg: string; kind: 'ok' | 'bad' };
export type DrawerCtx = { close: (msg?: string) => void; notify: (msg: string, kind?: 'ok' | 'bad') => void };
/** Forms inside a Drawer read this (see ActionForm): a successful save closes the panel and shows a toast. */
export const DrawerContext = createContext<DrawerCtx | null>(null);

/**
 * A button that opens a side panel with a form inside. The panel closes by itself after a successful save
 * (so the admin sees the updated list straight away), the save button stays pinned at the bottom, and
 * Esc / tapping outside / ✕ closes it. The content is mounted only while open, so it always starts from fresh data.
 */
export function Drawer({ label, title, children, variant = 'plain' }: {
  label: React.ReactNode; title: string; children: React.ReactNode; variant?: 'plain' | 'primary';
}) {
  const [open, setOpen] = useState(false);
  const [toast, setToast] = useState<Toast | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const notify = useCallback((msg: string, kind: 'ok' | 'bad' = 'ok') => {
    setToast({ msg, kind });
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setToast(null), kind === 'ok' ? 3000 : 7000);
  }, []);
  const close = useCallback((msg?: string) => { setOpen(false); if (msg) notify(msg); }, [notify]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('keydown', onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.removeEventListener('keydown', onKey); document.body.style.overflow = prev; };
  }, [open]);
  useEffect(() => () => clearTimeout(timer.current), []);

  return (
    <>
      <button type="button" className={`b b-${variant} b-sm`} onClick={() => setOpen(true)}>{label}</button>
      {open && createPortal(
        <>
          <div className="dz-back" onClick={() => setOpen(false)} />
          <aside className="dz-panel" role="dialog" aria-modal="true" aria-label={title}>
            <header className="dz-head">
              <h3>{title}</h3>
              <button type="button" className="dz-x" onClick={() => setOpen(false)} aria-label="ปิด">✕</button>
            </header>
            <div className="dz-body">
              <DrawerContext.Provider value={{ close, notify }}>{children}</DrawerContext.Provider>
            </div>
          </aside>
        </>, document.body)}
      {toast && createPortal(<div className={`dz-toast ${toast.kind}`} role="status">{toast.kind === 'ok' ? '✓ ' : ''}{toast.msg}</div>, document.body)}
    </>
  );
}
