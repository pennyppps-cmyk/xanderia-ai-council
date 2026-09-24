import { describe, expect, it } from 'vitest';
import { analyseArrears, arrearsMarkdown, bucketFor, detectColumns, parseCsv, readTable, toNumber } from '../src/tools/arrears.js';

describe('arrears analysis', () => {
  it('buckets days past due', () => {
    expect([0, 1, 30, 31, 60, 61, 90, 91, 180, 181, 400].map(bucketFor)).toEqual([
      'Current', '1-30', '1-30', '31-60', '31-60', '61-90', '61-90', '91-180', '91-180', '181+', '181+',
    ]);
  });

  it('parses quoted CSV and money', () => {
    expect(parseCsv('a,b\n"x, y","say ""hi"""\r\n1,2\n')).toEqual([['a', 'b'], ['x, y', 'say "hi"'], ['1', '2']]);
    expect(toNumber('RM 12,345.50')).toBe(12345.5);
    expect(toNumber('(100)')).toBe(-100);
    expect(toNumber('n/a')).toBeNull();
  });

  it('detects columns in English and BM', () => {
    expect(detectColumns(['Account No', 'Cawangan', 'Hari Tertunggak', 'Baki Pinjaman', 'Produk'])).toEqual({
      dpd: 'Hari Tertunggak', balance: 'Baki Pinjaman', branch: 'Cawangan', product: 'Produk',
    });
  });

  it('aggregates by bucket, branch and product', async () => {
    const csv = 'Account,Branch,DPD,Outstanding,Product\n1,KL,0,"1,000",PF\n2,KL,45,2000,PF\n3,Ipoh,120,3000,HP\n4,Ipoh,,500,HP\n';
    const { headers, rows } = await readTable('a.csv', Buffer.from(csv));
    const s = analyseArrears(headers, rows);
    expect(s.total.accounts).toBe(3);
    expect(s.skipped).toBe(1);
    expect(s.total.buckets['31-60']).toEqual({ accounts: 1, balance: 2000 });
    expect(s.byBranch.map((b) => b.name)).toEqual(['KL', 'Ipoh']) // equal balance: more accounts first;
    const md = arrearsMarkdown(s);
    expect(md).toContain('| 91-180 | 1 | 33.3% | RM 3,000 | 50.0% |');
  });

  it('asks for a DPD column when none is found', () => {
    expect(() => analyseArrears(['Name', 'Amount'], [['a', '1']])).toThrow(/DPD/);
  });
});
