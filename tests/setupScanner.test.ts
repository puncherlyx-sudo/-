import assert from 'node:assert/strict';
import { gradeOf, scoreSetup, type ScanFrame } from '../server/setupScanner.ts';

type Bias = 'BULLISH' | 'BEARISH' | 'RANGE';
const frames = (b15: Bias, b1h: Bias, b4h: Bias, b1d: Bias, rsi = 55): ScanFrame[] => [
  { tf: '15m', bias: b15, rsi },
  { tf: '1h', bias: b1h, rsi },
  { tf: '4h', bias: b4h, rsi },
  { tf: '1d', bias: b1d, rsi },
];

// Идеальный лонг: всё вверх, RSI 55, цена у поддержки, до сопротивления далеко
{
  const s = scoreSetup({
    symbol: 'BTCUSDT', price: 100, support: 99, resistance: 106, atrPct: 1.0,
    frames: frames('BULLISH', 'BULLISH', 'BULLISH', 'BULLISH', 55),
  })!;
  assert.equal(s.direction, 'LONG');
  assert.ok(s.score >= 90, `ожидали высокий балл, получили ${s.score}`);
  assert.equal(s.grade, 'A');
  assert.ok(s.riskReward !== null && s.riskReward >= 5, 'потенциал 6% при риске 1% → 6:1');
  assert.ok(s.reasons.some((r) => r.includes('Старшие таймфреймы')));
  assert.equal(s.warnings.length, 0);
}

// Идеальный шорт — зеркально
{
  const s = scoreSetup({
    symbol: 'ETHUSDT', price: 100, support: 94, resistance: 101, atrPct: 1.0,
    frames: frames('BEARISH', 'BEARISH', 'BEARISH', 'BEARISH', 45),
  })!;
  assert.equal(s.direction, 'SHORT');
  assert.equal(s.grade, 'A');
}

// Перегрев: те же тренды, но RSI 82 → ниже балл и предупреждение
{
  const hot = scoreSetup({
    symbol: 'SOLUSDT', price: 100, support: 90, resistance: 110, atrPct: 1.0,
    frames: frames('BULLISH', 'BULLISH', 'BULLISH', 'BULLISH', 82),
  })!;
  const calm = scoreSetup({
    symbol: 'SOLUSDT', price: 100, support: 90, resistance: 110, atrPct: 1.0,
    frames: frames('BULLISH', 'BULLISH', 'BULLISH', 'BULLISH', 55),
  })!;
  assert.ok(hot.score < calm.score - 15);
  assert.ok(hot.warnings.some((w) => w.includes('Перегрев')));
}

// Против дневного тренда
{
  const s = scoreSetup({
    symbol: 'XRPUSDT', price: 100, support: 98, resistance: 108, atrPct: 1,
    frames: frames('BULLISH', 'BULLISH', 'BULLISH', 'BEARISH', 55),
  })!;
  assert.ok(s.warnings.some((w) => w.includes('дневном')));
  assert.ok(s.score < 70);
}

// Вплотную к сопротивлению для лонга — штраф
{
  const s = scoreSetup({
    symbol: 'BNBUSDT', price: 100, support: 90, resistance: 100.5, atrPct: 1.0,
    frames: frames('BULLISH', 'BULLISH', 'BULLISH', 'BULLISH', 55),
  })!;
  assert.ok(s.warnings.some((w) => w.includes('сопротивлению')));
}

// Нет согласия — нет сетапа
assert.equal(
  scoreSetup({ symbol: 'TONUSDT', price: 100, support: 95, resistance: 105, atrPct: 1, frames: frames('BULLISH', 'RANGE', 'RANGE', 'BEARISH') }),
  null
);
assert.equal(
  scoreSetup({ symbol: 'TONUSDT', price: 100, support: 95, resistance: 105, atrPct: 1, frames: frames('RANGE', 'RANGE', 'RANGE', 'RANGE') }),
  null
);
// Мусорные данные не ломают расчёт
assert.equal(scoreSetup({ symbol: 'X', price: 0, support: 0, resistance: 0, atrPct: 0, frames: [] }), null);

// Баллы всегда в пределах 0..100
for (const rsi of [5, 30, 50, 70, 95]) {
  for (const b of ['BULLISH', 'BEARISH'] as Bias[]) {
    const s = scoreSetup({ symbol: 'T', price: 100, support: 99.9, resistance: 100.1, atrPct: 12, frames: frames(b, b, b, b, rsi) });
    if (s) assert.ok(s.score >= 0 && s.score <= 100);
  }
}
assert.deepEqual([80, 65, 50, 10].map(gradeOf), ['A', 'B', 'C', 'D']);

console.log('setupScanner: все проверки пройдены');
