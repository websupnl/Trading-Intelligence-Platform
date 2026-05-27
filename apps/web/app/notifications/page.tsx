'use client';

import { useState } from 'react';
import { Bell, Send } from 'lucide-react';
import { api } from '@/lib/api';
import { useApi } from '@/hooks/useApi';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import { LoadingSpinner } from '@/components/ui/loading';
import { fmtDate } from '@/lib/utils';

function statusVariant(status: string): 'success' | 'danger' | 'warning' | 'muted' {
  if (status === 'sent') return 'success';
  if (status === 'failed') return 'danger';
  if (status === 'pending') return 'warning';
  return 'muted';
}

function severityVariant(severity: string): 'danger' | 'warning' | 'default' {
  if (severity === 'critical') return 'danger';
  if (severity === 'warning') return 'warning';
  return 'default';
}

export default function NotificationsPage() {
  const { data: status, reload: reloadStatus } = useApi(() => api.getNotificationStatus(), []);
  const { data: notifications, loading, reload } = useApi(() => api.getNotifications(100), []);
  const [testing, setTesting] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  async function testTelegram() {
    setTesting(true);
    try {
      const result = await api.testTelegram();
      setMessage(result.message || result.status);
      await Promise.all([reload(), reloadStatus()]);
    } catch (error: any) {
      setMessage(error?.detail || 'Telegram-test mislukt.');
    } finally {
      setTesting(false);
    }
  }

  return (
    <div className="space-y-4 pb-20 md:pb-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-base font-semibold"><Bell size={16} /> Alerts</h1>
          <p className="mt-1 text-xs text-muted-foreground">
            Telegram ontvangt belangrijke events; de app bewaart ook mislukte of uitgeschakelde meldingen.
          </p>
        </div>
        <Button variant="success" size="sm" onClick={testTelegram} disabled={testing}>
          <Send size={13} /> {testing ? 'Versturen...' : 'Stuur testbericht'}
        </Button>
      </div>

      <Card>
        <CardContent className="flex flex-wrap items-center justify-between gap-3 p-4">
          <div>
            <p className="text-sm font-medium">Telegram kanaal</p>
            <p className="text-xs text-muted-foreground">
              Configureer `TELEGRAM_BOT_TOKEN` en `TELEGRAM_CHAT_ID` in Coolify.
            </p>
          </div>
          <Badge variant={status?.telegram_configured ? 'success' : 'muted'}>
            {status?.telegram_configured ? 'Geconfigureerd' : 'Niet ingesteld'}
          </Badge>
        </CardContent>
      </Card>

      {message && <div className="rounded-md border border-border bg-card p-3 text-sm">{message}</div>}

      <Card>
        <CardHeader><CardTitle>Notificatielog</CardTitle></CardHeader>
        <CardContent className="p-0">
          {loading && <LoadingSpinner />}
          {!loading && (!notifications || notifications.length === 0) && (
            <EmptyState message="Nog geen alerts geregistreerd." />
          )}
          {notifications?.map((notification: any) => (
            <div key={notification.id} className="border-b border-border px-4 py-3 last:border-0">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge variant={severityVariant(notification.severity)}>{notification.severity}</Badge>
                  <p className="text-sm font-medium">{notification.title}</p>
                </div>
                <div className="flex items-center gap-2">
                  <Badge variant={statusVariant(notification.status)}>{notification.status}</Badge>
                  <span className="text-xs text-muted-foreground">{fmtDate(notification.created_at)}</span>
                </div>
              </div>
              <p className="mt-1 whitespace-pre-line text-xs text-muted-foreground">{notification.message}</p>
              {notification.error_message && (
                <p className="mt-1 text-xs text-red-400">{notification.error_message}</p>
              )}
            </div>
          ))}
        </CardContent>
      </Card>
    </div>
  );
}
