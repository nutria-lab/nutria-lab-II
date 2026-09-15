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
      <div className="min-w-0 flex-1 pb-[calc(5rem+env(safe-area-inset-bottom,0px))] md:pb-0">{children}</div>
      <BottomNavigation />
    </div>
  );
}
