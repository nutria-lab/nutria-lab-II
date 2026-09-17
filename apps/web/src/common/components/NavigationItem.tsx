import { NavLink } from 'react-router-dom';
import type { PRIMARY_NAVIGATION_ITEMS } from './navigation';

export type NavigationIconName = (typeof PRIMARY_NAVIGATION_ITEMS)[number]['icon'];

export type NavigationItemProps = {
  to: string;
  label: string;
  icon: NavigationIconName;
  className?: string;
};

export function NavigationIcon({
  name,
  active = false,
}: {
  name: NavigationIconName;
  active?: boolean;
}) {
  const outlinedPaths: Record<NavigationIconName, string> = {
    home: 'M3 10.5 12 3l9 7.5V21a1 1 0 0 1-1 1h-5v-7H9v7H4a1 1 0 0 1-1-1z',
    calendar: 'M5 4h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2zm0 5h14M8 2v4m8-4v4',
    book: 'M4 4.5A2.5 2.5 0 0 1 6.5 2H20v18H6.5A2.5 2.5 0 0 0 4 22zm0-17.5V22',
    cart: 'M3 4h2l2.2 11.2a2 2 0 0 0 2 1.6h7.8a2 2 0 0 0 2-1.6L21 8H6m3 13a1 1 0 1 0 0 2 1 1 0 0 0 0-2m8 0a1 1 0 1 0 0 2 1 1 0 0 0 0-2',
    target: 'M12 2a10 10 0 1 0 10 10M12 6a6 6 0 1 0 6 6m-6-2a2 2 0 1 0 2 2',
  };

  const filledPaths: Record<NavigationIconName, string> = {
    home: 'M12 3 2 11.5h3V21a1 1 0 0 0 1 1h5v-6h2v6h5a1 1 0 0 0 1-1v-9.5h3z',
    calendar: 'M19 4h-1V2h-2v2H8V2H6v2H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6a2 2 0 0 0-2-2zm0 16H5V9h14v11z',
    book: 'M18 2H6c-1.1 0-2 .9-2 2v16c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2zm0 18H6V4h2v8l2.5-1.5L13 12V4h5v16z',
    cart: 'M7 18c-1.1 0-1.99.9-1.99 2S5.9 22 7 22s2-.9 2-2-.9-2-2-2zm10 0c-1.1 0-1.99.9-1.99 2s.89 2 1.99 2 2-.9 2-2-.9-2-2-2zm-9.83-3.25.03-.12.9-1.63h7.45c.75 0 1.41-.41 1.75-1.03l3.58-6.49A1.003 1.003 0 0 0 20 4H5.21l-.94-2H1v2h2l3.6 7.59-1.35 2.44C4.52 15.37 5.48 17 7 17h12v-2H7.42c-.14 0-.25-.11-.25-.25z',
    target: 'M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm0 18c-4.42 0-8-3.58-8-8s3.58-8 8-8 8 3.58 8 8-3.58 8-8 8zm0-14c-3.31 0-6 2.69-6 6s2.69 6 6 6 6-2.69 6-6-2.69-6-6-6zm0 10c-2.21 0-4-1.79-4-4s1.79-4 4-4 4 1.79 4 4-1.79 4-4 4zm0-6c-1.1 0-2 .9-2 2s.9 2 2 2 2-.9 2-2-.9-2-2-2z',
  };

  if (active) {
    return (
      <svg
        aria-hidden="true"
        data-active="true"
        className="h-5 w-5 shrink-0 transition-transform"
        fill="currentColor"
        viewBox="0 0 24 24"
      >
        <path d={filledPaths[name]} />
      </svg>
    );
  }

  return (
    <svg
      aria-hidden="true"
      data-active="false"
      className="h-5 w-5 shrink-0 transition-transform"
      fill="none"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth="1.8"
      viewBox="0 0 24 24"
    >
      <path d={outlinedPaths[name]} />
    </svg>
  );
}

export function NavigationItem({ to, label, icon, className = '' }: NavigationItemProps) {
  return (
    <NavLink
      to={to}
      className={({ isActive }) =>
        `flex h-20 min-h-[44px] min-w-0 flex-1 flex-col items-center justify-center gap-1 px-1 text-center text-[10px] transition-colors focus-visible:z-10 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-brand-green ${
          isActive
            ? 'font-bold text-brand-green'
            : 'font-medium text-stone-500 hover:text-stone-700'
        } ${className}`
      }
    >
      {({ isActive }) => (
        <>
          <NavigationIcon name={icon} active={isActive} />
          <span className="min-w-0 truncate">{label}</span>
        </>
      )}
    </NavLink>
  );
}
