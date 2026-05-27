const KNOWN_ASSET_NAMES: Record<string, string> = {
  AAPL: 'Apple Inc.',
  AMD: 'Advanced Micro Devices, Inc.',
  AMZN: 'Amazon.com, Inc.',
  AVGO: 'Broadcom Inc.',
  COIN: 'Coinbase Global, Inc.',
  GOOGL: 'Alphabet Inc.',
  META: 'Meta Platforms, Inc.',
  MSFT: 'Microsoft Corporation',
  MSTR: 'Strategy Inc.',
  NVDA: 'NVIDIA Corporation',
  QQQ: 'Invesco QQQ Trust',
  SMCI: 'Super Micro Computer, Inc.',
  SPY: 'SPDR S&P 500 ETF Trust',
  TSLA: 'Tesla, Inc.',
  TSM: 'Taiwan Semiconductor Manufacturing Company Limited',
  BTCUSD: 'Bitcoin / United States Dollar',
  'BTC/USD': 'Bitcoin / United States Dollar',
  ETHUSD: 'Ethereum / United States Dollar',
  'ETH/USD': 'Ethereum / United States Dollar',
  SOLUSD: 'Solana / United States Dollar',
  'SOL/USD': 'Solana / United States Dollar',
};

const assetRequests = new Map<string, Promise<string | null>>();

export function knownAssetName(symbol: string): string | null {
  return KNOWN_ASSET_NAMES[symbol.trim().toUpperCase()] || null;
}

export function loadAssetName(symbol: string): Promise<string | null> {
  const normalized = symbol.trim().toUpperCase();
  const localName = knownAssetName(normalized);
  if (localName) return Promise.resolve(localName);

  const cached = assetRequests.get(normalized);
  if (cached) return cached;

  const request = fetch(
    `${process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000'}/api/trading/asset/${encodeURIComponent(normalized)}`,
    {
      headers: typeof window !== 'undefined' && sessionStorage.getItem('dashboard_pin')
        ? { 'X-Dashboard-Pin': sessionStorage.getItem('dashboard_pin') || '' }
        : {},
    }
  )
    .then((response) => response.ok ? response.json() : null)
    .then((data) => data?.name || null)
    .catch(() => null);

  assetRequests.set(normalized, request);
  return request;
}
