/**
 * Atributions:
 * Rule and helpers are adapted from ESLint
 * https://github.com/eslint/eslint/blob/main/lib/rules/prefer-const.js
 */

import type { Reference, Variable, Scope } from '@typescript-eslint/scope-manager';
import type { TSESTree, AST_NODE_TYPES } from '@typescript-eslint/types';

import { getSourceCode } from '../../utils/compat';
import type { RuleContext } from '../../types';

type ASTNode = TSESTree.Node;
type CheckedNode = NonNullable<ASTNode & { parent: NonNullable<ASTNode> }>;
type VariableDeclaration =
	| TSESTree.LetOrConstOrVarDeclaration
	| TSESTree.UsingInForOfDeclaration
	| TSESTree.UsingInNormalContextDeclaration;
type VariableDeclarator =
	| TSESTree.LetOrConstOrVarDeclarator
	| TSESTree.UsingInForOfDeclarator
	| TSESTree.UsingInNormalContextDeclarator;

const PATTERN_TYPE =
	/^(?:.+?Pattern|RestElement|SpreadProperty|ExperimentalRestProperty|Property)$/u;
const DECLARATION_HOST_TYPE = /^(?:Program|BlockStatement|StaticBlock|SwitchCase)$/u;
const DESTRUCTURING_HOST_TYPE = /^(?:VariableDeclarator|AssignmentExpression)$/u;

/**
 * Finds the callee of a `CallExpression` if the given node is part of a
 * `VariableDeclarator` or an ObjectPattern within a `VariableDeclarator`.
 */
function findIdentifierCallee(node: CheckedNode) {
	const { parent } = node;
	if (parent.type === 'VariableDeclarator' && parent.init?.type === 'CallExpression') {
		return parent.init.callee;
	}

	if (
		parent.type === 'Property' &&
		parent.parent.type === 'ObjectPattern' &&
		parent.parent.parent.type === 'VariableDeclarator' &&
		parent.parent.parent.init?.type === 'CallExpression'
	) {
		return parent.parent.parent.init.callee;
	}

	return null;
}

/**
 * Skip let statements when they are reactive values created by runes.
 */
function skipReactiveValues(identifier: ASTNode | null) {
	if (!identifier || !identifier.parent) {
		return false;
	}

	const callee = findIdentifierCallee(identifier);
	if (!callee) {
		return true;
	}

	if (callee.type === 'Identifier' && ['$state', '$props', '$derived'].includes(callee.name)) {
		return false;
	}

	if (callee.type !== 'MemberExpression' || callee.object.type !== 'Identifier') {
		return true;
	}

	if (
		callee.object.name === '$derived' &&
		callee.property.type === 'Identifier' &&
		callee.property.name === 'by'
	) {
		return false;
	}
	if (
		callee.object.name === '$state' &&
		callee.property.type === 'Identifier' &&
		callee.property.name === 'frozen'
	) {
		return false;
	}

	return true;
}

/**
 * Checks whether a given `Identifier` node becomes a `VariableDeclaration` or
 * not.
 */
function canBecomeVariableDeclaration(identifier: ASTNode) {
	let node = identifier.parent;

	while (node && PATTERN_TYPE.test(node.type)) {
		node = node.parent;
	}
	if (!node) {
		// TS check
		return false;
	}

	const isValidAssignmentExpr =
		node.type === 'AssignmentExpression' &&
		node.parent.type === 'ExpressionStatement' &&
		DECLARATION_HOST_TYPE.test(node.parent.parent.type);
	return node.type === 'VariableDeclarator' || isValidAssignmentExpr;
}

/**
 * Checks if an property or element is from outer scope or export function
 * parameters in destructing pattern.
 */
function isOuterVariableInDestructing(name: string, initScope: Scope) {
	if (initScope.through.some((ref) => ref.resolved && ref.resolved.name === name)) {
		return true;
	}

	const variable = getVariableByName(initScope, name);
	return variable !== null ? variable.defs.some((def) => def.type === 'Parameter') : false;
}

/**
 * Gets the `VariableDeclarator/AssignmentExpression` node that a given
 * reference belongs to. It is used to detect a mix of reassigned and never
 * reassigned in a destructuring.
 */
