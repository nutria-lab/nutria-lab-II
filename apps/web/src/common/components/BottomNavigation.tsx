import { NavLink } from 'react-router-dom';
import { PRIMARY_NAVIGATION_ITEMS } from './navigation';

function NavigationIcon({ name }: { name: (typeof PRIMARY_NAVIGATION_ITEMS)[number]['icon'] }) {
  const paths = {
    home: 'M3 10.5 12 3l9 7.5V21a1 1 0 0 1-1 1h-5v-7H9v7H4a1 1 0 0 1-1-1z',
    calendar: 'M5 4h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2zm0 5h14M8 2v4m8-4v4',
    book: 'M4 4.5A2.5 2.5 0 0 1 6.5 2H20v18H6.5A2.5 2.5 0 0 0 4 22zm0-17.5V22',
    cart: 'M3 4h2l2.2 11.2a2 2 0 0 0 2 1.6h7.8a2 2 0 0 0 2-1.6L21 8H6m3 13a1 1 0 1 0 0 2 1 1 0 0 0 0-2m8 0a1 1 0 1 0 0 2 1 1 0 0 0 0-2',
    target: 'M12 2a10 10 0 1 0 10 10M12 6a6 6 0 1 0 6 6m-6-2a2 2 0 1 0 2 2',
  } as const;

  return <svg aria-hidden="true" className="h-5 w-5 shrink-0" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.8" viewBox="0 0 24 24"><path d={paths[name]} /></svg>;
}

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
              `flex h-20 min-h-11 min-w-0 flex-1 flex-col items-center justify-center gap-1 border-t-2 px-1 text-center text-xs font-medium leading-tight transition-colors focus-visible:z-10 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-brand-green ${
                isActive
                  ? 'border-brand-green bg-brand-cream font-semibold text-brand-green'
                  : 'border-transparent text-neutral-700 hover:bg-brand-cream-dark'
              }`
            }
          >
            <NavigationIcon name={item.icon} />
            <span className="min-w-0">{item.label}</span>
          </NavLink>
        ))}
      </div>
    </nav>
  );
}
