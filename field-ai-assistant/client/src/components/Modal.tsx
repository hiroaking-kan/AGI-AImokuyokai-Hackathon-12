import { useEffect, useRef, type ReactNode } from 'react';

export function Modal({ titleId, children, onEscape }: { titleId: string; children: ReactNode; onEscape?: () => void }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const dialog = ref.current;
    const previous = document.activeElement as HTMLElement | null;
    dialog?.showModal();
    return () => { dialog?.close(); previous?.focus(); };
  }, []);
  return <dialog ref={ref} className="modal" aria-labelledby={titleId} onCancel={event => { event.preventDefault(); onEscape?.(); }}>{children}</dialog>;
}
