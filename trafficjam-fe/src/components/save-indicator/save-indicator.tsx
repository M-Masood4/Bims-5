import styles from "./save-indicator.module.css";

interface SaveIndicatorProps {
  isDirty: boolean;
  isSaving: boolean;
  showSaved: boolean;
  onSave?: () => Promise<void> | void;
}

const isMac = navigator.platform.toUpperCase().includes("MAC");
const modKey = isMac ? "\u2318" : "Ctrl";

export function SaveIndicator({
  isDirty,
  isSaving,
  showSaved,
  onSave,
}: SaveIndicatorProps) {
  if (isSaving) return <SavingState />;
  if (showSaved) return <SavedState />;
  if (isDirty) return <DirtyState onSave={onSave} />;
  return null;
}

function SavingState() {
  return (
    <div className={`${styles.wrapper} ${styles.saving}`}>
      <div className={styles.spinner} />
      Saving…
    </div>
  );
}

function SavedState() {
  return (
    <div className={`${styles.wrapper} ${styles.saved}`}>
      Saved
    </div>
  );
}

function DirtyState({ onSave }: { onSave?: () => Promise<void> | void }) {
  return (
    <div className={`${styles.wrapper} ${styles.dirty}`}>
      Unsaved changes
      <kbd className={styles.kbd}>{modKey}+S</kbd>
      {onSave && (
        <button
          className={styles.saveButton}
          type="button"
          onClick={() => {
            void onSave();
          }}
        >
          Save now
        </button>
      )}
    </div>
  );
}
