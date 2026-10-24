import { MODULE_METADATA } from '@nestjs/common/constants';
import { ShoppingListItemKeyPipe } from '../shopping-list-item-key.pipe';
import { ShoppingListModule } from '../shopping-list.module';

describe('ShoppingListModule', () => {
  it('registers the item-key validation pipe as a provider', () => {
    const providers = Reflect.getMetadata(MODULE_METADATA.PROVIDERS, ShoppingListModule) as unknown[];

    expect(providers).toContain(ShoppingListItemKeyPipe);
  });
});
