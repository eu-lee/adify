const STORAGE_KEY = 'sonance_ads'

function load() {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '{}')
  } catch {
    return {}
  }
}

function save(data) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(data))
}

export function getStoreAds(storeDomain) {
  return load()[storeDomain] ?? {}
}

export function hasAd(storeDomain, productId) {
  return !!load()[storeDomain]?.[productId]
}

export function saveAd(storeDomain, productId, meta = {}) {
  const all = load()
  if (!all[storeDomain]) all[storeDomain] = {}
  all[storeDomain][productId] = {
    generatedAt: new Date().toISOString(),
    ...meta,
  }
  save(all)
}

export function removeAd(storeDomain, productId) {
  const all = load()
  delete all[storeDomain]?.[productId]
  save(all)
}
