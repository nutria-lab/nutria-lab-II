import { useEffect, useId, type MouseEvent, type ReactNode } from 'react';

type ModalProps = {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
  // NUT-20 (séptima iteración, tester) — Hallazgo 2 (bloqueante) del cuarto review: cuando es
  // `false`, ni el click en el overlay ni `Escape` invocan `onClose`. Usado por los
  // formularios/confirmaciones envueltos en este `Modal` mientras hay un guardado/borrado en
  // curso, para que cerrar el modal no abandone una mutación en vuelo. Default `true`
  // (comportamiento previo, sin regresión).
  dismissible?: boolean;
};

// Componente de modal/overlay reutilizable (no existía ningún patrón previo en el proyecto,
// ver plan.md sección 3 — "BRECHA confirmada"). Lo reutilizan el formulario de receta, el
// formulario de ingrediente standalone y la confirmación de borrado en iteraciones
// siguientes de este mismo ticket (NUT-20). API mínima y genérica a propósito.
export function Modal({ open, onClose, title, children, dismissible = true }: ModalProps) {
  const titleId = useId();

  useEffect(() => {
    if (!open) {
      return;
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape' && dismissible) {
        onClose();
      }
    }

    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [open, onClose, dismissible]);

  if (!open) {
    return null;
  }

  function handleContentClick(event: MouseEvent<HTMLDivElement>) {
    // Evita que un click dentro del contenido burbujee hasta el overlay y dispare un
    // cierre no deseado (patrón estándar de click-fuera para diálogos).
    event.stopPropagation();
  }

  function handleOverlayClick() {
    if (dismissible) {
      onClose();
    }
  }

  return (
    <div
      onClick={handleOverlayClick}
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 sm:items-center"
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        onClick={handleContentClick}
        className="max-h-[90vh] w-full overflow-y-auto rounded-2xl bg-brand-cream p-6 shadow-lg sm:max-w-md"
      >
        <div className="mb-4 flex items-center justify-between">
          <h2 id={titleId} className="font-serif text-lg font-semibold text-neutral-900">
            {title}
          </h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Cerrar"
            className="flex h-9 w-9 items-center justify-center rounded-full text-neutral-500 hover:bg-brand-cream-dark"
          >
            <span aria-hidden="true">✕</span>
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}
