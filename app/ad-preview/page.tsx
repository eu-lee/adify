'use client'

import { useSearchParams } from 'next/navigation'
import { Suspense } from 'react'

function AdPreviewContent() {
  const params = useSearchParams()
  const url = params.get('url')
  const title = params.get('title') ?? 'Your Ad'

  if (!url) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '100vh' }}>
        <p style={{ color: 'rgba(255,255,255,0.5)', fontFamily: 'var(--font-sans)' }}>No video found.</p>
      </div>
    )
  }

  return (
    <div style={{
      minHeight: '100vh',
      background: '#0a0a0a',
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      justifyContent: 'center',
      padding: '40px 24px',
      gap: '32px',
    }}>
      <h1 className="font-serif" style={{ fontSize: '1.75rem', fontWeight: 500, margin: 0, color: '#fff', textAlign: 'center' }}>
        {title}
      </h1>

      <video
        controls
        autoPlay
        src={url}
        style={{
          width: '100%',
          maxWidth: '960px',
          borderRadius: '12px',
          background: '#000',
          aspectRatio: '16/9',
        }}
      />

      <a
        href={url}
        download="ad.mp4"
        className="btn-primary"
        style={{ textDecoration: 'none', padding: '14px 48px' }}
      >
        Download
      </a>
    </div>
  )
}

export default function AdPreviewPage() {
  return (
    <Suspense>
      <AdPreviewContent />
    </Suspense>
  )
}
