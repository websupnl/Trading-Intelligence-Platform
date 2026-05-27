import { cn } from '@/lib/utils';

export function EmptyState({ message, className }: { message: string; className?: string }) {
  return (
    <div className={cn('flex flex-col items-center justify-center py-12 text-muted-foreground text-sm', className)}>
      <span>{message}</span>
    </div>
  );
}
