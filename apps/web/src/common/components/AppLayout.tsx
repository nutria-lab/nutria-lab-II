import type { ReactNode } from 'react';
import { BottomNavigation } from './BottomNavigation';
import { Sidebar } from './Sidebar';
import { TopBar } from './TopBar';
import type { AuthenticatedUser } from '../../services/authService';


type AppLayoutProps = {
  children: ReactNode;
  onLogout: () => Promise<void>;
  user?: AuthenticatedUser | null;
};

export function AppLayout({ children, onLogout, user = null }: AppLayoutProps) {
  return (
    <div className="flex min-h-screen bg-brand-cream">
      <Sidebar onLogout={onLogout} />
      <div className="flex min-w-0 flex-1 flex-col">
        <TopBar user={user} />
        {/* pt-16 on md+ compensates the fixed 64px TopBar */}
        <div className="min-w-0 flex-1 pb-[calc(5rem+env(safe-area-inset-bottom,0px))] md:pb-0 md:pt-16">
          {children}
        </div>
      </div>
      <BottomNavigation />
    </div>
  );
}
