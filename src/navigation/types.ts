// Param lists for typed navigation. Add new screens here as the app grows.

export type SearchStackParamList = {
  Search: undefined;
  CardDetail: { oracleId: string };
  PrintingDetail: { oracleId: string; printingId: string };
};

export type ScanStackParamList = {
  /** `manualMatch`: a capture resolved in PrintingPicker, handed back so its gallery tile shows as added. */
  Scan: { manualMatch?: { captureId: string; printingId: string; instanceId: string } } | undefined;
  Selection: undefined;
  PickCollection: { selectionId: string };
  PrintingPicker: {
    query?: string;
    oracleId?: string;
    captureId?: string;
    /** Selection entries the picked printing replaces (change printing) instead of adding a new card. */
    replaceInstanceIds?: string[];
    currentPrintingId?: string;
    isFoil?: boolean;
    condition?: string;
    language?: string;
  };
  CardDetail: { oracleId: string };
  PrintingDetail: { oracleId: string; printingId: string };
};

export type CollectionsStackParamList = {
  Collections: undefined;
  CollectionDetail: { collectionId: string };
  CardDetail: { oracleId: string };
  PrintingDetail: { oracleId: string; printingId: string };
};

export type MtgTabParamList = {
  SearchTab: undefined;
  ScanTab: undefined;
  CollectionsTab: undefined;
};

export type RootStackParamList = {
  Login: undefined;
  Tabs: undefined;
  Settings: undefined;
  ScanSettings: undefined;
  ScanDebugLog: undefined;
};

// Backwards-compat alias used by the existing SearchScreen / CardDetailScreen imports.
export type MtgStackParamList = SearchStackParamList;
