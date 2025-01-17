import { RuleTester } from '../../utils/eslint-compat.js';
import rule from '../../../src/rules/prefer-style-directive.js';
import { loadTestCases } from '../../utils/utils.js';

const tester = new RuleTester({
	languageOptions: {
		ecmaVersion: 2020,
		sourceType: 'module'
	}
});

tester.run('prefer-style-directive', rule as any, loadTestCases('prefer-style-directive'));
