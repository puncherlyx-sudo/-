import assert from 'node:assert/strict';
import { csvCell, tradesToCsv, type CsvTrade } from '../src/lib/journalCsv.ts';

// защита от формул
assert.equal(csvCell('=HYPERLINK("http://evil","x")'), `"'=HYPERLINK(""http://evil"",""x"")"`);
assert.equal(csvCell('+1+1'), "'+1+1");
assert.equal(csvCell('-2'), "'-2");
assert.equal(csvCell('@SUM(A1)'), "'@SUM(A1)");
assert.equal(csvCell('обычная заметка'), 'обычная заметка');
// отрицательные ЧИСЛА (не строки) не ломаются
assert.equal(csvCell(-1.5), '-1.5');
// запятые, кавычки, переводы строк
assert.equal(csvCell('вход, потом "выход"'), '"вход, потом ""выход"""');
assert.equal(csvCell('строка1\nстрока2'), '"строка1\nстрока2"');
assert.equal(csvCell(NaN), '');

const trades: CsvTrade[] = [
  { id: 't1', symbol: 'BTCUSDT', marketType: 'spot', side: 'LONG', entryPrice: 100, stopPrice: 95, exitPrice: 110, status: 'closed', note: 'пробой, объём', createdAtSec: 1763380800, closedAt: '2026-11-18T10:00:00.000Z' },
  { id: 't2', symbol: 'ETHUSDT', marketType: 'futures', side: 'SHORT', entryPrice: 200, stopPrice: 0, exitPrice: 0, status: 'open', note: '=cmd|"/c calc"!A1' },
];
const csv = tradesToCsv(trades);
const lines = csv.replace('﻿', '').trim().split('\r\n');
assert.ok(csv.startsWith('﻿'), 'есть BOM для Excel');
assert.equal(lines[0], 'id,date_opened,date_closed,symbol,market,side,entry,stop,exit,status,pnl_pct,r_multiple,note');
assert.equal(lines.length, 3);
assert.ok(lines[1].includes(',10,2,'), 'лонг 100→110: +10%, R=2 при риске 5%');
assert.ok(lines[1].endsWith('"пробой, объём"'));
assert.ok(lines[2].includes(',open,,,'), 'открытая сделка: пустые pnl и R');
assert.ok(lines[2].includes(`'=cmd`), 'формула в заметке обезврежена');
assert.ok(!lines[2].includes(',=cmd'), 'нет ячейки, начинающейся с =');

console.log('journalCsv: все проверки пройдены');
