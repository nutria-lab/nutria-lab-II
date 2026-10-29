import type { AdherenceResponse } from '../types';

/**
 * Props del widget de adherencia.
 *
 * Precedencia de estados:
 * - `data` + `loading` → refresco: se mantienen los datos.
 * - `data` + `error` → aviso no bloqueante con Reintentar.
 * - `loading` + `error` → gana `loading`.
 * - `loading` sin `data` → skeleton.
 * - `error` sin `data` → error con Reintentar; nunca 0% de progreso.
 * - `data: null` + `loading: false` + `error: null` → "No disponible todavía":
 *   NO es un estado de carga: es el estado sin usuario en sesión o tras un 401 mientras la sesión redirige.
 *
 * El 401 lo resuelve el manejador global de sesión; el widget nunca lo recibe y el coordinador no lo pasa como error.
 */
export type AdherenceWidgetProps = {
  /** Respuesta del contrato A, o `null` si aún no hay; `null` NO significa cargando. */
  data: AdherenceResponse | null;
  /** Hay una petición en curso; con `data` es un refresco. */
  loading: boolean;
  /** Mensaje interno breve para logs o decisiones; NUNCA se muestra al usuario (la UI usa copy fijo). `null` si no hay error. */
  error: string | null;
  /** Reintenta la petición; obligatorio para que todo error tenga salida. */
  onRetry: () => void;
};
