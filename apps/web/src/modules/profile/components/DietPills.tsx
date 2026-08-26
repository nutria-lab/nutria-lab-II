import { Pill } from '../../../common/components/Pill';
import type { Diet } from '../../../services/nutritionProfileService';

const DIET_OPTIONS: { value: Diet; label: string }[] = [
  { value: 'VEGAN', label: 'Vegano' },
  { value: 'VEGETARIAN', label: 'Vegetariano' },
  { value: 'PALEO', label: 'Paleo' },
  { value: 'KETO', label: 'Keto' },
  { value: 'PESCATARIAN', label: 'Pescetariano' },
  { value: 'ALL', label: 'Todo' },
];

type DietPillsProps = {
  value: Diet;
  onChange: (value: Diet) => void;
};

export function DietPills({ value, onChange }: DietPillsProps) {
  return (
    <div className="flex flex-wrap gap-2">
      {DIET_OPTIONS.map((option) => (
        <Pill
          key={option.value}
          label={option.label}
          selected={value === option.value}
          onClick={() => onChange(option.value)}
        />
      ))}
    </div>
  );
}
