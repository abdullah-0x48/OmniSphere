import { z } from 'zod';

// Password policy (8.1): at least 8 characters with a letter and a digit.
export const passwordSchema = z
  .string()
  .min(8, 'Password must be at least 8 characters long')
  .max(128, 'Password must be at most 128 characters long')
  .refine((val) => /[A-Za-z]/.test(val), 'Password must include at least one letter')
  .refine((val) => /\d/.test(val), 'Password must include at least one digit');

export const emailSchema = z
  .string()
  .trim()
  .toLowerCase()
  .email('Enter a valid email address')
  .max(254);

export const tenantCodeSchema = z
  .string()
  .trim()
  .toUpperCase()
  .regex(/^[A-Z]{2,6}$/, 'Tenant code must be 2 to 6 uppercase letters');

export const paginationQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(25),
  sort: z.string().optional(),
});

export function parseSortParam(
  sort: string | undefined,
  allowedFields: readonly string[],
  defaultField: string,
  defaultDir: 'asc' | 'desc' = 'desc',
): { field: string; dir: 'asc' | 'desc' } {
  if (!sort) {
    return { field: defaultField, dir: defaultDir };
  }
  const [rawField, rawDir] = sort.split(':');
  const field = allowedFields.includes(rawField) ? rawField : defaultField;
  const dir = rawDir === 'asc' || rawDir === 'desc' ? rawDir : defaultDir;
  return { field, dir };
}
