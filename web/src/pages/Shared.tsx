import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { api } from '../api';
import { AssistantMessage } from '../components/AssistantMessage';
import { Spinner } from '../components/ui';
import type { Message } from '../types';
import { Shell } from './Plan';

interface Shared {
  title: string;
  question: string;
  sharedBy: string;
  sharedAt: string;
  message: Message;
}

/** Read-only view of an answer or verdict a colleague shared. */
export default function SharedPage() {
  const { token } = useParams();
  const [data, setData] = useState<Shared | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api<Shared>(`/api/shared/${token}`).then(setData).catch((e) => setError(e.message));
  }, [token]);

  return (
    <Shell title={data ? data.title : 'Shared answer'}>
      <div className="mx-auto max-w-3xl space-y-6">
        {error && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
        {!data && !error && <Spinner className="h-5 w-5 text-ink-400" />}
        {data && (
          <>
            <p className="text-xs text-ink-400">
              Shared by {data.sharedBy} · {new Date(data.sharedAt).toLocaleString()} · read-only
            </p>
            <div className="flex justify-end">
              <div className="max-w-[85%] rounded-2xl rounded-tr-sm bg-ink-900 px-4 py-2.5 text-sm whitespace-pre-wrap text-white">{data.question}</div>
            </div>
            <AssistantMessage message={data.message} readOnly onFinished={() => {}} onFollowUp={() => {}} onRetry={() => {}} onSkipClarify={() => {}} />
          </>
        )}
      </div>
    </Shell>
  );
}
