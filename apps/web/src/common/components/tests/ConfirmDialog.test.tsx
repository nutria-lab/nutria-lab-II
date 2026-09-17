import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { ConfirmDialog } from '../ConfirmDialog';

// NUT-20 (quinta iteración, tester): `ConfirmDialog` todavía NO EXISTE. Es la primera vez que
// el proyecto necesita una confirmación de borrado (ver design.md sección 4.2 "Confirmación
// de borrado" y la consigna del tester) — se diseña genérico y reutilizable para cualquier
// confirmación destructiva futura, apoyado en el `Modal` ya existente (reutiliza su lógica de
// overlay/click-fuera/Escape/cierre, no la duplica). Se espera ROJO hoy por módulo
// inexistente.
//
// Props: `{ open, title, message, confirmLabel, onConfirm, onCancel, isConfirming? }`.
//
// Criterio propio del tester (documentado también en el informe final):
// - `onCancel` cumple el doble rol de "Cancelar" explícito y de `onClose` del `Modal`
//   subyacente: cerrar por click-fuera/Escape tiene el mismo efecto que cancelar
//   explícitamente, no hay una acción intermedia distinta para una confirmación de borrado.
// - El botón de confirmación lleva una clase con "red" en su nombre para la variante
//   destructiva (mismo vocabulario de color que ya usan los mensajes de error de
//   `RecipeForm`/`Banner`), sin fijar el tono/variante exacto de Tailwind — no se
//   sobre-especifica el color final.

describe('ConfirmDialog', () => {
  it('renders nothing when open is false', () => {
    const { container } = render(
      <ConfirmDialog
        open={false}
        title="Eliminar receta"
        message="¿Seguro que querés eliminar esta receta? Esta acción no se puede deshacer."
        confirmLabel="Eliminar"
        onConfirm={vi.fn()}
        onCancel={vi.fn()}
      />,
    );

    expect(container).toBeEmptyDOMElement();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('shows the title, the message, and a "Cancelar" button that invokes onCancel when open', async () => {
    const onCancel = vi.fn();
    const user = userEvent.setup();

    render(
      <ConfirmDialog
        open
        title="Eliminar receta"
        message="¿Seguro que querés eliminar esta receta? Esta acción no se puede deshacer."
        confirmLabel="Eliminar"
        onConfirm={vi.fn()}
        onCancel={onCancel}
      />,
    );

    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(screen.getByText('Eliminar receta')).toBeInTheDocument();
    expect(
      screen.getByText('¿Seguro que querés eliminar esta receta? Esta acción no se puede deshacer.'),
    ).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Cancelar' }));

    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it('shows a confirm button with confirmLabel styled as destructive', () => {
    render(
      <ConfirmDialog
        open
        title="Eliminar receta"
        message="¿Seguro que querés eliminar esta receta?"
        confirmLabel="Eliminar"
        onConfirm={vi.fn()}
        onCancel={vi.fn()}
      />,
    );

    const confirmButton = screen.getByRole('button', { name: 'Eliminar' });
    expect(confirmButton).toBeInTheDocument();
    // No se sobre-especifica el tono exacto: sólo se verifica que exista alguna clase que
    // marque la variante destructiva (mismo vocabulario de color ya usado en el proyecto).
    expect(confirmButton.className).toMatch(/red/i);
  });

  it('invokes onConfirm when the confirm button is clicked', async () => {
    const onConfirm = vi.fn();
    const user = userEvent.setup();

    render(
      <ConfirmDialog
        open
        title="Eliminar receta"
        message="¿Seguro que querés eliminar esta receta?"
        confirmLabel="Eliminar"
        onConfirm={onConfirm}
        onCancel={vi.fn()}
      />,
    );

    await user.click(screen.getByRole('button', { name: 'Eliminar' }));

    expect(onConfirm).toHaveBeenCalledTimes(1);
  });

  it('disables the confirm button while isConfirming is true, to avoid a double click during the pending delete', () => {
    render(
      <ConfirmDialog
        open
        title="Eliminar receta"
        message="¿Seguro que querés eliminar esta receta?"
        confirmLabel="Eliminar"
        onConfirm={vi.fn()}
        onCancel={vi.fn()}
        isConfirming
      />,
    );

    expect(screen.getByRole('button', { name: 'Eliminar' })).toBeDisabled();
  });

  // NUT-20 (séptima iteración, tester) — Hallazgo 2 (bloqueante) del cuarto review: hoy, el
  // botón "Eliminar" se deshabilita durante `isConfirming`, pero "Cancelar" NO, y el `Modal`
  // subyacente sigue siendo cerrable por click en el fondo o `Escape` mientras el borrado
  // sigue en curso — la usuaria puede "cancelar" visualmente mientras la mutación real sigue
  // viva en segundo plano. La corrección agrega: (1) deshabilitar también "Cancelar" mientras
  // `isConfirming` es `true`, y (2) pasar `dismissible={!isConfirming}` al `Modal` interno. Se
  // espera ROJO hoy en las tres aserciones de este bloque.
  describe('ConfirmDialog — no dismissible mientras isConfirming (Hallazgo 2, cuarto review)', () => {
    it('disables the "Cancelar" button while isConfirming is true', () => {
      render(
        <ConfirmDialog
          open
          title="Eliminar receta"
          message="¿Seguro que querés eliminar esta receta?"
          confirmLabel="Eliminar"
          onConfirm={vi.fn()}
          onCancel={vi.fn()}
          isConfirming
        />,
      );

      expect(screen.getByRole('button', { name: 'Cancelar' })).toBeDisabled();
    });

    it('does not close via overlay click while isConfirming is true', () => {
      const onCancel = vi.fn();

      render(
        <ConfirmDialog
          open
          title="Eliminar receta"
          message="¿Seguro que querés eliminar esta receta?"
          confirmLabel="Eliminar"
          onConfirm={vi.fn()}
          onCancel={onCancel}
          isConfirming
        />,
      );

      const dialog = screen.getByRole('dialog');
      const overlay = dialog.parentElement as HTMLElement;
      fireEvent.click(overlay);

      expect(onCancel).not.toHaveBeenCalled();
      expect(screen.getByRole('dialog')).toBeInTheDocument();
    });

    it('does not close via Escape while isConfirming is true', async () => {
      const onCancel = vi.fn();
      const user = userEvent.setup();

      render(
        <ConfirmDialog
          open
          title="Eliminar receta"
          message="¿Seguro que querés eliminar esta receta?"
          confirmLabel="Eliminar"
          onConfirm={vi.fn()}
          onCancel={onCancel}
          isConfirming
        />,
      );

      await user.keyboard('{Escape}');

      expect(onCancel).not.toHaveBeenCalled();
      expect(screen.getByRole('dialog')).toBeInTheDocument();
    });
  });
});
