import test from 'node:test';
import assert from 'node:assert/strict';
import { getPnlIntensityStyles, resolvePnlIntensityLevel } from '../src/lib/pnlIntensity';

test('resolvePnlIntensityLevel classifies return magnitudes into 5 intensity tiers (0..4)', () => {
  assert.equal(resolvePnlIntensityLevel(0), 0);
  assert.equal(resolvePnlIntensityLevel(0.04), 0);
  assert.equal(resolvePnlIntensityLevel(-0.04), 0);
  assert.equal(resolvePnlIntensityLevel(0.5), 1);
  assert.equal(resolvePnlIntensityLevel(-1.99), 1);
  assert.equal(resolvePnlIntensityLevel(2), 2);
  assert.equal(resolvePnlIntensityLevel(-6.99), 2);
  assert.equal(resolvePnlIntensityLevel(7), 3);
  assert.equal(resolvePnlIntensityLevel(-14.9), 3);
  assert.equal(resolvePnlIntensityLevel(15), 4);
  assert.equal(resolvePnlIntensityLevel(-42.5), 4);
});

test('getPnlIntensityStyles handles non-finite values and neutral privacy override safely', () => {
  assert.equal(getPnlIntensityStyles(Number.NaN).direction, 'neutral');
  assert.equal(getPnlIntensityStyles(Number.POSITIVE_INFINITY).level, 0);

  const masked = getPnlIntensityStyles(25, { isNeutral: true });
  assert.equal(masked.direction, 'neutral');
  assert.equal(masked.level, 0);
  assert.equal(masked.badgeClass.includes('emerald'), false);
  assert.equal(masked.badgeClass.includes('rose'), false);
});

test('getPnlIntensityStyles scales green and red Tailwind classes smoothly as PnL magnitude grows', () => {
  const mildPos = getPnlIntensityStyles(0.8);
  const strongPos = getPnlIntensityStyles(18.5);
  assert.equal(mildPos.direction, 'positive');
  assert.equal(strongPos.direction, 'positive');
  assert.equal(mildPos.level, 1);
  assert.equal(strongPos.level, 4);
  assert.equal(mildPos.badgeClass.includes('emerald'), true);
  assert.equal(strongPos.badgeClass.includes('emerald'), true);
  assert.equal(strongPos.badgeClass.includes('shadow-'), true);
  assert.notEqual(mildPos.badgeClass, strongPos.badgeClass);

  const mildNeg = getPnlIntensityStyles(-0.6);
  const extremeNeg = getPnlIntensityStyles(-22.4);
  assert.equal(mildNeg.direction, 'negative');
  assert.equal(extremeNeg.direction, 'negative');
  assert.equal(mildNeg.level, 1);
  assert.equal(extremeNeg.level, 4);
  assert.equal(mildNeg.badgeClass.includes('rose'), true);
  assert.equal(extremeNeg.badgeClass.includes('rose'), true);
  assert.equal(extremeNeg.cardTintClass.includes('shadow-'), true);
  assert.notEqual(mildNeg.textClass, extremeNeg.textClass);
});
