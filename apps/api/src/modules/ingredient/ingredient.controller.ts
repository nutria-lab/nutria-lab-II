import { Controller, Get, Post, Body, Patch, Param, Delete, UseGuards, BadRequestException } from '@nestjs/common';
import { IngredientService } from './ingredient.service';
import { CreateIngredientDto } from './dto/create-ingredient.dto';
import { UpdateIngredientDto } from './dto/update-ingredient.dto';
import { JwtAuthGuard } from '@/modules/auth/guards/jwt-auth.guard';

@UseGuards(JwtAuthGuard)
@Controller('ingredients')
export class IngredientController {
  constructor(private readonly ingredientService: IngredientService) {}

  private validateStringFields(dto: { description?: string; defaultUnit?: string }) {
    if (dto.description !== undefined && dto.description.trim() === '') {
      throw new BadRequestException('description cannot be empty or whitespace only');
    }
    if (dto.defaultUnit !== undefined && dto.defaultUnit.trim() === '') {
      throw new BadRequestException('defaultUnit cannot be empty or whitespace only');
    }
  }

  @Post()
  async create(@Body() createIngredientDto: CreateIngredientDto) {
    this.validateStringFields(createIngredientDto);
    return await this.ingredientService.create(createIngredientDto);
  }

  @Get()
  async findAll() {
    return await this.ingredientService.findAll();
  }

  @Get(':id')
  async findOne(@Param('id') id: string) {
    return await this.ingredientService.findById(id);
  }

  @Patch(':id')
  async update(@Param('id') id: string, @Body() updateIngredientDto: UpdateIngredientDto) {
    this.validateStringFields(updateIngredientDto);
    return await this.ingredientService.update(id, updateIngredientDto);
  }

  @Delete(':id')
  async remove(@Param('id') id: string) {
    return await this.ingredientService.delete(id);
  }
}