function getDestructuringHost(reference: Reference) {
	if (!reference.isWrite()) {
		return null;
	}

	let node = reference.identifier.parent;
	while (PATTERN_TYPE.test(node.type)) {
		if (!node.parent) {
			break;
		}

		node = node.parent;
	}

	return !DESTRUCTURING_HOST_TYPE.test(node.type) ? null : node;
}

/**
 * Determines if a destructuring assignment node contains any
 * `MemberExpression` nodes. is used to determine if a variable that is only
 * written once using destructuring can be safely converted into a const
 * declaration.
 */
function hasMemberExpressionAssignment(node: ASTNode): boolean {
	if (node.type === 'MemberExpression') {
		return true;
	}
	if (node.type === 'ObjectPattern') {
		return node.properties.some((prop) =>
			prop ? hasMemberExpressionAssignment('argument' in prop ? prop.argument : prop.value) : false
		);
	}
	if (node.type === 'ArrayPattern') {
		return node.elements.some((element) =>
			element ? hasMemberExpressionAssignment(element) : false
		);
	}
	if (node.type === 'AssignmentPattern') {
		return hasMemberExpressionAssignment(node.left);
	}

	return false;
}

/**
 * Validates an object pattern to determine if it contains outer variables or
 * non-identifier assignments.
 */
function validateObjectPattern(node: TSESTree.ObjectPattern, variable: Variable) {
	const properties = node.properties;
	const hasOuterVariables = properties
		.filter((prop) => prop.value)
		.map((prop) =>
			'value' in prop && prop.value
				? 'name' in prop.value
					? prop.value.name
					: undefined
				: undefined
		)
		.some((name) => name && isOuterVariableInDestructing(name, variable.scope));
	const hasNonIdentifiers = hasMemberExpressionAssignment(node);

	return hasOuterVariables || hasNonIdentifiers;
}

/**
 * Validates an array pattern to determine if it contains outer variables or
 * non-identifier elements.
 */
function validateArrayPattern(node: TSESTree.ArrayPattern, variable: Variable): boolean {
	const elements = node.elements;
	const hasOuterVariables = elements
		.map((element) => (element && 'name' in element ? element.name : undefined))
		.some((name) => name && isOuterVariableInDestructing(name, variable.scope));
	const hasNonIdentifiers = hasMemberExpressionAssignment(node);

	return hasOuterVariables || hasNonIdentifiers;
}

/**
 * Gets an identifier node of a given variable.
 *
 * If the initialization exists or one or more reading references exist before
 * the first assignment, the identifier node is the node of the declaration.
 * Otherwise, the identifier node is the node of the first assignment.
 *
 * If the variable should not change to const, export function returns null.
 * - If the variable is reassigned.
 * - If the variable is never initialized nor assigned.
 * - If the variable is initialized in a different scope from the declaration.
 * - If the unique assignment of the variable cannot change to a declaration.
 *   e.g. `if (a) b = 1` / `return (b = 1)`
 * - If the variable is declared in the global scope and `eslintUsed` is `true`.
 *   `/*exported foo` directive comment makes such variables. rule does not
 *   warn such variables because rule cannot distinguish whether the
 *   exported variables are reassigned or not.
 */
function getIdentifierIfShouldBeConst(variable: Variable, ignoreReadBeforeAssign: boolean) {
	if (variable.eslintUsed && variable.scope.type === 'global') {
		return null;
	}

	let writer = null;
	let isReadBeforeInit = false;
	const references = variable.references;
	for (let i = 0; i < references.length; ++i) {
		const reference = references[i];

		if (reference.isWrite()) {
			const isReassigned = writer !== null && writer.identifier !== reference.identifier;
			if (isReassigned) {
				return null;
			}

			const destructuringHost = getDestructuringHost(reference);
			const isValidDestructuringHost =
				destructuringHost !== null &&
				'left' in destructuringHost &&
				destructuringHost.left !== undefined;

			if (isValidDestructuringHost) {
				const leftNode = destructuringHost.left;

				if (leftNode.type === 'ObjectPattern' && validateObjectPattern(leftNode, variable)) {
					return null;
				} else if (leftNode.type === 'ArrayPattern' && validateArrayPattern(leftNode, variable)) {
					return null;
				}
			}

			writer = reference;
		} else if (reference.isRead() && writer === null) {
			if (ignoreReadBeforeAssign) {
				return null;
			}
			isReadBeforeInit = true;
		}
	}

	const shouldBeConst =
		writer !== null &&
		writer.from === variable.scope &&
		canBecomeVariableDeclaration(writer.identifier);
	if (!shouldBeConst) {
		return null;
	}

	if (isReadBeforeInit) {
		return variable.defs[0].name;
	}

	return writer?.identifier ?? null;
}

