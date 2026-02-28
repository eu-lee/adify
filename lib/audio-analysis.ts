import { execFile } from 'child_process'
import { promisify } from 'util'

const execFileAsync = promisify(execFile)

export interface SilenceRegion {
  start: number
  end: number
}

export interface AudioAnalysis {
  silenceRegions: SilenceRegion[]
  meanVolume: number
  peakVolume: number
  hasSpeech: boolean
}

function parseSilenceRegions(stderr: string): SilenceRegion[] {
  const regions: SilenceRegion[] = []
  const startPattern = /silence_start:\s*([\d.]+)/g
  const endPattern = /silence_end:\s*([\d.]+)/g

  const starts: number[] = []
  const ends: number[] = []

  let m: RegExpExecArray | null
  while ((m = startPattern.exec(stderr)) !== null) starts.push(parseFloat(m[1]))
  while ((m = endPattern.exec(stderr)) !== null) ends.push(parseFloat(m[1]))

  for (let i = 0; i < Math.min(starts.length, ends.length); i++) {
    regions.push({ start: starts[i], end: ends[i] })
  }

  // Handle trailing silence (no silence_end if video ends mid-silence)
  if (starts.length > ends.length) {
    const durationMatch = stderr.match(/Duration:\s*(\d+):(\d+):([\d.]+)/)
    if (durationMatch) {
      const totalSeconds =
        parseInt(durationMatch[1]) * 3600 +
        parseInt(durationMatch[2]) * 60 +
        parseFloat(durationMatch[3])
      regions.push({ start: starts[starts.length - 1], end: totalSeconds })
    }
  }

  return regions
}

function parseVolumeDetect(stderr: string): { meanVolume: number; peakVolume: number } {
  const meanMatch = stderr.match(/mean_volume:\s*([-\d.]+)\s*dB/)
  const peakMatch = stderr.match(/max_volume:\s*([-\d.]+)\s*dB/)
  return {
    meanVolume: meanMatch ? parseFloat(meanMatch[1]) : -91,
    peakVolume: peakMatch ? parseFloat(peakMatch[1]) : -91,
  }
}

export async function analyzeSourceAudio(videoPath: string): Promise<AudioAnalysis> {
  const [silenceResult, volumeResult] = await Promise.all([
    execFileAsync('ffmpeg', [
      '-i', videoPath,
      '-af', 'silencedetect=noise=-30dB:d=0.5',
      '-f', 'null', '-',
    ]).catch((e: { stderr: string }) => ({ stderr: e.stderr ?? '' })),

    execFileAsync('ffmpeg', [
      '-i', videoPath,
      '-af', 'volumedetect',
      '-f', 'null', '-',
    ]).catch((e: { stderr: string }) => ({ stderr: e.stderr ?? '' })),
  ])

  // ffmpeg writes filter output to stderr even on success
  const silenceStderr = (silenceResult as { stderr: string }).stderr
  const volumeStderr = (volumeResult as { stderr: string }).stderr

  const silenceRegions = parseSilenceRegions(silenceStderr)
  const { meanVolume, peakVolume } = parseVolumeDetect(volumeStderr)

  // Heuristic: speech likely present if mean volume is audible and there are few silence gaps
  const hasSpeech = meanVolume > -30 && silenceRegions.length < 5

  return { silenceRegions, meanVolume, peakVolume, hasSpeech }
}
