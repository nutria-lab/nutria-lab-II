// Purely illustrative example content: it is not user data and must never show figures such as
// percentages or calories. The whole illustration is aria-hidden and described in text by the page.

const WEEK_DAYS = ['Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb', 'Dom'] as const;

const EXAMPLE_MEALS = [
  { type: 'Desayuno', icon: 'egg_alt', name: 'Avena con frutas y semillas', minutes: 10 },
  { type: 'Almuerzo', icon: 'rice_bowl', name: 'Bowl de quinoa con pollo y verduras', minutes: 25 },
  { type: 'Cena', icon: 'dinner_dining', name: 'Pasta integral con brócoli y champiñones', minutes: 20 },
] as const;

const PROGRESS_DAYS = ['L', 'M', 'M', 'J', 'V', 'S', 'D'] as const;
const COMPLETED_PROGRESS_DAYS = 4;

const CARD_CLASSES = 'rounded-3xl border border-outline-variant/30 bg-white shadow-[0_4px_20px_rgba(46,50,48,0.06)]';

function Icon({ name, className = '' }: { name: string; className?: string }) {
  return <span className={`material-symbols-outlined ${className}`}>{name}</span>;
}

function WeeklyPlanCard() {
  return (
    <div className={`${CARD_CLASSES} w-full p-5 md:p-7`}>
      <div className="mb-5 flex items-center gap-3">
        <span className="flex h-11 w-11 shrink-0 items-center justify-center overflow-hidden rounded-full bg-surface-container text-brand-green">
          <Icon name="calendar_month" className="text-xl" />
        </span>
        <p className="font-headline text-xl font-bold text-on-surface">Plan semanal</p>
      </div>

      <div className="mb-4 flex items-center gap-1.5">
        <span className="hidden h-9 w-9 shrink-0 items-center justify-center overflow-hidden rounded-full bg-surface-container text-on-surface-variant md:flex">
          <Icon name="chevron_left" className="text-lg" />
        </span>
        <div className="grid flex-1 grid-cols-7 gap-1">
          {WEEK_DAYS.map((day, index) => (
            <span
              key={day}
              className={`flex h-9 items-center justify-center rounded-xl text-xs font-semibold ${
                index === 0 ? 'bg-brand-green text-on-primary' : 'bg-surface-container-low text-on-surface-variant'
              }`}
            >
              {day}
            </span>
          ))}
        </div>
        <span className="hidden h-9 w-9 shrink-0 items-center justify-center overflow-hidden rounded-full bg-surface-container text-on-surface-variant md:flex">
          <Icon name="chevron_right" className="text-lg" />
        </span>
      </div>

      <ul className="divide-y divide-outline-variant/30 border-t border-outline-variant/30">
        {EXAMPLE_MEALS.map((meal) => (
          <li
            key={meal.type}
            className="grid grid-cols-[3.5rem_minmax(0,1fr)_auto] items-center gap-x-4 gap-y-0.5 py-4 [grid-template-areas:'icon_type_chevron''icon_name_chevron''icon_time_chevron'] md:grid-cols-[5.5rem_4rem_minmax(0,1fr)_auto] md:[grid-template-areas:'type_icon_name_chevron''type_icon_time_chevron']"
          >
            <span className="text-[11px] font-bold uppercase tracking-wider text-brand-green-dark [grid-area:type]">
              {meal.type}
            </span>
            <span className="flex h-14 w-14 items-center justify-center overflow-hidden rounded-2xl bg-surface-container text-brand-green [grid-area:icon] md:h-16 md:w-16">
              <Icon name={meal.icon} className="text-2xl" />
            </span>
            <span className="text-sm font-semibold leading-snug text-on-surface [grid-area:name] md:text-base">{meal.name}</span>
            <span className="flex items-center gap-1 text-xs font-semibold text-brand-green-dark [grid-area:time]">
              <Icon name="schedule" className="text-sm" />
              {meal.minutes} min
            </span>
            <span className="text-on-surface-variant [grid-area:chevron]">
              <Icon name="chevron_right" className="text-xl" />
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function PhoneMockup() {
  return (
    <div className="mx-auto w-64 shrink-0 rounded-[2.5rem] border-[10px] border-on-surface bg-on-surface shadow-[0_24px_48px_rgba(46,50,48,0.18)]">
      <div className="flex h-[30rem] flex-col gap-4 overflow-hidden rounded-[1.9rem] bg-brand-cream px-4 py-5">
        <div className="flex items-center justify-between">
          <span className="font-headline text-sm font-bold text-brand-green">NutrIA</span>
          <span className="flex items-center gap-1.5">
            <span className="flex h-7 w-7 items-center justify-center overflow-hidden rounded-full bg-surface-container text-on-surface-variant">
              <Icon name="notifications" className="text-base" />
            </span>
            <span className="flex h-7 w-7 items-center justify-center overflow-hidden rounded-full bg-primary-fixed text-brand-green-dark">
              <Icon name="person" className="text-base" />
            </span>
          </span>
        </div>

        <div>
          <p className="font-headline text-lg font-bold text-on-surface">Hola</p>
          <p className="text-[11px] text-on-surface-variant">Hoy es un buen día para nutrirte.</p>
        </div>

        <div className="rounded-2xl bg-surface-container-low p-3">
          <p className="mb-2 font-headline text-xs font-bold text-on-surface">Progreso semanal</p>
          <div className="mb-3 h-1.5 overflow-hidden rounded-full bg-surface-container-high">
            <div className="h-full w-3/5 rounded-full bg-brand-green" />
          </div>
          <div className="grid grid-cols-7 gap-1">
            {PROGRESS_DAYS.map((day, index) => (
              <span key={`${day}-${index}`} className="flex flex-col items-center gap-1">
                <span className="text-[9px] font-semibold text-on-surface-variant">{day}</span>
                <span
                  className={`flex h-5 w-5 items-center justify-center overflow-hidden rounded-full ${
                    index < COMPLETED_PROGRESS_DAYS ? 'bg-brand-green text-on-primary' : 'bg-surface-container-high'
                  }`}
                >
                  {index < COMPLETED_PROGRESS_DAYS && <Icon name="check" className="text-xs" />}
                </span>
              </span>
            ))}
          </div>
        </div>

        <div>
          <div className="mb-2 flex items-center justify-between gap-2">
            <p className="font-headline text-xs font-bold text-on-surface">Siguiente comida por registrar</p>
            <span className="rounded-full bg-tertiary-fixed px-2 py-0.5 text-[9px] font-bold text-on-tertiary-container">
              Almuerzo
            </span>
          </div>
          <div className="flex items-center gap-3 rounded-2xl bg-white p-3 shadow-[0_4px_20px_rgba(46,50,48,0.06)]">
            <span className="flex h-12 w-12 shrink-0 items-center justify-center overflow-hidden rounded-xl bg-surface-container text-brand-green">
              <Icon name="rice_bowl" className="text-2xl" />
            </span>
            <span className="min-w-0">
              <span className="block text-xs font-semibold leading-snug text-on-surface">Bowl de quinoa con pollo y verduras</span>
              <span className="mt-1 flex items-center gap-1 text-[10px] font-semibold text-brand-green-dark">
                <Icon name="schedule" className="text-xs" />
                25 min
              </span>
            </span>
          </div>
        </div>

        <div className="mt-auto flex items-center gap-3 rounded-2xl bg-primary-fixed/50 p-3">
          <span className="flex h-8 w-8 shrink-0 items-center justify-center overflow-hidden rounded-lg bg-brand-green text-on-primary">
            <Icon name="calendar_month" className="text-base" />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block text-[11px] font-semibold text-on-surface">Ver mi plan semanal</span>
            <span className="block text-[9px] text-on-surface-variant">Revisá las comidas de la semana</span>
          </span>
          <Icon name="chevron_right" className="text-base text-on-surface-variant" />
        </div>
      </div>
    </div>
  );
}

export function WeekPreview() {
  return (
    <div
      aria-hidden="true"
      data-preview
      className="flex flex-col items-center gap-10 md:flex-row md:items-center md:justify-between md:gap-8 lg:gap-16"
    >
      <div className="w-full md:max-w-lg md:flex-1">
        <WeeklyPlanCard />
      </div>
      <PhoneMockup />
    </div>
  );
}
