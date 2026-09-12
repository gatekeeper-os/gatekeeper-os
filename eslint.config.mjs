import tsParser from '@typescript-eslint/parser';

// TypeScript's strict compiler owns type/name checks. ESLint adds complementary
// correctness checks without introducing a formatting migration during release prep.
export default [
  { ignores: ['**/node_modules/**', '**/dist/**', '**/.state/**', '**/vm-artifacts/**', '**/templates/**'] },
  {
    files: ['**/*.{js,mjs,cjs,ts,mts,cts}'],
    languageOptions: { ecmaVersion: 'latest', sourceType: 'module' },
    rules: {
      'constructor-super': 'error',
      'no-async-promise-executor': 'error',
      'no-compare-neg-zero': 'error',
      'no-cond-assign': ['error', 'except-parens'],
      'no-constant-condition': ['error', { checkLoops: false }],
      'no-dupe-args': 'error',
      'no-dupe-else-if': 'error',
      'no-duplicate-case': 'error',
      'no-ex-assign': 'error',
      'no-fallthrough': 'error',
      'no-loss-of-precision': 'error',
      'no-self-assign': 'error',
      'no-sparse-arrays': 'error',
      'no-unsafe-finally': 'error',
      'valid-typeof': 'error',
    },
  },
  { files: ['**/*.{ts,mts,cts}'], languageOptions: { parser: tsParser } },
  { files: ['**/*.cjs'], languageOptions: { sourceType: 'commonjs' } },
];
