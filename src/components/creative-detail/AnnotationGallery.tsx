import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Loader2, Trash2, Download } from "lucide-react";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { useQueryClient } from "@tanstack/react-query";
import { format } from "date-fns";

interface AnnotationGalleryProps {
  adId: string;
}

export function AnnotationGallery({ adId }: AnnotationGalleryProps) {
  const queryClient = useQueryClient();

  const { data: annotations = [], isLoading } = useQuery({
    queryKey: ["annotations", adId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("annotations")
        .select("*")
        .eq("ad_id", adId)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return (data || []).map((a: any) => ({
        ...a,
        publicUrl: supabase.storage.from("annotations").getPublicUrl(a.image_path).data.publicUrl,
      }));
    },
    enabled: !!adId,
  });

  const handleDelete = async (annotation: any) => {
    try {
      await supabase.storage.from("annotations").remove([annotation.image_path]);
      await supabase.from("annotations").delete().eq("id", annotation.id);
      queryClient.invalidateQueries({ queryKey: ["annotations", adId] });
      toast.success("Annotation deleted");
    } catch {
      toast.error("Failed to delete annotation");
    }
  };

  const handleDownload = (annotation: any) => {
    const a = document.createElement("a");
    a.href = annotation.publicUrl;
    a.download = `annotation_${adId}_${annotation.id}.png`;
    a.target = "_blank";
    a.click();
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-8">
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (annotations.length === 0) {
    return (
      <div className="text-center py-8">
        <p className="font-body text-[13px] text-muted-foreground">
          No annotations yet. Use the "Annotate" button above to add annotations to this creative.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <h3 className="font-heading text-[14px] text-forest">
        Saved Annotations ({annotations.length})
      </h3>
      <div className="grid grid-cols-2 gap-3">
        {annotations.map((ann: any) => (
          <div key={ann.id} className="group relative rounded-md border border-border overflow-hidden bg-muted">
            <img
              src={ann.publicUrl}
              alt="Annotation"
              className="w-full h-auto"
              loading="lazy"
            />
            <div className="absolute inset-0 bg-black/0 group-hover:bg-black/30 transition-colors flex items-end justify-between p-2 opacity-0 group-hover:opacity-100 transition-opacity">
              <span className="font-body text-[10px] text-white bg-black/50 px-1.5 py-0.5 rounded">
                {ann.created_at ? format(new Date(ann.created_at), "MMM d, yyyy h:mm a") : "—"}
              </span>
              <div className="flex gap-1">
                <Button
                  size="sm"
                  variant="secondary"
                  className="h-7 w-7 p-0"
                  onClick={() => handleDownload(ann)}
                  title="Download"
                >
                  <Download className="h-3.5 w-3.5" />
                </Button>
                <Button
                  size="sm"
                  variant="secondary"
                  className="h-7 w-7 p-0 text-destructive"
                  onClick={() => handleDelete(ann)}
                  title="Delete"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </Button>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
