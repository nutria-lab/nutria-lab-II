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
// Only below-the-fold copies defer loading; the hero copy is part of the first screen.
function Isotype({ className, deferred = false }: { className: string; deferred?: boolean }) {
  return (
    <img
      alt=""
      aria-hidden="true"
      className={`object-contain ${className}`}
      decoding={deferred ? 'async' : undefined}
      height="2048"
      loading={deferred ? 'lazy' : undefined}
      src={nutriaIsotype}
      width="2048"
    />
  );
}

function SignUpActions({ mdAlignment }: { mdAlignment: 'start' | 'center' }) {
  const alignment = mdAlignment === 'start' ? 'md:justify-start' : 'md:justify-center';
  return (
    <div className={`flex w-full flex-col items-center gap-2 md:flex-row md:gap-4 ${alignment}`}>
      <Link to="/register" className={`${PRIMARY_CTA_CLASSES} w-full md:w-auto md:px-8`}>
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
    <div className="landing-page flex min-h-dvh flex-col bg-brand-cream">
      <header className="sticky top-0 z-50 flex min-h-16 items-center justify-between gap-3 border-b border-outline-variant/30 bg-brand-cream/90 px-6 py-2 backdrop-blur-md md:min-h-20 lg:px-[max(1.5rem,calc((100%-72rem)/2+1.5rem))]">
        <BrandMark variant="header" />
        <div className="flex items-center gap-3">
          <Link to="/login" className={`${TEXT_LINK_CLASSES} whitespace-nowrap`}>
            Iniciar sesión
          </Link>
          {/* The wrapper owns the display toggle: PRIMARY_CTA_CLASSES sets inline-flex, which would compete with `hidden` on the link itself. */}
          <span className="hidden md:block">
            <Link to="/register" className={`${PRIMARY_CTA_CLASSES} whitespace-nowrap`}>
              Crear cuenta
            </Link>
          </span>
        </div>
      </header>

      <main className="mx-auto flex w-full max-w-6xl flex-1 flex-col px-6">
        <section className="flex flex-col items-center gap-4 pb-12 pt-8 text-center md:grid md:grid-cols-[minmax(0,1fr)_auto] md:content-center md:items-center md:gap-x-10 md:py-16 md:text-left lg:gap-x-16 lg:py-24">
          <Isotype className="h-24 w-24 -my-3 md:col-start-2 md:row-span-3 md:row-start-1 md:my-0 md:h-64 md:w-64 md:rounded-full md:bg-surface-container md:p-2 lg:h-80 lg:w-80 lg:p-3" />
          <h1 className="font-headline text-3xl font-bold leading-tight text-on-surface md:col-start-1 md:text-5xl lg:text-6xl">
            Planificá tus comidas, recetas y compras en un solo lugar
          </h1>
          <p className="mb-2 text-sm leading-relaxed text-on-surface-variant md:col-start-1 md:max-w-xl md:text-base lg:text-lg">
            NutrIA te ayuda a armar tu plan semanal según tus preferencias y a organizar tu lista de compras.
          </p>
          <div className="w-full md:col-start-1">
            <SignUpActions mdAlignment="start" />
          </div>
        </section>

        <section aria-labelledby="landing-how-it-works-title" className="border-t border-outline-variant/40 py-10 md:py-16 lg:py-20">
          <div className="mb-8 text-center md:mb-12">
            <p className="mb-1.5 text-[11px] font-bold uppercase tracking-widest text-brand-green-dark">Paso a paso</p>
            <h2 id="landing-how-it-works-title" className="font-headline text-2xl font-bold text-on-surface md:text-4xl">
              Cómo funciona
            </h2>
          </div>
          <ol className="flex flex-col gap-4 md:grid md:grid-cols-3 lg:gap-6">
            {STEPS.map((step, index) => (
              <li
                key={step.title}
                className="rounded-3xl border border-outline-variant/30 bg-white p-6 shadow-[0_4px_20px_rgba(46,50,48,0.06)]"
              >
                <div className="mb-4 flex items-center justify-between">
                  <span
                    aria-hidden="true"
                    className="flex h-10 w-10 items-center justify-center overflow-hidden rounded-full bg-surface-container text-brand-green"
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

        <section aria-labelledby="landing-closing-title" className="flex flex-col items-center gap-6 py-12 text-center md:py-20">
          <Isotype className="h-20 w-20 -my-3" deferred />
          <h2 id="landing-closing-title" className="font-headline text-2xl font-bold leading-tight text-on-surface md:text-4xl">
            Empezá a organizar tu semana
          </h2>
          <SignUpActions mdAlignment="center" />
        </section>
      </main>

      <footer className="border-t border-outline-variant/40 px-6 py-6 text-center">
        <p className="text-xs text-on-surface-variant">© {new Date().getFullYear()} NutrIA</p>
      </footer>
    </div>
  );
}
