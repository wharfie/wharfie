// @ts-nocheck
'use strict';
// Generated from lambdas/lib/athena/grammar/athenasql.g4 by ANTLR 4.9.2
// jshint ignore: start
const antlr4 = require('antlr4');

// This class defines a complete listener for a parse tree produced by athenasqlParser.
class athenasqlListener extends antlr4.tree.ParseTreeListener {
	tables = new Set()
	columns = new Set()
	selectedAsColumns = []
	lastIdentifier = undefined
	// Enter a parse tree produced by athenasqlParser#program.
	enterProgram(ctx) {
	}

	// Exit a parse tree produced by athenasqlParser#program.
	exitProgram(ctx) {
	}


	// Enter a parse tree produced by athenasqlParser#singleStatement.
	enterSingleStatement(ctx) {
	}

	// Exit a parse tree produced by athenasqlParser#singleStatement.
	exitSingleStatement(ctx) {
	}


	// Enter a parse tree produced by athenasqlParser#singleExpression.
	enterSingleExpression(ctx) {
	}

	// Exit a parse tree produced by athenasqlParser#singleExpression.
	exitSingleExpression(ctx) {
	}


	// Enter a parse tree produced by athenasqlParser#statementDefault.
	enterStatementDefault(ctx) {
	}

	// Exit a parse tree produced by athenasqlParser#statementDefault.
	exitStatementDefault(ctx) {
	}


	// Enter a parse tree produced by athenasqlParser#use.
	enterUse(ctx) {
	}

	// Exit a parse tree produced by athenasqlParser#use.
	exitUse(ctx) {
	}


	// Enter a parse tree produced by athenasqlParser#createSchema.
	enterCreateSchema(ctx) {
	}

	// Exit a parse tree produced by athenasqlParser#createSchema.
	exitCreateSchema(ctx) {
	}


	// Enter a parse tree produced by athenasqlParser#dropSchema.
	enterDropSchema(ctx) {
	}

	// Exit a parse tree produced by athenasqlParser#dropSchema.
	exitDropSchema(ctx) {
	}


	// Enter a parse tree produced by athenasqlParser#renameSchema.
	enterRenameSchema(ctx) {
	}

	// Exit a parse tree produced by athenasqlParser#renameSchema.
	exitRenameSchema(ctx) {
	}


	// Enter a parse tree produced by athenasqlParser#createTableAsSelect.
	enterCreateTableAsSelect(ctx) {
	}

	// Exit a parse tree produced by athenasqlParser#createTableAsSelect.
	exitCreateTableAsSelect(ctx) {
	}


	// Enter a parse tree produced by athenasqlParser#createTable.
	enterCreateTable(ctx) {
	}

	// Exit a parse tree produced by athenasqlParser#createTable.
	exitCreateTable(ctx) {
	}


	// Enter a parse tree produced by athenasqlParser#dropTable.
	enterDropTable(ctx) {
	}

	// Exit a parse tree produced by athenasqlParser#dropTable.
	exitDropTable(ctx) {
	}


	// Enter a parse tree produced by athenasqlParser#insertInto.
	enterInsertInto(ctx) {
	}

	// Exit a parse tree produced by athenasqlParser#insertInto.
	exitInsertInto(ctx) {
	}


	// Enter a parse tree produced by athenasqlParser#delete.
	enterDelete(ctx) {
	}

	// Exit a parse tree produced by athenasqlParser#delete.
	exitDelete(ctx) {
	}


	// Enter a parse tree produced by athenasqlParser#renameTable.
	enterRenameTable(ctx) {
	}

	// Exit a parse tree produced by athenasqlParser#renameTable.
	exitRenameTable(ctx) {
	}


	// Enter a parse tree produced by athenasqlParser#renameColumn.
	enterRenameColumn(ctx) {
	}

	// Exit a parse tree produced by athenasqlParser#renameColumn.
	exitRenameColumn(ctx) {
	}


	// Enter a parse tree produced by athenasqlParser#addColumn.
	enterAddColumn(ctx) {
	}

	// Exit a parse tree produced by athenasqlParser#addColumn.
	exitAddColumn(ctx) {
	}


	// Enter a parse tree produced by athenasqlParser#createView.
	enterCreateView(ctx) {
	}

	// Exit a parse tree produced by athenasqlParser#createView.
	exitCreateView(ctx) {
	}


	// Enter a parse tree produced by athenasqlParser#dropView.
	enterDropView(ctx) {
	}

	// Exit a parse tree produced by athenasqlParser#dropView.
	exitDropView(ctx) {
	}


	// Enter a parse tree produced by athenasqlParser#call.
	enterCall(ctx) {
	}

	// Exit a parse tree produced by athenasqlParser#call.
	exitCall(ctx) {
	}


	// Enter a parse tree produced by athenasqlParser#grant.
	enterGrant(ctx) {
	}

	// Exit a parse tree produced by athenasqlParser#grant.
	exitGrant(ctx) {
	}


