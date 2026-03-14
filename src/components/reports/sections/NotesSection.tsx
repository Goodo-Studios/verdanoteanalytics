import { Textarea } from "@/components/ui/textarea";

interface NotesSectionProps {
  config: Record<string, any>;
  report: any;
  isEditing?: boolean;
  onConfigChange?: (config: Record<string, any>) => void;
}

export function NotesSection({ config, isEditing, onConfigChange }: NotesSectionProps) {
  const content = config.content || "";

  if (isEditing) {
    return (
      <div className="space-y-2">
        <label className="font-label text-[11px] uppercase tracking-wider text-muted-foreground font-medium">
          Notes to share
        </label>
        <Textarea
          value={content}
          onChange={(e) => onConfigChange?.({ ...config, content: e.target.value })}
          placeholder="Add your notes, observations, or recommendations here…"
          className="min-h-[120px] font-body text-[14px] text-foreground border-border-light rounded-[4px] resize-y"
        />
      </div>
    );
  }

  if (!content) {
    return (
      <p className="font-body text-[13px] text-muted-foreground italic py-4">
        No notes added to this report.
      </p>
    );
  }

  return (
    <div className="glass-panel p-5">
      <p className="font-body text-[14px] text-foreground whitespace-pre-wrap leading-relaxed">
        {content}
      </p>
    </div>
  );
}
