#![allow(nonstandard_style)]
// Generated from ./grammar/athenasql.g4 by ANTLR 4.8
use antlr_rust::tree::ParseTreeListener;
use super::athenasqlparser::*;

pub trait athenasqlListener<'input> : ParseTreeListener<'input,athenasqlParserContextType>{
/**
 * Enter a parse tree produced by {@link athenasqlParser#program}.
 * @param ctx the parse tree
 */
fn enter_program(&mut self, _ctx: &ProgramContext<'input>) { }
/**
 * Exit a parse tree produced by {@link athenasqlParser#program}.
 * @param ctx the parse tree
 */
fn exit_program(&mut self, _ctx: &ProgramContext<'input>) { }
/**
 * Enter a parse tree produced by {@link athenasqlParser#singleStatement}.
 * @param ctx the parse tree
 */
fn enter_singleStatement(&mut self, _ctx: &SingleStatementContext<'input>) { }
/**
 * Exit a parse tree produced by {@link athenasqlParser#singleStatement}.
 * @param ctx the parse tree
 */
fn exit_singleStatement(&mut self, _ctx: &SingleStatementContext<'input>) { }
/**
 * Enter a parse tree produced by {@link athenasqlParser#singleExpression}.
 * @param ctx the parse tree
 */
fn enter_singleExpression(&mut self, _ctx: &SingleExpressionContext<'input>) { }
/**
 * Exit a parse tree produced by {@link athenasqlParser#singleExpression}.
 * @param ctx the parse tree
 */
fn exit_singleExpression(&mut self, _ctx: &SingleExpressionContext<'input>) { }
/**
 * Enter a parse tree produced by the {@code statementDefault}
 * labeled alternative in {@link athenasqlParser#statement}.
 * @param ctx the parse tree
 */
fn enter_statementDefault(&mut self, _ctx: &StatementDefaultContext<'input>) { }
/**
 * Exit a parse tree produced by the {@code statementDefault}
 * labeled alternative in {@link athenasqlParser#statement}.
 * @param ctx the parse tree
 */
fn exit_statementDefault(&mut self, _ctx: &StatementDefaultContext<'input>) { }
/**
 * Enter a parse tree produced by the {@code use}
 * labeled alternative in {@link athenasqlParser#statement}.
 * @param ctx the parse tree
 */
fn enter_use(&mut self, _ctx: &UseContext<'input>) { }
/**
 * Exit a parse tree produced by the {@code use}
 * labeled alternative in {@link athenasqlParser#statement}.
 * @param ctx the parse tree
 */
fn exit_use(&mut self, _ctx: &UseContext<'input>) { }
/**
 * Enter a parse tree produced by the {@code createSchema}
 * labeled alternative in {@link athenasqlParser#statement}.
 * @param ctx the parse tree
 */
fn enter_createSchema(&mut self, _ctx: &CreateSchemaContext<'input>) { }
/**
 * Exit a parse tree produced by the {@code createSchema}
 * labeled alternative in {@link athenasqlParser#statement}.
 * @param ctx the parse tree
 */
fn exit_createSchema(&mut self, _ctx: &CreateSchemaContext<'input>) { }
/**
 * Enter a parse tree produced by the {@code dropSchema}
 * labeled alternative in {@link athenasqlParser#statement}.
 * @param ctx the parse tree
 */
fn enter_dropSchema(&mut self, _ctx: &DropSchemaContext<'input>) { }
/**
 * Exit a parse tree produced by the {@code dropSchema}
 * labeled alternative in {@link athenasqlParser#statement}.
 * @param ctx the parse tree
 */
fn exit_dropSchema(&mut self, _ctx: &DropSchemaContext<'input>) { }
/**
 * Enter a parse tree produced by the {@code renameSchema}
 * labeled alternative in {@link athenasqlParser#statement}.
 * @param ctx the parse tree
 */
fn enter_renameSchema(&mut self, _ctx: &RenameSchemaContext<'input>) { }
/**
 * Exit a parse tree produced by the {@code renameSchema}
 * labeled alternative in {@link athenasqlParser#statement}.
 * @param ctx the parse tree
 */
fn exit_renameSchema(&mut self, _ctx: &RenameSchemaContext<'input>) { }
/**
 * Enter a parse tree produced by the {@code createTableAsSelect}
 * labeled alternative in {@link athenasqlParser#statement}.
 * @param ctx the parse tree
 */
fn enter_createTableAsSelect(&mut self, _ctx: &CreateTableAsSelectContext<'input>) { }
/**
 * Exit a parse tree produced by the {@code createTableAsSelect}
 * labeled alternative in {@link athenasqlParser#statement}.
 * @param ctx the parse tree
 */
fn exit_createTableAsSelect(&mut self, _ctx: &CreateTableAsSelectContext<'input>) { }
/**
 * Enter a parse tree produced by the {@code createTable}
 * labeled alternative in {@link athenasqlParser#statement}.
 * @param ctx the parse tree
 */
fn enter_createTable(&mut self, _ctx: &CreateTableContext<'input>) { }
/**
 * Exit a parse tree produced by the {@code createTable}
 * labeled alternative in {@link athenasqlParser#statement}.
 * @param ctx the parse tree
 */
fn exit_createTable(&mut self, _ctx: &CreateTableContext<'input>) { }
/**
 * Enter a parse tree produced by the {@code dropTable}
 * labeled alternative in {@link athenasqlParser#statement}.
 * @param ctx the parse tree
 */
fn enter_dropTable(&mut self, _ctx: &DropTableContext<'input>) { }
/**
 * Exit a parse tree produced by the {@code dropTable}
 * labeled alternative in {@link athenasqlParser#statement}.
 * @param ctx the parse tree
 */
fn exit_dropTable(&mut self, _ctx: &DropTableContext<'input>) { }
/**
 * Enter a parse tree produced by the {@code insertInto}
 * labeled alternative in {@link athenasqlParser#statement}.
 * @param ctx the parse tree
 */
fn enter_insertInto(&mut self, _ctx: &InsertIntoContext<'input>) { }
/**
 * Exit a parse tree produced by the {@code insertInto}
 * labeled alternative in {@link athenasqlParser#statement}.
 * @param ctx the parse tree
 */
fn exit_insertInto(&mut self, _ctx: &InsertIntoContext<'input>) { }
/**
 * Enter a parse tree produced by the {@code delete}
 * labeled alternative in {@link athenasqlParser#statement}.
 * @param ctx the parse tree
 */
fn enter_delete(&mut self, _ctx: &DeleteContext<'input>) { }
/**
 * Exit a parse tree produced by the {@code delete}
 * labeled alternative in {@link athenasqlParser#statement}.
 * @param ctx the parse tree
 */
fn exit_delete(&mut self, _ctx: &DeleteContext<'input>) { }
/**
 * Enter a parse tree produced by the {@code renameTable}
 * labeled alternative in {@link athenasqlParser#statement}.
 * @param ctx the parse tree
 */
fn enter_renameTable(&mut self, _ctx: &RenameTableContext<'input>) { }
/**
 * Exit a parse tree produced by the {@code renameTable}
 * labeled alternative in {@link athenasqlParser#statement}.
 * @param ctx the parse tree
 */
fn exit_renameTable(&mut self, _ctx: &RenameTableContext<'input>) { }
/**
 * Enter a parse tree produced by the {@code renameColumn}
 * labeled alternative in {@link athenasqlParser#statement}.
 * @param ctx the parse tree
 */
fn enter_renameColumn(&mut self, _ctx: &RenameColumnContext<'input>) { }
/**
 * Exit a parse tree produced by the {@code renameColumn}
 * labeled alternative in {@link athenasqlParser#statement}.
 * @param ctx the parse tree
 */
fn exit_renameColumn(&mut self, _ctx: &RenameColumnContext<'input>) { }
/**
 * Enter a parse tree produced by the {@code addColumn}
 * labeled alternative in {@link athenasqlParser#statement}.
 * @param ctx the parse tree
 */
fn enter_addColumn(&mut self, _ctx: &AddColumnContext<'input>) { }
/**
 * Exit a parse tree produced by the {@code addColumn}
 * labeled alternative in {@link athenasqlParser#statement}.
 * @param ctx the parse tree
 */
fn exit_addColumn(&mut self, _ctx: &AddColumnContext<'input>) { }
/**
 * Enter a parse tree produced by the {@code createView}
 * labeled alternative in {@link athenasqlParser#statement}.
 * @param ctx the parse tree
 */
fn enter_createView(&mut self, _ctx: &CreateViewContext<'input>) { }
/**
 * Exit a parse tree produced by the {@code createView}
 * labeled alternative in {@link athenasqlParser#statement}.
 * @param ctx the parse tree
 */
fn exit_createView(&mut self, _ctx: &CreateViewContext<'input>) { }
/**
 * Enter a parse tree produced by the {@code dropView}
 * labeled alternative in {@link athenasqlParser#statement}.
 * @param ctx the parse tree
 */
fn enter_dropView(&mut self, _ctx: &DropViewContext<'input>) { }
/**
 * Exit a parse tree produced by the {@code dropView}
 * labeled alternative in {@link athenasqlParser#statement}.
 * @param ctx the parse tree
 */
fn exit_dropView(&mut self, _ctx: &DropViewContext<'input>) { }
/**
 * Enter a parse tree produced by the {@code call}
 * labeled alternative in {@link athenasqlParser#statement}.
 * @param ctx the parse tree
 */
fn enter_call(&mut self, _ctx: &CallContext<'input>) { }
/**
 * Exit a parse tree produced by the {@code call}
 * labeled alternative in {@link athenasqlParser#statement}.
 * @param ctx the parse tree
 */
fn exit_call(&mut self, _ctx: &CallContext<'input>) { }
/**
 * Enter a parse tree produced by the {@code grant}
 * labeled alternative in {@link athenasqlParser#statement}.
 * @param ctx the parse tree
 */
fn enter_grant(&mut self, _ctx: &GrantContext<'input>) { }
/**
 * Exit a parse tree produced by the {@code grant}
 * labeled alternative in {@link athenasqlParser#statement}.
 * @param ctx the parse tree
 */
fn exit_grant(&mut self, _ctx: &GrantContext<'input>) { }
/**
 * Enter a parse tree produced by the {@code revoke}
 * labeled alternative in {@link athenasqlParser#statement}.
 * @param ctx the parse tree
 */
fn enter_revoke(&mut self, _ctx: &RevokeContext<'input>) { }
/**
 * Exit a parse tree produced by the {@code revoke}
 * labeled alternative in {@link athenasqlParser#statement}.
 * @param ctx the parse tree
 */
fn exit_revoke(&mut self, _ctx: &RevokeContext<'input>) { }
/**
 * Enter a parse tree produced by the {@code explain}
 * labeled alternative in {@link athenasqlParser#statement}.
 * @param ctx the parse tree
 */
fn enter_explain(&mut self, _ctx: &ExplainContext<'input>) { }
/**
 * Exit a parse tree produced by the {@code explain}
 * labeled alternative in {@link athenasqlParser#statement}.
 * @param ctx the parse tree
 */
fn exit_explain(&mut self, _ctx: &ExplainContext<'input>) { }
/**
 * Enter a parse tree produced by the {@code showCreateTable}
 * labeled alternative in {@link athenasqlParser#statement}.
 * @param ctx the parse tree
 */
fn enter_showCreateTable(&mut self, _ctx: &ShowCreateTableContext<'input>) { }
/**
 * Exit a parse tree produced by the {@code showCreateTable}
 * labeled alternative in {@link athenasqlParser#statement}.
 * @param ctx the parse tree
 */
fn exit_showCreateTable(&mut self, _ctx: &ShowCreateTableContext<'input>) { }
/**
 * Enter a parse tree produced by the {@code showCreateView}
 * labeled alternative in {@link athenasqlParser#statement}.
 * @param ctx the parse tree
 */
fn enter_showCreateView(&mut self, _ctx: &ShowCreateViewContext<'input>) { }
/**
 * Exit a parse tree produced by the {@code showCreateView}
 * labeled alternative in {@link athenasqlParser#statement}.
 * @param ctx the parse tree
 */
fn exit_showCreateView(&mut self, _ctx: &ShowCreateViewContext<'input>) { }
/**
 * Enter a parse tree produced by the {@code showTables}
 * labeled alternative in {@link athenasqlParser#statement}.
 * @param ctx the parse tree
 */
fn enter_showTables(&mut self, _ctx: &ShowTablesContext<'input>) { }
/**
 * Exit a parse tree produced by the {@code showTables}
 * labeled alternative in {@link athenasqlParser#statement}.
 * @param ctx the parse tree
 */
fn exit_showTables(&mut self, _ctx: &ShowTablesContext<'input>) { }
/**
 * Enter a parse tree produced by the {@code showSchemas}
 * labeled alternative in {@link athenasqlParser#statement}.
 * @param ctx the parse tree
 */
fn enter_showSchemas(&mut self, _ctx: &ShowSchemasContext<'input>) { }
/**
 * Exit a parse tree produced by the {@code showSchemas}
 * labeled alternative in {@link athenasqlParser#statement}.
 * @param ctx the parse tree
 */
fn exit_showSchemas(&mut self, _ctx: &ShowSchemasContext<'input>) { }
/**
 * Enter a parse tree produced by the {@code showCatalogs}
 * labeled alternative in {@link athenasqlParser#statement}.
 * @param ctx the parse tree
 */
fn enter_showCatalogs(&mut self, _ctx: &ShowCatalogsContext<'input>) { }
/**
 * Exit a parse tree produced by the {@code showCatalogs}
 * labeled alternative in {@link athenasqlParser#statement}.
 * @param ctx the parse tree
 */
fn exit_showCatalogs(&mut self, _ctx: &ShowCatalogsContext<'input>) { }
/**
 * Enter a parse tree produced by the {@code showColumns}
 * labeled alternative in {@link athenasqlParser#statement}.
 * @param ctx the parse tree
 */
fn enter_showColumns(&mut self, _ctx: &ShowColumnsContext<'input>) { }
/**
 * Exit a parse tree produced by the {@code showColumns}
 * labeled alternative in {@link athenasqlParser#statement}.
 * @param ctx the parse tree
 */
fn exit_showColumns(&mut self, _ctx: &ShowColumnsContext<'input>) { }
/**
 * Enter a parse tree produced by the {@code showFunctions}
 * labeled alternative in {@link athenasqlParser#statement}.
 * @param ctx the parse tree
 */
fn enter_showFunctions(&mut self, _ctx: &ShowFunctionsContext<'input>) { }
/**
 * Exit a parse tree produced by the {@code showFunctions}
 * labeled alternative in {@link athenasqlParser#statement}.
 * @param ctx the parse tree
 */
fn exit_showFunctions(&mut self, _ctx: &ShowFunctionsContext<'input>) { }
/**
 * Enter a parse tree produced by the {@code showSession}
 * labeled alternative in {@link athenasqlParser#statement}.
 * @param ctx the parse tree
 */
fn enter_showSession(&mut self, _ctx: &ShowSessionContext<'input>) { }
/**
 * Exit a parse tree produced by the {@code showSession}
 * labeled alternative in {@link athenasqlParser#statement}.
 * @param ctx the parse tree
 */
fn exit_showSession(&mut self, _ctx: &ShowSessionContext<'input>) { }
/**
 * Enter a parse tree produced by the {@code setSession}
 * labeled alternative in {@link athenasqlParser#statement}.
 * @param ctx the parse tree
 */
fn enter_setSession(&mut self, _ctx: &SetSessionContext<'input>) { }
/**
 * Exit a parse tree produced by the {@code setSession}
 * labeled alternative in {@link athenasqlParser#statement}.
 * @param ctx the parse tree
 */
fn exit_setSession(&mut self, _ctx: &SetSessionContext<'input>) { }
/**
 * Enter a parse tree produced by the {@code resetSession}
 * labeled alternative in {@link athenasqlParser#statement}.
 * @param ctx the parse tree
 */
fn enter_resetSession(&mut self, _ctx: &ResetSessionContext<'input>) { }
/**
 * Exit a parse tree produced by the {@code resetSession}
 * labeled alternative in {@link athenasqlParser#statement}.
 * @param ctx the parse tree
 */
fn exit_resetSession(&mut self, _ctx: &ResetSessionContext<'input>) { }
/**
 * Enter a parse tree produced by the {@code startTransaction}
 * labeled alternative in {@link athenasqlParser#statement}.
 * @param ctx the parse tree
 */
fn enter_startTransaction(&mut self, _ctx: &StartTransactionContext<'input>) { }
/**
 * Exit a parse tree produced by the {@code startTransaction}
 * labeled alternative in {@link athenasqlParser#statement}.
 * @param ctx the parse tree
 */
fn exit_startTransaction(&mut self, _ctx: &StartTransactionContext<'input>) { }
/**
 * Enter a parse tree produced by the {@code commit}
 * labeled alternative in {@link athenasqlParser#statement}.
 * @param ctx the parse tree
 */
fn enter_commit(&mut self, _ctx: &CommitContext<'input>) { }
/**
 * Exit a parse tree produced by the {@code commit}
 * labeled alternative in {@link athenasqlParser#statement}.
 * @param ctx the parse tree
 */
fn exit_commit(&mut self, _ctx: &CommitContext<'input>) { }
/**
 * Enter a parse tree produced by the {@code rollback}
 * labeled alternative in {@link athenasqlParser#statement}.
 * @param ctx the parse tree
 */
fn enter_rollback(&mut self, _ctx: &RollbackContext<'input>) { }
/**
 * Exit a parse tree produced by the {@code rollback}
 * labeled alternative in {@link athenasqlParser#statement}.
 * @param ctx the parse tree
 */
fn exit_rollback(&mut self, _ctx: &RollbackContext<'input>) { }
/**
 * Enter a parse tree produced by the {@code showPartitions}
 * labeled alternative in {@link athenasqlParser#statement}.
 * @param ctx the parse tree
 */
fn enter_showPartitions(&mut self, _ctx: &ShowPartitionsContext<'input>) { }
/**
 * Exit a parse tree produced by the {@code showPartitions}
 * labeled alternative in {@link athenasqlParser#statement}.
 * @param ctx the parse tree
 */
fn exit_showPartitions(&mut self, _ctx: &ShowPartitionsContext<'input>) { }
/**
 * Enter a parse tree produced by the {@code prepare}
 * labeled alternative in {@link athenasqlParser#statement}.
 * @param ctx the parse tree
 */
fn enter_prepare(&mut self, _ctx: &PrepareContext<'input>) { }
/**
 * Exit a parse tree produced by the {@code prepare}
 * labeled alternative in {@link athenasqlParser#statement}.
 * @param ctx the parse tree
 */
fn exit_prepare(&mut self, _ctx: &PrepareContext<'input>) { }
/**
 * Enter a parse tree produced by the {@code deallocate}
 * labeled alternative in {@link athenasqlParser#statement}.
 * @param ctx the parse tree
 */
fn enter_deallocate(&mut self, _ctx: &DeallocateContext<'input>) { }
/**
 * Exit a parse tree produced by the {@code deallocate}
 * labeled alternative in {@link athenasqlParser#statement}.
 * @param ctx the parse tree
 */
fn exit_deallocate(&mut self, _ctx: &DeallocateContext<'input>) { }
/**
 * Enter a parse tree produced by the {@code execute}
 * labeled alternative in {@link athenasqlParser#statement}.
 * @param ctx the parse tree
 */
fn enter_execute(&mut self, _ctx: &ExecuteContext<'input>) { }
/**
 * Exit a parse tree produced by the {@code execute}
 * labeled alternative in {@link athenasqlParser#statement}.
 * @param ctx the parse tree
 */
fn exit_execute(&mut self, _ctx: &ExecuteContext<'input>) { }
/**
 * Enter a parse tree produced by the {@code describeInput}
 * labeled alternative in {@link athenasqlParser#statement}.
 * @param ctx the parse tree
 */
fn enter_describeInput(&mut self, _ctx: &DescribeInputContext<'input>) { }
/**
 * Exit a parse tree produced by the {@code describeInput}
 * labeled alternative in {@link athenasqlParser#statement}.
 * @param ctx the parse tree
 */
fn exit_describeInput(&mut self, _ctx: &DescribeInputContext<'input>) { }
/**
 * Enter a parse tree produced by the {@code describeOutput}
 * labeled alternative in {@link athenasqlParser#statement}.
 * @param ctx the parse tree
 */
fn enter_describeOutput(&mut self, _ctx: &DescribeOutputContext<'input>) { }
/**
 * Exit a parse tree produced by the {@code describeOutput}
 * labeled alternative in {@link athenasqlParser#statement}.
 * @param ctx the parse tree
 */
fn exit_describeOutput(&mut self, _ctx: &DescribeOutputContext<'input>) { }
/**
 * Enter a parse tree produced by {@link athenasqlParser#query}.
 * @param ctx the parse tree
 */
fn enter_query(&mut self, _ctx: &QueryContext<'input>) { }
/**
 * Exit a parse tree produced by {@link athenasqlParser#query}.
 * @param ctx the parse tree
 */
fn exit_query(&mut self, _ctx: &QueryContext<'input>) { }
/**
 * Enter a parse tree produced by {@link athenasqlParser#js_with}.
 * @param ctx the parse tree
 */
fn enter_js_with(&mut self, _ctx: &Js_withContext<'input>) { }
/**
 * Exit a parse tree produced by {@link athenasqlParser#js_with}.
 * @param ctx the parse tree
 */
fn exit_js_with(&mut self, _ctx: &Js_withContext<'input>) { }
/**
 * Enter a parse tree produced by {@link athenasqlParser#tableElement}.
 * @param ctx the parse tree
 */
fn enter_tableElement(&mut self, _ctx: &TableElementContext<'input>) { }
/**
 * Exit a parse tree produced by {@link athenasqlParser#tableElement}.
 * @param ctx the parse tree
 */
fn exit_tableElement(&mut self, _ctx: &TableElementContext<'input>) { }
/**
 * Enter a parse tree produced by {@link athenasqlParser#columnDefinition}.
 * @param ctx the parse tree
 */
fn enter_columnDefinition(&mut self, _ctx: &ColumnDefinitionContext<'input>) { }
/**
 * Exit a parse tree produced by {@link athenasqlParser#columnDefinition}.
 * @param ctx the parse tree
 */
fn exit_columnDefinition(&mut self, _ctx: &ColumnDefinitionContext<'input>) { }
/**
 * Enter a parse tree produced by {@link athenasqlParser#likeClause}.
 * @param ctx the parse tree
 */
fn enter_likeClause(&mut self, _ctx: &LikeClauseContext<'input>) { }
/**
 * Exit a parse tree produced by {@link athenasqlParser#likeClause}.
 * @param ctx the parse tree
 */
fn exit_likeClause(&mut self, _ctx: &LikeClauseContext<'input>) { }
/**
 * Enter a parse tree produced by {@link athenasqlParser#tableProperties}.
 * @param ctx the parse tree
 */
fn enter_tableProperties(&mut self, _ctx: &TablePropertiesContext<'input>) { }
/**
 * Exit a parse tree produced by {@link athenasqlParser#tableProperties}.
 * @param ctx the parse tree
 */
fn exit_tableProperties(&mut self, _ctx: &TablePropertiesContext<'input>) { }
/**
 * Enter a parse tree produced by {@link athenasqlParser#tableProperty}.
 * @param ctx the parse tree
 */
fn enter_tableProperty(&mut self, _ctx: &TablePropertyContext<'input>) { }
/**
 * Exit a parse tree produced by {@link athenasqlParser#tableProperty}.
 * @param ctx the parse tree
 */
fn exit_tableProperty(&mut self, _ctx: &TablePropertyContext<'input>) { }
/**
 * Enter a parse tree produced by {@link athenasqlParser#queryNoWith}.
 * @param ctx the parse tree
 */
fn enter_queryNoWith(&mut self, _ctx: &QueryNoWithContext<'input>) { }
/**
 * Exit a parse tree produced by {@link athenasqlParser#queryNoWith}.
 * @param ctx the parse tree
 */
fn exit_queryNoWith(&mut self, _ctx: &QueryNoWithContext<'input>) { }
/**
 * Enter a parse tree produced by the {@code queryTermDefault}
 * labeled alternative in {@link athenasqlParser#queryTerm}.
 * @param ctx the parse tree
 */
fn enter_queryTermDefault(&mut self, _ctx: &QueryTermDefaultContext<'input>) { }
/**
 * Exit a parse tree produced by the {@code queryTermDefault}
 * labeled alternative in {@link athenasqlParser#queryTerm}.
 * @param ctx the parse tree
 */
fn exit_queryTermDefault(&mut self, _ctx: &QueryTermDefaultContext<'input>) { }
/**
 * Enter a parse tree produced by the {@code setOperation}
 * labeled alternative in {@link athenasqlParser#queryTerm}.
 * @param ctx the parse tree
 */
fn enter_setOperation(&mut self, _ctx: &SetOperationContext<'input>) { }
/**
 * Exit a parse tree produced by the {@code setOperation}
 * labeled alternative in {@link athenasqlParser#queryTerm}.
 * @param ctx the parse tree
 */
fn exit_setOperation(&mut self, _ctx: &SetOperationContext<'input>) { }
/**
 * Enter a parse tree produced by the {@code queryPrimaryDefault}
 * labeled alternative in {@link athenasqlParser#queryPrimary}.
 * @param ctx the parse tree
 */
fn enter_queryPrimaryDefault(&mut self, _ctx: &QueryPrimaryDefaultContext<'input>) { }
/**
 * Exit a parse tree produced by the {@code queryPrimaryDefault}
 * labeled alternative in {@link athenasqlParser#queryPrimary}.
 * @param ctx the parse tree
 */
fn exit_queryPrimaryDefault(&mut self, _ctx: &QueryPrimaryDefaultContext<'input>) { }
/**
 * Enter a parse tree produced by the {@code table}
 * labeled alternative in {@link athenasqlParser#queryPrimary}.
 * @param ctx the parse tree
 */
fn enter_table(&mut self, _ctx: &TableContext<'input>) { }
/**
 * Exit a parse tree produced by the {@code table}
 * labeled alternative in {@link athenasqlParser#queryPrimary}.
 * @param ctx the parse tree
 */
fn exit_table(&mut self, _ctx: &TableContext<'input>) { }
/**
 * Enter a parse tree produced by the {@code inlineTable}
 * labeled alternative in {@link athenasqlParser#queryPrimary}.
 * @param ctx the parse tree
 */
fn enter_inlineTable(&mut self, _ctx: &InlineTableContext<'input>) { }
/**
 * Exit a parse tree produced by the {@code inlineTable}
 * labeled alternative in {@link athenasqlParser#queryPrimary}.
 * @param ctx the parse tree
 */
fn exit_inlineTable(&mut self, _ctx: &InlineTableContext<'input>) { }
/**
 * Enter a parse tree produced by the {@code subquery}
 * labeled alternative in {@link athenasqlParser#queryPrimary}.
 * @param ctx the parse tree
 */
fn enter_subquery(&mut self, _ctx: &SubqueryContext<'input>) { }
/**
 * Exit a parse tree produced by the {@code subquery}
 * labeled alternative in {@link athenasqlParser#queryPrimary}.
 * @param ctx the parse tree
 */
fn exit_subquery(&mut self, _ctx: &SubqueryContext<'input>) { }
/**
 * Enter a parse tree produced by {@link athenasqlParser#sortItem}.
 * @param ctx the parse tree
 */
fn enter_sortItem(&mut self, _ctx: &SortItemContext<'input>) { }
/**
 * Exit a parse tree produced by {@link athenasqlParser#sortItem}.
 * @param ctx the parse tree
 */
fn exit_sortItem(&mut self, _ctx: &SortItemContext<'input>) { }
/**
 * Enter a parse tree produced by {@link athenasqlParser#querySpecification}.
 * @param ctx the parse tree
 */
fn enter_querySpecification(&mut self, _ctx: &QuerySpecificationContext<'input>) { }
/**
 * Exit a parse tree produced by {@link athenasqlParser#querySpecification}.
 * @param ctx the parse tree
 */
fn exit_querySpecification(&mut self, _ctx: &QuerySpecificationContext<'input>) { }
/**
 * Enter a parse tree produced by {@link athenasqlParser#groupBy}.
 * @param ctx the parse tree
 */
fn enter_groupBy(&mut self, _ctx: &GroupByContext<'input>) { }
/**
 * Exit a parse tree produced by {@link athenasqlParser#groupBy}.
 * @param ctx the parse tree
 */
fn exit_groupBy(&mut self, _ctx: &GroupByContext<'input>) { }
/**
 * Enter a parse tree produced by the {@code singleGroupingSet}
 * labeled alternative in {@link athenasqlParser#groupingElement}.
 * @param ctx the parse tree
 */
fn enter_singleGroupingSet(&mut self, _ctx: &SingleGroupingSetContext<'input>) { }
/**
 * Exit a parse tree produced by the {@code singleGroupingSet}
 * labeled alternative in {@link athenasqlParser#groupingElement}.
 * @param ctx the parse tree
 */
fn exit_singleGroupingSet(&mut self, _ctx: &SingleGroupingSetContext<'input>) { }
/**
 * Enter a parse tree produced by the {@code rollup}
 * labeled alternative in {@link athenasqlParser#groupingElement}.
 * @param ctx the parse tree
 */
fn enter_rollup(&mut self, _ctx: &RollupContext<'input>) { }
/**
 * Exit a parse tree produced by the {@code rollup}
 * labeled alternative in {@link athenasqlParser#groupingElement}.
 * @param ctx the parse tree
 */
fn exit_rollup(&mut self, _ctx: &RollupContext<'input>) { }
/**
 * Enter a parse tree produced by the {@code cube}
 * labeled alternative in {@link athenasqlParser#groupingElement}.
 * @param ctx the parse tree
 */
fn enter_cube(&mut self, _ctx: &CubeContext<'input>) { }
/**
 * Exit a parse tree produced by the {@code cube}
 * labeled alternative in {@link athenasqlParser#groupingElement}.
 * @param ctx the parse tree
 */
fn exit_cube(&mut self, _ctx: &CubeContext<'input>) { }
/**
 * Enter a parse tree produced by the {@code multipleGroupingSets}
 * labeled alternative in {@link athenasqlParser#groupingElement}.
 * @param ctx the parse tree
 */
fn enter_multipleGroupingSets(&mut self, _ctx: &MultipleGroupingSetsContext<'input>) { }
/**
 * Exit a parse tree produced by the {@code multipleGroupingSets}
 * labeled alternative in {@link athenasqlParser#groupingElement}.
 * @param ctx the parse tree
 */
fn exit_multipleGroupingSets(&mut self, _ctx: &MultipleGroupingSetsContext<'input>) { }
/**
 * Enter a parse tree produced by {@link athenasqlParser#groupingExpressions}.
 * @param ctx the parse tree
 */
fn enter_groupingExpressions(&mut self, _ctx: &GroupingExpressionsContext<'input>) { }
/**
 * Exit a parse tree produced by {@link athenasqlParser#groupingExpressions}.
 * @param ctx the parse tree
 */
fn exit_groupingExpressions(&mut self, _ctx: &GroupingExpressionsContext<'input>) { }
/**
 * Enter a parse tree produced by {@link athenasqlParser#groupingSet}.
 * @param ctx the parse tree
 */
fn enter_groupingSet(&mut self, _ctx: &GroupingSetContext<'input>) { }
/**
 * Exit a parse tree produced by {@link athenasqlParser#groupingSet}.
 * @param ctx the parse tree
 */
fn exit_groupingSet(&mut self, _ctx: &GroupingSetContext<'input>) { }
/**
 * Enter a parse tree produced by {@link athenasqlParser#namedQuery}.
 * @param ctx the parse tree
 */
fn enter_namedQuery(&mut self, _ctx: &NamedQueryContext<'input>) { }
/**
 * Exit a parse tree produced by {@link athenasqlParser#namedQuery}.
 * @param ctx the parse tree
 */
fn exit_namedQuery(&mut self, _ctx: &NamedQueryContext<'input>) { }
/**
 * Enter a parse tree produced by {@link athenasqlParser#setQuantifier}.
 * @param ctx the parse tree
 */
fn enter_setQuantifier(&mut self, _ctx: &SetQuantifierContext<'input>) { }
/**
 * Exit a parse tree produced by {@link athenasqlParser#setQuantifier}.
 * @param ctx the parse tree
 */
fn exit_setQuantifier(&mut self, _ctx: &SetQuantifierContext<'input>) { }
/**
 * Enter a parse tree produced by the {@code selectSingle}
 * labeled alternative in {@link athenasqlParser#selectItem}.
 * @param ctx the parse tree
 */
fn enter_selectSingle(&mut self, _ctx: &SelectSingleContext<'input>) { }
/**
 * Exit a parse tree produced by the {@code selectSingle}
 * labeled alternative in {@link athenasqlParser#selectItem}.
 * @param ctx the parse tree
 */
fn exit_selectSingle(&mut self, _ctx: &SelectSingleContext<'input>) { }
/**
 * Enter a parse tree produced by the {@code selectAll}
 * labeled alternative in {@link athenasqlParser#selectItem}.
 * @param ctx the parse tree
 */
fn enter_selectAll(&mut self, _ctx: &SelectAllContext<'input>) { }
/**
 * Exit a parse tree produced by the {@code selectAll}
 * labeled alternative in {@link athenasqlParser#selectItem}.
 * @param ctx the parse tree
 */
fn exit_selectAll(&mut self, _ctx: &SelectAllContext<'input>) { }
/**
 * Enter a parse tree produced by the {@code relationDefault}
 * labeled alternative in {@link athenasqlParser#relation}.
 * @param ctx the parse tree
 */
fn enter_relationDefault(&mut self, _ctx: &RelationDefaultContext<'input>) { }
/**
 * Exit a parse tree produced by the {@code relationDefault}
 * labeled alternative in {@link athenasqlParser#relation}.
 * @param ctx the parse tree
 */
fn exit_relationDefault(&mut self, _ctx: &RelationDefaultContext<'input>) { }
/**
 * Enter a parse tree produced by the {@code joinRelation}
 * labeled alternative in {@link athenasqlParser#relation}.
 * @param ctx the parse tree
 */
fn enter_joinRelation(&mut self, _ctx: &JoinRelationContext<'input>) { }
/**
 * Exit a parse tree produced by the {@code joinRelation}
 * labeled alternative in {@link athenasqlParser#relation}.
 * @param ctx the parse tree
 */
fn exit_joinRelation(&mut self, _ctx: &JoinRelationContext<'input>) { }
/**
 * Enter a parse tree produced by {@link athenasqlParser#joinType}.
 * @param ctx the parse tree
 */
fn enter_joinType(&mut self, _ctx: &JoinTypeContext<'input>) { }
/**
 * Exit a parse tree produced by {@link athenasqlParser#joinType}.
 * @param ctx the parse tree
 */
fn exit_joinType(&mut self, _ctx: &JoinTypeContext<'input>) { }
/**
 * Enter a parse tree produced by {@link athenasqlParser#joinCriteria}.
 * @param ctx the parse tree
 */
fn enter_joinCriteria(&mut self, _ctx: &JoinCriteriaContext<'input>) { }
/**
 * Exit a parse tree produced by {@link athenasqlParser#joinCriteria}.
 * @param ctx the parse tree
 */
fn exit_joinCriteria(&mut self, _ctx: &JoinCriteriaContext<'input>) { }
/**
 * Enter a parse tree produced by {@link athenasqlParser#sampledRelation}.
 * @param ctx the parse tree
 */
fn enter_sampledRelation(&mut self, _ctx: &SampledRelationContext<'input>) { }
/**
 * Exit a parse tree produced by {@link athenasqlParser#sampledRelation}.
 * @param ctx the parse tree
 */
fn exit_sampledRelation(&mut self, _ctx: &SampledRelationContext<'input>) { }
/**
 * Enter a parse tree produced by {@link athenasqlParser#sampleType}.
 * @param ctx the parse tree
 */
fn enter_sampleType(&mut self, _ctx: &SampleTypeContext<'input>) { }
/**
 * Exit a parse tree produced by {@link athenasqlParser#sampleType}.
 * @param ctx the parse tree
 */
fn exit_sampleType(&mut self, _ctx: &SampleTypeContext<'input>) { }
/**
 * Enter a parse tree produced by {@link athenasqlParser#aliasedRelation}.
 * @param ctx the parse tree
 */
fn enter_aliasedRelation(&mut self, _ctx: &AliasedRelationContext<'input>) { }
/**
 * Exit a parse tree produced by {@link athenasqlParser#aliasedRelation}.
 * @param ctx the parse tree
 */
fn exit_aliasedRelation(&mut self, _ctx: &AliasedRelationContext<'input>) { }
/**
 * Enter a parse tree produced by {@link athenasqlParser#columnAliases}.
 * @param ctx the parse tree
 */
fn enter_columnAliases(&mut self, _ctx: &ColumnAliasesContext<'input>) { }
/**
 * Exit a parse tree produced by {@link athenasqlParser#columnAliases}.
 * @param ctx the parse tree
 */
fn exit_columnAliases(&mut self, _ctx: &ColumnAliasesContext<'input>) { }
/**
 * Enter a parse tree produced by the {@code tableName}
 * labeled alternative in {@link athenasqlParser#relationPrimary}.
 * @param ctx the parse tree
 */
fn enter_tableName(&mut self, _ctx: &TableNameContext<'input>) { }
/**
 * Exit a parse tree produced by the {@code tableName}
 * labeled alternative in {@link athenasqlParser#relationPrimary}.
 * @param ctx the parse tree
 */
fn exit_tableName(&mut self, _ctx: &TableNameContext<'input>) { }
/**
 * Enter a parse tree produced by the {@code subqueryRelation}
 * labeled alternative in {@link athenasqlParser#relationPrimary}.
 * @param ctx the parse tree
 */
fn enter_subqueryRelation(&mut self, _ctx: &SubqueryRelationContext<'input>) { }
/**
 * Exit a parse tree produced by the {@code subqueryRelation}
 * labeled alternative in {@link athenasqlParser#relationPrimary}.
 * @param ctx the parse tree
 */
fn exit_subqueryRelation(&mut self, _ctx: &SubqueryRelationContext<'input>) { }
/**
 * Enter a parse tree produced by the {@code unnest}
 * labeled alternative in {@link athenasqlParser#relationPrimary}.
 * @param ctx the parse tree
 */
fn enter_unnest(&mut self, _ctx: &UnnestContext<'input>) { }
/**
 * Exit a parse tree produced by the {@code unnest}
 * labeled alternative in {@link athenasqlParser#relationPrimary}.
 * @param ctx the parse tree
 */
fn exit_unnest(&mut self, _ctx: &UnnestContext<'input>) { }
/**
 * Enter a parse tree produced by the {@code parenthesizedRelation}
 * labeled alternative in {@link athenasqlParser#relationPrimary}.
 * @param ctx the parse tree
 */
fn enter_parenthesizedRelation(&mut self, _ctx: &ParenthesizedRelationContext<'input>) { }
/**
 * Exit a parse tree produced by the {@code parenthesizedRelation}
 * labeled alternative in {@link athenasqlParser#relationPrimary}.
 * @param ctx the parse tree
 */
fn exit_parenthesizedRelation(&mut self, _ctx: &ParenthesizedRelationContext<'input>) { }
/**
 * Enter a parse tree produced by {@link athenasqlParser#tableReference}.
 * @param ctx the parse tree
 */
fn enter_tableReference(&mut self, _ctx: &TableReferenceContext<'input>) { }
/**
 * Exit a parse tree produced by {@link athenasqlParser#tableReference}.
 * @param ctx the parse tree
 */
fn exit_tableReference(&mut self, _ctx: &TableReferenceContext<'input>) { }
/**
 * Enter a parse tree produced by {@link athenasqlParser#expression}.
 * @param ctx the parse tree
 */
fn enter_expression(&mut self, _ctx: &ExpressionContext<'input>) { }
/**
 * Exit a parse tree produced by {@link athenasqlParser#expression}.
 * @param ctx the parse tree
 */
fn exit_expression(&mut self, _ctx: &ExpressionContext<'input>) { }
/**
 * Enter a parse tree produced by the {@code logicalNot}
 * labeled alternative in {@link athenasqlParser#booleanExpression}.
 * @param ctx the parse tree
 */
fn enter_logicalNot(&mut self, _ctx: &LogicalNotContext<'input>) { }
/**
 * Exit a parse tree produced by the {@code logicalNot}
 * labeled alternative in {@link athenasqlParser#booleanExpression}.
 * @param ctx the parse tree
 */
fn exit_logicalNot(&mut self, _ctx: &LogicalNotContext<'input>) { }
/**
 * Enter a parse tree produced by the {@code booleanDefault}
 * labeled alternative in {@link athenasqlParser#booleanExpression}.
 * @param ctx the parse tree
 */
fn enter_booleanDefault(&mut self, _ctx: &BooleanDefaultContext<'input>) { }
/**
 * Exit a parse tree produced by the {@code booleanDefault}
 * labeled alternative in {@link athenasqlParser#booleanExpression}.
 * @param ctx the parse tree
 */
fn exit_booleanDefault(&mut self, _ctx: &BooleanDefaultContext<'input>) { }
/**
 * Enter a parse tree produced by the {@code logicalBinary}
 * labeled alternative in {@link athenasqlParser#booleanExpression}.
 * @param ctx the parse tree
 */
fn enter_logicalBinary(&mut self, _ctx: &LogicalBinaryContext<'input>) { }
/**
 * Exit a parse tree produced by the {@code logicalBinary}
 * labeled alternative in {@link athenasqlParser#booleanExpression}.
 * @param ctx the parse tree
 */
fn exit_logicalBinary(&mut self, _ctx: &LogicalBinaryContext<'input>) { }
/**
 * Enter a parse tree produced by {@link athenasqlParser#predicated}.
 * @param ctx the parse tree
 */
fn enter_predicated(&mut self, _ctx: &PredicatedContext<'input>) { }
/**
 * Exit a parse tree produced by {@link athenasqlParser#predicated}.
 * @param ctx the parse tree
 */
fn exit_predicated(&mut self, _ctx: &PredicatedContext<'input>) { }
/**
 * Enter a parse tree produced by the {@code comparison}
 * labeled alternative in {@link athenasqlParser#predicate}.
 * @param ctx the parse tree
 */
fn enter_comparison(&mut self, _ctx: &ComparisonContext<'input>) { }
/**
 * Exit a parse tree produced by the {@code comparison}
 * labeled alternative in {@link athenasqlParser#predicate}.
 * @param ctx the parse tree
 */
fn exit_comparison(&mut self, _ctx: &ComparisonContext<'input>) { }
/**
 * Enter a parse tree produced by the {@code quantifiedComparison}
 * labeled alternative in {@link athenasqlParser#predicate}.
 * @param ctx the parse tree
 */
fn enter_quantifiedComparison(&mut self, _ctx: &QuantifiedComparisonContext<'input>) { }
/**
 * Exit a parse tree produced by the {@code quantifiedComparison}
 * labeled alternative in {@link athenasqlParser#predicate}.
 * @param ctx the parse tree
 */
fn exit_quantifiedComparison(&mut self, _ctx: &QuantifiedComparisonContext<'input>) { }
/**
 * Enter a parse tree produced by the {@code between}
 * labeled alternative in {@link athenasqlParser#predicate}.
 * @param ctx the parse tree
 */
fn enter_between(&mut self, _ctx: &BetweenContext<'input>) { }
/**
 * Exit a parse tree produced by the {@code between}
 * labeled alternative in {@link athenasqlParser#predicate}.
 * @param ctx the parse tree
 */
fn exit_between(&mut self, _ctx: &BetweenContext<'input>) { }
/**
 * Enter a parse tree produced by the {@code inList}
 * labeled alternative in {@link athenasqlParser#predicate}.
 * @param ctx the parse tree
 */
fn enter_inList(&mut self, _ctx: &InListContext<'input>) { }
/**
 * Exit a parse tree produced by the {@code inList}
 * labeled alternative in {@link athenasqlParser#predicate}.
 * @param ctx the parse tree
 */
fn exit_inList(&mut self, _ctx: &InListContext<'input>) { }
/**
 * Enter a parse tree produced by the {@code inSubquery}
 * labeled alternative in {@link athenasqlParser#predicate}.
 * @param ctx the parse tree
 */
fn enter_inSubquery(&mut self, _ctx: &InSubqueryContext<'input>) { }
/**
 * Exit a parse tree produced by the {@code inSubquery}
 * labeled alternative in {@link athenasqlParser#predicate}.
 * @param ctx the parse tree
 */
fn exit_inSubquery(&mut self, _ctx: &InSubqueryContext<'input>) { }
/**
 * Enter a parse tree produced by the {@code like}
 * labeled alternative in {@link athenasqlParser#predicate}.
 * @param ctx the parse tree
 */
fn enter_like(&mut self, _ctx: &LikeContext<'input>) { }
/**
 * Exit a parse tree produced by the {@code like}
 * labeled alternative in {@link athenasqlParser#predicate}.
 * @param ctx the parse tree
 */
fn exit_like(&mut self, _ctx: &LikeContext<'input>) { }
/**
 * Enter a parse tree produced by the {@code nullPredicate}
 * labeled alternative in {@link athenasqlParser#predicate}.
 * @param ctx the parse tree
 */
fn enter_nullPredicate(&mut self, _ctx: &NullPredicateContext<'input>) { }
/**
 * Exit a parse tree produced by the {@code nullPredicate}
 * labeled alternative in {@link athenasqlParser#predicate}.
 * @param ctx the parse tree
 */
fn exit_nullPredicate(&mut self, _ctx: &NullPredicateContext<'input>) { }
/**
 * Enter a parse tree produced by the {@code distinctFrom}
 * labeled alternative in {@link athenasqlParser#predicate}.
 * @param ctx the parse tree
 */
fn enter_distinctFrom(&mut self, _ctx: &DistinctFromContext<'input>) { }
/**
 * Exit a parse tree produced by the {@code distinctFrom}
 * labeled alternative in {@link athenasqlParser#predicate}.
 * @param ctx the parse tree
 */
fn exit_distinctFrom(&mut self, _ctx: &DistinctFromContext<'input>) { }
/**
 * Enter a parse tree produced by the {@code valueExpressionDefault}
 * labeled alternative in {@link athenasqlParser#valueExpression}.
 * @param ctx the parse tree
 */
fn enter_valueExpressionDefault(&mut self, _ctx: &ValueExpressionDefaultContext<'input>) { }
/**
 * Exit a parse tree produced by the {@code valueExpressionDefault}
 * labeled alternative in {@link athenasqlParser#valueExpression}.
 * @param ctx the parse tree
 */
fn exit_valueExpressionDefault(&mut self, _ctx: &ValueExpressionDefaultContext<'input>) { }
/**
 * Enter a parse tree produced by the {@code concatenation}
 * labeled alternative in {@link athenasqlParser#valueExpression}.
 * @param ctx the parse tree
 */
fn enter_concatenation(&mut self, _ctx: &ConcatenationContext<'input>) { }
/**
 * Exit a parse tree produced by the {@code concatenation}
 * labeled alternative in {@link athenasqlParser#valueExpression}.
 * @param ctx the parse tree
 */
fn exit_concatenation(&mut self, _ctx: &ConcatenationContext<'input>) { }
/**
 * Enter a parse tree produced by the {@code arithmeticBinary}
 * labeled alternative in {@link athenasqlParser#valueExpression}.
 * @param ctx the parse tree
 */
fn enter_arithmeticBinary(&mut self, _ctx: &ArithmeticBinaryContext<'input>) { }
/**
 * Exit a parse tree produced by the {@code arithmeticBinary}
 * labeled alternative in {@link athenasqlParser#valueExpression}.
 * @param ctx the parse tree
 */
fn exit_arithmeticBinary(&mut self, _ctx: &ArithmeticBinaryContext<'input>) { }
/**
 * Enter a parse tree produced by the {@code arithmeticUnary}
 * labeled alternative in {@link athenasqlParser#valueExpression}.
 * @param ctx the parse tree
 */
fn enter_arithmeticUnary(&mut self, _ctx: &ArithmeticUnaryContext<'input>) { }
/**
 * Exit a parse tree produced by the {@code arithmeticUnary}
 * labeled alternative in {@link athenasqlParser#valueExpression}.
 * @param ctx the parse tree
 */
fn exit_arithmeticUnary(&mut self, _ctx: &ArithmeticUnaryContext<'input>) { }
/**
 * Enter a parse tree produced by the {@code atTimeZone}
 * labeled alternative in {@link athenasqlParser#valueExpression}.
 * @param ctx the parse tree
 */
fn enter_atTimeZone(&mut self, _ctx: &AtTimeZoneContext<'input>) { }
/**
 * Exit a parse tree produced by the {@code atTimeZone}
 * labeled alternative in {@link athenasqlParser#valueExpression}.
 * @param ctx the parse tree
 */
fn exit_atTimeZone(&mut self, _ctx: &AtTimeZoneContext<'input>) { }
/**
 * Enter a parse tree produced by {@link athenasqlParser#columnReference}.
 * @param ctx the parse tree
 */
fn enter_columnReference(&mut self, _ctx: &ColumnReferenceContext<'input>) { }
/**
 * Exit a parse tree produced by {@link athenasqlParser#columnReference}.
 * @param ctx the parse tree
 */
fn exit_columnReference(&mut self, _ctx: &ColumnReferenceContext<'input>) { }
/**
 * Enter a parse tree produced by the {@code dereference}
 * labeled alternative in {@link athenasqlParser#primaryExpression}.
 * @param ctx the parse tree
 */
fn enter_dereference(&mut self, _ctx: &DereferenceContext<'input>) { }
/**
 * Exit a parse tree produced by the {@code dereference}
 * labeled alternative in {@link athenasqlParser#primaryExpression}.
 * @param ctx the parse tree
 */
fn exit_dereference(&mut self, _ctx: &DereferenceContext<'input>) { }
/**
 * Enter a parse tree produced by the {@code typeConstructor}
 * labeled alternative in {@link athenasqlParser#primaryExpression}.
 * @param ctx the parse tree
 */
fn enter_typeConstructor(&mut self, _ctx: &TypeConstructorContext<'input>) { }
/**
 * Exit a parse tree produced by the {@code typeConstructor}
 * labeled alternative in {@link athenasqlParser#primaryExpression}.
 * @param ctx the parse tree
 */
fn exit_typeConstructor(&mut self, _ctx: &TypeConstructorContext<'input>) { }
/**
 * Enter a parse tree produced by the {@code specialDateTimeFunction}
 * labeled alternative in {@link athenasqlParser#primaryExpression}.
 * @param ctx the parse tree
 */
fn enter_specialDateTimeFunction(&mut self, _ctx: &SpecialDateTimeFunctionContext<'input>) { }
/**
 * Exit a parse tree produced by the {@code specialDateTimeFunction}
 * labeled alternative in {@link athenasqlParser#primaryExpression}.
 * @param ctx the parse tree
 */
fn exit_specialDateTimeFunction(&mut self, _ctx: &SpecialDateTimeFunctionContext<'input>) { }
/**
 * Enter a parse tree produced by the {@code substring}
 * labeled alternative in {@link athenasqlParser#primaryExpression}.
 * @param ctx the parse tree
 */
fn enter_substring(&mut self, _ctx: &SubstringContext<'input>) { }
/**
 * Exit a parse tree produced by the {@code substring}
 * labeled alternative in {@link athenasqlParser#primaryExpression}.
 * @param ctx the parse tree
 */
fn exit_substring(&mut self, _ctx: &SubstringContext<'input>) { }
/**
 * Enter a parse tree produced by the {@code cast}
 * labeled alternative in {@link athenasqlParser#primaryExpression}.
 * @param ctx the parse tree
 */
fn enter_cast(&mut self, _ctx: &CastContext<'input>) { }
/**
 * Exit a parse tree produced by the {@code cast}
 * labeled alternative in {@link athenasqlParser#primaryExpression}.
 * @param ctx the parse tree
 */
fn exit_cast(&mut self, _ctx: &CastContext<'input>) { }
/**
 * Enter a parse tree produced by the {@code lambda}
 * labeled alternative in {@link athenasqlParser#primaryExpression}.
 * @param ctx the parse tree
 */
fn enter_lambda(&mut self, _ctx: &LambdaContext<'input>) { }
/**
 * Exit a parse tree produced by the {@code lambda}
 * labeled alternative in {@link athenasqlParser#primaryExpression}.
 * @param ctx the parse tree
 */
fn exit_lambda(&mut self, _ctx: &LambdaContext<'input>) { }
/**
 * Enter a parse tree produced by the {@code parenthesizedExpression}
 * labeled alternative in {@link athenasqlParser#primaryExpression}.
 * @param ctx the parse tree
 */
fn enter_parenthesizedExpression(&mut self, _ctx: &ParenthesizedExpressionContext<'input>) { }
/**
 * Exit a parse tree produced by the {@code parenthesizedExpression}
 * labeled alternative in {@link athenasqlParser#primaryExpression}.
 * @param ctx the parse tree
 */
fn exit_parenthesizedExpression(&mut self, _ctx: &ParenthesizedExpressionContext<'input>) { }
/**
 * Enter a parse tree produced by the {@code parameter}
 * labeled alternative in {@link athenasqlParser#primaryExpression}.
 * @param ctx the parse tree
 */
fn enter_parameter(&mut self, _ctx: &ParameterContext<'input>) { }
/**
 * Exit a parse tree produced by the {@code parameter}
 * labeled alternative in {@link athenasqlParser#primaryExpression}.
 * @param ctx the parse tree
 */
fn exit_parameter(&mut self, _ctx: &ParameterContext<'input>) { }
/**
 * Enter a parse tree produced by the {@code normalize}
 * labeled alternative in {@link athenasqlParser#primaryExpression}.
 * @param ctx the parse tree
 */
fn enter_normalize(&mut self, _ctx: &NormalizeContext<'input>) { }
/**
 * Exit a parse tree produced by the {@code normalize}
 * labeled alternative in {@link athenasqlParser#primaryExpression}.
 * @param ctx the parse tree
 */
fn exit_normalize(&mut self, _ctx: &NormalizeContext<'input>) { }
/**
 * Enter a parse tree produced by the {@code intervalLiteral}
 * labeled alternative in {@link athenasqlParser#primaryExpression}.
 * @param ctx the parse tree
 */
fn enter_intervalLiteral(&mut self, _ctx: &IntervalLiteralContext<'input>) { }
/**
 * Exit a parse tree produced by the {@code intervalLiteral}
 * labeled alternative in {@link athenasqlParser#primaryExpression}.
 * @param ctx the parse tree
 */
fn exit_intervalLiteral(&mut self, _ctx: &IntervalLiteralContext<'input>) { }
/**
 * Enter a parse tree produced by the {@code numericLiteral}
 * labeled alternative in {@link athenasqlParser#primaryExpression}.
 * @param ctx the parse tree
 */
fn enter_numericLiteral(&mut self, _ctx: &NumericLiteralContext<'input>) { }
/**
 * Exit a parse tree produced by the {@code numericLiteral}
 * labeled alternative in {@link athenasqlParser#primaryExpression}.
 * @param ctx the parse tree
 */
fn exit_numericLiteral(&mut self, _ctx: &NumericLiteralContext<'input>) { }
/**
 * Enter a parse tree produced by the {@code booleanLiteral}
 * labeled alternative in {@link athenasqlParser#primaryExpression}.
 * @param ctx the parse tree
 */
fn enter_booleanLiteral(&mut self, _ctx: &BooleanLiteralContext<'input>) { }
/**
 * Exit a parse tree produced by the {@code booleanLiteral}
 * labeled alternative in {@link athenasqlParser#primaryExpression}.
 * @param ctx the parse tree
 */
fn exit_booleanLiteral(&mut self, _ctx: &BooleanLiteralContext<'input>) { }
/**
 * Enter a parse tree produced by the {@code simpleCase}
 * labeled alternative in {@link athenasqlParser#primaryExpression}.
 * @param ctx the parse tree
 */
fn enter_simpleCase(&mut self, _ctx: &SimpleCaseContext<'input>) { }
/**
 * Exit a parse tree produced by the {@code simpleCase}
 * labeled alternative in {@link athenasqlParser#primaryExpression}.
 * @param ctx the parse tree
 */
fn exit_simpleCase(&mut self, _ctx: &SimpleCaseContext<'input>) { }
/**
 * Enter a parse tree produced by the {@code nullLiteral}
 * labeled alternative in {@link athenasqlParser#primaryExpression}.
 * @param ctx the parse tree
 */
fn enter_nullLiteral(&mut self, _ctx: &NullLiteralContext<'input>) { }
/**
 * Exit a parse tree produced by the {@code nullLiteral}
 * labeled alternative in {@link athenasqlParser#primaryExpression}.
 * @param ctx the parse tree
 */
fn exit_nullLiteral(&mut self, _ctx: &NullLiteralContext<'input>) { }
/**
 * Enter a parse tree produced by the {@code rowConstructor}
 * labeled alternative in {@link athenasqlParser#primaryExpression}.
 * @param ctx the parse tree
 */
fn enter_rowConstructor(&mut self, _ctx: &RowConstructorContext<'input>) { }
/**
 * Exit a parse tree produced by the {@code rowConstructor}
 * labeled alternative in {@link athenasqlParser#primaryExpression}.
 * @param ctx the parse tree
 */
fn exit_rowConstructor(&mut self, _ctx: &RowConstructorContext<'input>) { }
/**
 * Enter a parse tree produced by the {@code subscript}
 * labeled alternative in {@link athenasqlParser#primaryExpression}.
 * @param ctx the parse tree
 */
fn enter_subscript(&mut self, _ctx: &SubscriptContext<'input>) { }
/**
 * Exit a parse tree produced by the {@code subscript}
 * labeled alternative in {@link athenasqlParser#primaryExpression}.
 * @param ctx the parse tree
 */
fn exit_subscript(&mut self, _ctx: &SubscriptContext<'input>) { }
/**
 * Enter a parse tree produced by the {@code subqueryExpression}
 * labeled alternative in {@link athenasqlParser#primaryExpression}.
 * @param ctx the parse tree
 */
fn enter_subqueryExpression(&mut self, _ctx: &SubqueryExpressionContext<'input>) { }
/**
 * Exit a parse tree produced by the {@code subqueryExpression}
 * labeled alternative in {@link athenasqlParser#primaryExpression}.
 * @param ctx the parse tree
 */
fn exit_subqueryExpression(&mut self, _ctx: &SubqueryExpressionContext<'input>) { }
/**
 * Enter a parse tree produced by the {@code binaryLiteral}
 * labeled alternative in {@link athenasqlParser#primaryExpression}.
 * @param ctx the parse tree
 */
fn enter_binaryLiteral(&mut self, _ctx: &BinaryLiteralContext<'input>) { }
/**
 * Exit a parse tree produced by the {@code binaryLiteral}
 * labeled alternative in {@link athenasqlParser#primaryExpression}.
 * @param ctx the parse tree
 */
fn exit_binaryLiteral(&mut self, _ctx: &BinaryLiteralContext<'input>) { }
/**
 * Enter a parse tree produced by the {@code extract}
 * labeled alternative in {@link athenasqlParser#primaryExpression}.
 * @param ctx the parse tree
 */
fn enter_extract(&mut self, _ctx: &ExtractContext<'input>) { }
/**
 * Exit a parse tree produced by the {@code extract}
 * labeled alternative in {@link athenasqlParser#primaryExpression}.
 * @param ctx the parse tree
 */
fn exit_extract(&mut self, _ctx: &ExtractContext<'input>) { }
/**
 * Enter a parse tree produced by the {@code stringLiteral}
 * labeled alternative in {@link athenasqlParser#primaryExpression}.
 * @param ctx the parse tree
 */
fn enter_stringLiteral(&mut self, _ctx: &StringLiteralContext<'input>) { }
/**
 * Exit a parse tree produced by the {@code stringLiteral}
 * labeled alternative in {@link athenasqlParser#primaryExpression}.
 * @param ctx the parse tree
 */
fn exit_stringLiteral(&mut self, _ctx: &StringLiteralContext<'input>) { }
/**
 * Enter a parse tree produced by the {@code arrayConstructor}
 * labeled alternative in {@link athenasqlParser#primaryExpression}.
 * @param ctx the parse tree
 */
fn enter_arrayConstructor(&mut self, _ctx: &ArrayConstructorContext<'input>) { }
/**
 * Exit a parse tree produced by the {@code arrayConstructor}
 * labeled alternative in {@link athenasqlParser#primaryExpression}.
 * @param ctx the parse tree
 */
fn exit_arrayConstructor(&mut self, _ctx: &ArrayConstructorContext<'input>) { }
/**
 * Enter a parse tree produced by the {@code functionCall}
 * labeled alternative in {@link athenasqlParser#primaryExpression}.
 * @param ctx the parse tree
 */
fn enter_functionCall(&mut self, _ctx: &FunctionCallContext<'input>) { }
/**
 * Exit a parse tree produced by the {@code functionCall}
 * labeled alternative in {@link athenasqlParser#primaryExpression}.
 * @param ctx the parse tree
 */
fn exit_functionCall(&mut self, _ctx: &FunctionCallContext<'input>) { }
/**
 * Enter a parse tree produced by the {@code exists}
 * labeled alternative in {@link athenasqlParser#primaryExpression}.
 * @param ctx the parse tree
 */
fn enter_exists(&mut self, _ctx: &ExistsContext<'input>) { }
/**
 * Exit a parse tree produced by the {@code exists}
 * labeled alternative in {@link athenasqlParser#primaryExpression}.
 * @param ctx the parse tree
 */
fn exit_exists(&mut self, _ctx: &ExistsContext<'input>) { }
/**
 * Enter a parse tree produced by the {@code position}
 * labeled alternative in {@link athenasqlParser#primaryExpression}.
 * @param ctx the parse tree
 */
fn enter_position(&mut self, _ctx: &PositionContext<'input>) { }
/**
 * Exit a parse tree produced by the {@code position}
 * labeled alternative in {@link athenasqlParser#primaryExpression}.
 * @param ctx the parse tree
 */
fn exit_position(&mut self, _ctx: &PositionContext<'input>) { }
/**
 * Enter a parse tree produced by the {@code searchedCase}
 * labeled alternative in {@link athenasqlParser#primaryExpression}.
 * @param ctx the parse tree
 */
fn enter_searchedCase(&mut self, _ctx: &SearchedCaseContext<'input>) { }
/**
 * Exit a parse tree produced by the {@code searchedCase}
 * labeled alternative in {@link athenasqlParser#primaryExpression}.
 * @param ctx the parse tree
 */
fn exit_searchedCase(&mut self, _ctx: &SearchedCaseContext<'input>) { }
/**
 * Enter a parse tree produced by the {@code columnName}
 * labeled alternative in {@link athenasqlParser#primaryExpression}.
 * @param ctx the parse tree
 */
fn enter_columnName(&mut self, _ctx: &ColumnNameContext<'input>) { }
/**
 * Exit a parse tree produced by the {@code columnName}
 * labeled alternative in {@link athenasqlParser#primaryExpression}.
 * @param ctx the parse tree
 */
fn exit_columnName(&mut self, _ctx: &ColumnNameContext<'input>) { }
/**
 * Enter a parse tree produced by the {@code timeZoneInterval}
 * labeled alternative in {@link athenasqlParser#timeZoneSpecifier}.
 * @param ctx the parse tree
 */
fn enter_timeZoneInterval(&mut self, _ctx: &TimeZoneIntervalContext<'input>) { }
/**
 * Exit a parse tree produced by the {@code timeZoneInterval}
 * labeled alternative in {@link athenasqlParser#timeZoneSpecifier}.
 * @param ctx the parse tree
 */
fn exit_timeZoneInterval(&mut self, _ctx: &TimeZoneIntervalContext<'input>) { }
/**
 * Enter a parse tree produced by the {@code timeZoneString}
 * labeled alternative in {@link athenasqlParser#timeZoneSpecifier}.
 * @param ctx the parse tree
 */
fn enter_timeZoneString(&mut self, _ctx: &TimeZoneStringContext<'input>) { }
/**
 * Exit a parse tree produced by the {@code timeZoneString}
 * labeled alternative in {@link athenasqlParser#timeZoneSpecifier}.
 * @param ctx the parse tree
 */
fn exit_timeZoneString(&mut self, _ctx: &TimeZoneStringContext<'input>) { }
/**
 * Enter a parse tree produced by {@link athenasqlParser#comparisonOperator}.
 * @param ctx the parse tree
 */
fn enter_comparisonOperator(&mut self, _ctx: &ComparisonOperatorContext<'input>) { }
/**
 * Exit a parse tree produced by {@link athenasqlParser#comparisonOperator}.
 * @param ctx the parse tree
 */
fn exit_comparisonOperator(&mut self, _ctx: &ComparisonOperatorContext<'input>) { }
/**
 * Enter a parse tree produced by {@link athenasqlParser#comparisonQuantifier}.
 * @param ctx the parse tree
 */
fn enter_comparisonQuantifier(&mut self, _ctx: &ComparisonQuantifierContext<'input>) { }
/**
 * Exit a parse tree produced by {@link athenasqlParser#comparisonQuantifier}.
 * @param ctx the parse tree
 */
fn exit_comparisonQuantifier(&mut self, _ctx: &ComparisonQuantifierContext<'input>) { }
/**
 * Enter a parse tree produced by {@link athenasqlParser#booleanValue}.
 * @param ctx the parse tree
 */
fn enter_booleanValue(&mut self, _ctx: &BooleanValueContext<'input>) { }
/**
 * Exit a parse tree produced by {@link athenasqlParser#booleanValue}.
 * @param ctx the parse tree
 */
fn exit_booleanValue(&mut self, _ctx: &BooleanValueContext<'input>) { }
/**
 * Enter a parse tree produced by {@link athenasqlParser#interval}.
 * @param ctx the parse tree
 */
fn enter_interval(&mut self, _ctx: &IntervalContext<'input>) { }
/**
 * Exit a parse tree produced by {@link athenasqlParser#interval}.
 * @param ctx the parse tree
 */
fn exit_interval(&mut self, _ctx: &IntervalContext<'input>) { }
/**
 * Enter a parse tree produced by {@link athenasqlParser#intervalField}.
 * @param ctx the parse tree
 */
fn enter_intervalField(&mut self, _ctx: &IntervalFieldContext<'input>) { }
/**
 * Exit a parse tree produced by {@link athenasqlParser#intervalField}.
 * @param ctx the parse tree
 */
fn exit_intervalField(&mut self, _ctx: &IntervalFieldContext<'input>) { }
/**
 * Enter a parse tree produced by {@link athenasqlParser#type}.
 * @param ctx the parse tree
 */
fn enter_type(&mut self, _ctx: &TypeContext<'input>) { }
/**
 * Exit a parse tree produced by {@link athenasqlParser#type}.
 * @param ctx the parse tree
 */
fn exit_type(&mut self, _ctx: &TypeContext<'input>) { }
/**
 * Enter a parse tree produced by {@link athenasqlParser#typeParameter}.
 * @param ctx the parse tree
 */
fn enter_typeParameter(&mut self, _ctx: &TypeParameterContext<'input>) { }
/**
 * Exit a parse tree produced by {@link athenasqlParser#typeParameter}.
 * @param ctx the parse tree
 */
fn exit_typeParameter(&mut self, _ctx: &TypeParameterContext<'input>) { }
/**
 * Enter a parse tree produced by {@link athenasqlParser#baseType}.
 * @param ctx the parse tree
 */
fn enter_baseType(&mut self, _ctx: &BaseTypeContext<'input>) { }
/**
 * Exit a parse tree produced by {@link athenasqlParser#baseType}.
 * @param ctx the parse tree
 */
fn exit_baseType(&mut self, _ctx: &BaseTypeContext<'input>) { }
/**
 * Enter a parse tree produced by {@link athenasqlParser#whenClause}.
 * @param ctx the parse tree
 */
fn enter_whenClause(&mut self, _ctx: &WhenClauseContext<'input>) { }
/**
 * Exit a parse tree produced by {@link athenasqlParser#whenClause}.
 * @param ctx the parse tree
 */
fn exit_whenClause(&mut self, _ctx: &WhenClauseContext<'input>) { }
/**
 * Enter a parse tree produced by {@link athenasqlParser#filter}.
 * @param ctx the parse tree
 */
fn enter_filter(&mut self, _ctx: &FilterContext<'input>) { }
/**
 * Exit a parse tree produced by {@link athenasqlParser#filter}.
 * @param ctx the parse tree
 */
fn exit_filter(&mut self, _ctx: &FilterContext<'input>) { }
/**
 * Enter a parse tree produced by {@link athenasqlParser#over}.
 * @param ctx the parse tree
 */
fn enter_over(&mut self, _ctx: &OverContext<'input>) { }
/**
 * Exit a parse tree produced by {@link athenasqlParser#over}.
 * @param ctx the parse tree
 */
fn exit_over(&mut self, _ctx: &OverContext<'input>) { }
/**
 * Enter a parse tree produced by {@link athenasqlParser#windowFrame}.
 * @param ctx the parse tree
 */
fn enter_windowFrame(&mut self, _ctx: &WindowFrameContext<'input>) { }
/**
 * Exit a parse tree produced by {@link athenasqlParser#windowFrame}.
 * @param ctx the parse tree
 */
fn exit_windowFrame(&mut self, _ctx: &WindowFrameContext<'input>) { }
/**
 * Enter a parse tree produced by the {@code unboundedFrame}
 * labeled alternative in {@link athenasqlParser#frameBound}.
 * @param ctx the parse tree
 */
fn enter_unboundedFrame(&mut self, _ctx: &UnboundedFrameContext<'input>) { }
/**
 * Exit a parse tree produced by the {@code unboundedFrame}
 * labeled alternative in {@link athenasqlParser#frameBound}.
 * @param ctx the parse tree
 */
fn exit_unboundedFrame(&mut self, _ctx: &UnboundedFrameContext<'input>) { }
/**
 * Enter a parse tree produced by the {@code currentRowBound}
 * labeled alternative in {@link athenasqlParser#frameBound}.
 * @param ctx the parse tree
 */
fn enter_currentRowBound(&mut self, _ctx: &CurrentRowBoundContext<'input>) { }
/**
 * Exit a parse tree produced by the {@code currentRowBound}
 * labeled alternative in {@link athenasqlParser#frameBound}.
 * @param ctx the parse tree
 */
fn exit_currentRowBound(&mut self, _ctx: &CurrentRowBoundContext<'input>) { }
/**
 * Enter a parse tree produced by the {@code boundedFrame}
 * labeled alternative in {@link athenasqlParser#frameBound}.
 * @param ctx the parse tree
 */
fn enter_boundedFrame(&mut self, _ctx: &BoundedFrameContext<'input>) { }
/**
 * Exit a parse tree produced by the {@code boundedFrame}
 * labeled alternative in {@link athenasqlParser#frameBound}.
 * @param ctx the parse tree
 */
fn exit_boundedFrame(&mut self, _ctx: &BoundedFrameContext<'input>) { }
/**
 * Enter a parse tree produced by the {@code explainFormat}
 * labeled alternative in {@link athenasqlParser#explainOption}.
 * @param ctx the parse tree
 */
fn enter_explainFormat(&mut self, _ctx: &ExplainFormatContext<'input>) { }
/**
 * Exit a parse tree produced by the {@code explainFormat}
 * labeled alternative in {@link athenasqlParser#explainOption}.
 * @param ctx the parse tree
 */
fn exit_explainFormat(&mut self, _ctx: &ExplainFormatContext<'input>) { }
/**
 * Enter a parse tree produced by the {@code explainType}
 * labeled alternative in {@link athenasqlParser#explainOption}.
 * @param ctx the parse tree
 */
fn enter_explainType(&mut self, _ctx: &ExplainTypeContext<'input>) { }
/**
 * Exit a parse tree produced by the {@code explainType}
 * labeled alternative in {@link athenasqlParser#explainOption}.
 * @param ctx the parse tree
 */
fn exit_explainType(&mut self, _ctx: &ExplainTypeContext<'input>) { }
/**
 * Enter a parse tree produced by the {@code isolationLevel}
 * labeled alternative in {@link athenasqlParser#transactionMode}.
 * @param ctx the parse tree
 */
fn enter_isolationLevel(&mut self, _ctx: &IsolationLevelContext<'input>) { }
/**
 * Exit a parse tree produced by the {@code isolationLevel}
 * labeled alternative in {@link athenasqlParser#transactionMode}.
 * @param ctx the parse tree
 */
fn exit_isolationLevel(&mut self, _ctx: &IsolationLevelContext<'input>) { }
/**
 * Enter a parse tree produced by the {@code transactionAccessMode}
 * labeled alternative in {@link athenasqlParser#transactionMode}.
 * @param ctx the parse tree
 */
fn enter_transactionAccessMode(&mut self, _ctx: &TransactionAccessModeContext<'input>) { }
/**
 * Exit a parse tree produced by the {@code transactionAccessMode}
 * labeled alternative in {@link athenasqlParser#transactionMode}.
 * @param ctx the parse tree
 */
fn exit_transactionAccessMode(&mut self, _ctx: &TransactionAccessModeContext<'input>) { }
/**
 * Enter a parse tree produced by the {@code readUncommitted}
 * labeled alternative in {@link athenasqlParser#levelOfIsolation}.
 * @param ctx the parse tree
 */
fn enter_readUncommitted(&mut self, _ctx: &ReadUncommittedContext<'input>) { }
/**
 * Exit a parse tree produced by the {@code readUncommitted}
 * labeled alternative in {@link athenasqlParser#levelOfIsolation}.
 * @param ctx the parse tree
 */
fn exit_readUncommitted(&mut self, _ctx: &ReadUncommittedContext<'input>) { }
/**
 * Enter a parse tree produced by the {@code readCommitted}
 * labeled alternative in {@link athenasqlParser#levelOfIsolation}.
 * @param ctx the parse tree
 */
fn enter_readCommitted(&mut self, _ctx: &ReadCommittedContext<'input>) { }
/**
 * Exit a parse tree produced by the {@code readCommitted}
 * labeled alternative in {@link athenasqlParser#levelOfIsolation}.
 * @param ctx the parse tree
 */
fn exit_readCommitted(&mut self, _ctx: &ReadCommittedContext<'input>) { }
/**
 * Enter a parse tree produced by the {@code repeatableRead}
 * labeled alternative in {@link athenasqlParser#levelOfIsolation}.
 * @param ctx the parse tree
 */
fn enter_repeatableRead(&mut self, _ctx: &RepeatableReadContext<'input>) { }
/**
 * Exit a parse tree produced by the {@code repeatableRead}
 * labeled alternative in {@link athenasqlParser#levelOfIsolation}.
 * @param ctx the parse tree
 */
fn exit_repeatableRead(&mut self, _ctx: &RepeatableReadContext<'input>) { }
/**
 * Enter a parse tree produced by the {@code serializable}
 * labeled alternative in {@link athenasqlParser#levelOfIsolation}.
 * @param ctx the parse tree
 */
fn enter_serializable(&mut self, _ctx: &SerializableContext<'input>) { }
/**
 * Exit a parse tree produced by the {@code serializable}
 * labeled alternative in {@link athenasqlParser#levelOfIsolation}.
 * @param ctx the parse tree
 */
fn exit_serializable(&mut self, _ctx: &SerializableContext<'input>) { }
/**
 * Enter a parse tree produced by the {@code positionalArgument}
 * labeled alternative in {@link athenasqlParser#callArgument}.
 * @param ctx the parse tree
 */
fn enter_positionalArgument(&mut self, _ctx: &PositionalArgumentContext<'input>) { }
/**
 * Exit a parse tree produced by the {@code positionalArgument}
 * labeled alternative in {@link athenasqlParser#callArgument}.
 * @param ctx the parse tree
 */
fn exit_positionalArgument(&mut self, _ctx: &PositionalArgumentContext<'input>) { }
/**
 * Enter a parse tree produced by the {@code namedArgument}
 * labeled alternative in {@link athenasqlParser#callArgument}.
 * @param ctx the parse tree
 */
fn enter_namedArgument(&mut self, _ctx: &NamedArgumentContext<'input>) { }
/**
 * Exit a parse tree produced by the {@code namedArgument}
 * labeled alternative in {@link athenasqlParser#callArgument}.
 * @param ctx the parse tree
 */
fn exit_namedArgument(&mut self, _ctx: &NamedArgumentContext<'input>) { }
/**
 * Enter a parse tree produced by {@link athenasqlParser#privilege}.
 * @param ctx the parse tree
 */
fn enter_privilege(&mut self, _ctx: &PrivilegeContext<'input>) { }
/**
 * Exit a parse tree produced by {@link athenasqlParser#privilege}.
 * @param ctx the parse tree
 */
fn exit_privilege(&mut self, _ctx: &PrivilegeContext<'input>) { }
/**
 * Enter a parse tree produced by {@link athenasqlParser#qualifiedName}.
 * @param ctx the parse tree
 */
fn enter_qualifiedName(&mut self, _ctx: &QualifiedNameContext<'input>) { }
/**
 * Exit a parse tree produced by {@link athenasqlParser#qualifiedName}.
 * @param ctx the parse tree
 */
fn exit_qualifiedName(&mut self, _ctx: &QualifiedNameContext<'input>) { }
/**
 * Enter a parse tree produced by the {@code unquotedIdentifier}
 * labeled alternative in {@link athenasqlParser#identifier}.
 * @param ctx the parse tree
 */
fn enter_unquotedIdentifier(&mut self, _ctx: &UnquotedIdentifierContext<'input>) { }
/**
 * Exit a parse tree produced by the {@code unquotedIdentifier}
 * labeled alternative in {@link athenasqlParser#identifier}.
 * @param ctx the parse tree
 */
fn exit_unquotedIdentifier(&mut self, _ctx: &UnquotedIdentifierContext<'input>) { }
/**
 * Enter a parse tree produced by the {@code quotedIdentifierAlternative}
 * labeled alternative in {@link athenasqlParser#identifier}.
 * @param ctx the parse tree
 */
fn enter_quotedIdentifierAlternative(&mut self, _ctx: &QuotedIdentifierAlternativeContext<'input>) { }
/**
 * Exit a parse tree produced by the {@code quotedIdentifierAlternative}
 * labeled alternative in {@link athenasqlParser#identifier}.
 * @param ctx the parse tree
 */
fn exit_quotedIdentifierAlternative(&mut self, _ctx: &QuotedIdentifierAlternativeContext<'input>) { }
/**
 * Enter a parse tree produced by the {@code backQuotedIdentifier}
 * labeled alternative in {@link athenasqlParser#identifier}.
 * @param ctx the parse tree
 */
fn enter_backQuotedIdentifier(&mut self, _ctx: &BackQuotedIdentifierContext<'input>) { }
/**
 * Exit a parse tree produced by the {@code backQuotedIdentifier}
 * labeled alternative in {@link athenasqlParser#identifier}.
 * @param ctx the parse tree
 */
fn exit_backQuotedIdentifier(&mut self, _ctx: &BackQuotedIdentifierContext<'input>) { }
/**
 * Enter a parse tree produced by the {@code digitIdentifier}
 * labeled alternative in {@link athenasqlParser#identifier}.
 * @param ctx the parse tree
 */
fn enter_digitIdentifier(&mut self, _ctx: &DigitIdentifierContext<'input>) { }
/**
 * Exit a parse tree produced by the {@code digitIdentifier}
 * labeled alternative in {@link athenasqlParser#identifier}.
 * @param ctx the parse tree
 */
fn exit_digitIdentifier(&mut self, _ctx: &DigitIdentifierContext<'input>) { }
/**
 * Enter a parse tree produced by {@link athenasqlParser#quotedIdentifier}.
 * @param ctx the parse tree
 */
fn enter_quotedIdentifier(&mut self, _ctx: &QuotedIdentifierContext<'input>) { }
/**
 * Exit a parse tree produced by {@link athenasqlParser#quotedIdentifier}.
 * @param ctx the parse tree
 */
fn exit_quotedIdentifier(&mut self, _ctx: &QuotedIdentifierContext<'input>) { }
/**
 * Enter a parse tree produced by the {@code decimalLiteral}
 * labeled alternative in {@link athenasqlParser#number}.
 * @param ctx the parse tree
 */
fn enter_decimalLiteral(&mut self, _ctx: &DecimalLiteralContext<'input>) { }
/**
 * Exit a parse tree produced by the {@code decimalLiteral}
 * labeled alternative in {@link athenasqlParser#number}.
 * @param ctx the parse tree
 */
fn exit_decimalLiteral(&mut self, _ctx: &DecimalLiteralContext<'input>) { }
/**
 * Enter a parse tree produced by the {@code integerLiteral}
 * labeled alternative in {@link athenasqlParser#number}.
 * @param ctx the parse tree
 */
fn enter_integerLiteral(&mut self, _ctx: &IntegerLiteralContext<'input>) { }
/**
 * Exit a parse tree produced by the {@code integerLiteral}
 * labeled alternative in {@link athenasqlParser#number}.
 * @param ctx the parse tree
 */
fn exit_integerLiteral(&mut self, _ctx: &IntegerLiteralContext<'input>) { }
/**
 * Enter a parse tree produced by {@link athenasqlParser#nonReserved}.
 * @param ctx the parse tree
 */
fn enter_nonReserved(&mut self, _ctx: &NonReservedContext<'input>) { }
/**
 * Exit a parse tree produced by {@link athenasqlParser#nonReserved}.
 * @param ctx the parse tree
 */
fn exit_nonReserved(&mut self, _ctx: &NonReservedContext<'input>) { }
/**
 * Enter a parse tree produced by {@link athenasqlParser#normalForm}.
 * @param ctx the parse tree
 */
fn enter_normalForm(&mut self, _ctx: &NormalFormContext<'input>) { }
/**
 * Exit a parse tree produced by {@link athenasqlParser#normalForm}.
 * @param ctx the parse tree
 */
fn exit_normalForm(&mut self, _ctx: &NormalFormContext<'input>) { }

}

antlr_rust::coerce_from!{ 'input : athenasqlListener<'input> }


