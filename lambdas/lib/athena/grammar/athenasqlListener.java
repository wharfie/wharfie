// Generated from /Users/Dev/Documents/workspace/wharfie/wharfie/lambdas/lib/athena/grammar/athenasql.g4 by ANTLR 4.8
import org.antlr.v4.runtime.tree.ParseTreeListener;

/**
 * This interface defines a complete listener for a parse tree produced by
 * {@link athenasqlParser}.
 */
public interface athenasqlListener extends ParseTreeListener {
	/**
	 * Enter a parse tree produced by {@link athenasqlParser#program}.
	 * @param ctx the parse tree
	 */
	void enterProgram(athenasqlParser.ProgramContext ctx);
	/**
	 * Exit a parse tree produced by {@link athenasqlParser#program}.
	 * @param ctx the parse tree
	 */
	void exitProgram(athenasqlParser.ProgramContext ctx);
	/**
	 * Enter a parse tree produced by {@link athenasqlParser#singleStatement}.
	 * @param ctx the parse tree
	 */
	void enterSingleStatement(athenasqlParser.SingleStatementContext ctx);
	/**
	 * Exit a parse tree produced by {@link athenasqlParser#singleStatement}.
	 * @param ctx the parse tree
	 */
	void exitSingleStatement(athenasqlParser.SingleStatementContext ctx);
	/**
	 * Enter a parse tree produced by {@link athenasqlParser#singleExpression}.
	 * @param ctx the parse tree
	 */
	void enterSingleExpression(athenasqlParser.SingleExpressionContext ctx);
	/**
	 * Exit a parse tree produced by {@link athenasqlParser#singleExpression}.
	 * @param ctx the parse tree
	 */
	void exitSingleExpression(athenasqlParser.SingleExpressionContext ctx);
	/**
	 * Enter a parse tree produced by the {@code statementDefault}
	 * labeled alternative in {@link athenasqlParser#statement}.
	 * @param ctx the parse tree
	 */
	void enterStatementDefault(athenasqlParser.StatementDefaultContext ctx);
	/**
	 * Exit a parse tree produced by the {@code statementDefault}
	 * labeled alternative in {@link athenasqlParser#statement}.
	 * @param ctx the parse tree
	 */
	void exitStatementDefault(athenasqlParser.StatementDefaultContext ctx);
	/**
	 * Enter a parse tree produced by the {@code use}
	 * labeled alternative in {@link athenasqlParser#statement}.
	 * @param ctx the parse tree
	 */
	void enterUse(athenasqlParser.UseContext ctx);
	/**
	 * Exit a parse tree produced by the {@code use}
	 * labeled alternative in {@link athenasqlParser#statement}.
	 * @param ctx the parse tree
	 */
	void exitUse(athenasqlParser.UseContext ctx);
	/**
	 * Enter a parse tree produced by the {@code createSchema}
	 * labeled alternative in {@link athenasqlParser#statement}.
	 * @param ctx the parse tree
	 */
	void enterCreateSchema(athenasqlParser.CreateSchemaContext ctx);
	/**
	 * Exit a parse tree produced by the {@code createSchema}
	 * labeled alternative in {@link athenasqlParser#statement}.
	 * @param ctx the parse tree
	 */
	void exitCreateSchema(athenasqlParser.CreateSchemaContext ctx);
	/**
	 * Enter a parse tree produced by the {@code dropSchema}
	 * labeled alternative in {@link athenasqlParser#statement}.
	 * @param ctx the parse tree
	 */
	void enterDropSchema(athenasqlParser.DropSchemaContext ctx);
	/**
	 * Exit a parse tree produced by the {@code dropSchema}
	 * labeled alternative in {@link athenasqlParser#statement}.
	 * @param ctx the parse tree
	 */
	void exitDropSchema(athenasqlParser.DropSchemaContext ctx);
	/**
	 * Enter a parse tree produced by the {@code renameSchema}
	 * labeled alternative in {@link athenasqlParser#statement}.
	 * @param ctx the parse tree
	 */
	void enterRenameSchema(athenasqlParser.RenameSchemaContext ctx);
	/**
	 * Exit a parse tree produced by the {@code renameSchema}
	 * labeled alternative in {@link athenasqlParser#statement}.
	 * @param ctx the parse tree
	 */
	void exitRenameSchema(athenasqlParser.RenameSchemaContext ctx);
	/**
	 * Enter a parse tree produced by the {@code createTableAsSelect}
	 * labeled alternative in {@link athenasqlParser#statement}.
	 * @param ctx the parse tree
	 */
	void enterCreateTableAsSelect(athenasqlParser.CreateTableAsSelectContext ctx);
	/**
	 * Exit a parse tree produced by the {@code createTableAsSelect}
	 * labeled alternative in {@link athenasqlParser#statement}.
	 * @param ctx the parse tree
	 */
	void exitCreateTableAsSelect(athenasqlParser.CreateTableAsSelectContext ctx);
	/**
	 * Enter a parse tree produced by the {@code createTable}
	 * labeled alternative in {@link athenasqlParser#statement}.
	 * @param ctx the parse tree
	 */
	void enterCreateTable(athenasqlParser.CreateTableContext ctx);
	/**
	 * Exit a parse tree produced by the {@code createTable}
	 * labeled alternative in {@link athenasqlParser#statement}.
	 * @param ctx the parse tree
	 */
	void exitCreateTable(athenasqlParser.CreateTableContext ctx);
	/**
	 * Enter a parse tree produced by the {@code dropTable}
	 * labeled alternative in {@link athenasqlParser#statement}.
	 * @param ctx the parse tree
	 */
	void enterDropTable(athenasqlParser.DropTableContext ctx);
	/**
	 * Exit a parse tree produced by the {@code dropTable}
	 * labeled alternative in {@link athenasqlParser#statement}.
	 * @param ctx the parse tree
	 */
	void exitDropTable(athenasqlParser.DropTableContext ctx);
	/**
	 * Enter a parse tree produced by the {@code insertInto}
	 * labeled alternative in {@link athenasqlParser#statement}.
	 * @param ctx the parse tree
	 */
	void enterInsertInto(athenasqlParser.InsertIntoContext ctx);
	/**
	 * Exit a parse tree produced by the {@code insertInto}
	 * labeled alternative in {@link athenasqlParser#statement}.
	 * @param ctx the parse tree
	 */
	void exitInsertInto(athenasqlParser.InsertIntoContext ctx);
	/**
	 * Enter a parse tree produced by the {@code delete}
	 * labeled alternative in {@link athenasqlParser#statement}.
	 * @param ctx the parse tree
	 */
	void enterDelete(athenasqlParser.DeleteContext ctx);
	/**
	 * Exit a parse tree produced by the {@code delete}
	 * labeled alternative in {@link athenasqlParser#statement}.
	 * @param ctx the parse tree
	 */
	void exitDelete(athenasqlParser.DeleteContext ctx);
	/**
	 * Enter a parse tree produced by the {@code renameTable}
	 * labeled alternative in {@link athenasqlParser#statement}.
	 * @param ctx the parse tree
	 */
	void enterRenameTable(athenasqlParser.RenameTableContext ctx);
	/**
	 * Exit a parse tree produced by the {@code renameTable}
	 * labeled alternative in {@link athenasqlParser#statement}.
	 * @param ctx the parse tree
	 */
	void exitRenameTable(athenasqlParser.RenameTableContext ctx);
	/**
	 * Enter a parse tree produced by the {@code renameColumn}
	 * labeled alternative in {@link athenasqlParser#statement}.
	 * @param ctx the parse tree
	 */
	void enterRenameColumn(athenasqlParser.RenameColumnContext ctx);
	/**
	 * Exit a parse tree produced by the {@code renameColumn}
	 * labeled alternative in {@link athenasqlParser#statement}.
	 * @param ctx the parse tree
	 */
	void exitRenameColumn(athenasqlParser.RenameColumnContext ctx);
	/**
	 * Enter a parse tree produced by the {@code addColumn}
	 * labeled alternative in {@link athenasqlParser#statement}.
	 * @param ctx the parse tree
	 */
	void enterAddColumn(athenasqlParser.AddColumnContext ctx);
	/**
	 * Exit a parse tree produced by the {@code addColumn}
	 * labeled alternative in {@link athenasqlParser#statement}.
	 * @param ctx the parse tree
	 */
	void exitAddColumn(athenasqlParser.AddColumnContext ctx);
	/**
	 * Enter a parse tree produced by the {@code createView}
	 * labeled alternative in {@link athenasqlParser#statement}.
	 * @param ctx the parse tree
	 */
	void enterCreateView(athenasqlParser.CreateViewContext ctx);
	/**
	 * Exit a parse tree produced by the {@code createView}
	 * labeled alternative in {@link athenasqlParser#statement}.
	 * @param ctx the parse tree
	 */
	void exitCreateView(athenasqlParser.CreateViewContext ctx);
	/**
	 * Enter a parse tree produced by the {@code dropView}
	 * labeled alternative in {@link athenasqlParser#statement}.
	 * @param ctx the parse tree
	 */
	void enterDropView(athenasqlParser.DropViewContext ctx);
	/**
	 * Exit a parse tree produced by the {@code dropView}
	 * labeled alternative in {@link athenasqlParser#statement}.
	 * @param ctx the parse tree
	 */
	void exitDropView(athenasqlParser.DropViewContext ctx);
	/**
	 * Enter a parse tree produced by the {@code call}
	 * labeled alternative in {@link athenasqlParser#statement}.
	 * @param ctx the parse tree
	 */
	void enterCall(athenasqlParser.CallContext ctx);
	/**
	 * Exit a parse tree produced by the {@code call}
	 * labeled alternative in {@link athenasqlParser#statement}.
	 * @param ctx the parse tree
	 */
	void exitCall(athenasqlParser.CallContext ctx);
	/**
	 * Enter a parse tree produced by the {@code grant}
	 * labeled alternative in {@link athenasqlParser#statement}.
	 * @param ctx the parse tree
	 */
	void enterGrant(athenasqlParser.GrantContext ctx);
	/**
	 * Exit a parse tree produced by the {@code grant}
	 * labeled alternative in {@link athenasqlParser#statement}.
	 * @param ctx the parse tree
	 */
	void exitGrant(athenasqlParser.GrantContext ctx);
	/**
	 * Enter a parse tree produced by the {@code revoke}
	 * labeled alternative in {@link athenasqlParser#statement}.
	 * @param ctx the parse tree
	 */
	void enterRevoke(athenasqlParser.RevokeContext ctx);
	/**
	 * Exit a parse tree produced by the {@code revoke}
	 * labeled alternative in {@link athenasqlParser#statement}.
	 * @param ctx the parse tree
	 */
	void exitRevoke(athenasqlParser.RevokeContext ctx);
	/**
	 * Enter a parse tree produced by the {@code explain}
	 * labeled alternative in {@link athenasqlParser#statement}.
	 * @param ctx the parse tree
	 */
	void enterExplain(athenasqlParser.ExplainContext ctx);
	/**
	 * Exit a parse tree produced by the {@code explain}
	 * labeled alternative in {@link athenasqlParser#statement}.
	 * @param ctx the parse tree
	 */
	void exitExplain(athenasqlParser.ExplainContext ctx);
	/**
	 * Enter a parse tree produced by the {@code showCreateTable}
	 * labeled alternative in {@link athenasqlParser#statement}.
	 * @param ctx the parse tree
	 */
	void enterShowCreateTable(athenasqlParser.ShowCreateTableContext ctx);
	/**
	 * Exit a parse tree produced by the {@code showCreateTable}
	 * labeled alternative in {@link athenasqlParser#statement}.
	 * @param ctx the parse tree
	 */
	void exitShowCreateTable(athenasqlParser.ShowCreateTableContext ctx);
	/**
	 * Enter a parse tree produced by the {@code showCreateView}
	 * labeled alternative in {@link athenasqlParser#statement}.
	 * @param ctx the parse tree
	 */
	void enterShowCreateView(athenasqlParser.ShowCreateViewContext ctx);
	/**
	 * Exit a parse tree produced by the {@code showCreateView}
	 * labeled alternative in {@link athenasqlParser#statement}.
	 * @param ctx the parse tree
	 */
	void exitShowCreateView(athenasqlParser.ShowCreateViewContext ctx);
	/**
	 * Enter a parse tree produced by the {@code showTables}
	 * labeled alternative in {@link athenasqlParser#statement}.
	 * @param ctx the parse tree
	 */
	void enterShowTables(athenasqlParser.ShowTablesContext ctx);
	/**
	 * Exit a parse tree produced by the {@code showTables}
	 * labeled alternative in {@link athenasqlParser#statement}.
	 * @param ctx the parse tree
	 */
	void exitShowTables(athenasqlParser.ShowTablesContext ctx);
	/**
	 * Enter a parse tree produced by the {@code showSchemas}
	 * labeled alternative in {@link athenasqlParser#statement}.
	 * @param ctx the parse tree
	 */
	void enterShowSchemas(athenasqlParser.ShowSchemasContext ctx);
	/**
	 * Exit a parse tree produced by the {@code showSchemas}
	 * labeled alternative in {@link athenasqlParser#statement}.
	 * @param ctx the parse tree
	 */
	void exitShowSchemas(athenasqlParser.ShowSchemasContext ctx);
	/**
	 * Enter a parse tree produced by the {@code showCatalogs}
	 * labeled alternative in {@link athenasqlParser#statement}.
	 * @param ctx the parse tree
	 */
	void enterShowCatalogs(athenasqlParser.ShowCatalogsContext ctx);
	/**
	 * Exit a parse tree produced by the {@code showCatalogs}
	 * labeled alternative in {@link athenasqlParser#statement}.
	 * @param ctx the parse tree
	 */
	void exitShowCatalogs(athenasqlParser.ShowCatalogsContext ctx);
	/**
	 * Enter a parse tree produced by the {@code showColumns}
	 * labeled alternative in {@link athenasqlParser#statement}.
	 * @param ctx the parse tree
	 */
	void enterShowColumns(athenasqlParser.ShowColumnsContext ctx);
	/**
	 * Exit a parse tree produced by the {@code showColumns}
	 * labeled alternative in {@link athenasqlParser#statement}.
	 * @param ctx the parse tree
	 */
	void exitShowColumns(athenasqlParser.ShowColumnsContext ctx);
	/**
	 * Enter a parse tree produced by the {@code showFunctions}
	 * labeled alternative in {@link athenasqlParser#statement}.
	 * @param ctx the parse tree
	 */
	void enterShowFunctions(athenasqlParser.ShowFunctionsContext ctx);
	/**
	 * Exit a parse tree produced by the {@code showFunctions}
	 * labeled alternative in {@link athenasqlParser#statement}.
	 * @param ctx the parse tree
	 */
	void exitShowFunctions(athenasqlParser.ShowFunctionsContext ctx);
	/**
	 * Enter a parse tree produced by the {@code showSession}
	 * labeled alternative in {@link athenasqlParser#statement}.
	 * @param ctx the parse tree
	 */
	void enterShowSession(athenasqlParser.ShowSessionContext ctx);
	/**
	 * Exit a parse tree produced by the {@code showSession}
	 * labeled alternative in {@link athenasqlParser#statement}.
	 * @param ctx the parse tree
	 */
	void exitShowSession(athenasqlParser.ShowSessionContext ctx);
	/**
	 * Enter a parse tree produced by the {@code setSession}
	 * labeled alternative in {@link athenasqlParser#statement}.
	 * @param ctx the parse tree
	 */
	void enterSetSession(athenasqlParser.SetSessionContext ctx);
	/**
	 * Exit a parse tree produced by the {@code setSession}
	 * labeled alternative in {@link athenasqlParser#statement}.
	 * @param ctx the parse tree
	 */
	void exitSetSession(athenasqlParser.SetSessionContext ctx);
	/**
	 * Enter a parse tree produced by the {@code resetSession}
	 * labeled alternative in {@link athenasqlParser#statement}.
	 * @param ctx the parse tree
	 */
	void enterResetSession(athenasqlParser.ResetSessionContext ctx);
	/**
	 * Exit a parse tree produced by the {@code resetSession}
	 * labeled alternative in {@link athenasqlParser#statement}.
	 * @param ctx the parse tree
	 */
	void exitResetSession(athenasqlParser.ResetSessionContext ctx);
	/**
	 * Enter a parse tree produced by the {@code startTransaction}
	 * labeled alternative in {@link athenasqlParser#statement}.
	 * @param ctx the parse tree
	 */
	void enterStartTransaction(athenasqlParser.StartTransactionContext ctx);
	/**
	 * Exit a parse tree produced by the {@code startTransaction}
	 * labeled alternative in {@link athenasqlParser#statement}.
	 * @param ctx the parse tree
	 */
	void exitStartTransaction(athenasqlParser.StartTransactionContext ctx);
	/**
	 * Enter a parse tree produced by the {@code commit}
	 * labeled alternative in {@link athenasqlParser#statement}.
	 * @param ctx the parse tree
	 */
	void enterCommit(athenasqlParser.CommitContext ctx);
	/**
	 * Exit a parse tree produced by the {@code commit}
	 * labeled alternative in {@link athenasqlParser#statement}.
	 * @param ctx the parse tree
	 */
	void exitCommit(athenasqlParser.CommitContext ctx);
	/**
	 * Enter a parse tree produced by the {@code rollback}
	 * labeled alternative in {@link athenasqlParser#statement}.
	 * @param ctx the parse tree
	 */
	void enterRollback(athenasqlParser.RollbackContext ctx);
	/**
	 * Exit a parse tree produced by the {@code rollback}
	 * labeled alternative in {@link athenasqlParser#statement}.
	 * @param ctx the parse tree
	 */
	void exitRollback(athenasqlParser.RollbackContext ctx);
	/**
	 * Enter a parse tree produced by the {@code showPartitions}
	 * labeled alternative in {@link athenasqlParser#statement}.
	 * @param ctx the parse tree
	 */
	void enterShowPartitions(athenasqlParser.ShowPartitionsContext ctx);
	/**
	 * Exit a parse tree produced by the {@code showPartitions}
	 * labeled alternative in {@link athenasqlParser#statement}.
	 * @param ctx the parse tree
	 */
	void exitShowPartitions(athenasqlParser.ShowPartitionsContext ctx);
	/**
	 * Enter a parse tree produced by the {@code prepare}
	 * labeled alternative in {@link athenasqlParser#statement}.
	 * @param ctx the parse tree
	 */
	void enterPrepare(athenasqlParser.PrepareContext ctx);
	/**
	 * Exit a parse tree produced by the {@code prepare}
	 * labeled alternative in {@link athenasqlParser#statement}.
	 * @param ctx the parse tree
	 */
	void exitPrepare(athenasqlParser.PrepareContext ctx);
	/**
	 * Enter a parse tree produced by the {@code deallocate}
	 * labeled alternative in {@link athenasqlParser#statement}.
	 * @param ctx the parse tree
	 */
	void enterDeallocate(athenasqlParser.DeallocateContext ctx);
	/**
	 * Exit a parse tree produced by the {@code deallocate}
	 * labeled alternative in {@link athenasqlParser#statement}.
	 * @param ctx the parse tree
	 */
	void exitDeallocate(athenasqlParser.DeallocateContext ctx);
	/**
	 * Enter a parse tree produced by the {@code execute}
	 * labeled alternative in {@link athenasqlParser#statement}.
	 * @param ctx the parse tree
	 */
	void enterExecute(athenasqlParser.ExecuteContext ctx);
	/**
	 * Exit a parse tree produced by the {@code execute}
	 * labeled alternative in {@link athenasqlParser#statement}.
	 * @param ctx the parse tree
	 */
	void exitExecute(athenasqlParser.ExecuteContext ctx);
	/**
	 * Enter a parse tree produced by the {@code describeInput}
	 * labeled alternative in {@link athenasqlParser#statement}.
	 * @param ctx the parse tree
	 */
	void enterDescribeInput(athenasqlParser.DescribeInputContext ctx);
	/**
	 * Exit a parse tree produced by the {@code describeInput}
	 * labeled alternative in {@link athenasqlParser#statement}.
	 * @param ctx the parse tree
	 */
	void exitDescribeInput(athenasqlParser.DescribeInputContext ctx);
	/**
	 * Enter a parse tree produced by the {@code describeOutput}
	 * labeled alternative in {@link athenasqlParser#statement}.
	 * @param ctx the parse tree
	 */
	void enterDescribeOutput(athenasqlParser.DescribeOutputContext ctx);
	/**
	 * Exit a parse tree produced by the {@code describeOutput}
	 * labeled alternative in {@link athenasqlParser#statement}.
	 * @param ctx the parse tree
	 */
	void exitDescribeOutput(athenasqlParser.DescribeOutputContext ctx);
	/**
	 * Enter a parse tree produced by {@link athenasqlParser#query}.
	 * @param ctx the parse tree
	 */
	void enterQuery(athenasqlParser.QueryContext ctx);
	/**
	 * Exit a parse tree produced by {@link athenasqlParser#query}.
	 * @param ctx the parse tree
	 */
	void exitQuery(athenasqlParser.QueryContext ctx);
	/**
	 * Enter a parse tree produced by {@link athenasqlParser#js_with}.
	 * @param ctx the parse tree
	 */
	void enterJs_with(athenasqlParser.Js_withContext ctx);
	/**
	 * Exit a parse tree produced by {@link athenasqlParser#js_with}.
	 * @param ctx the parse tree
	 */
	void exitJs_with(athenasqlParser.Js_withContext ctx);
	/**
	 * Enter a parse tree produced by {@link athenasqlParser#tableElement}.
	 * @param ctx the parse tree
	 */
	void enterTableElement(athenasqlParser.TableElementContext ctx);
	/**
	 * Exit a parse tree produced by {@link athenasqlParser#tableElement}.
	 * @param ctx the parse tree
	 */
	void exitTableElement(athenasqlParser.TableElementContext ctx);
	/**
	 * Enter a parse tree produced by {@link athenasqlParser#columnDefinition}.
	 * @param ctx the parse tree
	 */
	void enterColumnDefinition(athenasqlParser.ColumnDefinitionContext ctx);
	/**
	 * Exit a parse tree produced by {@link athenasqlParser#columnDefinition}.
	 * @param ctx the parse tree
	 */
	void exitColumnDefinition(athenasqlParser.ColumnDefinitionContext ctx);
	/**
	 * Enter a parse tree produced by {@link athenasqlParser#likeClause}.
	 * @param ctx the parse tree
	 */
	void enterLikeClause(athenasqlParser.LikeClauseContext ctx);
	/**
	 * Exit a parse tree produced by {@link athenasqlParser#likeClause}.
	 * @param ctx the parse tree
	 */
	void exitLikeClause(athenasqlParser.LikeClauseContext ctx);
	/**
	 * Enter a parse tree produced by {@link athenasqlParser#tableProperties}.
	 * @param ctx the parse tree
	 */
	void enterTableProperties(athenasqlParser.TablePropertiesContext ctx);
	/**
	 * Exit a parse tree produced by {@link athenasqlParser#tableProperties}.
	 * @param ctx the parse tree
	 */
	void exitTableProperties(athenasqlParser.TablePropertiesContext ctx);
	/**
	 * Enter a parse tree produced by {@link athenasqlParser#tableProperty}.
	 * @param ctx the parse tree
	 */
	void enterTableProperty(athenasqlParser.TablePropertyContext ctx);
	/**
	 * Exit a parse tree produced by {@link athenasqlParser#tableProperty}.
	 * @param ctx the parse tree
	 */
	void exitTableProperty(athenasqlParser.TablePropertyContext ctx);
	/**
	 * Enter a parse tree produced by {@link athenasqlParser#queryNoWith}.
	 * @param ctx the parse tree
	 */
	void enterQueryNoWith(athenasqlParser.QueryNoWithContext ctx);
	/**
	 * Exit a parse tree produced by {@link athenasqlParser#queryNoWith}.
	 * @param ctx the parse tree
	 */
	void exitQueryNoWith(athenasqlParser.QueryNoWithContext ctx);
	/**
	 * Enter a parse tree produced by the {@code queryTermDefault}
	 * labeled alternative in {@link athenasqlParser#queryTerm}.
	 * @param ctx the parse tree
	 */
	void enterQueryTermDefault(athenasqlParser.QueryTermDefaultContext ctx);
	/**
	 * Exit a parse tree produced by the {@code queryTermDefault}
	 * labeled alternative in {@link athenasqlParser#queryTerm}.
	 * @param ctx the parse tree
	 */
	void exitQueryTermDefault(athenasqlParser.QueryTermDefaultContext ctx);
	/**
	 * Enter a parse tree produced by the {@code setOperation}
	 * labeled alternative in {@link athenasqlParser#queryTerm}.
	 * @param ctx the parse tree
	 */
	void enterSetOperation(athenasqlParser.SetOperationContext ctx);
	/**
	 * Exit a parse tree produced by the {@code setOperation}
	 * labeled alternative in {@link athenasqlParser#queryTerm}.
	 * @param ctx the parse tree
	 */
	void exitSetOperation(athenasqlParser.SetOperationContext ctx);
	/**
	 * Enter a parse tree produced by the {@code queryPrimaryDefault}
	 * labeled alternative in {@link athenasqlParser#queryPrimary}.
	 * @param ctx the parse tree
	 */
	void enterQueryPrimaryDefault(athenasqlParser.QueryPrimaryDefaultContext ctx);
	/**
	 * Exit a parse tree produced by the {@code queryPrimaryDefault}
	 * labeled alternative in {@link athenasqlParser#queryPrimary}.
	 * @param ctx the parse tree
	 */
	void exitQueryPrimaryDefault(athenasqlParser.QueryPrimaryDefaultContext ctx);
	/**
	 * Enter a parse tree produced by the {@code table}
	 * labeled alternative in {@link athenasqlParser#queryPrimary}.
	 * @param ctx the parse tree
	 */
	void enterTable(athenasqlParser.TableContext ctx);
	/**
	 * Exit a parse tree produced by the {@code table}
	 * labeled alternative in {@link athenasqlParser#queryPrimary}.
	 * @param ctx the parse tree
	 */
	void exitTable(athenasqlParser.TableContext ctx);
	/**
	 * Enter a parse tree produced by the {@code inlineTable}
	 * labeled alternative in {@link athenasqlParser#queryPrimary}.
	 * @param ctx the parse tree
	 */
	void enterInlineTable(athenasqlParser.InlineTableContext ctx);
	/**
	 * Exit a parse tree produced by the {@code inlineTable}
	 * labeled alternative in {@link athenasqlParser#queryPrimary}.
	 * @param ctx the parse tree
	 */
	void exitInlineTable(athenasqlParser.InlineTableContext ctx);
	/**
	 * Enter a parse tree produced by the {@code subquery}
	 * labeled alternative in {@link athenasqlParser#queryPrimary}.
	 * @param ctx the parse tree
	 */
	void enterSubquery(athenasqlParser.SubqueryContext ctx);
	/**
	 * Exit a parse tree produced by the {@code subquery}
	 * labeled alternative in {@link athenasqlParser#queryPrimary}.
	 * @param ctx the parse tree
	 */
	void exitSubquery(athenasqlParser.SubqueryContext ctx);
	/**
	 * Enter a parse tree produced by {@link athenasqlParser#sortItem}.
	 * @param ctx the parse tree
	 */
	void enterSortItem(athenasqlParser.SortItemContext ctx);
	/**
	 * Exit a parse tree produced by {@link athenasqlParser#sortItem}.
	 * @param ctx the parse tree
	 */
	void exitSortItem(athenasqlParser.SortItemContext ctx);
	/**
	 * Enter a parse tree produced by {@link athenasqlParser#querySpecification}.
	 * @param ctx the parse tree
	 */
	void enterQuerySpecification(athenasqlParser.QuerySpecificationContext ctx);
	/**
	 * Exit a parse tree produced by {@link athenasqlParser#querySpecification}.
	 * @param ctx the parse tree
	 */
	void exitQuerySpecification(athenasqlParser.QuerySpecificationContext ctx);
	/**
	 * Enter a parse tree produced by {@link athenasqlParser#groupBy}.
	 * @param ctx the parse tree
	 */
	void enterGroupBy(athenasqlParser.GroupByContext ctx);
	/**
	 * Exit a parse tree produced by {@link athenasqlParser#groupBy}.
	 * @param ctx the parse tree
	 */
	void exitGroupBy(athenasqlParser.GroupByContext ctx);
	/**
	 * Enter a parse tree produced by the {@code singleGroupingSet}
	 * labeled alternative in {@link athenasqlParser#groupingElement}.
	 * @param ctx the parse tree
	 */
	void enterSingleGroupingSet(athenasqlParser.SingleGroupingSetContext ctx);
	/**
	 * Exit a parse tree produced by the {@code singleGroupingSet}
	 * labeled alternative in {@link athenasqlParser#groupingElement}.
	 * @param ctx the parse tree
	 */
	void exitSingleGroupingSet(athenasqlParser.SingleGroupingSetContext ctx);
	/**
	 * Enter a parse tree produced by the {@code rollup}
	 * labeled alternative in {@link athenasqlParser#groupingElement}.
	 * @param ctx the parse tree
	 */
	void enterRollup(athenasqlParser.RollupContext ctx);
	/**
	 * Exit a parse tree produced by the {@code rollup}
	 * labeled alternative in {@link athenasqlParser#groupingElement}.
	 * @param ctx the parse tree
	 */
	void exitRollup(athenasqlParser.RollupContext ctx);
	/**
	 * Enter a parse tree produced by the {@code cube}
	 * labeled alternative in {@link athenasqlParser#groupingElement}.
	 * @param ctx the parse tree
	 */
	void enterCube(athenasqlParser.CubeContext ctx);
	/**
	 * Exit a parse tree produced by the {@code cube}
	 * labeled alternative in {@link athenasqlParser#groupingElement}.
	 * @param ctx the parse tree
	 */
	void exitCube(athenasqlParser.CubeContext ctx);
	/**
	 * Enter a parse tree produced by the {@code multipleGroupingSets}
	 * labeled alternative in {@link athenasqlParser#groupingElement}.
	 * @param ctx the parse tree
	 */
	void enterMultipleGroupingSets(athenasqlParser.MultipleGroupingSetsContext ctx);
	/**
	 * Exit a parse tree produced by the {@code multipleGroupingSets}
	 * labeled alternative in {@link athenasqlParser#groupingElement}.
	 * @param ctx the parse tree
	 */
	void exitMultipleGroupingSets(athenasqlParser.MultipleGroupingSetsContext ctx);
	/**
	 * Enter a parse tree produced by {@link athenasqlParser#groupingExpressions}.
	 * @param ctx the parse tree
	 */
	void enterGroupingExpressions(athenasqlParser.GroupingExpressionsContext ctx);
	/**
	 * Exit a parse tree produced by {@link athenasqlParser#groupingExpressions}.
	 * @param ctx the parse tree
	 */
	void exitGroupingExpressions(athenasqlParser.GroupingExpressionsContext ctx);
	/**
	 * Enter a parse tree produced by {@link athenasqlParser#groupingSet}.
	 * @param ctx the parse tree
	 */
	void enterGroupingSet(athenasqlParser.GroupingSetContext ctx);
	/**
	 * Exit a parse tree produced by {@link athenasqlParser#groupingSet}.
	 * @param ctx the parse tree
	 */
	void exitGroupingSet(athenasqlParser.GroupingSetContext ctx);
	/**
	 * Enter a parse tree produced by {@link athenasqlParser#namedQuery}.
	 * @param ctx the parse tree
	 */
	void enterNamedQuery(athenasqlParser.NamedQueryContext ctx);
	/**
	 * Exit a parse tree produced by {@link athenasqlParser#namedQuery}.
	 * @param ctx the parse tree
	 */
	void exitNamedQuery(athenasqlParser.NamedQueryContext ctx);
	/**
	 * Enter a parse tree produced by {@link athenasqlParser#setQuantifier}.
	 * @param ctx the parse tree
	 */
	void enterSetQuantifier(athenasqlParser.SetQuantifierContext ctx);
	/**
	 * Exit a parse tree produced by {@link athenasqlParser#setQuantifier}.
	 * @param ctx the parse tree
	 */
	void exitSetQuantifier(athenasqlParser.SetQuantifierContext ctx);
	/**
	 * Enter a parse tree produced by the {@code selectSingle}
	 * labeled alternative in {@link athenasqlParser#selectItem}.
	 * @param ctx the parse tree
	 */
	void enterSelectSingle(athenasqlParser.SelectSingleContext ctx);
	/**
	 * Exit a parse tree produced by the {@code selectSingle}
	 * labeled alternative in {@link athenasqlParser#selectItem}.
	 * @param ctx the parse tree
	 */
	void exitSelectSingle(athenasqlParser.SelectSingleContext ctx);
	/**
	 * Enter a parse tree produced by the {@code selectAll}
	 * labeled alternative in {@link athenasqlParser#selectItem}.
	 * @param ctx the parse tree
	 */
	void enterSelectAll(athenasqlParser.SelectAllContext ctx);
	/**
	 * Exit a parse tree produced by the {@code selectAll}
	 * labeled alternative in {@link athenasqlParser#selectItem}.
	 * @param ctx the parse tree
	 */
	void exitSelectAll(athenasqlParser.SelectAllContext ctx);
	/**
	 * Enter a parse tree produced by the {@code relationDefault}
	 * labeled alternative in {@link athenasqlParser#relation}.
	 * @param ctx the parse tree
	 */
	void enterRelationDefault(athenasqlParser.RelationDefaultContext ctx);
	/**
	 * Exit a parse tree produced by the {@code relationDefault}
	 * labeled alternative in {@link athenasqlParser#relation}.
	 * @param ctx the parse tree
	 */
	void exitRelationDefault(athenasqlParser.RelationDefaultContext ctx);
	/**
	 * Enter a parse tree produced by the {@code joinRelation}
	 * labeled alternative in {@link athenasqlParser#relation}.
	 * @param ctx the parse tree
	 */
	void enterJoinRelation(athenasqlParser.JoinRelationContext ctx);
	/**
	 * Exit a parse tree produced by the {@code joinRelation}
	 * labeled alternative in {@link athenasqlParser#relation}.
	 * @param ctx the parse tree
	 */
	void exitJoinRelation(athenasqlParser.JoinRelationContext ctx);
	/**
	 * Enter a parse tree produced by {@link athenasqlParser#joinType}.
	 * @param ctx the parse tree
	 */
	void enterJoinType(athenasqlParser.JoinTypeContext ctx);
	/**
	 * Exit a parse tree produced by {@link athenasqlParser#joinType}.
	 * @param ctx the parse tree
	 */
	void exitJoinType(athenasqlParser.JoinTypeContext ctx);
	/**
	 * Enter a parse tree produced by {@link athenasqlParser#joinCriteria}.
	 * @param ctx the parse tree
	 */
	void enterJoinCriteria(athenasqlParser.JoinCriteriaContext ctx);
	/**
	 * Exit a parse tree produced by {@link athenasqlParser#joinCriteria}.
	 * @param ctx the parse tree
	 */
	void exitJoinCriteria(athenasqlParser.JoinCriteriaContext ctx);
	/**
	 * Enter a parse tree produced by {@link athenasqlParser#sampledRelation}.
	 * @param ctx the parse tree
	 */
	void enterSampledRelation(athenasqlParser.SampledRelationContext ctx);
	/**
	 * Exit a parse tree produced by {@link athenasqlParser#sampledRelation}.
	 * @param ctx the parse tree
	 */
	void exitSampledRelation(athenasqlParser.SampledRelationContext ctx);
	/**
	 * Enter a parse tree produced by {@link athenasqlParser#sampleType}.
	 * @param ctx the parse tree
	 */
	void enterSampleType(athenasqlParser.SampleTypeContext ctx);
	/**
	 * Exit a parse tree produced by {@link athenasqlParser#sampleType}.
	 * @param ctx the parse tree
	 */
	void exitSampleType(athenasqlParser.SampleTypeContext ctx);
	/**
	 * Enter a parse tree produced by {@link athenasqlParser#aliasedRelation}.
	 * @param ctx the parse tree
	 */
	void enterAliasedRelation(athenasqlParser.AliasedRelationContext ctx);
	/**
	 * Exit a parse tree produced by {@link athenasqlParser#aliasedRelation}.
	 * @param ctx the parse tree
	 */
	void exitAliasedRelation(athenasqlParser.AliasedRelationContext ctx);
	/**
	 * Enter a parse tree produced by {@link athenasqlParser#columnAliases}.
	 * @param ctx the parse tree
	 */
	void enterColumnAliases(athenasqlParser.ColumnAliasesContext ctx);
	/**
	 * Exit a parse tree produced by {@link athenasqlParser#columnAliases}.
	 * @param ctx the parse tree
	 */
	void exitColumnAliases(athenasqlParser.ColumnAliasesContext ctx);
	/**
	 * Enter a parse tree produced by the {@code tableName}
	 * labeled alternative in {@link athenasqlParser#relationPrimary}.
	 * @param ctx the parse tree
	 */
	void enterTableName(athenasqlParser.TableNameContext ctx);
	/**
	 * Exit a parse tree produced by the {@code tableName}
	 * labeled alternative in {@link athenasqlParser#relationPrimary}.
	 * @param ctx the parse tree
	 */
	void exitTableName(athenasqlParser.TableNameContext ctx);
	/**
	 * Enter a parse tree produced by the {@code subqueryRelation}
	 * labeled alternative in {@link athenasqlParser#relationPrimary}.
	 * @param ctx the parse tree
	 */
	void enterSubqueryRelation(athenasqlParser.SubqueryRelationContext ctx);
	/**
	 * Exit a parse tree produced by the {@code subqueryRelation}
	 * labeled alternative in {@link athenasqlParser#relationPrimary}.
	 * @param ctx the parse tree
	 */
	void exitSubqueryRelation(athenasqlParser.SubqueryRelationContext ctx);
	/**
	 * Enter a parse tree produced by the {@code unnest}
	 * labeled alternative in {@link athenasqlParser#relationPrimary}.
	 * @param ctx the parse tree
	 */
	void enterUnnest(athenasqlParser.UnnestContext ctx);
	/**
	 * Exit a parse tree produced by the {@code unnest}
	 * labeled alternative in {@link athenasqlParser#relationPrimary}.
	 * @param ctx the parse tree
	 */
	void exitUnnest(athenasqlParser.UnnestContext ctx);
	/**
	 * Enter a parse tree produced by the {@code parenthesizedRelation}
	 * labeled alternative in {@link athenasqlParser#relationPrimary}.
	 * @param ctx the parse tree
	 */
	void enterParenthesizedRelation(athenasqlParser.ParenthesizedRelationContext ctx);
	/**
	 * Exit a parse tree produced by the {@code parenthesizedRelation}
	 * labeled alternative in {@link athenasqlParser#relationPrimary}.
	 * @param ctx the parse tree
	 */
	void exitParenthesizedRelation(athenasqlParser.ParenthesizedRelationContext ctx);
	/**
	 * Enter a parse tree produced by {@link athenasqlParser#tableReference}.
	 * @param ctx the parse tree
	 */
	void enterTableReference(athenasqlParser.TableReferenceContext ctx);
	/**
	 * Exit a parse tree produced by {@link athenasqlParser#tableReference}.
	 * @param ctx the parse tree
	 */
	void exitTableReference(athenasqlParser.TableReferenceContext ctx);
	/**
	 * Enter a parse tree produced by {@link athenasqlParser#expression}.
	 * @param ctx the parse tree
	 */
	void enterExpression(athenasqlParser.ExpressionContext ctx);
	/**
	 * Exit a parse tree produced by {@link athenasqlParser#expression}.
	 * @param ctx the parse tree
	 */
	void exitExpression(athenasqlParser.ExpressionContext ctx);
	/**
	 * Enter a parse tree produced by the {@code logicalNot}
	 * labeled alternative in {@link athenasqlParser#booleanExpression}.
	 * @param ctx the parse tree
	 */
	void enterLogicalNot(athenasqlParser.LogicalNotContext ctx);
	/**
	 * Exit a parse tree produced by the {@code logicalNot}
	 * labeled alternative in {@link athenasqlParser#booleanExpression}.
	 * @param ctx the parse tree
	 */
	void exitLogicalNot(athenasqlParser.LogicalNotContext ctx);
	/**
	 * Enter a parse tree produced by the {@code booleanDefault}
	 * labeled alternative in {@link athenasqlParser#booleanExpression}.
	 * @param ctx the parse tree
	 */
	void enterBooleanDefault(athenasqlParser.BooleanDefaultContext ctx);
	/**
	 * Exit a parse tree produced by the {@code booleanDefault}
	 * labeled alternative in {@link athenasqlParser#booleanExpression}.
	 * @param ctx the parse tree
	 */
	void exitBooleanDefault(athenasqlParser.BooleanDefaultContext ctx);
	/**
	 * Enter a parse tree produced by the {@code logicalBinary}
	 * labeled alternative in {@link athenasqlParser#booleanExpression}.
	 * @param ctx the parse tree
	 */
	void enterLogicalBinary(athenasqlParser.LogicalBinaryContext ctx);
	/**
	 * Exit a parse tree produced by the {@code logicalBinary}
	 * labeled alternative in {@link athenasqlParser#booleanExpression}.
	 * @param ctx the parse tree
	 */
	void exitLogicalBinary(athenasqlParser.LogicalBinaryContext ctx);
	/**
	 * Enter a parse tree produced by {@link athenasqlParser#predicated}.
	 * @param ctx the parse tree
	 */
	void enterPredicated(athenasqlParser.PredicatedContext ctx);
	/**
	 * Exit a parse tree produced by {@link athenasqlParser#predicated}.
	 * @param ctx the parse tree
	 */
	void exitPredicated(athenasqlParser.PredicatedContext ctx);
	/**
	 * Enter a parse tree produced by the {@code comparison}
	 * labeled alternative in {@link athenasqlParser#predicate}.
	 * @param ctx the parse tree
	 */
	void enterComparison(athenasqlParser.ComparisonContext ctx);
	/**
	 * Exit a parse tree produced by the {@code comparison}
	 * labeled alternative in {@link athenasqlParser#predicate}.
	 * @param ctx the parse tree
	 */
	void exitComparison(athenasqlParser.ComparisonContext ctx);
	/**
	 * Enter a parse tree produced by the {@code quantifiedComparison}
	 * labeled alternative in {@link athenasqlParser#predicate}.
	 * @param ctx the parse tree
	 */
	void enterQuantifiedComparison(athenasqlParser.QuantifiedComparisonContext ctx);
	/**
	 * Exit a parse tree produced by the {@code quantifiedComparison}
	 * labeled alternative in {@link athenasqlParser#predicate}.
	 * @param ctx the parse tree
	 */
	void exitQuantifiedComparison(athenasqlParser.QuantifiedComparisonContext ctx);
	/**
	 * Enter a parse tree produced by the {@code between}
	 * labeled alternative in {@link athenasqlParser#predicate}.
	 * @param ctx the parse tree
	 */
	void enterBetween(athenasqlParser.BetweenContext ctx);
	/**
	 * Exit a parse tree produced by the {@code between}
	 * labeled alternative in {@link athenasqlParser#predicate}.
	 * @param ctx the parse tree
	 */
	void exitBetween(athenasqlParser.BetweenContext ctx);
	/**
	 * Enter a parse tree produced by the {@code inList}
	 * labeled alternative in {@link athenasqlParser#predicate}.
	 * @param ctx the parse tree
	 */
	void enterInList(athenasqlParser.InListContext ctx);
	/**
	 * Exit a parse tree produced by the {@code inList}
	 * labeled alternative in {@link athenasqlParser#predicate}.
	 * @param ctx the parse tree
	 */
	void exitInList(athenasqlParser.InListContext ctx);
	/**
	 * Enter a parse tree produced by the {@code inSubquery}
	 * labeled alternative in {@link athenasqlParser#predicate}.
	 * @param ctx the parse tree
	 */
	void enterInSubquery(athenasqlParser.InSubqueryContext ctx);
	/**
	 * Exit a parse tree produced by the {@code inSubquery}
	 * labeled alternative in {@link athenasqlParser#predicate}.
	 * @param ctx the parse tree
	 */
	void exitInSubquery(athenasqlParser.InSubqueryContext ctx);
	/**
	 * Enter a parse tree produced by the {@code like}
	 * labeled alternative in {@link athenasqlParser#predicate}.
	 * @param ctx the parse tree
	 */
	void enterLike(athenasqlParser.LikeContext ctx);
	/**
	 * Exit a parse tree produced by the {@code like}
	 * labeled alternative in {@link athenasqlParser#predicate}.
	 * @param ctx the parse tree
	 */
	void exitLike(athenasqlParser.LikeContext ctx);
	/**
	 * Enter a parse tree produced by the {@code nullPredicate}
	 * labeled alternative in {@link athenasqlParser#predicate}.
	 * @param ctx the parse tree
	 */
	void enterNullPredicate(athenasqlParser.NullPredicateContext ctx);
	/**
	 * Exit a parse tree produced by the {@code nullPredicate}
	 * labeled alternative in {@link athenasqlParser#predicate}.
	 * @param ctx the parse tree
	 */
	void exitNullPredicate(athenasqlParser.NullPredicateContext ctx);
	/**
	 * Enter a parse tree produced by the {@code distinctFrom}
	 * labeled alternative in {@link athenasqlParser#predicate}.
	 * @param ctx the parse tree
	 */
	void enterDistinctFrom(athenasqlParser.DistinctFromContext ctx);
	/**
	 * Exit a parse tree produced by the {@code distinctFrom}
	 * labeled alternative in {@link athenasqlParser#predicate}.
	 * @param ctx the parse tree
	 */
	void exitDistinctFrom(athenasqlParser.DistinctFromContext ctx);
	/**
	 * Enter a parse tree produced by the {@code valueExpressionDefault}
	 * labeled alternative in {@link athenasqlParser#valueExpression}.
	 * @param ctx the parse tree
	 */
	void enterValueExpressionDefault(athenasqlParser.ValueExpressionDefaultContext ctx);
	/**
	 * Exit a parse tree produced by the {@code valueExpressionDefault}
	 * labeled alternative in {@link athenasqlParser#valueExpression}.
	 * @param ctx the parse tree
	 */
	void exitValueExpressionDefault(athenasqlParser.ValueExpressionDefaultContext ctx);
	/**
	 * Enter a parse tree produced by the {@code concatenation}
	 * labeled alternative in {@link athenasqlParser#valueExpression}.
	 * @param ctx the parse tree
	 */
	void enterConcatenation(athenasqlParser.ConcatenationContext ctx);
	/**
	 * Exit a parse tree produced by the {@code concatenation}
	 * labeled alternative in {@link athenasqlParser#valueExpression}.
	 * @param ctx the parse tree
	 */
	void exitConcatenation(athenasqlParser.ConcatenationContext ctx);
	/**
	 * Enter a parse tree produced by the {@code arithmeticBinary}
	 * labeled alternative in {@link athenasqlParser#valueExpression}.
	 * @param ctx the parse tree
	 */
	void enterArithmeticBinary(athenasqlParser.ArithmeticBinaryContext ctx);
	/**
	 * Exit a parse tree produced by the {@code arithmeticBinary}
	 * labeled alternative in {@link athenasqlParser#valueExpression}.
	 * @param ctx the parse tree
	 */
	void exitArithmeticBinary(athenasqlParser.ArithmeticBinaryContext ctx);
	/**
	 * Enter a parse tree produced by the {@code arithmeticUnary}
	 * labeled alternative in {@link athenasqlParser#valueExpression}.
	 * @param ctx the parse tree
	 */
	void enterArithmeticUnary(athenasqlParser.ArithmeticUnaryContext ctx);
	/**
	 * Exit a parse tree produced by the {@code arithmeticUnary}
	 * labeled alternative in {@link athenasqlParser#valueExpression}.
	 * @param ctx the parse tree
	 */
	void exitArithmeticUnary(athenasqlParser.ArithmeticUnaryContext ctx);
	/**
	 * Enter a parse tree produced by the {@code atTimeZone}
	 * labeled alternative in {@link athenasqlParser#valueExpression}.
	 * @param ctx the parse tree
	 */
	void enterAtTimeZone(athenasqlParser.AtTimeZoneContext ctx);
	/**
	 * Exit a parse tree produced by the {@code atTimeZone}
	 * labeled alternative in {@link athenasqlParser#valueExpression}.
	 * @param ctx the parse tree
	 */
	void exitAtTimeZone(athenasqlParser.AtTimeZoneContext ctx);
	/**
	 * Enter a parse tree produced by {@link athenasqlParser#columnReference}.
	 * @param ctx the parse tree
	 */
	void enterColumnReference(athenasqlParser.ColumnReferenceContext ctx);
	/**
	 * Exit a parse tree produced by {@link athenasqlParser#columnReference}.
	 * @param ctx the parse tree
	 */
	void exitColumnReference(athenasqlParser.ColumnReferenceContext ctx);
	/**
	 * Enter a parse tree produced by the {@code dereference}
	 * labeled alternative in {@link athenasqlParser#primaryExpression}.
	 * @param ctx the parse tree
	 */
	void enterDereference(athenasqlParser.DereferenceContext ctx);
	/**
	 * Exit a parse tree produced by the {@code dereference}
	 * labeled alternative in {@link athenasqlParser#primaryExpression}.
	 * @param ctx the parse tree
	 */
	void exitDereference(athenasqlParser.DereferenceContext ctx);
	/**
	 * Enter a parse tree produced by the {@code typeConstructor}
	 * labeled alternative in {@link athenasqlParser#primaryExpression}.
	 * @param ctx the parse tree
	 */
	void enterTypeConstructor(athenasqlParser.TypeConstructorContext ctx);
	/**
	 * Exit a parse tree produced by the {@code typeConstructor}
	 * labeled alternative in {@link athenasqlParser#primaryExpression}.
	 * @param ctx the parse tree
	 */
	void exitTypeConstructor(athenasqlParser.TypeConstructorContext ctx);
	/**
	 * Enter a parse tree produced by the {@code specialDateTimeFunction}
	 * labeled alternative in {@link athenasqlParser#primaryExpression}.
	 * @param ctx the parse tree
	 */
	void enterSpecialDateTimeFunction(athenasqlParser.SpecialDateTimeFunctionContext ctx);
	/**
	 * Exit a parse tree produced by the {@code specialDateTimeFunction}
	 * labeled alternative in {@link athenasqlParser#primaryExpression}.
	 * @param ctx the parse tree
	 */
	void exitSpecialDateTimeFunction(athenasqlParser.SpecialDateTimeFunctionContext ctx);
	/**
	 * Enter a parse tree produced by the {@code substring}
	 * labeled alternative in {@link athenasqlParser#primaryExpression}.
	 * @param ctx the parse tree
	 */
	void enterSubstring(athenasqlParser.SubstringContext ctx);
	/**
	 * Exit a parse tree produced by the {@code substring}
	 * labeled alternative in {@link athenasqlParser#primaryExpression}.
	 * @param ctx the parse tree
	 */
	void exitSubstring(athenasqlParser.SubstringContext ctx);
	/**
	 * Enter a parse tree produced by the {@code cast}
	 * labeled alternative in {@link athenasqlParser#primaryExpression}.
	 * @param ctx the parse tree
	 */
	void enterCast(athenasqlParser.CastContext ctx);
	/**
	 * Exit a parse tree produced by the {@code cast}
	 * labeled alternative in {@link athenasqlParser#primaryExpression}.
	 * @param ctx the parse tree
	 */
	void exitCast(athenasqlParser.CastContext ctx);
	/**
	 * Enter a parse tree produced by the {@code lambda}
	 * labeled alternative in {@link athenasqlParser#primaryExpression}.
	 * @param ctx the parse tree
	 */
	void enterLambda(athenasqlParser.LambdaContext ctx);
	/**
	 * Exit a parse tree produced by the {@code lambda}
	 * labeled alternative in {@link athenasqlParser#primaryExpression}.
	 * @param ctx the parse tree
	 */
	void exitLambda(athenasqlParser.LambdaContext ctx);
	/**
	 * Enter a parse tree produced by the {@code parenthesizedExpression}
	 * labeled alternative in {@link athenasqlParser#primaryExpression}.
	 * @param ctx the parse tree
	 */
	void enterParenthesizedExpression(athenasqlParser.ParenthesizedExpressionContext ctx);
	/**
	 * Exit a parse tree produced by the {@code parenthesizedExpression}
	 * labeled alternative in {@link athenasqlParser#primaryExpression}.
	 * @param ctx the parse tree
	 */
	void exitParenthesizedExpression(athenasqlParser.ParenthesizedExpressionContext ctx);
	/**
	 * Enter a parse tree produced by the {@code parameter}
	 * labeled alternative in {@link athenasqlParser#primaryExpression}.
	 * @param ctx the parse tree
	 */
	void enterParameter(athenasqlParser.ParameterContext ctx);
	/**
	 * Exit a parse tree produced by the {@code parameter}
	 * labeled alternative in {@link athenasqlParser#primaryExpression}.
	 * @param ctx the parse tree
	 */
	void exitParameter(athenasqlParser.ParameterContext ctx);
	/**
	 * Enter a parse tree produced by the {@code normalize}
	 * labeled alternative in {@link athenasqlParser#primaryExpression}.
	 * @param ctx the parse tree
	 */
	void enterNormalize(athenasqlParser.NormalizeContext ctx);
	/**
	 * Exit a parse tree produced by the {@code normalize}
	 * labeled alternative in {@link athenasqlParser#primaryExpression}.
	 * @param ctx the parse tree
	 */
	void exitNormalize(athenasqlParser.NormalizeContext ctx);
	/**
	 * Enter a parse tree produced by the {@code intervalLiteral}
	 * labeled alternative in {@link athenasqlParser#primaryExpression}.
	 * @param ctx the parse tree
	 */
	void enterIntervalLiteral(athenasqlParser.IntervalLiteralContext ctx);
	/**
	 * Exit a parse tree produced by the {@code intervalLiteral}
	 * labeled alternative in {@link athenasqlParser#primaryExpression}.
	 * @param ctx the parse tree
	 */
	void exitIntervalLiteral(athenasqlParser.IntervalLiteralContext ctx);
	/**
	 * Enter a parse tree produced by the {@code numericLiteral}
	 * labeled alternative in {@link athenasqlParser#primaryExpression}.
	 * @param ctx the parse tree
	 */
	void enterNumericLiteral(athenasqlParser.NumericLiteralContext ctx);
	/**
	 * Exit a parse tree produced by the {@code numericLiteral}
	 * labeled alternative in {@link athenasqlParser#primaryExpression}.
	 * @param ctx the parse tree
	 */
	void exitNumericLiteral(athenasqlParser.NumericLiteralContext ctx);
	/**
	 * Enter a parse tree produced by the {@code booleanLiteral}
	 * labeled alternative in {@link athenasqlParser#primaryExpression}.
	 * @param ctx the parse tree
	 */
	void enterBooleanLiteral(athenasqlParser.BooleanLiteralContext ctx);
	/**
	 * Exit a parse tree produced by the {@code booleanLiteral}
	 * labeled alternative in {@link athenasqlParser#primaryExpression}.
	 * @param ctx the parse tree
	 */
	void exitBooleanLiteral(athenasqlParser.BooleanLiteralContext ctx);
	/**
	 * Enter a parse tree produced by the {@code simpleCase}
	 * labeled alternative in {@link athenasqlParser#primaryExpression}.
	 * @param ctx the parse tree
	 */
	void enterSimpleCase(athenasqlParser.SimpleCaseContext ctx);
	/**
	 * Exit a parse tree produced by the {@code simpleCase}
	 * labeled alternative in {@link athenasqlParser#primaryExpression}.
	 * @param ctx the parse tree
	 */
	void exitSimpleCase(athenasqlParser.SimpleCaseContext ctx);
	/**
	 * Enter a parse tree produced by the {@code nullLiteral}
	 * labeled alternative in {@link athenasqlParser#primaryExpression}.
	 * @param ctx the parse tree
	 */
	void enterNullLiteral(athenasqlParser.NullLiteralContext ctx);
	/**
	 * Exit a parse tree produced by the {@code nullLiteral}
	 * labeled alternative in {@link athenasqlParser#primaryExpression}.
	 * @param ctx the parse tree
	 */
	void exitNullLiteral(athenasqlParser.NullLiteralContext ctx);
	/**
	 * Enter a parse tree produced by the {@code rowConstructor}
	 * labeled alternative in {@link athenasqlParser#primaryExpression}.
	 * @param ctx the parse tree
	 */
	void enterRowConstructor(athenasqlParser.RowConstructorContext ctx);
	/**
	 * Exit a parse tree produced by the {@code rowConstructor}
	 * labeled alternative in {@link athenasqlParser#primaryExpression}.
	 * @param ctx the parse tree
	 */
	void exitRowConstructor(athenasqlParser.RowConstructorContext ctx);
	/**
	 * Enter a parse tree produced by the {@code subscript}
	 * labeled alternative in {@link athenasqlParser#primaryExpression}.
	 * @param ctx the parse tree
	 */
	void enterSubscript(athenasqlParser.SubscriptContext ctx);
	/**
	 * Exit a parse tree produced by the {@code subscript}
	 * labeled alternative in {@link athenasqlParser#primaryExpression}.
	 * @param ctx the parse tree
	 */
	void exitSubscript(athenasqlParser.SubscriptContext ctx);
	/**
	 * Enter a parse tree produced by the {@code subqueryExpression}
	 * labeled alternative in {@link athenasqlParser#primaryExpression}.
	 * @param ctx the parse tree
	 */
	void enterSubqueryExpression(athenasqlParser.SubqueryExpressionContext ctx);
	/**
	 * Exit a parse tree produced by the {@code subqueryExpression}
	 * labeled alternative in {@link athenasqlParser#primaryExpression}.
	 * @param ctx the parse tree
	 */
	void exitSubqueryExpression(athenasqlParser.SubqueryExpressionContext ctx);
	/**
	 * Enter a parse tree produced by the {@code binaryLiteral}
	 * labeled alternative in {@link athenasqlParser#primaryExpression}.
	 * @param ctx the parse tree
	 */
	void enterBinaryLiteral(athenasqlParser.BinaryLiteralContext ctx);
	/**
	 * Exit a parse tree produced by the {@code binaryLiteral}
	 * labeled alternative in {@link athenasqlParser#primaryExpression}.
	 * @param ctx the parse tree
	 */
	void exitBinaryLiteral(athenasqlParser.BinaryLiteralContext ctx);
	/**
	 * Enter a parse tree produced by the {@code extract}
	 * labeled alternative in {@link athenasqlParser#primaryExpression}.
	 * @param ctx the parse tree
	 */
	void enterExtract(athenasqlParser.ExtractContext ctx);
	/**
	 * Exit a parse tree produced by the {@code extract}
	 * labeled alternative in {@link athenasqlParser#primaryExpression}.
	 * @param ctx the parse tree
	 */
	void exitExtract(athenasqlParser.ExtractContext ctx);
	/**
	 * Enter a parse tree produced by the {@code stringLiteral}
	 * labeled alternative in {@link athenasqlParser#primaryExpression}.
	 * @param ctx the parse tree
	 */
	void enterStringLiteral(athenasqlParser.StringLiteralContext ctx);
	/**
	 * Exit a parse tree produced by the {@code stringLiteral}
	 * labeled alternative in {@link athenasqlParser#primaryExpression}.
	 * @param ctx the parse tree
	 */
	void exitStringLiteral(athenasqlParser.StringLiteralContext ctx);
	/**
	 * Enter a parse tree produced by the {@code arrayConstructor}
	 * labeled alternative in {@link athenasqlParser#primaryExpression}.
	 * @param ctx the parse tree
	 */
	void enterArrayConstructor(athenasqlParser.ArrayConstructorContext ctx);
	/**
	 * Exit a parse tree produced by the {@code arrayConstructor}
	 * labeled alternative in {@link athenasqlParser#primaryExpression}.
	 * @param ctx the parse tree
	 */
	void exitArrayConstructor(athenasqlParser.ArrayConstructorContext ctx);
	/**
	 * Enter a parse tree produced by the {@code functionCall}
	 * labeled alternative in {@link athenasqlParser#primaryExpression}.
	 * @param ctx the parse tree
	 */
	void enterFunctionCall(athenasqlParser.FunctionCallContext ctx);
	/**
	 * Exit a parse tree produced by the {@code functionCall}
	 * labeled alternative in {@link athenasqlParser#primaryExpression}.
	 * @param ctx the parse tree
	 */
	void exitFunctionCall(athenasqlParser.FunctionCallContext ctx);
	/**
	 * Enter a parse tree produced by the {@code exists}
	 * labeled alternative in {@link athenasqlParser#primaryExpression}.
	 * @param ctx the parse tree
	 */
	void enterExists(athenasqlParser.ExistsContext ctx);
	/**
	 * Exit a parse tree produced by the {@code exists}
	 * labeled alternative in {@link athenasqlParser#primaryExpression}.
	 * @param ctx the parse tree
	 */
	void exitExists(athenasqlParser.ExistsContext ctx);
	/**
	 * Enter a parse tree produced by the {@code position}
	 * labeled alternative in {@link athenasqlParser#primaryExpression}.
	 * @param ctx the parse tree
	 */
	void enterPosition(athenasqlParser.PositionContext ctx);
	/**
	 * Exit a parse tree produced by the {@code position}
	 * labeled alternative in {@link athenasqlParser#primaryExpression}.
	 * @param ctx the parse tree
	 */
	void exitPosition(athenasqlParser.PositionContext ctx);
	/**
	 * Enter a parse tree produced by the {@code searchedCase}
	 * labeled alternative in {@link athenasqlParser#primaryExpression}.
	 * @param ctx the parse tree
	 */
	void enterSearchedCase(athenasqlParser.SearchedCaseContext ctx);
	/**
	 * Exit a parse tree produced by the {@code searchedCase}
	 * labeled alternative in {@link athenasqlParser#primaryExpression}.
	 * @param ctx the parse tree
	 */
	void exitSearchedCase(athenasqlParser.SearchedCaseContext ctx);
	/**
	 * Enter a parse tree produced by the {@code columnName}
	 * labeled alternative in {@link athenasqlParser#primaryExpression}.
	 * @param ctx the parse tree
	 */
	void enterColumnName(athenasqlParser.ColumnNameContext ctx);
	/**
	 * Exit a parse tree produced by the {@code columnName}
	 * labeled alternative in {@link athenasqlParser#primaryExpression}.
	 * @param ctx the parse tree
	 */
	void exitColumnName(athenasqlParser.ColumnNameContext ctx);
	/**
	 * Enter a parse tree produced by the {@code timeZoneInterval}
	 * labeled alternative in {@link athenasqlParser#timeZoneSpecifier}.
	 * @param ctx the parse tree
	 */
	void enterTimeZoneInterval(athenasqlParser.TimeZoneIntervalContext ctx);
	/**
	 * Exit a parse tree produced by the {@code timeZoneInterval}
	 * labeled alternative in {@link athenasqlParser#timeZoneSpecifier}.
	 * @param ctx the parse tree
	 */
	void exitTimeZoneInterval(athenasqlParser.TimeZoneIntervalContext ctx);
	/**
	 * Enter a parse tree produced by the {@code timeZoneString}
	 * labeled alternative in {@link athenasqlParser#timeZoneSpecifier}.
	 * @param ctx the parse tree
	 */
	void enterTimeZoneString(athenasqlParser.TimeZoneStringContext ctx);
	/**
	 * Exit a parse tree produced by the {@code timeZoneString}
	 * labeled alternative in {@link athenasqlParser#timeZoneSpecifier}.
	 * @param ctx the parse tree
	 */
	void exitTimeZoneString(athenasqlParser.TimeZoneStringContext ctx);
	/**
	 * Enter a parse tree produced by {@link athenasqlParser#comparisonOperator}.
	 * @param ctx the parse tree
	 */
	void enterComparisonOperator(athenasqlParser.ComparisonOperatorContext ctx);
	/**
	 * Exit a parse tree produced by {@link athenasqlParser#comparisonOperator}.
	 * @param ctx the parse tree
	 */
	void exitComparisonOperator(athenasqlParser.ComparisonOperatorContext ctx);
	/**
	 * Enter a parse tree produced by {@link athenasqlParser#comparisonQuantifier}.
	 * @param ctx the parse tree
	 */
	void enterComparisonQuantifier(athenasqlParser.ComparisonQuantifierContext ctx);
	/**
	 * Exit a parse tree produced by {@link athenasqlParser#comparisonQuantifier}.
	 * @param ctx the parse tree
	 */
	void exitComparisonQuantifier(athenasqlParser.ComparisonQuantifierContext ctx);
	/**
	 * Enter a parse tree produced by {@link athenasqlParser#booleanValue}.
	 * @param ctx the parse tree
	 */
	void enterBooleanValue(athenasqlParser.BooleanValueContext ctx);
	/**
	 * Exit a parse tree produced by {@link athenasqlParser#booleanValue}.
	 * @param ctx the parse tree
	 */
	void exitBooleanValue(athenasqlParser.BooleanValueContext ctx);
	/**
	 * Enter a parse tree produced by {@link athenasqlParser#interval}.
	 * @param ctx the parse tree
	 */
	void enterInterval(athenasqlParser.IntervalContext ctx);
	/**
	 * Exit a parse tree produced by {@link athenasqlParser#interval}.
	 * @param ctx the parse tree
	 */
	void exitInterval(athenasqlParser.IntervalContext ctx);
	/**
	 * Enter a parse tree produced by {@link athenasqlParser#intervalField}.
	 * @param ctx the parse tree
	 */
	void enterIntervalField(athenasqlParser.IntervalFieldContext ctx);
	/**
	 * Exit a parse tree produced by {@link athenasqlParser#intervalField}.
	 * @param ctx the parse tree
	 */
	void exitIntervalField(athenasqlParser.IntervalFieldContext ctx);
	/**
	 * Enter a parse tree produced by {@link athenasqlParser#type}.
	 * @param ctx the parse tree
	 */
	void enterType(athenasqlParser.TypeContext ctx);
	/**
	 * Exit a parse tree produced by {@link athenasqlParser#type}.
	 * @param ctx the parse tree
	 */
	void exitType(athenasqlParser.TypeContext ctx);
	/**
	 * Enter a parse tree produced by {@link athenasqlParser#typeParameter}.
	 * @param ctx the parse tree
	 */
	void enterTypeParameter(athenasqlParser.TypeParameterContext ctx);
	/**
	 * Exit a parse tree produced by {@link athenasqlParser#typeParameter}.
	 * @param ctx the parse tree
	 */
	void exitTypeParameter(athenasqlParser.TypeParameterContext ctx);
	/**
	 * Enter a parse tree produced by {@link athenasqlParser#baseType}.
	 * @param ctx the parse tree
	 */
	void enterBaseType(athenasqlParser.BaseTypeContext ctx);
	/**
	 * Exit a parse tree produced by {@link athenasqlParser#baseType}.
	 * @param ctx the parse tree
	 */
	void exitBaseType(athenasqlParser.BaseTypeContext ctx);
	/**
	 * Enter a parse tree produced by {@link athenasqlParser#whenClause}.
	 * @param ctx the parse tree
	 */
	void enterWhenClause(athenasqlParser.WhenClauseContext ctx);
	/**
	 * Exit a parse tree produced by {@link athenasqlParser#whenClause}.
	 * @param ctx the parse tree
	 */
	void exitWhenClause(athenasqlParser.WhenClauseContext ctx);
	/**
	 * Enter a parse tree produced by {@link athenasqlParser#filter}.
	 * @param ctx the parse tree
	 */
	void enterFilter(athenasqlParser.FilterContext ctx);
	/**
	 * Exit a parse tree produced by {@link athenasqlParser#filter}.
	 * @param ctx the parse tree
	 */
	void exitFilter(athenasqlParser.FilterContext ctx);
	/**
	 * Enter a parse tree produced by {@link athenasqlParser#over}.
	 * @param ctx the parse tree
	 */
	void enterOver(athenasqlParser.OverContext ctx);
	/**
	 * Exit a parse tree produced by {@link athenasqlParser#over}.
	 * @param ctx the parse tree
	 */
	void exitOver(athenasqlParser.OverContext ctx);
	/**
	 * Enter a parse tree produced by {@link athenasqlParser#windowFrame}.
	 * @param ctx the parse tree
	 */
	void enterWindowFrame(athenasqlParser.WindowFrameContext ctx);
	/**
	 * Exit a parse tree produced by {@link athenasqlParser#windowFrame}.
	 * @param ctx the parse tree
	 */
	void exitWindowFrame(athenasqlParser.WindowFrameContext ctx);
	/**
	 * Enter a parse tree produced by the {@code unboundedFrame}
	 * labeled alternative in {@link athenasqlParser#frameBound}.
	 * @param ctx the parse tree
	 */
	void enterUnboundedFrame(athenasqlParser.UnboundedFrameContext ctx);
	/**
	 * Exit a parse tree produced by the {@code unboundedFrame}
	 * labeled alternative in {@link athenasqlParser#frameBound}.
	 * @param ctx the parse tree
	 */
	void exitUnboundedFrame(athenasqlParser.UnboundedFrameContext ctx);
	/**
	 * Enter a parse tree produced by the {@code currentRowBound}
	 * labeled alternative in {@link athenasqlParser#frameBound}.
	 * @param ctx the parse tree
	 */
	void enterCurrentRowBound(athenasqlParser.CurrentRowBoundContext ctx);
	/**
	 * Exit a parse tree produced by the {@code currentRowBound}
	 * labeled alternative in {@link athenasqlParser#frameBound}.
	 * @param ctx the parse tree
	 */
	void exitCurrentRowBound(athenasqlParser.CurrentRowBoundContext ctx);
	/**
	 * Enter a parse tree produced by the {@code boundedFrame}
	 * labeled alternative in {@link athenasqlParser#frameBound}.
	 * @param ctx the parse tree
	 */
	void enterBoundedFrame(athenasqlParser.BoundedFrameContext ctx);
	/**
	 * Exit a parse tree produced by the {@code boundedFrame}
	 * labeled alternative in {@link athenasqlParser#frameBound}.
	 * @param ctx the parse tree
	 */
	void exitBoundedFrame(athenasqlParser.BoundedFrameContext ctx);
	/**
	 * Enter a parse tree produced by the {@code explainFormat}
	 * labeled alternative in {@link athenasqlParser#explainOption}.
	 * @param ctx the parse tree
	 */
	void enterExplainFormat(athenasqlParser.ExplainFormatContext ctx);
	/**
	 * Exit a parse tree produced by the {@code explainFormat}
	 * labeled alternative in {@link athenasqlParser#explainOption}.
	 * @param ctx the parse tree
	 */
	void exitExplainFormat(athenasqlParser.ExplainFormatContext ctx);
	/**
	 * Enter a parse tree produced by the {@code explainType}
	 * labeled alternative in {@link athenasqlParser#explainOption}.
	 * @param ctx the parse tree
	 */
	void enterExplainType(athenasqlParser.ExplainTypeContext ctx);
	/**
	 * Exit a parse tree produced by the {@code explainType}
	 * labeled alternative in {@link athenasqlParser#explainOption}.
	 * @param ctx the parse tree
	 */
	void exitExplainType(athenasqlParser.ExplainTypeContext ctx);
	/**
	 * Enter a parse tree produced by the {@code isolationLevel}
	 * labeled alternative in {@link athenasqlParser#transactionMode}.
	 * @param ctx the parse tree
	 */
	void enterIsolationLevel(athenasqlParser.IsolationLevelContext ctx);
	/**
	 * Exit a parse tree produced by the {@code isolationLevel}
	 * labeled alternative in {@link athenasqlParser#transactionMode}.
	 * @param ctx the parse tree
	 */
	void exitIsolationLevel(athenasqlParser.IsolationLevelContext ctx);
	/**
	 * Enter a parse tree produced by the {@code transactionAccessMode}
	 * labeled alternative in {@link athenasqlParser#transactionMode}.
	 * @param ctx the parse tree
	 */
	void enterTransactionAccessMode(athenasqlParser.TransactionAccessModeContext ctx);
	/**
	 * Exit a parse tree produced by the {@code transactionAccessMode}
	 * labeled alternative in {@link athenasqlParser#transactionMode}.
	 * @param ctx the parse tree
	 */
	void exitTransactionAccessMode(athenasqlParser.TransactionAccessModeContext ctx);
	/**
	 * Enter a parse tree produced by the {@code readUncommitted}
	 * labeled alternative in {@link athenasqlParser#levelOfIsolation}.
	 * @param ctx the parse tree
	 */
	void enterReadUncommitted(athenasqlParser.ReadUncommittedContext ctx);
	/**
	 * Exit a parse tree produced by the {@code readUncommitted}
	 * labeled alternative in {@link athenasqlParser#levelOfIsolation}.
	 * @param ctx the parse tree
	 */
	void exitReadUncommitted(athenasqlParser.ReadUncommittedContext ctx);
	/**
	 * Enter a parse tree produced by the {@code readCommitted}
	 * labeled alternative in {@link athenasqlParser#levelOfIsolation}.
	 * @param ctx the parse tree
	 */
	void enterReadCommitted(athenasqlParser.ReadCommittedContext ctx);
	/**
	 * Exit a parse tree produced by the {@code readCommitted}
	 * labeled alternative in {@link athenasqlParser#levelOfIsolation}.
	 * @param ctx the parse tree
	 */
	void exitReadCommitted(athenasqlParser.ReadCommittedContext ctx);
	/**
	 * Enter a parse tree produced by the {@code repeatableRead}
	 * labeled alternative in {@link athenasqlParser#levelOfIsolation}.
	 * @param ctx the parse tree
	 */
	void enterRepeatableRead(athenasqlParser.RepeatableReadContext ctx);
	/**
	 * Exit a parse tree produced by the {@code repeatableRead}
	 * labeled alternative in {@link athenasqlParser#levelOfIsolation}.
	 * @param ctx the parse tree
	 */
	void exitRepeatableRead(athenasqlParser.RepeatableReadContext ctx);
	/**
	 * Enter a parse tree produced by the {@code serializable}
	 * labeled alternative in {@link athenasqlParser#levelOfIsolation}.
	 * @param ctx the parse tree
	 */
	void enterSerializable(athenasqlParser.SerializableContext ctx);
	/**
	 * Exit a parse tree produced by the {@code serializable}
	 * labeled alternative in {@link athenasqlParser#levelOfIsolation}.
	 * @param ctx the parse tree
	 */
	void exitSerializable(athenasqlParser.SerializableContext ctx);
	/**
	 * Enter a parse tree produced by the {@code positionalArgument}
	 * labeled alternative in {@link athenasqlParser#callArgument}.
	 * @param ctx the parse tree
	 */
	void enterPositionalArgument(athenasqlParser.PositionalArgumentContext ctx);
	/**
	 * Exit a parse tree produced by the {@code positionalArgument}
	 * labeled alternative in {@link athenasqlParser#callArgument}.
	 * @param ctx the parse tree
	 */
	void exitPositionalArgument(athenasqlParser.PositionalArgumentContext ctx);
	/**
	 * Enter a parse tree produced by the {@code namedArgument}
	 * labeled alternative in {@link athenasqlParser#callArgument}.
	 * @param ctx the parse tree
	 */
	void enterNamedArgument(athenasqlParser.NamedArgumentContext ctx);
	/**
	 * Exit a parse tree produced by the {@code namedArgument}
	 * labeled alternative in {@link athenasqlParser#callArgument}.
	 * @param ctx the parse tree
	 */
	void exitNamedArgument(athenasqlParser.NamedArgumentContext ctx);
	/**
	 * Enter a parse tree produced by {@link athenasqlParser#privilege}.
	 * @param ctx the parse tree
	 */
	void enterPrivilege(athenasqlParser.PrivilegeContext ctx);
	/**
	 * Exit a parse tree produced by {@link athenasqlParser#privilege}.
	 * @param ctx the parse tree
	 */
	void exitPrivilege(athenasqlParser.PrivilegeContext ctx);
	/**
	 * Enter a parse tree produced by {@link athenasqlParser#qualifiedName}.
	 * @param ctx the parse tree
	 */
	void enterQualifiedName(athenasqlParser.QualifiedNameContext ctx);
	/**
	 * Exit a parse tree produced by {@link athenasqlParser#qualifiedName}.
	 * @param ctx the parse tree
	 */
	void exitQualifiedName(athenasqlParser.QualifiedNameContext ctx);
	/**
	 * Enter a parse tree produced by the {@code unquotedIdentifier}
	 * labeled alternative in {@link athenasqlParser#identifier}.
	 * @param ctx the parse tree
	 */
	void enterUnquotedIdentifier(athenasqlParser.UnquotedIdentifierContext ctx);
	/**
	 * Exit a parse tree produced by the {@code unquotedIdentifier}
	 * labeled alternative in {@link athenasqlParser#identifier}.
	 * @param ctx the parse tree
	 */
	void exitUnquotedIdentifier(athenasqlParser.UnquotedIdentifierContext ctx);
	/**
	 * Enter a parse tree produced by the {@code quotedIdentifierAlternative}
	 * labeled alternative in {@link athenasqlParser#identifier}.
	 * @param ctx the parse tree
	 */
	void enterQuotedIdentifierAlternative(athenasqlParser.QuotedIdentifierAlternativeContext ctx);
	/**
	 * Exit a parse tree produced by the {@code quotedIdentifierAlternative}
	 * labeled alternative in {@link athenasqlParser#identifier}.
	 * @param ctx the parse tree
	 */
	void exitQuotedIdentifierAlternative(athenasqlParser.QuotedIdentifierAlternativeContext ctx);
	/**
	 * Enter a parse tree produced by the {@code backQuotedIdentifier}
	 * labeled alternative in {@link athenasqlParser#identifier}.
	 * @param ctx the parse tree
	 */
	void enterBackQuotedIdentifier(athenasqlParser.BackQuotedIdentifierContext ctx);
	/**
	 * Exit a parse tree produced by the {@code backQuotedIdentifier}
	 * labeled alternative in {@link athenasqlParser#identifier}.
	 * @param ctx the parse tree
	 */
	void exitBackQuotedIdentifier(athenasqlParser.BackQuotedIdentifierContext ctx);
	/**
	 * Enter a parse tree produced by the {@code digitIdentifier}
	 * labeled alternative in {@link athenasqlParser#identifier}.
	 * @param ctx the parse tree
	 */
	void enterDigitIdentifier(athenasqlParser.DigitIdentifierContext ctx);
	/**
	 * Exit a parse tree produced by the {@code digitIdentifier}
	 * labeled alternative in {@link athenasqlParser#identifier}.
	 * @param ctx the parse tree
	 */
	void exitDigitIdentifier(athenasqlParser.DigitIdentifierContext ctx);
	/**
	 * Enter a parse tree produced by {@link athenasqlParser#quotedIdentifier}.
	 * @param ctx the parse tree
	 */
	void enterQuotedIdentifier(athenasqlParser.QuotedIdentifierContext ctx);
	/**
	 * Exit a parse tree produced by {@link athenasqlParser#quotedIdentifier}.
	 * @param ctx the parse tree
	 */
	void exitQuotedIdentifier(athenasqlParser.QuotedIdentifierContext ctx);
	/**
	 * Enter a parse tree produced by the {@code decimalLiteral}
	 * labeled alternative in {@link athenasqlParser#number}.
	 * @param ctx the parse tree
	 */
	void enterDecimalLiteral(athenasqlParser.DecimalLiteralContext ctx);
	/**
	 * Exit a parse tree produced by the {@code decimalLiteral}
	 * labeled alternative in {@link athenasqlParser#number}.
	 * @param ctx the parse tree
	 */
	void exitDecimalLiteral(athenasqlParser.DecimalLiteralContext ctx);
	/**
	 * Enter a parse tree produced by the {@code integerLiteral}
	 * labeled alternative in {@link athenasqlParser#number}.
	 * @param ctx the parse tree
	 */
	void enterIntegerLiteral(athenasqlParser.IntegerLiteralContext ctx);
	/**
	 * Exit a parse tree produced by the {@code integerLiteral}
	 * labeled alternative in {@link athenasqlParser#number}.
	 * @param ctx the parse tree
	 */
	void exitIntegerLiteral(athenasqlParser.IntegerLiteralContext ctx);
	/**
	 * Enter a parse tree produced by {@link athenasqlParser#nonReserved}.
	 * @param ctx the parse tree
	 */
	void enterNonReserved(athenasqlParser.NonReservedContext ctx);
	/**
	 * Exit a parse tree produced by {@link athenasqlParser#nonReserved}.
	 * @param ctx the parse tree
	 */
	void exitNonReserved(athenasqlParser.NonReservedContext ctx);
	/**
	 * Enter a parse tree produced by {@link athenasqlParser#normalForm}.
	 * @param ctx the parse tree
	 */
	void enterNormalForm(athenasqlParser.NormalFormContext ctx);
	/**
	 * Exit a parse tree produced by {@link athenasqlParser#normalForm}.
	 * @param ctx the parse tree
	 */
	void exitNormalForm(athenasqlParser.NormalFormContext ctx);
}
