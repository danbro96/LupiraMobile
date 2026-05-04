// Param lists for typed navigation. Add new screens here as the app grows.

export type SearchStackParamList = {
  Search: undefined;
  CardDetail: { printingId: string };
};

export type ScanStackParamList = {
  Scan: undefined;
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
