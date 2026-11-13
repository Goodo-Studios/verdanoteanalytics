// Ask the Brain (Goodo OS OS-026). A question box on the Brain page. The brain-ask edge function
// answers only from Brain pages and returns the pages it used; every answer lists them as links.
// When nothing matches it says so plainly and cites nothing. Staff only: the Brain page renders
// this only for builders and employees, and the function refuses everyone else.
import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { BRAIN_SECTIONS, type BrainAnswer, type BrainSection, toBrainAnswer } from "./model";

function asSection(value: string): BrainSection | null {
  return BRAIN_SECTIONS.find((s) => s === value) ?? null;
}

export function BrainAsk({ onOpen }: { onOpen: (section: BrainSection, slug: string) => void }) {
  const [question, setQuestion] = useState("");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<BrainAnswer | null>(null);
  const [error, setError] = useState<string | null>(null);

  const ask = async (e: React.FormEvent) => {
    e.preventDefault();
    const q = question.trim();
    if (q.length < 3) return setError("Ask a question of at least 3 characters.");
    setBusy(true);
    setError(null);
    setResult(null);
    const { data, error: e2 } = await supabase.functions.invoke("brain-ask", { body: { question: q } });
    setBusy(false);
    if (e2) return setError("The Brain could not answer right now. Try again.");
    setResult(toBrainAnswer(data));
  };

  return (
    <section aria-label="Ask the Brain" className="space-y-3 rounded-lg border border-input p-4" data-testid="brain-ask">
      <form onSubmit={(e) => void ask(e)} className="flex flex-col gap-2 sm:flex-row">
        <label htmlFor="brain-ask-input" className="sr-only">Ask the Brain a question</label>
        <input
          id="brain-ask-input"
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
          maxLength={500}
          placeholder="Ask the Brain a question"
          className="h-9 flex-1 rounded-md border border-input bg-background px-3 text-sm"
        />
        <Button type="submit" size="sm" disabled={busy}>{busy ? "Asking…" : "Ask"}</Button>
      </form>
      <p className="text-[12px] text-muted-foreground">Answers come only from Brain pages, and list the pages they came from.</p>
      {error ? <p role="alert" className="text-sm text-muted-foreground">{error}</p> : null}
      {result ? (
        <div className="space-y-3" data-testid="brain-answer" aria-live="polite">
          {result.mode === "none" ? (
            <p className="text-sm" data-testid="brain-answer-none">{result.answer}</p>
          ) : (
            <>
              {result.answer ? <p className="whitespace-pre-wrap text-sm" data-testid="brain-answer-text">{result.answer}</p> : (
                <p className="text-sm text-muted-foreground">These parts of the Brain match your question.</p>
              )}
              {result.mode === "passages" && result.passages.length ? (
                <ul className="space-y-2" data-testid="brain-answer-passages">
                  {result.passages.map((p, i) => (
                    <li key={i} className="rounded-md bg-muted/40 p-2 text-sm">
                      <p className="whitespace-pre-wrap">{p.text}</p>
                      <p className="text-[12px] text-muted-foreground">From {p.title}</p>
                    </li>
                  ))}
                </ul>
              ) : null}
              <div>
                <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Sources</h3>
                <ul className="list-disc pl-5 text-sm" data-testid="brain-answer-sources">
                  {result.citations.map((c) => {
                    const section = asSection(c.section);
                    const href = `?section=${c.section.toLowerCase()}&page=${encodeURIComponent(c.slug)}`;
                    return (
                      <li key={`${c.section}/${c.slug}`}>
                        <a
                          href={href}
                          className="underline"
                          onClick={(e) => {
                            if (!section) return;
                            e.preventDefault();
                            onOpen(section, c.slug);
                          }}
                        >
                          {c.title}
                        </a>
                        <span className="text-muted-foreground"> · {c.section}</span>
                      </li>
                    );
                  })}
                </ul>
              </div>
            </>
          )}
        </div>
      ) : null}
    </section>
  );
}
