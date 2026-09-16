import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { IngredientForm } from './IngredientForm';
import {
  ingredientService,
  IngredientRequestError,
  type CreateIngredientRequest,
  type Ingredient,
} from '../../../services/ingredientService';

// NUT-20 (tercera iteración, tester) — `IngredientForm` todavía NO EXISTE. Reemplaza el
// placeholder `<p>Formulario próximamente.</p>` que hoy muestra el modal "Nuevo Ingrediente"
// de `RecipesListPage` (ver design.md secciones 2.2/4.1/5 y `CreateIngredientRequest` real
// en `ingredientService.ts`). Se espera ROJO hoy por módulo inexistente.
//
// Mismo patrón de mock que `RecipesListPage.test.tsx` (mockear el módulo completo con
// `importOriginal` + override del método relevante), aplicado acá a `ingredientService`
// completo en vez de a un hook, porque este componente llama al servicio directamente.
vi.mock('../../../services/ingredientService', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../services/ingredientService')>();
  return {
    ...actual,
    ingredientService: {
      ...actual.ingredientService,
      create: vi.fn(),
    },
  };
});

// Criterio propio del tester, documentado en el informe final: los 6 campos numéricos
// (calorías/proteínas/carbohidratos/grasas/fibra/sodio) se esperan implementados como
// `<input type="text" inputMode="decimal">`, NO `type="number"`. Un `type="number"` real
// sanitiza el `.value` a `""` apenas la cadena no es un float válido (tanto en navegadores
// reales, que bloquean la tecla, como en jsdom, que sanea el valor resultante) — eso hace
// indistinguible "el usuario escribió 'abc'" de "el usuario no escribió nada", y estas
// pruebas necesitan poder diferenciar ambos casos de forma determinística. Con texto libre,
// la validación y el mensaje de error los controla el propio componente.
const REQUIRED_TEXT_ERROR = 'Este campo es obligatorio.';
const REQUIRED_TYPE_ERROR = 'Seleccioná un tipo.';
const INVALID_NUMBER_ERROR = 'Ingresá un valor numérico mayor o igual a 0.';
const CONFLICT_ERROR = 'Ya existe un ingrediente con ese nombre.';
const VALIDATION_ERROR = 'Revisá los campos del formulario e intentá de nuevo.';
const CONNECTIVITY_ERROR = 'No pudimos conectar. Revisá tu conexión e intentá de nuevo.';

function buildIngredient(overrides: Partial<Ingredient> = {}): Ingredient {
  return {
    id: 'ingredient-1',
    name: 'Quinoa',
    description: 'Cereal andino sin gluten',
    type: 'GRAIN',
    defaultUnit: 'g',
    nutritionalValues: { calories: 120, protein: 4, carbs: 21, fat: 2, fiber: 3, sodium: 5 },
    properties: ['Vegano'],
    createdAt: '2026-09-01T00:00:00.000Z',
    updatedAt: '2026-09-01T00:00:00.000Z',
    ...overrides,
  };
}

function createDeferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

// Completa sólo los campos obligatorios, con valores válidos: nombre, tipo, unidad
// habitual y los 4 valores nutricionales obligatorios (calorías/proteínas/carbos/grasas).
// Descripción, fibra, sodio y propiedades quedan sin tocar (todos opcionales).
async function fillMinimalValidForm(user: ReturnType<typeof userEvent.setup>) {
  await user.type(screen.getByLabelText(/^Nombre/i), 'Quinoa');
  await user.selectOptions(screen.getByRole('combobox', { name: /^Tipo/i }), 'GRAIN');
  await user.type(screen.getByLabelText(/Unidad de Medida Habitual/i), 'g');
  await user.type(screen.getByLabelText(/^Calorías/i), '120');
  await user.type(screen.getByLabelText(/^Proteínas/i), '4');
  await user.type(screen.getByLabelText(/^Carbohidratos/i), '21');
  await user.type(screen.getByLabelText(/^Grasas/i), '2');
}

// Completa además los campos opcionales, para probar el envío "completo".
async function fillFullValidForm(user: ReturnType<typeof userEvent.setup>) {
  await fillMinimalValidForm(user);
  await user.type(screen.getByLabelText(/^Descripción/i), 'Cereal andino sin gluten');
  await user.type(screen.getByLabelText(/^Fibra/i), '3');
  await user.type(screen.getByLabelText(/^Sodio/i), '5');
  await user.type(screen.getByLabelText(/Propiedades y Restricciones/i), 'Vegano');
}

