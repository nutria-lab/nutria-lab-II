import 'reflect-metadata';
import { PlansService } from '../plans.service';

// NUT-78 (mínimo de NUT-76): borrar un plan nunca borra recetas, porque las versiones y otros
// planes pueden compartirlas (el catálogo es compartido).
describe('PlansService.deletePlan (NUT-78)', () => {
  const currentVersion = {
    id: 'plan-v2',
    userId: 'user-1',
    version: 2,
    isCurrent: true,
    supersedesId: 'plan-v1',
    days: [{ id: 'day-1', meals: [{ id: 'meal-1', recipeId: 'recipe-shared', recipe: { id: 'recipe-shared', image: null } }] }],
  };

  function setup() {
    const repository: any = {
      findPlanByWeek: jest.fn().mockResolvedValue(currentVersion),
      deletePlanTransaction: jest.fn().mockResolvedValue(currentVersion),
    };
    return { repository, service: new PlansService(repository, {} as any, {} as any, {} as any) };
  }

  it('borra sólo la versión current de la semana (del usuario) y no le pasa recetas para borrar', async () => {
    const { repository, service } = setup();

    const response = await service.deletePlan('user-1', '2026-09-14');

    expect(repository.findPlanByWeek).toHaveBeenCalledWith('user-1', new Date('2026-09-14T00:00:00Z'));
    expect(repository.deletePlanTransaction).toHaveBeenCalledWith('plan-v2', 'user-1');
    // La respuesta sigue siendo el plan borrado, como antes.
    expect(response).toBe(currentVersion);
  });
});
