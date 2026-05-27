'use client';
import { useApi } from '@/hooks/useApi';
import { api } from '@/lib/api';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { EmptyState } from '@/components/ui/empty-state';

export default function AIWarRoomPage() {
  const { data: config } = useApi(() => api.configStatus(), []);

  const aiConfigured = config?.anthropic?.configured || config?.openai?.configured;

  return (
    <div className="space-y-4">
      <h1 className="text-base font-semibold">AI War Room</h1>

      {!aiConfigured && (
        <div className="p-4 rounded-md bg-yellow-500/10 border border-yellow-500/20 text-yellow-400 text-sm">
          AI War Room vereist ANTHROPIC_API_KEY of OPENAI_API_KEY in .env.
          Vul de key in en herstart het systeem om de AI agents te activeren.
        </div>
      )}

      <div className="grid grid-cols-2 gap-4">
        {[
          { name: 'Bull Agent', desc: 'Analyseert bullish signalen en kansen', color: 'text-green-400' },
          { name: 'Bear Agent', desc: 'Analyseert bearish risicos en gevaren', color: 'text-red-400' },
          { name: 'Risk Agent', desc: 'Evalueert risico en positiegrootte', color: 'text-yellow-400' },
          { name: 'Strategy Agent', desc: 'Bepaalt finale strategie en conclusie', color: 'text-blue-400' },
        ].map(agent => (
          <Card key={agent.name}>
            <CardHeader>
              <CardTitle className={agent.color}>{agent.name}</CardTitle>
              <Badge variant={aiConfigured ? 'muted' : 'muted'}>{aiConfigured ? 'Beschikbaar' : 'N/C'}</Badge>
            </CardHeader>
            <CardContent>
              <p className="text-xs text-muted-foreground">{agent.desc}</p>
              {!aiConfigured && (
                <p className="text-xs text-muted-foreground mt-2">Vereist AI API key</p>
              )}
              {aiConfigured && (
                <EmptyState message="Geen actieve analyse. Selecteer een signal om te analyseren." className="py-6" />
              )}
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}
