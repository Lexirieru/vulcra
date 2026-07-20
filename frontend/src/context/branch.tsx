"use client";

// Selected collateral branch, shared app-wide and persisted to localStorage.
// Read through useSyncExternalStore so SSR and the first client render both use
// DEFAULT_BRANCH (no hydration mismatch) and no setState-in-effect is needed.
import {
  createContext,
  useContext,
  useMemo,
  useSyncExternalStore,
  type ReactNode,
} from "react";
import {
  BRANCHES,
  DEFAULT_BRANCH,
  isBranchKey,
  type BranchKey,
  type CollateralBranch,
} from "@/config/branches";

const STORAGE_KEY = "vulcra.branch";
const CHANGE_EVENT = "vulcra:branch-change";

function subscribe(callback: () => void) {
  window.addEventListener("storage", callback);
  window.addEventListener(CHANGE_EVENT, callback);
  return () => {
    window.removeEventListener("storage", callback);
    window.removeEventListener(CHANGE_EVENT, callback);
  };
}

function getSnapshot(): BranchKey {
  const stored = window.localStorage.getItem(STORAGE_KEY);
  return isBranchKey(stored) ? stored : DEFAULT_BRANCH;
}

function getServerSnapshot(): BranchKey {
  return DEFAULT_BRANCH;
}

function persistBranch(key: BranchKey) {
  window.localStorage.setItem(STORAGE_KEY, key);
  window.dispatchEvent(new Event(CHANGE_EVENT));
}

interface BranchContextValue {
  branchKey: BranchKey;
  branch: CollateralBranch;
  setBranchKey: (key: BranchKey) => void;
}

const BranchContext = createContext<BranchContextValue | null>(null);

export function BranchProvider({ children }: { children: ReactNode }) {
  const branchKey = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);

  const value = useMemo<BranchContextValue>(
    () => ({ branchKey, branch: BRANCHES[branchKey], setBranchKey: persistBranch }),
    [branchKey],
  );

  return <BranchContext.Provider value={value}>{children}</BranchContext.Provider>;
}

export function useBranch(): BranchContextValue {
  const ctx = useContext(BranchContext);
  if (!ctx) throw new Error("useBranch must be used within BranchProvider");
  return ctx;
}
