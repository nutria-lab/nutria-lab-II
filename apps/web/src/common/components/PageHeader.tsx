/**
 * PageHeader — sticky top bar that appears on all authenticated mobile screens.
 *
 * Matches the Stitch Terra design:
 * - bg-brand-cream/80 with backdrop blur
 * - Brand title (Literata, primary green) on the left
 * - Optional action slot on the right (notification icon, avatar, etc.)
 * - Sticks at top with z-50, fades border in on scroll
 */

type PageHeaderProps = {
  title?: string;
  right?: React.ReactNode;
};

export function PageHeader({ title = 'NutrIA', right }: PageHeaderProps) {
  return (
    <header className="sticky top-0 z-50 flex h-16 items-center justify-between bg-brand-cream/80 px-6 backdrop-blur-md">
      <h1 className="font-headline text-xl font-semibold text-brand-green">{title}</h1>
      {right && <div className="flex items-center gap-3">{right}</div>}
    </header>
  );
}
