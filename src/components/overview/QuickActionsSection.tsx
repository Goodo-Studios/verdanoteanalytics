import { Button } from "@/components/ui/button";
import { useNavigate } from "react-router-dom";
import { useSync } from "@/hooks/useSyncApi";
import { FileText, RefreshCw, Sparkles } from "lucide-react";
import { cn } from "@/lib/utils";

interface Props {
  accountId?: string;
}

export function QuickActionsSection({ accountId }: Props) {
  const navigate = useNavigate();
  const sync = useSync();

  return (
    <div className="bg-white border border-border-light rounded-[8px] p-5">
      <h2 className="font-heading text-[18px] text-forest mb-4">Quick Actions</h2>
      <div className="flex flex-wrap gap-3">
        <Button
          variant="outline"
          className="font-body text-[13px] gap-2"
          onClick={() => navigate("/reports/new")}
        >
          <FileText className="h-4 w-4" />
          New Report
        </Button>
        <Button
          variant="outline"
          className="font-body text-[13px] gap-2"
          onClick={() => sync.mutate({ account_id: accountId && accountId !== "all" ? accountId : undefined })}
          disabled={sync.isPending}
        >
          <RefreshCw className={cn("h-4 w-4", sync.isPending && "animate-spin")} />
          Trigger Sync
        </Button>
        <Button
          variant="outline"
          className="font-body text-[13px] gap-2"
          onClick={() => navigate("/ai-chat")}
        >
          <Sparkles className="h-4 w-4" />
          Generate Brief
        </Button>
      </div>
    </div>
  );
}
