import csv
import json
import math
import unittest
from pathlib import Path


REPO_ROOT = Path(__file__).resolve().parents[1]
MODE_A = REPO_ROOT / "web" / "data" / "mode-a"
DERIVED = REPO_ROOT / "data" / "derived" / "2026"
FORECAST_YEARS = list(range(2026, 2037))


class TransformerModelArtifactTests(unittest.TestCase):
    def test_transformer_artifacts_exist_and_cover_horizon(self) -> None:
        model = json.loads((MODE_A / "transformer_impact_model.json").read_text(encoding="utf-8"))
        capacity = json.loads((MODE_A / "transformer_capacity_forecast.json").read_text(encoding="utf-8"))
        by_cell = json.loads((MODE_A / "transformer_capacity_by_cell.json").read_text(encoding="utf-8"))
        assets = json.loads((DERIVED / "belfast_ni_transformers_official.geojson").read_text(encoding="utf-8"))

        self.assertEqual(model["kind"], "belfast.transformerImpactModel")
        self.assertEqual(capacity["kind"], "belfast.transformerCapacityForecast")
        self.assertEqual(by_cell["kind"], "belfast.transformerCapacityByCell")
        self.assertEqual(capacity["years"], FORECAST_YEARS)
        self.assertGreaterEqual(len(model["cellFeatures"]), 100)
        self.assertGreaterEqual(len(by_cell["cells"]), 100)
        self.assertGreaterEqual(len(assets["features"]), 1)
        self.assertIn(assets["metadata"]["sourceMode"], {"official-record-api", "manual-official-drop", "osm-proxy-with-official-metadata"})

    def test_transformer_values_have_sensible_units(self) -> None:
        capacity = json.loads((MODE_A / "transformer_capacity_forecast.json").read_text(encoding="utf-8"))
        by_cell = json.loads((MODE_A / "transformer_capacity_by_cell.json").read_text(encoding="utf-8"))
        model = json.loads((MODE_A / "transformer_impact_model.json").read_text(encoding="utf-8"))

        for year in FORECAST_YEARS:
            row = capacity["summaryByYear"][str(year)]
            for key in ("capacityKwProxy", "peakKwProxy", "headroomKwProxy", "meanOverloadRisk"):
                self.assertTrue(math.isfinite(row[key]), f"{year} {key}")
            self.assertGreaterEqual(row["capacityKwProxy"], 0)
            self.assertGreaterEqual(row["peakKwProxy"], 0)
            self.assertGreaterEqual(row["meanOverloadRisk"], 0)
            self.assertLessEqual(row["meanOverloadRisk"], 1)

        for cell_id, cell in list(by_cell["cells"].items())[:25]:
            self.assertGreaterEqual(cell["availableCapacityKwProxy2026"], 0, cell_id)
            self.assertGreaterEqual(cell["peakKwProxy2026"], 0, cell_id)
            self.assertIn(cell["confidence"], {"low", "medium", "medium-high", "high"})

        self.assertEqual(model["transformerDefaults"]["secondary"]["capacityKva"], 500)
        self.assertEqual(model["transformerDefaults"]["primary"]["capacityKva"], 16000)

    def test_transformer_grid_feature_table_shape(self) -> None:
        path = DERIVED / "belfast_transformer_grid_features.csv"
        with path.open(newline="", encoding="utf-8") as handle:
            rows = list(csv.DictReader(handle))
        self.assertGreaterEqual(len(rows), 100)
        required = {
            "cell_id",
            "secondary_500m",
            "primary_2000m",
            "weighted_capacity_kva",
            "available_capacity_kw_proxy",
            "headroom_kw_proxy_2026",
            "overload_risk_2026",
            "confidence",
        }
        self.assertTrue(required.issubset(rows[0].keys()))


if __name__ == "__main__":
    unittest.main()
