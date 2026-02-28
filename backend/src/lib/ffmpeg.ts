import { execFile } from 'child_process';
import { promisify } from 'util';
import path from 'path';
import os from 'os';

const execFileAsync = promisify(execFile);

// ─── Types ────────────────────────────────────────────────────────────────────

export interface Sentence {
  videoStart: number;
  videoEnd: number;
}

export interface Cut {
  videoStart: number;
  videoEnd: number;
  textOverlay?: string | null;
}

export interface AudioAnalysis {
  hasSpeech: boolean;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Pick a font file that exists on the current OS. */
function systemFont(): string {
  switch (os.platform()) {
    case 'win32':
      return 'C:\\Windows\\Fonts\\arial.ttf';
    case 'darwin':
      return '/System/Library/Fonts/Helvetica.ttc';
    default:
      return '/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf';
  }
}

/** Run ffmpeg with the given args, logging the full command on failure. */
async function runFFmpeg(args: string[]): Promise<void> {
  try {
    await execFileAsync('ffmpeg', args, { maxBuffer: 100 * 1024 * 1024 });
  } catch (err: unknown) {
    const e = err as { stderr?: string; message?: string };
    console.error('FFmpeg failed.\nCommand:', ['ffmpeg', ...args].join(' '));
    console.error('Stderr:', e.stderr ?? e.message);
    throw new Error(`FFmpeg error: ${e.stderr ?? e.message}`);
  }
}

// ─── Narrated Ad ──────────────────────────────────────────────────────────────

/**
 * Compose a narrated ad. Trims source video segments to match per-sentence
 * ElevenLabs narration durations, then layers voice + sidechain-ducked music
 * + spatial SFX into the final 1080x1920 MP4.
 *
 * Input index map:
 *   0 → source video
 *   1 → narration MP3 (full concatenated narration from ElevenLabs)
 *   2 → music WAV (from Lyria)
 *   3…3+cutCount-1 → SFX whoosh files (one per cut transition)
 */
export async function composeNarratedAd(
  videoPath: string,
  narrationPath: string,
  musicPath: string,
  sfxDir: string,
  sentences: Sentence[],
  chunkDurations: number[], // ms per sentence, measured by ffprobe
  audioAnalysis: AudioAnalysis,
  outputPath: string
): Promise<void> {
  const n = sentences.length;
  if (n === 0) throw new Error('composeNarratedAd: no sentences provided');

  const cutCount = n - 1; // transitions between segments

  // Build -i input list
  const inputs: string[] = [
    '-i', videoPath,
    '-i', narrationPath,
    '-i', musicPath,
  ];
  for (let i = 0; i < cutCount; i++) {
    inputs.push('-i', path.join(sfxDir, `whoosh-${(i % 3) + 1}.mp3`));
  }

  const f: string[] = []; // filter_complex parts

  // ── VIDEO ──────────────────────────────────────────────────────────────────

  // Split source into N independent streams
  f.push(`[0:v]split=${n}${range(n).map(i => `[v${i}]`).join('')}`);

  for (let i = 0; i < n; i++) {
    const { videoStart, videoEnd } = sentences[i];
    const targetDur = chunkDurations[i] / 1000;          // seconds
    const clipDur   = videoEnd - videoStart;
    const trimDur   = Math.min(clipDur, targetDur);
    const padDur    = Math.max(0, targetDur - clipDur);  // hold last frame if clip too short

    const padFilter = padDur > 0.01
      ? `,tpad=stop_mode=clone:stop_duration=${padDur.toFixed(3)}`
      : '';

    f.push(
      `[v${i}]trim=start=${videoStart.toFixed(3)}:duration=${trimDur.toFixed(3)},` +
      `setpts=PTS-STARTPTS${padFilter}[seg${i}]`
    );
  }

  // Concat all segments
  f.push(`${range(n).map(i => `[seg${i}]`).join('')}concat=n=${n}:v=1:a=0[vc]`);

  // Scale to 1080x1920 with black letterbox
  f.push(
    `[vc]scale=1080:1920:force_original_aspect_ratio=decrease,` +
    `pad=1080:1920:(ow-iw)/2:(oh-ih)/2:color=black[v]`
  );

  // ── AUDIO ──────────────────────────────────────────────────────────────────

  // Voice: format mono → stereo (ElevenLabs outputs mono)
  f.push(`[1:a]aformat=sample_fmts=fltp:sample_rates=44100:channel_layouts=stereo[voice]`);

  // Music: widen stereo field with stereotools (M/S mode, boost side channel)
  f.push(
    `[2:a]aformat=sample_fmts=fltp:sample_rates=44100:channel_layouts=stereo,` +
    `stereotools=mode=ms:slevel=1.5[music_wide]`
  );

  // Sidechain ducking: music ducks under voice, swells in gaps
  f.push(
    `[music_wide][voice]sidechaincompress=` +
    `threshold=0.02:ratio=6:attack=200:release=1000[ducked]`
  );

  // SFX: whoosh 100ms before each cut, alternating L/R pan, 50% volume
  const sfxLabels: string[] = [];
  let cumulativeMs = 0;

  for (let i = 0; i < cutCount; i++) {
    cumulativeMs += chunkDurations[i];
    const delayMs   = Math.max(0, cumulativeMs - 100);
    const sfxInput  = 3 + i;
    const sfxLabel  = `sfx${i}`;
    // Even cuts pan left, odd cuts pan right
    const pan = i % 2 === 0
      ? 'pan=stereo|c0=1.5*c0|c1=0.3*c0'
      : 'pan=stereo|c0=0.3*c0|c1=1.5*c0';

    f.push(`[${sfxInput}:a]adelay=${delayMs}|${delayMs},${pan},volume=0.5[${sfxLabel}]`);
    sfxLabels.push(`[${sfxLabel}]`);
  }

  // Ambient bed: mix source audio at 10% if no speech (interesting ambient sound)
  const ambientLabels: string[] = [];
  if (!audioAnalysis.hasSpeech) {
    f.push(`[0:a]volume=0.1[ambient]`);
    ambientLabels.push('[ambient]');
  }

  // Final mix — normalize=0 preserves relative levels
  const mixStreams = ['[voice]', '[ducked]', ...sfxLabels, ...ambientLabels];
  f.push(
    `${mixStreams.join('')}amix=inputs=${mixStreams.length}:duration=first:normalize=0[a]`
  );

  await runFFmpeg([
    ...inputs,
    '-filter_complex', f.join(';\n'),
    '-map', '[v]',
    '-map', '[a]',
    '-c:v', 'libx264', '-preset', 'ultrafast',
    '-c:a', 'aac', '-b:a', '192k',
    '-shortest',
    '-y', outputPath,
  ]);
}

// ─── Music-Only Ad ────────────────────────────────────────────────────────────

/**
 * Compose a music-only ad from beat-snapped cuts (see lib/beats.ts).
 * Burns in text overlays where specified, full-width spatial music, hard-panned SFX.
 *
 * Input index map:
 *   0 → source video
 *   1 → music WAV (from Lyria)
 *   2…2+cutCount-1 → SFX whoosh files
 */
export async function composeMusicAd(
  videoPath: string,
  musicPath: string,
  sfxDir: string,
  cuts: Cut[],
  audioAnalysis: AudioAnalysis,
  outputPath: string
): Promise<void> {
  const n = cuts.length;
  if (n === 0) throw new Error('composeMusicAd: no cuts provided');

  const cutCount = n - 1;
  const font = systemFont();

  const inputs: string[] = ['-i', videoPath, '-i', musicPath];
  for (let i = 0; i < cutCount; i++) {
    inputs.push('-i', path.join(sfxDir, `whoosh-${(i % 3) + 1}.mp3`));
  }

  const f: string[] = [];

  // ── VIDEO ──────────────────────────────────────────────────────────────────

  f.push(`[0:v]split=${n}${range(n).map(i => `[v${i}]`).join('')}`);

  for (let i = 0; i < n; i++) {
    const { videoStart, videoEnd, textOverlay } = cuts[i];
    const dur = (videoEnd - videoStart).toFixed(3);

    let chain =
      `[v${i}]trim=start=${videoStart.toFixed(3)}:duration=${dur},setpts=PTS-STARTPTS`;

    if (textOverlay) {
      // Escape characters that break FFmpeg filter syntax
      const safe = textOverlay.replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/:/g, '\\:');
      chain +=
        `,drawtext=text='${safe}'` +
        `:fontfile='${font.replace(/\\/g, '/').replace(/:/g, '\\:')}'` +
        `:fontsize=72:fontcolor=white` +
        `:x=(w-text_w)/2:y=(h-text_h)/2` +
        `:box=1:boxcolor=black@0.5:boxborderw=10`;
    }

    f.push(`${chain}[seg${i}]`);
  }

