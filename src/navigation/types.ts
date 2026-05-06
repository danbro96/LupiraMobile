// Param lists for typed navigation. Add new screens here as the app grows.

export type SearchStackParamList = {
  Search: undefined;
  CardDetail: { printingId: string };
};

export type ScanStackParamList = {
  Scan: {
    pendingUpload?: {
      uri: string;
      cropped: boolean;
      sourceWidth: number;
      sourceHeight: number;
    };
  } | undefined;
  ScanSettings: undefined;
  ScanPreview: {
    /** File URI of the (possibly cropped) image queued for upload. */
    uri: string;
    /** Whether the URI points to a perspective-corrected crop (vs raw still). */
    cropped: boolean;
    /** File URI of the raw, uncropped still — for the inspect-raw toggle. */
    originalUri: string;
    /** Width of the source still in pixels (for src-MP debug chip). */
    sourceWidth: number;
    /** Height of the source still in pixels (for src-MP debug chip). */
    sourceHeight: number;
  };
  Selection: undefined;
  PickCollection: { selectionId: string };
  CardDetail: { printingId: string };
};

export type CollectionsStackParamList = {
  Collections: undefined;
  CollectionDetail: { collectionId: string };
  CardDetail: { printingId: string };
};

export type MtgTabParamList = {
  SearchTab: undefined;
  ScanTab: undefined;
  CollectionsTab: undefined;
  ProfileTab: undefined;
};

export type RootTabParamList = {
  MTG: undefined;
  Narrator: undefined;
};

// Backwards-compat alias used by the existing SearchScreen / CardDetailScreen imports.
export type MtgStackParamList = SearchStackParamList;
