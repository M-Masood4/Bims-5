import json
import struct
import sys
import tempfile
import unittest
from pathlib import Path


REPO_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(REPO_ROOT / "scripts"))

from spatial_replay_etl import build_catalog, build_timeline_manifest  # noqa: E402


class SpatialReplayEtlTests(unittest.TestCase):
    def test_catalog_summarizes_geojson_and_tiff(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp) / "data"
            (root / "2016").mkdir(parents=True)
            (root / "2026").mkdir(parents=True)

            write_minimal_tiff(root / "2016" / "sample_rgb_2016.tif", width=12, height=34)
            (root / "2026" / "sample_stops_2026.geojson").write_text(
                json.dumps(
                    {
                        "type": "FeatureCollection",
                        "timestamp": "2026-01-01T00:00:00Z",
                        "features": [
                            {
                                "type": "Feature",
                                "id": "node/1",
                                "properties": {"@id": "node/1", "highway": "bus_stop"},
                                "geometry": {"type": "Point", "coordinates": [-5.93, 54.6]},
                            },
                            {
                                "type": "Feature",
                                "id": "way/2",
                                "properties": {"@id": "way/2", "railway": "platform"},
                                "geometry": {
                                    "type": "LineString",
                                    "coordinates": [[-5.95, 54.59], [-5.92, 54.61]],
                                },
                            },
                        ],
                    }
                ),
                encoding="utf-8",
            )

            catalog = build_catalog(root, hash_max_bytes=999999)
            timeline = build_timeline_manifest(catalog)

            by_id = {dataset["dataset_id"]: dataset for dataset in catalog["datasets"]}
            self.assertEqual(catalog["dataset_count"], 2)
            self.assertEqual(by_id["sample_stops_2026"]["vector_summary"]["feature_count"], 2)
            self.assertEqual(by_id["sample_stops_2026"]["vector_summary"]["bbox"], [-5.95, 54.59, -5.92, 54.61])
            self.assertEqual(by_id["sample_rgb_2016"]["raster_summary"]["image_width"], 12)
            self.assertEqual(by_id["sample_rgb_2016"]["raster_summary"]["image_height"], 34)

            statuses = {item["year"]: item["status"] for item in timeline["annual_snapshots"]}
            self.assertEqual(statuses[2016], "observed_source_available")
            self.assertEqual(statuses[2026], "observed_source_available")
            self.assertEqual(statuses[2020], "awaiting_source_manifest")


def write_minimal_tiff(path: Path, width: int, height: int) -> None:
    endian = "<"
    entries = [
        (256, 4, 1, width),
        (257, 4, 1, height),
        (259, 3, 1, 1),
    ]
    payload = bytearray()
    payload.extend(b"II")
    payload.extend(struct.pack(endian + "H", 42))
    payload.extend(struct.pack(endian + "I", 8))
    payload.extend(struct.pack(endian + "H", len(entries)))
    for tag, value_type, count, value in entries:
        if value_type == 3:
            raw_value = struct.pack(endian + "H", value) + b"\x00\x00"
        else:
            raw_value = struct.pack(endian + "I", value)
        payload.extend(struct.pack(endian + "HHI4s", tag, value_type, count, raw_value))
    payload.extend(struct.pack(endian + "I", 0))
    path.write_bytes(payload)


if __name__ == "__main__":
    unittest.main()
