const STORAGE_KEY = 'sonance_ads'

export interface AdMeta {
  generatedAt: string
  [key: string]: unknown
}

type StoreAds = Record<string, AdMeta>
type AllAds = Record<string, StoreAds>

function load(): AllAds {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '{}')
  } catch {
    return {}
  }
}

function save(data: AllAds): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(data))
}

export function getStoreAds(storeDomain: string): StoreAds {
  return load()[storeDomain] ?? {}
}

export function hasAd(storeDomain: string, productId: string | number): boolean {
  return !!load()[storeDomain]?.[productId]
}

export function saveAd(
  storeDomain: string,
  productId: string | number,
  meta: Record<string, unknown> = {}
): void {
  const all = load()
  if (!all[storeDomain]) all[storeDomain] = {}
  all[storeDomain][productId] = {
    generatedAt: new Date().toISOString(),
    ...meta,
  }
  save(all)
}

export function removeAd(storeDomain: string, productId: string | number): void {
  const all = load()
  delete all[storeDomain]?.[productId]
  save(all)
}