	// Enter a parse tree produced by athenasqlParser#revoke.
	enterRevoke(ctx) {
	}

	// Exit a parse tree produced by athenasqlParser#revoke.
	exitRevoke(ctx) {
	}


	// Enter a parse tree produced by athenasqlParser#explain.
	enterExplain(ctx) {
	}

	// Exit a parse tree produced by athenasqlParser#explain.
	exitExplain(ctx) {
	}


	// Enter a parse tree produced by athenasqlParser#showCreateTable.
	enterShowCreateTable(ctx) {
	}

	// Exit a parse tree produced by athenasqlParser#showCreateTable.
	exitShowCreateTable(ctx) {
	}


	// Enter a parse tree produced by athenasqlParser#showCreateView.
	enterShowCreateView(ctx) {
	}

	// Exit a parse tree produced by athenasqlParser#showCreateView.
	exitShowCreateView(ctx) {
	}


	// Enter a parse tree produced by athenasqlParser#showTables.
	enterShowTables(ctx) {
	}

	// Exit a parse tree produced by athenasqlParser#showTables.
	exitShowTables(ctx) {
	}


	// Enter a parse tree produced by athenasqlParser#showSchemas.
	enterShowSchemas(ctx) {
	}

	// Exit a parse tree produced by athenasqlParser#showSchemas.
	exitShowSchemas(ctx) {
	}


	// Enter a parse tree produced by athenasqlParser#showCatalogs.
	enterShowCatalogs(ctx) {
	}

	// Exit a parse tree produced by athenasqlParser#showCatalogs.
	exitShowCatalogs(ctx) {
	}


	// Enter a parse tree produced by athenasqlParser#showColumns.
	enterShowColumns(ctx) {
	}

	// Exit a parse tree produced by athenasqlParser#showColumns.
	exitShowColumns(ctx) {
	}


	// Enter a parse tree produced by athenasqlParser#showFunctions.
	enterShowFunctions(ctx) {
	}

	// Exit a parse tree produced by athenasqlParser#showFunctions.
	exitShowFunctions(ctx) {
	}


	// Enter a parse tree produced by athenasqlParser#showSession.
	enterShowSession(ctx) {
	}

	// Exit a parse tree produced by athenasqlParser#showSession.
	exitShowSession(ctx) {
	}


	// Enter a parse tree produced by athenasqlParser#setSession.
	enterSetSession(ctx) {
	}

	// Exit a parse tree produced by athenasqlParser#setSession.
	exitSetSession(ctx) {
	}


	// Enter a parse tree produced by athenasqlParser#resetSession.
	enterResetSession(ctx) {
	}

	// Exit a parse tree produced by athenasqlParser#resetSession.
	exitResetSession(ctx) {
	}


	// Enter a parse tree produced by athenasqlParser#startTransaction.
	enterStartTransaction(ctx) {
	}

	// Exit a parse tree produced by athenasqlParser#startTransaction.
	exitStartTransaction(ctx) {
	}


	// Enter a parse tree produced by athenasqlParser#commit.
	enterCommit(ctx) {
	}

	// Exit a parse tree produced by athenasqlParser#commit.
	exitCommit(ctx) {
	}


	// Enter a parse tree produced by athenasqlParser#rollback.
	enterRollback(ctx) {
	}

	// Exit a parse tree produced by athenasqlParser#rollback.
	exitRollback(ctx) {
	}


	// Enter a parse tree produced by athenasqlParser#showPartitions.
	enterShowPartitions(ctx) {
	}

	// Exit a parse tree produced by athenasqlParser#showPartitions.
	exitShowPartitions(ctx) {
	}


	// Enter a parse tree produced by athenasqlParser#prepare.
	enterPrepare(ctx) {
	}

	// Exit a parse tree produced by athenasqlParser#prepare.
	exitPrepare(ctx) {
	}


	// Enter a parse tree produced by athenasqlParser#deallocate.
	enterDeallocate(ctx) {
	}

	// Exit a parse tree produced by athenasqlParser#deallocate.
	exitDeallocate(ctx) {
	}


	// Enter a parse tree produced by athenasqlParser#execute.
	enterExecute(ctx) {
	}

	// Exit a parse tree produced by athenasqlParser#execute.
	exitExecute(ctx) {
	}


	// Enter a parse tree produced by athenasqlParser#describeInput.
	enterDescribeInput(ctx) {
	}

	// Exit a parse tree produced by athenasqlParser#describeInput.
	exitDescribeInput(ctx) {
	}


	// Enter a parse tree produced by athenasqlParser#describeOutput.
	enterDescribeOutput(ctx) {
	}

	// Exit a parse tree produced by athenasqlParser#describeOutput.
	exitDescribeOutput(ctx) {
	}


	// Enter a parse tree produced by athenasqlParser#query.
	enterQuery(ctx) {
	}

	// Exit a parse tree produced by athenasqlParser#query.
	exitQuery(ctx) {
	}


