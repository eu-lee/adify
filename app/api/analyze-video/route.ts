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
  const tmpDir = path.join(process.cwd(), '.tmp', `adify-${timestamp}`)
  fs.mkdirSync(tmpDir, { recursive: true })

  try {
    const formData = await req.formData()

    const productRaw = formData.get('product') as string | null
    const adType = (formData.get('adType') as string) ?? 'narrated'
    const duration = parseInt((formData.get('duration') as string) ?? '30', 10)

    // Accept video_0, video_1, ... or single "video" for backward compat
    const videoFiles: File[] = []
    for (let i = 0; ; i++) {
      const f = formData.get(`video_${i}`) as File | null
      if (!f) break
      videoFiles.push(f)
    }
    if (videoFiles.length === 0) {
      const single = formData.get('video') as File | null
      if (single) videoFiles.push(single)
    }

    if (videoFiles.length === 0 || !productRaw) {
      return NextResponse.json({ error: 'Missing required fields: video, product' }, { status: 400 })
    }

    const product = JSON.parse(productRaw)

    // Write all videos to temp dir
    const videoPaths: string[] = []
    for (let i = 0; i < videoFiles.length; i++) {
      const vPath = path.join(tmpDir, `source_${i}.mp4`)
      fs.writeFileSync(vPath, Buffer.from(await videoFiles[i].arrayBuffer()))
      videoPaths.push(vPath)
    }

    // Compress and analyze audio for each clip in parallel
    const results = await Promise.all(
      videoPaths.map(async (vPath) => {
        const [compressed, audio] = await Promise.all([
          compressVideo(vPath),
          analyzeSourceAudio(vPath),
        ])
        return { compressed, audio }
      })
    )
    const compressedPaths = results.map(r => r.compressed)
    const audioAnalyses = results.map(r => r.audio)

    if (adType === 'music_only') {
      const result = await analyzeVideoForMusicAd(compressedPaths, product, audioAnalyses, duration)
      const bpm = MOOD_BPM[result.mood] ?? 90
      return NextResponse.json({
        mood: result.mood,
        bpm,
        cuts: result.cuts,
        audioAnalysis: audioAnalyses[0],
        audioAnalyses,
      })
    } else {
      const result = await analyzeVideoForNarratedAd(compressedPaths, product, audioAnalyses, duration)
      const bpm = MOOD_BPM[result.mood] ?? 90
      return NextResponse.json({
        mood: result.mood,
        bpm,
        voice: result.voice,
        sentences: result.sentences,
        audioAnalysis: audioAnalyses[0],
        audioAnalyses,
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
