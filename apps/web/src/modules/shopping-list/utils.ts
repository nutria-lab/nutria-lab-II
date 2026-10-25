const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

export function isMondayDate(value: string): boolean {
  if (!DATE_PATTERN.test(value)) return false;
  const date = new Date(`${value}T00:00:00.000Z`);
  return (
    !Number.isNaN(date.getTime()) &&
    date.toISOString().slice(0, 10) === value &&
    date.getUTCDay() === 1
  );
}

export function shiftWeekStart(weekStart: string, weeks: number): string {
  if (!isMondayDate(weekStart)) return weekStart;
  const date = new Date(`${weekStart}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + weeks * 7);
  return date.toISOString().slice(0, 10);
}

export function formatWeekRange(weekStart: string): string {
  if (!isMondayDate(weekStart)) return "Semana no disponible";
  const start = new Date(`${weekStart}T00:00:00.000Z`);
  const end = new Date(start);
  end.setUTCDate(end.getUTCDate() + 6);
  const formatter = new Intl.DateTimeFormat("es-AR", {
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  });
  return `${formatter.format(start)} – ${formatter.format(end)}`;
}

export function formatShoppingQuantity(quantity: number): string {
  return new Intl.NumberFormat("es-AR", {
    maximumFractionDigits: 3,
    useGrouping: false,
  }).format(quantity);
}
