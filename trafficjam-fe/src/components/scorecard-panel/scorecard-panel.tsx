import { useCallback, useState } from "react";
import { api } from "@/api";
import type { Scorecard } from "@/types";
import styles from "./scorecard-panel.module.css";

interface ScorecardPanelProps {
  scenarioId: string;
  runId: string;
}

const GRADE_COLORS: Record<string, string> = {
  A: "#0d904f",
  B: "#34a853",
  C: "#ea8600",
  D: "#e8710a",
  E: "#d93025",
  F: "#a50e0e",
};

function GradeCircle({ grade, score }: { grade: string; score: number }) {
  const color = GRADE_COLORS[grade] ?? "#5f6368";
  return (
    <div className={styles.gradeCircle} style={{ borderColor: color }}>
      <span className={styles.gradeLetter} style={{ color }}>{grade}</span>
      <span className={styles.gradeScore}>{Math.round(score)}</span>
    </div>
  );
}

export function ScorecardPanel({ scenarioId, runId }: ScorecardPanelProps) {
  const [scorecard, setScorecard] = useState<Scorecard | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchScorecard = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await api.fetchScorecard(scenarioId, runId);
      setScorecard(data);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load scorecard");
    } finally {
      setLoading(false);
    }
  }, [scenarioId, runId]);

  if (!scorecard && !loading && !error) {
    return (
      <div className={styles.container}>
        <button className={styles.fetchButton} onClick={fetchScorecard}>
          📊 View 2036 Scorecard
        </button>
      </div>
    );
  }

  if (loading) {
    return (
      <div className={styles.container}>
        <div className={styles.loading}>
          <div className={styles.spinner} />
          Analyzing against Belfast Agenda...
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className={styles.container}>
        <div className={styles.error}>{error}</div>
        <button className={styles.retryButton} onClick={fetchScorecard}>
          Retry
        </button>
      </div>
    );
  }

  if (!scorecard) return null;

  return (
    <div className={styles.container}>
      <div className={styles.header}>
        <h3 className={styles.title}>2036 Policy Scorecard</h3>
        <GradeCircle grade={scorecard.overall_grade} score={
          scorecard.grades.reduce((sum, g) => sum + g.score, 0) / scorecard.grades.length
        } />
      </div>

      <div className={styles.grades}>
        {scorecard.grades.map((g) => (
          <div key={g.category} className={styles.gradeRow}>
            <div className={styles.gradeInfo}>
              <span className={styles.gradeCategory}>{g.category}</span>
              <span className={styles.gradeTarget}>{g.target}</span>
            </div>
            <GradeCircle grade={g.grade} score={g.score} />
            <p className={styles.gradeFinding}>{g.finding}</p>
          </div>
        ))}
      </div>

      {scorecard.actionable_advice.length > 0 && (
        <div className={styles.adviceSection}>
          <h4 className={styles.adviceTitle}>💡 Recommendations</h4>
          <ul className={styles.adviceList}>
            {scorecard.actionable_advice.map((a, i) => (
              <li key={i} className={styles.adviceItem}>{a}</li>
            ))}
          </ul>
        </div>
      )}

      {scorecard.future_layer_suggestions.length > 0 && (
        <div className={styles.suggestionsSection}>
          <h4 className={styles.adviceTitle}>🏗️ Suggested Infrastructure</h4>
          {scorecard.future_layer_suggestions.map((s, i) => (
            <div key={i} className={styles.suggestion}>
              <strong>{s.name}</strong> — {s.area}
              <span className={styles.suggestionType}>{s.type}</span>
              <p className={styles.suggestionRationale}>{s.rationale}</p>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
