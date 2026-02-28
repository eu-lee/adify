import { NextRequest, NextResponse } from 'next/server'
import { generateSpeech } from '@/lib/elevenlabs'

export const runtime = 'nodejs'

export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    const { sentences, voiceId, segmentDurations } = body

    if (!sentences || !Array.isArray(sentences) || sentences.length === 0) {
      return NextResponse.json({ error: 'Missing or empty sentences array' }, { status: 400 })
    }
    if (!voiceId || typeof voiceId !== 'string') {
      return NextResponse.json({ error: 'Missing voiceId' }, { status: 400 })
    }

    // Compute per-sentence speed from segment durations
    let speeds: number[] | undefined
    if (segmentDurations && Array.isArray(segmentDurations) && segmentDurations.length === sentences.length) {
      speeds = sentences.map((text: string, i: number) => {
        const wordCount = text.split(/\s+/).filter(Boolean).length
        const targetSec = segmentDurations[i]
        if (!targetSec || targetSec <= 0) return 1.0
        return wordCount / 3.0 / targetSec
      })
    }

    const result = await generateSpeech(sentences, voiceId, speeds)
    return NextResponse.json(result)
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