	// Enter a parse tree produced by athenasqlParser#js_with.
	enterJs_with(ctx) {
	}

	// Exit a parse tree produced by athenasqlParser#js_with.
	exitJs_with(ctx) {
	}


	// Enter a parse tree produced by athenasqlParser#tableElement.
	enterTableElement(ctx) {
	}

	// Exit a parse tree produced by athenasqlParser#tableElement.
	exitTableElement(ctx) {
	}


	// Enter a parse tree produced by athenasqlParser#columnDefinition.
	enterColumnDefinition(ctx) {
	}

	// Exit a parse tree produced by athenasqlParser#columnDefinition.
	exitColumnDefinition(ctx) {
	}


	// Enter a parse tree produced by athenasqlParser#likeClause.
	enterLikeClause(ctx) {
	}

	// Exit a parse tree produced by athenasqlParser#likeClause.
	exitLikeClause(ctx) {
	}


	// Enter a parse tree produced by athenasqlParser#tableProperties.
	enterTableProperties(ctx) {
	}

	// Exit a parse tree produced by athenasqlParser#tableProperties.
	exitTableProperties(ctx) {
	}


	// Enter a parse tree produced by athenasqlParser#tableProperty.
	enterTableProperty(ctx) {
	}

	// Exit a parse tree produced by athenasqlParser#tableProperty.
	exitTableProperty(ctx) {
	}


	// Enter a parse tree produced by athenasqlParser#queryNoWith.
	enterQueryNoWith(ctx) {
	}

	// Exit a parse tree produced by athenasqlParser#queryNoWith.
	exitQueryNoWith(ctx) {
	}


	// Enter a parse tree produced by athenasqlParser#queryTermDefault.
	enterQueryTermDefault(ctx) {
	}

	// Exit a parse tree produced by athenasqlParser#queryTermDefault.
	exitQueryTermDefault(ctx) {
	}


	// Enter a parse tree produced by athenasqlParser#setOperation.
	enterSetOperation(ctx) {
	}

	// Exit a parse tree produced by athenasqlParser#setOperation.
	exitSetOperation(ctx) {
	}


	// Enter a parse tree produced by athenasqlParser#queryPrimaryDefault.
	enterQueryPrimaryDefault(ctx) {
	}

	// Exit a parse tree produced by athenasqlParser#queryPrimaryDefault.
	exitQueryPrimaryDefault(ctx) {
	}


	// Enter a parse tree produced by athenasqlParser#table.
	enterTable(ctx) {
	}

	// Exit a parse tree produced by athenasqlParser#table.
	exitTable(ctx) {
	}


	// Enter a parse tree produced by athenasqlParser#inlineTable.
	enterInlineTable(ctx) {
	}

	// Exit a parse tree produced by athenasqlParser#inlineTable.
	exitInlineTable(ctx) {
	}


	// Enter a parse tree produced by athenasqlParser#subquery.
	enterSubquery(ctx) {
	}

	// Exit a parse tree produced by athenasqlParser#subquery.
	exitSubquery(ctx) {
	}


	// Enter a parse tree produced by athenasqlParser#sortItem.
	enterSortItem(ctx) {
	}

	// Exit a parse tree produced by athenasqlParser#sortItem.
	exitSortItem(ctx) {
	}


	// Enter a parse tree produced by athenasqlParser#querySpecification.
	enterQuerySpecification(ctx) {
	}

	// Exit a parse tree produced by athenasqlParser#querySpecification.
	exitQuerySpecification(ctx) {
	}


	// Enter a parse tree produced by athenasqlParser#groupBy.
	enterGroupBy(ctx) {
	}

	// Exit a parse tree produced by athenasqlParser#groupBy.
	exitGroupBy(ctx) {
	}


	// Enter a parse tree produced by athenasqlParser#singleGroupingSet.
	enterSingleGroupingSet(ctx) {
	}

	// Exit a parse tree produced by athenasqlParser#singleGroupingSet.
	exitSingleGroupingSet(ctx) {
	}


	// Enter a parse tree produced by athenasqlParser#rollup.
	enterRollup(ctx) {
	}

	// Exit a parse tree produced by athenasqlParser#rollup.
	exitRollup(ctx) {
	}


	// Enter a parse tree produced by athenasqlParser#cube.
	enterCube(ctx) {
	}

	// Exit a parse tree produced by athenasqlParser#cube.
	exitCube(ctx) {
	}


	// Enter a parse tree produced by athenasqlParser#multipleGroupingSets.
	enterMultipleGroupingSets(ctx) {
	}

	// Exit a parse tree produced by athenasqlParser#multipleGroupingSets.
	exitMultipleGroupingSets(ctx) {
	}


	// Enter a parse tree produced by athenasqlParser#groupingExpressions.
	enterGroupingExpressions(ctx) {
	}

	// Exit a parse tree produced by athenasqlParser#groupingExpressions.
	exitGroupingExpressions(ctx) {
	}


	// Enter a parse tree produced by athenasqlParser#groupingSet.
	enterGroupingSet(ctx) {
	}

