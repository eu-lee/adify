"use client"

import { useState, useMemo, useEffect, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { fetchStorefrontProducts } from '@/lib/storefront'
import { MOCK_PRODUCTS } from '@/data/products'
import { hasAd, saveAd, removeAd, getStoreAds } from '@/lib/adStore'
import { supabase } from '@/lib/supabase'

interface Product {
  id: string | number
  title: string
  price?: string | null
  priceMax?: string | null
  compareAtPrice?: string | null
  onSale?: boolean
  image?: string | null
  category?: string
  vendor?: string
  tags?: string[]
  availableForSale?: boolean
  totalInventory?: number | null
  variantCount?: number
  variants?: unknown[]
  collections?: string[]
  images?: unknown[]
  description?: string
  bestSellerRank?: number
}

interface StoreData {
  storeName: string
  baseUrl: string
  storefrontToken: string | null
  products: Product[]
}

function SearchIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" />
    </svg>
  )
}

const SORTS = [
  { key: 'BEST_SELLING', label: 'Best Selling', apiKey: true },
  { key: 'NEWEST',       label: 'Newest',       apiKey: true },
  { key: 'PRICE_ASC',    label: 'Price ↑',      apiKey: true },
  { key: 'PRICE_DESC',   label: 'Price ↓',      apiKey: true },
  { key: 'TITLE',        label: 'A – Z',         apiKey: false },
]

function clientSort(products: Product[], sortKey: string) {
  const clone = [...products]
  const price = (p: Product) => parseFloat(p.price?.replace(/[^0-9.]/g, '') ?? '0')
  if (sortKey === 'PRICE_ASC') return clone.sort((a, b) => price(a) - price(b))
  if (sortKey === 'PRICE_DESC') return clone.sort((a, b) => price(b) - price(a))
  if (sortKey === 'TITLE') return clone.sort((a, b) => a.title.localeCompare(b.title))
  return clone
}

