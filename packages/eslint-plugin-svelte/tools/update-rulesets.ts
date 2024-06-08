import path from 'path';
import { rules } from './lib/load-rules';
import { writeAndFormat } from './lib/write';

// ------------------
// Legacy Config
// ------------------

const legacyBaseContent = `/*
 * IMPORTANT!
 * This file has been automatically generated,
 * in order to update its content execute "pnpm run update"
 */
export = {
  plugins: ["svelte"],
  overrides: [
    {
      files: ["*.svelte"],
      parser: require.resolve("svelte-eslint-parser"),
      rules: {
        // ESLint core rules known to cause problems with \`.svelte\`.
        "no-inner-declarations": "off", // The AST generated by svelte-eslint-parser will false positives in it rule because the root node of the script is not the \`Program\`.
        // "no-irregular-whitespace": "off",
        // Self assign is one of way to update reactive value in Svelte.
        "no-self-assign": "off",

        // eslint-plugin-svelte rules
        ${rules
					.filter((rule) => rule.meta.docs.recommended === 'base' && !rule.meta.deprecated)
					.map((rule) => {
						const conf = rule.meta.docs.default || 'error';
						return `"${rule.meta.docs.ruleId}": "${conf}"`;
					})
					.join(',\n        ')},
      },
    },
  ],
}
`;

const legacyBaseFilePath = path.resolve(__dirname, '../src/configs/base.ts');

// Update file.
void writeAndFormat(legacyBaseFilePath, legacyBaseContent);

const legacyRecommendedContent = `/*
 * IMPORTANT!
 * This file has been automatically generated,
 * in order to update its content execute "pnpm run update"
 */
import path from "path"
const base = require.resolve("./base")
const baseExtend =
  path.extname(\`\${base}\`) === ".ts" ? "plugin:svelte/base" : base
export = {
  extends: [baseExtend],
  rules: {
    // eslint-plugin-svelte rules
    ${rules
			.filter((rule) => rule.meta.docs.recommended && !rule.meta.deprecated)
			.map((rule) => {
				const conf = rule.meta.docs.default || 'error';
				return `"${rule.meta.docs.ruleId}": "${conf}"`;
			})
			.join(',\n    ')},
  },
}
`;

const legacyRecommendedFilePath = path.resolve(__dirname, '../src/configs/recommended.ts');

// Update file.
void writeAndFormat(legacyRecommendedFilePath, legacyRecommendedContent);

const legacyPrettierContent = `/*
 * IMPORTANT!
 * This file has been automatically generated,
 * in order to update its content execute "pnpm run update"
 */
import path from "path"
const base = require.resolve("./base")
const baseExtend =
  path.extname(\`\${base}\`) === ".ts" ? "plugin:svelte/base" : base
export = {
  extends: [baseExtend],
  rules: {
    // eslint-plugin-svelte rules
    ${rules
			.filter((rule) => rule.meta.docs.conflictWithPrettier)
			.map((rule) => `"${rule.meta.docs.ruleId}": "off"`)
			.join(',\n    ')},
  },
}
`;

const legacyPrettierFilePath = path.resolve(__dirname, '../src/configs/prettier.ts');

// Update file.
void writeAndFormat(legacyPrettierFilePath, legacyPrettierContent);

// ------------------
// Flat Config
// ------------------

const baseContent = `/*
 * IMPORTANT!
 * This file has been automatically generated,
 * in order to update its content execute "pnpm run update"
 */
import type { ESLint } from 'eslint';
export default [
  {
    plugins: {
      get svelte(): ESLint.Plugin {
				// eslint-disable-next-line @typescript-eslint/no-require-imports -- ignore
        return require("../../index")
      }
    },
  },
  {
    files: ["*.svelte", "**/*.svelte"],
    languageOptions: {
      // eslint-disable-next-line @typescript-eslint/no-require-imports -- ignore
      parser: require('svelte-eslint-parser'),
    },
    rules: {
      // ESLint core rules known to cause problems with \`.svelte\`.
      "no-inner-declarations": "off", // The AST generated by svelte-eslint-parser will false positives in it rule because the root node of the script is not the \`Program\`.
      // "no-irregular-whitespace": "off",
      // Self assign is one of way to update reactive value in Svelte.
      "no-self-assign": "off",

      // eslint-plugin-svelte rules
      ${rules
				.filter((rule) => rule.meta.docs.recommended === 'base' && !rule.meta.deprecated)
				.map((rule) => {
					const conf = rule.meta.docs.default || 'error';
					return `"${rule.meta.docs.ruleId}": "${conf}"`;
				})
				.join(',\n        ')},
    },
		processor: 'svelte/svelte'
  },
]
`;

const baseFilePath = path.resolve(__dirname, '../src/configs/flat/base.ts');

// Update file.
void writeAndFormat(baseFilePath, baseContent);

const recommendedContent = `/*
 * IMPORTANT!
 * This file has been automatically generated,
 * in order to update its content execute "pnpm run update"
 */
import base from "./base"
export default [
  ...base,
  {
    rules: {
      // eslint-plugin-svelte rules
      ${rules
				.filter((rule) => rule.meta.docs.recommended && !rule.meta.deprecated)
				.map((rule) => {
					const conf = rule.meta.docs.default || 'error';
					return `"${rule.meta.docs.ruleId}": "${conf}"`;
				})
				.join(',\n    ')},
    },
  }
]
`;

const recommendedFilePath = path.resolve(__dirname, '../src/configs/flat/recommended.ts');

// Update file.
void writeAndFormat(recommendedFilePath, recommendedContent);

const prettierContent = `/*
 * IMPORTANT!
 * This file has been automatically generated,
 * in order to update its content execute "pnpm run update"
 */
import base from "./base"
export default [
  ...base,
  {
    rules: {
      // eslint-plugin-svelte rules
      ${rules
				.filter((rule) => rule.meta.docs.conflictWithPrettier)
				.map((rule) => `"${rule.meta.docs.ruleId}": "off"`)
				.join(',\n    ')},
    },
  }
]
`;

const prettierFilePath = path.resolve(__dirname, '../src/configs/flat/prettier.ts');

// Update file.
void writeAndFormat(prettierFilePath, prettierContent);