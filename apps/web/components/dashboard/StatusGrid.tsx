'use client';
import { useApi } from '@/hooks/useApi';
import { api } from '@/lib/api';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { LoadingSpinner } from '@/components/ui/loading';

export function StatusGrid() {
  const { data: config, loading } = useApi(() => api.configStatus(), []);

  if (loading) return <LoadingSpinner />;
  if (!config) return null;

  const integrations = [
    { name: 'Alpaca', data: config.alpaca },
    { name: 'Anthropic', data: config.anthropic },
    { name: 'OpenAI', data: config.openai },
    { name: 'Reddit', data: config.reddit },
    { name: 'X/Twitter', data: config.x_twitter },
    { name: 'Telegram', data: config.telegram },
    { name: 'Nieuwsfeeds', data: config.news_feeds },
    { name: 'Crypto feeds', data: config.crypto_feeds },
  ];

  return (
    <Card>
      <CardHeader>
        <CardTitle>Systeemstatus</CardTitle>
        <div className="flex gap-2">
          <Badge variant={config.trading_mode === 'paper' ? 'success' : 'warning'}>
            {config.trading_mode?.toUpperCase()}
          </Badge>
          {config.kill_switch_enabled && <Badge variant="danger">KILL SWITCH</Badge>}
          {config.live_trading_enabled && <Badge variant="warning">LIVE TRADING</Badge>}
        </div>
      </CardHeader>
      <CardContent>
        <div className="mb-3 rounded-md border border-border bg-accent/40 p-2 text-xs">
          <p className="font-medium text-foreground">Automation status</p>
          <p className="mt-0.5 text-muted-foreground">
            {config.kill_switch_enabled
              ? 'Geblokkeerd: kill switch staat aan.'
              : config.require_manual_confirmation
                ? 'AI analyseert automatisch; orders vereisen bevestiging.'
                : config.trading_mode === 'paper'
                  ? 'AI kan goedgekeurde signalen automatisch paper-traden.'
                  : 'Live modus actief: controleer risico en approvals.'}
          </p>
        </div>
        <div className="grid grid-cols-2 gap-2">
          {integrations.map(({ name, data }) => (
            <div key={name} className="flex items-center justify-between py-1.5 px-2 rounded bg-muted/30">
              <span className="text-xs text-muted-foreground">{name}</span>
              <Badge variant={data?.configured ? 'success' : 'muted'}>
                {data?.configured ? 'OK' : 'N/C'}
              </Badge>
            </div>
          ))}
        </div>
        {config.use_mock_data && (
          <div className="mt-3 p-2 rounded bg-yellow-500/10 border border-yellow-500/20 text-yellow-400 text-xs">
            USE_MOCK_DATA is actief - echte data wordt niet gebruikt
          </div>
        )}
      </CardContent>
    </Card>
  );
}
