import js from '@eslint/js';
import prettier from 'eslint-config-prettier';
import vue from 'eslint-plugin-vue';
import tseslint from 'typescript-eslint';

export default tseslint.config(
    { ignores: ['dist', 'node_modules', 'example', 'coverage'] },
    js.configs.recommended,
    ...tseslint.configs.recommended,
    // The library source is pure .ts (defineComponent + h), but keep the Vue
    // flat-config recommended rules active for any .vue files that appear.
    ...vue.configs['flat/recommended'],
    prettier
);
