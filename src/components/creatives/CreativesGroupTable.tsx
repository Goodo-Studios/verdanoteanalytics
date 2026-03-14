import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { GROUP_BY_OPTIONS } from "./constants";

interface GroupRow {
  name: string;
  count: number;
  totalSpend: number;
  avgRoas: number;
  avgCpa: number;
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
            <TableHead className="font-label text-[11px] uppercase tracking-[0.04em] text-slate font-semibold text-right">Avg ROAS</TableHead>
            <TableHead className="font-label text-[11px] uppercase tracking-[0.04em] text-slate font-semibold text-right">Avg CPA</TableHead>
            <TableHead className="font-label text-[11px] uppercase tracking-[0.04em] text-slate font-semibold text-right">Avg Spend</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {data.map((g) => (
            <TableRow key={g.name} className="border-b border-border-light">
              <TableCell className="font-body text-[13px] font-medium text-charcoal">{g.name}</TableCell>
              <TableCell className="font-data text-[17px] font-medium text-charcoal tabular-nums text-right">{g.count}</TableCell>
              <TableCell className="font-data text-[17px] font-medium text-charcoal tabular-nums text-right">${g.totalSpend.toLocaleString("en-US", { maximumFractionDigits: 0 })}</TableCell>
              <TableCell className="font-data text-[17px] font-medium text-charcoal tabular-nums text-right">{g.avgRoas.toFixed(2)}x</TableCell>
              <TableCell className="font-data text-[17px] font-medium text-charcoal tabular-nums text-right">${g.avgCpa.toFixed(2)}</TableCell>
              <TableCell className="font-data text-[17px] font-medium text-charcoal tabular-nums text-right">${g.avgSpend.toLocaleString("en-US", { maximumFractionDigits: 0 })}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
