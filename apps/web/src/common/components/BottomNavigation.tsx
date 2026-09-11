import { NavLink } from 'react-router-dom';
import { PRIMARY_NAVIGATION_ITEMS } from './navigation';

export function BottomNavigation() {
  return (
    <nav
      aria-label="Mobile navigation"
      className="fixed inset-x-0 bottom-0 z-40 border-t border-neutral-200 bg-white pb-[env(safe-area-inset-bottom,0px)] shadow-[0_-2px_8px_rgba(0,0,0,0.06)] md:hidden"
    >
      <div className="mx-auto flex h-20 max-w-lg">
        {PRIMARY_NAVIGATION_ITEMS.map((item) => (
          <NavLink
            key={item.path}
            to={item.path}
            className={({ isActive }) =>
              `flex h-20 min-h-11 min-w-0 flex-1 items-center justify-center border-t-2 px-1 text-center text-xs font-medium leading-tight transition-colors focus-visible:z-10 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-brand-green ${
                isActive
                  ? 'border-brand-green bg-brand-cream font-semibold text-brand-green'
                  : 'border-transparent text-neutral-700 hover:bg-brand-cream-dark'
              }`
            }
          >
            <span className="min-w-0">{item.label}</span>
          </NavLink>
        ))}
      </div>
    </nav>
  );
}
