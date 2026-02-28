import { useState, useRef, useEffect, useCallback } from "react";
import { AppLayout } from "@/components/AppLayout";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Send, Bot, User, Loader2, Sparkles, Download, MessageSquare, FileText, BarChart3, Lightbulb, AlertCircle } from "lucide-react";
import { useAccountContext } from "@/contexts/AccountContext";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import ReactMarkdown from "react-markdown";
import { ChatHistorySidebar } from "@/components/ai-chat/ChatHistorySidebar";
import { ChatEmptyState } from "@/components/ai-chat/ChatEmptyState";
import { useAIChatHistory } from "@/hooks/useAIChatHistory";
import { exportChatAsMarkdown } from "@/lib/exportChat";
import { cn } from "@/lib/utils";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";

interface Message {
  role: "user" | "assistant";
  content: string;
}

type AnalysisMode = "free_chat" | "weekly_brief" | "competitive_debrief" | "concept_planner";

const MODE_TABS: { mode: AnalysisMode; label: string; icon: React.ReactNode; description: string }[] = [
  { mode: "free_chat", label: "Free Chat", icon: <MessageSquare className="h-3.5 w-3.5" />, description: "Ask anything about your creative data" },
  { mode: "weekly_brief", label: "Weekly Brief", icon: <FileText className="h-3.5 w-3.5" />, description: "Structured weekly performance analysis" },
  { mode: "competitive_debrief", label: "Competitive Debrief", icon: <BarChart3 className="h-3.5 w-3.5" />, description: "Benchmark vs industry comparison" },
  { mode: "concept_planner", label: "Concept Planner", icon: <Lightbulb className="h-3.5 w-3.5" />, description: "AI-generated creative concept plans" },
];

