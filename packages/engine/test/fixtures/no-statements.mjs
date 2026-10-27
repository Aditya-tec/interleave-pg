export default {
  name: 'no statements',
  tables: ['accounts'],
  schema: 'sql/accounts.sql',
  actors: { A: () => 1, B: () => 2 },
};
