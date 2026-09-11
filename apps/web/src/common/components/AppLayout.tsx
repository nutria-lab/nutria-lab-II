import type { ReactNode } from 'react';
import { BottomNavigation } from './BottomNavigation';
import { Sidebar } from './Sidebar';

type AppLayoutProps = {
  children: ReactNode;
};

export function AppLayout({ children }: AppLayoutProps) {
  return (
    <div className="flex min-h-screen bg-brand-cream">
      <Sidebar />
      <div className="min-w-0 flex-1 pb-[calc(5rem+env(safe-area-inset-bottom,0px))] md:pb-0">{children}</div>
      <BottomNavigation />
    </div>
  );
}
