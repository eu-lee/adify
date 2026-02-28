import { useState, useMemo } from 'react'
import { useNavigate, useLocation } from 'react-router-dom'
import { fetchStorefrontProducts } from '../lib/storefront.js'
import { MOCK_PRODUCTS } from '../data/products.js'
import { hasAd, saveAd, removeAd, getStoreAds } from '../lib/adStore.js'

// ─── Icons ────────────────────────────────────────────────────────────────────

function SearchIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" />
    </svg>
  )
}

// ─── Sort config ──────────────────────────────────────────────────────────────

const SORTS = [
  { key: 'BEST_SELLING', label: 'Best Selling', apiKey: true },
  { key: 'NEWEST',       label: 'Newest',       apiKey: true },
  { key: 'PRICE_ASC',    label: 'Price ↑',      apiKey: true },
  { key: 'PRICE_DESC',   label: 'Price ↓',      apiKey: true },
  { key: 'TITLE',        label: 'A – Z',         apiKey: false },
]

// Client-side sort fallback (used when no storefront token)
function clientSort(products, sortKey) {
  const clone = [...products]
  const price = (p) => parseFloat(p.price?.replace(/[^0-9.]/g, '') ?? 0)
  if (sortKey === 'PRICE_ASC') return clone.sort((a, b) => price(a) - price(b))
  if (sortKey === 'PRICE_DESC') return clone.sort((a, b) => price(b) - price(a))
  if (sortKey === 'TITLE') return clone.sort((a, b) => a.title.localeCompare(b.title))
  return clone // BEST_SELLING / NEWEST come pre-sorted from API
}

// ─── Stat badge ───────────────────────────────────────────────────────────────

function Badge({ children, color = '#2a2a2a', textColor = '#666' }) {
  return (
    <span
      className="font-sans"
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        fontSize: '0.625rem',
        fontWeight: 500,
        letterSpacing: '0.08em',
        textTransform: 'uppercase',
        color: textColor,
        background: color,
        borderRadius: '4px',
        padding: '2px 7px',
        lineHeight: 1.6,
      }}
    >
      {children}
    </span>
  )
}

// ─── Inventory bar ────────────────────────────────────────────────────────────

function InventoryBar({ total }) {
  if (total === null || total === undefined) return null
  const capped = Math.min(total, 100)
  const pct = (capped / 100) * 100
  const color = total === 0 ? '#3a1a1a' : total < 10 ? 'rgba(251,191,36,0.35)' : 'rgba(255,255,255,0.08)'
  const fill = total === 0 ? '#5a2020' : total < 10 ? 'rgba(251,191,36,0.7)' : 'rgba(255,255,255,0.18)'

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginTop: '2px' }}>
      <div style={{ flex: 1, height: '2px', background: color, borderRadius: '2px', overflow: 'hidden' }}>
        <div style={{ width: `${pct}%`, height: '100%', background: fill, borderRadius: '2px', transition: 'width 0.4s ease' }} />
      </div>
      <span className="font-sans" style={{ fontSize: '0.625rem', color: '#444', fontWeight: 400, whiteSpace: 'nowrap' }}>
        {total === 0 ? 'sold out' : `${total} in stock`}
      </span>
    </div>
  )
}

// ─── Product card ─────────────────────────────────────────────────────────────

