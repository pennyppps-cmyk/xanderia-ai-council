import { useCallback, useEffect, useRef, useState } from 'react';
import { useLocation, useNavigate, useParams } from 'react-router-dom';
import { api } from '../api';
import { useAuth } from '../auth';
import { AssistantMessage } from '../components/AssistantMessage';
import { Composer, type ComposerHandle } from '../components/Composer';
import { Sidebar } from '../components/Sidebar';
import { cx, Icon, Spinner } from '../components/ui';
import type { ConversationSummary, Message, Mode } from '../types';
import { useUserEvents } from '../useUserEvents';
import { TemplateDialog, TemplateGrid, type CouncilTemplate } from '../components/Templates';
import { getLang, tl } from '../i18n';
import { OnboardingCard } from '../components/Onboarding';


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
  const [pulse, setPulse] = useState(0);
  const [templates, setTemplates] = useState<CouncilTemplate[]>([]);
  const [templateDialog, setTemplateDialog] = useState<{ open: boolean; initial: CouncilTemplate | null }>({ open: false, initial: null });

  useEffect(() => {
    api<CouncilTemplate[]>('/api/templates').then(setTemplates).catch(() => {});
  }, []);
  const composer = useRef<ComposerHandle>(null);
  // Arriving from Tools with a result: put it in the composer for the asker to finish and send.
  const location = useLocation();
  useEffect(() => {
    const st = location.state as { prefill?: string; mode?: Mode } | null;
    if (!st?.prefill) return;
    // Not cancelled on cleanup: clearing the state below re-runs this effect.
    setTimeout(() => composer.current?.setText(st.prefill!, st.mode), 50);
    navigate(location.pathname, { replace: true, state: null });
  }, [location.state]); // eslint-disable-line react-hooks/exhaustive-deps
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

  useUserEvents(id, () => {
    void loadList();
    setPulse((n) => n + 1);
  });

  async function send(input: {
    content: string;
    mode: Mode;
    departmentId?: string;
    peerReview?: boolean;
    skipClarify?: boolean;
    template?: string;
    attachmentIds?: string[];
  }) {
    setSending(true);
    setError(null);
    try {
      const res = await api<{ conversation: { id: string }; userMessage: Message; assistantMessage: Message }>('/api/messages', {
        body: { ...input, conversationId: id, lang: getLang() },
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
  const last = messages[messages.length - 1];
  const awaitingAnswers = last?.role === 'assistant' && last.mode === 'clarify' && last.status === 'done';

  return (
    <div className="flex h-full">
      <div className="hidden md:block">
        <Sidebar conversations={conversations} query={query} onQuery={setQuery} onChanged={loadList} onNavigate={() => {}} pulse={pulse} />
      </div>
      {drawer && (
        <div className="fixed inset-0 z-40 flex md:hidden">
          <Sidebar conversations={conversations} query={query} onQuery={setQuery} onChanged={loadList} onNavigate={() => setDrawer(false)} pulse={pulse} />
          <button className="flex-1 bg-black/40" aria-label={tl("Close menu")} onClick={() => setDrawer(false)} />
        </div>
      )}

      <main className="flex min-w-0 flex-1 flex-col">
        <header className="flex items-center gap-2 border-b border-ink-100 bg-white px-3 py-2 md:hidden">
          <button onClick={() => setDrawer(true)} className="rounded-md p-1.5 text-ink-600 hover:bg-ink-100" aria-label={tl("Menu")}>
            <Icon name="menu" className="h-5 w-5" />
          </button>
          <span className="truncate text-sm font-semibold">
            {conversations.find((c) => c.id === id)?.title ?? 'Xanderia AI Council'}
          </span>
        </header>

        <div className="flex-1 overflow-y-auto">
          <div className={cx('mx-auto w-full max-w-3xl px-4', empty ? 'flex h-full flex-col justify-center py-8' : 'py-6')}>
            {empty ? (
              <div className="text-center">
                <h1 className="text-2xl font-semibold text-ink-900">
                  {tl("Selamat datang")}{me ? `, ${me.user.display_name.split(' ')[0]}` : ''}.
                </h1>
                <p className="mx-auto mt-2 max-w-lg text-sm text-ink-600">
                  {tl("Ask a quick question, or bring a plan or decision to the council: six advisors with different mandates weigh in, and the Chairman returns one verdict with an action plan.")}
                </p>
                <OnboardingCard />
                {templates.length > 0 && (
                  <div className="mt-6">
                    <p className="mb-2 text-left text-xs font-semibold tracking-wide text-ink-400 uppercase">{tl('Start from a template')}</p>
                    <TemplateGrid templates={templates} onPick={(t) => setTemplateDialog({ open: true, initial: t })} />
                  </div>
                )}
                <p className="mt-6 mb-2 text-left text-xs font-semibold tracking-wide text-ink-400 uppercase">{tl('Or try an example')}</p>
                <div className="grid gap-2 text-left sm:grid-cols-2">
                  {EXAMPLES.map((e) => (
                    <button
                      key={e.text}
                      onClick={() => composer.current?.setText(tl(e.text))}
                      className="rounded-xl border border-ink-100 bg-white p-3 text-sm text-ink-700 shadow-sm hover:border-accent-500"
                    >
                      <span className="mb-1 block text-[11px] font-semibold tracking-wide text-accent-700 uppercase">{e.mode}</span>
                      {tl(e.text)}
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
                        {m.attachments && m.attachments.length > 0 && (
                          <div className="mt-2 flex flex-wrap gap-1.5">
                            {m.attachments.map((a) => (
                              <span key={a.id} className="inline-flex items-center gap-1 rounded-md bg-white/10 px-2 py-0.5 text-xs text-white/90">
                                <Icon name="file" className="h-3.5 w-3.5" /> {a.filename}
                              </span>
                            ))}
                          </div>
                        )}
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
                      onFollowUp={(t, mode) => composer.current?.setText(t, mode)}
                      onSkipClarify={() =>
                        send({
                          content: tl('Skip: please go ahead with your stated assumptions.'),
                          mode: 'council',
                          departmentId: m.department_id ?? undefined,
                          skipClarify: true,
                        }).catch(() => {})
                      }
                      onWhatIf={async (change) => {
                        const res = await api<{ userMessage: Message; assistantMessage: Message }>(`/api/messages/${m.id}/whatif`, { body: { change } });
                        setMessages((all) => [...all, { ...res.userMessage, parts: [] }, res.assistantMessage]);
                      }}
                      onDraft={(request) =>
                        send({ content: request, mode: 'quick', departmentId: m.department_id ?? undefined, template: 'policy_draft' }).catch(() => {})
                      }
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
            <Composer
              ref={composer}
              busy={sending}
              defaultDepartmentId={convDept}
              placeholder={awaitingAnswers ? tl("Answer the council's questions here (all in one message), or press Skip above…") : undefined}
              onSend={send}
              onTemplates={templates.length ? () => setTemplateDialog({ open: true, initial: null }) : undefined}
            />
            {templateDialog.open && (
              <TemplateDialog
                templates={templates}
                initial={templateDialog.initial}
                onClose={() => setTemplateDialog({ open: false, initial: null })}
                onSubmit={(t, content, departmentId) =>
                  send({ content, mode: t.mode === 'council' ? 'council' : 'quick', departmentId, template: t.key })
                }
              />
            )}
            <p className="mt-2 text-center text-[11px] text-ink-400">
              {tl("Advisory output only. Final decisions sit with the responsible staff and management. Legal and finance answers must be reviewed before acting.")}
            </p>
          </div>
        </div>
      </main>
    </div>
  );
}
