'use client';
import { useState, useRef, useEffect } from 'react';
import { usePathname } from 'next/navigation';
import { MessageCircle, X, Send, Loader2, Bot, Trash2 } from 'lucide-react';
import { cn } from '@/lib/utils';

const API_BASE = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000';

function getPin(): string {
  if (typeof window === 'undefined') return '';
  return sessionStorage.getItem('dashboard_pin') || '';
}

interface Message {
  role: 'user' | 'assistant';
  content: string;
  toolCalls?: string[];
}

const SUGGESTED = [
  'Hoe loopt de bot nu?',
  'Wat zijn de actieve signalen?',
  'Wat is mijn portfolio waard?',
  'Analyseer NVDA voor mij',
  'Wat zijn de laatste geruchten?',
  'Hoeveel trades zijn er vandaag?',
];

// Simple markdown-ish renderer: bold, newlines, bullet points
function renderText(text: string) {
  const lines = text.split('\n');
  return lines.map((line, i) => {
    // Bold: **text** or *text*
    const parts = line.split(/(\*\*[^*]+\*\*|\*[^*]+\*)/g);
    const rendered = parts.map((part, j) => {
      if (part.startsWith('**') && part.endsWith('**')) {
        return <strong key={j}>{part.slice(2, -2)}</strong>;
      }
      if (part.startsWith('*') && part.endsWith('*')) {
        return <em key={j}>{part.slice(1, -1)}</em>;
      }
      return <span key={j}>{part}</span>;
    });
    const isBullet = line.trimStart().startsWith('- ') || line.trimStart().startsWith('• ');
    return (
      <span key={i}>
        {isBullet ? '• ' : ''}{isBullet ? rendered.map((r, j) => j === 0 ? null : r) : rendered}
        {i < lines.length - 1 && <br />}
      </span>
    );
  });
}

