import {
  MousePointer2,
  Route,
  Building2,
  Zap,
  Bus,
  Scissors,
  Undo2,
  Upload,
  Layers,
  Trash2,
} from "lucide-react";
import styles from "./map-toolbar.module.css";
import type { EditorTool } from "../editor-tool";

const PRIMARY_TOOLS: {
  id: EditorTool;
  icon: React.ReactNode;
  label: string;
}[] = [
  { id: "select", icon: <MousePointer2 size={18} />, label: "Select" },
  { id: "roads", icon: <Route size={18} />, label: "Add Roads" },
  { id: "buildings", icon: <Building2 size={18} />, label: "Buildings" },
  { id: "electricity", icon: <Zap size={18} />, label: "Electricity" },
  { id: "transport", icon: <Bus size={18} />, label: "Transport" },
  { id: "demolish", icon: <Scissors size={18} />, label: "Demolish" },
];

interface MapToolbarProps {
  activeTool: EditorTool;
  onSelectTool: (tool: EditorTool) => void;
  onUndo: () => void;
  canUndo: boolean;
  onExport: () => void;
  onClear: () => void;
  showBuildings: boolean;
  onToggleBuildings: () => void;
}

export function MapToolbar({
  activeTool,
  onSelectTool,
  onUndo,
  canUndo,
  onExport,
  onClear,
  showBuildings,
  onToggleBuildings,
}: MapToolbarProps) {
  return (
    <div className={styles.toolbar}>
      <div className={styles.group}>
        {PRIMARY_TOOLS.map(({ id, icon, label }) => (
          <button
            key={id}
            className={`${styles.btn} ${activeTool === id ? styles.active : ""}`}
            onClick={() => onSelectTool(id)}
            title={label}
          >
            <span className={styles.icon}>{icon}</span>
            <span className={styles.label}>{label}</span>
          </button>
        ))}
      </div>

      <div className={styles.sep} />

      <div className={styles.group}>
        <button
          className={`${styles.btn} ${showBuildings ? styles.activeUtil : ""}`}
          onClick={onToggleBuildings}
          title={showBuildings ? "Hide buildings" : "Show buildings"}
        >
          <span className={styles.icon}><Layers size={18} /></span>
          <span className={styles.label}>Layers</span>
        </button>
        <button
          className={styles.btn}
          onClick={onUndo}
          disabled={!canUndo}
          title="Undo (Ctrl+Z)"
        >
          <span className={styles.icon}><Undo2 size={18} /></span>
          <span className={styles.label}>Undo</span>
        </button>
        <button
          className={styles.btn}
          onClick={onExport}
          title="Export network"
        >
          <span className={styles.icon}><Upload size={18} /></span>
          <span className={styles.label}>Export</span>
        </button>
        <button
          className={`${styles.btn} ${styles.danger}`}
          onClick={onClear}
          title="Clear entire network"
        >
          <span className={styles.icon}><Trash2 size={18} /></span>
          <span className={styles.label}>Clear all</span>
        </button>
      </div>
    </div>
  );
}
