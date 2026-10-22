import { Link } from 'react-router-dom';

import { FOCUS_VISIBLE_CLASSES } from './classNames';

const QUICK_ACCESS_ITEMS = [
  {
    to: '/meal-plan',
    title: 'Ver mi plan semanal',
    description: 'Revisá las comidas de la semana',
    icon: 'calendar_month',
    tone: 'bg-primary-fixed text-on-primary-fixed',
    iconTone: 'bg-brand-green text-on-primary',
  },
  {
    to: '/recipes',
    title: 'Explorar recetas',
    description: 'Buscá ideas y preparaciones',
    icon: 'menu_book',
    tone: 'bg-secondary-fixed text-on-surface',
    iconTone: 'bg-secondary text-white',
  },
  {
    to: '/shopping-list',
    title: 'Lista de compras',
    description: 'Ingredientes de tu plan',
    icon: 'shopping_cart',
    tone: 'bg-surface-container-high text-on-surface',
    iconTone: 'bg-surface-dim text-on-surface',
  },
] as const;

export function QuickAccessLinks({ className = '' }: { className?: string }) {
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
                <span className="block text-sm opacity-80">{item.description}</span>
              </span>
              <span aria-hidden="true" className="material-symbols-outlined">
                chevron_right
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}
