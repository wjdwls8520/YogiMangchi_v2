import { invalidContract } from "./contracts";

export function marginMode(value: unknown): "ISOLATED" | "LEGACY_CROSS" {
  if (value !== "ISOLATED" && value !== "LEGACY_CROSS") return invalidContract();
  return value;
}
export function transitionStatus(value: unknown): "COMPLETE" | "PENDING" | "REVIEW_REQUIRED" {
  if (value !== "COMPLETE" && value !== "PENDING" && value !== "REVIEW_REQUIRED") return invalidContract();
  return value;
}
export function isolatedReady(value: { marginMode: string; marginTransitionStatus: string } | null | undefined) {
  return value?.marginMode === "ISOLATED" && value.marginTransitionStatus === "COMPLETE";
}
