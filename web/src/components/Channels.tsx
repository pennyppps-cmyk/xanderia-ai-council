import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { api } from '../api';
import { tl } from '../i18n';
import { Button, cx, Icon, Spinner } from './ui';

/** Voice input and Telegram: both optional, switched on by the server's configuration. */
interface Channels {
  voice: boolean;
  telegram: { bot: string | null; linked: { username: string | null; linked_at: string } | null } | null;
}

let cache: Promise<Channels> | null = null;
function loadChannels(fresh = false) {
  if (!cache || fresh) cache = api<Channels>('/api/channels').catch(() => ({ voice: false, telegram: null }));
  return cache;
}

export function useChannels() {
  const [ch, setCh] = useState<Channels | null>(null);
  useEffect(() => {
    let live = true;
    void loadChannels().then((c) => live && setCh(c));
    return () => {
      live = false;
    };
  }, []);
  return { channels: ch, reload: async () => setCh(await loadChannels(true)) };
}

/** Record a question and put the transcript in the composer (Whisper runs on our own server). */
export function MicButton({ onText }: { onText(text: string): void }) {
  const { channels } = useChannels();
  const [state, setState] = useState<'idle' | 'recording' | 'working'>('idle');
  const [error, setError] = useState<string | null>(null);
  const rec = useRef<MediaRecorder | null>(null);
  const started = useRef(0);
  if (!channels?.voice || typeof MediaRecorder === 'undefined') return null;

  async function start() {
    setError(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const chunks: Blob[] = [];
      const r = new MediaRecorder(stream);
      r.ondataavailable = (e) => e.data.size && chunks.push(e.data);
      r.onstop = async () => {
        stream.getTracks().forEach((t) => t.stop());
        if (Date.now() - started.current < 700) return setState('idle'); // accidental tap
        setState('working');
        try {
          const form = new FormData();
          const type = r.mimeType || 'audio/webm';
          form.append('file', new Blob(chunks, { type }), type.includes('ogg') ? 'voice.ogg' : type.includes('mp4') ? 'voice.m4a' : 'voice.webm');
          const { text } = await api<{ text: string }>('/api/voice/transcribe', { form });
          if (text) onText(text);
          else setError(tl('Could not hear anything. Try again closer to the mic.'));
        } catch (err) {
          setError((err as Error).message);
        } finally {
          setState('idle');
        }
      };
      rec.current = r;
      started.current = Date.now();
      r.start();
      setState('recording');
      // Hard stop at 2 minutes.
      setTimeout(() => r.state === 'recording' && r.stop(), 120_000);
    } catch {
      setError(tl('Microphone access was blocked. Allow it in the browser to ask by voice.'));
    }
  }

  return (
    <span className="relative inline-flex items-center">
      <button
        type="button"
        onClick={() => (state === 'recording' ? rec.current?.stop() : state === 'idle' && start())}
        disabled={state === 'working'}
        aria-pressed={state === 'recording'}
        title={state === 'recording' ? tl('Stop and transcribe') : tl('Ask by voice (English or Bahasa Malaysia; transcribed on our own server)')}
        className={cx(
          'inline-flex h-8 w-8 items-center justify-center rounded-lg border',
          state === 'recording' ? 'animate-pulse border-red-300 bg-red-50 text-red-700' : 'border-ink-200 text-ink-600 hover:bg-ink-50',
        )}
      >
        {state === 'working' ? <Spinner /> : <Icon name={state === 'recording' ? 'stop' : 'mic'} className="h-4 w-4" />}
      </button>
      {error && (
        <span role="alert" className="absolute right-0 bottom-10 w-64 rounded-lg bg-red-50 px-2 py-1 text-xs text-red-700 shadow">
          {error}
        </span>
      )}
    </span>
  );
}

/** Sidebar entry: connect / disconnect Telegram. */
export function TelegramButton() {
  const { channels, reload } = useChannels();
  const [open, setOpen] = useState(false);
  const [link, setLink] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  if (!channels?.telegram) return null;
  const linked = channels.telegram.linked;
  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs text-ink-200 hover:bg-ink-900 hover:text-white"
      >
        <Icon name="send" className="h-3.5 w-3.5" /> Telegram{linked ? ' ✓' : ''}
      </button>
      {open && createPortal(
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-ink-950/40 p-4" onClick={() => setOpen(false)}>
          <div role="dialog" aria-label="Telegram" className="w-full max-w-md rounded-2xl bg-white p-5 text-ink-900 shadow-xl" onClick={(e) => e.stopPropagation()}>
            <h2 className="text-base font-semibold">{tl('Ask the council from Telegram')}</h2>
            <p className="mt-2 text-sm text-ink-600">
              {tl('Link your Telegram so you can message the council bot. Answers come back in the chat, with a link to the full report here.')}
            </p>
            <p className="mt-2 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800">
              {tl('Telegram is an outside service: do not send customer personal data (IC, account or phone numbers) through it.')}
            </p>
            {linked ? (
              <div className="mt-4 flex items-center justify-between gap-2 text-sm">
                <span>
                  {tl('Connected')}
                  {linked.username ? ` (@${linked.username})` : ''}
                </span>
                <Button
                  size="sm"
                  variant="danger"
                  onClick={async () => {
                    await api('/api/telegram/link', { method: 'DELETE' });
                    await reload();
                  }}
                >
                  {tl('Disconnect')}
                </Button>
              </div>
            ) : link ? (
              <div className="mt-4 space-y-2 text-sm">
                <a href={link} target="_blank" rel="noreferrer" className="inline-flex items-center gap-2 rounded-lg bg-ink-900 px-3 py-2 font-medium text-white hover:bg-ink-800">
                  <Icon name="send" className="h-4 w-4" /> {tl('Open @{bot} and press Start', { bot: channels.telegram.bot ?? 'bot' })}
                </a>
                <p className="text-xs text-ink-500">{tl('The link works once and expires in 15 minutes. Then close this window.')}</p>
              </div>
            ) : (
              <Button
                variant="primary"
                className="mt-4"
                onClick={async () => {
                  setError(null);
                  try {
                    setLink((await api<{ url: string }>('/api/telegram/link', { method: 'POST' })).url);
                  } catch (err) {
                    setError((err as Error).message);
                  }
                }}
              >
                {tl('Connect Telegram')}
              </Button>
            )}
            {error && <p className="mt-2 text-sm text-red-700">{error}</p>}
            <div className="mt-4 text-right">
              <Button
                size="sm"
                variant="ghost"
                onClick={async () => {
                  setOpen(false);
                  setLink(null);
                  await reload();
                }}
              >
                {tl('Close')}
              </Button>
            </div>
          </div>
        </div>,
        document.body,
      )}
    </>
  );
}
