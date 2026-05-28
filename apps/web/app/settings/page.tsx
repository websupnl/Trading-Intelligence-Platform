'use client';
import { useState } from 'react';
import { useApi } from '@/hooks/useApi';
import { api } from '@/lib/api';
import { useToast } from '@/contexts/toast';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { LoadingSpinner } from '@/components/ui/loading';
import { cn } from '@/lib/utils';

function Toggle({
  label, value, description, onToggle, loading
}: {
  label: string;
  value: boolean;
  description?: string;
  onToggle: () => void;
  loading?: boolean;
}) {
  return (
    <div className="flex items-center justify-between py-3 border-b border-border last:border-0">
      <div>
        <p className="text-sm font-medium">{label}</p>
        {description && <p className="text-xs text-muted-foreground">{description}</p>}
      </div>
      <button
        onClick={onToggle}
        disabled={loading}
        className={cn(
          'relative inline-flex h-5 w-9 items-center rounded-full transition-colors disabled:opacity-50',
          value ? 'bg-green-500' : 'bg-muted'
        )}
      >
        <span className={cn(
          'inline-block h-3.5 w-3.5 transform rounded-full bg-white transition-transform mx-0.5',
          value ? 'translate-x-4' : 'translate-x-0'
        )} />
      </button>
    </div>
  );
}

export default function SettingsPage() {
  const { data: settings, loading, reload } = useApi(() => api.getSettings(), []);
  const { data: risk } = useApi(() => api.getRiskStatus(), []);
  const [saving, setSaving] = useState<string | null>(null);
  const { toast } = useToast();

  async function toggle(key: string, current: boolean) {
    setSaving(key);
    try {
      await api.updateRuntimeSettings({ [key]: !current });
      toast(`✅ ${key.replace(/_/g, ' ')} bijgewerkt naar ${!current}`, 'success');
      await reload();
    } catch (e: any) {
      toast(`❌ ${e?.detail || 'Instelling opslaan mislukt'}`, 'error');
    } finally {
      setSaving(null);
    }
  }

  async function handleKillSwitch(enable: boolean) {
    setSaving('kill_switch');
    try {
      if (enable) await api.enableKillSwitch();
      else await api.disableKillSwitch();
      toast(enable ? '🛑 Kill switch geactiveerd — alle orders geblokkeerd' : '✅ Kill switch uitgeschakeld', enable ? 'warning' : 'success');
      await reload();
    } catch {
      toast('❌ Kill switch actie mislukt', 'error');
    } finally {
      setSaving(null);
    }
  }

  return (
    <div className="space-y-4 pb-20 md:pb-4">
      <h1 className="text-base font-semibold">Instellingen</h1>

      {loading && <LoadingSpinner />}

      {settings && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {/* Trading veiligheid */}
          <Card>
            <CardHeader><CardTitle>⚙️ Trading Veiligheid</CardTitle></CardHeader>
            <CardContent>
              <Toggle
                label="Kill Switch"
                value={settings.kill_switch_enabled}
                description="Blokkeert alle orders direct"
                onToggle={() => handleKillSwitch(!settings.kill_switch_enabled)}
                loading={saving === 'kill_switch'}
              />
              <Toggle
                label="Live Trading"
                value={settings.live_trading_enabled}
                description="Schakel live orders in (gevaarlijk!)"
                onToggle={() => toggle('live_trading_enabled', settings.live_trading_enabled)}
                loading={saving === 'live_trading_enabled'}
              />
              <Toggle
                label="Handmatige Bevestiging"
                value={settings.require_manual_confirmation}
                description="Vereist je goedkeuring voor elke order"
                onToggle={() => toggle('require_manual_confirmation', settings.require_manual_confirmation)}
                loading={saving === 'require_manual_confirmation'}
              />

              <div className="mt-3 flex items-center gap-2">
                <span className="text-sm text-muted-foreground">Trading Mode:</span>
                <Badge variant={settings.trading_mode === 'paper' ? 'warning' : 'danger'}>
                  {settings.trading_mode}
                </Badge>
              </div>

              {settings.runtime_overrides?.length > 0 && (
                <p className="text-xs text-muted-foreground mt-2">
                  Safety-instellingen actief: {settings.runtime_overrides.join(', ')}
                  <br />Opgeslagen in de database en gedeeld met workers via Redis.
                </p>
              )}
            </CardContent>
          </Card>

          {/* Integraties */}
          <Card>
            <CardHeader><CardTitle>🔌 Integraties</CardTitle></CardHeader>
            <CardContent>
              {[
                { label: 'Alpaca', ok: settings.alpaca_configured },
                { label: 'Anthropic Claude', ok: settings.anthropic_configured },
                { label: 'OpenAI', ok: settings.openai_configured },
                { label: 'Reddit', ok: settings.reddit_configured },
                { label: 'X/Twitter', ok: settings.x_configured },
                { label: 'Telegram Alerts', ok: settings.telegram_configured },
              ].map(({ label, ok }) => (
                <div key={label} className="flex items-center justify-between py-2 border-b border-border last:border-0">
                  <span className="text-sm text-muted-foreground">{label}</span>
                  <Badge variant={ok ? 'success' : 'muted'}>{ok ? 'Geconfigureerd' : 'Niet ingesteld'}</Badge>
                </div>
              ))}
              <div className="flex items-center justify-between py-2">
                <span className="text-sm text-muted-foreground">AI Model</span>
                <span className="text-sm font-medium">{settings.anthropic_model}</span>
              </div>
              <p className="mt-2 text-xs text-muted-foreground">
                API keys aanpassen: update .env en herstart.
              </p>
            </CardContent>
          </Card>

          {/* Risk limieten */}
          <Card>
            <CardHeader><CardTitle>🛡️ Risk Limieten</CardTitle></CardHeader>
            <CardContent>
              {risk && (
                <div className="space-y-2">
                  {[
                    ['Max Positiegrootte', `$${risk.max_position_size_usd?.toLocaleString()}`],
                    ['Max Trades/Dag', String(risk.max_trades_per_day)],
                    ['Max Open Posities', String(risk.max_open_positions)],
                    ['Auto Trade Threshold', `${(risk.auto_trade_threshold * 100).toFixed(0)}% confidence`],
                  ].map(([label, value]) => (
                    <div key={label} className="flex justify-between text-sm border-b border-border last:border-0 py-2">
                      <span className="text-muted-foreground">{label}</span>
                      <span className="font-medium">{value}</span>
                    </div>
                  ))}
                  <p className="text-xs text-muted-foreground mt-2">
                    Limieten aanpassen: update risk_engine.py of voeg SystemSettings DB toe.
                  </p>
                </div>
              )}
            </CardContent>
          </Card>

          {/* AI instellingen */}
          <Card>
            <CardHeader><CardTitle>🤖 AI Instellingen</CardTitle></CardHeader>
            <CardContent>
              <div className="space-y-2 text-sm">
                <div className="flex justify-between border-b border-border py-2">
                  <span className="text-muted-foreground">Provider</span>
                  <span>{settings.default_ai_provider}</span>
                </div>
                <div className="flex justify-between border-b border-border py-2">
                  <span className="text-muted-foreground">Model</span>
                  <span>{settings.anthropic_model}</span>
                </div>
                <div className="flex justify-between border-b border-border py-2">
                  <span className="text-muted-foreground">Nieuws Feeds</span>
                  <span>{settings.news_feed_count} feeds</span>
                </div>
                <div className="flex justify-between py-2">
                  <span className="text-muted-foreground">Crypto Feeds</span>
                  <span>{settings.crypto_feed_count} feeds</span>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  );
}
