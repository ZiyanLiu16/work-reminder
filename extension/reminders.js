export function safeSourceUrl(url) {
  try { const parsed = new URL(url); return ['http:', 'https:'].includes(parsed.protocol) ? parsed.href : ''; }
  catch { return ''; }
}

export function validateInspirations(entries) {
  if (!Array.isArray(entries) || entries.length > 20) throw new Error('最多保存 20 条鼓励链接。');
  return entries.map(entry => {
    const sourceUrl = safeSourceUrl(entry.sourceUrl);
    const text = String(entry.text || '').trim();
    const author = String(entry.author || '').trim();
    if (!sourceUrl || sourceUrl.length > 4000) throw new Error('请填写有效的 HTTP 或 HTTPS 帖文链接。');
    if (text.length > 1000 || author.length > 100) throw new Error('鼓励文案最多 1000 字，作者最多 100 字。');
    return { sourceUrl, text, author };
  });
}

export function chooseReminder({ goal, projects = [], encouragements = [] }, index) {
  const snippets = projects.flatMap(project => project.snippets.map(snippet => ({ ...snippet,
    projectName: project.name, importedAt: project.importedAt })));
  const kinds = ['goal', ...(snippets.length ? ['project'] : []), ...(encouragements.length ? ['encouragement'] : [])];
  const kind = kinds[index % kinds.length];
  const turn = Math.floor(index / kinds.length);
  if (kind === 'goal') {
    const templates = [
      `你还记得想要「${goal}」吗？现在回来做一小步也不晚。`,
      `「${goal}」还在等你。要不要把接下来的五分钟，留给这件在意的事？`,
      `不必一下完成「${goal}」。先做一个小动作，就已经重新开始了。`
    ];
    return { kind, title: '回到你在意的事', text: templates[turn % templates.length] };
  }
  if (kind === 'project') {
    const snippet = snippets[turn % snippets.length];
    return { kind, title: `回到 ${snippet.projectName}`, text: '要不要先回去看看这一小段？',
      snippet: snippet.text, path: snippet.path, line: snippet.line, importedAt: snippet.importedAt };
  }
  const entry = encouragements[turn % encouragements.length];
  return { kind, title: '给自己一点鼓励', text: entry.text || '你为自己收藏了一条鼓励。可以打开原帖看看，也可以现在回到目标。',
    author: entry.author || (entry.sourceUrl ? '你收藏的链接 · 未填写摘录' : ''), sourceUrl: safeSourceUrl(entry.sourceUrl) };
}
