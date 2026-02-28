import { Router, Request, Response } from 'express';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import os from 'os';
import { composeNarratedAd, composeMusicAd, Cut, Sentence } from '../lib/ffmpeg';
import { snapCutsToBeatMap } from '../lib/beats';

const router = Router();
const upload = multer({ dest: path.join(os.tmpdir(), 'adify-uploads') });

const SFX_DIR = path.join(process.cwd(), '..', 'public', 'sfx');

router.post(
  '/',
  upload.fields([
    { name: 'video', maxCount: 1 },
    { name: 'narration', maxCount: 1 },
    { name: 'music', maxCount: 1 },
  ]),
  async (req: Request, res: Response): Promise<void> => {
    const tmpDir = path.join(os.tmpdir(), `adify-${Date.now()}`);
    fs.mkdirSync(tmpDir, { recursive: true });

    try {
      const files = req.files as Record<string, Express.Multer.File[]>;
      const body = req.body as Record<string, string>;

      // ── Validate required fields ──────────────────────────────────────────

      if (!files.video?.[0]) {
        res.status(400).json({ error: 'Missing video file' });
        return;
      }
      if (!files.music?.[0]) {
        res.status(400).json({ error: 'Missing music file' });
        return;
      }

      const adType: 'narrated' | 'music_only' = body.adType as 'narrated' | 'music_only';
      if (!adType || !['narrated', 'music_only'].includes(adType)) {
        res.status(400).json({ error: 'adType must be "narrated" or "music_only"' });
        return;
      }

      const audioAnalysis = JSON.parse(body.audioAnalysis ?? '{"hasSpeech":false}') as {
        hasSpeech: boolean;
      };

      // ── Move uploaded files to a named tmp dir ────────────────────────────

      const videoPath = path.join(tmpDir, 'source.mp4');
      fs.renameSync(files.video[0].path, videoPath);

      const musicPath = path.join(tmpDir, 'music.wav');
      fs.renameSync(files.music[0].path, musicPath);

      const outputPath = path.join(tmpDir, 'output.mp4');

      // ── Compose ───────────────────────────────────────────────────────────

      if (adType === 'narrated') {
        if (!files.narration?.[0]) {
          res.status(400).json({ error: 'Missing narration file for narrated ad' });
          return;
        }

        const narrationPath = path.join(tmpDir, 'narration.mp3');
        fs.renameSync(files.narration[0].path, narrationPath);

        const sentences: Sentence[] = JSON.parse(body.cutList ?? '[]');
        const chunkDurations: number[] = JSON.parse(body.chunkDurations ?? '[]');

        if (sentences.length === 0) {
          res.status(400).json({ error: 'cutList is empty' });
          return;
        }
        if (chunkDurations.length !== sentences.length) {
          res.status(400).json({
            error: `chunkDurations length (${chunkDurations.length}) must match sentences length (${sentences.length})`,
          });
          return;
        }

        await composeNarratedAd(
          videoPath,
          narrationPath,
          musicPath,
          SFX_DIR,
          sentences,
          chunkDurations,
          audioAnalysis,
          outputPath
        );
      } else {
        // music_only
        const bpm = parseFloat(body.bpm ?? '120');
        const rawCuts: Cut[] = JSON.parse(body.cutList ?? '[]');

        if (rawCuts.length === 0) {
          res.status(400).json({ error: 'cutList is empty' });
          return;
        }

        const totalDuration = rawCuts.reduce(
          (sum, c) => sum + (c.videoEnd - c.videoStart),
          0
        );
        const cuts = snapCutsToBeatMap(rawCuts, bpm, totalDuration);

        await composeMusicAd(videoPath, musicPath, SFX_DIR, cuts, audioAnalysis, outputPath);
      }

      // ── Stream output back ────────────────────────────────────────────────

      const stat = fs.statSync(outputPath);
      res.setHeader('Content-Type', 'video/mp4');
      res.setHeader('Content-Length', stat.size);
      res.setHeader('Content-Disposition', 'attachment; filename="ad.mp4"');

      const stream = fs.createReadStream(outputPath);
      stream.pipe(res);
      stream.on('end', () => cleanup(tmpDir));
      stream.on('error', (err) => {
        console.error('Stream error:', err);
        cleanup(tmpDir);
      });
    } catch (err: unknown) {
      cleanup(tmpDir);
      const message = err instanceof Error ? err.message : String(err);
      console.error('compose-video error:', message);
      res.status(500).json({ error: message });
    }
  }
);

function cleanup(dir: string): void {
  try {
    fs.rmSync(dir, { recursive: true, force: true });
  } catch {
    // best-effort cleanup — log but don't crash
    console.warn(`Failed to clean up ${dir}`);
  }
}

export default router;
