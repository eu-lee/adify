import { execFile } from 'child_process'
import { promisify } from 'util'
import * as fs from 'fs'
import * as path from 'path'
import { GoogleGenerativeAI } from '@google/generative-ai'
import { GoogleAIFileManager } from '@google/generative-ai/server'

const execFileAsync = promisify(execFile)

export interface Product {
  title: string
  description: string
  price: string
}

export interface AudioAnalysis {
  silenceRegions: { start: number; end: number }[]
  meanVolume: number
  peakVolume: number
  hasSpeech: boolean
}

export interface NarratedAnalysis {
  mood: string
  voice: { elevenlabs_voice_id: string }
  sentences: { text: string; clipIndex: number; videoStart: number; videoEnd: number; estimatedDurationSec: number }[]
}

export interface MusicAnalysis {
  mood: string
  cuts: { clipIndex: number; videoStart: number; videoEnd: number; textOverlay: string | null }[]
}

export const MOOD_BPM: Record<string, number> = {
  energetic: 128,
  luxury: 72,
  playful: 110,
  professional: 90,
  emotional: 68,
  minimalist: 80,
}

const VOICE_LIST = [
  'JBFqnCBsd6RMkjVDRZzb — Rachel (warm, professional female)',
  'pNInz6obpgDQGcFmaJgB — Adam (deep, authoritative male)',
  'EXAVITQu4vr4xnSDxMaL — Bella (young, friendly female)',
  'ErXwobaYiN019PkySvjV — Antoni (warm, calm male)',
  'MF3mGyEYCl7XYWbV9V6O — Elli (young, energetic female)',
  'TxGEqnHWrfWFTfGW9XjX — Josh (deep, narrative male)',
].join('\n')

export async function compressVideo(inputPath: string): Promise<string> {
  const tmpDir = path.dirname(inputPath)
  const outputPath = path.join(tmpDir, 'compressed.mp4')
  await execFileAsync('ffmpeg', [
    '-i', inputPath,
    '-vf', 'scale=640:-2',
    '-preset', 'ultrafast',
    '-crf', '28',
    '-y',
    outputPath,
  ])
  return outputPath
}

async function uploadAndWaitForActive(filePath: string): Promise<string> {
  const fileManager = new GoogleAIFileManager(process.env.GEMINI_API_KEY_1!)
  const mimeType = 'video/mp4'

  const uploadResult = await fileManager.uploadFile(filePath, {
    mimeType,
    displayName: path.basename(filePath),
  })

  let file = await fileManager.getFile(uploadResult.file.name)
  while (file.state === 'PROCESSING') {
    await new Promise(r => setTimeout(r, 2000))
    file = await fileManager.getFile(uploadResult.file.name)
  }

  if (file.state !== 'ACTIVE') {
    throw new Error(`Gemini file upload failed with state: ${file.state}`)
  }

  return file.uri
}

function buildNarratedPrompt(
  product: Product,
  audioAnalyses: AudioAnalysis[],
  duration: number,
): string {
  const clipHints = audioAnalyses.map((aa, i) => {
    const silenceHint =
      aa.silenceRegions.length > 0
        ? `Silence regions: ${aa.silenceRegions.map(r => `${r.start.toFixed(1)}s-${r.end.toFixed(1)}s`).join(', ')}`
        : `No detected silence regions`
    return `Clip ${i}: ${silenceHint}. Speech present: ${aa.hasSpeech}.`
  }).join('\n')

  return `Watch these product video clips. You are an expert TikTok/Instagram ad copywriter.

Product: ${product.title}
Description: ${product.description}
Price: ${product.price}
Target duration: ${duration} seconds

You are given ${audioAnalyses.length} source video clip(s) (Clip 0${audioAnalyses.length > 1 ? `, Clip 1, ...Clip ${audioAnalyses.length - 1}` : ''}):
${clipHints}

Write a ${duration}-second narrated video ad. For each sentence of narration, specify
which clip (clipIndex) and timestamp range from that clip best matches what's being said.
Prefer using silence regions in the source audio for cuts to avoid cutting over speech.

IMPORTANT — VARIETY:
- Use as many DIFFERENT parts of the source video as possible. Spread your cuts across the full timeline of each clip.
- Do NOT cluster cuts in the same region. If clip 0 is 30 seconds long, pull segments from the beginning, middle, AND end.
- Each cut MUST use a different timestamp range — never repeat or heavily overlap the same segment.
- Vary segment lengths (mix short 1-2s cuts with longer 3-5s cuts) to create visual rhythm.

IMPORTANT — DURATION:
Each sentence's narration must fit its video segment duration.
Natural speech is approximately 3 words per second. For a segment of N seconds, write approximately N*3 words (plus or minus 2).
Include "estimatedDurationSec" in your output for each sentence.

Also determine the ideal voice characteristics for this product's target audience.
Choose the elevenlabs_voice_id from ONLY these options:
${VOICE_LIST}

Return JSON only, no markdown:
{
  "adType": "narrated",
  "mood": "energetic|luxury|playful|professional|emotional|minimalist",
  "voice": {
    "gender": "female|male",
    "age": "young|middle|mature",
    "tone": "warm|authoritative|excited|calm|friendly",
    "elevenlabs_voice_id": "JBFqnCBsd6RMkjVDRZzb"
  },
  "sentences": [
    {
      "text": "Example narration sentence.",
      "clipIndex": 0,
      "videoStart": 0.0,
      "videoEnd": 4.2,
      "estimatedDurationSec": 4.2
    }
  ]
}`
}

