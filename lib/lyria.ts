import * as fs from 'fs'
import * as path from 'path'
import { GoogleGenAI } from '@google/genai'

const MOOD_CONFIG: Record<string, { bpm: number; density: number; brightness: number; prompt: string }> = {
  energetic:    { bpm: 128, density: 0.8, brightness: 0.7, prompt: 'upbeat electronic pop, driving beat, energetic' },
  luxury:       { bpm: 72,  density: 0.3, brightness: 0.4, prompt: 'elegant piano, ambient, sophisticated, luxury' },
  playful:      { bpm: 110, density: 0.6, brightness: 0.8, prompt: 'fun ukulele, upbeat acoustic, playful' },
  professional: { bpm: 90,  density: 0.5, brightness: 0.5, prompt: 'clean corporate, ambient technology, professional' },
  emotional:    { bpm: 68,  density: 0.3, brightness: 0.3, prompt: 'emotional piano strings, cinematic, heartfelt' },
  minimalist:   { bpm: 80,  density: 0.2, brightness: 0.4, prompt: 'minimal ambient, soft electronic, clean' },
}

export interface MusicResult {
  musicPath: string
  bpm: number
}

export async function generateMusic(mood: string, durationSeconds: number): Promise<MusicResult> {
  const config = MOOD_CONFIG[mood] ?? MOOD_CONFIG['professional']

  try {
    const client = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY_1!, apiVersion: 'v1alpha' })
    const pcmChunks: Buffer[] = []

    const session = await client.live.music.connect({
      model: 'models/lyria-realtime-exp',
      callbacks: {
        onmessage: (message: unknown) => {
          const msg = message as { serverContent?: { audioChunks?: { data: string }[] } }
          if (msg.serverContent?.audioChunks) {
            for (const chunk of msg.serverContent.audioChunks) {
              pcmChunks.push(Buffer.from(chunk.data, 'base64'))
            }
          }
        },
        onerror: (e: unknown) => { console.error('Lyria error:', e) },
        onclose: () => {},
      },
    })

    await session.setMusicGenerationConfig({
      musicGenerationConfig: {
        bpm: config.bpm,
        density: config.density,
        brightness: config.brightness,
      },
    })

    await session.setWeightedPrompts({
      weightedPrompts: [{ text: config.prompt, weight: 1.0 }],
    })

    await session.play()
    await new Promise<void>(resolve => setTimeout(resolve, durationSeconds * 1000))
    await session.stop()
    // Small buffer to collect remaining chunks
    await new Promise<void>(resolve => setTimeout(resolve, 500))

    const pcmData = Buffer.concat(pcmChunks)
    fs.mkdirSync(path.join(process.cwd(), '.tmp'), { recursive: true })
    const wavPath = path.join(process.cwd(), '.tmp', `adify-music-${Date.now()}.wav`)

    // Build WAV header manually — 44 bytes
    // channels=2, sampleRate=48000, bitsPerSample=16
    const sampleRate = 48000
    const numChannels = 2
    const bitsPerSample = 16
    const byteRate = sampleRate * numChannels * (bitsPerSample / 8)
    const blockAlign = numChannels * (bitsPerSample / 8)
    const dataSize = pcmData.length
    const chunkSize = 36 + dataSize

    const header = Buffer.alloc(44)
    header.write('RIFF', 0)
    header.writeUInt32LE(chunkSize, 4)
    header.write('WAVE', 8)
    header.write('fmt ', 12)
    header.writeUInt32LE(16, 16)          // subchunk1 size
    header.writeUInt16LE(1, 20)           // PCM format
    header.writeUInt16LE(numChannels, 22)
    header.writeUInt32LE(sampleRate, 24)
    header.writeUInt32LE(byteRate, 28)
    header.writeUInt16LE(blockAlign, 32)
    header.writeUInt16LE(bitsPerSample, 34)
    header.write('data', 36)
    header.writeUInt32LE(dataSize, 40)

    fs.writeFileSync(wavPath, Buffer.concat([header, pcmData]))
    return { musicPath: wavPath, bpm: config.bpm }

  } catch (err) {
    console.error('Lyria generation failed, falling back to bundled track:', err)

    const fallbackFile =
      mood === 'energetic' || mood === 'playful' ? 'upbeat.mp3' :
      mood === 'luxury' || mood === 'emotional' || mood === 'minimalist' ? 'calm.mp3' :
      'cinematic.mp3'

    const srcPath = path.join(process.cwd(), 'public', 'music', fallbackFile)
    fs.mkdirSync(path.join(process.cwd(), '.tmp'), { recursive: true })
    const destPath = path.join(process.cwd(), '.tmp', `adify-music-fallback-${Date.now()}.mp3`)
    fs.copyFileSync(srcPath, destPath)
    return { musicPath: destPath, bpm: config.bpm }
  }
}
