import { SelectableCard } from '../../../common/components/SelectableCard';
import type { Goal } from '../../../services/nutritionProfileService';

const GOAL_OPTIONS: { value: Goal; title: string; description: string }[] = [
  { value: 'LOSE_WEIGHT', title: 'Bajar de peso', description: 'Déficit calórico equilibrado y saciante.' },
  { value: 'GAIN_MUSCLE', title: 'Ganar músculo', description: 'Alto en proteínas y superávit nutritivo.' },
  { value: 'MAINTAIN', title: 'Mantenimiento', description: 'Estabilidad energética y bienestar general.' },
];

type GoalSelectorProps = {
  value: Goal;
  disabled?: boolean;
  onChange: (value: Goal) => void;
};

export function GoalSelector({ value, disabled, onChange }: GoalSelectorProps) {
  return (
    <div className="space-y-3">
      {GOAL_OPTIONS.map((option) => (
        <SelectableCard
          key={option.value}
          title={option.title}
          description={option.description}
          selected={value === option.value}
          disabled={disabled}
          onClick={() => onChange(option.value)}
        />
      ))}
    </div>
  );
}
