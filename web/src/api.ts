export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

type Options = { method?: string; body?: unknown; form?: FormData };

export async function api<T = any>(path: string, opts: Options = {}): Promise<T> {
  const init: RequestInit = { method: opts.method ?? (opts.body || opts.form ? 'POST' : 'GET'), credentials: 'same-origin' };
  if (opts.form) {
    init.body = opts.form;
  } else if (opts.body !== undefined) {
    init.headers = { 'content-type': 'application/json' };
    init.body = JSON.stringify(opts.body);
  }
  const res = await fetch(path, init);
  const text = await res.text();
  const data = text ? JSON.parse(text) : null;
  if (!res.ok) {
    if (res.status === 401 && !path.startsWith('/api/auth/')) window.dispatchEvent(new Event('xc:unauthorized'));
    throw new ApiError(data?.error ?? `Request failed (${res.status})`, res.status);
  }
  return data as T;
}
