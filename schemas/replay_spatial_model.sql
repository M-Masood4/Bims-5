-- Belfast historical replay spatial ETL/model contract, 2016-2026.
--
-- Dialect target: PostgreSQL + PostGIS. Geometry columns are expressed as
-- geometry(..., 4326), but the table contracts are still useful for SQLite or
-- DuckDB implementations if geometry is stored as WKB/GeoJSON instead.

CREATE TABLE IF NOT EXISTS source_batches (
    source_batch_id TEXT PRIMARY KEY,
    manifest_version TEXT NOT NULL,
    study_area TEXT NOT NULL DEFAULT 'Belfast',
    source_branch TEXT,
    source_commit TEXT,
    created_at TIMESTAMPTZ,
    manifest_uri TEXT,
    notes TEXT
);

CREATE TABLE IF NOT EXISTS source_files (
    source_file_id TEXT PRIMARY KEY,
    source_batch_id TEXT REFERENCES source_batches(source_batch_id),
    source_path TEXT NOT NULL,
    source_year INTEGER CHECK (source_year BETWEEN 2016 AND 2026),
    layer_kind TEXT NOT NULL,
    media_type TEXT NOT NULL,
    size_bytes BIGINT,
    sha256 TEXT,
    provenance JSONB NOT NULL DEFAULT '{}'::jsonb
);

CREATE TABLE IF NOT EXISTS replay_zones (
    zone_id TEXT PRIMARY KEY,
    zone_scheme TEXT NOT NULL,
    zone_name TEXT,
    valid_from_year INTEGER CHECK (valid_from_year BETWEEN 2016 AND 2026),
    valid_to_year INTEGER CHECK (valid_to_year BETWEEN 2016 AND 2026),
    source_file_id TEXT REFERENCES source_files(source_file_id),
    geom geometry(MultiPolygon, 4326),
    properties JSONB NOT NULL DEFAULT '{}'::jsonb
);

CREATE TABLE IF NOT EXISTS annual_zone_snapshots (
    snapshot_id TEXT PRIMARY KEY,
    replay_year INTEGER NOT NULL CHECK (replay_year BETWEEN 2016 AND 2026),
    zone_id TEXT NOT NULL REFERENCES replay_zones(zone_id),
    source_batch_id TEXT REFERENCES source_batches(source_batch_id),
    geom geometry(MultiPolygon, 4326),
    properties JSONB NOT NULL DEFAULT '{}'::jsonb,
    UNIQUE (replay_year, zone_id)
);

CREATE TABLE IF NOT EXISTS indicator_definitions (
    indicator_id TEXT PRIMARY KEY,
    indicator_group TEXT NOT NULL,
    display_name TEXT NOT NULL,
    unit TEXT,
    calculation_contract TEXT NOT NULL,
    expected_frequency TEXT NOT NULL DEFAULT 'annual',
    provenance JSONB NOT NULL DEFAULT '{}'::jsonb
);

CREATE TABLE IF NOT EXISTS annual_zone_indicators (
    replay_year INTEGER NOT NULL CHECK (replay_year BETWEEN 2016 AND 2026),
    zone_id TEXT NOT NULL REFERENCES replay_zones(zone_id),
    indicator_id TEXT NOT NULL REFERENCES indicator_definitions(indicator_id),
    value_numeric DOUBLE PRECISION,
    value_text TEXT,
    confidence TEXT NOT NULL DEFAULT 'source_observed',
    source_file_id TEXT REFERENCES source_files(source_file_id),
    provenance JSONB NOT NULL DEFAULT '{}'::jsonb,
    PRIMARY KEY (replay_year, zone_id, indicator_id)
);

CREATE TABLE IF NOT EXISTS osm_features (
    osm_feature_id TEXT PRIMARY KEY,
    osm_type TEXT,
    osm_numeric_id BIGINT,
    canonical_layer_kind TEXT NOT NULL,
    first_seen_year INTEGER CHECK (first_seen_year BETWEEN 2016 AND 2026),
    last_seen_year INTEGER CHECK (last_seen_year BETWEEN 2016 AND 2026),
    tags JSONB NOT NULL DEFAULT '{}'::jsonb
);

CREATE TABLE IF NOT EXISTS annual_osm_feature_snapshots (
    replay_year INTEGER NOT NULL CHECK (replay_year BETWEEN 2016 AND 2026),
    osm_feature_id TEXT NOT NULL REFERENCES osm_features(osm_feature_id),
    source_file_id TEXT REFERENCES source_files(source_file_id),
    geom geometry(Geometry, 4326),
    tags JSONB NOT NULL DEFAULT '{}'::jsonb,
    feature_state TEXT NOT NULL DEFAULT 'present',
    PRIMARY KEY (replay_year, osm_feature_id)
);

