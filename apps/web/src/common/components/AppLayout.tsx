import type { ReactNode } from 'react';
import { Sidebar } from './Sidebar';

type AppLayoutProps = {
  children: ReactNode;
};

export function AppLayout({ children }: AppLayoutProps) {
  return (
    <div className="flex min-h-screen bg-brand-cream">
      <Sidebar />
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  );
}
