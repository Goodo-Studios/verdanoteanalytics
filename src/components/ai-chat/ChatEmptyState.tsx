import { Bot } from "lucide-react";

const SUGGESTED_PROMPTS = [
  "What should I make next?",
  "Which creatives are fatiguing?",
  "Show me this week's winners",
  "What's our best hook type?",
  "Which concepts have the most iterations?",
  "Generate a brief for my next shoot",
];

interface Props {
  onSend: (text: string) => void;
}

export function ChatEmptyState({ onSend }: Props) {
  return (
    <div className="flex flex-col items-center justify-center h-full gap-6 text-center">
      <div className="h-14 w-14 rounded-2xl bg-sage-light flex items-center justify-center">
        <Bot className="h-7 w-7 text-verdant" />
      </div>
      <div>
        <p className="font-heading text-[18px] text-foreground mb-1">What would you like to know?</p>
        <p className="font-body text-[13px] text-muted-foreground max-w-sm">
          I have real-time access to your creative data. Ask me anything about performance, trends, or strategy.
        </p>
      </div>
      <div className="grid grid-cols-2 gap-2 max-w-md w-full">
        {SUGGESTED_PROMPTS.map((prompt) => (
          <button
            key={prompt}
            onClick={() => onSend(prompt)}
            className="font-body text-[12px] text-muted-foreground bg-card border border-border hover:border-primary hover:text-foreground hover:bg-accent rounded-full px-3 py-2 transition-colors text-left"
          >
            {prompt}
          </button>
        ))}
      </div>
    </div>
  );
}
