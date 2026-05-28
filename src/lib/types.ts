export type ItemKind =
  | 'street'
  | 'street_with_numbers'
  | 'settlement'
  | 'organization'
  | 'fop'
  | 'person';

export type SearchKindFilter = 'all' | 'address' | 'org' | 'fop' | 'person';

export interface ParsedItem {
  kind: ItemKind;
  displayName: string;
  normalized: string;
  settlement?: string;
  streetName?: string;
  streetNumber?: string;
}

export interface ParsedEntry {
  filia: string;
  rawText: string;
  pageNumber: number;
  items: ParsedItem[];
}

export interface ParsedDocument {
  queueNumber: number;
  subQueue: number;
  label: string;
  validFrom?: string;
  validTo?: string;
  entries: ParsedEntry[];
}

export interface SearchResultRow {
  id: number;
  kind: ItemKind;
  displayName: string;
  filia: string;
  queue: {
    number: number;
    subQueue: number;
    label: string;
    validFrom: string | null;
    validTo: string | null;
  };
}

export interface SearchResponse {
  total: number;
  page: number;
  pageSize: number;
  results: SearchResultRow[];
}