CREATE TABLE IF NOT EXISTS osm_feature_version_events (
    event_id TEXT PRIMARY KEY,
    osm_feature_id TEXT NOT NULL REFERENCES osm_features(osm_feature_id),
    event_year INTEGER NOT NULL CHECK (event_year BETWEEN 2016 AND 2026),
    event_date DATE,
    change_type TEXT NOT NULL CHECK (change_type IN ('created', 'modified', 'deleted', 'retagged', 'geometry_changed', 'inferred')),
    before_tags JSONB,
    after_tags JSONB,
    before_geom geometry(Geometry, 4326),
    after_geom geometry(Geometry, 4326),
    source_file_id TEXT REFERENCES source_files(source_file_id),
    provenance JSONB NOT NULL DEFAULT '{}'::jsonb
);

CREATE TABLE IF NOT EXISTS planning_applications (
    planning_application_id TEXT PRIMARY KEY,
    external_reference TEXT,
    description TEXT,
    applicant TEXT,
    address TEXT,
    submitted_date DATE,
    decided_date DATE,
    status TEXT,
    geom geometry(Geometry, 4326),
    properties JSONB NOT NULL DEFAULT '{}'::jsonb
);

CREATE TABLE IF NOT EXISTS annual_planning_application_snapshots (
    replay_year INTEGER NOT NULL CHECK (replay_year BETWEEN 2016 AND 2026),
    planning_application_id TEXT NOT NULL REFERENCES planning_applications(planning_application_id),
    status_at_year_end TEXT,
    geom geometry(Geometry, 4326),
    properties JSONB NOT NULL DEFAULT '{}'::jsonb,
    PRIMARY KEY (replay_year, planning_application_id)
);

CREATE TABLE IF NOT EXISTS planning_application_events (
    event_id TEXT PRIMARY KEY,
    planning_application_id TEXT NOT NULL REFERENCES planning_applications(planning_application_id),
    event_year INTEGER NOT NULL CHECK (event_year BETWEEN 2016 AND 2026),
    event_date DATE,
    event_type TEXT NOT NULL,
    status_before TEXT,
    status_after TEXT,
    source_file_id TEXT REFERENCES source_files(source_file_id),
    provenance JSONB NOT NULL DEFAULT '{}'::jsonb
);

CREATE TABLE IF NOT EXISTS bike_stations (
    station_id TEXT PRIMARY KEY,
    station_name TEXT,
    first_seen_year INTEGER CHECK (first_seen_year BETWEEN 2016 AND 2026),
    last_seen_year INTEGER CHECK (last_seen_year BETWEEN 2016 AND 2026),
    geom geometry(Point, 4326),
    properties JSONB NOT NULL DEFAULT '{}'::jsonb
);

CREATE TABLE IF NOT EXISTS annual_bike_station_snapshots (
    replay_year INTEGER NOT NULL CHECK (replay_year BETWEEN 2016 AND 2026),
    station_id TEXT NOT NULL REFERENCES bike_stations(station_id),
    dock_count INTEGER,
    station_state TEXT NOT NULL DEFAULT 'present',
    properties JSONB NOT NULL DEFAULT '{}'::jsonb,
    PRIMARY KEY (replay_year, station_id)
);

CREATE TABLE IF NOT EXISTS bike_station_events (
    event_id TEXT PRIMARY KEY,
    station_id TEXT NOT NULL REFERENCES bike_stations(station_id),
    event_year INTEGER NOT NULL CHECK (event_year BETWEEN 2016 AND 2026),
    event_date DATE,
    event_type TEXT NOT NULL CHECK (event_type IN ('opened', 'closed', 'relocated', 'capacity_changed', 'inferred')),
    source_file_id TEXT REFERENCES source_files(source_file_id),
    provenance JSONB NOT NULL DEFAULT '{}'::jsonb
);

CREATE TABLE IF NOT EXISTS bike_trip_events (
    trip_id TEXT PRIMARY KEY,
    event_year INTEGER NOT NULL CHECK (event_year BETWEEN 2016 AND 2026),
    started_at TIMESTAMPTZ,
    ended_at TIMESTAMPTZ,
    start_station_id TEXT REFERENCES bike_stations(station_id),
    end_station_id TEXT REFERENCES bike_stations(station_id),
    duration_seconds INTEGER,
    source_file_id TEXT REFERENCES source_files(source_file_id),
    provenance JSONB NOT NULL DEFAULT '{}'::jsonb
);