function lastCreatePayload(): CreateIngredientRequest | undefined {
  const calls = vi.mocked(ingredientService.create).mock.calls;
  return calls[calls.length - 1]?.[0];
}

afterEach(() => {
  vi.resetAllMocks();
});

describe('IngredientForm — validación de campos obligatorios', () => {
  it('no llama a ingredientService.create y marca cada campo obligatorio vacío al enviar el formulario en blanco', async () => {
    const user = userEvent.setup();
    render(<IngredientForm onSuccess={vi.fn()} onCancel={vi.fn()} />);

    const saveButton = screen.getByRole('button', { name: 'Guardar Ingrediente' });
    // Criterio propio: el botón queda siempre habilitado (no se deshabilita por estado de
    // formulario incompleto) para que la usuaria pueda intentar enviar y ver los errores.
    expect(saveButton).toBeEnabled();

    await user.click(saveButton);

    expect(ingredientService.create).not.toHaveBeenCalled();

    expect(screen.getByTestId('error-name')).toHaveTextContent(REQUIRED_TEXT_ERROR);
    expect(screen.getByTestId('error-type')).toHaveTextContent(REQUIRED_TYPE_ERROR);
    expect(screen.getByTestId('error-defaultUnit')).toHaveTextContent(REQUIRED_TEXT_ERROR);
    expect(screen.getByTestId('error-calories')).toHaveTextContent(INVALID_NUMBER_ERROR);
    expect(screen.getByTestId('error-protein')).toHaveTextContent(INVALID_NUMBER_ERROR);
    expect(screen.getByTestId('error-carbs')).toHaveTextContent(INVALID_NUMBER_ERROR);
    expect(screen.getByTestId('error-fat')).toHaveTextContent(INVALID_NUMBER_ERROR);

    // Los campos opcionales, vacíos, nunca deben mostrar un error de obligatoriedad.
    expect(screen.queryByTestId('error-fiber')).not.toBeInTheDocument();
    expect(screen.queryByTestId('error-sodium')).not.toBeInTheDocument();
    expect(screen.queryByTestId('error-properties')).not.toBeInTheDocument();
  });
});

describe('IngredientForm — validación numérica', () => {
  it('bloquea el envío y muestra un error cuando un campo numérico obligatorio no es numérico', async () => {
    const user = userEvent.setup();
    render(<IngredientForm onSuccess={vi.fn()} onCancel={vi.fn()} />);

    await user.type(screen.getByLabelText(/^Nombre/i), 'Quinoa');
    await user.selectOptions(screen.getByRole('combobox', { name: /^Tipo/i }), 'GRAIN');
    await user.type(screen.getByLabelText(/Unidad de Medida Habitual/i), 'g');
    await user.type(screen.getByLabelText(/^Calorías/i), 'abc');
    await user.type(screen.getByLabelText(/^Proteínas/i), '4');
    await user.type(screen.getByLabelText(/^Carbohidratos/i), '21');
    await user.type(screen.getByLabelText(/^Grasas/i), '2');

    await user.click(screen.getByRole('button', { name: 'Guardar Ingrediente' }));

    expect(screen.getByTestId('error-calories')).toHaveTextContent(INVALID_NUMBER_ERROR);
    expect(ingredientService.create).not.toHaveBeenCalled();
  });

  it('bloquea el envío y muestra un error cuando un campo numérico obligatorio es negativo', async () => {
    const user = userEvent.setup();
    render(<IngredientForm onSuccess={vi.fn()} onCancel={vi.fn()} />);

    await user.type(screen.getByLabelText(/^Nombre/i), 'Quinoa');
    await user.selectOptions(screen.getByRole('combobox', { name: /^Tipo/i }), 'GRAIN');
    await user.type(screen.getByLabelText(/Unidad de Medida Habitual/i), 'g');
    await user.type(screen.getByLabelText(/^Calorías/i), '120');
    await user.type(screen.getByLabelText(/^Proteínas/i), '-3');
    await user.type(screen.getByLabelText(/^Carbohidratos/i), '21');
    await user.type(screen.getByLabelText(/^Grasas/i), '2');

    await user.click(screen.getByRole('button', { name: 'Guardar Ingrediente' }));

    expect(screen.getByTestId('error-protein')).toHaveTextContent(INVALID_NUMBER_ERROR);
    expect(ingredientService.create).not.toHaveBeenCalled();
  });

  it('bloquea el envío y muestra un error cuando un campo numérico opcional (fibra) se carga en negativo', async () => {
    const user = userEvent.setup();
    render(<IngredientForm onSuccess={vi.fn()} onCancel={vi.fn()} />);

    await fillMinimalValidForm(user);
    await user.type(screen.getByLabelText(/^Fibra/i), '-1');

    await user.click(screen.getByRole('button', { name: 'Guardar Ingrediente' }));

    expect(screen.getByTestId('error-fiber')).toHaveTextContent(INVALID_NUMBER_ERROR);
    expect(ingredientService.create).not.toHaveBeenCalled();
  });

  it('bloquea el envío y muestra un error cuando un campo numérico opcional (sodio) no es numérico', async () => {
    const user = userEvent.setup();
    render(<IngredientForm onSuccess={vi.fn()} onCancel={vi.fn()} />);

    await fillMinimalValidForm(user);
    await user.type(screen.getByLabelText(/^Sodio/i), 'muchisimo');

    await user.click(screen.getByRole('button', { name: 'Guardar Ingrediente' }));

    expect(screen.getByTestId('error-sodium')).toHaveTextContent(INVALID_NUMBER_ERROR);
    expect(ingredientService.create).not.toHaveBeenCalled();
  });
});

