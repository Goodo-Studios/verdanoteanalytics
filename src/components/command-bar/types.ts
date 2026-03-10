import { type Grade } from "@/lib/creativeGrading";

export interface SearchResult {
  id: string;
  category: "creatives" | "concepts" | "reports" | "briefs" | "creators" | "tests";
  title: string;
  subtitle?: string;
  meta?: string;
  thumbnail?: string | null;
  grade?: Grade;
  roas?: number;
  navigateTo: string;
  searchParams?: Record<string, string>;
}

export interface GroupedResults {
  category: string;
  label: string;
  icon: React.ReactNode;
  results: SearchResult[];
  total: number;
}

export interface CommandItem {
  id: string;
  label: string;
  icon: React.ReactNode;
  subtitle?: string;
  action: () => void;
  group: "recent" | "actions";
}

export interface SlashCommand {
  command: string;
  label: string;
  description: string;
  icon: React.ReactNode;
  execute: (args: string) => void;
}

export interface RecentItem {
  id: string;
  label: string;
  category: string;
  navigateTo: string;
  timestamp: number;
}
