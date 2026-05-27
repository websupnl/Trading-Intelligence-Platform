'use client';

import { useEffect, useState } from 'react';
import { cn } from '@/lib/utils';
import { knownAssetName, loadAssetName } from '@/lib/assets';

export function AssetLabel({
  symbol,
  compact = false,
  className,
}: {
  symbol: string;
  compact?: boolean;
  className?: string;
}) {
  const normalized = symbol?.toUpperCase() || '---';
  const [name, setName] = useState<string | null>(() => knownAssetName(normalized));

  useEffect(() => {
    let active = true;
    setName(knownAssetName(normalized));
    loadAssetName(normalized).then((resolved) => {
      if (active && resolved) setName(resolved);
    });
    return () => {
      active = false;
    };
  }, [normalized]);

  if (compact) {
    return (
      <span className={cn('inline-flex gap-1.5 items-baseline', className)}>
        <span className="font-semibold">{normalized}</span>
        {name && <span className="text-muted-foreground">{name}</span>}
      </span>
    );
  }

  return (
    <span className={cn('inline-flex flex-col leading-tight', className)}>
      <span className="font-semibold">{normalized}</span>
      {name && <span className="text-xs font-normal text-muted-foreground">{name}</span>}
    </span>
  );
}
