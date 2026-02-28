import { useMemo } from "react";
import { CheckCircle2, AlertTriangle } from "lucide-react";
import { useAccountContext } from "@/contexts/AccountContext";
import { loadNamingConfig, validateAdName } from "@/components/settings/NamingConventionSection";

interface Props {
  value: string;
}

export function NamingValidator({ value }: Props) {
  const { selectedAccountId } = useAccountContext();

  const result = useMemo(() => {
    if (!selectedAccountId || selectedAccountId === "all" || !value.trim()) return null;
    const config = loadNamingConfig(selectedAccountId);
    if (!config || config.tokens.length === 0) return null;
    return validateAdName(value, config);
  }, [value, selectedAccountId]);

  if (!result) return null;

  return (
    <div className="flex items-start gap-1.5 mt-1">
      {result.valid ? (
        <>
          <CheckCircle2 className="h-3.5 w-3.5 text-[hsl(var(--success))] shrink-0 mt-0.5" />
          <span className="text-[11px] text-[hsl(var(--success))]">Follows naming convention</span>
        </>
      ) : (
        <>
          <AlertTriangle className="h-3.5 w-3.5 text-[hsl(var(--warning))] shrink-0 mt-0.5" />
          <div className="space-y-0.5">
            {result.issues.map((issue, i) => (
              <p key={i} className="text-[11px] text-[hsl(var(--warning))]">{issue}</p>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
