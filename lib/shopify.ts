export function normaliseStoreUrl(input: string): string {
  let raw = input.trim()
  if (!raw) throw new Error('Please enter a store URL.')
  if (!/^https?:\/\//i.test(raw)) raw = 'https://' + raw
  let parsed: URL
  try {
    parsed = new URL(raw)
  } catch {
    throw new Error("That doesn't look like a valid URL.")
  }
  return `${parsed.protocol}//${parsed.host}`
}

export interface ShopifyProduct {
  id: number | string
  title: string
  category: string
  price: string | null
  image: string | null
}

export async function fetchShopifyProducts(
  baseUrl: string,
  limit: number = 24
): Promise<ShopifyProduct[]> {
  const endpoint = `${baseUrl}/products.json?limit=${limit}`
  let res: Response
  try {
    res = await fetch(endpoint, { signal: AbortSignal.timeout(10_000) })
  } catch (err: unknown) {
    if (err instanceof Error && err.name === 'TimeoutError')
      throw new Error('The store took too long to respond.')
    throw new Error('Could not reach the store. Check the URL and try again.')
  }
  if (res.status === 404) throw new Error('No Shopify store found at that URL.')
  if (!res.ok) throw new Error(`Store returned an error (${res.status}).`)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let json: any
  try {
    json = await res.json()
  } catch {
    throw new Error("The response wasn't valid JSON — this might not be a Shopify store.")
  }
  if (!Array.isArray(json.products))
    throw new Error("Couldn't find products — is this a Shopify storefront?")
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return json.products.map((p: any) => ({
    id: p.id,
    title: p.title,
    category: p.product_type || 'Product',
    price: p.variants?.[0]?.price
      ? `$${parseFloat(p.variants[0].price).toFixed(2)}`
      : null,
    image: p.images?.[0]?.src ?? null,
  }))
}
