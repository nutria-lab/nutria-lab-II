import { PRIMARY_NAVIGATION_ITEMS } from './navigation';
import { NavigationItem } from './NavigationItem';

export function BottomNavigation() {
  return (
    <nav
      aria-label="Mobile navigation"
      className="fixed inset-x-0 bottom-0 z-50 border-t border-stone-200/60 bg-brand-cream pb-[env(safe-area-inset-bottom,0px)] shadow-[0_-2px_8px_rgba(0,0,0,0.04)] md:hidden"
    >
      <div className="mx-auto flex h-20 max-w-lg items-center justify-between px-2">
        {PRIMARY_NAVIGATION_ITEMS.map((item) => (
          <NavigationItem
            key={item.path}
            to={item.path}
            label={item.label}
            icon={item.icon}
          />
        ))}
      </div>
    </nav>
  );
}
