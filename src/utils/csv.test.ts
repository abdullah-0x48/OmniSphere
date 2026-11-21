import assert from 'node:assert/strict';
import test from 'node:test';
import { parseCsvMatrix, parseDeviceImportCsv } from './csv.ts';

test('parseCsvMatrix handles quoted commas, escaped quotes, CRLF, and BOM', () => {
  const input =
    '\uFEFFserialNumber,hardwareId,model,site,tags,name\r\n' +
    'SN-001,AA:BB:CC:00:00:01,"TH-200 ""Pro""",Dyeing Plant,"critical,line-1",Sensor-1\r\n';
  const matrix = parseCsvMatrix(input);
  assert.equal(matrix.length, 2);
  assert.equal(matrix[1][2], 'TH-200 "Pro"');
  assert.equal(matrix[1][4], 'critical,line-1');
});

test('parseDeviceImportCsv maps headers case-insensitively and reports missing columns', () => {
  const valid = parseDeviceImportCsv(
    'Serial_Number,Hardware ID,Model,Site,Tags,Name\nSN-10,11:22:33:44:55:66,TH-200,Dyeing Plant,"a,b",Dev-10',
  );
  assert.equal(valid.headerError, null);
  assert.equal(valid.rows.length, 1);
  assert.equal(valid.rows[0].serialNumber, 'SN-10');
  assert.equal(valid.rows[0].tags, 'a,b');

  const missing = parseDeviceImportCsv('serialNumber,model\nSN-10,TH-200');
  assert.ok(missing.headerError);
  assert.match(missing.headerError, /hardwareid/i);
  assert.match(missing.headerError, /site/i);
});
