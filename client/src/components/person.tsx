import { Reel } from '@/components/bits';
import { initialsOf, reelColor } from '@/lib/api';
import { cn } from '@/lib/utils';
import { useWorld } from '@/lib/world';

type Person = {
  id: string;
  name: string;
  dot?: string | null;
};

type Leaves = { onNavigate?: () => void };

export function PersonReel({
  person,
  size = 'sm',
  className,
  solo,
  onNavigate,
}: {
  person: Person;
  size?: 'sm' | 'md' | 'lg';
  className?: string;
  solo?: boolean;
} & Leaves) {
  const club = useWorld();
  const go = (e: { stopPropagation: () => void }) => {
    e.stopPropagation();
    onNavigate?.();
    club.goPerson(person.id);
  };

  const face = (
    <Reel color={reelColor(person.dot, person.id)} src={club.avatarOf(person.id)} size={size}>
      {initialsOf(person.name)}
    </Reel>
  );

  if (solo) {
    return (
      <button
        type="button"
        onClick={go}
        aria-label={`Abrir o perfil de ${person.name}`}
        className={cn('flex flex-none rounded-[1px]', className)}
      >
        {face}
      </button>
    );
  }

  return (
    <span aria-hidden onClick={go} className={cn('flex flex-none cursor-pointer', className)}>
      {face}
    </span>
  );
}

export function PersonName({
  person,
  className,
  onNavigate,
}: {
  person: Person;
  className?: string;
} & Leaves) {
  const club = useWorld();
  return (
    <button
      type="button"
      onClick={e => {
        e.stopPropagation();
        onNavigate?.();
        club.goPerson(person.id);
      }}
      className={cn('rounded-cell text-left transition-colors hover:text-beam', className)}
    >
      {person.name}
    </button>
  );
}
