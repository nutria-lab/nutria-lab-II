import { BadRequestException, Injectable, PipeTransform } from '@nestjs/common';

@Injectable()
export class ShoppingListItemKeyPipe implements PipeTransform<string, string> {
  transform(value: string): string {
    if (!/^[0-9a-f]{64}$/.test(value)) {
      throw new BadRequestException('itemKey must be a 64-character lowercase hexadecimal key');
    }

    return value;
  }
}
