/** Shape of the dataset produced by build_inventory.py. */

export type StabClass = 'confirmed' | 'highly_likely' | 'possible' | 'market' | 'unknown';
export type Importance = 'req' | 'strong' | 'nice' | 'off';
export type ConfidenceLevel = 'High' | 'Medium' | 'Low';
export type ListingGrade = 'unit_verified' | 'building_indicated';

export interface Amenities {
  doorman?: boolean; concierge?: boolean; elevator?: boolean; gym?: boolean;
  roof_deck?: boolean; package_room?: boolean; parking?: boolean; pets?: boolean;
  laundry_in_unit?: boolean; central_air?: boolean; outdoor_space?: boolean;
  [k: string]: boolean | undefined;
}

export interface Contact {
  name?: string | null;
  phone?: string | null;
  url?: string | null;
  verified?: boolean;
}

export interface Building {
  id: string;
  name?: string | null;
  address?: string | null;
  neighborhood?: string | null;
  hood_id?: string | null;
  lat?: number | null;
  lon?: number | null;
  bbl?: string | null;
  year_built?: number | null;
  year_renovated?: number | null;
  units?: number | null;
  stories?: number | null;
  avg_sf_per_unit?: number | null;
  ownership_type?: string | null;
  quality_score?: number | null;
  condition?: string | null;
  management?: string | null;
  owner?: string | null;
  program?: string | null;
  benefit_status?: string | null;
  stabilization_note?: string | null;
  why_stabilized?: string | null;
  transit?: string | null;
  amenities?: Amenities;
  tier?: number | null;
  fit_seed?: number | null;
  contact?: Contact | null;
  availability_source?: string | null;
  last_checked?: string | null;
  historical_rents?: { period: string; rent: number; psf?: number }[];
}

/** The eight sub-scores the agent supplies. The UI computes Fit from these. */
export interface Components {
  location?: number; size?: number; price?: number; building_quality?: number;
  apartment_quality?: number; stabilization?: number; amenities?: number; value?: number;
}

export interface Comparable { address?: string; rent: number; sf?: number | null }

export interface CrossCheck {
  status?: 'confirmed' | 'conflict' | 'gone';
  sources_confirming?: string[];
  note?: string | null;
}

export interface Listing {
  id: string;
  building_id: string;
  building_name?: string | null;
  address?: string | null;
  unit?: string | null;
  neighborhood?: string | null;
  hood_id?: string | null;
  lat?: number | null;
  lon?: number | null;

  rent?: number | null;
  effective_rent?: number | null;
  concessions_text?: string | null;
  months_free?: number | null;
  lease_months?: number | null;
  fee?: string | null;
  fee_paid_by?: string | null;
  lease_terms?: string | null;

  beds?: number | null;
  baths?: number | null;
  sf?: number | null;
  sf_source?: string | null;
  floor?: number | null;
  ceiling_ft?: number | null;

  est_market_rent?: number | null;
  discount_pct?: number | null;
  comps_count?: number | null;
  comparables?: Comparable[];
  value_score?: number | null;
  value_reasons?: string | null;

  condition?: string | null;
  condition_score?: number | null;
  kitchen_score?: number | null;
  bathroom_score?: number | null;
  light_score?: number | null;
  views_score?: number | null;
  furnished?: boolean | string | null;
  amenities?: Amenities;

  available_date?: string | null;
  listed_date?: string | null;
  last_verified?: string | null;
  days_on_market?: number | null;
  availability_status?: string | null;
  listing_grade?: ListingGrade;
  cross_check?: CrossCheck;

  source?: string | null;
  url?: string | null;
  photos?: string[];
  floorplan_url?: string | null;

  stabilization?: { class: StabClass; reasons?: string[] };
  components?: Components;
  location_note?: string | null;
  why_matches?: string | null;
  tradeoffs?: string | null;
}

export interface MicroMarket {
  name: string;
  parent_neighborhood?: string | null;
  hood_id?: string | null;
  median_psf?: number | null;
  parent_median_psf?: number | null;
  selected?: boolean;
  rationale?: string | null;
}

export interface Discovery {
  kind?: string;
  text?: string;
  listing_id?: string | null;
}

export interface Dataset {
  date?: string;
  generated_at?: string;
  demo?: boolean;
  coverage?: { sources_blocked?: string[]; buildings_searched?: number; notes?: string };
  discoveries?: Discovery[];
  off_market_buildings?: Building[];
  micro_markets?: MicroMarket[];
  candidate_additions?: { address: string; note: string }[];
  buildings: Building[];
  listings: Listing[];
}

/** A scored listing, the unit the UI actually renders. */
export interface Scored {
  L: Listing;
  fit: number;
  value: number;
  eff: number | null;
  comp: Required<Components>;
  misses: { k: string; label: string; imp: Importance }[];
  unverified: { k: string; label: string }[];
  sizeUnknown: boolean;
  freshness: 'today' | 'h24' | 'd3' | 'older';
  nearReason?: string;
}
