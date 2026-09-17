import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { Modal } from './Modal';

// NUT-20 (segunda iteración, tester): el proyecto no tiene todavía ningún patrón de
// modal/overlay reutilizable (confirmado por el explorer en plan.md, sección 3 —
// "BRECHA confirmada"). Este componente lo van a reutilizar el formulario de receta, el de
// ingrediente standalone y la confirmación de borrado en iteraciones siguientes de este
// mismo ticket, así que se diseña con una API genérica y mínima:
//   <Modal open={boolean} onClose={() => void} title={string}>{children}</Modal>
// Criterio propio del tester (design.md no especifica la forma exacta de este componente,
// sólo que hace falta crear uno): overlay de fondo envolviendo directamente al contenedor
// con `role="dialog"`, botón de cierre con ícono ✕ y `aria-label="Cerrar"`, título asociado
// vía `aria-labelledby` (patrón estándar de diálogo accesible, ver WAI-ARIA Dialog Pattern).

describe('Modal', () => {
  it('does not render anything (neither the overlay nor the content) when closed', () => {
    const { container } = render(
      <Modal open={false} onClose={vi.fn()} title="Nueva Receta">
        <p>Contenido del formulario</p>
      </Modal>,
    );

    expect(container).toBeEmptyDOMElement();
    expect(screen.queryByText('Contenido del formulario')).not.toBeInTheDocument();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('renders the title and the children when open', () => {
    render(
      <Modal open onClose={vi.fn()} title="Nueva Receta">
        <p>Contenido del formulario</p>
      </Modal>,
    );

    expect(screen.getByText('Nueva Receta')).toBeInTheDocument();
    expect(screen.getByText('Contenido del formulario')).toBeInTheDocument();
  });

  it('exposes dialog accessibility semantics with the title associated via aria-labelledby', () => {
    render(
      <Modal open onClose={vi.fn()} title="Nueva Receta">
        <p>Contenido</p>
      </Modal>,
    );

    const dialog = screen.getByRole('dialog');
    expect(dialog).toHaveAttribute('aria-modal', 'true');

    const labelledBy = dialog.getAttribute('aria-labelledby');
    expect(labelledBy).toBeTruthy();

    const titleElement = document.getElementById(labelledBy as string);
    expect(titleElement).not.toBeNull();
    expect(titleElement).toHaveTextContent('Nueva Receta');
  });

  it('invokes onClose when the close button (✕, aria-label "Cerrar") is clicked', async () => {
    const onClose = vi.fn();
    const user = userEvent.setup();

    render(
      <Modal open onClose={onClose} title="Nueva Receta">
        <p>Contenido</p>
      </Modal>,
    );

    await user.click(screen.getByRole('button', { name: 'Cerrar' }));

    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('invokes onClose when the Escape key is pressed', async () => {
    const onClose = vi.fn();
    const user = userEvent.setup();

    render(
      <Modal open onClose={onClose} title="Nueva Receta">
        <p>Contenido</p>
      </Modal>,
    );

    await user.keyboard('{Escape}');

    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('invokes onClose when clicking the overlay outside the content, but not when clicking inside the content', () => {
    const onClose = vi.fn();

    render(
      <Modal open onClose={onClose} title="Nueva Receta">
        <p>Contenido del formulario</p>
      </Modal>,
    );

    // Click DENTRO del contenido: no debe propagar hasta el overlay ni invocar onClose.
    fireEvent.click(screen.getByText('Contenido del formulario'));
    expect(onClose).not.toHaveBeenCalled();

    // Click en el fondo/overlay (el padre directo del contenedor con role="dialog"): sí
    // debe invocar onClose.
    const dialog = screen.getByRole('dialog');
    const overlay = dialog.parentElement;
    expect(overlay).not.toBeNull();

    fireEvent.click(overlay as HTMLElement);

    expect(onClose).toHaveBeenCalledTimes(1);
  });
});

// NUT-20 (séptima iteración, tester) — Hallazgo 2 (bloqueante) del cuarto review: hoy, si un
// formulario envuelto en este `Modal` está enviando/borrando en curso, el modal se puede
// cerrar igual por click en el fondo o `Escape`, y la mutación en curso sigue viva. La
// corrección agrega una prop `dismissible?: boolean` (default `true`); cuando es `false`,
// ni el click en el overlay ni `Escape` deben invocar `onClose`. Se espera ROJO hoy: `Modal`
// todavía no acepta esta prop, así que con `dismissible={false}` el comportamiento actual
// (siempre cerrable) hace que estas aserciones fallen.
describe('Modal — dismissible (Hallazgo 2, cuarto review)', () => {
  it('with dismissible={false}, clicking the overlay does NOT invoke onClose', () => {
    const onClose = vi.fn();

    render(
      <Modal open onClose={onClose} title="Nueva Receta" dismissible={false}>
        <p>Contenido del formulario</p>
      </Modal>,
    );

    const dialog = screen.getByRole('dialog');
    const overlay = dialog.parentElement as HTMLElement;
    fireEvent.click(overlay);

    expect(onClose).not.toHaveBeenCalled();
    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });

  it('with dismissible={false}, pressing Escape does NOT invoke onClose', async () => {
    const onClose = vi.fn();
    const user = userEvent.setup();

    render(
      <Modal open onClose={onClose} title="Nueva Receta" dismissible={false}>
        <p>Contenido del formulario</p>
      </Modal>,
    );

    await user.keyboard('{Escape}');

    expect(onClose).not.toHaveBeenCalled();
    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });

  // Hallazgo de review externo, verificado en el código real: Modal.tsx línea ~72-79, el botón
  // "✕" (aria-label "Cerrar") llama a `onClose` incondicionalmente, sin mirar `dismissible`,
  // a diferencia del overlay y de Escape (que sí lo respetan, ver tests arriba). Esto permite
  // cerrar el modal por la "✕" con `dismissible={false}` y abandonar una mutación en curso.
  // Se contrasta con el test "invokes onClose when the close button... is clicked" de arriba
  // (dismissible por default / true), que sí debe seguir invocando onClose. Se espera ROJO hoy.
  it('with dismissible={false}, clicking the close button ("✕", aria-label "Cerrar") does NOT invoke onClose', async () => {
    const onClose = vi.fn();
    const user = userEvent.setup();

    render(
      <Modal open onClose={onClose} title="Nueva Receta" dismissible={false}>
        <p>Contenido del formulario</p>
      </Modal>,
    );

    await user.click(screen.getByRole('button', { name: 'Cerrar' }));

    expect(onClose).not.toHaveBeenCalled();
    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });

  it('with dismissible={true} explicitly, the overlay/Escape keep closing the modal (no regression)', async () => {
    const onClose = vi.fn();
    const user = userEvent.setup();

    render(
      <Modal open onClose={onClose} title="Nueva Receta" dismissible={true}>
        <p>Contenido del formulario</p>
      </Modal>,
    );

    const dialog = screen.getByRole('dialog');
    const overlay = dialog.parentElement as HTMLElement;
    fireEvent.click(overlay);
    expect(onClose).toHaveBeenCalledTimes(1);

    await user.keyboard('{Escape}');
    expect(onClose).toHaveBeenCalledTimes(2);
  });

  it('without the dismissible prop at all (default), the overlay/Escape keep closing the modal (no regression)', async () => {
    const onClose = vi.fn();
    const user = userEvent.setup();

    render(
      <Modal open onClose={onClose} title="Nueva Receta">
        <p>Contenido del formulario</p>
      </Modal>,
    );

    const dialog = screen.getByRole('dialog');
    const overlay = dialog.parentElement as HTMLElement;
    fireEvent.click(overlay);
    expect(onClose).toHaveBeenCalledTimes(1);

    await user.keyboard('{Escape}');
    expect(onClose).toHaveBeenCalledTimes(2);
  });
});
