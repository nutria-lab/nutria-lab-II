import { Modal } from './Modal';

type ConfirmDialogProps = {
  open: boolean;
  title: string;
  message: string;
  confirmLabel: string;
  onConfirm: () => void | Promise<void>;
  onCancel: () => void;
  isConfirming?: boolean;
};

// Confirmación genérica y reutilizable para acciones destructivas (ver
// `ConfirmDialog.test.tsx`). Envuelve el `Modal` ya existente en vez de duplicar su lógica de
// overlay/click-fuera/Escape: `onCancel` cumple el doble rol de "Cancelar" explícito y de
// `onClose` del `Modal` subyacente (criterio del tester, ver comentario en el propio test).
export function ConfirmDialog({
  open,
  title,
  message,
  confirmLabel,
  onConfirm,
  onCancel,
  isConfirming = false,
}: ConfirmDialogProps) {
  return (
    <Modal open={open} onClose={onCancel} title={title} dismissible={!isConfirming}>
      <div className="space-y-4">
        <p className="text-sm text-neutral-700">{message}</p>
        <div className="flex justify-end gap-3 pt-2">
          <button
            type="button"
            onClick={onCancel}
            disabled={isConfirming}
            className="min-h-[44px] rounded-lg bg-brand-cream-dark px-6 text-sm font-semibold text-neutral-700 disabled:cursor-not-allowed disabled:opacity-50"
          >
            Cancelar
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={isConfirming}
            className="min-h-[44px] rounded-lg bg-red-600 px-6 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50"
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </Modal>
  );
}
