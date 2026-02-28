import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { normaliseStoreUrl, fetchShopifyProducts } from '../lib/shopify.js'
import { fetchStorefrontProducts } from '../lib/storefront.js'

const STATUS = { idle: 'idle', loading: 'loading', error: 'error' }

export default function ConnectStore() {
  const [url, setUrl] = useState('')
  const [token, setToken] = useState('')
  const [showToken, setShowToken] = useState(false)
  const [status, setStatus] = useState(STATUS.idle)
  const [errorMsg, setErrorMsg] = useState('')
  const navigate = useNavigate()

  const handleConnect = async (e) => {
    e.preventDefault()
    setErrorMsg('')

    let baseUrl
    try {
      baseUrl = normaliseStoreUrl(url)
    } catch (err) {
      setErrorMsg(err.message)
      return
    }

    setStatus(STATUS.loading)

    try {
      let products
      const trimmedToken = token.trim()

      if (trimmedToken) {
        // Storefront API — richer data, real best-seller ranking
        products = await fetchStorefrontProducts(baseUrl, trimmedToken)
      } else {
        // Public scrape fallback
        products = await fetchShopifyProducts(baseUrl)
      }

      navigate('/products', {
        state: {
          storeName: new URL(baseUrl).host,
          baseUrl,
          storefrontToken: trimmedToken || null,
          products,
        },
      })
    } catch (err) {
      setErrorMsg(err.message)
      setStatus(STATUS.error)
    }
  }

  const loading = status === STATUS.loading

  return (
    <div style={{ minHeight: '100vh', background: '#0a0a0a', display: 'flex', flexDirection: 'column' }}>
      {/* Nav */}
      <nav style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '28px 48px' }}>
        <span className="font-serif" style={{ fontSize: '1.25rem', fontWeight: 400, letterSpacing: '0.04em', color: '#fff' }}>
          sonance
        </span>
        <div style={{ display: 'flex', gap: '32px', alignItems: 'center' }}>
          {['How it works', 'Features', 'Pricing'].map((link) => (
            <span
              key={link}
              className="font-sans"
              style={{ fontSize: '0.8125rem', color: '#666', cursor: 'pointer', fontWeight: 300, transition: 'color 0.2s' }}
              onMouseEnter={(e) => (e.target.style.color = '#999')}
              onMouseLeave={(e) => (e.target.style.color = '#666')}
            >
              {link}
            </span>
          ))}
        </div>
      </nav>

      {/* Hero */}
      <main
        style={{
          flex: 1,
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          padding: '0 24px 80px',
          animation: 'fadeUp 0.7s ease forwards',
        }}
      >
        <h1
          className="font-serif"
          style={{ fontSize: 'clamp(3rem, 7vw, 5.5rem)', fontWeight: 300, letterSpacing: '-0.02em', lineHeight: 1.1, textAlign: 'center', marginBottom: 0, color: '#fff' }}
        >
          Create ads that
        </h1>
        <h1
          className="font-serif"
          style={{ fontSize: 'clamp(3rem, 7vw, 5.5rem)', fontWeight: 300, letterSpacing: '-0.02em', lineHeight: 1.1, textAlign: 'center', marginBottom: '32px' }}
        >
          <span className="text-gradient-warm">sound different.</span>
        </h1>

        <p
          className="font-sans"
          style={{ fontSize: '0.9375rem', color: '#888', fontWeight: 300, textAlign: 'center', maxWidth: '420px', lineHeight: 1.7, marginBottom: '52px' }}
        >
          AI-powered audio ads for your Shopify store. Paste your store URL and start generating.
        </p>

        <form
          onSubmit={handleConnect}
          style={{ display: 'flex', flexDirection: 'column', gap: '10px', width: '100%', maxWidth: '540px', alignItems: 'center' }}
        >
          {/* URL + button row */}
          <div style={{ display: 'flex', gap: '12px', width: '100%', flexWrap: 'wrap', justifyContent: 'center' }}>
            <input
              className="input-dark"
              type="text"
              placeholder="yourstore.myshopify.com"
              value={url}
              onChange={(e) => { setUrl(e.target.value); if (errorMsg) setErrorMsg('') }}
              style={{ flex: 1, minWidth: '260px', borderColor: errorMsg ? 'rgba(251,113,133,0.4)' : undefined }}
              disabled={loading}
            />
            <button
              type="submit"
              className="btn-primary"
              disabled={loading}
              style={{ opacity: loading ? 0.75 : 1, cursor: loading ? 'not-allowed' : 'pointer', minWidth: '160px', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px' }}
            >
              {loading ? <><Spinner /> Fetching…</> : 'Connect Store →'}
            </button>
          </div>

          {/* Optional token row */}
          {showToken ? (
            <div style={{ width: '100%', display: 'flex', flexDirection: 'column', gap: '6px' }}>
              <input
                className="input-dark"
                type="text"
                placeholder="Storefront Access Token"
                value={token}
                onChange={(e) => setToken(e.target.value)}
                style={{ width: '100%', borderRadius: '12px', padding: '12px 20px' }}
                disabled={loading}
                autoFocus
              />
              <p className="font-sans" style={{ fontSize: '0.7rem', color: '#3a3a3a', fontWeight: 300, margin: 0, paddingLeft: '4px' }}>
                Unlocks best seller ranking, inventory levels, sale prices &amp; variant data.
                Generate one in Shopify Admin → Settings → Apps → Develop apps.
              </p>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => setShowToken(true)}
              className="font-sans"
              style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: '0.75rem', color: '#3a3a3a', fontWeight: 300, padding: '2px 0', transition: 'color 0.2s' }}
              onMouseEnter={(e) => (e.target.style.color = '#666')}
              onMouseLeave={(e) => (e.target.style.color = '#3a3a3a')}
            >
              + Add Storefront Token for richer data
            </button>
          )}

          {/* Status messages */}
          {loading && (
            <p className="font-sans" style={{ fontSize: '0.75rem', color: '#555', fontWeight: 300, margin: 0, letterSpacing: '0.03em' }}>
              {token.trim() ? 'Loading products via Storefront API…' : 'Connecting to your store…'}
            </p>
          )}
          {errorMsg && (
            <p className="font-sans" style={{ fontSize: '0.75rem', color: 'rgba(251,113,133,0.85)', fontWeight: 300, margin: 0, textAlign: 'center' }}>
              {errorMsg}
            </p>
          )}
        </form>
      </main>

      <style>{`
        @keyframes fadeUp { 0% { opacity:0; transform:translateY(28px); } 100% { opacity:1; transform:translateY(0); } }
        @keyframes spin { to { transform:rotate(360deg); } }
        @media (max-width:600px) { nav { padding:20px 24px !important; } nav > div { display:none; } }
      `}</style>
    </div>
  )
}

function Spinner() {
  return (
    <span style={{ width:'14px', height:'14px', border:'1.5px solid rgba(0,0,0,0.2)', borderTopColor:'#0a0a0a', borderRadius:'50%', display:'inline-block', animation:'spin 0.7s linear infinite', flexShrink:0 }} />
  )
}
