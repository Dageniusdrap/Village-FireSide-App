import { create } from "zustand";

import { readSettings, writeSettings } from "@/lib/settings";

type SettingsState = {
  wifiOnlyDownloads: boolean;
  setWifiOnlyDownloads: (value: boolean) => void;
};

export const useSettingsStore = create<SettingsState>((set) => ({
  ...readSettings(),
  setWifiOnlyDownloads: (value) => {
    writeSettings({ wifiOnlyDownloads: value });
    set({ wifiOnlyDownloads: value });
  },
}));
