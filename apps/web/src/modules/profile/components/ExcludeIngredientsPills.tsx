import { Pill } from '../../../common/components/Pill';
import type { Restriction } from '../../../services/nutritionProfileService';

const RESTRICTION_OPTIONS: { value: Restriction; label: string }[] = [
  { value: 'NUTS', label: 'Frutos secos' },
  { value: 'GLUTEN', label: 'Gluten' },
  { value: 'DAIRY', label: 'Lácteos' },
  { value: 'SHELLFISH', label: 'Mariscos' },
  { value: 'SOY', label: 'Soja' },
];

type ExcludeIngredientsPillsProps = {
  value: Restriction[];
  disabled?: boolean;
  onChange: (value: Restriction[]) => void;
};

export function ExcludeIngredientsPills({ value, disabled, onChange }: ExcludeIngredientsPillsProps) {
  function toggle(option: Restriction) {
    onChange(value.includes(option) ? value.filter((item) => item !== option) : [...value, option]);
  }

  return (
    <div className="flex flex-wrap gap-2">
      {RESTRICTION_OPTIONS.map((option) => (
        <Pill
          key={option.value}
          label={option.label}
          selected={value.includes(option.value)}
          disabled={disabled}
          onClick={() => toggle(option.value)}
        />
      ))}
    </div>
  );
}
