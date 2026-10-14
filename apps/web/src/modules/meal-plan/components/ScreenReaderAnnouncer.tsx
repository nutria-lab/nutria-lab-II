type ScreenReaderAnnouncerProps = {
  message: string;
};

export function ScreenReaderAnnouncer({ message }: ScreenReaderAnnouncerProps) {
  return (
    <div
      role="status"
      aria-live="polite"
      aria-atomic="true"
      className="sr-only"
      data-testid="screen-reader-announcer"
    >
      {message}
    </div>
  );
}