function Badge({ children, color = '#2a2a2a', textColor = '#666' }: { children: React.ReactNode; color?: string; textColor?: string }) {
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

function InventoryBar({ total }: { total: number | null | undefined }) {
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

function ProductCard({ product, rank, hasStorefrontData, storeDomain, onAdChange }: {
  product: Product;
  rank: number;
  hasStorefrontData: boolean;
  storeDomain: string;
  onAdChange?: () => void;
}) {
  const [hovered, setHovered] = useState(false)
  const [adHovered, setAdHovered] = useState(false)
  const [adExists, setAdExists] = useState(() => hasAd(storeDomain, product.id))

  function handleGenerateAd() {
    saveAd(storeDomain, product.id, { productTitle: product.title })
    setAdExists(true)
    onAdChange?.()
  }

  function handleRemoveAd(e: React.MouseEvent) {
    e.stopPropagation()
    removeAd(storeDomain, product.id)
    setAdExists(false)
    onAdChange?.()
  }

  const isBestSeller = hasStorefrontData && rank <= 3
  const isLowStock = hasStorefrontData && product.totalInventory !== null && product.totalInventory !== undefined && product.totalInventory > 0 && product.totalInventory < 10
  const isSoldOut = hasStorefrontData && product.availableForSale === false
  const isOnSale = product.onSale && product.compareAtPrice

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

        <div style={{ position: 'absolute', top: '10px', left: '10px', display: 'flex', flexDirection: 'column', gap: '4px' }}>
          {isBestSeller && (
            <Badge color="rgba(251,191,36,0.15)" textColor="rgba(251,191,36,0.9)">
              #{rank} Best Seller
            </Badge>
          )}
          {isSoldOut && <Badge color="rgba(80,20,20,0.8)" textColor="#f87171">Sold Out</Badge>}
          {isLowStock && !isSoldOut && <Badge color="rgba(80,50,10,0.8)" textColor="rgba(251,191,36,0.85)">Low Stock</Badge>}
        </div>

        {isOnSale && (
          <div style={{ position: 'absolute', top: '10px', right: '10px' }}>
            <Badge color="rgba(251,113,133,0.15)" textColor="rgba(251,113,133,0.9)">Sale</Badge>
          </div>
        )}
      </div>

      {/* Body */}
      <div style={{ padding: '18px 20px 20px', display: 'flex', flexDirection: 'column', gap: '5px', flex: 1 }}>
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

        {product.variantCount && product.variantCount > 1 && (
          <span className="font-sans" style={{ fontSize: '0.6875rem', color: '#3a3a3a', fontWeight: 300 }}>
            {product.variantCount} variants
          </span>
        )}

        {hasStorefrontData && <InventoryBar total={product.totalInventory} />}

        <div style={{ flex: 1, minHeight: '10px' }} />

        {adExists ? (
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
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
            <button
              onClick={handleRemoveAd}
              className="font-sans"
              style={{
                background: 'none', border: 'none', cursor: 'pointer',
                fontSize: '0.6875rem', color: '#333', fontWeight: 300,
                padding: 0, transition: 'color 0.2s',
              }}
              onMouseEnter={(e) => ((e.target as HTMLElement).style.color = '#666')}
              onMouseLeave={(e) => ((e.target as HTMLElement).style.color = '#333')}
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

export default function ProductLibrary() {
  const router = useRouter()

  const [storeData, setStoreData] = useState<StoreData | null>(null)

  useEffect(() => {
    const raw = sessionStorage.getItem('sonance_store')
    if (raw) {
      try { setStoreData(JSON.parse(raw)) } catch {}
    }
  }, [])

  const storeName = storeData?.storeName ?? 'demo'
  const displayName = storeName.split('.')[0]
  const baseUrl = storeData?.baseUrl ?? null
  const storefrontToken = storeData?.storefrontToken ?? null
  const hasStorefrontData = !!storefrontToken

  const [products, setProducts] = useState<Product[]>([])
  const [search, setSearch] = useState('')
  const [sortKey, setSortKey] = useState('BEST_SELLING')
  const [loading, setLoading] = useState(false)
  const [adCount, setAdCount] = useState(0)
  const [hasVideoMap, setHasVideoMap] = useState<Record<string, boolean>>({})
  const [videoFilter, setVideoFilter] = useState<'all' | 'has_video' | 'no_video'>('all')

  useEffect(() => {
    if (storeData?.products) setProducts(storeData.products)
    else setProducts(MOCK_PRODUCTS)
  }, [storeData])

  useEffect(() => {
    setAdCount(Object.keys(getStoreAds(storeName)).length)
  }, [storeName])

  useEffect(() => {
    if (!storeName || storeName === 'demo') return
    supabase
      .from('products')
      .select('id, has_video')
      .eq('storefront_id', storeName)
      .then(({ data }) => {
        if (!data) return
        const map: Record<string, boolean> = {}
        data.forEach((row) => { map[row.id] = row.has_video })
        setHasVideoMap(map)
      })
  }, [storeName])

  const handleAdChange = useCallback(() => {
    setAdCount(Object.keys(getStoreAds(storeName)).length)
  }, [storeName])

  const handleSort = async (key: string) => {
    setSortKey(key)
    const sortDef = SORTS.find((s) => s.key === key)

    if (sortDef?.apiKey && storefrontToken && baseUrl) {
      setLoading(true)
      try {
        const freshProducts = await fetchStorefrontProducts(baseUrl, storefrontToken, key)
        setProducts(freshProducts)
      } catch {
        setProducts((prev) => clientSort(prev, key))
      } finally {
        setLoading(false)
      }
    } else {
      setProducts((prev) => clientSort(prev, key))
    }
  }

  const filtered = useMemo(() => {
    let list = products
    if (search.trim()) {
      const q = search.toLowerCase()
      list = list.filter(
        (p) =>
          p.title.toLowerCase().includes(q) ||
          (p.category && p.category.toLowerCase().includes(q)) ||
          (p.vendor && p.vendor.toLowerCase().includes(q)) ||
          (p.tags && p.tags.some((t) => t.toLowerCase().includes(q)))
      )
    }
    const numericId = (p: Product) => { const s = String(p.id); return s.includes('/') ? s.split('/').pop()! : s }
    if (videoFilter === 'has_video') list = list.filter((p) => hasVideoMap[numericId(p)])
    if (videoFilter === 'no_video') list = list.filter((p) => !hasVideoMap[numericId(p)])
    return list
  }, [products, search, videoFilter, hasVideoMap])

  return (
    <div style={{ minHeight: '100vh', background: '#0a0a0a', display: 'flex', flexDirection: 'column' }}>
      {/* Nav */}
      <nav style={{ display: 'grid', gridTemplateColumns: '1fr auto 1fr', alignItems: 'center', padding: '28px 48px' }}>
        <span
          className="font-serif"
          style={{ fontSize: '1.25rem', fontWeight: 400, letterSpacing: '0.04em', color: '#fff', cursor: 'pointer' }}
          onClick={() => router.push('/')}
        >
          sonance
        </span>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', justifyContent: 'center' }}>
          {adCount > 0 && (
            <span className="font-sans" style={{ fontSize: '0.75rem', color: 'rgba(251,191,36,0.7)', fontWeight: 400 }}>
              {adCount} ad{adCount !== 1 ? 's' : ''} ready ·
            </span>
          )}
          <span className="font-sans" style={{ fontSize: '0.8125rem', color: '#555', fontWeight: 300 }}>
            {displayName}
          </span>
        </div>
        <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
          <button
            onClick={() => { sessionStorage.removeItem('sonance_store'); router.push('/') }}
            className="font-sans"
            style={{
              background: 'none',
              border: '1px solid rgba(255,255,255,0.08)',
              borderRadius: '8px',
              padding: '6px 14px',
              fontSize: '0.75rem',
              color: '#555',
              fontWeight: 300,
              cursor: 'pointer',
              transition: 'color 0.2s, border-color 0.2s',
            }}
            onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.color = '#999'; (e.currentTarget as HTMLElement).style.borderColor = 'rgba(255,255,255,0.18)' }}
            onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.color = '#555'; (e.currentTarget as HTMLElement).style.borderColor = 'rgba(255,255,255,0.08)' }}
          >
            Disconnect
          </button>
        </div>
      </nav>

      {/* Shop heading */}
      <div style={{ padding: '40px 48px 0' }}>
        <h2
          className="font-serif"
          style={{ fontSize: 'clamp(2rem, 4vw, 3rem)', fontWeight: 300, letterSpacing: '-0.02em', color: '#fff', margin: 0, lineHeight: 1.1 }}
        >
          {displayName}
        </h2>
      </div>

      {/* Toolbar */}
      <div style={{ padding: '32px 48px 0', display: 'flex', alignItems: 'center', gap: '16px', flexWrap: 'wrap', marginBottom: '40px' }}>
        {/* Search */}
        <div style={{ position: 'relative', flex: 1, minWidth: '200px', maxWidth: '360px' }}>
          <span style={{ position: 'absolute', left: '14px', top: '50%', transform: 'translateY(-50%)', color: '#444', pointerEvents: 'none' }}>
            <SearchIcon />
          </span>
          <input
            className="input-dark font-sans"
            type="text"
            placeholder="Search products…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            style={{ width: '100%', paddingLeft: '38px', fontSize: '0.8125rem' }}
          />
        </div>

        {/* Sort pills */}
        <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
          {SORTS.map((s) => (
            <button
              key={s.key}
              onClick={() => handleSort(s.key)}
              className="font-sans"
              style={{
                background: sortKey === s.key ? 'rgba(255,255,255,0.08)' : 'transparent',
                border: `1px solid ${sortKey === s.key ? 'rgba(255,255,255,0.12)' : 'rgba(255,255,255,0.05)'}`,
                borderRadius: '8px',
                padding: '6px 14px',
                fontSize: '0.6875rem',
                fontWeight: 400,
                color: sortKey === s.key ? '#ccc' : '#444',
                cursor: 'pointer',
                transition: 'all 0.2s',
                letterSpacing: '0.02em',
              }}
            >
              {s.label}
            </button>
          ))}
        </div>

        {/* Video filter */}
        <div style={{ display: 'flex', gap: '6px' }}>
          {([
            { key: 'all', label: 'All' },
            { key: 'has_video', label: 'Has Ad(s)' },
            { key: 'no_video', label: 'No Ads' },
          ] as const).map((f) => (
            <button
              key={f.key}
              onClick={() => setVideoFilter(f.key)}
              className="font-sans"
              style={{
                background: videoFilter === f.key ? 'rgba(255,255,255,0.08)' : 'transparent',
                border: `1px solid ${videoFilter === f.key ? 'rgba(255,255,255,0.12)' : 'rgba(255,255,255,0.05)'}`,
                borderRadius: '8px',
                padding: '6px 14px',
                fontSize: '0.6875rem',
                fontWeight: 400,
                color: videoFilter === f.key ? '#ccc' : '#444',
                cursor: 'pointer',
                transition: 'all 0.2s',
                letterSpacing: '0.02em',
              }}
            >
              {f.label}
            </button>
          ))}
        </div>

        {/* Product count */}
        <span className="font-sans" style={{ fontSize: '0.6875rem', color: '#333', fontWeight: 300, marginLeft: 'auto' }}>
          {filtered.length} product{filtered.length !== 1 ? 's' : ''}
        </span>
      </div>

      {/* Grid */}
      <main style={{ padding: '0 48px 80px', flex: 1 }}>
        {loading ? (
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '80px 0' }}>
            <span className="font-sans" style={{ fontSize: '0.8125rem', color: '#444', fontWeight: 300 }}>Loading…</span>
          </div>
        ) : filtered.length === 0 ? (
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '80px 0' }}>
            <span className="font-sans" style={{ fontSize: '0.8125rem', color: '#333', fontWeight: 300 }}>
              {search ? 'No products match your search.' : 'No products found.'}
            </span>
          </div>
        ) : (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: '16px' }}>
            {filtered.map((product, i) => (
              <ProductCard
                key={product.id}
                product={product}
                rank={i + 1}
                hasStorefrontData={hasStorefrontData}
                storeDomain={storeName}
                onAdChange={handleAdChange}
              />
            ))}
          </div>
        )}
      </main>

      <style>{`
        @media (max-width:600px) { nav { padding:20px 24px !important; } }
      `}</style>
    </div>
  )
}
