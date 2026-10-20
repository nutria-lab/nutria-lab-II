import type { CardState } from '../types';
import { CardError, CardNotice, CardSkeleton } from './CardStates';

type Props = {
  state: CardState<null>;
  className?: string;
};

// Placeholder: el contenido real lo aporta el widget de adherencia. Solo se usa
// `kind` y el copy es fijo, así que ningún número ni mensaje externo llega acá.
export function AdherenceWidgetSlot({ state, className = '' }: Props) {
  return (
    <section aria-labelledby="dashboard-progress-title" className={`rounded-xl bg-surface-container p-6 ${className}`}>
      <h2 id="dashboard-progress-title" className="mb-4 font-headline text-xl font-semibold text-on-surface">
        Progreso semanal
      </h2>
      {state.kind === 'loading' && <CardSkeleton rows={2} />}
      {state.kind === 'error' && <CardError message="No pudimos cargar tu progreso." retry={state.retry} />}
      {state.kind === 'unavailable' && <CardNotice icon="hourglass_empty" title="No disponible todavía" />}
      {state.kind === 'ready' && <CardNotice icon="insights" title="Tu progreso aparecerá aquí." />}
    </section>
  );
}
