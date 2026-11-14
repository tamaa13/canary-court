# Canary Court demo film: score

An original ~85 s score, synthesised from scratch by `score.py` (numpy/scipy, fixed seed:
the same code renders a bit-identical file). No samples, no loops, nothing taken from the
reference. The reference was only analysed for mood (numbers below).

| file | what |
|---|---|
| `score.py` | the generator: cue list at the top (seconds), instruments, mix, mastering, `--check` report |
| `score.wav` | 48 kHz, stereo, 24-bit PCM, 85.0 s |
| `score.mp3` | 192 kbps preview |
| `score_check.png` | spectrogram + RMS curve with the cue marks |

```bash
python3 film/audio/score.py --check     # needs numpy, scipy, soundfile, matplotlib; lame or ffmpeg
```

## Reference analysis (a reference pitch film, music from ~0:14; analysis only)

- Tempo ≈ 86 BPM (tempogram peaks at 86 and its double); sparse, ~1.35 onsets/s.
- Key/mode: D minor (Krumhansl correlation 0.92), with F major colour; pitch classes D F A C E (minor 9th colours).
- Timbre: very warm and dark. 57% of the energy is below 250 Hz and only ~6% above 1 kHz (spectral centroid ~860 Hz). Mostly harmonic (H/P +5.6 dB): soft keys over pads with a strong sub, a light pulse, and a few airy transitions.
- Dynamics/structure: level steady around −19 to −21 dB RMS. A dense opening, a gap and a held low drone around 0:28–0:40, then a long warm section with slow bass changes to the end.

## The score (original): C minor → E♭ major, 84 BPM

| cue | time | what happens |
|---|---|---|
| open | 0:00–0:14 | single soft piano notes (G, E♭, D, B♭, C) over a faint Cm9 pad; the sub enters at 0:06 |
| pulse | 0:14–0:22 | a felted tick on every beat comes in; Cm9 → A♭maj7 with a two-note piano figure |
| build | 0:22–0:38 | A♭maj7 · E♭/G · Fm9 · Gsus4 → G, soft eighth-note broken chords; the pad slowly opens |
| hold | 0:38–0:42 | the pulse stops; G sustains and swells, one high D rings |
| warm | 0:42–1:10 | the theme in E♭: E♭maj9 · B♭/D · Cm9 · A♭maj9 · Fm9 · B♭sus4, an original four-phrase piano line, pulse back softly |
| lift | 1:10–1:16 | A♭maj9 → B♭sus4 → B♭, an octave-up arpeggio, the pad opens, slightly louder |
| resolve | 1:16–1:25 | E♭maj9(6), the pulse stops, last piano notes G · B♭ · D · E♭, rings into the tail and fades |

Instruments: an additive piano with slightly inharmonic, individually decaying partials and a felt
attack; detuned additive pads through a gentle low-pass (high-passed at 120 Hz); a sine sub on the
roots (short release, so neighbouring roots never beat); a very soft felted tick for the pulse; a
convolution room with a synthetic, frequency-dependent noise impulse response (RT60 ≈ 2.6 s).

## Self-check

- Integrated loudness **−18.0 LUFS** (own BS.1770-4 implementation; ffmpeg `ebur128` agrees: −18.0 LUFS, LRA 6.7 LU)
- True peak **−4.5 dBTP** (4× oversampled), sample peak −4.6 dBFS: no clipping
- Per section (short-term loudness): open −22.3, pulse −20.4, build −17.5, hold −19.0, warm −17.2, lift −15.8 (the peak), resolve −18.7 LUFS
- Spectral balance: 13% at 20–80 Hz, 35% at 80–250 Hz, 44% at 250 Hz–1 kHz, 7% at 1–4 kHz, centroid ~750 Hz. Warm like the reference, a little clearer in the low-mids.

Re-timing: edit `CUES` at the top of `score.py` and re-run. Each section lays its material out on
the beat grid from its own start.