	// Exit a parse tree produced by athenasqlParser#groupingSet.
	exitGroupingSet(ctx) {
	}


	// Enter a parse tree produced by athenasqlParser#namedQuery.
	enterNamedQuery(ctx) {
	}

	// Exit a parse tree produced by athenasqlParser#namedQuery.
	exitNamedQuery(ctx) {
	}


	// Enter a parse tree produced by athenasqlParser#setQuantifier.
	enterSetQuantifier(ctx) {
	}

	// Exit a parse tree produced by athenasqlParser#setQuantifier.
	exitSetQuantifier(ctx) {
	}


	// Enter a parse tree produced by athenasqlParser#selectSingle.
	enterSelectSingle(ctx) {
		this.currentSelectColumns = new Set()
	}

	// Exit a parse tree produced by athenasqlParser#selectSingle.
	exitSelectSingle(ctx) {
		this.selectedAsColumns.push({
			columns: this.currentSelectColumns,
			identifier: this.lastIdentifier
		})
		this.currentSelectColumns = undefined
	}


	// Enter a parse tree produced by athenasqlParser#selectAll.
	enterSelectAll(ctx) {
	}

	// Exit a parse tree produced by athenasqlParser#selectAll.
	exitSelectAll(ctx) {
	}


	// Enter a parse tree produced by athenasqlParser#relationDefault.
	enterRelationDefault(ctx) {
	}

	// Exit a parse tree produced by athenasqlParser#relationDefault.
	exitRelationDefault(ctx) {
	}


	// Enter a parse tree produced by athenasqlParser#joinRelation.
	enterJoinRelation(ctx) {
	}

	// Exit a parse tree produced by athenasqlParser#joinRelation.
	exitJoinRelation(ctx) {
	}


	// Enter a parse tree produced by athenasqlParser#joinType.
	enterJoinType(ctx) {
	}

	// Exit a parse tree produced by athenasqlParser#joinType.
	exitJoinType(ctx) {
	}


	// Enter a parse tree produced by athenasqlParser#joinCriteria.
	enterJoinCriteria(ctx) {
	}

	// Exit a parse tree produced by athenasqlParser#joinCriteria.
	exitJoinCriteria(ctx) {
	}


	// Enter a parse tree produced by athenasqlParser#sampledRelation.
	enterSampledRelation(ctx) {
	}

	// Exit a parse tree produced by athenasqlParser#sampledRelation.
	exitSampledRelation(ctx) {
	}


	// Enter a parse tree produced by athenasqlParser#sampleType.
	enterSampleType(ctx) {
	}

	// Exit a parse tree produced by athenasqlParser#sampleType.
	exitSampleType(ctx) {
	}


	// Enter a parse tree produced by athenasqlParser#aliasedRelation.
	enterAliasedRelation(ctx) {
	}

	// Exit a parse tree produced by athenasqlParser#aliasedRelation.
	exitAliasedRelation(ctx) {
	}


	// Enter a parse tree produced by athenasqlParser#columnAliases.
	enterColumnAliases(ctx) {
	}

	// Exit a parse tree produced by athenasqlParser#columnAliases.
	exitColumnAliases(ctx) {
	}


	// Enter a parse tree produced by athenasqlParser#tableName.
	enterTableName(ctx) {
	}

	// Exit a parse tree produced by athenasqlParser#tableName.
	exitTableName(ctx) {
	}


	// Enter a parse tree produced by athenasqlParser#subqueryRelation.
	enterSubqueryRelation(ctx) {
	}

	// Exit a parse tree produced by athenasqlParser#subqueryRelation.
	exitSubqueryRelation(ctx) {
	}


	// Enter a parse tree produced by athenasqlParser#unnest.
	enterUnnest(ctx) {
	}

	// Exit a parse tree produced by athenasqlParser#unnest.
	exitUnnest(ctx) {
	}


	// Enter a parse tree produced by athenasqlParser#parenthesizedRelation.
	enterParenthesizedRelation(ctx) {
	}

	// Exit a parse tree produced by athenasqlParser#parenthesizedRelation.
	exitParenthesizedRelation(ctx) {
	}


	// Enter a parse tree produced by athenasqlParser#tableReference.
	enterTableReference(ctx) {
	}

	// Exit a parse tree produced by athenasqlParser#tableReference.
	exitTableReference(ctx) {
		if (ctx && ctx.children) {
			ctx.children.map(
			  /**
			   * @param {any} child -
			   */
			  (child) => {
				const tablename = child.getText();
				this.tables.add(tablename);
			  }
			);
		  }
	}


	// Enter a parse tree produced by athenasqlParser#expression.
	enterExpression(ctx) {
	}

	// Exit a parse tree produced by athenasqlParser#expression.
	exitExpression(ctx) {
	}


	// Enter a parse tree produced by athenasqlParser#logicalNot.
	enterLogicalNot(ctx) {
	}

