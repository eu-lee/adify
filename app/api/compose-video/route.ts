import { NextRequest, NextResponse } from 'next/server'
import * as fs from 'fs'
import * as path from 'path'
import { composeNarratedAd, composeMusicAd } from '@/lib/ffmpeg'
import { snapCutsToBeatMap, Cut } from '@/lib/beats'

export const runtime = 'nodejs'
export const maxDuration = 120

const SFX_DIR = path.join(process.cwd(), 'public', 'sfx')

export async function POST(req: NextRequest) {
  const timestamp = Date.now()
  const tmpDir = path.join(process.cwd(), '.tmp', `adify-${timestamp}`)
  fs.mkdirSync(tmpDir, { recursive: true })

  try {
    const formData = await req.formData()

    // ── Parse files ──────────────────────────────────────────────────────────

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

    const musicFile  = formData.get('music')   as File | null
    const narration  = formData.get('narration') as File | null

    if (videoFiles.length === 0) return NextResponse.json({ error: 'Missing video file(s)' }, { status: 400 })
    if (!musicFile) return NextResponse.json({ error: 'Missing music file' }, { status: 400 })

    // ── Parse fields ─────────────────────────────────────────────────────────

    const adType = (formData.get('adType') as string | null) ?? ''
    if (!['narrated', 'music_only'].includes(adType)) {
      return NextResponse.json({ error: 'adType must be "narrated" or "music_only"' }, { status: 400 })
    }

    const rawAudioAnalysis = JSON.parse((formData.get('audioAnalysis') as string | null) ?? '{"hasSpeech":false}')
    // Normalize: accept both single object and array, convert to single object for ffmpeg
    const audioAnalysis: { hasSpeech: boolean } = Array.isArray(rawAudioAnalysis)
      ? { hasSpeech: rawAudioAnalysis.some((a: { hasSpeech: boolean }) => a.hasSpeech) }
      : rawAudioAnalysis

    // ── Write files to tmp ───────────────────────────────────────────────────

    const videoPaths: string[] = []
    for (let i = 0; i < videoFiles.length; i++) {
      const vPath = path.join(tmpDir, `source_${i}.mp4`)
      fs.writeFileSync(vPath, Buffer.from(await videoFiles[i].arrayBuffer()))
      videoPaths.push(vPath)
    }

    const musicBytes = Buffer.from(await musicFile.arrayBuffer())
    const isMP3 = musicBytes[0] === 0xFF || musicBytes.slice(0, 3).toString('ascii') === 'ID3'
    const musicPath = path.join(tmpDir, isMP3 ? 'music.mp3' : 'music.wav')
    fs.writeFileSync(musicPath, musicBytes)

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
        videoPaths, narrationPath, musicPath, SFX_DIR,
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

      await composeMusicAd(videoPaths, musicPath, SFX_DIR, cuts, audioAnalysis, outputPath)
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
