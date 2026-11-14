"""
Canary Court demo film: an original, calm score, synthesised from scratch (no samples).

  python3 film/audio/score.py            # -> film/audio/score.wav (48 kHz, stereo, 24-bit) + score.mp3
  python3 film/audio/score.py --check    # + spectrogram PNG and per-section loudness report

Everything is generated with numpy/scipy and a fixed seed, so the same code renders the same file:
  piano  additive, slightly inharmonic partials with per-partial decay and a soft felt attack
  pad    detuned additive voices through a gentle low-pass, slow swells between chords
  sub    sine on the chord roots
  pulse  a very soft felted tick on the beat (only where the cue list asks for it)
  room   convolution with a synthetic, frequency-dependent decaying-noise impulse response
Mastered to -18 LUFS integrated (ITU-R BS.1770-4 K-weighting and gating) with true peak < -1 dBTP.
Needs numpy, scipy, soundfile (and matplotlib for --check); lame or ffmpeg for the mp3.

Re-timing: edit CUES (seconds). Every section lays its material out on the beat grid from its own
start, so moving a cue moves the music with it.
"""
import argparse
import math
import os
import shutil
import subprocess

import numpy as np
import soundfile as sf
from scipy import signal

HERE = os.path.dirname(os.path.abspath(__file__))
SR = 48000
BPM = 84.0
BEAT = 60.0 / BPM
SEED = 20261114

# ----------------------------------------------------------------------------- the cue list (seconds)
CUES = {
    "open": 0.0,       # sparse: single piano notes over a faint pad
    "pulse": 14.0,     # the soft pulse comes in (news wall)
    "build": 22.0,     # builds a little (problem cards)
    "hold": 38.0,      # a held moment (logo / dive): pulse stops
    "warm": 42.0,      # warm and full but still calm (product): the theme
    "lift": 70.0,      # lift (proof)
    "resolve": 76.0,   # resolve + tail (closing)
    "end": 85.0,
}
TARGET_LUFS = -18.0
TP_CEILING = -1.2      # dBTP, a little under the -1 dBTP spec


def midi(name):
    names = {"C": 0, "D": 2, "E": 4, "F": 5, "G": 7, "A": 9, "B": 11}
    n = names[name[0]]
    i = 1
    while i < len(name) and name[i] in "b#":
        n += -1 if name[i] == "b" else 1
        i += 1
    return 12 * (int(name[i:]) + 1) + n


def hz(m):
    return 440.0 * 2 ** ((m - 69) / 12)


def notes(s):
    return [midi(x) for x in s.split()]


# chords: (pad voicing, bass root)
CH = {
    "Cm9": (notes("Eb3 G3 Bb3 D4"), midi("C2")),
    "Abmaj7": (notes("Eb3 G3 C4 Eb4"), midi("Ab1")),
    "Eb/G": (notes("Eb3 Bb3 D4 G4"), midi("G1")),
    "Fm9": (notes("Eb3 Ab3 C4 G4"), midi("F1")),
    "Gsus4": (notes("D3 G3 C4 D4"), midi("G1")),
    "G": (notes("D3 G3 B3 D4"), midi("G1")),
    "Ebmaj9": (notes("D3 G3 Bb3 F4"), midi("Eb2")),
    "Bb/D": (notes("D3 F3 Bb3 D4"), midi("D2")),
    "Abmaj9": (notes("G3 Bb3 C4 Eb4"), midi("Ab1")),
    "Bbsus4": (notes("Eb3 F3 Bb3 Eb4"), midi("Bb1")),
    "Bb": (notes("D3 F3 Bb3 D4"), midi("Bb1")),
    "Ebmaj96": (notes("D3 G3 Bb3 C4 F4"), midi("Eb2")),
}


# ----------------------------------------------------------------------------- voices
class Bus:
    def __init__(self, seconds):
        self.n = int(seconds * SR) + SR * 6
        self.x = np.zeros((self.n, 2))

    def add(self, t, sig, pan=0.0, gain=1.0):
        i = int(round(t * SR))
        if i >= self.n:
            return
        sig = sig[: self.n - i]
        a = (pan + 1) * math.pi / 4                          # constant-power pan
        self.x[i:i + len(sig), 0] += sig * math.cos(a) * gain
        self.x[i:i + len(sig), 1] += sig * math.sin(a) * gain