  f.push(`${range(n).map(i => `[seg${i}]`).join('')}concat=n=${n}:v=1:a=0[vc]`);
  f.push(
    `[vc]scale=1080:1920:force_original_aspect_ratio=decrease,` +
    `pad=1080:1920:(ow-iw)/2:(oh-ih)/2:color=black[v]`
  );

  // ── AUDIO ──────────────────────────────────────────────────────────────────

  // Music: more aggressive widening since no voice to protect
  f.push(
    `[1:a]aformat=sample_fmts=fltp:sample_rates=44100:channel_layouts=stereo,` +
    `stereotools=mode=ms:slevel=1.8[music_wide]`
  );

  // SFX: full volume, hard L/R pans at each beat-synced cut
  const sfxLabels: string[] = [];
  let cumulativeSecs = 0;

  for (let i = 0; i < cutCount; i++) {
    cumulativeSecs += cuts[i].videoEnd - cuts[i].videoStart;
    const delayMs  = Math.max(0, Math.round(cumulativeSecs * 1000) - 100);
    const sfxInput = 2 + i;
    const sfxLabel = `sfx${i}`;
    // Hard pans: fully left or fully right
    const pan = i % 2 === 0
      ? 'pan=stereo|c0=2*c0|c1=0'
      : 'pan=stereo|c0=0|c1=2*c0';

    f.push(`[${sfxInput}:a]adelay=${delayMs}|${delayMs},${pan}[${sfxLabel}]`);
    sfxLabels.push(`[${sfxLabel}]`);
  }

  // Ambient bed: source audio at 10% if no speech
  const ambientLabels: string[] = [];
  if (!audioAnalysis.hasSpeech) {
    f.push(`[0:a]volume=0.1[ambient]`);
    ambientLabels.push('[ambient]');
  }

  const mixStreams = ['[music_wide]', ...sfxLabels, ...ambientLabels];
  f.push(
    `${mixStreams.join('')}amix=inputs=${mixStreams.length}:duration=first:normalize=0[a]`
  );

  await runFFmpeg([
    ...inputs,
    '-filter_complex', f.join(';\n'),
    '-map', '[v]',
    '-map', '[a]',
    '-c:v', 'libx264', '-preset', 'ultrafast',
    '-c:a', 'aac', '-b:a', '192k',
    '-shortest',
    '-y', outputPath,
  ]);
}

// ─── Utils ────────────────────────────────────────────────────────────────────

function range(n: number): number[] {
  return Array.from({ length: n }, (_, i) => i);
}
