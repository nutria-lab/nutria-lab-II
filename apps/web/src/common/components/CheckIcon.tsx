type CheckIconProps = {
  className?: string;
};

export function CheckIcon({ className }: CheckIconProps) {
  return (
    <svg
      viewBox="0 0 20 20"
      fill="currentColor"
      className={className}
      aria-hidden="true"
    >
      <path
        fillRule="evenodd"
        d="M16.704 5.29a1 1 0 0 1 0 1.415l-7.5 7.5a1 1 0 0 1-1.415 0l-3.5-3.5a1 1 0 1 1 1.415-1.415L8.5 12.086l6.79-6.795a1 1 0 0 1 1.414 0Z"
        clipRule="evenodd"
      />
    </svg>
  );
}
