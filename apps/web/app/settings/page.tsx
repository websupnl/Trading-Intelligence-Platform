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
import { Bot, Cpu, Plug, Settings, Shield, Trash2, AlertTriangle } from 'lucide-react';

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
        {description && <p className="text-xs text-muted-foreground mt-0.5">{description}</p>}
      </div>
      <button
        onClick={onToggle}
        disabled={loading}
        className={cn(
          'relative inline-flex h-5 w-9 items-center rounded-full transition-colors disabled:opacity-50 shrink-0 ml-4',
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
  const [resetting, setResetting] = useState(false);
  const { toast } = useToast();

  async function handleResetTradeData() {
    if (!confirm('Weet je zeker dat je alle trade- en signaaldata wilt wissen? Dit kan niet ongedaan worden gemaakt.\n\nNieuws, candles en geheugen blijven bewaard.')) return;
    setResetting(true);
    try {
      await api.resetTradeData();
      toast('Trade data gewist — schone lei', 'success');
      reload();
    } catch (e: any) {
      toast(`Reset mislukt: ${e?.detail || 'Onbekende fout'}`, 'error');
    } finally {
      setResetting(false);
    }
  }

  async function toggle(key: string, current: boolean) {
    setSaving(key);
    try {
      await api.updateRuntimeSettings({ [key]: !current });
      toast(`Instelling bijgewerkt`, 'success');
      await reload();
    } catch (e: any) {
      toast(`Opslaan mislukt: ${e?.detail || 'Onbekende fout'}`, 'error');
    } finally {
      setSaving(null);
    }
  }

  async function handleKillSwitch(enable: boolean) {
    setSaving('kill_switch');
    try {
      if (enable) await api.enableKillSwitch();
      else await api.disableKillSwitch();
      toast(
        enable ? 'Kill switch geactiveerd — alle orders geblokkeerd' : 'Kill switch uitgeschakeld',
        enable ? 'warning' : 'success'
      );
      await reload();
    } catch {
      toast('Kill switch actie mislukt', 'error');
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
            <CardHeader>
              <div className="flex items-center gap-2">
                <Shield size={15} />
                <CardTitle>Trading Veiligheid</CardTitle>
              </div>
            </CardHeader>
            <CardContent>
              <Toggle
                label="Kill Switch"
                value={settings.kill_switch_enabled}
                description="Blokkeert alle orders direct — noodstop"
                onToggle={() => handleKillSwitch(!settings.kill_switch_enabled)}
                loading={saving === 'kill_switch'}
              />
              <Toggle
                label="Live Trading"
                value={settings.live_trading_enabled}
                description="Schakel echte live orders in (gevaarlijk!)"
                onToggle={() => toggle('live_trading_enabled', settings.live_trading_enabled)}
                loading={saving === 'live_trading_enabled'}
              />
              <Toggle
                label="Handmatige Bevestiging"
                value={settings.require_manual_confirmation}
                description="Vereist jouw goedkeuring voor elke order"
                onToggle={() => toggle('require_manual_confirmation', settings.require_manual_confirmation)}
                loading={saving === 'require_manual_confirmation'}
              />

              <div className="mt-4 flex items-center gap-2">
                <span className="text-sm text-muted-foreground">Trading Modus:</span>
                <Badge variant={settings.trading_mode === 'paper' ? 'warning' : 'danger'}>
                  {settings.trading_mode === 'paper' ? 'Paper (gesimuleerd)' : settings.trading_mode}
                </Badge>
              </div>

              {settings.runtime_overrides?.length > 0 && (
                <p className="text-xs text-muted-foreground mt-3 bg-muted/40 rounded p-2">
                  Actieve veiligheidsregels: {settings.runtime_overrides.join(', ')}
                </p>
              )}
            </CardContent>
          </Card>

          {/* Integraties */}
          <Card>
            <CardHeader>
              <div className="flex items-center gap-2">
                <Plug size={15} />
                <CardTitle>Gekoppelde Diensten</CardTitle>
              </div>
            </CardHeader>
            <CardContent>
              {[
                { label: 'Alpaca (broker)', ok: settings.alpaca_configured },
                { label: 'Anthropic Claude (AI)', ok: settings.anthropic_configured },
                { label: 'OpenAI', ok: settings.openai_configured },
                { label: 'Reddit', ok: settings.reddit_configured },
                { label: 'X / Twitter', ok: settings.x_configured },
                { label: 'Telegram Meldingen', ok: settings.telegram_configured },
              ].map(({ label, ok }) => (
                <div key={label} className="flex items-center justify-between py-2.5 border-b border-border last:border-0">
                  <span className="text-sm text-muted-foreground">{label}</span>
                  <Badge variant={ok ? 'success' : 'muted'}>{ok ? 'Gekoppeld' : 'Niet ingesteld'}</Badge>
                </div>
              ))}
              <div className="flex items-center justify-between py-2.5">
                <span className="text-sm text-muted-foreground">AI Model</span>
                <span className="text-sm font-medium">{settings.anthropic_model}</span>
              </div>
            </CardContent>
          </Card>

          {/* Risk limieten */}
          <Card>
            <CardHeader>
              <div className="flex items-center gap-2">
                <Settings size={15} />
                <CardTitle>Risicolimieten</CardTitle>
              </div>
            </CardHeader>
            <CardContent>
              {risk && (
                <div className="space-y-0">
                  {[
                    ['Max positiegrootte', `$${risk.max_position_size_usd?.toLocaleString()}`],
                    ['Max trades per dag', String(risk.max_trades_per_day)],
                    ['Max open posities', String(risk.max_open_positions)],
                    ['Auto-trade drempel', risk.auto_trade_threshold != null
                      ? `${(risk.auto_trade_threshold * 100).toFixed(0)}% vertrouwen`
                      : `${(risk.min_confidence_for_auto * 100 || 60).toFixed(0)}% vertrouwen`],
                  ].map(([label, value]) => (
                    <div key={label} className="flex justify-between text-sm border-b border-border last:border-0 py-2.5">
                      <span className="text-muted-foreground">{label}</span>
                      <span className="font-medium">{value}</span>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>

          {/* AI instellingen */}
          <Card>
            <CardHeader>
              <div className="flex items-center gap-2">
                <Bot size={15} />
                <CardTitle>AI Configuratie</CardTitle>
              </div>
            </CardHeader>
            <CardContent>
              <div className="space-y-0 text-sm">
                <div className="flex justify-between border-b border-border py-2.5">
                  <span className="text-muted-foreground">Provider</span>
                  <span>{settings.default_ai_provider}</span>
                </div>
                <div className="flex justify-between border-b border-border py-2.5">
                  <span className="text-muted-foreground">Model</span>
                  <span>{settings.anthropic_model}</span>
                </div>
                <div className="flex justify-between border-b border-border py-2.5">
                  <span className="text-muted-foreground">Nieuwsfeeds</span>
                  <span>{settings.news_feed_count} feeds</span>
                </div>
                <div className="flex justify-between py-2.5">
                  <span className="text-muted-foreground">Crypto feeds</span>
                  <span>{settings.crypto_feed_count} feeds</span>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>
      )}

      {/* Gevaarzone */}
      <Card className="border-red-300/50">
        <CardHeader>
          <div className="flex items-center gap-2">
            <AlertTriangle size={15} className="text-red-500" />
            <CardTitle className="text-red-500">Gevaarzone</CardTitle>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-start justify-between gap-4">
            <div>
              <p className="text-sm font-medium">Trade data wissen</p>
              <p className="text-xs text-muted-foreground mt-0.5">
                Wist alle trades, signalen, orders, posities en auditlogs. Nieuws, candles en geheugen blijven bewaard.
              </p>
            </div>
            <Button
              variant="outline"
              size="sm"
              className="border-red-300 text-red-500 hover:bg-red-50 shrink-0"
              onClick={handleResetTradeData}
              disabled={resetting}
            >
              <Trash2 size={13} />
              {resetting ? 'Wissen...' : 'Wis Trade Data'}
            </Button>
          </div>
          <p className="text-xs text-muted-foreground border-t border-border pt-3">
            Reset ook je Alpaca paper account via <span className="font-mono text-foreground">paper.alpaca.markets</span> om open posities te sluiten.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
