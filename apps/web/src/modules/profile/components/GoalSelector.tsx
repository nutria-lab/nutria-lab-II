import { SelectableCard } from '../../../common/components/SelectableCard';
import type { Goal } from '../../../services/nutritionProfileService';

const GOAL_OPTIONS: { value: Goal; title: string; description: string; icon: string }[] = [
  {
    value: 'LOSE_WEIGHT',
    title: 'Bajar de peso',
    description: 'Déficit calórico equilibrado y saciante.',
    icon: 'monitor_weight',
  },
  {
    value: 'GAIN_MUSCLE',
    title: 'Ganar músculo',
    description: 'Alto en proteínas y superávit nutritivo.',
    icon: 'fitness_center',
  },
  {
    value: 'MAINTAIN',
    title: 'Mantenimiento',
    description: 'Estabilidad energética y bienestar general.',
    icon: 'self_care',
  },
];

type GoalSelectorProps = {
  value: Goal;
  disabled?: boolean;
  onChange: (value: Goal) => void;
};

export function GoalSelector({ value, disabled, onChange }: GoalSelectorProps) {
  return (
    <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
      {GOAL_OPTIONS.map((option) => (
        <SelectableCard
          key={option.value}
          title={option.title}
          description={option.description}
          icon={option.icon}
          selected={value === option.value}
          disabled={disabled}
          onClick={() => onChange(option.value)}
        />
      ))}
    </div>
  );
}
