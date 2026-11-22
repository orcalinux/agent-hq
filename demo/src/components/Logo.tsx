/** The Agent HQ mark from public/logo.svg in the app. */
export const Logo = ({ size = 128, draw = 1 }: { size?: number; draw?: number }) => (
  <svg width={size} height={size} viewBox="0 0 128 128" fill="none">
    <defs>
      <linearGradient id="tile" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stopColor="#1c2740" />
        <stop offset="1" stopColor="#0f1626" />
      </linearGradient>
      <linearGradient id="ink" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stopColor="#9cc3ff" />
        <stop offset="1" stopColor="#5b9bff" />
      </linearGradient>
    </defs>
    <rect x="4" y="4" width="120" height="120" rx="28" fill="url(#tile)" />
    <rect x="4.75" y="4.75" width="118.5" height="118.5" rx="27.25" stroke="#ffffff" strokeOpacity="0.08" strokeWidth="1.5" />
    <path d="M37 94L64 36L91 94" stroke="url(#ink)" strokeWidth="11" strokeLinecap="round" strokeLinejoin="round" pathLength={1} strokeDasharray={1} strokeDashoffset={1 - draw} />
    <path d="M48 76H80" stroke="#7fb0ff" strokeWidth="9" strokeLinecap="round" pathLength={1} strokeDasharray={1} strokeDashoffset={1 - Math.max(0, draw * 2 - 1)} />
    <circle cx="64" cy="34" r={11 * draw} fill="#9cc3ff" />
    <circle cx="64" cy="34" r={4.5 * draw} fill="#0f1626" />
    <circle cx="37" cy="95" r={8.5 * draw} fill="#0f1626" stroke="#5b9bff" strokeWidth="5" />
    <circle cx="91" cy="95" r={8.5 * draw} fill="#0f1626" stroke="#5b9bff" strokeWidth="5" />
  </svg>
);
