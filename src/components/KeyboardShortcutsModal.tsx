import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

interface Shortcut {
  keys: string[];
  description: string;
}

interface Section {
  title: string;
  shortcuts: Shortcut[];
}

const sections: Section[] = [
  {
    title: "Global",
    shortcuts: [
      { keys: ["⌘", "K"], description: "Open Command Bar" },
      { keys: ["?"], description: "Show this shortcuts panel" },
      { keys: ["Esc"], description: "Close modal / panel / drawer" },
      { keys: ["G", "D"], description: "Go to Dashboard" },
      { keys: ["G", "C"], description: "Go to Creatives" },
      { keys: ["G", "A"], description: "Go to Analytics" },
      { keys: ["G", "R"], description: "Go to Reports" },
      { keys: ["G", "T"], description: "Go to Tagging" },
      { keys: ["G", "B"], description: "Go to Briefs" },
      { keys: ["G", "S"], description: "Go to Settings" },
      { keys: ["["], description: "Previous account" },
      { keys: ["]"], description: "Next account" },
    ],
  },
  {
    title: "Creatives Page",
    shortcuts: [
      { keys: ["/"], description: "Focus search bar" },
      { keys: ["F"], description: "Toggle filters panel" },
      { keys: ["1"], description: "Grid view" },
      { keys: ["2"], description: "Table view" },
      { keys: ["3"], description: "Timeline view" },
      { keys: ["S"], description: "Sort options menu" },
      { keys: ["N"], description: "New Brief from selected" },
    ],
  },
  {
    title: "Creative Detail Modal",
    shortcuts: [
      { keys: ["→"], description: "Next creative" },
      { keys: ["←"], description: "Previous creative" },
      { keys: ["C"], description: "Comments tab" },
      { keys: ["C"], description: "Comments tab" },
      { keys: ["B"], description: "Brief from creative" },
      { keys: ["Esc"], description: "Close modal" },
    ],
  },
  {
    title: "Tagging Page",
    shortcuts: [
      { keys: ["Q"], description: "Enter Quick Tag mode" },
      { keys: ["→"], description: "Next creative" },
      { keys: ["←"], description: "Previous creative" },
      { keys: ["1–9"], description: "Toggle tag by number" },
      { keys: ["Enter"], description: "Save and next" },
    ],
  },
  {
    title: "Command Bar",
    shortcuts: [
      { keys: ["↑", "↓"], description: "Navigate results" },
      { keys: ["Enter"], description: "Select" },
      { keys: ["Esc"], description: "Close" },
      { keys: ["Tab"], description: "Switch mode" },
    ],
  },
];

function Kbd({ children }: { children: string }) {
  return (
    <kbd className="inline-flex items-center justify-center min-w-[22px] h-[22px] px-1.5 rounded-md bg-muted border border-border text-[11px] font-mono font-medium text-muted-foreground leading-none">
      {children}
    </kbd>
  );
}

export function KeyboardShortcutsModal({ open, onOpenChange }: Props) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="text-lg font-heading">Keyboard Shortcuts</DialogTitle>
          <DialogDescription className="text-sm text-muted-foreground">
            Press <Kbd>?</Kbd> anywhere to show this panel.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-5 mt-2">
          {sections.map((section) => (
            <div key={section.title}>
              <h3 className="font-label text-[10px] uppercase tracking-[0.12em] text-muted-foreground mb-2">
                {section.title}
              </h3>
              <div className="space-y-1">
                {section.shortcuts.map((sc, i) => (
                  <div
                    key={i}
                    className="flex items-center justify-between py-1.5 px-2 rounded-md hover:bg-accent/40 transition-colors"
                  >
                    <span className="text-sm text-foreground">{sc.description}</span>
                    <span className="flex items-center gap-1 shrink-0 ml-4">
                      {sc.keys.map((k, ki) => (
                        <span key={ki} className="flex items-center gap-0.5">
                          {ki > 0 && (
                            <span className="text-[10px] text-muted-foreground mx-0.5">then</span>
                          )}
                          <Kbd>{k}</Kbd>
                        </span>
                      ))}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  );
}