	// Exit a parse tree produced by athenasqlParser#logicalNot.
	exitLogicalNot(ctx) {
	}


	// Enter a parse tree produced by athenasqlParser#booleanDefault.
	enterBooleanDefault(ctx) {
	}

	// Exit a parse tree produced by athenasqlParser#booleanDefault.
	exitBooleanDefault(ctx) {
	}


	// Enter a parse tree produced by athenasqlParser#logicalBinary.
	enterLogicalBinary(ctx) {
	}

	// Exit a parse tree produced by athenasqlParser#logicalBinary.
	exitLogicalBinary(ctx) {
	}


	// Enter a parse tree produced by athenasqlParser#predicated.
	enterPredicated(ctx) {
	}

	// Exit a parse tree produced by athenasqlParser#predicated.
	exitPredicated(ctx) {
	}


	// Enter a parse tree produced by athenasqlParser#comparison.
	enterComparison(ctx) {
	}

	// Exit a parse tree produced by athenasqlParser#comparison.
	exitComparison(ctx) {
	}


	// Enter a parse tree produced by athenasqlParser#quantifiedComparison.
	enterQuantifiedComparison(ctx) {
	}

	// Exit a parse tree produced by athenasqlParser#quantifiedComparison.
	exitQuantifiedComparison(ctx) {
	}


	// Enter a parse tree produced by athenasqlParser#between.
	enterBetween(ctx) {
	}

	// Exit a parse tree produced by athenasqlParser#between.
	exitBetween(ctx) {
	}


	// Enter a parse tree produced by athenasqlParser#inList.
	enterInList(ctx) {
	}

	// Exit a parse tree produced by athenasqlParser#inList.
	exitInList(ctx) {
	}


	// Enter a parse tree produced by athenasqlParser#inSubquery.
	enterInSubquery(ctx) {
	}

	// Exit a parse tree produced by athenasqlParser#inSubquery.
	exitInSubquery(ctx) {
	}


	// Enter a parse tree produced by athenasqlParser#like.
	enterLike(ctx) {
	}

	// Exit a parse tree produced by athenasqlParser#like.
	exitLike(ctx) {
	}


	// Enter a parse tree produced by athenasqlParser#nullPredicate.
	enterNullPredicate(ctx) {
	}

	// Exit a parse tree produced by athenasqlParser#nullPredicate.
	exitNullPredicate(ctx) {
	}


	// Enter a parse tree produced by athenasqlParser#distinctFrom.
	enterDistinctFrom(ctx) {
	}

	// Exit a parse tree produced by athenasqlParser#distinctFrom.
	exitDistinctFrom(ctx) {
	}


	// Enter a parse tree produced by athenasqlParser#valueExpressionDefault.
	enterValueExpressionDefault(ctx) {
	}

	// Exit a parse tree produced by athenasqlParser#valueExpressionDefault.
	exitValueExpressionDefault(ctx) {
	}


	// Enter a parse tree produced by athenasqlParser#concatenation.
	enterConcatenation(ctx) {
	}

	// Exit a parse tree produced by athenasqlParser#concatenation.
	exitConcatenation(ctx) {
	}


	// Enter a parse tree produced by athenasqlParser#arithmeticBinary.
	enterArithmeticBinary(ctx) {
	}

	// Exit a parse tree produced by athenasqlParser#arithmeticBinary.
	exitArithmeticBinary(ctx) {
	}


	// Enter a parse tree produced by athenasqlParser#arithmeticUnary.
	enterArithmeticUnary(ctx) {
	}

	// Exit a parse tree produced by athenasqlParser#arithmeticUnary.
	exitArithmeticUnary(ctx) {
	}


	// Enter a parse tree produced by athenasqlParser#atTimeZone.
	enterAtTimeZone(ctx) {
	}

	// Exit a parse tree produced by athenasqlParser#atTimeZone.
	exitAtTimeZone(ctx) {
	}


	// Enter a parse tree produced by athenasqlParser#columnReference.
	enterColumnReference(ctx) {
	}

	// Exit a parse tree produced by athenasqlParser#columnReference.
	exitColumnReference(ctx) {
		if (ctx && ctx.children) {
			ctx.children.map(
			  /**
			   * @param {any} child -
			   */
			  (child) => {
				const columnName = child.getText();
				if (this.currentSelectColumns) this.currentSelectColumns.add(columnName)
				this.columns.add(columnName);
			  }
			);
		  }
	}


	// Enter a parse tree produced by athenasqlParser#dereference.
	enterDereference(ctx) {
	}

	// Exit a parse tree produced by athenasqlParser#dereference.
	exitDereference(ctx) {
	}


	// Enter a parse tree produced by athenasqlParser#typeConstructor.
	enterTypeConstructor(ctx) {
	}

	// Exit a parse tree produced by athenasqlParser#typeConstructor.
	exitTypeConstructor(ctx) {
	}


	// Enter a parse tree produced by athenasqlParser#specialDateTimeFunction.
	enterSpecialDateTimeFunction(ctx) {
	}

