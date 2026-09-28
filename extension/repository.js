const EXCLUDED_DIRS = new Set(['node_modules', 'vendor', 'dist', 'build', 'coverage', '__pycache__', 'venv', 'env', 'target', 'data', 'datasets']);
const TEXT_EXTENSIONS = /\.(md|mdx|txt|rst|py|js|ts|jsx|tsx|java|rs|go|c|cpp|h|swift|rb|sh|css|html)$/i;
const SECRET_NAMES = /(^|[._-])(secret|secrets|credential|credentials|token|tokens|password|passwords|private|id_rsa|id_ed25519)([._-]|$)/i;
export const LIMITS = { fileBytes: 200_000, candidates: 100, snippets: 30, characters: 500 };

export function isCandidate(path, size) {
  const parts = path.replaceAll('\\', '/').split('/');
  const name = parts.at(-1);
  return size <= LIMITS.fileBytes && size > 0 && !parts.some(p => p.startsWith('.') || EXCLUDED_DIRS.has(p.toLowerCase())) &&
    !SECRET_NAMES.test(name) && !/lock\.(json|yaml|yml)$|\.lock$|\.min\./i.test(name) && TEXT_EXTENSIONS.test(name);
}

export function priority(path) {
  if (/(^|\/)(readme|todo)(\.|$)/i.test(path)) return 0;
  if (/(^|\/)docs?\//i.test(path) && /\.(md|rst|txt)$/i.test(path)) return 1;
  return /\.(md|rst|txt)$/i.test(path) ? 2 : 3;
}

export function extractSnippets(text, path) {
  if (text.includes('\0')) return [];
  const lines = text.replaceAll('\r\n', '\n').split('\n');
  const snippets = [];
  let start = 0;
  while (start < lines.length && snippets.length < 3) {
    while (start < lines.length && !lines[start].trim()) start++;
    if (start >= lines.length) break;
    let end = start;
    let block = '';
    while (end < lines.length && end - start < 15) {
      const line = lines[end];
      if (end > start && !line.trim() && end - start >= 3) break;
      if (block.length + line.length + (block ? 1 : 0) > LIMITS.characters) {
        if (!block) { block = line.slice(0, LIMITS.characters); end++; }
        break;
      }
      block += (block ? '\n' : '') + line;
      end++;
    }
    if (block.trim().length >= 25) snippets.push({ path, line: start + 1, text: block.trimEnd() });
    start = Math.max(end, start + 1);
  }
  return snippets;
}

export async function importProject(files, { signal, onProgress = () => {}, now = Date.now() } = {}) {
  const entries = Array.from(files);
  const name = (entries[0]?.webkitRelativePath || '').split('/')[0] || '我的项目';
  const candidates = entries.map(file => ({ file, path: (file.webkitRelativePath || file.name).split('/').slice(1).join('/') || file.name }))
    .filter(({ file, path }) => isCandidate(path, file.size))
    .sort((a, b) => priority(a.path) - priority(b.path) || a.path.localeCompare(b.path))
    .slice(0, LIMITS.candidates);
  const snippets = [];
  let processed = 0;
  for (const { file, path } of candidates) {
    signal?.throwIfAborted();
    const text = await file.text();
    signal?.throwIfAborted();
    snippets.push(...extractSnippets(text, path).slice(0, LIMITS.snippets - snippets.length));
    onProgress(++processed, candidates.length);
    if (snippets.length >= LIMITS.snippets) break;
    // Let the cancel button paint/respond even when reading cached files.
    await new Promise(resolve => setTimeout(resolve, 0));
  }
  return { id: crypto.randomUUID(), name, importedAt: now, snippets };
}
