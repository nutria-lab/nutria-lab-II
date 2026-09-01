import { NavLink } from 'react-router-dom';

const NAV_ITEMS = [
  { label: 'Dashboard', path: '/dashboard' },
  { label: 'Meal Plan', path: '/meal-plan' },
  { label: 'Recipes', path: '/recipes' },
  { label: 'Shopping List', path: '/shopping-list' },
  { label: 'Goals', path: '/goals' },
];

export function Sidebar() {
  return (
    <aside className="hidden w-56 shrink-0 border-r border-neutral-200 bg-white px-4 py-6 md:block">
      <p className="mb-6 font-serif text-lg font-bold text-brand-green">NutrIA</p>
      <nav className="space-y-1">
        {NAV_ITEMS.map((item) => (
          <NavLink
            key={item.path}
            to={item.path}
            className={({ isActive }) =>
              `flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium transition-colors ${
                isActive ? 'bg-brand-green text-white' : 'text-neutral-700 hover:bg-brand-cream-dark'
              }`
            }
          >
            <span className="h-2 w-2 shrink-0 rounded-full bg-current opacity-70" />
            {item.label}
          </NavLink>
        ))}
      </nav>
    </aside>
  );
}
