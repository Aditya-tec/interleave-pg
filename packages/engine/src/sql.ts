export const quoteIdent = (id: string): string => '"' + id.replace(/"/g, '""') + '"';
/** `schema.table` or `table`; every part is quoted, nothing is interpolated unquoted. */
export const quoteTable = (t: string): string => t.split('.').map(quoteIdent).join('.');
