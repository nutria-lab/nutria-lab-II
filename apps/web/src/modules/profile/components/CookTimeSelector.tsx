import { useState } from 'react';
import { SelectableCard } from '../../../common/components/SelectableCard';
import type { CookTimePreference } from '../../../services/nutritionProfileService';
import { COOK_TIME_OPTIONS } from '../cookTimeOptions';

const LAST_POSITION = COOK_TIME_OPTIONS.length - 1;
// Un valor fuera del enum no se presenta como una opción: el slider queda al centro y dice "Sin elegir".
const UNKNOWN_VALUE_POSITION = 1;
const UNKNOWN_VALUE_LABEL = 'Sin elegir';

type CookTimeSelectorProps = {
  value: CookTimePreference;
  disabled?: boolean;
  onChange: (value: CookTimePreference) => void;
};

export function CookTimeSelector({ value, disabled, onChange }: CookTimeSelectorProps) {
  const selectedPosition = COOK_TIME_OPTIONS.findIndex((option) => option.value === value);
  const selected = COOK_TIME_OPTIONS[selectedPosition];

  function handleSliderChange(event: React.ChangeEvent<HTMLInputElement>) {
    const option = COOK_TIME_OPTIONS[Number(event.target.value)];
    if (option) onChange(option.value);
  }

  return (
    <>
      {/* Mobile: range slider */}
      <div className="space-y-4 md:hidden">
        <div className="flex items-end justify-between gap-3">
          <span className="text-sm font-bold uppercase tracking-wider text-on-surface-variant">
            Tiempo de cocina
          </span>
          <span className="text-2xl font-bold text-brand-green">
            {selected ? `${selected.minutes} min` : UNKNOWN_VALUE_LABEL}
          </span>
        </div>
        <input
          type="range"
          min={0}
          max={LAST_POSITION}
          step={1}
          value={selected ? selectedPosition : UNKNOWN_VALUE_POSITION}
          disabled={disabled}
          aria-label="Tiempo de cocina"
          aria-valuetext={selected ? `${selected.title}, ${selected.minutes} minutos` : UNKNOWN_VALUE_LABEL}
          onChange={handleSliderChange}
          className="w-full cursor-pointer appearance-none rounded-lg accent-brand-green disabled:cursor-not-allowed disabled:opacity-50"
          style={{ height: '8px', backgroundColor: 'var(--color-surface-container-highest)' }}
        />
        {/* Tres columnas iguales: cada marca queda bajo su posición aunque los textos midan distinto. */}
        <div className="grid grid-cols-3 gap-2 text-xs text-on-surface-variant">
          {COOK_TIME_OPTIONS.map((option, position) => (
            <span
              key={option.value}
              className={`${option.markAlignment} ${
                position === selectedPosition ? 'font-bold text-brand-green' : 'font-medium'
              }`}
            >
              {option.title} ({option.valueLabel})
            </span>
          ))}
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
