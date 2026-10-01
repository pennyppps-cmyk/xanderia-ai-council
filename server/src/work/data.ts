import type { SourceTask } from './plans.js';

/**
 * Follow-up work built from the tools' figures. Only aggregates go into tasks (and so into
 * emails); customer names and IC numbers never do. Account numbers are included only for the
 * deduction exceptions, where Finance cannot act without them.
 */
const rm = (n: number) => `RM ${n.toLocaleString('en-MY', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

type Bucket = 'Current' | '1-30' | '31-60' | '61-90' | '91-180' | '181+';
interface BranchAgg {
  name: string;
  accounts: number;
  balance: number;
  buckets: Record<Bucket, { accounts: number; balance: number }>;
}

/** One follow-up task per branch with accounts in arrears, largest arrears first. */
export function arrearsTasks(byBranch: BranchAgg[], dueDate: string): SourceTask[] {
  const overdue: Bucket[] = ['1-30', '31-60', '61-90', '91-180', '181+'];
  return byBranch
    .map((b) => ({
      b,
      accounts: overdue.reduce((n, k) => n + (b.buckets[k]?.accounts ?? 0), 0),
      balance: overdue.reduce((n, k) => n + (b.buckets[k]?.balance ?? 0), 0),
    }))
    .filter((x) => x.accounts > 0)
    .sort((a, b) => b.balance - a.balance)
    .map(({ b, accounts, balance }) => ({
      title: `Arrears follow-up: ${b.name}`,
      description:
        `${accounts.toLocaleString()} accounts in arrears at ${b.name}, ${rm(balance)} outstanding. By days past due: ` +
        overdue
          .filter((k) => b.buckets[k]?.accounts)
          .map((k) => `${k}: ${b.buckets[k].accounts} (${rm(b.buckets[k].balance)})`)
          .join('; ') +
        '. Contact the 1-30 DPD accounts first, before they roll further. Use the collections system for the account list.',
      ownerRole: `Branch Manager ${b.name}`,
      dueDate,
    }));
}

interface DeductionInput {
  matchedOn: 'account' | 'ic' | 'salaryNo';
  counts: Record<'missing' | 'short' | 'over' | 'unknown', number>;
  exceptions: Array<{ kind: 'missing' | 'short' | 'over' | 'unknown'; key: string; difference: number }>;
}

const KIND = {
  missing: { title: 'Loans with no salary deduction this month', action: 'Check with the employer / Angkasa why nothing was deducted and arrange collection before the customer is treated as in arrears.' },
  short: { title: 'Loans deducted short this month', action: 'Confirm the deduction amount with the employer / Angkasa and correct the deduction instruction.' },
  over: { title: 'Loans deducted more than the instalment', action: 'Confirm the extra amount and arrange a refund or allocation as the policy requires.' },
  unknown: { title: 'Deductions received with no matching loan', action: 'Identify the loan each deduction belongs to, or arrange a refund.' },
} as const;

/** One task per kind of exception, for Finance to follow up. */
export function deductionTasks(r: DeductionInput, dueDate: string): SourceTask[] {
  return (Object.keys(KIND) as Array<keyof typeof KIND>)
    .filter((k) => r.counts[k] > 0)
    .map((k) => {
      const list = r.exceptions.filter((e) => e.kind === k);
      const total = list.reduce((n, e) => n + Math.abs(e.difference), 0);
      const accounts =
        r.matchedOn === 'account' && list.length
          ? `\n\nAccounts: ${list.slice(0, 60).map((e) => e.key).join(', ')}${list.length > 60 ? ` and ${list.length - 60} more (see the reconciliation file)` : ''}.`
          : '\n\nThe account list is in the reconciliation file (matched on IC / salary number, so it is not copied into this email).';
      return {
        title: `${KIND[k].title} (${r.counts[k]})`,
        description: `${r.counts[k]} loans, ${rm(total)} difference in total. ${KIND[k].action}${accounts}`,
        ownerRole: 'Finance Executive',
        dueDate,
      };
    });
}

export interface PortfolioLimits {
  enabled: boolean;
  npl_ratio_max: number; // % of balance
  par30_max: number; // % of balance
  branch_npl_max: number; // % of a branch's balance
}
export const DEFAULT_LIMITS: PortfolioLimits = { enabled: false, npl_ratio_max: 5, par30_max: 15, branch_npl_max: 8 };

interface PortfolioFigures {
  nplRatio: number;
  par: { par30: number };
  byBranch: Array<{ name: string; balance: number; nplRatio: number }>;
}

/** Which limits the month's figures break (ratios in the summary are fractions, limits are %). */
export function portfolioBreaches(s: PortfolioFigures, l: PortfolioLimits): string[] {
  const pct = (x: number) => `${(x * 100).toFixed(1)}%`;
  const out: string[] = [];
  if (s.nplRatio * 100 > l.npl_ratio_max) out.push(`NPL ratio is ${pct(s.nplRatio)}, above the ${l.npl_ratio_max}% limit`);
  if (s.par.par30 * 100 > l.par30_max) out.push(`PAR30 is ${pct(s.par.par30)}, above the ${l.par30_max}% limit`);
  for (const b of s.byBranch) {
    if (b.balance > 0 && b.nplRatio * 100 > l.branch_npl_max) out.push(`Branch ${b.name}: NPL ratio ${pct(b.nplRatio)}, above the ${l.branch_npl_max}% branch limit`);
  }
  return out;
}

/** The question the council is asked when a limit is broken. */
export function breachQuestion(month: string, breaches: string[], figures: string) {
  return (
    `The loan portfolio for ${month} has broken limits set by management:\n${breaches.map((b) => `- ${b}`).join('\n')}\n\n` +
    `Figures for the month (calculated from the loan export):\n${figures}\n\n` +
    'What should we do about it? Give a plan with owners and a timeline that brings these figures back within the limits.'
  );
}
