"use client"

import { useState, useMemo, useEffect, useCallback, useRef } from 'react'
import { useRouter } from 'next/navigation'
import { fetchStorefrontProducts } from '@/lib/storefront'
import { MOCK_PRODUCTS } from '@/data/products'
import { saveAd, getStoreAds } from '@/lib/adStore'
import { supabase } from '@/lib/supabase'

function base64ToBlob(b64: string, mime: string): Blob {
  const bytes = Uint8Array.from(atob(b64), c => c.charCodeAt(0))
  return new Blob([bytes], { type: mime })
}

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

// ─── Icons ────────────────────────────────────────────────────────────────────

function SearchIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" />
    </svg>
  )
}

function UploadIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="16 16 12 12 8 16" /><line x1="12" y1="12" x2="12" y2="21" />
      <path d="M20.39 18.39A5 5 0 0 0 18 9h-1.26A8 8 0 1 0 3 16.3" />
    </svg>
  )
}

function Spinner({ size = 14, color = 'rgba(0,0,0,0.5)', topColor = '#0a0a0a' }: { size?: number; color?: string; topColor?: string }) {
  return (
    <span style={{ width: `${size}px`, height: `${size}px`, border: `1.5px solid ${color}`, borderTopColor: topColor, borderRadius: '50%', display: 'inline-block', animation: 'spin 0.7s linear infinite', flexShrink: 0 }} />
  )
}

// ─── Shared components ────────────────────────────────────────────────────────

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
        display: 'inline-flex', alignItems: 'center',
        fontSize: '0.625rem', fontWeight: 500, letterSpacing: '0.08em', textTransform: 'uppercase',
        color: textColor, background: color, borderRadius: '4px', padding: '2px 7px', lineHeight: 1.6,
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
  const trackColor = total === 0 ? 'rgba(239,68,68,0.2)' : total < 10 ? 'rgba(251,191,36,0.2)' : 'rgba(134,239,172,0.15)'
  const fillColor = total === 0 ? '#ef4444' : total < 10 ? '#fbbf24' : '#4ade80'
  const textColor = total === 0 ? '#ef4444' : total < 10 ? '#fbbf24' : '#4ade80'
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginTop: '2px' }}>
      <div style={{ flex: 1, height: '2px', background: trackColor, borderRadius: '2px', overflow: 'hidden' }}>
        <div style={{ width: '100%', height: '100%', background: fillColor, borderRadius: '2px' }} />
      </div>
      <span className="font-sans" style={{ fontSize: '0.625rem', color: textColor, fontWeight: 400, whiteSpace: 'nowrap' }}>
        {total === 0 ? 'sold out' : `${total} in stock`}
      </span>
    </div>
  )
}

// ─── Expanded Ad View ─────────────────────────────────────────────────────────

