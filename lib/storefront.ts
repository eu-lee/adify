const API_VERSION = '2025-01'

export const SORT_KEYS = {
  BEST_SELLING: 'BEST_SELLING',
  NEWEST: 'CREATED_AT',
  PRICE_ASC: 'PRICE',
  PRICE_DESC: 'PRICE',
  TITLE: 'TITLE',
} as const

export type SortKeyName = keyof typeof SORT_KEYS

const PRODUCTS_QUERY = `
  query GetProducts($first: Int!, $sortKey: ProductSortKeys!, $reverse: Boolean!) {
    products(first: $first, sortKey: $sortKey, reverse: $reverse) {
      edges {
        node {
          id
          title
          description
          productType
          vendor
          tags
          availableForSale
          totalInventory
          priceRange {
            minVariantPrice { amount currencyCode }
            maxVariantPrice { amount currencyCode }
          }
          compareAtPriceRange {
            minVariantPrice { amount currencyCode }
          }
          variants(first: 10) {
            edges {
              node {
                id
                title
                availableForSale
                quantityAvailable
                price { amount currencyCode }
                compareAtPrice { amount currencyCode }
                selectedOptions { name value }
              }
            }
          }
          images(first: 4) {
            edges {
              node { url altText }
            }
          }
          collections(first: 3) {
            edges {
              node { title }
            }
          }
        }
      }
    }
  }
`

export interface StorefrontVariant {
  id: string
  title: string
  availableForSale: boolean
  quantityAvailable: number | null
  price: { amount: string; currencyCode: string }
  compareAtPrice: { amount: string; currencyCode: string } | null
  selectedOptions: { name: string; value: string }[]
}

export interface StorefrontImage {
  url: string
  altText: string | null
}

export interface StorefrontProduct {
  id: string
  title: string
  description: string
  category: string
  vendor: string
  tags: string[]
  collections: string[]
  availableForSale: boolean
  totalInventory: number
  price: string | null
  priceMax: string | null
  compareAtPrice: string | null
  onSale: boolean
  variants: StorefrontVariant[]
  variantCount: number
  image: string | null
  images: StorefrontImage[]
  bestSellerRank: number
}

export async function fetchStorefrontProducts(
  baseUrl: string,
  token: string,
  sortKey: string = 'BEST_SELLING',
  limit: number = 48
): Promise<StorefrontProduct[]> {
  const endpoint = `${baseUrl}/api/${API_VERSION}/graphql.json`
  const reverse = sortKey === 'PRICE_DESC'
  const gqlSortKey = (SORT_KEYS as Record<string, string>)[sortKey] ?? 'BEST_SELLING'

  let res: Response
  try {
    res = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Shopify-Storefront-Access-Token': token,
      },
      body: JSON.stringify({
        query: PRODUCTS_QUERY,
        variables: { first: limit, sortKey: gqlSortKey, reverse },
      }),
      signal: AbortSignal.timeout(12_000),
    })
  } catch (err: unknown) {
    if (err instanceof Error && err.name === 'TimeoutError')
      throw new Error('The store took too long to respond.')
    throw new Error('Could not reach the store. Check the URL and try again.')
  }

  if (res.status === 401 || res.status === 403) {
    throw new Error(
      'Access denied — check your Storefront token and that the app is installed.'
    )
  }
  if (!res.ok) throw new Error(`Store returned an error (${res.status}).`)

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const json: any = await res.json()

  if (json.errors?.length) {
    console.error('[Storefront API] Errors:', json.errors)
    const msg: string = json.errors[0]?.message ?? 'Unknown error'
    throw new Error(`Shopify: ${msg}`)
  }

  const edges = json?.data?.products?.edges
  if (!Array.isArray(edges))
    throw new Error("Couldn't read products from the Storefront API.")

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return edges.map(({ node: p }: { node: any }, index: number) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const variants: StorefrontVariant[] = p.variants.edges.map((e: any) => e.node)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const images: StorefrontImage[] = p.images.edges.map((e: any) => e.node)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const collections: string[] = p.collections.edges.map((e: any) => e.node.title)

    const minPrice = parseFloat(p.priceRange.minVariantPrice.amount)
    const maxPrice = parseFloat(p.priceRange.maxVariantPrice.amount)
    const currency: string = p.priceRange.minVariantPrice.currencyCode

    const compareAt = parseFloat(
      p.compareAtPriceRange?.minVariantPrice?.amount ?? 0
    )
    const onSale = compareAt > 0 && compareAt > minPrice

    return {
      id: p.id,
      title: p.title,
      description: p.description,
      category: p.productType || (collections[0] ?? 'Product'),
      vendor: p.vendor,
      tags: p.tags,
      collections,
      availableForSale: p.availableForSale,
      totalInventory: p.totalInventory,
      price: formatPrice(minPrice, currency),
      priceMax: minPrice !== maxPrice ? formatPrice(maxPrice, currency) : null,
      compareAtPrice: onSale ? formatPrice(compareAt, currency) : null,
      onSale,
      variants,
      variantCount: variants.length,
      image: images[0]?.url ?? null,
      images,
      bestSellerRank: index + 1,
    }
  })
}

function formatPrice(amount: number, currency: string): string | null {
  if (isNaN(amount)) return null
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: currency || 'USD',
    minimumFractionDigits: 2,
  }).format(amount)
}