	// Exit a parse tree produced by athenasqlParser#specialDateTimeFunction.
	exitSpecialDateTimeFunction(ctx) {
	}


	// Enter a parse tree produced by athenasqlParser#substring.
	enterSubstring(ctx) {
	}

	// Exit a parse tree produced by athenasqlParser#substring.
	exitSubstring(ctx) {
	}


	// Enter a parse tree produced by athenasqlParser#cast.
	enterCast(ctx) {
	}

	// Exit a parse tree produced by athenasqlParser#cast.
	exitCast(ctx) {
	}


	// Enter a parse tree produced by athenasqlParser#lambda.
	enterLambda(ctx) {
	}

	// Exit a parse tree produced by athenasqlParser#lambda.
	exitLambda(ctx) {
	}


	// Enter a parse tree produced by athenasqlParser#parenthesizedExpression.
	enterParenthesizedExpression(ctx) {
	}

	// Exit a parse tree produced by athenasqlParser#parenthesizedExpression.
	exitParenthesizedExpression(ctx) {
	}


	// Enter a parse tree produced by athenasqlParser#parameter.
	enterParameter(ctx) {
	}

	// Exit a parse tree produced by athenasqlParser#parameter.
	exitParameter(ctx) {
	}


	// Enter a parse tree produced by athenasqlParser#normalize.
	enterNormalize(ctx) {
	}

	// Exit a parse tree produced by athenasqlParser#normalize.
	exitNormalize(ctx) {
	}


	// Enter a parse tree produced by athenasqlParser#intervalLiteral.
	enterIntervalLiteral(ctx) {
	}

	// Exit a parse tree produced by athenasqlParser#intervalLiteral.
	exitIntervalLiteral(ctx) {
	}


	// Enter a parse tree produced by athenasqlParser#numericLiteral.
	enterNumericLiteral(ctx) {
	}

	// Exit a parse tree produced by athenasqlParser#numericLiteral.
	exitNumericLiteral(ctx) {
	}


	// Enter a parse tree produced by athenasqlParser#booleanLiteral.
	enterBooleanLiteral(ctx) {
	}

	// Exit a parse tree produced by athenasqlParser#booleanLiteral.
	exitBooleanLiteral(ctx) {
	}


	// Enter a parse tree produced by athenasqlParser#simpleCase.
	enterSimpleCase(ctx) {
	}

	// Exit a parse tree produced by athenasqlParser#simpleCase.
	exitSimpleCase(ctx) {
	}


	// Enter a parse tree produced by athenasqlParser#nullLiteral.
	enterNullLiteral(ctx) {
	}

	// Exit a parse tree produced by athenasqlParser#nullLiteral.
	exitNullLiteral(ctx) {
	}


	// Enter a parse tree produced by athenasqlParser#rowConstructor.
	enterRowConstructor(ctx) {
	}

	// Exit a parse tree produced by athenasqlParser#rowConstructor.
	exitRowConstructor(ctx) {
	}


	// Enter a parse tree produced by athenasqlParser#subscript.
	enterSubscript(ctx) {
	}

	// Exit a parse tree produced by athenasqlParser#subscript.
	exitSubscript(ctx) {
	}


	// Enter a parse tree produced by athenasqlParser#subqueryExpression.
	enterSubqueryExpression(ctx) {
	}

	// Exit a parse tree produced by athenasqlParser#subqueryExpression.
	exitSubqueryExpression(ctx) {
	}


	// Enter a parse tree produced by athenasqlParser#binaryLiteral.
	enterBinaryLiteral(ctx) {
	}

	// Exit a parse tree produced by athenasqlParser#binaryLiteral.
	exitBinaryLiteral(ctx) {
	}


	// Enter a parse tree produced by athenasqlParser#extract.
	enterExtract(ctx) {
	}

	// Exit a parse tree produced by athenasqlParser#extract.
	exitExtract(ctx) {
	}


	// Enter a parse tree produced by athenasqlParser#stringLiteral.
	enterStringLiteral(ctx) {
	}

	// Exit a parse tree produced by athenasqlParser#stringLiteral.
	exitStringLiteral(ctx) {
	}


	// Enter a parse tree produced by athenasqlParser#arrayConstructor.
	enterArrayConstructor(ctx) {
	}

	// Exit a parse tree produced by athenasqlParser#arrayConstructor.
	exitArrayConstructor(ctx) {
	}


	// Enter a parse tree produced by athenasqlParser#functionCall.
	enterFunctionCall(ctx) {
	}

	// Exit a parse tree produced by athenasqlParser#functionCall.
	exitFunctionCall(ctx) {
	}


	// Enter a parse tree produced by athenasqlParser#exists.
	enterExists(ctx) {
	}

	// Exit a parse tree produced by athenasqlParser#exists.
	exitExists(ctx) {
	}


	// Enter a parse tree produced by athenasqlParser#position.
	enterPosition(ctx) {
	}

	// Exit a parse tree produced by athenasqlParser#position.
	exitPosition(ctx) {
	}


