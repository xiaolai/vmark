import { useState, useEffect } from "react";
import { calculateTotalCost, calculateCumulativeMetrics } from "./statusBarUtils";
import { Run, CumulativeMetrics } from "./types";

const ZERO_COST_RUNS = 0;

const StatusBar = () => {
  const [runs, setRuns] = useState<Run[]>([]);
  const [cumulativeMetrics, setCumulativeMetrics] = useState<CumulativeMetrics>({
    totalCost: ZERO_COST_RUNS,
    avg7Day: ZERO_COST_RUNS,
    avg30Day: ZERO_COST_RUNS,
  });

  useEffect(() => {
    // Simulate fetching runs data
    const fetchRuns = async () => {
      // In a real app, this would be an API call
      const mockRuns: Run[] = [
        {
          id: "run-1",
          workflow: "claude-audit",
          runNumber: 25248950703,
          durationMs: 552000,
          turns: 81,
          inputTokens: 0,
          outputTokens: 0,
          cacheCreated: 0,
          cacheRead: 0,
          cost: 6.56,
          timestamp: new Date("2026-05-02T10:00:00Z").getTime(),
        },
      ];
      setRuns(mockRuns);
      setCumulativeMetrics(calculateCumulativeMetrics(mockRuns));
    };

    fetchRuns();
  }, []);

  return (
    <div className="status-bar">
      <div className="status-item">
        <span className="label">Total Cost</span>
        <span className="value">${cumulativeMetrics.totalCost.toFixed(2)}</span>
      </div>
      <div className="status-item">
        <span className="label">7-day avg</span>
        <span className="value">${cumulativeMetrics.avg7Day.toFixed(2)}</span>
      </div>
      <div className="status-item">
        <span className="label">30-day avg</span>
        <span className="value">${cumulativeMetrics.avg30Day.toFixed(2)}</span>
      </div>
    </div>
  );
};

export { StatusBar };