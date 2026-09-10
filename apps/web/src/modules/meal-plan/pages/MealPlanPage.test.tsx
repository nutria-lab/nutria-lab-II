import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MealPlanPage } from './MealPlanPage';
import { mealPlanService } from '../../../services/mealPlanService';
import { mealPlanFixture } from '../mealPlanFixture';

vi.mock('../../../services/mealPlanService', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../services/mealPlanService')>();
  return {
    ...actual,
    mealPlanService: { getCurrentMealPlan: vi.fn() },
  };
});

describe('MealPlanPage', () => {
  beforeEach(() => {
    vi.mocked(mealPlanService.getCurrentMealPlan).mockReset();
  });

  it('renders the plan for the first day once loaded', async () => {
    vi.mocked(mealPlanService.getCurrentMealPlan).mockResolvedValue(mealPlanFixture);

    render(<MealPlanPage />);

    expect(await screen.findByText('Tu plan semanal')).toBeInTheDocument();
    expect(screen.getByText('Avena con frutos rojos')).toBeInTheDocument();
    expect(screen.getByText('Bowl de quinoa y vegetales')).toBeInTheDocument();
  });

  it('lets the user switch to another day', async () => {
    vi.mocked(mealPlanService.getCurrentMealPlan).mockResolvedValue(mealPlanFixture);
    const user = userEvent.setup();

    render(<MealPlanPage />);
    await screen.findByText('Avena con frutos rojos');

    await user.click(screen.getByRole('tab', { name: /25/ }));

    await waitFor(() => {
      expect(screen.queryByText('Avena con frutos rojos')).not.toBeInTheDocument();
    });
  });

  it('shows the empty state when there is no plan for the week', async () => {
    vi.mocked(mealPlanService.getCurrentMealPlan).mockResolvedValue(null);

    render(<MealPlanPage />);

    expect(await screen.findByText('Todavía no tenés un plan para esta semana')).toBeInTheDocument();
  });

  it('opens the recipe detail for a meal without losing the selected day', async () => {
    vi.mocked(mealPlanService.getCurrentMealPlan).mockResolvedValue(mealPlanFixture);
    const user = userEvent.setup();

    render(<MealPlanPage />);
    await screen.findByText('Avena con frutos rojos');

    await user.click(screen.getByRole('button', { name: /Avena con frutos rojos/ }));

    expect(await screen.findByText('Mezclar todo')).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: /24/ })).toHaveAttribute('aria-selected', 'true');
  });

  it('shows a retry option on error and recovers when the retry succeeds', async () => {
    vi.mocked(mealPlanService.getCurrentMealPlan).mockRejectedValueOnce(new Error('network error'));
    const user = userEvent.setup();

    render(<MealPlanPage />);

    expect(await screen.findByText('Algo salió mal')).toBeInTheDocument();

    vi.mocked(mealPlanService.getCurrentMealPlan).mockResolvedValueOnce(mealPlanFixture);
    await user.click(screen.getByRole('button', { name: 'Reintentar' }));

    expect(await screen.findByText('Tu plan semanal')).toBeInTheDocument();
  });
});