export function ChatPanel() {
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [streaming, setStreaming] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const pathname = usePathname();

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, streaming]);

  useEffect(() => {
    if (open) setTimeout(() => inputRef.current?.focus(), 100);
  }, [open]);

  const send = async (text?: string) => {
    const msg = (text || input).trim();
    if (!msg || streaming) return;
    setInput('');

    const newMessages: Message[] = [...messages, { role: 'user', content: msg }];
    setMessages(newMessages);
    setStreaming(true);

    const assistantMsg: Message = { role: 'assistant', content: '', toolCalls: [] };
    setMessages(prev => [...prev, assistantMsg]);

    try {
      const pin = getPin();
      const headers: Record<string, string> = { 'Content-Type': 'application/json' };
      if (pin) headers['X-Dashboard-Pin'] = pin;

      const res = await fetch(`${API_BASE}/api/chat/stream`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          messages: newMessages.map(m => ({ role: m.role, content: m.content })),
          context: `Pagina: ${pathname}`,
        }),
      });

      if (!res.ok) {
        throw new Error(`HTTP ${res.status}`);
      }

      const reader = res.body?.getReader();
      const decoder = new TextDecoder();
      if (!reader) return;

      let buffer = '';
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          if (!line.startsWith('data: ')) continue;
          try {
            const event = JSON.parse(line.slice(6));
            if (event.type === 'text') {
              setMessages(prev => {
                const updated = [...prev];
                const last = updated[updated.length - 1];
                if (last.role === 'assistant') {
                  updated[updated.length - 1] = { ...last, content: last.content + event.text };
                }
                return updated;
              });
            } else if (event.type === 'tool_call') {
              setMessages(prev => {
                const updated = [...prev];
                const last = updated[updated.length - 1];
                if (last.role === 'assistant') {
                  const existing = last.toolCalls || [];
                  if (!existing.includes(event.tool)) {
                    updated[updated.length - 1] = {
                      ...last,
                      toolCalls: [...existing, event.tool],
                    };
                  }
                }
                return updated;
              });
            } else if (event.type === 'error') {
              setMessages(prev => {
                const updated = [...prev];
                const last = updated[updated.length - 1];
                if (last.role === 'assistant') {
                  updated[updated.length - 1] = { ...last, content: `⚠️ ${event.text}` };
                }
                return updated;
              });
            }
          } catch {}
        }
      }
    } catch (e: unknown) {
      setMessages(prev => {
        const updated = [...prev];
        const last = updated[updated.length - 1];
        if (last.role === 'assistant') {
          updated[updated.length - 1] = {
            ...last,
            content: `Verbindingsfout: ${e instanceof Error ? e.message : 'Onbekende fout'}`,
          };
        }
        return updated;
      });
    } finally {
      setStreaming(false);
    }
  };

  const handleKey = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      send();
    }
  };

  const toolLabel: Record<string, string> = {
    get_portfolio: '💼 Portfolio',
    get_positions: '📊 Posities',
    get_signals: '⚡ Signalen',
    get_news: '📰 Nieuws',
    get_rumours: '🕵️ Geruchten',
    get_risk_status: '🛡️ Risk',
    get_bot_status: '🤖 Bot status',
    get_performance: '📈 Performance',
    get_trade_history: '🔄 Trade history',
    analyze_ticker: '🔍 Ticker analyse',
    get_config_status: '⚙️ Config',
  };

  return (
    <div className="fixed bottom-20 md:bottom-4 right-4 z-50 flex flex-col items-end gap-2">
      {open && (
        <div className="w-[min(92vw,420px)] h-[min(80vh,600px)] bg-card border border-border rounded-xl shadow-2xl flex flex-col overflow-hidden">
          {/* Header */}
          <div className="flex items-center justify-between px-4 py-3 border-b border-border bg-card shrink-0">
            <div className="flex items-center gap-2">
              <Bot size={16} className="text-primary" />
              <span className="text-sm font-semibold">Trading AI Assistent</span>
            </div>
            <div className="flex items-center gap-2">
              {messages.length > 0 && (
                <button
                  onClick={() => setMessages([])}
                  className="text-muted-foreground hover:text-foreground transition-colors"
                  title="Gesprek wissen"
                >
                  <Trash2 size={14} />
                </button>
              )}
              <button onClick={() => setOpen(false)} className="text-muted-foreground hover:text-foreground">
                <X size={16} />
              </button>
            </div>
          </div>

          {/* Messages */}
          <div className="flex-1 overflow-y-auto p-3 space-y-3 min-h-0">
            {messages.length === 0 && (
              <div className="space-y-3">
                <p className="text-xs text-muted-foreground text-center mt-4">
                  Stel een vraag over je portfolio, signalen, nieuws of de bot status.
                </p>
                <div className="grid grid-cols-2 gap-1.5">
                  {SUGGESTED.map((q) => (
                    <button
                      key={q}
                      onClick={() => send(q)}
                      className="text-left text-xs px-2.5 py-1.5 rounded-lg bg-muted hover:bg-accent border border-border transition-colors text-muted-foreground hover:text-foreground leading-tight"
                    >
                      {q}
                    </button>
                  ))}
                </div>
              </div>
            )}
            {messages.map((msg, i) => (
              <div key={i} className={cn('flex flex-col gap-1.5', msg.role === 'user' ? 'items-end' : 'items-start')}>
                {msg.toolCalls && msg.toolCalls.length > 0 && (
                  <div className="flex flex-wrap gap-1 max-w-[90%]">
                    {msg.toolCalls.map((tool, j) => (
                      <span key={j} className="text-[10px] px-2 py-0.5 rounded-full bg-amber-500/10 text-amber-500 border border-amber-500/20 font-mono">
                        {toolLabel[tool] || `🔧 ${tool}`}
                      </span>
                    ))}
                  </div>
                )}
                {(msg.content || (msg.role === 'assistant' && streaming && i === messages.length - 1)) && (
                  <div className={cn(
                    'max-w-[90%] rounded-xl px-3 py-2 text-xs leading-relaxed',
                    msg.role === 'user'
                      ? 'bg-primary text-primary-foreground'
                      : 'bg-muted text-foreground'
                  )}>
                    {msg.content ? (
                      <span>{renderText(msg.content)}</span>
                    ) : (
                      <span className="flex gap-1 items-center text-muted-foreground">
                        <span className="animate-pulse">●</span>
                        <span className="animate-pulse" style={{ animationDelay: '150ms' }}>●</span>
                        <span className="animate-pulse" style={{ animationDelay: '300ms' }}>●</span>
                      </span>
                    )}
                  </div>
                )}
              </div>
            ))}
            <div ref={bottomRef} />
          </div>

          {/* Input */}
          <div className="border-t border-border p-3 flex gap-2 items-end shrink-0">
            <textarea
              ref={inputRef}
              value={input}
              onChange={e => setInput(e.target.value)}
              onKeyDown={handleKey}
              placeholder="Typ een vraag... (Enter om te sturen)"
              rows={1}
              disabled={streaming}
              className="flex-1 bg-background border border-border rounded-lg px-3 py-2 text-xs resize-none focus:outline-none focus:ring-1 focus:ring-ring disabled:opacity-50 max-h-[100px]"
              style={{ fieldSizing: 'content' } as React.CSSProperties}
            />
            <button
              onClick={() => send()}
              disabled={!input.trim() || streaming}
              className="p-2 rounded-lg bg-primary hover:bg-primary/90 disabled:opacity-40 text-primary-foreground shrink-0 transition-colors"
            >
              {streaming ? <Loader2 size={14} className="animate-spin" /> : <Send size={14} />}
            </button>
          </div>
        </div>
      )}

      {/* Toggle button */}
      <button
        onClick={() => setOpen(v => !v)}
        className={cn(
          'w-12 h-12 rounded-full shadow-lg flex items-center justify-center transition-all',
          open ? 'bg-muted text-foreground' : 'bg-primary text-primary-foreground hover:bg-primary/90 hover:scale-105'
        )}
      >
        {open ? <X size={20} /> : <MessageCircle size={20} />}
      </button>
    </div>
  );
}
