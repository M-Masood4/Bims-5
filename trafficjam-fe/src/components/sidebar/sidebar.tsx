import { useState, useRef, useCallback } from "react";
import * as ScrollArea from "@radix-ui/react-scroll-area";
import {
  CheckCircle2,
  XCircle,
  Loader2,
  Plus,
  Settings2,
  Trash2,
  RotateCcw,
  Pencil,
  Play,
  GitCompare,
  Download,
  Map,
  BarChart2,
  Users,
  FileText,
  MapPin,
  ChevronRight,
} from "lucide-react";
import styles from "./sidebar.module.css";
import type { Scenario, Run } from "@/types";

function relativeTime(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

interface SidebarProps {
  scenarios: Scenario[];
  activeScenarioId: string | null;
  isLoadingScenarios?: boolean;
  onSelectScenario: (id: string) => void;
  onPrefetchScenario: (id: string) => void;
  onCreateScenario: () => void;
  onOpenAgentConfig: (scenarioId: string) => void;
  onDeleteScenario: (scenarioId: string) => void;
  onRenameScenario: (id: string, newName: string) => void;
  runs: Run[];
  onSelectRun: (run: Run) => void;
  onRerunRun: (run: Run) => void;
  onRunSimulationClick?: () => void;
  onCompareBranches?: () => void;
}

function InlineRenameInput({
  defaultName,
  onConfirm,
  onCancel,
}: {
  defaultName: string;
  onConfirm: (name: string) => void;
  onCancel: () => void;
}) {
  const [value, setValue] = useState(defaultName);
  const inputRef = useRef<HTMLInputElement>(null);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "Enter") onConfirm(value.trim() || defaultName);
      if (e.key === "Escape") onCancel();
    },
    [value, defaultName, onConfirm, onCancel],
  );

  return (
    <input
      ref={inputRef}
      className={styles.renameInput}
      value={value}
      onChange={(e) => setValue(e.target.value)}
      onKeyDown={handleKeyDown}
      onBlur={() => onConfirm(value.trim() || defaultName)}
      autoFocus
      onClick={(e) => e.stopPropagation()}
    />
  );
}

function ScenarioActions({
  isActive,
  onEdit,
  onConfigure,
  onDelete,
}: {
  isActive: boolean;
  onEdit: () => void;
  onConfigure: () => void;
  onDelete: () => void;
}) {
  if (!isActive) return null;
  return (
    <div className={styles.scenarioActions}>
      <button
        className={styles.iconBtn}
        onClick={(e) => { e.stopPropagation(); onEdit(); }}
        title="Rename"
      >
        <Pencil size={14} />
      </button>
      <button
        className={styles.iconBtn}
        onClick={(e) => { e.stopPropagation(); onConfigure(); }}
        title="Configure Agent Planner"
      >
        <Settings2 size={14} />
      </button>
      <button
        className={`${styles.iconBtn} ${styles.deleteBtnIcon}`}
        onClick={(e) => { e.stopPropagation(); onDelete(); }}
        title="Delete Scenario"
      >
        <Trash2 size={14} />
      </button>
    </div>
  );
}

function RunStatusDot({ status }: { status: string }) {
  if (status === "pending") return <span className={`${styles.statusDot} ${styles.dotPending}`} />;
  if (status === "running") return <Loader2 size={13} className={styles.spinnerIcon} />;
  if (status === "completed") return <CheckCircle2 size={13} className={styles.dotCompleted} />;
  if (status === "failed") return <XCircle size={13} className={styles.dotFailed} />;
  return null;
}

