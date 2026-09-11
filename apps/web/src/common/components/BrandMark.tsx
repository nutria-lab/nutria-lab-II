import nutriaIcon from '../../assets/nutria-icon.png';

type BrandMarkProps = {
  variant: 'auth' | 'app';
};

const variantClasses = {
  auth: 'mb-6 flex w-full min-w-0 items-center justify-between gap-4 sm:gap-6',
  app: 'mb-6 flex min-w-0 items-center justify-center gap-2',
} as const;

export function BrandMark({ variant }: BrandMarkProps) {
  return (
    <div className={variantClasses[variant]}>
      <span className="min-w-0 font-serif text-xl font-bold tracking-[-0.025em] text-[#254a36] sm:text-2xl">
        NutrIA
      </span>
      <img
        alt=""
        aria-hidden="true"
        className="block h-10 w-auto shrink-0 object-contain sm:h-12"
        height="632"
        src={nutriaIcon}
        width="817"
      />
    </div>
  );
}
