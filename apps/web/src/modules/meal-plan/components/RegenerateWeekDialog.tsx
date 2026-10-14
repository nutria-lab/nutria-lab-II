import { Modal } from '../../../common/components/Modal';

export type RegenerationDialogStatus = 'confirming' | 'submitting' | 'error';

type RegenerateWeekDialogProps = {
  open: boolean;
  status: RegenerationDialogStatus;
  errorMessage?: string | null;
  onClose: () => void;
  onCancel: () => void;
  onConfirm: () => void | Promise<void>;
  onRetry: () => void | Promise<void>;
};

export function RegenerateWeekDialog({
  open,
  status,
  errorMessage,
  onClose,
  onCancel,
  onConfirm,
  onRetry,
}: RegenerateWeekDialogProps) {
  const isSubmitting = status === 'submitting';

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={isSubmitting ? 'Regenerando tu semana' : 'Regenerar semana'}
      dismissible
    >
      <div className="space-y-5" aria-busy={isSubmitting}>
        {status === 'confirming' && (
          <>
            <p className="text-sm leading-6 text-on-surface-variant">
              Se creará una propuesta nueva para toda la semana. La propuesta actual quedará reemplazada como vista vigente.
            </p>
            <div className="flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
              <button
                type="button"
                onClick={onCancel}
                className="min-h-[44px] rounded-xl bg-surface-container px-5 text-sm font-bold text-on-surface transition-colors hover:bg-surface-container-high"
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={onConfirm}
                className="min-h-[44px] rounded-xl bg-brand-green px-5 text-sm font-bold text-on-primary shadow-md transition-opacity hover:opacity-90"
              >
                Regenerar semana
              </button>
            </div>
          </>
        )}

        {status === 'submitting' && (
          <div className="space-y-4" role="status" aria-live="polite">
            <div className="flex items-center gap-3 text-brand-green">
              <span aria-hidden="true" className="material-symbols-outlined animate-spin">progress_activity</span>
              <p className="text-sm font-semibold text-on-surface">Estamos preparando una propuesta nueva.</p>
            </div>
            <p className="text-sm leading-6 text-on-surface-variant">
              Tu plan actual sigue disponible mientras termina la regeneración.
            </p>
          </div>
        )}

        {status === 'error' && (
          <>
            <div role="alert" className="rounded-xl bg-error-container px-4 py-3 text-sm leading-6 text-on-error-container">
              {errorMessage ?? 'No pudimos regenerar tu semana.'}
            </div>
            <p className="text-sm leading-6 text-on-surface-variant">
              Tu plan actual sigue disponible. Podés reintentar la misma solicitud.
            </p>
            <div className="flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
              <button
                type="button"
                onClick={onCancel}
                className="min-h-[44px] rounded-xl bg-surface-container px-5 text-sm font-bold text-on-surface transition-colors hover:bg-surface-container-high"
              >
                Cerrar
              </button>
              <button
                type="button"
                onClick={onRetry}
                className="min-h-[44px] rounded-xl bg-brand-green px-5 text-sm font-bold text-on-primary shadow-md transition-opacity hover:opacity-90"
              >
                Reintentar
              </button>
            </div>
          </>
        )}
      </div>
    </Modal>
  );
}