export function Skeleton({ className = '', style }: { className?: string; style?: React.CSSProperties }) {
  return <div className={`skeleton ${className}`} style={style} />;
}

/** A few stacked skeleton rows for list/card placeholders. */
export function SkeletonRows({ rows = 4, height = 56 }: { rows?: number; height?: number }) {
  return (
    <div className="space-y-2">
      {Array.from({ length: rows }).map((_, i) => (
        <Skeleton key={i} style={{ height }} />
      ))}
    </div>
  );
}
