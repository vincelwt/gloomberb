
export type EconImpact = "high" | "medium" | "low";

export interface EconEvent {
  id: string;
  date: Date;
  time: string; // "08:30" or "All Day"
  country: string; // "US", "GB", etc.
  event: string;
  actual: string | null;
  forecast: string | null;
  prior: string | null;
  impact: EconImpact;
}
