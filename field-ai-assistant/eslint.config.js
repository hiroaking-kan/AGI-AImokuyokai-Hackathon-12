import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import globals from 'globals';

export default tseslint.config(
  { ignores: ['node_modules/**', 'dist/**', 'dist-server/**'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  { languageOptions: { globals: { ...globals.browser, ...globals.node } } },
  { rules: { '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }] } },
  { files: ['client/public/pcm-worklet.js'], languageOptions: { globals: { AudioWorkletProcessor: 'readonly', registerProcessor: 'readonly', sampleRate: 'readonly' } } },
);
