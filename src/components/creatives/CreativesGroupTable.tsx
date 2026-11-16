import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { GROUP_BY_OPTIONS } from "./constants";
import { fmtOrDash } from "@/lib/groupMetrics";

interface GroupRow {
  name: string;
  count: number;
  totalSpend: number;
  /** Group ROAS = total revenue / total spend; null with no spend. */
  roas: number | null;
  /** Group CPA = total spend / total purchases; null with no purchases. */
  cpa: number | null;
  avgSpend: number;
}

interface CreativesGroupTableProps {
  groupBy: string;
  data: GroupRow[];
}

export function CreativesGroupTable({ groupBy, data }: CreativesGroupTableProps) {
  return (
    <div className="glass-panel overflow-hidden">
      <Table>
        <TableHeader>
          <TableRow className="bg-cream-dark">
            <TableHead className="font-label text-[11px] uppercase tracking-[0.04em] text-slate font-semibold">{GROUP_BY_OPTIONS.find(o => o.value === groupBy)?.label}</TableHead>
            <TableHead className="font-label text-[11px] uppercase tracking-[0.04em] text-slate font-semibold text-right">Count</TableHead>
            <TableHead className="font-label text-[11px] uppercase tracking-[0.04em] text-slate font-semibold text-right">Total Spend</TableHead>
            <TableHead className="font-label text-[11px] uppercase tracking-[0.04em] text-slate font-semibold text-right">ROAS</TableHead>
            <TableHead className="font-label text-[11px] uppercase tracking-[0.04em] text-slate font-semibold text-right">CPA</TableHead>
            <TableHead className="font-label text-[11px] uppercase tracking-[0.04em] text-slate font-semibold text-right">Avg Spend</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {data.map((g) => (
            <TableRow key={g.name} className="border-b border-border-light">
              <TableCell className="font-body text-[13px] font-medium text-charcoal">{g.name}</TableCell>
              <TableCell className="font-data text-[17px] font-medium text-charcoal tabular-nums text-right">{g.count}</TableCell>
              <TableCell className="font-data text-[17px] font-medium text-charcoal tabular-nums text-right">${g.totalSpend.toLocaleString("en-US", { maximumFractionDigits: 0 })}</TableCell>
              <TableCell className="font-data text-[17px] font-medium text-charcoal tabular-nums text-right">{fmtOrDash(g.roas, (v) => `${v.toFixed(2)}x`)}</TableCell>
              <TableCell className="font-data text-[17px] font-medium text-charcoal tabular-nums text-right">{fmtOrDash(g.cpa, (v) => `$${v.toFixed(2)}`)}</TableCell>
              <TableCell className="font-data text-[17px] font-medium text-charcoal tabular-nums text-right">${g.avgSpend.toLocaleString("en-US", { maximumFractionDigits: 0 })}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
