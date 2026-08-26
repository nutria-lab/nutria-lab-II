import { CheckIcon } from './CheckIcon';

type BannerVariant = 'success' | 'error';

type BannerProps = {
  variant: BannerVariant;
  message: string;
};

export function Banner({ variant, message }: BannerProps) {
  const styles =
    variant === 'success'
      ? 'bg-brand-green text-white'
      : 'border border-red-300 bg-red-50 text-red-800';

  return (
    <div role="status" className={`flex items-center gap-2 rounded-lg px-4 py-3 text-sm font-medium ${styles}`}>
      {variant === 'success' && (
        <span className="flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-white/25">
          <CheckIcon className="h-3 w-3" />
        </span>
      )}
      {message}
    </div>
  );
}
