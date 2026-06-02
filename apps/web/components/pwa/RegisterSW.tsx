'use client';
import { useEffect } from 'react';

export function RegisterSW() {
  useEffect(() => {
    if (typeof window !== 'undefined' && 'serviceWorker' in navigator) {
      const onLoad = () => navigator.serviceWorker.register('/sw.js').catch(() => {});
      if (document.readyState === 'complete') onLoad();
      else window.addEventListener('load', onLoad, { once: true });
    }
  }, []);
  return null;
}
