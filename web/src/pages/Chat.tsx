import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { api } from '../api';
import { useAuth } from '../auth';
import { AssistantMessage } from '../components/AssistantMessage';
import { Composer, type ComposerHandle } from '../components/Composer';
import { Sidebar } from '../components/Sidebar';
import { cx, Icon, Spinner } from '../components/ui';
import type { ConversationSummary, Message, Mode } from '../types';
import { useUserEvents } from '../useUserEvents';

const EXAMPLES = [
  { mode: 'council' as Mode, text: 'We want to send collections reminders on day 2 instead of day 5 and add WhatsApp. Should we, and how do we roll it out?' },
  { mode: 'quick' as Mode, text: 'What must a staff data-access policy cover under PDPA 2010?' },
  { mode: 'council' as Mode, text: 'Plan a hiring round for 4 collection officers in Q1: budget, sourcing, and onboarding.' },
  { mode: 'quick' as Mode, text: 'Bagaimana cara terbaik mengira kos bagi sebut harga tender perkhidmatan?' },
];

export default function Chat() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { me } = useAuth();
  const [conversations, setConversations] = useState<ConversationSummary[]>([]);
  const [query, setQuery] = useState('');
  const [messages, setMessages] = useState<Message[]>([]);
  const [convDept, setConvDept] = useState<string | undefined>();
  const [loading, setLoading] = useState(false);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [drawer, setDrawer] = useState(false);
  const composer = useRef<ComposerHandle>(null);
  const bottom = useRef<HTMLDivElement>(null);

  const loadList = useCallback(async () => {
    const q = query.trim();
    setConversations(await api(`/api/conversations${q ? `?q=${encodeURIComponent(q)}` : ''}`));
  }, [query]);

  useEffect(() => {
    const t = setTimeout(() => void loadList().catch(() => {}), query ? 250 : 0);
    return () => clearTimeout(t);
  }, [loadList, query]);

  const loadConversation = useCallback(async (convId: string) => {
    const data = await api<{ conversation: { department_id: string }; messages: Message[] }>(`/api/conversations/${convId}`);
    setMessages(data.messages);
    setConvDept(data.conversation.department_id);
  }, []);

  useEffect(() => {
    setError(null);
    if (!id) {
      setMessages([]);
      setConvDept(undefined);
      return;
    }
    setLoading(true);
    loadConversation(id)
      .catch(() => navigate('/'))
      .finally(() => setLoading(false));
  }, [id, loadConversation, navigate]);

  useEffect(() => {
    bottom.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, [messages.length]);

  useUserEvents(id, loadList);

  async function send(input: { content: string; mode: Mode; departmentId: string; peerReview: boolean }) {
    setSending(true);
    setError(null);
    try {
      const res = await api<{ conversation: { id: string }; userMessage: Message; assistantMessage: Message }>('/api/messages', {
        body: { ...input, conversationId: id },
      });
      if (!id) {
        navigate(`/c/${res.conversation.id}`);
      } else {
        setMessages((m) => [...m, { ...res.userMessage, parts: [] }, res.assistantMessage]);
      }
      void loadList();
    } catch (err) {
      setError((err as Error).message);
      throw err;
    } finally {
      setSending(false);
    }
  }

  const empty = !id && messages.length === 0;

  return (
    <div className="flex h-full">
      <div className="hidden md:block">
        <Sidebar conversations={conversations} query={query} onQuery={setQuery} onChanged={loadList} onNavigate={() => {}} />
      </div>
      {drawer && (
        <div className="fixed inset-0 z-40 flex md:hidden">
          <Sidebar conversations={conversations} query={query} onQuery={setQuery} onChanged={loadList} onNavigate={() => setDrawer(false)} />
          <button className="flex-1 bg-black/40" aria-label="Close menu" onClick={() => setDrawer(false)} />
        </div>
      )}

      <main className="flex min-w-0 flex-1 flex-col">
        <header className="flex items-center gap-2 border-b border-ink-100 bg-white px-3 py-2 md:hidden">
          <button onClick={() => setDrawer(true)} className="rounded-md p-1.5 text-ink-600 hover:bg-ink-100" aria-label="Menu">
            <Icon name="menu" className="h-5 w-5" />
          </button>
          <span className="truncate text-sm font-semibold">
            {conversations.find((c) => c.id === id)?.title ?? 'Xanderia Council'}
          </span>
        </header>

        <div className="flex-1 overflow-y-auto">
          <div className={cx('mx-auto w-full max-w-3xl px-4', empty ? 'flex h-full flex-col justify-center py-8' : 'py-6')}>
            {empty ? (
              <div className="text-center">
                <h1 className="text-2xl font-semibold text-ink-900">
                  Selamat datang{me ? `, ${me.user.display_name.split(' ')[0]}` : ''}.
                </h1>
                <p className="mx-auto mt-2 max-w-lg text-sm text-ink-600">
                  Ask a quick question, or bring a plan or decision to the council: six advisors with different
                  mandates weigh in, and the Chairman returns one verdict with an action plan.
                </p>
                <div className="mt-6 grid gap-2 text-left sm:grid-cols-2">
                  {EXAMPLES.map((e) => (
                    <button
                      key={e.text}
                      onClick={() => composer.current?.setText(e.text)}
                      className="rounded-xl border border-ink-100 bg-white p-3 text-sm text-ink-700 shadow-sm hover:border-accent-500"
                    >
                      <span className="mb-1 block text-[11px] font-semibold tracking-wide text-accent-700 uppercase">{e.mode}</span>
                      {e.text}
                    </button>
                  ))}
                </div>
              </div>
            ) : loading ? (
              <div className="flex justify-center py-12 text-ink-400">
                <Spinner className="h-6 w-6" />
              </div>
            ) : (
              <div className="space-y-6">
                {messages.map((m) =>
                  m.role === 'user' ? (
                    <div key={m.id} className="flex justify-end">
                      <div className="max-w-[85%] rounded-2xl rounded-tr-sm bg-ink-900 px-4 py-2.5 text-sm whitespace-pre-wrap text-white">
                        {m.content}
                      </div>
                    </div>
                  ) : (
                    <AssistantMessage
                      key={`${m.id}:${m.status === 'queued' ? m.created_at : m.status}`}
                      message={m}
                      onFinished={() => {
                        if (id) void loadConversation(id);
                        void loadList();
                      }}
                      onFollowUp={(t) => composer.current?.setText(t)}
                      onRetry={async () => {
                        await api(`/api/messages/${m.id}/retry`, { method: 'POST' });
                        setMessages((all) =>
                          all.map((x) => (x.id === m.id ? { ...x, status: 'queued', error: null, created_at: new Date().toISOString() } : x)),
                        );
                      }}
                    />
                  ),
                )}
              </div>
            )}
            <div ref={bottom} />
          </div>
        </div>

        <div className="border-t border-ink-100 bg-ink-50/80 px-4 pt-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] backdrop-blur">
          <div className="mx-auto w-full max-w-3xl">
            {error && <p className="mb-2 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
            <Composer ref={composer} busy={sending} defaultDepartmentId={convDept} onSend={send} />
            <p className="mt-2 text-center text-[11px] text-ink-400">
              Advisory output only. Final decisions sit with the responsible staff and management. Legal and finance
              answers must be reviewed before acting.
            </p>
          </div>
        </div>
      </main>
    </div>
  );
}
