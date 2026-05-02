import { Run, CumulativeMetrics } from "./types";

const MS_PER_DAY = 24 * 60 * 60 * 1000;

export const calculateTotalCost = (runs: Run[]): number => {
  if (!Array.isArray(runs) || runs.length === 0) return 0;

  return runs.reduce((total, run) => {
    // Only include non-cache costs as per approved approach
    return total + run.cost;
  }, 0);
};

export const calculateCumulativeMetrics = (runs: Run[]): CumulativeMetrics => {
  const totalCost = calculateTotalCost(runs);
  const now = Date.now();

  const last7DaysRuns = runs.filter(
    (run) => (now - run.timestamp) / MS_PER_DAY <= 7
  );
  const last30DaysRuns = runs.filter(
    (run) => (now - run.timestamp) / MS_PER_DAY <= 30
  );

  const avg7Day = last7DaysRuns.length
    ? calculateTotalCost(last7DaysRuns) / 7
    : 0;

  const avg30Day = last30DaysRuns.length
    ? calculateTotalCost(last30DaysRuns) / 30
    : 0;

  return {
    totalCost,
    avg7Day,
    avg30Day,
  };
};