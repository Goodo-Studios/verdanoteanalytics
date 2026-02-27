interface Message {
  role: "user" | "assistant";
  content: string;
}

export function exportChatAsMarkdown(messages: Message[]) {
  const date = new Date().toLocaleDateString("en-US", {
    year: "numeric",
    month: "long",
    day: "numeric",
  });

  const lines = [`# Verdanote AI Analysis — ${date}\n`];

  for (const msg of messages) {
    const heading = msg.role === "user" ? "## User" : "## Analyst";
    lines.push(`${heading}\n\n${msg.content}\n`);
  }

  const blob = new Blob([lines.join("\n")], { type: "text/markdown" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `verdanote-analysis-${new Date().toISOString().slice(0, 10)}.md`;
  a.click();
  URL.revokeObjectURL(url);
}
