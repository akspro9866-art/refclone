// Deterministic Foley approximations. Pulses describe contacts, brushes and release.
export const MATERIAL_SFX = {
  'paper-feed': { duration: 0.32, cutoff: 2800, noise: 0.35, modes: [[115, 0.06]], pulses: [[0, 0.8, 0.09], [0.12, 0.45, 0.12], [0.25, 0.9, 0.026]] },
  'ink-stamp': { duration: 0.16, cutoff: 1200, noise: 0.32, modes: [[106, 0.5], [233, 0.18]], pulses: [[0, 1, 0.038], [0.065, 0.15, 0.024]] },
  'hinge-latch': { duration: 0.14, cutoff: 4200, noise: 0.26, modes: [[180, 0.26], [750, 0.23], [1190, 0.08]], pulses: [[0, 0.32, 0.019], [0.034, 1, 0.023]] },
  'flap-train': { duration: 0.29, cutoff: 3200, noise: 0.36, modes: [[204, 0.18], [620, 0.16]], pulses: [[0, 0.5, 0.018], [0.045, 0.55, 0.016], [0.091, 0.7, 0.018], [0.149, 1, 0.029]] },
  'chalk-stroke': { duration: 0.38, cutoff: 2200, noise: 0.42, modes: [[760, 0.036], [1090, 0.02]], pulses: [[0, 0.5, 0.1], [0.09, 0.85, 0.13], [0.245, 0.5, 0.055]] },
  'bristle-swipe': { duration: 0.32, cutoff: 1580, noise: 0.38, modes: [[156, 0.05]], pulses: [[0, 0.5, 0.12], [0.10, 0.7, 0.17]] },
  'vinyl-catch': { duration: 0.22, cutoff: 1900, noise: 0.26, modes: [[72, 0.26], [164, 0.12]], pulses: [[0, 0.2, 0.05], [0.065, 1, 0.025], [0.112, 0.22, 0.015]] },
  'glass-contact': { duration: 0.40, cutoff: 5000, noise: 0.16, modes: [[744, 0.34], [1169, 0.21], [2163, 0.12]], pulses: [[0, 1, 0.10], [0.074, 0.12, 0.074]] },
  'rubber-flex': { duration: 0.25, cutoff: 1250, noise: 0.22, modes: [[148, 0.45], [305, 0.16]], pulses: [[0, 0.45, 0.075], [0.095, 1, 0.052]] },
  'air-valve': { duration: 0.38, cutoff: 3600, noise: 0.55, modes: [[155, 0.09]], pulses: [[0, 0.18, 0.038], [0.052, 0.9, 0.11], [0.16, 0.4, 0.12]] },
  'water-bloom': { duration: 0.44, cutoff: 1050, noise: 0.22, modes: [[288, 0.26], [468, 0.14], [813, 0.06]], pulses: [[0, 1, 0.075], [0.091, 0.24, 0.135]] },
  'relay-switch': { duration: 0.13, cutoff: 4800, noise: 0.30, modes: [[274, 0.20], [941, 0.19], [1410, 0.07]], pulses: [[0, 1, 0.016], [0.041, 0.4, 0.028]] },
};

export function synthesizeMaterialSfx(recipe, sampleRate, random) {
  const length = Math.round(recipe.duration * sampleRate);
  const samples = new Float32Array(length);
  const noiseSmoothing = 1 - Math.exp(-2 * Math.PI * recipe.cutoff / sampleRate);
  let noise = 0;
  for (let index = 0; index < length; index++) {
    const t = index / sampleRate;
    noise += ((2 * random() - 1) - noise) * noiseSmoothing;
    for (const [start, strength, decay] of recipe.pulses) {
      const age = t - start;
      if (age < 0) continue;
      const envelope = strength * (1 - Math.exp(-age * 1800)) * Math.exp(-age / decay);
      const ring = recipe.modes.reduce((sum, [hz, gain]) =>
        sum + gain * Math.sin(2 * Math.PI * hz * age), 0);
      samples[index] += envelope * (recipe.noise * noise + ring);
    }
    samples[index] *= Math.min(1, (length - index - 1) / (sampleRate * 0.016));
  }
  return samples;
}
