import { Link } from 'react-router-dom';

import nutriaIsotype from '../../../assets/nutria-isotype.png';
import { BrandMark } from '../../../common/components/BrandMark';
import {
  FOCUS_VISIBLE_CLASSES,
  PRIMARY_CTA_CLASSES,
} from '../../dashboard/components/classNames';

const TEXT_LINK_CLASSES = `inline-flex min-h-[44px] items-center rounded-xl px-2 text-sm font-bold text-brand-green hover:underline underline-offset-4 ${FOCUS_VISIBLE_CLASSES}`;

const STEPS = [
  {
    icon: 'tune',
    title: 'Completá tus preferencias',
    description: 'Contanos tus gustos, objetivos y restricciones.',
  },
  {
    icon: 'calendar_month',
    title: 'Armá tu plan',
    description: 'Obtené un plan semanal de comidas y recetas.',
  },
  {
    icon: 'shopping_basket',
    title: 'Organizá y registrá',
    description: 'Prepará tu lista de compras y registrá lo que comés.',
  },
] as const;

// The isotype PNG already draws its own circle with transparent margin, so it is not wrapped in another one.
function Isotype({ sizeClasses }: { sizeClasses: string }) {
  return (
    <img
      alt=""
      aria-hidden="true"
      className={`object-contain ${sizeClasses}`}
      height="2048"
      src={nutriaIsotype}
      width="2048"
    />
  );
}

function SignUpActions() {
  return (
    <div className="flex w-full flex-col items-center gap-2">
      <Link to="/register" className={`${PRIMARY_CTA_CLASSES} w-full`}>
        Crear cuenta
      </Link>
      <p className="flex flex-wrap items-center justify-center text-sm text-on-surface-variant">
        ¿Ya tenés cuenta?
        <Link to="/login" className={TEXT_LINK_CLASSES}>
          Iniciá sesión
        </Link>
      </p>
    </div>
  );
}

export function LandingPage() {
  return (
    <div className="flex min-h-dvh flex-col bg-brand-cream">
      <header className="sticky top-0 z-50 flex h-16 items-center justify-between border-b border-outline-variant/30 bg-brand-cream/90 px-6 backdrop-blur-md">
        <BrandMark variant="header" />
        <Link to="/login" className={TEXT_LINK_CLASSES}>
          Iniciar sesión
        </Link>
      </header>

      <main className="flex flex-1 flex-col px-6">
        <section className="flex flex-col items-center gap-4 pb-12 pt-8 text-center">
          <Isotype sizeClasses="h-24 w-24 -my-3" />
          <h1 className="font-headline text-3xl font-bold leading-tight text-on-surface">
            Planifica tus comidas, recetas y compras en un solo lugar
          </h1>
          <p className="mb-2 text-sm leading-relaxed text-on-surface-variant">
            NutrIA te ayuda a armar tu plan semanal según tus preferencias y a organizar tu lista de compras.
          </p>
          <SignUpActions />
        </section>

        <section aria-labelledby="landing-how-it-works-title" className="border-t border-outline-variant/40 py-10">
          <div className="mb-8 text-center">
            <p className="mb-1.5 text-[11px] font-bold uppercase tracking-widest text-brand-green-dark">Paso a paso</p>
            <h2 id="landing-how-it-works-title" className="font-headline text-2xl font-bold text-on-surface">
              Cómo funciona
            </h2>
          </div>
          <ol className="flex flex-col gap-4">
            {STEPS.map((step, index) => (
              <li
                key={step.title}
                className="rounded-3xl border border-outline-variant/30 bg-white p-6 shadow-[0_4px_20px_rgba(46,50,48,0.06)]"
              >
                <div className="mb-4 flex items-center justify-between">
                  <span
                    aria-hidden="true"
                    className="flex h-10 w-10 items-center justify-center rounded-full bg-surface-container text-brand-green"
                  >
                    <span className="material-symbols-outlined text-xl">{step.icon}</span>
                  </span>
                  <span aria-hidden="true" className="font-headline text-xl font-bold text-outline">
                    {String(index + 1).padStart(2, '0')}
                  </span>
                </div>
                <h3 className="mb-1.5 font-headline text-lg font-bold text-on-surface">{step.title}</h3>
                <p className="text-sm leading-relaxed text-on-surface-variant">{step.description}</p>
              </li>
            ))}
          </ol>
        </section>

        <section aria-labelledby="landing-closing-title" className="flex flex-col items-center gap-6 py-12 text-center">
          <Isotype sizeClasses="h-20 w-20 -my-3" />
          <h2 id="landing-closing-title" className="font-headline text-2xl font-bold leading-tight text-on-surface">
            Empezá a organizar tu semana
          </h2>
          <SignUpActions />
        </section>
      </main>

      <footer className="border-t border-outline-variant/40 px-6 py-6 text-center">
        <p className="text-xs text-on-surface-variant">© {new Date().getFullYear()} NutrIA</p>
      </footer>
    </div>
  );
}
