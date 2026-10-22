import type { AdherenceResponse } from '../types';

/**
 * Precedencia de estados para quien consume el widget:
 * - `loading` sin `data` → skeleton.
 * - `error` sin `data` → estado de error con reintento; nunca mostrar 0% de progreso.
 * - Con `data` → se renderizan los datos; si además hay `loading` es un refresco,
 *   y un `error` no nulo es un aviso no bloqueante con reintento sobre los datos previos.
 * - `loading` y `error` juntos → gana `loading` (hay un reintento en curso).
 */
export type AdherenceWidgetProps = {
  data: AdherenceResponse | null;
  loading: boolean;
  error: string | null;
  onRetry: () => void;
};
