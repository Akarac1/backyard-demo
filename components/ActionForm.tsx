'use client';
import { useActionState, useEffect, useRef } from 'react';
import { useFormStatus } from 'react-dom';
import type { ActionResult } from '@/app/admin/actions';

type Action = (prev: ActionResult, f: FormData) => Promise<ActionResult>;

/** A form bound to a server action, with an inline success/error message. */
export function ActionForm({ action, children, className, confirm, resetOnOk }: {
  action: Action; children: React.ReactNode; className?: string; confirm?: string; resetOnOk?: boolean;
}) {
  const [state, formAction] = useActionState(action, null);
  const ref = useRef<HTMLFormElement>(null);
  useEffect(() => { if (state?.ok && resetOnOk) ref.current?.reset(); }, [state, resetOnOk]);
  return (
    <form ref={ref} action={formAction} className={className}
      onSubmit={(e) => { if (confirm && !window.confirm(confirm)) e.preventDefault(); }}>
      {children}
      {state?.error && <p className="msg bad" role="alert">{state.error}</p>}
      {state?.ok && <p className="msg ok" role="status">{state.ok}</p>}
    </form>
  );
}

export function Submit({ children, variant = 'primary', small }: { children: React.ReactNode; variant?: 'primary' | 'plain' | 'danger'; small?: boolean }) {
  const { pending } = useFormStatus();
  return <button className={`b b-${variant}${small ? ' b-sm' : ''}`} disabled={pending}>{pending ? 'กำลังบันทึก…' : children}</button>;
}

/** One-click button that posts hidden fields to a server action. */
export function ActionButton({ action, fields, label, variant = 'plain', confirm }: {
  action: Action; fields: Record<string, string | number>; label: string; variant?: 'primary' | 'plain' | 'danger'; confirm?: string;
}) {
  return (
    <ActionForm action={action} confirm={confirm} className="inline-form">
      {Object.entries(fields).map(([k, v]) => <input key={k} type="hidden" name={k} value={v} />)}
      <Submit variant={variant} small>{label}</Submit>
    </ActionForm>
  );
}
