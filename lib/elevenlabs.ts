import { execFile } from 'child_process'
import { promisify } from 'util'
import * as fs from 'fs'
import * as path from 'path'

const execFileAsync = promisify(execFile)

export interface ChunkResult {
  durationMs: number
  audioBase64: string
}

export interface SpeechResult {
  chunks: ChunkResult[]
  fullAudioBase64: string
}

async function measureDurationMs(filePath: string, fallbackBytes: number): Promise<number> {
  try {
    const { stdout } = await execFileAsync('ffprobe', [
      '-v', 'error',
      '-show_entries', 'format=duration',
      '-of', 'csv=p=0',
      filePath,
    ])
    const secs = parseFloat(stdout.trim())
    if (!isNaN(secs)) return secs * 1000
  } catch {
    // fall through to estimate
  }
  // Fallback: rough estimate from byte size (128kbps mp3)
  return (fallbackBytes / 16000) * 1000
}

export async function generateSpeech(sentences: string[], voiceId: string, speeds?: number[]): Promise<SpeechResult> {
  const apiKey = process.env.ELEVENLABS_API_KEY_1!
  const timestamp = Date.now()

  // Send all sentences in parallel
  const buffers = await Promise.all(
    sentences.map(async (text, i) => {
      const speed = speeds?.[i] ?? 1.0
      const clampedSpeed = Math.min(1.5, Math.max(0.7, speed))
      const res = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${voiceId}`, {
        method: 'POST',
        headers: {
          'xi-api-key': apiKey,
          'Content-Type': 'application/json',
          'Accept': 'audio/mpeg',
        },
        body: JSON.stringify({
          text,
          model_id: 'eleven_multilingual_v2',
          voice_settings: { stability: 0.5, similarity_boost: 0.75 },
          speed: clampedSpeed,
        }),
      })
      if (!res.ok) {
        const err = await res.text()
        throw new Error(`ElevenLabs error ${res.status}: ${err}`)
      }
      return Buffer.from(await res.arrayBuffer())
    })
  )

  // Measure each chunk duration via ffprobe
  fs.mkdirSync(path.join(process.cwd(), '.tmp'), { recursive: true })
  const chunks: ChunkResult[] = await Promise.all(
    buffers.map(async (buf, i) => {
      const tmpPath = path.join(process.cwd(), '.tmp', `adify-tts-${timestamp}-${i}.mp3`)
      fs.writeFileSync(tmpPath, buf)
      const durationMs = await measureDurationMs(tmpPath, buf.length)
      fs.unlink(tmpPath, () => {})
      return { durationMs, audioBase64: buf.toString('base64') }
    })
  )

  // Concatenate MP3 chunks properly using FFmpeg's concat demuxer.
  // Raw byte concatenation of MP3 files produces a file with multiple
  // ID3 headers that FFmpeg may only partially read.
  const tmpDir = path.join(process.cwd(), '.tmp')
  const chunkPaths: string[] = []
  for (let i = 0; i < buffers.length; i++) {
    const p = path.join(tmpDir, `adify-tts-${timestamp}-concat-${i}.mp3`)
    fs.writeFileSync(p, buffers[i])
    chunkPaths.push(p)
  }

  const concatListPath = path.join(tmpDir, `adify-tts-${timestamp}-concat.txt`)
  const concatListContent = chunkPaths.map(p => `file '${p}'`).join('\n')
  fs.writeFileSync(concatListPath, concatListContent)

  const fullAudioPath = path.join(tmpDir, `adify-tts-${timestamp}-full.mp3`)
  await execFileAsync('ffmpeg', [
    '-y', '-f', 'concat', '-safe', '0',
    '-i', concatListPath,
    '-c', 'copy',
    fullAudioPath,
  ])

  const fullAudioBase64 = fs.readFileSync(fullAudioPath).toString('base64')

  // Clean up temp files
  for (const p of chunkPaths) fs.unlink(p, () => {})
  fs.unlink(concatListPath, () => {})
  fs.unlink(fullAudioPath, () => {})

  return { chunks, fullAudioBase64 }
}