CREATE TABLE IF NOT EXISTS pt_stops (
    stop_id TEXT PRIMARY KEY,
    stop_name TEXT,
    stop_kind TEXT,
    first_seen_year INTEGER CHECK (first_seen_year BETWEEN 2016 AND 2026),
    last_seen_year INTEGER CHECK (last_seen_year BETWEEN 2016 AND 2026),
    geom geometry(Geometry, 4326),
    properties JSONB NOT NULL DEFAULT '{}'::jsonb
);

CREATE TABLE IF NOT EXISTS annual_pt_stop_snapshots (
    replay_year INTEGER NOT NULL CHECK (replay_year BETWEEN 2016 AND 2026),
    stop_id TEXT NOT NULL REFERENCES pt_stops(stop_id),
    stop_state TEXT NOT NULL DEFAULT 'present',
    properties JSONB NOT NULL DEFAULT '{}'::jsonb,
    PRIMARY KEY (replay_year, stop_id)
);

CREATE TABLE IF NOT EXISTS pt_stop_events (
    event_id TEXT PRIMARY KEY,
    stop_id TEXT NOT NULL REFERENCES pt_stops(stop_id),
    event_year INTEGER NOT NULL CHECK (event_year BETWEEN 2016 AND 2026),
    event_date DATE,
    event_type TEXT NOT NULL CHECK (event_type IN ('opened', 'closed', 'renamed', 'relocated', 'service_changed', 'inferred')),
    source_file_id TEXT REFERENCES source_files(source_file_id),
    provenance JSONB NOT NULL DEFAULT '{}'::jsonb
);

CREATE TABLE IF NOT EXISTS pt_routes (
    route_id TEXT PRIMARY KEY,
    route_name TEXT,
    route_type TEXT,
    operator_name TEXT,
    first_seen_year INTEGER CHECK (first_seen_year BETWEEN 2016 AND 2026),
    last_seen_year INTEGER CHECK (last_seen_year BETWEEN 2016 AND 2026),
    geom geometry(Geometry, 4326),
    properties JSONB NOT NULL DEFAULT '{}'::jsonb
);

CREATE TABLE IF NOT EXISTS annual_pt_route_snapshots (
    replay_year INTEGER NOT NULL CHECK (replay_year BETWEEN 2016 AND 2026),
    route_id TEXT NOT NULL REFERENCES pt_routes(route_id),
    route_state TEXT NOT NULL DEFAULT 'present',
    service_level JSONB NOT NULL DEFAULT '{}'::jsonb,
    PRIMARY KEY (replay_year, route_id)
);

CREATE TABLE IF NOT EXISTS pt_route_events (
    event_id TEXT PRIMARY KEY,
    route_id TEXT NOT NULL REFERENCES pt_routes(route_id),
    event_year INTEGER NOT NULL CHECK (event_year BETWEEN 2016 AND 2026),
    event_date DATE,
    event_type TEXT NOT NULL CHECK (event_type IN ('created', 'withdrawn', 'rerouted', 'frequency_changed', 'operator_changed', 'inferred')),
    source_file_id TEXT REFERENCES source_files(source_file_id),
    provenance JSONB NOT NULL DEFAULT '{}'::jsonb
);

CREATE TABLE IF NOT EXISTS pt_timetable_events (
    event_id TEXT PRIMARY KEY,
    route_id TEXT REFERENCES pt_routes(route_id),
    stop_id TEXT REFERENCES pt_stops(stop_id),
    event_year INTEGER NOT NULL CHECK (event_year BETWEEN 2016 AND 2026),
    service_date DATE,
    arrival_time TIME,
    departure_time TIME,
    trip_headsign TEXT,
    source_file_id TEXT REFERENCES source_files(source_file_id),
    provenance JSONB NOT NULL DEFAULT '{}'::jsonb
);

CREATE TABLE IF NOT EXISTS air_zones (
    air_zone_id TEXT PRIMARY KEY,
    zone_name TEXT,
    geom geometry(MultiPolygon, 4326),
    properties JSONB NOT NULL DEFAULT '{}'::jsonb
);

CREATE TABLE IF NOT EXISTS annual_air_zone_snapshots (
    replay_year INTEGER NOT NULL CHECK (replay_year BETWEEN 2016 AND 2026),
    air_zone_id TEXT NOT NULL REFERENCES air_zones(air_zone_id),
    classification TEXT,
    properties JSONB NOT NULL DEFAULT '{}'::jsonb,
    PRIMARY KEY (replay_year, air_zone_id)
);

