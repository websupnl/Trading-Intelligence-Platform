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
  label, value, description, onToggle, loading, danger
}: {
  label: string;
  value: boolean;
  description?: string;
  onToggle: () => void;
  loading?: boolean;
  danger?: boolean;
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
          value ? (danger ? 'bg-[#f6465d]' : 'bg-[#2ebd85]') : 'bg-muted'
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

function NumericField({
  label, value, description, onSave, loading, min, max, step, suffix, prefix
}: {
  label: string;
  value: number;
  description?: string;
  onSave: (v: number) => void;
  loading?: boolean;
  min?: number;
  max?: number;
  step?: number;
  suffix?: string;
  prefix?: string;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');

  function startEdit() {
    setDraft(String(value));
    setEditing(true);
  }

  function cancel() {
    setEditing(false);
  }

  function save() {
    const num = parseFloat(draft);
    if (isNaN(num)) return;
    onSave(num);
    setEditing(false);
  }

  return (
    <div className="flex items-center justify-between py-3 border-b border-border last:border-0">
      <div>
        <p className="text-sm font-medium">{label}</p>
        {description && <p className="text-xs text-muted-foreground">{description}</p>}
      </div>
      {editing ? (
        <div className="flex items-center gap-1.5">
          {prefix && <span className="text-xs text-muted-foreground">{prefix}</span>}
          <input
            type="number"
            className="w-24 text-right text-sm bg-background border border-border rounded px-2 py-1 focus:outline-none focus:ring-1 focus:ring-primary"
            value={draft}
            min={min}
            max={max}
            step={step ?? 1}
            onChange={e => setDraft(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') save(); if (e.key === 'Escape') cancel(); }}
            autoFocus
          />
          {suffix && <span className="text-xs text-muted-foreground">{suffix}</span>}
          <button onClick={save} disabled={loading} className="text-xs text-[#2ebd85] hover:opacity-80 px-1">✓</button>
          <button onClick={cancel} className="text-xs text-muted-foreground hover:text-foreground px-1">✕</button>
        </div>
      ) : (
        <button
          onClick={startEdit}
          disabled={loading}
          className="text-sm font-medium tabular-nums hover:text-primary transition-colors group flex items-center gap-1.5"
        >
          {prefix}{value != null ? value : '—'}{suffix && <span className="text-muted-foreground">{suffix}</span>}
          <span className="text-xs text-muted-foreground opacity-0 group-hover:opacity-100">✎</span>
        </button>
      )}
    </div>
  );
}

export default function SettingsPage() {
  const { data: settings, loading, reload } = useApi(() => api.getSettings(), []);
  const [saving, setSaving] = useState<string | null>(null);
  const [resetting, setResetting] = useState(false);
  const { toast } = useToast();

  async function handleResetTradeData() {
    if (!confirm('Weet je zeker dat je alle trade- en signaaldata wilt wissen? Dit kan niet ongedaan worden gemaakt.\n\nNews, candles en memory blijven bewaard.')) return;
    setResetting(true);
    try {
      await api.resetTradeData();
      toast('✅ Trade data gewist — schone lei', 'success');
      reload();
    } catch (e: any) {
      toast(`❌ ${e?.detail || 'Reset mislukt'}`, 'error');
    } finally {
      setResetting(false);
    }
  }

  async function toggle(key: string, current: boolean) {
    setSaving(key);
    try {
      await api.updateRuntimeSettings({ [key]: !current });
      toast(`✅ ${key.replace(/_/g, ' ')} → ${!current}`, 'success');
      await reload();
    } catch (e: any) {
      toast(`❌ ${e?.detail || 'Opslaan mislukt'}`, 'error');
    } finally {
      setSaving(null);
    }
  }

  async function saveNum(key: string, value: number) {
    setSaving(key);
    try {
      await api.updateRuntimeSettings({ [key]: value });
      toast(`✅ ${key.replace(/_/g, ' ')} → ${value}`, 'success');
      await reload();
    } catch (e: any) {
      toast(`❌ ${e?.detail || 'Opslaan mislukt'}`, 'error');
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
                danger
              />
              <Toggle
                label="Live Trading"
                value={settings.live_trading_enabled}
                description="Schakel live orders in (gevaarlijk!)"
                onToggle={() => toggle('live_trading_enabled', settings.live_trading_enabled)}
                loading={saving === 'live_trading_enabled'}
                danger
              />
              <Toggle
                label="Handmatige Bevestiging"
                value={settings.require_manual_confirmation}
                description="Vereist je goedkeuring voor elke order"
                onToggle={() => toggle('require_manual_confirmation', settings.require_manual_confirmation)}
                loading={saving === 'require_manual_confirmation'}
              />
              <Toggle
                label="Crypto 24/7"
                value={settings.crypto_24_7_enabled}
                description="Handel ook buiten markturen in crypto"
                onToggle={() => toggle('crypto_24_7_enabled', settings.crypto_24_7_enabled)}
                loading={saving === 'crypto_24_7_enabled'}
              />
              <Toggle
                label="Micro Trading"
                value={settings.micro_trading_enabled}
                description="Rule-based scalping op 15m candles (geen AI)"
                onToggle={() => toggle('micro_trading_enabled', settings.micro_trading_enabled)}
                loading={saving === 'micro_trading_enabled'}
              />
              <Toggle
                label="Short Selling"
                value={settings.allow_short_selling}
                description="Sta verkoop-posities toe (standaard uit)"
                onToggle={() => toggle('allow_short_selling', settings.allow_short_selling)}
                loading={saving === 'allow_short_selling'}
                danger
              />
              <div className="mt-3 flex items-center gap-2">
                <span className="text-sm text-muted-foreground">Trading Mode:</span>
                <Badge variant={settings.trading_mode === 'paper' ? 'warning' : 'danger'}>
                  {settings.trading_mode}
                </Badge>
              </div>
              {settings.runtime_overrides?.length > 0 && (
                <p className="text-xs text-muted-foreground mt-2">
                  Actieve overrides: {settings.runtime_overrides.join(', ')}
                </p>
              )}
            </CardContent>
          </Card>

          {/* Risk limieten */}
          <Card>
            <CardHeader><CardTitle>🛡️ Risk Limieten</CardTitle></CardHeader>
            <CardContent>
              <NumericField
                label="Positie grootte"
                value={Math.round(settings.position_size_pct * 100)}
                description="% van account equity per trade"
                onSave={v => saveNum('position_size_pct', v / 100)}
                loading={saving === 'position_size_pct'}
                min={1} max={50} step={1} suffix="%"
              />
              <NumericField
                label="Max positie (USD)"
                value={settings.max_position_size_usd}
                description="Maximaal bedrag per order"
                onSave={v => saveNum('max_position_size_usd', v)}
                loading={saving === 'max_position_size_usd'}
                min={10} step={10} prefix="$"
              />
              <NumericField
                label="Max dagverlies"
                value={Math.round(settings.max_daily_loss_pct * 100)}
                description="Circuit breaker bij dagverlies"
                onSave={v => saveNum('max_daily_loss_pct', v / 100)}
                loading={saving === 'max_daily_loss_pct'}
                min={1} max={50} step={1} suffix="%"
              />
              <NumericField
                label="Max open posities"
                value={settings.max_open_positions}
                description="Gelijktijdige posities"
                onSave={v => saveNum('max_open_positions', v)}
                loading={saving === 'max_open_positions'}
                min={1} max={20} step={1}
              />
              <NumericField
                label="Max trades/dag"
                value={settings.max_trades_per_day}
                description="Dagelijks handelslimiet"
                onSave={v => saveNum('max_trades_per_day', v)}
                loading={saving === 'max_trades_per_day'}
                min={1} max={100} step={1}
              />
              <NumericField
                label="Min. confidence (auto)"
                value={Math.round(settings.min_confidence_for_auto * 100)}
                description="Onder dit niveau → handmatig"
                onSave={v => saveNum('min_confidence_for_auto', v / 100)}
                loading={saving === 'min_confidence_for_auto'}
                min={30} max={95} step={1} suffix="%"
              />
              <NumericField
                label="Min. confidence (reject)"
                value={Math.round(settings.manual_approval_threshold * 100)}
                description="Onder dit niveau → geblokkeerd"
                onSave={v => saveNum('manual_approval_threshold', v / 100)}
                loading={saving === 'manual_approval_threshold'}
                min={10} max={90} step={1} suffix="%"
              />
            </CardContent>
          </Card>

          {/* AI budget & model */}
          <Card>
            <CardHeader><CardTitle>🤖 AI Instellingen</CardTitle></CardHeader>
            <CardContent>
              <NumericField
                label="Dagbudget AI"
                value={settings.ai_daily_budget_usd}
                description="Max AI-kosten per dag (0 = onbeperkt)"
                onSave={v => saveNum('ai_daily_budget_usd', v)}
                loading={saving === 'ai_daily_budget_usd'}
                min={0} step={0.5} prefix="$"
              />
              <div className="flex justify-between text-sm py-3 border-b border-border">
                <span className="text-muted-foreground">Signaal model</span>
                <span className="font-medium truncate ml-4">{settings.anthropic_model}</span>
              </div>
              <div className="flex justify-between text-sm py-3 border-b border-border">
                <span className="text-muted-foreground">Analyse model</span>
                <span className="font-medium truncate ml-4">{settings.anthropic_analysis_model}</span>
              </div>
              <div className="flex justify-between text-sm py-3 border-b border-border">
                <span className="text-muted-foreground">Max tokens</span>
                <span className="font-medium">{settings.anthropic_max_tokens?.toLocaleString()}</span>
              </div>
              <div className="flex justify-between text-sm py-3 border-b border-border">
                <span className="text-muted-foreground">Prompt caching</span>
                <Badge variant={settings.anthropic_enable_prompt_caching ? 'success' : 'muted'}>
                  {settings.anthropic_enable_prompt_caching ? 'Aan' : 'Uit'}
                </Badge>
              </div>
              <div className="flex justify-between text-sm py-3">
                <span className="text-muted-foreground">Web search</span>
                <Badge variant={settings.anthropic_enable_web_search ? 'success' : 'muted'}>
                  {settings.anthropic_enable_web_search ? 'Aan' : 'Uit'}
                </Badge>
              </div>
              <p className="text-xs text-muted-foreground mt-2">
                Model en API keys wijzigen: update env vars in Coolify en herstart.
              </p>
            </CardContent>
          </Card>

          {/* Integraties */}
          <Card>
            <CardHeader><CardTitle>🔌 Integraties</CardTitle></CardHeader>
            <CardContent>
              {[
                { label: 'Alpaca (stocks)', ok: settings.alpaca_configured },
                { label: 'Bitvavo (crypto NL)', ok: settings.bitvavo_configured },
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
              <div className="flex justify-between py-2 border-b border-border">
                <span className="text-sm text-muted-foreground">Nieuws feeds</span>
                <span className="text-sm">{settings.news_feed_count} feeds</span>
              </div>
              <div className="flex justify-between py-2">
                <span className="text-sm text-muted-foreground">Crypto feeds</span>
                <span className="text-sm">{settings.crypto_feed_count} feeds</span>
              </div>
              <p className="mt-2 text-xs text-muted-foreground">
                API keys instellen via env vars in Coolify.
              </p>
            </CardContent>
          </Card>

        </div>
      )}

      {/* Gevaarzone */}
      <Card className="border-red-500/30">
        <CardHeader><CardTitle className="text-red-400">⚠️ Gevaarzone</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium">Trade data wissen</p>
              <p className="text-xs text-muted-foreground">Wist trades, signals, orders, posities en audit logs. News, candles en memory blijven bewaard.</p>
            </div>
            <Button
              variant="outline"
              size="sm"
              className="border-red-500/50 text-red-400 hover:bg-red-500/10 shrink-0"
              onClick={handleResetTradeData}
              disabled={resetting}
            >
              {resetting ? '⏳ Wissen...' : '🗑️ Reset Trade Data'}
            </Button>
          </div>
          <p className="text-xs text-muted-foreground">
            Reset ook je Alpaca paper account via <span className="font-mono">paper.alpaca.markets</span> → Account → Reset.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
