import { AlertTriangle } from 'lucide-react';

export function ErrorState({ message }: { message: string }) {
  return (
    <div className="flex items-center gap-2 p-3 rounded-md bg-destructive/10 border border-destructive/20 text-red-400 text-sm">
      <AlertTriangle size={14} />
      <span>{message}</span>
    </div>
  );
}
