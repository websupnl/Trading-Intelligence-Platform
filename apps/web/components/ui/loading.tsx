export function LoadingSpinner() {
  return (
    <div className="flex items-center justify-center py-8">
      <div className="w-5 h-5 border-2 border-border border-t-primary rounded-full animate-spin" />
    </div>
  );
}

export function LoadingRow() {
  return <div className="h-8 bg-muted/40 rounded animate-pulse my-1" />;
}
