import type { ReactNode } from 'react';
import { BottomNavigation } from './BottomNavigation';
import { Sidebar } from './Sidebar';

type AppLayoutProps = {
  children: ReactNode;
  onLogout: () => Promise<void>;
};

export function AppLayout({ children, onLogout }: AppLayoutProps) {
  return (
    <div className="flex min-h-screen bg-brand-cream">
      <Sidebar onLogout={onLogout} />
      <div className="min-w-0 flex-1 pb-[calc(5rem+env(safe-area-inset-bottom,0px))] md:pb-0">
        <header className="flex min-h-14 items-center justify-end border-b border-neutral-200 bg-white px-4 md:hidden">
          <button
            type="button"
            onClick={() => void onLogout()}
            className="min-h-11 rounded-lg px-3 py-2 text-sm font-medium text-neutral-700 focus-visible:outline focus-visible:outline-3"
          >
            Cerrar sesión en móvil
          </button>
        </header>
        {children}
      </div>
      <BottomNavigation />
    </div>
  );
}
