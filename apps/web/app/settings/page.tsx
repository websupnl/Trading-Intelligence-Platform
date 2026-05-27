'use client';
import { useApi } from '@/hooks/useApi';
import { api } from '@/lib/api';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { LoadingSpinner } from '@/components/ui/loading';

function Row({ label, value, ok }: { label: string; value: string | boolean | number; ok?: boolean }) {
  return (
    <div className="flex items-center justify-between py-2 border-b border-border last:border-0">
      <span className="text-sm text-muted-foreground">{label}</span>
      {typeof value === 'boolean' ? (
        <Badge variant={ok !== undefined ? (ok ? 'success' : 'danger') : (value ? 'success' : 'muted')}>
          {value ? 'Ja' : 'Nee'}
        </Badge>
      ) : (
        <span className="text-sm font-medium">{String(value)}</span>
      )}
    </div>
  );
}

export default function SettingsPage() {
  const { data: settings, loading } = useApi(() => api.getSettings(), []);
  const { data: risk } = useApi(() => api.getRiskStatus(), []);

  async function handleKillSwitch(enable: boolean) {
    if (enable) await api.enableKillSwitch();
    else await api.disableKillSwitch();
    window.location.reload();
  }

  return (
    <div className="space-y-4">
      <h1 className="text-base font-semibold">Instellingen</h1>

      {loading && <LoadingSpinner />}

      {settings && (
        <div className="grid grid-cols-2 gap-4">
          <Card>
            <CardHeader><CardTitle>Trading Veiligheid</CardTitle></CardHeader>
            <CardContent>
              <Row label="Trading Mode" value={settings.trading_mode} />
              <Row label="Live Trading" value={settings.live_trading_enabled} ok={!settings.live_trading_enabled} />
              <Row label="Kill Switch" value={settings.kill_switch_enabled} ok={!settings.kill_switch_enabled} />
              <Row label="Handmatige Bevestiging" value={settings.require_manual_confirmation} ok={settings.require_manual_confirmation} />
              <Row label="Mock Data" value={settings.use_mock_data} ok={!settings.use_mock_data} />

              <div className="mt-4 flex gap-2">
                <Button
                  variant={settings.kill_switch_enabled ? 'success' : 'destructive'}
                  size="sm"
                  onClick={() => handleKillSwitch(!settings.kill_switch_enabled)}
                >
                  {settings.kill_switch_enabled ? 'Kill Switch Uitschakelen' : 'Kill Switch Activeren'}
                </Button>
              </div>
              <p className="text-xs text-muted-foreground mt-2">
                Kill switch blokkeert alle orders. Permanente wijzigingen vereisen herstart na .env aanpassing.
              </p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader><CardTitle>Integraties</CardTitle></CardHeader>
            <CardContent>
              <Row label="Alpaca" value={settings.alpaca_configured} ok={settings.alpaca_configured} />
              <Row label="Anthropic Claude" value={settings.anthropic_configured} ok={settings.anthropic_configured} />
              <Row label="OpenAI" value={settings.openai_configured} />
              <Row label="Reddit" value={settings.reddit_configured} />
              <Row label="X/Twitter" value={settings.x_configured} />
              <Row label="AI Provider" value={settings.default_ai_provider} />
              <Row label="AI Model" value={settings.anthropic_model} />
              <Row label="Nieuws Feeds" value={`${settings.news_feed_count} feeds`} />
              <Row label="Crypto Feeds" value={`${settings.crypto_feed_count} feeds`} />
              <p className="mt-3 text-xs text-muted-foreground">
                API keys worden niet getoond. Pas .env aan en herstart voor wijzigingen.
              </p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader><CardTitle>Risk Limieten</CardTitle></CardHeader>
            <CardContent>
              {risk && (
                <>
                  <Row label="Max Positiegrootte" value={`$${risk.max_position_size_usd?.toLocaleString()}`} />
                  <Row label="Max Trades/Dag" value={risk.max_trades_per_day} />
                  <Row label="Max Open Posities" value={risk.max_open_positions} />
                </>
              )}
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  );
}
