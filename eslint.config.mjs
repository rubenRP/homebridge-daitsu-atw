import eslint from '@eslint/js';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    ignores: ['dist/**', 'node_modules/**'],
  },
  eslint.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['src/**/*.ts'],
    rules: {
      quotes: ['error', 'single'],
      indent: ['error', 2, { SwitchCase: 0 }],
      semi: ['error', 'always'],
      'comma-dangle': ['error', 'always-multiline'],
      eqeqeq: 'error',
    },
  },
);
