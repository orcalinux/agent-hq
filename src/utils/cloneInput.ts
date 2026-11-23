export function cloneFolderName(input: string): string {
  const text = input.trim().replace(/\/+$/, '').replace(/\.git$/, '');
  const last = text.split(/[/:]/).filter(Boolean).pop() ?? '';
  return /^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/.test(last) && !last.includes('..') ? last : '';
}