def piano(m, vel=0.5, dur=None, rng=None):
    """Soft additive piano: inharmonic partials, faster decay up the series, felt-soft attack."""
    f0 = hz(m)
    dur = dur or min(7.0, 2.5 + 3.5 * (1 - (m - 40) / 60))
    n = int(dur * SR)
    t = np.arange(n) / SR
    B = 0.00035 * (1 + (m - 60) / 48)                        # inharmonicity
    out = np.zeros(n)
    bright = 0.55 + 0.6 * vel                                # softer touch = darker
    for k in range(1, 13):
        fk = f0 * k * math.sqrt(1 + B * k * k)
        if fk > 9000:
            break
        amp = (1.0 / k ** (1.6 - 0.5 * bright)) * (0.6 if k == 2 else 1.0)
        dec = (0.55 + 0.32 * k) * (1 + (m - 60) / 70)        # 1/s, higher partials die sooner
        detune = 1 + (rng.uniform(-0.0006, 0.0006) if rng is not None else 0)
        out += amp * np.exp(-dec * t) * np.sin(2 * math.pi * fk * detune * t + (rng.uniform(0, 6.28) if rng is not None else 0))
    att = 1 - np.exp(-t / 0.006)                             # ~6 ms felt attack
    rel = np.clip((dur - t) / 0.4, 0, 1)
    thump = np.exp(-t / 0.012) * np.sin(2 * math.pi * f0 * 0.5 * t) * 0.15
    return (out * att * rel + thump * (t < 0.06)) * vel * 0.27


def pad(chord_notes, dur, cutoff, rng, attack=1.8, release=2.6):
    """Detuned additive voices (odd-weighted, warm) through a 2-pole low-pass; returns stereo."""
    n = int((dur + release) * SR)
    t = np.arange(n) / SR
    L, R = np.zeros(n), np.zeros(n)
    for vi, m in enumerate(chord_notes):
        for d, side in ((-6.0, -1), (0.0, 0), (6.5, 1)):     # cents
            f = hz(m) * 2 ** (d / 1200)
            ph = rng.uniform(0, 6.28)
            vib = 1 + 0.0015 * np.sin(2 * math.pi * rng.uniform(0.15, 0.3) * t + ph)
            v = np.zeros(n)
            for k in range(1, 10):
                if f * k > 3500:
                    break
                v += (1.0 / k ** 1.7) * (1.0 if k % 2 else 0.55) * np.sin(2 * math.pi * f * k * vib * t + ph * k)
            p = 0.25 * side + 0.15 * (vi - len(chord_notes) / 2) / len(chord_notes)
            L += v * math.cos((p + 1) * math.pi / 4)
            R += v * math.sin((p + 1) * math.pi / 4)
    env = np.minimum(1, t / attack) * np.clip((dur + release - t) / release, 0, 1)
    env = env * env * (3 - 2 * env)
    b, a = signal.butter(2, cutoff / (SR / 2))
    L, R = signal.lfilter(b, a, L * env), signal.lfilter(b, a, R * env)
    hb, ha = signal.butter(1, 120 / (SR / 2), btype="high")      # keep the low-mids clear for the sub
    L, R = signal.lfilter(hb, ha, L), signal.lfilter(hb, ha, R)
    return np.stack([L, R], 1) * (0.042 / len(chord_notes))


def sub(m, dur, rel=0.6):
    """Sine on the root. Short release: overlapping subs a semitone apart would beat (an audible 'wah')."""
    n = int((dur + rel) * SR)
    t = np.arange(n) / SR
    env = np.minimum(1, t / 0.35) * np.clip((dur + rel - t) / rel, 0, 1)
    env = env * env * (3 - 2 * env)
    return np.sin(2 * math.pi * hz(m) * t) * env * 0.075


