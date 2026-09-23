import { useEffect, useRef } from 'react';
import { toast } from './toast';

/**
 * Per-user notification stream: when a council run finishes while the user is looking
 * at another conversation (or another tab), show a toast and a browser notification.
 */
export function useUserEvents(activeConversationId: string | undefined, onAnyChange: () => void) {
  const activeRef = useRef(activeConversationId);
  activeRef.current = activeConversationId;
  const changeRef = useRef(onAnyChange);
  changeRef.current = onAnyChange;

  useEffect(() => {
    if ('Notification' in window && Notification.permission === 'default') {
      // Ask once, after the first interaction, so the prompt is not a surprise on load.
      const ask = () => {
        void Notification.requestPermission();
        window.removeEventListener('pointerdown', ask);
      };
      window.addEventListener('pointerdown', ask);
    }

    const es = new EventSource('/api/events');
    const onDone = (ev: MessageEvent) => {
      const e = JSON.parse(ev.data);
      changeRef.current();
      const elsewhere = e.conversationId !== activeRef.current;
      if (elsewhere) {
        toast({
          title: e.mode === 'council' ? 'Council verdict ready' : 'Answer ready',
          body: e.title,
          href: `/c/${e.conversationId}`,
        });
      }
      if ((elsewhere || document.hidden) && 'Notification' in window && Notification.permission === 'granted') {
        const n = new Notification(e.mode === 'council' ? 'Council verdict ready' : 'Answer ready', {
          body: e.title,
          icon: '/favicon.svg',
          tag: e.messageId,
        });
        n.onclick = () => {
          window.focus();
          window.location.assign(`/c/${e.conversationId}`);
        };
      }
    };
    es.addEventListener('job_done', onDone as EventListener);
    es.addEventListener('job_failed', () => changeRef.current());
    return () => es.close();
  }, []);
}
