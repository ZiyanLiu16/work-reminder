import test from 'node:test';
import assert from 'node:assert/strict';
import { isCandidate, extractSnippets, importProject, LIMITS } from '../extension/repository.js';
for (const path of ['.env', '.git/config', '.hidden/main.py', 'node_modules/a/index.js', 'dist/a.js', 'build/a.py', 'venv/a.py', 'data/users.txt', 'private_key.txt', 'credentials.py', 'auth.token.js', 'package-lock.json', 'a.min.js', 'image.png', 'cert.pem'])
  test(`excludes ${path}`, () => assert.equal(isCandidate(path, 100), false));
test('accepts docs and source, excludes huge/empty files', () => {
  for (const path of ['README.md', 'docs/setup.md', 'src/main.py']) assert.ok(isCandidate(path, 100));
  assert.equal(isCandidate('README.md', LIMITS.fileBytes + 1), false); assert.equal(isCandidate('a.py', 0), false);
});
test('snippets preserve source positions and line limits', () => {
  const text = '\n\n# Project\n' + 'An explanation of a project and its current goals.\n'.repeat(40);
  const snippets = extractSnippets(text, 'README.md');
  assert.equal(snippets[0].line, 3);
  for (const snippet of snippets) { assert.ok(snippet.text.length <= 501); assert.ok(snippet.text.split('\n').length <= 15); assert.equal(snippet.path, 'README.md'); }
});
test('binary or unhelpful text skipped', () => { assert.deepEqual(extractSnippets('abc\0'.repeat(40), 'a.py'), []); assert.deepEqual(extractSnippets('hi', 'a.txt'), []); });
test('very long line cannot create an infinite loop', () => { const snippets = extractSnippets('a'.repeat(10000), 'a.md'); assert.equal(snippets.length, 1); assert.equal(snippets[0].text.length, 500); });
const file = (path, text = 'A useful paragraph that helps return to this project.') => ({ name: path.split('/').at(-1), webkitRelativePath: `demo/${path}`, size: text.length, text: async () => text });
test('import prioritizes README and never reads excluded file contents', async () => {
  const secret = file('.env'); secret.text = () => { throw new Error('MUST NOT READ'); };
  const project = await importProject([file('src/a.py'), secret, file('README.md')], { now: 123 });
  assert.equal(project.name, 'demo'); assert.equal(project.importedAt, 123); assert.equal(project.snippets[0].path, 'README.md'); assert.equal(project.snippets.length, 2);
});
test('import caps snapshot size', async () => {
  const project = await importProject(Array.from({ length: 150 }, (_, i) => file(`docs/${i}.md`)));
  assert.equal(project.snippets.length, 30);
});
test('abort before reading saves nothing', async () => {
  const controller = new AbortController(); controller.abort();
  await assert.rejects(importProject([file('README.md')], { signal: controller.signal }), { name: 'AbortError' });
});
test('abort during read prevents snapshot completion', async () => {
  const controller = new AbortController(); const reading = file('README.md');
  reading.text = async () => { controller.abort(); return 'a'.repeat(50); };
  await assert.rejects(importProject([reading], { signal: controller.signal }), { name: 'AbortError' });
});
test('empty import succeeds without snippets', async () => assert.deepEqual((await importProject([])).snippets, []));
test('read failures propagate and cannot silently create partial snapshots', async () => {
  const failing = file('README.md'); failing.text = async () => { throw new Error('file unreadable'); };
  await assert.rejects(importProject([failing]), /file unreadable/);
});
