import { loadFont as loadInter } from '@remotion/google-fonts/Inter';
import { loadFont as loadMono } from '@remotion/google-fonts/JetBrainsMono';

export const FPS = 30;
export const WIDTH = 1920;
export const HEIGHT = 1080;

export const sans = loadInter('normal', { weights: ['400', '500', '600', '700'], subsets: ['latin'] }).fontFamily;
export const mono = loadMono('normal', { weights: ['400', '500'], subsets: ['latin'] }).fontFamily;

/** The app's dark theme tokens, so the animated scenes look like Agent HQ itself. */
export const C = {
  bg: '#0d0e11',
  surface: '#16171b',
  surface2: '#1c1d22',
  line: 'rgba(255,255,255,0.08)',
  fg: '#ededf0',
  muted: '#a1a1aa',
  subtle: '#71717a',
  accent: '#6aa3ff',
  accent2: '#8f86ff',
  success: '#4ade80',
  warning: '#fbbf24',
  roles: {
    manager: '#f59e0b',
    architect: '#a78bfa',
    frontend: '#60a5fa',
    backend: '#2dd4bf',
    qa: '#f87171',
    junior: '#f472b6',
  },
} as const;