function ExpandedAdView({ product, storeDomain, onClose }: {
  product: Product
  storeDomain: string
  onClose: () => void
}) {
  const [adType, setAdType] = useState<'narrated' | 'music_only'>('narrated')
  const [duration, setDuration] = useState<15 | 30 | 60>(30)
  const [formStatus, setFormStatus] = useState<'idle' | 'analyzing' | 'generating_audio' | 'composing' | 'done' | 'error'>('idle')
  const [errorMsg, setErrorMsg] = useState('')
  const [adVideoUrl, setAdVideoUrl] = useState<string | null>(null)

  // B-roll state
  const [brollLibrary, setBrollLibrary] = useState<{ name: string; url: string }[]>([])
  const [brollLibraryLoading, setBrollLibraryLoading] = useState(true)
  const [selectedBroll, setSelectedBroll] = useState<{ name: string; url: string } | null>(null)
  const [previewClip, setPreviewClip] = useState<{ name: string; url: string } | null>(null)
  const [brollProgress, setBrollProgress] = useState<number | null>(null)
  const [brollError, setBrollError] = useState<string | null>(null)
  const brollInputRef = useRef<HTMLInputElement>(null)

  const raw = String(product.id)
  const numericId = raw.includes('/') ? raw.split('/').pop()! : raw

  async function refreshBrollLibrary(selectName?: string) {
    const { data: files } = await supabase.storage.from('broll').list()
    const productFiles = (files ?? []).filter(f => f.name === numericId || f.name.startsWith(`${numericId}_`))
    if (!productFiles.length) { setBrollLibrary([]); setBrollLibraryLoading(false); return }
    const urls = await Promise.all(
      productFiles.map(async (f) => {
        const { data } = await supabase.storage.from('broll').createSignedUrl(f.name, 3600)
        return data?.signedUrl ? { name: f.name, url: data.signedUrl } : null
      })
    )
    const library = urls.filter(Boolean) as { name: string; url: string }[]
    setBrollLibrary(library)
    if (selectName) {
      const match = library.find(f => f.name === selectName)
      if (match) setSelectedBroll(match)
    } else if (!selectedBroll) {
      // auto-select the one matching this product if it exists
      const match = library.find(f => f.name === numericId)
      if (match) setSelectedBroll(match)
    }
    setBrollLibraryLoading(false)
  }

  useEffect(() => { refreshBrollLibrary() }, [numericId]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    return () => {
      if (adVideoUrl) URL.revokeObjectURL(adVideoUrl)
    }
  }, [adVideoUrl])

  async function handleBrollUpload(file: File) {
    if (!file.type.startsWith('video/')) return
    setBrollError(null)
    setBrollProgress(0)
    const uploadName = `${numericId}_${Date.now()}`

    let fake = 0
    const interval = setInterval(() => {
      fake = Math.min(fake + Math.random() * 18, 90)
      setBrollProgress(Math.round(fake))
    }, 250)

    const { error } = await supabase.storage.from('broll').upload(uploadName, file)
    clearInterval(interval)

    if (error) {
      setBrollError(error.message)
      setBrollProgress(null)
      return
    }

    setBrollProgress(100)
    await refreshBrollLibrary(uploadName)
    setTimeout(() => setBrollProgress(null), 400)
  }

  // Load stored ad analytics
  const storedAd = getStoreAds(storeDomain)[product.id] as Record<string, unknown> | undefined

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!selectedBroll) return
    setErrorMsg('')

    try {
      // ── Step 1: Fetch b-roll blob (needed for later steps too) ──────────────
      setFormStatus('analyzing')
      const videoRes = await fetch(selectedBroll.url)
      const videoBlob = await videoRes.blob()

      // ── Step 2: Analyze video ───────────────────────────────────────────────
      const fd = new FormData()
      fd.append('video', videoBlob, `${numericId}.mp4`)
      fd.append('product', JSON.stringify({ title: product.title, description: product.description ?? product.title, price: product.price ?? '$0' }))
      fd.append('adType', adType)
      fd.append('duration', String(duration))
      const analyzeRes = await fetch('/api/analyze-video', { method: 'POST', body: fd })
      const analyzeData = await analyzeRes.json()
      if (!analyzeRes.ok) throw new Error(analyzeData.error ?? `Server error ${analyzeRes.status}`)

      const { mood, bpm: analyzedBpm, sentences: analyzedSentences, voice, audioAnalysis, cuts } = analyzeData

      // ── Step 3: Generate audio ──────────────────────────────────────────────
      setFormStatus('generating_audio')

      let narrationBlob: Blob | null = null
      let chunkDurations: number[] = []

      if (adType === 'narrated') {
        const audioRes = await fetch('/api/generate-audio', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ sentences: analyzedSentences.map((s: { text: string }) => s.text), voiceId: voice?.elevenlabs_voice_id, segmentDurations: analyzedSentences.map((s: { estimatedDurationSec: number }) => s.estimatedDurationSec) }),
        })
        const audioData = await audioRes.json()
        if (!audioRes.ok) throw new Error(audioData.error ?? `Server error ${audioRes.status}`)
        const { chunks, fullAudioBase64 } = audioData
        narrationBlob = base64ToBlob(fullAudioBase64, 'audio/mpeg')
        chunkDurations = (chunks as Array<{ durationMs: number }>).map(c => c.durationMs)
      }

      const musicRes = await fetch('/api/generate-music', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mood, durationSeconds: duration }),
      })
      if (!musicRes.ok) {
        const musicErr = await musicRes.json()
        throw new Error(musicErr.error ?? `Server error ${musicRes.status}`)
      }
      const musicBlob = await musicRes.blob()

      // ── Step 4: Compose video ───────────────────────────────────────────────
      setFormStatus('composing')

      const composeFd = new FormData()
      composeFd.append('video', videoBlob, `${numericId}.mp4`)
      composeFd.append('music', musicBlob, 'music.wav')
      composeFd.append('adType', adType)
      composeFd.append('audioAnalysis', JSON.stringify(audioAnalysis))

      if (adType === 'narrated') {
        composeFd.append('narration', narrationBlob!, 'narration.mp3')
        composeFd.append('cutList', JSON.stringify(analyzedSentences))
        composeFd.append('chunkDurations', JSON.stringify(chunkDurations))
      } else {
        composeFd.append('cutList', JSON.stringify(cuts))
        composeFd.append('bpm', String(analyzedBpm))
      }

      const composeRes = await fetch('/api/compose-video', { method: 'POST', body: composeFd })
      if (!composeRes.ok) {
        const composeErr = await composeRes.json()
        throw new Error(composeErr.error ?? `Server error ${composeRes.status}`)
      }
      const outputBlob = await composeRes.blob()
      const url = URL.createObjectURL(outputBlob)
      setAdVideoUrl(url)
      saveAd(storeDomain, product.id, { productTitle: product.title, adType, duration, ...analyzeData })
      setFormStatus('done')
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : String(err))
      setFormStatus('error')
    }
  }

  const pill = (label: string, active: boolean, onClick: () => void) => (
    <button key={label} type="button" onClick={onClick} className="font-sans" style={{
      background: active ? 'rgba(255,255,255,0.1)' : 'transparent',
      border: `1px solid ${active ? 'rgba(255,255,255,0.2)' : 'rgba(255,255,255,0.07)'}`,
      borderRadius: '8px', padding: '7px 16px', fontSize: '0.75rem',
      fontWeight: active ? 500 : 300, color: active ? '#fff' : '#555',
      cursor: 'pointer', transition: 'all 0.2s',
    }}>{label}</button>
  )

  const analyticsData = storedAd ?? {}
  const mood = analyticsData.mood as string | undefined
  const bpm = analyticsData.bpm as number | undefined
  const adTypeSaved = analyticsData.adType as string | undefined
  const durationSaved = analyticsData.duration as number | undefined
  const sentences = (analyticsData.sentences as unknown[])?.length
  const cuts = (analyticsData.cuts as unknown[])?.length
  const hasSpeech = (analyticsData.audioAnalysis as Record<string, unknown>)?.hasSpeech
  const generatedAt = analyticsData.generatedAt as string | undefined

  return (
    <>
    <div style={{ display: 'flex', background: '#111', border: '1px solid rgba(255,255,255,0.08)', borderRadius: '12px', overflow: 'hidden', minHeight: '520px', position: 'relative' }}>
      {/* Close button */}
      <button
        onClick={onClose}
        style={{ position: 'absolute', top: '16px', right: '16px', zIndex: 10, background: 'rgba(0,0,0,0.4)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: '50%', width: '28px', height: '28px', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', color: '#666', fontSize: '1rem', lineHeight: 1, transition: 'color 0.2s, border-color 0.2s' }}
        onMouseEnter={e => { (e.currentTarget as HTMLElement).style.color = '#ccc'; (e.currentTarget as HTMLElement).style.borderColor = 'rgba(255,255,255,0.2)' }}
        onMouseLeave={e => { (e.currentTarget as HTMLElement).style.color = '#666'; (e.currentTarget as HTMLElement).style.borderColor = 'rgba(255,255,255,0.08)' }}
      >
        ×
      </button>

      {/* Left: image */}
      <div style={{ width: '380px', flexShrink: 0, position: 'relative', background: '#0f0f0f' }}>
        {product.image ? (
          <img src={product.image} alt={product.title} style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />
        ) : (
          <div style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <span style={{ fontSize: '0.7rem', color: '#333' }}>No image</span>
          </div>
        )}
      </div>

      {/* Right panel */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflowY: 'auto' }}>

        {/* ── Bestsellers — Audio Analytics ── */}
        {(
          <div style={{ padding: '28px 36px', borderBottom: '1px solid rgba(255,255,255,0.06)', background: 'rgba(255,255,255,0.015)' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '16px' }}>
              <span style={{ width: '6px', height: '6px', borderRadius: '50%', background: 'rgba(251,191,36,0.8)', boxShadow: '0 0 6px rgba(251,191,36,0.4)', flexShrink: 0 }} />
              <span className="font-sans" style={{ fontSize: '0.625rem', fontWeight: 500, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'rgba(251,191,36,0.7)' }}>
                Bestsellers — Audio Analytics
              </span>
              {generatedAt && (
                <span className="font-sans" style={{ fontSize: '0.625rem', color: '#333', fontWeight: 300, marginLeft: 'auto' }}>
                  {new Date(generatedAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
                </span>
              )}
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(100px, 1fr))', gap: '8px' }}>
              {[
                { label: 'Mood', value: mood ?? '—' },
                { label: 'BPM', value: bpm != null ? String(bpm) : '—' },
                { label: 'Ad Type', value: adTypeSaved ?? '—' },
                { label: 'Duration', value: durationSaved != null ? `${durationSaved}s` : '—' },
                { label: adTypeSaved === 'narrated' ? 'Sentences' : 'Cuts', value: adTypeSaved === 'narrated' ? (sentences != null ? String(sentences) : '—') : (cuts != null ? String(cuts) : '—') },
                { label: 'Has Speech', value: hasSpeech != null ? (hasSpeech ? 'Yes' : 'No') : '—' },
              ].map(({ label, value }) => (
                <div key={label} style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.05)', borderRadius: '8px', padding: '10px 12px' }}>
                  <p className="font-sans" style={{ fontSize: '0.5rem', color: '#444', fontWeight: 500, letterSpacing: '0.1em', textTransform: 'uppercase', margin: '0 0 4px' }}>{label}</p>
                  <p className="font-sans" style={{ fontSize: '0.875rem', color: '#bbb', fontWeight: 400, margin: 0, textTransform: 'capitalize' }}>{value}</p>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* ── B-Roll ── */}
        <div style={{ padding: '22px 36px', borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '14px' }}>
            <span className="font-sans" style={{ fontSize: '0.625rem', fontWeight: 500, letterSpacing: '0.1em', textTransform: 'uppercase', color: '#555' }}>
              B-Roll
            </span>
            {selectedBroll && (
              <>
                <span style={{ width: '5px', height: '5px', borderRadius: '50%', background: 'rgba(134,239,172,0.8)', boxShadow: '0 0 5px rgba(134,239,172,0.4)', flexShrink: 0 }} />
                <span className="font-sans" style={{ fontSize: '0.625rem', color: '#444', fontWeight: 300 }}>click to preview</span>
              </>
            )}
          </div>

          {brollLibraryLoading ? (
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <Spinner size={12} color="rgba(255,255,255,0.1)" topColor="rgba(255,255,255,0.3)" />
              <span className="font-sans" style={{ fontSize: '0.75rem', color: '#333', fontWeight: 300 }}>Loading library…</span>
            </div>
          ) : (
            <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap', alignItems: 'flex-start' }}>
              {brollLibrary.map((clip) => (
                <div
                  key={clip.name}
                  onClick={() => setPreviewClip(clip)}
                  style={{
                    position: 'relative', cursor: 'pointer', borderRadius: '6px', overflow: 'hidden', flexShrink: 0,
                    outline: selectedBroll?.name === clip.name ? '2px solid rgba(255,255,255,0.9)' : '2px solid transparent',
                    transition: 'outline-color 0.2s',
                  }}
                >
                  <video
                    src={clip.url}
                    style={{ width: '110px', height: '68px', objectFit: 'cover', display: 'block', background: '#0f0f0f' }}
                    muted
                    preload="metadata"
                    onLoadedMetadata={e => { (e.currentTarget as HTMLVideoElement).currentTime = 0.1 }}
                  />
                  {selectedBroll?.name === clip.name && (
                    <div style={{ position: 'absolute', inset: 0, background: 'rgba(255,255,255,0.08)', display: 'flex', alignItems: 'center', justifyContent: 'center', pointerEvents: 'none' }}>
                      <span style={{ fontSize: '0.6rem', color: '#fff', background: 'rgba(0,0,0,0.6)', borderRadius: '4px', padding: '2px 6px', fontFamily: "'DM Sans', sans-serif", fontWeight: 500 }}>Selected</span>
                    </div>
                  )}
                </div>
              ))}

              {/* Upload new tile */}
              <div
                onClick={() => brollInputRef.current?.click()}
                style={{
                  width: '110px', height: '68px', borderRadius: '6px', flexShrink: 0,
                  border: '1.5px dashed rgba(255,255,255,0.1)', cursor: 'pointer',
                  display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: '4px',
                  background: 'transparent', transition: 'border-color 0.2s',
                }}
                onMouseEnter={e => ((e.currentTarget as HTMLElement).style.borderColor = 'rgba(255,255,255,0.25)')}
                onMouseLeave={e => ((e.currentTarget as HTMLElement).style.borderColor = 'rgba(255,255,255,0.1)')}
              >
                {brollProgress !== null ? (
                  <div style={{ width: '80%', display: 'flex', flexDirection: 'column', gap: '5px', alignItems: 'center' }}>
                    <span className="font-sans" style={{ fontSize: '0.5625rem', color: '#555', fontWeight: 300 }}>{brollProgress}%</span>
                    <div style={{ width: '100%', height: '2px', background: 'rgba(255,255,255,0.06)', borderRadius: '2px', overflow: 'hidden' }}>
                      <div style={{ width: `${brollProgress}%`, height: '100%', background: 'rgba(255,255,255,0.3)', borderRadius: '2px', transition: 'width 0.15s ease' }} />
                    </div>
                  </div>
                ) : (
                  <>
                    <span style={{ color: '#333' }}><UploadIcon /></span>
                    <span className="font-sans" style={{ fontSize: '0.5625rem', color: '#444', fontWeight: 300 }}>Upload new</span>
                  </>
                )}
              </div>
            </div>
          )}

          <input ref={brollInputRef} type="file" accept="video/*" style={{ display: 'none' }} onChange={e => { const f = e.target.files?.[0]; if (f) handleBrollUpload(f) }} />
          {brollError && (
            <p className="font-sans" style={{ fontSize: '0.6875rem', color: 'rgba(251,113,133,0.85)', fontWeight: 300, margin: '10px 0 0' }}>{brollError}</p>
          )}
        </div>

        {/* ── Product info + form ── */}
        <div style={{ flex: 1, padding: '28px 48px 28px 36px', display: 'flex', gap: '32px' }}>

          {/* Left: product info + form */}
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: '24px', minWidth: 0 }}>
            {/* Header */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
              {product.category && (
                <span className="font-sans" style={{ fontSize: '0.5625rem', fontWeight: 400, letterSpacing: '0.12em', textTransform: 'uppercase', color: '#444' }}>
                  {product.category}
                </span>
              )}
              <h2 className="font-sans" style={{ fontSize: '1.125rem', fontWeight: 500, color: '#fff', margin: 0, lineHeight: 1.3 }}>
                {product.title}
              </h2>
              {product.price && (
                <span className="font-sans" style={{ fontSize: '0.8125rem', color: '#555', fontWeight: 300 }}>{product.price}</span>
              )}
            </div>

            {/* Form */}
            {(() => {
              const isLoading = formStatus === 'analyzing' || formStatus === 'generating_audio' || formStatus === 'composing'
              if (formStatus === 'done') {
                return (
                  <>
                    {adVideoUrl && (
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
                        <div style={{ width: '100%', aspectRatio: '16/9', background: '#000', borderRadius: '8px', overflow: 'hidden', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                          <video
                            controls
                            src={adVideoUrl}
                            style={{ height: '100%', width: 'auto', borderRadius: '8px', background: '#000' }}
                          />
                        </div>
                        <div style={{ display: 'flex', gap: '12px', alignItems: 'stretch' }}>
                          <a
                            href={`/ad-preview?url=${encodeURIComponent(adVideoUrl)}&title=${encodeURIComponent(product.title)}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="btn-primary"
                            style={{ flex: 1 }}
                          >
                            View Ad
                          </a>
                          <a
                            href={adVideoUrl}
                            download="ad.mp4"
                            className="btn-primary"
                            style={{ flex: 1 }}
                          >
                            Download
                          </a>
                          <button
                            className="btn-primary"
                            onClick={() => setFormStatus('idle')}
                            style={{ flex: 1 }}
                          >
                            Done
                          </button>
                        </div>
                      </div>
                    )}
                    {!adVideoUrl && (
                      <button className="btn-secondary" onClick={() => setFormStatus('idle')}>
                        Done
                      </button>
                    )}
                  </>
                )
              }
              return (
                <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
                  <div style={{ display: 'flex', gap: '32px', flexWrap: 'wrap' }}>
                    <div>
                      <p className="font-sans" style={{ fontSize: '0.6875rem', color: '#555', fontWeight: 400, letterSpacing: '0.08em', textTransform: 'uppercase', margin: '0 0 8px' }}>Ad Type</p>
                      <div style={{ display: 'flex', gap: '6px' }}>
                        {pill('Narrated', adType === 'narrated', () => setAdType('narrated'))}
                        {pill('Music Only', adType === 'music_only', () => setAdType('music_only'))}
                      </div>
                    </div>
                    <div>
                      <p className="font-sans" style={{ fontSize: '0.6875rem', color: '#555', fontWeight: 400, letterSpacing: '0.08em', textTransform: 'uppercase', margin: '0 0 8px' }}>Duration</p>
                      <div style={{ display: 'flex', gap: '6px' }}>
                        {([15, 30, 60] as const).map(d => pill(`${d}s`, duration === d, () => setDuration(d)))}
                      </div>
                    </div>
                  </div>

                  {formStatus === 'error' && errorMsg && (
                    <p className="font-sans" style={{ fontSize: '0.75rem', color: 'rgba(251,113,133,0.85)', fontWeight: 300, margin: 0 }}>{errorMsg}</p>
                  )}

                  <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
                    <button
                      type="submit"
                      disabled={!selectedBroll || isLoading}
                      className="btn-primary font-sans"
                      style={{ opacity: !selectedBroll || isLoading ? 0.5 : 1, cursor: !selectedBroll || isLoading ? 'not-allowed' : 'pointer', display: 'flex', alignItems: 'center', gap: '8px' }}
                    >
                      {isLoading ? (
                        <>
                          <Spinner />
                          {formStatus === 'analyzing' && 'Analyzing video...'}
                          {formStatus === 'generating_audio' && 'Generating audio...'}
                          {formStatus === 'composing' && 'Composing video...'}
                        </>
                      ) : 'Generate Ad →'}
                    </button>
                    {isLoading && (
                      <span className="font-sans" style={{ fontSize: '0.6875rem', color: '#333', fontWeight: 300 }}>Gemini is watching your video — this takes 20–60s</span>
                    )}
                  </div>
                </form>
              )
            })()}
          </div>

          {/* Right: trend graph */}
          {(() => {
            const W = 420, H = 180, pad = { t: 12, r: 4, b: 28, l: 4 }
            const cW = W - pad.l - pad.r
            const cH = H - pad.t - pad.b
            // Sample sales trend data (8 weeks)
            const sales = [28, 41, 35, 58, 47, 72, 63, 80]
            const views = [60, 72, 55, 78, 68, 88, 75, 92]
            const labels = ['W1','W2','W3','W4','W5','W6','W7','W8']
            const maxV = 100
            const toX = (i: number) => pad.l + (i / (sales.length - 1)) * cW
            const toY = (v: number) => pad.t + cH - (v / maxV) * cH
            const linePath = (pts: number[]) =>
              pts.map((v, i) => `${i === 0 ? 'M' : 'L'} ${toX(i).toFixed(1)} ${toY(v).toFixed(1)}`).join(' ')
            const smoothPath = (pts: number[]) => {
              let d = `M ${toX(0).toFixed(1)} ${toY(pts[0]).toFixed(1)}`
              for (let i = 1; i < pts.length; i++) {
                const x0 = toX(i - 1), y0 = toY(pts[i - 1])
                const x1 = toX(i), y1 = toY(pts[i])
                const cx = (x0 + x1) / 2
                d += ` C ${cx.toFixed(1)} ${y0.toFixed(1)}, ${cx.toFixed(1)} ${y1.toFixed(1)}, ${x1.toFixed(1)} ${y1.toFixed(1)}`
              }
              return d
            }
            const salesPath = smoothPath(sales)
            const viewsPath = smoothPath(views)
            const salesFill = salesPath + ` L ${toX(sales.length - 1).toFixed(1)} ${(pad.t + cH).toFixed(1)} L ${toX(0).toFixed(1)} ${(pad.t + cH).toFixed(1)} Z`
            return (
              <div style={{ width: `${W}px`, flexShrink: 0, paddingLeft: '28px', borderLeft: '1px solid rgba(255,255,255,0.05)', display: 'flex', flexDirection: 'column', gap: '10px', minWidth: 0 }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                  <span className="font-sans" style={{ fontSize: '0.5rem', color: '#888', textTransform: 'uppercase', letterSpacing: '0.1em', fontWeight: 500 }}>Sales Trend</span>
                  <div style={{ display: 'flex', gap: '10px', alignItems: 'center' }}>
                    <span style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                      <span style={{ width: '12px', height: '1.5px', background: 'rgba(134,239,172,0.7)', display: 'inline-block', borderRadius: '1px' }} />
                      <span className="font-sans" style={{ fontSize: '0.5rem', color: '#666', fontWeight: 300 }}>Sales</span>
                    </span>
                    <span style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                      <span style={{ width: '12px', height: '1.5px', background: 'rgba(148,163,184,0.5)', display: 'inline-block', borderRadius: '1px', borderTop: '1px dashed rgba(148,163,184,0.5)' }} />
                      <span className="font-sans" style={{ fontSize: '0.5rem', color: '#666', fontWeight: 300 }}>Views</span>
                    </span>
                  </div>
                </div>
                <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} style={{ overflow: 'visible' }}>
                  <defs>
                    <linearGradient id="salesGrad" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="rgba(134,239,172,0.15)" />
                      <stop offset="100%" stopColor="rgba(134,239,172,0)" />
                    </linearGradient>
                  </defs>
                  {/* Grid lines */}
                  {[0.25, 0.5, 0.75, 1].map(f => (
                    <line key={f} x1={pad.l} y1={pad.t + cH * (1 - f)} x2={pad.l + cW} y2={pad.t + cH * (1 - f)}
                      stroke="rgba(255,255,255,0.03)" strokeWidth="1" />
                  ))}
                  {/* Fill */}
                  <path d={salesFill} fill="url(#salesGrad)" />
                  {/* Views line (dashed) */}
                  <path d={viewsPath} fill="none" stroke="rgba(148,163,184,0.25)" strokeWidth="1.5" strokeDasharray="4 4" />
                  {/* Sales line */}
                  <path d={salesPath} fill="none" stroke="rgba(134,239,172,0.7)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                  {/* Dots */}
                  {sales.map((v, i) => (
                    <circle key={i} cx={toX(i)} cy={toY(v)} r="3" fill="rgba(134,239,172,0.85)" />
                  ))}
                  {/* X labels */}
                  {labels.map((l, i) => (
                    <text key={i} x={toX(i)} y={H - 6} textAnchor="middle" fill="#555" fontSize="7" fontFamily="DM Sans, sans-serif">{l}</text>
                  ))}
                </svg>
              </div>
            )
          })()}
        </div>
      </div>
    </div>

    {/* B-roll preview popup */}

    {previewClip && (
      <div
        onClick={() => setPreviewClip(null)}
        style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.85)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 200, padding: '32px', animation: 'fadeIn 0.2s ease forwards' }}
      >
        <div
          onClick={e => e.stopPropagation()}
          style={{ display: 'flex', flexDirection: 'column', gap: '16px', width: '100%', maxWidth: '720px', animation: 'fadeSlideUp 0.25s ease forwards' }}
        >
          <video
            src={previewClip.url}
            style={{ width: '100%', borderRadius: '10px', background: '#0a0a0a', display: 'block', maxHeight: '60vh', objectFit: 'contain' }}
            controls
            autoPlay
            muted
          />
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
            <button
              onClick={() => { setSelectedBroll(previewClip); setPreviewClip(null) }}
              className="btn-primary font-sans"
              style={{ flex: 1 }}
            >
              {selectedBroll?.name === previewClip.name ? 'Selected ✓' : 'Use this clip'}
            </button>
            <button
              onClick={() => setPreviewClip(null)}
              className="font-sans"
              style={{ background: 'none', border: '1px solid rgba(255,255,255,0.08)', borderRadius: '10px', padding: '10px 20px', color: '#555', fontSize: '0.8125rem', cursor: 'pointer', transition: 'color 0.2s', fontWeight: 300 }}
              onMouseEnter={e => ((e.currentTarget as HTMLElement).style.color = '#999')}
              onMouseLeave={e => ((e.currentTarget as HTMLElement).style.color = '#555')}
            >
              Close
            </button>
          </div>
        </div>
      </div>
    )}
    </>
  )
}

// ─── Product Card ─────────────────────────────────────────────────────────────

function ProductCard({ product, rank, hasStorefrontData, storeDomain, onExpand }: {
  product: Product
  rank: number
  hasStorefrontData: boolean
  storeDomain: string
  onExpand: (product: Product) => void
}) {
  const [hovered, setHovered] = useState(false)

  function handleCardClick(e: React.MouseEvent) {
    // Don't expand if clicking the Remove button (handled by stopPropagation there)
    if (isSoldOut) return
    onExpand(product)
  }

  const isBestSeller = hasStorefrontData && rank <= 3
  const isLowStock = hasStorefrontData && product.totalInventory !== null && product.totalInventory !== undefined && product.totalInventory > 0 && product.totalInventory < 5
  const isSoldOut = hasStorefrontData && product.availableForSale === false
  const isOnSale = product.onSale && product.compareAtPrice

  return (
    <div
      className="card-product"
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      onClick={() => !isSoldOut && onExpand(product)}
      style={{ display: 'flex', flexDirection: 'column', opacity: isSoldOut ? 0.5 : 1, cursor: isSoldOut ? 'default' : 'pointer' }}
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
          {isBestSeller && <Badge color="rgba(0,0,0,0.85)" textColor="rgba(255,255,255,0.85)">#{rank} Best Seller</Badge>}
          {isSoldOut && <Badge color="rgba(80,20,20,0.8)" textColor="#f87171">Sold Out</Badge>}
          {isLowStock && !isSoldOut && <Badge color="rgba(127,29,29,0.8)" textColor="rgba(252,165,165,0.9)">Low Stock</Badge>}
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
              <span className="font-sans" style={{ fontSize: '0.5625rem', fontWeight: 400, letterSpacing: '0.08em', color: '#333' }}>{product.vendor}</span>
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

        <div style={{ display: 'flex', alignItems: 'center', gap: '6px', color: hovered && !isSoldOut ? '#fff' : '#444', transition: 'color 0.25s', fontFamily: "'DM Sans', sans-serif", fontSize: '0.8125rem', fontWeight: 400, letterSpacing: '0.01em' }}>
          <span style={{
            width: '20px', height: '20px', borderRadius: '50%',
            border: `1px solid ${hovered && !isSoldOut ? 'rgba(255,255,255,0.3)' : 'rgba(255,255,255,0.1)'}`,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            flexShrink: 0, transition: 'border-color 0.25s',
          }}>
            <svg width="7" height="7" viewBox="0 0 8 8" fill={hovered && !isSoldOut ? '#fff' : '#555'} style={{ transition: 'fill 0.25s', marginLeft: '1px' }}>
              <polygon points="0,0 8,4 0,8" />
            </svg>
          </span>
          Generate Ad
        </div>
      </div>
    </div>
  )
}

// ─── Page ─────────────────────────────────────────────────────────────────────

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
  const [expandedProduct, setExpandedProduct] = useState<Product | null>(null)
  const [isClosing, setIsClosing] = useState(false)

  function openExpanded(product: Product) {
    setIsClosing(false)
    setExpandedProduct(product)
  }

  function closeExpanded() {
    setIsClosing(true)
    setTimeout(() => {
      setExpandedProduct(null)
      setIsClosing(false)
    }, 280)
  }

  useEffect(() => {
    if (storeData?.products) setProducts(storeData.products)
    else setProducts(MOCK_PRODUCTS)
  }, [storeData])

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
    return list
  }, [products, search])

  return (
    <div style={{ minHeight: '100vh', background: '#0a0a0a', display: 'flex', flexDirection: 'column' }}>
      {/* Nav */}
      <nav style={{ display: 'grid', gridTemplateColumns: '1fr auto 1fr', alignItems: 'center', padding: '28px 48px' }}>
        <span
          className="font-serif"
          style={{ fontSize: '1.25rem', fontWeight: 400, letterSpacing: '0.04em', color: '#fff', cursor: 'pointer' }}
          onClick={() => router.push('/')}
        >
          adify
        </span>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', justifyContent: 'center' }}>
          <span className="font-sans" style={{ fontSize: '0.8125rem', color: '#555', fontWeight: 300 }}>
            {displayName}
          </span>
        </div>
        <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
          <button
            onClick={() => { sessionStorage.removeItem('sonance_store'); router.push('/') }}
            className="font-sans"
            style={{
              background: 'none', border: '1px solid rgba(255,255,255,0.08)', borderRadius: '8px',
              padding: '6px 14px', fontSize: '0.75rem', color: '#555', fontWeight: 300,
              cursor: 'pointer', transition: 'color 0.2s, border-color 0.2s',
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

        <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
          {SORTS.map((s) => (
            <button
              key={s.key}
              onClick={() => handleSort(s.key)}
              className="font-sans"
              style={{
                background: sortKey === s.key ? 'rgba(255,255,255,0.08)' : 'transparent',
                border: `1px solid ${sortKey === s.key ? 'rgba(255,255,255,0.12)' : 'rgba(255,255,255,0.05)'}`,
                borderRadius: '8px', padding: '6px 14px',
                fontSize: '0.6875rem', fontWeight: 400,
                color: sortKey === s.key ? '#ccc' : '#444',
                cursor: 'pointer', transition: 'all 0.2s', letterSpacing: '0.02em',
              }}
            >
              {s.label}
            </button>
          ))}
        </div>

        <span className="font-sans" style={{ fontSize: '0.6875rem', color: '#333', fontWeight: 300, marginLeft: 'auto' }}>
          {filtered.length} product{filtered.length !== 1 ? 's' : ''}
        </span>
      </div>

      {/* Expanded product view */}
      {expandedProduct ? (
        <main style={{ padding: '0 48px 80px', flex: 1, animation: isClosing ? 'fadeSlideDown 0.28s ease forwards' : 'fadeSlideUp 0.35s ease forwards' }}>
          <ExpandedAdView
            product={expandedProduct}
            storeDomain={storeName}
            onClose={closeExpanded}
          />
        </main>
      ) : (
        /* Grid */
        <main style={{ padding: '0 48px 80px', flex: 1, animation: 'fadeIn 0.3s ease forwards' }}>
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
                  onExpand={openExpanded}
                />
              ))}
            </div>
          )}
        </main>
      )}

      <style>{`
        @keyframes fadeUp { 0% { opacity:0; transform:translateY(28px); } 100% { opacity:1; transform:translateY(0); } }
        @keyframes fadeSlideUp { 0% { opacity:0; transform:translateY(20px) scale(0.99); } 100% { opacity:1; transform:translateY(0) scale(1); } }
        @keyframes fadeSlideDown { 0% { opacity:1; transform:translateY(0) scale(1); } 100% { opacity:0; transform:translateY(16px) scale(0.99); } }
        @keyframes fadeIn { 0% { opacity:0; } 100% { opacity:1; } }
        @keyframes spin { to { transform:rotate(360deg); } }
        @media (max-width:600px) { nav { padding:20px 24px !important; } }
      `}</style>
    </div>
  )
}
