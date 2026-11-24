export function hostToolBlocks(text: string, name: string): { blocks: string[]; unclosed: boolean } {
  const blocks: string[] = [];
  let fenceLength = 0;
  let selected = false;
  let body: string[] = [];
  for (const line of text.split('\n')) {
    const fence = /^\s*(`{3,})([^`]*)$/.exec(line);
    if (!fenceLength) {
      if (!fence) continue;
      fenceLength = fence[1].length;
      selected = fence[2].trim() === name;
      body = [];
    } else if (fence && fence[1].length >= fenceLength && !fence[2].trim()) {
      if (selected) blocks.push(body.join('\n'));
      fenceLength = 0;
      selected = false;
    } else if (selected) {
      body.push(line);
    }
  }
  return { blocks, unclosed: selected };
}
