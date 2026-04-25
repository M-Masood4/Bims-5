import json
import unittest
from pathlib import Path


REPO_ROOT = Path(__file__).resolve().parents[1]
MODE_A = REPO_ROOT / "web" / "data" / "mode-a"
METRICS = [
    "traffic",
    "population",
    "jobs",
    "economy",
    "housingPressure",
    "services",
    "electricity",
    "environmentAir",
    "greenScore",
    "fairness",
    "fiscalBalance",
    "planningViability",
]


class ForecastArtifactTests(unittest.TestCase):
    def test_forecast_artifacts_cover_2026_to_2036(self) -> None:
        model = json.loads((MODE_A / "forecast_model.json").read_text(encoding="utf-8"))
        baseline = json.loads((MODE_A / "baseline_2025_forecast.json").read_text(encoding="utf-8"))

        self.assertEqual(model["kind"], "belfast.forecastModel")
        self.assertEqual(model["baselineYear"], 2025)
        self.assertEqual(model["metrics"], METRICS)
        self.assertEqual(baseline["kind"], "belfast.baseline2025Forecast")
        self.assertEqual(baseline["years"], list(range(2026, 2037)))
        self.assertGreaterEqual(len(baseline["cells"]), 100)

    def test_forecast_values_are_normalized(self) -> None:
        baseline = json.loads((MODE_A / "baseline_2025_forecast.json").read_text(encoding="utf-8"))
        for year in baseline["years"]:
            summary = baseline["summaryByYear"][str(year)]
            for metric in METRICS:
                self.assertGreaterEqual(summary[metric], 0, f"{year} {metric}")
                self.assertLessEqual(summary[metric], 1, f"{year} {metric}")

        for cell in baseline["cells"][:25]:
            for year in baseline["years"]:
                row = cell["forecastByYear"][str(year)]
                for metric in METRICS:
                    self.assertGreaterEqual(row[metric], 0, f"{cell['cellId']} {year} {metric}")
                    self.assertLessEqual(row[metric], 1, f"{cell['cellId']} {year} {metric}")


if __name__ == "__main__":
    unittest.main()
