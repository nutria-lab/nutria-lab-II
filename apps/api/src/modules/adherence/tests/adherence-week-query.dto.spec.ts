import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { AdherenceWeekQueryDto } from '../dto/adherence-week-query.dto';

describe('AdherenceWeekQueryDto', () => {
  async function errors(value: Record<string, unknown>) {
    const dto = plainToInstance(AdherenceWeekQueryDto, value);
    return validate(dto, { whitelist: true, forbidNonWhitelisted: true });
  }

  it.each(['2026-10-19', '2026-02-02'])('accepts an exact real Monday date: %s', async (weekStart) => {
    expect(await errors({ weekStart })).toHaveLength(0);
  });

  it.each([
    ['missing date', {}],
    ['malformed format', { weekStart: '2026-1-19' }],
    ['timestamp instead of a civil date', { weekStart: '2026-10-19T00:00:00.000Z' }],
    ['impossible calendar date', { weekStart: '2026-02-30' }],
    ['non-Monday date', { weekStart: '2026-10-20' }],
    ['unknown field', { weekStart: '2026-10-19', userId: 'another-user' }],
  ] as Array<[string, Record<string, unknown>]>)('rejects %s', async (_caseName, value) => {
    expect(await errors(value)).not.toHaveLength(0);
  });
});
