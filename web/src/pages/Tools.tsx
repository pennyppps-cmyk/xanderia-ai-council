import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../api';
import { Button, cx, Field, Icon, inputCls, Spinner } from '../components/ui';
import { tl } from '../i18n';
import { Shell } from './Plan';

/**
 * Working tools: loan / collections calculators (computed in the browser) and arrears file
 * analysis (aggregated on the server, file not stored). Every result can be taken to the council.
 */
type Tab = 'instalment' | 'rebate' | 'roll' | 'cost' | 'arrears';
const TABS: Array<{ key: Tab; label: string }> = [
  { key: 'instalment', label: 'Instalment' },
  { key: 'rebate', label: 'Early settlement rebate' },
  { key: 'roll', label: 'Roll rates' },
  { key: 'cost', label: 'Cost to collect' },
  { key: 'arrears', label: 'Arrears file' },
];

export const rm = (n: number) => `RM ${n.toLocaleString('en-MY', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const num = (s: string) => {
  const n = Number(s.replace(/,/g, ''));
  return Number.isFinite(n) ? n : 0;
};

export default function ToolsPage() {
  const [tab, setTab] = useState<Tab>('instalment');
  const navigate = useNavigate();
  // Pre-fill a new council question with the result (the asker reviews and sends it).
  const ask = (text: string) => navigate('/', { state: { prefill: text, mode: 'council' } });
  return (
    <Shell title={tl('Tools')}>
      <div className="mb-4 flex flex-wrap gap-1" role="tablist">
        {TABS.map((t) => (
          <button
            key={t.key}
            role="tab"
            aria-selected={tab === t.key}
            onClick={() => setTab(t.key)}
            className={cx(
              'rounded-lg px-3 py-1.5 text-sm font-medium',
              tab === t.key ? 'bg-ink-900 text-white' : 'text-ink-600 hover:bg-ink-100 hover:text-ink-900',
            )}
          >
            {tl(t.label)}
          </button>
        ))}
      </div>
      {tab === 'instalment' && <Instalment ask={ask} />}
      {tab === 'rebate' && <Rebate ask={ask} />}
      {tab === 'roll' && <RollRates ask={ask} />}
      {tab === 'cost' && <CostToCollect ask={ask} />}
      {tab === 'arrears' && <Arrears ask={ask} />}
    </Shell>
  );
}

function Card({ title, note, children }: { title: string; note?: string; children: React.ReactNode }) {
  return (
    <section className="rounded-xl border border-ink-100 bg-white p-4 shadow-sm md:p-5">
      <h2 className="text-base font-semibold">{title}</h2>
      {note && <p className="mt-1 text-xs text-ink-500">{note}</p>}
      <div className="mt-4">{children}</div>
    </section>
  );
}

function Results({ items, onAsk }: { items: Array<[string, string]>; onAsk?(): void }) {
  return (
    <div className="mt-4 rounded-lg bg-ink-50 p-3">
      <dl className="grid grid-cols-1 gap-x-6 gap-y-2 sm:grid-cols-2">
        {items.map(([k, v]) => (
          <div key={k} className="flex items-baseline justify-between gap-3 border-b border-ink-100 pb-1 text-sm">
            <dt className="text-ink-600">{tl(k)}</dt>
            <dd className="font-semibold tabular-nums">{v}</dd>
          </div>
        ))}
      </dl>
      {onAsk && (
        <Button size="sm" variant="secondary" className="mt-3" onClick={onAsk}>
          <Icon name="reply" className="h-3.5 w-3.5" /> {tl('Ask the council about this')}
        </Button>
      )}
    </div>
  );
}

function NumberField({ label, value, onChange, hint }: { label: string; value: string; onChange(v: string): void; hint?: string }) {
  return (
    <Field label={tl(label)} hint={hint && tl(hint)}>
      <input className={inputCls} inputMode="decimal" value={value} onChange={(e) => onChange(e.target.value)} />
    </Field>
  );
}

/** Monthly rate i such that the annuity of `payment` over n months is worth `principal`. */
export function solveMonthlyRate(principal: number, payment: number, n: number) {
  if (payment * n <= principal) return 0;
  let lo = 0;
  let hi = 1;
  for (let k = 0; k < 100; k++) {
    const i = (lo + hi) / 2;
    const pv = (payment * (1 - (1 + i) ** -n)) / i;
    if (pv > principal) lo = i;
    else hi = i;
  }
  return (lo + hi) / 2;
}

export function instalment(principal: number, ratePct: number, months: number, method: 'flat' | 'reducing') {
  const r = ratePct / 100;
  if (method === 'flat') {
    const interest = principal * r * (months / 12);
    const monthly = (principal + interest) / months;
    return { monthly, interest, total: principal + interest, eir: solveMonthlyRate(principal, monthly, months) * 12 * 100 };
  }
  const i = r / 12;
  const monthly = i ? (principal * i) / (1 - (1 + i) ** -months) : principal / months;
  return { monthly, interest: monthly * months - principal, total: monthly * months, eir: ratePct };
}

function Instalment({ ask }: { ask(t: string): void }) {
  const [p, setP] = useState('20000');
  const [rate, setRate] = useState('8');
  const [n, setN] = useState('60');
  const [method, setMethod] = useState<'flat' | 'reducing'>('flat');
  const P = num(p);
  const N = Math.round(num(n));
  const ok = P > 0 && N > 0;
  const r = ok ? instalment(P, num(rate), N, method) : null;
  const label = method === 'flat' ? tl('flat rate') : tl('reducing balance');
  return (
    <Card title={tl('Instalment calculator')} note={tl('Flat rate is common for personal financing; the effective interest rate (EIR) shows its true yearly cost.')}>
      <div className="grid gap-3 sm:grid-cols-4">
        <NumberField label="Amount financed (RM)" value={p} onChange={setP} />
        <NumberField label="Rate (% a year)" value={rate} onChange={setRate} />
        <NumberField label="Tenure (months)" value={n} onChange={setN} />
        <Field label={tl('Method')}>
          <select className={inputCls} value={method} onChange={(e) => setMethod(e.target.value as 'flat' | 'reducing')}>
            <option value="flat">{tl('flat rate')}</option>
            <option value="reducing">{tl('reducing balance')}</option>
          </select>
        </Field>
      </div>
      {r && (
        <Results
          items={[
            ['Monthly instalment', rm(r.monthly)],
            ['Total interest', rm(r.interest)],
            ['Total payable', rm(r.total)],
            ['Effective rate (EIR, % a year)', `${r.eir.toFixed(2)}%`],
          ]}
          onAsk={() =>
            ask(
              `Financing of ${rm(P)} over ${N} months at ${num(rate)}% a year (${label}): monthly instalment ${rm(r.monthly)}, ` +
                `total interest ${rm(r.interest)}, EIR ${r.eir.toFixed(2)}%.\n\nQuestion: `,
            )
          }
        />
      )}
    </Card>
  );
}

/** Early settlement rebate on the unearned interest, k months before the end of an n-month term. */
export function rebate(totalInterest: number, months: number, remaining: number) {
  const k = Math.max(0, Math.min(remaining, months));
  return {
    rule78: (totalInterest * (k * (k + 1))) / (months * (months + 1)),
    straight: (totalInterest * k) / months,
  };
}

function Rebate({ ask }: { ask(t: string): void }) {
  const [interest, setInterest] = useState('8000');
  const [n, setN] = useState('60');
  const [k, setK] = useState('24');
  const [outstanding, setOutstanding] = useState('');
  const N = Math.round(num(n));
  const K = Math.round(num(k));
  const ok = num(interest) > 0 && N > 0 && K >= 0 && K <= N;
  const r = ok ? rebate(num(interest), N, K) : null;
  const os = num(outstanding);
  return (
    <Card
      title={tl('Early settlement rebate')}
      note={tl('Rule of 78 and straight-line (proportional) rebates of unearned interest. Check which method the agreement and the regulator require.')}
    >
      <div className="grid gap-3 sm:grid-cols-4">
        <NumberField label="Total interest / profit (RM)" value={interest} onChange={setInterest} />
        <NumberField label="Tenure (months)" value={n} onChange={setN} />
        <NumberField label="Months remaining" value={k} onChange={setK} />
        <NumberField label="Outstanding balance (RM), optional" value={outstanding} onChange={setOutstanding} hint="Instalments not yet paid, including interest" />
      </div>
      {!ok && <p className="mt-3 text-sm text-red-700">{tl('Months remaining must be between 0 and the tenure.')}</p>}
      {r && (
        <Results
          items={[
            ['Rebate (Rule of 78)', rm(r.rule78)],
            ['Rebate (straight-line)', rm(r.straight)],
            ...(os > 0
              ? ([
                  ['Settlement amount (Rule of 78)', rm(os - r.rule78)],
                  ['Settlement amount (straight-line)', rm(os - r.straight)],
                ] as Array<[string, string]>)
              : []),
            ['Difference to the customer', rm(r.straight - r.rule78)],
          ]}
          onAsk={() =>
            ask(
              `Early settlement with ${K} of ${N} months remaining, total interest ${rm(num(interest))}: rebate ${rm(r.rule78)} under Rule of 78 vs ` +
                `${rm(r.straight)} straight-line (difference ${rm(r.straight - r.rule78)}).\n\nQuestion: `,
            )
          }
        />
      )}
    </Card>
  );
}

const ROLL_BUCKETS = ['Current', '1-30', '31-60', '61-90', '91+'];

function RollRates({ ask }: { ask(t: string): void }) {
  const [thisM, setThis] = useState(['1000000', '150000', '80000', '50000', '40000']);
  const [nextM, setNext] = useState(['980000', '160000', '90000', '52000', '75000']);
  const a = thisM.map(num);
  const b = nextM.map(num);
  // Roll rate: share of a bucket this month that rolled one bucket worse next month (91+ is cumulative).
  const rolls = ROLL_BUCKETS.slice(0, -1).map((x, i) => ({
    from: x,
    to: ROLL_BUCKETS[i + 1],
    rate: a[i] ? (i + 1 === ROLL_BUCKETS.length - 1 ? b[i + 1] - a[i + 1] : b[i + 1]) / a[i] : 0,
  }));
  const setAt = (arr: string[], set: (v: string[]) => void, i: number, v: string) => set(arr.map((x, j) => (j === i ? v : x)));
  return (
    <Card
      title={tl('Roll rates')}
      note={tl('Enter the balance (or account count) in each bucket at two month-ends. The roll rate is the share that moved one bucket worse. For 91+, the new inflow is next month minus this month.')}
    >
      <div className="overflow-x-auto">
        <table className="w-full min-w-[520px] text-sm">
          <thead>
            <tr className="text-left text-xs text-ink-500">
              <th className="py-1 pr-2">{tl('Bucket (DPD)')}</th>
              <th className="py-1 pr-2">{tl('This month')}</th>
              <th className="py-1 pr-2">{tl('Next month')}</th>
              <th className="py-1">{tl('Roll rate to next bucket')}</th>
            </tr>
          </thead>
          <tbody>
            {ROLL_BUCKETS.map((bk, i) => (
              <tr key={bk} className="border-t border-ink-100">
                <td className="py-1.5 pr-2 font-medium">{tl(bk)}</td>
                <td className="py-1.5 pr-2">
                  <input aria-label={`${bk} this month`} className={inputCls} inputMode="decimal" value={thisM[i]} onChange={(e) => setAt(thisM, setThis, i, e.target.value)} />
                </td>
                <td className="py-1.5 pr-2">
                  <input aria-label={`${bk} next month`} className={inputCls} inputMode="decimal" value={nextM[i]} onChange={(e) => setAt(nextM, setNext, i, e.target.value)} />
                </td>
                <td className={cx('py-1.5 font-semibold tabular-nums', rolls[i] && rolls[i].rate > 0.3 && 'text-red-700')}>
                  {rolls[i] ? `${(rolls[i].rate * 100).toFixed(1)}% → ${rolls[i].to}` : '—'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <Results
        items={rolls.map((r) => [`${r.from} → ${r.to}`, `${(r.rate * 100).toFixed(1)}%`] as [string, string])}
        onAsk={() =>
          ask(
            `Roll rates this month: ${rolls.map((r) => `${r.from}→${r.to} ${(r.rate * 100).toFixed(1)}%`).join(', ')}. ` +
              `Bucket balances this month: ${ROLL_BUCKETS.map((bk, i) => `${bk} ${a[i].toLocaleString()}`).join(', ')}.\n\nQuestion: `,
          )
        }
      />
    </Card>
  );
}

function CostToCollect({ ask }: { ask(t: string): void }) {
  const [staff, setStaff] = useState('45000');
  const [field, setField] = useState('12000');
  const [comms, setComms] = useState('3000');
  const [agency, setAgency] = useState('8000');
  const [collected, setCollected] = useState('600000');
  const [accounts, setAccounts] = useState('400');
  const cost = num(staff) + num(field) + num(comms) + num(agency);
  const coll = num(collected);
  const acc = num(accounts);
  return (
    <Card title={tl('Cost to collect')} note={tl('Monthly figures. Shows what each ringgit collected costs, and the cost per account resolved.')}>
      <div className="grid gap-3 sm:grid-cols-3">
        <NumberField label="Collection staff cost (RM)" value={staff} onChange={setStaff} />
        <NumberField label="Field visits / travel (RM)" value={field} onChange={setField} />
        <NumberField label="Calls, SMS, letters (RM)" value={comms} onChange={setComms} />
        <NumberField label="Agency / legal fees (RM)" value={agency} onChange={setAgency} />
        <NumberField label="Amount collected (RM)" value={collected} onChange={setCollected} />
        <NumberField label="Accounts resolved" value={accounts} onChange={setAccounts} />
      </div>
      <Results
        items={[
          ['Total collection cost', rm(cost)],
          ['Cost per RM 1 collected', coll ? `RM ${(cost / coll).toFixed(3)}` : '—'],
          ['Cost to collect (% of collected)', coll ? `${((cost / coll) * 100).toFixed(1)}%` : '—'],
          ['Cost per account resolved', acc ? rm(cost / acc) : '—'],
        ]}
        onAsk={() =>
          ask(
            `Collections cost this month ${rm(cost)} (staff ${rm(num(staff))}, field ${rm(num(field))}, calls/SMS/letters ${rm(num(comms))}, agency/legal ${rm(num(agency))}); ` +
              `collected ${rm(coll)} from ${acc} accounts resolved: cost to collect ${coll ? ((cost / coll) * 100).toFixed(1) : '-'}%, ${acc ? rm(cost / acc) : '-'} per account.\n\nQuestion: `,
          )
        }
      />
    </Card>
  );
}

// ── Arrears file ────────────────────────────────────────────────────────────
const BUCKETS = ['Current', '1-30', '31-60', '61-90', '91-180', '181+'] as const;
type Agg = { accounts: number; balance: number; buckets: Record<string, { accounts: number; balance: number }> };
interface ArrearsResult {
  rows: number;
  skipped: number;
  columns: Record<string, string>;
  total: Agg;
  byBranch: Array<{ name: string } & Agg>;
  byProduct: Array<{ name: string } & Agg>;
  markdown: string;
}
const BUCKET_COLOUR: Record<string, string> = {
  Current: 'bg-emerald-500',
  '1-30': 'bg-lime-500',
  '31-60': 'bg-amber-400',
  '61-90': 'bg-orange-500',
  '91-180': 'bg-red-500',
  '181+': 'bg-red-800',
};

function Arrears({ ask }: { ask(t: string): void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [res, setRes] = useState<ArrearsResult | null>(null);
  const [name, setName] = useState('');

  async function upload(file: File) {
    setBusy(true);
    setError(null);
    setRes(null);
    setName(file.name);
    try {
      const form = new FormData();
      form.append('file', file);
      setRes(await api<ArrearsResult>('/api/tools/arrears', { form }));
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const by: 'balance' | 'accounts' = res?.columns.balance ? 'balance' : 'accounts';
  const fmt = (n: number) => (by === 'balance' ? rm(n) : n.toLocaleString());
  return (
    <Card
      title={tl('Arrears file analysis')}
      note={tl('Upload a collections export (.csv or .xlsx, one row per account) with a DPD column, and optionally balance, branch and product. The file is analysed in memory and not stored; only totals go to the council.')}
    >
      <label className="flex cursor-pointer flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed border-ink-200 p-6 text-sm text-ink-600 hover:border-accent-600">
        <Icon name="plus" className="h-5 w-5" />
        <span>{busy ? tl('Analysing…') : name ? `${name} (${tl('choose another file')})` : tl('Choose a .csv or .xlsx file')}</span>
        <input type="file" accept=".csv,.xlsx,.txt" className="sr-only" disabled={busy} onChange={(e) => e.target.files?.[0] && upload(e.target.files[0])} />
      </label>
      {busy && <Spinner className="mt-3" />}
      {error && <p className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
      {res && (
        <div className="mt-4 space-y-5">
          <p className="text-xs text-ink-500">
            {tl('{n} accounts analysed', { n: res.total.accounts.toLocaleString() })}
            {res.skipped > 0 && ` · ${tl('{n} rows skipped (no DPD)', { n: res.skipped.toLocaleString() })}`} ·{' '}
            {tl('Columns used')}: {Object.entries(res.columns).map(([k, v]) => `${k} = "${v}"`).join(', ')}
          </p>
          <div>
            <h3 className="mb-2 text-sm font-semibold">{by === 'balance' ? tl('Balance by bucket') : tl('Accounts by bucket')}</h3>
            <div className="space-y-1.5">
              {BUCKETS.map((b) => {
                const v = res.total.buckets[b][by];
                const share = res.total[by] ? v / res.total[by] : 0;
                return (
                  <div key={b} className="flex items-center gap-2 text-sm">
                    <span className="w-16 shrink-0 text-ink-600">{tl(b)}</span>
                    <div className="h-5 flex-1 rounded bg-ink-50">
                      <div className={cx('h-5 rounded', BUCKET_COLOUR[b])} style={{ width: `${Math.max(share * 100, v ? 0.5 : 0)}%` }} />
                    </div>
                    <span className="w-44 shrink-0 text-right tabular-nums">
                      {fmt(v)} <span className="text-ink-400">({(share * 100).toFixed(1)}%)</span>
                    </span>
                  </div>
                );
              })}
            </div>
          </div>
          <GroupTable title={tl('By branch')} column={tl('Branch')} rows={res.byBranch} by={by} fmt={fmt} />
          <GroupTable title={tl('By product')} column={tl('Product')} rows={res.byProduct} by={by} fmt={fmt} />
          <Button onClick={() => ask(`${res.markdown}\n\nQuestion: `)}>
            <Icon name="reply" className="h-4 w-4" /> {tl('Ask the council about this file')}
          </Button>
        </div>
      )}
    </Card>
  );
}

function GroupTable({ title, column, rows, by, fmt }: { title: string; column: string; rows: ArrearsResult['byBranch']; by: 'balance' | 'accounts'; fmt(n: number): string }) {
  if (!rows.length) return null;
  return (
    <div>
      <h3 className="mb-2 text-sm font-semibold">{title}</h3>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[560px] text-sm">
          <thead>
            <tr className="text-left text-xs text-ink-500">
              <th className="py-1 pr-2">{column}</th>
              <th className="py-1 pr-2 text-right">{tl('Accounts')}</th>
              <th className="py-1 pr-2 text-right">{by === 'balance' ? tl('Balance') : tl('Accounts')}</th>
              <th className="py-1 pr-2">{tl('Mix')}</th>
              <th className="py-1 text-right">{tl('91+ DPD')}</th>
            </tr>
          </thead>
          <tbody>
            {rows.slice(0, 15).map((g) => {
              const npl = (g.buckets['91-180'][by] + g.buckets['181+'][by]) / (g[by] || 1);
              return (
                <tr key={g.name} className="border-t border-ink-100">
                  <td className="py-1.5 pr-2 font-medium">{g.name}</td>
                  <td className="py-1.5 pr-2 text-right tabular-nums">{g.accounts.toLocaleString()}</td>
                  <td className="py-1.5 pr-2 text-right tabular-nums">{fmt(g[by])}</td>
                  <td className="py-1.5 pr-2">
                    <div className="flex h-3 w-40 overflow-hidden rounded bg-ink-50">
                      {BUCKETS.map((b) => (
                        <div key={b} className={BUCKET_COLOUR[b]} style={{ width: `${(g.buckets[b][by] / (g[by] || 1)) * 100}%` }} title={`${b}: ${fmt(g.buckets[b][by])}`} />
                      ))}
                    </div>
                  </td>
                  <td className={cx('py-1.5 text-right font-semibold tabular-nums', npl > 0.1 && 'text-red-700')}>{(npl * 100).toFixed(1)}%</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {rows.length > 15 && <p className="mt-1 text-xs text-ink-400">{tl('Showing the top 15 of {n}.', { n: rows.length })}</p>}
    </div>
  );
}