CREATE TABLE IF NOT EXISTS air_observation_events (
    event_id TEXT PRIMARY KEY,
    air_zone_id TEXT REFERENCES air_zones(air_zone_id),
    event_year INTEGER NOT NULL CHECK (event_year BETWEEN 2016 AND 2026),
    observed_at TIMESTAMPTZ,
    pollutant TEXT NOT NULL,
    value_numeric DOUBLE PRECISION,
    unit TEXT,
    source_file_id TEXT REFERENCES source_files(source_file_id),
    provenance JSONB NOT NULL DEFAULT '{}'::jsonb
);

CREATE TABLE IF NOT EXISTS scenario_branches (
    scenario_branch_id TEXT PRIMARY KEY,
    parent_branch_id TEXT REFERENCES scenario_branches(scenario_branch_id),
    branch_name TEXT NOT NULL,
    base_replay_year INTEGER CHECK (base_replay_year BETWEEN 2016 AND 2026),
    created_by TEXT,
    created_at TIMESTAMPTZ,
    description TEXT,
    branch_state TEXT NOT NULL DEFAULT 'draft'
);

CREATE TABLE IF NOT EXISTS scenario_branch_events (
    event_id TEXT PRIMARY KEY,
    scenario_branch_id TEXT NOT NULL REFERENCES scenario_branches(scenario_branch_id),
    event_year INTEGER CHECK (event_year BETWEEN 2016 AND 2026),
    event_type TEXT NOT NULL CHECK (event_type IN ('created', 'forked', 'published', 'archived', 'rebased')),
    event_at TIMESTAMPTZ,
    metadata JSONB NOT NULL DEFAULT '{}'::jsonb
);

CREATE TABLE IF NOT EXISTS scenario_edits (
    scenario_edit_id TEXT PRIMARY KEY,
    scenario_branch_id TEXT NOT NULL REFERENCES scenario_branches(scenario_branch_id),
    target_table TEXT NOT NULL,
    target_id TEXT NOT NULL,
    edit_year INTEGER CHECK (edit_year BETWEEN 2016 AND 2026),
    edit_type TEXT NOT NULL CHECK (edit_type IN ('insert', 'update', 'delete', 'geometry_update', 'indicator_override')),
    patch JSONB NOT NULL,
    geom geometry(Geometry, 4326),
    created_at TIMESTAMPTZ,
    provenance JSONB NOT NULL DEFAULT '{}'::jsonb
);

CREATE TABLE IF NOT EXISTS scenario_edit_events (
    event_id TEXT PRIMARY KEY,
    scenario_edit_id TEXT NOT NULL REFERENCES scenario_edits(scenario_edit_id),
    scenario_branch_id TEXT NOT NULL REFERENCES scenario_branches(scenario_branch_id),
    event_year INTEGER CHECK (event_year BETWEEN 2016 AND 2026),
    event_type TEXT NOT NULL CHECK (event_type IN ('applied', 'reverted', 'superseded', 'validated')),
    event_at TIMESTAMPTZ,
    metadata JSONB NOT NULL DEFAULT '{}'::jsonb
);

CREATE TABLE IF NOT EXISTS spatial_feature_deltas (
    delta_id TEXT PRIMARY KEY,
    from_year INTEGER NOT NULL CHECK (from_year BETWEEN 2016 AND 2026),
    to_year INTEGER NOT NULL CHECK (to_year BETWEEN 2016 AND 2026),
    feature_namespace TEXT NOT NULL,
    feature_id TEXT NOT NULL,
    delta_type TEXT NOT NULL CHECK (delta_type IN ('added', 'removed', 'geometry_changed', 'attributes_changed', 'unchanged')),
    before_geom geometry(Geometry, 4326),
    after_geom geometry(Geometry, 4326),
    attribute_delta JSONB NOT NULL DEFAULT '{}'::jsonb,
    provenance JSONB NOT NULL DEFAULT '{}'::jsonb
);

CREATE TABLE IF NOT EXISTS zone_indicator_deltas (
    from_year INTEGER NOT NULL CHECK (from_year BETWEEN 2016 AND 2026),
    to_year INTEGER NOT NULL CHECK (to_year BETWEEN 2016 AND 2026),
    zone_id TEXT NOT NULL REFERENCES replay_zones(zone_id),
    indicator_id TEXT NOT NULL REFERENCES indicator_definitions(indicator_id),
    value_before DOUBLE PRECISION,
    value_after DOUBLE PRECISION,
    value_delta DOUBLE PRECISION,
    provenance JSONB NOT NULL DEFAULT '{}'::jsonb,
    PRIMARY KEY (from_year, to_year, zone_id, indicator_id)
);
