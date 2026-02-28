const API_VERSION = '2025-01'

export const SORT_KEYS = {
  BEST_SELLING: 'BEST_SELLING',
  NEWEST: 'CREATED_AT',
  PRICE_ASC: 'PRICE',
  PRICE_DESC: 'PRICE', // same key, reverse flag differs
  TITLE: 'TITLE',
}

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

export async function fetchStorefrontProducts(baseUrl, token, sortKey = 'BEST_SELLING', limit = 48) {
  const endpoint = `${baseUrl}/api/${API_VERSION}/graphql.json`
  const reverse = sortKey === 'PRICE_DESC'
  const gqlSortKey = SORT_KEYS[sortKey] ?? 'BEST_SELLING'

  let res
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
  } catch (err) {
    if (err.name === 'TimeoutError') throw new Error('The store took too long to respond.')
    throw new Error('Could not reach the store. Check the URL and try again.')
  }

  if (res.status === 401 || res.status === 403) {
    throw new Error('Access denied — check your Storefront token and that the app is installed.')
  }
  if (!res.ok) throw new Error(`Store returned an error (${res.status}).`)

  const json = await res.json()

  // Log raw response to console for debugging
  if (json.errors?.length) {
    console.error('[Storefront API] Errors:', json.errors)
    const msg = json.errors[0]?.message ?? 'Unknown error'
    throw new Error(`Shopify: ${msg}`)
  }

  const edges = json?.data?.products?.edges
  if (!Array.isArray(edges)) throw new Error("Couldn't read products from the Storefront API.")

  return edges.map(({ node: p }, index) => {
    const variants = p.variants.edges.map((e) => e.node)
    const images = p.images.edges.map((e) => e.node)
    const collections = p.collections.edges.map((e) => e.node.title)

    const minPrice = parseFloat(p.priceRange.minVariantPrice.amount)
    const maxPrice = parseFloat(p.priceRange.maxVariantPrice.amount)
    const currency = p.priceRange.minVariantPrice.currencyCode

    const compareAt = parseFloat(p.compareAtPriceRange?.minVariantPrice?.amount ?? 0)
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
      // Pricing
      price: formatPrice(minPrice, currency),
      priceMax: minPrice !== maxPrice ? formatPrice(maxPrice, currency) : null,
      compareAtPrice: onSale ? formatPrice(compareAt, currency) : null,
      onSale,
      // Variants
      variants,
      variantCount: variants.length,
      // Images
      image: images[0]?.url ?? null,
      images,
      // Ranking
      bestSellerRank: index + 1,
    }
  })
}

function formatPrice(amount, currency) {
  if (isNaN(amount)) return null
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: currency || 'USD',
    minimumFractionDigits: 2,
  }).format(amount)
}
