import type { AdherenceWidgetProps } from '../adherence-widget/types';
import { PRIMARY_CTA_CLASSES } from './classNames';
import { CardError, CardNotice, CardSkeleton } from './CardStates';

type Props = AdherenceWidgetProps & { className?: string };

const PROGRESS_ERROR = 'No pudimos cargar tu progreso.';

// Placeholder con el contrato del widget de adherencia (NUT-103); NUT-94 reemplaza el contenido.
// Precedencia según la doc de `AdherenceWidgetProps` (design §16): `loading` gana sobre `error`;
// el aviso no bloqueante solo aparece con data + error sin loading. Copy fijo: nunca se muestra `error` ni números.
function SlotBody({ data, loading, error, onRetry }: AdherenceWidgetProps) {
  if (!data) {
    if (loading) return <CardSkeleton rows={2} />;
    if (error) return <CardError message={PROGRESS_ERROR} retry={onRetry} />;
    return <CardNotice icon="hourglass_empty" title="No disponible todavía" />;
  }
  return (
    <>
      <CardNotice icon="insights" title="Tu progreso aparecerá aquí." />
      {error && !loading && (
        <div role="alert" className="mt-2 flex flex-wrap items-center justify-between gap-3">
          <p className="text-sm text-on-surface-variant">No pudimos actualizar tu progreso.</p>
          <button type="button" onClick={onRetry} className={PRIMARY_CTA_CLASSES}>
            Reintentar
          </button>
        </div>
      )}
    </>
  );
}

export function AdherenceWidgetSlot({ className = '', ...widgetProps }: Props) {
  return (
    <section aria-labelledby="dashboard-progress-title" className={`rounded-xl bg-surface-container p-6 ${className}`}>
      <h2 id="dashboard-progress-title" className="mb-4 font-headline text-xl font-semibold text-on-surface">
        Progreso semanal
      </h2>
      <SlotBody {...widgetProps} />
    </section>
  );
}
