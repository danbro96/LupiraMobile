import { useAuth } from '../store/auth-store';
import {
  AddCardToCollectionRequest,
  AddSelectionEntryRequest,
  CardListResponse,
  CardPrintingResponse,
  CardSearchParams,
  CardSearchResponse,
  CardInstanceResponse,
  CollectionDetailResponse,
  CollectionListResponse,
  CollectionResponse,
  CommitSelectionRequest,
  CommitSelectionResponse,
  CreateCollectionRequest,
  MoveCardRequest,
  RegisterDeviceRequest,
  RegisterDeviceResponse,
  RenameCollectionRequest,
  ScanResponse,
  SelectionEntryResponse,
  SelectionResponse,
  WhoAmIResponse,
} from './mtg-types';

export class ApiError extends Error {
  status: number;

  constructor(status: number, message: string) {
    super(message);
    this.status = status;
    this.name = 'ApiError';
  }
}

type FetchOptions = {
  init?: RequestInit;
  authenticated?: boolean;
};

async function fetchJson<T>(path: string, opts: FetchOptions = {}): Promise<T> {
  const { mtgApiUrl, token } = useAuth.getState();
  if (!mtgApiUrl) throw new ApiError(0, 'API base URL is not configured.');

  const url = mtgApiUrl.replace(/\/$/, '') + path;
  const headers = new Headers(opts.init?.headers ?? {});
  headers.set('Accept', 'application/json');

  if (opts.authenticated !== false) {
    if (!token) throw new ApiError(401, 'Not authenticated.');
    headers.set('Authorization', `Bearer ${token}`);
  }

  if (opts.init?.body && !headers.has('content-type')) {
    // FormData sets its own multipart/form-data with boundary; let fetch handle it.
    if (!(opts.init.body instanceof FormData)) {
      headers.set('Content-Type', 'application/json');
    }
  }

  const res = await fetch(url, { ...opts.init, headers });
  if (!res.ok) {
    const text = await res.text().catch(() => res.statusText);
    throw new ApiError(res.status, text || res.statusText);
  }

  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

function buildSearchQuery(params: CardSearchParams): string {
  const search = new URLSearchParams();
  if (params.q) search.set('q', params.q);
  if (params.set) search.set('set', params.set);
  if (params.color) search.set('color', params.color);
  if (params.rarity) search.set('rarity', params.rarity);
  if (params.limit) search.set('limit', String(params.limit));
  const qs = search.toString();
  return qs.length ? `?${qs}` : '';
}

export type ScanInput = {
  uri: string;
  mimeType?: string;
  fileName?: string;
};

export const mtgApi = {
  registerDevice: (body: RegisterDeviceRequest = {}, signal?: AbortSignal) =>
    fetchJson<RegisterDeviceResponse>('/me/register', {
      authenticated: false,
      init: { method: 'POST', body: JSON.stringify(body), signal },
    }),

  whoAmI: (signal?: AbortSignal) =>
    fetchJson<WhoAmIResponse>('/me', { init: { signal } }),

  searchCards: (params: CardSearchParams, signal?: AbortSignal) =>
    fetchJson<CardSearchResponse>(`/cards/search${buildSearchQuery(params)}`, { init: { signal } }),

  getPrinting: (printingId: string, signal?: AbortSignal) =>
    fetchJson<CardPrintingResponse>(`/cards/${encodeURIComponent(printingId)}`, { init: { signal } }),

  scanCard: (input: ScanInput, signal?: AbortSignal) => {
    const form = new FormData();
    // React Native FormData accepts a {uri, type, name} blob descriptor for multipart upload.
    form.append('image', {
      uri: input.uri,
      type: input.mimeType ?? 'image/jpeg',
      name: input.fileName ?? 'scan.jpg',
    } as unknown as Blob);
    return fetchJson<ScanResponse>('/scans', {
      init: { method: 'POST', body: form, signal },
    });
  },

  health: (signal?: AbortSignal) =>
    fetchJson<{ status: string }>(`/healthz`, { authenticated: false, init: { signal } }),

  collections: {
    list: (signal?: AbortSignal) =>
      fetchJson<CollectionListResponse>('/collections/', { init: { signal } }),

    create: (body: CreateCollectionRequest, signal?: AbortSignal) =>
      fetchJson<CollectionResponse>('/collections/', {
        init: { method: 'POST', body: JSON.stringify(body), signal },
      }),

    get: (collectionId: string, signal?: AbortSignal) =>
      fetchJson<CollectionDetailResponse>(`/collections/${encodeURIComponent(collectionId)}`, { init: { signal } }),

    rename: (collectionId: string, body: RenameCollectionRequest, signal?: AbortSignal) =>
      fetchJson<CollectionResponse>(`/collections/${encodeURIComponent(collectionId)}`, {
        init: { method: 'PATCH', body: JSON.stringify(body), signal },
      }),

    delete: (collectionId: string, signal?: AbortSignal) =>
      fetchJson<void>(`/collections/${encodeURIComponent(collectionId)}`, {
        init: { method: 'DELETE', signal },
      }),

    listCards: (collectionId: string, signal?: AbortSignal) =>
      fetchJson<CardListResponse>(`/collections/${encodeURIComponent(collectionId)}/cards`, { init: { signal } }),

    addCard: (collectionId: string, body: AddCardToCollectionRequest, signal?: AbortSignal) =>
      fetchJson<CardInstanceResponse>(`/collections/${encodeURIComponent(collectionId)}/cards`, {
        init: { method: 'POST', body: JSON.stringify(body), signal },
      }),

    removeCard: (collectionId: string, instanceId: string, signal?: AbortSignal) =>
      fetchJson<void>(
        `/collections/${encodeURIComponent(collectionId)}/cards/${encodeURIComponent(instanceId)}`,
        { init: { method: 'DELETE', signal } },
      ),

    moveCard: (collectionId: string, instanceId: string, body: MoveCardRequest, signal?: AbortSignal) =>
      fetchJson<CardInstanceResponse>(
        `/collections/${encodeURIComponent(collectionId)}/cards/${encodeURIComponent(instanceId)}/move`,
        { init: { method: 'POST', body: JSON.stringify(body), signal } },
      ),
  },

  selections: {
    create: (signal?: AbortSignal) =>
      fetchJson<SelectionResponse>('/selections/', { init: { method: 'POST', signal } }),

    get: (selectionId: string, signal?: AbortSignal) =>
      fetchJson<SelectionResponse>(`/selections/${encodeURIComponent(selectionId)}`, { init: { signal } }),

    addCard: (selectionId: string, body: AddSelectionEntryRequest, signal?: AbortSignal) =>
      fetchJson<SelectionEntryResponse>(`/selections/${encodeURIComponent(selectionId)}/cards`, {
        init: { method: 'POST', body: JSON.stringify(body), signal },
      }),

    removeCard: (selectionId: string, instanceId: string, signal?: AbortSignal) =>
      fetchJson<void>(
        `/selections/${encodeURIComponent(selectionId)}/cards/${encodeURIComponent(instanceId)}`,
        { init: { method: 'DELETE', signal } },
      ),

    commit: (selectionId: string, body: CommitSelectionRequest, signal?: AbortSignal) =>
      fetchJson<CommitSelectionResponse>(`/selections/${encodeURIComponent(selectionId)}/commit`, {
        init: { method: 'POST', body: JSON.stringify(body), signal },
      }),
  },

  me: {
    cards: (signal?: AbortSignal) =>
      fetchJson<CardListResponse>('/me/cards', { init: { signal } }),
  },
};
