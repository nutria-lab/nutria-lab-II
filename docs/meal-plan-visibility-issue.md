# Diagnóstico: Por qué no se visualiza el Meal Plan de un usuario que existe en la Base de Datos

## 1. Resumen del Problema

**Síntoma:** Un usuario posee registros válidos en la base de datos (tablas `meal_plans`, `meal_plan_days`, `planned_meals`), pero al ingresar a la vista del plan semanal (`/meal-plan`), la aplicación muestra el estado vacío:
> *"Todavía no tenés un plan para esta semana"* o la API responde `404 Not Found` (`Plan not found for this week`).

Tras investigar el código del frontend, la lógica del backend y los registros reales en PostgreSQL, se identificaron **3 causas estructurales**.

---

## 2. Causas Raíz Identificadas

### Causa 1: Desfase de semanas (Filtro rígido a la semana actual)

* **Frontend:** En `apps/web/src/modules/meal-plan/hooks/useMealPlan.ts`, la función `getCurrentWeekStart()` calcula automáticamente el lunes de la semana actual del reloj del cliente:
  ```typescript
  function getCurrentWeekStart(): string {
    const now = new Date();
    const dayOfWeek = now.getDay();
    const diffToMonday = dayOfWeek === 0 ? -6 : 1 - dayOfWeek;
    const monday = new Date(now);
    monday.setDate(now.getDate() + diffToMonday);
    return formatLocalDateKey(monday); // Ej: '2026-09-28'
  }
  ```
  La llamada enviada a la API es `GET /meal-plans/current?weekStart=YYYY-MM-DD` con ese lunes específico.

* **Base de datos:** Los planes existentes (por ejemplo los generados por el seed o creados en semanas pasadas) tienen `startDate` de semanas anteriores (ej. `2026-09-14`).

* **Interfaz de usuario:** `MealPlanPage.tsx` no cuenta actualmente con botones de paginación o navegación entre semanas pasadas/futuras (el componente `WeekSelector` solo permite alternar entre los 7 días de la semana cargada). Por lo tanto, cualquier plan que no coincida exactamente con la semana en curso queda inaccesible desde la UI.

---

### Causa 2: Discrepancia de horas y zona horaria en `startDate` (UTC vs Hora Local)

* **Consulta Prisma:** En `apps/api/src/modules/plans/plans.repository.ts`:
  ```typescript
  async findPlanByWeek(userId: string, weekStart: Date) {
    return this.prisma.mealPlan.findUnique({
      where: { userId_startDate: { userId, startDate: weekStart } },
      ...
  ```
  Prisma ejecuta una consulta SQL con **igualdad estricta** (`WHERE "userId" = $1 AND "startDate" = $2`) sobre una columna `TIMESTAMP(3)`.

* **Normalización del Backend:** En `apps/api/src/modules/plans/plans.service.ts`:
  ```typescript
  private parseDateString(dateStr: string): Date {
    return new Date(`${dateStr}T00:00:00Z`); // Ej: 2026-09-14T00:00:00.000Z
  }
  ```
  El servicio busca exactamente la medianoche UTC (`00:00:00.000Z`).

* **Dato real en PostgreSQL:** En `apps/api/prisma/seed.ts` se generó la fecha con:
  ```typescript
  const startDate = new Date();
  startDate.setHours(0, 0, 0, 0); // ¡Hora local del sistema!
  ```
  En una máquina con huso horario no-UTC (por ejemplo UTC-3 o UTC-6), el registro quedó guardado con horas en UTC:
  `2026-09-14T06:00:00.000Z`.

* **Resultado:** Como `2026-09-14T00:00:00.000Z != 2026-09-14T06:00:00.000Z`, la base de datos devuelve cero filas y el backend arroja `NotFoundException('Plan not found for this week')` (404), **incluso si el usuario intenta consultar la semana exacta del plan**.

---

### Causa 3: Usuario autenticado (`userId`) no coincide con el dueño del plan

* En `apps/api/src/modules/plans/plans.controller.ts`, el endpoint obtiene el ID del usuario directamente del token JWT:
  ```typescript
  const userId = req.user.sub;
  ```
* En la base de datos coexisten usuarios creados por seed (`usuario.prueba1@nutria.com`, etc.) y usuarios creados manualmente (por ejemplo `fercesio11@gmail.com`).
* Si se inicia sesión con una cuenta distinta a la que posee los planes en la base de datos, la cláusula `userId_startDate` no coincidirá y devolverá 404.

---

### Causa 4: Comportamiento del Frontend ante un 404

* En `apps/web/src/services/mealPlanService.ts`:
  ```typescript
  if (axios.isAxiosError(error) && error.response?.status === 404) {
    return null;
  }
  ```
  El servicio intercepta el `404` y lo transforma silenciosamente en `null`.
* El hook `useMealPlan` pasa al estado `'empty'`.
* La página `MealPlanPage` asume que el usuario no tiene plan y renderiza el botón *"Generar plan"*, ocultando el motivo real (si fue por fecha no coincidente, zona horaria o usuario).

---

## 3. Plan de Soluciones Recomendadas (Para cuando se aborde la tarea)

### A. Corregir la generación de fechas en el seeder (`seed.ts`)
1. Calcular fechas en UTC puro evitando `setHours` en tiempo local:
   ```typescript
   // Normalizar a medianoche UTC
   const now = new Date();
   const day = now.getUTCDay();
   const diff = day === 0 ? 6 : day - 1;
   const startDate = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - diff, 0, 0, 0, 0));
   ```
2. Asegurar que los datos semilla se generen para la semana actual (`now - diff`) para que el frontend los encuentre inmediatamente al loguearse.

### B. Robustecer la búsqueda en el Backend (`PlansRepository` / `PlansService`)
1. En lugar de una igualdad estricta a nivel milisegundo en `startDate`, buscar un rango que cubra todo el día UTC o verificar si la fecha consultada cae dentro del período:
   ```typescript
   // Alternativa 1: Por rango de día para startDate
   const nextDay = new Date(weekStart.getTime() + 24 * 60 * 60 * 1000);
   return this.prisma.mealPlan.findFirst({
     where: {
       userId,
       startDate: {
         gte: weekStart,
         lt: nextDay,
       },
     },
     include: { days: { include: { meals: { include: { recipe: true } } } } },
   });
   ```
2. O bien buscar el plan activo cuya ventana temporal cubra la fecha actual (`startDate <= queryDate AND endDate >= queryDate`).

### C. Navegación de semanas en el Frontend (`MealPlanPage`)
1. Permitir que `useMealPlan` reciba un parámetro `weekStart` opcional proveniente de la URL (`?weekStart=YYYY-MM-DD`).
2. Añadir flechas de navegación "Semana anterior / Semana siguiente" en el encabezado de `MealPlanPage.tsx`.

---

## 4. Archivos Clave de Referencia

* Backend Controller: `apps/api/src/modules/plans/plans.controller.ts`
* Backend Service: `apps/api/src/modules/plans/plans.service.ts`
* Backend Repository: `apps/api/src/modules/plans/plans.repository.ts`
* Database Seeder: `apps/api/prisma/seed.ts`
* Frontend Service: `apps/web/src/services/mealPlanService.ts`
* Frontend Hook: `apps/web/src/modules/meal-plan/hooks/useMealPlan.ts`
* Frontend Page: `apps/web/src/modules/meal-plan/pages/MealPlanPage.tsx`
