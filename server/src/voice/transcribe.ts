import { config } from '../config.js';

/**
 * On-premises speech-to-text through an OpenAI-compatible Whisper server (the `voice` compose
 * profile runs one inside the stack). Audio is sent only to WHISPER_URL, never to a cloud API.
 */
export const voiceEnabled = () => Boolean(config.WHISPER_URL);

export async function transcribe(audio: Buffer, filename: string, opts: { language?: 'ms' | 'en'; fetchImpl?: typeof fetch } = {}) {
  if (!config.WHISPER_URL) throw new Error('Voice input is not enabled on this server');
  const doFetch = opts.fetchImpl ?? fetch;
  const base = config.WHISPER_URL.replace(/\/+$/, '');
  const attempt = () => {
    const form = new FormData();
    form.append('file', new Blob([new Uint8Array(audio)]), filename);
    form.append('model', config.WHISPER_MODEL);
    form.append('response_format', 'json');
    // Without a language, Whisper detects it (staff mix BM and English freely).
    if (opts.language) form.append('language', opts.language);
    return doFetch(`${base}/v1/audio/transcriptions`, { method: 'POST', body: form, signal: AbortSignal.timeout(120_000) });
  };
  let res = await attempt();
  if (res.status === 404 && /not installed/i.test(await res.clone().text())) {
    // First use: the Whisper server downloads the model once (then it works offline).
    const install = await doFetch(`${base}/v1/models/${config.WHISPER_MODEL}`, { method: 'POST', signal: AbortSignal.timeout(600_000) });
    if (!install.ok) throw new Error(`Could not install the speech model (${install.status}): ${(await install.text()).slice(0, 200)}`);
    res = await attempt();
  }
  if (!res.ok) throw new Error(`Speech-to-text failed (${res.status}): ${(await res.text()).slice(0, 200)}`);
  const data = (await res.json()) as { text?: string };
  return (data.text ?? '').trim();
}
