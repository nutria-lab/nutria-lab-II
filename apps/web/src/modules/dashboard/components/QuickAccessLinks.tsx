import { Link } from 'react-router-dom';

import type { CardState, ShoppingProgress } from '../types';
import { FOCUS_VISIBLE_CLASSES, PRIMARY_CTA_CLASSES } from './classNames';

// Vocabulario de la lista de compras (NUT-89). Los contadores son los del contrato C, sin recalcular.
function shoppingDescription(shopping: CardState<ShoppingProgress>, fallback: string): string {
  if (shopping.kind !== 'ready' || shopping.data.plan === null) return fallback;
  const { totalItems, checkedItems } = shopping.data.summary;
  return totalItems === 0 ? 'Todavía no hay productos para marcar.' : `${checkedItems} de ${totalItems} marcados`;
}

const QUICK_ACCESS_ITEMS = [
  {
    to: '/meal-plan',
    showsShoppingProgress: false,
    title: 'Ver mi plan semanal',
    description: 'Revisá las comidas de la semana',
    icon: 'calendar_month',
    tone: 'bg-primary-fixed text-on-primary-fixed',
    iconTone: 'bg-brand-green text-on-primary',
  },
  {
    to: '/recipes',
    showsShoppingProgress: false,
    title: 'Explorar recetas',
    description: 'Buscá ideas y preparaciones',
    icon: 'menu_book',
    tone: 'bg-secondary-fixed text-on-surface',
    iconTone: 'bg-secondary text-white',
  },
  {
    to: '/shopping-list',
    showsShoppingProgress: true,
    title: 'Lista de compras',
    description: 'Ingredientes de tu plan',
    icon: 'shopping_cart',
    tone: 'bg-surface-container-high text-on-surface',
    iconTone: 'bg-surface-dim text-on-surface',
  },
] as const;

type Props = {
  shopping: CardState<ShoppingProgress>;
  className?: string;
};

export function QuickAccessLinks({ shopping, className = '' }: Props) {
  return (
    <nav aria-labelledby="dashboard-quick-access-title" className={className}>
      <h2 id="dashboard-quick-access-title" className="mb-4 font-headline text-xl font-semibold text-on-surface">
        Accesos rápidos
      </h2>
      <ul role="list" className="grid gap-3 md:grid-cols-3">
        {QUICK_ACCESS_ITEMS.map((item) => (
          <li key={item.to}>
            <Link
              to={item.to}
              className={`flex min-h-[44px] items-center gap-4 rounded-xl p-4 transition-opacity hover:opacity-90 ${item.tone} ${FOCUS_VISIBLE_CLASSES}`}
            >
              <span
                aria-hidden="true"
                className={`flex h-12 w-12 shrink-0 items-center justify-center rounded-lg ${item.iconTone}`}
              >
                <span className="material-symbols-outlined text-2xl">{item.icon}</span>
              </span>
              <span className="min-w-0 flex-1">
                <span className="block font-semibold">{item.title}</span>
                <span className="block break-words text-sm opacity-80">
                  {item.showsShoppingProgress ? shoppingDescription(shopping, item.description) : item.description}
                </span>
              </span>
              <span aria-hidden="true" className="material-symbols-outlined">
                chevron_right
              </span>
            </Link>
            {/* El reintento va fuera del enlace: un botón dentro de un enlace no es accesible. */}
            {item.showsShoppingProgress && shopping.kind === 'error' && (
              <div role="alert" className="mt-2 flex flex-wrap items-center justify-between gap-3 px-1">
                <p className="text-sm text-on-surface-variant">No pudimos cargar el avance de tus compras.</p>
                <button type="button" onClick={shopping.retry} className={PRIMARY_CTA_CLASSES}>
                  Reintentar
                </button>
              </div>
            )}
          </li>
        ))}
      </ul>
    </nav>
  );
}
