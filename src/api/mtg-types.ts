// Hand-typed mirror of LupiraMtgApi's response shapes.
// These will be replaced by Orval-generated types in a later phase.

export type CardImageUrls = {
  normal?: string | null;
  artCrop?: string | null;
};

export type CardPrintingResponse = {
  id: string;
  oracleId: string;
  name: string;
  setCode: string;
  setName: string;
  collectorNumber: string;
  colorIdentity: string[];
  rarity: string;
  images?: CardImageUrls | null;
  prices?: Record<string, number> | null;
};

export type CardSearchResponse = {
  results: CardPrintingResponse[];
  total: number;
};

export type CardSearchParams = {
  q?: string;
  set?: string;
  color?: string;
  rarity?: string;
  limit?: number;
};

export type RegisterDeviceRequest = {
  displayName?: string;
};

export type RegisterDeviceResponse = {
  sub: string;
  token: string;
  displayName?: string | null;
};

export type WhoAmIResponse = {
  sub: string;
  displayName?: string | null;
  createdAt: string;
  lastSeenAt: string;
};

export type RecognitionConfidence = 'low' | 'medium' | 'high';

export type CardCandidateResponse = {
  printing: CardPrintingResponse;
  combinedScore: number;
  nameScore: number;
  hammingScore: number;
  hammingDistance?: number | null;
  matchedByPHash: boolean;
  matchedByName: boolean;
};

export type ScanDebug = {
  ocrText?: string | null;
  imagePHash?: number | null;
  pHashCandidateCount: number;
  ocrCandidateCount: number;
  ocrLatencyMs: number;
  pHashLatencyMs: number;
};

export type ScanResponse = {
  confidence: RecognitionConfidence;
  candidates: CardCandidateResponse[];
  debug: ScanDebug;
};

export type CardInstanceResponse = {
  instanceId: string;
  printing: CardPrintingResponse;
  foil: boolean;
  language: string;
  condition: string;
  acquiredAt: string;
  collectionId?: string | null;
  collectionName?: string | null;
};

export type CardListResponse = {
  cards: CardInstanceResponse[];
};

export type CollectionResponse = {
  id: string;
  name: string;
  cardCount: number;
  createdAt: string;
  updatedAt: string;
};

export type CollectionListResponse = {
  collections: CollectionResponse[];
};

export type CollectionDetailResponse = {
  id: string;
  name: string;
  cards: CardInstanceResponse[];
  createdAt: string;
  updatedAt: string;
};

export type CreateCollectionRequest = { name: string };

export type RenameCollectionRequest = { name: string };

export type AddCardToCollectionRequest = {
  printingId: string;
  foil?: boolean;
  language?: string;
  condition?: string;
};

export type MoveCardRequest = { toCollectionId: string };

export type SelectionEntryResponse = {
  instanceId: string;
  printing: CardPrintingResponse;
  foil: boolean;
  language: string;
  condition: string;
  confidence: number;
};

export type SelectionResponse = {
  id: string;
  cards: SelectionEntryResponse[];
  createdAt: string;
  expiresAt: string;
};

export type AddSelectionEntryRequest = {
  printingId: string;
  foil?: boolean;
  language?: string;
  condition?: string;
  confidence?: number;
  allowDuplicate?: boolean;
};

export type CommitSelectionRequest = {
  collectionId: string;
  instanceIds?: string[];
};

export type CommitSelectionResponse = {
  collectionId: string;
  collectionName: string;
  addedCount: number;
  remainingCount: number;
};