	// Enter a parse tree produced by athenasqlParser#searchedCase.
	enterSearchedCase(ctx) {
	}

	// Exit a parse tree produced by athenasqlParser#searchedCase.
	exitSearchedCase(ctx) {
	}


	// Enter a parse tree produced by athenasqlParser#columnName.
	enterColumnName(ctx) {
	}

	// Exit a parse tree produced by athenasqlParser#columnName.
	exitColumnName(ctx) {
	}


	// Enter a parse tree produced by athenasqlParser#timeZoneInterval.
	enterTimeZoneInterval(ctx) {
	}

	// Exit a parse tree produced by athenasqlParser#timeZoneInterval.
	exitTimeZoneInterval(ctx) {
	}


	// Enter a parse tree produced by athenasqlParser#timeZoneString.
	enterTimeZoneString(ctx) {
	}

	// Exit a parse tree produced by athenasqlParser#timeZoneString.
	exitTimeZoneString(ctx) {
	}


	// Enter a parse tree produced by athenasqlParser#comparisonOperator.
	enterComparisonOperator(ctx) {
	}

	// Exit a parse tree produced by athenasqlParser#comparisonOperator.
	exitComparisonOperator(ctx) {
	}


	// Enter a parse tree produced by athenasqlParser#comparisonQuantifier.
	enterComparisonQuantifier(ctx) {
	}

	// Exit a parse tree produced by athenasqlParser#comparisonQuantifier.
	exitComparisonQuantifier(ctx) {
	}


	// Enter a parse tree produced by athenasqlParser#booleanValue.
	enterBooleanValue(ctx) {
	}

	// Exit a parse tree produced by athenasqlParser#booleanValue.
	exitBooleanValue(ctx) {
	}


	// Enter a parse tree produced by athenasqlParser#interval.
	enterInterval(ctx) {
	}

	// Exit a parse tree produced by athenasqlParser#interval.
	exitInterval(ctx) {
	}


	// Enter a parse tree produced by athenasqlParser#intervalField.
	enterIntervalField(ctx) {
	}

	// Exit a parse tree produced by athenasqlParser#intervalField.
	exitIntervalField(ctx) {
	}


	// Enter a parse tree produced by athenasqlParser#type.
	enterType(ctx) {
	}

	// Exit a parse tree produced by athenasqlParser#type.
	exitType(ctx) {
	}


	// Enter a parse tree produced by athenasqlParser#typeParameter.
	enterTypeParameter(ctx) {
	}

	// Exit a parse tree produced by athenasqlParser#typeParameter.
	exitTypeParameter(ctx) {
	}


	// Enter a parse tree produced by athenasqlParser#baseType.
	enterBaseType(ctx) {
	}

	// Exit a parse tree produced by athenasqlParser#baseType.
	exitBaseType(ctx) {
	}


	// Enter a parse tree produced by athenasqlParser#whenClause.
	enterWhenClause(ctx) {
	}

	// Exit a parse tree produced by athenasqlParser#whenClause.
	exitWhenClause(ctx) {
	}


	// Enter a parse tree produced by athenasqlParser#filter.
	enterFilter(ctx) {
	}

	// Exit a parse tree produced by athenasqlParser#filter.
	exitFilter(ctx) {
	}


	// Enter a parse tree produced by athenasqlParser#over.
	enterOver(ctx) {
	}

	// Exit a parse tree produced by athenasqlParser#over.
	exitOver(ctx) {
	}


	// Enter a parse tree produced by athenasqlParser#windowFrame.
	enterWindowFrame(ctx) {
	}

	// Exit a parse tree produced by athenasqlParser#windowFrame.
	exitWindowFrame(ctx) {
	}


	// Enter a parse tree produced by athenasqlParser#unboundedFrame.
	enterUnboundedFrame(ctx) {
	}

	// Exit a parse tree produced by athenasqlParser#unboundedFrame.
	exitUnboundedFrame(ctx) {
	}


	// Enter a parse tree produced by athenasqlParser#currentRowBound.
	enterCurrentRowBound(ctx) {
	}

	// Exit a parse tree produced by athenasqlParser#currentRowBound.
	exitCurrentRowBound(ctx) {
	}


	// Enter a parse tree produced by athenasqlParser#boundedFrame.
	enterBoundedFrame(ctx) {
	}

	// Exit a parse tree produced by athenasqlParser#boundedFrame.
	exitBoundedFrame(ctx) {
	}


	// Enter a parse tree produced by athenasqlParser#explainFormat.
	enterExplainFormat(ctx) {
	}

	// Exit a parse tree produced by athenasqlParser#explainFormat.
	exitExplainFormat(ctx) {
	}


	// Enter a parse tree produced by athenasqlParser#explainType.
	enterExplainType(ctx) {
	}

	// Exit a parse tree produced by athenasqlParser#explainType.
	exitExplainType(ctx) {
	}


	// Enter a parse tree produced by athenasqlParser#isolationLevel.
	enterIsolationLevel(ctx) {
	}

