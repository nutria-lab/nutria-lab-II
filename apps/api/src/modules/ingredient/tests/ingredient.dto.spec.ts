import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { CreateIngredientDto } from '../dto/create-ingredient.dto';

describe('CreateIngredientDto Transformation', () => {
  it('should normalize properties array (trim, deduplicate, case-insensitive)', () => {
    const plain = {
      name: 'Sal',
      type: 'OTHER',
      description: 'Sal marina',
      defaultUnit: 'g',
      nutritionalValues: { calories: 0, protein: 0, carbs: 0, fat: 0, sodium: 39000 },
      properties: [' Vegano ', 'Libre de sodio', 'vegano', '  ', 'LIBRE DE SODIO']
    };

    const instance = plainToInstance(CreateIngredientDto, plain);

    expect(instance.properties).toEqual(['Vegano', 'Libre de sodio']);
  });
});