describe('IngredientForm — serialización de "Propiedades y Restricciones"', () => {
  it('serializa el texto separado por comas a un array recortado al enviar', async () => {
    const user = userEvent.setup();
    vi.mocked(ingredientService.create).mockResolvedValue(buildIngredient());
    render(<IngredientForm onSuccess={vi.fn()} onCancel={vi.fn()} />);

    await fillMinimalValidForm(user);
    await user.type(
      screen.getByLabelText(/Propiedades y Restricciones/i),
      'Vegano, Sin Gluten,  Alto en Fibra',
    );

    await user.click(screen.getByRole('button', { name: 'Guardar Ingrediente' }));

    await waitFor(() => expect(ingredientService.create).toHaveBeenCalledTimes(1));
    expect(lastCreatePayload()?.properties).toEqual(['Vegano', 'Sin Gluten', 'Alto en Fibra']);
  });

  it('envía properties: [] cuando el campo de propiedades queda vacío', async () => {
    const user = userEvent.setup();
    vi.mocked(ingredientService.create).mockResolvedValue(buildIngredient());
    render(<IngredientForm onSuccess={vi.fn()} onCancel={vi.fn()} />);

    await fillMinimalValidForm(user);
    await user.click(screen.getByRole('button', { name: 'Guardar Ingrediente' }));

    await waitFor(() => expect(ingredientService.create).toHaveBeenCalledTimes(1));
    expect(lastCreatePayload()?.properties).toEqual([]);
  });
});

describe('IngredientForm — fibra/sodio opcionales', () => {
  it('envía el alta sin fiber/sodium en el payload cuando ambos quedan sin completar', async () => {
    const user = userEvent.setup();
    vi.mocked(ingredientService.create).mockResolvedValue(buildIngredient());
    render(<IngredientForm onSuccess={vi.fn()} onCancel={vi.fn()} />);

    await fillMinimalValidForm(user);
    await user.click(screen.getByRole('button', { name: 'Guardar Ingrediente' }));

    await waitFor(() => expect(ingredientService.create).toHaveBeenCalledTimes(1));
    // `toEqual` trata una clave ausente igual que una clave presente con valor `undefined`,
    // así que esta aserción es válida tanto si el componente omite `fiber`/`sodium` del
    // objeto como si los incluye como `undefined` — cualquiera de las dos formas es
    // aceptable siempre que sea consistente (ver informe final del tester).
    expect(lastCreatePayload()).toEqual({
      name: 'Quinoa',
      type: 'GRAIN',
      defaultUnit: 'g',
      nutritionalValues: { calories: 120, protein: 4, carbs: 21, fat: 2 },
      properties: [],
    });
  });
});

