const pptxgen = require('pptxgenjs');
const path = require('path');
const L = require('C:/Users/fan_o/.claude/skills/tt-powerpoint2/scripts/layouts.js');

const root = 'C:/dev/AGI-AImokuyokai-Hackathon-12/output/slides';
const pres = new pptxgen();
pres.author = 'チーム12';
pres.subject = '総務AIのミテハナさん 発表スライド';
pres.title = '総務AIのミテハナさん';
pres.company = 'AI木曜会 Hackathon チーム12';
pres.lang = 'ja-JP';
const ctx = L.createContext(pres, 'sui', path.join(root, 'work', 'grad.json'));

// 1. Cover
L.coverArt(ctx, {
  chapter: 'チーム12',
  title: '総務AIの\nミテハナさん',
  sub: '見る・話すだけで管理されるAI資産台帳\n見せて、話すだけ。台帳は、AI社員がつける時代へ。'
});

// 2. Future vision
L.threeCardsBadge(ctx, {
  num: '01', title: '10年後、私たちはこういう世界を想定しました',
  subtitle: '10年後の未来予想',
  items: [
    { icon: 'users', emoji: '🤝', t: 'AI社員と働くのが当たり前', d: 'AIが日々の仕事を支える' },
    { icon: 'camera', emoji: '📷', t: 'AIが現場のモノを見る', d: 'カメラ・ロボットで現場を確認' },
    { icon: 'clipboard-list', emoji: '📋', t: 'バックオフィスのAI化', d: '経理から総務の台帳へ' }
  ]
});

// 3. Before / After
L.beforeAfter(ctx, {
  num: '02', title: 'でも実は、台帳はこうなっている',
  subtitle: '「見る・話す」だけを、AIが登録までつなぐ。',
  labelA: 'Before', labelB: 'After',
  before: ['現物・シール・QRを確認', 'Excelを開く', '年1回の棚卸し'],
  after: ['カメラで見る', 'AIに話しかける', '台帳を更新・履歴化']
});

// 4. Persona and scope
L.threeCards(ctx, {
  num: '03', title: '今回フォーカスしたこと',
  subtitle: '総務の資産台帳を、現場の対話から更新する。',
  items: [
    { icon: 'users', t: 'ペルソナ', d: '100人規模メーカーで\n総務と経理を兼務する佐藤さん' },
    { icon: 'clipboard-list', t: '業務', d: '備品・資産の台帳の\n登録と更新' },
    { icon: 'camera', t: '機能', d: 'カメラと声だけで操作\n確定は人の「はい」' }
  ]
});

// 5. Demo interlude
L.demoIntro(ctx, {
  num: 'DEMO', title: 'デモ', subtitle: '「見せて、話すだけ」をご覧ください',
  hint: 'アプリ画面（後で差し替え）',
  prompt: 'カメラで資産を映し、Gemini Live に話しかけるデモ画面',
  items: [
    { t: '見せる', d: '現物をカメラで確認' },
    { t: '話す', d: 'AIに状態や情報を伝える' },
    { t: '確認する', d: '登録内容を人が確定' }
  ]
});

// 6. Mechanism + actual spreadsheet image (custom layout prevents any overlap)
const slide6 = pres.addSlide();
slide6.background = { color: 'FFFFFF' };
slide6.addText('04', { x: 0.65, y: 0.52, w: 0.62, h: 0.45, fontFace: 'Aptos', fontSize: 28, bold: true, color: '1D9ED3', margin: 0 });
slide6.addText('しくみ', { x: 1.55, y: 0.48, w: 3.0, h: 0.52, fontFace: 'Noto Sans JP', fontSize: 30, bold: true, color: '202124', margin: 0 });
slide6.addShape('line', { x: 0.65, y: 1.22, w: 3.45, h: 0, line: { color: '00A6A6', width: 1.5 } });
slide6.addText('対話から、確認を経て、台帳へ。', { x: 0.65, y: 1.43, w: 5.8, h: 0.35, fontFace: 'Noto Sans JP', fontSize: 17, color: '3F3F46', margin: 0 });
const flowSteps = [
  ['1', 'カメラ / 声で入力'], ['2', 'Gemini Live が認識・提案'],
  ['3', '人が「はい」で確定'], ['4', '台帳・履歴を更新']
];
flowSteps.forEach((step, i) => {
  const y = 2.05 + i * 0.94;
  slide6.addShape('roundRect', { x: 0.62, y, w: 5.65, h: 0.62, rectRadius: 0.06, fill: { color: i === 3 ? '00A6A6' : 'EAF8F7' }, line: { color: i === 3 ? '00A6A6' : 'B9E7E4', width: 1 } });
  slide6.addShape('ellipse', { x: 0.82, y: y + 0.12, w: 0.38, h: 0.38, fill: { color: '00A6A6' }, line: { color: '00A6A6' } });
  slide6.addText(step[0], { x: 0.82, y: y + 0.18, w: 0.38, h: 0.16, fontFace: 'Aptos', fontSize: 9, bold: true, color: 'FFFFFF', align: 'center', margin: 0 });
  slide6.addText(step[1], { x: 1.38, y: y + 0.17, w: 4.5, h: 0.22, fontFace: 'Noto Sans JP', fontSize: 13, bold: true, color: i === 3 ? 'FFFFFF' : '16343B', margin: 0 });
  if (i < 3) slide6.addText('↓', { x: 3.1, y: y + 0.62, w: 0.4, h: 0.2, fontFace: 'Aptos', fontSize: 15, bold: true, color: '00A6A6', align: 'center', margin: 0 });
});
slide6.addImage({ path: 'C:/dev/AGI-AImokuyokai-Hackathon-12/output/screenshots/ledger_spreadsheet.png', x: 7.52, y: 2.1, w: 5.18, h: 3.88 });
slide6.addText('実際の資産台帳（Google スプレッドシート）', { x: 7.52, y: 6.1, w: 5.18, h: 0.22, fontFace: 'Noto Sans JP', fontSize: 8, color: '475569', align: 'center', margin: 0 });
slide6.addShape('line', { x: 0.65, y: 7.16, w: 12.05, h: 0, line: { color: '00A6A6', width: 1 } });

// 7. Future
L.stepsH(ctx, {
  num: '05', title: '10年後: 台帳は「巡回するAI社員」が更新する',
  subtitle: '人は確認、AIは日々の記録を担う。',
  items: [
    { icon: 'camera', emoji: '📷', t: '今日', d: '人がカメラを持って\n話しかける' },
    { icon: 'glasses', emoji: '👓', t: '次', d: 'AIグラス・見守りカメラで\n所在と数を常時確認' },
    { icon: 'bot', emoji: '🤖', t: '10年後', d: 'ロボットが工場と事務所を巡回し\n台帳を自動更新' }
  ]
});

// 8. Closing
L.summary(ctx, {
  title: '見せて、話すだけ。',
  subtitle: '台帳は、AI社員がつける時代へ。',
  headAccent: '総務AIの', headRest: 'ミテハナさん',
  items: [
    { t: '見る', d: '現物をカメラで確認' },
    { t: '話す', d: 'AIと自然に対話' },
    { t: '残す', d: '台帳と履歴を更新' }
  ],
  closing: 'チーム12'
});

L.validate(ctx);
pres.writeFile({ fileName: path.join(root, 'ミテハナさん_発表スライド.pptx') });
