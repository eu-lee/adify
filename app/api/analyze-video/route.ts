import { NextRequest, NextResponse } from 'next/server'
import * as fs from 'fs'
import * as path from 'path'
import { analyzeSourceAudio } from '@/lib/audio-analysis'
import {
  compressVideo,
  analyzeVideoForNarratedAd,
  analyzeVideoForMusicAd,
  MOOD_BPM,
} from '@/lib/gemini'

export const runtime = 'nodejs'
export const maxDuration = 120

export async function POST(req: NextRequest) {
  const timestamp = Date.now()
  const tmpDir = `/tmp/adify-${timestamp}`
  fs.mkdirSync(tmpDir, { recursive: true })

  try {
    const formData = await req.formData()

    const videoFile = formData.get('video') as File | null
    const productRaw = formData.get('product') as string | null
    const adType = (formData.get('adType') as string) ?? 'narrated'
    const duration = parseInt((formData.get('duration') as string) ?? '30', 10)

    if (!videoFile || !productRaw) {
      return NextResponse.json({ error: 'Missing required fields: video, product' }, { status: 400 })
    }

    const product = JSON.parse(productRaw)

    // Write video to temp dir
    const videoPath = path.join(tmpDir, 'source.mp4')
    const videoBuffer = Buffer.from(await videoFile.arrayBuffer())
    fs.writeFileSync(videoPath, videoBuffer)

    // Run compression and audio analysis in parallel
    const [compressedPath, audioAnalysis] = await Promise.all([
      compressVideo(videoPath),
      analyzeSourceAudio(videoPath),
    ])

    if (adType === 'music_only') {
      const result = await analyzeVideoForMusicAd(compressedPath, product, audioAnalysis, duration)
      const bpm = MOOD_BPM[result.mood] ?? 90
      return NextResponse.json({
        mood: result.mood,
        bpm,
        cuts: result.cuts,
        audioAnalysis,
      })
    } else {
      const result = await analyzeVideoForNarratedAd(compressedPath, product, audioAnalysis, duration)
      const bpm = MOOD_BPM[result.mood] ?? 90
      return NextResponse.json({
        mood: result.mood,
        bpm,
        voice: result.voice,
        sentences: result.sentences,
        audioAnalysis,
      })
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    return NextResponse.json({ error: message }, { status: 500 })
  } finally {
    // Fire-and-forget cleanup
    fs.rm(tmpDir, { recursive: true, force: true }, () => {})
  }
}
