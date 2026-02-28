/**
 * Normalises whatever the user typed into a clean base URL.
 * Accepts:  store.myshopify.com
 *           https://store.myshopify.com
 *           https://www.customdomain.com/anything
 */
export function normaliseStoreUrl(input) {
  let raw = input.trim()
  if (!raw) throw new Error('Please enter a store URL.')

  // Add protocol if missing so URL() can parse it
  if (!/^https?:\/\//i.test(raw)) raw = 'https://' + raw

  let parsed
  try {
    parsed = new URL(raw)
  } catch {
    throw new Error("That doesn't look like a valid URL.")
  }

  return `${parsed.protocol}//${parsed.host}`
}

/**
 * Fetches up to `limit` products from a Shopify storefront's public JSON API.
 * Returns an array of normalised product objects.
 */
export async function fetchShopifyProducts(baseUrl, limit = 24) {
  const endpoint = `${baseUrl}/products.json?limit=${limit}`

  let res
  try {
    res = await fetch(endpoint, { signal: AbortSignal.timeout(10_000) })
  } catch (err) {
    if (err.name === 'TimeoutError') throw new Error('The store took too long to respond.')
    throw new Error('Could not reach the store. Check the URL and try again.')
  }

  if (res.status === 404) {
    throw new Error('No Shopify store found at that URL.')
  }
  if (!res.ok) {
    throw new Error(`Store returned an error (${res.status}).`)
  }

  let json
  try {
    json = await res.json()
  } catch {
    throw new Error("The response wasn't valid JSON — this might not be a Shopify store.")
  }

  if (!Array.isArray(json.products)) {
    throw new Error("Couldn't find products — is this a Shopify storefront?")
  }

  return json.products.map((p) => ({
    id: p.id,
    title: p.title,
    category: p.product_type || 'Product',
    price: p.variants?.[0]?.price
      ? `$${parseFloat(p.variants[0].price).toFixed(2)}`
      : null,
    image: p.images?.[0]?.src ?? null,
  }))
}
