import { CardError, CardNotice, CardSkeleton } from '../components/CardStates';
import { PRIMARY_CTA_CLASSES } from '../components/classNames';
import type { AdherenceResponse } from '../types';
import {
  formatAdherencePercent,
  hasNoRecords,
  isConsistentAdherence,
  isStaleAdherence,
  type AdherenceWidgetViewProps,
} from './utils';

type Props = AdherenceWidgetViewProps & { className?: string };

const TITLE_ID = 'dashboard-progress-title';

// Precedencia (design de NUT-94 §2). Datos obsoletos o inconsistentes no se muestran: mientras hay un
// pedido en curso se ve la carga y, si no, un error con Reintentar, así nunca queda una carga infinita.
// El 401 lo resuelve el manejo global de sesión: este componente no lo recibe.
function WidgetBody({ data, loading, error, onRetry, expectedWeekStart, expectedPlanId }: AdherenceWidgetViewProps) {
  const usable =
    data !== null && !isStaleAdherence(data, { expectedWeekStart, expectedPlanId }) && isConsistentAdherence(data);

  if (!usable) {
    if (loading) return <CardSkeleton rows={2} />;
    if (data !== null || error) return <CardError message="No pudimos cargar tu progreso." retry={onRetry} />;
    return <CardNotice icon="hourglass_empty" title="No disponible todavía" />;
  }

  return (
    <>
      <ProgressContent data={data} />
      {error && !loading && (
        <div role="alert" className="mt-4 flex flex-wrap items-center justify-between gap-3">
          <p className="text-sm text-on-surface-variant">No pudimos actualizar tu progreso.</p>
          <button type="button" onClick={onRetry} className={PRIMARY_CTA_CLASSES}>
            Reintentar
          </button>
        </div>
      )}
    </>
  );
}

function ProgressContent({ data }: { data: AdherenceResponse }) {
  if (data.plan === null) {
    return (
      <CardNotice
        icon="event_busy"
        title="Todavía no tenés un plan para esta semana."
        description="Cuando tengas un plan, vas a ver acá cómo avanza tu semana."
      />
    );
  }
  // Con un resumen consistente, cero comidas equivale a porcentaje null: "sin datos", nunca 0 % ni 100 %.
  if (data.summary.adherencePercent === null) {
    return (
      <CardNotice icon="insights" title="Sin datos de progreso" description="Tu plan no tiene comidas planificadas esta semana." />
    );
  }
  return <ProgressSummary summary={data.summary} percent={data.summary.adherencePercent} />;
}

const COUNTERS = [
  { key: 'completedMeals', label: 'Completadas' },
  { key: 'skippedMeals', label: 'Omitidas' },
  { key: 'notLoggedMeals', label: 'Sin registrar' },
] as const;

// Todos los números vienen del backend: el denominador incluye las comidas futuras de la semana.
function ProgressSummary({ summary, percent }: { summary: AdherenceResponse['summary']; percent: number }) {
  const percentText = formatAdherencePercent(percent);

  return (
    <div aria-live="polite" aria-atomic="true" className="space-y-4">
      <div>
        <p className="font-headline text-4xl font-bold text-brand-green">{percentText}</p>
        <p className="mt-1 text-sm text-on-surface-variant">
          {summary.completedMeals} de {summary.plannedMeals} comidas completadas
        </p>
      </div>

      <div
        role="progressbar"
        aria-labelledby={TITLE_ID}
        aria-valuenow={percent}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuetext={percentText}
        className="h-3 w-full overflow-hidden rounded-full bg-surface-container-high"
      >
        <div className="h-full rounded-full bg-brand-green" style={{ width: `${percent}%` }} />
      </div>

      {/* En móvil, gap, padding y etiqueta reducidos para que "Completadas" entre entera desde 320 px. */}
      <dl className="grid grid-cols-3 gap-1 sm:gap-2">
        {COUNTERS.map(({ key, label }) => (
          <div key={key} className="min-w-0 rounded-xl bg-surface-container-low px-0.5 py-3 text-center sm:p-3">
            <dt className="break-words text-[11px] font-semibold text-on-surface-variant sm:text-xs">{label}</dt>
            <dd className="mt-1 font-headline text-xl font-bold text-on-surface">{summary[key]}</dd>
          </div>
        ))}
      </dl>

      {hasNoRecords(summary) && (
        <p className="text-sm text-on-surface">Todavía no hay comidas registradas esta semana.</p>
      )}
      <p className="text-xs text-on-surface-variant">
        Incluye todas las comidas planificadas de la semana, también las de los próximos días.
      </p>
    </div>
  );
}

export function AdherenceWidget({ className = '', ...props }: Props) {
  return (
    <section aria-labelledby={TITLE_ID} className={`rounded-xl bg-surface-container p-6 ${className}`}>
      <h2 id={TITLE_ID} className="mb-4 font-headline text-xl font-semibold text-on-surface">
        Progreso de la semana
      </h2>
      <WidgetBody {...props} />
    </section>
  );
}
