import { test } from 'node:test';
import assert from 'node:assert/strict';
import { homedir } from 'node:os';
import { extensionOf, expandHome, buildLookup, plan } from '../src/docmgr.js';

const config = { sourceDir: '/tmp/dl', neverMove: ['mobileconfig', 'rgpack'] };
const lookup = buildLookup({ Images: ['png', 'JPG'], Documents: ['pdf'] });

const file = (name, ext) => ({ name, path: `/tmp/dl/${name}`, ext, size: 1 });
const only = (f) => plan([f], lookup, config)[0];

test('extensionOf 去點、轉小寫、取最後一段', () => {
    assert.equal(extensionOf('A.PNG'), 'png');
    assert.equal(extensionOf('a.tar.gz'), 'gz');
    assert.equal(extensionOf('README'), '');
    assert.equal(extensionOf('.gitignore'), '');
});

test('expandHome 只展開開頭的 ~/', () => {
    assert.equal(expandHome('~/Downloads'), `${homedir()}/Downloads`);
    assert.equal(expandHome('/abs/path'), '/abs/path');
    assert.equal(expandHome('a/~/b'), 'a/~/b');
});

test('buildLookup 忽略大小寫', () => {
    assert.equal(lookup.get('jpg'), 'Images');
    assert.equal(lookup.get('JPG'), undefined);
});

test('buildLookup 重複定義時後者勝出', () => {
    const l = buildLookup({ A: ['txt'], B: ['txt'] });
    assert.equal(l.get('txt'), 'B');
});

test('有規則的檔案會被歸類，目標路徑正確', () => {
    const d = only(file('a.png', 'png'));
    assert.equal(d.action, 'move');
    assert.equal(d.folder, 'Images');
    assert.equal(d.to, '/tmp/dl/Images/a.png');
});

test('沒副檔名 / 沒規則 / neverMove 一律 keep', () => {
    for (const f of [
        file('README', ''),
        file('x.xyz', 'xyz'),
        file('p.mobileconfig', 'mobileconfig'),
    ]) {
        const d = only(f);
        assert.equal(d.action, 'keep', `${f.name} 應該是 keep`);
        assert.ok(d.reason, `${f.name} 應該要有 reason`);
    }
});

test('plan 不會改到傳進去的物件', () => {
    const f = file('a.png', 'png');
    only(f);
    assert.equal(f.action, undefined);
});