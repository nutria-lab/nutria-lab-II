import { Link } from 'react-router-dom';

import { BrandMark } from '../../common/components/BrandMark';

type AuthBrandLinkProps = {
  /** Mientras se restaura la sesión el formulario no admite interacción, y este link tampoco. */
  disabled?: boolean;
};

// El logo de login y registro lleva a la landing pública; el aspecto de la marca no cambia.
export function AuthBrandLink({ disabled = false }: AuthBrandLinkProps) {
  return (
    <Link
      to="/"
      aria-label="NutrIA, ir al inicio"
      aria-disabled={disabled || undefined}
      tabIndex={disabled ? -1 : undefined}
      onClick={disabled ? (event) => event.preventDefault() : undefined}
      className="block rounded-xl focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-green aria-disabled:cursor-not-allowed"
    >
      <BrandMark variant="auth" />
    </Link>
  );
}