function buildMusicPrompt(product: Product, audioAnalyses: AudioAnalysis[], duration: number): string {
  const clipHints = audioAnalyses.map((aa, i) => {
    return `Clip ${i}: Speech present: ${aa.hasSpeech}.`
  }).join('\n')

  return `Watch these product video clips. Create a ${duration}-second music-only video ad
(no voiceover). Determine the best cuts based on visual content.

Product: ${product.title}
Description: ${product.description}
Price: ${product.price}
Target duration: ${duration} seconds

You are given ${audioAnalyses.length} source video clip(s) (Clip 0${audioAnalyses.length > 1 ? `, Clip 1, ...Clip ${audioAnalyses.length - 1}` : ''}):
${clipHints}

For each cut, specify which clip (clipIndex) and timestamp range to use.

IMPORTANT — VARIETY:
- Use as many DIFFERENT parts of the source video as possible. Spread your cuts across the full timeline of each clip.
- Do NOT cluster cuts in the same region. If a clip is 30 seconds long, pull segments from the beginning, middle, AND end.
- Each cut MUST use a different timestamp range — never repeat or heavily overlap the same segment.
- Vary segment lengths (mix short 1-2s cuts with longer 3-5s cuts) to create visual rhythm and energy.
- Prefer visually interesting moments: product close-ups, action shots, texture details, hands interacting with the product.

Return JSON only, no markdown:
{
  "adType": "music_only",
  "mood": "energetic|luxury|playful|professional|emotional|minimalist",
  "cuts": [
    { "clipIndex": 0, "videoStart": 0.0, "videoEnd": 3.5, "textOverlay": null },
    { "clipIndex": 0, "videoStart": 8.2, "videoEnd": 12.0, "textOverlay": "Product Name" },
    { "clipIndex": 0, "videoStart": 18.0, "videoEnd": 21.5, "textOverlay": null },
    { "clipIndex": 1, "videoStart": 2.0, "videoEnd": 5.5, "textOverlay": "$29.99" }
  ]
}`
}

export async function analyzeVideoForNarratedAd(
  videoPaths: string[],
  product: Product,
  audioAnalyses: AudioAnalysis[],
  duration: number,
): Promise<NarratedAnalysis> {
  const fileUris = await Promise.all(videoPaths.map(p => uploadAndWaitForActive(p)))

  const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY_1!)
  const model = genAI.getGenerativeModel({
    model: 'gemini-2.0-flash',
    generationConfig: { responseMimeType: 'application/json' },
  })

  const prompt = buildNarratedPrompt(product, audioAnalyses, duration)

  const result = await model.generateContent([
    ...fileUris.map(fileUri => ({ fileData: { mimeType: 'video/mp4' as const, fileUri } })),
    { text: prompt },
  ])

  const raw = result.response.text()
  const parsed = JSON.parse(raw)

  return {
    mood: parsed.mood,
    voice: { elevenlabs_voice_id: parsed.voice.elevenlabs_voice_id },
    sentences: parsed.sentences,
  }
}

export async function analyzeVideoForMusicAd(
  videoPaths: string[],
  product: Product,
  audioAnalyses: AudioAnalysis[],
  duration: number,
): Promise<MusicAnalysis> {
  const fileUris = await Promise.all(videoPaths.map(p => uploadAndWaitForActive(p)))

  const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY_1!)
  const model = genAI.getGenerativeModel({
    model: 'gemini-2.0-flash',
    generationConfig: { responseMimeType: 'application/json' },
  })

  const prompt = buildMusicPrompt(product, audioAnalyses, duration)

  const result = await model.generateContent([
    ...fileUris.map(fileUri => ({ fileData: { mimeType: 'video/mp4' as const, fileUri } })),
    { text: prompt },
  ])

  const raw = result.response.text()
  const parsed = JSON.parse(raw)

  return {
    mood: parsed.mood,
    cuts: parsed.cuts,
  }
}
