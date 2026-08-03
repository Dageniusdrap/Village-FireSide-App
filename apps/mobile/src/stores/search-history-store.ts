import { create } from "zustand";

import { readSearchHistory, writeSearchHistory } from "@/lib/search-history";

type SearchHistoryState = {
  queries: string[];
  addQuery: (query: string) => void;
  clearHistory: () => void;
};

export const useSearchHistoryStore = create<SearchHistoryState>((set, get) => ({
  queries: readSearchHistory(),
  addQuery: (query) => {
    const trimmed = query.trim();
    if (trimmed.length === 0) {
      return;
    }
    const next = [trimmed, ...get().queries.filter((q) => q !== trimmed)];
    writeSearchHistory(next);
    set({ queries: next });
  },
  clearHistory: () => {
    writeSearchHistory([]);
    set({ queries: [] });
  },
}));
