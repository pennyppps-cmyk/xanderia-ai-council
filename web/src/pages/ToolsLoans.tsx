import { useEffect, useState } from 'react';
import { api } from '../api';
import { useAuth } from '../auth';
import { Markdown } from '../components/Markdown';
import { Badge, Button, cx, Field, Icon, inputCls, Spinner } from '../components/ui';
import { getLang, tl } from '../i18n';

/** Loan-book tools: portfolio report, salary-deduction reconciliation, payslip affordability. */
const BUCKETS = ['Current', '1-30', '31-60', '61-90', '91-180', '181+'] as const;
const BUCKET_COLOR: Record<string, string> = { Current: 'bg-emerald-500', '1-30': 'bg-lime-500', '31-60': 'bg-amber-400', '61-90': 'bg-orange-500', '91-180': 'bg-red-500', '181+': 'bg-red-800' };
const rm = (n: number, d = 0) => `RM ${n.toLocaleString('en-MY', { minimumFractionDigits: d, maximumFractionDigits: d })}`;
const pct = (x: number, d = 2) => `${(x * 100).toFixed(d)}%`;

function Card({ title, note, children }: { title: string; note?: string; children: React.ReactNode }) {
  return (
    <section className="rounded-xl border border-ink-100 bg-white p-4 shadow-sm md:p-5">
      <h2 className="text-base font-semibold">{title}</h2>
      {note && <p className="mt-1 text-xs text-ink-500">{note}</p>}
      <div className="mt-4">{children}</div>
    </section>
  );
}
function Tiles({ items }: { items: Array<[string, string, string?]> }) {
  return (
    <div className="grid gap-2 sm:grid-cols-4">
      {items.map(([label, value, tone]) => (
        <div key={label} className="rounded-lg bg-ink-50 p-3">
          <p className="text-xs text-ink-500">{label}</p>
          <p className={cx('text-lg font-semibold tabular-nums', tone)}>{value}</p>
        </div>
      ))}
    </div>
  );
}
function FileInput({ label, onFile, accept = '.csv,.xlsx,.txt' }: { label: string; onFile(f: File | null): void; accept?: string }) {
  return (
    <Field label={label}>
      <input type="file" accept={accept} className="block w-full text-sm" onChange={(e) => onFile(e.target.files?.[0] ?? null)} />
    </Field>
  );
}

// ── Portfolio report ─────────────────────────────────────────────────────────
interface Agg { accounts: number; balance: number; buckets: Record<string, { accounts: number; balance: number }>; npl: { accounts: number; balance: number } }
interface Summary {
  rows: number;
  skipped: number;
  columns: Record<string, string>;
  options: { nplDays: number; restructuredIsNpl: boolean };
  total: Agg;
  nplRatio: number;
  nplRatioAccounts: number;
  par: { par30: number; par60: number; par90: number };
  byBranch: Array<{ name: string; nplRatio: number } & Agg>;
  byProduct: Array<{ name: string; nplRatio: number } & Agg>;
  byEmployer: Array<{ name: string; nplRatio: number } & Agg>;
  vintage: Array<{ cohort: string; accounts: number; balance: number; nplRatio: number; par30: number }>;
  rollRates: null | { matched: number; rates: Array<{ from: string; worse: number; same: number; better: number }> };
}
interface PortfolioResult { month: string; snapshotId: string | null; summary: Summary; trend: Array<{ month: string; nplRatio: number; par30: number }>; markdown: string }

