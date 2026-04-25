import { useState } from "react";
import { GitCompare, ExternalLink } from "lucide-react";
import styles from "./compare-dialog.module.css";
import { Dialog } from "@/components";
import type { Run, Scenario } from "@/types";

interface CompareDialogProps {
  runs: Run[];
  scenarios: Scenario[];
  onViewRun: (run: Run) => void;
  onClose: () => void;
}

function relativeTime(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

function RunColumn({
  label,
  options,
  scenarios,
  selected,
  onSelect,
  onView,
}: {
  label: string;
  options: Run[];
  scenarios: Scenario[];
  selected: Run | null;
  onSelect: (run: Run) => void;
  onView: (run: Run) => void;
}) {
  const scenarioName = selected
    ? (scenarios.find((s) => s.id === selected.scenarioId)?.name ?? "—")
    : null;

  return (
    <div className={styles.column}>
      <div className={styles.columnLabel}>{label}</div>
      <select
        className={styles.select}
        value={selected?.id ?? ""}
        onChange={(e) => {
          const run = options.find((r) => r.id === e.target.value);
          if (run) onSelect(run);
        }}
      >
        <option value="">Choose a run…</option>
        {options.map((run) => {
          const sc = scenarios.find((s) => s.id === run.scenarioId);
          return (
            <option key={run.id} value={run.id}>
              {run.note ?? `Run ${run.id.slice(0, 4)}`} — {sc?.name ?? "?"}
            </option>
          );
        })}
      </select>
      {selected && (
        <div className={styles.card}>
          <div className={styles.cardRow}>
            <span className={styles.cardKey}>Scenario</span>
            <span className={styles.cardVal}>{scenarioName}</span>
          </div>
          <div className={styles.cardRow}>
            <span className={styles.cardKey}>Iterations</span>
            <span className={styles.cardVal}>{selected.iterations}</span>
          </div>
          <div className={styles.cardRow}>
            <span className={styles.cardKey}>Seed</span>
            <span className={styles.cardVal}>
              {selected.randomSeed != null ? selected.randomSeed : "Random"}
            </span>
          </div>
          <div className={styles.cardRow}>
            <span className={styles.cardKey}>Created</span>
            <span className={styles.cardVal}>{relativeTime(selected.createdAt)}</span>
          </div>
          {selected.note && (
            <div className={styles.cardRow}>
              <span className={styles.cardKey}>Note</span>
              <span className={styles.cardVal}>{selected.note}</span>
            </div>
          )}
          <button className={styles.viewBtn} onClick={() => onView(selected)}>
            <ExternalLink size={13} />
            Open in Visualizer
          </button>
        </div>
      )}
    </div>
  );
}

export function CompareDialog({ runs, scenarios, onViewRun, onClose }: CompareDialogProps) {
  const completedRuns = runs.filter((r) => r.status === "completed");
  const [runA, setRunA] = useState<Run | null>(null);
  const [runB, setRunB] = useState<Run | null>(null);

  return (
    <Dialog
      title={
        <span className={styles.titleRow}>
          <GitCompare size={16} />
          Compare Branches
        </span>
      }
      onClose={onClose}
      maxWidth={580}
      footer={
        <button className={styles.closeBtn} onClick={onClose}>
          Close
        </button>
      }
    >
      {completedRuns.length < 2 ? (
        <p className={styles.empty}>
          At least two completed runs are needed to compare branches.
        </p>
      ) : (
        <div className={styles.grid}>
          <RunColumn
            label="Branch A"
            options={completedRuns.filter((r) => r.id !== runB?.id)}
            scenarios={scenarios}
            selected={runA}
            onSelect={setRunA}
            onView={(r) => { onViewRun(r); onClose(); }}
          />
          <div className={styles.divider} />
          <RunColumn
            label="Branch B"
            options={completedRuns.filter((r) => r.id !== runA?.id)}
            scenarios={scenarios}
            selected={runB}
            onSelect={setRunB}
            onView={(r) => { onViewRun(r); onClose(); }}
          />
        </div>
      )}
    </Dialog>
  );
}