def pulse_tick(m, accent, rng):
    """A felted tick: a short low sine 'tok' plus a whisper of band-passed noise."""
    n = int(0.45 * SR)
    t = np.arange(n) / SR
    tone = np.sin(2 * math.pi * hz(m) * t) * np.exp(-t / 0.09) * (1 - np.exp(-t / 0.004))
    noise = rng.standard_normal(n) * np.exp(-t / 0.012)
    b, a = signal.butter(2, [1800 / (SR / 2), 4200 / (SR / 2)], btype="band")
    noise = signal.lfilter(b, a, noise) * 0.25
    return (tone + noise) * (0.05 if accent else 0.032)


def reverb_ir(rng, seconds=3.2, rt60=2.6):
    n = int(seconds * SR)
    t = np.arange(n) / SR
    ir = np.zeros((n, 2))
    bands = [(0, 400, 1.15), (400, 2000, 1.0), (2000, 8000, 0.65), (8000, 20000, 0.4)]   # (lo, hi, rt60 scale)
    for c in range(2):
        noise = rng.standard_normal(n)
        acc = np.zeros(n)
        for lo, hi, k in bands:
            if lo == 0:
                b, a = signal.butter(2, hi / (SR / 2))
            elif hi >= SR / 2:
                b, a = signal.butter(2, lo / (SR / 2), btype="high")
            else:
                b, a = signal.butter(2, [lo / (SR / 2), hi / (SR / 2)], btype="band")
            acc += signal.lfilter(b, a, noise) * np.exp(-6.91 * t / (rt60 * k))
        acc *= np.minimum(1, t / 0.02)                       # 20 ms soft onset (pre-delay feel)
        ir[:, c] = acc
    return ir / np.sqrt((ir ** 2).sum() / 2)


