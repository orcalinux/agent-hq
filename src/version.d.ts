declare const __APP_VERSION__: string;

declare module '*.md?raw' {
  const text: string;
  export default text;
}

declare module '*?raw' {
  const content: string;
  export default content;
}
