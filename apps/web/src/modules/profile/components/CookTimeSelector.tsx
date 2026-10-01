import { useState } from 'react';
import { SelectableCard } from '../../../common/components/SelectableCard';
import type { CookTimePreference } from '../../../services/nutritionProfileService';

const COOK_TIME_OPTIONS: {
  value: CookTimePreference;
  title: string;
  valueLabel: string;
  description: string;
  minutes: number;
}[] = [
  { value: 'QUICK', title: 'Rápido', valueLabel: '15m', description: 'Comidas rápidas y saludables para días ocupados.', minutes: 15 },
  { value: 'STANDARD', title: 'Estándar', valueLabel: '30m', description: 'El equilibrio perfecto entre facilidad y sabor.', minutes: 30 },
  { value: 'GOURMET', title: 'Gourmet', valueLabel: '60m', description: 'Sabores elaborados para quienes disfrutan cocinar.', minutes: 60 },
];

const MINUTES_TO_VALUE: Record<number, CookTimePreference> = {
  15: 'QUICK',
  30: 'STANDARD',
  60: 'GOURMET',
};

const VALUE_TO_MINUTES: Record<CookTimePreference, number> = {
  QUICK: 15,
  STANDARD: 30,
  GOURMET: 60,
};

type CookTimeSelectorProps = {
  value: CookTimePreference;
  disabled?: boolean;
  onChange: (value: CookTimePreference) => void;
};

export function CookTimeSelector({ value, disabled, onChange }: CookTimeSelectorProps) {
  const currentMinutes = VALUE_TO_MINUTES[value] ?? 30;

  function handleSliderChange(event: React.ChangeEvent<HTMLInputElement>) {
    const minutes = Number(event.target.value);
    const mapped = MINUTES_TO_VALUE[minutes];
    if (mapped) onChange(mapped);
  }

  return (
    <>
      {/* Mobile: range slider */}
      <div className="space-y-4 md:hidden">
        <div className="flex items-end justify-between">
          <span className="text-sm font-bold uppercase tracking-wider text-on-surface-variant">
            Tiempo de cocina
          </span>
          <span className="text-2xl font-bold text-brand-green">{currentMinutes} min</span>
        </div>
        <input
          type="range"
          min={15}
          max={60}
          step={15}
          value={currentMinutes}
          disabled={disabled}
          aria-label={`Tiempo de cocina: ${currentMinutes} minutos`}
          onChange={handleSliderChange}
          className="w-full cursor-pointer appearance-none rounded-lg accent-brand-green disabled:cursor-not-allowed disabled:opacity-50"
          style={{ height: '8px', backgroundColor: 'var(--color-surface-container-highest)' }}
        />
        <div className="flex justify-between text-xs font-medium text-on-surface-variant">
          <span>Rápido (15m)</span>
          <span>Elaborado (60m)</span>
        </div>
      </div>

      {/* Desktop: 3-column card grid */}
      <div className="hidden md:grid md:grid-cols-3 gap-4">
        {COOK_TIME_OPTIONS.map((option) => (
          <SelectableCard
            key={option.value}
            title={option.title}
            valueLabel={option.valueLabel}
            description={option.description}
            selected={value === option.value}
            disabled={disabled}
            onClick={() => onChange(option.value)}
          />
        ))}
      </div>
    </>
  );
}
