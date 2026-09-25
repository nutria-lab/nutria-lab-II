/**
 * TopBar — persistent sticky desktop header bar on all authenticated screens.
 *
 * Matches the Stitch Terra design:
 * - Persistent container across all screens (no separate loading or flash)
 * - h-16 fixed top-0 right-0 z-40 bg-brand-cream border-b border-outline-variant/40 px-8 shadow-sm backdrop-blur-md
 * - Left: SearchInput (variant="topbar", rounded-full, bg-surface-container, max-w-md)
 * - Right:
 *   * In recipes (/recipes*): "+ Ingrediente" (outline) + "Nueva Receta" (green) + divider + Notifications + Settings
 *   * In profile / other screens: Notifications + Settings + divider + User Name + Avatar
 */

import { useState } from 'react';
import { useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import type { AuthenticatedUser } from '../../services/authService';
import { SearchInput } from './SearchInput';

export type TopBarProps = {
  user?: AuthenticatedUser | null;
  isRecipes?: boolean;
  searchTerm?: string;
  onSearchTermChange?: (term: string) => void;
  onOpenCreateRecipe?: () => void;
  onOpenCreateIngredient?: () => void;
};

function buildInitials(user: AuthenticatedUser | null | undefined): string {
  if (!user) return '?';
  if (user.name) {
    return user.name
      .split(' ')
      .slice(0, 2)
      .map((n) => n[0])
      .join('')
      .toUpperCase();
  }
  return (user.email?.[0] ?? '?').toUpperCase();
}

export function TopBar({
  user,
  isRecipes: propIsRecipes,
  searchTerm: propSearchTerm,
  onSearchTermChange: propOnSearchTermChange,
  onOpenCreateRecipe: propOnOpenCreateRecipe,
  onOpenCreateIngredient: propOnOpenCreateIngredient,
}: TopBarProps) {
  const location = useLocation();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();

  const isRecipes = propIsRecipes ?? location.pathname.startsWith('/recipes');

  // Search state
  const [localQuery, setLocalQuery] = useState('');
  const query = isRecipes
    ? (propSearchTerm ?? (searchParams.get('q') ?? ''))
    : localQuery;

  const handleQueryChange = (val: string) => {
    if (isRecipes) {
      if (propOnSearchTermChange) {
        propOnSearchTermChange(val);
      } else {
        const next = new URLSearchParams(searchParams);
        if (val.trim()) {
          next.set('q', val);
        } else {
          next.delete('q');
        }
        setSearchParams(next, { replace: true });
      }
    } else {
      setLocalQuery(val);
    }
  };

  const handleSearchSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!isRecipes) {
      const trimmed = query.trim();
      if (trimmed) {
        navigate(`/recipes?q=${encodeURIComponent(trimmed)}`);
      } else {
        navigate('/recipes');
      }
    }
  };

  const handleCreateRecipe = () => {
    if (propOnOpenCreateRecipe) {
      propOnOpenCreateRecipe();
    } else {
      const next = new URLSearchParams(searchParams);
      next.set('panel', 'create');
      setSearchParams(next);
    }
  };

  const handleCreateIngredient = () => {
    if (propOnOpenCreateIngredient) {
      propOnOpenCreateIngredient();
    } else {
      const next = new URLSearchParams(searchParams);
      next.set('modal', 'ingredient');
      setSearchParams(next);
    }
  };

  const displayName = user?.name ?? user?.email ?? '—';
  const initials = buildInitials(user);

  return (
    <header
      className="
        fixed top-0 right-0 z-40 hidden h-16 items-center justify-between
        border-b border-outline-variant/40 bg-brand-cream px-8 shadow-sm backdrop-blur-md
        md:flex w-full md:w-[calc(100%-15rem)]
      "
    >
      {/* Search bar */}
      <form onSubmit={handleSearchSubmit} className="flex flex-1 items-center gap-4">
        <SearchInput
          id={isRecipes ? 'desktop-search' : 'topbar-search'}
          value={query}
          onChange={handleQueryChange}
          placeholder={
            isRecipes
              ? 'Buscar recetas por nombre, ingrediente o etiqueta...'
              : 'Buscar recetas o ingredientes...'
          }
          variant="topbar"
          className="w-full max-w-md"
        />
      </form>

      {/* Right section: adapts smoothly according to section */}
      <div className="flex items-center gap-3">
        {isRecipes ? (
          <>
            <button
              type="button"
              onClick={handleCreateIngredient}
              aria-label="+ Ingrediente"
              className="flex items-center gap-1.5 rounded-xl border border-outline-variant/40 bg-surface-container px-3.5 py-1.5 text-xs font-bold text-on-surface transition-all hover:bg-surface-container-high active:scale-95"
            >
              <span aria-hidden="true" className="material-symbols-outlined text-sm text-brand-green">
                nutrition
              </span>
              <span>+ Ingrediente</span>
            </button>
            <button
              type="button"
              onClick={handleCreateRecipe}
              aria-label="Nueva Receta"
              className="flex items-center gap-1.5 rounded-xl bg-brand-green px-4 py-1.5 text-xs font-bold text-white shadow-sm transition-all hover:bg-brand-green-dark active:scale-95"
            >
              <span aria-hidden="true" className="material-symbols-outlined text-sm">
                add_circle
              </span>
              <span>Nueva Receta</span>
            </button>
            <div className="mx-1 h-6 w-px bg-outline-variant/40" />
            <button
              type="button"
              aria-label="Notificaciones"
              className="p-1.5 text-on-surface-variant transition-colors hover:text-brand-green focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand-green"
            >
              <span className="material-symbols-outlined" aria-hidden="true">
                notifications
              </span>
            </button>
            <button
              type="button"
              aria-label="Configuración"
              className="p-1.5 text-on-surface-variant transition-colors hover:text-brand-green focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand-green"
            >
              <span className="material-symbols-outlined" aria-hidden="true">
                settings
              </span>
            </button>
          </>
        ) : (
          <>
            <button
              type="button"
              aria-label="Notificaciones"
              className="p-1.5 text-on-surface-variant transition-colors hover:text-brand-green focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand-green"
            >
              <span className="material-symbols-outlined" aria-hidden="true">
                notifications
              </span>
            </button>
            <button
              type="button"
              aria-label="Configuración"
              className="p-1.5 text-on-surface-variant transition-colors hover:text-brand-green focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand-green"
            >
              <span className="material-symbols-outlined" aria-hidden="true">
                settings
              </span>
            </button>

            <div className="flex items-center gap-3 border-l border-outline-variant/40 pl-4">
              <div className="hidden text-right sm:block">
                <p className="text-sm font-bold text-on-surface">{displayName}</p>
                <p className="text-xs text-on-surface-variant">Miembro Premium</p>
              </div>
              <div
                aria-label={`Avatar de ${displayName}`}
                className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full border-2 border-primary-fixed bg-primary-container text-sm font-bold text-on-primary-container"
              >
                {initials}
              </div>
            </div>
          </>
        )}
      </div>
    </header>
  );
}
