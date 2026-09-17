import nutriaIsotype from '../../assets/nutria-isotype.png';
import nutriaWordmark from '../../assets/nutria-wordmark.png';

type BrandMarkProps = {
  variant: 'auth' | 'app';
};

const variantClasses = {
  auth: 'mb-6 flex w-full min-w-0 items-center justify-center gap-1',
  app: 'mb-6 flex min-w-0 items-center justify-center gap-1',
} as const;

const wordmarkClasses = {
  auth: 'block h-auto w-36 max-w-full object-contain',
  app: 'block h-auto w-28 max-w-full object-contain',
} as const;

const isotypeClasses = {
  auth: 'block h-16 w-16 shrink-0 object-contain',
  app: 'block h-11 w-11 shrink-0 object-contain',
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
