const API_BASE = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000';

async function apiFetch(path: string, options?: RequestInit) {
  const res = await fetch(`${API_BASE}${path}`, {
    headers: { 'Content-Type': 'application/json', ...options?.headers },
    ...options,
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: res.statusText }));
    throw { status: res.status, detail: err.detail || err };
  }
  return res.json();
}

export const api = {
  health: () => apiFetch('/health'),
  configStatus: () => apiFetch('/api/config/status'),
  apiStatus: () => apiFetch('/api/status'),

  // Trading
  getAccount: () => apiFetch('/api/trading/account'),
  getPositions: () => apiFetch('/api/trading/positions'),
  getOrders: (status = 'open') => apiFetch(`/api/trading/orders?status=${status}`),
  getPortfolioHistory: (period = '1M') => apiFetch(`/api/trading/portfolio-history?period=${period}`),
  submitPaperOrder: (data: any) => apiFetch('/api/trading/orders/paper', { method: 'POST', body: JSON.stringify(data) }),
  cancelOrder: (alpacaOrderId: string) => apiFetch('/api/trading/orders/cancel', { method: 'POST', body: JSON.stringify({ alpaca_order_id: alpacaOrderId }) }),

  // Risk
  getRiskStatus: () => apiFetch('/api/risk/status'),
  checkRisk: (data: any) => apiFetch('/api/risk/check', { method: 'POST', body: JSON.stringify(data) }),
  enableKillSwitch: () => apiFetch('/api/risk/kill-switch/enable', { method: 'POST' }),
  disableKillSwitch: () => apiFetch('/api/risk/kill-switch/disable', { method: 'POST' }),

  // News
  getNews: (limit = 50) => apiFetch(`/api/news?limit=${limit}`),
  ingestNews: () => apiFetch('/api/news/ingest', { method: 'POST' }),

  // Social
  getPosts: (limit = 50) => apiFetch(`/api/social/posts?limit=${limit}`),
  fetchReddit: () => apiFetch('/api/social/reddit/fetch', { method: 'POST' }),
  fetchX: () => apiFetch('/api/social/x/fetch', { method: 'POST' }),

  // Rumours
  getRumours: (limit = 50) => apiFetch(`/api/rumours?limit=${limit}`),

  // Signals
  getSignals: (limit = 50) => apiFetch(`/api/signals?limit=${limit}`),
  paperTradeSignal: (id: string) => apiFetch(`/api/signals/${id}/paper-trade`, { method: 'POST' }),
  rejectSignal: (id: string) => apiFetch(`/api/signals/${id}/reject`, { method: 'POST' }),

  // Memory
  searchMemory: (q: string) => apiFetch(`/api/memory/search?q=${encodeURIComponent(q)}`),
  getPendingRules: () => apiFetch('/api/memory/pending-rules'),
  getActiveRules: () => apiFetch('/api/memory/active-rules'),
  approveRule: (id: string) => apiFetch(`/api/memory/pending-rules/${id}/approve`, { method: 'POST' }),
  rejectRule: (id: string) => apiFetch(`/api/memory/pending-rules/${id}/reject`, { method: 'POST' }),

  // Audit
  getAuditLogs: (limit = 100) => apiFetch(`/api/audit?limit=${limit}`),

  // Settings
  getSettings: () => apiFetch('/api/settings'),
};
