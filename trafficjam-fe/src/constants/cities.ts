export interface CityConfig {
  id: string;
  name: string;
  center: [number, number];
  zoom: number;
  bounds: { south: number; west: number; north: number; east: number };
  population: number;
  populationDensity: number;
}

export const BELFAST: CityConfig = {
  id: "belfast",
  name: "Belfast",
  center: [-5.93, 54.597],
  zoom: 14,
  bounds: { south: 54.55, west: -6.05, north: 54.65, east: -5.81 },
  population: 345418,
  populationDensity: 2700,
};

export const DUBLIN: CityConfig = {
  id: "dublin",
  name: "Dublin",
  center: [-6.26, 53.35],
  zoom: 14,
  bounds: { south: 53.28, west: -6.42, north: 53.42, east: -6.1 },
  population: 592713,
  populationDensity: 5150,
};

export const CITIES: CityConfig[] = [BELFAST, DUBLIN];

export const DEFAULT_CITY = BELFAST;