export function PortfolioTool({ ask }: { ask(t: string): void }) {
  const { me } = useAuth();
  const lead = me?.user.role === 'admin' || me?.user.role === 'dept_lead';
  const [month, setMonth] = useState(() => new Date().toISOString().slice(0, 7));
  const [file, setFile] = useState<File | null>(null);
  const [previous, setPrevious] = useState<File | null>(null);
  const [save, setSave] = useState(lead);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [res, setRes] = useState<PortfolioResult | null>(null);
  const [commentary, setCommentary] = useState<string | null>(null);
  const [sent, setSent] = useState<string | null>(null);
  const [saved, setSaved] = useState<Array<{ id: string; month: string; nplRatio: number; par30: number; accounts: number; has_commentary: boolean }>>([]);
  const loadSaved = () => api<typeof saved>('/api/tools/portfolio').then(setSaved).catch(() => {});
  useEffect(() => void loadSaved(), []);

  async function analyse() {
    if (!file) return;
    setBusy('analyse');
    setError(null);
    setRes(null);
    setCommentary(null);
    setSent(null);
    try {
      const form = new FormData();
      form.append('month', month);
      form.append('save', String(save && lead));
      form.append('file', file);
      if (previous) form.append('previous', previous);
      setRes(await api<PortfolioResult>('/api/tools/portfolio', { form }));
      void loadSaved();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(null);
    }
  }
  const s = res?.summary;
  return (
    <Card
      title={tl('Portfolio report')}
      note={tl('Upload the month-end loan export (.csv or .xlsx, one row per account) with at least a DPD column; balance, branch, product, employer, disbursement date and a restructured flag are used when present. Add last month\'s file for roll rates. Figures are calculated exactly; the file is not stored, only the month\'s totals.')}
    >
      <div className="grid gap-3 sm:grid-cols-3">
        <Field label={tl('Month')}>
          <input type="month" className={inputCls} value={month} onChange={(e) => setMonth(e.target.value)} />
        </Field>
        <FileInput label={tl('This month-end loan export')} onFile={setFile} />
        <FileInput label={tl("Last month's export (optional, for roll rates)")} onFile={setPrevious} />
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-3">
        {lead && (
          <label className="inline-flex items-center gap-2 text-sm">
            <input type="checkbox" className="accent-accent-600" checked={save} onChange={(e) => setSave(e.target.checked)} />
            {tl("Save as this month's report (totals only)")}
          </label>
        )}
        <Button variant="primary" disabled={!file || busy !== null} onClick={analyse}>
          {busy === 'analyse' ? <Spinner /> : null} {tl('Analyse')}
        </Button>
      </div>
      {error && <p className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
      {s && res && (
        <div className="mt-5 space-y-5">
          <p className="text-xs text-ink-500">
            {tl('{n} accounts', { n: s.total.accounts.toLocaleString() })}
            {s.skipped ? ` · ${tl('{n} rows skipped (no DPD)', { n: s.skipped })}` : ''} · {tl('NPL = {d}+ days past due', { d: s.options.nplDays })}
            {s.options.restructuredIsNpl && s.columns.restructured ? `, ${tl('restructured included')}` : ''} · {tl('Columns used')}:{' '}
            {Object.entries(s.columns).map(([k, v]) => `${k} = "${v}"`).join(', ')}
          </p>
          <Tiles
            items={[
              [tl('NPL ratio'), pct(s.nplRatio), s.nplRatio > 0.05 ? 'text-red-700' : s.nplRatio > 0.03 ? 'text-amber-700' : 'text-emerald-700'],
              ['PAR30', pct(s.par.par30)],
              ['PAR90', pct(s.par.par90)],
              [tl('Outstanding'), rm(s.total.balance)],
            ]}
          />
          <div className="flex h-5 overflow-hidden rounded">
            {BUCKETS.map((b) => (
              <div key={b} className={BUCKET_COLOR[b]} style={{ width: `${s.total.balance ? (s.total.buckets[b].balance / s.total.balance) * 100 : 0}%` }} title={`${b}: ${rm(s.total.buckets[b].balance)}`} />
            ))}
          </div>
          {res.trend.length > 1 && (
            <div>
              <p className="mb-2 text-xs font-medium text-ink-500">{tl('NPL ratio by month')}</p>
              <div className="flex h-24 items-end gap-2">
                {res.trend.map((t) => {
                  const max = Math.max(...res.trend.map((x) => x.nplRatio), 0.001);
                  return (
                    <div key={t.month} className="flex flex-1 flex-col items-center gap-1">
                      <span className="text-[10px] tabular-nums text-ink-600">{pct(t.nplRatio, 1)}</span>
                      <div className="w-full rounded-t bg-red-400" style={{ height: `${(t.nplRatio / max) * 64}px` }} />
                      <span className="text-[10px] text-ink-400">{t.month}</span>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
          <Breakdown title={tl('By branch')} rows={s.byBranch} />
          <Breakdown title={tl('By product')} rows={s.byProduct} />
          <Breakdown title={tl('By employer')} rows={s.byEmployer} />
          {s.vintage.length > 0 && (
            <SimpleTable
              title={tl('Vintage (disbursement quarter)')}
              head={[tl('Cohort'), tl('Accounts'), tl('Balance'), tl('NPL ratio'), 'PAR30']}
              rows={s.vintage.slice(-12).map((v) => [v.cohort, v.accounts.toLocaleString(), rm(v.balance), pct(v.nplRatio), pct(v.par30)])}
            />
          )}
          {s.rollRates && (
            <SimpleTable
              title={tl('Roll rates vs last month ({n} accounts matched)', { n: s.rollRates.matched.toLocaleString() })}
              head={[tl('From bucket'), tl('Rolled worse'), tl('Stayed'), tl('Improved')]}
              rows={s.rollRates.rates.map((r) => [r.from, pct(r.worse, 1), pct(r.same, 1), pct(r.better, 1)])}
            />
          )}
          {commentary && (
            <div className="rounded-lg border border-ink-100 p-3">
              <Markdown text={commentary} />
            </div>
          )}
          <div className="flex flex-wrap gap-2">
            {res.snapshotId && (
              <>
                <Button
                  disabled={busy !== null}
                  onClick={async () => {
                    setBusy('commentary');
                    setError(null);
                    try {
                      setCommentary((await api<{ commentary: string }>(`/api/tools/portfolio/${res.snapshotId}/commentary`, { body: { lang: getLang() } })).commentary);
                    } catch (err) {
                      setError((err as Error).message);
                    } finally {
                      setBusy(null);
                    }
                  }}
                >
                  {busy === 'commentary' ? <Spinner /> : <Icon name="edit" className="h-4 w-4" />} {tl('Write council commentary')}
                </Button>
                <a href={`/api/tools/portfolio/${res.snapshotId}/report.pdf`} download className="inline-flex items-center gap-1.5 rounded-lg border border-ink-200 px-3 py-2 text-sm font-medium text-ink-800 hover:bg-ink-50">
                  <Icon name="print" className="h-4 w-4" /> {tl('Download PDF report')}
                </a>
                <Button
                  variant="ghost"
                  onClick={async () => {
                    setError(null);
                    try {
                      const r = await api<{ queued: number }>(`/api/tools/portfolio/${res.snapshotId}/email`, { method: 'POST' });
                      setSent(tl('Report sent to {n} recipient(s).', { n: r.queued }));
                    } catch (err) {
                      setError((err as Error).message);
                    }
                  }}
                >
                  {tl('Email to Management')}
                </Button>
              </>
            )}
            <Button variant="ghost" onClick={() => ask(`${res.markdown}\n\nQuestion: `)}>
              <Icon name="reply" className="h-4 w-4" /> {tl('Ask the council about this')}
            </Button>
          </div>
          {sent && <p className="text-sm text-accent-700">{sent}</p>}
        </div>
      )}
      {saved.length > 0 && (
        <div className="mt-6">
          <p className="mb-2 text-xs font-medium text-ink-500">{tl('Saved monthly reports')}</p>
          <ul className="divide-y divide-ink-100 text-sm">
            {saved.map((m) => (
              <li key={m.id} className="flex items-center justify-between gap-2 py-1.5">
                <span className="font-medium">{m.month}</span>
                <span className="text-xs text-ink-500">
                  {tl('NPL ratio')} {pct(m.nplRatio)} · PAR30 {pct(m.par30)} · {tl('{n} accounts', { n: m.accounts.toLocaleString() })}
                </span>
                <a className="text-xs font-medium text-accent-700 hover:underline" href={`/api/tools/portfolio/${m.id}/report.pdf`} download>
                  PDF
                </a>
              </li>
            ))}
          </ul>
        </div>
      )}
    </Card>
  );
}

function Breakdown({ title, rows }: { title: string; rows: Summary['byBranch'] }) {
  if (!rows.length) return null;
  return (
    <SimpleTable
      title={title}
      head={[tl('Name'), tl('Accounts'), tl('Balance'), tl('NPL balance'), tl('NPL ratio')]}
      rows={rows.slice(0, 12).map((g) => [g.name, g.accounts.toLocaleString(), rm(g.balance), rm(g.npl.balance), pct(g.nplRatio)])}
      highlight={(r) => parseFloat(r[4]) > 5}
    />
  );
}

function SimpleTable({ title, head, rows, highlight }: { title: string; head: string[]; rows: string[][]; highlight?(r: string[]): boolean }) {
  return (
    <div>
      <h3 className="mb-2 text-sm font-semibold">{title}</h3>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[520px] text-sm">
          <thead>
            <tr className="text-left text-xs text-ink-500">
              {head.map((h, i) => (
                <th key={h} className={cx('py-1 pr-2', i > 0 && 'text-right')}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={i} className="border-t border-ink-100">
                {r.map((c, j) => (
                  <td key={j} className={cx('py-1.5 pr-2 tabular-nums', j > 0 && 'text-right', j === 0 && 'font-medium', highlight?.(r) && j === r.length - 1 && 'font-semibold text-red-700')}>
                    {c}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ── Salary-deduction reconciliation ─────────────────────────────────────────
interface Recon {
  matchedOn: string;
  loans: number;
  deductionRows: number;
  matched: number;
  counts: { missing: number; short: number; over: number; unknown: number };
  amounts: { expected: number; deducted: number; shortfall: number };
  exceptions: Array<{ kind: 'missing' | 'short' | 'over' | 'unknown'; key: string; name: string; expected: number; deducted: number; difference: number }>;
  markdown: string;
}
const KIND: Record<string, { label: string; tone: 'red' | 'amber' | 'blue' | 'neutral' }> = {
  missing: { label: 'Not deducted', tone: 'red' },
  short: { label: 'Short', tone: 'amber' },
  over: { label: 'Over', tone: 'blue' },
  unknown: { label: 'No matching loan', tone: 'neutral' },
};

export function DeductionsTool({ ask }: { ask(t: string): void }) {
  const [expected, setExpected] = useState<File | null>(null);
  const [received, setReceived] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [r, setR] = useState<Recon | null>(null);
  const [filter, setFilter] = useState<string>('all');
  const download = () => {
    if (!r) return;
    const esc = (s: string | number) => (/[",\n]/.test(String(s)) ? `"${String(s).replace(/"/g, '""')}"` : String(s));
    const rows = [['Type', 'Key', 'Name', 'Expected (RM)', 'Deducted (RM)', 'Difference (RM)'], ...r.exceptions.map((e) => [KIND[e.kind].label, e.key, e.name, e.expected.toFixed(2), e.deducted.toFixed(2), e.difference.toFixed(2)])];
    const blob = new Blob(['﻿' + rows.map((x) => x.map(esc).join(',')).join('\r\n')], { type: 'text/csv' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `deduction-exceptions-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
  };
  const shown = r ? r.exceptions.filter((e) => filter === 'all' || e.kind === filter) : [];
  return (
    <Card
      title={tl('Salary-deduction reconciliation')}
      note={tl('Upload the loans with their monthly instalment, and the deduction file from the employer or Angkasa. They are matched on account number, IC number or salary number, whichever both files have. Files are not stored; the exception list is only shown to you.')}
    >
      <div className="grid gap-3 sm:grid-cols-2">
        <FileInput label={tl('Loans with monthly instalment (.csv / .xlsx)')} onFile={setExpected} />
        <FileInput label={tl('Deduction file from employer / Angkasa')} onFile={setReceived} />
      </div>
      <Button
        className="mt-3"
        variant="primary"
        disabled={!expected || !received || busy}
        onClick={async () => {
          setBusy(true);
          setError(null);
          setR(null);
          try {
            const form = new FormData();
            form.append('expected', expected!);
            form.append('received', received!);
            setR(await api<Recon>('/api/tools/deductions', { form }));
          } catch (err) {
            setError((err as Error).message);
          } finally {
            setBusy(false);
          }
        }}
      >
        {busy ? <Spinner /> : null} {tl('Reconcile')}
      </Button>
      {error && <p className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
      {r && (
        <div className="mt-5 space-y-4">
          <Tiles
            items={[
              [tl('Loans matched'), `${r.matched.toLocaleString()} / ${r.loans.toLocaleString()}`],
              [tl('Not deducted'), r.counts.missing.toLocaleString(), r.counts.missing ? 'text-red-700' : ''],
              [tl('Short / over'), `${r.counts.short} / ${r.counts.over}`, r.counts.short ? 'text-amber-700' : ''],
              [tl('Shortfall'), rm(r.amounts.shortfall, 2), r.amounts.shortfall ? 'text-red-700' : ''],
            ]}
          />
          <p className="text-xs text-ink-500">
            {tl('Matched on {k}', { k: r.matchedOn === 'ic' ? tl('IC number') : r.matchedOn === 'account' ? tl('account number') : tl('salary number') })} · {tl('Expected')} {rm(r.amounts.expected, 2)} · {tl('Deducted')} {rm(r.amounts.deducted, 2)} · {tl('Deductions with no matching loan')}: {r.counts.unknown}
          </p>
          {r.exceptions.length > 0 && (
            <>
              <div className="flex flex-wrap items-center gap-2">
                <select className="rounded-lg border border-ink-200 bg-white px-2 py-1 text-sm" value={filter} onChange={(e) => setFilter(e.target.value)} aria-label={tl('Show')}>
                  <option value="all">{tl('All exceptions ({n})', { n: r.exceptions.length })}</option>
                  {Object.entries(KIND).map(([k, v]) => (
                    <option key={k} value={k}>{tl(v.label)} ({r.counts[k as keyof Recon['counts']]})</option>
                  ))}
                </select>
                <Button size="sm" onClick={download}>{tl('Download exceptions (Excel CSV)')}</Button>
              </div>
              <div className="max-h-96 overflow-auto">
                <table className="w-full min-w-[620px] text-sm">
                  <thead className="sticky top-0 bg-white">
                    <tr className="text-left text-xs text-ink-500">
                      <th className="py-1">{tl('Type')}</th>
                      <th className="py-1">{tl('Key')}</th>
                      <th className="py-1">{tl('Name')}</th>
                      <th className="py-1 text-right">{tl('Expected')}</th>
                      <th className="py-1 text-right">{tl('Deducted')}</th>
                      <th className="py-1 text-right">{tl('Difference')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {shown.slice(0, 300).map((e, i) => (
                      <tr key={i} className="border-t border-ink-100">
                        <td className="py-1"><Badge tone={KIND[e.kind].tone}>{tl(KIND[e.kind].label)}</Badge></td>
                        <td className="py-1 font-mono text-xs">{e.key}</td>
                        <td className="py-1">{e.name}</td>
                        <td className="py-1 text-right tabular-nums">{e.expected.toFixed(2)}</td>
                        <td className="py-1 text-right tabular-nums">{e.deducted.toFixed(2)}</td>
                        <td className={cx('py-1 text-right tabular-nums', e.difference < 0 && 'text-red-700')}>{e.difference.toFixed(2)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {shown.length > 300 && <p className="mt-1 text-xs text-ink-400">{tl('Showing 300 of {n}; download the CSV for all.', { n: shown.length })}</p>}
              </div>
            </>
          )}
          <Button variant="ghost" onClick={() => ask(`${r.markdown}\n\nQuestion: `)}>
            <Icon name="reply" className="h-4 w-4" /> {tl('Ask the council about this')}
          </Button>
        </div>
      )}
    </Card>
  );
}

// ── Payslip affordability ───────────────────────────────────────────────────
interface Afford {
  verdict: 'pass' | 'borderline' | 'fail';
  rule: { maxDeductionPct: number; minNet: number };
  instalment: number;
  maxAffordableInstalment: number;
  months: Array<{ month: string; type: string; gross: number; deductions: number; net: number; netPct: number; existingFinancing: number; deductionPctAfter: number; netAfter: number; notMatched: number }>;
  worstMonth: string;
  flags: string[];
  markdown: string;
}

export function AffordabilityTool({ ask }: { ask(t: string): void }) {
  const [file, setFile] = useState<File | null>(null);
  const [amount, setAmount] = useState('');
  const [rate, setRate] = useState('');
  const [tenure, setTenure] = useState('');
  const [instalment, setInstalment] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [a, setA] = useState<Afford | null>(null);
  // Flat-rate instalment from amount, rate and tenure when the officer has not typed one.
  const computed = (() => {
    const P = Number(amount.replace(/,/g, ''));
    const r = Number(rate);
    const n = Number(tenure);
    if (!(P > 0 && n > 0 && r >= 0)) return null;
    return Math.round(((P + P * (r / 100) * (n / 12)) / n) * 100) / 100;
  })();
  const inst = Number(instalment.replace(/,/g, '')) || computed || 0;
  return (
    <Card
      title={tl('Payslip affordability check')}
      note={tl('Upload the "Payslip Extraction Result" report from the payslip extractor (one or more months). The new instalment is added to the existing deductions and checked against the rule in Admin → Settings (by default, total deductions may not exceed 60% of gross pay) for the weakest month. The file is not stored; name and IC are never sent to the council.')}
    >
      <div className="grid gap-3 sm:grid-cols-5">
        <div className="sm:col-span-2">
          <FileInput label={tl('Payslip extractor report (.xlsx)')} onFile={setFile} accept=".xlsx" />
        </div>
        <Field label={tl('Amount (RM)')}>
          <input className={inputCls} inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} />
        </Field>
        <Field label={tl('Rate (% a year, flat)')}>
          <input className={inputCls} inputMode="decimal" value={rate} onChange={(e) => setRate(e.target.value)} />
        </Field>
        <Field label={tl('Tenure (months)')}>
          <input className={inputCls} inputMode="decimal" value={tenure} onChange={(e) => setTenure(e.target.value)} />
        </Field>
      </div>
      <div className="mt-3 grid gap-3 sm:grid-cols-5">
        <Field label={tl('Monthly instalment (RM)')} hint={computed ? tl('Calculated: {v}', { v: rm(computed, 2) }) : tl('Or fill amount, rate and tenure')}>
          <input className={inputCls} inputMode="decimal" value={instalment} placeholder={computed ? computed.toFixed(2) : ''} onChange={(e) => setInstalment(e.target.value)} />
        </Field>
      </div>
      <Button
        className="mt-3"
        variant="primary"
        disabled={!file || !inst || busy}
        onClick={async () => {
          setBusy(true);
          setError(null);
          setA(null);
          try {
            const form = new FormData();
            form.append('instalment', String(inst));
            if (amount) form.append('amount', amount.replace(/,/g, ''));
            if (rate) form.append('rate', rate);
            if (tenure) form.append('tenure', tenure);
            form.append('file', file!);
            setA(await api<Afford>('/api/tools/affordability', { form }));
          } catch (err) {
            setError((err as Error).message);
          } finally {
            setBusy(false);
          }
        }}
      >
        {busy ? <Spinner /> : null} {tl('Check affordability')}
      </Button>
      {error && <p className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
      {a && (
        <div className="mt-5 space-y-4">
          <div className={cx('rounded-lg p-3', a.verdict === 'pass' ? 'bg-emerald-50' : a.verdict === 'borderline' ? 'bg-amber-50' : 'bg-red-50')}>
            <p className={cx('text-lg font-semibold', a.verdict === 'pass' ? 'text-emerald-800' : a.verdict === 'borderline' ? 'text-amber-800' : 'text-red-800')}>
              {a.verdict === 'pass' ? tl('Affordable') : a.verdict === 'borderline' ? tl('Borderline') : tl('Not affordable')}
            </p>
            <p className="text-sm text-ink-700">
              {tl('Weakest month: {m}. Rule: deductions at most {p} of gross pay.', { m: a.worstMonth, p: pct(a.rule.maxDeductionPct, 0) })}{' '}
              {tl('Largest instalment the rule allows: {v}.', { v: rm(a.maxAffordableInstalment, 2) })}
            </p>
          </div>
          <SimpleTable
            title={tl('Month by month')}
            head={[tl('Month'), tl('Gross'), tl('Deductions'), tl('Net'), tl('Deductions after'), tl('Net after')]}
            rows={a.months.map((m) => [m.month, rm(m.gross, 2), rm(m.deductions, 2), rm(m.net, 2), pct(m.deductionPctAfter, 1), rm(m.netAfter, 2)])}
          />
          {a.flags.length > 0 && (
            <ul className="list-disc space-y-1 rounded-lg bg-amber-50 p-3 pl-7 text-sm text-amber-900">
              {a.flags.map((f) => <li key={f}>{f}</li>)}
            </ul>
          )}
          <div className="flex flex-wrap gap-2">
            <Button variant="ghost" onClick={() => ask(`${a.markdown}\n\nQuestion: `)}>
              <Icon name="reply" className="h-4 w-4" /> {tl('Ask the council about this')}
            </Button>
            <Button
              variant="ghost"
              onClick={() => ask(`Draft a short credit memo for this personal financing application, for the credit committee. Use only these figures; mark anything else as [TO CONFIRM].\n\n${a.markdown}`)}
            >
              <Icon name="copy" className="h-4 w-4" /> {tl('Draft a credit memo')}
            </Button>
          </div>
        </div>
      )}
    </Card>
  );
}
