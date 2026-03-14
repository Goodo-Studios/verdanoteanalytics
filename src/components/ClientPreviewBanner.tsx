import { useClientPreview } from "@/hooks/useClientPreviewMode";
import { Button } from "@/components/ui/button";
import { Eye } from "lucide-react";
import { useNavigate } from "react-router-dom";

export function ClientPreviewBanner() {
  const { isClientPreview, isEmployeePreview, previewRole, setPreviewRole } = useClientPreview();
  const navigate = useNavigate();

  if (!isClientPreview && !isEmployeePreview) return null;

  const label = previewRole === "client" ? "Client" : "Employee";

  return (
    <div className="bg-gold-light px-4 py-2 flex items-center justify-between sticky top-0 z-50">
      <div className="flex items-center gap-2">
        <Eye className="h-4 w-4 text-[#92730F]" />
        <span className="font-body text-[13px] text-charcoal">
          {label} Preview Mode — this is what your {label.toLowerCase()} sees
        </span>
      </div>
      <Button
        size="sm"
        variant="outline"
        className="h-7 font-body text-[12px] border-[#92730F]/30 text-[#92730F] hover:bg-gold-light/80"
        onClick={() => { setPreviewRole(null); navigate("/builder/"); }}
      >
        Exit Preview
      </Button>
    </div>
  );
}
