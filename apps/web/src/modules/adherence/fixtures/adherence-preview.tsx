import { useState } from 'react';
import { createRoot } from 'react-dom/client';
import '../../../index.css';
import { MealAdherenceControl, type AdherenceMeal, type MealCompletionStatus } from '..';
import { adherenceFixture } from './adherence.fixture';

const sampleMeals = adherenceFixture.days.flatMap((day) => day.meals);
const initialMeal = sampleMeals[0];
const previewError = 'No se pudo guardar el cambio. Elegí otra vez un estado para volver a intentarlo. Tu registro anterior se conserva hasta confirmar la operación.';

function FixtureExample({ meal, pending = false, error = null }: {
  meal: AdherenceMeal;
  pending?: boolean;
  error?: string | null;
}) {
  const [sample, setSample] = useState(meal);
  return <MealAdherenceControl meal={sample} pending={pending} error={error} onSetStatus={(status) => setSample((current) => ({ ...current, status }))} />;
}

function AdherencePreview() {
  const [meal, setMeal] = useState(initialMeal);
  const [requested, setRequested] = useState<MealCompletionStatus | null>(null);
  const [error, setError] = useState<string | null>(null);

  function request(status: MealCompletionStatus) {
    setError(null);
    setRequested(status);
  }

  return (
    <main className="mx-auto max-w-6xl px-4 py-8 sm:px-8 text-on-surface">
      <header className="mb-8 max-w-3xl">
        <p className="text-sm font-bold text-brand-green-dark mb-2">NutrIA · Muestra de componentes</p>
        <h1 className="text-3xl font-semibold mb-3">Registro de comidas</h1>
        <p className="leading-relaxed">Vista aislada con datos ficticios del contrato A. No conecta con la API ni guarda datos. Fecha de referencia fija: {adherenceFixture.today}.</p>
      </header>
      <section aria-labelledby="interactive-heading" className="mb-10">
        <h2 id="interactive-heading" className="text-xl font-semibold mb-3">Probá el control</h2>
        <div className="max-w-2xl">
          <MealAdherenceControl meal={meal} pending={requested !== null} error={error} onSetStatus={request} />
        </div>
        <p className="mt-3 text-sm">Elegí un estado y resolvé la simulación para probar guardado o recuperación de error.</p>
        <div className="flex flex-wrap gap-3 mt-3">
          <button type="button" disabled={requested === null} className="min-h-11 px-4 py-2 rounded-lg border border-outline font-bold disabled:opacity-50 focus-visible:outline-3 focus-visible:outline-offset-2" onClick={() => {
            if (requested !== null) setMeal((current) => ({ ...current, status: requested }));
            setRequested(null);
            setError(null);
          }}>Simular éxito</button>
          <button type="button" disabled={requested === null} className="min-h-11 px-4 py-2 rounded-lg border border-outline font-bold disabled:opacity-50 focus-visible:outline-3 focus-visible:outline-offset-2" onClick={() => {
            setRequested(null);
            setError(previewError);
          }}>Simular error</button>
        </div>
      </section>
      <section aria-labelledby="states-heading">
        <h2 id="states-heading" className="text-xl font-semibold mb-4">Estados y situaciones de referencia</h2>
        <p className="mb-4 text-sm">Cada ejemplo es independiente. Los ejemplos disponibles cambian localmente; la muestra pendiente permanece bloqueada.</p>
        <div className="grid min-w-0 gap-5 lg:grid-cols-2">
          {sampleMeals.slice(0, 3).map((sample) => (
            <FixtureExample key={sample.plannedMealId} meal={sample} />
          ))}
          <FixtureExample meal={{ ...initialMeal, title: 'Guardado en curso · Tostadas integrales' }} pending />
          <FixtureExample meal={{ ...initialMeal, title: 'Ensalada tibia de vegetales de estación con arroz integral, garbanzos, semillas y aderezo de limón' }} error={previewError} />
          <FixtureExample meal={sampleMeals[3]} />
        </div>
      </section>
    </main>
  );
}

const root = document.getElementById('root');
if (root) createRoot(root).render(<AdherencePreview />);