	// Exit a parse tree produced by athenasqlParser#isolationLevel.
	exitIsolationLevel(ctx) {
	}


	// Enter a parse tree produced by athenasqlParser#transactionAccessMode.
	enterTransactionAccessMode(ctx) {
	}

	// Exit a parse tree produced by athenasqlParser#transactionAccessMode.
	exitTransactionAccessMode(ctx) {
	}


	// Enter a parse tree produced by athenasqlParser#readUncommitted.
	enterReadUncommitted(ctx) {
	}

	// Exit a parse tree produced by athenasqlParser#readUncommitted.
	exitReadUncommitted(ctx) {
	}


	// Enter a parse tree produced by athenasqlParser#readCommitted.
	enterReadCommitted(ctx) {
	}

	// Exit a parse tree produced by athenasqlParser#readCommitted.
	exitReadCommitted(ctx) {
	}


	// Enter a parse tree produced by athenasqlParser#repeatableRead.
	enterRepeatableRead(ctx) {
	}

	// Exit a parse tree produced by athenasqlParser#repeatableRead.
	exitRepeatableRead(ctx) {
	}


	// Enter a parse tree produced by athenasqlParser#serializable.
	enterSerializable(ctx) {
	}

	// Exit a parse tree produced by athenasqlParser#serializable.
	exitSerializable(ctx) {
	}


	// Enter a parse tree produced by athenasqlParser#positionalArgument.
	enterPositionalArgument(ctx) {
	}

	// Exit a parse tree produced by athenasqlParser#positionalArgument.
	exitPositionalArgument(ctx) {
	}


	// Enter a parse tree produced by athenasqlParser#namedArgument.
	enterNamedArgument(ctx) {
	}

	// Exit a parse tree produced by athenasqlParser#namedArgument.
	exitNamedArgument(ctx) {
	}


	// Enter a parse tree produced by athenasqlParser#privilege.
	enterPrivilege(ctx) {
	}

	// Exit a parse tree produced by athenasqlParser#privilege.
	exitPrivilege(ctx) {
	}


	// Enter a parse tree produced by athenasqlParser#qualifiedName.
	enterQualifiedName(ctx) {
	}

	// Exit a parse tree produced by athenasqlParser#qualifiedName.
	exitQualifiedName(ctx) {
	}


	// Enter a parse tree produced by athenasqlParser#unquotedIdentifier.
	enterUnquotedIdentifier(ctx) {
	}

	// Exit a parse tree produced by athenasqlParser#unquotedIdentifier.
	exitUnquotedIdentifier(ctx) {
		if (ctx && ctx.children) {
			ctx.children.map(
			  /**
			   * @param {any} child -
			   */
			  (child) => {
				const identifier = child.getText();
				this.lastIdentifier = identifier;
			  }
			);
		  }
	}


	// Enter a parse tree produced by athenasqlParser#quotedIdentifierAlternative.
	enterQuotedIdentifierAlternative(ctx) {
	}

	// Exit a parse tree produced by athenasqlParser#quotedIdentifierAlternative.
	exitQuotedIdentifierAlternative(ctx) {
	}


	// Enter a parse tree produced by athenasqlParser#backQuotedIdentifier.
	enterBackQuotedIdentifier(ctx) {
	}

	// Exit a parse tree produced by athenasqlParser#backQuotedIdentifier.
	exitBackQuotedIdentifier(ctx) {
	}


	// Enter a parse tree produced by athenasqlParser#digitIdentifier.
	enterDigitIdentifier(ctx) {
	}

	// Exit a parse tree produced by athenasqlParser#digitIdentifier.
	exitDigitIdentifier(ctx) {
	}


	// Enter a parse tree produced by athenasqlParser#quotedIdentifier.
	enterQuotedIdentifier(ctx) {
	}

	// Exit a parse tree produced by athenasqlParser#quotedIdentifier.
	exitQuotedIdentifier(ctx) {
	}


	// Enter a parse tree produced by athenasqlParser#decimalLiteral.
	enterDecimalLiteral(ctx) {
	}

	// Exit a parse tree produced by athenasqlParser#decimalLiteral.
	exitDecimalLiteral(ctx) {
	}


	// Enter a parse tree produced by athenasqlParser#integerLiteral.
	enterIntegerLiteral(ctx) {
	}

	// Exit a parse tree produced by athenasqlParser#integerLiteral.
	exitIntegerLiteral(ctx) {
	}


	// Enter a parse tree produced by athenasqlParser#nonReserved.
	enterNonReserved(ctx) {
	}

	// Exit a parse tree produced by athenasqlParser#nonReserved.
	exitNonReserved(ctx) {
	}


	// Enter a parse tree produced by athenasqlParser#normalForm.
	enterNormalForm(ctx) {
	}

	// Exit a parse tree produced by athenasqlParser#normalForm.
	exitNormalForm(ctx) {
	}



}


module.exports = athenasqlListener
