import { test } from 'node:test';
import assert from 'node:assert/strict';
import { homedir } from 'node:os';
import { extensionOf, expandHome, globToRegExp, compileRules, matchRule, plan } from '../src/docmgr.js';

const config = { sourceDir: '/tmp/dl', neverMove: ['mobileconfig', 'rgpack'] };
const rules = compileRules({ Images: ['png', 'JPG'], Documents: ['pdf'] });

const file = (name, ext) => ({ name, path: `/tmp/dl/${name}`, ext, size: 1 });
const only = (f,r=rules) => plan([f], r, config)[0];

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

test('副檔名規則忽略大小寫', () => {
    assert.equal(matchRule(file('a.jpg', 'jpg'), rules).folder, 'Images');
});

test('同一副檔名重複定義時前者勝出', () => {
    const r = compileRules({ A: ['txt'], B: ['txt'] });
    assert.equal(matchRule(file('a.txt', 'txt'), r).folder, 'A');
});

test('globToRegExp 只讓 * 和 ? 有特殊意義', () => {
    assert.ok(globToRegExp('Screenshot *').test('Screenshot 2026-08-13.png'));
    assert.ok(globToRegExp('IMG_????.HEIC').test('img_0012.heic'));
    assert.ok(!globToRegExp('IMG_????.HEIC').test('img_012.heic'));
    assert.ok(globToRegExp('a.b').test('a.b'));
    assert.ok(!globToRegExp('a.b').test('axb'), '. 不該被當成萬用字元');
    assert.ok(!globToRegExp('Screenshot *').test('my Screenshot 1.png'), 'glob 要整個檔名相符');
});

test('檔名 pattern 優先於副檔名，即使規則寫在後面', () => {
    const r = compileRules({
        Images: ['png'],
        Screenshots: { match: ['Screenshot *', '螢幕截圖 *'] },
    });
    assert.equal(only(file('Screenshot 2026-08-13.png', 'png'), r).folder, 'Screenshots');
    assert.equal(only(file('螢幕截圖 2026-08-13.png', 'png'), r).folder, 'Screenshots');
    assert.equal(only(file('cat.png', 'png'), r).folder, 'Images');
});

test('多個 pattern 命中時由上而下第一個勝出', () => {
    const r = compileRules({
        A: { match: ['report *'] },
        B: { match: ['* draft'] },
    });
    assert.equal(only(file('report draft', ''), r).folder, 'A');
});

test('pattern 可以歸類沒有副檔名的檔案', () => {
    const r = compileRules({ Notes: { match: ['meeting-*'] } });
    const d = only(file('meeting-0813', ''), r);
    assert.equal(d.action, 'move');
    assert.equal(d.to, '/tmp/dl/Notes/meeting-0813');
});

test('同一條規則可以同時有 match 和 ext', () => {
    const r = compileRules({ Fonts: { match: ['*-webfont'], ext: ['ttf'] } });
    assert.equal(only(file('a.ttf', 'ttf'), r).folder, 'Fonts');
    assert.equal(only(file('inter-webfont', ''), r).folder, 'Fonts');
});

test('move 決策帶著命中的 pattern，副檔名命中則為 null', () => {
    const r = compileRules({ Shots: { match: ['Screenshot *'] }, Images: ['png'] });
    assert.equal(only(file('Screenshot 1.png', 'png'), r).pattern, 'Screenshot *');
    assert.equal(only(file('cat.png', 'png'), r).pattern, null);
});

test('neverMove 蓋過 pattern', () => {
    const r = compileRules({ Configs: { match: ['*.mobileconfig'] } });
    assert.equal(only(file('p.mobileconfig', 'mobileconfig'), r).action, 'keep');
});

test('規則格式錯誤會丟出可讀的訊息', () => {
    assert.throws(() => compileRules({ A: {} }), /needs at least one of "ext" or "match"/);
    assert.throws(() => compileRules({ A: 'png' }), /must be an array/);
    assert.throws(() => compileRules(undefined), /"rules" object/);
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