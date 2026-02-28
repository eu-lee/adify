import { NextRequest, NextResponse } from 'next/server'
import * as fs from 'fs'
import * as path from 'path'
import { generateMusic } from '@/lib/lyria'

export const runtime = 'nodejs'
export const maxDuration = 120

export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    const { mood, durationSeconds } = body

    if (!mood || typeof mood !== 'string') {
      return NextResponse.json({ error: 'Missing mood' }, { status: 400 })
    }
    if (!durationSeconds || typeof durationSeconds !== 'number') {
      return NextResponse.json({ error: 'Missing durationSeconds' }, { status: 400 })
    }

    const result = await generateMusic(mood, durationSeconds)
    const audioBuffer = fs.readFileSync(result.musicPath)

    // Clean up temp file fire-and-forget
    fs.unlink(result.musicPath, () => {})

    const ext = path.extname(result.musicPath)
    const contentType = ext === '.wav' ? 'audio/wav' : 'audio/mpeg'

    return new Response(audioBuffer, {
      headers: {
        'Content-Type': contentType,
        'Content-Length': String(audioBuffer.length),
        'X-BPM': String(result.bpm),
      },
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