describe('IngredientForm — envío exitoso completo', () => {
  it('llama a ingredientService.create una vez con el CreateIngredientRequest exacto e invoca onSuccess con el ingrediente creado', async () => {
    const user = userEvent.setup();
    const onSuccess = vi.fn();
    const created = buildIngredient({ id: 'ingredient-new' });
    vi.mocked(ingredientService.create).mockResolvedValue(created);
    render(<IngredientForm onSuccess={onSuccess} onCancel={vi.fn()} />);

    await fillFullValidForm(user);
    await user.click(screen.getByRole('button', { name: 'Guardar Ingrediente' }));

    await waitFor(() => expect(onSuccess).toHaveBeenCalledTimes(1));
    expect(ingredientService.create).toHaveBeenCalledTimes(1);
    expect(lastCreatePayload()).toEqual({
      name: 'Quinoa',
      description: 'Cereal andino sin gluten',
      type: 'GRAIN',
      defaultUnit: 'g',
      nutritionalValues: { calories: 120, protein: 4, carbs: 21, fat: 2, fiber: 3, sodium: 5 },
      properties: ['Vegano'],
    });
    expect(onSuccess).toHaveBeenCalledWith(created);
  });
});

describe('IngredientForm — estado de envío en curso', () => {
  it('deshabilita "Guardar Ingrediente" mientras la petición está pendiente, para evitar doble envío', async () => {
    const user = userEvent.setup();
    const { promise, resolve } = createDeferred<Ingredient>();
    vi.mocked(ingredientService.create).mockReturnValue(promise);
    const onSuccess = vi.fn();
    render(<IngredientForm onSuccess={onSuccess} onCancel={vi.fn()} />);

    await fillMinimalValidForm(user);
    const saveButton = screen.getByRole('button', { name: 'Guardar Ingrediente' });
    await user.click(saveButton);

    expect(saveButton).toBeDisabled();
    expect(ingredientService.create).toHaveBeenCalledTimes(1);

    // Un segundo click mientras está deshabilitado no debe disparar un segundo alta.
    await user.click(saveButton);
    expect(ingredientService.create).toHaveBeenCalledTimes(1);

    resolve(buildIngredient());
    await waitFor(() => expect(onSuccess).toHaveBeenCalledTimes(1));
  });
});

// NUT-20 (séptima iteración, tester) — Hallazgo 2 (bloqueante) del cuarto review: mismo
// criterio que `RecipeForm.test.tsx`. Mientras el formulario está enviando, "Cancelar" debe
// deshabilitarse, y un `onSubmittingChange?: (submitting: boolean) => void` opcional debe
// invocarse al arrancar y al terminar el envío (éxito o error), para que el `Modal` padre
// pueda dejar de ser cerrable mientras dura la mutación. Se espera ROJO hoy.
describe('IngredientForm — cancelar deshabilitado durante envío y onSubmittingChange (Hallazgo 2, cuarto review)', () => {
  it('deshabilita el botón "Cancelar" mientras la petición está pendiente', async () => {
    const user = userEvent.setup();
    const { promise, resolve } = createDeferred<Ingredient>();
    vi.mocked(ingredientService.create).mockReturnValue(promise);
    render(<IngredientForm onSuccess={vi.fn()} onCancel={vi.fn()} />);

    await fillMinimalValidForm(user);
    const cancelButton = screen.getByRole('button', { name: 'Cancelar' });
    expect(cancelButton).toBeEnabled();

    await user.click(screen.getByRole('button', { name: 'Guardar Ingrediente' }));

    expect(cancelButton).toBeDisabled();

    resolve(buildIngredient());
    await waitFor(() => expect(cancelButton).toBeEnabled());
  });

  it('invoca onSubmittingChange(true) al arrancar el envío y onSubmittingChange(false) al resolver con éxito', async () => {
    const user = userEvent.setup();
    const { promise, resolve } = createDeferred<Ingredient>();
    vi.mocked(ingredientService.create).mockReturnValue(promise);
    const onSubmittingChange = vi.fn();
    const onSuccess = vi.fn();
    render(
      <IngredientForm onSuccess={onSuccess} onCancel={vi.fn()} onSubmittingChange={onSubmittingChange} />,
    );

    await fillMinimalValidForm(user);
    await user.click(screen.getByRole('button', { name: 'Guardar Ingrediente' }));

    expect(onSubmittingChange).toHaveBeenNthCalledWith(1, true);

    resolve(buildIngredient());
    await waitFor(() => expect(onSuccess).toHaveBeenCalledTimes(1));

    expect(onSubmittingChange).toHaveBeenLastCalledWith(false);
  });

  it('invoca onSubmittingChange(false) también cuando el envío termina en error', async () => {
    const user = userEvent.setup();
    vi.mocked(ingredientService.create).mockRejectedValue(new IngredientRequestError('network'));
    const onSubmittingChange = vi.fn();
    render(
      <IngredientForm onSuccess={vi.fn()} onCancel={vi.fn()} onSubmittingChange={onSubmittingChange} />,
    );

    await fillMinimalValidForm(user);
    await user.click(screen.getByRole('button', { name: 'Guardar Ingrediente' }));

    expect(await screen.findByText(CONNECTIVITY_ERROR)).toBeInTheDocument();
    expect(onSubmittingChange).toHaveBeenNthCalledWith(1, true);
    expect(onSubmittingChange).toHaveBeenLastCalledWith(false);
  });
});

