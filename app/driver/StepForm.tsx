'use client';
import { useActionState, useEffect, useRef, useState } from 'react';
import { useFormStatus } from 'react-dom';
import { useRouter } from 'next/navigation';
import type { ActionResult } from '@/app/admin/actions';
import { addTripNote, recordCall, sendWelcome, setTripStatus } from './actions';

type Step = { key: 'en_route' | 'arrived' | 'done'; label: string; at: string | null; preview: string };
type Ask = { title: string; body: string; preview?: string | null; danger?: boolean };

/** Confirmation popup. Rendered by each form; the form submits only after "confirm". */
function Confirm({ ask, onCancel, onOk }: { ask: Ask; onCancel: () => void; onOk: () => void }) {
  return (
    <div className="modal-bg" role="dialog" aria-modal="true" aria-labelledby="ask-title" onClick={onCancel}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h2 id="ask-title">{ask.title}</h2>
        <p>{ask.body}</p>
        {ask.preview && <div className="modal-preview">ลูกค้าจะได้รับการ์ด: <b>{ask.preview}</b></div>}
        <div className="modal-actions">
          <button type="button" className="b b-plain" onClick={onCancel}>ยกเลิก</button>
          <button type="button" className={`b ${ask.danger ? 'b-danger' : 'b-primary'}`} onClick={onOk} autoFocus>ยืนยัน</button>
        </div>
      </div>
    </div>
  );
}

/** Wraps a form: intercepts submit, asks, then submits for real. */
function useConfirm() {
  const [ask, setAsk] = useState<Ask | null>(null);
  const ok = useRef(false);
  const form = useRef<HTMLFormElement>(null);
  const intercept = (build: (f: HTMLFormElement) => Ask) => (e: React.FormEvent<HTMLFormElement>) => {
    if (ok.current) { ok.current = false; return; }
    e.preventDefault();
    setAsk(build(e.currentTarget));
  };
  const dialog = ask && (
    <Confirm ask={ask} onCancel={() => setAsk(null)}
      onOk={() => { setAsk(null); ok.current = true; form.current?.requestSubmit(); }} />
  );
  return { form, intercept, dialog };
}

function Msg({ state }: { state: ActionResult }) {
  if (state?.error) return <p className="msg bad" role="alert">{state.error}</p>;
  if (state?.ok) return <p className="msg ok" role="status">{state.ok}</p>;
  return null;
}

function StepButtons({ steps, next, pick }: { steps: Step[]; next: string | null; pick: (k: string) => void }) {
  const { pending } = useFormStatus();
  return (
    <div className="steps">
      {steps.map((s, i) => (
        <button key={s.key} type="submit" onClick={() => pick(s.key)} disabled={pending}
          className={`step ${s.at ? 'did' : ''} ${s.key === next ? 'next' : ''}`}>
          <i>{s.at ? '✓' : i + 1}</i>
          <span>{s.label}</span>
          {s.at && <small>{s.at}</small>}
        </button>
      ))}
    </div>
  );
}

export function StepForm({ tripId, direction, steps, next, hasLine, takenBy, customer }: {
  tripId: string; direction: string; steps: Step[]; next: string | null; hasLine: boolean; takenBy: string | null; customer: string;
}) {
  const [state, action] = useActionState<ActionResult, FormData>(setTripStatus, null);
  // controlled: a hidden input's value would be reset by React when the popup re-renders the form
  const [status, setStatus] = useState('');
  const picked = useRef('');
  const { form, intercept, dialog } = useConfirm();
  return (
    <form ref={form} action={action} className="step-form"
      onSubmit={intercept((f) => {
        const step = steps.find((s) => s.key === picked.current);
        const notify = (f.elements.namedItem('notify') as HTMLInputElement | null)?.checked;
        const takeover = (f.elements.namedItem('takeover') as HTMLInputElement | null)?.checked;
        return {
          title: `ยืนยัน “${step?.label ?? ''}”?`,
          body: `${customer}${takeover ? ' · คุณจะรับงานนี้แทน' : ''}${step?.at ? ' · ขั้นนี้เคยกดแล้ว จะบันทึกเวลาใหม่' : ''}${notify ? '' : ' · ไม่ส่งข้อความถึงลูกค้า'}`,
          preview: notify ? step?.preview : null,
        };
      })}>
      <input type="hidden" name="id" value={tripId} />
      <input type="hidden" name="direction" value={direction} />
      <input type="hidden" name="status" value={status} readOnly />
      {takenBy && (
        <label className="takeover">
          <input type="checkbox" name="takeover" value="on" /> {takenBy} ดูแลงานนี้อยู่ · ติ๊กเพื่อรับงานแทน
        </label>
      )}
      <StepButtons steps={steps} next={next} pick={(k) => { picked.current = k; setStatus(k); }} />
      <label className="notify">
        <input type="checkbox" name="notify" value="on" defaultChecked={hasLine} disabled={!hasLine} />
        {hasLine ? 'ส่งข้อความแจ้งลูกค้าทาง LINE อัตโนมัติ' : 'ลูกค้าไม่ได้จองผ่าน LINE (โทรแจ้งแทน)'}
      </label>
      <Msg state={state} />
      {dialog}
    </form>
  );
}

