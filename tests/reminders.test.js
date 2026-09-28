import test from 'node:test';
import assert from 'node:assert/strict';
import { chooseReminder, safeSourceUrl, validateInspirations } from '../extension/reminders.js';
const content = { goal: 'ship a project', projects: [{ name: 'demo', importedAt: 123, snippets: [{ text: 'snippet', path: 'README.md', line: 3 }] }], encouragements: [{ text: 'hello', author: 'original', sourceUrl: 'https://example.com/post' }] };
test('all three kinds rotate', () => assert.deepEqual([0, 1, 2, 3].map(i => chooseReminder(content, i).kind), ['goal', 'project', 'encouragement', 'goal']));
test('empty project kind is skipped', () => assert.equal(chooseReminder({ ...content, projects: [] }, 1).kind, 'encouragement'));
test('goal works with no optional content', () => { for (let i = 0; i < 10; i++) assert.equal(chooseReminder({ goal: 'hello' }, i).kind, 'goal'); });
test('goal templates vary between cycles', () => assert.notEqual(chooseReminder(content, 0).text, chooseReminder(content, 3).text));
test('project attribution preserved', () => { const card = chooseReminder(content, 1); assert.equal(card.path, 'README.md'); assert.equal(card.line, 3); assert.equal(card.importedAt, 123); });
test('source URL allows HTTP and HTTPS but rejects executable and local URLs', () => {
  for (const url of ['javascript:alert(1)', 'data:text/html,hi', 'file:///etc/passwd', 'ftp://example.com', 'invalid']) assert.equal(safeSourceUrl(url), '');
  for (const url of ['https://example.com/post', 'http://xhslink.com/o/1q65Rm2gonl']) assert.equal(safeSourceUrl(url), url);
});
test('user links support optional excerpts and normalize whitespace', () => {
  assert.deepEqual(validateInspirations([{ sourceUrl: 'https://www.xiaohongshu.com/explore/a', text: ' 小步开始 ', author: ' 作者 ' }]), [{ sourceUrl: 'https://www.xiaohongshu.com/explore/a', text: '小步开始', author: '作者' }]);
  assert.equal(validateInspirations([{ sourceUrl: 'https://example.com/post' }])[0].text, '');
});
test('invalid inspiration URLs and oversized content are rejected', () => {
  for (const sourceUrl of ['', 'javascript:alert(1)', 'file:///private', 'ftp://example.com']) assert.throws(() => validateInspirations([{ sourceUrl }]));
  assert.throws(() => validateInspirations(Array(21).fill({ sourceUrl: 'https://example.com' })));
  assert.throws(() => validateInspirations([{ sourceUrl: 'https://example.com', text: 'a'.repeat(1001) }]));
});
test('the supplied Xiaohongshu HTTP share URL validates unchanged', () => {
  const sourceUrl = 'http://xhslink.com/o/1q65Rm2gonl';
  assert.equal(validateInspirations([{ sourceUrl }])[0].sourceUrl, sourceUrl);
});
for (const projects of [[], content.projects]) test(`multiple encouragements rotate then wrap (${projects.length} projects)`, () => {
  const entries = ['first', 'second', 'third'].map(text => ({ text, sourceUrl: 'http://xhslink.com/o/1q65Rm2gonl' }));
  const cards = Array.from({ length: 12 }, (_, i) => chooseReminder({ ...content, projects, encouragements: entries }, i)).filter(card => card.kind === 'encouragement');
  assert.deepEqual(cards.slice(0, 4).map(card => card.text), ['first', 'second', 'third', 'first']);
});
test('link-only reminder does not invent an excerpt', () => {
  const card = chooseReminder({ goal: 'test', encouragements: [{ sourceUrl: 'https://example.com/post', text: '' }] }, 1);
  assert.match(card.text, /收藏/); assert.match(card.author, /未填写摘录/); assert.equal(card.sourceUrl, 'https://example.com/post');
});
