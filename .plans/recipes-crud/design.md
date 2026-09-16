# Design Record: Recipes and Ingredients CRUD (recipes-crud)

## 1. Overview
This design covers the implementation of the backend CRUD endpoints for `Recipe` and `Ingredient` using NestJS and Prisma, strictly adhering to the existing database models.

## 2. Constraints & Data Models

### Recipe Model
- `id`: String (UUID)
- `title`: String
- `description`: String
- `prepMinutes`: Int
- `cookMinutes`: Int
- `ingredients`: Json (Contains ingredient details, including ingredient names)
- `instructions`: String[]
- `createdAt`, `updatedAt`: DateTime
- `plannedMeals`: PlannedMeal[]
*(No `imageUrl`, `servings`, or `nutritionalValues` fields are included or permitted)*

### Ingredient Model
- `id`: String (UUID)
- `name`: String (Unique)
- `type`: IngredientType (Enum: MEAT, VEGETABLE, FRUIT, DAIRY, GRAIN, SPICE, OTHER)
- `nutritionalValues`: Json
- `createdAt`, `updatedAt`: DateTime

## 3. Endpoints

### 3.1. Ingredient Controller (`/ingredients`)
- `POST /ingredients`: Creates a new ingredient. Expects `name`, `type`, and `nutritionalValues`.
- `GET /ingredients`: Retrieves a list of ingredients.
- `GET /ingredients/:id`: Retrieves a single ingredient by ID.
- `PATCH /ingredients/:id`: Updates an existing ingredient.
- `DELETE /ingredients/:id`: Deletes an ingredient. 
  - **Integrity Rule:** Before deleting, the system MUST query the `Recipe` table to ensure that the ingredient's `name` is not present within any Recipe's `ingredients` JSON array. If it is found, the deletion must be blocked (e.g., returning an HTTP 409 Conflict error) to enforce data integrity without explicit foreign keys.

### 3.2. Recipe Controller (`/recipes`)
- `POST /recipes`: Creates a new recipe. Expects `title`, `description`, `prepMinutes`, `cookMinutes`, `ingredients` (JSON), and `instructions` (Array of Strings).
- `GET /recipes`: Retrieves a list of recipes.
- `GET /recipes/:id`: Retrieves a single recipe by ID.
- `PATCH /recipes/:id`: Updates a recipe.
- `DELETE /recipes/:id`: Deletes a recipe.

## 4. Validation & Architecture
- **DTOs**: NestJS Data Transfer Objects must perfectly mirror the Prisma definitions above, actively stripping or rejecting any extra fields like `servings` or `imageUrl`.
- **Validation**: Rely on `class-validator` and `class-transformer` for type checking.
- **Service Layer**: The logic for checking if an ingredient is used in a Recipe's `ingredients` JSON before deletion will reside entirely in `IngredientService`.

## 5. Testing Strategy
- **Unit Tests**: Focus on service logic, particularly mocking the Prisma calls to ensure the Ingredient deletion rejects when the `name` is matched in a Recipe's JSON.
- **Integration Tests**: Ensure actual endpoints work end-to-end with the Prisma models, strictly testing that unexpected fields are not saved.