function Small({ children, variant = 'plain' }: { children: React.ReactNode; variant?: 'plain' | 'primary' }) {
  const { pending } = useFormStatus();
  return <button className={`b b-${variant} b-sm`} disabled={pending}>{pending ? 'กำลังส่ง…' : children}</button>;
}

export function NoteForm({ tripId, hasLine, customer }: { tripId: string; hasLine: boolean; customer: string }) {
  const [state, action] = useActionState<ActionResult, FormData>(addTripNote, null);
  const { form, intercept, dialog } = useConfirm();
  return (
    <details className="note-box">
      <summary>แจ้งปัญหา / หมายเหตุ</summary>
      <form ref={form} action={action} onSubmit={intercept((f) => {
        const note = (f.elements.namedItem('note') as HTMLTextAreaElement).value.trim();
        const notify = (f.elements.namedItem('notify') as HTMLInputElement | null)?.checked;
        return { title: 'ส่งหมายเหตุนี้?', body: `“${note}”${notify ? '' : ' · แจ้งแอดมินอย่างเดียว ไม่ส่งถึงลูกค้า'}`, preview: notify ? `แจ้งจากคนขับ (ถึง${customer})` : null };
      })}>
        <input type="hidden" name="id" value={tripId} />
        <textarea name="note" rows={2} maxLength={500} placeholder="เช่น รถติดหนัก ถึงช้าประมาณ 15 นาที / ลูกค้ายังไม่ออกจากโถง" required />
        <div className="note-row">
          <label className="notify"><input type="checkbox" name="notify" value="on" defaultChecked={hasLine} disabled={!hasLine} /> ส่งให้ลูกค้าด้วย</label>
          <Small>ส่งหมายเหตุ</Small>
        </div>
        <Msg state={state} />
        {dialog}
      </form>
    </details>
  );
}

/** Return trips: send the welcome card now, or record that the customer phoned. */
export function CallTools({ tripId, hasLine, welcomed, called, customer }: { tripId: string; hasLine: boolean; welcomed: boolean; called: boolean; customer: string }) {
  const [wState, wAction] = useActionState<ActionResult, FormData>(sendWelcome, null);
  const [cState, cAction] = useActionState<ActionResult, FormData>(recordCall, null);
  const w = useConfirm();
  const c = useConfirm();
  return (
    <div className="call-tools">
      {hasLine && !called && (
        <form ref={w.form} action={wAction} onSubmit={w.intercept(() => ({
          title: welcomed ? 'ส่งข้อความต้อนรับอีกครั้ง?' : 'ส่งข้อความต้อนรับตอนนี้?',
          body: `${customer} จะได้การ์ดพร้อมปุ่ม “เรียกรถมารับ”`, preview: 'ยินดีต้อนรับสู่สุวรรณภูมิ',
        }))}>
          <input type="hidden" name="id" value={tripId} />
          <Small>{welcomed ? 'ส่งข้อความต้อนรับซ้ำ' : 'ส่งข้อความต้อนรับตอนนี้'}</Small>
          {w.dialog}
        </form>
      )}
      {!called && (
        <form ref={c.form} action={cAction} onSubmit={c.intercept(() => ({
          title: 'ลูกค้าโทรมาเรียกรถ?', body: `บันทึกว่า${customer}พร้อมแล้ว งานจะขึ้นเป็น “ลูกค้าเรียกรถ” ให้คนขับเห็น`,
        }))}>
          <input type="hidden" name="id" value={tripId} />
          <Small>ลูกค้าโทรมาเรียกแล้ว</Small>
          {c.dialog}
        </form>
      )}
      <Msg state={wState} /><Msg state={cState} />
    </div>
  );
}

/** Re-reads the board every 30 seconds and flags new calls in the tab title. */
export function AutoRefresh({ urgent }: { urgent: number }) {
  const router = useRouter();
  useEffect(() => {
    const t = setInterval(() => router.refresh(), 30_000);
    return () => clearInterval(t);
  }, [router]);
  useEffect(() => {
    const title = urgent ? `(${urgent}) ลูกค้าเรียกรถ · Backyard` : 'งานรับส่ง · Backyard';
    const t = setTimeout(() => { document.title = title; }, 300); // after Next.js sets the page title
    if (urgent && 'vibrate' in navigator) navigator.vibrate?.([200, 100, 200]);
    return () => clearTimeout(t);
  }, [urgent]);
  return null;
}

/** Minutes left until the van should be at the meeting point. */
export function Countdown({ deadline }: { deadline: string }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => { const t = setInterval(() => setNow(Date.now()), 15_000); return () => clearInterval(t); }, []);
  const min = Math.round((Date.parse(deadline) - now) / 60_000);
  return <b>{min >= 0 ? `เหลือ ${min} นาที` : `เลยมา ${-min} นาที`}</b>;
}