/**
 * Finds the nearest parent of node with a given type.
 */
function findUp(node: ASTNode, type: `${AST_NODE_TYPES}`, shouldStop: (node: ASTNode) => boolean) {
	if (!node || shouldStop(node) || !node.parent) {
		return null;
	}
	if (node.type === type) {
		return node;
	}

	return findUp(node.parent, type, shouldStop);
}

/**
 * Finds the variable by a given name in a given scope and its upper scopes.
 */
function getVariableByName(initScope: Scope, name: string): Variable | null {
	let scope: Scope | null = initScope;

	while (scope) {
		const variable = scope.set.get(name);
		if (variable) {
			return variable;
		}
		scope = scope.upper;
	}

	return null;
}

/**
 * Checks whether a given node is located at `ForStatement.init` or not.
 */
export function isInitOfForStatement(node: ASTNode): boolean {
	return Boolean(node.parent && node.parent.type === 'ForStatement' && node.parent.init === node);
}

/**
 * Groups by the VariableDeclarator/AssignmentExpression node that each
 * reference of given variables belongs to.
 * is used to detect a mix of reassigned and never reassigned in a
 * destructuring.
 */
export function groupByDestructuring(
	variables: Variable[],
	ignoreReadBeforeAssign: boolean
): Map<ASTNode, (ASTNode | null)[]> {
	const identifierMap = new Map<ASTNode, (ASTNode | null)[]>();

	for (let i = 0; i < variables.length; ++i) {
		const variable = variables[i];
		const references = variable.references;
		const identifier = getIdentifierIfShouldBeConst(variable, ignoreReadBeforeAssign);

		let prevId: TSESTree.Identifier | TSESTree.JSXIdentifier | null = null;
		references.forEach((reference) => {
			const id = reference.identifier;
			if (id === prevId) {
				return;
			}

			prevId = id;
			const group = getDestructuringHost(reference);
			if (!group) {
				return;
			}

			if (identifierMap.has(group)) {
				identifierMap.get(group)!.push(identifier);
			} else {
				identifierMap.set(group, [identifier]);
			}
		});
	}

	return identifierMap;
}

/**
 * Calculates the retained text range by comparing the given range with an
 * optional retained range. If a retained range is provided, it merges the two
 * ranges to form an actual range. It then returns two ranges: one from the
 * start of the actual range to the start of the given range, and another from
 * the end of the given range to the end of the actual range.
 */
function calculateRetainedTextRange(
	range: TSESTree.Range,
	retainedRange: TSESTree.Range | null
): [TSESTree.Range, TSESTree.Range] {
	const actualRange = retainedRange
		? [Math.min(retainedRange[0], range[0]), Math.max(retainedRange[1], range[1])]
		: range;

	return [
		[actualRange[0], range[0]],
		[range[1], actualRange[1]]
	];
}

type NodeReporterOptions = { destructuring: 'any' | 'all' };
type NodeReporter = { report: (nodes: (ASTNode | null)[]) => void };

/**
 * Creates a node reporter function that checks and reports nodes based on the
 * provided context and options.
 *
 * @remarks The `report` function checks and reports nodes that should be
 * converted to `const` declarations. It performs various checks to ensure that
 * the nodes meet the criteria for reporting and fixing.
 *
 * The function also handles cases where variables are declared using
 * destructuring patterns and ensures that the correct number of nodes are
 * reported and fixed.
 */