# ----------------------------------------------------------------------------- the score
def compose():
    rng = np.random.default_rng(SEED)
    C = CUES
    total = C["end"]
    dry, wet = Bus(total), Bus(total)

    def P(t, name, vel, pan=None, rv=0.38, dur=None):
        m = midi(name) if isinstance(name, str) else name
        s = piano(m, vel, dur, rng)
        pn = pan if pan is not None else max(-0.5, min(0.5, (m - 64) / 40))
        dry.add(t, s, pn)
        wet.add(t, s, pn, rv)

    def chord(t, name, dur, cutoff, gain=1.0, attack=1.8):
        voices, root = CH[name]
        s = pad(voices, dur, cutoff, rng, attack=attack) * gain
        i = int(t * SR)
        k = min(len(s), dry.n - i)
        dry.x[i:i + k] += s[:k] * 0.7
        wet.x[i:i + k] += s[:k] * 0.55
        return root

    def bass(t, root, dur, gain=1.0):
        s = sub(root + 12 if root < midi("C2") else root, dur) * gain
        dry.add(t, s, 0.0)

    def pulse(t0, t1, roots, accent_every=4, level=1.0):
        k, t = 0, t0
        while t < t1 - 1e-6:
            root = roots(t)
            tick = pulse_tick(root + 24, k % accent_every == 0, rng) * level
            dry.add(t, tick, 0.12)
            wet.add(t, tick, 0.12, 0.18)
            k += 1
            t += BEAT

    # A: open (sparse single notes over a faint Cm9)
    a0, a1 = C["open"], C["pulse"]
    chord(a0 + 0.3, "Cm9", a1 - a0 + 0.5, 650, gain=0.55, attack=4.0)
    for dt, n, v in ((0.9, "G4", 0.46), (3.7, "Eb5", 0.42), (6.1, "D5", 0.40), (8.8, "Bb4", 0.42),
                     (11.0, "C5", 0.38), (12.7, "G4", 0.34)):
        P(a0 + dt, n, v)
    bass(a0 + 6.0, CH["Cm9"][1], a1 - a0 - 6.0, gain=0.5)

    # B: the pulse (Cm9 -> Abmaj7), a two-note figure per bar
    b0, b1 = C["pulse"], C["build"]
    mid = b0 + 2 * 4 * BEAT
    chord(b0, "Cm9", mid - b0, 750, gain=0.75)
    chord(mid, "Abmaj7", b1 - mid, 800, gain=0.75)
    bass(b0, CH["Cm9"][1], mid - b0, 0.8)
    bass(mid, CH["Abmaj7"][1], b1 - mid, 0.8)
    pulse(b0, b1, lambda t: CH["Cm9"][1] if t < mid else CH["Abmaj7"][1], level=0.8)
    bar = 0
    t = b0
    while t < b1 - 0.5:
        m1, m2 = (("G4", "Eb5") if t < mid else ("C5", "G5"))
        P(t + 0 * BEAT, m1, 0.36)
        P(t + 1.5 * BEAT, m2, 0.32)
        t += 4 * BEAT
        bar += 1

    # C: build a little (Abmaj7, Eb/G, Fm9, Gsus4 -> G), soft broken chords in eighths
    c0, c1 = C["build"], C["hold"]
    span = (c1 - c0)
    plan = [("Abmaj7", 0.25), ("Eb/G", 0.25), ("Fm9", 0.25), ("Gsus4", 0.16), ("G", 0.09)]
    t = c0
    for i, (name, frac) in enumerate(plan):
        d = span * frac
        cut = 800 + 600 * (t - c0) / span
        root = chord(t, name, d, cut, gain=0.85 + 0.2 * (t - c0) / span)
        bass(t, root, d, 0.9)
        arp = sorted(CH[name][0])
        arp = [x + 12 for x in arp] + [arp[-1] + 17]
        k, tt = 0, t
        while tt < t + d - 0.2:
            seq = arp + arp[-2:0:-1]
            P(tt, seq[k % len(seq)], 0.24 + 0.08 * (tt - c0) / span, rv=0.32)
            k += 1
            tt += BEAT / 2
        t += d
    pulse(c0, c1, lambda tt: CH["Abmaj7"][1], level=0.9)

    # D: the held moment: the pulse stops, G sustains and swells, one high note
    d0, d1 = C["hold"], C["warm"]
    chord(d0, "G", d1 - d0 + 0.4, 1500, gain=1.0, attack=0.8)
    dry.add(d0, sub(CH["G"][1] + 12, d1 - d0, rel=0.6) * 0.7)
    P(d0 + 0.15, "D6", 0.34, rv=0.6, dur=6.5)
    P(d0 + 0.15, "G2", 0.30, dur=6.0)

    # E: warm and full, still calm: the theme (Ebmaj9, Bb/D, Cm9, Abmaj9, Fm9, Bbsus4)
    e0, e1 = C["warm"], C["lift"]
    two_bars = 8 * BEAT
    prog = ["Ebmaj9", "Bb/D", "Cm9", "Abmaj9"]
    t = e0
    for name in prog:
        root = chord(t, name, two_bars, 1400, gain=1.05)
        bass(t, root, two_bars, 1.0)
        P(t, root + 12, 0.32, rv=0.3)                         # left hand: the root, low
        P(t + 4 * BEAT, root + 19, 0.26, rv=0.3)              # and the fifth on bar 2
        t += two_bars
    rest = e1 - t
    root = chord(t, "Fm9", rest * 0.55, 1400, gain=1.0)
    bass(t, root, rest * 0.55)
    P(t, root + 12, 0.3)
    t2 = t + rest * 0.55
    root = chord(t2, "Bbsus4", e1 - t2, 1500, gain=1.0)
    bass(t2, root, e1 - t2)
    P(t2, root + 12, 0.3)
    melody = [  # (beat from e0, note, velocity): an original 4-phrase line
        (0, "Bb4", .44), (1.5, "G5", .50), (2, "F5", .42), (3, "Eb5", .46), (5, "D5", .38), (6, "Eb5", .40),
        (8, "F5", .46), (9.5, "D5", .40), (10, "Eb5", .40), (11, "F5", .46), (13, "Bb4", .36), (14, "C5", .38),
        (16, "G5", .50), (17.5, "Eb5", .42), (18, "D5", .40), (19, "C5", .42), (21, "G4", .36), (22, "Bb4", .38),
        (24, "C5", .44), (25.5, "Eb5", .46), (26, "G5", .50), (27, "F5", .42), (29, "Eb5", .38), (30, "C5", .36),
        (32, "Ab4", .40), (33, "C5", .40), (34, "Eb5", .42), (35.5, "F5", .46), (37, "Eb5", .38), (38, "D5", .36),
    ]
    for b, n, v in melody:
        if e0 + b * BEAT < e1 - 0.2:
            P(e0 + b * BEAT, n, v, rv=0.4)
    pulse(e0 + 4 * BEAT, e1, lambda tt: CH["Ebmaj9"][1], level=0.7)

    # F: the lift (Abmaj9 -> Bbsus4 -> Bb), an octave-up arpeggio, the pad opens
    f0_, f1 = C["lift"], C["resolve"]
    span = f1 - f0_
    t = f0_
    for name, frac in (("Abmaj9", 0.5), ("Bbsus4", 0.25), ("Bb", 0.25)):
        d = span * frac
        root = chord(t, name, d, 1800 + 800 * (t - f0_) / span, gain=1.15)
        bass(t, root, d, 1.05)
        arp = [x + 24 for x in sorted(CH[name][0])]
        k, tt = 0, t
        while tt < t + d - 0.15:
            P(tt, arp[k % len(arp)], 0.30 + 0.1 * (tt - f0_) / span, rv=0.45)
            k += 1
            tt += BEAT / 2
        t += d
    pulse(f0_, f1, lambda tt: CH["Abmaj9"][1] if tt < f0_ + span / 2 else CH["Bb"][1], level=0.85)

    # G: resolve (Ebmaj9 add 6) and let it ring out
    g0, g1 = C["resolve"], C["end"]
    root = chord(g0, "Ebmaj96", (g1 - g0) - 3.6, 1600, gain=1.1, attack=0.5)
    dry.add(g0, sub(CH["Ebmaj96"][1], (g1 - g0) - 3.6, rel=3.0) * 0.9)          # the last one may ring
    P(g0, "Eb3", 0.38, dur=7.0)
    P(g0, "Bb3", 0.34, dur=7.0)
    for dt, n, v in ((0.25, "G5", 0.44), (1.4, "Bb5", 0.40), (2.6, "D6", 0.36), (4.4, "Eb6", 0.32)):
        P(g0 + dt, n, v, rv=0.55, dur=6.0)

    return dry, wet, rng


