export interface Cut {
  clipIndex: number
  videoStart: number
  videoEnd: number
  textOverlay?: string | null
}

/**
 * Snaps cut boundaries to the nearest beat in the Lyria music track.
 * Since Lyria generates at a known BPM, the beat map is pure math.
 */
export function snapCutsToBeatMap(cuts: Cut[], bpm: number, targetDuration: number): Cut[] {
  const interval = 60 / bpm

  const beats: number[] = []
  for (let t = 0; t <= targetDuration + interval; t += interval) {
    beats.push(Math.round(t * 1000) / 1000)
  }

  const snapToNearest = (t: number): number =>
    beats.reduce((prev, b) =>
      Math.abs(b - t) < Math.abs(prev - t) ? b : prev
    )

  return cuts.map((cut) => {
    const snappedStart = snapToNearest(cut.videoStart)
    let snappedEnd = snapToNearest(cut.videoEnd)

    // Enforce minimum segment length of one beat to avoid micro-cuts
    if (snappedEnd <= snappedStart) {
      snappedEnd = snappedStart + interval
    }

    return { ...cut, videoStart: snappedStart, videoEnd: snappedEnd }
  })
}

export function generateBeatMap(bpm: number, durationSeconds: number): number[] {
  const interval = 60 / bpm
  const beats: number[] = []
  for (let t = 0; t < durationSeconds; t += interval) {
    beats.push(Math.round(t * 1000) / 1000)
  }
  return beats
}
