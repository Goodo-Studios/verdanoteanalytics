import { useState, useRef, useEffect, useCallback } from "react";
import { AppLayout } from "@/components/AppLayout";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Send, Bot, User, Loader2, Sparkles, Download } from "lucide-react";
import { useAccountContext } from "@/contexts/AccountContext";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import ReactMarkdown from "react-markdown";
import { ChatHistorySidebar } from "@/components/ai-chat/ChatHistorySidebar";
import { ChatEmptyState } from "@/components/ai-chat/ChatEmptyState";
import { useAIChatHistory } from "@/hooks/useAIChatHistory";
import { exportChatAsMarkdown } from "@/lib/exportChat";

interface Message {
  role: "user" | "assistant";
  content: string;
}

export default function AIChatPage() {
  const { selectedAccountId } = useAccountContext();
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [conversationId, setConversationId] = useState<string | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const { data: history = [], invalidate: refreshHistory } = useAIChatHistory();

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, isLoading]);

  const loadConversation = useCallback(async (id: string) => {
    const { data, error } = await supabase
      .from("ai_conversations")
      .select("messages")
      .eq("id", id)
      .single();
    if (error || !data) { toast.error("Could not load conversation"); return; }
    setConversationId(id);
    setMessages((data.messages as any as Message[]) || []);
    setInput("");
  }, []);

  const handleNewChat = useCallback(() => {
    setMessages([]);
    setConversationId(null);
    setInput("");
    textareaRef.current?.focus();
  }, []);

  const sendMessage = async (text: string) => {
    const trimmed = text.trim();
    if (!trimmed || isLoading) return;

    const userMsg: Message = { role: "user", content: trimmed };
    setMessages(prev => [...prev, userMsg]);
    setInput("");
    setIsLoading(true);

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
          {/* Header */}
          <div className="flex items-center justify-between px-6 py-3 border-b border-border shrink-0">
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

          {/* Messages */}
          <div className="flex-1 overflow-y-auto px-6 py-4 space-y-4 min-h-0">
            {messages.length === 0 ? (
              <ChatEmptyState onSend={sendMessage} />
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
                placeholder="Ask about your creative performance…"
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
    </AppLayout>
  );
}
