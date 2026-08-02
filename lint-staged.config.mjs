/** @type {import('lint-staged').Config} */
export default {
  'packages/*/src/**/*.{ts,tsx,js}': ['prettier --write', 'eslint --fix --max-warnings 0 --no-warn-ignored'],
  'apps/*/src/**/*.{ts,tsx,js}': ['prettier --write', 'eslint --fix --max-warnings 0 --no-warn-ignored'],
  '*.{json,md,yml,yaml,css}': ['prettier --write'],
}
