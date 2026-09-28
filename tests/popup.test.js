import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { JSDOM } from 'jsdom';
const code = (await readFile(new URL('../extension/popup.js', import.meta.url), 'utf8'))
  .replace(/^import .*;$/gm, '').split('async function render()')[0];
function fixture({ focused = true, visible = true, missing = false } = {}) {
  const dom = new JSDOM('', { runScripts: 'outside-only', pretendToBeVisual: true });
  dom.window.document.hasFocus = () => focused;
  Object.defineProperty(dom.window.document, 'visibilityState', { value: visible ? 'visible' : 'hidden' });
  let listener;
  dom.window.chrome = {
    runtime: { id: 'test', onMessage: { addListener: fn => { listener = fn; } } },
    windows: { getCurrent: async () => { if (missing) throw new Error('closed'); return { id: 42 }; } }
  };
  dom.window.eval(code);
  return { dom, listener };
}
test('popup probe reports current document focus, not parent window focus', async () => {
  for (const options of [{}, { focused: false }, { visible: false }, { missing: true }]) {
    const f = fixture(options);
    const response = await new Promise(resolve => {
      assert.equal(f.listener({ type: 'popupFocus' }, { id: 'test' }, resolve), true);
    });
    assert.equal(response.focused, !options.missing && options.focused !== false && options.visible !== false);
    if (!options.missing) assert.equal(response.windowId, 42);
    f.dom.window.close();
  }
});
test('popup ignores unrelated messages and messages from other extensions', () => {
  const f = fixture();
  const reject = () => assert.fail('must not reply');
  assert.equal(f.listener({ type: 'status' }, { id: 'test' }, reject), undefined);
  assert.equal(f.listener({ type: 'popupFocus' }, { id: 'other' }, reject), undefined);
  f.dom.window.close();
});
