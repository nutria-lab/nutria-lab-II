import { SelectableCard } from '../../../common/components/SelectableCard';
import type { CookTimePreference } from '../../../services/nutritionProfileService';

const COOK_TIME_OPTIONS: {
  value: CookTimePreference;
  title: string;
  valueLabel: string;
  description: string;
}[] = [
  { value: 'QUICK', title: 'Rápido', valueLabel: '15m', description: 'Comidas rápidas y saludables para días ocupados.' },
  { value: 'STANDARD', title: 'Estándar', valueLabel: '30m', description: 'El equilibrio perfecto entre facilidad y sabor.' },
  { value: 'GOURMET', title: 'Gourmet', valueLabel: '60m', description: 'Sabores elaborados para quienes disfrutan cocinar.' },
];

type CookTimeSelectorProps = {
  value: CookTimePreference;
  disabled?: boolean;
  onChange: (value: CookTimePreference) => void;
};

export function CookTimeSelector({ value, disabled, onChange }: CookTimeSelectorProps) {
  return (
    <div className="space-y-3">
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
  );
}
