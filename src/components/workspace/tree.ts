import type { WorkspaceTreeEntry } from '@/types';

export interface TreeNode {
  path: string;
  name: string;
  type: 'file' | 'directory';
  children: TreeNode[];
}

/** Build a nested tree from the flat file list (directories are inferred from file paths). */
export function buildTree(entries: WorkspaceTreeEntry[]): TreeNode[] {
  const root: TreeNode = { path: '', name: '', type: 'directory', children: [] };
  const dirs = new Map<string, TreeNode>([['', root]]);

  const ensureDir = (dirPath: string): TreeNode => {
    const existing = dirs.get(dirPath);
    if (existing) return existing;
    const idx = dirPath.lastIndexOf('/');
    const parent = ensureDir(idx >= 0 ? dirPath.slice(0, idx) : '');
    const node: TreeNode = { path: dirPath, name: dirPath.slice(idx + 1), type: 'directory', children: [] };
    parent.children.push(node);
    dirs.set(dirPath, node);
    return node;
  };

  for (const entry of entries) {
    if (entry.type === 'directory') {
      ensureDir(entry.path);
      continue;
    }
    const idx = entry.path.lastIndexOf('/');
    const parent = ensureDir(idx >= 0 ? entry.path.slice(0, idx) : '');
    parent.children.push({ path: entry.path, name: entry.name || entry.path.slice(idx + 1), type: 'file', children: [] });
  }

  const sort = (nodes: TreeNode[]) => {
    nodes.sort((a, b) => (a.type === b.type ? a.name.localeCompare(b.name) : a.type === 'directory' ? -1 : 1));
    nodes.forEach((n) => sort(n.children));
  };
  sort(root.children);
  return root.children;
}

export interface VisibleRow {
  node: TreeNode;
  depth: number;
}

export function flattenVisible(nodes: TreeNode[], expanded: Set<string>, depth = 0, out: VisibleRow[] = []): VisibleRow[] {
  for (const node of nodes) {
    out.push({ node, depth });
    if (node.type === 'directory' && expanded.has(node.path)) flattenVisible(node.children, expanded, depth + 1, out);
  }
  return out;
}