# ----------------------------------------------------------------------------- loudness
def k_weight(x):
    b1, a1 = [1.53512485958697, -2.69169618940638, 1.19839281085285], [1.0, -1.69065929318241, 0.73248077421585]
    b2, a2 = [1.0, -2.0, 1.0], [1.0, -1.99004745483398, 0.99007225036621]
    return signal.lfilter(b2, a2, signal.lfilter(b1, a1, x, axis=0), axis=0)


def lufs(x):
    """Integrated loudness (ITU-R BS.1770-4) of a 48 kHz stereo signal."""
    y = k_weight(x)
    blk, hop = int(0.4 * SR), int(0.1 * SR)
    ms = np.array([(y[i:i + blk] ** 2).mean(0).sum() for i in range(0, len(y) - blk, hop)])
    lk = -0.691 + 10 * np.log10(ms + 1e-12)
    g = ms[lk > -70]
    rel = -0.691 + 10 * np.log10(g.mean()) - 10
    g = g[-0.691 + 10 * np.log10(g + 1e-12) > rel]
    return -0.691 + 10 * np.log10(g.mean())


def true_peak_db(x):
    up = signal.resample_poly(x, 4, 1, axis=0)
    return 20 * np.log10(np.abs(up).max() + 1e-12)


def master(mix):
    # gentle glue: a slow RMS-follow compressor (2:1 above -24 dBFS), then loudness + true-peak
    env = np.sqrt(signal.lfilter([0.0005], [1, -0.9995], (mix ** 2).mean(1)) + 1e-12)
    lvl = 20 * np.log10(env)
    gain_db = np.where(lvl > -24, -(lvl + 24) * 0.5, 0.0)
    mix = mix * (10 ** (gain_db / 20))[:, None]
    mix = mix * 10 ** ((TARGET_LUFS - lufs(mix)) / 20)
    tp = true_peak_db(mix)
    if tp > TP_CEILING:                                      # soft-knee peak limiter, look-ahead 2 ms
        lim = 10 ** (TP_CEILING / 20)
        peak = np.abs(mix).max(1)
        g = np.minimum(1, lim / np.maximum(peak, 1e-9))
        g = np.minimum.accumulate(np.r_[g[96:], np.ones(96)][::-1])[::-1] if False else g
        g = signal.lfilter([0.02], [1, -0.98], np.minimum(g, 1))
        mix = mix * np.minimum(1, g)[:, None]
        mix = mix * 10 ** ((TARGET_LUFS - lufs(mix)) / 20)
    return mix


