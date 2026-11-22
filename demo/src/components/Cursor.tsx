export const Cursor = ({ x, y, press }: { x: number; y: number; press: number }) => (
  <svg
    width={40}
    height={40}
    viewBox="0 0 24 24"
    style={{ position: 'absolute', left: x - 6, top: y - 3, transform: `scale(${1 - press * 0.14})`, transformOrigin: '6px 3px', filter: 'drop-shadow(0 4px 8px rgba(0,0,0,0.5))' }}
  >
    <path d="M5.5 3.2v15.6c0 .5.6.7.9.4l3.6-3.6 2.4 5.6c.2.4.6.5 1 .4l1.9-.8c.4-.2.5-.6.4-1l-2.4-5.5h5.2c.5 0 .7-.6.4-.9L6.4 2.8c-.3-.3-.9-.1-.9.4z" fill="#fff" stroke="#111" strokeWidth="1.2" strokeLinejoin="round" />
  </svg>
);
