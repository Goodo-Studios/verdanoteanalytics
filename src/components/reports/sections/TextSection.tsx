import { Textarea } from "@/components/ui/textarea";
import ReactMarkdown from "react-markdown";

interface TextSectionProps {
  config: Record<string, any>;
  report: any;
  isEditing?: boolean;
  onConfigChange?: (config: Record<string, any>) => void;
}

export function TextSection({ config, isEditing, onConfigChange }: TextSectionProps) {
  if (isEditing) {
    return (
      <Textarea
        value={config.content || ""}
        onChange={(e) => onConfigChange?.({ ...config, content: e.target.value })}
        placeholder="Write your text here... (Markdown supported)"
        className="min-h-[120px] font-body text-[14px] text-charcoal border-border-light rounded-[4px]"
      />
    );
  }

  if (!config.content) return null;

  return (
    <div className="prose prose-sm max-w-none font-body text-charcoal">
      <ReactMarkdown>{config.content}</ReactMarkdown>
    </div>
  );
}
