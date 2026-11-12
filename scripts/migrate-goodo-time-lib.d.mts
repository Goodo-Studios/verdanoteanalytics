// Types for scripts/migrate-goodo-time-lib.mjs, so the Vitest suite can import it.

export const STAGING_REF: string;
export const DEFAULT_ZONE: string;

export interface Totals {
  ms: number;
  entries: number;
}
export type TotalsMap = Map<string, Totals>;
type Row = Record<string, unknown>;
type IdMap = Map<number, string>;

export function parseArgs(argv: string[]): { dryRun: boolean; allowProduction: boolean; help: boolean };
export function assertTarget(url: string | undefined, opts?: { allowProduction?: boolean }): string;
export function normaliseEmail(email: unknown): string;
export function mapPerson(user: Row): Row;
export function mapClient(client: Row): Row;
export function mapProject(project: Row, clientIds: IdMap): Row;
export function mapInvoice(invoice: Row, personIds: IdMap): Row;
export function mapInvoiceLine(line: Row, invoiceIds: IdMap): Row;
export function mapEntry(entry: Row, maps: { personIds: IdMap; projectIds: IdMap; invoiceIds: IdMap }): Row;
export function monthKey(instant: string | number | Date, zone?: string): string;
export function totalsByPersonMonth(
  rows: { email: string; start_at: string | Date; end_at: string | Date | null }[],
  zone?: string,
): TotalsMap;
export function compareTotals(
  source: TotalsMap,
  target: TotalsMap,
): { key: string; source: Totals; target: Totals }[];
export function formatTotals(source: TotalsMap, target?: TotalsMap): string;
export function compareCounts(
  source: Record<string, number>,
  target: Record<string, number>,
): { table: string; source: number; target: number }[];