def render(check=False):
    dry, wet, rng = compose()
    ir = reverb_ir(rng)
    room = np.stack([signal.fftconvolve(wet.x[:, c], ir[:, c])[: wet.n] for c in range(2)], 1)
    mix = dry.x + room * 0.55
    hp_b, hp_a = signal.butter(2, 28 / (SR / 2), btype="high")
    mix = signal.lfilter(hp_b, hp_a, mix, axis=0)
    n = int(CUES["end"] * SR)
    mix = mix[:n]
    fade = int(2.5 * SR)
    mix[-fade:] *= np.linspace(1, 0, fade)[:, None] ** 2
    mix[: int(0.02 * SR)] *= np.linspace(0, 1, int(0.02 * SR))[:, None]
    mix = master(mix)
    wav = os.path.join(HERE, "score.wav")
    sf.write(wav, mix, SR, subtype="PCM_24")
    mp3 = os.path.join(HERE, "score.mp3")
    if shutil.which("lame"):
        subprocess.run(["lame", "--quiet", "-b", "192", "-q", "2", wav, mp3], check=True)
    elif shutil.which("ffmpeg"):
        subprocess.run(["ffmpeg", "-v", "error", "-y", "-i", wav, "-b:a", "192k", mp3], check=True)
    print(f"score.wav: {len(mix) / SR:.2f}s, {lufs(mix):.2f} LUFS integrated, true peak {true_peak_db(mix):.2f} dBTP, "
          f"sample peak {20 * np.log10(np.abs(mix).max()):.2f} dBFS")
    if check:
        report(mix)


def report(mix):
    import matplotlib
    matplotlib.use("Agg")
    import matplotlib.pyplot as plt
    names = list(CUES)
    print("per section (RMS dBFS, short-term loudness of the section):")
    for a, b in zip(names[:-1], names[1:]):
        s = mix[int(CUES[a] * SR): int(CUES[b] * SR)]
        rms = 20 * np.log10(np.sqrt((s ** 2).mean()) + 1e-12)
        print(f"  {a:8s} {CUES[a]:5.1f}-{CUES[b]:5.1f}s  RMS {rms:6.1f} dBFS   loudness {lufs(s) if len(s) > SR else float('nan'):6.1f} LUFS")
    f, t, S = signal.spectrogram(mix.mean(1), SR, nperseg=4096, noverlap=3072)
    fig, ax = plt.subplots(2, 1, figsize=(14, 7), gridspec_kw={"height_ratios": [3, 1]})
    ax[0].pcolormesh(t, f, 10 * np.log10(S + 1e-12), shading="auto", cmap="magma", vmin=-130, vmax=-40)
    ax[0].set_yscale("symlog", linthresh=100)
    ax[0].set_ylim(20, 16000)
    ax[0].set_title("Canary Court score: spectrogram")
    env = np.sqrt(signal.lfilter([0.002], [1, -0.998], (mix ** 2).mean(1)))
    tt = np.arange(len(env)) / SR
    ax[1].plot(tt[::480], 20 * np.log10(env[::480] + 1e-9), lw=0.8)
    for k, v in CUES.items():
        ax[0].axvline(v, color="w", lw=0.5, alpha=0.5)
        ax[1].axvline(v, color="k", lw=0.5, alpha=0.4)
        ax[1].text(v + 0.3, -18, k, fontsize=8)
    ax[1].set_ylim(-60, -10)
    ax[1].set_ylabel("RMS dBFS")
    ax[1].set_xlim(0, CUES["end"])
    ax[0].set_xlim(0, CUES["end"])
    plt.tight_layout()
    out = os.path.join(HERE, "score_check.png")
    plt.savefig(out, dpi=80)
    print("check:", out)


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--check", action="store_true")
    render(ap.parse_args().check)
