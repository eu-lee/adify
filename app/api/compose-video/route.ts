import { NextRequest, NextResponse } from 'next/server'
import * as fs from 'fs'
import * as path from 'path'
import * as os from 'os'
import { composeNarratedAd, composeMusicAd } from '@/lib/ffmpeg'
import { snapCutsToBeatMap, Cut } from '@/lib/beats'

export const runtime = 'nodejs'
export const maxDuration = 120

const SFX_DIR = path.join(process.cwd(), 'public', 'sfx')

export async function POST(req: NextRequest) {
  const timestamp = Date.now()
  const tmpDir = path.join(os.tmpdir(), `adify-${timestamp}`)
  fs.mkdirSync(tmpDir, { recursive: true })

  try {
    const formData = await req.formData()

    // ── Parse files ──────────────────────────────────────────────────────────

    const videoFile  = formData.get('video')   as File | null
    const musicFile  = formData.get('music')   as File | null
    const narration  = formData.get('narration') as File | null

    if (!videoFile) return NextResponse.json({ error: 'Missing video file' }, { status: 400 })
    if (!musicFile) return NextResponse.json({ error: 'Missing music file' }, { status: 400 })

    // ── Parse fields ─────────────────────────────────────────────────────────

    const adType = (formData.get('adType') as string | null) ?? ''
    if (!['narrated', 'music_only'].includes(adType)) {
      return NextResponse.json({ error: 'adType must be "narrated" or "music_only"' }, { status: 400 })
    }

    const audioAnalysis = JSON.parse((formData.get('audioAnalysis') as string | null) ?? '{"hasSpeech":false}') as { hasSpeech: boolean }

    // ── Write files to tmp ───────────────────────────────────────────────────

    const videoPath = path.join(tmpDir, 'source.mp4')
    fs.writeFileSync(videoPath, Buffer.from(await videoFile.arrayBuffer()))

    const musicPath = path.join(tmpDir, 'music.wav')
    fs.writeFileSync(musicPath, Buffer.from(await musicFile.arrayBuffer()))

    const outputPath = path.join(tmpDir, 'output.mp4')

    // ── Compose ───────────────────────────────────────────────────────────────

    if (adType === 'narrated') {
      if (!narration) {
        return NextResponse.json({ error: 'Missing narration file for narrated ad' }, { status: 400 })
      }

      const narrationPath = path.join(tmpDir, 'narration.mp3')
      fs.writeFileSync(narrationPath, Buffer.from(await narration.arrayBuffer()))

      const sentences = JSON.parse((formData.get('cutList') as string | null) ?? '[]')
      const chunkDurations: number[] = JSON.parse((formData.get('chunkDurations') as string | null) ?? '[]')

      if (sentences.length === 0) {
        return NextResponse.json({ error: 'cutList is empty' }, { status: 400 })
      }
      if (chunkDurations.length !== sentences.length) {
        return NextResponse.json({ error: 'chunkDurations length must match sentences length' }, { status: 400 })
      }

      await composeNarratedAd(
        videoPath, narrationPath, musicPath, SFX_DIR,
        sentences, chunkDurations, audioAnalysis, outputPath
      )
    } else {
      // music_only
      const bpm = parseFloat((formData.get('bpm') as string | null) ?? '120')
      const rawCuts: Cut[] = JSON.parse((formData.get('cutList') as string | null) ?? '[]')

      if (rawCuts.length === 0) {
        return NextResponse.json({ error: 'cutList is empty' }, { status: 400 })
      }

      const totalDuration = rawCuts.reduce((sum, c) => sum + (c.videoEnd - c.videoStart), 0)
      const cuts = snapCutsToBeatMap(rawCuts, bpm, totalDuration)

      await composeMusicAd(videoPath, musicPath, SFX_DIR, cuts, audioAnalysis, outputPath)
    }

    // ── Return MP4 ───────────────────────────────────────────────────────────

    const videoBuffer = fs.readFileSync(outputPath)
    return new Response(videoBuffer, {
      headers: {
        'Content-Type': 'video/mp4',
        'Content-Disposition': 'attachment; filename="ad.mp4"',
      },
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    console.error('compose-video error:', message)
    return NextResponse.json({ error: message }, { status: 500 })
  } finally {
    // Fire-and-forget cleanup (same pattern as analyze-video route)
    fs.rm(tmpDir, { recursive: true, force: true }, () => {})
  }
}
