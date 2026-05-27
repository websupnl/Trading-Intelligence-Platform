'use client';
import { useApi } from '@/hooks/useApi';
import { api } from '@/lib/api';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import { LoadingSpinner } from '@/components/ui/loading';
import { fmtDate } from '@/lib/utils';

export default function AuditPage() {
  const { data: logs, loading, reload } = useApi(() => api.getAuditLogs(200), []);

  return (
    <div className="space-y-4">
      <h1 className="text-base font-semibold">Audit Log</h1>
      <Card>
        <CardHeader>
          <CardTitle>Systeemgebeurtenissen</CardTitle>
          <Button variant="outline" size="sm" onClick={reload}>Vernieuwen</Button>
        </CardHeader>
        <CardContent className="p-0">
          {loading && <LoadingSpinner />}
          {!loading && (!logs || logs.length === 0) && <EmptyState message="Geen audit events" />}
          {logs?.map((e: any) => (
            <div key={e.id} className="flex items-center gap-4 px-4 py-2 border-b border-border last:border-0 hover:bg-muted/20">
              <span className="text-xs text-muted-foreground shrink-0 w-32">{fmtDate(e.created_at)}</span>
              <Badge variant={e.status === 'error' ? 'danger' : e.status === 'rejected' ? 'warning' : 'muted'}>{e.status}</Badge>
              <span className="text-sm font-medium">{e.action}</span>
              {e.message && <span className="text-xs text-muted-foreground truncate">{e.message}</span>}
              {e.entity_type && <span className="text-xs text-muted-foreground ml-auto shrink-0">{e.entity_type} {e.entity_id?.slice(0, 8)}</span>}
            </div>
          ))}
        </CardContent>
      </Card>
    </div>
  );
}
