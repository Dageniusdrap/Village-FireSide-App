import { create } from "zustand";

import { MAX_HISTORY, readSearchHistory, writeSearchHistory } from "@/lib/search-history";

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
    const next = [trimmed, ...get().queries.filter((q) => q !== trimmed)].slice(0, MAX_HISTORY);
    writeSearchHistory(next);
    set({ queries: next });
  },
  clearHistory: () => {
    writeSearchHistory([]);
    set({ queries: [] });
  },
}));