function exportResults(runs: Run[], scenarios: Scenario[], activeScenarioId: string | null) {
  const scenario = scenarios.find((s) => s.id === activeScenarioId);
  const activeRuns = runs.filter(
    (r) => r.scenarioId === activeScenarioId && r.status === "completed",
  );
  const payload = {
    exportedAt: new Date().toISOString(),
    scenario: scenario
      ? { id: scenario.id, name: scenario.name, agentConfig: scenario.agentConfig }
      : null,
    runs: activeRuns.map(({ id, note, iterations, randomSeed, status, createdAt, completedAt }) => ({
      id, note, iterations, randomSeed, status, createdAt, completedAt,
    })),
  };
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `${scenario?.name ?? "results"}-export.json`;
  a.click();
  URL.revokeObjectURL(url);
}

export function Sidebar({
  scenarios,
  activeScenarioId,
  isLoadingScenarios,
  onSelectScenario,
  onPrefetchScenario,
  onCreateScenario,
  onOpenAgentConfig,
  onDeleteScenario,
  onRenameScenario,
  runs,
  onSelectRun,
  onRerunRun,
  onRunSimulationClick,
  onCompareBranches,
}: SidebarProps) {
  const [editingId, setEditingId] = useState<string | null>(null);
  const activeScenario = scenarios.find((s) => s.id === activeScenarioId);
  const activeRuns = runs.filter((r) => r.scenarioId === activeScenarioId);

  const handleRenameConfirm = useCallback(
    (id: string, newName: string) => {
      onRenameScenario(id, newName);
      setEditingId(null);
    },
    [onRenameScenario],
  );

  const completedRunCount = runs.filter((r) => r.status === "completed").length;
  const hasExportableRuns = activeRuns.some((r) => r.status === "completed");

  return (
    <aside className={styles.sidebar}>
      <header className={styles.header}>
        <div className={styles.brand}>
          <span className={styles.brandMark} />
          <div>
            <div className={styles.brandName}>BIMS 5</div>
            <div className={styles.brandSub}>Urban Intelligence Lab</div>
          </div>
        </div>
        <button className={styles.newBtn} onClick={onCreateScenario} title="New Scenario">
          <Plus size={16} />
          <span>New</span>
        </button>
      </header>

      <ScrollArea.Root className={styles.scrollRoot}>
        <ScrollArea.Viewport className={styles.scrollViewport}>

          <section className={styles.section}>
            <div className={styles.sectionHeader}>
              <span className={styles.sectionLabel}>Scenarios</span>
              {scenarios.length > 0 && (
                <span className={styles.sectionCount}>{scenarios.length}</span>
              )}
            </div>

            {isLoadingScenarios ? (
              <div className={styles.loadingContainer}>
                <Loader2 size={20} className={styles.spinnerIcon} />
              </div>
            ) : scenarios.length === 0 ? (
              <div className={styles.emptyState}>
                <MapPin size={28} className={styles.emptyIcon} />
                <div className={styles.emptyTitle}>No scenarios yet</div>
                <div className={styles.emptyHint}>Click New to create your first scenario</div>
              </div>
            ) : (
              <ul className={styles.list}>
                {scenarios.map((s) => (
                  <li
                    key={s.id}
                    className={`${styles.scenarioItem} ${s.id === activeScenarioId ? styles.scenarioItemActive : ""}`}
                    onClick={() => onSelectScenario(s.id)}
                    onMouseEnter={() => onPrefetchScenario(s.id)}
                  >
                    <span className={`${styles.scenarioPin} ${s.id === activeScenarioId ? styles.scenarioPinActive : ""}`}>
                      <MapPin size={14} />
                    </span>
                    {editingId === s.id ? (
                      <InlineRenameInput
                        defaultName={s.name}
                        onConfirm={(name) => handleRenameConfirm(s.id, name)}
                        onCancel={() => setEditingId(null)}
                      />
                    ) : (
                      <span className={styles.scenarioName}>{s.name}</span>
                    )}
                    <ScenarioActions
                      isActive={s.id === activeScenarioId}
                      onEdit={() => setEditingId(s.id)}
                      onConfigure={() => onOpenAgentConfig(s.id)}
                      onDelete={() => onDeleteScenario(s.id)}
                    />
                    {s.id !== activeScenarioId && editingId !== s.id && (
                      <ChevronRight size={14} className={styles.scenarioChevron} />
                    )}
                  </li>
                ))}
              </ul>
            )}
          </section>

          {activeScenario && (
            <section className={styles.section}>
              <div className={styles.sectionHeader}>
                <span className={styles.sectionLabel}>Run History</span>
                {activeRuns.length > 0 && (
                  <span className={styles.sectionCount}>{activeRuns.length}</span>
                )}
              </div>
              <ul className={styles.list}>
                {activeRuns.length === 0 ? (
                  <li className={styles.emptyMsg}>No runs yet for this scenario</li>
                ) : (
                  activeRuns.map((r) => (
                    <li
                      key={r.id}
                      className={`${styles.runItem} ${styles[`runItem_${r.status}`] ?? ""}`}
                      onClick={() => onSelectRun(r)}
                    >
                      <div className={styles.runStatusCol}>
                        <RunStatusDot status={r.status} />
                      </div>
                      <div className={styles.runInfo}>
                        <div className={styles.runNote}>
                          {r.note || `Run ${r.id.slice(0, 6)}`}
                        </div>
                        <div className={styles.runMeta}>
                          {r.iterations} iterations · {relativeTime(r.createdAt)}
                        </div>
                      </div>
                      {(r.status === "completed" || r.status === "failed") && (
                        <button
                          className={styles.rerunBtn}
                          onClick={(e) => { e.stopPropagation(); onRerunRun(r); }}
                          title="Re-run with same settings"
                        >
                          <RotateCcw size={13} />
                        </button>
                      )}
                    </li>
                  ))
                )}
              </ul>
            </section>
          )}

        </ScrollArea.Viewport>
        <ScrollArea.Scrollbar className={styles.scrollbar} orientation="vertical">
          <ScrollArea.Thumb className={styles.scrollThumb} />
        </ScrollArea.Scrollbar>
      </ScrollArea.Root>

      <div className={styles.simTools}>
        <div className={styles.sectionHeader}>
          <span className={styles.sectionLabel}>Simulation Tools</span>
        </div>
        <div className={styles.simToolGroup}>
          <button
            className={styles.btnPrimary}
            onClick={onRunSimulationClick}
            disabled={!activeScenarioId || !onRunSimulationClick}
            title="Run simulation for active scenario"
          >
            <Play size={15} />
            Run Simulation
          </button>
          <button
            className={styles.btnSecondary}
            onClick={onCompareBranches}
            disabled={completedRunCount < 2 || !onCompareBranches}
            title={completedRunCount < 2 ? "Need at least 2 completed runs" : "Compare two scenario runs"}
          >
            <GitCompare size={15} />
            Compare Branches
          </button>
          <button
            className={styles.btnText}
            onClick={() => exportResults(runs, scenarios, activeScenarioId)}
            disabled={!hasExportableRuns}
            title={hasExportableRuns ? "Export results as JSON" : "No completed runs to export"}
          >
            <Download size={14} />
            Export Results
          </button>
        </div>
      </div>

      <footer className={styles.footer}>
        <nav className={styles.footerNav}>
          <button className={`${styles.navTab} ${styles.navTabActive}`}>
            <Map size={18} />
            <span>Explorer</span>
          </button>
          <button className={styles.navTab} disabled>
            <BarChart2 size={18} />
            <span>Analytics</span>
          </button>
          <button className={styles.navTab} disabled>
            <Users size={18} />
            <span>Insights</span>
          </button>
          <button className={styles.navTab} disabled>
            <FileText size={18} />
            <span>Reports</span>
          </button>
        </nav>
        <div className={styles.projectInfo}>
          <div className={styles.projectInfoRow}>
            <span className={styles.projectInfoName}>Urban Intelligence Lab</span>
          </div>
          <p className={styles.projectInfoDesc}>
            Building and Infrastructure Management Simulator — urban planning and traffic flow analysis.
          </p>
        </div>
      </footer>
    </aside>
  );
}
