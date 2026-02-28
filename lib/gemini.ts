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
  sentences: { text: string; videoStart: number; videoEnd: number }[]
}

export interface MusicAnalysis {
  mood: string
  cuts: { videoStart: number; videoEnd: number; textOverlay: string | null }[]
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
  audioAnalysis: AudioAnalysis,
  duration: number,
): string {
  const silenceHint =
    audioAnalysis.silenceRegions.length > 0
      ? `Audio hint: Silence regions in source video (prefer cuts here): ${audioAnalysis.silenceRegions
          .map(r => `${r.start.toFixed(1)}s-${r.end.toFixed(1)}s`)
          .join(', ')}. Speech present: ${audioAnalysis.hasSpeech}.`
      : `Audio hint: No detected silence regions. Speech present: ${audioAnalysis.hasSpeech}.`

  return `Watch this product video. You are an expert TikTok/Instagram ad copywriter.

Product: ${product.title}
Description: ${product.description}
Price: ${product.price}
Target duration: ${duration} seconds

${silenceHint}

Write a ${duration}-second narrated video ad. For each sentence of narration, specify
which timestamp range from the source video best matches what's being said.
Prefer using silence regions in the source audio for cuts to avoid cutting over speech.

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
      "videoStart": 0.0,
      "videoEnd": 4.2
    }
  ]
}`
}

function buildMusicPrompt(product: Product, duration: number): string {
  return `Watch this product video. Create a ${duration}-second music-only video ad
(no voiceover). Determine the best cuts based on visual content.

Product: ${product.title}
Description: ${product.description}
Price: ${product.price}
Target duration: ${duration} seconds

Return JSON only, no markdown:
{
  "adType": "music_only",
  "mood": "energetic|luxury|playful|professional|emotional|minimalist",
  "cuts": [
    { "videoStart": 0.0, "videoEnd": 3.5, "textOverlay": null },
    { "videoStart": 8.2, "videoEnd": 12.0, "textOverlay": "Product Name" },
    { "videoStart": 15.0, "videoEnd": 19.5, "textOverlay": "$29.99" }
  ]
}`
}

export async function analyzeVideoForNarratedAd(
  videoPath: string,
  product: Product,
  audioAnalysis: AudioAnalysis,
  duration: number,
): Promise<NarratedAnalysis> {
  const fileUri = await uploadAndWaitForActive(videoPath)

  const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY_1!)
  const model = genAI.getGenerativeModel({
    model: 'gemini-2.0-flash',
    generationConfig: { responseMimeType: 'application/json' },
  })

  const prompt = buildNarratedPrompt(product, audioAnalysis, duration)

  const result = await model.generateContent([
    { fileData: { mimeType: 'video/mp4', fileUri } },
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
  videoPath: string,
  product: Product,
  audioAnalysis: AudioAnalysis,
  duration: number,
): Promise<MusicAnalysis> {
  const fileUri = await uploadAndWaitForActive(videoPath)

  const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY_1!)
  const model = genAI.getGenerativeModel({
    model: 'gemini-2.0-flash',
    generationConfig: { responseMimeType: 'application/json' },
  })

  const prompt = buildMusicPrompt(product, duration)

  const result = await model.generateContent([
    { fileData: { mimeType: 'video/mp4', fileUri } },
    { text: prompt },
  ])

  const raw = result.response.text()
  const parsed = JSON.parse(raw)

  return {
    mood: parsed.mood,
    cuts: parsed.cuts,
  }
}