describe('IngredientForm — error de conflicto (409, nombre duplicado)', () => {
  it('muestra un mensaje específico de nombre duplicado, no cierra el formulario y conserva los datos cargados', async () => {
    const user = userEvent.setup();
    vi.mocked(ingredientService.create).mockRejectedValue(new IngredientRequestError('conflict'));
    const onSuccess = vi.fn();
    const onCancel = vi.fn();
    render(<IngredientForm onSuccess={onSuccess} onCancel={onCancel} />);

    await fillMinimalValidForm(user);
    await user.click(screen.getByRole('button', { name: 'Guardar Ingrediente' }));

    expect(await screen.findByText(CONFLICT_ERROR)).toBeInTheDocument();
    expect(onSuccess).not.toHaveBeenCalled();
    expect(onCancel).not.toHaveBeenCalled();
    expect(screen.getByLabelText(/^Nombre/i)).toHaveValue('Quinoa');
    expect(screen.getByLabelText(/Unidad de Medida Habitual/i)).toHaveValue('g');
  });
});

describe('IngredientForm — error de validación del backend (400)', () => {
  it('muestra un mensaje genérico de validación y no cierra el formulario', async () => {
    const user = userEvent.setup();
    vi.mocked(ingredientService.create).mockRejectedValue(new IngredientRequestError('validation'));
    const onSuccess = vi.fn();
    render(<IngredientForm onSuccess={onSuccess} onCancel={vi.fn()} />);

    await fillMinimalValidForm(user);
    await user.click(screen.getByRole('button', { name: 'Guardar Ingrediente' }));

    expect(await screen.findByText(VALIDATION_ERROR)).toBeInTheDocument();
    expect(onSuccess).not.toHaveBeenCalled();
    expect(screen.getByLabelText(/^Nombre/i)).toHaveValue('Quinoa');
  });
});

describe('IngredientForm — error de red/timeout', () => {
  it.each(['network', 'timeout'] as const)(
    'muestra un mensaje de conectividad ante un error "%s" y permite reintentar sin perder los datos cargados',
    async (kind) => {
      const user = userEvent.setup();
      vi.mocked(ingredientService.create)
        .mockRejectedValueOnce(new IngredientRequestError(kind))
        .mockResolvedValueOnce(buildIngredient());
      const onSuccess = vi.fn();
      render(<IngredientForm onSuccess={onSuccess} onCancel={vi.fn()} />);

      await fillMinimalValidForm(user);
      const saveButton = screen.getByRole('button', { name: 'Guardar Ingrediente' });
      await user.click(saveButton);

      expect(await screen.findByText(CONNECTIVITY_ERROR)).toBeInTheDocument();
      expect(screen.getByLabelText(/^Nombre/i)).toHaveValue('Quinoa');
      expect(onSuccess).not.toHaveBeenCalled();

      // Reintento: mismos datos siguen cargados, reenviar el mismo formulario alcanza.
      await user.click(saveButton);

      await waitFor(() => expect(onSuccess).toHaveBeenCalledTimes(1));
      expect(ingredientService.create).toHaveBeenCalledTimes(2);
    },
  );
});

describe('IngredientForm — cancelar', () => {
  it('invoca onCancel sin llamar a ingredientService.create', async () => {
    const user = userEvent.setup();
    const onCancel = vi.fn();
    render(<IngredientForm onSuccess={vi.fn()} onCancel={onCancel} />);

    await user.click(screen.getByRole('button', { name: 'Cancelar' }));

    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(ingredientService.create).not.toHaveBeenCalled();
  });
});
