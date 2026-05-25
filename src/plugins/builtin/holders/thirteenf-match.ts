import { listThirteenFForms, searchThirteenFFunds } from "../thirteenf/api";
import { dateYearsAgo, todayIso } from "../thirteenf/model";
import type { HolderRow } from "./types";

export interface Holder13FMatch {
  cik: string;
  fundName: string;
  periodOfReport?: string;
  filedAsOfDate?: string;
  tableValueTotal?: number | null;
}

const HOLDER_MATCH_LIMIT = 25;
const HOLDER_MATCH_CONCURRENCY = 4;

function normalizeName(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9 ]+/g, " ")
    .replace(/\b(inc|llc|ltd|lp|corp|corporation|co|company|the)\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function bestFundMatch(holderName: string, funds: Array<{ cik: string; name: string }>) {
  const normalizedHolder = normalizeName(holderName);
  return funds.find((fund) => normalizeName(fund.name) === normalizedHolder)
    ?? funds.find((fund) => {
      const normalizedFund = normalizeName(fund.name);
      return normalizedFund.includes(normalizedHolder)
        || normalizedHolder.includes(normalizedFund);
    })
    ?? funds[0];
}

export async function loadHolder13FMatches(
  rows: HolderRow[],
  signal: AbortSignal,
): Promise<Map<string, Holder13FMatch>> {
  const now = new Date();
  const from = dateYearsAgo(2, now);
  const to = todayIso(now);
  const matches = new Map<string, Holder13FMatch>();
  const sourceRows = rows.filter((row) => row.name).slice(0, HOLDER_MATCH_LIMIT);

  let index = 0;
  async function worker() {
    while (!signal.aborted && index < sourceRows.length) {
      const row = sourceRows[index++];
      if (!row) continue;
      try {
        const funds = await searchThirteenFFunds(row.name, 5, signal);
        const fund = bestFundMatch(row.name, funds);
        if (!fund) continue;
        const forms = await listThirteenFForms(fund.cik, from, to, 1, signal);
        const form = forms[0];
        matches.set(row.id, {
          cik: fund.cik,
          fundName: fund.name,
          periodOfReport: form?.periodOfReport,
          filedAsOfDate: form?.filedAsOfDate,
          tableValueTotal: form?.tableValueTotal,
        });
      } catch {
        // Matching 13F metadata is an enhancement; holder rows should remain usable.
      }
    }
  }

  await Promise.all(Array.from(
    { length: Math.min(HOLDER_MATCH_CONCURRENCY, sourceRows.length) },
    () => worker(),
  ));

  return matches;
}
