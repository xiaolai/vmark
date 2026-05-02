export interface Run {
  id: string;
  workflow: string;
  runNumber: number;
  durationMs: number;
  turns: number;
  inputTokens: number;
  outputTokens: number;
  cacheCreated: number;
  cacheRead: number;
  cost: number;
  timestamp: number;
}

export interface CumulativeMetrics {
  totalCost: number;
  avg7Day: number;
  avg30Day: number;
}