export default function AIChatPage() {
  const { selectedAccountId } = useAccountContext();
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [activeMode, setActiveMode] = useState<AnalysisMode>("free_chat");
  const [pendingMode, setPendingMode] = useState<AnalysisMode | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const { data: history = [], invalidate: refreshHistory } = useAIChatHistory();

  // Concept planner inputs
  const [conceptProduct, setConceptProduct] = useState("");
  const [conceptAudience, setConceptAudience] = useState("");
  const [conceptGoal, setConceptGoal] = useState("");

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, isLoading]);

  const loadConversation = useCallback(async (id: string) => {
    const { data, error } = await supabase
      .from("ai_conversations")
      .select("messages, context")
      .eq("id", id)
      .single();
    if (error || !data) { toast.error("Could not load conversation"); return; }
    setConversationId(id);
    setMessages((data.messages as any as Message[]) || []);
    // Restore mode if saved
    const savedMode = (data.context as any)?.mode;
    if (savedMode && MODE_TABS.some(t => t.mode === savedMode)) {
      setActiveMode(savedMode);
    }
    setInput("");
  }, []);

  const handleNewChat = useCallback(() => {
    setMessages([]);
    setConversationId(null);
    setInput("");
    textareaRef.current?.focus();
  }, []);

  const handleModeSwitch = (newMode: AnalysisMode) => {
    if (newMode === activeMode) return;
    if (messages.length > 0) {
      setPendingMode(newMode);
    } else {
      setActiveMode(newMode);
      setConversationId(null);
    }
  };

  const confirmModeSwitch = () => {
    if (pendingMode) {
      setActiveMode(pendingMode);
      setMessages([]);
      setConversationId(null);
      setInput("");
      setPendingMode(null);
    }
  };

  const sendMessage = async (text: string, modeOverride?: AnalysisMode, modeInputs?: any) => {
    const trimmed = text.trim();
    if (!trimmed || isLoading) return;

    const userMsg: Message = { role: "user", content: trimmed };
    setMessages(prev => [...prev, userMsg]);
    setInput("");
    setIsLoading(true);

    const mode = modeOverride || activeMode;

    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) throw new Error("Not authenticated");

      const res = await fetch(
        `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/ai-chat`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${session.access_token}`,
          },
          body: JSON.stringify({
            message: trimmed,
            conversationId,
            accountId: selectedAccountId,
            mode,
            modeInputs,
          }),
        }
      );

      if (res.status === 429) { toast.error("Rate limit reached — please wait a moment."); setMessages(prev => prev.slice(0, -1)); return; }
      if (res.status === 402) { toast.error("AI credits exhausted."); setMessages(prev => prev.slice(0, -1)); return; }
      if (!res.ok) throw new Error("AI service error");

      const data = await res.json();
      if (data.error) throw new Error(data.error);

      setMessages(prev => [...prev, { role: "assistant", content: data.answer }]);
      if (data.conversationId && !conversationId) setConversationId(data.conversationId);
      refreshHistory();
    } catch (err: any) {
      console.error(err);
      toast.error(err.message || "Failed to get a response.");
      setMessages(prev => prev.slice(0, -1));
    } finally {
      setIsLoading(false);
      textareaRef.current?.focus();
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); sendMessage(input); }
  };

  const handleWeeklyBrief = () => {
    sendMessage("Generate my weekly performance brief for this account.", "weekly_brief");
  };

  const handleCompetitiveDebrief = () => {
    sendMessage("Analyze this account's performance against industry benchmarks and provide strategic recommendations.", "competitive_debrief");
  };

  const handleConceptPlan = () => {
    if (!conceptProduct.trim()) { toast.error("Please enter a product description."); return; }
    sendMessage(
      `Create a creative concept plan for: Product: ${conceptProduct}. Audience: ${conceptAudience || "Not specified"}. Goal: ${conceptGoal || "Not specified"}.`,
      "concept_planner",
      { product: conceptProduct, audience: conceptAudience, goal: conceptGoal }
    );
  };

  const renderModeEmptyState = () => {
    switch (activeMode) {
      case "weekly_brief":
        return (
          <div className="flex flex-col items-center justify-center h-full gap-5 text-center">
            <div className="h-14 w-14 rounded-2xl bg-accent flex items-center justify-center">
              <FileText className="h-7 w-7 text-primary" />
            </div>
            <div>
              <p className="font-heading text-[18px] text-foreground mb-1">Weekly Performance Brief</p>
              <p className="font-body text-[13px] text-muted-foreground max-w-md">
                Get a structured analysis of what worked, what didn't, patterns, and action items for next week.
              </p>
            </div>
            <Button onClick={handleWeeklyBrief} disabled={isLoading} className="gap-2">
              {isLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
              Generate Weekly Brief
            </Button>
          </div>
        );

      case "competitive_debrief":
        return (
          <div className="flex flex-col items-center justify-center h-full gap-5 text-center">
            <div className="h-14 w-14 rounded-2xl bg-accent flex items-center justify-center">
              <BarChart3 className="h-7 w-7 text-primary" />
            </div>
            <div>
              <p className="font-heading text-[18px] text-foreground mb-1">Competitive Debrief</p>
              <p className="font-body text-[13px] text-muted-foreground max-w-md">
                Compare this account's ROAS, CTR, and CPA against industry benchmarks. See where you're winning and where to improve.
              </p>
            </div>
            <Button onClick={handleCompetitiveDebrief} disabled={isLoading} className="gap-2">
              {isLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
              Run Competitive Analysis
            </Button>
            {!selectedAccountId || selectedAccountId === "all" ? (
              <div className="flex items-center gap-2 text-amber-600">
                <AlertCircle className="h-3.5 w-3.5" />
                <span className="font-body text-[12px]">Select a specific account for best results</span>
              </div>
            ) : null}
          </div>
        );

      case "concept_planner":
        return (
          <div className="flex flex-col items-center justify-center h-full gap-5 text-center">
            <div className="h-14 w-14 rounded-2xl bg-accent flex items-center justify-center">
              <Lightbulb className="h-7 w-7 text-primary" />
            </div>
            <div>
              <p className="font-heading text-[18px] text-foreground mb-1">Concept Planner</p>
              <p className="font-body text-[13px] text-muted-foreground max-w-md">
                Describe your product, audience, and goal — get 3 ready-to-produce creative concepts backed by your data.
              </p>
            </div>
            <div className="w-full max-w-md space-y-3 text-left">
              <div>
                <label className="font-label text-[11px] uppercase tracking-wide text-muted-foreground mb-1 block">Product *</label>
                <Input
                  value={conceptProduct}
                  onChange={(e) => setConceptProduct(e.target.value)}
                  placeholder="e.g. Organic protein powder for active women"
                  className="font-body text-[13px]"
                />
              </div>
              <div>
                <label className="font-label text-[11px] uppercase tracking-wide text-muted-foreground mb-1 block">Target Audience</label>
                <Input
                  value={conceptAudience}
                  onChange={(e) => setConceptAudience(e.target.value)}
                  placeholder="e.g. Women 25-45, fitness-conscious, Instagram-active"
                  className="font-body text-[13px]"
                />
              </div>
              <div>
                <label className="font-label text-[11px] uppercase tracking-wide text-muted-foreground mb-1 block">Goal</label>
                <Input
                  value={conceptGoal}
                  onChange={(e) => setConceptGoal(e.target.value)}
                  placeholder="e.g. Drive first purchases, ROAS > 2x"
                  className="font-body text-[13px]"
                />
              </div>
              <Button onClick={handleConceptPlan} disabled={isLoading || !conceptProduct.trim()} className="w-full gap-2">
                {isLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
                Generate Concept Plan
              </Button>
            </div>
          </div>
        );

      default:
        return <ChatEmptyState onSend={sendMessage} />;
    }
  };

  return (
    <AppLayout>
      <div className="flex h-[calc(100vh-64px)] -mx-6 -mt-6">
        {/* History sidebar */}
        <ChatHistorySidebar
          conversations={history}
          activeId={conversationId}
          onSelect={loadConversation}
          onNewChat={handleNewChat}
          onDeleted={() => { refreshHistory(); if (conversationId) handleNewChat(); }}
        />

        {/* Main chat area */}
        <div className="flex-1 flex flex-col min-w-0">
          {/* Header with mode tabs */}
          <div className="shrink-0 border-b border-border">
            <div className="flex items-center justify-between px-6 py-2.5">
              <div className="flex items-center gap-2">
                <Sparkles className="h-5 w-5 text-primary" />
                <h1 className="font-heading text-[20px] text-foreground">AI Analyst</h1>
              </div>
              {messages.length > 0 && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => exportChatAsMarkdown(messages)}
                  className="gap-1.5 text-muted-foreground hover:text-foreground text-[12px]"
                >
                  <Download className="h-3.5 w-3.5" />
                  Export
                </Button>
              )}
            </div>
            {/* Mode tabs */}
            <div className="flex items-center gap-1 px-6 pb-2">
              {MODE_TABS.map((tab) => (
                <button
                  key={tab.mode}
                  onClick={() => handleModeSwitch(tab.mode)}
                  className={cn(
                    "inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full font-body text-[12px] font-medium transition-colors",
                    activeMode === tab.mode
                      ? "bg-primary text-primary-foreground"
                      : "bg-card border border-border text-muted-foreground hover:text-foreground hover:border-primary/40"
                  )}
                  title={tab.description}
                >
                  {tab.icon}
                  {tab.label}
                </button>
              ))}
            </div>
          </div>

          {/* Messages */}
          <div className="flex-1 overflow-y-auto px-6 py-4 space-y-4 min-h-0">
            {messages.length === 0 ? (
              renderModeEmptyState()
            ) : (
              <>
                {messages.map((msg, i) => (
                  <div key={i} className={`flex gap-3 ${msg.role === "user" ? "justify-end" : "justify-start"}`}>
                    {msg.role === "assistant" && (
                      <div className="h-7 w-7 rounded-lg bg-accent flex items-center justify-center shrink-0 mt-0.5">
                        <Bot className="h-4 w-4 text-primary" />
                      </div>
                    )}
                    <div className={`max-w-[75%] rounded-2xl px-4 py-3 font-body text-[13px] leading-relaxed ${
                      msg.role === "user"
                        ? "bg-primary text-primary-foreground rounded-br-sm"
                        : "bg-card border border-border text-foreground rounded-bl-sm"
                    }`}>
                      {msg.role === "assistant" ? (
                        <div className="prose prose-sm max-w-none prose-p:my-1 prose-ul:my-1 prose-li:my-0.5 prose-strong:text-foreground prose-headings:text-foreground prose-headings:font-heading">
                          <ReactMarkdown>{msg.content}</ReactMarkdown>
                        </div>
                      ) : msg.content}
                    </div>
                    {msg.role === "user" && (
                      <div className="h-7 w-7 rounded-lg bg-muted flex items-center justify-center shrink-0 mt-0.5">
                        <User className="h-4 w-4 text-muted-foreground" />
                      </div>
                    )}
                  </div>
                ))}
                {isLoading && (
                  <div className="flex gap-3 justify-start">
                    <div className="h-7 w-7 rounded-lg bg-accent flex items-center justify-center shrink-0 mt-0.5">
                      <Bot className="h-4 w-4 text-primary" />
                    </div>
                    <div className="bg-card border border-border rounded-2xl rounded-bl-sm px-4 py-3 flex items-center gap-2">
                      <Loader2 className="h-4 w-4 animate-spin text-primary" />
                      <span className="font-body text-[13px] text-muted-foreground">Thinking…</span>
                    </div>
                  </div>
                )}
                <div ref={bottomRef} />
              </>
            )}
          </div>

          {/* Input */}
          <div className="shrink-0 border-t border-border px-6 py-3">
            <div className="max-w-3xl mx-auto flex items-end gap-2 bg-card border border-border rounded-xl p-3 focus-within:border-primary transition-colors">
              <Textarea
                ref={textareaRef}
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder={
                  activeMode === "weekly_brief" ? "Ask follow-up questions about your brief…"
                  : activeMode === "competitive_debrief" ? "Ask follow-ups about the competitive analysis…"
                  : activeMode === "concept_planner" ? "Refine concepts or ask for variations…"
                  : "Ask about your creative performance…"
                }
                rows={1}
                className="flex-1 resize-none border-0 shadow-none focus-visible:ring-0 p-0 font-body text-[13px] text-foreground placeholder:text-muted-foreground min-h-[24px] max-h-32"
              />
              <Button
                onClick={() => sendMessage(input)}
                disabled={!input.trim() || isLoading}
                size="sm"
                className="h-8 w-8 p-0 rounded-lg shrink-0"
              >
                <Send className="h-4 w-4" />
              </Button>
            </div>
            <p className="font-body text-[11px] text-muted-foreground text-center mt-2">
              Enter to send · Shift+Enter for new line
            </p>
          </div>
        </div>
      </div>

      {/* Mode switch confirmation */}
      <AlertDialog open={!!pendingMode} onOpenChange={() => setPendingMode(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Switch analysis mode?</AlertDialogTitle>
            <AlertDialogDescription>
              Switching modes will clear your current conversation. This can't be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={confirmModeSwitch}>Switch Mode</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </AppLayout>
  );
}
