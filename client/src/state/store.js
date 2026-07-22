import { create } from "zustand";

// Shared filter state for the Dashboard (and future workspaces).
export const useFilters = create((set) => ({
  metric: "total_cases", // 'total_cases' | 'crimes_per_100k'
  selectedDistrict: null, // parent district name (e.g. "Mysuru")
  setMetric: (metric) => set({ metric }),
  selectDistrict: (selectedDistrict) => set({ selectedDistrict }),
}));
