/**
 * Ranked geography. `tier` seeds the location score only when the agent has not
 * supplied one; the agent's block-level judgement always wins.
 *
 * The brief is explicit that neighborhoods are NOT equal and that the name is a
 * weak signal. A midblock townhouse street and a corner above a bus depot are
 * different locations at the same address prefix.
 */
export interface Hood {
  id: string;
  name: string;
  region: string;
  lat: number;
  lon: number;
  on: boolean;
  tier: number;
  caveat?: string;
}

export const HOODS: Hood[] = [
  // West Side and downtown core, the strongest preference
  { id: 'west-village',  name: 'West Village',         region: 'West downtown', lat: 40.7358, lon: -74.0036, on: true,  tier: 1.00 },
  { id: 'greenwich',     name: 'Greenwich Village',    region: 'West downtown', lat: 40.7336, lon: -73.9995, on: true,  tier: 0.97 },
  { id: 'meatpacking',   name: 'Meatpacking District', region: 'West downtown', lat: 40.7404, lon: -74.0071, on: true,  tier: 0.95 },
  { id: 'chelsea',       name: 'Chelsea',              region: 'West downtown', lat: 40.7465, lon: -74.0014, on: true,  tier: 0.95 },
  { id: 'west-chelsea',  name: 'West Chelsea',         region: 'West downtown', lat: 40.7480, lon: -74.0060, on: true,  tier: 0.96 },
  { id: 'hudson-square', name: 'Hudson Square',        region: 'West downtown', lat: 40.7261, lon: -74.0075, on: true,  tier: 0.94 },
  { id: 'tribeca',       name: 'Tribeca',              region: 'West downtown', lat: 40.7163, lon: -74.0086, on: true,  tier: 0.98 },
  { id: 'soho',          name: 'SoHo',                 region: 'West downtown', lat: 40.7233, lon: -74.0030, on: true,  tier: 0.93 },
  { id: 'bpc',           name: 'Battery Park City North', region: 'West downtown', lat: 40.7175, lon: -74.0165, on: true, tier: 0.86 },
  { id: 'fidi',          name: 'Financial District',   region: 'West downtown', lat: 40.7085, lon: -74.0110, on: false, tier: 0.72 },
  { id: 'hudson-yards',  name: 'Hudson Yards / far West (below 38th)', region: 'West midtown', lat: 40.7540, lon: -74.0020, on: true, tier: 0.84 },
  // Midtown south
  { id: 'flatiron',      name: 'Flatiron',             region: 'Midtown south', lat: 40.7410, lon: -73.9896, on: true, tier: 0.90 },
  { id: 'nomad',         name: 'NoMad',                region: 'Midtown south', lat: 40.7449, lon: -73.9877, on: true, tier: 0.88 },
  { id: 'union-square',  name: 'Union Square',         region: 'Midtown south', lat: 40.7359, lon: -73.9911, on: true, tier: 0.87 },
  { id: 'gramercy',      name: 'Gramercy',             region: 'Midtown south', lat: 40.7368, lon: -73.9845, on: true, tier: 0.86 },
  { id: 'east-village',  name: 'East Village',         region: 'East downtown',  lat: 40.7265, lon: -73.9815, on: true, tier: 0.84 },
  { id: 'murray-hill',   name: 'Murray Hill',          region: 'Midtown east',   lat: 40.7479, lon: -73.9757, on: true, tier: 0.72, caveat: 'compelling buildings only' },
  { id: 'kips-bay',      name: 'Kips Bay',             region: 'Midtown east',   lat: 40.7409, lon: -73.9781, on: true, tier: 0.68, caveat: 'compelling buildings only' },
  // Upper East Side, ranked internally
  { id: 'lenox-hill',    name: 'Lenox Hill (UES)',     region: 'Upper East Side', lat: 40.7663, lon: -73.9634, on: true, tier: 0.83 },
  { id: 'ues-carnegie',  name: 'Carnegie Hill (UES)',  region: 'Upper East Side', lat: 40.7834, lon: -73.9550, on: true, tier: 0.80 },
  { id: 'ues',           name: 'Upper East Side (other)', region: 'Upper East Side', lat: 40.7736, lon: -73.9566, on: true, tier: 0.78 },
  { id: 'yorkville',     name: 'Yorkville (UES)',      region: 'Upper East Side', lat: 40.7760, lon: -73.9490, on: true, tier: 0.72 },
];

export const HOOD_BY_ID: Record<string, Hood> = Object.fromEntries(HOODS.map((h) => [h.id, h]));
export const WEST_SIDE_IDS = HOODS.filter((h) => /West/.test(h.region)).map((h) => h.id);

/** Roughly W 38th St. The West Side ceiling. */
export const NORTH_LIMIT_LAT = 40.7555;

export function regionsInOrder(): string[] {
  return [...new Set(HOODS.map((h) => h.region))];
}
