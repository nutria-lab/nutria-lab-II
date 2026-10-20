import { Link } from 'react-router-dom';

import { PRIMARY_CTA_CLASSES } from './classNames';

export function CardSkeleton({ rows }: { rows: number }) {
  return (
    <div className="animate-pulse space-y-3" aria-busy="true" aria-live="polite">
      <span className="sr-only">Cargando…</span>
      {Array.from({ length: rows }).map((_, index) => (
        <div key={index} className="h-16 rounded-xl bg-surface-container-high" />
      ))}
    </div>
  );
}

export function CardError({ message, retry }: { message: string; retry?: () => void }) {
  return (
    <div className="flex flex-col items-start gap-4">
      <p role="alert" className="text-sm font-medium text-error">
        {message}
      </p>
      {retry && (
        <button type="button" onClick={retry} className={PRIMARY_CTA_CLASSES}>
          Reintentar
        </button>
      )}
    </div>
  );
}

type CardNoticeProps = {
  icon: string;
  title: string;
  description?: string;
  action?: { label: string; to: string };
};

export function CardNotice({ icon, title, description, action }: CardNoticeProps) {
  return (
    <div className="flex flex-col items-center gap-2 py-6 text-center">
      <div className="mb-2 flex h-14 w-14 items-center justify-center rounded-full bg-surface-container-high">
        <span aria-hidden="true" className="material-symbols-outlined text-2xl text-on-surface-variant">
          {icon}
        </span>
      </div>
      <p className="font-headline text-lg font-semibold text-on-surface">{title}</p>
      {description && <p className="text-sm text-on-surface-variant">{description}</p>}
      {action && (
        <Link to={action.to} className={`mt-4 ${PRIMARY_CTA_CLASSES}`}>
          {action.label}
        </Link>
      )}
    </div>
  );
}
