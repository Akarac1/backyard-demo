'use client';
import { useActionState, useRef } from 'react';
import { useFormStatus } from 'react-dom';
import type { ActionResult } from '@/app/admin/actions';
import { addTripNote, setTripStatus } from './actions';

type Step = { key: 'en_route' | 'arrived' | 'done'; label: string; at: string | null };

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

export function StepForm({ tripId, direction, steps, next, hasLine }: { tripId: string; direction: string; steps: Step[]; next: string | null; hasLine: boolean }) {
  const [state, action] = useActionState<ActionResult, FormData>(setTripStatus, null);
  const status = useRef<HTMLInputElement>(null);
  return (
    <form action={action} className="step-form">
      <input type="hidden" name="id" value={tripId} />
      <input type="hidden" name="direction" value={direction} />
      {/* set by the clicked button just before the form submits */}
      <input type="hidden" name="status" ref={status} defaultValue="" />
      <StepButtons steps={steps} next={next} pick={(k) => { if (status.current) status.current.value = k; }} />
      <label className="notify">
        <input type="checkbox" name="notify" value="on" defaultChecked={hasLine} disabled={!hasLine} />
        {hasLine ? 'ส่งข้อความแจ้งลูกค้าทาง LINE อัตโนมัติ' : 'ลูกค้าไม่ได้จองผ่าน LINE (โทรแจ้งแทน)'}
      </label>
      {state?.error && <p className="msg bad" role="alert">{state.error}</p>}
      {state?.ok && <p className="msg ok" role="status">{state.ok}</p>}
    </form>
  );
}

function SendNote() {
  const { pending } = useFormStatus();
  return <button className="b b-plain b-sm" disabled={pending}>{pending ? 'กำลังส่ง…' : 'ส่งหมายเหตุ'}</button>;
}

export function NoteForm({ tripId, hasLine }: { tripId: string; hasLine: boolean }) {
  const [state, action] = useActionState<ActionResult, FormData>(addTripNote, null);
  return (
    <details className="note-box">
      <summary>แจ้งปัญหา / หมายเหตุ</summary>
      <form action={action}>
        <input type="hidden" name="id" value={tripId} />
        <textarea name="note" rows={2} maxLength={500} placeholder="เช่น รถติดหนัก ถึงช้าประมาณ 15 นาที / ลูกค้ายังไม่ออกจากโถง" required />
        <div className="note-row">
          <label className="notify"><input type="checkbox" name="notify" value="on" defaultChecked={hasLine} disabled={!hasLine} /> ส่งให้ลูกค้าด้วย</label>
          <SendNote />
        </div>
        {state?.error && <p className="msg bad" role="alert">{state.error}</p>}
        {state?.ok && <p className="msg ok" role="status">{state.ok}</p>}
      </form>
    </details>
  );
}