export function createNodeReporter(
	context: RuleContext,
	{ destructuring }: NodeReporterOptions
): NodeReporter {
	let reportCount = 0;
	let checkedId: TSESTree.BindingName | null = null;
	let checkedName = '';
	const shouldMatchAnyDestructuredVariable = destructuring !== 'all';

	function checkAndReportNodes(initialNodes: (ASTNode | null)[]): void {
		const nodes = initialNodes.filter(Boolean) as ASTNode[];
		const shouldCheckGroup =
			nodes.length && (shouldMatchAnyDestructuredVariable || initialNodes.length === nodes.length);
		if (!shouldCheckGroup) {
			return;
		}

		const variableDeclarationParent = findUp(
			nodes[0],
			'VariableDeclaration',
			(parentNode: ASTNode) => parentNode.type.endsWith('Statement')
		);
		const isVarDecParentNull = variableDeclarationParent === null;
		const isValidDecParent =
			!isVarDecParentNull &&
			'declarations' in variableDeclarationParent &&
			variableDeclarationParent.declarations.length > 0;
		if (isValidDecParent) {
			checkDeclarator(variableDeclarationParent.declarations[0]);
		}

		const shouldFix =
			isValidDecParent &&
			checkShouldFix(variableDeclarationParent, nodes.length, initialNodes.length);
		const sourceCode = getSourceCode(context);
		nodes.filter(skipReactiveValues).forEach((node) => {
			report(sourceCode, node, variableDeclarationParent!, shouldFix);
		});
	}

	function report(
		sourceCode: ReturnType<typeof getSourceCode>,
		node: ASTNode,
		nodeParent: ASTNode,
		shouldFix: boolean
	) {
		context.report({
			node,
			messageId: 'useConst',
			// @ts-expect-error Name will exist at point
			data: { name: node.name },
			fix: !shouldFix
				? null
				: (fixer) => {
						const letKeywordToken = sourceCode.getFirstToken(nodeParent, {
							includeComments: false,
							filter: (t) => 'kind' in nodeParent && t.value === nodeParent.kind
						});
						if (!letKeywordToken) {
							return null;
						}

						const [initialRange, finalRange] = calculateRetainedTextRange(
							letKeywordToken.range,
							nodeParent.range
						);
						const prefix = sourceCode.text.slice(...initialRange);
						const suffix = sourceCode.text.slice(...finalRange);

						return fixer.replaceTextRange(
							[initialRange[0], finalRange[1]],
							`${prefix}const${suffix}`
						);
					}
		});
	}

	function checkShouldFix(
		declaration: VariableDeclaration,
		totalNodes: number,
		totalInitialNodes: number
	) {
		const isParentForStatement =
			declaration?.parent.type === 'ForInStatement' ||
			declaration?.parent.type === 'ForOfStatement';
		const areAllDeclarationsInitialized =
			'declarations' in declaration && declaration.declarations.every((decl) => decl.init);
		const shouldFix =
			totalNodes === totalInitialNodes &&
			declaration &&
			(isParentForStatement || areAllDeclarationsInitialized);

		const totalDeclarationCount = checkDestructuredDeclaration(declaration, totalNodes);
		if (totalDeclarationCount === -1) {
			return shouldFix;
		}

		return shouldFix && reportCount === totalDeclarationCount;
	}

	function checkDestructuredDeclaration(declaration: VariableDeclaration, totalNodes: number) {
		const isValidDeclaration = declaration !== null && 'declarations' in declaration;
		const hasMultipleDeclarations = isValidDeclaration && declaration.declarations.length !== 1;
		if (!hasMultipleDeclarations) {
			return -1;
		}

		const hasMoreThanOneDeclaration =
			declaration.declarations && declaration.declarations.length >= 1;
		if (!hasMoreThanOneDeclaration) {
			return -1;
		}

		reportCount += totalNodes;

		return declaration.declarations.reduce((total, declaration) => {
			if (declaration.id.type === 'ObjectPattern') {
				return total + declaration.id.properties.length;
			}

			if (declaration.id.type === 'ArrayPattern') {
				return total + declaration.id.elements.length;
			}

			return total + 1;
		}, 0);
	}

	function checkDeclarator(declarator: VariableDeclarator) {
		if (!declarator.init) {
			return;
		}

		const firstDeclaratorParent = declarator.init.parent;
		if (firstDeclaratorParent.type !== 'VariableDeclarator') {
			return;
		}

		const { id } = firstDeclaratorParent;
		if ('name' in id && id.name !== checkedName) {
			checkedName = id.name;
			reportCount = 0;
		}

		if (firstDeclaratorParent.id.type === 'ObjectPattern') {
			const { init } = firstDeclaratorParent;
			if (init && 'name' in init && init.name !== checkedName) {
				checkedName = init.name;
				reportCount = 0;
			}
		}

		if (firstDeclaratorParent.id !== checkedId) {
			checkedId = firstDeclaratorParent.id;
			reportCount = 0;
		}
	}

	return {
		report(group) {
			checkAndReportNodes(group);
		}
	};
}
