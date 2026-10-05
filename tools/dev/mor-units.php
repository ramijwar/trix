<?php
// اختبار وحدات لمحرّك المور — يُشغَّل عبر node test-mor-units.mjs
spl_autoload_register(function (string $class): void {
    if (strncmp($class, 'Trix\\', 5) !== 0) { return; }
    $rel = str_replace('\\', '/', substr($class, 5));
    $file = '/src/' . $rel . '.php';
    if (is_file($file)) { require_once $file; }
});
require '/engine.php';
require '/mor.php';

use Trix\Game\Mor;

$tests = [];
  $check = function (string $label, bool $ok, string $extra = '') use (&$tests) {
      $tests[] = ['label' => $label, 'ok' => $ok, 'extra' => $extra];
  };

  /* ---------- سلاسل ---------- */
  $check('سلسلة نظيفة ٣ أوراق', Mor::validateMeld(['H3','H4','H5'])['ok'] === true);
  $check('سلسلة نظيفة ٧ أوراق (مشروع ٢٠٠)', Mor::validateMeld(['H3','H4','H5','H6','H7','H8','H9'])['ok'] === true);
  $check('سلسلة مع آس منخفض A-2-3 (بمبدّل ٢)', Mor::validateMeld(['H14','H2','H3'])['ok'] === true);
  $check('سلسلة Q-K-A (آس عالياً)', Mor::validateMeld(['H12','H13','H14'])['ok'] === true);
  $check('ممنوع اللف Q-K-A-2-3', Mor::validateMeld(['H12','H13','H14','H2','H3'])['ok'] === false);
  $check('سلسلة بألوان مختلفة مرفوضة', Mor::validateMeld(['H3','S4','H5'])['ok'] === false);
  $check('سلسلة بفجوة مرفوضة', Mor::validateMeld(['H3','H4','H6'])['ok'] === false);
  $check('سلسلة بفجوة + جوكر مقبولة', Mor::validateMeld(['H3','H4','H6','X1'])['ok'] === true);
  $check('ورقتان فقط مرفوض', Mor::validateMeld(['H3','H4'])['ok'] === false);
  $check('جوكر + ٢ + مبدّل ثالث مرفوض', Mor::validateMeld(['H3','H4','X1','H2','S2'])['ok'] === false);

  /* ---------- الأطقم ---------- */
  $check('طقم ثلاثات', Mor::validateMeld(['H3','S3','D3'])['ok'] === true);
  $check('طقم أصوص', Mor::validateMeld(['H14','S14','D14','C14'])['ok'] === true);
  $check('طقم سبعات مرفوض (الأطقم للثلاثات والأصوص فقط)', Mor::validateMeld(['H7','S7','D7'])['ok'] === false);
  $check('طقم شواه مرفوض', Mor::validateMeld(['H13','S13','D13'])['ok'] === false);
  $check('طقم ثلاثات + جوكر', Mor::validateMeld(['H3','S3','X1'])['ok'] === true);

  /* ---------- النوع والنقاط ---------- */
  $m = ['kind' => 'seq', 'cards' => ['H3','H4','H5','H6','H7','H8','H9']];
  $check('سلسلة ٧ نظيفة = ٢٠٠', Mor::meldPoints($m) === 200, (string) Mor::meldPoints($m));
  $m2 = ['kind' => 'seq', 'cards' => ['H3','H4','H5','H6','H7','H8','X1']];
  $check('سلسلة ٧ بمبدّل = ١٠٠', Mor::meldPoints($m2) === 100, (string) Mor::meldPoints($m2));
  $m3 = ['kind' => 'set', 'cards' => ['H3','S3','D3','C3','H3','S3','D3']];
  $check('٧ ثلاثات نظيفة = ٣٠٠', Mor::meldPoints($m3) === 300, (string) Mor::meldPoints($m3));
  $m4 = ['kind' => 'set', 'cards' => ['H3','S3','D3','C3','H3','S3','X1']];
  $check('٧ ثلاثات بمبدّل = ١٥٠', Mor::meldPoints($m4) === 150, (string) Mor::meldPoints($m4));
  $check('نزول ٦ أوراق = ٠ (ليس مشروعاً)', Mor::meldPoints(['kind' => 'seq', 'cards' => ['H3','H4','H5','H6','H7','H8']]) === 0);

  /* ---------- الإغلاق ---------- */
  $mk = function (array $melds) { return ['melds' => [$melds, []]]; };
  $check('٣٠٠ كاملة تسمح بالإغلاق', Mor::canClose($mk([['kind' => 'set', 'cards' => ['H3','S3','D3','C3','H3','S3','D3']]]), 0) === true);
  $check('٢٠٠ + ١٠٠ تسمح بالإغلاق', Mor::canClose($mk([
      ['kind' => 'seq', 'cards' => ['H3','H4','H5','H6','H7','H8','H9']],
      ['kind' => 'seq', 'cards' => ['S3','S4','S5','S6','S7','S8','X1']],
  ]), 0) === true);
  $check('٣ مشاريع ١٠٠ لا تكفي', Mor::canClose($mk([
      ['kind' => 'seq', 'cards' => ['H3','H4','H5','H6','H7','H8','X1']],
      ['kind' => 'seq', 'cards' => ['S3','S4','S5','S6','S7','S8','X2']],
      ['kind' => 'seq', 'cards' => ['D3','D4','D5','D6','D7','D8','X1']],
  ]), 0) === false);
  $check('١٥٠ + ١٥٠ لا تكفي', Mor::canClose($mk([
      ['kind' => 'set', 'cards' => ['H3','S3','D3','C3','H3','S3','X1']],
      ['kind' => 'set', 'cards' => ['H14','S14','D14','C14','H14','S14','X2']],
  ]), 0) === false);

  /* ---------- قيم الأوراق ---------- */
  $check('جواكر: ٣ = ٠٫٥', abs(Mor::cardValueJawaker('H3') - 0.5) < 0.001);
  $check('جواكر: آس = ١٫٥', abs(Mor::cardValueJawaker('H14') - 1.5) < 0.001);
  $check('جواكر: جوكر = ١٫٥', abs(Mor::cardValueJawaker('X1') - 1.5) < 0.001);
  $check('شعبي: جوكر = ١٥', abs(Mor::cardValuePopular('X1') - 15) < 0.001);
  $check('شعبي: شاه = ١٠', abs(Mor::cardValuePopular('H13') - 10) < 0.001);
  $check('شعبي: سبعة = ٧', abs(Mor::cardValuePopular('H7') - 7) < 0.001);

  /* ---------- كومة المور: الأخذ اليدوي والتلقائي والإغلاق ---------- */
  $settingsT = ['game' => 'mor', 'morMode' => 'jawaker', 'target' => 101, 'turnTime' => 0];
  $seatsT = [];
  for ($i = 0; $i < 4; $i++) {
      $seatsT[] = ['userId' => 700 + $i, 'name' => 'فحص' . $i, 'avatar' => '🧪', 'level' => 40, 'isBot' => true, 'connected' => true, 'ready' => true, 'seat' => $i];
  }

  // أ) أخذ يدوي عند بقاء ورقة واحدة
  $s2 = Mor::newMatch($seatsT, $settingsT, 0, 'TEST02', 'فحص المور');
  $s2['hands'][0] = ['H5'];
  $s2['needDraw'] = false;
  $s2['turn'] = 0;
  Mor::takeMor($s2, 0);
  // يبقى اللاعب بما بيده (ورقة) + ١١ من المور = ١٢
  $check('أخذ المور يدوياً عند ورقة واحدة', count($s2['hands'][0]) === 12 && $s2['morTaken'][0] === true && count($s2['mor'][0]) === 0,
      'hand=' . count($s2['hands'][0]) . ' taken=' . json_encode($s2['morTaken'][0]));

  // ب) لا يُسمح بأخذ المور مرتين
  $err = '';
  try { Mor::takeMor($s2, 0); } catch (\Throwable $e) { $err = $e->getMessage(); }
  $check('لا يُسمح بأخذ المور مرتين للفريق', $err !== '', $err);

  // ج) لا يُسمح بالأخذ وأوراق اليد أكثر من واحدة
  $s3 = Mor::newMatch($seatsT, $settingsT, 0, 'TEST03', 'فحص المور');
  $s3['turn'] = 0;
  $err3 = '';
  try { Mor::takeMor($s3, 0); } catch (\Throwable $e) { $err3 = $e->getMessage(); }
  $check('المور يُؤخذ فقط عند ورقة واحدة أو أقل', $err3 !== '', $err3);

  // د) أخذ تلقائي عند إنهاء الأوراق بلا مشروع كافٍ
  $s4 = Mor::newMatch($seatsT, $settingsT, 0, 'TEST04', 'فحص المور');
  $s4['hands'][0] = ['H5'];
  $s4['needDraw'] = false;
  $s4['turn'] = 0;
  $s4['melds'][0] = []; // لا مشاريع
  Mor::applyDiscard($s4, 0, 'H5');
  $check('إنهاء الأوراق يأخذ المور تلقائياً (بلا مشروع)', count($s4['hands'][0]) === 11 && $s4['morTaken'][0] === true && count($s4['mor'][0]) === 0,
      'hand=' . count($s4['hands'][0]) . ' taken=' . json_encode($s4['morTaken'][0]));

  // هـ) إنهاء الأوراق مع ٣٠٠ مشروع = إغلاق اللقطة
  $s5 = Mor::newMatch($seatsT, $settingsT, 0, 'TEST05', 'فحص المور');
  $s5['hands'][0] = ['H5'];
  $s5['needDraw'] = false;
  $s5['turn'] = 0;
  $s5['melds'][0] = [['id' => 1, 'kind' => 'set', 'cards' => ['H3','S3','D3','C3','H3','S3','D3'], 'by' => 0, 'at' => time()]];
  Mor::applyDiscard($s5, 0, 'H5');
  $check('إنهاء الأوراق مع ٣٠٠ مشروع يُغلق اللقطة', $s5['phase'] === 'round_end' && (int) ($s5['summary']['winnerTeam'] ?? -1) === 0
      && (string) ($s5['summary']['reason'] ?? '') === 'closed', json_encode($s5['summary'], JSON_UNESCAPED_UNICODE));
  $check('المشروع يُحسب في الإغلاق (مشاريع الفريق ٠)', (int) ($s5['summary']['projects'][0] ?? 0) === 300, json_encode($s5['summary']['projects'] ?? []));

  // و) كومة الرمي لا تُؤخذ إن لم تحوِ ورقة قابلة للاستخدام
  $s6 = Mor::newMatch($seatsT, $settingsT, 0, 'TEST06', 'فحص المور');
  $s6['melds'][0] = [['id' => 1, 'kind' => 'seq', 'cards' => ['H3','H4','H5'], 'by' => 0, 'at' => time()]];
  $s6['discard'] = ['C13'];                 // لا تنزل ولا تُضاف
  $s6['hands'][0] = ['S9', 'D11', 'C6'];
  $s6['needDraw'] = true;
  $s6['turn'] = 0;
  $check('كومة الرمي غير المفيدة لا تُعتبر متاحة', Mor::pileUseful($s6, 0) === false);
  $err6 = '';
  try { Mor::applyDraw($s6, 0, 'pile'); } catch (\Throwable $e) { $err6 = $e->getMessage(); }
  $check('سحب كومة غير مفيدة مرفوض برسالة عربية', $err6 !== '', $err6);

  // ز) كومة الرمي المفيدة (تُكمل نزولاً) تُقبل، وورقتها تُستخدم قبل الرمي
  $s7 = Mor::newMatch($seatsT, $settingsT, 0, 'TEST07', 'فحص المور');
  $s7['melds'][0] = [['id' => 1, 'kind' => 'seq', 'cards' => ['H3','H4','H5'], 'by' => 0, 'at' => time()]];
  $s7['discard'] = ['H6'];
  $s7['hands'][0] = ['S9', 'D11', 'C6'];
  $s7['needDraw'] = true;
  $s7['turn'] = 0;
  $check('كومة الرمي المفيدة تُعتبر متاحة', Mor::pileUseful($s7, 0) === true);
  Mor::applyDraw($s7, 0, 'pile');
  $check('أخذت الكومة كاملة وأصبحت معلّقة', count($s7['hands'][0]) === 4 && $s7['pilePending'] === true && in_array('H6', $s7['hands'][0], true),
      json_encode($s7['hands'][0]));
  $err7 = '';
  try { Mor::applyDiscard($s7, 0, 'S9'); } catch (\Throwable $e) { $err7 = $e->getMessage(); }
  $check('ممنوع الرمي قبل استخدام ورقة من الكومة', $err7 !== '', $err7);
  Mor::applyAdd($s7, 0, 1, ['H6']);
  $check('إضافة ورقة الكومة إلى النزول تُصرّف التعليق', $s7['pilePending'] === false && count($s7['hands'][0]) === 3, json_encode($s7['hands'][0]));

  /* ---------- المباراة الكاملة: توزيع ثم لعب آلي حتى نهاية الدور ---------- */
  $seats = [];
  for ($i = 0; $i < 4; $i++) {
      $seats[] = ['userId' => 900 + $i, 'name' => 'بوت' . $i, 'avatar' => '🤖', 'level' => 40, 'isBot' => true, 'connected' => true, 'ready' => true, 'seat' => $i];
  }
  $settings = ['game' => 'mor', 'morMode' => 'jawaker', 'target' => 101, 'turnTime' => 0];
  $s = Mor::newMatch($seats, $settings, 0, 'TEST01', 'طاولة فحص');
  $check('توزيع: ١١ ورقة لكل لاعب + ورقة للبداية', count($s['hands'][0]) === 12 && count($s['hands'][1]) === 11 && count($s['hands'][2]) === 11 && count($s['hands'][3]) === 11);
  $check('كومتا المور ١١ + ١١', count($s['mor'][0]) === 11 && count($s['mor'][1]) === 11);
  $check('كومة الرمي تبدأ بورقة', count($s['discard']) === 1);
  $check('الرزمة = ٣٨ ورقة', count($s['deck']) === 38, (string) count($s['deck']));
  $total = count($s['deck']) + count($s['discard']) + count($s['mor'][0]) + count($s['mor'][1]) + array_sum(array_map('count', $s['hands']));
  $check('مجموع الأوراق ١٠٦ (ورقان + جوكران)', $total === 106, (string) $total);

  // لعب المباراة كاملة بالبوتات
  $turns = 0;
  while (($s['phase'] === 'playing') && $turns < 4000) {
      $turns++;
      if (!Mor::botAct($s)) { Mor::autoAct($s); }
  }
  $check('انتهى الدور الأول (إغلاق أو نفاد الرزمة)', $s['phase'] !== 'playing', (string) $s['phase']);
  $check('ملخص الدور محفوظ', is_array($s['summary']), json_encode($s['summary'], JSON_UNESCAPED_UNICODE));
  $check('النقاط تحدّثت', ($s['scores'][0] !== 0 || $s['scores'][1] !== 0), json_encode($s['scores']));

  // دور ثانٍ ثم حتى نهاية المباراة
  Mor::nextRound($s);
  $check('الدور الثاني بدأ بأوراق جديدة', count($s['hands'][0]) >= 11 && $s['roundNo'] === 2);
  $rounds = 2;
  while ($s['phase'] !== 'game_end' && $rounds < 60) {
      $guard = 0;
      while (($s['phase'] === 'playing') && $guard < 4000) { $guard++; if (!Mor::botAct($s)) { Mor::autoAct($s); } }
      if ($s['phase'] === 'game_end') break;
      Mor::nextRound($s);
      $rounds++;
  }
  $check('انتهت المباراة بفائز', $s['phase'] === 'game_end' && $s['winnerTeam'] !== null, (string) $s['phase'] . ' winner=' . json_encode($s['winnerTeam']));
  $check('نقاط الفائز بلغت الهدف', max((int) $s['scores'][0], (int) $s['scores'][1]) >= 101, json_encode($s['scores']));

  file_put_contents('/units.json', json_encode($tests, JSON_UNESCAPED_UNICODE));
