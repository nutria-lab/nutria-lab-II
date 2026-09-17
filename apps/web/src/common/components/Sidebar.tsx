import { NavLink } from 'react-router-dom';
import { PRIMARY_NAVIGATION_ITEMS } from './navigation';
import { BrandMark } from './BrandMark';
import { NavigationIcon } from './NavigationItem';

export function Sidebar({ onLogout }: { onLogout: () => Promise<void> }) {
  return (
    <aside className="hidden w-60 shrink-0 flex-col bg-brand-cream py-6 md:flex">
      <div className="mb-6 px-4">
        <BrandMark variant="app" />
      </div>
      <nav className="flex flex-col gap-1 px-3" aria-label="Desktop navigation">
        {PRIMARY_NAVIGATION_ITEMS.map((item) => (
          <NavLink
            key={item.path}
            to={item.path}
            className={({ isActive }) =>
              `group flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-brand-green ${
                isActive
                  ? 'bg-primary-container/20 font-semibold text-brand-green'
                  : 'text-on-surface-variant hover:bg-surface-container'
              }`
            }
          >
            {({ isActive }) => (
              <>
                <NavigationIcon name={item.icon} active={isActive} />
                <span>{item.label}</span>
              </>
            )}
          </NavLink>
        ))}
      </nav>
      <div className="mt-auto px-3">
        <button
          type="button"
          onClick={() => void onLogout()}
          className="flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium text-on-surface-variant transition-colors hover:bg-surface-container focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-brand-green"
        >
          <svg
            aria-hidden="true"
            className="h-5 w-5 shrink-0"
            fill="none"
            stroke="currentColor"
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth="1.8"
            viewBox="0 0 24 24"
          >
            <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4m7 14 5-5-5-5m5 5H9" />
          </svg>
          Cerrar sesión
        </button>
      </div>
    </aside>
  );
}
