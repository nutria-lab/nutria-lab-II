import { ConfigService } from '@nestjs/config';

const DEFAULT_PENDING_TTL_MINUTES = 10;

// PENDING más viejo que MEAL_REPLACEMENT_PENDING_TTL_MINUTES (por defecto 10): el intento se colgó.
// Lo usan el reemplazo de una comida (NUT-77) y la generación del plan semanal (NUT-74).
export function isStalePendingRun(
  run: { status: string; startedAt?: Date | string; createdAt?: Date | string },
  config: ConfigService,
): boolean {
  if (run.status !== 'PENDING') return false;
  const configured = Number(config.get<string>('MEAL_REPLACEMENT_PENDING_TTL_MINUTES'));
  const ttlMinutes = Number.isFinite(configured) && configured > 0 ? configured : DEFAULT_PENDING_TTL_MINUTES;
  const startedAt = new Date(run.startedAt ?? run.createdAt ?? Date.now()).getTime();
  return Date.now() - startedAt > ttlMinutes * 60_000;
}