function ProductCard({ product, rank, hasStorefrontData, storeDomain, onAdChange }) {
  const [hovered, setHovered]     = useState(false)
  const [adHovered, setAdHovered] = useState(false)
  const [adExists, setAdExists]   = useState(() => hasAd(storeDomain, product.id))

  function handleGenerateAd() {
    saveAd(storeDomain, product.id, { productTitle: product.title })
    setAdExists(true)
    onAdChange?.()
  }

  function handleRemoveAd(e) {
    e.stopPropagation()
    removeAd(storeDomain, product.id)
    setAdExists(false)
    onAdChange?.()
  }

  const isBestSeller  = hasStorefrontData && rank <= 3
  const isLowStock    = hasStorefrontData && product.totalInventory !== null && product.totalInventory > 0 && product.totalInventory < 10
  const isSoldOut     = hasStorefrontData && product.availableForSale === false
  const isOnSale      = product.onSale && product.compareAtPrice

  return (
    <div
      className="card-product"
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{ display: 'flex', flexDirection: 'column', opacity: isSoldOut ? 0.5 : 1 }}
    >
      {/* Image */}
      <div style={{ width: '100%', aspectRatio: '6/5', overflow: 'hidden', background: '#0f0f0f', flexShrink: 0, position: 'relative' }}>
        {product.image ? (
          <img
            src={product.image}
            alt={product.title}
            style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block', transition: 'transform 0.5s ease', transform: hovered ? 'scale(1.04)' : 'scale(1)' }}
            loading="lazy"
          />
        ) : (
          <div style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <span style={{ fontSize: '0.7rem', color: '#333', fontFamily: "'DM Sans', sans-serif" }}>No image</span>
          </div>
        )}

        {/* Overlay badges (top-left) */}
        <div style={{ position: 'absolute', top: '10px', left: '10px', display: 'flex', flexDirection: 'column', gap: '4px' }}>
          {isBestSeller && (
            <Badge color="rgba(251,191,36,0.15)" textColor="rgba(251,191,36,0.9)">
              #{rank} Best Seller
            </Badge>
          )}
          {isSoldOut && <Badge color="rgba(80,20,20,0.8)" textColor="#f87171">Sold Out</Badge>}
          {isLowStock && !isSoldOut && <Badge color="rgba(80,50,10,0.8)" textColor="rgba(251,191,36,0.85)">Low Stock</Badge>}
        </div>

        {/* Sale badge (top-right) */}
        {isOnSale && (
          <div style={{ position: 'absolute', top: '10px', right: '10px' }}>
            <Badge color="rgba(251,113,133,0.15)" textColor="rgba(251,113,133,0.9)">Sale</Badge>
          </div>
        )}
      </div>

      {/* Body */}
      <div style={{ padding: '18px 20px 20px', display: 'flex', flexDirection: 'column', gap: '5px', flex: 1 }}>
        {/* Category / vendor row */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
          {product.category && (
            <span className="font-sans" style={{ fontSize: '0.5625rem', fontWeight: 400, letterSpacing: '0.12em', textTransform: 'uppercase', color: '#444' }}>
              {product.category}
            </span>
          )}
          {product.vendor && product.vendor !== product.category && (
            <>
              <span style={{ color: '#2a2a2a', fontSize: '0.5625rem' }}>·</span>
              <span className="font-sans" style={{ fontSize: '0.5625rem', fontWeight: 400, letterSpacing: '0.08em', color: '#333' }}>
                {product.vendor}
              </span>
            </>
          )}
        </div>

        <h3 className="font-sans" style={{ fontSize: '0.9375rem', fontWeight: 500, color: isSoldOut ? '#555' : '#fff', margin: 0, lineHeight: 1.35 }}>
          {product.title}
        </h3>

        {/* Price row */}
        <div style={{ display: 'flex', alignItems: 'baseline', gap: '6px' }}>
          {product.price && (
            <span className="font-sans" style={{ fontSize: '0.8125rem', color: isOnSale ? 'rgba(251,113,133,0.85)' : '#666', fontWeight: isOnSale ? 500 : 300 }}>
              {product.price}
              {product.priceMax && <span style={{ fontWeight: 300, color: '#555' }}> – {product.priceMax}</span>}
            </span>
          )}
          {isOnSale && (
            <span className="font-sans" style={{ fontSize: '0.75rem', color: '#3a3a3a', fontWeight: 300, textDecoration: 'line-through' }}>
              {product.compareAtPrice}
            </span>
          )}
        </div>

        {/* Variant count */}
        {product.variantCount > 1 && (
          <span className="font-sans" style={{ fontSize: '0.6875rem', color: '#3a3a3a', fontWeight: 300 }}>
            {product.variantCount} variants
          </span>
        )}

        {/* Inventory bar — only when we have real data */}
        {hasStorefrontData && <InventoryBar total={product.totalInventory} />}

        <div style={{ flex: 1, minHeight: '10px' }} />

        {/* CTA */}
        {adExists ? (
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            {/* Ad ready state */}
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
              <span style={{
                width: '6px', height: '6px', borderRadius: '50%',
                background: 'rgba(251,191,36,0.8)',
                boxShadow: '0 0 6px rgba(251,191,36,0.5)',
                flexShrink: 0,
              }} />
              <span className="font-sans" style={{ fontSize: '0.8125rem', color: 'rgba(251,191,36,0.75)', fontWeight: 400 }}>
                Ad ready
              </span>
            </div>
            {/* Remove / regenerate */}
            <button
              onClick={handleRemoveAd}
              className="font-sans"
              style={{
                background: 'none', border: 'none', cursor: 'pointer',
                fontSize: '0.6875rem', color: '#333', fontWeight: 300,
                padding: 0, transition: 'color 0.2s',
              }}
              onMouseEnter={(e) => (e.target.style.color = '#666')}
              onMouseLeave={(e) => (e.target.style.color = '#333')}
            >
              Remove
            </button>
          </div>
        ) : (
          <button
            onMouseEnter={() => setAdHovered(true)}
            onMouseLeave={() => setAdHovered(false)}
            onClick={handleGenerateAd}
            disabled={isSoldOut}
            style={{
              background: 'transparent', border: 'none', padding: 0,
              cursor: isSoldOut ? 'not-allowed' : 'pointer',
              display: 'flex', alignItems: 'center', gap: '6px',
              fontFamily: "'DM Sans', sans-serif", fontSize: '0.8125rem', fontWeight: 400,
              color: adHovered && !isSoldOut ? '#fff' : '#444',
              transition: 'color 0.25s', letterSpacing: '0.01em',
            }}
          >
            <span style={{
              width: '20px', height: '20px', borderRadius: '50%',
              border: `1px solid ${adHovered && !isSoldOut ? 'rgba(255,255,255,0.3)' : 'rgba(255,255,255,0.1)'}`,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              flexShrink: 0, transition: 'border-color 0.25s',
            }}>
              <svg width="7" height="7" viewBox="0 0 8 8" fill={adHovered && !isSoldOut ? '#fff' : '#555'} style={{ transition: 'fill 0.25s', marginLeft: '1px' }}>
                <polygon points="0,0 8,4 0,8" />
              </svg>
            </span>
            Generate Ad
          </button>
        )}
      </div>
    </div>
  )
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function ProductLibrary() {
  const [query, setQuery]     = useState('')
  const [sortKey, setSortKey] = useState('BEST_SELLING')
  const [refetching, setRefetching] = useState(false)
  const navigate = useNavigate()
  const location = useLocation()

  const storeName        = location.state?.storeName ?? 'demo'
  const baseUrl          = location.state?.baseUrl ?? null
  const storefrontToken  = location.state?.storefrontToken ?? null
  const hasStorefrontData = !!storefrontToken

  const [products, setProducts] = useState(location.state?.products ?? MOCK_PRODUCTS)
  // Re-render when ads change by tracking count
  const [adCount, setAdCount] = useState(() => Object.keys(getStoreAds(storeName)).length)

  function onAdChange() {
    setAdCount(Object.keys(getStoreAds(storeName)).length)
  }

  // When sort changes and we have the Storefront API, refetch with the server sort
  const handleSort = async (key) => {
    setSortKey(key)
    if (!hasStorefrontData || !baseUrl) return

    setRefetching(true)
    try {
      const fresh = await fetchStorefrontProducts(baseUrl, storefrontToken, key)
      setProducts(fresh)
    } catch {
      // silently keep current products if refetch fails
    } finally {
      setRefetching(false)
    }
  }

  const displayed = useMemo(() => {
    const filtered = products.filter((p) => {
      const q = query.toLowerCase()
      return (
        p.title.toLowerCase().includes(q) ||
        (p.category || '').toLowerCase().includes(q) ||
        (p.vendor || '').toLowerCase().includes(q) ||
        (p.tags || []).some((t) => t.toLowerCase().includes(q))
      )
    })
    // Client-side sort when no API token
    return hasStorefrontData ? filtered : clientSort(filtered, sortKey)
  }, [products, query, sortKey, hasStorefrontData])

  return (
    <div style={{ minHeight: '100vh', background: '#0a0a0a', animation: 'fadeIn 0.45s ease forwards' }}>

      {/* Header */}
      <header style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '26px 48px', borderBottom: '1px solid #141414' }}>
        <span className="font-serif" style={{ fontSize: '1.1875rem', fontWeight: 400, letterSpacing: '0.04em', color: '#fff' }}>
          sonance
        </span>
        {storeName && (
          <span className="font-sans" style={{ fontSize: '0.8125rem', color: '#555', fontWeight: 300, letterSpacing: '0.02em' }}>
            {storeName}
          </span>
        )}
        <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
          {adCount > 0 && (
            <span className="font-sans" style={{ fontSize: '0.75rem', color: 'rgba(251,191,36,0.6)', fontWeight: 300 }}>
              {adCount} ad{adCount !== 1 ? 's' : ''} generated
            </span>
          )}
          <button className="btn-ghost" onClick={() => navigate('/')}>Disconnect</button>
        </div>
      </header>

      <main style={{ padding: '56px 48px 80px', maxWidth: '1280px', margin: '0 auto' }}>

        {/* Heading + search */}
        <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', marginBottom: '32px', flexWrap: 'wrap', gap: '20px' }}>
          <h2 className="font-serif" style={{ fontSize: 'clamp(1.75rem, 3.5vw, 2.75rem)', fontWeight: 400, letterSpacing: '-0.01em', color: '#fff', margin: 0, lineHeight: 1.15 }}>
            Your products
          </h2>
          <div style={{ position: 'relative', display: 'flex', alignItems: 'center' }}>
            <span style={{ position: 'absolute', left: '16px', color: '#444', display: 'flex', alignItems: 'center', pointerEvents: 'none' }}>
              <SearchIcon />
            </span>
            <input
              type="text"
              placeholder="Search products…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              style={{
                background: '#141414', border: '1px solid #2a2a2a', color: '#fff', borderRadius: '9999px',
                padding: '10px 20px 10px 40px', fontSize: '0.8125rem', fontFamily: "'DM Sans', sans-serif",
                fontWeight: 300, outline: 'none', width: '220px', transition: 'border-color 0.3s',
              }}
              onFocus={(e) => (e.target.style.borderColor = 'rgba(255,255,255,0.2)')}
              onBlur={(e) => (e.target.style.borderColor = '#2a2a2a')}
            />
          </div>
        </div>

        {/* Sort pills */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '28px', flexWrap: 'wrap' }}>
          {SORTS.map((s) => {
            const active = sortKey === s.key
            const disabled = refetching
            return (
              <button
                key={s.key}
                onClick={() => handleSort(s.key)}
                disabled={disabled}
                className="font-sans"
                style={{
                  background: active ? 'rgba(255,255,255,0.07)' : 'transparent',
                  border: `1px solid ${active ? 'rgba(255,255,255,0.18)' : '#222'}`,
                  color: active ? '#fff' : '#555',
                  borderRadius: '9999px',
                  padding: '5px 14px',
                  fontSize: '0.75rem',
                  fontWeight: active ? 500 : 300,
                  cursor: disabled ? 'not-allowed' : 'pointer',
                  transition: 'all 0.2s',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '5px',
                  opacity: disabled ? 0.5 : 1,
                }}
                onMouseEnter={(e) => { if (!active && !disabled) e.currentTarget.style.color = '#888' }}
                onMouseLeave={(e) => { if (!active && !disabled) e.currentTarget.style.color = '#555' }}
              >
                {s.key === 'BEST_SELLING' && <span style={{ fontSize: '0.6rem' }}>↑</span>}
                {s.label}
                {s.key !== 'BEST_SELLING' && !hasStorefrontData && (
                  <span style={{ fontSize: '0.55rem', color: '#333', marginLeft: '1px' }}>client</span>
                )}
              </button>
            )
          })}

          {!hasStorefrontData && (
            <span className="font-sans" style={{ fontSize: '0.6875rem', color: '#2e2e2e', fontWeight: 300, marginLeft: '4px' }}>
              · Add a Storefront Token for server-side sorting &amp; inventory
            </span>
          )}

          {refetching && (
            <span className="font-sans" style={{ fontSize: '0.6875rem', color: '#444', fontWeight: 300, marginLeft: '4px' }}>
              Loading…
            </span>
          )}
        </div>

        {/* Count row */}
        <p className="font-sans" style={{ fontSize: '0.75rem', color: '#2e2e2e', fontWeight: 400, marginBottom: '32px', letterSpacing: '0.08em', textTransform: 'uppercase' }}>
          {displayed.length} product{displayed.length !== 1 ? 's' : ''}
          {!hasStorefrontData && <span style={{ color: '#222', marginLeft: '10px' }}>· demo / basic data</span>}
        </p>

        {/* Grid */}
        {displayed.length > 0 ? (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: '28px', opacity: refetching ? 0.4 : 1, transition: 'opacity 0.2s' }}>
            {displayed.map((product, i) => (
              <div key={product.id} style={{ animation: 'fadeUp 0.5s ease forwards', animationDelay: `${i * 50}ms`, opacity: 0 }}>
                <ProductCard
                  product={product}
                  rank={i + 1}
                  hasStorefrontData={hasStorefrontData}
                  storeDomain={storeName}
                  onAdChange={onAdChange}
                />
              </div>
            ))}
          </div>
        ) : (
          <div style={{ textAlign: 'center', padding: '80px 0', color: '#333' }}>
            <p className="font-sans" style={{ fontSize: '0.9rem', fontWeight: 300 }}>No products match "{query}"</p>
          </div>
        )}
      </main>

      <style>{`
        @keyframes fadeIn  { 0%{opacity:0} 100%{opacity:1} }
        @keyframes fadeUp  { 0%{opacity:0;transform:translateY(20px)} 100%{opacity:1;transform:translateY(0)} }
        @media (max-width:768px) { header{padding:20px 24px!important} main{padding:40px 24px 60px!important} }
        @media (max-width:480px) { header span:nth-child(2){display:none} }
      `}</style>
    </div>
  )
}
