import { Controller, Get, Post, Body, Patch, Param, Delete, UseGuards } from '@nestjs/common';
import { RecipeService } from './recipe.service';
import { CreateRecipeDto } from './dto/create-recipe.dto';
import { UpdateRecipeDto } from './dto/update-recipe.dto';
import { JwtAuthGuard } from '@/modules/auth/guards/jwt-auth.guard';

@UseGuards(JwtAuthGuard)
@Controller('recipes')
export class RecipeController {
  constructor(private readonly recipeService: RecipeService) {}

  @Post()
  async create(@Body() createRecipeDto: CreateRecipeDto) {
    return await this.recipeService.create(createRecipeDto);
  }

  @Get()
  async findAll() {
    return await this.recipeService.findAll();
  }

  @Get(':id')
  async findOne(@Param('id') id: string) {
    return await this.recipeService.findById(id);
  }

  @Patch(':id')
  async update(@Param('id') id: string, @Body() updateRecipeDto: UpdateRecipeDto) {
    return await this.recipeService.update(id, updateRecipeDto);
  }

  @Delete(':id')
  async remove(@Param('id') id: string) {
    return await this.recipeService.delete(id);
  }
}