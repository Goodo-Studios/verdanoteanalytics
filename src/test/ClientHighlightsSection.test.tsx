/**
 * US-005 — "This Period's Highlights": AI-drafted, strategist-published narrative.
 *
 * Verifies the two distinct surfaces of the highlights section:
 *   - STRATEGIST (isAuthor): can draft / edit / publish; the Generate-draft,
 *     Save-draft, and Publish controls invoke their callbacks.
 *   - CLIENT (isAuthor=false): renders ONLY the published narrative (markdown),
 *     never the draft text, the editor, or any authoring control. With nothing
 *     published, a real client gets a friendly onboarding line — never an error.
 */
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ClientHighlightsSection } from "@/components/client/ClientHighlightsSection";

const PUBLISHED = "## Great month\n\nSpend was efficient and revenue climbed.";
const DRAFT = "- Draft point one\n- Draft point two";

afterEach(() => cleanup());

describe("ClientHighlightsSection (US-005)", () => {
  it("client view renders only the published narrative as markdown", () => {
    render(
      <ClientHighlightsSection publishedText={PUBLISHED} periodLabel="May 2026" />,
    );

    // Published markdown renders (heading element from "## Great month").
    expect(screen.getByText("Great month")).toBeInTheDocument();
    expect(
      screen.getByText(/Spend was efficient and revenue climbed/),
    ).toBeInTheDocument();
  });

  it("client view shows NO editor / Generate / Publish controls (AC2)", () => {
    const { container } = render(
      <ClientHighlightsSection publishedText={PUBLISHED} periodLabel="May 2026" />,
    );

    // No authoring affordances exist in the client DOM.
    expect(
      container.querySelector('[data-testid="highlights-author-controls"]'),
    ).toBeNull();
    expect(container.querySelector("textarea")).toBeNull();
    expect(screen.queryByText(/Generate draft/i)).toBeNull();
    expect(screen.queryByText(/^Publish$/i)).toBeNull();
    expect(screen.queryByText(/Save draft/i)).toBeNull();
  });

  it("client never sees draft text even if one would exist (AC2)", () => {
    // The client surface is not given draft props; even if it were, isAuthor
    // is false so the editor block is absent and draft_text is never rendered.
    const { container } = render(
      <ClientHighlightsSection
        publishedText={PUBLISHED}
        periodLabel="May 2026"
        isAuthor={false}
        draftText={DRAFT}
        status="draft"
      />,
    );
    const text = container.textContent ?? "";
    expect(text).not.toMatch(/Draft point one/);
    expect(text).not.toMatch(/Draft point two/);
    expect(container.querySelector("textarea")).toBeNull();
  });

  it("client view shows a friendly onboarding state when nothing is published (AC3)", () => {
    render(
      <ClientHighlightsSection publishedText={null} periodLabel="May 2026" />,
    );
    expect(
      screen.getByText(/Your strategist is preparing your first highlights/i),
    ).toBeInTheDocument();
  });

  it("strategist view renders the editor seeded with the draft text (AC1)", () => {
    render(
      <ClientHighlightsSection
        publishedText={null}
        periodLabel="May 2026"
        isAuthor
        draftText={DRAFT}
        status="draft"
      />,
    );
    const textarea = screen.getByLabelText("Highlights draft") as HTMLTextAreaElement;
    expect(textarea).toBeInTheDocument();
    expect(textarea.value).toBe(DRAFT);
  });

  it("strategist can generate, edit, and publish a draft (AC1, AC5)", () => {
    const onGenerateDraft = vi.fn();
    const onSaveDraft = vi.fn();
    const onPublish = vi.fn();

    render(
      <ClientHighlightsSection
        publishedText={null}
        periodLabel="May 2026"
        isAuthor
        draftText={DRAFT}
        status="draft"
        onGenerateDraft={onGenerateDraft}
        onSaveDraft={onSaveDraft}
        onPublish={onPublish}
      />,
    );

    fireEvent.click(screen.getByText(/Generate draft/i));
    expect(onGenerateDraft).toHaveBeenCalledTimes(1);

    const textarea = screen.getByLabelText("Highlights draft") as HTMLTextAreaElement;
    fireEvent.change(textarea, { target: { value: "Revised narrative" } });

    fireEvent.click(screen.getByText(/Save draft/i));
    expect(onSaveDraft).toHaveBeenCalledWith("Revised narrative");

    fireEvent.click(screen.getByText(/^Publish$/i));
    expect(onPublish).toHaveBeenCalledWith("Revised narrative");
  });

  it("strategist Publish is disabled when the editor is empty", () => {
    const onPublish = vi.fn();
    render(
      <ClientHighlightsSection
        publishedText={null}
        periodLabel="May 2026"
        isAuthor
        draftText=""
        status="draft"
        onPublish={onPublish}
      />,
    );
    const publishBtn = screen.getByText(/^Publish$/i).closest("button");
    expect(publishBtn).toBeDisabled();
  });
});
