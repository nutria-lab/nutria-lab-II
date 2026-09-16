import nutriaIsotype from '../../assets/nutria-isotype.png';
import nutriaWordmark from '../../assets/nutria-wordmark.png';

type BrandMarkProps = {
  variant: 'auth' | 'app';
};

const variantClasses = {
  auth: 'mb-6 flex w-full min-w-0 items-center justify-between gap-4 sm:gap-6',
  app: 'mb-6 flex min-w-0 items-center justify-center gap-2',
} as const;

const wordmarkClasses = {
  auth: 'block h-auto w-full max-w-[min(58%,18rem)] object-contain',
  app: 'block h-auto w-28 max-w-full object-contain',
} as const;

const isotypeClasses = {
  auth: 'block h-10 w-10 shrink-0 object-contain sm:h-12 sm:w-12',
  app: 'block h-8 w-8 shrink-0 object-contain',
} as const;

export function BrandMark({ variant }: BrandMarkProps) {
  return (
    <div className={variantClasses[variant]}>
      <img
        alt="NutrIA"
        className={wordmarkClasses[variant]}
        height="211"
        src={nutriaWordmark}
        width="800"
      />
      <img
        alt=""
        aria-hidden="true"
        className={isotypeClasses[variant]}
        height="2048"
        src={nutriaIsotype}
        width="2048"
      />
    </div>
  );
}
