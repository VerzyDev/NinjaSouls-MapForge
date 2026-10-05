import js from '@eslint/js';
import globals from 'globals';
import tseslint from 'typescript-eslint';
import prettier from 'eslint-plugin-prettier';
import reactHooks from 'eslint-plugin-react-hooks';
import reactRefresh from 'eslint-plugin-react-refresh';
import prettierConfig from 'eslint-config-prettier';
import perfectionist from 'eslint-plugin-perfectionist';
import unusedImports from 'eslint-plugin-unused-imports';

export default tseslint.config(
	{ ignores: ['dist', 'src-tauri', 'vite.config.ts', 'tailwind.config.ts'] },
	{
		files: ['**/*.{ts,tsx}'],
		extends: [js.configs.recommended, ...tseslint.configs.recommended, prettierConfig],
		languageOptions: {
			ecmaVersion: 2020,
			globals: globals.browser
		},
		plugins: {
			prettier,
			perfectionist,
			'react-hooks': reactHooks,
			'react-refresh': reactRefresh,
			'unused-imports': unusedImports
		},
		rules: {
			...reactHooks.configs.recommended.rules,
			'prettier/prettier': 'warn',
			'react-hooks/exhaustive-deps': 'off',
			'@typescript-eslint/no-explicit-any': 'off',
			'@typescript-eslint/no-unused-vars': 'off',
			'unused-imports/no-unused-imports': 'error',
			'unused-imports/no-unused-vars': ['warn', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
			'react-refresh/only-export-components': ['warn', { allowConstantExport: true }],
			'perfectionist/sort-named-imports': ['error', { type: 'line-length', order: 'asc' }],
			'perfectionist/sort-named-exports': ['error', { type: 'line-length', order: 'asc' }],
			'perfectionist/sort-jsx-props': ['error', { type: 'line-length', order: 'asc' }],
			'perfectionist/sort-imports': [
				'error',
				{
					type: 'line-length',
					order: 'asc',
					newlinesBetween: 1,
					groups: ['type', ['builtin', 'external'], 'internal', ['parent', 'sibling', 'index'], 'side-effect', 'unknown']
				}
			]
		}
	},
	{
		files: ['src/main.tsx'],
		rules: {
			'react-refresh/only-export-components': 'off'
		}
	}
);
