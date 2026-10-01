import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../api';
import { tl } from '../i18n';
import { Button, Icon, Spinner } from './ui';

/**
 * Turns a tool's result into follow-up tasks: the server builds a plan (figures only, no customer
 * names) and the user reviews owners and dates on the plan page before anything is sent.
 */
export function CreateTasksButton({ endpoint, body, label, hint }: { endpoint: string; body: unknown; label?: string; hint?: string }) {
  const navigate = useNavigate();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <span className="inline-flex flex-col gap-1">
      <Button
        disabled={busy}
        title={hint ?? tl('Creates tasks for you to check and approve. Nothing is sent until you approve.')}
        onClick={async () => {
          setBusy(true);
          setError(null);
          try {
            const r = await api<{ planId: string }>(endpoint, { body });
            navigate(`/plans/${r.planId}`);
          } catch (e) {
            setError((e as Error).message);
            setBusy(false);
          }
        }}
      >
        {busy ? <Spinner /> : <Icon name="send" className="h-4 w-4" />} {label ?? tl('Create follow-up tasks')}
      </Button>
      {error && <span className="text-xs text-red-700">{error}</span>}
    </span>
  );
}
