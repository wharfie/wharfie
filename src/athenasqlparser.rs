// Generated from ./grammar/athenasql.g4 by ANTLR 4.8
#![allow(dead_code)]
#![allow(non_snake_case)]
#![allow(non_upper_case_globals)]
#![allow(nonstandard_style)]
#![allow(unused_imports)]
#![allow(unused_mut)]
#![allow(unused_braces)]
use antlr_rust::PredictionContextCache;
use antlr_rust::parser::{Parser, BaseParser, ParserRecog, ParserNodeType};
use antlr_rust::token_stream::TokenStream;
use antlr_rust::TokenSource;
use antlr_rust::parser_atn_simulator::ParserATNSimulator;
use antlr_rust::errors::*;
use antlr_rust::rule_context::{BaseRuleContext, CustomRuleContext, RuleContext};
use antlr_rust::recognizer::{Recognizer,Actions};
use antlr_rust::atn_deserializer::ATNDeserializer;
use antlr_rust::dfa::DFA;
use antlr_rust::atn::{ATN, INVALID_ALT};
use antlr_rust::error_strategy::{ErrorStrategy, DefaultErrorStrategy};
use antlr_rust::parser_rule_context::{BaseParserRuleContext, ParserRuleContext,cast,cast_mut};
use antlr_rust::tree::*;
use antlr_rust::token::{TOKEN_EOF,OwningToken,Token};
use antlr_rust::int_stream::EOF;
use antlr_rust::vocabulary::{Vocabulary,VocabularyImpl};
use antlr_rust::token_factory::{CommonTokenFactory,TokenFactory, TokenAware};
use super::athenasqllistener::*;
use antlr_rust::lazy_static;
use antlr_rust::{TidAble,TidExt};

use std::marker::PhantomData;
use std::sync::Arc;
use std::rc::Rc;
use std::convert::TryFrom;
use std::cell::RefCell;
use std::ops::{DerefMut, Deref};
use std::borrow::{Borrow,BorrowMut};
use std::any::{Any,TypeId};

		pub const T__0:isize=1; 
		pub const T__1:isize=2; 
		pub const T__2:isize=3; 
		pub const T__3:isize=4; 
		pub const T__4:isize=5; 
		pub const T__5:isize=6; 
		pub const T__6:isize=7; 
		pub const T__7:isize=8; 
		pub const T__8:isize=9; 
		pub const SELECT:isize=10; 
		pub const FROM:isize=11; 
		pub const ADD:isize=12; 
		pub const AS:isize=13; 
		pub const ALL:isize=14; 
		pub const SOME:isize=15; 
		pub const ANY:isize=16; 
		pub const DISTINCT:isize=17; 
		pub const WHERE:isize=18; 
		pub const GROUP:isize=19; 
		pub const BY:isize=20; 
		pub const GROUPING:isize=21; 
		pub const SETS:isize=22; 
		pub const CUBE:isize=23; 
		pub const ROLLUP:isize=24; 
		pub const ORDER:isize=25; 
		pub const HAVING:isize=26; 
		pub const LIMIT:isize=27; 
		pub const AT:isize=28; 
		pub const OR:isize=29; 
		pub const AND:isize=30; 
		pub const IN:isize=31; 
		pub const NOT:isize=32; 
		pub const NO:isize=33; 
		pub const EXISTS:isize=34; 
		pub const BETWEEN:isize=35; 
		pub const LIKE:isize=36; 
		pub const IS:isize=37; 
		pub const NULL:isize=38; 
		pub const TRUE:isize=39; 
		pub const FALSE:isize=40; 
		pub const NULLS:isize=41; 
		pub const FIRST:isize=42; 
		pub const LAST:isize=43; 
		pub const ESCAPE:isize=44; 
		pub const ASC:isize=45; 
		pub const DESC:isize=46; 
		pub const SUBSTRING:isize=47; 
		pub const POSITION:isize=48; 
		pub const FOR:isize=49; 
		pub const TINYINT:isize=50; 
		pub const SMALLINT:isize=51; 
		pub const INTEGER:isize=52; 
		pub const DATE:isize=53; 
		pub const TIME:isize=54; 
		pub const TIMESTAMP:isize=55; 
		pub const INTERVAL:isize=56; 
		pub const YEAR:isize=57; 
		pub const MONTH:isize=58; 
		pub const DAY:isize=59; 
		pub const HOUR:isize=60; 
		pub const MINUTE:isize=61; 
		pub const SECOND:isize=62; 
		pub const ZONE:isize=63; 
		pub const CURRENT_DATE:isize=64; 
		pub const CURRENT_TIME:isize=65; 
		pub const CURRENT_TIMESTAMP:isize=66; 
		pub const LOCALTIME:isize=67; 
		pub const LOCALTIMESTAMP:isize=68; 
		pub const EXTRACT:isize=69; 
		pub const CASE:isize=70; 
		pub const WHEN:isize=71; 
		pub const THEN:isize=72; 
		pub const ELSE:isize=73; 
		pub const END:isize=74; 
		pub const JOIN:isize=75; 
		pub const CROSS:isize=76; 
		pub const OUTER:isize=77; 
		pub const INNER:isize=78; 
		pub const LEFT:isize=79; 
		pub const RIGHT:isize=80; 
		pub const FULL:isize=81; 
		pub const NATURAL:isize=82; 
		pub const USING:isize=83; 
		pub const ON:isize=84; 
		pub const FILTER:isize=85; 
		pub const OVER:isize=86; 
		pub const PARTITION:isize=87; 
		pub const RANGE:isize=88; 
		pub const ROWS:isize=89; 
		pub const UNBOUNDED:isize=90; 
		pub const PRECEDING:isize=91; 
		pub const FOLLOWING:isize=92; 
		pub const CURRENT:isize=93; 
		pub const ROW:isize=94; 
		pub const WITH:isize=95; 
		pub const RECURSIVE:isize=96; 
		pub const VALUES:isize=97; 
		pub const CREATE:isize=98; 
		pub const SCHEMA:isize=99; 
		pub const TABLE:isize=100; 
		pub const COMMENT:isize=101; 
		pub const VIEW:isize=102; 
		pub const REPLACE:isize=103; 
		pub const INSERT:isize=104; 
		pub const DELETE:isize=105; 
		pub const INTO:isize=106; 
		pub const CONSTRAINT:isize=107; 
		pub const DESCRIBE:isize=108; 
		pub const GRANT:isize=109; 
		pub const REVOKE:isize=110; 
		pub const PRIVILEGES:isize=111; 
		pub const PUBLIC:isize=112; 
		pub const OPTION:isize=113; 
		pub const EXPLAIN:isize=114; 
		pub const ANALYZE:isize=115; 
		pub const FORMAT:isize=116; 
		pub const TYPE:isize=117; 
		pub const TEXT:isize=118; 
		pub const GRAPHVIZ:isize=119; 
		pub const LOGICAL:isize=120; 
		pub const DISTRIBUTED:isize=121; 
		pub const VALIDATE:isize=122; 
		pub const CAST:isize=123; 
		pub const TRY_CAST:isize=124; 
		pub const SHOW:isize=125; 
		pub const TABLES:isize=126; 
		pub const SCHEMAS:isize=127; 
		pub const CATALOGS:isize=128; 
		pub const COLUMNS:isize=129; 
		pub const COLUMN:isize=130; 
		pub const USE:isize=131; 
		pub const PARTITIONS:isize=132; 
		pub const FUNCTIONS:isize=133; 
		pub const DROP:isize=134; 
		pub const UNION:isize=135; 
		pub const EXCEPT:isize=136; 
		pub const INTERSECT:isize=137; 
		pub const TO:isize=138; 
		pub const SYSTEM:isize=139; 
		pub const BERNOULLI:isize=140; 
		pub const POISSONIZED:isize=141; 
		pub const TABLESAMPLE:isize=142; 
		pub const ALTER:isize=143; 
		pub const RENAME:isize=144; 
		pub const UNNEST:isize=145; 
		pub const ORDINALITY:isize=146; 
		pub const ARRAY:isize=147; 
		pub const MAP:isize=148; 
		pub const SET:isize=149; 
		pub const RESET:isize=150; 
		pub const SESSION:isize=151; 
		pub const DATA:isize=152; 
		pub const START:isize=153; 
		pub const TRANSACTION:isize=154; 
		pub const COMMIT:isize=155; 
		pub const ROLLBACK:isize=156; 
		pub const WORK:isize=157; 
		pub const ISOLATION:isize=158; 
		pub const LEVEL:isize=159; 
		pub const SERIALIZABLE:isize=160; 
		pub const REPEATABLE:isize=161; 
		pub const COMMITTED:isize=162; 
		pub const UNCOMMITTED:isize=163; 
		pub const READ:isize=164; 
		pub const WRITE:isize=165; 
		pub const ONLY:isize=166; 
		pub const CALL:isize=167; 
		pub const PREPARE:isize=168; 
		pub const DEALLOCATE:isize=169; 
		pub const EXECUTE:isize=170; 
		pub const INPUT:isize=171; 
		pub const OUTPUT:isize=172; 
		pub const CASCADE:isize=173; 
		pub const RESTRICT:isize=174; 
		pub const INCLUDING:isize=175; 
		pub const EXCLUDING:isize=176; 
		pub const PROPERTIES:isize=177; 
		pub const NORMALIZE:isize=178; 
		pub const NFD:isize=179; 
		pub const NFC:isize=180; 
		pub const NFKD:isize=181; 
		pub const NFKC:isize=182; 
		pub const IF:isize=183; 
		pub const NULLIF:isize=184; 
		pub const COALESCE:isize=185; 
		pub const EQ:isize=186; 
		pub const NEQ:isize=187; 
		pub const LT:isize=188; 
		pub const LTE:isize=189; 
		pub const GT:isize=190; 
		pub const GTE:isize=191; 
		pub const PLUS:isize=192; 
		pub const MINUS:isize=193; 
		pub const ASTERISK:isize=194; 
		pub const SLASH:isize=195; 
		pub const PERCENT:isize=196; 
		pub const CONCAT:isize=197; 
		pub const STRING:isize=198; 
		pub const BINARY_LITERAL:isize=199; 
		pub const INTEGER_VALUE:isize=200; 
		pub const DECIMAL_VALUE:isize=201; 
		pub const IDENTIFIER:isize=202; 
		pub const DIGIT_IDENTIFIER:isize=203; 
		pub const QUOTED_IDENTIFIER:isize=204; 
		pub const BACKQUOTED_IDENTIFIER:isize=205; 
		pub const TIME_WITH_TIME_ZONE:isize=206; 
		pub const TIMESTAMP_WITH_TIME_ZONE:isize=207; 
		pub const DOUBLE_PRECISION:isize=208; 
		pub const SIMPLE_COMMENT:isize=209; 
		pub const BRACKETED_COMMENT:isize=210; 
		pub const WS:isize=211; 
		pub const UNRECOGNIZED:isize=212; 
		pub const DELIMITER:isize=213;
	pub const RULE_program:usize = 0; 
	pub const RULE_singleStatement:usize = 1; 
	pub const RULE_singleExpression:usize = 2; 
	pub const RULE_statement:usize = 3; 
	pub const RULE_query:usize = 4; 
	pub const RULE_js_with:usize = 5; 
	pub const RULE_tableElement:usize = 6; 
	pub const RULE_columnDefinition:usize = 7; 
	pub const RULE_likeClause:usize = 8; 
	pub const RULE_tableProperties:usize = 9; 
	pub const RULE_tableProperty:usize = 10; 
	pub const RULE_queryNoWith:usize = 11; 
	pub const RULE_queryTerm:usize = 12; 
	pub const RULE_queryPrimary:usize = 13; 
	pub const RULE_sortItem:usize = 14; 
	pub const RULE_querySpecification:usize = 15; 
	pub const RULE_groupBy:usize = 16; 
	pub const RULE_groupingElement:usize = 17; 
	pub const RULE_groupingExpressions:usize = 18; 
	pub const RULE_groupingSet:usize = 19; 
	pub const RULE_namedQuery:usize = 20; 
	pub const RULE_setQuantifier:usize = 21; 
	pub const RULE_selectItem:usize = 22; 
	pub const RULE_relation:usize = 23; 
	pub const RULE_joinType:usize = 24; 
	pub const RULE_joinCriteria:usize = 25; 
	pub const RULE_sampledRelation:usize = 26; 
	pub const RULE_sampleType:usize = 27; 
	pub const RULE_aliasedRelation:usize = 28; 
	pub const RULE_columnAliases:usize = 29; 
	pub const RULE_relationPrimary:usize = 30; 
	pub const RULE_tableReference:usize = 31; 
	pub const RULE_expression:usize = 32; 
	pub const RULE_booleanExpression:usize = 33; 
	pub const RULE_predicated:usize = 34; 
	pub const RULE_predicate:usize = 35; 
	pub const RULE_valueExpression:usize = 36; 
	pub const RULE_columnReference:usize = 37; 
	pub const RULE_primaryExpression:usize = 38; 
	pub const RULE_timeZoneSpecifier:usize = 39; 
	pub const RULE_comparisonOperator:usize = 40; 
	pub const RULE_comparisonQuantifier:usize = 41; 
	pub const RULE_booleanValue:usize = 42; 
	pub const RULE_interval:usize = 43; 
	pub const RULE_intervalField:usize = 44; 
	pub const RULE_type:usize = 45; 
	pub const RULE_typeParameter:usize = 46; 
	pub const RULE_baseType:usize = 47; 
	pub const RULE_whenClause:usize = 48; 
	pub const RULE_filter:usize = 49; 
	pub const RULE_over:usize = 50; 
	pub const RULE_windowFrame:usize = 51; 
	pub const RULE_frameBound:usize = 52; 
	pub const RULE_explainOption:usize = 53; 
	pub const RULE_transactionMode:usize = 54; 
	pub const RULE_levelOfIsolation:usize = 55; 
	pub const RULE_callArgument:usize = 56; 
	pub const RULE_privilege:usize = 57; 
	pub const RULE_qualifiedName:usize = 58; 
	pub const RULE_identifier:usize = 59; 
	pub const RULE_quotedIdentifier:usize = 60; 
	pub const RULE_number:usize = 61; 
	pub const RULE_nonReserved:usize = 62; 
	pub const RULE_normalForm:usize = 63;
	pub const ruleNames: [&'static str; 64] =  [
		"program", "singleStatement", "singleExpression", "statement", "query", 
		"js_with", "tableElement", "columnDefinition", "likeClause", "tableProperties", 
		"tableProperty", "queryNoWith", "queryTerm", "queryPrimary", "sortItem", 
		"querySpecification", "groupBy", "groupingElement", "groupingExpressions", 
		"groupingSet", "namedQuery", "setQuantifier", "selectItem", "relation", 
		"joinType", "joinCriteria", "sampledRelation", "sampleType", "aliasedRelation", 
		"columnAliases", "relationPrimary", "tableReference", "expression", "booleanExpression", 
		"predicated", "predicate", "valueExpression", "columnReference", "primaryExpression", 
		"timeZoneSpecifier", "comparisonOperator", "comparisonQuantifier", "booleanValue", 
		"interval", "intervalField", "type", "typeParameter", "baseType", "whenClause", 
		"filter", "over", "windowFrame", "frameBound", "explainOption", "transactionMode", 
		"levelOfIsolation", "callArgument", "privilege", "qualifiedName", "identifier", 
		"quotedIdentifier", "number", "nonReserved", "normalForm"
	];


	pub const _LITERAL_NAMES: [Option<&'static str>;198] = [
		None, Some("'.'"), Some("'('"), Some("','"), Some("')'"), Some("'?'"), 
		Some("'->'"), Some("'['"), Some("']'"), Some("'=>'"), None, None, None, 
		None, None, None, None, None, None, None, None, None, None, None, None, 
		None, None, None, None, None, None, None, None, None, None, None, None, 
		None, None, None, None, None, None, None, None, None, None, None, None, 
		None, None, None, None, None, None, None, None, None, None, None, None, 
		None, None, None, None, None, None, None, None, None, None, None, None, 
		None, None, None, None, None, None, None, None, None, None, None, None, 
		None, None, None, None, None, None, None, None, None, None, None, None, 
		None, None, None, None, None, None, None, None, None, None, None, None, 
		None, None, None, None, None, None, None, None, None, None, None, None, 
		None, None, None, None, None, None, None, None, None, None, None, None, 
		None, None, None, None, None, None, None, None, None, None, None, None, 
		None, None, None, None, None, None, None, None, None, None, None, None, 
		None, None, None, None, None, None, None, None, None, None, None, None, 
		None, None, None, None, None, None, None, None, None, None, None, None, 
		None, None, None, None, None, Some("'='"), None, Some("'<'"), Some("'<='"), 
		Some("'>'"), Some("'>='"), Some("'+'"), Some("'-'"), Some("'*'"), Some("'/'"), 
		Some("'%'"), Some("'||'")
	];
	pub const _SYMBOLIC_NAMES: [Option<&'static str>;214]  = [
		None, None, None, None, None, None, None, None, None, None, Some("SELECT"), 
		Some("FROM"), Some("ADD"), Some("AS"), Some("ALL"), Some("SOME"), Some("ANY"), 
		Some("DISTINCT"), Some("WHERE"), Some("GROUP"), Some("BY"), Some("GROUPING"), 
		Some("SETS"), Some("CUBE"), Some("ROLLUP"), Some("ORDER"), Some("HAVING"), 
		Some("LIMIT"), Some("AT"), Some("OR"), Some("AND"), Some("IN"), Some("NOT"), 
		Some("NO"), Some("EXISTS"), Some("BETWEEN"), Some("LIKE"), Some("IS"), 
		Some("NULL"), Some("TRUE"), Some("FALSE"), Some("NULLS"), Some("FIRST"), 
		Some("LAST"), Some("ESCAPE"), Some("ASC"), Some("DESC"), Some("SUBSTRING"), 
		Some("POSITION"), Some("FOR"), Some("TINYINT"), Some("SMALLINT"), Some("INTEGER"), 
		Some("DATE"), Some("TIME"), Some("TIMESTAMP"), Some("INTERVAL"), Some("YEAR"), 
		Some("MONTH"), Some("DAY"), Some("HOUR"), Some("MINUTE"), Some("SECOND"), 
		Some("ZONE"), Some("CURRENT_DATE"), Some("CURRENT_TIME"), Some("CURRENT_TIMESTAMP"), 
		Some("LOCALTIME"), Some("LOCALTIMESTAMP"), Some("EXTRACT"), Some("CASE"), 
		Some("WHEN"), Some("THEN"), Some("ELSE"), Some("END"), Some("JOIN"), Some("CROSS"), 
		Some("OUTER"), Some("INNER"), Some("LEFT"), Some("RIGHT"), Some("FULL"), 
		Some("NATURAL"), Some("USING"), Some("ON"), Some("FILTER"), Some("OVER"), 
		Some("PARTITION"), Some("RANGE"), Some("ROWS"), Some("UNBOUNDED"), Some("PRECEDING"), 
		Some("FOLLOWING"), Some("CURRENT"), Some("ROW"), Some("WITH"), Some("RECURSIVE"), 
		Some("VALUES"), Some("CREATE"), Some("SCHEMA"), Some("TABLE"), Some("COMMENT"), 
		Some("VIEW"), Some("REPLACE"), Some("INSERT"), Some("DELETE"), Some("INTO"), 
		Some("CONSTRAINT"), Some("DESCRIBE"), Some("GRANT"), Some("REVOKE"), Some("PRIVILEGES"), 
		Some("PUBLIC"), Some("OPTION"), Some("EXPLAIN"), Some("ANALYZE"), Some("FORMAT"), 
		Some("TYPE"), Some("TEXT"), Some("GRAPHVIZ"), Some("LOGICAL"), Some("DISTRIBUTED"), 
		Some("VALIDATE"), Some("CAST"), Some("TRY_CAST"), Some("SHOW"), Some("TABLES"), 
		Some("SCHEMAS"), Some("CATALOGS"), Some("COLUMNS"), Some("COLUMN"), Some("USE"), 
		Some("PARTITIONS"), Some("FUNCTIONS"), Some("DROP"), Some("UNION"), Some("EXCEPT"), 
		Some("INTERSECT"), Some("TO"), Some("SYSTEM"), Some("BERNOULLI"), Some("POISSONIZED"), 
		Some("TABLESAMPLE"), Some("ALTER"), Some("RENAME"), Some("UNNEST"), Some("ORDINALITY"), 
		Some("ARRAY"), Some("MAP"), Some("SET"), Some("RESET"), Some("SESSION"), 
		Some("DATA"), Some("START"), Some("TRANSACTION"), Some("COMMIT"), Some("ROLLBACK"), 
		Some("WORK"), Some("ISOLATION"), Some("LEVEL"), Some("SERIALIZABLE"), 
		Some("REPEATABLE"), Some("COMMITTED"), Some("UNCOMMITTED"), Some("READ"), 
		Some("WRITE"), Some("ONLY"), Some("CALL"), Some("PREPARE"), Some("DEALLOCATE"), 
		Some("EXECUTE"), Some("INPUT"), Some("OUTPUT"), Some("CASCADE"), Some("RESTRICT"), 
		Some("INCLUDING"), Some("EXCLUDING"), Some("PROPERTIES"), Some("NORMALIZE"), 
		Some("NFD"), Some("NFC"), Some("NFKD"), Some("NFKC"), Some("IF"), Some("NULLIF"), 
		Some("COALESCE"), Some("EQ"), Some("NEQ"), Some("LT"), Some("LTE"), Some("GT"), 
		Some("GTE"), Some("PLUS"), Some("MINUS"), Some("ASTERISK"), Some("SLASH"), 
		Some("PERCENT"), Some("CONCAT"), Some("STRING"), Some("BINARY_LITERAL"), 
		Some("INTEGER_VALUE"), Some("DECIMAL_VALUE"), Some("IDENTIFIER"), Some("DIGIT_IDENTIFIER"), 
		Some("QUOTED_IDENTIFIER"), Some("BACKQUOTED_IDENTIFIER"), Some("TIME_WITH_TIME_ZONE"), 
		Some("TIMESTAMP_WITH_TIME_ZONE"), Some("DOUBLE_PRECISION"), Some("SIMPLE_COMMENT"), 
		Some("BRACKETED_COMMENT"), Some("WS"), Some("UNRECOGNIZED"), Some("DELIMITER")
	];
	lazy_static!{
	    static ref _shared_context_cache: Arc<PredictionContextCache> = Arc::new(PredictionContextCache::new());
		static ref VOCABULARY: Box<dyn Vocabulary> = Box::new(VocabularyImpl::new(_LITERAL_NAMES.iter(), _SYMBOLIC_NAMES.iter(), None));
	}


type BaseParserType<'input, I> =
	BaseParser<'input,athenasqlParserExt<'input>, I, athenasqlParserContextType , dyn athenasqlListener<'input> + 'input >;

type TokenType<'input> = <LocalTokenFactory<'input> as TokenFactory<'input>>::Tok;
pub type LocalTokenFactory<'input> = CommonTokenFactory;

pub type athenasqlTreeWalker<'input,'a> =
	ParseTreeWalker<'input, 'a, athenasqlParserContextType , dyn athenasqlListener<'input> + 'a>;

/// Parser for athenasql grammar
pub struct athenasqlParser<'input,I,H>
where
    I: TokenStream<'input, TF = LocalTokenFactory<'input> > + TidAble<'input>,
    H: ErrorStrategy<'input,BaseParserType<'input,I>>
{
	base:BaseParserType<'input,I>,
	interpreter:Arc<ParserATNSimulator>,
	_shared_context_cache: Box<PredictionContextCache>,
    pub err_handler: H,
}

impl<'input, I, H> athenasqlParser<'input, I, H>
where
    I: TokenStream<'input, TF = LocalTokenFactory<'input> > + TidAble<'input>,
    H: ErrorStrategy<'input,BaseParserType<'input,I>>
{
	pub fn get_serialized_atn() -> &'static str { _serializedATN }

    pub fn set_error_strategy(&mut self, strategy: H) {
        self.err_handler = strategy
    }

    pub fn with_strategy(input: I, strategy: H) -> Self {
		antlr_rust::recognizer::check_version("0","3");
		let interpreter = Arc::new(ParserATNSimulator::new(
			_ATN.clone(),
			_decision_to_DFA.clone(),
			_shared_context_cache.clone(),
		));
		Self {
			base: BaseParser::new_base_parser(
				input,
				Arc::clone(&interpreter),
				athenasqlParserExt{
					_pd: Default::default(),
				}
			),
			interpreter,
            _shared_context_cache: Box::new(PredictionContextCache::new()),
            err_handler: strategy,
        }
    }

}

type DynStrategy<'input,I> = Box<dyn ErrorStrategy<'input,BaseParserType<'input,I>> + 'input>;

impl<'input, I> athenasqlParser<'input, I, DynStrategy<'input,I>>
where
    I: TokenStream<'input, TF = LocalTokenFactory<'input> > + TidAble<'input>,
{
    pub fn with_dyn_strategy(input: I) -> Self{
    	Self::with_strategy(input,Box::new(DefaultErrorStrategy::new()))
    }
}

impl<'input, I> athenasqlParser<'input, I, DefaultErrorStrategy<'input,athenasqlParserContextType>>
where
    I: TokenStream<'input, TF = LocalTokenFactory<'input> > + TidAble<'input>,
{
    pub fn new(input: I) -> Self{
    	Self::with_strategy(input,DefaultErrorStrategy::new())
    }
}

/// Trait for monomorphized trait object that corresponds to the nodes of parse tree generated for athenasqlParser
pub trait athenasqlParserContext<'input>:
	for<'x> Listenable<dyn athenasqlListener<'input> + 'x > + 
	ParserRuleContext<'input, TF=LocalTokenFactory<'input>, Ctx=athenasqlParserContextType>
{}

antlr_rust::coerce_from!{ 'input : athenasqlParserContext<'input> }

impl<'input> athenasqlParserContext<'input> for TerminalNode<'input,athenasqlParserContextType> {}
impl<'input> athenasqlParserContext<'input> for ErrorNode<'input,athenasqlParserContextType> {}

antlr_rust::tid! { impl<'input> TidAble<'input> for dyn athenasqlParserContext<'input> + 'input }

antlr_rust::tid! { impl<'input> TidAble<'input> for dyn athenasqlListener<'input> + 'input }

pub struct athenasqlParserContextType;
antlr_rust::tid!{athenasqlParserContextType}

impl<'input> ParserNodeType<'input> for athenasqlParserContextType{
	type TF = LocalTokenFactory<'input>;
	type Type = dyn athenasqlParserContext<'input> + 'input;
}

impl<'input, I, H> Deref for athenasqlParser<'input, I, H>
where
    I: TokenStream<'input, TF = LocalTokenFactory<'input> > + TidAble<'input>,
    H: ErrorStrategy<'input,BaseParserType<'input,I>>
{
    type Target = BaseParserType<'input,I>;

    fn deref(&self) -> &Self::Target {
        &self.base
    }
}

impl<'input, I, H> DerefMut for athenasqlParser<'input, I, H>
where
    I: TokenStream<'input, TF = LocalTokenFactory<'input> > + TidAble<'input>,
    H: ErrorStrategy<'input,BaseParserType<'input,I>>
{
    fn deref_mut(&mut self) -> &mut Self::Target {
        &mut self.base
    }
}

pub struct athenasqlParserExt<'input>{
	_pd: PhantomData<&'input str>,
}

impl<'input> athenasqlParserExt<'input>{

	this._input = input;

}
antlr_rust::tid! { athenasqlParserExt<'a> }

impl<'input> TokenAware<'input> for athenasqlParserExt<'input>{
	type TF = LocalTokenFactory<'input>;
}

impl<'input,I: TokenStream<'input, TF = LocalTokenFactory<'input> > + TidAble<'input>> ParserRecog<'input, BaseParserType<'input,I>> for athenasqlParserExt<'input>{}

impl<'input,I: TokenStream<'input, TF = LocalTokenFactory<'input> > + TidAble<'input>> Actions<'input, BaseParserType<'input,I>> for athenasqlParserExt<'input>{
	fn get_grammar_file_name(&self) -> & str{ "athenasql.g4"}

   	fn get_rule_names(&self) -> &[& str] {&ruleNames}

   	fn get_vocabulary(&self) -> &dyn Vocabulary { &**VOCABULARY }
	fn sempred(_localctx: Option<&(dyn athenasqlParserContext<'input> + 'input)>, rule_index: isize, pred_index: isize,
			   recog:&mut BaseParserType<'input,I>
	)->bool{
		match rule_index {
					12 => athenasqlParser::<'input,I,_>::queryTerm_sempred(_localctx.and_then(|x|x.downcast_ref()), pred_index, recog),
					23 => athenasqlParser::<'input,I,_>::relation_sempred(_localctx.and_then(|x|x.downcast_ref()), pred_index, recog),
					33 => athenasqlParser::<'input,I,_>::booleanExpression_sempred(_localctx.and_then(|x|x.downcast_ref()), pred_index, recog),
					36 => athenasqlParser::<'input,I,_>::valueExpression_sempred(_localctx.and_then(|x|x.downcast_ref()), pred_index, recog),
					38 => athenasqlParser::<'input,I,_>::primaryExpression_sempred(_localctx.and_then(|x|x.downcast_ref()), pred_index, recog),
					45 => athenasqlParser::<'input,I,_>::type_sempred(_localctx.and_then(|x|x.downcast_ref()), pred_index, recog),
			_ => true
		}
	}
}

impl<'input, I> athenasqlParser<'input, I, DefaultErrorStrategy<'input,athenasqlParserContextType>>
where
    I: TokenStream<'input, TF = LocalTokenFactory<'input> > + TidAble<'input>,
{
	fn queryTerm_sempred(_localctx: Option<&QueryTermContext<'input>>, pred_index:isize,
						recog:&mut <Self as Deref>::Target
		) -> bool {
		match pred_index {
				0=>{
					recog.precpred(None, 2)
				}
				1=>{
					recog.precpred(None, 1)
				}
			_ => true
		}
	}
	fn relation_sempred(_localctx: Option<&RelationContext<'input>>, pred_index:isize,
						recog:&mut <Self as Deref>::Target
		) -> bool {
		match pred_index {
				2=>{
					recog.precpred(None, 2)
				}
			_ => true
		}
	}
	fn booleanExpression_sempred(_localctx: Option<&BooleanExpressionContext<'input>>, pred_index:isize,
						recog:&mut <Self as Deref>::Target
		) -> bool {
		match pred_index {
				3=>{
					recog.precpred(None, 2)
				}
				4=>{
					recog.precpred(None, 1)
				}
			_ => true
		}
	}
	fn valueExpression_sempred(_localctx: Option<&ValueExpressionContext<'input>>, pred_index:isize,
						recog:&mut <Self as Deref>::Target
		) -> bool {
		match pred_index {
				5=>{
					recog.precpred(None, 3)
				}
				6=>{
					recog.precpred(None, 2)
				}
				7=>{
					recog.precpred(None, 1)
				}
				8=>{
					recog.precpred(None, 5)
				}
			_ => true
		}
	}
	fn primaryExpression_sempred(_localctx: Option<&PrimaryExpressionContext<'input>>, pred_index:isize,
						recog:&mut <Self as Deref>::Target
		) -> bool {
		match pred_index {
				9=>{
					recog.precpred(None, 12)
				}
				10=>{
					recog.precpred(None, 10)
				}
			_ => true
		}
	}
	fn type_sempred(_localctx: Option<&TypeContext<'input>>, pred_index:isize,
						recog:&mut <Self as Deref>::Target
		) -> bool {
		match pred_index {
				11=>{
					recog.precpred(None, 5)
				}
			_ => true
		}
	}
}
//------------------- program ----------------
pub type ProgramContextAll<'input> = ProgramContext<'input>;


pub type ProgramContext<'input> = BaseParserRuleContext<'input,ProgramContextExt<'input>>;

#[derive(Clone)]
pub struct ProgramContextExt<'input>{
ph:PhantomData<&'input str>
}

impl<'input> athenasqlParserContext<'input> for ProgramContext<'input>{}

impl<'input,'a> Listenable<dyn athenasqlListener<'input> + 'a> for ProgramContext<'input>{
		fn enter(&self,listener: &mut (dyn athenasqlListener<'input> + 'a)) {
			listener.enter_every_rule(self);
			listener.enter_program(self);
		}fn exit(&self,listener: &mut (dyn athenasqlListener<'input> + 'a)) {
			listener.exit_program(self);
			listener.exit_every_rule(self);
		}
}

impl<'input> CustomRuleContext<'input> for ProgramContextExt<'input>{
	type TF = LocalTokenFactory<'input>;
	type Ctx = athenasqlParserContextType;
	fn get_rule_index(&self) -> usize { RULE_program }
	//fn type_rule_index() -> usize where Self: Sized { RULE_program }
}
antlr_rust::tid!{ProgramContextExt<'a>}

impl<'input> ProgramContextExt<'input>{
	fn new(parent: Option<Rc<dyn athenasqlParserContext<'input> + 'input > >, invoking_state: isize) -> Rc<ProgramContextAll<'input>> {
		Rc::new(
			BaseParserRuleContext::new_parser_ctx(parent, invoking_state,ProgramContextExt{
				ph:PhantomData
			}),
		)
	}
}

pub trait ProgramContextAttrs<'input>: athenasqlParserContext<'input> + BorrowMut<ProgramContextExt<'input>>{

fn singleStatement(&self) -> Option<Rc<SingleStatementContextAll<'input>>> where Self:Sized{
	self.child_of_type(0)
}

}

impl<'input> ProgramContextAttrs<'input> for ProgramContext<'input>{}

impl<'input, I, H> athenasqlParser<'input, I, H>
where
    I: TokenStream<'input, TF = LocalTokenFactory<'input> > + TidAble<'input>,
    H: ErrorStrategy<'input,BaseParserType<'input,I>>
{
	pub fn program(&mut self,)
	-> Result<Rc<ProgramContextAll<'input>>,ANTLRError> {
		let mut recog = self;
		let _parentctx = recog.ctx.take();
		let mut _localctx = ProgramContextExt::new(_parentctx.clone(), recog.base.get_state());
        recog.base.enter_rule(_localctx.clone(), 0, RULE_program);
        let mut _localctx: Rc<ProgramContextAll> = _localctx;
		let result: Result<(), ANTLRError> = (|| {

			//recog.base.enter_outer_alt(_localctx.clone(), 1);
			recog.base.enter_outer_alt(None, 1);
			{
			/*InvokeRule singleStatement*/
			recog.base.set_state(128);
			recog.singleStatement()?;

			}
			Ok(())
		})();
		match result {
		Ok(_)=>{},
        Err(e @ ANTLRError::FallThrough(_)) => return Err(e),
		Err(ref re) => {
				//_localctx.exception = re;
				recog.err_handler.report_error(&mut recog.base, re);
				recog.err_handler.recover(&mut recog.base, re)?;
			}
		}
		recog.base.exit_rule();

		Ok(_localctx)
	}
}
//------------------- singleStatement ----------------
pub type SingleStatementContextAll<'input> = SingleStatementContext<'input>;


pub type SingleStatementContext<'input> = BaseParserRuleContext<'input,SingleStatementContextExt<'input>>;

#[derive(Clone)]
pub struct SingleStatementContextExt<'input>{
ph:PhantomData<&'input str>
}

impl<'input> athenasqlParserContext<'input> for SingleStatementContext<'input>{}

impl<'input,'a> Listenable<dyn athenasqlListener<'input> + 'a> for SingleStatementContext<'input>{
		fn enter(&self,listener: &mut (dyn athenasqlListener<'input> + 'a)) {
			listener.enter_every_rule(self);
			listener.enter_singleStatement(self);
		}fn exit(&self,listener: &mut (dyn athenasqlListener<'input> + 'a)) {
			listener.exit_singleStatement(self);
			listener.exit_every_rule(self);
		}
}

impl<'input> CustomRuleContext<'input> for SingleStatementContextExt<'input>{
	type TF = LocalTokenFactory<'input>;
	type Ctx = athenasqlParserContextType;
	fn get_rule_index(&self) -> usize { RULE_singleStatement }
	//fn type_rule_index() -> usize where Self: Sized { RULE_singleStatement }
}
antlr_rust::tid!{SingleStatementContextExt<'a>}

impl<'input> SingleStatementContextExt<'input>{
	fn new(parent: Option<Rc<dyn athenasqlParserContext<'input> + 'input > >, invoking_state: isize) -> Rc<SingleStatementContextAll<'input>> {
		Rc::new(
			BaseParserRuleContext::new_parser_ctx(parent, invoking_state,SingleStatementContextExt{
				ph:PhantomData
			}),
		)
	}
}

pub trait SingleStatementContextAttrs<'input>: athenasqlParserContext<'input> + BorrowMut<SingleStatementContextExt<'input>>{

fn statement(&self) -> Option<Rc<StatementContextAll<'input>>> where Self:Sized{
	self.child_of_type(0)
}
/// Retrieves first TerminalNode corresponding to token EOF
/// Returns `None` if there is no child corresponding to token EOF
fn EOF(&self) -> Option<Rc<TerminalNode<'input,athenasqlParserContextType>>> where Self:Sized{
	self.get_token(EOF, 0)
}

}

impl<'input> SingleStatementContextAttrs<'input> for SingleStatementContext<'input>{}

impl<'input, I, H> athenasqlParser<'input, I, H>
where
    I: TokenStream<'input, TF = LocalTokenFactory<'input> > + TidAble<'input>,
    H: ErrorStrategy<'input,BaseParserType<'input,I>>
{
	pub fn singleStatement(&mut self,)
	-> Result<Rc<SingleStatementContextAll<'input>>,ANTLRError> {
		let mut recog = self;
		let _parentctx = recog.ctx.take();
		let mut _localctx = SingleStatementContextExt::new(_parentctx.clone(), recog.base.get_state());
        recog.base.enter_rule(_localctx.clone(), 2, RULE_singleStatement);
        let mut _localctx: Rc<SingleStatementContextAll> = _localctx;
		let result: Result<(), ANTLRError> = (|| {

			//recog.base.enter_outer_alt(_localctx.clone(), 1);
			recog.base.enter_outer_alt(None, 1);
			{
			/*InvokeRule statement*/
			recog.base.set_state(130);
			recog.statement()?;

			recog.base.set_state(131);
			recog.base.match_token(EOF,&mut recog.err_handler)?;

			}
			Ok(())
		})();
		match result {
		Ok(_)=>{},
        Err(e @ ANTLRError::FallThrough(_)) => return Err(e),
		Err(ref re) => {
				//_localctx.exception = re;
				recog.err_handler.report_error(&mut recog.base, re);
				recog.err_handler.recover(&mut recog.base, re)?;
			}
		}
		recog.base.exit_rule();

		Ok(_localctx)
	}
}
//------------------- singleExpression ----------------
pub type SingleExpressionContextAll<'input> = SingleExpressionContext<'input>;


pub type SingleExpressionContext<'input> = BaseParserRuleContext<'input,SingleExpressionContextExt<'input>>;

#[derive(Clone)]
pub struct SingleExpressionContextExt<'input>{
ph:PhantomData<&'input str>
}

impl<'input> athenasqlParserContext<'input> for SingleExpressionContext<'input>{}

impl<'input,'a> Listenable<dyn athenasqlListener<'input> + 'a> for SingleExpressionContext<'input>{
		fn enter(&self,listener: &mut (dyn athenasqlListener<'input> + 'a)) {
			listener.enter_every_rule(self);
			listener.enter_singleExpression(self);
		}fn exit(&self,listener: &mut (dyn athenasqlListener<'input> + 'a)) {
			listener.exit_singleExpression(self);
			listener.exit_every_rule(self);
		}
}

impl<'input> CustomRuleContext<'input> for SingleExpressionContextExt<'input>{
	type TF = LocalTokenFactory<'input>;
	type Ctx = athenasqlParserContextType;
	fn get_rule_index(&self) -> usize { RULE_singleExpression }
	//fn type_rule_index() -> usize where Self: Sized { RULE_singleExpression }
}
antlr_rust::tid!{SingleExpressionContextExt<'a>}

impl<'input> SingleExpressionContextExt<'input>{
	fn new(parent: Option<Rc<dyn athenasqlParserContext<'input> + 'input > >, invoking_state: isize) -> Rc<SingleExpressionContextAll<'input>> {
		Rc::new(
			BaseParserRuleContext::new_parser_ctx(parent, invoking_state,SingleExpressionContextExt{
				ph:PhantomData
			}),
		)
	}
}

pub trait SingleExpressionContextAttrs<'input>: athenasqlParserContext<'input> + BorrowMut<SingleExpressionContextExt<'input>>{

fn expression(&self) -> Option<Rc<ExpressionContextAll<'input>>> where Self:Sized{
	self.child_of_type(0)
}
/// Retrieves first TerminalNode corresponding to token EOF
/// Returns `None` if there is no child corresponding to token EOF
fn EOF(&self) -> Option<Rc<TerminalNode<'input,athenasqlParserContextType>>> where Self:Sized{
	self.get_token(EOF, 0)
}

}

impl<'input> SingleExpressionContextAttrs<'input> for SingleExpressionContext<'input>{}

impl<'input, I, H> athenasqlParser<'input, I, H>
where
    I: TokenStream<'input, TF = LocalTokenFactory<'input> > + TidAble<'input>,
    H: ErrorStrategy<'input,BaseParserType<'input,I>>
{
	pub fn singleExpression(&mut self,)
	-> Result<Rc<SingleExpressionContextAll<'input>>,ANTLRError> {
		let mut recog = self;
		let _parentctx = recog.ctx.take();
		let mut _localctx = SingleExpressionContextExt::new(_parentctx.clone(), recog.base.get_state());
        recog.base.enter_rule(_localctx.clone(), 4, RULE_singleExpression);
        let mut _localctx: Rc<SingleExpressionContextAll> = _localctx;
		let result: Result<(), ANTLRError> = (|| {

			//recog.base.enter_outer_alt(_localctx.clone(), 1);
			recog.base.enter_outer_alt(None, 1);
			{
			/*InvokeRule expression*/
			recog.base.set_state(133);
			recog.expression()?;

			recog.base.set_state(134);
			recog.base.match_token(EOF,&mut recog.err_handler)?;

			}
			Ok(())
		})();
		match result {
		Ok(_)=>{},
        Err(e @ ANTLRError::FallThrough(_)) => return Err(e),
		Err(ref re) => {
				//_localctx.exception = re;
				recog.err_handler.report_error(&mut recog.base, re);
				recog.err_handler.recover(&mut recog.base, re)?;
			}
		}
		recog.base.exit_rule();

		Ok(_localctx)
	}
}
//------------------- statement ----------------
#[derive(Debug)]
pub enum StatementContextAll<'input>{
	ExplainContext(ExplainContext<'input>),
	PrepareContext(PrepareContext<'input>),
	CreateTableContext(CreateTableContext<'input>),
	StartTransactionContext(StartTransactionContext<'input>),
	CreateTableAsSelectContext(CreateTableAsSelectContext<'input>),
	UseContext(UseContext<'input>),
	DeallocateContext(DeallocateContext<'input>),
	RenameTableContext(RenameTableContext<'input>),
	CommitContext(CommitContext<'input>),
	RevokeContext(RevokeContext<'input>),
	ShowPartitionsContext(ShowPartitionsContext<'input>),
	DropViewContext(DropViewContext<'input>),
	DeleteContext(DeleteContext<'input>),
	ShowTablesContext(ShowTablesContext<'input>),
	DescribeInputContext(DescribeInputContext<'input>),
	ShowCatalogsContext(ShowCatalogsContext<'input>),
	StatementDefaultContext(StatementDefaultContext<'input>),
	RenameColumnContext(RenameColumnContext<'input>),
	SetSessionContext(SetSessionContext<'input>),
	CreateViewContext(CreateViewContext<'input>),
	ShowCreateTableContext(ShowCreateTableContext<'input>),
	ShowSchemasContext(ShowSchemasContext<'input>),
	DropTableContext(DropTableContext<'input>),
	ShowColumnsContext(ShowColumnsContext<'input>),
	RollbackContext(RollbackContext<'input>),
	AddColumnContext(AddColumnContext<'input>),
	ResetSessionContext(ResetSessionContext<'input>),
	InsertIntoContext(InsertIntoContext<'input>),
	ShowSessionContext(ShowSessionContext<'input>),
	CreateSchemaContext(CreateSchemaContext<'input>),
	ExecuteContext(ExecuteContext<'input>),
	CallContext(CallContext<'input>),
	RenameSchemaContext(RenameSchemaContext<'input>),
	ShowFunctionsContext(ShowFunctionsContext<'input>),
	DescribeOutputContext(DescribeOutputContext<'input>),
	DropSchemaContext(DropSchemaContext<'input>),
	GrantContext(GrantContext<'input>),
	ShowCreateViewContext(ShowCreateViewContext<'input>),
Error(StatementContext<'input>)
}
antlr_rust::tid!{StatementContextAll<'a>}

impl<'input> antlr_rust::parser_rule_context::DerefSeal for StatementContextAll<'input>{}

impl<'input> athenasqlParserContext<'input> for StatementContextAll<'input>{}

impl<'input> Deref for StatementContextAll<'input>{
	type Target = dyn StatementContextAttrs<'input> + 'input;
	fn deref(&self) -> &Self::Target{
		use StatementContextAll::*;
		match self{
			ExplainContext(inner) => inner,
			PrepareContext(inner) => inner,
			CreateTableContext(inner) => inner,
			StartTransactionContext(inner) => inner,
			CreateTableAsSelectContext(inner) => inner,
			UseContext(inner) => inner,
			DeallocateContext(inner) => inner,
			RenameTableContext(inner) => inner,
			CommitContext(inner) => inner,
			RevokeContext(inner) => inner,
			ShowPartitionsContext(inner) => inner,
			DropViewContext(inner) => inner,
			DeleteContext(inner) => inner,
			ShowTablesContext(inner) => inner,
			DescribeInputContext(inner) => inner,
			ShowCatalogsContext(inner) => inner,
			StatementDefaultContext(inner) => inner,
			RenameColumnContext(inner) => inner,
			SetSessionContext(inner) => inner,
			CreateViewContext(inner) => inner,
			ShowCreateTableContext(inner) => inner,
			ShowSchemasContext(inner) => inner,
			DropTableContext(inner) => inner,
			ShowColumnsContext(inner) => inner,
			RollbackContext(inner) => inner,
			AddColumnContext(inner) => inner,
			ResetSessionContext(inner) => inner,
			InsertIntoContext(inner) => inner,
			ShowSessionContext(inner) => inner,
			CreateSchemaContext(inner) => inner,
			ExecuteContext(inner) => inner,
			CallContext(inner) => inner,
			RenameSchemaContext(inner) => inner,
			ShowFunctionsContext(inner) => inner,
			DescribeOutputContext(inner) => inner,
			DropSchemaContext(inner) => inner,
			GrantContext(inner) => inner,
			ShowCreateViewContext(inner) => inner,
Error(inner) => inner
		}
	}
}
impl<'input,'a> Listenable<dyn athenasqlListener<'input> + 'a> for StatementContextAll<'input>{
    fn enter(&self, listener: &mut (dyn athenasqlListener<'input> + 'a)) { self.deref().enter(listener) }
    fn exit(&self, listener: &mut (dyn athenasqlListener<'input> + 'a)) { self.deref().exit(listener) }
}



pub type StatementContext<'input> = BaseParserRuleContext<'input,StatementContextExt<'input>>;

#[derive(Clone)]
pub struct StatementContextExt<'input>{
ph:PhantomData<&'input str>
}

impl<'input> athenasqlParserContext<'input> for StatementContext<'input>{}

impl<'input,'a> Listenable<dyn athenasqlListener<'input> + 'a> for StatementContext<'input>{
}

impl<'input> CustomRuleContext<'input> for StatementContextExt<'input>{
	type TF = LocalTokenFactory<'input>;
	type Ctx = athenasqlParserContextType;
	fn get_rule_index(&self) -> usize { RULE_statement }
	//fn type_rule_index() -> usize where Self: Sized { RULE_statement }
}
antlr_rust::tid!{StatementContextExt<'a>}

impl<'input> StatementContextExt<'input>{
	fn new(parent: Option<Rc<dyn athenasqlParserContext<'input> + 'input > >, invoking_state: isize) -> Rc<StatementContextAll<'input>> {
		Rc::new(
		StatementContextAll::Error(
			BaseParserRuleContext::new_parser_ctx(parent, invoking_state,StatementContextExt{
				ph:PhantomData
			}),
		)
		)
	}
}

pub trait StatementContextAttrs<'input>: athenasqlParserContext<'input> + BorrowMut<StatementContextExt<'input>>{


}

impl<'input> StatementContextAttrs<'input> for StatementContext<'input>{}

pub type ExplainContext<'input> = BaseParserRuleContext<'input,ExplainContextExt<'input>>;

pub trait ExplainContextAttrs<'input>: athenasqlParserContext<'input>{
	/// Retrieves first TerminalNode corresponding to token EXPLAIN
	/// Returns `None` if there is no child corresponding to token EXPLAIN
	fn EXPLAIN(&self) -> Option<Rc<TerminalNode<'input,athenasqlParserContextType>>> where Self:Sized{
		self.get_token(EXPLAIN, 0)
	}
	fn statement(&self) -> Option<Rc<StatementContextAll<'input>>> where Self:Sized{
		self.child_of_type(0)
	}
	/// Retrieves first TerminalNode corresponding to token ANALYZE
	/// Returns `None` if there is no child corresponding to token ANALYZE
	fn ANALYZE(&self) -> Option<Rc<TerminalNode<'input,athenasqlParserContextType>>> where Self:Sized{
		self.get_token(ANALYZE, 0)
	}
	fn explainOption_all(&self) ->  Vec<Rc<ExplainOptionContextAll<'input>>> where Self:Sized{
		self.children_of_type()
	}
	fn explainOption(&self, i: usize) -> Option<Rc<ExplainOptionContextAll<'input>>> where Self:Sized{
		self.child_of_type(i)
	}
}

impl<'input> ExplainContextAttrs<'input> for ExplainContext<'input>{}

pub struct ExplainContextExt<'input>{
	base:StatementContextExt<'input>,
	ph:PhantomData<&'input str>
}

antlr_rust::tid!{ExplainContextExt<'a>}

impl<'input> athenasqlParserContext<'input> for ExplainContext<'input>{}

impl<'input,'a> Listenable<dyn athenasqlListener<'input> + 'a> for ExplainContext<'input>{
	fn enter(&self,listener: &mut (dyn athenasqlListener<'input> + 'a)) {
		listener.enter_every_rule(self);
		listener.enter_explain(self);
	}
}

impl<'input> CustomRuleContext<'input> for ExplainContextExt<'input>{
	type TF = LocalTokenFactory<'input>;
	type Ctx = athenasqlParserContextType;
	fn get_rule_index(&self) -> usize { RULE_statement }
	//fn type_rule_index() -> usize where Self: Sized { RULE_statement }
}

impl<'input> Borrow<StatementContextExt<'input>> for ExplainContext<'input>{
	fn borrow(&self) -> &StatementContextExt<'input> { &self.base }
}
impl<'input> BorrowMut<StatementContextExt<'input>> for ExplainContext<'input>{
	fn borrow_mut(&mut self) -> &mut StatementContextExt<'input> { &mut self.base }
}

impl<'input> StatementContextAttrs<'input> for ExplainContext<'input> {}

impl<'input> ExplainContextExt<'input>{
	fn new(ctx: &dyn StatementContextAttrs<'input>) -> Rc<StatementContextAll<'input>>  {
		Rc::new(
			StatementContextAll::ExplainContext(
				BaseParserRuleContext::copy_from(ctx,ExplainContextExt{
        			base: ctx.borrow().clone(),
        			ph:PhantomData
				})
			)
		)
	}
}

pub type PrepareContext<'input> = BaseParserRuleContext<'input,PrepareContextExt<'input>>;

pub trait PrepareContextAttrs<'input>: athenasqlParserContext<'input>{
	/// Retrieves first TerminalNode corresponding to token PREPARE
	/// Returns `None` if there is no child corresponding to token PREPARE
	fn PREPARE(&self) -> Option<Rc<TerminalNode<'input,athenasqlParserContextType>>> where Self:Sized{
		self.get_token(PREPARE, 0)
	}
	fn identifier(&self) -> Option<Rc<IdentifierContextAll<'input>>> where Self:Sized{
		self.child_of_type(0)
	}
	/// Retrieves first TerminalNode corresponding to token FROM
	/// Returns `None` if there is no child corresponding to token FROM
	fn FROM(&self) -> Option<Rc<TerminalNode<'input,athenasqlParserContextType>>> where Self:Sized{
		self.get_token(FROM, 0)
	}
	fn statement(&self) -> Option<Rc<StatementContextAll<'input>>> where Self:Sized{
		self.child_of_type(0)
	}
}

impl<'input> PrepareContextAttrs<'input> for PrepareContext<'input>{}

pub struct PrepareContextExt<'input>{
	base:StatementContextExt<'input>,
	ph:PhantomData<&'input str>
}

antlr_rust::tid!{PrepareContextExt<'a>}

impl<'input> athenasqlParserContext<'input> for PrepareContext<'input>{}

impl<'input,'a> Listenable<dyn athenasqlListener<'input> + 'a> for PrepareContext<'input>{
	fn enter(&self,listener: &mut (dyn athenasqlListener<'input> + 'a)) {
		listener.enter_every_rule(self);
		listener.enter_prepare(self);
	}
}

impl<'input> CustomRuleContext<'input> for PrepareContextExt<'input>{
	type TF = LocalTokenFactory<'input>;
	type Ctx = athenasqlParserContextType;
	fn get_rule_index(&self) -> usize { RULE_statement }
	//fn type_rule_index() -> usize where Self: Sized { RULE_statement }
}

impl<'input> Borrow<StatementContextExt<'input>> for PrepareContext<'input>{
	fn borrow(&self) -> &StatementContextExt<'input> { &self.base }
}
impl<'input> BorrowMut<StatementContextExt<'input>> for PrepareContext<'input>{
	fn borrow_mut(&mut self) -> &mut StatementContextExt<'input> { &mut self.base }
}

impl<'input> StatementContextAttrs<'input> for PrepareContext<'input> {}

impl<'input> PrepareContextExt<'input>{
	fn new(ctx: &dyn StatementContextAttrs<'input>) -> Rc<StatementContextAll<'input>>  {
		Rc::new(
			StatementContextAll::PrepareContext(
				BaseParserRuleContext::copy_from(ctx,PrepareContextExt{
        			base: ctx.borrow().clone(),
        			ph:PhantomData
				})
			)
		)
	}
}

pub type CreateTableContext<'input> = BaseParserRuleContext<'input,CreateTableContextExt<'input>>;

pub trait CreateTableContextAttrs<'input>: athenasqlParserContext<'input>{
	/// Retrieves first TerminalNode corresponding to token CREATE
	/// Returns `None` if there is no child corresponding to token CREATE
	fn CREATE(&self) -> Option<Rc<TerminalNode<'input,athenasqlParserContextType>>> where Self:Sized{
		self.get_token(CREATE, 0)
	}
	/// Retrieves first TerminalNode corresponding to token TABLE
	/// Returns `None` if there is no child corresponding to token TABLE
	fn TABLE(&self) -> Option<Rc<TerminalNode<'input,athenasqlParserContextType>>> where Self:Sized{
		self.get_token(TABLE, 0)
	}
	fn qualifiedName(&self) -> Option<Rc<QualifiedNameContextAll<'input>>> where Self:Sized{
		self.child_of_type(0)
	}
	fn tableElement_all(&self) ->  Vec<Rc<TableElementContextAll<'input>>> where Self:Sized{
		self.children_of_type()
	}
	fn tableElement(&self, i: usize) -> Option<Rc<TableElementContextAll<'input>>> where Self:Sized{
		self.child_of_type(i)
	}
	/// Retrieves first TerminalNode corresponding to token IF
	/// Returns `None` if there is no child corresponding to token IF
	fn IF(&self) -> Option<Rc<TerminalNode<'input,athenasqlParserContextType>>> where Self:Sized{
		self.get_token(IF, 0)
	}
	/// Retrieves first TerminalNode corresponding to token NOT
	/// Returns `None` if there is no child corresponding to token NOT
	fn NOT(&self) -> Option<Rc<TerminalNode<'input,athenasqlParserContextType>>> where Self:Sized{
		self.get_token(NOT, 0)
	}
	/// Retrieves first TerminalNode corresponding to token EXISTS
	/// Returns `None` if there is no child corresponding to token EXISTS
	fn EXISTS(&self) -> Option<Rc<TerminalNode<'input,athenasqlParserContextType>>> where Self:Sized{
		self.get_token(EXISTS, 0)
	}
	/// Retrieves first TerminalNode corresponding to token WITH
	/// Returns `None` if there is no child corresponding to token WITH
	fn WITH(&self) -> Option<Rc<TerminalNode<'input,athenasqlParserContextType>>> where Self:Sized{
		self.get_token(WITH, 0)
	}
	fn tableProperties(&self) -> Option<Rc<TablePropertiesContextAll<'input>>> where Self:Sized{
		self.child_of_type(0)
	}
}

impl<'input> CreateTableContextAttrs<'input> for CreateTableContext<'input>{}

pub struct CreateTableContextExt<'input>{
	base:StatementContextExt<'input>,
	ph:PhantomData<&'input str>
}

antlr_rust::tid!{CreateTableContextExt<'a>}

impl<'input> athenasqlParserContext<'input> for CreateTableContext<'input>{}

impl<'input,'a> Listenable<dyn athenasqlListener<'input> + 'a> for CreateTableContext<'input>{
	fn enter(&self,listener: &mut (dyn athenasqlListener<'input> + 'a)) {
		listener.enter_every_rule(self);
		listener.enter_createTable(self);
	}
}

impl<'input> CustomRuleContext<'input> for CreateTableContextExt<'input>{
	type TF = LocalTokenFactory<'input>;
	type Ctx = athenasqlParserContextType;
	fn get_rule_index(&self) -> usize { RULE_statement }
	//fn type_rule_index() -> usize where Self: Sized { RULE_statement }
}

impl<'input> Borrow<StatementContextExt<'input>> for CreateTableContext<'input>{
	fn borrow(&self) -> &StatementContextExt<'input> { &self.base }
}
impl<'input> BorrowMut<StatementContextExt<'input>> for CreateTableContext<'input>{
	fn borrow_mut(&mut self) -> &mut StatementContextExt<'input> { &mut self.base }
}

impl<'input> StatementContextAttrs<'input> for CreateTableContext<'input> {}

impl<'input> CreateTableContextExt<'input>{
	fn new(ctx: &dyn StatementContextAttrs<'input>) -> Rc<StatementContextAll<'input>>  {
		Rc::new(
			StatementContextAll::CreateTableContext(
				BaseParserRuleContext::copy_from(ctx,CreateTableContextExt{
        			base: ctx.borrow().clone(),
        			ph:PhantomData
				})
			)
		)
	}
}

pub type StartTransactionContext<'input> = BaseParserRuleContext<'input,StartTransactionContextExt<'input>>;

pub trait StartTransactionContextAttrs<'input>: athenasqlParserContext<'input>{
	/// Retrieves first TerminalNode corresponding to token START
	/// Returns `None` if there is no child corresponding to token START
	fn START(&self) -> Option<Rc<TerminalNode<'input,athenasqlParserContextType>>> where Self:Sized{
		self.get_token(START, 0)
	}
	/// Retrieves first TerminalNode corresponding to token TRANSACTION
	/// Returns `None` if there is no child corresponding to token TRANSACTION
	fn TRANSACTION(&self) -> Option<Rc<TerminalNode<'input,athenasqlParserContextType>>> where Self:Sized{
		self.get_token(TRANSACTION, 0)
	}
	fn transactionMode_all(&self) ->  Vec<Rc<TransactionModeContextAll<'input>>> where Self:Sized{
		self.children_of_type()
	}
	fn transactionMode(&self, i: usize) -> Option<Rc<TransactionModeContextAll<'input>>> where Self:Sized{
		self.child_of_type(i)
	}
}

impl<'input> StartTransactionContextAttrs<'input> for StartTransactionContext<'input>{}

pub struct StartTransactionContextExt<'input>{
	base:StatementContextExt<'input>,
	ph:PhantomData<&'input str>
}

antlr_rust::tid!{StartTransactionContextExt<'a>}

impl<'input> athenasqlParserContext<'input> for StartTransactionContext<'input>{}

impl<'input,'a> Listenable<dyn athenasqlListener<'input> + 'a> for StartTransactionContext<'input>{
	fn enter(&self,listener: &mut (dyn athenasqlListener<'input> + 'a)) {
		listener.enter_every_rule(self);
		listener.enter_startTransaction(self);
	}
}

impl<'input> CustomRuleContext<'input> for StartTransactionContextExt<'input>{
	type TF = LocalTokenFactory<'input>;
	type Ctx = athenasqlParserContextType;
	fn get_rule_index(&self) -> usize { RULE_statement }
	//fn type_rule_index() -> usize where Self: Sized { RULE_statement }
}

impl<'input> Borrow<StatementContextExt<'input>> for StartTransactionContext<'input>{
	fn borrow(&self) -> &StatementContextExt<'input> { &self.base }
}
impl<'input> BorrowMut<StatementContextExt<'input>> for StartTransactionContext<'input>{
	fn borrow_mut(&mut self) -> &mut StatementContextExt<'input> { &mut self.base }
}

impl<'input> StatementContextAttrs<'input> for StartTransactionContext<'input> {}

impl<'input> StartTransactionContextExt<'input>{
	fn new(ctx: &dyn StatementContextAttrs<'input>) -> Rc<StatementContextAll<'input>>  {
		Rc::new(
			StatementContextAll::StartTransactionContext(
				BaseParserRuleContext::copy_from(ctx,StartTransactionContextExt{
        			base: ctx.borrow().clone(),
        			ph:PhantomData
				})
			)
		)
	}
}

pub type CreateTableAsSelectContext<'input> = BaseParserRuleContext<'input,CreateTableAsSelectContextExt<'input>>;

pub trait CreateTableAsSelectContextAttrs<'input>: athenasqlParserContext<'input>{
	/// Retrieves first TerminalNode corresponding to token CREATE
	/// Returns `None` if there is no child corresponding to token CREATE
	fn CREATE(&self) -> Option<Rc<TerminalNode<'input,athenasqlParserContextType>>> where Self:Sized{
		self.get_token(CREATE, 0)
	}
	/// Retrieves first TerminalNode corresponding to token TABLE
	/// Returns `None` if there is no child corresponding to token TABLE
	fn TABLE(&self) -> Option<Rc<TerminalNode<'input,athenasqlParserContextType>>> where Self:Sized{
		self.get_token(TABLE, 0)
	}
	fn qualifiedName(&self) -> Option<Rc<QualifiedNameContextAll<'input>>> where Self:Sized{
		self.child_of_type(0)
	}
	/// Retrieves first TerminalNode corresponding to token AS
	/// Returns `None` if there is no child corresponding to token AS
	fn AS(&self) -> Option<Rc<TerminalNode<'input,athenasqlParserContextType>>> where Self:Sized{
		self.get_token(AS, 0)
	}
	fn query(&self) -> Option<Rc<QueryContextAll<'input>>> where Self:Sized{
		self.child_of_type(0)
	}
	/// Retrieves first TerminalNode corresponding to token IF
	/// Returns `None` if there is no child corresponding to token IF
	fn IF(&self) -> Option<Rc<TerminalNode<'input,athenasqlParserContextType>>> where Self:Sized{
		self.get_token(IF, 0)
	}
	/// Retrieves first TerminalNode corresponding to token NOT
	/// Returns `None` if there is no child corresponding to token NOT
	fn NOT(&self) -> Option<Rc<TerminalNode<'input,athenasqlParserContextType>>> where Self:Sized{
		self.get_token(NOT, 0)
	}
	/// Retrieves first TerminalNode corresponding to token EXISTS
	/// Returns `None` if there is no child corresponding to token EXISTS
	fn EXISTS(&self) -> Option<Rc<TerminalNode<'input,athenasqlParserContextType>>> where Self:Sized{
		self.get_token(EXISTS, 0)
	}
	/// Retrieves all `TerminalNode`s corresponding to token WITH in current rule
	fn WITH_all(&self) -> Vec<Rc<TerminalNode<'input,athenasqlParserContextType>>>  where Self:Sized{
		self.children_of_type()
	}
	/// Retrieves 'i's TerminalNode corresponding to token WITH, starting from 0.
	/// Returns `None` if number of children corresponding to token WITH is less or equal than `i`.
	fn WITH(&self, i: usize) -> Option<Rc<TerminalNode<'input,athenasqlParserContextType>>> where Self:Sized{
		self.get_token(WITH, i)
	}
	fn tableProperties(&self) -> Option<Rc<TablePropertiesContextAll<'input>>> where Self:Sized{
		self.child_of_type(0)
	}
	/// Retrieves first TerminalNode corresponding to token DATA
	/// Returns `None` if there is no child corresponding to token DATA
	fn DATA(&self) -> Option<Rc<TerminalNode<'input,athenasqlParserContextType>>> where Self:Sized{
		self.get_token(DATA, 0)
	}
	/// Retrieves first TerminalNode corresponding to token NO
	/// Returns `None` if there is no child corresponding to token NO
	fn NO(&self) -> Option<Rc<TerminalNode<'input,athenasqlParserContextType>>> where Self:Sized{
		self.get_token(NO, 0)
	}
}

impl<'input> CreateTableAsSelectContextAttrs<'input> for CreateTableAsSelectContext<'input>{}

pub struct CreateTableAsSelectContextExt<'input>{
	base:StatementContextExt<'input>,
	ph:PhantomData<&'input str>
}

antlr_rust::tid!{CreateTableAsSelectContextExt<'a>}

impl<'input> athenasqlParserContext<'input> for CreateTableAsSelectContext<'input>{}

impl<'input,'a> Listenable<dyn athenasqlListener<'input> + 'a> for CreateTableAsSelectContext<'input>{
	fn enter(&self,listener: &mut (dyn athenasqlListener<'input> + 'a)) {
		listener.enter_every_rule(self);
		listener.enter_createTableAsSelect(self);
	}
}

impl<'input> CustomRuleContext<'input> for CreateTableAsSelectContextExt<'input>{
	type TF = LocalTokenFactory<'input>;
	type Ctx = athenasqlParserContextType;
	fn get_rule_index(&self) -> usize { RULE_statement }
	//fn type_rule_index() -> usize where Self: Sized { RULE_statement }
}

impl<'input> Borrow<StatementContextExt<'input>> for CreateTableAsSelectContext<'input>{
	fn borrow(&self) -> &StatementContextExt<'input> { &self.base }
}
impl<'input> BorrowMut<StatementContextExt<'input>> for CreateTableAsSelectContext<'input>{
	fn borrow_mut(&mut self) -> &mut StatementContextExt<'input> { &mut self.base }
}

impl<'input> StatementContextAttrs<'input> for CreateTableAsSelectContext<'input> {}

impl<'input> CreateTableAsSelectContextExt<'input>{
	fn new(ctx: &dyn StatementContextAttrs<'input>) -> Rc<StatementContextAll<'input>>  {
		Rc::new(
			StatementContextAll::CreateTableAsSelectContext(
				BaseParserRuleContext::copy_from(ctx,CreateTableAsSelectContextExt{
        			base: ctx.borrow().clone(),
        			ph:PhantomData
				})
			)
		)
	}
}

pub type UseContext<'input> = BaseParserRuleContext<'input,UseContextExt<'input>>;

pub trait UseContextAttrs<'input>: athenasqlParserContext<'input>{
	/// Retrieves first TerminalNode corresponding to token USE
	/// Returns `None` if there is no child corresponding to token USE
	fn USE(&self) -> Option<Rc<TerminalNode<'input,athenasqlParserContextType>>> where Self:Sized{
		self.get_token(USE, 0)
	}
	fn identifier_all(&self) ->  Vec<Rc<IdentifierContextAll<'input>>> where Self:Sized{
		self.children_of_type()
	}
	fn identifier(&self, i: usize) -> Option<Rc<IdentifierContextAll<'input>>> where Self:Sized{
		self.child_of_type(i)
	}
}

impl<'input> UseContextAttrs<'input> for UseContext<'input>{}

pub struct UseContextExt<'input>{
	base:StatementContextExt<'input>,
	pub schema: Option<Rc<IdentifierContextAll<'input>>>,
	pub catalog: Option<Rc<IdentifierContextAll<'input>>>,
	ph:PhantomData<&'input str>
}

antlr_rust::tid!{UseContextExt<'a>}

impl<'input> athenasqlParserContext<'input> for UseContext<'input>{}

impl<'input,'a> Listenable<dyn athenasqlListener<'input> + 'a> for UseContext<'input>{
	fn enter(&self,listener: &mut (dyn athenasqlListener<'input> + 'a)) {
		listener.enter_every_rule(self);
		listener.enter_use(self);
	}
}

impl<'input> CustomRuleContext<'input> for UseContextExt<'input>{
	type TF = LocalTokenFactory<'input>;
	type Ctx = athenasqlParserContextType;
	fn get_rule_index(&self) -> usize { RULE_statement }
	//fn type_rule_index() -> usize where Self: Sized { RULE_statement }
}

impl<'input> Borrow<StatementContextExt<'input>> for UseContext<'input>{
	fn borrow(&self) -> &StatementContextExt<'input> { &self.base }
}
impl<'input> BorrowMut<StatementContextExt<'input>> for UseContext<'input>{
	fn borrow_mut(&mut self) -> &mut StatementContextExt<'input> { &mut self.base }
}

impl<'input> StatementContextAttrs<'input> for UseContext<'input> {}

impl<'input> UseContextExt<'input>{
	fn new(ctx: &dyn StatementContextAttrs<'input>) -> Rc<StatementContextAll<'input>>  {
		Rc::new(
			StatementContextAll::UseContext(
				BaseParserRuleContext::copy_from(ctx,UseContextExt{
        			schema:None, catalog:None, 
        			base: ctx.borrow().clone(),
        			ph:PhantomData
				})
			)
		)
	}
}

pub type DeallocateContext<'input> = BaseParserRuleContext<'input,DeallocateContextExt<'input>>;

pub trait DeallocateContextAttrs<'input>: athenasqlParserContext<'input>{
	/// Retrieves first TerminalNode corresponding to token DEALLOCATE
	/// Returns `None` if there is no child corresponding to token DEALLOCATE
	fn DEALLOCATE(&self) -> Option<Rc<TerminalNode<'input,athenasqlParserContextType>>> where Self:Sized{
		self.get_token(DEALLOCATE, 0)
	}
	/// Retrieves first TerminalNode corresponding to token PREPARE
	/// Returns `None` if there is no child corresponding to token PREPARE
	fn PREPARE(&self) -> Option<Rc<TerminalNode<'input,athenasqlParserContextType>>> where Self:Sized{
		self.get_token(PREPARE, 0)
	}
	fn identifier(&self) -> Option<Rc<IdentifierContextAll<'input>>> where Self:Sized{
		self.child_of_type(0)
	}
}

impl<'input> DeallocateContextAttrs<'input> for DeallocateContext<'input>{}

pub struct DeallocateContextExt<'input>{
	base:StatementContextExt<'input>,
	ph:PhantomData<&'input str>
}

antlr_rust::tid!{DeallocateContextExt<'a>}

impl<'input> athenasqlParserContext<'input> for DeallocateContext<'input>{}

impl<'input,'a> Listenable<dyn athenasqlListener<'input> + 'a> for DeallocateContext<'input>{
	fn enter(&self,listener: &mut (dyn athenasqlListener<'input> + 'a)) {
		listener.enter_every_rule(self);
		listener.enter_deallocate(self);
	}
}

impl<'input> CustomRuleContext<'input> for DeallocateContextExt<'input>{
	type TF = LocalTokenFactory<'input>;
	type Ctx = athenasqlParserContextType;
	fn get_rule_index(&self) -> usize { RULE_statement }
	//fn type_rule_index() -> usize where Self: Sized { RULE_statement }
}

impl<'input> Borrow<StatementContextExt<'input>> for DeallocateContext<'input>{
	fn borrow(&self) -> &StatementContextExt<'input> { &self.base }
}
impl<'input> BorrowMut<StatementContextExt<'input>> for DeallocateContext<'input>{
	fn borrow_mut(&mut self) -> &mut StatementContextExt<'input> { &mut self.base }
}

impl<'input> StatementContextAttrs<'input> for DeallocateContext<'input> {}

impl<'input> DeallocateContextExt<'input>{
	fn new(ctx: &dyn StatementContextAttrs<'input>) -> Rc<StatementContextAll<'input>>  {
		Rc::new(
			StatementContextAll::DeallocateContext(
				BaseParserRuleContext::copy_from(ctx,DeallocateContextExt{
        			base: ctx.borrow().clone(),
        			ph:PhantomData
				})
			)
		)
	}
}

pub type RenameTableContext<'input> = BaseParserRuleContext<'input,RenameTableContextExt<'input>>;

pub trait RenameTableContextAttrs<'input>: athenasqlParserContext<'input>{
	/// Retrieves first TerminalNode corresponding to token ALTER
	/// Returns `None` if there is no child corresponding to token ALTER
	fn ALTER(&self) -> Option<Rc<TerminalNode<'input,athenasqlParserContextType>>> where Self:Sized{
		self.get_token(ALTER, 0)
	}
	/// Retrieves first TerminalNode corresponding to token TABLE
	/// Returns `None` if there is no child corresponding to token TABLE
	fn TABLE(&self) -> Option<Rc<TerminalNode<'input,athenasqlParserContextType>>> where Self:Sized{
		self.get_token(TABLE, 0)
	}
	/// Retrieves first TerminalNode corresponding to token RENAME
	/// Returns `None` if there is no child corresponding to token RENAME
	fn RENAME(&self) -> Option<Rc<TerminalNode<'input,athenasqlParserContextType>>> where Self:Sized{
		self.get_token(RENAME, 0)
	}
	/// Retrieves first TerminalNode corresponding to token TO
	/// Returns `None` if there is no child corresponding to token TO
	fn TO(&self) -> Option<Rc<TerminalNode<'input,athenasqlParserContextType>>> where Self:Sized{
		self.get_token(TO, 0)
	}
	fn qualifiedName_all(&self) ->  Vec<Rc<QualifiedNameContextAll<'input>>> where Self:Sized{
		self.children_of_type()
	}
	fn qualifiedName(&self, i: usize) -> Option<Rc<QualifiedNameContextAll<'input>>> where Self:Sized{
		self.child_of_type(i)
	}
}

impl<'input> RenameTableContextAttrs<'input> for RenameTableContext<'input>{}

pub struct RenameTableContextExt<'input>{
	base:StatementContextExt<'input>,
	pub from: Option<Rc<QualifiedNameContextAll<'input>>>,
	pub to: Option<Rc<QualifiedNameContextAll<'input>>>,
	ph:PhantomData<&'input str>
}

antlr_rust::tid!{RenameTableContextExt<'a>}

impl<'input> athenasqlParserContext<'input> for RenameTableContext<'input>{}

impl<'input,'a> Listenable<dyn athenasqlListener<'input> + 'a> for RenameTableContext<'input>{
	fn enter(&self,listener: &mut (dyn athenasqlListener<'input> + 'a)) {
		listener.enter_every_rule(self);
		listener.enter_renameTable(self);
	}
}

impl<'input> CustomRuleContext<'input> for RenameTableContextExt<'input>{
	type TF = LocalTokenFactory<'input>;
	type Ctx = athenasqlParserContextType;
	fn get_rule_index(&self) -> usize { RULE_statement }
	//fn type_rule_index() -> usize where Self: Sized { RULE_statement }
}

impl<'input> Borrow<StatementContextExt<'input>> for RenameTableContext<'input>{
	fn borrow(&self) -> &StatementContextExt<'input> { &self.base }
}
impl<'input> BorrowMut<StatementContextExt<'input>> for RenameTableContext<'input>{
	fn borrow_mut(&mut self) -> &mut StatementContextExt<'input> { &mut self.base }
}

impl<'input> StatementContextAttrs<'input> for RenameTableContext<'input> {}

impl<'input> RenameTableContextExt<'input>{
	fn new(ctx: &dyn StatementContextAttrs<'input>) -> Rc<StatementContextAll<'input>>  {
		Rc::new(
			StatementContextAll::RenameTableContext(
				BaseParserRuleContext::copy_from(ctx,RenameTableContextExt{
        			from:None, to:None, 
        			base: ctx.borrow().clone(),
        			ph:PhantomData
				})
			)
		)
	}
}

pub type CommitContext<'input> = BaseParserRuleContext<'input,CommitContextExt<'input>>;

pub trait CommitContextAttrs<'input>: athenasqlParserContext<'input>{
	/// Retrieves first TerminalNode corresponding to token COMMIT
	/// Returns `None` if there is no child corresponding to token COMMIT
	fn COMMIT(&self) -> Option<Rc<TerminalNode<'input,athenasqlParserContextType>>> where Self:Sized{
		self.get_token(COMMIT, 0)
	}
	/// Retrieves first TerminalNode corresponding to token WORK
	/// Returns `None` if there is no child corresponding to token WORK
	fn WORK(&self) -> Option<Rc<TerminalNode<'input,athenasqlParserContextType>>> where Self:Sized{
		self.get_token(WORK, 0)
	}
}

impl<'input> CommitContextAttrs<'input> for CommitContext<'input>{}

pub struct CommitContextExt<'input>{
	base:StatementContextExt<'input>,
	ph:PhantomData<&'input str>
}

antlr_rust::tid!{CommitContextExt<'a>}

impl<'input> athenasqlParserContext<'input> for CommitContext<'input>{}

impl<'input,'a> Listenable<dyn athenasqlListener<'input> + 'a> for CommitContext<'input>{
	fn enter(&self,listener: &mut (dyn athenasqlListener<'input> + 'a)) {
		listener.enter_every_rule(self);
		listener.enter_commit(self);
	}
}

impl<'input> CustomRuleContext<'input> for CommitContextExt<'input>{
	type TF = LocalTokenFactory<'input>;
	type Ctx = athenasqlParserContextType;
	fn get_rule_index(&self) -> usize { RULE_statement }
	//fn type_rule_index() -> usize where Self: Sized { RULE_statement }
}

impl<'input> Borrow<StatementContextExt<'input>> for CommitContext<'input>{
	fn borrow(&self) -> &StatementContextExt<'input> { &self.base }
}
impl<'input> BorrowMut<StatementContextExt<'input>> for CommitContext<'input>{
	fn borrow_mut(&mut self) -> &mut StatementContextExt<'input> { &mut self.base }
}

impl<'input> StatementContextAttrs<'input> for CommitContext<'input> {}

impl<'input> CommitContextExt<'input>{
	fn new(ctx: &dyn StatementContextAttrs<'input>) -> Rc<StatementContextAll<'input>>  {
		Rc::new(
			StatementContextAll::CommitContext(
				BaseParserRuleContext::copy_from(ctx,CommitContextExt{
        			base: ctx.borrow().clone(),
        			ph:PhantomData
				})
			)
		)
	}
}

pub type RevokeContext<'input> = BaseParserRuleContext<'input,RevokeContextExt<'input>>;

pub trait RevokeContextAttrs<'input>: athenasqlParserContext<'input>{
	/// Retrieves first TerminalNode corresponding to token REVOKE
	/// Returns `None` if there is no child corresponding to token REVOKE
	fn REVOKE(&self) -> Option<Rc<TerminalNode<'input,athenasqlParserContextType>>> where Self:Sized{
		self.get_token(REVOKE, 0)
	}
	/// Retrieves first TerminalNode corresponding to token ON
	/// Returns `None` if there is no child corresponding to token ON
	fn ON(&self) -> Option<Rc<TerminalNode<'input,athenasqlParserContextType>>> where Self:Sized{
		self.get_token(ON, 0)
	}
	fn qualifiedName(&self) -> Option<Rc<QualifiedNameContextAll<'input>>> where Self:Sized{
		self.child_of_type(0)
	}
	/// Retrieves first TerminalNode corresponding to token FROM
	/// Returns `None` if there is no child corresponding to token FROM
	fn FROM(&self) -> Option<Rc<TerminalNode<'input,athenasqlParserContextType>>> where Self:Sized{
		self.get_token(FROM, 0)
	}
	fn identifier(&self) -> Option<Rc<IdentifierContextAll<'input>>> where Self:Sized{
		self.child_of_type(0)
	}
	fn privilege_all(&self) ->  Vec<Rc<PrivilegeContextAll<'input>>> where Self:Sized{
		self.children_of_type()
	}
	fn privilege(&self, i: usize) -> Option<Rc<PrivilegeContextAll<'input>>> where Self:Sized{
		self.child_of_type(i)
	}
	/// Retrieves first TerminalNode corresponding to token ALL
	/// Returns `None` if there is no child corresponding to token ALL
	fn ALL(&self) -> Option<Rc<TerminalNode<'input,athenasqlParserContextType>>> where Self:Sized{
		self.get_token(ALL, 0)
	}
	/// Retrieves first TerminalNode corresponding to token PRIVILEGES
	/// Returns `None` if there is no child corresponding to token PRIVILEGES
	fn PRIVILEGES(&self) -> Option<Rc<TerminalNode<'input,athenasqlParserContextType>>> where Self:Sized{
		self.get_token(PRIVILEGES, 0)
	}
	/// Retrieves first TerminalNode corresponding to token GRANT
	/// Returns `None` if there is no child corresponding to token GRANT
	fn GRANT(&self) -> Option<Rc<TerminalNode<'input,athenasqlParserContextType>>> where Self:Sized{
		self.get_token(GRANT, 0)
	}
	/// Retrieves first TerminalNode corresponding to token OPTION
	/// Returns `None` if there is no child corresponding to token OPTION
	fn OPTION(&self) -> Option<Rc<TerminalNode<'input,athenasqlParserContextType>>> where Self:Sized{
		self.get_token(OPTION, 0)
	}
	/// Retrieves first TerminalNode corresponding to token FOR
	/// Returns `None` if there is no child corresponding to token FOR
	fn FOR(&self) -> Option<Rc<TerminalNode<'input,athenasqlParserContextType>>> where Self:Sized{
		self.get_token(FOR, 0)
	}
	/// Retrieves first TerminalNode corresponding to token TABLE
	/// Returns `None` if there is no child corresponding to token TABLE
	fn TABLE(&self) -> Option<Rc<TerminalNode<'input,athenasqlParserContextType>>> where Self:Sized{
		self.get_token(TABLE, 0)
	}
}

impl<'input> RevokeContextAttrs<'input> for RevokeContext<'input>{}

pub struct RevokeContextExt<'input>{
	base:StatementContextExt<'input>,
	pub grantee: Option<Rc<IdentifierContextAll<'input>>>,
	ph:PhantomData<&'input str>
}

antlr_rust::tid!{RevokeContextExt<'a>}

impl<'input> athenasqlParserContext<'input> for RevokeContext<'input>{}

impl<'input,'a> Listenable<dyn athenasqlListener<'input> + 'a> for RevokeContext<'input>{
	fn enter(&self,listener: &mut (dyn athenasqlListener<'input> + 'a)) {
		listener.enter_every_rule(self);
		listener.enter_revoke(self);
	}
}

impl<'input> CustomRuleContext<'input> for RevokeContextExt<'input>{
	type TF = LocalTokenFactory<'input>;
	type Ctx = athenasqlParserContextType;
	fn get_rule_index(&self) -> usize { RULE_statement }
	//fn type_rule_index() -> usize where Self: Sized { RULE_statement }
}

impl<'input> Borrow<StatementContextExt<'input>> for RevokeContext<'input>{
	fn borrow(&self) -> &StatementContextExt<'input> { &self.base }
}
impl<'input> BorrowMut<StatementContextExt<'input>> for RevokeContext<'input>{
	fn borrow_mut(&mut self) -> &mut StatementContextExt<'input> { &mut self.base }
}

impl<'input> StatementContextAttrs<'input> for RevokeContext<'input> {}

impl<'input> RevokeContextExt<'input>{
	fn new(ctx: &dyn StatementContextAttrs<'input>) -> Rc<StatementContextAll<'input>>  {
		Rc::new(
			StatementContextAll::RevokeContext(
				BaseParserRuleContext::copy_from(ctx,RevokeContextExt{
        			grantee:None, 
        			base: ctx.borrow().clone(),
        			ph:PhantomData
				})
			)
		)
	}
}

pub type ShowPartitionsContext<'input> = BaseParserRuleContext<'input,ShowPartitionsContextExt<'input>>;

pub trait ShowPartitionsContextAttrs<'input>: athenasqlParserContext<'input>{
	/// Retrieves first TerminalNode corresponding to token SHOW
	/// Returns `None` if there is no child corresponding to token SHOW
	fn SHOW(&self) -> Option<Rc<TerminalNode<'input,athenasqlParserContextType>>> where Self:Sized{
		self.get_token(SHOW, 0)
	}
	/// Retrieves first TerminalNode corresponding to token PARTITIONS
	/// Returns `None` if there is no child corresponding to token PARTITIONS
	fn PARTITIONS(&self) -> Option<Rc<TerminalNode<'input,athenasqlParserContextType>>> where Self:Sized{
		self.get_token(PARTITIONS, 0)
	}
	fn qualifiedName(&self) -> Option<Rc<QualifiedNameContextAll<'input>>> where Self:Sized{
		self.child_of_type(0)
	}
	/// Retrieves first TerminalNode corresponding to token FROM
	/// Returns `None` if there is no child corresponding to token FROM
	fn FROM(&self) -> Option<Rc<TerminalNode<'input,athenasqlParserContextType>>> where Self:Sized{
		self.get_token(FROM, 0)
	}
	/// Retrieves first TerminalNode corresponding to token IN
	/// Returns `None` if there is no child corresponding to token IN
	fn IN(&self) -> Option<Rc<TerminalNode<'input,athenasqlParserContextType>>> where Self:Sized{
		self.get_token(IN, 0)
	}
	/// Retrieves first TerminalNode corresponding to token WHERE
	/// Returns `None` if there is no child corresponding to token WHERE
	fn WHERE(&self) -> Option<Rc<TerminalNode<'input,athenasqlParserContextType>>> where Self:Sized{
		self.get_token(WHERE, 0)
	}
	fn booleanExpression(&self) -> Option<Rc<BooleanExpressionContextAll<'input>>> where Self:Sized{
		self.child_of_type(0)
	}
	/// Retrieves first TerminalNode corresponding to token ORDER
	/// Returns `None` if there is no child corresponding to token ORDER
	fn ORDER(&self) -> Option<Rc<TerminalNode<'input,athenasqlParserContextType>>> where Self:Sized{
		self.get_token(ORDER, 0)
	}
	/// Retrieves first TerminalNode corresponding to token BY
	/// Returns `None` if there is no child corresponding to token BY
	fn BY(&self) -> Option<Rc<TerminalNode<'input,athenasqlParserContextType>>> where Self:Sized{
		self.get_token(BY, 0)
	}
	fn sortItem_all(&self) ->  Vec<Rc<SortItemContextAll<'input>>> where Self:Sized{
		self.children_of_type()
	}
	fn sortItem(&self, i: usize) -> Option<Rc<SortItemContextAll<'input>>> where Self:Sized{
		self.child_of_type(i)
	}
	/// Retrieves first TerminalNode corresponding to token LIMIT
	/// Returns `None` if there is no child corresponding to token LIMIT
	fn LIMIT(&self) -> Option<Rc<TerminalNode<'input,athenasqlParserContextType>>> where Self:Sized{
		self.get_token(LIMIT, 0)
	}
	/// Retrieves first TerminalNode corresponding to token INTEGER_VALUE
	/// Returns `None` if there is no child corresponding to token INTEGER_VALUE
	fn INTEGER_VALUE(&self) -> Option<Rc<TerminalNode<'input,athenasqlParserContextType>>> where Self:Sized{
		self.get_token(INTEGER_VALUE, 0)
	}
	/// Retrieves first TerminalNode corresponding to token ALL
	/// Returns `None` if there is no child corresponding to token ALL
	fn ALL(&self) -> Option<Rc<TerminalNode<'input,athenasqlParserContextType>>> where Self:Sized{
		self.get_token(ALL, 0)
	}
}

impl<'input> ShowPartitionsContextAttrs<'input> for ShowPartitionsContext<'input>{}

pub struct ShowPartitionsContextExt<'input>{
	base:StatementContextExt<'input>,
	pub limit: Option<TokenType<'input>>,
	ph:PhantomData<&'input str>
}

antlr_rust::tid!{ShowPartitionsContextExt<'a>}

impl<'input> athenasqlParserContext<'input> for ShowPartitionsContext<'input>{}

impl<'input,'a> Listenable<dyn athenasqlListener<'input> + 'a> for ShowPartitionsContext<'input>{
	fn enter(&self,listener: &mut (dyn athenasqlListener<'input> + 'a)) {
		listener.enter_every_rule(self);
		listener.enter_showPartitions(self);
	}
}

impl<'input> CustomRuleContext<'input> for ShowPartitionsContextExt<'input>{
	type TF = LocalTokenFactory<'input>;
	type Ctx = athenasqlParserContextType;
	fn get_rule_index(&self) -> usize { RULE_statement }
	//fn type_rule_index() -> usize where Self: Sized { RULE_statement }
}

impl<'input> Borrow<StatementContextExt<'input>> for ShowPartitionsContext<'input>{
	fn borrow(&self) -> &StatementContextExt<'input> { &self.base }
}
impl<'input> BorrowMut<StatementContextExt<'input>> for ShowPartitionsContext<'input>{
	fn borrow_mut(&mut self) -> &mut StatementContextExt<'input> { &mut self.base }
}

impl<'input> StatementContextAttrs<'input> for ShowPartitionsContext<'input> {}

impl<'input> ShowPartitionsContextExt<'input>{
	fn new(ctx: &dyn StatementContextAttrs<'input>) -> Rc<StatementContextAll<'input>>  {
		Rc::new(
			StatementContextAll::ShowPartitionsContext(
				BaseParserRuleContext::copy_from(ctx,ShowPartitionsContextExt{
					limit:None, 
        			base: ctx.borrow().clone(),
        			ph:PhantomData
				})
			)
		)
	}
}

pub type DropViewContext<'input> = BaseParserRuleContext<'input,DropViewContextExt<'input>>;

pub trait DropViewContextAttrs<'input>: athenasqlParserContext<'input>{
	/// Retrieves first TerminalNode corresponding to token DROP
	/// Returns `None` if there is no child corresponding to token DROP
	fn DROP(&self) -> Option<Rc<TerminalNode<'input,athenasqlParserContextType>>> where Self:Sized{
		self.get_token(DROP, 0)
	}
	/// Retrieves first TerminalNode corresponding to token VIEW
	/// Returns `None` if there is no child corresponding to token VIEW
	fn VIEW(&self) -> Option<Rc<TerminalNode<'input,athenasqlParserContextType>>> where Self:Sized{
		self.get_token(VIEW, 0)
	}
	fn qualifiedName(&self) -> Option<Rc<QualifiedNameContextAll<'input>>> where Self:Sized{
		self.child_of_type(0)
	}
	/// Retrieves first TerminalNode corresponding to token IF
	/// Returns `None` if there is no child corresponding to token IF
	fn IF(&self) -> Option<Rc<TerminalNode<'input,athenasqlParserContextType>>> where Self:Sized{
		self.get_token(IF, 0)
	}
	/// Retrieves first TerminalNode corresponding to token EXISTS
	/// Returns `None` if there is no child corresponding to token EXISTS
	fn EXISTS(&self) -> Option<Rc<TerminalNode<'input,athenasqlParserContextType>>> where Self:Sized{
		self.get_token(EXISTS, 0)
	}
}

impl<'input> DropViewContextAttrs<'input> for DropViewContext<'input>{}

pub struct DropViewContextExt<'input>{
	base:StatementContextExt<'input>,
	ph:PhantomData<&'input str>
}

antlr_rust::tid!{DropViewContextExt<'a>}

impl<'input> athenasqlParserContext<'input> for DropViewContext<'input>{}

impl<'input,'a> Listenable<dyn athenasqlListener<'input> + 'a> for DropViewContext<'input>{
	fn enter(&self,listener: &mut (dyn athenasqlListener<'input> + 'a)) {
		listener.enter_every_rule(self);
		listener.enter_dropView(self);
	}
}

impl<'input> CustomRuleContext<'input> for DropViewContextExt<'input>{
	type TF = LocalTokenFactory<'input>;
	type Ctx = athenasqlParserContextType;
	fn get_rule_index(&self) -> usize { RULE_statement }
	//fn type_rule_index() -> usize where Self: Sized { RULE_statement }
}

impl<'input> Borrow<StatementContextExt<'input>> for DropViewContext<'input>{
	fn borrow(&self) -> &StatementContextExt<'input> { &self.base }
}
impl<'input> BorrowMut<StatementContextExt<'input>> for DropViewContext<'input>{
	fn borrow_mut(&mut self) -> &mut StatementContextExt<'input> { &mut self.base }
}

impl<'input> StatementContextAttrs<'input> for DropViewContext<'input> {}

impl<'input> DropViewContextExt<'input>{
	fn new(ctx: &dyn StatementContextAttrs<'input>) -> Rc<StatementContextAll<'input>>  {
		Rc::new(
			StatementContextAll::DropViewContext(
				BaseParserRuleContext::copy_from(ctx,DropViewContextExt{
        			base: ctx.borrow().clone(),
        			ph:PhantomData
				})
			)
		)
	}
}

pub type DeleteContext<'input> = BaseParserRuleContext<'input,DeleteContextExt<'input>>;

pub trait DeleteContextAttrs<'input>: athenasqlParserContext<'input>{
	/// Retrieves first TerminalNode corresponding to token DELETE
	/// Returns `None` if there is no child corresponding to token DELETE
	fn DELETE(&self) -> Option<Rc<TerminalNode<'input,athenasqlParserContextType>>> where Self:Sized{
		self.get_token(DELETE, 0)
	}
	/// Retrieves first TerminalNode corresponding to token FROM
	/// Returns `None` if there is no child corresponding to token FROM
	fn FROM(&self) -> Option<Rc<TerminalNode<'input,athenasqlParserContextType>>> where Self:Sized{
		self.get_token(FROM, 0)
	}
	fn qualifiedName(&self) -> Option<Rc<QualifiedNameContextAll<'input>>> where Self:Sized{
		self.child_of_type(0)
	}
	/// Retrieves first TerminalNode corresponding to token WHERE
	/// Returns `None` if there is no child corresponding to token WHERE
	fn WHERE(&self) -> Option<Rc<TerminalNode<'input,athenasqlParserContextType>>> where Self:Sized{
		self.get_token(WHERE, 0)
	}
	fn booleanExpression(&self) -> Option<Rc<BooleanExpressionContextAll<'input>>> where Self:Sized{
		self.child_of_type(0)
	}
}

impl<'input> DeleteContextAttrs<'input> for DeleteContext<'input>{}

pub struct DeleteContextExt<'input>{
	base:StatementContextExt<'input>,
	ph:PhantomData<&'input str>
}

antlr_rust::tid!{DeleteContextExt<'a>}

impl<'input> athenasqlParserContext<'input> for DeleteContext<'input>{}

impl<'input,'a> Listenable<dyn athenasqlListener<'input> + 'a> for DeleteContext<'input>{
	fn enter(&self,listener: &mut (dyn athenasqlListener<'input> + 'a)) {
		listener.enter_every_rule(self);
		listener.enter_delete(self);
	}
}

impl<'input> CustomRuleContext<'input> for DeleteContextExt<'input>{
	type TF = LocalTokenFactory<'input>;
	type Ctx = athenasqlParserContextType;
	fn get_rule_index(&self) -> usize { RULE_statement }
	//fn type_rule_index() -> usize where Self: Sized { RULE_statement }
}

impl<'input> Borrow<StatementContextExt<'input>> for DeleteContext<'input>{
	fn borrow(&self) -> &StatementContextExt<'input> { &self.base }
}
impl<'input> BorrowMut<StatementContextExt<'input>> for DeleteContext<'input>{
	fn borrow_mut(&mut self) -> &mut StatementContextExt<'input> { &mut self.base }
}

impl<'input> StatementContextAttrs<'input> for DeleteContext<'input> {}

impl<'input> DeleteContextExt<'input>{
	fn new(ctx: &dyn StatementContextAttrs<'input>) -> Rc<StatementContextAll<'input>>  {
		Rc::new(
			StatementContextAll::DeleteContext(
				BaseParserRuleContext::copy_from(ctx,DeleteContextExt{
        			base: ctx.borrow().clone(),
        			ph:PhantomData
				})
			)
		)
	}
}

pub type ShowTablesContext<'input> = BaseParserRuleContext<'input,ShowTablesContextExt<'input>>;

pub trait ShowTablesContextAttrs<'input>: athenasqlParserContext<'input>{
	/// Retrieves first TerminalNode corresponding to token SHOW
	/// Returns `None` if there is no child corresponding to token SHOW
	fn SHOW(&self) -> Option<Rc<TerminalNode<'input,athenasqlParserContextType>>> where Self:Sized{
		self.get_token(SHOW, 0)
	}
	/// Retrieves first TerminalNode corresponding to token TABLES
	/// Returns `None` if there is no child corresponding to token TABLES
	fn TABLES(&self) -> Option<Rc<TerminalNode<'input,athenasqlParserContextType>>> where Self:Sized{
		self.get_token(TABLES, 0)
	}
	fn qualifiedName(&self) -> Option<Rc<QualifiedNameContextAll<'input>>> where Self:Sized{
		self.child_of_type(0)
	}
	/// Retrieves first TerminalNode corresponding to token LIKE
	/// Returns `None` if there is no child corresponding to token LIKE
	fn LIKE(&self) -> Option<Rc<TerminalNode<'input,athenasqlParserContextType>>> where Self:Sized{
		self.get_token(LIKE, 0)
	}
	/// Retrieves first TerminalNode corresponding to token FROM
	/// Returns `None` if there is no child corresponding to token FROM
	fn FROM(&self) -> Option<Rc<TerminalNode<'input,athenasqlParserContextType>>> where Self:Sized{
		self.get_token(FROM, 0)
	}
	/// Retrieves first TerminalNode corresponding to token IN
	/// Returns `None` if there is no child corresponding to token IN
	fn IN(&self) -> Option<Rc<TerminalNode<'input,athenasqlParserContextType>>> where Self:Sized{
		self.get_token(IN, 0)
	}
	/// Retrieves first TerminalNode corresponding to token STRING
	/// Returns `None` if there is no child corresponding to token STRING
	fn STRING(&self) -> Option<Rc<TerminalNode<'input,athenasqlParserContextType>>> where Self:Sized{
		self.get_token(STRING, 0)
	}
}

impl<'input> ShowTablesContextAttrs<'input> for ShowTablesContext<'input>{}

pub struct ShowTablesContextExt<'input>{
	base:StatementContextExt<'input>,
	pub pattern: Option<TokenType<'input>>,
	ph:PhantomData<&'input str>
}

antlr_rust::tid!{ShowTablesContextExt<'a>}

impl<'input> athenasqlParserContext<'input> for ShowTablesContext<'input>{}

impl<'input,'a> Listenable<dyn athenasqlListener<'input> + 'a> for ShowTablesContext<'input>{
	fn enter(&self,listener: &mut (dyn athenasqlListener<'input> + 'a)) {
		listener.enter_every_rule(self);
		listener.enter_showTables(self);
	}
}

impl<'input> CustomRuleContext<'input> for ShowTablesContextExt<'input>{
	type TF = LocalTokenFactory<'input>;
	type Ctx = athenasqlParserContextType;
	fn get_rule_index(&self) -> usize { RULE_statement }
	//fn type_rule_index() -> usize where Self: Sized { RULE_statement }
}

impl<'input> Borrow<StatementContextExt<'input>> for ShowTablesContext<'input>{
	fn borrow(&self) -> &StatementContextExt<'input> { &self.base }
}
impl<'input> BorrowMut<StatementContextExt<'input>> for ShowTablesContext<'input>{
	fn borrow_mut(&mut self) -> &mut StatementContextExt<'input> { &mut self.base }
}

impl<'input> StatementContextAttrs<'input> for ShowTablesContext<'input> {}

impl<'input> ShowTablesContextExt<'input>{
	fn new(ctx: &dyn StatementContextAttrs<'input>) -> Rc<StatementContextAll<'input>>  {
		Rc::new(
			StatementContextAll::ShowTablesContext(
				BaseParserRuleContext::copy_from(ctx,ShowTablesContextExt{
					pattern:None, 
        			base: ctx.borrow().clone(),
        			ph:PhantomData
				})
			)
		)
	}
}

pub type DescribeInputContext<'input> = BaseParserRuleContext<'input,DescribeInputContextExt<'input>>;

pub trait DescribeInputContextAttrs<'input>: athenasqlParserContext<'input>{
	/// Retrieves first TerminalNode corresponding to token DESCRIBE
	/// Returns `None` if there is no child corresponding to token DESCRIBE
	fn DESCRIBE(&self) -> Option<Rc<TerminalNode<'input,athenasqlParserContextType>>> where Self:Sized{
		self.get_token(DESCRIBE, 0)
	}
	/// Retrieves first TerminalNode corresponding to token INPUT
	/// Returns `None` if there is no child corresponding to token INPUT
	fn INPUT(&self) -> Option<Rc<TerminalNode<'input,athenasqlParserContextType>>> where Self:Sized{
		self.get_token(INPUT, 0)
	}
	fn identifier(&self) -> Option<Rc<IdentifierContextAll<'input>>> where Self:Sized{
		self.child_of_type(0)
	}
}

impl<'input> DescribeInputContextAttrs<'input> for DescribeInputContext<'input>{}

pub struct DescribeInputContextExt<'input>{
	base:StatementContextExt<'input>,
	ph:PhantomData<&'input str>
}

antlr_rust::tid!{DescribeInputContextExt<'a>}

impl<'input> athenasqlParserContext<'input> for DescribeInputContext<'input>{}

impl<'input,'a> Listenable<dyn athenasqlListener<'input> + 'a> for DescribeInputContext<'input>{
	fn enter(&self,listener: &mut (dyn athenasqlListener<'input> + 'a)) {
		listener.enter_every_rule(self);
		listener.enter_describeInput(self);
	}
}

impl<'input> CustomRuleContext<'input> for DescribeInputContextExt<'input>{
	type TF = LocalTokenFactory<'input>;
	type Ctx = athenasqlParserContextType;
	fn get_rule_index(&self) -> usize { RULE_statement }
	//fn type_rule_index() -> usize where Self: Sized { RULE_statement }
}

impl<'input> Borrow<StatementContextExt<'input>> for DescribeInputContext<'input>{
	fn borrow(&self) -> &StatementContextExt<'input> { &self.base }
}
impl<'input> BorrowMut<StatementContextExt<'input>> for DescribeInputContext<'input>{
	fn borrow_mut(&mut self) -> &mut StatementContextExt<'input> { &mut self.base }
}

impl<'input> StatementContextAttrs<'input> for DescribeInputContext<'input> {}

impl<'input> DescribeInputContextExt<'input>{
	fn new(ctx: &dyn StatementContextAttrs<'input>) -> Rc<StatementContextAll<'input>>  {
		Rc::new(
			StatementContextAll::DescribeInputContext(
				BaseParserRuleContext::copy_from(ctx,DescribeInputContextExt{
        			base: ctx.borrow().clone(),
        			ph:PhantomData
				})
			)
		)
	}
}

pub type ShowCatalogsContext<'input> = BaseParserRuleContext<'input,ShowCatalogsContextExt<'input>>;

pub trait ShowCatalogsContextAttrs<'input>: athenasqlParserContext<'input>{
	/// Retrieves first TerminalNode corresponding to token SHOW
	/// Returns `None` if there is no child corresponding to token SHOW
	fn SHOW(&self) -> Option<Rc<TerminalNode<'input,athenasqlParserContextType>>> where Self:Sized{
		self.get_token(SHOW, 0)
	}
	/// Retrieves first TerminalNode corresponding to token CATALOGS
	/// Returns `None` if there is no child corresponding to token CATALOGS
	fn CATALOGS(&self) -> Option<Rc<TerminalNode<'input,athenasqlParserContextType>>> where Self:Sized{
		self.get_token(CATALOGS, 0)
	}
	/// Retrieves first TerminalNode corresponding to token LIKE
	/// Returns `None` if there is no child corresponding to token LIKE
	fn LIKE(&self) -> Option<Rc<TerminalNode<'input,athenasqlParserContextType>>> where Self:Sized{
		self.get_token(LIKE, 0)
	}
	/// Retrieves first TerminalNode corresponding to token STRING
	/// Returns `None` if there is no child corresponding to token STRING
	fn STRING(&self) -> Option<Rc<TerminalNode<'input,athenasqlParserContextType>>> where Self:Sized{
		self.get_token(STRING, 0)
	}
}

impl<'input> ShowCatalogsContextAttrs<'input> for ShowCatalogsContext<'input>{}

pub struct ShowCatalogsContextExt<'input>{
	base:StatementContextExt<'input>,
	pub pattern: Option<TokenType<'input>>,
	ph:PhantomData<&'input str>
}

antlr_rust::tid!{ShowCatalogsContextExt<'a>}

impl<'input> athenasqlParserContext<'input> for ShowCatalogsContext<'input>{}

impl<'input,'a> Listenable<dyn athenasqlListener<'input> + 'a> for ShowCatalogsContext<'input>{
	fn enter(&self,listener: &mut (dyn athenasqlListener<'input> + 'a)) {
		listener.enter_every_rule(self);
		listener.enter_showCatalogs(self);
	}
}

impl<'input> CustomRuleContext<'input> for ShowCatalogsContextExt<'input>{
	type TF = LocalTokenFactory<'input>;
	type Ctx = athenasqlParserContextType;
	fn get_rule_index(&self) -> usize { RULE_statement }
	//fn type_rule_index() -> usize where Self: Sized { RULE_statement }
}

impl<'input> Borrow<StatementContextExt<'input>> for ShowCatalogsContext<'input>{
	fn borrow(&self) -> &StatementContextExt<'input> { &self.base }
}
impl<'input> BorrowMut<StatementContextExt<'input>> for ShowCatalogsContext<'input>{
	fn borrow_mut(&mut self) -> &mut StatementContextExt<'input> { &mut self.base }
}

impl<'input> StatementContextAttrs<'input> for ShowCatalogsContext<'input> {}

impl<'input> ShowCatalogsContextExt<'input>{
	fn new(ctx: &dyn StatementContextAttrs<'input>) -> Rc<StatementContextAll<'input>>  {
		Rc::new(
			StatementContextAll::ShowCatalogsContext(
				BaseParserRuleContext::copy_from(ctx,ShowCatalogsContextExt{
					pattern:None, 
        			base: ctx.borrow().clone(),
        			ph:PhantomData
				})
			)
		)
	}
}

pub type StatementDefaultContext<'input> = BaseParserRuleContext<'input,StatementDefaultContextExt<'input>>;

pub trait StatementDefaultContextAttrs<'input>: athenasqlParserContext<'input>{
	fn query(&self) -> Option<Rc<QueryContextAll<'input>>> where Self:Sized{
		self.child_of_type(0)
	}
}

impl<'input> StatementDefaultContextAttrs<'input> for StatementDefaultContext<'input>{}

pub struct StatementDefaultContextExt<'input>{
	base:StatementContextExt<'input>,
	ph:PhantomData<&'input str>
}

antlr_rust::tid!{StatementDefaultContextExt<'a>}

impl<'input> athenasqlParserContext<'input> for StatementDefaultContext<'input>{}

impl<'input,'a> Listenable<dyn athenasqlListener<'input> + 'a> for StatementDefaultContext<'input>{
	fn enter(&self,listener: &mut (dyn athenasqlListener<'input> + 'a)) {
		listener.enter_every_rule(self);
		listener.enter_statementDefault(self);
	}
}

impl<'input> CustomRuleContext<'input> for StatementDefaultContextExt<'input>{
	type TF = LocalTokenFactory<'input>;
	type Ctx = athenasqlParserContextType;
	fn get_rule_index(&self) -> usize { RULE_statement }
	//fn type_rule_index() -> usize where Self: Sized { RULE_statement }
}

impl<'input> Borrow<StatementContextExt<'input>> for StatementDefaultContext<'input>{
	fn borrow(&self) -> &StatementContextExt<'input> { &self.base }
}
impl<'input> BorrowMut<StatementContextExt<'input>> for StatementDefaultContext<'input>{
	fn borrow_mut(&mut self) -> &mut StatementContextExt<'input> { &mut self.base }
}

impl<'input> StatementContextAttrs<'input> for StatementDefaultContext<'input> {}

impl<'input> StatementDefaultContextExt<'input>{
	fn new(ctx: &dyn StatementContextAttrs<'input>) -> Rc<StatementContextAll<'input>>  {
		Rc::new(
			StatementContextAll::StatementDefaultContext(
				BaseParserRuleContext::copy_from(ctx,StatementDefaultContextExt{
        			base: ctx.borrow().clone(),
        			ph:PhantomData
				})
			)
		)
	}
}

pub type RenameColumnContext<'input> = BaseParserRuleContext<'input,RenameColumnContextExt<'input>>;

pub trait RenameColumnContextAttrs<'input>: athenasqlParserContext<'input>{
	/// Retrieves first TerminalNode corresponding to token ALTER
	/// Returns `None` if there is no child corresponding to token ALTER
	fn ALTER(&self) -> Option<Rc<TerminalNode<'input,athenasqlParserContextType>>> where Self:Sized{
		self.get_token(ALTER, 0)
	}
	/// Retrieves first TerminalNode corresponding to token TABLE
	/// Returns `None` if there is no child corresponding to token TABLE
	fn TABLE(&self) -> Option<Rc<TerminalNode<'input,athenasqlParserContextType>>> where Self:Sized{
		self.get_token(TABLE, 0)
	}
	/// Retrieves first TerminalNode corresponding to token RENAME
	/// Returns `None` if there is no child corresponding to token RENAME
	fn RENAME(&self) -> Option<Rc<TerminalNode<'input,athenasqlParserContextType>>> where Self:Sized{
		self.get_token(RENAME, 0)
	}
	/// Retrieves first TerminalNode corresponding to token COLUMN
	/// Returns `None` if there is no child corresponding to token COLUMN
	fn COLUMN(&self) -> Option<Rc<TerminalNode<'input,athenasqlParserContextType>>> where Self:Sized{
		self.get_token(COLUMN, 0)
	}
	/// Retrieves first TerminalNode corresponding to token TO
	/// Returns `None` if there is no child corresponding to token TO
	fn TO(&self) -> Option<Rc<TerminalNode<'input,athenasqlParserContextType>>> where Self:Sized{
		self.get_token(TO, 0)
	}
	fn qualifiedName(&self) -> Option<Rc<QualifiedNameContextAll<'input>>> where Self:Sized{
		self.child_of_type(0)
	}
	fn identifier_all(&self) ->  Vec<Rc<IdentifierContextAll<'input>>> where Self:Sized{
		self.children_of_type()
	}
	fn identifier(&self, i: usize) -> Option<Rc<IdentifierContextAll<'input>>> where Self:Sized{
		self.child_of_type(i)
	}
}

impl<'input> RenameColumnContextAttrs<'input> for RenameColumnContext<'input>{}

pub struct RenameColumnContextExt<'input>{
	base:StatementContextExt<'input>,
	pub tableName: Option<Rc<QualifiedNameContextAll<'input>>>,
	pub from: Option<Rc<IdentifierContextAll<'input>>>,
	pub to: Option<Rc<IdentifierContextAll<'input>>>,
	ph:PhantomData<&'input str>
}

antlr_rust::tid!{RenameColumnContextExt<'a>}

impl<'input> athenasqlParserContext<'input> for RenameColumnContext<'input>{}

impl<'input,'a> Listenable<dyn athenasqlListener<'input> + 'a> for RenameColumnContext<'input>{
	fn enter(&self,listener: &mut (dyn athenasqlListener<'input> + 'a)) {
		listener.enter_every_rule(self);
		listener.enter_renameColumn(self);
	}
}

impl<'input> CustomRuleContext<'input> for RenameColumnContextExt<'input>{
	type TF = LocalTokenFactory<'input>;
	type Ctx = athenasqlParserContextType;
	fn get_rule_index(&self) -> usize { RULE_statement }
	//fn type_rule_index() -> usize where Self: Sized { RULE_statement }
}

impl<'input> Borrow<StatementContextExt<'input>> for RenameColumnContext<'input>{
	fn borrow(&self) -> &StatementContextExt<'input> { &self.base }
}
impl<'input> BorrowMut<StatementContextExt<'input>> for RenameColumnContext<'input>{
	fn borrow_mut(&mut self) -> &mut StatementContextExt<'input> { &mut self.base }
}

impl<'input> StatementContextAttrs<'input> for RenameColumnContext<'input> {}

impl<'input> RenameColumnContextExt<'input>{
	fn new(ctx: &dyn StatementContextAttrs<'input>) -> Rc<StatementContextAll<'input>>  {
		Rc::new(
			StatementContextAll::RenameColumnContext(
				BaseParserRuleContext::copy_from(ctx,RenameColumnContextExt{
        			tableName:None, from:None, to:None, 
        			base: ctx.borrow().clone(),
        			ph:PhantomData
				})
			)
		)
	}
}

pub type SetSessionContext<'input> = BaseParserRuleContext<'input,SetSessionContextExt<'input>>;

pub trait SetSessionContextAttrs<'input>: athenasqlParserContext<'input>{
	/// Retrieves first TerminalNode corresponding to token SET
	/// Returns `None` if there is no child corresponding to token SET
	fn SET(&self) -> Option<Rc<TerminalNode<'input,athenasqlParserContextType>>> where Self:Sized{
		self.get_token(SET, 0)
	}
	/// Retrieves first TerminalNode corresponding to token SESSION
	/// Returns `None` if there is no child corresponding to token SESSION
	fn SESSION(&self) -> Option<Rc<TerminalNode<'input,athenasqlParserContextType>>> where Self:Sized{
		self.get_token(SESSION, 0)
	}
	fn qualifiedName(&self) -> Option<Rc<QualifiedNameContextAll<'input>>> where Self:Sized{
		self.child_of_type(0)
	}
	/// Retrieves first TerminalNode corresponding to token EQ
	/// Returns `None` if there is no child corresponding to token EQ
	fn EQ(&self) -> Option<Rc<TerminalNode<'input,athenasqlParserContextType>>> where Self:Sized{
		self.get_token(EQ, 0)
	}
	fn expression(&self) -> Option<Rc<ExpressionContextAll<'input>>> where Self:Sized{
		self.child_of_type(0)
	}
}

impl<'input> SetSessionContextAttrs<'input> for SetSessionContext<'input>{}

pub struct SetSessionContextExt<'input>{
	base:StatementContextExt<'input>,
	ph:PhantomData<&'input str>
}

antlr_rust::tid!{SetSessionContextExt<'a>}

impl<'input> athenasqlParserContext<'input> for SetSessionContext<'input>{}

impl<'input,'a> Listenable<dyn athenasqlListener<'input> + 'a> for SetSessionContext<'input>{
	fn enter(&self,listener: &mut (dyn athenasqlListener<'input> + 'a)) {
		listener.enter_every_rule(self);
		listener.enter_setSession(self);
	}
}

impl<'input> CustomRuleContext<'input> for SetSessionContextExt<'input>{
	type TF = LocalTokenFactory<'input>;
	type Ctx = athenasqlParserContextType;
	fn get_rule_index(&self) -> usize { RULE_statement }
	//fn type_rule_index() -> usize where Self: Sized { RULE_statement }
}

impl<'input> Borrow<StatementContextExt<'input>> for SetSessionContext<'input>{
	fn borrow(&self) -> &StatementContextExt<'input> { &self.base }
}
impl<'input> BorrowMut<StatementContextExt<'input>> for SetSessionContext<'input>{
	fn borrow_mut(&mut self) -> &mut StatementContextExt<'input> { &mut self.base }
}

impl<'input> StatementContextAttrs<'input> for SetSessionContext<'input> {}

impl<'input> SetSessionContextExt<'input>{
	fn new(ctx: &dyn StatementContextAttrs<'input>) -> Rc<StatementContextAll<'input>>  {
		Rc::new(
			StatementContextAll::SetSessionContext(
				BaseParserRuleContext::copy_from(ctx,SetSessionContextExt{
        			base: ctx.borrow().clone(),
        			ph:PhantomData
				})
			)
		)
	}
}

pub type CreateViewContext<'input> = BaseParserRuleContext<'input,CreateViewContextExt<'input>>;

pub trait CreateViewContextAttrs<'input>: athenasqlParserContext<'input>{
	/// Retrieves first TerminalNode corresponding to token CREATE
	/// Returns `None` if there is no child corresponding to token CREATE
	fn CREATE(&self) -> Option<Rc<TerminalNode<'input,athenasqlParserContextType>>> where Self:Sized{
		self.get_token(CREATE, 0)
	}
	/// Retrieves first TerminalNode corresponding to token VIEW
	/// Returns `None` if there is no child corresponding to token VIEW
	fn VIEW(&self) -> Option<Rc<TerminalNode<'input,athenasqlParserContextType>>> where Self:Sized{
		self.get_token(VIEW, 0)
	}
	fn qualifiedName(&self) -> Option<Rc<QualifiedNameContextAll<'input>>> where Self:Sized{
		self.child_of_type(0)
	}
	/// Retrieves first TerminalNode corresponding to token AS
	/// Returns `None` if there is no child corresponding to token AS
	fn AS(&self) -> Option<Rc<TerminalNode<'input,athenasqlParserContextType>>> where Self:Sized{
		self.get_token(AS, 0)
	}
	fn query(&self) -> Option<Rc<QueryContextAll<'input>>> where Self:Sized{
		self.child_of_type(0)
	}
	/// Retrieves first TerminalNode corresponding to token OR
	/// Returns `None` if there is no child corresponding to token OR
	fn OR(&self) -> Option<Rc<TerminalNode<'input,athenasqlParserContextType>>> where Self:Sized{
		self.get_token(OR, 0)
	}
	/// Retrieves first TerminalNode corresponding to token REPLACE
	/// Returns `None` if there is no child corresponding to token REPLACE
	fn REPLACE(&self) -> Option<Rc<TerminalNode<'input,athenasqlParserContextType>>> where Self:Sized{
		self.get_token(REPLACE, 0)
	}
}

impl<'input> CreateViewContextAttrs<'input> for CreateViewContext<'input>{}

pub struct CreateViewContextExt<'input>{
	base:StatementContextExt<'input>,
	ph:PhantomData<&'input str>
}

antlr_rust::tid!{CreateViewContextExt<'a>}

impl<'input> athenasqlParserContext<'input> for CreateViewContext<'input>{}

impl<'input,'a> Listenable<dyn athenasqlListener<'input> + 'a> for CreateViewContext<'input>{
	fn enter(&self,listener: &mut (dyn athenasqlListener<'input> + 'a)) {
		listener.enter_every_rule(self);
		listener.enter_createView(self);
	}
}

impl<'input> CustomRuleContext<'input> for CreateViewContextExt<'input>{
	type TF = LocalTokenFactory<'input>;
	type Ctx = athenasqlParserContextType;
	fn get_rule_index(&self) -> usize { RULE_statement }
	//fn type_rule_index() -> usize where Self: Sized { RULE_statement }
}

impl<'input> Borrow<StatementContextExt<'input>> for CreateViewContext<'input>{
	fn borrow(&self) -> &StatementContextExt<'input> { &self.base }
}
impl<'input> BorrowMut<StatementContextExt<'input>> for CreateViewContext<'input>{
	fn borrow_mut(&mut self) -> &mut StatementContextExt<'input> { &mut self.base }
}

impl<'input> StatementContextAttrs<'input> for CreateViewContext<'input> {}

impl<'input> CreateViewContextExt<'input>{
	fn new(ctx: &dyn StatementContextAttrs<'input>) -> Rc<StatementContextAll<'input>>  {
		Rc::new(
			StatementContextAll::CreateViewContext(
				BaseParserRuleContext::copy_from(ctx,CreateViewContextExt{
        			base: ctx.borrow().clone(),
        			ph:PhantomData
				})
			)
		)
	}
}

pub type ShowCreateTableContext<'input> = BaseParserRuleContext<'input,ShowCreateTableContextExt<'input>>;

pub trait ShowCreateTableContextAttrs<'input>: athenasqlParserContext<'input>{
	/// Retrieves first TerminalNode corresponding to token SHOW
	/// Returns `None` if there is no child corresponding to token SHOW
	fn SHOW(&self) -> Option<Rc<TerminalNode<'input,athenasqlParserContextType>>> where Self:Sized{
		self.get_token(SHOW, 0)
	}
	/// Retrieves first TerminalNode corresponding to token CREATE
	/// Returns `None` if there is no child corresponding to token CREATE
	fn CREATE(&self) -> Option<Rc<TerminalNode<'input,athenasqlParserContextType>>> where Self:Sized{
		self.get_token(CREATE, 0)
	}
	/// Retrieves first TerminalNode corresponding to token TABLE
	/// Returns `None` if there is no child corresponding to token TABLE
	fn TABLE(&self) -> Option<Rc<TerminalNode<'input,athenasqlParserContextType>>> where Self:Sized{
		self.get_token(TABLE, 0)
	}
	fn qualifiedName(&self) -> Option<Rc<QualifiedNameContextAll<'input>>> where Self:Sized{
		self.child_of_type(0)
	}
}

impl<'input> ShowCreateTableContextAttrs<'input> for ShowCreateTableContext<'input>{}

pub struct ShowCreateTableContextExt<'input>{
	base:StatementContextExt<'input>,
	ph:PhantomData<&'input str>
}

antlr_rust::tid!{ShowCreateTableContextExt<'a>}

impl<'input> athenasqlParserContext<'input> for ShowCreateTableContext<'input>{}

impl<'input,'a> Listenable<dyn athenasqlListener<'input> + 'a> for ShowCreateTableContext<'input>{
	fn enter(&self,listener: &mut (dyn athenasqlListener<'input> + 'a)) {
		listener.enter_every_rule(self);
		listener.enter_showCreateTable(self);
	}
}

impl<'input> CustomRuleContext<'input> for ShowCreateTableContextExt<'input>{
	type TF = LocalTokenFactory<'input>;
	type Ctx = athenasqlParserContextType;
	fn get_rule_index(&self) -> usize { RULE_statement }
	//fn type_rule_index() -> usize where Self: Sized { RULE_statement }
}

impl<'input> Borrow<StatementContextExt<'input>> for ShowCreateTableContext<'input>{
	fn borrow(&self) -> &StatementContextExt<'input> { &self.base }
}
impl<'input> BorrowMut<StatementContextExt<'input>> for ShowCreateTableContext<'input>{
	fn borrow_mut(&mut self) -> &mut StatementContextExt<'input> { &mut self.base }
}

impl<'input> StatementContextAttrs<'input> for ShowCreateTableContext<'input> {}

impl<'input> ShowCreateTableContextExt<'input>{
	fn new(ctx: &dyn StatementContextAttrs<'input>) -> Rc<StatementContextAll<'input>>  {
		Rc::new(
			StatementContextAll::ShowCreateTableContext(
				BaseParserRuleContext::copy_from(ctx,ShowCreateTableContextExt{
        			base: ctx.borrow().clone(),
        			ph:PhantomData
				})
			)
		)
	}
}

pub type ShowSchemasContext<'input> = BaseParserRuleContext<'input,ShowSchemasContextExt<'input>>;

pub trait ShowSchemasContextAttrs<'input>: athenasqlParserContext<'input>{
	/// Retrieves first TerminalNode corresponding to token SHOW
	/// Returns `None` if there is no child corresponding to token SHOW
	fn SHOW(&self) -> Option<Rc<TerminalNode<'input,athenasqlParserContextType>>> where Self:Sized{
		self.get_token(SHOW, 0)
	}
	/// Retrieves first TerminalNode corresponding to token SCHEMAS
	/// Returns `None` if there is no child corresponding to token SCHEMAS
	fn SCHEMAS(&self) -> Option<Rc<TerminalNode<'input,athenasqlParserContextType>>> where Self:Sized{
		self.get_token(SCHEMAS, 0)
	}
	fn identifier(&self) -> Option<Rc<IdentifierContextAll<'input>>> where Self:Sized{
		self.child_of_type(0)
	}
	/// Retrieves first TerminalNode corresponding to token LIKE
	/// Returns `None` if there is no child corresponding to token LIKE
	fn LIKE(&self) -> Option<Rc<TerminalNode<'input,athenasqlParserContextType>>> where Self:Sized{
		self.get_token(LIKE, 0)
	}
	/// Retrieves first TerminalNode corresponding to token FROM
	/// Returns `None` if there is no child corresponding to token FROM
	fn FROM(&self) -> Option<Rc<TerminalNode<'input,athenasqlParserContextType>>> where Self:Sized{
		self.get_token(FROM, 0)
	}
	/// Retrieves first TerminalNode corresponding to token IN
	/// Returns `None` if there is no child corresponding to token IN
	fn IN(&self) -> Option<Rc<TerminalNode<'input,athenasqlParserContextType>>> where Self:Sized{
		self.get_token(IN, 0)
	}
	/// Retrieves first TerminalNode corresponding to token STRING
	/// Returns `None` if there is no child corresponding to token STRING
	fn STRING(&self) -> Option<Rc<TerminalNode<'input,athenasqlParserContextType>>> where Self:Sized{
		self.get_token(STRING, 0)
	}
}

impl<'input> ShowSchemasContextAttrs<'input> for ShowSchemasContext<'input>{}

pub struct ShowSchemasContextExt<'input>{
	base:StatementContextExt<'input>,
	pub pattern: Option<TokenType<'input>>,
	ph:PhantomData<&'input str>
}

antlr_rust::tid!{ShowSchemasContextExt<'a>}

impl<'input> athenasqlParserContext<'input> for ShowSchemasContext<'input>{}

impl<'input,'a> Listenable<dyn athenasqlListener<'input> + 'a> for ShowSchemasContext<'input>{
	fn enter(&self,listener: &mut (dyn athenasqlListener<'input> + 'a)) {
		listener.enter_every_rule(self);
		listener.enter_showSchemas(self);
	}
}

impl<'input> CustomRuleContext<'input> for ShowSchemasContextExt<'input>{
	type TF = LocalTokenFactory<'input>;
	type Ctx = athenasqlParserContextType;
	fn get_rule_index(&self) -> usize { RULE_statement }
	//fn type_rule_index() -> usize where Self: Sized { RULE_statement }
}

impl<'input> Borrow<StatementContextExt<'input>> for ShowSchemasContext<'input>{
	fn borrow(&self) -> &StatementContextExt<'input> { &self.base }
}
impl<'input> BorrowMut<StatementContextExt<'input>> for ShowSchemasContext<'input>{
	fn borrow_mut(&mut self) -> &mut StatementContextExt<'input> { &mut self.base }
}

impl<'input> StatementContextAttrs<'input> for ShowSchemasContext<'input> {}

impl<'input> ShowSchemasContextExt<'input>{
	fn new(ctx: &dyn StatementContextAttrs<'input>) -> Rc<StatementContextAll<'input>>  {
		Rc::new(
			StatementContextAll::ShowSchemasContext(
				BaseParserRuleContext::copy_from(ctx,ShowSchemasContextExt{
					pattern:None, 
        			base: ctx.borrow().clone(),
        			ph:PhantomData
				})
			)
		)
	}
}

pub type DropTableContext<'input> = BaseParserRuleContext<'input,DropTableContextExt<'input>>;

pub trait DropTableContextAttrs<'input>: athenasqlParserContext<'input>{
	/// Retrieves first TerminalNode corresponding to token DROP
	/// Returns `None` if there is no child corresponding to token DROP
	fn DROP(&self) -> Option<Rc<TerminalNode<'input,athenasqlParserContextType>>> where Self:Sized{
		self.get_token(DROP, 0)
	}
	/// Retrieves first TerminalNode corresponding to token TABLE
	/// Returns `None` if there is no child corresponding to token TABLE
	fn TABLE(&self) -> Option<Rc<TerminalNode<'input,athenasqlParserContextType>>> where Self:Sized{
		self.get_token(TABLE, 0)
	}
	fn qualifiedName(&self) -> Option<Rc<QualifiedNameContextAll<'input>>> where Self:Sized{
		self.child_of_type(0)
	}
	/// Retrieves first TerminalNode corresponding to token IF
	/// Returns `None` if there is no child corresponding to token IF
	fn IF(&self) -> Option<Rc<TerminalNode<'input,athenasqlParserContextType>>> where Self:Sized{
		self.get_token(IF, 0)
	}
	/// Retrieves first TerminalNode corresponding to token EXISTS
	/// Returns `None` if there is no child corresponding to token EXISTS
	fn EXISTS(&self) -> Option<Rc<TerminalNode<'input,athenasqlParserContextType>>> where Self:Sized{
		self.get_token(EXISTS, 0)
	}
}

impl<'input> DropTableContextAttrs<'input> for DropTableContext<'input>{}

pub struct DropTableContextExt<'input>{
	base:StatementContextExt<'input>,
	ph:PhantomData<&'input str>
}

antlr_rust::tid!{DropTableContextExt<'a>}

impl<'input> athenasqlParserContext<'input> for DropTableContext<'input>{}

impl<'input,'a> Listenable<dyn athenasqlListener<'input> + 'a> for DropTableContext<'input>{
	fn enter(&self,listener: &mut (dyn athenasqlListener<'input> + 'a)) {
		listener.enter_every_rule(self);
		listener.enter_dropTable(self);
	}
}

impl<'input> CustomRuleContext<'input> for DropTableContextExt<'input>{
	type TF = LocalTokenFactory<'input>;
	type Ctx = athenasqlParserContextType;
	fn get_rule_index(&self) -> usize { RULE_statement }
	//fn type_rule_index() -> usize where Self: Sized { RULE_statement }
}

impl<'input> Borrow<StatementContextExt<'input>> for DropTableContext<'input>{
	fn borrow(&self) -> &StatementContextExt<'input> { &self.base }
}
impl<'input> BorrowMut<StatementContextExt<'input>> for DropTableContext<'input>{
	fn borrow_mut(&mut self) -> &mut StatementContextExt<'input> { &mut self.base }
}

impl<'input> StatementContextAttrs<'input> for DropTableContext<'input> {}

impl<'input> DropTableContextExt<'input>{
	fn new(ctx: &dyn StatementContextAttrs<'input>) -> Rc<StatementContextAll<'input>>  {
		Rc::new(
			StatementContextAll::DropTableContext(
				BaseParserRuleContext::copy_from(ctx,DropTableContextExt{
        			base: ctx.borrow().clone(),
        			ph:PhantomData
				})
			)
		)
	}
}

pub type ShowColumnsContext<'input> = BaseParserRuleContext<'input,ShowColumnsContextExt<'input>>;

pub trait ShowColumnsContextAttrs<'input>: athenasqlParserContext<'input>{
	/// Retrieves first TerminalNode corresponding to token SHOW
	/// Returns `None` if there is no child corresponding to token SHOW
	fn SHOW(&self) -> Option<Rc<TerminalNode<'input,athenasqlParserContextType>>> where Self:Sized{
		self.get_token(SHOW, 0)
	}
	/// Retrieves first TerminalNode corresponding to token COLUMNS
	/// Returns `None` if there is no child corresponding to token COLUMNS
	fn COLUMNS(&self) -> Option<Rc<TerminalNode<'input,athenasqlParserContextType>>> where Self:Sized{
		self.get_token(COLUMNS, 0)
	}
	fn qualifiedName(&self) -> Option<Rc<QualifiedNameContextAll<'input>>> where Self:Sized{
		self.child_of_type(0)
	}
	/// Retrieves first TerminalNode corresponding to token FROM
	/// Returns `None` if there is no child corresponding to token FROM
	fn FROM(&self) -> Option<Rc<TerminalNode<'input,athenasqlParserContextType>>> where Self:Sized{
		self.get_token(FROM, 0)
	}
	/// Retrieves first TerminalNode corresponding to token IN
	/// Returns `None` if there is no child corresponding to token IN
	fn IN(&self) -> Option<Rc<TerminalNode<'input,athenasqlParserContextType>>> where Self:Sized{
		self.get_token(IN, 0)
	}
	/// Retrieves first TerminalNode corresponding to token DESCRIBE
	/// Returns `None` if there is no child corresponding to token DESCRIBE
	fn DESCRIBE(&self) -> Option<Rc<TerminalNode<'input,athenasqlParserContextType>>> where Self:Sized{
		self.get_token(DESCRIBE, 0)
	}
	/// Retrieves first TerminalNode corresponding to token DESC
	/// Returns `None` if there is no child corresponding to token DESC
	fn DESC(&self) -> Option<Rc<TerminalNode<'input,athenasqlParserContextType>>> where Self:Sized{
		self.get_token(DESC, 0)
	}
}

impl<'input> ShowColumnsContextAttrs<'input> for ShowColumnsContext<'input>{}

pub struct ShowColumnsContextExt<'input>{
	base:StatementContextExt<'input>,
	ph:PhantomData<&'input str>
}

antlr_rust::tid!{ShowColumnsContextExt<'a>}

impl<'input> athenasqlParserContext<'input> for ShowColumnsContext<'input>{}

impl<'input,'a> Listenable<dyn athenasqlListener<'input> + 'a> for ShowColumnsContext<'input>{
	fn enter(&self,listener: &mut (dyn athenasqlListener<'input> + 'a)) {
		listener.enter_every_rule(self);
		listener.enter_showColumns(self);
	}
}

impl<'input> CustomRuleContext<'input> for ShowColumnsContextExt<'input>{
	type TF = LocalTokenFactory<'input>;
	type Ctx = athenasqlParserContextType;
	fn get_rule_index(&self) -> usize { RULE_statement }
	//fn type_rule_index() -> usize where Self: Sized { RULE_statement }
}

impl<'input> Borrow<StatementContextExt<'input>> for ShowColumnsContext<'input>{
	fn borrow(&self) -> &StatementContextExt<'input> { &self.base }
}
impl<'input> BorrowMut<StatementContextExt<'input>> for ShowColumnsContext<'input>{
	fn borrow_mut(&mut self) -> &mut StatementContextExt<'input> { &mut self.base }
}

impl<'input> StatementContextAttrs<'input> for ShowColumnsContext<'input> {}

impl<'input> ShowColumnsContextExt<'input>{
	fn new(ctx: &dyn StatementContextAttrs<'input>) -> Rc<StatementContextAll<'input>>  {
		Rc::new(
			StatementContextAll::ShowColumnsContext(
				BaseParserRuleContext::copy_from(ctx,ShowColumnsContextExt{
        			base: ctx.borrow().clone(),
        			ph:PhantomData
				})
			)
		)
	}
}

pub type RollbackContext<'input> = BaseParserRuleContext<'input,RollbackContextExt<'input>>;

pub trait RollbackContextAttrs<'input>: athenasqlParserContext<'input>{
	/// Retrieves first TerminalNode corresponding to token ROLLBACK
	/// Returns `None` if there is no child corresponding to token ROLLBACK
	fn ROLLBACK(&self) -> Option<Rc<TerminalNode<'input,athenasqlParserContextType>>> where Self:Sized{
		self.get_token(ROLLBACK, 0)
	}
	/// Retrieves first TerminalNode corresponding to token WORK
	/// Returns `None` if there is no child corresponding to token WORK
	fn WORK(&self) -> Option<Rc<TerminalNode<'input,athenasqlParserContextType>>> where Self:Sized{
		self.get_token(WORK, 0)
	}
}

impl<'input> RollbackContextAttrs<'input> for RollbackContext<'input>{}

pub struct RollbackContextExt<'input>{
	base:StatementContextExt<'input>,
	ph:PhantomData<&'input str>
}

antlr_rust::tid!{RollbackContextExt<'a>}

impl<'input> athenasqlParserContext<'input> for RollbackContext<'input>{}

impl<'input,'a> Listenable<dyn athenasqlListener<'input> + 'a> for RollbackContext<'input>{
	fn enter(&self,listener: &mut (dyn athenasqlListener<'input> + 'a)) {
		listener.enter_every_rule(self);
		listener.enter_rollback(self);
	}
}

impl<'input> CustomRuleContext<'input> for RollbackContextExt<'input>{
	type TF = LocalTokenFactory<'input>;
	type Ctx = athenasqlParserContextType;
	fn get_rule_index(&self) -> usize { RULE_statement }
	//fn type_rule_index() -> usize where Self: Sized { RULE_statement }
}

impl<'input> Borrow<StatementContextExt<'input>> for RollbackContext<'input>{
	fn borrow(&self) -> &StatementContextExt<'input> { &self.base }
}
impl<'input> BorrowMut<StatementContextExt<'input>> for RollbackContext<'input>{
	fn borrow_mut(&mut self) -> &mut StatementContextExt<'input> { &mut self.base }
}

impl<'input> StatementContextAttrs<'input> for RollbackContext<'input> {}

impl<'input> RollbackContextExt<'input>{
	fn new(ctx: &dyn StatementContextAttrs<'input>) -> Rc<StatementContextAll<'input>>  {
		Rc::new(
			StatementContextAll::RollbackContext(
				BaseParserRuleContext::copy_from(ctx,RollbackContextExt{
        			base: ctx.borrow().clone(),
        			ph:PhantomData
				})
			)
		)
	}
}

pub type AddColumnContext<'input> = BaseParserRuleContext<'input,AddColumnContextExt<'input>>;

pub trait AddColumnContextAttrs<'input>: athenasqlParserContext<'input>{
	/// Retrieves first TerminalNode corresponding to token ALTER
	/// Returns `None` if there is no child corresponding to token ALTER
	fn ALTER(&self) -> Option<Rc<TerminalNode<'input,athenasqlParserContextType>>> where Self:Sized{
		self.get_token(ALTER, 0)
	}
	/// Retrieves first TerminalNode corresponding to token TABLE
	/// Returns `None` if there is no child corresponding to token TABLE
	fn TABLE(&self) -> Option<Rc<TerminalNode<'input,athenasqlParserContextType>>> where Self:Sized{
		self.get_token(TABLE, 0)
	}
	/// Retrieves first TerminalNode corresponding to token ADD
	/// Returns `None` if there is no child corresponding to token ADD
	fn ADD(&self) -> Option<Rc<TerminalNode<'input,athenasqlParserContextType>>> where Self:Sized{
		self.get_token(ADD, 0)
	}
	/// Retrieves first TerminalNode corresponding to token COLUMN
	/// Returns `None` if there is no child corresponding to token COLUMN
	fn COLUMN(&self) -> Option<Rc<TerminalNode<'input,athenasqlParserContextType>>> where Self:Sized{
		self.get_token(COLUMN, 0)
	}
	fn qualifiedName(&self) -> Option<Rc<QualifiedNameContextAll<'input>>> where Self:Sized{
		self.child_of_type(0)
	}
	fn columnDefinition(&self) -> Option<Rc<ColumnDefinitionContextAll<'input>>> where Self:Sized{
		self.child_of_type(0)
	}
}

impl<'input> AddColumnContextAttrs<'input> for AddColumnContext<'input>{}

pub struct AddColumnContextExt<'input>{
	base:StatementContextExt<'input>,
	pub tableName: Option<Rc<QualifiedNameContextAll<'input>>>,
	pub column: Option<Rc<ColumnDefinitionContextAll<'input>>>,
	ph:PhantomData<&'input str>
}

antlr_rust::tid!{AddColumnContextExt<'a>}

impl<'input> athenasqlParserContext<'input> for AddColumnContext<'input>{}

impl<'input,'a> Listenable<dyn athenasqlListener<'input> + 'a> for AddColumnContext<'input>{
	fn enter(&self,listener: &mut (dyn athenasqlListener<'input> + 'a)) {
		listener.enter_every_rule(self);
		listener.enter_addColumn(self);
	}
}

impl<'input> CustomRuleContext<'input> for AddColumnContextExt<'input>{
	type TF = LocalTokenFactory<'input>;
	type Ctx = athenasqlParserContextType;
	fn get_rule_index(&self) -> usize { RULE_statement }
	//fn type_rule_index() -> usize where Self: Sized { RULE_statement }
}

impl<'input> Borrow<StatementContextExt<'input>> for AddColumnContext<'input>{
	fn borrow(&self) -> &StatementContextExt<'input> { &self.base }
}
impl<'input> BorrowMut<StatementContextExt<'input>> for AddColumnContext<'input>{
	fn borrow_mut(&mut self) -> &mut StatementContextExt<'input> { &mut self.base }
}

impl<'input> StatementContextAttrs<'input> for AddColumnContext<'input> {}

impl<'input> AddColumnContextExt<'input>{
	fn new(ctx: &dyn StatementContextAttrs<'input>) -> Rc<StatementContextAll<'input>>  {
		Rc::new(
			StatementContextAll::AddColumnContext(
				BaseParserRuleContext::copy_from(ctx,AddColumnContextExt{
        			tableName:None, column:None, 
        			base: ctx.borrow().clone(),
        			ph:PhantomData
				})
			)
		)
	}
}

pub type ResetSessionContext<'input> = BaseParserRuleContext<'input,ResetSessionContextExt<'input>>;

pub trait ResetSessionContextAttrs<'input>: athenasqlParserContext<'input>{
	/// Retrieves first TerminalNode corresponding to token RESET
	/// Returns `None` if there is no child corresponding to token RESET
	fn RESET(&self) -> Option<Rc<TerminalNode<'input,athenasqlParserContextType>>> where Self:Sized{
		self.get_token(RESET, 0)
	}
	/// Retrieves first TerminalNode corresponding to token SESSION
	/// Returns `None` if there is no child corresponding to token SESSION
	fn SESSION(&self) -> Option<Rc<TerminalNode<'input,athenasqlParserContextType>>> where Self:Sized{
		self.get_token(SESSION, 0)
	}
	fn qualifiedName(&self) -> Option<Rc<QualifiedNameContextAll<'input>>> where Self:Sized{
		self.child_of_type(0)
	}
}

impl<'input> ResetSessionContextAttrs<'input> for ResetSessionContext<'input>{}

pub struct ResetSessionContextExt<'input>{
	base:StatementContextExt<'input>,
	ph:PhantomData<&'input str>
}

antlr_rust::tid!{ResetSessionContextExt<'a>}

impl<'input> athenasqlParserContext<'input> for ResetSessionContext<'input>{}

impl<'input,'a> Listenable<dyn athenasqlListener<'input> + 'a> for ResetSessionContext<'input>{
	fn enter(&self,listener: &mut (dyn athenasqlListener<'input> + 'a)) {
		listener.enter_every_rule(self);
		listener.enter_resetSession(self);
	}
}

impl<'input> CustomRuleContext<'input> for ResetSessionContextExt<'input>{
	type TF = LocalTokenFactory<'input>;
	type Ctx = athenasqlParserContextType;
	fn get_rule_index(&self) -> usize { RULE_statement }
	//fn type_rule_index() -> usize where Self: Sized { RULE_statement }
}

impl<'input> Borrow<StatementContextExt<'input>> for ResetSessionContext<'input>{
	fn borrow(&self) -> &StatementContextExt<'input> { &self.base }
}
impl<'input> BorrowMut<StatementContextExt<'input>> for ResetSessionContext<'input>{
	fn borrow_mut(&mut self) -> &mut StatementContextExt<'input> { &mut self.base }
}

impl<'input> StatementContextAttrs<'input> for ResetSessionContext<'input> {}

impl<'input> ResetSessionContextExt<'input>{
	fn new(ctx: &dyn StatementContextAttrs<'input>) -> Rc<StatementContextAll<'input>>  {
		Rc::new(
			StatementContextAll::ResetSessionContext(
				BaseParserRuleContext::copy_from(ctx,ResetSessionContextExt{
        			base: ctx.borrow().clone(),
        			ph:PhantomData
				})
			)
		)
	}
}

pub type InsertIntoContext<'input> = BaseParserRuleContext<'input,InsertIntoContextExt<'input>>;

pub trait InsertIntoContextAttrs<'input>: athenasqlParserContext<'input>{
	/// Retrieves first TerminalNode corresponding to token INSERT
	/// Returns `None` if there is no child corresponding to token INSERT
	fn INSERT(&self) -> Option<Rc<TerminalNode<'input,athenasqlParserContextType>>> where Self:Sized{
		self.get_token(INSERT, 0)
	}
	/// Retrieves first TerminalNode corresponding to token INTO
	/// Returns `None` if there is no child corresponding to token INTO
	fn INTO(&self) -> Option<Rc<TerminalNode<'input,athenasqlParserContextType>>> where Self:Sized{
		self.get_token(INTO, 0)
	}
	fn qualifiedName(&self) -> Option<Rc<QualifiedNameContextAll<'input>>> where Self:Sized{
		self.child_of_type(0)
	}
	fn query(&self) -> Option<Rc<QueryContextAll<'input>>> where Self:Sized{
		self.child_of_type(0)
	}
	fn columnAliases(&self) -> Option<Rc<ColumnAliasesContextAll<'input>>> where Self:Sized{
		self.child_of_type(0)
	}
}

impl<'input> InsertIntoContextAttrs<'input> for InsertIntoContext<'input>{}

pub struct InsertIntoContextExt<'input>{
	base:StatementContextExt<'input>,
	ph:PhantomData<&'input str>
}

antlr_rust::tid!{InsertIntoContextExt<'a>}

impl<'input> athenasqlParserContext<'input> for InsertIntoContext<'input>{}

impl<'input,'a> Listenable<dyn athenasqlListener<'input> + 'a> for InsertIntoContext<'input>{
	fn enter(&self,listener: &mut (dyn athenasqlListener<'input> + 'a)) {
		listener.enter_every_rule(self);
		listener.enter_insertInto(self);
	}
}

impl<'input> CustomRuleContext<'input> for InsertIntoContextExt<'input>{
	type TF = LocalTokenFactory<'input>;
	type Ctx = athenasqlParserContextType;
	fn get_rule_index(&self) -> usize { RULE_statement }
	//fn type_rule_index() -> usize where Self: Sized { RULE_statement }
}

impl<'input> Borrow<StatementContextExt<'input>> for InsertIntoContext<'input>{
	fn borrow(&self) -> &StatementContextExt<'input> { &self.base }
}
impl<'input> BorrowMut<StatementContextExt<'input>> for InsertIntoContext<'input>{
	fn borrow_mut(&mut self) -> &mut StatementContextExt<'input> { &mut self.base }
}

impl<'input> StatementContextAttrs<'input> for InsertIntoContext<'input> {}

impl<'input> InsertIntoContextExt<'input>{
	fn new(ctx: &dyn StatementContextAttrs<'input>) -> Rc<StatementContextAll<'input>>  {
		Rc::new(
			StatementContextAll::InsertIntoContext(
				BaseParserRuleContext::copy_from(ctx,InsertIntoContextExt{
        			base: ctx.borrow().clone(),
        			ph:PhantomData
				})
			)
		)
	}
}

pub type ShowSessionContext<'input> = BaseParserRuleContext<'input,ShowSessionContextExt<'input>>;

pub trait ShowSessionContextAttrs<'input>: athenasqlParserContext<'input>{
	/// Retrieves first TerminalNode corresponding to token SHOW
	/// Returns `None` if there is no child corresponding to token SHOW
	fn SHOW(&self) -> Option<Rc<TerminalNode<'input,athenasqlParserContextType>>> where Self:Sized{
		self.get_token(SHOW, 0)
	}
	/// Retrieves first TerminalNode corresponding to token SESSION
	/// Returns `None` if there is no child corresponding to token SESSION
	fn SESSION(&self) -> Option<Rc<TerminalNode<'input,athenasqlParserContextType>>> where Self:Sized{
		self.get_token(SESSION, 0)
	}
}

impl<'input> ShowSessionContextAttrs<'input> for ShowSessionContext<'input>{}

pub struct ShowSessionContextExt<'input>{
	base:StatementContextExt<'input>,
	ph:PhantomData<&'input str>
}

antlr_rust::tid!{ShowSessionContextExt<'a>}

impl<'input> athenasqlParserContext<'input> for ShowSessionContext<'input>{}

impl<'input,'a> Listenable<dyn athenasqlListener<'input> + 'a> for ShowSessionContext<'input>{
	fn enter(&self,listener: &mut (dyn athenasqlListener<'input> + 'a)) {
		listener.enter_every_rule(self);
		listener.enter_showSession(self);
	}
}

impl<'input> CustomRuleContext<'input> for ShowSessionContextExt<'input>{
	type TF = LocalTokenFactory<'input>;
	type Ctx = athenasqlParserContextType;
	fn get_rule_index(&self) -> usize { RULE_statement }
	//fn type_rule_index() -> usize where Self: Sized { RULE_statement }
}

impl<'input> Borrow<StatementContextExt<'input>> for ShowSessionContext<'input>{
	fn borrow(&self) -> &StatementContextExt<'input> { &self.base }
}
impl<'input> BorrowMut<StatementContextExt<'input>> for ShowSessionContext<'input>{
	fn borrow_mut(&mut self) -> &mut StatementContextExt<'input> { &mut self.base }
}

impl<'input> StatementContextAttrs<'input> for ShowSessionContext<'input> {}

impl<'input> ShowSessionContextExt<'input>{
	fn new(ctx: &dyn StatementContextAttrs<'input>) -> Rc<StatementContextAll<'input>>  {
		Rc::new(
			StatementContextAll::ShowSessionContext(
				BaseParserRuleContext::copy_from(ctx,ShowSessionContextExt{
        			base: ctx.borrow().clone(),
        			ph:PhantomData
				})
			)
		)
	}
}

pub type CreateSchemaContext<'input> = BaseParserRuleContext<'input,CreateSchemaContextExt<'input>>;

pub trait CreateSchemaContextAttrs<'input>: athenasqlParserContext<'input>{
	/// Retrieves first TerminalNode corresponding to token CREATE
	/// Returns `None` if there is no child corresponding to token CREATE
	fn CREATE(&self) -> Option<Rc<TerminalNode<'input,athenasqlParserContextType>>> where Self:Sized{
		self.get_token(CREATE, 0)
	}
	/// Retrieves first TerminalNode corresponding to token SCHEMA
	/// Returns `None` if there is no child corresponding to token SCHEMA
	fn SCHEMA(&self) -> Option<Rc<TerminalNode<'input,athenasqlParserContextType>>> where Self:Sized{
		self.get_token(SCHEMA, 0)
	}
	fn qualifiedName(&self) -> Option<Rc<QualifiedNameContextAll<'input>>> where Self:Sized{
		self.child_of_type(0)
	}
	/// Retrieves first TerminalNode corresponding to token IF
	/// Returns `None` if there is no child corresponding to token IF
	fn IF(&self) -> Option<Rc<TerminalNode<'input,athenasqlParserContextType>>> where Self:Sized{
		self.get_token(IF, 0)
	}
	/// Retrieves first TerminalNode corresponding to token NOT
	/// Returns `None` if there is no child corresponding to token NOT
	fn NOT(&self) -> Option<Rc<TerminalNode<'input,athenasqlParserContextType>>> where Self:Sized{
		self.get_token(NOT, 0)
	}
	/// Retrieves first TerminalNode corresponding to token EXISTS
	/// Returns `None` if there is no child corresponding to token EXISTS
	fn EXISTS(&self) -> Option<Rc<TerminalNode<'input,athenasqlParserContextType>>> where Self:Sized{
		self.get_token(EXISTS, 0)
	}
	/// Retrieves first TerminalNode corresponding to token WITH
	/// Returns `None` if there is no child corresponding to token WITH
	fn WITH(&self) -> Option<Rc<TerminalNode<'input,athenasqlParserContextType>>> where Self:Sized{
		self.get_token(WITH, 0)
	}
	fn tableProperties(&self) -> Option<Rc<TablePropertiesContextAll<'input>>> where Self:Sized{
		self.child_of_type(0)
	}
}

impl<'input> CreateSchemaContextAttrs<'input> for CreateSchemaContext<'input>{}

pub struct CreateSchemaContextExt<'input>{
	base:StatementContextExt<'input>,
	ph:PhantomData<&'input str>
}

antlr_rust::tid!{CreateSchemaContextExt<'a>}

impl<'input> athenasqlParserContext<'input> for CreateSchemaContext<'input>{}

impl<'input,'a> Listenable<dyn athenasqlListener<'input> + 'a> for CreateSchemaContext<'input>{
	fn enter(&self,listener: &mut (dyn athenasqlListener<'input> + 'a)) {
		listener.enter_every_rule(self);
		listener.enter_createSchema(self);
	}
}

impl<'input> CustomRuleContext<'input> for CreateSchemaContextExt<'input>{
	type TF = LocalTokenFactory<'input>;
	type Ctx = athenasqlParserContextType;
	fn get_rule_index(&self) -> usize { RULE_statement }
	//fn type_rule_index() -> usize where Self: Sized { RULE_statement }
}

impl<'input> Borrow<StatementContextExt<'input>> for CreateSchemaContext<'input>{
	fn borrow(&self) -> &StatementContextExt<'input> { &self.base }
}
impl<'input> BorrowMut<StatementContextExt<'input>> for CreateSchemaContext<'input>{
	fn borrow_mut(&mut self) -> &mut StatementContextExt<'input> { &mut self.base }
}

impl<'input> StatementContextAttrs<'input> for CreateSchemaContext<'input> {}

impl<'input> CreateSchemaContextExt<'input>{
	fn new(ctx: &dyn StatementContextAttrs<'input>) -> Rc<StatementContextAll<'input>>  {
		Rc::new(
			StatementContextAll::CreateSchemaContext(
				BaseParserRuleContext::copy_from(ctx,CreateSchemaContextExt{
        			base: ctx.borrow().clone(),
        			ph:PhantomData
				})
			)
		)
	}
}

pub type ExecuteContext<'input> = BaseParserRuleContext<'input,ExecuteContextExt<'input>>;

pub trait ExecuteContextAttrs<'input>: athenasqlParserContext<'input>{
	/// Retrieves first TerminalNode corresponding to token EXECUTE
	/// Returns `None` if there is no child corresponding to token EXECUTE
	fn EXECUTE(&self) -> Option<Rc<TerminalNode<'input,athenasqlParserContextType>>> where Self:Sized{
		self.get_token(EXECUTE, 0)
	}
	fn identifier(&self) -> Option<Rc<IdentifierContextAll<'input>>> where Self:Sized{
		self.child_of_type(0)
	}
	/// Retrieves first TerminalNode corresponding to token USING
	/// Returns `None` if there is no child corresponding to token USING
	fn USING(&self) -> Option<Rc<TerminalNode<'input,athenasqlParserContextType>>> where Self:Sized{
		self.get_token(USING, 0)
	}
	fn expression_all(&self) ->  Vec<Rc<ExpressionContextAll<'input>>> where Self:Sized{
		self.children_of_type()
	}
	fn expression(&self, i: usize) -> Option<Rc<ExpressionContextAll<'input>>> where Self:Sized{
		self.child_of_type(i)
	}
}

impl<'input> ExecuteContextAttrs<'input> for ExecuteContext<'input>{}

pub struct ExecuteContextExt<'input>{
	base:StatementContextExt<'input>,
	ph:PhantomData<&'input str>
}

antlr_rust::tid!{ExecuteContextExt<'a>}

impl<'input> athenasqlParserContext<'input> for ExecuteContext<'input>{}

impl<'input,'a> Listenable<dyn athenasqlListener<'input> + 'a> for ExecuteContext<'input>{
	fn enter(&self,listener: &mut (dyn athenasqlListener<'input> + 'a)) {
		listener.enter_every_rule(self);
		listener.enter_execute(self);
	}
}

impl<'input> CustomRuleContext<'input> for ExecuteContextExt<'input>{
	type TF = LocalTokenFactory<'input>;
	type Ctx = athenasqlParserContextType;
	fn get_rule_index(&self) -> usize { RULE_statement }
	//fn type_rule_index() -> usize where Self: Sized { RULE_statement }
}

impl<'input> Borrow<StatementContextExt<'input>> for ExecuteContext<'input>{
	fn borrow(&self) -> &StatementContextExt<'input> { &self.base }
}
impl<'input> BorrowMut<StatementContextExt<'input>> for ExecuteContext<'input>{
	fn borrow_mut(&mut self) -> &mut StatementContextExt<'input> { &mut self.base }
}

impl<'input> StatementContextAttrs<'input> for ExecuteContext<'input> {}

impl<'input> ExecuteContextExt<'input>{
	fn new(ctx: &dyn StatementContextAttrs<'input>) -> Rc<StatementContextAll<'input>>  {
		Rc::new(
			StatementContextAll::ExecuteContext(
				BaseParserRuleContext::copy_from(ctx,ExecuteContextExt{
        			base: ctx.borrow().clone(),
        			ph:PhantomData
				})
			)
		)
	}
}

pub type CallContext<'input> = BaseParserRuleContext<'input,CallContextExt<'input>>;

pub trait CallContextAttrs<'input>: athenasqlParserContext<'input>{
	/// Retrieves first TerminalNode corresponding to token CALL
	/// Returns `None` if there is no child corresponding to token CALL
	fn CALL(&self) -> Option<Rc<TerminalNode<'input,athenasqlParserContextType>>> where Self:Sized{
		self.get_token(CALL, 0)
	}
	fn qualifiedName(&self) -> Option<Rc<QualifiedNameContextAll<'input>>> where Self:Sized{
		self.child_of_type(0)
	}
	fn callArgument_all(&self) ->  Vec<Rc<CallArgumentContextAll<'input>>> where Self:Sized{
		self.children_of_type()
	}
	fn callArgument(&self, i: usize) -> Option<Rc<CallArgumentContextAll<'input>>> where Self:Sized{
		self.child_of_type(i)
	}
}

impl<'input> CallContextAttrs<'input> for CallContext<'input>{}

pub struct CallContextExt<'input>{
	base:StatementContextExt<'input>,
	ph:PhantomData<&'input str>
}

antlr_rust::tid!{CallContextExt<'a>}

impl<'input> athenasqlParserContext<'input> for CallContext<'input>{}

impl<'input,'a> Listenable<dyn athenasqlListener<'input> + 'a> for CallContext<'input>{
	fn enter(&self,listener: &mut (dyn athenasqlListener<'input> + 'a)) {
		listener.enter_every_rule(self);
		listener.enter_call(self);
	}
}

impl<'input> CustomRuleContext<'input> for CallContextExt<'input>{
	type TF = LocalTokenFactory<'input>;
	type Ctx = athenasqlParserContextType;
	fn get_rule_index(&self) -> usize { RULE_statement }
	//fn type_rule_index() -> usize where Self: Sized { RULE_statement }
}

impl<'input> Borrow<StatementContextExt<'input>> for CallContext<'input>{
	fn borrow(&self) -> &StatementContextExt<'input> { &self.base }
}
impl<'input> BorrowMut<StatementContextExt<'input>> for CallContext<'input>{
	fn borrow_mut(&mut self) -> &mut StatementContextExt<'input> { &mut self.base }
}

impl<'input> StatementContextAttrs<'input> for CallContext<'input> {}

impl<'input> CallContextExt<'input>{
	fn new(ctx: &dyn StatementContextAttrs<'input>) -> Rc<StatementContextAll<'input>>  {
		Rc::new(
			StatementContextAll::CallContext(
				BaseParserRuleContext::copy_from(ctx,CallContextExt{
        			base: ctx.borrow().clone(),
        			ph:PhantomData
				})
			)
		)
	}
}

pub type RenameSchemaContext<'input> = BaseParserRuleContext<'input,RenameSchemaContextExt<'input>>;

pub trait RenameSchemaContextAttrs<'input>: athenasqlParserContext<'input>{
	/// Retrieves first TerminalNode corresponding to token ALTER
	/// Returns `None` if there is no child corresponding to token ALTER
	fn ALTER(&self) -> Option<Rc<TerminalNode<'input,athenasqlParserContextType>>> where Self:Sized{
		self.get_token(ALTER, 0)
	}
	/// Retrieves first TerminalNode corresponding to token SCHEMA
	/// Returns `None` if there is no child corresponding to token SCHEMA
	fn SCHEMA(&self) -> Option<Rc<TerminalNode<'input,athenasqlParserContextType>>> where Self:Sized{
		self.get_token(SCHEMA, 0)
	}
	fn qualifiedName(&self) -> Option<Rc<QualifiedNameContextAll<'input>>> where Self:Sized{
		self.child_of_type(0)
	}
	/// Retrieves first TerminalNode corresponding to token RENAME
	/// Returns `None` if there is no child corresponding to token RENAME
	fn RENAME(&self) -> Option<Rc<TerminalNode<'input,athenasqlParserContextType>>> where Self:Sized{
		self.get_token(RENAME, 0)
	}
	/// Retrieves first TerminalNode corresponding to token TO
	/// Returns `None` if there is no child corresponding to token TO
	fn TO(&self) -> Option<Rc<TerminalNode<'input,athenasqlParserContextType>>> where Self:Sized{
		self.get_token(TO, 0)
	}
	fn identifier(&self) -> Option<Rc<IdentifierContextAll<'input>>> where Self:Sized{
		self.child_of_type(0)
	}
}

impl<'input> RenameSchemaContextAttrs<'input> for RenameSchemaContext<'input>{}

pub struct RenameSchemaContextExt<'input>{
	base:StatementContextExt<'input>,
	ph:PhantomData<&'input str>
}

antlr_rust::tid!{RenameSchemaContextExt<'a>}

impl<'input> athenasqlParserContext<'input> for RenameSchemaContext<'input>{}

impl<'input,'a> Listenable<dyn athenasqlListener<'input> + 'a> for RenameSchemaContext<'input>{
	fn enter(&self,listener: &mut (dyn athenasqlListener<'input> + 'a)) {
		listener.enter_every_rule(self);
		listener.enter_renameSchema(self);
	}
}

impl<'input> CustomRuleContext<'input> for RenameSchemaContextExt<'input>{
	type TF = LocalTokenFactory<'input>;
	type Ctx = athenasqlParserContextType;
	fn get_rule_index(&self) -> usize { RULE_statement }
	//fn type_rule_index() -> usize where Self: Sized { RULE_statement }
}

impl<'input> Borrow<StatementContextExt<'input>> for RenameSchemaContext<'input>{
	fn borrow(&self) -> &StatementContextExt<'input> { &self.base }
}
impl<'input> BorrowMut<StatementContextExt<'input>> for RenameSchemaContext<'input>{
	fn borrow_mut(&mut self) -> &mut StatementContextExt<'input> { &mut self.base }
}

impl<'input> StatementContextAttrs<'input> for RenameSchemaContext<'input> {}

impl<'input> RenameSchemaContextExt<'input>{
	fn new(ctx: &dyn StatementContextAttrs<'input>) -> Rc<StatementContextAll<'input>>  {
		Rc::new(
			StatementContextAll::RenameSchemaContext(
				BaseParserRuleContext::copy_from(ctx,RenameSchemaContextExt{
        			base: ctx.borrow().clone(),
        			ph:PhantomData
				})
			)
		)
	}
}

pub type ShowFunctionsContext<'input> = BaseParserRuleContext<'input,ShowFunctionsContextExt<'input>>;

pub trait ShowFunctionsContextAttrs<'input>: athenasqlParserContext<'input>{
	/// Retrieves first TerminalNode corresponding to token SHOW
	/// Returns `None` if there is no child corresponding to token SHOW
	fn SHOW(&self) -> Option<Rc<TerminalNode<'input,athenasqlParserContextType>>> where Self:Sized{
		self.get_token(SHOW, 0)
	}
	/// Retrieves first TerminalNode corresponding to token FUNCTIONS
	/// Returns `None` if there is no child corresponding to token FUNCTIONS
	fn FUNCTIONS(&self) -> Option<Rc<TerminalNode<'input,athenasqlParserContextType>>> where Self:Sized{
		self.get_token(FUNCTIONS, 0)
	}
}

impl<'input> ShowFunctionsContextAttrs<'input> for ShowFunctionsContext<'input>{}

pub struct ShowFunctionsContextExt<'input>{
	base:StatementContextExt<'input>,
	ph:PhantomData<&'input str>
}

antlr_rust::tid!{ShowFunctionsContextExt<'a>}

impl<'input> athenasqlParserContext<'input> for ShowFunctionsContext<'input>{}

impl<'input,'a> Listenable<dyn athenasqlListener<'input> + 'a> for ShowFunctionsContext<'input>{
	fn enter(&self,listener: &mut (dyn athenasqlListener<'input> + 'a)) {
		listener.enter_every_rule(self);
		listener.enter_showFunctions(self);
	}
}

impl<'input> CustomRuleContext<'input> for ShowFunctionsContextExt<'input>{
	type TF = LocalTokenFactory<'input>;
	type Ctx = athenasqlParserContextType;
	fn get_rule_index(&self) -> usize { RULE_statement }
	//fn type_rule_index() -> usize where Self: Sized { RULE_statement }
}

impl<'input> Borrow<StatementContextExt<'input>> for ShowFunctionsContext<'input>{
	fn borrow(&self) -> &StatementContextExt<'input> { &self.base }
}
impl<'input> BorrowMut<StatementContextExt<'input>> for ShowFunctionsContext<'input>{
	fn borrow_mut(&mut self) -> &mut StatementContextExt<'input> { &mut self.base }
}

impl<'input> StatementContextAttrs<'input> for ShowFunctionsContext<'input> {}

impl<'input> ShowFunctionsContextExt<'input>{
	fn new(ctx: &dyn StatementContextAttrs<'input>) -> Rc<StatementContextAll<'input>>  {
		Rc::new(
			StatementContextAll::ShowFunctionsContext(
				BaseParserRuleContext::copy_from(ctx,ShowFunctionsContextExt{
        			base: ctx.borrow().clone(),
        			ph:PhantomData
				})
			)
		)
	}
}

pub type DescribeOutputContext<'input> = BaseParserRuleContext<'input,DescribeOutputContextExt<'input>>;

pub trait DescribeOutputContextAttrs<'input>: athenasqlParserContext<'input>{
	/// Retrieves first TerminalNode corresponding to token DESCRIBE
	/// Returns `None` if there is no child corresponding to token DESCRIBE
	fn DESCRIBE(&self) -> Option<Rc<TerminalNode<'input,athenasqlParserContextType>>> where Self:Sized{
		self.get_token(DESCRIBE, 0)
	}
	/// Retrieves first TerminalNode corresponding to token OUTPUT
	/// Returns `None` if there is no child corresponding to token OUTPUT
	fn OUTPUT(&self) -> Option<Rc<TerminalNode<'input,athenasqlParserContextType>>> where Self:Sized{
		self.get_token(OUTPUT, 0)
	}
	fn identifier(&self) -> Option<Rc<IdentifierContextAll<'input>>> where Self:Sized{
		self.child_of_type(0)
	}
}

impl<'input> DescribeOutputContextAttrs<'input> for DescribeOutputContext<'input>{}

pub struct DescribeOutputContextExt<'input>{
	base:StatementContextExt<'input>,
	ph:PhantomData<&'input str>
}

antlr_rust::tid!{DescribeOutputContextExt<'a>}

impl<'input> athenasqlParserContext<'input> for DescribeOutputContext<'input>{}

impl<'input,'a> Listenable<dyn athenasqlListener<'input> + 'a> for DescribeOutputContext<'input>{
	fn enter(&self,listener: &mut (dyn athenasqlListener<'input> + 'a)) {
		listener.enter_every_rule(self);
		listener.enter_describeOutput(self);
	}
}

impl<'input> CustomRuleContext<'input> for DescribeOutputContextExt<'input>{
	type TF = LocalTokenFactory<'input>;
	type Ctx = athenasqlParserContextType;
	fn get_rule_index(&self) -> usize { RULE_statement }
	//fn type_rule_index() -> usize where Self: Sized { RULE_statement }
}

impl<'input> Borrow<StatementContextExt<'input>> for DescribeOutputContext<'input>{
	fn borrow(&self) -> &StatementContextExt<'input> { &self.base }
}
impl<'input> BorrowMut<StatementContextExt<'input>> for DescribeOutputContext<'input>{
	fn borrow_mut(&mut self) -> &mut StatementContextExt<'input> { &mut self.base }
}

impl<'input> StatementContextAttrs<'input> for DescribeOutputContext<'input> {}

impl<'input> DescribeOutputContextExt<'input>{
	fn new(ctx: &dyn StatementContextAttrs<'input>) -> Rc<StatementContextAll<'input>>  {
		Rc::new(
			StatementContextAll::DescribeOutputContext(
				BaseParserRuleContext::copy_from(ctx,DescribeOutputContextExt{
        			base: ctx.borrow().clone(),
        			ph:PhantomData
				})
			)
		)
	}
}

pub type DropSchemaContext<'input> = BaseParserRuleContext<'input,DropSchemaContextExt<'input>>;

pub trait DropSchemaContextAttrs<'input>: athenasqlParserContext<'input>{
	/// Retrieves first TerminalNode corresponding to token DROP
	/// Returns `None` if there is no child corresponding to token DROP
	fn DROP(&self) -> Option<Rc<TerminalNode<'input,athenasqlParserContextType>>> where Self:Sized{
		self.get_token(DROP, 0)
	}
	/// Retrieves first TerminalNode corresponding to token SCHEMA
	/// Returns `None` if there is no child corresponding to token SCHEMA
	fn SCHEMA(&self) -> Option<Rc<TerminalNode<'input,athenasqlParserContextType>>> where Self:Sized{
		self.get_token(SCHEMA, 0)
	}
	fn qualifiedName(&self) -> Option<Rc<QualifiedNameContextAll<'input>>> where Self:Sized{
		self.child_of_type(0)
	}
	/// Retrieves first TerminalNode corresponding to token IF
	/// Returns `None` if there is no child corresponding to token IF
	fn IF(&self) -> Option<Rc<TerminalNode<'input,athenasqlParserContextType>>> where Self:Sized{
		self.get_token(IF, 0)
	}
	/// Retrieves first TerminalNode corresponding to token EXISTS
	/// Returns `None` if there is no child corresponding to token EXISTS
	fn EXISTS(&self) -> Option<Rc<TerminalNode<'input,athenasqlParserContextType>>> where Self:Sized{
		self.get_token(EXISTS, 0)
	}
	/// Retrieves first TerminalNode corresponding to token CASCADE
	/// Returns `None` if there is no child corresponding to token CASCADE
	fn CASCADE(&self) -> Option<Rc<TerminalNode<'input,athenasqlParserContextType>>> where Self:Sized{
		self.get_token(CASCADE, 0)
	}
	/// Retrieves first TerminalNode corresponding to token RESTRICT
	/// Returns `None` if there is no child corresponding to token RESTRICT
	fn RESTRICT(&self) -> Option<Rc<TerminalNode<'input,athenasqlParserContextType>>> where Self:Sized{
		self.get_token(RESTRICT, 0)
	}
}

impl<'input> DropSchemaContextAttrs<'input> for DropSchemaContext<'input>{}

pub struct DropSchemaContextExt<'input>{
	base:StatementContextExt<'input>,
	ph:PhantomData<&'input str>
}

antlr_rust::tid!{DropSchemaContextExt<'a>}

impl<'input> athenasqlParserContext<'input> for DropSchemaContext<'input>{}

impl<'input,'a> Listenable<dyn athenasqlListener<'input> + 'a> for DropSchemaContext<'input>{
	fn enter(&self,listener: &mut (dyn athenasqlListener<'input> + 'a)) {
		listener.enter_every_rule(self);
		listener.enter_dropSchema(self);
	}
}

impl<'input> CustomRuleContext<'input> for DropSchemaContextExt<'input>{
	type TF = LocalTokenFactory<'input>;
	type Ctx = athenasqlParserContextType;
	fn get_rule_index(&self) -> usize { RULE_statement }
	//fn type_rule_index() -> usize where Self: Sized { RULE_statement }
}

impl<'input> Borrow<StatementContextExt<'input>> for DropSchemaContext<'input>{
	fn borrow(&self) -> &StatementContextExt<'input> { &self.base }
}
impl<'input> BorrowMut<StatementContextExt<'input>> for DropSchemaContext<'input>{
	fn borrow_mut(&mut self) -> &mut StatementContextExt<'input> { &mut self.base }
}

impl<'input> StatementContextAttrs<'input> for DropSchemaContext<'input> {}

impl<'input> DropSchemaContextExt<'input>{
	fn new(ctx: &dyn StatementContextAttrs<'input>) -> Rc<StatementContextAll<'input>>  {
		Rc::new(
			StatementContextAll::DropSchemaContext(
				BaseParserRuleContext::copy_from(ctx,DropSchemaContextExt{
        			base: ctx.borrow().clone(),
        			ph:PhantomData
				})
			)
		)
	}
}

pub type GrantContext<'input> = BaseParserRuleContext<'input,GrantContextExt<'input>>;

pub trait GrantContextAttrs<'input>: athenasqlParserContext<'input>{
	/// Retrieves all `TerminalNode`s corresponding to token GRANT in current rule
	fn GRANT_all(&self) -> Vec<Rc<TerminalNode<'input,athenasqlParserContextType>>>  where Self:Sized{
		self.children_of_type()
	}
	/// Retrieves 'i's TerminalNode corresponding to token GRANT, starting from 0.
	/// Returns `None` if number of children corresponding to token GRANT is less or equal than `i`.
	fn GRANT(&self, i: usize) -> Option<Rc<TerminalNode<'input,athenasqlParserContextType>>> where Self:Sized{
		self.get_token(GRANT, i)
	}
	/// Retrieves first TerminalNode corresponding to token ON
	/// Returns `None` if there is no child corresponding to token ON
	fn ON(&self) -> Option<Rc<TerminalNode<'input,athenasqlParserContextType>>> where Self:Sized{
		self.get_token(ON, 0)
	}
	fn qualifiedName(&self) -> Option<Rc<QualifiedNameContextAll<'input>>> where Self:Sized{
		self.child_of_type(0)
	}
	/// Retrieves first TerminalNode corresponding to token TO
	/// Returns `None` if there is no child corresponding to token TO
	fn TO(&self) -> Option<Rc<TerminalNode<'input,athenasqlParserContextType>>> where Self:Sized{
		self.get_token(TO, 0)
	}
	fn identifier(&self) -> Option<Rc<IdentifierContextAll<'input>>> where Self:Sized{
		self.child_of_type(0)
	}
	fn privilege_all(&self) ->  Vec<Rc<PrivilegeContextAll<'input>>> where Self:Sized{
		self.children_of_type()
	}
	fn privilege(&self, i: usize) -> Option<Rc<PrivilegeContextAll<'input>>> where Self:Sized{
		self.child_of_type(i)
	}
	/// Retrieves first TerminalNode corresponding to token ALL
	/// Returns `None` if there is no child corresponding to token ALL
	fn ALL(&self) -> Option<Rc<TerminalNode<'input,athenasqlParserContextType>>> where Self:Sized{
		self.get_token(ALL, 0)
	}
	/// Retrieves first TerminalNode corresponding to token PRIVILEGES
	/// Returns `None` if there is no child corresponding to token PRIVILEGES
	fn PRIVILEGES(&self) -> Option<Rc<TerminalNode<'input,athenasqlParserContextType>>> where Self:Sized{
		self.get_token(PRIVILEGES, 0)
	}
	/// Retrieves first TerminalNode corresponding to token TABLE
	/// Returns `None` if there is no child corresponding to token TABLE
	fn TABLE(&self) -> Option<Rc<TerminalNode<'input,athenasqlParserContextType>>> where Self:Sized{
		self.get_token(TABLE, 0)
	}
	/// Retrieves first TerminalNode corresponding to token WITH
	/// Returns `None` if there is no child corresponding to token WITH
	fn WITH(&self) -> Option<Rc<TerminalNode<'input,athenasqlParserContextType>>> where Self:Sized{
		self.get_token(WITH, 0)
	}
	/// Retrieves first TerminalNode corresponding to token OPTION
	/// Returns `None` if there is no child corresponding to token OPTION
	fn OPTION(&self) -> Option<Rc<TerminalNode<'input,athenasqlParserContextType>>> where Self:Sized{
		self.get_token(OPTION, 0)
	}
}

impl<'input> GrantContextAttrs<'input> for GrantContext<'input>{}

pub struct GrantContextExt<'input>{
	base:StatementContextExt<'input>,
	pub grantee: Option<Rc<IdentifierContextAll<'input>>>,
	ph:PhantomData<&'input str>
}

antlr_rust::tid!{GrantContextExt<'a>}

impl<'input> athenasqlParserContext<'input> for GrantContext<'input>{}

impl<'input,'a> Listenable<dyn athenasqlListener<'input> + 'a> for GrantContext<'input>{
	fn enter(&self,listener: &mut (dyn athenasqlListener<'input> + 'a)) {
		listener.enter_every_rule(self);
		listener.enter_grant(self);
	}
}

impl<'input> CustomRuleContext<'input> for GrantContextExt<'input>{
	type TF = LocalTokenFactory<'input>;
	type Ctx = athenasqlParserContextType;
	fn get_rule_index(&self) -> usize { RULE_statement }
	//fn type_rule_index() -> usize where Self: Sized { RULE_statement }
}

impl<'input> Borrow<StatementContextExt<'input>> for GrantContext<'input>{
	fn borrow(&self) -> &StatementContextExt<'input> { &self.base }
}
impl<'input> BorrowMut<StatementContextExt<'input>> for GrantContext<'input>{
	fn borrow_mut(&mut self) -> &mut StatementContextExt<'input> { &mut self.base }
}

impl<'input> StatementContextAttrs<'input> for GrantContext<'input> {}

impl<'input> GrantContextExt<'input>{
	fn new(ctx: &dyn StatementContextAttrs<'input>) -> Rc<StatementContextAll<'input>>  {
		Rc::new(
			StatementContextAll::GrantContext(
				BaseParserRuleContext::copy_from(ctx,GrantContextExt{
        			grantee:None, 
        			base: ctx.borrow().clone(),
        			ph:PhantomData
				})
			)
		)
	}
}

pub type ShowCreateViewContext<'input> = BaseParserRuleContext<'input,ShowCreateViewContextExt<'input>>;

pub trait ShowCreateViewContextAttrs<'input>: athenasqlParserContext<'input>{
	/// Retrieves first TerminalNode corresponding to token SHOW
	/// Returns `None` if there is no child corresponding to token SHOW
	fn SHOW(&self) -> Option<Rc<TerminalNode<'input,athenasqlParserContextType>>> where Self:Sized{
		self.get_token(SHOW, 0)
	}
	/// Retrieves first TerminalNode corresponding to token CREATE
	/// Returns `None` if there is no child corresponding to token CREATE
	fn CREATE(&self) -> Option<Rc<TerminalNode<'input,athenasqlParserContextType>>> where Self:Sized{
		self.get_token(CREATE, 0)
	}
	/// Retrieves first TerminalNode corresponding to token VIEW
	/// Returns `None` if there is no child corresponding to token VIEW
	fn VIEW(&self) -> Option<Rc<TerminalNode<'input,athenasqlParserContextType>>> where Self:Sized{
		self.get_token(VIEW, 0)
	}
	fn qualifiedName(&self) -> Option<Rc<QualifiedNameContextAll<'input>>> where Self:Sized{
		self.child_of_type(0)
	}
}

impl<'input> ShowCreateViewContextAttrs<'input> for ShowCreateViewContext<'input>{}

pub struct ShowCreateViewContextExt<'input>{
	base:StatementContextExt<'input>,
	ph:PhantomData<&'input str>
}

antlr_rust::tid!{ShowCreateViewContextExt<'a>}

impl<'input> athenasqlParserContext<'input> for ShowCreateViewContext<'input>{}

impl<'input,'a> Listenable<dyn athenasqlListener<'input> + 'a> for ShowCreateViewContext<'input>{
	fn enter(&self,listener: &mut (dyn athenasqlListener<'input> + 'a)) {
		listener.enter_every_rule(self);
		listener.enter_showCreateView(self);
	}
}

impl<'input> CustomRuleContext<'input> for ShowCreateViewContextExt<'input>{
	type TF = LocalTokenFactory<'input>;
	type Ctx = athenasqlParserContextType;
	fn get_rule_index(&self) -> usize { RULE_statement }
	//fn type_rule_index() -> usize where Self: Sized { RULE_statement }
}

impl<'input> Borrow<StatementContextExt<'input>> for ShowCreateViewContext<'input>{
	fn borrow(&self) -> &StatementContextExt<'input> { &self.base }
}
impl<'input> BorrowMut<StatementContextExt<'input>> for ShowCreateViewContext<'input>{
	fn borrow_mut(&mut self) -> &mut StatementContextExt<'input> { &mut self.base }
}

impl<'input> StatementContextAttrs<'input> for ShowCreateViewContext<'input> {}

impl<'input> ShowCreateViewContextExt<'input>{
	fn new(ctx: &dyn StatementContextAttrs<'input>) -> Rc<StatementContextAll<'input>>  {
		Rc::new(
			StatementContextAll::ShowCreateViewContext(
				BaseParserRuleContext::copy_from(ctx,ShowCreateViewContextExt{
        			base: ctx.borrow().clone(),
        			ph:PhantomData
				})
			)
		)
	}
}

impl<'input, I, H> athenasqlParser<'input, I, H>
where
    I: TokenStream<'input, TF = LocalTokenFactory<'input> > + TidAble<'input>,
    H: ErrorStrategy<'input,BaseParserType<'input,I>>
{
	pub fn statement(&mut self,)
	-> Result<Rc<StatementContextAll<'input>>,ANTLRError> {
		let mut recog = self;
		let _parentctx = recog.ctx.take();
		let mut _localctx = StatementContextExt::new(_parentctx.clone(), recog.base.get_state());
        recog.base.enter_rule(_localctx.clone(), 6, RULE_statement);
        let mut _localctx: Rc<StatementContextAll> = _localctx;
		let mut _la: isize = -1;
		let result: Result<(), ANTLRError> = (|| {

			recog.base.set_state(488);
			recog.err_handler.sync(&mut recog.base)?;
			match  recog.interpreter.adaptive_predict(44,&mut recog.base)? {
				1 =>{
					let tmp = StatementDefaultContextExt::new(&**_localctx);
					recog.base.enter_outer_alt(Some(tmp.clone()), 1);
					_localctx = tmp;
					{
					/*InvokeRule query*/
					recog.base.set_state(136);
					recog.query()?;

					}
				}
			,
				2 =>{
					let tmp = UseContextExt::new(&**_localctx);
					recog.base.enter_outer_alt(Some(tmp.clone()), 2);
					_localctx = tmp;
					{
					recog.base.set_state(137);
					recog.base.match_token(USE,&mut recog.err_handler)?;

					/*InvokeRule identifier*/
					recog.base.set_state(138);
					let tmp = recog.identifier()?;
					if let StatementContextAll::UseContext(ctx) = cast_mut::<_,StatementContextAll >(&mut _localctx){
					ctx.schema = Some(tmp.clone()); } else {unreachable!("cant cast");}  

					}
				}
			,
				3 =>{
					let tmp = UseContextExt::new(&**_localctx);
					recog.base.enter_outer_alt(Some(tmp.clone()), 3);
					_localctx = tmp;
					{
					recog.base.set_state(139);
					recog.base.match_token(USE,&mut recog.err_handler)?;

					/*InvokeRule identifier*/
					recog.base.set_state(140);
					let tmp = recog.identifier()?;
					if let StatementContextAll::UseContext(ctx) = cast_mut::<_,StatementContextAll >(&mut _localctx){
					ctx.catalog = Some(tmp.clone()); } else {unreachable!("cant cast");}  

					recog.base.set_state(141);
					recog.base.match_token(T__0,&mut recog.err_handler)?;

					/*InvokeRule identifier*/
					recog.base.set_state(142);
					let tmp = recog.identifier()?;
					if let StatementContextAll::UseContext(ctx) = cast_mut::<_,StatementContextAll >(&mut _localctx){
					ctx.schema = Some(tmp.clone()); } else {unreachable!("cant cast");}  

					}
				}
			,
				4 =>{
					let tmp = CreateSchemaContextExt::new(&**_localctx);
					recog.base.enter_outer_alt(Some(tmp.clone()), 4);
					_localctx = tmp;
					{
					recog.base.set_state(144);
					recog.base.match_token(CREATE,&mut recog.err_handler)?;

					recog.base.set_state(145);
					recog.base.match_token(SCHEMA,&mut recog.err_handler)?;

					recog.base.set_state(149);
					recog.err_handler.sync(&mut recog.base)?;
					match  recog.interpreter.adaptive_predict(0,&mut recog.base)? {
						x if x == 1=>{
							{
							recog.base.set_state(146);
							recog.base.match_token(IF,&mut recog.err_handler)?;

							recog.base.set_state(147);
							recog.base.match_token(NOT,&mut recog.err_handler)?;

							recog.base.set_state(148);
							recog.base.match_token(EXISTS,&mut recog.err_handler)?;

							}
						}

						_ => {}
					}
					/*InvokeRule qualifiedName*/
					recog.base.set_state(151);
					recog.qualifiedName()?;

					recog.base.set_state(154);
					recog.err_handler.sync(&mut recog.base)?;
					_la = recog.base.input.la(1);
					if _la==WITH {
						{
						recog.base.set_state(152);
						recog.base.match_token(WITH,&mut recog.err_handler)?;

						/*InvokeRule tableProperties*/
						recog.base.set_state(153);
						recog.tableProperties()?;

						}
					}

					}
				}
			,
				5 =>{
					let tmp = DropSchemaContextExt::new(&**_localctx);
					recog.base.enter_outer_alt(Some(tmp.clone()), 5);
					_localctx = tmp;
					{
					recog.base.set_state(156);
					recog.base.match_token(DROP,&mut recog.err_handler)?;

					recog.base.set_state(157);
					recog.base.match_token(SCHEMA,&mut recog.err_handler)?;

					recog.base.set_state(160);
					recog.err_handler.sync(&mut recog.base)?;
					match  recog.interpreter.adaptive_predict(2,&mut recog.base)? {
						x if x == 1=>{
							{
							recog.base.set_state(158);
							recog.base.match_token(IF,&mut recog.err_handler)?;

							recog.base.set_state(159);
							recog.base.match_token(EXISTS,&mut recog.err_handler)?;

							}
						}

						_ => {}
					}
					/*InvokeRule qualifiedName*/
					recog.base.set_state(162);
					recog.qualifiedName()?;

					recog.base.set_state(164);
					recog.err_handler.sync(&mut recog.base)?;
					_la = recog.base.input.la(1);
					if _la==CASCADE || _la==RESTRICT {
						{
						recog.base.set_state(163);
						_la = recog.base.input.la(1);
						if { !(_la==CASCADE || _la==RESTRICT) } {
							recog.err_handler.recover_inline(&mut recog.base)?;

						}
						else {
							if  recog.base.input.la(1)==TOKEN_EOF { recog.base.matched_eof = true };
							recog.err_handler.report_match(&mut recog.base);
							recog.base.consume(&mut recog.err_handler);
						}
						}
					}

					}
				}
			,
				6 =>{
					let tmp = RenameSchemaContextExt::new(&**_localctx);
					recog.base.enter_outer_alt(Some(tmp.clone()), 6);
					_localctx = tmp;
					{
					recog.base.set_state(166);
					recog.base.match_token(ALTER,&mut recog.err_handler)?;

					recog.base.set_state(167);
					recog.base.match_token(SCHEMA,&mut recog.err_handler)?;

					/*InvokeRule qualifiedName*/
					recog.base.set_state(168);
					recog.qualifiedName()?;

					recog.base.set_state(169);
					recog.base.match_token(RENAME,&mut recog.err_handler)?;

					recog.base.set_state(170);
					recog.base.match_token(TO,&mut recog.err_handler)?;

					/*InvokeRule identifier*/
					recog.base.set_state(171);
					recog.identifier()?;

					}
				}
			,
				7 =>{
					let tmp = CreateTableAsSelectContextExt::new(&**_localctx);
					recog.base.enter_outer_alt(Some(tmp.clone()), 7);
					_localctx = tmp;
					{
					recog.base.set_state(173);
					recog.base.match_token(CREATE,&mut recog.err_handler)?;

					recog.base.set_state(174);
					recog.base.match_token(TABLE,&mut recog.err_handler)?;

					recog.base.set_state(178);
					recog.err_handler.sync(&mut recog.base)?;
					match  recog.interpreter.adaptive_predict(4,&mut recog.base)? {
						x if x == 1=>{
							{
							recog.base.set_state(175);
							recog.base.match_token(IF,&mut recog.err_handler)?;

							recog.base.set_state(176);
							recog.base.match_token(NOT,&mut recog.err_handler)?;

							recog.base.set_state(177);
							recog.base.match_token(EXISTS,&mut recog.err_handler)?;

							}
						}

						_ => {}
					}
					/*InvokeRule qualifiedName*/
					recog.base.set_state(180);
					recog.qualifiedName()?;

					recog.base.set_state(183);
					recog.err_handler.sync(&mut recog.base)?;
					_la = recog.base.input.la(1);
					if _la==WITH {
						{
						recog.base.set_state(181);
						recog.base.match_token(WITH,&mut recog.err_handler)?;

						/*InvokeRule tableProperties*/
						recog.base.set_state(182);
						recog.tableProperties()?;

						}
					}

					recog.base.set_state(185);
					recog.base.match_token(AS,&mut recog.err_handler)?;

					/*InvokeRule query*/
					recog.base.set_state(186);
					recog.query()?;

					recog.base.set_state(192);
					recog.err_handler.sync(&mut recog.base)?;
					_la = recog.base.input.la(1);
					if _la==WITH {
						{
						recog.base.set_state(187);
						recog.base.match_token(WITH,&mut recog.err_handler)?;

						recog.base.set_state(189);
						recog.err_handler.sync(&mut recog.base)?;
						_la = recog.base.input.la(1);
						if _la==NO {
							{
							recog.base.set_state(188);
							recog.base.match_token(NO,&mut recog.err_handler)?;

							}
						}

						recog.base.set_state(191);
						recog.base.match_token(DATA,&mut recog.err_handler)?;

						}
					}

					}
				}
			,
				8 =>{
					let tmp = CreateTableContextExt::new(&**_localctx);
					recog.base.enter_outer_alt(Some(tmp.clone()), 8);
					_localctx = tmp;
					{
					recog.base.set_state(194);
					recog.base.match_token(CREATE,&mut recog.err_handler)?;

					recog.base.set_state(195);
					recog.base.match_token(TABLE,&mut recog.err_handler)?;

					recog.base.set_state(199);
					recog.err_handler.sync(&mut recog.base)?;
					match  recog.interpreter.adaptive_predict(8,&mut recog.base)? {
						x if x == 1=>{
							{
							recog.base.set_state(196);
							recog.base.match_token(IF,&mut recog.err_handler)?;

							recog.base.set_state(197);
							recog.base.match_token(NOT,&mut recog.err_handler)?;

							recog.base.set_state(198);
							recog.base.match_token(EXISTS,&mut recog.err_handler)?;

							}
						}

						_ => {}
					}
					/*InvokeRule qualifiedName*/
					recog.base.set_state(201);
					recog.qualifiedName()?;

					recog.base.set_state(202);
					recog.base.match_token(T__1,&mut recog.err_handler)?;

					/*InvokeRule tableElement*/
					recog.base.set_state(203);
					recog.tableElement()?;

					recog.base.set_state(208);
					recog.err_handler.sync(&mut recog.base)?;
					_la = recog.base.input.la(1);
					while _la==T__2 {
						{
						{
						recog.base.set_state(204);
						recog.base.match_token(T__2,&mut recog.err_handler)?;

						/*InvokeRule tableElement*/
						recog.base.set_state(205);
						recog.tableElement()?;

						}
						}
						recog.base.set_state(210);
						recog.err_handler.sync(&mut recog.base)?;
						_la = recog.base.input.la(1);
					}
					recog.base.set_state(211);
					recog.base.match_token(T__3,&mut recog.err_handler)?;

					recog.base.set_state(214);
					recog.err_handler.sync(&mut recog.base)?;
					_la = recog.base.input.la(1);
					if _la==WITH {
						{
						recog.base.set_state(212);
						recog.base.match_token(WITH,&mut recog.err_handler)?;

						/*InvokeRule tableProperties*/
						recog.base.set_state(213);
						recog.tableProperties()?;

						}
					}

					}
				}
			,
				9 =>{
					let tmp = DropTableContextExt::new(&**_localctx);
					recog.base.enter_outer_alt(Some(tmp.clone()), 9);
					_localctx = tmp;
					{
					recog.base.set_state(216);
					recog.base.match_token(DROP,&mut recog.err_handler)?;

					recog.base.set_state(217);
					recog.base.match_token(TABLE,&mut recog.err_handler)?;

					recog.base.set_state(220);
					recog.err_handler.sync(&mut recog.base)?;
					match  recog.interpreter.adaptive_predict(11,&mut recog.base)? {
						x if x == 1=>{
							{
							recog.base.set_state(218);
							recog.base.match_token(IF,&mut recog.err_handler)?;

							recog.base.set_state(219);
							recog.base.match_token(EXISTS,&mut recog.err_handler)?;

							}
						}

						_ => {}
					}
					/*InvokeRule qualifiedName*/
					recog.base.set_state(222);
					recog.qualifiedName()?;

					}
				}
			,
				10 =>{
					let tmp = InsertIntoContextExt::new(&**_localctx);
					recog.base.enter_outer_alt(Some(tmp.clone()), 10);
					_localctx = tmp;
					{
					recog.base.set_state(223);
					recog.base.match_token(INSERT,&mut recog.err_handler)?;

					recog.base.set_state(224);
					recog.base.match_token(INTO,&mut recog.err_handler)?;

					/*InvokeRule qualifiedName*/
					recog.base.set_state(225);
					recog.qualifiedName()?;

					recog.base.set_state(227);
					recog.err_handler.sync(&mut recog.base)?;
					match  recog.interpreter.adaptive_predict(12,&mut recog.base)? {
						x if x == 1=>{
							{
							/*InvokeRule columnAliases*/
							recog.base.set_state(226);
							recog.columnAliases()?;

							}
						}

						_ => {}
					}
					/*InvokeRule query*/
					recog.base.set_state(229);
					recog.query()?;

					}
				}
			,
				11 =>{
					let tmp = DeleteContextExt::new(&**_localctx);
					recog.base.enter_outer_alt(Some(tmp.clone()), 11);
					_localctx = tmp;
					{
					recog.base.set_state(231);
					recog.base.match_token(DELETE,&mut recog.err_handler)?;

					recog.base.set_state(232);
					recog.base.match_token(FROM,&mut recog.err_handler)?;

					/*InvokeRule qualifiedName*/
					recog.base.set_state(233);
					recog.qualifiedName()?;

					recog.base.set_state(236);
					recog.err_handler.sync(&mut recog.base)?;
					_la = recog.base.input.la(1);
					if _la==WHERE {
						{
						recog.base.set_state(234);
						recog.base.match_token(WHERE,&mut recog.err_handler)?;

						/*InvokeRule booleanExpression*/
						recog.base.set_state(235);
						recog.booleanExpression_rec(0)?;

						}
					}

					}
				}
			,
				12 =>{
					let tmp = RenameTableContextExt::new(&**_localctx);
					recog.base.enter_outer_alt(Some(tmp.clone()), 12);
					_localctx = tmp;
					{
					recog.base.set_state(238);
					recog.base.match_token(ALTER,&mut recog.err_handler)?;

					recog.base.set_state(239);
					recog.base.match_token(TABLE,&mut recog.err_handler)?;

					/*InvokeRule qualifiedName*/
					recog.base.set_state(240);
					let tmp = recog.qualifiedName()?;
					if let StatementContextAll::RenameTableContext(ctx) = cast_mut::<_,StatementContextAll >(&mut _localctx){
					ctx.from = Some(tmp.clone()); } else {unreachable!("cant cast");}  

					recog.base.set_state(241);
					recog.base.match_token(RENAME,&mut recog.err_handler)?;

					recog.base.set_state(242);
					recog.base.match_token(TO,&mut recog.err_handler)?;

					/*InvokeRule qualifiedName*/
					recog.base.set_state(243);
					let tmp = recog.qualifiedName()?;
					if let StatementContextAll::RenameTableContext(ctx) = cast_mut::<_,StatementContextAll >(&mut _localctx){
					ctx.to = Some(tmp.clone()); } else {unreachable!("cant cast");}  

					}
				}
			,
				13 =>{
					let tmp = RenameColumnContextExt::new(&**_localctx);
					recog.base.enter_outer_alt(Some(tmp.clone()), 13);
					_localctx = tmp;
					{
					recog.base.set_state(245);
					recog.base.match_token(ALTER,&mut recog.err_handler)?;

					recog.base.set_state(246);
					recog.base.match_token(TABLE,&mut recog.err_handler)?;

					/*InvokeRule qualifiedName*/
					recog.base.set_state(247);
					let tmp = recog.qualifiedName()?;
					if let StatementContextAll::RenameColumnContext(ctx) = cast_mut::<_,StatementContextAll >(&mut _localctx){
					ctx.tableName = Some(tmp.clone()); } else {unreachable!("cant cast");}  

					recog.base.set_state(248);
					recog.base.match_token(RENAME,&mut recog.err_handler)?;

					recog.base.set_state(249);
					recog.base.match_token(COLUMN,&mut recog.err_handler)?;

					/*InvokeRule identifier*/
					recog.base.set_state(250);
					let tmp = recog.identifier()?;
					if let StatementContextAll::RenameColumnContext(ctx) = cast_mut::<_,StatementContextAll >(&mut _localctx){
					ctx.from = Some(tmp.clone()); } else {unreachable!("cant cast");}  

					recog.base.set_state(251);
					recog.base.match_token(TO,&mut recog.err_handler)?;

					/*InvokeRule identifier*/
					recog.base.set_state(252);
					let tmp = recog.identifier()?;
					if let StatementContextAll::RenameColumnContext(ctx) = cast_mut::<_,StatementContextAll >(&mut _localctx){
					ctx.to = Some(tmp.clone()); } else {unreachable!("cant cast");}  

					}
				}
			,
				14 =>{
					let tmp = AddColumnContextExt::new(&**_localctx);
					recog.base.enter_outer_alt(Some(tmp.clone()), 14);
					_localctx = tmp;
					{
					recog.base.set_state(254);
					recog.base.match_token(ALTER,&mut recog.err_handler)?;

					recog.base.set_state(255);
					recog.base.match_token(TABLE,&mut recog.err_handler)?;

					/*InvokeRule qualifiedName*/
					recog.base.set_state(256);
					let tmp = recog.qualifiedName()?;
					if let StatementContextAll::AddColumnContext(ctx) = cast_mut::<_,StatementContextAll >(&mut _localctx){
					ctx.tableName = Some(tmp.clone()); } else {unreachable!("cant cast");}  

					recog.base.set_state(257);
					recog.base.match_token(ADD,&mut recog.err_handler)?;

					recog.base.set_state(258);
					recog.base.match_token(COLUMN,&mut recog.err_handler)?;

					/*InvokeRule columnDefinition*/
					recog.base.set_state(259);
					let tmp = recog.columnDefinition()?;
					if let StatementContextAll::AddColumnContext(ctx) = cast_mut::<_,StatementContextAll >(&mut _localctx){
					ctx.column = Some(tmp.clone()); } else {unreachable!("cant cast");}  

					}
				}
			,
				15 =>{
					let tmp = CreateViewContextExt::new(&**_localctx);
					recog.base.enter_outer_alt(Some(tmp.clone()), 15);
					_localctx = tmp;
					{
					recog.base.set_state(261);
					recog.base.match_token(CREATE,&mut recog.err_handler)?;

					recog.base.set_state(264);
					recog.err_handler.sync(&mut recog.base)?;
					_la = recog.base.input.la(1);
					if _la==OR {
						{
						recog.base.set_state(262);
						recog.base.match_token(OR,&mut recog.err_handler)?;

						recog.base.set_state(263);
						recog.base.match_token(REPLACE,&mut recog.err_handler)?;

						}
					}

					recog.base.set_state(266);
					recog.base.match_token(VIEW,&mut recog.err_handler)?;

					/*InvokeRule qualifiedName*/
					recog.base.set_state(267);
					recog.qualifiedName()?;

					recog.base.set_state(268);
					recog.base.match_token(AS,&mut recog.err_handler)?;

					/*InvokeRule query*/
					recog.base.set_state(269);
					recog.query()?;

					}
				}
			,
				16 =>{
					let tmp = DropViewContextExt::new(&**_localctx);
					recog.base.enter_outer_alt(Some(tmp.clone()), 16);
					_localctx = tmp;
					{
					recog.base.set_state(271);
					recog.base.match_token(DROP,&mut recog.err_handler)?;

					recog.base.set_state(272);
					recog.base.match_token(VIEW,&mut recog.err_handler)?;

					recog.base.set_state(275);
					recog.err_handler.sync(&mut recog.base)?;
					match  recog.interpreter.adaptive_predict(15,&mut recog.base)? {
						x if x == 1=>{
							{
							recog.base.set_state(273);
							recog.base.match_token(IF,&mut recog.err_handler)?;

							recog.base.set_state(274);
							recog.base.match_token(EXISTS,&mut recog.err_handler)?;

							}
						}

						_ => {}
					}
					/*InvokeRule qualifiedName*/
					recog.base.set_state(277);
					recog.qualifiedName()?;

					}
				}
			,
				17 =>{
					let tmp = CallContextExt::new(&**_localctx);
					recog.base.enter_outer_alt(Some(tmp.clone()), 17);
					_localctx = tmp;
					{
					recog.base.set_state(278);
					recog.base.match_token(CALL,&mut recog.err_handler)?;

					/*InvokeRule qualifiedName*/
					recog.base.set_state(279);
					recog.qualifiedName()?;

					recog.base.set_state(280);
					recog.base.match_token(T__1,&mut recog.err_handler)?;

					recog.base.set_state(289);
					recog.err_handler.sync(&mut recog.base)?;
					_la = recog.base.input.la(1);
					if (((_la) & !0x3f) == 0 && ((1usize << _la) & ((1usize << T__1) | (1usize << T__4) | (1usize << ADD) | (1usize << ALL) | (1usize << SOME) | (1usize << ANY) | (1usize << AT))) != 0) || ((((_la - 32)) & !0x3f) == 0 && ((1usize << (_la - 32)) & ((1usize << (NOT - 32)) | (1usize << (NO - 32)) | (1usize << (EXISTS - 32)) | (1usize << (NULL - 32)) | (1usize << (TRUE - 32)) | (1usize << (FALSE - 32)) | (1usize << (SUBSTRING - 32)) | (1usize << (POSITION - 32)) | (1usize << (TINYINT - 32)) | (1usize << (SMALLINT - 32)) | (1usize << (INTEGER - 32)) | (1usize << (DATE - 32)) | (1usize << (TIME - 32)) | (1usize << (TIMESTAMP - 32)) | (1usize << (INTERVAL - 32)) | (1usize << (YEAR - 32)) | (1usize << (MONTH - 32)) | (1usize << (DAY - 32)) | (1usize << (HOUR - 32)) | (1usize << (MINUTE - 32)) | (1usize << (SECOND - 32)) | (1usize << (ZONE - 32)))) != 0) || ((((_la - 64)) & !0x3f) == 0 && ((1usize << (_la - 64)) & ((1usize << (CURRENT_DATE - 64)) | (1usize << (CURRENT_TIME - 64)) | (1usize << (CURRENT_TIMESTAMP - 64)) | (1usize << (LOCALTIME - 64)) | (1usize << (LOCALTIMESTAMP - 64)) | (1usize << (EXTRACT - 64)) | (1usize << (CASE - 64)) | (1usize << (FILTER - 64)) | (1usize << (OVER - 64)) | (1usize << (PARTITION - 64)) | (1usize << (RANGE - 64)) | (1usize << (ROWS - 64)) | (1usize << (PRECEDING - 64)) | (1usize << (FOLLOWING - 64)) | (1usize << (CURRENT - 64)) | (1usize << (ROW - 64)))) != 0) || ((((_la - 99)) & !0x3f) == 0 && ((1usize << (_la - 99)) & ((1usize << (SCHEMA - 99)) | (1usize << (COMMENT - 99)) | (1usize << (VIEW - 99)) | (1usize << (REPLACE - 99)) | (1usize << (GRANT - 99)) | (1usize << (REVOKE - 99)) | (1usize << (PRIVILEGES - 99)) | (1usize << (PUBLIC - 99)) | (1usize << (OPTION - 99)) | (1usize << (EXPLAIN - 99)) | (1usize << (ANALYZE - 99)) | (1usize << (FORMAT - 99)) | (1usize << (TYPE - 99)) | (1usize << (TEXT - 99)) | (1usize << (GRAPHVIZ - 99)) | (1usize << (LOGICAL - 99)) | (1usize << (DISTRIBUTED - 99)) | (1usize << (VALIDATE - 99)) | (1usize << (CAST - 99)) | (1usize << (TRY_CAST - 99)) | (1usize << (SHOW - 99)) | (1usize << (TABLES - 99)) | (1usize << (SCHEMAS - 99)) | (1usize << (CATALOGS - 99)) | (1usize << (COLUMNS - 99)) | (1usize << (COLUMN - 99)))) != 0) || ((((_la - 131)) & !0x3f) == 0 && ((1usize << (_la - 131)) & ((1usize << (USE - 131)) | (1usize << (PARTITIONS - 131)) | (1usize << (FUNCTIONS - 131)) | (1usize << (TO - 131)) | (1usize << (SYSTEM - 131)) | (1usize << (BERNOULLI - 131)) | (1usize << (POISSONIZED - 131)) | (1usize << (TABLESAMPLE - 131)) | (1usize << (ARRAY - 131)) | (1usize << (MAP - 131)) | (1usize << (SET - 131)) | (1usize << (RESET - 131)) | (1usize << (SESSION - 131)) | (1usize << (DATA - 131)) | (1usize << (START - 131)) | (1usize << (TRANSACTION - 131)) | (1usize << (COMMIT - 131)) | (1usize << (ROLLBACK - 131)) | (1usize << (WORK - 131)) | (1usize << (ISOLATION - 131)) | (1usize << (LEVEL - 131)) | (1usize << (SERIALIZABLE - 131)) | (1usize << (REPEATABLE - 131)) | (1usize << (COMMITTED - 131)))) != 0) || ((((_la - 163)) & !0x3f) == 0 && ((1usize << (_la - 163)) & ((1usize << (UNCOMMITTED - 163)) | (1usize << (READ - 163)) | (1usize << (WRITE - 163)) | (1usize << (ONLY - 163)) | (1usize << (CALL - 163)) | (1usize << (INPUT - 163)) | (1usize << (OUTPUT - 163)) | (1usize << (CASCADE - 163)) | (1usize << (RESTRICT - 163)) | (1usize << (INCLUDING - 163)) | (1usize << (EXCLUDING - 163)) | (1usize << (PROPERTIES - 163)) | (1usize << (NORMALIZE - 163)) | (1usize << (NFD - 163)) | (1usize << (NFC - 163)) | (1usize << (NFKD - 163)) | (1usize << (NFKC - 163)) | (1usize << (IF - 163)) | (1usize << (NULLIF - 163)) | (1usize << (COALESCE - 163)) | (1usize << (PLUS - 163)) | (1usize << (MINUS - 163)))) != 0) || ((((_la - 198)) & !0x3f) == 0 && ((1usize << (_la - 198)) & ((1usize << (STRING - 198)) | (1usize << (BINARY_LITERAL - 198)) | (1usize << (INTEGER_VALUE - 198)) | (1usize << (DECIMAL_VALUE - 198)) | (1usize << (IDENTIFIER - 198)) | (1usize << (DIGIT_IDENTIFIER - 198)) | (1usize << (QUOTED_IDENTIFIER - 198)) | (1usize << (BACKQUOTED_IDENTIFIER - 198)) | (1usize << (DOUBLE_PRECISION - 198)))) != 0) {
						{
						/*InvokeRule callArgument*/
						recog.base.set_state(281);
						recog.callArgument()?;

						recog.base.set_state(286);
						recog.err_handler.sync(&mut recog.base)?;
						_la = recog.base.input.la(1);
						while _la==T__2 {
							{
							{
							recog.base.set_state(282);
							recog.base.match_token(T__2,&mut recog.err_handler)?;

							/*InvokeRule callArgument*/
							recog.base.set_state(283);
							recog.callArgument()?;

							}
							}
							recog.base.set_state(288);
							recog.err_handler.sync(&mut recog.base)?;
							_la = recog.base.input.la(1);
						}
						}
					}

					recog.base.set_state(291);
					recog.base.match_token(T__3,&mut recog.err_handler)?;

					}
				}
			,
				18 =>{
					let tmp = GrantContextExt::new(&**_localctx);
					recog.base.enter_outer_alt(Some(tmp.clone()), 18);
					_localctx = tmp;
					{
					recog.base.set_state(293);
					recog.base.match_token(GRANT,&mut recog.err_handler)?;

					recog.base.set_state(304);
					recog.err_handler.sync(&mut recog.base)?;
					match  recog.interpreter.adaptive_predict(19,&mut recog.base)? {
						1 =>{
							{
							/*InvokeRule privilege*/
							recog.base.set_state(294);
							recog.privilege()?;

							recog.base.set_state(299);
							recog.err_handler.sync(&mut recog.base)?;
							_la = recog.base.input.la(1);
							while _la==T__2 {
								{
								{
								recog.base.set_state(295);
								recog.base.match_token(T__2,&mut recog.err_handler)?;

								/*InvokeRule privilege*/
								recog.base.set_state(296);
								recog.privilege()?;

								}
								}
								recog.base.set_state(301);
								recog.err_handler.sync(&mut recog.base)?;
								_la = recog.base.input.la(1);
							}
							}
						}
					,
						2 =>{
							{
							recog.base.set_state(302);
							recog.base.match_token(ALL,&mut recog.err_handler)?;

							recog.base.set_state(303);
							recog.base.match_token(PRIVILEGES,&mut recog.err_handler)?;

							}
						}

						_ => {}
					}
					recog.base.set_state(306);
					recog.base.match_token(ON,&mut recog.err_handler)?;

					recog.base.set_state(308);
					recog.err_handler.sync(&mut recog.base)?;
					_la = recog.base.input.la(1);
					if _la==TABLE {
						{
						recog.base.set_state(307);
						recog.base.match_token(TABLE,&mut recog.err_handler)?;

						}
					}

					/*InvokeRule qualifiedName*/
					recog.base.set_state(310);
					recog.qualifiedName()?;

					recog.base.set_state(311);
					recog.base.match_token(TO,&mut recog.err_handler)?;

					/*InvokeRule identifier*/
					recog.base.set_state(312);
					let tmp = recog.identifier()?;
					if let StatementContextAll::GrantContext(ctx) = cast_mut::<_,StatementContextAll >(&mut _localctx){
					ctx.grantee = Some(tmp.clone()); } else {unreachable!("cant cast");}  

					recog.base.set_state(316);
					recog.err_handler.sync(&mut recog.base)?;
					_la = recog.base.input.la(1);
					if _la==WITH {
						{
						recog.base.set_state(313);
						recog.base.match_token(WITH,&mut recog.err_handler)?;

						recog.base.set_state(314);
						recog.base.match_token(GRANT,&mut recog.err_handler)?;

						recog.base.set_state(315);
						recog.base.match_token(OPTION,&mut recog.err_handler)?;

						}
					}

					}
				}
			,
				19 =>{
					let tmp = RevokeContextExt::new(&**_localctx);
					recog.base.enter_outer_alt(Some(tmp.clone()), 19);
					_localctx = tmp;
					{
					recog.base.set_state(318);
					recog.base.match_token(REVOKE,&mut recog.err_handler)?;

					recog.base.set_state(322);
					recog.err_handler.sync(&mut recog.base)?;
					match  recog.interpreter.adaptive_predict(22,&mut recog.base)? {
						x if x == 1=>{
							{
							recog.base.set_state(319);
							recog.base.match_token(GRANT,&mut recog.err_handler)?;

							recog.base.set_state(320);
							recog.base.match_token(OPTION,&mut recog.err_handler)?;

							recog.base.set_state(321);
							recog.base.match_token(FOR,&mut recog.err_handler)?;

							}
						}

						_ => {}
					}
					recog.base.set_state(334);
					recog.err_handler.sync(&mut recog.base)?;
					match  recog.interpreter.adaptive_predict(24,&mut recog.base)? {
						1 =>{
							{
							/*InvokeRule privilege*/
							recog.base.set_state(324);
							recog.privilege()?;

							recog.base.set_state(329);
							recog.err_handler.sync(&mut recog.base)?;
							_la = recog.base.input.la(1);
							while _la==T__2 {
								{
								{
								recog.base.set_state(325);
								recog.base.match_token(T__2,&mut recog.err_handler)?;

								/*InvokeRule privilege*/
								recog.base.set_state(326);
								recog.privilege()?;

								}
								}
								recog.base.set_state(331);
								recog.err_handler.sync(&mut recog.base)?;
								_la = recog.base.input.la(1);
							}
							}
						}
					,
						2 =>{
							{
							recog.base.set_state(332);
							recog.base.match_token(ALL,&mut recog.err_handler)?;

							recog.base.set_state(333);
							recog.base.match_token(PRIVILEGES,&mut recog.err_handler)?;

							}
						}

						_ => {}
					}
					recog.base.set_state(336);
					recog.base.match_token(ON,&mut recog.err_handler)?;

					recog.base.set_state(338);
					recog.err_handler.sync(&mut recog.base)?;
					_la = recog.base.input.la(1);
					if _la==TABLE {
						{
						recog.base.set_state(337);
						recog.base.match_token(TABLE,&mut recog.err_handler)?;

						}
					}

					/*InvokeRule qualifiedName*/
					recog.base.set_state(340);
					recog.qualifiedName()?;

					recog.base.set_state(341);
					recog.base.match_token(FROM,&mut recog.err_handler)?;

					/*InvokeRule identifier*/
					recog.base.set_state(342);
					let tmp = recog.identifier()?;
					if let StatementContextAll::RevokeContext(ctx) = cast_mut::<_,StatementContextAll >(&mut _localctx){
					ctx.grantee = Some(tmp.clone()); } else {unreachable!("cant cast");}  

					}
				}
			,
				20 =>{
					let tmp = ExplainContextExt::new(&**_localctx);
					recog.base.enter_outer_alt(Some(tmp.clone()), 20);
					_localctx = tmp;
					{
					recog.base.set_state(344);
					recog.base.match_token(EXPLAIN,&mut recog.err_handler)?;

					recog.base.set_state(346);
					recog.err_handler.sync(&mut recog.base)?;
					_la = recog.base.input.la(1);
					if _la==ANALYZE {
						{
						recog.base.set_state(345);
						recog.base.match_token(ANALYZE,&mut recog.err_handler)?;

						}
					}

					recog.base.set_state(359);
					recog.err_handler.sync(&mut recog.base)?;
					match  recog.interpreter.adaptive_predict(28,&mut recog.base)? {
						x if x == 1=>{
							{
							recog.base.set_state(348);
							recog.base.match_token(T__1,&mut recog.err_handler)?;

							/*InvokeRule explainOption*/
							recog.base.set_state(349);
							recog.explainOption()?;

							recog.base.set_state(354);
							recog.err_handler.sync(&mut recog.base)?;
							_la = recog.base.input.la(1);
							while _la==T__2 {
								{
								{
								recog.base.set_state(350);
								recog.base.match_token(T__2,&mut recog.err_handler)?;

								/*InvokeRule explainOption*/
								recog.base.set_state(351);
								recog.explainOption()?;

								}
								}
								recog.base.set_state(356);
								recog.err_handler.sync(&mut recog.base)?;
								_la = recog.base.input.la(1);
							}
							recog.base.set_state(357);
							recog.base.match_token(T__3,&mut recog.err_handler)?;

							}
						}

						_ => {}
					}
					/*InvokeRule statement*/
					recog.base.set_state(361);
					recog.statement()?;

					}
				}
			,
				21 =>{
					let tmp = ShowCreateTableContextExt::new(&**_localctx);
					recog.base.enter_outer_alt(Some(tmp.clone()), 21);
					_localctx = tmp;
					{
					recog.base.set_state(362);
					recog.base.match_token(SHOW,&mut recog.err_handler)?;

					recog.base.set_state(363);
					recog.base.match_token(CREATE,&mut recog.err_handler)?;

					recog.base.set_state(364);
					recog.base.match_token(TABLE,&mut recog.err_handler)?;

					/*InvokeRule qualifiedName*/
					recog.base.set_state(365);
					recog.qualifiedName()?;

					}
				}
			,
				22 =>{
					let tmp = ShowCreateViewContextExt::new(&**_localctx);
					recog.base.enter_outer_alt(Some(tmp.clone()), 22);
					_localctx = tmp;
					{
					recog.base.set_state(366);
					recog.base.match_token(SHOW,&mut recog.err_handler)?;

					recog.base.set_state(367);
					recog.base.match_token(CREATE,&mut recog.err_handler)?;

					recog.base.set_state(368);
					recog.base.match_token(VIEW,&mut recog.err_handler)?;

					/*InvokeRule qualifiedName*/
					recog.base.set_state(369);
					recog.qualifiedName()?;

					}
				}
			,
				23 =>{
					let tmp = ShowTablesContextExt::new(&**_localctx);
					recog.base.enter_outer_alt(Some(tmp.clone()), 23);
					_localctx = tmp;
					{
					recog.base.set_state(370);
					recog.base.match_token(SHOW,&mut recog.err_handler)?;

					recog.base.set_state(371);
					recog.base.match_token(TABLES,&mut recog.err_handler)?;

					recog.base.set_state(374);
					recog.err_handler.sync(&mut recog.base)?;
					_la = recog.base.input.la(1);
					if _la==FROM || _la==IN {
						{
						recog.base.set_state(372);
						_la = recog.base.input.la(1);
						if { !(_la==FROM || _la==IN) } {
							recog.err_handler.recover_inline(&mut recog.base)?;

						}
						else {
							if  recog.base.input.la(1)==TOKEN_EOF { recog.base.matched_eof = true };
							recog.err_handler.report_match(&mut recog.base);
							recog.base.consume(&mut recog.err_handler);
						}
						/*InvokeRule qualifiedName*/
						recog.base.set_state(373);
						recog.qualifiedName()?;

						}
					}

					recog.base.set_state(378);
					recog.err_handler.sync(&mut recog.base)?;
					_la = recog.base.input.la(1);
					if _la==LIKE {
						{
						recog.base.set_state(376);
						recog.base.match_token(LIKE,&mut recog.err_handler)?;

						recog.base.set_state(377);
						let tmp = recog.base.match_token(STRING,&mut recog.err_handler)?;
						if let StatementContextAll::ShowTablesContext(ctx) = cast_mut::<_,StatementContextAll >(&mut _localctx){
						ctx.pattern = Some(tmp.clone()); } else {unreachable!("cant cast");}  

						}
					}

					}
				}
			,
				24 =>{
					let tmp = ShowSchemasContextExt::new(&**_localctx);
					recog.base.enter_outer_alt(Some(tmp.clone()), 24);
					_localctx = tmp;
					{
					recog.base.set_state(380);
					recog.base.match_token(SHOW,&mut recog.err_handler)?;

					recog.base.set_state(381);
					recog.base.match_token(SCHEMAS,&mut recog.err_handler)?;

					recog.base.set_state(384);
					recog.err_handler.sync(&mut recog.base)?;
					_la = recog.base.input.la(1);
					if _la==FROM || _la==IN {
						{
						recog.base.set_state(382);
						_la = recog.base.input.la(1);
						if { !(_la==FROM || _la==IN) } {
							recog.err_handler.recover_inline(&mut recog.base)?;

						}
						else {
							if  recog.base.input.la(1)==TOKEN_EOF { recog.base.matched_eof = true };
							recog.err_handler.report_match(&mut recog.base);
							recog.base.consume(&mut recog.err_handler);
						}
						/*InvokeRule identifier*/
						recog.base.set_state(383);
						recog.identifier()?;

						}
					}

					recog.base.set_state(388);
					recog.err_handler.sync(&mut recog.base)?;
					_la = recog.base.input.la(1);
					if _la==LIKE {
						{
						recog.base.set_state(386);
						recog.base.match_token(LIKE,&mut recog.err_handler)?;

						recog.base.set_state(387);
						let tmp = recog.base.match_token(STRING,&mut recog.err_handler)?;
						if let StatementContextAll::ShowSchemasContext(ctx) = cast_mut::<_,StatementContextAll >(&mut _localctx){
						ctx.pattern = Some(tmp.clone()); } else {unreachable!("cant cast");}  

						}
					}

					}
				}
			,
				25 =>{
					let tmp = ShowCatalogsContextExt::new(&**_localctx);
					recog.base.enter_outer_alt(Some(tmp.clone()), 25);
					_localctx = tmp;
					{
					recog.base.set_state(390);
					recog.base.match_token(SHOW,&mut recog.err_handler)?;

					recog.base.set_state(391);
					recog.base.match_token(CATALOGS,&mut recog.err_handler)?;

					recog.base.set_state(394);
					recog.err_handler.sync(&mut recog.base)?;
					_la = recog.base.input.la(1);
					if _la==LIKE {
						{
						recog.base.set_state(392);
						recog.base.match_token(LIKE,&mut recog.err_handler)?;

						recog.base.set_state(393);
						let tmp = recog.base.match_token(STRING,&mut recog.err_handler)?;
						if let StatementContextAll::ShowCatalogsContext(ctx) = cast_mut::<_,StatementContextAll >(&mut _localctx){
						ctx.pattern = Some(tmp.clone()); } else {unreachable!("cant cast");}  

						}
					}

					}
				}
			,
				26 =>{
					let tmp = ShowColumnsContextExt::new(&**_localctx);
					recog.base.enter_outer_alt(Some(tmp.clone()), 26);
					_localctx = tmp;
					{
					recog.base.set_state(396);
					recog.base.match_token(SHOW,&mut recog.err_handler)?;

					recog.base.set_state(397);
					recog.base.match_token(COLUMNS,&mut recog.err_handler)?;

					recog.base.set_state(398);
					_la = recog.base.input.la(1);
					if { !(_la==FROM || _la==IN) } {
						recog.err_handler.recover_inline(&mut recog.base)?;

					}
					else {
						if  recog.base.input.la(1)==TOKEN_EOF { recog.base.matched_eof = true };
						recog.err_handler.report_match(&mut recog.base);
						recog.base.consume(&mut recog.err_handler);
					}
					/*InvokeRule qualifiedName*/
					recog.base.set_state(399);
					recog.qualifiedName()?;

					}
				}
			,
				27 =>{
					let tmp = ShowColumnsContextExt::new(&**_localctx);
					recog.base.enter_outer_alt(Some(tmp.clone()), 27);
					_localctx = tmp;
					{
					recog.base.set_state(400);
					recog.base.match_token(DESCRIBE,&mut recog.err_handler)?;

					/*InvokeRule qualifiedName*/
					recog.base.set_state(401);
					recog.qualifiedName()?;

					}
				}
			,
				28 =>{
					let tmp = ShowColumnsContextExt::new(&**_localctx);
					recog.base.enter_outer_alt(Some(tmp.clone()), 28);
					_localctx = tmp;
					{
					recog.base.set_state(402);
					recog.base.match_token(DESC,&mut recog.err_handler)?;

					/*InvokeRule qualifiedName*/
					recog.base.set_state(403);
					recog.qualifiedName()?;

					}
				}
			,
				29 =>{
					let tmp = ShowFunctionsContextExt::new(&**_localctx);
					recog.base.enter_outer_alt(Some(tmp.clone()), 29);
					_localctx = tmp;
					{
					recog.base.set_state(404);
					recog.base.match_token(SHOW,&mut recog.err_handler)?;

					recog.base.set_state(405);
					recog.base.match_token(FUNCTIONS,&mut recog.err_handler)?;

					}
				}
			,
				30 =>{
					let tmp = ShowSessionContextExt::new(&**_localctx);
					recog.base.enter_outer_alt(Some(tmp.clone()), 30);
					_localctx = tmp;
					{
					recog.base.set_state(406);
					recog.base.match_token(SHOW,&mut recog.err_handler)?;

					recog.base.set_state(407);
					recog.base.match_token(SESSION,&mut recog.err_handler)?;

					}
				}
			,
				31 =>{
					let tmp = SetSessionContextExt::new(&**_localctx);
					recog.base.enter_outer_alt(Some(tmp.clone()), 31);
					_localctx = tmp;
					{
					recog.base.set_state(408);
					recog.base.match_token(SET,&mut recog.err_handler)?;

					recog.base.set_state(409);
					recog.base.match_token(SESSION,&mut recog.err_handler)?;

					/*InvokeRule qualifiedName*/
					recog.base.set_state(410);
					recog.qualifiedName()?;

					recog.base.set_state(411);
					recog.base.match_token(EQ,&mut recog.err_handler)?;

					/*InvokeRule expression*/
					recog.base.set_state(412);
					recog.expression()?;

					}
				}
			,
				32 =>{
					let tmp = ResetSessionContextExt::new(&**_localctx);
					recog.base.enter_outer_alt(Some(tmp.clone()), 32);
					_localctx = tmp;
					{
					recog.base.set_state(414);
					recog.base.match_token(RESET,&mut recog.err_handler)?;

					recog.base.set_state(415);
					recog.base.match_token(SESSION,&mut recog.err_handler)?;

					/*InvokeRule qualifiedName*/
					recog.base.set_state(416);
					recog.qualifiedName()?;

					}
				}
			,
				33 =>{
					let tmp = StartTransactionContextExt::new(&**_localctx);
					recog.base.enter_outer_alt(Some(tmp.clone()), 33);
					_localctx = tmp;
					{
					recog.base.set_state(417);
					recog.base.match_token(START,&mut recog.err_handler)?;

					recog.base.set_state(418);
					recog.base.match_token(TRANSACTION,&mut recog.err_handler)?;

					recog.base.set_state(427);
					recog.err_handler.sync(&mut recog.base)?;
					_la = recog.base.input.la(1);
					if _la==ISOLATION || _la==READ {
						{
						/*InvokeRule transactionMode*/
						recog.base.set_state(419);
						recog.transactionMode()?;

						recog.base.set_state(424);
						recog.err_handler.sync(&mut recog.base)?;
						_la = recog.base.input.la(1);
						while _la==T__2 {
							{
							{
							recog.base.set_state(420);
							recog.base.match_token(T__2,&mut recog.err_handler)?;

							/*InvokeRule transactionMode*/
							recog.base.set_state(421);
							recog.transactionMode()?;

							}
							}
							recog.base.set_state(426);
							recog.err_handler.sync(&mut recog.base)?;
							_la = recog.base.input.la(1);
						}
						}
					}

					}
				}
			,
				34 =>{
					let tmp = CommitContextExt::new(&**_localctx);
					recog.base.enter_outer_alt(Some(tmp.clone()), 34);
					_localctx = tmp;
					{
					recog.base.set_state(429);
					recog.base.match_token(COMMIT,&mut recog.err_handler)?;

					recog.base.set_state(431);
					recog.err_handler.sync(&mut recog.base)?;
					_la = recog.base.input.la(1);
					if _la==WORK {
						{
						recog.base.set_state(430);
						recog.base.match_token(WORK,&mut recog.err_handler)?;

						}
					}

					}
				}
			,
				35 =>{
					let tmp = RollbackContextExt::new(&**_localctx);
					recog.base.enter_outer_alt(Some(tmp.clone()), 35);
					_localctx = tmp;
					{
					recog.base.set_state(433);
					recog.base.match_token(ROLLBACK,&mut recog.err_handler)?;

					recog.base.set_state(435);
					recog.err_handler.sync(&mut recog.base)?;
					_la = recog.base.input.la(1);
					if _la==WORK {
						{
						recog.base.set_state(434);
						recog.base.match_token(WORK,&mut recog.err_handler)?;

						}
					}

					}
				}
			,
				36 =>{
					let tmp = ShowPartitionsContextExt::new(&**_localctx);
					recog.base.enter_outer_alt(Some(tmp.clone()), 36);
					_localctx = tmp;
					{
					recog.base.set_state(437);
					recog.base.match_token(SHOW,&mut recog.err_handler)?;

					recog.base.set_state(438);
					recog.base.match_token(PARTITIONS,&mut recog.err_handler)?;

					recog.base.set_state(439);
					_la = recog.base.input.la(1);
					if { !(_la==FROM || _la==IN) } {
						recog.err_handler.recover_inline(&mut recog.base)?;

					}
					else {
						if  recog.base.input.la(1)==TOKEN_EOF { recog.base.matched_eof = true };
						recog.err_handler.report_match(&mut recog.base);
						recog.base.consume(&mut recog.err_handler);
					}
					/*InvokeRule qualifiedName*/
					recog.base.set_state(440);
					recog.qualifiedName()?;

					recog.base.set_state(443);
					recog.err_handler.sync(&mut recog.base)?;
					_la = recog.base.input.la(1);
					if _la==WHERE {
						{
						recog.base.set_state(441);
						recog.base.match_token(WHERE,&mut recog.err_handler)?;

						/*InvokeRule booleanExpression*/
						recog.base.set_state(442);
						recog.booleanExpression_rec(0)?;

						}
					}

					recog.base.set_state(455);
					recog.err_handler.sync(&mut recog.base)?;
					_la = recog.base.input.la(1);
					if _la==ORDER {
						{
						recog.base.set_state(445);
						recog.base.match_token(ORDER,&mut recog.err_handler)?;

						recog.base.set_state(446);
						recog.base.match_token(BY,&mut recog.err_handler)?;

						/*InvokeRule sortItem*/
						recog.base.set_state(447);
						recog.sortItem()?;

						recog.base.set_state(452);
						recog.err_handler.sync(&mut recog.base)?;
						_la = recog.base.input.la(1);
						while _la==T__2 {
							{
							{
							recog.base.set_state(448);
							recog.base.match_token(T__2,&mut recog.err_handler)?;

							/*InvokeRule sortItem*/
							recog.base.set_state(449);
							recog.sortItem()?;

							}
							}
							recog.base.set_state(454);
							recog.err_handler.sync(&mut recog.base)?;
							_la = recog.base.input.la(1);
						}
						}
					}

					recog.base.set_state(459);
					recog.err_handler.sync(&mut recog.base)?;
					_la = recog.base.input.la(1);
					if _la==LIMIT {
						{
						recog.base.set_state(457);
						recog.base.match_token(LIMIT,&mut recog.err_handler)?;

						recog.base.set_state(458);
						if let StatementContextAll::ShowPartitionsContext(ctx) = cast_mut::<_,StatementContextAll >(&mut _localctx){
						ctx.limit = recog.base.input.lt(1).cloned(); } else {unreachable!("cant cast");} 
						_la = recog.base.input.la(1);
						if { !(_la==ALL || _la==INTEGER_VALUE) } {
							let tmp = recog.err_handler.recover_inline(&mut recog.base)?;
							if let StatementContextAll::ShowPartitionsContext(ctx) = cast_mut::<_,StatementContextAll >(&mut _localctx){
							ctx.limit = Some(tmp.clone()); } else {unreachable!("cant cast");}  

						}
						else {
							if  recog.base.input.la(1)==TOKEN_EOF { recog.base.matched_eof = true };
							recog.err_handler.report_match(&mut recog.base);
							recog.base.consume(&mut recog.err_handler);
						}
						}
					}

					}
				}
			,
				37 =>{
					let tmp = PrepareContextExt::new(&**_localctx);
					recog.base.enter_outer_alt(Some(tmp.clone()), 37);
					_localctx = tmp;
					{
					recog.base.set_state(461);
					recog.base.match_token(PREPARE,&mut recog.err_handler)?;

					/*InvokeRule identifier*/
					recog.base.set_state(462);
					recog.identifier()?;

					recog.base.set_state(463);
					recog.base.match_token(FROM,&mut recog.err_handler)?;

					/*InvokeRule statement*/
					recog.base.set_state(464);
					recog.statement()?;

					}
				}
			,
				38 =>{
					let tmp = DeallocateContextExt::new(&**_localctx);
					recog.base.enter_outer_alt(Some(tmp.clone()), 38);
					_localctx = tmp;
					{
					recog.base.set_state(466);
					recog.base.match_token(DEALLOCATE,&mut recog.err_handler)?;

					recog.base.set_state(467);
					recog.base.match_token(PREPARE,&mut recog.err_handler)?;

					/*InvokeRule identifier*/
					recog.base.set_state(468);
					recog.identifier()?;

					}
				}
			,
				39 =>{
					let tmp = ExecuteContextExt::new(&**_localctx);
					recog.base.enter_outer_alt(Some(tmp.clone()), 39);
					_localctx = tmp;
					{
					recog.base.set_state(469);
					recog.base.match_token(EXECUTE,&mut recog.err_handler)?;

					/*InvokeRule identifier*/
					recog.base.set_state(470);
					recog.identifier()?;

					recog.base.set_state(480);
					recog.err_handler.sync(&mut recog.base)?;
					_la = recog.base.input.la(1);
					if _la==USING {
						{
						recog.base.set_state(471);
						recog.base.match_token(USING,&mut recog.err_handler)?;

						/*InvokeRule expression*/
						recog.base.set_state(472);
						recog.expression()?;

						recog.base.set_state(477);
						recog.err_handler.sync(&mut recog.base)?;
						_la = recog.base.input.la(1);
						while _la==T__2 {
							{
							{
							recog.base.set_state(473);
							recog.base.match_token(T__2,&mut recog.err_handler)?;

							/*InvokeRule expression*/
							recog.base.set_state(474);
							recog.expression()?;

							}
							}
							recog.base.set_state(479);
							recog.err_handler.sync(&mut recog.base)?;
							_la = recog.base.input.la(1);
						}
						}
					}

					}
				}
			,
				40 =>{
					let tmp = DescribeInputContextExt::new(&**_localctx);
					recog.base.enter_outer_alt(Some(tmp.clone()), 40);
					_localctx = tmp;
					{
					recog.base.set_state(482);
					recog.base.match_token(DESCRIBE,&mut recog.err_handler)?;

					recog.base.set_state(483);
					recog.base.match_token(INPUT,&mut recog.err_handler)?;

					/*InvokeRule identifier*/
					recog.base.set_state(484);
					recog.identifier()?;

					}
				}
			,
				41 =>{
					let tmp = DescribeOutputContextExt::new(&**_localctx);
					recog.base.enter_outer_alt(Some(tmp.clone()), 41);
					_localctx = tmp;
					{
					recog.base.set_state(485);
					recog.base.match_token(DESCRIBE,&mut recog.err_handler)?;

					recog.base.set_state(486);
					recog.base.match_token(OUTPUT,&mut recog.err_handler)?;

					/*InvokeRule identifier*/
					recog.base.set_state(487);
					recog.identifier()?;

					}
				}

				_ => {}
			}
			Ok(())
		})();
		match result {
		Ok(_)=>{},
        Err(e @ ANTLRError::FallThrough(_)) => return Err(e),
		Err(ref re) => {
				//_localctx.exception = re;
				recog.err_handler.report_error(&mut recog.base, re);
				recog.err_handler.recover(&mut recog.base, re)?;
			}
		}
		recog.base.exit_rule();

		Ok(_localctx)
	}
}
//------------------- query ----------------
pub type QueryContextAll<'input> = QueryContext<'input>;


pub type QueryContext<'input> = BaseParserRuleContext<'input,QueryContextExt<'input>>;

#[derive(Clone)]
pub struct QueryContextExt<'input>{
ph:PhantomData<&'input str>
}

impl<'input> athenasqlParserContext<'input> for QueryContext<'input>{}

impl<'input,'a> Listenable<dyn athenasqlListener<'input> + 'a> for QueryContext<'input>{
		fn enter(&self,listener: &mut (dyn athenasqlListener<'input> + 'a)) {
			listener.enter_every_rule(self);
			listener.enter_query(self);
		}fn exit(&self,listener: &mut (dyn athenasqlListener<'input> + 'a)) {
			listener.exit_query(self);
			listener.exit_every_rule(self);
		}
}

impl<'input> CustomRuleContext<'input> for QueryContextExt<'input>{
	type TF = LocalTokenFactory<'input>;
	type Ctx = athenasqlParserContextType;
	fn get_rule_index(&self) -> usize { RULE_query }
	//fn type_rule_index() -> usize where Self: Sized { RULE_query }
}
antlr_rust::tid!{QueryContextExt<'a>}

impl<'input> QueryContextExt<'input>{
	fn new(parent: Option<Rc<dyn athenasqlParserContext<'input> + 'input > >, invoking_state: isize) -> Rc<QueryContextAll<'input>> {
		Rc::new(
			BaseParserRuleContext::new_parser_ctx(parent, invoking_state,QueryContextExt{
				ph:PhantomData
			}),
		)
	}
}

pub trait QueryContextAttrs<'input>: athenasqlParserContext<'input> + BorrowMut<QueryContextExt<'input>>{

fn queryNoWith(&self) -> Option<Rc<QueryNoWithContextAll<'input>>> where Self:Sized{
	self.child_of_type(0)
}
fn js_with(&self) -> Option<Rc<Js_withContextAll<'input>>> where Self:Sized{
	self.child_of_type(0)
}

}

impl<'input> QueryContextAttrs<'input> for QueryContext<'input>{}

impl<'input, I, H> athenasqlParser<'input, I, H>
where
    I: TokenStream<'input, TF = LocalTokenFactory<'input> > + TidAble<'input>,
    H: ErrorStrategy<'input,BaseParserType<'input,I>>
{
	pub fn query(&mut self,)
	-> Result<Rc<QueryContextAll<'input>>,ANTLRError> {
		let mut recog = self;
		let _parentctx = recog.ctx.take();
		let mut _localctx = QueryContextExt::new(_parentctx.clone(), recog.base.get_state());
        recog.base.enter_rule(_localctx.clone(), 8, RULE_query);
        let mut _localctx: Rc<QueryContextAll> = _localctx;
		let mut _la: isize = -1;
		let result: Result<(), ANTLRError> = (|| {

			//recog.base.enter_outer_alt(_localctx.clone(), 1);
			recog.base.enter_outer_alt(None, 1);
			{
			recog.base.set_state(491);
			recog.err_handler.sync(&mut recog.base)?;
			_la = recog.base.input.la(1);
			if _la==WITH {
				{
				/*InvokeRule js_with*/
				recog.base.set_state(490);
				recog.js_with()?;

				}
			}

			/*InvokeRule queryNoWith*/
			recog.base.set_state(493);
			recog.queryNoWith()?;

			}
			Ok(())
		})();
		match result {
		Ok(_)=>{},
        Err(e @ ANTLRError::FallThrough(_)) => return Err(e),
		Err(ref re) => {
				//_localctx.exception = re;
				recog.err_handler.report_error(&mut recog.base, re);
				recog.err_handler.recover(&mut recog.base, re)?;
			}
		}
		recog.base.exit_rule();

		Ok(_localctx)
	}
}
//------------------- js_with ----------------
pub type Js_withContextAll<'input> = Js_withContext<'input>;


pub type Js_withContext<'input> = BaseParserRuleContext<'input,Js_withContextExt<'input>>;

#[derive(Clone)]
pub struct Js_withContextExt<'input>{
ph:PhantomData<&'input str>
}

impl<'input> athenasqlParserContext<'input> for Js_withContext<'input>{}

impl<'input,'a> Listenable<dyn athenasqlListener<'input> + 'a> for Js_withContext<'input>{
		fn enter(&self,listener: &mut (dyn athenasqlListener<'input> + 'a)) {
			listener.enter_every_rule(self);
			listener.enter_js_with(self);
		}fn exit(&self,listener: &mut (dyn athenasqlListener<'input> + 'a)) {
			listener.exit_js_with(self);
			listener.exit_every_rule(self);
		}
}

impl<'input> CustomRuleContext<'input> for Js_withContextExt<'input>{
	type TF = LocalTokenFactory<'input>;
	type Ctx = athenasqlParserContextType;
	fn get_rule_index(&self) -> usize { RULE_js_with }
	//fn type_rule_index() -> usize where Self: Sized { RULE_js_with }
}
antlr_rust::tid!{Js_withContextExt<'a>}

impl<'input> Js_withContextExt<'input>{
	fn new(parent: Option<Rc<dyn athenasqlParserContext<'input> + 'input > >, invoking_state: isize) -> Rc<Js_withContextAll<'input>> {
		Rc::new(
			BaseParserRuleContext::new_parser_ctx(parent, invoking_state,Js_withContextExt{
				ph:PhantomData
			}),
		)
	}
}

pub trait Js_withContextAttrs<'input>: athenasqlParserContext<'input> + BorrowMut<Js_withContextExt<'input>>{

/// Retrieves first TerminalNode corresponding to token WITH
/// Returns `None` if there is no child corresponding to token WITH
fn WITH(&self) -> Option<Rc<TerminalNode<'input,athenasqlParserContextType>>> where Self:Sized{
	self.get_token(WITH, 0)
}
fn namedQuery_all(&self) ->  Vec<Rc<NamedQueryContextAll<'input>>> where Self:Sized{
	self.children_of_type()
}
fn namedQuery(&self, i: usize) -> Option<Rc<NamedQueryContextAll<'input>>> where Self:Sized{
	self.child_of_type(i)
}
/// Retrieves first TerminalNode corresponding to token RECURSIVE
/// Returns `None` if there is no child corresponding to token RECURSIVE
fn RECURSIVE(&self) -> Option<Rc<TerminalNode<'input,athenasqlParserContextType>>> where Self:Sized{
	self.get_token(RECURSIVE, 0)
}

}

impl<'input> Js_withContextAttrs<'input> for Js_withContext<'input>{}

impl<'input, I, H> athenasqlParser<'input, I, H>
where
    I: TokenStream<'input, TF = LocalTokenFactory<'input> > + TidAble<'input>,
    H: ErrorStrategy<'input,BaseParserType<'input,I>>
{
	pub fn js_with(&mut self,)
	-> Result<Rc<Js_withContextAll<'input>>,ANTLRError> {
		let mut recog = self;
		let _parentctx = recog.ctx.take();
		let mut _localctx = Js_withContextExt::new(_parentctx.clone(), recog.base.get_state());
        recog.base.enter_rule(_localctx.clone(), 10, RULE_js_with);
        let mut _localctx: Rc<Js_withContextAll> = _localctx;
		let mut _la: isize = -1;
		let result: Result<(), ANTLRError> = (|| {

			//recog.base.enter_outer_alt(_localctx.clone(), 1);
			recog.base.enter_outer_alt(None, 1);
			{
			recog.base.set_state(495);
			recog.base.match_token(WITH,&mut recog.err_handler)?;

			recog.base.set_state(497);
			recog.err_handler.sync(&mut recog.base)?;
			_la = recog.base.input.la(1);
			if _la==RECURSIVE {
				{
				recog.base.set_state(496);
				recog.base.match_token(RECURSIVE,&mut recog.err_handler)?;

				}
			}

			/*InvokeRule namedQuery*/
			recog.base.set_state(499);
			recog.namedQuery()?;

			recog.base.set_state(504);
			recog.err_handler.sync(&mut recog.base)?;
			_la = recog.base.input.la(1);
			while _la==T__2 {
				{
				{
				recog.base.set_state(500);
				recog.base.match_token(T__2,&mut recog.err_handler)?;

				/*InvokeRule namedQuery*/
				recog.base.set_state(501);
				recog.namedQuery()?;

				}
				}
				recog.base.set_state(506);
				recog.err_handler.sync(&mut recog.base)?;
				_la = recog.base.input.la(1);
			}
			}
			Ok(())
		})();
		match result {
		Ok(_)=>{},
        Err(e @ ANTLRError::FallThrough(_)) => return Err(e),
		Err(ref re) => {
				//_localctx.exception = re;
				recog.err_handler.report_error(&mut recog.base, re);
				recog.err_handler.recover(&mut recog.base, re)?;
			}
		}
		recog.base.exit_rule();

		Ok(_localctx)
	}
}
//------------------- tableElement ----------------
pub type TableElementContextAll<'input> = TableElementContext<'input>;


pub type TableElementContext<'input> = BaseParserRuleContext<'input,TableElementContextExt<'input>>;

#[derive(Clone)]
pub struct TableElementContextExt<'input>{
ph:PhantomData<&'input str>
}

impl<'input> athenasqlParserContext<'input> for TableElementContext<'input>{}

impl<'input,'a> Listenable<dyn athenasqlListener<'input> + 'a> for TableElementContext<'input>{
		fn enter(&self,listener: &mut (dyn athenasqlListener<'input> + 'a)) {
			listener.enter_every_rule(self);
			listener.enter_tableElement(self);
		}fn exit(&self,listener: &mut (dyn athenasqlListener<'input> + 'a)) {
			listener.exit_tableElement(self);
			listener.exit_every_rule(self);
		}
}

impl<'input> CustomRuleContext<'input> for TableElementContextExt<'input>{
	type TF = LocalTokenFactory<'input>;
	type Ctx = athenasqlParserContextType;
	fn get_rule_index(&self) -> usize { RULE_tableElement }
	//fn type_rule_index() -> usize where Self: Sized { RULE_tableElement }
}
antlr_rust::tid!{TableElementContextExt<'a>}

impl<'input> TableElementContextExt<'input>{
	fn new(parent: Option<Rc<dyn athenasqlParserContext<'input> + 'input > >, invoking_state: isize) -> Rc<TableElementContextAll<'input>> {
		Rc::new(
			BaseParserRuleContext::new_parser_ctx(parent, invoking_state,TableElementContextExt{
				ph:PhantomData
			}),
		)
	}
}

pub trait TableElementContextAttrs<'input>: athenasqlParserContext<'input> + BorrowMut<TableElementContextExt<'input>>{

fn columnDefinition(&self) -> Option<Rc<ColumnDefinitionContextAll<'input>>> where Self:Sized{
	self.child_of_type(0)
}
fn likeClause(&self) -> Option<Rc<LikeClauseContextAll<'input>>> where Self:Sized{
	self.child_of_type(0)
}

}

impl<'input> TableElementContextAttrs<'input> for TableElementContext<'input>{}

impl<'input, I, H> athenasqlParser<'input, I, H>
where
    I: TokenStream<'input, TF = LocalTokenFactory<'input> > + TidAble<'input>,
    H: ErrorStrategy<'input,BaseParserType<'input,I>>
{
	pub fn tableElement(&mut self,)
	-> Result<Rc<TableElementContextAll<'input>>,ANTLRError> {
		let mut recog = self;
		let _parentctx = recog.ctx.take();
		let mut _localctx = TableElementContextExt::new(_parentctx.clone(), recog.base.get_state());
        recog.base.enter_rule(_localctx.clone(), 12, RULE_tableElement);
        let mut _localctx: Rc<TableElementContextAll> = _localctx;
		let result: Result<(), ANTLRError> = (|| {

			recog.base.set_state(509);
			recog.err_handler.sync(&mut recog.base)?;
			match recog.base.input.la(1) {
			 ADD | ALL | SOME | ANY | AT | NO | SUBSTRING | POSITION | TINYINT | SMALLINT |
			 INTEGER | DATE | TIME | TIMESTAMP | INTERVAL | YEAR | MONTH | DAY | HOUR |
			 MINUTE | SECOND | ZONE | FILTER | OVER | PARTITION | RANGE | ROWS | PRECEDING |
			 FOLLOWING | CURRENT | ROW | SCHEMA | COMMENT | VIEW | REPLACE | GRANT |
			 REVOKE | PRIVILEGES | PUBLIC | OPTION | EXPLAIN | ANALYZE | FORMAT |
			 TYPE | TEXT | GRAPHVIZ | LOGICAL | DISTRIBUTED | VALIDATE | SHOW | TABLES |
			 SCHEMAS | CATALOGS | COLUMNS | COLUMN | USE | PARTITIONS | FUNCTIONS |
			 TO | SYSTEM | BERNOULLI | POISSONIZED | TABLESAMPLE | ARRAY | MAP | SET |
			 RESET | SESSION | DATA | START | TRANSACTION | COMMIT | ROLLBACK | WORK |
			 ISOLATION | LEVEL | SERIALIZABLE | REPEATABLE | COMMITTED | UNCOMMITTED |
			 READ | WRITE | ONLY | CALL | INPUT | OUTPUT | CASCADE | RESTRICT | INCLUDING |
			 EXCLUDING | PROPERTIES | NFD | NFC | NFKD | NFKC | IF | NULLIF | COALESCE |
			 IDENTIFIER | DIGIT_IDENTIFIER | QUOTED_IDENTIFIER | BACKQUOTED_IDENTIFIER 
				=> {
					//recog.base.enter_outer_alt(_localctx.clone(), 1);
					recog.base.enter_outer_alt(None, 1);
					{
					/*InvokeRule columnDefinition*/
					recog.base.set_state(507);
					recog.columnDefinition()?;

					}
				}

			 LIKE 
				=> {
					//recog.base.enter_outer_alt(_localctx.clone(), 2);
					recog.base.enter_outer_alt(None, 2);
					{
					/*InvokeRule likeClause*/
					recog.base.set_state(508);
					recog.likeClause()?;

					}
				}

				_ => Err(ANTLRError::NoAltError(NoViableAltError::new(&mut recog.base)))?
			}
			Ok(())
		})();
		match result {
		Ok(_)=>{},
        Err(e @ ANTLRError::FallThrough(_)) => return Err(e),
		Err(ref re) => {
				//_localctx.exception = re;
				recog.err_handler.report_error(&mut recog.base, re);
				recog.err_handler.recover(&mut recog.base, re)?;
			}
		}
		recog.base.exit_rule();

		Ok(_localctx)
	}
}
//------------------- columnDefinition ----------------
pub type ColumnDefinitionContextAll<'input> = ColumnDefinitionContext<'input>;


pub type ColumnDefinitionContext<'input> = BaseParserRuleContext<'input,ColumnDefinitionContextExt<'input>>;

#[derive(Clone)]
pub struct ColumnDefinitionContextExt<'input>{
ph:PhantomData<&'input str>
}

impl<'input> athenasqlParserContext<'input> for ColumnDefinitionContext<'input>{}

impl<'input,'a> Listenable<dyn athenasqlListener<'input> + 'a> for ColumnDefinitionContext<'input>{
		fn enter(&self,listener: &mut (dyn athenasqlListener<'input> + 'a)) {
			listener.enter_every_rule(self);
			listener.enter_columnDefinition(self);
		}fn exit(&self,listener: &mut (dyn athenasqlListener<'input> + 'a)) {
			listener.exit_columnDefinition(self);
			listener.exit_every_rule(self);
		}
}

impl<'input> CustomRuleContext<'input> for ColumnDefinitionContextExt<'input>{
	type TF = LocalTokenFactory<'input>;
	type Ctx = athenasqlParserContextType;
	fn get_rule_index(&self) -> usize { RULE_columnDefinition }
	//fn type_rule_index() -> usize where Self: Sized { RULE_columnDefinition }
}
antlr_rust::tid!{ColumnDefinitionContextExt<'a>}

impl<'input> ColumnDefinitionContextExt<'input>{
	fn new(parent: Option<Rc<dyn athenasqlParserContext<'input> + 'input > >, invoking_state: isize) -> Rc<ColumnDefinitionContextAll<'input>> {
		Rc::new(
			BaseParserRuleContext::new_parser_ctx(parent, invoking_state,ColumnDefinitionContextExt{
				ph:PhantomData
			}),
		)
	}
}

pub trait ColumnDefinitionContextAttrs<'input>: athenasqlParserContext<'input> + BorrowMut<ColumnDefinitionContextExt<'input>>{

fn identifier(&self) -> Option<Rc<IdentifierContextAll<'input>>> where Self:Sized{
	self.child_of_type(0)
}
fn type(&self) -> Option<Rc<TypeContextAll<'input>>> where Self:Sized{
	self.child_of_type(0)
}
/// Retrieves first TerminalNode corresponding to token COMMENT
/// Returns `None` if there is no child corresponding to token COMMENT
fn COMMENT(&self) -> Option<Rc<TerminalNode<'input,athenasqlParserContextType>>> where Self:Sized{
	self.get_token(COMMENT, 0)
}
/// Retrieves first TerminalNode corresponding to token STRING
/// Returns `None` if there is no child corresponding to token STRING
fn STRING(&self) -> Option<Rc<TerminalNode<'input,athenasqlParserContextType>>> where Self:Sized{
	self.get_token(STRING, 0)
}

}

impl<'input> ColumnDefinitionContextAttrs<'input> for ColumnDefinitionContext<'input>{}

impl<'input, I, H> athenasqlParser<'input, I, H>
where
    I: TokenStream<'input, TF = LocalTokenFactory<'input> > + TidAble<'input>,
    H: ErrorStrategy<'input,BaseParserType<'input,I>>
{
	pub fn columnDefinition(&mut self,)
	-> Result<Rc<ColumnDefinitionContextAll<'input>>,ANTLRError> {
		let mut recog = self;
		let _parentctx = recog.ctx.take();
		let mut _localctx = ColumnDefinitionContextExt::new(_parentctx.clone(), recog.base.get_state());
        recog.base.enter_rule(_localctx.clone(), 14, RULE_columnDefinition);
        let mut _localctx: Rc<ColumnDefinitionContextAll> = _localctx;
		let mut _la: isize = -1;
		let result: Result<(), ANTLRError> = (|| {

			//recog.base.enter_outer_alt(_localctx.clone(), 1);
			recog.base.enter_outer_alt(None, 1);
			{
			/*InvokeRule identifier*/
			recog.base.set_state(511);
			recog.identifier()?;

			/*InvokeRule type*/
			recog.base.set_state(512);
			recog.type_rec(0)?;

			recog.base.set_state(515);
			recog.err_handler.sync(&mut recog.base)?;
			_la = recog.base.input.la(1);
			if _la==COMMENT {
				{
				recog.base.set_state(513);
				recog.base.match_token(COMMENT,&mut recog.err_handler)?;

				recog.base.set_state(514);
				recog.base.match_token(STRING,&mut recog.err_handler)?;

				}
			}

			}
			Ok(())
		})();
		match result {
		Ok(_)=>{},
        Err(e @ ANTLRError::FallThrough(_)) => return Err(e),
		Err(ref re) => {
				//_localctx.exception = re;
				recog.err_handler.report_error(&mut recog.base, re);
				recog.err_handler.recover(&mut recog.base, re)?;
			}
		}
		recog.base.exit_rule();

		Ok(_localctx)
	}
}
//------------------- likeClause ----------------
pub type LikeClauseContextAll<'input> = LikeClauseContext<'input>;


pub type LikeClauseContext<'input> = BaseParserRuleContext<'input,LikeClauseContextExt<'input>>;

#[derive(Clone)]
pub struct LikeClauseContextExt<'input>{
	pub optionType: Option<TokenType<'input>>,
ph:PhantomData<&'input str>
}

impl<'input> athenasqlParserContext<'input> for LikeClauseContext<'input>{}

impl<'input,'a> Listenable<dyn athenasqlListener<'input> + 'a> for LikeClauseContext<'input>{
		fn enter(&self,listener: &mut (dyn athenasqlListener<'input> + 'a)) {
			listener.enter_every_rule(self);
			listener.enter_likeClause(self);
		}fn exit(&self,listener: &mut (dyn athenasqlListener<'input> + 'a)) {
			listener.exit_likeClause(self);
			listener.exit_every_rule(self);
		}
}

impl<'input> CustomRuleContext<'input> for LikeClauseContextExt<'input>{
	type TF = LocalTokenFactory<'input>;
	type Ctx = athenasqlParserContextType;
	fn get_rule_index(&self) -> usize { RULE_likeClause }
	//fn type_rule_index() -> usize where Self: Sized { RULE_likeClause }
}
antlr_rust::tid!{LikeClauseContextExt<'a>}

impl<'input> LikeClauseContextExt<'input>{
	fn new(parent: Option<Rc<dyn athenasqlParserContext<'input> + 'input > >, invoking_state: isize) -> Rc<LikeClauseContextAll<'input>> {
		Rc::new(
			BaseParserRuleContext::new_parser_ctx(parent, invoking_state,LikeClauseContextExt{
				optionType: None, 
				ph:PhantomData
			}),
		)
	}
}

pub trait LikeClauseContextAttrs<'input>: athenasqlParserContext<'input> + BorrowMut<LikeClauseContextExt<'input>>{

/// Retrieves first TerminalNode corresponding to token LIKE
/// Returns `None` if there is no child corresponding to token LIKE
fn LIKE(&self) -> Option<Rc<TerminalNode<'input,athenasqlParserContextType>>> where Self:Sized{
	self.get_token(LIKE, 0)
}
fn qualifiedName(&self) -> Option<Rc<QualifiedNameContextAll<'input>>> where Self:Sized{
	self.child_of_type(0)
}
/// Retrieves first TerminalNode corresponding to token PROPERTIES
/// Returns `None` if there is no child corresponding to token PROPERTIES
fn PROPERTIES(&self) -> Option<Rc<TerminalNode<'input,athenasqlParserContextType>>> where Self:Sized{
	self.get_token(PROPERTIES, 0)
}
/// Retrieves first TerminalNode corresponding to token INCLUDING
/// Returns `None` if there is no child corresponding to token INCLUDING
fn INCLUDING(&self) -> Option<Rc<TerminalNode<'input,athenasqlParserContextType>>> where Self:Sized{
	self.get_token(INCLUDING, 0)
}
/// Retrieves first TerminalNode corresponding to token EXCLUDING
/// Returns `None` if there is no child corresponding to token EXCLUDING
fn EXCLUDING(&self) -> Option<Rc<TerminalNode<'input,athenasqlParserContextType>>> where Self:Sized{
	self.get_token(EXCLUDING, 0)
}

}

impl<'input> LikeClauseContextAttrs<'input> for LikeClauseContext<'input>{}

impl<'input, I, H> athenasqlParser<'input, I, H>
where
    I: TokenStream<'input, TF = LocalTokenFactory<'input> > + TidAble<'input>,
    H: ErrorStrategy<'input,BaseParserType<'input,I>>
{
	pub fn likeClause(&mut self,)
	-> Result<Rc<LikeClauseContextAll<'input>>,ANTLRError> {
		let mut recog = self;
		let _parentctx = recog.ctx.take();
		let mut _localctx = LikeClauseContextExt::new(_parentctx.clone(), recog.base.get_state());
        recog.base.enter_rule(_localctx.clone(), 16, RULE_likeClause);
        let mut _localctx: Rc<LikeClauseContextAll> = _localctx;
		let mut _la: isize = -1;
		let result: Result<(), ANTLRError> = (|| {

			//recog.base.enter_outer_alt(_localctx.clone(), 1);
			recog.base.enter_outer_alt(None, 1);
			{
			recog.base.set_state(517);
			recog.base.match_token(LIKE,&mut recog.err_handler)?;

			/*InvokeRule qualifiedName*/
			recog.base.set_state(518);
			recog.qualifiedName()?;

			recog.base.set_state(521);
			recog.err_handler.sync(&mut recog.base)?;
			_la = recog.base.input.la(1);
			if _la==INCLUDING || _la==EXCLUDING {
				{
				recog.base.set_state(519);
				 cast_mut::<_,LikeClauseContext >(&mut _localctx).optionType = recog.base.input.lt(1).cloned();
				 
				_la = recog.base.input.la(1);
				if { !(_la==INCLUDING || _la==EXCLUDING) } {
					let tmp = recog.err_handler.recover_inline(&mut recog.base)?;
					 cast_mut::<_,LikeClauseContext >(&mut _localctx).optionType = Some(tmp.clone());
					  

				}
				else {
					if  recog.base.input.la(1)==TOKEN_EOF { recog.base.matched_eof = true };
					recog.err_handler.report_match(&mut recog.base);
					recog.base.consume(&mut recog.err_handler);
				}
				recog.base.set_state(520);
				recog.base.match_token(PROPERTIES,&mut recog.err_handler)?;

				}
			}

			}
			Ok(())
		})();
		match result {
		Ok(_)=>{},
        Err(e @ ANTLRError::FallThrough(_)) => return Err(e),
		Err(ref re) => {
				//_localctx.exception = re;
				recog.err_handler.report_error(&mut recog.base, re);
				recog.err_handler.recover(&mut recog.base, re)?;
			}
		}
		recog.base.exit_rule();

		Ok(_localctx)
	}
}
//------------------- tableProperties ----------------
pub type TablePropertiesContextAll<'input> = TablePropertiesContext<'input>;


pub type TablePropertiesContext<'input> = BaseParserRuleContext<'input,TablePropertiesContextExt<'input>>;

#[derive(Clone)]
pub struct TablePropertiesContextExt<'input>{
ph:PhantomData<&'input str>
}

impl<'input> athenasqlParserContext<'input> for TablePropertiesContext<'input>{}

impl<'input,'a> Listenable<dyn athenasqlListener<'input> + 'a> for TablePropertiesContext<'input>{
		fn enter(&self,listener: &mut (dyn athenasqlListener<'input> + 'a)) {
			listener.enter_every_rule(self);
			listener.enter_tableProperties(self);
		}fn exit(&self,listener: &mut (dyn athenasqlListener<'input> + 'a)) {
			listener.exit_tableProperties(self);
			listener.exit_every_rule(self);
		}
}

impl<'input> CustomRuleContext<'input> for TablePropertiesContextExt<'input>{
	type TF = LocalTokenFactory<'input>;
	type Ctx = athenasqlParserContextType;
	fn get_rule_index(&self) -> usize { RULE_tableProperties }
	//fn type_rule_index() -> usize where Self: Sized { RULE_tableProperties }
}
antlr_rust::tid!{TablePropertiesContextExt<'a>}

impl<'input> TablePropertiesContextExt<'input>{
	fn new(parent: Option<Rc<dyn athenasqlParserContext<'input> + 'input > >, invoking_state: isize) -> Rc<TablePropertiesContextAll<'input>> {
		Rc::new(
			BaseParserRuleContext::new_parser_ctx(parent, invoking_state,TablePropertiesContextExt{
				ph:PhantomData
			}),
		)
	}
}

pub trait TablePropertiesContextAttrs<'input>: athenasqlParserContext<'input> + BorrowMut<TablePropertiesContextExt<'input>>{

fn tableProperty_all(&self) ->  Vec<Rc<TablePropertyContextAll<'input>>> where Self:Sized{
	self.children_of_type()
}
fn tableProperty(&self, i: usize) -> Option<Rc<TablePropertyContextAll<'input>>> where Self:Sized{
	self.child_of_type(i)
}

}

impl<'input> TablePropertiesContextAttrs<'input> for TablePropertiesContext<'input>{}

impl<'input, I, H> athenasqlParser<'input, I, H>
where
    I: TokenStream<'input, TF = LocalTokenFactory<'input> > + TidAble<'input>,
    H: ErrorStrategy<'input,BaseParserType<'input,I>>
{
	pub fn tableProperties(&mut self,)
	-> Result<Rc<TablePropertiesContextAll<'input>>,ANTLRError> {
		let mut recog = self;
		let _parentctx = recog.ctx.take();
		let mut _localctx = TablePropertiesContextExt::new(_parentctx.clone(), recog.base.get_state());
        recog.base.enter_rule(_localctx.clone(), 18, RULE_tableProperties);
        let mut _localctx: Rc<TablePropertiesContextAll> = _localctx;
		let mut _la: isize = -1;
		let result: Result<(), ANTLRError> = (|| {

			//recog.base.enter_outer_alt(_localctx.clone(), 1);
			recog.base.enter_outer_alt(None, 1);
			{
			recog.base.set_state(523);
			recog.base.match_token(T__1,&mut recog.err_handler)?;

			/*InvokeRule tableProperty*/
			recog.base.set_state(524);
			recog.tableProperty()?;

			recog.base.set_state(529);
			recog.err_handler.sync(&mut recog.base)?;
			_la = recog.base.input.la(1);
			while _la==T__2 {
				{
				{
				recog.base.set_state(525);
				recog.base.match_token(T__2,&mut recog.err_handler)?;

				/*InvokeRule tableProperty*/
				recog.base.set_state(526);
				recog.tableProperty()?;

				}
				}
				recog.base.set_state(531);
				recog.err_handler.sync(&mut recog.base)?;
				_la = recog.base.input.la(1);
			}
			recog.base.set_state(532);
			recog.base.match_token(T__3,&mut recog.err_handler)?;

			}
			Ok(())
		})();
		match result {
		Ok(_)=>{},
        Err(e @ ANTLRError::FallThrough(_)) => return Err(e),
		Err(ref re) => {
				//_localctx.exception = re;
				recog.err_handler.report_error(&mut recog.base, re);
				recog.err_handler.recover(&mut recog.base, re)?;
			}
		}
		recog.base.exit_rule();

		Ok(_localctx)
	}
}
//------------------- tableProperty ----------------
pub type TablePropertyContextAll<'input> = TablePropertyContext<'input>;


pub type TablePropertyContext<'input> = BaseParserRuleContext<'input,TablePropertyContextExt<'input>>;

#[derive(Clone)]
pub struct TablePropertyContextExt<'input>{
ph:PhantomData<&'input str>
}

impl<'input> athenasqlParserContext<'input> for TablePropertyContext<'input>{}

impl<'input,'a> Listenable<dyn athenasqlListener<'input> + 'a> for TablePropertyContext<'input>{
		fn enter(&self,listener: &mut (dyn athenasqlListener<'input> + 'a)) {
			listener.enter_every_rule(self);
			listener.enter_tableProperty(self);
		}fn exit(&self,listener: &mut (dyn athenasqlListener<'input> + 'a)) {
			listener.exit_tableProperty(self);
			listener.exit_every_rule(self);
		}
}

impl<'input> CustomRuleContext<'input> for TablePropertyContextExt<'input>{
	type TF = LocalTokenFactory<'input>;
	type Ctx = athenasqlParserContextType;
	fn get_rule_index(&self) -> usize { RULE_tableProperty }
	//fn type_rule_index() -> usize where Self: Sized { RULE_tableProperty }
}
antlr_rust::tid!{TablePropertyContextExt<'a>}

impl<'input> TablePropertyContextExt<'input>{
	fn new(parent: Option<Rc<dyn athenasqlParserContext<'input> + 'input > >, invoking_state: isize) -> Rc<TablePropertyContextAll<'input>> {
		Rc::new(
			BaseParserRuleContext::new_parser_ctx(parent, invoking_state,TablePropertyContextExt{
				ph:PhantomData
			}),
		)
	}
}

pub trait TablePropertyContextAttrs<'input>: athenasqlParserContext<'input> + BorrowMut<TablePropertyContextExt<'input>>{

fn identifier(&self) -> Option<Rc<IdentifierContextAll<'input>>> where Self:Sized{
	self.child_of_type(0)
}
/// Retrieves first TerminalNode corresponding to token EQ
/// Returns `None` if there is no child corresponding to token EQ
fn EQ(&self) -> Option<Rc<TerminalNode<'input,athenasqlParserContextType>>> where Self:Sized{
	self.get_token(EQ, 0)
}
fn expression(&self) -> Option<Rc<ExpressionContextAll<'input>>> where Self:Sized{
	self.child_of_type(0)
}

}

impl<'input> TablePropertyContextAttrs<'input> for TablePropertyContext<'input>{}

impl<'input, I, H> athenasqlParser<'input, I, H>
where
    I: TokenStream<'input, TF = LocalTokenFactory<'input> > + TidAble<'input>,
    H: ErrorStrategy<'input,BaseParserType<'input,I>>
{
	pub fn tableProperty(&mut self,)
	-> Result<Rc<TablePropertyContextAll<'input>>,ANTLRError> {
		let mut recog = self;
		let _parentctx = recog.ctx.take();
		let mut _localctx = TablePropertyContextExt::new(_parentctx.clone(), recog.base.get_state());
        recog.base.enter_rule(_localctx.clone(), 20, RULE_tableProperty);
        let mut _localctx: Rc<TablePropertyContextAll> = _localctx;
		let result: Result<(), ANTLRError> = (|| {

			//recog.base.enter_outer_alt(_localctx.clone(), 1);
			recog.base.enter_outer_alt(None, 1);
			{
			/*InvokeRule identifier*/
			recog.base.set_state(534);
			recog.identifier()?;

			recog.base.set_state(535);
			recog.base.match_token(EQ,&mut recog.err_handler)?;

			/*InvokeRule expression*/
			recog.base.set_state(536);
			recog.expression()?;

			}
			Ok(())
		})();
		match result {
		Ok(_)=>{},
        Err(e @ ANTLRError::FallThrough(_)) => return Err(e),
		Err(ref re) => {
				//_localctx.exception = re;
				recog.err_handler.report_error(&mut recog.base, re);
				recog.err_handler.recover(&mut recog.base, re)?;
			}
		}
		recog.base.exit_rule();

		Ok(_localctx)
	}
}
//------------------- queryNoWith ----------------
pub type QueryNoWithContextAll<'input> = QueryNoWithContext<'input>;


pub type QueryNoWithContext<'input> = BaseParserRuleContext<'input,QueryNoWithContextExt<'input>>;

#[derive(Clone)]
pub struct QueryNoWithContextExt<'input>{
	pub limit: Option<TokenType<'input>>,
ph:PhantomData<&'input str>
}

impl<'input> athenasqlParserContext<'input> for QueryNoWithContext<'input>{}

impl<'input,'a> Listenable<dyn athenasqlListener<'input> + 'a> for QueryNoWithContext<'input>{
		fn enter(&self,listener: &mut (dyn athenasqlListener<'input> + 'a)) {
			listener.enter_every_rule(self);
			listener.enter_queryNoWith(self);
		}fn exit(&self,listener: &mut (dyn athenasqlListener<'input> + 'a)) {
			listener.exit_queryNoWith(self);
			listener.exit_every_rule(self);
		}
}

impl<'input> CustomRuleContext<'input> for QueryNoWithContextExt<'input>{
	type TF = LocalTokenFactory<'input>;
	type Ctx = athenasqlParserContextType;
	fn get_rule_index(&self) -> usize { RULE_queryNoWith }
	//fn type_rule_index() -> usize where Self: Sized { RULE_queryNoWith }
}
antlr_rust::tid!{QueryNoWithContextExt<'a>}

impl<'input> QueryNoWithContextExt<'input>{
	fn new(parent: Option<Rc<dyn athenasqlParserContext<'input> + 'input > >, invoking_state: isize) -> Rc<QueryNoWithContextAll<'input>> {
		Rc::new(
			BaseParserRuleContext::new_parser_ctx(parent, invoking_state,QueryNoWithContextExt{
				limit: None, 
				ph:PhantomData
			}),
		)
	}
}

pub trait QueryNoWithContextAttrs<'input>: athenasqlParserContext<'input> + BorrowMut<QueryNoWithContextExt<'input>>{

fn queryTerm(&self) -> Option<Rc<QueryTermContextAll<'input>>> where Self:Sized{
	self.child_of_type(0)
}
/// Retrieves first TerminalNode corresponding to token ORDER
/// Returns `None` if there is no child corresponding to token ORDER
fn ORDER(&self) -> Option<Rc<TerminalNode<'input,athenasqlParserContextType>>> where Self:Sized{
	self.get_token(ORDER, 0)
}
/// Retrieves first TerminalNode corresponding to token BY
/// Returns `None` if there is no child corresponding to token BY
fn BY(&self) -> Option<Rc<TerminalNode<'input,athenasqlParserContextType>>> where Self:Sized{
	self.get_token(BY, 0)
}
fn sortItem_all(&self) ->  Vec<Rc<SortItemContextAll<'input>>> where Self:Sized{
	self.children_of_type()
}
fn sortItem(&self, i: usize) -> Option<Rc<SortItemContextAll<'input>>> where Self:Sized{
	self.child_of_type(i)
}
/// Retrieves first TerminalNode corresponding to token LIMIT
/// Returns `None` if there is no child corresponding to token LIMIT
fn LIMIT(&self) -> Option<Rc<TerminalNode<'input,athenasqlParserContextType>>> where Self:Sized{
	self.get_token(LIMIT, 0)
}
/// Retrieves first TerminalNode corresponding to token INTEGER_VALUE
/// Returns `None` if there is no child corresponding to token INTEGER_VALUE
fn INTEGER_VALUE(&self) -> Option<Rc<TerminalNode<'input,athenasqlParserContextType>>> where Self:Sized{
	self.get_token(INTEGER_VALUE, 0)
}
/// Retrieves first TerminalNode corresponding to token ALL
/// Returns `None` if there is no child corresponding to token ALL
fn ALL(&self) -> Option<Rc<TerminalNode<'input,athenasqlParserContextType>>> where Self:Sized{
	self.get_token(ALL, 0)
}

}

impl<'input> QueryNoWithContextAttrs<'input> for QueryNoWithContext<'input>{}

impl<'input, I, H> athenasqlParser<'input, I, H>
where
    I: TokenStream<'input, TF = LocalTokenFactory<'input> > + TidAble<'input>,
    H: ErrorStrategy<'input,BaseParserType<'input,I>>
{
	pub fn queryNoWith(&mut self,)
	-> Result<Rc<QueryNoWithContextAll<'input>>,ANTLRError> {
		let mut recog = self;
		let _parentctx = recog.ctx.take();
		let mut _localctx = QueryNoWithContextExt::new(_parentctx.clone(), recog.base.get_state());
        recog.base.enter_rule(_localctx.clone(), 22, RULE_queryNoWith);
        let mut _localctx: Rc<QueryNoWithContextAll> = _localctx;
		let mut _la: isize = -1;
		let result: Result<(), ANTLRError> = (|| {

			//recog.base.enter_outer_alt(_localctx.clone(), 1);
			recog.base.enter_outer_alt(None, 1);
			{
			/*InvokeRule queryTerm*/
			recog.base.set_state(538);
			recog.queryTerm_rec(0)?;

			recog.base.set_state(549);
			recog.err_handler.sync(&mut recog.base)?;
			_la = recog.base.input.la(1);
			if _la==ORDER {
				{
				recog.base.set_state(539);
				recog.base.match_token(ORDER,&mut recog.err_handler)?;

				recog.base.set_state(540);
				recog.base.match_token(BY,&mut recog.err_handler)?;

				/*InvokeRule sortItem*/
				recog.base.set_state(541);
				recog.sortItem()?;

				recog.base.set_state(546);
				recog.err_handler.sync(&mut recog.base)?;
				_la = recog.base.input.la(1);
				while _la==T__2 {
					{
					{
					recog.base.set_state(542);
					recog.base.match_token(T__2,&mut recog.err_handler)?;

					/*InvokeRule sortItem*/
					recog.base.set_state(543);
					recog.sortItem()?;

					}
					}
					recog.base.set_state(548);
					recog.err_handler.sync(&mut recog.base)?;
					_la = recog.base.input.la(1);
				}
				}
			}

			recog.base.set_state(553);
			recog.err_handler.sync(&mut recog.base)?;
			_la = recog.base.input.la(1);
			if _la==LIMIT {
				{
				recog.base.set_state(551);
				recog.base.match_token(LIMIT,&mut recog.err_handler)?;

				recog.base.set_state(552);
				 cast_mut::<_,QueryNoWithContext >(&mut _localctx).limit = recog.base.input.lt(1).cloned();
				 
				_la = recog.base.input.la(1);
				if { !(_la==ALL || _la==INTEGER_VALUE) } {
					let tmp = recog.err_handler.recover_inline(&mut recog.base)?;
					 cast_mut::<_,QueryNoWithContext >(&mut _localctx).limit = Some(tmp.clone());
					  

				}
				else {
					if  recog.base.input.la(1)==TOKEN_EOF { recog.base.matched_eof = true };
					recog.err_handler.report_match(&mut recog.base);
					recog.base.consume(&mut recog.err_handler);
				}
				}
			}

			}
			Ok(())
		})();
		match result {
		Ok(_)=>{},
        Err(e @ ANTLRError::FallThrough(_)) => return Err(e),
		Err(ref re) => {
				//_localctx.exception = re;
				recog.err_handler.report_error(&mut recog.base, re);
				recog.err_handler.recover(&mut recog.base, re)?;
			}
		}
		recog.base.exit_rule();

		Ok(_localctx)
	}
}
//------------------- queryTerm ----------------
#[derive(Debug)]
pub enum QueryTermContextAll<'input>{
	QueryTermDefaultContext(QueryTermDefaultContext<'input>),
	SetOperationContext(SetOperationContext<'input>),
Error(QueryTermContext<'input>)
}
antlr_rust::tid!{QueryTermContextAll<'a>}

impl<'input> antlr_rust::parser_rule_context::DerefSeal for QueryTermContextAll<'input>{}

impl<'input> athenasqlParserContext<'input> for QueryTermContextAll<'input>{}

impl<'input> Deref for QueryTermContextAll<'input>{
	type Target = dyn QueryTermContextAttrs<'input> + 'input;
	fn deref(&self) -> &Self::Target{
		use QueryTermContextAll::*;
		match self{
			QueryTermDefaultContext(inner) => inner,
			SetOperationContext(inner) => inner,
Error(inner) => inner
		}
	}
}
impl<'input,'a> Listenable<dyn athenasqlListener<'input> + 'a> for QueryTermContextAll<'input>{
    fn enter(&self, listener: &mut (dyn athenasqlListener<'input> + 'a)) { self.deref().enter(listener) }
    fn exit(&self, listener: &mut (dyn athenasqlListener<'input> + 'a)) { self.deref().exit(listener) }
}



pub type QueryTermContext<'input> = BaseParserRuleContext<'input,QueryTermContextExt<'input>>;

#[derive(Clone)]
pub struct QueryTermContextExt<'input>{
ph:PhantomData<&'input str>
}

impl<'input> athenasqlParserContext<'input> for QueryTermContext<'input>{}

impl<'input,'a> Listenable<dyn athenasqlListener<'input> + 'a> for QueryTermContext<'input>{
}

impl<'input> CustomRuleContext<'input> for QueryTermContextExt<'input>{
	type TF = LocalTokenFactory<'input>;
	type Ctx = athenasqlParserContextType;
	fn get_rule_index(&self) -> usize { RULE_queryTerm }
	//fn type_rule_index() -> usize where Self: Sized { RULE_queryTerm }
}
antlr_rust::tid!{QueryTermContextExt<'a>}

impl<'input> QueryTermContextExt<'input>{
	fn new(parent: Option<Rc<dyn athenasqlParserContext<'input> + 'input > >, invoking_state: isize) -> Rc<QueryTermContextAll<'input>> {
		Rc::new(
		QueryTermContextAll::Error(
			BaseParserRuleContext::new_parser_ctx(parent, invoking_state,QueryTermContextExt{
				ph:PhantomData
			}),
		)
		)
	}
}

pub trait QueryTermContextAttrs<'input>: athenasqlParserContext<'input> + BorrowMut<QueryTermContextExt<'input>>{


}

impl<'input> QueryTermContextAttrs<'input> for QueryTermContext<'input>{}

pub type QueryTermDefaultContext<'input> = BaseParserRuleContext<'input,QueryTermDefaultContextExt<'input>>;

pub trait QueryTermDefaultContextAttrs<'input>: athenasqlParserContext<'input>{
	fn queryPrimary(&self) -> Option<Rc<QueryPrimaryContextAll<'input>>> where Self:Sized{
		self.child_of_type(0)
	}
}

impl<'input> QueryTermDefaultContextAttrs<'input> for QueryTermDefaultContext<'input>{}

pub struct QueryTermDefaultContextExt<'input>{
	base:QueryTermContextExt<'input>,
	ph:PhantomData<&'input str>
}

antlr_rust::tid!{QueryTermDefaultContextExt<'a>}

impl<'input> athenasqlParserContext<'input> for QueryTermDefaultContext<'input>{}

impl<'input,'a> Listenable<dyn athenasqlListener<'input> + 'a> for QueryTermDefaultContext<'input>{
	fn enter(&self,listener: &mut (dyn athenasqlListener<'input> + 'a)) {
		listener.enter_every_rule(self);
		listener.enter_queryTermDefault(self);
	}
}

impl<'input> CustomRuleContext<'input> for QueryTermDefaultContextExt<'input>{
	type TF = LocalTokenFactory<'input>;
	type Ctx = athenasqlParserContextType;
	fn get_rule_index(&self) -> usize { RULE_queryTerm }
	//fn type_rule_index() -> usize where Self: Sized { RULE_queryTerm }
}

impl<'input> Borrow<QueryTermContextExt<'input>> for QueryTermDefaultContext<'input>{
	fn borrow(&self) -> &QueryTermContextExt<'input> { &self.base }
}
impl<'input> BorrowMut<QueryTermContextExt<'input>> for QueryTermDefaultContext<'input>{
	fn borrow_mut(&mut self) -> &mut QueryTermContextExt<'input> { &mut self.base }
}

impl<'input> QueryTermContextAttrs<'input> for QueryTermDefaultContext<'input> {}

impl<'input> QueryTermDefaultContextExt<'input>{
	fn new(ctx: &dyn QueryTermContextAttrs<'input>) -> Rc<QueryTermContextAll<'input>>  {
		Rc::new(
			QueryTermContextAll::QueryTermDefaultContext(
				BaseParserRuleContext::copy_from(ctx,QueryTermDefaultContextExt{
        			base: ctx.borrow().clone(),
        			ph:PhantomData
				})
			)
		)
	}
}

pub type SetOperationContext<'input> = BaseParserRuleContext<'input,SetOperationContextExt<'input>>;

pub trait SetOperationContextAttrs<'input>: athenasqlParserContext<'input>{
	fn queryTerm_all(&self) ->  Vec<Rc<QueryTermContextAll<'input>>> where Self:Sized{
		self.children_of_type()
	}
	fn queryTerm(&self, i: usize) -> Option<Rc<QueryTermContextAll<'input>>> where Self:Sized{
		self.child_of_type(i)
	}
	/// Retrieves first TerminalNode corresponding to token INTERSECT
	/// Returns `None` if there is no child corresponding to token INTERSECT
	fn INTERSECT(&self) -> Option<Rc<TerminalNode<'input,athenasqlParserContextType>>> where Self:Sized{
		self.get_token(INTERSECT, 0)
	}
	fn setQuantifier(&self) -> Option<Rc<SetQuantifierContextAll<'input>>> where Self:Sized{
		self.child_of_type(0)
	}
	/// Retrieves first TerminalNode corresponding to token UNION
	/// Returns `None` if there is no child corresponding to token UNION
	fn UNION(&self) -> Option<Rc<TerminalNode<'input,athenasqlParserContextType>>> where Self:Sized{
		self.get_token(UNION, 0)
	}
	/// Retrieves first TerminalNode corresponding to token EXCEPT
	/// Returns `None` if there is no child corresponding to token EXCEPT
	fn EXCEPT(&self) -> Option<Rc<TerminalNode<'input,athenasqlParserContextType>>> where Self:Sized{
		self.get_token(EXCEPT, 0)
	}
}

impl<'input> SetOperationContextAttrs<'input> for SetOperationContext<'input>{}

pub struct SetOperationContextExt<'input>{
	base:QueryTermContextExt<'input>,
	pub left: Option<Rc<QueryTermContextAll<'input>>>,
	pub operator: Option<TokenType<'input>>,
	pub right: Option<Rc<QueryTermContextAll<'input>>>,
	ph:PhantomData<&'input str>
}

antlr_rust::tid!{SetOperationContextExt<'a>}

impl<'input> athenasqlParserContext<'input> for SetOperationContext<'input>{}

impl<'input,'a> Listenable<dyn athenasqlListener<'input> + 'a> for SetOperationContext<'input>{
	fn enter(&self,listener: &mut (dyn athenasqlListener<'input> + 'a)) {
		listener.enter_every_rule(self);
		listener.enter_setOperation(self);
	}
}

impl<'input> CustomRuleContext<'input> for SetOperationContextExt<'input>{
	type TF = LocalTokenFactory<'input>;
	type Ctx = athenasqlParserContextType;
	fn get_rule_index(&self) -> usize { RULE_queryTerm }
	//fn type_rule_index() -> usize where Self: Sized { RULE_queryTerm }
}

impl<'input> Borrow<QueryTermContextExt<'input>> for SetOperationContext<'input>{
	fn borrow(&self) -> &QueryTermContextExt<'input> { &self.base }
}
impl<'input> BorrowMut<QueryTermContextExt<'input>> for SetOperationContext<'input>{
	fn borrow_mut(&mut self) -> &mut QueryTermContextExt<'input> { &mut self.base }
}

impl<'input> QueryTermContextAttrs<'input> for SetOperationContext<'input> {}

impl<'input> SetOperationContextExt<'input>{
	fn new(ctx: &dyn QueryTermContextAttrs<'input>) -> Rc<QueryTermContextAll<'input>>  {
		Rc::new(
			QueryTermContextAll::SetOperationContext(
				BaseParserRuleContext::copy_from(ctx,SetOperationContextExt{
					operator:None, 
        			left:None, right:None, 
        			base: ctx.borrow().clone(),
        			ph:PhantomData
				})
			)
		)
	}
}

impl<'input, I, H> athenasqlParser<'input, I, H>
where
    I: TokenStream<'input, TF = LocalTokenFactory<'input> > + TidAble<'input>,
    H: ErrorStrategy<'input,BaseParserType<'input,I>>
{
	pub fn  queryTerm(&mut self,)
	-> Result<Rc<QueryTermContextAll<'input>>,ANTLRError> {
		self.queryTerm_rec(0)
	}

	fn queryTerm_rec(&mut self, _p: isize)
	-> Result<Rc<QueryTermContextAll<'input>>,ANTLRError> {
		let recog = self;
		let _parentctx = recog.ctx.take();
		let _parentState = recog.base.get_state();
		let mut _localctx = QueryTermContextExt::new(_parentctx.clone(), recog.base.get_state());
		recog.base.enter_recursion_rule(_localctx.clone(), 24, RULE_queryTerm, _p);
	    let mut _localctx: Rc<QueryTermContextAll> = _localctx;
        let mut _prevctx = _localctx.clone();
		let _startState = 24;
		let mut _la: isize = -1;
		let result: Result<(), ANTLRError> = (|| {
			let mut _alt: isize;
			//recog.base.enter_outer_alt(_localctx.clone(), 1);
			recog.base.enter_outer_alt(None, 1);
			{
			{
			let mut tmp = QueryTermDefaultContextExt::new(&**_localctx);
			recog.ctx = Some(tmp.clone());
			_localctx = tmp;
			_prevctx = _localctx.clone();


			/*InvokeRule queryPrimary*/
			recog.base.set_state(556);
			recog.queryPrimary()?;

			}

			let tmp = recog.input.lt(-1).cloned();
			recog.ctx.as_ref().unwrap().set_stop(tmp);
			recog.base.set_state(572);
			recog.err_handler.sync(&mut recog.base)?;
			_alt = recog.interpreter.adaptive_predict(58,&mut recog.base)?;
			while { _alt!=2 && _alt!=INVALID_ALT } {
				if _alt==1 {
					recog.trigger_exit_rule_event();
					_prevctx = _localctx.clone();
					{
					recog.base.set_state(570);
					recog.err_handler.sync(&mut recog.base)?;
					match  recog.interpreter.adaptive_predict(57,&mut recog.base)? {
						1 =>{
							{
							/*recRuleLabeledAltStartAction*/
							let mut tmp = SetOperationContextExt::new(&**QueryTermContextExt::new(_parentctx.clone(), _parentState));
							if let QueryTermContextAll::SetOperationContext(ctx) = cast_mut::<_,QueryTermContextAll >(&mut tmp){
								ctx.left = Some(_prevctx.clone());
							} else {unreachable!("cant cast");}
							recog.push_new_recursion_context(tmp.clone(), _startState, RULE_queryTerm);
							_localctx = tmp;
							recog.base.set_state(558);
							if !({recog.precpred(None, 2)}) {
								Err(FailedPredicateError::new(&mut recog.base, Some("recog.precpred(None, 2)".to_owned()), None))?;
							}
							recog.base.set_state(559);
							let tmp = recog.base.match_token(INTERSECT,&mut recog.err_handler)?;
							if let QueryTermContextAll::SetOperationContext(ctx) = cast_mut::<_,QueryTermContextAll >(&mut _localctx){
							ctx.operator = Some(tmp.clone()); } else {unreachable!("cant cast");}  

							recog.base.set_state(561);
							recog.err_handler.sync(&mut recog.base)?;
							_la = recog.base.input.la(1);
							if _la==ALL || _la==DISTINCT {
								{
								/*InvokeRule setQuantifier*/
								recog.base.set_state(560);
								recog.setQuantifier()?;

								}
							}

							/*InvokeRule queryTerm*/
							recog.base.set_state(563);
							let tmp = recog.queryTerm_rec(3)?;
							if let QueryTermContextAll::SetOperationContext(ctx) = cast_mut::<_,QueryTermContextAll >(&mut _localctx){
							ctx.right = Some(tmp.clone()); } else {unreachable!("cant cast");}  

							}
						}
					,
						2 =>{
							{
							/*recRuleLabeledAltStartAction*/
							let mut tmp = SetOperationContextExt::new(&**QueryTermContextExt::new(_parentctx.clone(), _parentState));
							if let QueryTermContextAll::SetOperationContext(ctx) = cast_mut::<_,QueryTermContextAll >(&mut tmp){
								ctx.left = Some(_prevctx.clone());
							} else {unreachable!("cant cast");}
							recog.push_new_recursion_context(tmp.clone(), _startState, RULE_queryTerm);
							_localctx = tmp;
							recog.base.set_state(564);
							if !({recog.precpred(None, 1)}) {
								Err(FailedPredicateError::new(&mut recog.base, Some("recog.precpred(None, 1)".to_owned()), None))?;
							}
							recog.base.set_state(565);
							if let QueryTermContextAll::SetOperationContext(ctx) = cast_mut::<_,QueryTermContextAll >(&mut _localctx){
							ctx.operator = recog.base.input.lt(1).cloned(); } else {unreachable!("cant cast");} 
							_la = recog.base.input.la(1);
							if { !(_la==UNION || _la==EXCEPT) } {
								let tmp = recog.err_handler.recover_inline(&mut recog.base)?;
								if let QueryTermContextAll::SetOperationContext(ctx) = cast_mut::<_,QueryTermContextAll >(&mut _localctx){
								ctx.operator = Some(tmp.clone()); } else {unreachable!("cant cast");}  

							}
							else {
								if  recog.base.input.la(1)==TOKEN_EOF { recog.base.matched_eof = true };
								recog.err_handler.report_match(&mut recog.base);
								recog.base.consume(&mut recog.err_handler);
							}
							recog.base.set_state(567);
							recog.err_handler.sync(&mut recog.base)?;
							_la = recog.base.input.la(1);
							if _la==ALL || _la==DISTINCT {
								{
								/*InvokeRule setQuantifier*/
								recog.base.set_state(566);
								recog.setQuantifier()?;

								}
							}

							/*InvokeRule queryTerm*/
							recog.base.set_state(569);
							let tmp = recog.queryTerm_rec(2)?;
							if let QueryTermContextAll::SetOperationContext(ctx) = cast_mut::<_,QueryTermContextAll >(&mut _localctx){
							ctx.right = Some(tmp.clone()); } else {unreachable!("cant cast");}  

							}
						}

						_ => {}
					}
					} 
				}
				recog.base.set_state(574);
				recog.err_handler.sync(&mut recog.base)?;
				_alt = recog.interpreter.adaptive_predict(58,&mut recog.base)?;
			}
			}
			Ok(())
		})();
		match result {
		Ok(_) => {},
        Err(e @ ANTLRError::FallThrough(_)) => return Err(e),
		Err(ref re)=>{
			//_localctx.exception = re;
			recog.err_handler.report_error(&mut recog.base, re);
	        recog.err_handler.recover(&mut recog.base, re)?;}
		}
		recog.base.unroll_recursion_context(_parentctx);

		Ok(_localctx)
	}
}
//------------------- queryPrimary ----------------
#[derive(Debug)]
pub enum QueryPrimaryContextAll<'input>{
	SubqueryContext(SubqueryContext<'input>),
	QueryPrimaryDefaultContext(QueryPrimaryDefaultContext<'input>),
	TableContext(TableContext<'input>),
	InlineTableContext(InlineTableContext<'input>),
Error(QueryPrimaryContext<'input>)
}
antlr_rust::tid!{QueryPrimaryContextAll<'a>}

impl<'input> antlr_rust::parser_rule_context::DerefSeal for QueryPrimaryContextAll<'input>{}

impl<'input> athenasqlParserContext<'input> for QueryPrimaryContextAll<'input>{}

impl<'input> Deref for QueryPrimaryContextAll<'input>{
	type Target = dyn QueryPrimaryContextAttrs<'input> + 'input;
	fn deref(&self) -> &Self::Target{
		use QueryPrimaryContextAll::*;
		match self{
			SubqueryContext(inner) => inner,
			QueryPrimaryDefaultContext(inner) => inner,
			TableContext(inner) => inner,
			InlineTableContext(inner) => inner,
Error(inner) => inner
		}
	}
}
impl<'input,'a> Listenable<dyn athenasqlListener<'input> + 'a> for QueryPrimaryContextAll<'input>{
    fn enter(&self, listener: &mut (dyn athenasqlListener<'input> + 'a)) { self.deref().enter(listener) }
    fn exit(&self, listener: &mut (dyn athenasqlListener<'input> + 'a)) { self.deref().exit(listener) }
}



pub type QueryPrimaryContext<'input> = BaseParserRuleContext<'input,QueryPrimaryContextExt<'input>>;

#[derive(Clone)]
pub struct QueryPrimaryContextExt<'input>{
ph:PhantomData<&'input str>
}

impl<'input> athenasqlParserContext<'input> for QueryPrimaryContext<'input>{}

impl<'input,'a> Listenable<dyn athenasqlListener<'input> + 'a> for QueryPrimaryContext<'input>{
}

impl<'input> CustomRuleContext<'input> for QueryPrimaryContextExt<'input>{
	type TF = LocalTokenFactory<'input>;
	type Ctx = athenasqlParserContextType;
	fn get_rule_index(&self) -> usize { RULE_queryPrimary }
	//fn type_rule_index() -> usize where Self: Sized { RULE_queryPrimary }
}
antlr_rust::tid!{QueryPrimaryContextExt<'a>}

impl<'input> QueryPrimaryContextExt<'input>{
	fn new(parent: Option<Rc<dyn athenasqlParserContext<'input> + 'input > >, invoking_state: isize) -> Rc<QueryPrimaryContextAll<'input>> {
		Rc::new(
		QueryPrimaryContextAll::Error(
			BaseParserRuleContext::new_parser_ctx(parent, invoking_state,QueryPrimaryContextExt{
				ph:PhantomData
			}),
		)
		)
	}
}

pub trait QueryPrimaryContextAttrs<'input>: athenasqlParserContext<'input> + BorrowMut<QueryPrimaryContextExt<'input>>{


}

impl<'input> QueryPrimaryContextAttrs<'input> for QueryPrimaryContext<'input>{}

pub type SubqueryContext<'input> = BaseParserRuleContext<'input,SubqueryContextExt<'input>>;

pub trait SubqueryContextAttrs<'input>: athenasqlParserContext<'input>{
	fn queryNoWith(&self) -> Option<Rc<QueryNoWithContextAll<'input>>> where Self:Sized{
		self.child_of_type(0)
	}
}

impl<'input> SubqueryContextAttrs<'input> for SubqueryContext<'input>{}

pub struct SubqueryContextExt<'input>{
	base:QueryPrimaryContextExt<'input>,
	ph:PhantomData<&'input str>
}

antlr_rust::tid!{SubqueryContextExt<'a>}

impl<'input> athenasqlParserContext<'input> for SubqueryContext<'input>{}

impl<'input,'a> Listenable<dyn athenasqlListener<'input> + 'a> for SubqueryContext<'input>{
	fn enter(&self,listener: &mut (dyn athenasqlListener<'input> + 'a)) {
		listener.enter_every_rule(self);
		listener.enter_subquery(self);
	}
}

impl<'input> CustomRuleContext<'input> for SubqueryContextExt<'input>{
	type TF = LocalTokenFactory<'input>;
	type Ctx = athenasqlParserContextType;
	fn get_rule_index(&self) -> usize { RULE_queryPrimary }
	//fn type_rule_index() -> usize where Self: Sized { RULE_queryPrimary }
}

impl<'input> Borrow<QueryPrimaryContextExt<'input>> for SubqueryContext<'input>{
	fn borrow(&self) -> &QueryPrimaryContextExt<'input> { &self.base }
}
impl<'input> BorrowMut<QueryPrimaryContextExt<'input>> for SubqueryContext<'input>{
	fn borrow_mut(&mut self) -> &mut QueryPrimaryContextExt<'input> { &mut self.base }
}

impl<'input> QueryPrimaryContextAttrs<'input> for SubqueryContext<'input> {}

impl<'input> SubqueryContextExt<'input>{
	fn new(ctx: &dyn QueryPrimaryContextAttrs<'input>) -> Rc<QueryPrimaryContextAll<'input>>  {
		Rc::new(
			QueryPrimaryContextAll::SubqueryContext(
				BaseParserRuleContext::copy_from(ctx,SubqueryContextExt{
        			base: ctx.borrow().clone(),
        			ph:PhantomData
				})
			)
		)
	}
}

pub type QueryPrimaryDefaultContext<'input> = BaseParserRuleContext<'input,QueryPrimaryDefaultContextExt<'input>>;

pub trait QueryPrimaryDefaultContextAttrs<'input>: athenasqlParserContext<'input>{
	fn querySpecification(&self) -> Option<Rc<QuerySpecificationContextAll<'input>>> where Self:Sized{
		self.child_of_type(0)
	}
}

impl<'input> QueryPrimaryDefaultContextAttrs<'input> for QueryPrimaryDefaultContext<'input>{}

pub struct QueryPrimaryDefaultContextExt<'input>{
	base:QueryPrimaryContextExt<'input>,
	ph:PhantomData<&'input str>
}

antlr_rust::tid!{QueryPrimaryDefaultContextExt<'a>}

impl<'input> athenasqlParserContext<'input> for QueryPrimaryDefaultContext<'input>{}

impl<'input,'a> Listenable<dyn athenasqlListener<'input> + 'a> for QueryPrimaryDefaultContext<'input>{
	fn enter(&self,listener: &mut (dyn athenasqlListener<'input> + 'a)) {
		listener.enter_every_rule(self);
		listener.enter_queryPrimaryDefault(self);
	}
}

impl<'input> CustomRuleContext<'input> for QueryPrimaryDefaultContextExt<'input>{
	type TF = LocalTokenFactory<'input>;
	type Ctx = athenasqlParserContextType;
	fn get_rule_index(&self) -> usize { RULE_queryPrimary }
	//fn type_rule_index() -> usize where Self: Sized { RULE_queryPrimary }
}

impl<'input> Borrow<QueryPrimaryContextExt<'input>> for QueryPrimaryDefaultContext<'input>{
	fn borrow(&self) -> &QueryPrimaryContextExt<'input> { &self.base }
}
impl<'input> BorrowMut<QueryPrimaryContextExt<'input>> for QueryPrimaryDefaultContext<'input>{
	fn borrow_mut(&mut self) -> &mut QueryPrimaryContextExt<'input> { &mut self.base }
}

impl<'input> QueryPrimaryContextAttrs<'input> for QueryPrimaryDefaultContext<'input> {}

impl<'input> QueryPrimaryDefaultContextExt<'input>{
	fn new(ctx: &dyn QueryPrimaryContextAttrs<'input>) -> Rc<QueryPrimaryContextAll<'input>>  {
		Rc::new(
			QueryPrimaryContextAll::QueryPrimaryDefaultContext(
				BaseParserRuleContext::copy_from(ctx,QueryPrimaryDefaultContextExt{
        			base: ctx.borrow().clone(),
        			ph:PhantomData
				})
			)
		)
	}
}

pub type TableContext<'input> = BaseParserRuleContext<'input,TableContextExt<'input>>;

pub trait TableContextAttrs<'input>: athenasqlParserContext<'input>{
	/// Retrieves first TerminalNode corresponding to token TABLE
	/// Returns `None` if there is no child corresponding to token TABLE
	fn TABLE(&self) -> Option<Rc<TerminalNode<'input,athenasqlParserContextType>>> where Self:Sized{
		self.get_token(TABLE, 0)
	}
	fn qualifiedName(&self) -> Option<Rc<QualifiedNameContextAll<'input>>> where Self:Sized{
		self.child_of_type(0)
	}
}

impl<'input> TableContextAttrs<'input> for TableContext<'input>{}

pub struct TableContextExt<'input>{
	base:QueryPrimaryContextExt<'input>,
	ph:PhantomData<&'input str>
}

antlr_rust::tid!{TableContextExt<'a>}

impl<'input> athenasqlParserContext<'input> for TableContext<'input>{}

impl<'input,'a> Listenable<dyn athenasqlListener<'input> + 'a> for TableContext<'input>{
	fn enter(&self,listener: &mut (dyn athenasqlListener<'input> + 'a)) {
		listener.enter_every_rule(self);
		listener.enter_table(self);
	}
}

impl<'input> CustomRuleContext<'input> for TableContextExt<'input>{
	type TF = LocalTokenFactory<'input>;
	type Ctx = athenasqlParserContextType;
	fn get_rule_index(&self) -> usize { RULE_queryPrimary }
	//fn type_rule_index() -> usize where Self: Sized { RULE_queryPrimary }
}

impl<'input> Borrow<QueryPrimaryContextExt<'input>> for TableContext<'input>{
	fn borrow(&self) -> &QueryPrimaryContextExt<'input> { &self.base }
}
impl<'input> BorrowMut<QueryPrimaryContextExt<'input>> for TableContext<'input>{
	fn borrow_mut(&mut self) -> &mut QueryPrimaryContextExt<'input> { &mut self.base }
}

impl<'input> QueryPrimaryContextAttrs<'input> for TableContext<'input> {}

impl<'input> TableContextExt<'input>{
	fn new(ctx: &dyn QueryPrimaryContextAttrs<'input>) -> Rc<QueryPrimaryContextAll<'input>>  {
		Rc::new(
			QueryPrimaryContextAll::TableContext(
				BaseParserRuleContext::copy_from(ctx,TableContextExt{
        			base: ctx.borrow().clone(),
        			ph:PhantomData
				})
			)
		)
	}
}

pub type InlineTableContext<'input> = BaseParserRuleContext<'input,InlineTableContextExt<'input>>;

pub trait InlineTableContextAttrs<'input>: athenasqlParserContext<'input>{
	/// Retrieves first TerminalNode corresponding to token VALUES
	/// Returns `None` if there is no child corresponding to token VALUES
	fn VALUES(&self) -> Option<Rc<TerminalNode<'input,athenasqlParserContextType>>> where Self:Sized{
		self.get_token(VALUES, 0)
	}
	fn expression_all(&self) ->  Vec<Rc<ExpressionContextAll<'input>>> where Self:Sized{
		self.children_of_type()
	}
	fn expression(&self, i: usize) -> Option<Rc<ExpressionContextAll<'input>>> where Self:Sized{
		self.child_of_type(i)
	}
}

impl<'input> InlineTableContextAttrs<'input> for InlineTableContext<'input>{}

pub struct InlineTableContextExt<'input>{
	base:QueryPrimaryContextExt<'input>,
	ph:PhantomData<&'input str>
}

antlr_rust::tid!{InlineTableContextExt<'a>}

impl<'input> athenasqlParserContext<'input> for InlineTableContext<'input>{}

impl<'input,'a> Listenable<dyn athenasqlListener<'input> + 'a> for InlineTableContext<'input>{
	fn enter(&self,listener: &mut (dyn athenasqlListener<'input> + 'a)) {
		listener.enter_every_rule(self);
		listener.enter_inlineTable(self);
	}
}

impl<'input> CustomRuleContext<'input> for InlineTableContextExt<'input>{
	type TF = LocalTokenFactory<'input>;
	type Ctx = athenasqlParserContextType;
	fn get_rule_index(&self) -> usize { RULE_queryPrimary }
	//fn type_rule_index() -> usize where Self: Sized { RULE_queryPrimary }
}

impl<'input> Borrow<QueryPrimaryContextExt<'input>> for InlineTableContext<'input>{
	fn borrow(&self) -> &QueryPrimaryContextExt<'input> { &self.base }
}
impl<'input> BorrowMut<QueryPrimaryContextExt<'input>> for InlineTableContext<'input>{
	fn borrow_mut(&mut self) -> &mut QueryPrimaryContextExt<'input> { &mut self.base }
}

impl<'input> QueryPrimaryContextAttrs<'input> for InlineTableContext<'input> {}

impl<'input> InlineTableContextExt<'input>{
	fn new(ctx: &dyn QueryPrimaryContextAttrs<'input>) -> Rc<QueryPrimaryContextAll<'input>>  {
		Rc::new(
			QueryPrimaryContextAll::InlineTableContext(
				BaseParserRuleContext::copy_from(ctx,InlineTableContextExt{
        			base: ctx.borrow().clone(),
        			ph:PhantomData
				})
			)
		)
	}
}

impl<'input, I, H> athenasqlParser<'input, I, H>
where
    I: TokenStream<'input, TF = LocalTokenFactory<'input> > + TidAble<'input>,
    H: ErrorStrategy<'input,BaseParserType<'input,I>>
{
	pub fn queryPrimary(&mut self,)
	-> Result<Rc<QueryPrimaryContextAll<'input>>,ANTLRError> {
		let mut recog = self;
		let _parentctx = recog.ctx.take();
		let mut _localctx = QueryPrimaryContextExt::new(_parentctx.clone(), recog.base.get_state());
        recog.base.enter_rule(_localctx.clone(), 26, RULE_queryPrimary);
        let mut _localctx: Rc<QueryPrimaryContextAll> = _localctx;
		let result: Result<(), ANTLRError> = (|| {

			let mut _alt: isize;
			recog.base.set_state(591);
			recog.err_handler.sync(&mut recog.base)?;
			match recog.base.input.la(1) {
			 SELECT 
				=> {
					let tmp = QueryPrimaryDefaultContextExt::new(&**_localctx);
					recog.base.enter_outer_alt(Some(tmp.clone()), 1);
					_localctx = tmp;
					{
					/*InvokeRule querySpecification*/
					recog.base.set_state(575);
					recog.querySpecification()?;

					}
				}

			 TABLE 
				=> {
					let tmp = TableContextExt::new(&**_localctx);
					recog.base.enter_outer_alt(Some(tmp.clone()), 2);
					_localctx = tmp;
					{
					recog.base.set_state(576);
					recog.base.match_token(TABLE,&mut recog.err_handler)?;

					/*InvokeRule qualifiedName*/
					recog.base.set_state(577);
					recog.qualifiedName()?;

					}
				}

			 VALUES 
				=> {
					let tmp = InlineTableContextExt::new(&**_localctx);
					recog.base.enter_outer_alt(Some(tmp.clone()), 3);
					_localctx = tmp;
					{
					recog.base.set_state(578);
					recog.base.match_token(VALUES,&mut recog.err_handler)?;

					/*InvokeRule expression*/
					recog.base.set_state(579);
					recog.expression()?;

					recog.base.set_state(584);
					recog.err_handler.sync(&mut recog.base)?;
					_alt = recog.interpreter.adaptive_predict(59,&mut recog.base)?;
					while { _alt!=2 && _alt!=INVALID_ALT } {
						if _alt==1 {
							{
							{
							recog.base.set_state(580);
							recog.base.match_token(T__2,&mut recog.err_handler)?;

							/*InvokeRule expression*/
							recog.base.set_state(581);
							recog.expression()?;

							}
							} 
						}
						recog.base.set_state(586);
						recog.err_handler.sync(&mut recog.base)?;
						_alt = recog.interpreter.adaptive_predict(59,&mut recog.base)?;
					}
					}
				}

			 T__1 
				=> {
					let tmp = SubqueryContextExt::new(&**_localctx);
					recog.base.enter_outer_alt(Some(tmp.clone()), 4);
					_localctx = tmp;
					{
					recog.base.set_state(587);
					recog.base.match_token(T__1,&mut recog.err_handler)?;

					/*InvokeRule queryNoWith*/
					recog.base.set_state(588);
					recog.queryNoWith()?;

					recog.base.set_state(589);
					recog.base.match_token(T__3,&mut recog.err_handler)?;

					}
				}

				_ => Err(ANTLRError::NoAltError(NoViableAltError::new(&mut recog.base)))?
			}
			Ok(())
		})();
		match result {
		Ok(_)=>{},
        Err(e @ ANTLRError::FallThrough(_)) => return Err(e),
		Err(ref re) => {
				//_localctx.exception = re;
				recog.err_handler.report_error(&mut recog.base, re);
				recog.err_handler.recover(&mut recog.base, re)?;
			}
		}
		recog.base.exit_rule();

		Ok(_localctx)
	}
}
//------------------- sortItem ----------------
pub type SortItemContextAll<'input> = SortItemContext<'input>;


pub type SortItemContext<'input> = BaseParserRuleContext<'input,SortItemContextExt<'input>>;

#[derive(Clone)]
pub struct SortItemContextExt<'input>{
	pub ordering: Option<TokenType<'input>>,
	pub nullOrdering: Option<TokenType<'input>>,
ph:PhantomData<&'input str>
}

impl<'input> athenasqlParserContext<'input> for SortItemContext<'input>{}

impl<'input,'a> Listenable<dyn athenasqlListener<'input> + 'a> for SortItemContext<'input>{
		fn enter(&self,listener: &mut (dyn athenasqlListener<'input> + 'a)) {
			listener.enter_every_rule(self);
			listener.enter_sortItem(self);
		}fn exit(&self,listener: &mut (dyn athenasqlListener<'input> + 'a)) {
			listener.exit_sortItem(self);
			listener.exit_every_rule(self);
		}
}

impl<'input> CustomRuleContext<'input> for SortItemContextExt<'input>{
	type TF = LocalTokenFactory<'input>;
	type Ctx = athenasqlParserContextType;
	fn get_rule_index(&self) -> usize { RULE_sortItem }
	//fn type_rule_index() -> usize where Self: Sized { RULE_sortItem }
}
antlr_rust::tid!{SortItemContextExt<'a>}

impl<'input> SortItemContextExt<'input>{
	fn new(parent: Option<Rc<dyn athenasqlParserContext<'input> + 'input > >, invoking_state: isize) -> Rc<SortItemContextAll<'input>> {
		Rc::new(
			BaseParserRuleContext::new_parser_ctx(parent, invoking_state,SortItemContextExt{
				ordering: None, nullOrdering: None, 
				ph:PhantomData
			}),
		)
	}
}

pub trait SortItemContextAttrs<'input>: athenasqlParserContext<'input> + BorrowMut<SortItemContextExt<'input>>{

fn expression(&self) -> Option<Rc<ExpressionContextAll<'input>>> where Self:Sized{
	self.child_of_type(0)
}
/// Retrieves first TerminalNode corresponding to token NULLS
/// Returns `None` if there is no child corresponding to token NULLS
fn NULLS(&self) -> Option<Rc<TerminalNode<'input,athenasqlParserContextType>>> where Self:Sized{
	self.get_token(NULLS, 0)
}
/// Retrieves first TerminalNode corresponding to token ASC
/// Returns `None` if there is no child corresponding to token ASC
fn ASC(&self) -> Option<Rc<TerminalNode<'input,athenasqlParserContextType>>> where Self:Sized{
	self.get_token(ASC, 0)
}
/// Retrieves first TerminalNode corresponding to token DESC
/// Returns `None` if there is no child corresponding to token DESC
fn DESC(&self) -> Option<Rc<TerminalNode<'input,athenasqlParserContextType>>> where Self:Sized{
	self.get_token(DESC, 0)
}
/// Retrieves first TerminalNode corresponding to token FIRST
/// Returns `None` if there is no child corresponding to token FIRST
fn FIRST(&self) -> Option<Rc<TerminalNode<'input,athenasqlParserContextType>>> where Self:Sized{
	self.get_token(FIRST, 0)
}
/// Retrieves first TerminalNode corresponding to token LAST
/// Returns `None` if there is no child corresponding to token LAST
fn LAST(&self) -> Option<Rc<TerminalNode<'input,athenasqlParserContextType>>> where Self:Sized{
	self.get_token(LAST, 0)
}

}

impl<'input> SortItemContextAttrs<'input> for SortItemContext<'input>{}

impl<'input, I, H> athenasqlParser<'input, I, H>
where
    I: TokenStream<'input, TF = LocalTokenFactory<'input> > + TidAble<'input>,
    H: ErrorStrategy<'input,BaseParserType<'input,I>>
{
	pub fn sortItem(&mut self,)
	-> Result<Rc<SortItemContextAll<'input>>,ANTLRError> {
		let mut recog = self;
		let _parentctx = recog.ctx.take();
		let mut _localctx = SortItemContextExt::new(_parentctx.clone(), recog.base.get_state());
        recog.base.enter_rule(_localctx.clone(), 28, RULE_sortItem);
        let mut _localctx: Rc<SortItemContextAll> = _localctx;
		let mut _la: isize = -1;
		let result: Result<(), ANTLRError> = (|| {

			//recog.base.enter_outer_alt(_localctx.clone(), 1);
			recog.base.enter_outer_alt(None, 1);
			{
			/*InvokeRule expression*/
			recog.base.set_state(593);
			recog.expression()?;

			recog.base.set_state(595);
			recog.err_handler.sync(&mut recog.base)?;
			_la = recog.base.input.la(1);
			if _la==ASC || _la==DESC {
				{
				recog.base.set_state(594);
				 cast_mut::<_,SortItemContext >(&mut _localctx).ordering = recog.base.input.lt(1).cloned();
				 
				_la = recog.base.input.la(1);
				if { !(_la==ASC || _la==DESC) } {
					let tmp = recog.err_handler.recover_inline(&mut recog.base)?;
					 cast_mut::<_,SortItemContext >(&mut _localctx).ordering = Some(tmp.clone());
					  

				}
				else {
					if  recog.base.input.la(1)==TOKEN_EOF { recog.base.matched_eof = true };
					recog.err_handler.report_match(&mut recog.base);
					recog.base.consume(&mut recog.err_handler);
				}
				}
			}

			recog.base.set_state(599);
			recog.err_handler.sync(&mut recog.base)?;
			_la = recog.base.input.la(1);
			if _la==NULLS {
				{
				recog.base.set_state(597);
				recog.base.match_token(NULLS,&mut recog.err_handler)?;

				recog.base.set_state(598);
				 cast_mut::<_,SortItemContext >(&mut _localctx).nullOrdering = recog.base.input.lt(1).cloned();
				 
				_la = recog.base.input.la(1);
				if { !(_la==FIRST || _la==LAST) } {
					let tmp = recog.err_handler.recover_inline(&mut recog.base)?;
					 cast_mut::<_,SortItemContext >(&mut _localctx).nullOrdering = Some(tmp.clone());
					  

				}
				else {
					if  recog.base.input.la(1)==TOKEN_EOF { recog.base.matched_eof = true };
					recog.err_handler.report_match(&mut recog.base);
					recog.base.consume(&mut recog.err_handler);
				}
				}
			}

			}
			Ok(())
		})();
		match result {
		Ok(_)=>{},
        Err(e @ ANTLRError::FallThrough(_)) => return Err(e),
		Err(ref re) => {
				//_localctx.exception = re;
				recog.err_handler.report_error(&mut recog.base, re);
				recog.err_handler.recover(&mut recog.base, re)?;
			}
		}
		recog.base.exit_rule();

		Ok(_localctx)
	}
}
//------------------- querySpecification ----------------
pub type QuerySpecificationContextAll<'input> = QuerySpecificationContext<'input>;


pub type QuerySpecificationContext<'input> = BaseParserRuleContext<'input,QuerySpecificationContextExt<'input>>;

#[derive(Clone)]
pub struct QuerySpecificationContextExt<'input>{
	pub where: Option<Rc<BooleanExpressionContextAll<'input>>>,
	pub having: Option<Rc<BooleanExpressionContextAll<'input>>>,
ph:PhantomData<&'input str>
}

impl<'input> athenasqlParserContext<'input> for QuerySpecificationContext<'input>{}

impl<'input,'a> Listenable<dyn athenasqlListener<'input> + 'a> for QuerySpecificationContext<'input>{
		fn enter(&self,listener: &mut (dyn athenasqlListener<'input> + 'a)) {
			listener.enter_every_rule(self);
			listener.enter_querySpecification(self);
		}fn exit(&self,listener: &mut (dyn athenasqlListener<'input> + 'a)) {
			listener.exit_querySpecification(self);
			listener.exit_every_rule(self);
		}
}

impl<'input> CustomRuleContext<'input> for QuerySpecificationContextExt<'input>{
	type TF = LocalTokenFactory<'input>;
	type Ctx = athenasqlParserContextType;
	fn get_rule_index(&self) -> usize { RULE_querySpecification }
	//fn type_rule_index() -> usize where Self: Sized { RULE_querySpecification }
}
antlr_rust::tid!{QuerySpecificationContextExt<'a>}

impl<'input> QuerySpecificationContextExt<'input>{
	fn new(parent: Option<Rc<dyn athenasqlParserContext<'input> + 'input > >, invoking_state: isize) -> Rc<QuerySpecificationContextAll<'input>> {
		Rc::new(
			BaseParserRuleContext::new_parser_ctx(parent, invoking_state,QuerySpecificationContextExt{
				where: None, having: None, 
				ph:PhantomData
			}),
		)
	}
}

pub trait QuerySpecificationContextAttrs<'input>: athenasqlParserContext<'input> + BorrowMut<QuerySpecificationContextExt<'input>>{

/// Retrieves first TerminalNode corresponding to token SELECT
/// Returns `None` if there is no child corresponding to token SELECT
fn SELECT(&self) -> Option<Rc<TerminalNode<'input,athenasqlParserContextType>>> where Self:Sized{
	self.get_token(SELECT, 0)
}
fn selectItem_all(&self) ->  Vec<Rc<SelectItemContextAll<'input>>> where Self:Sized{
	self.children_of_type()
}
fn selectItem(&self, i: usize) -> Option<Rc<SelectItemContextAll<'input>>> where Self:Sized{
	self.child_of_type(i)
}
fn setQuantifier(&self) -> Option<Rc<SetQuantifierContextAll<'input>>> where Self:Sized{
	self.child_of_type(0)
}
/// Retrieves first TerminalNode corresponding to token FROM
/// Returns `None` if there is no child corresponding to token FROM
fn FROM(&self) -> Option<Rc<TerminalNode<'input,athenasqlParserContextType>>> where Self:Sized{
	self.get_token(FROM, 0)
}
fn relation_all(&self) ->  Vec<Rc<RelationContextAll<'input>>> where Self:Sized{
	self.children_of_type()
}
fn relation(&self, i: usize) -> Option<Rc<RelationContextAll<'input>>> where Self:Sized{
	self.child_of_type(i)
}
/// Retrieves first TerminalNode corresponding to token WHERE
/// Returns `None` if there is no child corresponding to token WHERE
fn WHERE(&self) -> Option<Rc<TerminalNode<'input,athenasqlParserContextType>>> where Self:Sized{
	self.get_token(WHERE, 0)
}
/// Retrieves first TerminalNode corresponding to token GROUP
/// Returns `None` if there is no child corresponding to token GROUP
fn GROUP(&self) -> Option<Rc<TerminalNode<'input,athenasqlParserContextType>>> where Self:Sized{
	self.get_token(GROUP, 0)
}
/// Retrieves first TerminalNode corresponding to token BY
/// Returns `None` if there is no child corresponding to token BY
fn BY(&self) -> Option<Rc<TerminalNode<'input,athenasqlParserContextType>>> where Self:Sized{
	self.get_token(BY, 0)
}
fn groupBy(&self) -> Option<Rc<GroupByContextAll<'input>>> where Self:Sized{
	self.child_of_type(0)
}
/// Retrieves first TerminalNode corresponding to token HAVING
/// Returns `None` if there is no child corresponding to token HAVING
fn HAVING(&self) -> Option<Rc<TerminalNode<'input,athenasqlParserContextType>>> where Self:Sized{
	self.get_token(HAVING, 0)
}
fn booleanExpression_all(&self) ->  Vec<Rc<BooleanExpressionContextAll<'input>>> where Self:Sized{
	self.children_of_type()
}
fn booleanExpression(&self, i: usize) -> Option<Rc<BooleanExpressionContextAll<'input>>> where Self:Sized{
	self.child_of_type(i)
}

}

impl<'input> QuerySpecificationContextAttrs<'input> for QuerySpecificationContext<'input>{}

impl<'input, I, H> athenasqlParser<'input, I, H>
where
    I: TokenStream<'input, TF = LocalTokenFactory<'input> > + TidAble<'input>,
    H: ErrorStrategy<'input,BaseParserType<'input,I>>
{
	pub fn querySpecification(&mut self,)
	-> Result<Rc<QuerySpecificationContextAll<'input>>,ANTLRError> {
		let mut recog = self;
		let _parentctx = recog.ctx.take();
		let mut _localctx = QuerySpecificationContextExt::new(_parentctx.clone(), recog.base.get_state());
        recog.base.enter_rule(_localctx.clone(), 30, RULE_querySpecification);
        let mut _localctx: Rc<QuerySpecificationContextAll> = _localctx;
		let result: Result<(), ANTLRError> = (|| {

			let mut _alt: isize;
			//recog.base.enter_outer_alt(_localctx.clone(), 1);
			recog.base.enter_outer_alt(None, 1);
			{
			recog.base.set_state(601);
			recog.base.match_token(SELECT,&mut recog.err_handler)?;

			recog.base.set_state(603);
			recog.err_handler.sync(&mut recog.base)?;
			match  recog.interpreter.adaptive_predict(63,&mut recog.base)? {
				x if x == 1=>{
					{
					/*InvokeRule setQuantifier*/
					recog.base.set_state(602);
					recog.setQuantifier()?;

					}
				}

				_ => {}
			}
			/*InvokeRule selectItem*/
			recog.base.set_state(605);
			recog.selectItem()?;

			recog.base.set_state(610);
			recog.err_handler.sync(&mut recog.base)?;
			_alt = recog.interpreter.adaptive_predict(64,&mut recog.base)?;
			while { _alt!=2 && _alt!=INVALID_ALT } {
				if _alt==1 {
					{
					{
					recog.base.set_state(606);
					recog.base.match_token(T__2,&mut recog.err_handler)?;

					/*InvokeRule selectItem*/
					recog.base.set_state(607);
					recog.selectItem()?;

					}
					} 
				}
				recog.base.set_state(612);
				recog.err_handler.sync(&mut recog.base)?;
				_alt = recog.interpreter.adaptive_predict(64,&mut recog.base)?;
			}
			recog.base.set_state(622);
			recog.err_handler.sync(&mut recog.base)?;
			match  recog.interpreter.adaptive_predict(66,&mut recog.base)? {
				x if x == 1=>{
					{
					recog.base.set_state(613);
					recog.base.match_token(FROM,&mut recog.err_handler)?;

					/*InvokeRule relation*/
					recog.base.set_state(614);
					recog.relation_rec(0)?;

					recog.base.set_state(619);
					recog.err_handler.sync(&mut recog.base)?;
					_alt = recog.interpreter.adaptive_predict(65,&mut recog.base)?;
					while { _alt!=2 && _alt!=INVALID_ALT } {
						if _alt==1 {
							{
							{
							recog.base.set_state(615);
							recog.base.match_token(T__2,&mut recog.err_handler)?;

							/*InvokeRule relation*/
							recog.base.set_state(616);
							recog.relation_rec(0)?;

							}
							} 
						}
						recog.base.set_state(621);
						recog.err_handler.sync(&mut recog.base)?;
						_alt = recog.interpreter.adaptive_predict(65,&mut recog.base)?;
					}
					}
				}

				_ => {}
			}
			recog.base.set_state(626);
			recog.err_handler.sync(&mut recog.base)?;
			match  recog.interpreter.adaptive_predict(67,&mut recog.base)? {
				x if x == 1=>{
					{
					recog.base.set_state(624);
					recog.base.match_token(WHERE,&mut recog.err_handler)?;

					/*InvokeRule booleanExpression*/
					recog.base.set_state(625);
					let tmp = recog.booleanExpression_rec(0)?;
					 cast_mut::<_,QuerySpecificationContext >(&mut _localctx).where = Some(tmp.clone());
					  

					}
				}

				_ => {}
			}
			recog.base.set_state(631);
			recog.err_handler.sync(&mut recog.base)?;
			match  recog.interpreter.adaptive_predict(68,&mut recog.base)? {
				x if x == 1=>{
					{
					recog.base.set_state(628);
					recog.base.match_token(GROUP,&mut recog.err_handler)?;

					recog.base.set_state(629);
					recog.base.match_token(BY,&mut recog.err_handler)?;

					/*InvokeRule groupBy*/
					recog.base.set_state(630);
					recog.groupBy()?;

					}
				}

				_ => {}
			}
			recog.base.set_state(635);
			recog.err_handler.sync(&mut recog.base)?;
			match  recog.interpreter.adaptive_predict(69,&mut recog.base)? {
				x if x == 1=>{
					{
					recog.base.set_state(633);
					recog.base.match_token(HAVING,&mut recog.err_handler)?;

					/*InvokeRule booleanExpression*/
					recog.base.set_state(634);
					let tmp = recog.booleanExpression_rec(0)?;
					 cast_mut::<_,QuerySpecificationContext >(&mut _localctx).having = Some(tmp.clone());
					  

					}
				}

				_ => {}
			}
			}
			Ok(())
		})();
		match result {
		Ok(_)=>{},
        Err(e @ ANTLRError::FallThrough(_)) => return Err(e),
		Err(ref re) => {
				//_localctx.exception = re;
				recog.err_handler.report_error(&mut recog.base, re);
				recog.err_handler.recover(&mut recog.base, re)?;
			}
		}
		recog.base.exit_rule();

		Ok(_localctx)
	}
}
//------------------- groupBy ----------------
pub type GroupByContextAll<'input> = GroupByContext<'input>;


pub type GroupByContext<'input> = BaseParserRuleContext<'input,GroupByContextExt<'input>>;

#[derive(Clone)]
pub struct GroupByContextExt<'input>{
ph:PhantomData<&'input str>
}

impl<'input> athenasqlParserContext<'input> for GroupByContext<'input>{}

impl<'input,'a> Listenable<dyn athenasqlListener<'input> + 'a> for GroupByContext<'input>{
		fn enter(&self,listener: &mut (dyn athenasqlListener<'input> + 'a)) {
			listener.enter_every_rule(self);
			listener.enter_groupBy(self);
		}fn exit(&self,listener: &mut (dyn athenasqlListener<'input> + 'a)) {
			listener.exit_groupBy(self);
			listener.exit_every_rule(self);
		}
}

impl<'input> CustomRuleContext<'input> for GroupByContextExt<'input>{
	type TF = LocalTokenFactory<'input>;
	type Ctx = athenasqlParserContextType;
	fn get_rule_index(&self) -> usize { RULE_groupBy }
	//fn type_rule_index() -> usize where Self: Sized { RULE_groupBy }
}
antlr_rust::tid!{GroupByContextExt<'a>}

impl<'input> GroupByContextExt<'input>{
	fn new(parent: Option<Rc<dyn athenasqlParserContext<'input> + 'input > >, invoking_state: isize) -> Rc<GroupByContextAll<'input>> {
		Rc::new(
			BaseParserRuleContext::new_parser_ctx(parent, invoking_state,GroupByContextExt{
				ph:PhantomData
			}),
		)
	}
}

pub trait GroupByContextAttrs<'input>: athenasqlParserContext<'input> + BorrowMut<GroupByContextExt<'input>>{

fn groupingElement_all(&self) ->  Vec<Rc<GroupingElementContextAll<'input>>> where Self:Sized{
	self.children_of_type()
}
fn groupingElement(&self, i: usize) -> Option<Rc<GroupingElementContextAll<'input>>> where Self:Sized{
	self.child_of_type(i)
}
fn setQuantifier(&self) -> Option<Rc<SetQuantifierContextAll<'input>>> where Self:Sized{
	self.child_of_type(0)
}

}

impl<'input> GroupByContextAttrs<'input> for GroupByContext<'input>{}

impl<'input, I, H> athenasqlParser<'input, I, H>
where
    I: TokenStream<'input, TF = LocalTokenFactory<'input> > + TidAble<'input>,
    H: ErrorStrategy<'input,BaseParserType<'input,I>>
{
	pub fn groupBy(&mut self,)
	-> Result<Rc<GroupByContextAll<'input>>,ANTLRError> {
		let mut recog = self;
		let _parentctx = recog.ctx.take();
		let mut _localctx = GroupByContextExt::new(_parentctx.clone(), recog.base.get_state());
        recog.base.enter_rule(_localctx.clone(), 32, RULE_groupBy);
        let mut _localctx: Rc<GroupByContextAll> = _localctx;
		let result: Result<(), ANTLRError> = (|| {

			let mut _alt: isize;
			//recog.base.enter_outer_alt(_localctx.clone(), 1);
			recog.base.enter_outer_alt(None, 1);
			{
			recog.base.set_state(638);
			recog.err_handler.sync(&mut recog.base)?;
			match  recog.interpreter.adaptive_predict(70,&mut recog.base)? {
				x if x == 1=>{
					{
					/*InvokeRule setQuantifier*/
					recog.base.set_state(637);
					recog.setQuantifier()?;

					}
				}

				_ => {}
			}
			/*InvokeRule groupingElement*/
			recog.base.set_state(640);
			recog.groupingElement()?;

			recog.base.set_state(645);
			recog.err_handler.sync(&mut recog.base)?;
			_alt = recog.interpreter.adaptive_predict(71,&mut recog.base)?;
			while { _alt!=2 && _alt!=INVALID_ALT } {
				if _alt==1 {
					{
					{
					recog.base.set_state(641);
					recog.base.match_token(T__2,&mut recog.err_handler)?;

					/*InvokeRule groupingElement*/
					recog.base.set_state(642);
					recog.groupingElement()?;

					}
					} 
				}
				recog.base.set_state(647);
				recog.err_handler.sync(&mut recog.base)?;
				_alt = recog.interpreter.adaptive_predict(71,&mut recog.base)?;
			}
			}
			Ok(())
		})();
		match result {
		Ok(_)=>{},
        Err(e @ ANTLRError::FallThrough(_)) => return Err(e),
		Err(ref re) => {
				//_localctx.exception = re;
				recog.err_handler.report_error(&mut recog.base, re);
				recog.err_handler.recover(&mut recog.base, re)?;
			}
		}
		recog.base.exit_rule();

		Ok(_localctx)
	}
}
//------------------- groupingElement ----------------
#[derive(Debug)]
pub enum GroupingElementContextAll<'input>{
	MultipleGroupingSetsContext(MultipleGroupingSetsContext<'input>),
	SingleGroupingSetContext(SingleGroupingSetContext<'input>),
	CubeContext(CubeContext<'input>),
	RollupContext(RollupContext<'input>),
Error(GroupingElementContext<'input>)
}
antlr_rust::tid!{GroupingElementContextAll<'a>}

impl<'input> antlr_rust::parser_rule_context::DerefSeal for GroupingElementContextAll<'input>{}

impl<'input> athenasqlParserContext<'input> for GroupingElementContextAll<'input>{}

impl<'input> Deref for GroupingElementContextAll<'input>{
	type Target = dyn GroupingElementContextAttrs<'input> + 'input;
	fn deref(&self) -> &Self::Target{
		use GroupingElementContextAll::*;
		match self{
			MultipleGroupingSetsContext(inner) => inner,
			SingleGroupingSetContext(inner) => inner,
			CubeContext(inner) => inner,
			RollupContext(inner) => inner,
Error(inner) => inner
		}
	}
}
impl<'input,'a> Listenable<dyn athenasqlListener<'input> + 'a> for GroupingElementContextAll<'input>{
    fn enter(&self, listener: &mut (dyn athenasqlListener<'input> + 'a)) { self.deref().enter(listener) }
    fn exit(&self, listener: &mut (dyn athenasqlListener<'input> + 'a)) { self.deref().exit(listener) }
}



pub type GroupingElementContext<'input> = BaseParserRuleContext<'input,GroupingElementContextExt<'input>>;

#[derive(Clone)]
pub struct GroupingElementContextExt<'input>{
ph:PhantomData<&'input str>
}

impl<'input> athenasqlParserContext<'input> for GroupingElementContext<'input>{}

impl<'input,'a> Listenable<dyn athenasqlListener<'input> + 'a> for GroupingElementContext<'input>{
}

impl<'input> CustomRuleContext<'input> for GroupingElementContextExt<'input>{
	type TF = LocalTokenFactory<'input>;
	type Ctx = athenasqlParserContextType;
	fn get_rule_index(&self) -> usize { RULE_groupingElement }
	//fn type_rule_index() -> usize where Self: Sized { RULE_groupingElement }
}
antlr_rust::tid!{GroupingElementContextExt<'a>}

impl<'input> GroupingElementContextExt<'input>{
	fn new(parent: Option<Rc<dyn athenasqlParserContext<'input> + 'input > >, invoking_state: isize) -> Rc<GroupingElementContextAll<'input>> {
		Rc::new(
		GroupingElementContextAll::Error(
			BaseParserRuleContext::new_parser_ctx(parent, invoking_state,GroupingElementContextExt{
				ph:PhantomData
			}),
		)
		)
	}
}

pub trait GroupingElementContextAttrs<'input>: athenasqlParserContext<'input> + BorrowMut<GroupingElementContextExt<'input>>{


}

impl<'input> GroupingElementContextAttrs<'input> for GroupingElementContext<'input>{}

pub type MultipleGroupingSetsContext<'input> = BaseParserRuleContext<'input,MultipleGroupingSetsContextExt<'input>>;

pub trait MultipleGroupingSetsContextAttrs<'input>: athenasqlParserContext<'input>{
	/// Retrieves first TerminalNode corresponding to token GROUPING
	/// Returns `None` if there is no child corresponding to token GROUPING
	fn GROUPING(&self) -> Option<Rc<TerminalNode<'input,athenasqlParserContextType>>> where Self:Sized{
		self.get_token(GROUPING, 0)
	}
	/// Retrieves first TerminalNode corresponding to token SETS
	/// Returns `None` if there is no child corresponding to token SETS
	fn SETS(&self) -> Option<Rc<TerminalNode<'input,athenasqlParserContextType>>> where Self:Sized{
		self.get_token(SETS, 0)
	}
	fn groupingSet_all(&self) ->  Vec<Rc<GroupingSetContextAll<'input>>> where Self:Sized{
		self.children_of_type()
	}
	fn groupingSet(&self, i: usize) -> Option<Rc<GroupingSetContextAll<'input>>> where Self:Sized{
		self.child_of_type(i)
	}
}

impl<'input> MultipleGroupingSetsContextAttrs<'input> for MultipleGroupingSetsContext<'input>{}

pub struct MultipleGroupingSetsContextExt<'input>{
	base:GroupingElementContextExt<'input>,
	ph:PhantomData<&'input str>
}

antlr_rust::tid!{MultipleGroupingSetsContextExt<'a>}

impl<'input> athenasqlParserContext<'input> for MultipleGroupingSetsContext<'input>{}

impl<'input,'a> Listenable<dyn athenasqlListener<'input> + 'a> for MultipleGroupingSetsContext<'input>{
	fn enter(&self,listener: &mut (dyn athenasqlListener<'input> + 'a)) {
		listener.enter_every_rule(self);
		listener.enter_multipleGroupingSets(self);
	}
}

impl<'input> CustomRuleContext<'input> for MultipleGroupingSetsContextExt<'input>{
	type TF = LocalTokenFactory<'input>;
	type Ctx = athenasqlParserContextType;
	fn get_rule_index(&self) -> usize { RULE_groupingElement }
	//fn type_rule_index() -> usize where Self: Sized { RULE_groupingElement }
}

impl<'input> Borrow<GroupingElementContextExt<'input>> for MultipleGroupingSetsContext<'input>{
	fn borrow(&self) -> &GroupingElementContextExt<'input> { &self.base }
}
impl<'input> BorrowMut<GroupingElementContextExt<'input>> for MultipleGroupingSetsContext<'input>{
	fn borrow_mut(&mut self) -> &mut GroupingElementContextExt<'input> { &mut self.base }
}

impl<'input> GroupingElementContextAttrs<'input> for MultipleGroupingSetsContext<'input> {}

impl<'input> MultipleGroupingSetsContextExt<'input>{
	fn new(ctx: &dyn GroupingElementContextAttrs<'input>) -> Rc<GroupingElementContextAll<'input>>  {
		Rc::new(
			GroupingElementContextAll::MultipleGroupingSetsContext(
				BaseParserRuleContext::copy_from(ctx,MultipleGroupingSetsContextExt{
        			base: ctx.borrow().clone(),
        			ph:PhantomData
				})
			)
		)
	}
}

pub type SingleGroupingSetContext<'input> = BaseParserRuleContext<'input,SingleGroupingSetContextExt<'input>>;

pub trait SingleGroupingSetContextAttrs<'input>: athenasqlParserContext<'input>{
	fn groupingExpressions(&self) -> Option<Rc<GroupingExpressionsContextAll<'input>>> where Self:Sized{
		self.child_of_type(0)
	}
}

impl<'input> SingleGroupingSetContextAttrs<'input> for SingleGroupingSetContext<'input>{}

pub struct SingleGroupingSetContextExt<'input>{
	base:GroupingElementContextExt<'input>,
	ph:PhantomData<&'input str>
}

antlr_rust::tid!{SingleGroupingSetContextExt<'a>}

impl<'input> athenasqlParserContext<'input> for SingleGroupingSetContext<'input>{}

impl<'input,'a> Listenable<dyn athenasqlListener<'input> + 'a> for SingleGroupingSetContext<'input>{
	fn enter(&self,listener: &mut (dyn athenasqlListener<'input> + 'a)) {
		listener.enter_every_rule(self);
		listener.enter_singleGroupingSet(self);
	}
}

impl<'input> CustomRuleContext<'input> for SingleGroupingSetContextExt<'input>{
	type TF = LocalTokenFactory<'input>;
	type Ctx = athenasqlParserContextType;
	fn get_rule_index(&self) -> usize { RULE_groupingElement }
	//fn type_rule_index() -> usize where Self: Sized { RULE_groupingElement }
}

impl<'input> Borrow<GroupingElementContextExt<'input>> for SingleGroupingSetContext<'input>{
	fn borrow(&self) -> &GroupingElementContextExt<'input> { &self.base }
}
impl<'input> BorrowMut<GroupingElementContextExt<'input>> for SingleGroupingSetContext<'input>{
	fn borrow_mut(&mut self) -> &mut GroupingElementContextExt<'input> { &mut self.base }
}

impl<'input> GroupingElementContextAttrs<'input> for SingleGroupingSetContext<'input> {}

impl<'input> SingleGroupingSetContextExt<'input>{
	fn new(ctx: &dyn GroupingElementContextAttrs<'input>) -> Rc<GroupingElementContextAll<'input>>  {
		Rc::new(
			GroupingElementContextAll::SingleGroupingSetContext(
				BaseParserRuleContext::copy_from(ctx,SingleGroupingSetContextExt{
        			base: ctx.borrow().clone(),
        			ph:PhantomData
				})
			)
		)
	}
}

pub type CubeContext<'input> = BaseParserRuleContext<'input,CubeContextExt<'input>>;

pub trait CubeContextAttrs<'input>: athenasqlParserContext<'input>{
	/// Retrieves first TerminalNode corresponding to token CUBE
	/// Returns `None` if there is no child corresponding to token CUBE
	fn CUBE(&self) -> Option<Rc<TerminalNode<'input,athenasqlParserContextType>>> where Self:Sized{
		self.get_token(CUBE, 0)
	}
	fn qualifiedName_all(&self) ->  Vec<Rc<QualifiedNameContextAll<'input>>> where Self:Sized{
		self.children_of_type()
	}
	fn qualifiedName(&self, i: usize) -> Option<Rc<QualifiedNameContextAll<'input>>> where Self:Sized{
		self.child_of_type(i)
	}
}

impl<'input> CubeContextAttrs<'input> for CubeContext<'input>{}

pub struct CubeContextExt<'input>{
	base:GroupingElementContextExt<'input>,
	ph:PhantomData<&'input str>
}

antlr_rust::tid!{CubeContextExt<'a>}

impl<'input> athenasqlParserContext<'input> for CubeContext<'input>{}

impl<'input,'a> Listenable<dyn athenasqlListener<'input> + 'a> for CubeContext<'input>{
	fn enter(&self,listener: &mut (dyn athenasqlListener<'input> + 'a)) {
		listener.enter_every_rule(self);
		listener.enter_cube(self);
	}
}

impl<'input> CustomRuleContext<'input> for CubeContextExt<'input>{
	type TF = LocalTokenFactory<'input>;
	type Ctx = athenasqlParserContextType;
	fn get_rule_index(&self) -> usize { RULE_groupingElement }
	//fn type_rule_index() -> usize where Self: Sized { RULE_groupingElement }
}

impl<'input> Borrow<GroupingElementContextExt<'input>> for CubeContext<'input>{
	fn borrow(&self) -> &GroupingElementContextExt<'input> { &self.base }
}
impl<'input> BorrowMut<GroupingElementContextExt<'input>> for CubeContext<'input>{
	fn borrow_mut(&mut self) -> &mut GroupingElementContextExt<'input> { &mut self.base }
}

impl<'input> GroupingElementContextAttrs<'input> for CubeContext<'input> {}

impl<'input> CubeContextExt<'input>{
	fn new(ctx: &dyn GroupingElementContextAttrs<'input>) -> Rc<GroupingElementContextAll<'input>>  {
		Rc::new(
			GroupingElementContextAll::CubeContext(
				BaseParserRuleContext::copy_from(ctx,CubeContextExt{
        			base: ctx.borrow().clone(),
        			ph:PhantomData
				})
			)
		)
	}
}

pub type RollupContext<'input> = BaseParserRuleContext<'input,RollupContextExt<'input>>;

pub trait RollupContextAttrs<'input>: athenasqlParserContext<'input>{
	/// Retrieves first TerminalNode corresponding to token ROLLUP
	/// Returns `None` if there is no child corresponding to token ROLLUP
	fn ROLLUP(&self) -> Option<Rc<TerminalNode<'input,athenasqlParserContextType>>> where Self:Sized{
		self.get_token(ROLLUP, 0)
	}
	fn qualifiedName_all(&self) ->  Vec<Rc<QualifiedNameContextAll<'input>>> where Self:Sized{
		self.children_of_type()
	}
	fn qualifiedName(&self, i: usize) -> Option<Rc<QualifiedNameContextAll<'input>>> where Self:Sized{
		self.child_of_type(i)
	}
}

impl<'input> RollupContextAttrs<'input> for RollupContext<'input>{}

pub struct RollupContextExt<'input>{
	base:GroupingElementContextExt<'input>,
	ph:PhantomData<&'input str>
}

antlr_rust::tid!{RollupContextExt<'a>}

impl<'input> athenasqlParserContext<'input> for RollupContext<'input>{}

impl<'input,'a> Listenable<dyn athenasqlListener<'input> + 'a> for RollupContext<'input>{
	fn enter(&self,listener: &mut (dyn athenasqlListener<'input> + 'a)) {
		listener.enter_every_rule(self);
		listener.enter_rollup(self);
	}
}

impl<'input> CustomRuleContext<'input> for RollupContextExt<'input>{
	type TF = LocalTokenFactory<'input>;
	type Ctx = athenasqlParserContextType;
	fn get_rule_index(&self) -> usize { RULE_groupingElement }
	//fn type_rule_index() -> usize where Self: Sized { RULE_groupingElement }
}

impl<'input> Borrow<GroupingElementContextExt<'input>> for RollupContext<'input>{
	fn borrow(&self) -> &GroupingElementContextExt<'input> { &self.base }
}
impl<'input> BorrowMut<GroupingElementContextExt<'input>> for RollupContext<'input>{
	fn borrow_mut(&mut self) -> &mut GroupingElementContextExt<'input> { &mut self.base }
}

impl<'input> GroupingElementContextAttrs<'input> for RollupContext<'input> {}

impl<'input> RollupContextExt<'input>{
	fn new(ctx: &dyn GroupingElementContextAttrs<'input>) -> Rc<GroupingElementContextAll<'input>>  {
		Rc::new(
			GroupingElementContextAll::RollupContext(
				BaseParserRuleContext::copy_from(ctx,RollupContextExt{
        			base: ctx.borrow().clone(),
        			ph:PhantomData
				})
			)
		)
	}
}

impl<'input, I, H> athenasqlParser<'input, I, H>
where
    I: TokenStream<'input, TF = LocalTokenFactory<'input> > + TidAble<'input>,
    H: ErrorStrategy<'input,BaseParserType<'input,I>>
{
	pub fn groupingElement(&mut self,)
	-> Result<Rc<GroupingElementContextAll<'input>>,ANTLRError> {
		let mut recog = self;
		let _parentctx = recog.ctx.take();
		let mut _localctx = GroupingElementContextExt::new(_parentctx.clone(), recog.base.get_state());
        recog.base.enter_rule(_localctx.clone(), 34, RULE_groupingElement);
        let mut _localctx: Rc<GroupingElementContextAll> = _localctx;
		let mut _la: isize = -1;
		let result: Result<(), ANTLRError> = (|| {

			recog.base.set_state(688);
			recog.err_handler.sync(&mut recog.base)?;
			match recog.base.input.la(1) {
			 T__1 | T__4 | ADD | ALL | SOME | ANY | AT | NOT | NO | EXISTS | NULL |
			 TRUE | FALSE | SUBSTRING | POSITION | TINYINT | SMALLINT | INTEGER |
			 DATE | TIME | TIMESTAMP | INTERVAL | YEAR | MONTH | DAY | HOUR | MINUTE |
			 SECOND | ZONE | CURRENT_DATE | CURRENT_TIME | CURRENT_TIMESTAMP | LOCALTIME |
			 LOCALTIMESTAMP | EXTRACT | CASE | FILTER | OVER | PARTITION | RANGE |
			 ROWS | PRECEDING | FOLLOWING | CURRENT | ROW | SCHEMA | COMMENT | VIEW |
			 REPLACE | GRANT | REVOKE | PRIVILEGES | PUBLIC | OPTION | EXPLAIN | ANALYZE |
			 FORMAT | TYPE | TEXT | GRAPHVIZ | LOGICAL | DISTRIBUTED | VALIDATE |
			 CAST | TRY_CAST | SHOW | TABLES | SCHEMAS | CATALOGS | COLUMNS | COLUMN |
			 USE | PARTITIONS | FUNCTIONS | TO | SYSTEM | BERNOULLI | POISSONIZED |
			 TABLESAMPLE | ARRAY | MAP | SET | RESET | SESSION | DATA | START | TRANSACTION |
			 COMMIT | ROLLBACK | WORK | ISOLATION | LEVEL | SERIALIZABLE | REPEATABLE |
			 COMMITTED | UNCOMMITTED | READ | WRITE | ONLY | CALL | INPUT | OUTPUT |
			 CASCADE | RESTRICT | INCLUDING | EXCLUDING | PROPERTIES | NORMALIZE |
			 NFD | NFC | NFKD | NFKC | IF | NULLIF | COALESCE | PLUS | MINUS | STRING |
			 BINARY_LITERAL | INTEGER_VALUE | DECIMAL_VALUE | IDENTIFIER | DIGIT_IDENTIFIER |
			 QUOTED_IDENTIFIER | BACKQUOTED_IDENTIFIER | DOUBLE_PRECISION 
				=> {
					let tmp = SingleGroupingSetContextExt::new(&**_localctx);
					recog.base.enter_outer_alt(Some(tmp.clone()), 1);
					_localctx = tmp;
					{
					/*InvokeRule groupingExpressions*/
					recog.base.set_state(648);
					recog.groupingExpressions()?;

					}
				}

			 ROLLUP 
				=> {
					let tmp = RollupContextExt::new(&**_localctx);
					recog.base.enter_outer_alt(Some(tmp.clone()), 2);
					_localctx = tmp;
					{
					recog.base.set_state(649);
					recog.base.match_token(ROLLUP,&mut recog.err_handler)?;

					recog.base.set_state(650);
					recog.base.match_token(T__1,&mut recog.err_handler)?;

					recog.base.set_state(659);
					recog.err_handler.sync(&mut recog.base)?;
					_la = recog.base.input.la(1);
					if (((_la) & !0x3f) == 0 && ((1usize << _la) & ((1usize << ADD) | (1usize << ALL) | (1usize << SOME) | (1usize << ANY) | (1usize << AT))) != 0) || ((((_la - 33)) & !0x3f) == 0 && ((1usize << (_la - 33)) & ((1usize << (NO - 33)) | (1usize << (SUBSTRING - 33)) | (1usize << (POSITION - 33)) | (1usize << (TINYINT - 33)) | (1usize << (SMALLINT - 33)) | (1usize << (INTEGER - 33)) | (1usize << (DATE - 33)) | (1usize << (TIME - 33)) | (1usize << (TIMESTAMP - 33)) | (1usize << (INTERVAL - 33)) | (1usize << (YEAR - 33)) | (1usize << (MONTH - 33)) | (1usize << (DAY - 33)) | (1usize << (HOUR - 33)) | (1usize << (MINUTE - 33)) | (1usize << (SECOND - 33)) | (1usize << (ZONE - 33)))) != 0) || ((((_la - 85)) & !0x3f) == 0 && ((1usize << (_la - 85)) & ((1usize << (FILTER - 85)) | (1usize << (OVER - 85)) | (1usize << (PARTITION - 85)) | (1usize << (RANGE - 85)) | (1usize << (ROWS - 85)) | (1usize << (PRECEDING - 85)) | (1usize << (FOLLOWING - 85)) | (1usize << (CURRENT - 85)) | (1usize << (ROW - 85)) | (1usize << (SCHEMA - 85)) | (1usize << (COMMENT - 85)) | (1usize << (VIEW - 85)) | (1usize << (REPLACE - 85)) | (1usize << (GRANT - 85)) | (1usize << (REVOKE - 85)) | (1usize << (PRIVILEGES - 85)) | (1usize << (PUBLIC - 85)) | (1usize << (OPTION - 85)) | (1usize << (EXPLAIN - 85)) | (1usize << (ANALYZE - 85)) | (1usize << (FORMAT - 85)))) != 0) || ((((_la - 117)) & !0x3f) == 0 && ((1usize << (_la - 117)) & ((1usize << (TYPE - 117)) | (1usize << (TEXT - 117)) | (1usize << (GRAPHVIZ - 117)) | (1usize << (LOGICAL - 117)) | (1usize << (DISTRIBUTED - 117)) | (1usize << (VALIDATE - 117)) | (1usize << (SHOW - 117)) | (1usize << (TABLES - 117)) | (1usize << (SCHEMAS - 117)) | (1usize << (CATALOGS - 117)) | (1usize << (COLUMNS - 117)) | (1usize << (COLUMN - 117)) | (1usize << (USE - 117)) | (1usize << (PARTITIONS - 117)) | (1usize << (FUNCTIONS - 117)) | (1usize << (TO - 117)) | (1usize << (SYSTEM - 117)) | (1usize << (BERNOULLI - 117)) | (1usize << (POISSONIZED - 117)) | (1usize << (TABLESAMPLE - 117)) | (1usize << (ARRAY - 117)) | (1usize << (MAP - 117)))) != 0) || ((((_la - 149)) & !0x3f) == 0 && ((1usize << (_la - 149)) & ((1usize << (SET - 149)) | (1usize << (RESET - 149)) | (1usize << (SESSION - 149)) | (1usize << (DATA - 149)) | (1usize << (START - 149)) | (1usize << (TRANSACTION - 149)) | (1usize << (COMMIT - 149)) | (1usize << (ROLLBACK - 149)) | (1usize << (WORK - 149)) | (1usize << (ISOLATION - 149)) | (1usize << (LEVEL - 149)) | (1usize << (SERIALIZABLE - 149)) | (1usize << (REPEATABLE - 149)) | (1usize << (COMMITTED - 149)) | (1usize << (UNCOMMITTED - 149)) | (1usize << (READ - 149)) | (1usize << (WRITE - 149)) | (1usize << (ONLY - 149)) | (1usize << (CALL - 149)) | (1usize << (INPUT - 149)) | (1usize << (OUTPUT - 149)) | (1usize << (CASCADE - 149)) | (1usize << (RESTRICT - 149)) | (1usize << (INCLUDING - 149)) | (1usize << (EXCLUDING - 149)) | (1usize << (PROPERTIES - 149)) | (1usize << (NFD - 149)) | (1usize << (NFC - 149)))) != 0) || ((((_la - 181)) & !0x3f) == 0 && ((1usize << (_la - 181)) & ((1usize << (NFKD - 181)) | (1usize << (NFKC - 181)) | (1usize << (IF - 181)) | (1usize << (NULLIF - 181)) | (1usize << (COALESCE - 181)) | (1usize << (IDENTIFIER - 181)) | (1usize << (DIGIT_IDENTIFIER - 181)) | (1usize << (QUOTED_IDENTIFIER - 181)) | (1usize << (BACKQUOTED_IDENTIFIER - 181)))) != 0) {
						{
						/*InvokeRule qualifiedName*/
						recog.base.set_state(651);
						recog.qualifiedName()?;

						recog.base.set_state(656);
						recog.err_handler.sync(&mut recog.base)?;
						_la = recog.base.input.la(1);
						while _la==T__2 {
							{
							{
							recog.base.set_state(652);
							recog.base.match_token(T__2,&mut recog.err_handler)?;

							/*InvokeRule qualifiedName*/
							recog.base.set_state(653);
							recog.qualifiedName()?;

							}
							}
							recog.base.set_state(658);
							recog.err_handler.sync(&mut recog.base)?;
							_la = recog.base.input.la(1);
						}
						}
					}

					recog.base.set_state(661);
					recog.base.match_token(T__3,&mut recog.err_handler)?;

					}
				}

			 CUBE 
				=> {
					let tmp = CubeContextExt::new(&**_localctx);
					recog.base.enter_outer_alt(Some(tmp.clone()), 3);
					_localctx = tmp;
					{
					recog.base.set_state(662);
					recog.base.match_token(CUBE,&mut recog.err_handler)?;

					recog.base.set_state(663);
					recog.base.match_token(T__1,&mut recog.err_handler)?;

					recog.base.set_state(672);
					recog.err_handler.sync(&mut recog.base)?;
					_la = recog.base.input.la(1);
					if (((_la) & !0x3f) == 0 && ((1usize << _la) & ((1usize << ADD) | (1usize << ALL) | (1usize << SOME) | (1usize << ANY) | (1usize << AT))) != 0) || ((((_la - 33)) & !0x3f) == 0 && ((1usize << (_la - 33)) & ((1usize << (NO - 33)) | (1usize << (SUBSTRING - 33)) | (1usize << (POSITION - 33)) | (1usize << (TINYINT - 33)) | (1usize << (SMALLINT - 33)) | (1usize << (INTEGER - 33)) | (1usize << (DATE - 33)) | (1usize << (TIME - 33)) | (1usize << (TIMESTAMP - 33)) | (1usize << (INTERVAL - 33)) | (1usize << (YEAR - 33)) | (1usize << (MONTH - 33)) | (1usize << (DAY - 33)) | (1usize << (HOUR - 33)) | (1usize << (MINUTE - 33)) | (1usize << (SECOND - 33)) | (1usize << (ZONE - 33)))) != 0) || ((((_la - 85)) & !0x3f) == 0 && ((1usize << (_la - 85)) & ((1usize << (FILTER - 85)) | (1usize << (OVER - 85)) | (1usize << (PARTITION - 85)) | (1usize << (RANGE - 85)) | (1usize << (ROWS - 85)) | (1usize << (PRECEDING - 85)) | (1usize << (FOLLOWING - 85)) | (1usize << (CURRENT - 85)) | (1usize << (ROW - 85)) | (1usize << (SCHEMA - 85)) | (1usize << (COMMENT - 85)) | (1usize << (VIEW - 85)) | (1usize << (REPLACE - 85)) | (1usize << (GRANT - 85)) | (1usize << (REVOKE - 85)) | (1usize << (PRIVILEGES - 85)) | (1usize << (PUBLIC - 85)) | (1usize << (OPTION - 85)) | (1usize << (EXPLAIN - 85)) | (1usize << (ANALYZE - 85)) | (1usize << (FORMAT - 85)))) != 0) || ((((_la - 117)) & !0x3f) == 0 && ((1usize << (_la - 117)) & ((1usize << (TYPE - 117)) | (1usize << (TEXT - 117)) | (1usize << (GRAPHVIZ - 117)) | (1usize << (LOGICAL - 117)) | (1usize << (DISTRIBUTED - 117)) | (1usize << (VALIDATE - 117)) | (1usize << (SHOW - 117)) | (1usize << (TABLES - 117)) | (1usize << (SCHEMAS - 117)) | (1usize << (CATALOGS - 117)) | (1usize << (COLUMNS - 117)) | (1usize << (COLUMN - 117)) | (1usize << (USE - 117)) | (1usize << (PARTITIONS - 117)) | (1usize << (FUNCTIONS - 117)) | (1usize << (TO - 117)) | (1usize << (SYSTEM - 117)) | (1usize << (BERNOULLI - 117)) | (1usize << (POISSONIZED - 117)) | (1usize << (TABLESAMPLE - 117)) | (1usize << (ARRAY - 117)) | (1usize << (MAP - 117)))) != 0) || ((((_la - 149)) & !0x3f) == 0 && ((1usize << (_la - 149)) & ((1usize << (SET - 149)) | (1usize << (RESET - 149)) | (1usize << (SESSION - 149)) | (1usize << (DATA - 149)) | (1usize << (START - 149)) | (1usize << (TRANSACTION - 149)) | (1usize << (COMMIT - 149)) | (1usize << (ROLLBACK - 149)) | (1usize << (WORK - 149)) | (1usize << (ISOLATION - 149)) | (1usize << (LEVEL - 149)) | (1usize << (SERIALIZABLE - 149)) | (1usize << (REPEATABLE - 149)) | (1usize << (COMMITTED - 149)) | (1usize << (UNCOMMITTED - 149)) | (1usize << (READ - 149)) | (1usize << (WRITE - 149)) | (1usize << (ONLY - 149)) | (1usize << (CALL - 149)) | (1usize << (INPUT - 149)) | (1usize << (OUTPUT - 149)) | (1usize << (CASCADE - 149)) | (1usize << (RESTRICT - 149)) | (1usize << (INCLUDING - 149)) | (1usize << (EXCLUDING - 149)) | (1usize << (PROPERTIES - 149)) | (1usize << (NFD - 149)) | (1usize << (NFC - 149)))) != 0) || ((((_la - 181)) & !0x3f) == 0 && ((1usize << (_la - 181)) & ((1usize << (NFKD - 181)) | (1usize << (NFKC - 181)) | (1usize << (IF - 181)) | (1usize << (NULLIF - 181)) | (1usize << (COALESCE - 181)) | (1usize << (IDENTIFIER - 181)) | (1usize << (DIGIT_IDENTIFIER - 181)) | (1usize << (QUOTED_IDENTIFIER - 181)) | (1usize << (BACKQUOTED_IDENTIFIER - 181)))) != 0) {
						{
						/*InvokeRule qualifiedName*/
						recog.base.set_state(664);
						recog.qualifiedName()?;

						recog.base.set_state(669);
						recog.err_handler.sync(&mut recog.base)?;
						_la = recog.base.input.la(1);
						while _la==T__2 {
							{
							{
							recog.base.set_state(665);
							recog.base.match_token(T__2,&mut recog.err_handler)?;

							/*InvokeRule qualifiedName*/
							recog.base.set_state(666);
							recog.qualifiedName()?;

							}
							}
							recog.base.set_state(671);
							recog.err_handler.sync(&mut recog.base)?;
							_la = recog.base.input.la(1);
						}
						}
					}

					recog.base.set_state(674);
					recog.base.match_token(T__3,&mut recog.err_handler)?;

					}
				}

			 GROUPING 
				=> {
					let tmp = MultipleGroupingSetsContextExt::new(&**_localctx);
					recog.base.enter_outer_alt(Some(tmp.clone()), 4);
					_localctx = tmp;
					{
					recog.base.set_state(675);
					recog.base.match_token(GROUPING,&mut recog.err_handler)?;

					recog.base.set_state(676);
					recog.base.match_token(SETS,&mut recog.err_handler)?;

					recog.base.set_state(677);
					recog.base.match_token(T__1,&mut recog.err_handler)?;

					/*InvokeRule groupingSet*/
					recog.base.set_state(678);
					recog.groupingSet()?;

					recog.base.set_state(683);
					recog.err_handler.sync(&mut recog.base)?;
					_la = recog.base.input.la(1);
					while _la==T__2 {
						{
						{
						recog.base.set_state(679);
						recog.base.match_token(T__2,&mut recog.err_handler)?;

						/*InvokeRule groupingSet*/
						recog.base.set_state(680);
						recog.groupingSet()?;

						}
						}
						recog.base.set_state(685);
						recog.err_handler.sync(&mut recog.base)?;
						_la = recog.base.input.la(1);
					}
					recog.base.set_state(686);
					recog.base.match_token(T__3,&mut recog.err_handler)?;

					}
				}

				_ => Err(ANTLRError::NoAltError(NoViableAltError::new(&mut recog.base)))?
			}
			Ok(())
		})();
		match result {
		Ok(_)=>{},
        Err(e @ ANTLRError::FallThrough(_)) => return Err(e),
		Err(ref re) => {
				//_localctx.exception = re;
				recog.err_handler.report_error(&mut recog.base, re);
				recog.err_handler.recover(&mut recog.base, re)?;
			}
		}
		recog.base.exit_rule();

		Ok(_localctx)
	}
}
//------------------- groupingExpressions ----------------
pub type GroupingExpressionsContextAll<'input> = GroupingExpressionsContext<'input>;


pub type GroupingExpressionsContext<'input> = BaseParserRuleContext<'input,GroupingExpressionsContextExt<'input>>;

#[derive(Clone)]
pub struct GroupingExpressionsContextExt<'input>{
ph:PhantomData<&'input str>
}

impl<'input> athenasqlParserContext<'input> for GroupingExpressionsContext<'input>{}

impl<'input,'a> Listenable<dyn athenasqlListener<'input> + 'a> for GroupingExpressionsContext<'input>{
		fn enter(&self,listener: &mut (dyn athenasqlListener<'input> + 'a)) {
			listener.enter_every_rule(self);
			listener.enter_groupingExpressions(self);
		}fn exit(&self,listener: &mut (dyn athenasqlListener<'input> + 'a)) {
			listener.exit_groupingExpressions(self);
			listener.exit_every_rule(self);
		}
}

impl<'input> CustomRuleContext<'input> for GroupingExpressionsContextExt<'input>{
	type TF = LocalTokenFactory<'input>;
	type Ctx = athenasqlParserContextType;
	fn get_rule_index(&self) -> usize { RULE_groupingExpressions }
	//fn type_rule_index() -> usize where Self: Sized { RULE_groupingExpressions }
}
antlr_rust::tid!{GroupingExpressionsContextExt<'a>}

impl<'input> GroupingExpressionsContextExt<'input>{
	fn new(parent: Option<Rc<dyn athenasqlParserContext<'input> + 'input > >, invoking_state: isize) -> Rc<GroupingExpressionsContextAll<'input>> {
		Rc::new(
			BaseParserRuleContext::new_parser_ctx(parent, invoking_state,GroupingExpressionsContextExt{
				ph:PhantomData
			}),
		)
	}
}

pub trait GroupingExpressionsContextAttrs<'input>: athenasqlParserContext<'input> + BorrowMut<GroupingExpressionsContextExt<'input>>{

fn expression_all(&self) ->  Vec<Rc<ExpressionContextAll<'input>>> where Self:Sized{
	self.children_of_type()
}
fn expression(&self, i: usize) -> Option<Rc<ExpressionContextAll<'input>>> where Self:Sized{
	self.child_of_type(i)
}

}

impl<'input> GroupingExpressionsContextAttrs<'input> for GroupingExpressionsContext<'input>{}

impl<'input, I, H> athenasqlParser<'input, I, H>
where
    I: TokenStream<'input, TF = LocalTokenFactory<'input> > + TidAble<'input>,
    H: ErrorStrategy<'input,BaseParserType<'input,I>>
{
	pub fn groupingExpressions(&mut self,)
	-> Result<Rc<GroupingExpressionsContextAll<'input>>,ANTLRError> {
		let mut recog = self;
		let _parentctx = recog.ctx.take();
		let mut _localctx = GroupingExpressionsContextExt::new(_parentctx.clone(), recog.base.get_state());
        recog.base.enter_rule(_localctx.clone(), 36, RULE_groupingExpressions);
        let mut _localctx: Rc<GroupingExpressionsContextAll> = _localctx;
		let mut _la: isize = -1;
		let result: Result<(), ANTLRError> = (|| {

			recog.base.set_state(703);
			recog.err_handler.sync(&mut recog.base)?;
			match  recog.interpreter.adaptive_predict(80,&mut recog.base)? {
				1 =>{
					//recog.base.enter_outer_alt(_localctx.clone(), 1);
					recog.base.enter_outer_alt(None, 1);
					{
					recog.base.set_state(690);
					recog.base.match_token(T__1,&mut recog.err_handler)?;

					recog.base.set_state(699);
					recog.err_handler.sync(&mut recog.base)?;
					_la = recog.base.input.la(1);
					if (((_la) & !0x3f) == 0 && ((1usize << _la) & ((1usize << T__1) | (1usize << T__4) | (1usize << ADD) | (1usize << ALL) | (1usize << SOME) | (1usize << ANY) | (1usize << AT))) != 0) || ((((_la - 32)) & !0x3f) == 0 && ((1usize << (_la - 32)) & ((1usize << (NOT - 32)) | (1usize << (NO - 32)) | (1usize << (EXISTS - 32)) | (1usize << (NULL - 32)) | (1usize << (TRUE - 32)) | (1usize << (FALSE - 32)) | (1usize << (SUBSTRING - 32)) | (1usize << (POSITION - 32)) | (1usize << (TINYINT - 32)) | (1usize << (SMALLINT - 32)) | (1usize << (INTEGER - 32)) | (1usize << (DATE - 32)) | (1usize << (TIME - 32)) | (1usize << (TIMESTAMP - 32)) | (1usize << (INTERVAL - 32)) | (1usize << (YEAR - 32)) | (1usize << (MONTH - 32)) | (1usize << (DAY - 32)) | (1usize << (HOUR - 32)) | (1usize << (MINUTE - 32)) | (1usize << (SECOND - 32)) | (1usize << (ZONE - 32)))) != 0) || ((((_la - 64)) & !0x3f) == 0 && ((1usize << (_la - 64)) & ((1usize << (CURRENT_DATE - 64)) | (1usize << (CURRENT_TIME - 64)) | (1usize << (CURRENT_TIMESTAMP - 64)) | (1usize << (LOCALTIME - 64)) | (1usize << (LOCALTIMESTAMP - 64)) | (1usize << (EXTRACT - 64)) | (1usize << (CASE - 64)) | (1usize << (FILTER - 64)) | (1usize << (OVER - 64)) | (1usize << (PARTITION - 64)) | (1usize << (RANGE - 64)) | (1usize << (ROWS - 64)) | (1usize << (PRECEDING - 64)) | (1usize << (FOLLOWING - 64)) | (1usize << (CURRENT - 64)) | (1usize << (ROW - 64)))) != 0) || ((((_la - 99)) & !0x3f) == 0 && ((1usize << (_la - 99)) & ((1usize << (SCHEMA - 99)) | (1usize << (COMMENT - 99)) | (1usize << (VIEW - 99)) | (1usize << (REPLACE - 99)) | (1usize << (GRANT - 99)) | (1usize << (REVOKE - 99)) | (1usize << (PRIVILEGES - 99)) | (1usize << (PUBLIC - 99)) | (1usize << (OPTION - 99)) | (1usize << (EXPLAIN - 99)) | (1usize << (ANALYZE - 99)) | (1usize << (FORMAT - 99)) | (1usize << (TYPE - 99)) | (1usize << (TEXT - 99)) | (1usize << (GRAPHVIZ - 99)) | (1usize << (LOGICAL - 99)) | (1usize << (DISTRIBUTED - 99)) | (1usize << (VALIDATE - 99)) | (1usize << (CAST - 99)) | (1usize << (TRY_CAST - 99)) | (1usize << (SHOW - 99)) | (1usize << (TABLES - 99)) | (1usize << (SCHEMAS - 99)) | (1usize << (CATALOGS - 99)) | (1usize << (COLUMNS - 99)) | (1usize << (COLUMN - 99)))) != 0) || ((((_la - 131)) & !0x3f) == 0 && ((1usize << (_la - 131)) & ((1usize << (USE - 131)) | (1usize << (PARTITIONS - 131)) | (1usize << (FUNCTIONS - 131)) | (1usize << (TO - 131)) | (1usize << (SYSTEM - 131)) | (1usize << (BERNOULLI - 131)) | (1usize << (POISSONIZED - 131)) | (1usize << (TABLESAMPLE - 131)) | (1usize << (ARRAY - 131)) | (1usize << (MAP - 131)) | (1usize << (SET - 131)) | (1usize << (RESET - 131)) | (1usize << (SESSION - 131)) | (1usize << (DATA - 131)) | (1usize << (START - 131)) | (1usize << (TRANSACTION - 131)) | (1usize << (COMMIT - 131)) | (1usize << (ROLLBACK - 131)) | (1usize << (WORK - 131)) | (1usize << (ISOLATION - 131)) | (1usize << (LEVEL - 131)) | (1usize << (SERIALIZABLE - 131)) | (1usize << (REPEATABLE - 131)) | (1usize << (COMMITTED - 131)))) != 0) || ((((_la - 163)) & !0x3f) == 0 && ((1usize << (_la - 163)) & ((1usize << (UNCOMMITTED - 163)) | (1usize << (READ - 163)) | (1usize << (WRITE - 163)) | (1usize << (ONLY - 163)) | (1usize << (CALL - 163)) | (1usize << (INPUT - 163)) | (1usize << (OUTPUT - 163)) | (1usize << (CASCADE - 163)) | (1usize << (RESTRICT - 163)) | (1usize << (INCLUDING - 163)) | (1usize << (EXCLUDING - 163)) | (1usize << (PROPERTIES - 163)) | (1usize << (NORMALIZE - 163)) | (1usize << (NFD - 163)) | (1usize << (NFC - 163)) | (1usize << (NFKD - 163)) | (1usize << (NFKC - 163)) | (1usize << (IF - 163)) | (1usize << (NULLIF - 163)) | (1usize << (COALESCE - 163)) | (1usize << (PLUS - 163)) | (1usize << (MINUS - 163)))) != 0) || ((((_la - 198)) & !0x3f) == 0 && ((1usize << (_la - 198)) & ((1usize << (STRING - 198)) | (1usize << (BINARY_LITERAL - 198)) | (1usize << (INTEGER_VALUE - 198)) | (1usize << (DECIMAL_VALUE - 198)) | (1usize << (IDENTIFIER - 198)) | (1usize << (DIGIT_IDENTIFIER - 198)) | (1usize << (QUOTED_IDENTIFIER - 198)) | (1usize << (BACKQUOTED_IDENTIFIER - 198)) | (1usize << (DOUBLE_PRECISION - 198)))) != 0) {
						{
						/*InvokeRule expression*/
						recog.base.set_state(691);
						recog.expression()?;

						recog.base.set_state(696);
						recog.err_handler.sync(&mut recog.base)?;
						_la = recog.base.input.la(1);
						while _la==T__2 {
							{
							{
							recog.base.set_state(692);
							recog.base.match_token(T__2,&mut recog.err_handler)?;

							/*InvokeRule expression*/
							recog.base.set_state(693);
							recog.expression()?;

							}
							}
							recog.base.set_state(698);
							recog.err_handler.sync(&mut recog.base)?;
							_la = recog.base.input.la(1);
						}
						}
					}

					recog.base.set_state(701);
					recog.base.match_token(T__3,&mut recog.err_handler)?;

					}
				}
			,
				2 =>{
					//recog.base.enter_outer_alt(_localctx.clone(), 2);
					recog.base.enter_outer_alt(None, 2);
					{
					/*InvokeRule expression*/
					recog.base.set_state(702);
					recog.expression()?;

					}
				}

				_ => {}
			}
			Ok(())
		})();
		match result {
		Ok(_)=>{},
        Err(e @ ANTLRError::FallThrough(_)) => return Err(e),
		Err(ref re) => {
				//_localctx.exception = re;
				recog.err_handler.report_error(&mut recog.base, re);
				recog.err_handler.recover(&mut recog.base, re)?;
			}
		}
		recog.base.exit_rule();

		Ok(_localctx)
	}
}
//------------------- groupingSet ----------------
pub type GroupingSetContextAll<'input> = GroupingSetContext<'input>;


pub type GroupingSetContext<'input> = BaseParserRuleContext<'input,GroupingSetContextExt<'input>>;

#[derive(Clone)]
pub struct GroupingSetContextExt<'input>{
ph:PhantomData<&'input str>
}

impl<'input> athenasqlParserContext<'input> for GroupingSetContext<'input>{}

impl<'input,'a> Listenable<dyn athenasqlListener<'input> + 'a> for GroupingSetContext<'input>{
		fn enter(&self,listener: &mut (dyn athenasqlListener<'input> + 'a)) {
			listener.enter_every_rule(self);
			listener.enter_groupingSet(self);
		}fn exit(&self,listener: &mut (dyn athenasqlListener<'input> + 'a)) {
			listener.exit_groupingSet(self);
			listener.exit_every_rule(self);
		}
}

impl<'input> CustomRuleContext<'input> for GroupingSetContextExt<'input>{
	type TF = LocalTokenFactory<'input>;
	type Ctx = athenasqlParserContextType;
	fn get_rule_index(&self) -> usize { RULE_groupingSet }
	//fn type_rule_index() -> usize where Self: Sized { RULE_groupingSet }
}
antlr_rust::tid!{GroupingSetContextExt<'a>}

impl<'input> GroupingSetContextExt<'input>{
	fn new(parent: Option<Rc<dyn athenasqlParserContext<'input> + 'input > >, invoking_state: isize) -> Rc<GroupingSetContextAll<'input>> {
		Rc::new(
			BaseParserRuleContext::new_parser_ctx(parent, invoking_state,GroupingSetContextExt{
				ph:PhantomData
			}),
		)
	}
}

pub trait GroupingSetContextAttrs<'input>: athenasqlParserContext<'input> + BorrowMut<GroupingSetContextExt<'input>>{

fn qualifiedName_all(&self) ->  Vec<Rc<QualifiedNameContextAll<'input>>> where Self:Sized{
	self.children_of_type()
}
fn qualifiedName(&self, i: usize) -> Option<Rc<QualifiedNameContextAll<'input>>> where Self:Sized{
	self.child_of_type(i)
}

}

impl<'input> GroupingSetContextAttrs<'input> for GroupingSetContext<'input>{}

impl<'input, I, H> athenasqlParser<'input, I, H>
where
    I: TokenStream<'input, TF = LocalTokenFactory<'input> > + TidAble<'input>,
    H: ErrorStrategy<'input,BaseParserType<'input,I>>
{
	pub fn groupingSet(&mut self,)
	-> Result<Rc<GroupingSetContextAll<'input>>,ANTLRError> {
		let mut recog = self;
		let _parentctx = recog.ctx.take();
		let mut _localctx = GroupingSetContextExt::new(_parentctx.clone(), recog.base.get_state());
        recog.base.enter_rule(_localctx.clone(), 38, RULE_groupingSet);
        let mut _localctx: Rc<GroupingSetContextAll> = _localctx;
		let mut _la: isize = -1;
		let result: Result<(), ANTLRError> = (|| {

			recog.base.set_state(718);
			recog.err_handler.sync(&mut recog.base)?;
			match recog.base.input.la(1) {
			 T__1 
				=> {
					//recog.base.enter_outer_alt(_localctx.clone(), 1);
					recog.base.enter_outer_alt(None, 1);
					{
					recog.base.set_state(705);
					recog.base.match_token(T__1,&mut recog.err_handler)?;

					recog.base.set_state(714);
					recog.err_handler.sync(&mut recog.base)?;
					_la = recog.base.input.la(1);
					if (((_la) & !0x3f) == 0 && ((1usize << _la) & ((1usize << ADD) | (1usize << ALL) | (1usize << SOME) | (1usize << ANY) | (1usize << AT))) != 0) || ((((_la - 33)) & !0x3f) == 0 && ((1usize << (_la - 33)) & ((1usize << (NO - 33)) | (1usize << (SUBSTRING - 33)) | (1usize << (POSITION - 33)) | (1usize << (TINYINT - 33)) | (1usize << (SMALLINT - 33)) | (1usize << (INTEGER - 33)) | (1usize << (DATE - 33)) | (1usize << (TIME - 33)) | (1usize << (TIMESTAMP - 33)) | (1usize << (INTERVAL - 33)) | (1usize << (YEAR - 33)) | (1usize << (MONTH - 33)) | (1usize << (DAY - 33)) | (1usize << (HOUR - 33)) | (1usize << (MINUTE - 33)) | (1usize << (SECOND - 33)) | (1usize << (ZONE - 33)))) != 0) || ((((_la - 85)) & !0x3f) == 0 && ((1usize << (_la - 85)) & ((1usize << (FILTER - 85)) | (1usize << (OVER - 85)) | (1usize << (PARTITION - 85)) | (1usize << (RANGE - 85)) | (1usize << (ROWS - 85)) | (1usize << (PRECEDING - 85)) | (1usize << (FOLLOWING - 85)) | (1usize << (CURRENT - 85)) | (1usize << (ROW - 85)) | (1usize << (SCHEMA - 85)) | (1usize << (COMMENT - 85)) | (1usize << (VIEW - 85)) | (1usize << (REPLACE - 85)) | (1usize << (GRANT - 85)) | (1usize << (REVOKE - 85)) | (1usize << (PRIVILEGES - 85)) | (1usize << (PUBLIC - 85)) | (1usize << (OPTION - 85)) | (1usize << (EXPLAIN - 85)) | (1usize << (ANALYZE - 85)) | (1usize << (FORMAT - 85)))) != 0) || ((((_la - 117)) & !0x3f) == 0 && ((1usize << (_la - 117)) & ((1usize << (TYPE - 117)) | (1usize << (TEXT - 117)) | (1usize << (GRAPHVIZ - 117)) | (1usize << (LOGICAL - 117)) | (1usize << (DISTRIBUTED - 117)) | (1usize << (VALIDATE - 117)) | (1usize << (SHOW - 117)) | (1usize << (TABLES - 117)) | (1usize << (SCHEMAS - 117)) | (1usize << (CATALOGS - 117)) | (1usize << (COLUMNS - 117)) | (1usize << (COLUMN - 117)) | (1usize << (USE - 117)) | (1usize << (PARTITIONS - 117)) | (1usize << (FUNCTIONS - 117)) | (1usize << (TO - 117)) | (1usize << (SYSTEM - 117)) | (1usize << (BERNOULLI - 117)) | (1usize << (POISSONIZED - 117)) | (1usize << (TABLESAMPLE - 117)) | (1usize << (ARRAY - 117)) | (1usize << (MAP - 117)))) != 0) || ((((_la - 149)) & !0x3f) == 0 && ((1usize << (_la - 149)) & ((1usize << (SET - 149)) | (1usize << (RESET - 149)) | (1usize << (SESSION - 149)) | (1usize << (DATA - 149)) | (1usize << (START - 149)) | (1usize << (TRANSACTION - 149)) | (1usize << (COMMIT - 149)) | (1usize << (ROLLBACK - 149)) | (1usize << (WORK - 149)) | (1usize << (ISOLATION - 149)) | (1usize << (LEVEL - 149)) | (1usize << (SERIALIZABLE - 149)) | (1usize << (REPEATABLE - 149)) | (1usize << (COMMITTED - 149)) | (1usize << (UNCOMMITTED - 149)) | (1usize << (READ - 149)) | (1usize << (WRITE - 149)) | (1usize << (ONLY - 149)) | (1usize << (CALL - 149)) | (1usize << (INPUT - 149)) | (1usize << (OUTPUT - 149)) | (1usize << (CASCADE - 149)) | (1usize << (RESTRICT - 149)) | (1usize << (INCLUDING - 149)) | (1usize << (EXCLUDING - 149)) | (1usize << (PROPERTIES - 149)) | (1usize << (NFD - 149)) | (1usize << (NFC - 149)))) != 0) || ((((_la - 181)) & !0x3f) == 0 && ((1usize << (_la - 181)) & ((1usize << (NFKD - 181)) | (1usize << (NFKC - 181)) | (1usize << (IF - 181)) | (1usize << (NULLIF - 181)) | (1usize << (COALESCE - 181)) | (1usize << (IDENTIFIER - 181)) | (1usize << (DIGIT_IDENTIFIER - 181)) | (1usize << (QUOTED_IDENTIFIER - 181)) | (1usize << (BACKQUOTED_IDENTIFIER - 181)))) != 0) {
						{
						/*InvokeRule qualifiedName*/
						recog.base.set_state(706);
						recog.qualifiedName()?;

						recog.base.set_state(711);
						recog.err_handler.sync(&mut recog.base)?;
						_la = recog.base.input.la(1);
						while _la==T__2 {
							{
							{
							recog.base.set_state(707);
							recog.base.match_token(T__2,&mut recog.err_handler)?;

							/*InvokeRule qualifiedName*/
							recog.base.set_state(708);
							recog.qualifiedName()?;

							}
							}
							recog.base.set_state(713);
							recog.err_handler.sync(&mut recog.base)?;
							_la = recog.base.input.la(1);
						}
						}
					}

					recog.base.set_state(716);
					recog.base.match_token(T__3,&mut recog.err_handler)?;

					}
				}

			 ADD | ALL | SOME | ANY | AT | NO | SUBSTRING | POSITION | TINYINT | SMALLINT |
			 INTEGER | DATE | TIME | TIMESTAMP | INTERVAL | YEAR | MONTH | DAY | HOUR |
			 MINUTE | SECOND | ZONE | FILTER | OVER | PARTITION | RANGE | ROWS | PRECEDING |
			 FOLLOWING | CURRENT | ROW | SCHEMA | COMMENT | VIEW | REPLACE | GRANT |
			 REVOKE | PRIVILEGES | PUBLIC | OPTION | EXPLAIN | ANALYZE | FORMAT |
			 TYPE | TEXT | GRAPHVIZ | LOGICAL | DISTRIBUTED | VALIDATE | SHOW | TABLES |
			 SCHEMAS | CATALOGS | COLUMNS | COLUMN | USE | PARTITIONS | FUNCTIONS |
			 TO | SYSTEM | BERNOULLI | POISSONIZED | TABLESAMPLE | ARRAY | MAP | SET |
			 RESET | SESSION | DATA | START | TRANSACTION | COMMIT | ROLLBACK | WORK |
			 ISOLATION | LEVEL | SERIALIZABLE | REPEATABLE | COMMITTED | UNCOMMITTED |
			 READ | WRITE | ONLY | CALL | INPUT | OUTPUT | CASCADE | RESTRICT | INCLUDING |
			 EXCLUDING | PROPERTIES | NFD | NFC | NFKD | NFKC | IF | NULLIF | COALESCE |
			 IDENTIFIER | DIGIT_IDENTIFIER | QUOTED_IDENTIFIER | BACKQUOTED_IDENTIFIER 
				=> {
					//recog.base.enter_outer_alt(_localctx.clone(), 2);
					recog.base.enter_outer_alt(None, 2);
					{
					/*InvokeRule qualifiedName*/
					recog.base.set_state(717);
					recog.qualifiedName()?;

					}
				}

				_ => Err(ANTLRError::NoAltError(NoViableAltError::new(&mut recog.base)))?
			}
			Ok(())
		})();
		match result {
		Ok(_)=>{},
        Err(e @ ANTLRError::FallThrough(_)) => return Err(e),
		Err(ref re) => {
				//_localctx.exception = re;
				recog.err_handler.report_error(&mut recog.base, re);
				recog.err_handler.recover(&mut recog.base, re)?;
			}
		}
		recog.base.exit_rule();

		Ok(_localctx)
	}
}
//------------------- namedQuery ----------------
pub type NamedQueryContextAll<'input> = NamedQueryContext<'input>;


pub type NamedQueryContext<'input> = BaseParserRuleContext<'input,NamedQueryContextExt<'input>>;

#[derive(Clone)]
pub struct NamedQueryContextExt<'input>{
	pub name: Option<Rc<IdentifierContextAll<'input>>>,
ph:PhantomData<&'input str>
}

impl<'input> athenasqlParserContext<'input> for NamedQueryContext<'input>{}

impl<'input,'a> Listenable<dyn athenasqlListener<'input> + 'a> for NamedQueryContext<'input>{
		fn enter(&self,listener: &mut (dyn athenasqlListener<'input> + 'a)) {
			listener.enter_every_rule(self);
			listener.enter_namedQuery(self);
		}fn exit(&self,listener: &mut (dyn athenasqlListener<'input> + 'a)) {
			listener.exit_namedQuery(self);
			listener.exit_every_rule(self);
		}
}

impl<'input> CustomRuleContext<'input> for NamedQueryContextExt<'input>{
	type TF = LocalTokenFactory<'input>;
	type Ctx = athenasqlParserContextType;
	fn get_rule_index(&self) -> usize { RULE_namedQuery }
	//fn type_rule_index() -> usize where Self: Sized { RULE_namedQuery }
}
antlr_rust::tid!{NamedQueryContextExt<'a>}

impl<'input> NamedQueryContextExt<'input>{
	fn new(parent: Option<Rc<dyn athenasqlParserContext<'input> + 'input > >, invoking_state: isize) -> Rc<NamedQueryContextAll<'input>> {
		Rc::new(
			BaseParserRuleContext::new_parser_ctx(parent, invoking_state,NamedQueryContextExt{
				name: None, 
				ph:PhantomData
			}),
		)
	}
}

pub trait NamedQueryContextAttrs<'input>: athenasqlParserContext<'input> + BorrowMut<NamedQueryContextExt<'input>>{

/// Retrieves first TerminalNode corresponding to token AS
/// Returns `None` if there is no child corresponding to token AS
fn AS(&self) -> Option<Rc<TerminalNode<'input,athenasqlParserContextType>>> where Self:Sized{
	self.get_token(AS, 0)
}
fn query(&self) -> Option<Rc<QueryContextAll<'input>>> where Self:Sized{
	self.child_of_type(0)
}
fn identifier(&self) -> Option<Rc<IdentifierContextAll<'input>>> where Self:Sized{
	self.child_of_type(0)
}
fn columnAliases(&self) -> Option<Rc<ColumnAliasesContextAll<'input>>> where Self:Sized{
	self.child_of_type(0)
}

}

impl<'input> NamedQueryContextAttrs<'input> for NamedQueryContext<'input>{}

impl<'input, I, H> athenasqlParser<'input, I, H>
where
    I: TokenStream<'input, TF = LocalTokenFactory<'input> > + TidAble<'input>,
    H: ErrorStrategy<'input,BaseParserType<'input,I>>
{
	pub fn namedQuery(&mut self,)
	-> Result<Rc<NamedQueryContextAll<'input>>,ANTLRError> {
		let mut recog = self;
		let _parentctx = recog.ctx.take();
		let mut _localctx = NamedQueryContextExt::new(_parentctx.clone(), recog.base.get_state());
        recog.base.enter_rule(_localctx.clone(), 40, RULE_namedQuery);
        let mut _localctx: Rc<NamedQueryContextAll> = _localctx;
		let mut _la: isize = -1;
		let result: Result<(), ANTLRError> = (|| {

			//recog.base.enter_outer_alt(_localctx.clone(), 1);
			recog.base.enter_outer_alt(None, 1);
			{
			/*InvokeRule identifier*/
			recog.base.set_state(720);
			let tmp = recog.identifier()?;
			 cast_mut::<_,NamedQueryContext >(&mut _localctx).name = Some(tmp.clone());
			  

			recog.base.set_state(722);
			recog.err_handler.sync(&mut recog.base)?;
			_la = recog.base.input.la(1);
			if _la==T__1 {
				{
				/*InvokeRule columnAliases*/
				recog.base.set_state(721);
				recog.columnAliases()?;

				}
			}

			recog.base.set_state(724);
			recog.base.match_token(AS,&mut recog.err_handler)?;

			recog.base.set_state(725);
			recog.base.match_token(T__1,&mut recog.err_handler)?;

			/*InvokeRule query*/
			recog.base.set_state(726);
			recog.query()?;

			recog.base.set_state(727);
			recog.base.match_token(T__3,&mut recog.err_handler)?;

			}
			Ok(())
		})();
		match result {
		Ok(_)=>{},
        Err(e @ ANTLRError::FallThrough(_)) => return Err(e),
		Err(ref re) => {
				//_localctx.exception = re;
				recog.err_handler.report_error(&mut recog.base, re);
				recog.err_handler.recover(&mut recog.base, re)?;
			}
		}
		recog.base.exit_rule();

		Ok(_localctx)
	}
}
//------------------- setQuantifier ----------------
pub type SetQuantifierContextAll<'input> = SetQuantifierContext<'input>;


pub type SetQuantifierContext<'input> = BaseParserRuleContext<'input,SetQuantifierContextExt<'input>>;

#[derive(Clone)]
pub struct SetQuantifierContextExt<'input>{
ph:PhantomData<&'input str>
}

impl<'input> athenasqlParserContext<'input> for SetQuantifierContext<'input>{}

impl<'input,'a> Listenable<dyn athenasqlListener<'input> + 'a> for SetQuantifierContext<'input>{
		fn enter(&self,listener: &mut (dyn athenasqlListener<'input> + 'a)) {
			listener.enter_every_rule(self);
			listener.enter_setQuantifier(self);
		}fn exit(&self,listener: &mut (dyn athenasqlListener<'input> + 'a)) {
			listener.exit_setQuantifier(self);
			listener.exit_every_rule(self);
		}
}

impl<'input> CustomRuleContext<'input> for SetQuantifierContextExt<'input>{
	type TF = LocalTokenFactory<'input>;
	type Ctx = athenasqlParserContextType;
	fn get_rule_index(&self) -> usize { RULE_setQuantifier }
	//fn type_rule_index() -> usize where Self: Sized { RULE_setQuantifier }
}
antlr_rust::tid!{SetQuantifierContextExt<'a>}

impl<'input> SetQuantifierContextExt<'input>{
	fn new(parent: Option<Rc<dyn athenasqlParserContext<'input> + 'input > >, invoking_state: isize) -> Rc<SetQuantifierContextAll<'input>> {
		Rc::new(
			BaseParserRuleContext::new_parser_ctx(parent, invoking_state,SetQuantifierContextExt{
				ph:PhantomData
			}),
		)
	}
}

pub trait SetQuantifierContextAttrs<'input>: athenasqlParserContext<'input> + BorrowMut<SetQuantifierContextExt<'input>>{

/// Retrieves first TerminalNode corresponding to token DISTINCT
/// Returns `None` if there is no child corresponding to token DISTINCT
fn DISTINCT(&self) -> Option<Rc<TerminalNode<'input,athenasqlParserContextType>>> where Self:Sized{
	self.get_token(DISTINCT, 0)
}
/// Retrieves first TerminalNode corresponding to token ALL
/// Returns `None` if there is no child corresponding to token ALL
fn ALL(&self) -> Option<Rc<TerminalNode<'input,athenasqlParserContextType>>> where Self:Sized{
	self.get_token(ALL, 0)
}

}

impl<'input> SetQuantifierContextAttrs<'input> for SetQuantifierContext<'input>{}

impl<'input, I, H> athenasqlParser<'input, I, H>
where
    I: TokenStream<'input, TF = LocalTokenFactory<'input> > + TidAble<'input>,
    H: ErrorStrategy<'input,BaseParserType<'input,I>>
{
	pub fn setQuantifier(&mut self,)
	-> Result<Rc<SetQuantifierContextAll<'input>>,ANTLRError> {
		let mut recog = self;
		let _parentctx = recog.ctx.take();
		let mut _localctx = SetQuantifierContextExt::new(_parentctx.clone(), recog.base.get_state());
        recog.base.enter_rule(_localctx.clone(), 42, RULE_setQuantifier);
        let mut _localctx: Rc<SetQuantifierContextAll> = _localctx;
		let mut _la: isize = -1;
		let result: Result<(), ANTLRError> = (|| {

			//recog.base.enter_outer_alt(_localctx.clone(), 1);
			recog.base.enter_outer_alt(None, 1);
			{
			recog.base.set_state(729);
			_la = recog.base.input.la(1);
			if { !(_la==ALL || _la==DISTINCT) } {
				recog.err_handler.recover_inline(&mut recog.base)?;

			}
			else {
				if  recog.base.input.la(1)==TOKEN_EOF { recog.base.matched_eof = true };
				recog.err_handler.report_match(&mut recog.base);
				recog.base.consume(&mut recog.err_handler);
			}
			}
			Ok(())
		})();
		match result {
		Ok(_)=>{},
        Err(e @ ANTLRError::FallThrough(_)) => return Err(e),
		Err(ref re) => {
				//_localctx.exception = re;
				recog.err_handler.report_error(&mut recog.base, re);
				recog.err_handler.recover(&mut recog.base, re)?;
			}
		}
		recog.base.exit_rule();

		Ok(_localctx)
	}
}
//------------------- selectItem ----------------
#[derive(Debug)]
pub enum SelectItemContextAll<'input>{
	SelectAllContext(SelectAllContext<'input>),
	SelectSingleContext(SelectSingleContext<'input>),
Error(SelectItemContext<'input>)
}
antlr_rust::tid!{SelectItemContextAll<'a>}

impl<'input> antlr_rust::parser_rule_context::DerefSeal for SelectItemContextAll<'input>{}

impl<'input> athenasqlParserContext<'input> for SelectItemContextAll<'input>{}

impl<'input> Deref for SelectItemContextAll<'input>{
	type Target = dyn SelectItemContextAttrs<'input> + 'input;
	fn deref(&self) -> &Self::Target{
		use SelectItemContextAll::*;
		match self{
			SelectAllContext(inner) => inner,
			SelectSingleContext(inner) => inner,
Error(inner) => inner
		}
	}
}
impl<'input,'a> Listenable<dyn athenasqlListener<'input> + 'a> for SelectItemContextAll<'input>{
    fn enter(&self, listener: &mut (dyn athenasqlListener<'input> + 'a)) { self.deref().enter(listener) }
    fn exit(&self, listener: &mut (dyn athenasqlListener<'input> + 'a)) { self.deref().exit(listener) }
}



pub type SelectItemContext<'input> = BaseParserRuleContext<'input,SelectItemContextExt<'input>>;

#[derive(Clone)]
pub struct SelectItemContextExt<'input>{
ph:PhantomData<&'input str>
}

impl<'input> athenasqlParserContext<'input> for SelectItemContext<'input>{}

impl<'input,'a> Listenable<dyn athenasqlListener<'input> + 'a> for SelectItemContext<'input>{
}

impl<'input> CustomRuleContext<'input> for SelectItemContextExt<'input>{
	type TF = LocalTokenFactory<'input>;
	type Ctx = athenasqlParserContextType;
	fn get_rule_index(&self) -> usize { RULE_selectItem }
	//fn type_rule_index() -> usize where Self: Sized { RULE_selectItem }
}
antlr_rust::tid!{SelectItemContextExt<'a>}

impl<'input> SelectItemContextExt<'input>{
	fn new(parent: Option<Rc<dyn athenasqlParserContext<'input> + 'input > >, invoking_state: isize) -> Rc<SelectItemContextAll<'input>> {
		Rc::new(
		SelectItemContextAll::Error(
			BaseParserRuleContext::new_parser_ctx(parent, invoking_state,SelectItemContextExt{
				ph:PhantomData
			}),
		)
		)
	}
}

pub trait SelectItemContextAttrs<'input>: athenasqlParserContext<'input> + BorrowMut<SelectItemContextExt<'input>>{


}

impl<'input> SelectItemContextAttrs<'input> for SelectItemContext<'input>{}

pub type SelectAllContext<'input> = BaseParserRuleContext<'input,SelectAllContextExt<'input>>;

pub trait SelectAllContextAttrs<'input>: athenasqlParserContext<'input>{
	fn qualifiedName(&self) -> Option<Rc<QualifiedNameContextAll<'input>>> where Self:Sized{
		self.child_of_type(0)
	}
	/// Retrieves first TerminalNode corresponding to token ASTERISK
	/// Returns `None` if there is no child corresponding to token ASTERISK
	fn ASTERISK(&self) -> Option<Rc<TerminalNode<'input,athenasqlParserContextType>>> where Self:Sized{
		self.get_token(ASTERISK, 0)
	}
}

impl<'input> SelectAllContextAttrs<'input> for SelectAllContext<'input>{}

pub struct SelectAllContextExt<'input>{
	base:SelectItemContextExt<'input>,
	ph:PhantomData<&'input str>
}

antlr_rust::tid!{SelectAllContextExt<'a>}

impl<'input> athenasqlParserContext<'input> for SelectAllContext<'input>{}

impl<'input,'a> Listenable<dyn athenasqlListener<'input> + 'a> for SelectAllContext<'input>{
	fn enter(&self,listener: &mut (dyn athenasqlListener<'input> + 'a)) {
		listener.enter_every_rule(self);
		listener.enter_selectAll(self);
	}
}

impl<'input> CustomRuleContext<'input> for SelectAllContextExt<'input>{
	type TF = LocalTokenFactory<'input>;
	type Ctx = athenasqlParserContextType;
	fn get_rule_index(&self) -> usize { RULE_selectItem }
	//fn type_rule_index() -> usize where Self: Sized { RULE_selectItem }
}

impl<'input> Borrow<SelectItemContextExt<'input>> for SelectAllContext<'input>{
	fn borrow(&self) -> &SelectItemContextExt<'input> { &self.base }
}
impl<'input> BorrowMut<SelectItemContextExt<'input>> for SelectAllContext<'input>{
	fn borrow_mut(&mut self) -> &mut SelectItemContextExt<'input> { &mut self.base }
}

impl<'input> SelectItemContextAttrs<'input> for SelectAllContext<'input> {}

impl<'input> SelectAllContextExt<'input>{
	fn new(ctx: &dyn SelectItemContextAttrs<'input>) -> Rc<SelectItemContextAll<'input>>  {
		Rc::new(
			SelectItemContextAll::SelectAllContext(
				BaseParserRuleContext::copy_from(ctx,SelectAllContextExt{
        			base: ctx.borrow().clone(),
        			ph:PhantomData
				})
			)
		)
	}
}

pub type SelectSingleContext<'input> = BaseParserRuleContext<'input,SelectSingleContextExt<'input>>;

pub trait SelectSingleContextAttrs<'input>: athenasqlParserContext<'input>{
	fn expression(&self) -> Option<Rc<ExpressionContextAll<'input>>> where Self:Sized{
		self.child_of_type(0)
	}
	fn identifier(&self) -> Option<Rc<IdentifierContextAll<'input>>> where Self:Sized{
		self.child_of_type(0)
	}
	/// Retrieves first TerminalNode corresponding to token AS
	/// Returns `None` if there is no child corresponding to token AS
	fn AS(&self) -> Option<Rc<TerminalNode<'input,athenasqlParserContextType>>> where Self:Sized{
		self.get_token(AS, 0)
	}
}

impl<'input> SelectSingleContextAttrs<'input> for SelectSingleContext<'input>{}

pub struct SelectSingleContextExt<'input>{
	base:SelectItemContextExt<'input>,
	ph:PhantomData<&'input str>
}

antlr_rust::tid!{SelectSingleContextExt<'a>}

impl<'input> athenasqlParserContext<'input> for SelectSingleContext<'input>{}

impl<'input,'a> Listenable<dyn athenasqlListener<'input> + 'a> for SelectSingleContext<'input>{
	fn enter(&self,listener: &mut (dyn athenasqlListener<'input> + 'a)) {
		listener.enter_every_rule(self);
		listener.enter_selectSingle(self);
	}
}

impl<'input> CustomRuleContext<'input> for SelectSingleContextExt<'input>{
	type TF = LocalTokenFactory<'input>;
	type Ctx = athenasqlParserContextType;
	fn get_rule_index(&self) -> usize { RULE_selectItem }
	//fn type_rule_index() -> usize where Self: Sized { RULE_selectItem }
}

impl<'input> Borrow<SelectItemContextExt<'input>> for SelectSingleContext<'input>{
	fn borrow(&self) -> &SelectItemContextExt<'input> { &self.base }
}
impl<'input> BorrowMut<SelectItemContextExt<'input>> for SelectSingleContext<'input>{
	fn borrow_mut(&mut self) -> &mut SelectItemContextExt<'input> { &mut self.base }
}

impl<'input> SelectItemContextAttrs<'input> for SelectSingleContext<'input> {}

impl<'input> SelectSingleContextExt<'input>{
	fn new(ctx: &dyn SelectItemContextAttrs<'input>) -> Rc<SelectItemContextAll<'input>>  {
		Rc::new(
			SelectItemContextAll::SelectSingleContext(
				BaseParserRuleContext::copy_from(ctx,SelectSingleContextExt{
        			base: ctx.borrow().clone(),
        			ph:PhantomData
				})
			)
		)
	}
}

impl<'input, I, H> athenasqlParser<'input, I, H>
where
    I: TokenStream<'input, TF = LocalTokenFactory<'input> > + TidAble<'input>,
    H: ErrorStrategy<'input,BaseParserType<'input,I>>
{
	pub fn selectItem(&mut self,)
	-> Result<Rc<SelectItemContextAll<'input>>,ANTLRError> {
		let mut recog = self;
		let _parentctx = recog.ctx.take();
		let mut _localctx = SelectItemContextExt::new(_parentctx.clone(), recog.base.get_state());
        recog.base.enter_rule(_localctx.clone(), 44, RULE_selectItem);
        let mut _localctx: Rc<SelectItemContextAll> = _localctx;
		let mut _la: isize = -1;
		let result: Result<(), ANTLRError> = (|| {

			recog.base.set_state(743);
			recog.err_handler.sync(&mut recog.base)?;
			match  recog.interpreter.adaptive_predict(87,&mut recog.base)? {
				1 =>{
					let tmp = SelectSingleContextExt::new(&**_localctx);
					recog.base.enter_outer_alt(Some(tmp.clone()), 1);
					_localctx = tmp;
					{
					/*InvokeRule expression*/
					recog.base.set_state(731);
					recog.expression()?;

					recog.base.set_state(736);
					recog.err_handler.sync(&mut recog.base)?;
					match  recog.interpreter.adaptive_predict(86,&mut recog.base)? {
						x if x == 1=>{
							{
							recog.base.set_state(733);
							recog.err_handler.sync(&mut recog.base)?;
							_la = recog.base.input.la(1);
							if _la==AS {
								{
								recog.base.set_state(732);
								recog.base.match_token(AS,&mut recog.err_handler)?;

								}
							}

							/*InvokeRule identifier*/
							recog.base.set_state(735);
							recog.identifier()?;

							}
						}

						_ => {}
					}
					}
				}
			,
				2 =>{
					let tmp = SelectAllContextExt::new(&**_localctx);
					recog.base.enter_outer_alt(Some(tmp.clone()), 2);
					_localctx = tmp;
					{
					/*InvokeRule qualifiedName*/
					recog.base.set_state(738);
					recog.qualifiedName()?;

					recog.base.set_state(739);
					recog.base.match_token(T__0,&mut recog.err_handler)?;

					recog.base.set_state(740);
					recog.base.match_token(ASTERISK,&mut recog.err_handler)?;

					}
				}
			,
				3 =>{
					let tmp = SelectAllContextExt::new(&**_localctx);
					recog.base.enter_outer_alt(Some(tmp.clone()), 3);
					_localctx = tmp;
					{
					recog.base.set_state(742);
					recog.base.match_token(ASTERISK,&mut recog.err_handler)?;

					}
				}

				_ => {}
			}
			Ok(())
		})();
		match result {
		Ok(_)=>{},
        Err(e @ ANTLRError::FallThrough(_)) => return Err(e),
		Err(ref re) => {
				//_localctx.exception = re;
				recog.err_handler.report_error(&mut recog.base, re);
				recog.err_handler.recover(&mut recog.base, re)?;
			}
		}
		recog.base.exit_rule();

		Ok(_localctx)
	}
}
//------------------- relation ----------------
#[derive(Debug)]
pub enum RelationContextAll<'input>{
	RelationDefaultContext(RelationDefaultContext<'input>),
	JoinRelationContext(JoinRelationContext<'input>),
Error(RelationContext<'input>)
}
antlr_rust::tid!{RelationContextAll<'a>}

impl<'input> antlr_rust::parser_rule_context::DerefSeal for RelationContextAll<'input>{}

impl<'input> athenasqlParserContext<'input> for RelationContextAll<'input>{}

impl<'input> Deref for RelationContextAll<'input>{
	type Target = dyn RelationContextAttrs<'input> + 'input;
	fn deref(&self) -> &Self::Target{
		use RelationContextAll::*;
		match self{
			RelationDefaultContext(inner) => inner,
			JoinRelationContext(inner) => inner,
Error(inner) => inner
		}
	}
}
impl<'input,'a> Listenable<dyn athenasqlListener<'input> + 'a> for RelationContextAll<'input>{
    fn enter(&self, listener: &mut (dyn athenasqlListener<'input> + 'a)) { self.deref().enter(listener) }
    fn exit(&self, listener: &mut (dyn athenasqlListener<'input> + 'a)) { self.deref().exit(listener) }
}



pub type RelationContext<'input> = BaseParserRuleContext<'input,RelationContextExt<'input>>;

#[derive(Clone)]
pub struct RelationContextExt<'input>{
ph:PhantomData<&'input str>
}

impl<'input> athenasqlParserContext<'input> for RelationContext<'input>{}

impl<'input,'a> Listenable<dyn athenasqlListener<'input> + 'a> for RelationContext<'input>{
}

impl<'input> CustomRuleContext<'input> for RelationContextExt<'input>{
	type TF = LocalTokenFactory<'input>;
	type Ctx = athenasqlParserContextType;
	fn get_rule_index(&self) -> usize { RULE_relation }
	//fn type_rule_index() -> usize where Self: Sized { RULE_relation }
}
antlr_rust::tid!{RelationContextExt<'a>}

impl<'input> RelationContextExt<'input>{
	fn new(parent: Option<Rc<dyn athenasqlParserContext<'input> + 'input > >, invoking_state: isize) -> Rc<RelationContextAll<'input>> {
		Rc::new(
		RelationContextAll::Error(
			BaseParserRuleContext::new_parser_ctx(parent, invoking_state,RelationContextExt{
				ph:PhantomData
			}),
		)
		)
	}
}

pub trait RelationContextAttrs<'input>: athenasqlParserContext<'input> + BorrowMut<RelationContextExt<'input>>{


}

impl<'input> RelationContextAttrs<'input> for RelationContext<'input>{}

pub type RelationDefaultContext<'input> = BaseParserRuleContext<'input,RelationDefaultContextExt<'input>>;

pub trait RelationDefaultContextAttrs<'input>: athenasqlParserContext<'input>{
	fn sampledRelation(&self) -> Option<Rc<SampledRelationContextAll<'input>>> where Self:Sized{
		self.child_of_type(0)
	}
}

impl<'input> RelationDefaultContextAttrs<'input> for RelationDefaultContext<'input>{}

pub struct RelationDefaultContextExt<'input>{
	base:RelationContextExt<'input>,
	ph:PhantomData<&'input str>
}

antlr_rust::tid!{RelationDefaultContextExt<'a>}

impl<'input> athenasqlParserContext<'input> for RelationDefaultContext<'input>{}

impl<'input,'a> Listenable<dyn athenasqlListener<'input> + 'a> for RelationDefaultContext<'input>{
	fn enter(&self,listener: &mut (dyn athenasqlListener<'input> + 'a)) {
		listener.enter_every_rule(self);
		listener.enter_relationDefault(self);
	}
}

impl<'input> CustomRuleContext<'input> for RelationDefaultContextExt<'input>{
	type TF = LocalTokenFactory<'input>;
	type Ctx = athenasqlParserContextType;
	fn get_rule_index(&self) -> usize { RULE_relation }
	//fn type_rule_index() -> usize where Self: Sized { RULE_relation }
}

impl<'input> Borrow<RelationContextExt<'input>> for RelationDefaultContext<'input>{
	fn borrow(&self) -> &RelationContextExt<'input> { &self.base }
}
impl<'input> BorrowMut<RelationContextExt<'input>> for RelationDefaultContext<'input>{
	fn borrow_mut(&mut self) -> &mut RelationContextExt<'input> { &mut self.base }
}

impl<'input> RelationContextAttrs<'input> for RelationDefaultContext<'input> {}

impl<'input> RelationDefaultContextExt<'input>{
	fn new(ctx: &dyn RelationContextAttrs<'input>) -> Rc<RelationContextAll<'input>>  {
		Rc::new(
			RelationContextAll::RelationDefaultContext(
				BaseParserRuleContext::copy_from(ctx,RelationDefaultContextExt{
        			base: ctx.borrow().clone(),
        			ph:PhantomData
				})
			)
		)
	}
}

pub type JoinRelationContext<'input> = BaseParserRuleContext<'input,JoinRelationContextExt<'input>>;

pub trait JoinRelationContextAttrs<'input>: athenasqlParserContext<'input>{
	fn relation_all(&self) ->  Vec<Rc<RelationContextAll<'input>>> where Self:Sized{
		self.children_of_type()
	}
	fn relation(&self, i: usize) -> Option<Rc<RelationContextAll<'input>>> where Self:Sized{
		self.child_of_type(i)
	}
	/// Retrieves first TerminalNode corresponding to token CROSS
	/// Returns `None` if there is no child corresponding to token CROSS
	fn CROSS(&self) -> Option<Rc<TerminalNode<'input,athenasqlParserContextType>>> where Self:Sized{
		self.get_token(CROSS, 0)
	}
	/// Retrieves first TerminalNode corresponding to token JOIN
	/// Returns `None` if there is no child corresponding to token JOIN
	fn JOIN(&self) -> Option<Rc<TerminalNode<'input,athenasqlParserContextType>>> where Self:Sized{
		self.get_token(JOIN, 0)
	}
	fn joinType(&self) -> Option<Rc<JoinTypeContextAll<'input>>> where Self:Sized{
		self.child_of_type(0)
	}
	fn joinCriteria(&self) -> Option<Rc<JoinCriteriaContextAll<'input>>> where Self:Sized{
		self.child_of_type(0)
	}
	/// Retrieves first TerminalNode corresponding to token NATURAL
	/// Returns `None` if there is no child corresponding to token NATURAL
	fn NATURAL(&self) -> Option<Rc<TerminalNode<'input,athenasqlParserContextType>>> where Self:Sized{
		self.get_token(NATURAL, 0)
	}
	fn sampledRelation(&self) -> Option<Rc<SampledRelationContextAll<'input>>> where Self:Sized{
		self.child_of_type(0)
	}
}

impl<'input> JoinRelationContextAttrs<'input> for JoinRelationContext<'input>{}

pub struct JoinRelationContextExt<'input>{
	base:RelationContextExt<'input>,
	pub left: Option<Rc<RelationContextAll<'input>>>,
	pub right: Option<Rc<SampledRelationContextAll<'input>>>,
	pub rightRelation: Option<Rc<RelationContextAll<'input>>>,
	ph:PhantomData<&'input str>
}

antlr_rust::tid!{JoinRelationContextExt<'a>}

impl<'input> athenasqlParserContext<'input> for JoinRelationContext<'input>{}

impl<'input,'a> Listenable<dyn athenasqlListener<'input> + 'a> for JoinRelationContext<'input>{
	fn enter(&self,listener: &mut (dyn athenasqlListener<'input> + 'a)) {
		listener.enter_every_rule(self);
		listener.enter_joinRelation(self);
	}
}

impl<'input> CustomRuleContext<'input> for JoinRelationContextExt<'input>{
	type TF = LocalTokenFactory<'input>;
	type Ctx = athenasqlParserContextType;
	fn get_rule_index(&self) -> usize { RULE_relation }
	//fn type_rule_index() -> usize where Self: Sized { RULE_relation }
}

impl<'input> Borrow<RelationContextExt<'input>> for JoinRelationContext<'input>{
	fn borrow(&self) -> &RelationContextExt<'input> { &self.base }
}
impl<'input> BorrowMut<RelationContextExt<'input>> for JoinRelationContext<'input>{
	fn borrow_mut(&mut self) -> &mut RelationContextExt<'input> { &mut self.base }
}

impl<'input> RelationContextAttrs<'input> for JoinRelationContext<'input> {}

impl<'input> JoinRelationContextExt<'input>{
	fn new(ctx: &dyn RelationContextAttrs<'input>) -> Rc<RelationContextAll<'input>>  {
		Rc::new(
			RelationContextAll::JoinRelationContext(
				BaseParserRuleContext::copy_from(ctx,JoinRelationContextExt{
        			left:None, right:None, rightRelation:None, 
        			base: ctx.borrow().clone(),
        			ph:PhantomData
				})
			)
		)
	}
}

impl<'input, I, H> athenasqlParser<'input, I, H>
where
    I: TokenStream<'input, TF = LocalTokenFactory<'input> > + TidAble<'input>,
    H: ErrorStrategy<'input,BaseParserType<'input,I>>
{
	pub fn  relation(&mut self,)
	-> Result<Rc<RelationContextAll<'input>>,ANTLRError> {
		self.relation_rec(0)
	}

	fn relation_rec(&mut self, _p: isize)
	-> Result<Rc<RelationContextAll<'input>>,ANTLRError> {
		let recog = self;
		let _parentctx = recog.ctx.take();
		let _parentState = recog.base.get_state();
		let mut _localctx = RelationContextExt::new(_parentctx.clone(), recog.base.get_state());
		recog.base.enter_recursion_rule(_localctx.clone(), 46, RULE_relation, _p);
	    let mut _localctx: Rc<RelationContextAll> = _localctx;
        let mut _prevctx = _localctx.clone();
		let _startState = 46;
		let result: Result<(), ANTLRError> = (|| {
			let mut _alt: isize;
			//recog.base.enter_outer_alt(_localctx.clone(), 1);
			recog.base.enter_outer_alt(None, 1);
			{
			{
			let mut tmp = RelationDefaultContextExt::new(&**_localctx);
			recog.ctx = Some(tmp.clone());
			_localctx = tmp;
			_prevctx = _localctx.clone();


			/*InvokeRule sampledRelation*/
			recog.base.set_state(746);
			recog.sampledRelation()?;

			}

			let tmp = recog.input.lt(-1).cloned();
			recog.ctx.as_ref().unwrap().set_stop(tmp);
			recog.base.set_state(766);
			recog.err_handler.sync(&mut recog.base)?;
			_alt = recog.interpreter.adaptive_predict(89,&mut recog.base)?;
			while { _alt!=2 && _alt!=INVALID_ALT } {
				if _alt==1 {
					recog.trigger_exit_rule_event();
					_prevctx = _localctx.clone();
					{
					{
					/*recRuleLabeledAltStartAction*/
					let mut tmp = JoinRelationContextExt::new(&**RelationContextExt::new(_parentctx.clone(), _parentState));
					if let RelationContextAll::JoinRelationContext(ctx) = cast_mut::<_,RelationContextAll >(&mut tmp){
						ctx.left = Some(_prevctx.clone());
					} else {unreachable!("cant cast");}
					recog.push_new_recursion_context(tmp.clone(), _startState, RULE_relation);
					_localctx = tmp;
					recog.base.set_state(748);
					if !({recog.precpred(None, 2)}) {
						Err(FailedPredicateError::new(&mut recog.base, Some("recog.precpred(None, 2)".to_owned()), None))?;
					}
					recog.base.set_state(762);
					recog.err_handler.sync(&mut recog.base)?;
					match recog.base.input.la(1) {
					 CROSS 
						=> {
							{
							recog.base.set_state(749);
							recog.base.match_token(CROSS,&mut recog.err_handler)?;

							recog.base.set_state(750);
							recog.base.match_token(JOIN,&mut recog.err_handler)?;

							/*InvokeRule sampledRelation*/
							recog.base.set_state(751);
							let tmp = recog.sampledRelation()?;
							if let RelationContextAll::JoinRelationContext(ctx) = cast_mut::<_,RelationContextAll >(&mut _localctx){
							ctx.right = Some(tmp.clone()); } else {unreachable!("cant cast");}  

							}
						}

					 JOIN | INNER | LEFT | RIGHT | FULL 
						=> {
							{
							/*InvokeRule joinType*/
							recog.base.set_state(752);
							recog.joinType()?;

							recog.base.set_state(753);
							recog.base.match_token(JOIN,&mut recog.err_handler)?;

							/*InvokeRule relation*/
							recog.base.set_state(754);
							let tmp = recog.relation_rec(0)?;
							if let RelationContextAll::JoinRelationContext(ctx) = cast_mut::<_,RelationContextAll >(&mut _localctx){
							ctx.rightRelation = Some(tmp.clone()); } else {unreachable!("cant cast");}  

							/*InvokeRule joinCriteria*/
							recog.base.set_state(755);
							recog.joinCriteria()?;

							}
						}

					 NATURAL 
						=> {
							{
							recog.base.set_state(757);
							recog.base.match_token(NATURAL,&mut recog.err_handler)?;

							/*InvokeRule joinType*/
							recog.base.set_state(758);
							recog.joinType()?;

							recog.base.set_state(759);
							recog.base.match_token(JOIN,&mut recog.err_handler)?;

							/*InvokeRule sampledRelation*/
							recog.base.set_state(760);
							let tmp = recog.sampledRelation()?;
							if let RelationContextAll::JoinRelationContext(ctx) = cast_mut::<_,RelationContextAll >(&mut _localctx){
							ctx.right = Some(tmp.clone()); } else {unreachable!("cant cast");}  

							}
						}

						_ => Err(ANTLRError::NoAltError(NoViableAltError::new(&mut recog.base)))?
					}
					}
					} 
				}
				recog.base.set_state(768);
				recog.err_handler.sync(&mut recog.base)?;
				_alt = recog.interpreter.adaptive_predict(89,&mut recog.base)?;
			}
			}
			Ok(())
		})();
		match result {
		Ok(_) => {},
        Err(e @ ANTLRError::FallThrough(_)) => return Err(e),
		Err(ref re)=>{
			//_localctx.exception = re;
			recog.err_handler.report_error(&mut recog.base, re);
	        recog.err_handler.recover(&mut recog.base, re)?;}
		}
		recog.base.unroll_recursion_context(_parentctx);

		Ok(_localctx)
	}
}
//------------------- joinType ----------------
pub type JoinTypeContextAll<'input> = JoinTypeContext<'input>;


pub type JoinTypeContext<'input> = BaseParserRuleContext<'input,JoinTypeContextExt<'input>>;

#[derive(Clone)]
pub struct JoinTypeContextExt<'input>{
ph:PhantomData<&'input str>
}

impl<'input> athenasqlParserContext<'input> for JoinTypeContext<'input>{}

impl<'input,'a> Listenable<dyn athenasqlListener<'input> + 'a> for JoinTypeContext<'input>{
		fn enter(&self,listener: &mut (dyn athenasqlListener<'input> + 'a)) {
			listener.enter_every_rule(self);
			listener.enter_joinType(self);
		}fn exit(&self,listener: &mut (dyn athenasqlListener<'input> + 'a)) {
			listener.exit_joinType(self);
			listener.exit_every_rule(self);
		}
}

impl<'input> CustomRuleContext<'input> for JoinTypeContextExt<'input>{
	type TF = LocalTokenFactory<'input>;
	type Ctx = athenasqlParserContextType;
	fn get_rule_index(&self) -> usize { RULE_joinType }
	//fn type_rule_index() -> usize where Self: Sized { RULE_joinType }
}
antlr_rust::tid!{JoinTypeContextExt<'a>}

impl<'input> JoinTypeContextExt<'input>{
	fn new(parent: Option<Rc<dyn athenasqlParserContext<'input> + 'input > >, invoking_state: isize) -> Rc<JoinTypeContextAll<'input>> {
		Rc::new(
			BaseParserRuleContext::new_parser_ctx(parent, invoking_state,JoinTypeContextExt{
				ph:PhantomData
			}),
		)
	}
}

pub trait JoinTypeContextAttrs<'input>: athenasqlParserContext<'input> + BorrowMut<JoinTypeContextExt<'input>>{

/// Retrieves first TerminalNode corresponding to token INNER
/// Returns `None` if there is no child corresponding to token INNER
fn INNER(&self) -> Option<Rc<TerminalNode<'input,athenasqlParserContextType>>> where Self:Sized{
	self.get_token(INNER, 0)
}
/// Retrieves first TerminalNode corresponding to token LEFT
/// Returns `None` if there is no child corresponding to token LEFT
fn LEFT(&self) -> Option<Rc<TerminalNode<'input,athenasqlParserContextType>>> where Self:Sized{
	self.get_token(LEFT, 0)
}
/// Retrieves first TerminalNode corresponding to token OUTER
/// Returns `None` if there is no child corresponding to token OUTER
fn OUTER(&self) -> Option<Rc<TerminalNode<'input,athenasqlParserContextType>>> where Self:Sized{
	self.get_token(OUTER, 0)
}
/// Retrieves first TerminalNode corresponding to token RIGHT
/// Returns `None` if there is no child corresponding to token RIGHT
fn RIGHT(&self) -> Option<Rc<TerminalNode<'input,athenasqlParserContextType>>> where Self:Sized{
	self.get_token(RIGHT, 0)
}
/// Retrieves first TerminalNode corresponding to token FULL
/// Returns `None` if there is no child corresponding to token FULL
fn FULL(&self) -> Option<Rc<TerminalNode<'input,athenasqlParserContextType>>> where Self:Sized{
	self.get_token(FULL, 0)
}

}

impl<'input> JoinTypeContextAttrs<'input> for JoinTypeContext<'input>{}

impl<'input, I, H> athenasqlParser<'input, I, H>
where
    I: TokenStream<'input, TF = LocalTokenFactory<'input> > + TidAble<'input>,
    H: ErrorStrategy<'input,BaseParserType<'input,I>>
{
	pub fn joinType(&mut self,)
	-> Result<Rc<JoinTypeContextAll<'input>>,ANTLRError> {
		let mut recog = self;
		let _parentctx = recog.ctx.take();
		let mut _localctx = JoinTypeContextExt::new(_parentctx.clone(), recog.base.get_state());
        recog.base.enter_rule(_localctx.clone(), 48, RULE_joinType);
        let mut _localctx: Rc<JoinTypeContextAll> = _localctx;
		let mut _la: isize = -1;
		let result: Result<(), ANTLRError> = (|| {

			recog.base.set_state(784);
			recog.err_handler.sync(&mut recog.base)?;
			match recog.base.input.la(1) {
			 JOIN | INNER 
				=> {
					//recog.base.enter_outer_alt(_localctx.clone(), 1);
					recog.base.enter_outer_alt(None, 1);
					{
					recog.base.set_state(770);
					recog.err_handler.sync(&mut recog.base)?;
					_la = recog.base.input.la(1);
					if _la==INNER {
						{
						recog.base.set_state(769);
						recog.base.match_token(INNER,&mut recog.err_handler)?;

						}
					}

					}
				}

			 LEFT 
				=> {
					//recog.base.enter_outer_alt(_localctx.clone(), 2);
					recog.base.enter_outer_alt(None, 2);
					{
					recog.base.set_state(772);
					recog.base.match_token(LEFT,&mut recog.err_handler)?;

					recog.base.set_state(774);
					recog.err_handler.sync(&mut recog.base)?;
					_la = recog.base.input.la(1);
					if _la==OUTER {
						{
						recog.base.set_state(773);
						recog.base.match_token(OUTER,&mut recog.err_handler)?;

						}
					}

					}
				}

			 RIGHT 
				=> {
					//recog.base.enter_outer_alt(_localctx.clone(), 3);
					recog.base.enter_outer_alt(None, 3);
					{
					recog.base.set_state(776);
					recog.base.match_token(RIGHT,&mut recog.err_handler)?;

					recog.base.set_state(778);
					recog.err_handler.sync(&mut recog.base)?;
					_la = recog.base.input.la(1);
					if _la==OUTER {
						{
						recog.base.set_state(777);
						recog.base.match_token(OUTER,&mut recog.err_handler)?;

						}
					}

					}
				}

			 FULL 
				=> {
					//recog.base.enter_outer_alt(_localctx.clone(), 4);
					recog.base.enter_outer_alt(None, 4);
					{
					recog.base.set_state(780);
					recog.base.match_token(FULL,&mut recog.err_handler)?;

					recog.base.set_state(782);
					recog.err_handler.sync(&mut recog.base)?;
					_la = recog.base.input.la(1);
					if _la==OUTER {
						{
						recog.base.set_state(781);
						recog.base.match_token(OUTER,&mut recog.err_handler)?;

						}
					}

					}
				}

				_ => Err(ANTLRError::NoAltError(NoViableAltError::new(&mut recog.base)))?
			}
			Ok(())
		})();
		match result {
		Ok(_)=>{},
        Err(e @ ANTLRError::FallThrough(_)) => return Err(e),
		Err(ref re) => {
				//_localctx.exception = re;
				recog.err_handler.report_error(&mut recog.base, re);
				recog.err_handler.recover(&mut recog.base, re)?;
			}
		}
		recog.base.exit_rule();

		Ok(_localctx)
	}
}
//------------------- joinCriteria ----------------
pub type JoinCriteriaContextAll<'input> = JoinCriteriaContext<'input>;


pub type JoinCriteriaContext<'input> = BaseParserRuleContext<'input,JoinCriteriaContextExt<'input>>;

#[derive(Clone)]
pub struct JoinCriteriaContextExt<'input>{
ph:PhantomData<&'input str>
}

impl<'input> athenasqlParserContext<'input> for JoinCriteriaContext<'input>{}

impl<'input,'a> Listenable<dyn athenasqlListener<'input> + 'a> for JoinCriteriaContext<'input>{
		fn enter(&self,listener: &mut (dyn athenasqlListener<'input> + 'a)) {
			listener.enter_every_rule(self);
			listener.enter_joinCriteria(self);
		}fn exit(&self,listener: &mut (dyn athenasqlListener<'input> + 'a)) {
			listener.exit_joinCriteria(self);
			listener.exit_every_rule(self);
		}
}

impl<'input> CustomRuleContext<'input> for JoinCriteriaContextExt<'input>{
	type TF = LocalTokenFactory<'input>;
	type Ctx = athenasqlParserContextType;
	fn get_rule_index(&self) -> usize { RULE_joinCriteria }
	//fn type_rule_index() -> usize where Self: Sized { RULE_joinCriteria }
}
antlr_rust::tid!{JoinCriteriaContextExt<'a>}

impl<'input> JoinCriteriaContextExt<'input>{
	fn new(parent: Option<Rc<dyn athenasqlParserContext<'input> + 'input > >, invoking_state: isize) -> Rc<JoinCriteriaContextAll<'input>> {
		Rc::new(
			BaseParserRuleContext::new_parser_ctx(parent, invoking_state,JoinCriteriaContextExt{
				ph:PhantomData
			}),
		)
	}
}

pub trait JoinCriteriaContextAttrs<'input>: athenasqlParserContext<'input> + BorrowMut<JoinCriteriaContextExt<'input>>{

/// Retrieves first TerminalNode corresponding to token ON
/// Returns `None` if there is no child corresponding to token ON
fn ON(&self) -> Option<Rc<TerminalNode<'input,athenasqlParserContextType>>> where Self:Sized{
	self.get_token(ON, 0)
}
fn booleanExpression(&self) -> Option<Rc<BooleanExpressionContextAll<'input>>> where Self:Sized{
	self.child_of_type(0)
}
/// Retrieves first TerminalNode corresponding to token USING
/// Returns `None` if there is no child corresponding to token USING
fn USING(&self) -> Option<Rc<TerminalNode<'input,athenasqlParserContextType>>> where Self:Sized{
	self.get_token(USING, 0)
}
fn identifier_all(&self) ->  Vec<Rc<IdentifierContextAll<'input>>> where Self:Sized{
	self.children_of_type()
}
fn identifier(&self, i: usize) -> Option<Rc<IdentifierContextAll<'input>>> where Self:Sized{
	self.child_of_type(i)
}

}

impl<'input> JoinCriteriaContextAttrs<'input> for JoinCriteriaContext<'input>{}

impl<'input, I, H> athenasqlParser<'input, I, H>
where
    I: TokenStream<'input, TF = LocalTokenFactory<'input> > + TidAble<'input>,
    H: ErrorStrategy<'input,BaseParserType<'input,I>>
{
	pub fn joinCriteria(&mut self,)
	-> Result<Rc<JoinCriteriaContextAll<'input>>,ANTLRError> {
		let mut recog = self;
		let _parentctx = recog.ctx.take();
		let mut _localctx = JoinCriteriaContextExt::new(_parentctx.clone(), recog.base.get_state());
        recog.base.enter_rule(_localctx.clone(), 50, RULE_joinCriteria);
        let mut _localctx: Rc<JoinCriteriaContextAll> = _localctx;
		let mut _la: isize = -1;
		let result: Result<(), ANTLRError> = (|| {

			recog.base.set_state(800);
			recog.err_handler.sync(&mut recog.base)?;
			match recog.base.input.la(1) {
			 ON 
				=> {
					//recog.base.enter_outer_alt(_localctx.clone(), 1);
					recog.base.enter_outer_alt(None, 1);
					{
					recog.base.set_state(786);
					recog.base.match_token(ON,&mut recog.err_handler)?;

					/*InvokeRule booleanExpression*/
					recog.base.set_state(787);
					recog.booleanExpression_rec(0)?;

					}
				}

			 USING 
				=> {
					//recog.base.enter_outer_alt(_localctx.clone(), 2);
					recog.base.enter_outer_alt(None, 2);
					{
					recog.base.set_state(788);
					recog.base.match_token(USING,&mut recog.err_handler)?;

					recog.base.set_state(789);
					recog.base.match_token(T__1,&mut recog.err_handler)?;

					/*InvokeRule identifier*/
					recog.base.set_state(790);
					recog.identifier()?;

					recog.base.set_state(795);
					recog.err_handler.sync(&mut recog.base)?;
					_la = recog.base.input.la(1);
					while _la==T__2 {
						{
						{
						recog.base.set_state(791);
						recog.base.match_token(T__2,&mut recog.err_handler)?;

						/*InvokeRule identifier*/
						recog.base.set_state(792);
						recog.identifier()?;

						}
						}
						recog.base.set_state(797);
						recog.err_handler.sync(&mut recog.base)?;
						_la = recog.base.input.la(1);
					}
					recog.base.set_state(798);
					recog.base.match_token(T__3,&mut recog.err_handler)?;

					}
				}

				_ => Err(ANTLRError::NoAltError(NoViableAltError::new(&mut recog.base)))?
			}
			Ok(())
		})();
		match result {
		Ok(_)=>{},
        Err(e @ ANTLRError::FallThrough(_)) => return Err(e),
		Err(ref re) => {
				//_localctx.exception = re;
				recog.err_handler.report_error(&mut recog.base, re);
				recog.err_handler.recover(&mut recog.base, re)?;
			}
		}
		recog.base.exit_rule();

		Ok(_localctx)
	}
}
//------------------- sampledRelation ----------------
pub type SampledRelationContextAll<'input> = SampledRelationContext<'input>;


pub type SampledRelationContext<'input> = BaseParserRuleContext<'input,SampledRelationContextExt<'input>>;

#[derive(Clone)]
pub struct SampledRelationContextExt<'input>{
	pub percentage: Option<Rc<ExpressionContextAll<'input>>>,
ph:PhantomData<&'input str>
}

impl<'input> athenasqlParserContext<'input> for SampledRelationContext<'input>{}

impl<'input,'a> Listenable<dyn athenasqlListener<'input> + 'a> for SampledRelationContext<'input>{
		fn enter(&self,listener: &mut (dyn athenasqlListener<'input> + 'a)) {
			listener.enter_every_rule(self);
			listener.enter_sampledRelation(self);
		}fn exit(&self,listener: &mut (dyn athenasqlListener<'input> + 'a)) {
			listener.exit_sampledRelation(self);
			listener.exit_every_rule(self);
		}
}

impl<'input> CustomRuleContext<'input> for SampledRelationContextExt<'input>{
	type TF = LocalTokenFactory<'input>;
	type Ctx = athenasqlParserContextType;
	fn get_rule_index(&self) -> usize { RULE_sampledRelation }
	//fn type_rule_index() -> usize where Self: Sized { RULE_sampledRelation }
}
antlr_rust::tid!{SampledRelationContextExt<'a>}

impl<'input> SampledRelationContextExt<'input>{
	fn new(parent: Option<Rc<dyn athenasqlParserContext<'input> + 'input > >, invoking_state: isize) -> Rc<SampledRelationContextAll<'input>> {
		Rc::new(
			BaseParserRuleContext::new_parser_ctx(parent, invoking_state,SampledRelationContextExt{
				percentage: None, 
				ph:PhantomData
			}),
		)
	}
}

pub trait SampledRelationContextAttrs<'input>: athenasqlParserContext<'input> + BorrowMut<SampledRelationContextExt<'input>>{

fn aliasedRelation(&self) -> Option<Rc<AliasedRelationContextAll<'input>>> where Self:Sized{
	self.child_of_type(0)
}
/// Retrieves first TerminalNode corresponding to token TABLESAMPLE
/// Returns `None` if there is no child corresponding to token TABLESAMPLE
fn TABLESAMPLE(&self) -> Option<Rc<TerminalNode<'input,athenasqlParserContextType>>> where Self:Sized{
	self.get_token(TABLESAMPLE, 0)
}
fn sampleType(&self) -> Option<Rc<SampleTypeContextAll<'input>>> where Self:Sized{
	self.child_of_type(0)
}
fn expression(&self) -> Option<Rc<ExpressionContextAll<'input>>> where Self:Sized{
	self.child_of_type(0)
}

}

impl<'input> SampledRelationContextAttrs<'input> for SampledRelationContext<'input>{}

impl<'input, I, H> athenasqlParser<'input, I, H>
where
    I: TokenStream<'input, TF = LocalTokenFactory<'input> > + TidAble<'input>,
    H: ErrorStrategy<'input,BaseParserType<'input,I>>
{
	pub fn sampledRelation(&mut self,)
	-> Result<Rc<SampledRelationContextAll<'input>>,ANTLRError> {
		let mut recog = self;
		let _parentctx = recog.ctx.take();
		let mut _localctx = SampledRelationContextExt::new(_parentctx.clone(), recog.base.get_state());
        recog.base.enter_rule(_localctx.clone(), 52, RULE_sampledRelation);
        let mut _localctx: Rc<SampledRelationContextAll> = _localctx;
		let result: Result<(), ANTLRError> = (|| {

			//recog.base.enter_outer_alt(_localctx.clone(), 1);
			recog.base.enter_outer_alt(None, 1);
			{
			/*InvokeRule aliasedRelation*/
			recog.base.set_state(802);
			recog.aliasedRelation()?;

			recog.base.set_state(809);
			recog.err_handler.sync(&mut recog.base)?;
			match  recog.interpreter.adaptive_predict(97,&mut recog.base)? {
				x if x == 1=>{
					{
					recog.base.set_state(803);
					recog.base.match_token(TABLESAMPLE,&mut recog.err_handler)?;

					/*InvokeRule sampleType*/
					recog.base.set_state(804);
					recog.sampleType()?;

					recog.base.set_state(805);
					recog.base.match_token(T__1,&mut recog.err_handler)?;

					/*InvokeRule expression*/
					recog.base.set_state(806);
					let tmp = recog.expression()?;
					 cast_mut::<_,SampledRelationContext >(&mut _localctx).percentage = Some(tmp.clone());
					  

					recog.base.set_state(807);
					recog.base.match_token(T__3,&mut recog.err_handler)?;

					}
				}

				_ => {}
			}
			}
			Ok(())
		})();
		match result {
		Ok(_)=>{},
        Err(e @ ANTLRError::FallThrough(_)) => return Err(e),
		Err(ref re) => {
				//_localctx.exception = re;
				recog.err_handler.report_error(&mut recog.base, re);
				recog.err_handler.recover(&mut recog.base, re)?;
			}
		}
		recog.base.exit_rule();

		Ok(_localctx)
	}
}
//------------------- sampleType ----------------
pub type SampleTypeContextAll<'input> = SampleTypeContext<'input>;


pub type SampleTypeContext<'input> = BaseParserRuleContext<'input,SampleTypeContextExt<'input>>;

#[derive(Clone)]
pub struct SampleTypeContextExt<'input>{
ph:PhantomData<&'input str>
}

impl<'input> athenasqlParserContext<'input> for SampleTypeContext<'input>{}

impl<'input,'a> Listenable<dyn athenasqlListener<'input> + 'a> for SampleTypeContext<'input>{
		fn enter(&self,listener: &mut (dyn athenasqlListener<'input> + 'a)) {
			listener.enter_every_rule(self);
			listener.enter_sampleType(self);
		}fn exit(&self,listener: &mut (dyn athenasqlListener<'input> + 'a)) {
			listener.exit_sampleType(self);
			listener.exit_every_rule(self);
		}
}

impl<'input> CustomRuleContext<'input> for SampleTypeContextExt<'input>{
	type TF = LocalTokenFactory<'input>;
	type Ctx = athenasqlParserContextType;
	fn get_rule_index(&self) -> usize { RULE_sampleType }
	//fn type_rule_index() -> usize where Self: Sized { RULE_sampleType }
}
antlr_rust::tid!{SampleTypeContextExt<'a>}

impl<'input> SampleTypeContextExt<'input>{
	fn new(parent: Option<Rc<dyn athenasqlParserContext<'input> + 'input > >, invoking_state: isize) -> Rc<SampleTypeContextAll<'input>> {
		Rc::new(
			BaseParserRuleContext::new_parser_ctx(parent, invoking_state,SampleTypeContextExt{
				ph:PhantomData
			}),
		)
	}
}

pub trait SampleTypeContextAttrs<'input>: athenasqlParserContext<'input> + BorrowMut<SampleTypeContextExt<'input>>{

/// Retrieves first TerminalNode corresponding to token BERNOULLI
/// Returns `None` if there is no child corresponding to token BERNOULLI
fn BERNOULLI(&self) -> Option<Rc<TerminalNode<'input,athenasqlParserContextType>>> where Self:Sized{
	self.get_token(BERNOULLI, 0)
}
/// Retrieves first TerminalNode corresponding to token SYSTEM
/// Returns `None` if there is no child corresponding to token SYSTEM
fn SYSTEM(&self) -> Option<Rc<TerminalNode<'input,athenasqlParserContextType>>> where Self:Sized{
	self.get_token(SYSTEM, 0)
}
/// Retrieves first TerminalNode corresponding to token POISSONIZED
/// Returns `None` if there is no child corresponding to token POISSONIZED
fn POISSONIZED(&self) -> Option<Rc<TerminalNode<'input,athenasqlParserContextType>>> where Self:Sized{
	self.get_token(POISSONIZED, 0)
}

}

impl<'input> SampleTypeContextAttrs<'input> for SampleTypeContext<'input>{}

impl<'input, I, H> athenasqlParser<'input, I, H>
where
    I: TokenStream<'input, TF = LocalTokenFactory<'input> > + TidAble<'input>,
    H: ErrorStrategy<'input,BaseParserType<'input,I>>
{
	pub fn sampleType(&mut self,)
	-> Result<Rc<SampleTypeContextAll<'input>>,ANTLRError> {
		let mut recog = self;
		let _parentctx = recog.ctx.take();
		let mut _localctx = SampleTypeContextExt::new(_parentctx.clone(), recog.base.get_state());
        recog.base.enter_rule(_localctx.clone(), 54, RULE_sampleType);
        let mut _localctx: Rc<SampleTypeContextAll> = _localctx;
		let mut _la: isize = -1;
		let result: Result<(), ANTLRError> = (|| {

			//recog.base.enter_outer_alt(_localctx.clone(), 1);
			recog.base.enter_outer_alt(None, 1);
			{
			recog.base.set_state(811);
			_la = recog.base.input.la(1);
			if { !(((((_la - 139)) & !0x3f) == 0 && ((1usize << (_la - 139)) & ((1usize << (SYSTEM - 139)) | (1usize << (BERNOULLI - 139)) | (1usize << (POISSONIZED - 139)))) != 0)) } {
				recog.err_handler.recover_inline(&mut recog.base)?;

			}
			else {
				if  recog.base.input.la(1)==TOKEN_EOF { recog.base.matched_eof = true };
				recog.err_handler.report_match(&mut recog.base);
				recog.base.consume(&mut recog.err_handler);
			}
			}
			Ok(())
		})();
		match result {
		Ok(_)=>{},
        Err(e @ ANTLRError::FallThrough(_)) => return Err(e),
		Err(ref re) => {
				//_localctx.exception = re;
				recog.err_handler.report_error(&mut recog.base, re);
				recog.err_handler.recover(&mut recog.base, re)?;
			}
		}
		recog.base.exit_rule();

		Ok(_localctx)
	}
}
//------------------- aliasedRelation ----------------
pub type AliasedRelationContextAll<'input> = AliasedRelationContext<'input>;


pub type AliasedRelationContext<'input> = BaseParserRuleContext<'input,AliasedRelationContextExt<'input>>;

#[derive(Clone)]
pub struct AliasedRelationContextExt<'input>{
ph:PhantomData<&'input str>
}

impl<'input> athenasqlParserContext<'input> for AliasedRelationContext<'input>{}

impl<'input,'a> Listenable<dyn athenasqlListener<'input> + 'a> for AliasedRelationContext<'input>{
		fn enter(&self,listener: &mut (dyn athenasqlListener<'input> + 'a)) {
			listener.enter_every_rule(self);
			listener.enter_aliasedRelation(self);
		}fn exit(&self,listener: &mut (dyn athenasqlListener<'input> + 'a)) {
			listener.exit_aliasedRelation(self);
			listener.exit_every_rule(self);
		}
}

impl<'input> CustomRuleContext<'input> for AliasedRelationContextExt<'input>{
	type TF = LocalTokenFactory<'input>;
	type Ctx = athenasqlParserContextType;
	fn get_rule_index(&self) -> usize { RULE_aliasedRelation }
	//fn type_rule_index() -> usize where Self: Sized { RULE_aliasedRelation }
}
antlr_rust::tid!{AliasedRelationContextExt<'a>}

impl<'input> AliasedRelationContextExt<'input>{
	fn new(parent: Option<Rc<dyn athenasqlParserContext<'input> + 'input > >, invoking_state: isize) -> Rc<AliasedRelationContextAll<'input>> {
		Rc::new(
			BaseParserRuleContext::new_parser_ctx(parent, invoking_state,AliasedRelationContextExt{
				ph:PhantomData
			}),
		)
	}
}

pub trait AliasedRelationContextAttrs<'input>: athenasqlParserContext<'input> + BorrowMut<AliasedRelationContextExt<'input>>{

fn relationPrimary(&self) -> Option<Rc<RelationPrimaryContextAll<'input>>> where Self:Sized{
	self.child_of_type(0)
}
fn identifier(&self) -> Option<Rc<IdentifierContextAll<'input>>> where Self:Sized{
	self.child_of_type(0)
}
/// Retrieves first TerminalNode corresponding to token AS
/// Returns `None` if there is no child corresponding to token AS
fn AS(&self) -> Option<Rc<TerminalNode<'input,athenasqlParserContextType>>> where Self:Sized{
	self.get_token(AS, 0)
}
fn columnAliases(&self) -> Option<Rc<ColumnAliasesContextAll<'input>>> where Self:Sized{
	self.child_of_type(0)
}

}

impl<'input> AliasedRelationContextAttrs<'input> for AliasedRelationContext<'input>{}

impl<'input, I, H> athenasqlParser<'input, I, H>
where
    I: TokenStream<'input, TF = LocalTokenFactory<'input> > + TidAble<'input>,
    H: ErrorStrategy<'input,BaseParserType<'input,I>>
{
	pub fn aliasedRelation(&mut self,)
	-> Result<Rc<AliasedRelationContextAll<'input>>,ANTLRError> {
		let mut recog = self;
		let _parentctx = recog.ctx.take();
		let mut _localctx = AliasedRelationContextExt::new(_parentctx.clone(), recog.base.get_state());
        recog.base.enter_rule(_localctx.clone(), 56, RULE_aliasedRelation);
        let mut _localctx: Rc<AliasedRelationContextAll> = _localctx;
		let mut _la: isize = -1;
		let result: Result<(), ANTLRError> = (|| {

			//recog.base.enter_outer_alt(_localctx.clone(), 1);
			recog.base.enter_outer_alt(None, 1);
			{
			/*InvokeRule relationPrimary*/
			recog.base.set_state(813);
			recog.relationPrimary()?;

			recog.base.set_state(821);
			recog.err_handler.sync(&mut recog.base)?;
			match  recog.interpreter.adaptive_predict(100,&mut recog.base)? {
				x if x == 1=>{
					{
					recog.base.set_state(815);
					recog.err_handler.sync(&mut recog.base)?;
					_la = recog.base.input.la(1);
					if _la==AS {
						{
						recog.base.set_state(814);
						recog.base.match_token(AS,&mut recog.err_handler)?;

						}
					}

					/*InvokeRule identifier*/
					recog.base.set_state(817);
					recog.identifier()?;

					recog.base.set_state(819);
					recog.err_handler.sync(&mut recog.base)?;
					match  recog.interpreter.adaptive_predict(99,&mut recog.base)? {
						x if x == 1=>{
							{
							/*InvokeRule columnAliases*/
							recog.base.set_state(818);
							recog.columnAliases()?;

							}
						}

						_ => {}
					}
					}
				}

				_ => {}
			}
			}
			Ok(())
		})();
		match result {
		Ok(_)=>{},
        Err(e @ ANTLRError::FallThrough(_)) => return Err(e),
		Err(ref re) => {
				//_localctx.exception = re;
				recog.err_handler.report_error(&mut recog.base, re);
				recog.err_handler.recover(&mut recog.base, re)?;
			}
		}
		recog.base.exit_rule();

		Ok(_localctx)
	}
}
//------------------- columnAliases ----------------
pub type ColumnAliasesContextAll<'input> = ColumnAliasesContext<'input>;


pub type ColumnAliasesContext<'input> = BaseParserRuleContext<'input,ColumnAliasesContextExt<'input>>;

#[derive(Clone)]
pub struct ColumnAliasesContextExt<'input>{
ph:PhantomData<&'input str>
}

impl<'input> athenasqlParserContext<'input> for ColumnAliasesContext<'input>{}

impl<'input,'a> Listenable<dyn athenasqlListener<'input> + 'a> for ColumnAliasesContext<'input>{
		fn enter(&self,listener: &mut (dyn athenasqlListener<'input> + 'a)) {
			listener.enter_every_rule(self);
			listener.enter_columnAliases(self);
		}fn exit(&self,listener: &mut (dyn athenasqlListener<'input> + 'a)) {
			listener.exit_columnAliases(self);
			listener.exit_every_rule(self);
		}
}

impl<'input> CustomRuleContext<'input> for ColumnAliasesContextExt<'input>{
	type TF = LocalTokenFactory<'input>;
	type Ctx = athenasqlParserContextType;
	fn get_rule_index(&self) -> usize { RULE_columnAliases }
	//fn type_rule_index() -> usize where Self: Sized { RULE_columnAliases }
}
antlr_rust::tid!{ColumnAliasesContextExt<'a>}

impl<'input> ColumnAliasesContextExt<'input>{
	fn new(parent: Option<Rc<dyn athenasqlParserContext<'input> + 'input > >, invoking_state: isize) -> Rc<ColumnAliasesContextAll<'input>> {
		Rc::new(
			BaseParserRuleContext::new_parser_ctx(parent, invoking_state,ColumnAliasesContextExt{
				ph:PhantomData
			}),
		)
	}
}

pub trait ColumnAliasesContextAttrs<'input>: athenasqlParserContext<'input> + BorrowMut<ColumnAliasesContextExt<'input>>{

fn identifier_all(&self) ->  Vec<Rc<IdentifierContextAll<'input>>> where Self:Sized{
	self.children_of_type()
}
fn identifier(&self, i: usize) -> Option<Rc<IdentifierContextAll<'input>>> where Self:Sized{
	self.child_of_type(i)
}

}

impl<'input> ColumnAliasesContextAttrs<'input> for ColumnAliasesContext<'input>{}

impl<'input, I, H> athenasqlParser<'input, I, H>
where
    I: TokenStream<'input, TF = LocalTokenFactory<'input> > + TidAble<'input>,
    H: ErrorStrategy<'input,BaseParserType<'input,I>>
{
	pub fn columnAliases(&mut self,)
	-> Result<Rc<ColumnAliasesContextAll<'input>>,ANTLRError> {
		let mut recog = self;
		let _parentctx = recog.ctx.take();
		let mut _localctx = ColumnAliasesContextExt::new(_parentctx.clone(), recog.base.get_state());
        recog.base.enter_rule(_localctx.clone(), 58, RULE_columnAliases);
        let mut _localctx: Rc<ColumnAliasesContextAll> = _localctx;
		let mut _la: isize = -1;
		let result: Result<(), ANTLRError> = (|| {

			//recog.base.enter_outer_alt(_localctx.clone(), 1);
			recog.base.enter_outer_alt(None, 1);
			{
			recog.base.set_state(823);
			recog.base.match_token(T__1,&mut recog.err_handler)?;

			/*InvokeRule identifier*/
			recog.base.set_state(824);
			recog.identifier()?;

			recog.base.set_state(829);
			recog.err_handler.sync(&mut recog.base)?;
			_la = recog.base.input.la(1);
			while _la==T__2 {
				{
				{
				recog.base.set_state(825);
				recog.base.match_token(T__2,&mut recog.err_handler)?;

				/*InvokeRule identifier*/
				recog.base.set_state(826);
				recog.identifier()?;

				}
				}
				recog.base.set_state(831);
				recog.err_handler.sync(&mut recog.base)?;
				_la = recog.base.input.la(1);
			}
			recog.base.set_state(832);
			recog.base.match_token(T__3,&mut recog.err_handler)?;

			}
			Ok(())
		})();
		match result {
		Ok(_)=>{},
        Err(e @ ANTLRError::FallThrough(_)) => return Err(e),
		Err(ref re) => {
				//_localctx.exception = re;
				recog.err_handler.report_error(&mut recog.base, re);
				recog.err_handler.recover(&mut recog.base, re)?;
			}
		}
		recog.base.exit_rule();

		Ok(_localctx)
	}
}
//------------------- relationPrimary ----------------
#[derive(Debug)]
pub enum RelationPrimaryContextAll<'input>{
	SubqueryRelationContext(SubqueryRelationContext<'input>),
	ParenthesizedRelationContext(ParenthesizedRelationContext<'input>),
	UnnestContext(UnnestContext<'input>),
	TableNameContext(TableNameContext<'input>),
Error(RelationPrimaryContext<'input>)
}
antlr_rust::tid!{RelationPrimaryContextAll<'a>}

impl<'input> antlr_rust::parser_rule_context::DerefSeal for RelationPrimaryContextAll<'input>{}

impl<'input> athenasqlParserContext<'input> for RelationPrimaryContextAll<'input>{}

impl<'input> Deref for RelationPrimaryContextAll<'input>{
	type Target = dyn RelationPrimaryContextAttrs<'input> + 'input;
	fn deref(&self) -> &Self::Target{
		use RelationPrimaryContextAll::*;
		match self{
			SubqueryRelationContext(inner) => inner,
			ParenthesizedRelationContext(inner) => inner,
			UnnestContext(inner) => inner,
			TableNameContext(inner) => inner,
Error(inner) => inner
		}
	}
}
impl<'input,'a> Listenable<dyn athenasqlListener<'input> + 'a> for RelationPrimaryContextAll<'input>{
    fn enter(&self, listener: &mut (dyn athenasqlListener<'input> + 'a)) { self.deref().enter(listener) }
    fn exit(&self, listener: &mut (dyn athenasqlListener<'input> + 'a)) { self.deref().exit(listener) }
}



pub type RelationPrimaryContext<'input> = BaseParserRuleContext<'input,RelationPrimaryContextExt<'input>>;

#[derive(Clone)]
pub struct RelationPrimaryContextExt<'input>{
ph:PhantomData<&'input str>
}

impl<'input> athenasqlParserContext<'input> for RelationPrimaryContext<'input>{}

impl<'input,'a> Listenable<dyn athenasqlListener<'input> + 'a> for RelationPrimaryContext<'input>{
}

impl<'input> CustomRuleContext<'input> for RelationPrimaryContextExt<'input>{
	type TF = LocalTokenFactory<'input>;
	type Ctx = athenasqlParserContextType;
	fn get_rule_index(&self) -> usize { RULE_relationPrimary }
	//fn type_rule_index() -> usize where Self: Sized { RULE_relationPrimary }
}
antlr_rust::tid!{RelationPrimaryContextExt<'a>}

impl<'input> RelationPrimaryContextExt<'input>{
	fn new(parent: Option<Rc<dyn athenasqlParserContext<'input> + 'input > >, invoking_state: isize) -> Rc<RelationPrimaryContextAll<'input>> {
		Rc::new(
		RelationPrimaryContextAll::Error(
			BaseParserRuleContext::new_parser_ctx(parent, invoking_state,RelationPrimaryContextExt{
				ph:PhantomData
			}),
		)
		)
	}
}

pub trait RelationPrimaryContextAttrs<'input>: athenasqlParserContext<'input> + BorrowMut<RelationPrimaryContextExt<'input>>{


}

impl<'input> RelationPrimaryContextAttrs<'input> for RelationPrimaryContext<'input>{}

pub type SubqueryRelationContext<'input> = BaseParserRuleContext<'input,SubqueryRelationContextExt<'input>>;

pub trait SubqueryRelationContextAttrs<'input>: athenasqlParserContext<'input>{
	fn query(&self) -> Option<Rc<QueryContextAll<'input>>> where Self:Sized{
		self.child_of_type(0)
	}
}

impl<'input> SubqueryRelationContextAttrs<'input> for SubqueryRelationContext<'input>{}

pub struct SubqueryRelationContextExt<'input>{
	base:RelationPrimaryContextExt<'input>,
	ph:PhantomData<&'input str>
}

antlr_rust::tid!{SubqueryRelationContextExt<'a>}

impl<'input> athenasqlParserContext<'input> for SubqueryRelationContext<'input>{}

impl<'input,'a> Listenable<dyn athenasqlListener<'input> + 'a> for SubqueryRelationContext<'input>{
	fn enter(&self,listener: &mut (dyn athenasqlListener<'input> + 'a)) {
		listener.enter_every_rule(self);
		listener.enter_subqueryRelation(self);
	}
}

impl<'input> CustomRuleContext<'input> for SubqueryRelationContextExt<'input>{
	type TF = LocalTokenFactory<'input>;
	type Ctx = athenasqlParserContextType;
	fn get_rule_index(&self) -> usize { RULE_relationPrimary }
	//fn type_rule_index() -> usize where Self: Sized { RULE_relationPrimary }
}

impl<'input> Borrow<RelationPrimaryContextExt<'input>> for SubqueryRelationContext<'input>{
	fn borrow(&self) -> &RelationPrimaryContextExt<'input> { &self.base }
}
impl<'input> BorrowMut<RelationPrimaryContextExt<'input>> for SubqueryRelationContext<'input>{
	fn borrow_mut(&mut self) -> &mut RelationPrimaryContextExt<'input> { &mut self.base }
}

impl<'input> RelationPrimaryContextAttrs<'input> for SubqueryRelationContext<'input> {}

impl<'input> SubqueryRelationContextExt<'input>{
	fn new(ctx: &dyn RelationPrimaryContextAttrs<'input>) -> Rc<RelationPrimaryContextAll<'input>>  {
		Rc::new(
			RelationPrimaryContextAll::SubqueryRelationContext(
				BaseParserRuleContext::copy_from(ctx,SubqueryRelationContextExt{
        			base: ctx.borrow().clone(),
        			ph:PhantomData
				})
			)
		)
	}
}

pub type ParenthesizedRelationContext<'input> = BaseParserRuleContext<'input,ParenthesizedRelationContextExt<'input>>;

pub trait ParenthesizedRelationContextAttrs<'input>: athenasqlParserContext<'input>{
	fn relation(&self) -> Option<Rc<RelationContextAll<'input>>> where Self:Sized{
		self.child_of_type(0)
	}
}

impl<'input> ParenthesizedRelationContextAttrs<'input> for ParenthesizedRelationContext<'input>{}

pub struct ParenthesizedRelationContextExt<'input>{
	base:RelationPrimaryContextExt<'input>,
	ph:PhantomData<&'input str>
}

antlr_rust::tid!{ParenthesizedRelationContextExt<'a>}

impl<'input> athenasqlParserContext<'input> for ParenthesizedRelationContext<'input>{}

impl<'input,'a> Listenable<dyn athenasqlListener<'input> + 'a> for ParenthesizedRelationContext<'input>{
	fn enter(&self,listener: &mut (dyn athenasqlListener<'input> + 'a)) {
		listener.enter_every_rule(self);
		listener.enter_parenthesizedRelation(self);
	}
}

impl<'input> CustomRuleContext<'input> for ParenthesizedRelationContextExt<'input>{
	type TF = LocalTokenFactory<'input>;
	type Ctx = athenasqlParserContextType;
	fn get_rule_index(&self) -> usize { RULE_relationPrimary }
	//fn type_rule_index() -> usize where Self: Sized { RULE_relationPrimary }
}

impl<'input> Borrow<RelationPrimaryContextExt<'input>> for ParenthesizedRelationContext<'input>{
	fn borrow(&self) -> &RelationPrimaryContextExt<'input> { &self.base }
}
impl<'input> BorrowMut<RelationPrimaryContextExt<'input>> for ParenthesizedRelationContext<'input>{
	fn borrow_mut(&mut self) -> &mut RelationPrimaryContextExt<'input> { &mut self.base }
}

impl<'input> RelationPrimaryContextAttrs<'input> for ParenthesizedRelationContext<'input> {}

impl<'input> ParenthesizedRelationContextExt<'input>{
	fn new(ctx: &dyn RelationPrimaryContextAttrs<'input>) -> Rc<RelationPrimaryContextAll<'input>>  {
		Rc::new(
			RelationPrimaryContextAll::ParenthesizedRelationContext(
				BaseParserRuleContext::copy_from(ctx,ParenthesizedRelationContextExt{
        			base: ctx.borrow().clone(),
        			ph:PhantomData
				})
			)
		)
	}
}

pub type UnnestContext<'input> = BaseParserRuleContext<'input,UnnestContextExt<'input>>;

pub trait UnnestContextAttrs<'input>: athenasqlParserContext<'input>{
	/// Retrieves first TerminalNode corresponding to token UNNEST
	/// Returns `None` if there is no child corresponding to token UNNEST
	fn UNNEST(&self) -> Option<Rc<TerminalNode<'input,athenasqlParserContextType>>> where Self:Sized{
		self.get_token(UNNEST, 0)
	}
	fn expression_all(&self) ->  Vec<Rc<ExpressionContextAll<'input>>> where Self:Sized{
		self.children_of_type()
	}
	fn expression(&self, i: usize) -> Option<Rc<ExpressionContextAll<'input>>> where Self:Sized{
		self.child_of_type(i)
	}
	/// Retrieves first TerminalNode corresponding to token WITH
	/// Returns `None` if there is no child corresponding to token WITH
	fn WITH(&self) -> Option<Rc<TerminalNode<'input,athenasqlParserContextType>>> where Self:Sized{
		self.get_token(WITH, 0)
	}
	/// Retrieves first TerminalNode corresponding to token ORDINALITY
	/// Returns `None` if there is no child corresponding to token ORDINALITY
	fn ORDINALITY(&self) -> Option<Rc<TerminalNode<'input,athenasqlParserContextType>>> where Self:Sized{
		self.get_token(ORDINALITY, 0)
	}
}

impl<'input> UnnestContextAttrs<'input> for UnnestContext<'input>{}

pub struct UnnestContextExt<'input>{
	base:RelationPrimaryContextExt<'input>,
	ph:PhantomData<&'input str>
}

antlr_rust::tid!{UnnestContextExt<'a>}

impl<'input> athenasqlParserContext<'input> for UnnestContext<'input>{}

impl<'input,'a> Listenable<dyn athenasqlListener<'input> + 'a> for UnnestContext<'input>{
	fn enter(&self,listener: &mut (dyn athenasqlListener<'input> + 'a)) {
		listener.enter_every_rule(self);
		listener.enter_unnest(self);
	}
}

impl<'input> CustomRuleContext<'input> for UnnestContextExt<'input>{
	type TF = LocalTokenFactory<'input>;
	type Ctx = athenasqlParserContextType;
	fn get_rule_index(&self) -> usize { RULE_relationPrimary }
	//fn type_rule_index() -> usize where Self: Sized { RULE_relationPrimary }
}

impl<'input> Borrow<RelationPrimaryContextExt<'input>> for UnnestContext<'input>{
	fn borrow(&self) -> &RelationPrimaryContextExt<'input> { &self.base }
}
impl<'input> BorrowMut<RelationPrimaryContextExt<'input>> for UnnestContext<'input>{
	fn borrow_mut(&mut self) -> &mut RelationPrimaryContextExt<'input> { &mut self.base }
}

impl<'input> RelationPrimaryContextAttrs<'input> for UnnestContext<'input> {}

impl<'input> UnnestContextExt<'input>{
	fn new(ctx: &dyn RelationPrimaryContextAttrs<'input>) -> Rc<RelationPrimaryContextAll<'input>>  {
		Rc::new(
			RelationPrimaryContextAll::UnnestContext(
				BaseParserRuleContext::copy_from(ctx,UnnestContextExt{
        			base: ctx.borrow().clone(),
        			ph:PhantomData
				})
			)
		)
	}
}

pub type TableNameContext<'input> = BaseParserRuleContext<'input,TableNameContextExt<'input>>;

pub trait TableNameContextAttrs<'input>: athenasqlParserContext<'input>{
	fn tableReference(&self) -> Option<Rc<TableReferenceContextAll<'input>>> where Self:Sized{
		self.child_of_type(0)
	}
}

impl<'input> TableNameContextAttrs<'input> for TableNameContext<'input>{}

pub struct TableNameContextExt<'input>{
	base:RelationPrimaryContextExt<'input>,
	ph:PhantomData<&'input str>
}

antlr_rust::tid!{TableNameContextExt<'a>}

impl<'input> athenasqlParserContext<'input> for TableNameContext<'input>{}

impl<'input,'a> Listenable<dyn athenasqlListener<'input> + 'a> for TableNameContext<'input>{
	fn enter(&self,listener: &mut (dyn athenasqlListener<'input> + 'a)) {
		listener.enter_every_rule(self);
		listener.enter_tableName(self);
	}
}

impl<'input> CustomRuleContext<'input> for TableNameContextExt<'input>{
	type TF = LocalTokenFactory<'input>;
	type Ctx = athenasqlParserContextType;
	fn get_rule_index(&self) -> usize { RULE_relationPrimary }
	//fn type_rule_index() -> usize where Self: Sized { RULE_relationPrimary }
}

impl<'input> Borrow<RelationPrimaryContextExt<'input>> for TableNameContext<'input>{
	fn borrow(&self) -> &RelationPrimaryContextExt<'input> { &self.base }
}
impl<'input> BorrowMut<RelationPrimaryContextExt<'input>> for TableNameContext<'input>{
	fn borrow_mut(&mut self) -> &mut RelationPrimaryContextExt<'input> { &mut self.base }
}

impl<'input> RelationPrimaryContextAttrs<'input> for TableNameContext<'input> {}

impl<'input> TableNameContextExt<'input>{
	fn new(ctx: &dyn RelationPrimaryContextAttrs<'input>) -> Rc<RelationPrimaryContextAll<'input>>  {
		Rc::new(
			RelationPrimaryContextAll::TableNameContext(
				BaseParserRuleContext::copy_from(ctx,TableNameContextExt{
        			base: ctx.borrow().clone(),
        			ph:PhantomData
				})
			)
		)
	}
}

impl<'input, I, H> athenasqlParser<'input, I, H>
where
    I: TokenStream<'input, TF = LocalTokenFactory<'input> > + TidAble<'input>,
    H: ErrorStrategy<'input,BaseParserType<'input,I>>
{
	pub fn relationPrimary(&mut self,)
	-> Result<Rc<RelationPrimaryContextAll<'input>>,ANTLRError> {
		let mut recog = self;
		let _parentctx = recog.ctx.take();
		let mut _localctx = RelationPrimaryContextExt::new(_parentctx.clone(), recog.base.get_state());
        recog.base.enter_rule(_localctx.clone(), 60, RULE_relationPrimary);
        let mut _localctx: Rc<RelationPrimaryContextAll> = _localctx;
		let mut _la: isize = -1;
		let result: Result<(), ANTLRError> = (|| {

			recog.base.set_state(858);
			recog.err_handler.sync(&mut recog.base)?;
			match  recog.interpreter.adaptive_predict(104,&mut recog.base)? {
				1 =>{
					let tmp = TableNameContextExt::new(&**_localctx);
					recog.base.enter_outer_alt(Some(tmp.clone()), 1);
					_localctx = tmp;
					{
					/*InvokeRule tableReference*/
					recog.base.set_state(834);
					recog.tableReference()?;

					}
				}
			,
				2 =>{
					let tmp = SubqueryRelationContextExt::new(&**_localctx);
					recog.base.enter_outer_alt(Some(tmp.clone()), 2);
					_localctx = tmp;
					{
					recog.base.set_state(835);
					recog.base.match_token(T__1,&mut recog.err_handler)?;

					/*InvokeRule query*/
					recog.base.set_state(836);
					recog.query()?;

					recog.base.set_state(837);
					recog.base.match_token(T__3,&mut recog.err_handler)?;

					}
				}
			,
				3 =>{
					let tmp = UnnestContextExt::new(&**_localctx);
					recog.base.enter_outer_alt(Some(tmp.clone()), 3);
					_localctx = tmp;
					{
					recog.base.set_state(839);
					recog.base.match_token(UNNEST,&mut recog.err_handler)?;

					recog.base.set_state(840);
					recog.base.match_token(T__1,&mut recog.err_handler)?;

					/*InvokeRule expression*/
					recog.base.set_state(841);
					recog.expression()?;

					recog.base.set_state(846);
					recog.err_handler.sync(&mut recog.base)?;
					_la = recog.base.input.la(1);
					while _la==T__2 {
						{
						{
						recog.base.set_state(842);
						recog.base.match_token(T__2,&mut recog.err_handler)?;

						/*InvokeRule expression*/
						recog.base.set_state(843);
						recog.expression()?;

						}
						}
						recog.base.set_state(848);
						recog.err_handler.sync(&mut recog.base)?;
						_la = recog.base.input.la(1);
					}
					recog.base.set_state(849);
					recog.base.match_token(T__3,&mut recog.err_handler)?;

					recog.base.set_state(852);
					recog.err_handler.sync(&mut recog.base)?;
					match  recog.interpreter.adaptive_predict(103,&mut recog.base)? {
						x if x == 1=>{
							{
							recog.base.set_state(850);
							recog.base.match_token(WITH,&mut recog.err_handler)?;

							recog.base.set_state(851);
							recog.base.match_token(ORDINALITY,&mut recog.err_handler)?;

							}
						}

						_ => {}
					}
					}
				}
			,
				4 =>{
					let tmp = ParenthesizedRelationContextExt::new(&**_localctx);
					recog.base.enter_outer_alt(Some(tmp.clone()), 4);
					_localctx = tmp;
					{
					recog.base.set_state(854);
					recog.base.match_token(T__1,&mut recog.err_handler)?;

					/*InvokeRule relation*/
					recog.base.set_state(855);
					recog.relation_rec(0)?;

					recog.base.set_state(856);
					recog.base.match_token(T__3,&mut recog.err_handler)?;

					}
				}

				_ => {}
			}
			Ok(())
		})();
		match result {
		Ok(_)=>{},
        Err(e @ ANTLRError::FallThrough(_)) => return Err(e),
		Err(ref re) => {
				//_localctx.exception = re;
				recog.err_handler.report_error(&mut recog.base, re);
				recog.err_handler.recover(&mut recog.base, re)?;
			}
		}
		recog.base.exit_rule();

		Ok(_localctx)
	}
}
//------------------- tableReference ----------------
pub type TableReferenceContextAll<'input> = TableReferenceContext<'input>;


pub type TableReferenceContext<'input> = BaseParserRuleContext<'input,TableReferenceContextExt<'input>>;

#[derive(Clone)]
pub struct TableReferenceContextExt<'input>{
ph:PhantomData<&'input str>
}

impl<'input> athenasqlParserContext<'input> for TableReferenceContext<'input>{}

impl<'input,'a> Listenable<dyn athenasqlListener<'input> + 'a> for TableReferenceContext<'input>{
		fn enter(&self,listener: &mut (dyn athenasqlListener<'input> + 'a)) {
			listener.enter_every_rule(self);
			listener.enter_tableReference(self);
		}fn exit(&self,listener: &mut (dyn athenasqlListener<'input> + 'a)) {
			listener.exit_tableReference(self);
			listener.exit_every_rule(self);
		}
}

impl<'input> CustomRuleContext<'input> for TableReferenceContextExt<'input>{
	type TF = LocalTokenFactory<'input>;
	type Ctx = athenasqlParserContextType;
	fn get_rule_index(&self) -> usize { RULE_tableReference }
	//fn type_rule_index() -> usize where Self: Sized { RULE_tableReference }
}
antlr_rust::tid!{TableReferenceContextExt<'a>}

impl<'input> TableReferenceContextExt<'input>{
	fn new(parent: Option<Rc<dyn athenasqlParserContext<'input> + 'input > >, invoking_state: isize) -> Rc<TableReferenceContextAll<'input>> {
		Rc::new(
			BaseParserRuleContext::new_parser_ctx(parent, invoking_state,TableReferenceContextExt{
				ph:PhantomData
			}),
		)
	}
}

pub trait TableReferenceContextAttrs<'input>: athenasqlParserContext<'input> + BorrowMut<TableReferenceContextExt<'input>>{

fn qualifiedName(&self) -> Option<Rc<QualifiedNameContextAll<'input>>> where Self:Sized{
	self.child_of_type(0)
}

}

impl<'input> TableReferenceContextAttrs<'input> for TableReferenceContext<'input>{}

impl<'input, I, H> athenasqlParser<'input, I, H>
where
    I: TokenStream<'input, TF = LocalTokenFactory<'input> > + TidAble<'input>,
    H: ErrorStrategy<'input,BaseParserType<'input,I>>
{
	pub fn tableReference(&mut self,)
	-> Result<Rc<TableReferenceContextAll<'input>>,ANTLRError> {
		let mut recog = self;
		let _parentctx = recog.ctx.take();
		let mut _localctx = TableReferenceContextExt::new(_parentctx.clone(), recog.base.get_state());
        recog.base.enter_rule(_localctx.clone(), 62, RULE_tableReference);
        let mut _localctx: Rc<TableReferenceContextAll> = _localctx;
		let result: Result<(), ANTLRError> = (|| {

			//recog.base.enter_outer_alt(_localctx.clone(), 1);
			recog.base.enter_outer_alt(None, 1);
			{
			/*InvokeRule qualifiedName*/
			recog.base.set_state(860);
			recog.qualifiedName()?;

			}
			Ok(())
		})();
		match result {
		Ok(_)=>{},
        Err(e @ ANTLRError::FallThrough(_)) => return Err(e),
		Err(ref re) => {
				//_localctx.exception = re;
				recog.err_handler.report_error(&mut recog.base, re);
				recog.err_handler.recover(&mut recog.base, re)?;
			}
		}
		recog.base.exit_rule();

		Ok(_localctx)
	}
}
//------------------- expression ----------------
pub type ExpressionContextAll<'input> = ExpressionContext<'input>;


pub type ExpressionContext<'input> = BaseParserRuleContext<'input,ExpressionContextExt<'input>>;

#[derive(Clone)]
pub struct ExpressionContextExt<'input>{
ph:PhantomData<&'input str>
}

impl<'input> athenasqlParserContext<'input> for ExpressionContext<'input>{}

impl<'input,'a> Listenable<dyn athenasqlListener<'input> + 'a> for ExpressionContext<'input>{
		fn enter(&self,listener: &mut (dyn athenasqlListener<'input> + 'a)) {
			listener.enter_every_rule(self);
			listener.enter_expression(self);
		}fn exit(&self,listener: &mut (dyn athenasqlListener<'input> + 'a)) {
			listener.exit_expression(self);
			listener.exit_every_rule(self);
		}
}

impl<'input> CustomRuleContext<'input> for ExpressionContextExt<'input>{
	type TF = LocalTokenFactory<'input>;
	type Ctx = athenasqlParserContextType;
	fn get_rule_index(&self) -> usize { RULE_expression }
	//fn type_rule_index() -> usize where Self: Sized { RULE_expression }
}
antlr_rust::tid!{ExpressionContextExt<'a>}

impl<'input> ExpressionContextExt<'input>{
	fn new(parent: Option<Rc<dyn athenasqlParserContext<'input> + 'input > >, invoking_state: isize) -> Rc<ExpressionContextAll<'input>> {
		Rc::new(
			BaseParserRuleContext::new_parser_ctx(parent, invoking_state,ExpressionContextExt{
				ph:PhantomData
			}),
		)
	}
}

pub trait ExpressionContextAttrs<'input>: athenasqlParserContext<'input> + BorrowMut<ExpressionContextExt<'input>>{

fn booleanExpression(&self) -> Option<Rc<BooleanExpressionContextAll<'input>>> where Self:Sized{
	self.child_of_type(0)
}

}

impl<'input> ExpressionContextAttrs<'input> for ExpressionContext<'input>{}

impl<'input, I, H> athenasqlParser<'input, I, H>
where
    I: TokenStream<'input, TF = LocalTokenFactory<'input> > + TidAble<'input>,
    H: ErrorStrategy<'input,BaseParserType<'input,I>>
{
	pub fn expression(&mut self,)
	-> Result<Rc<ExpressionContextAll<'input>>,ANTLRError> {
		let mut recog = self;
		let _parentctx = recog.ctx.take();
		let mut _localctx = ExpressionContextExt::new(_parentctx.clone(), recog.base.get_state());
        recog.base.enter_rule(_localctx.clone(), 64, RULE_expression);
        let mut _localctx: Rc<ExpressionContextAll> = _localctx;
		let result: Result<(), ANTLRError> = (|| {

			//recog.base.enter_outer_alt(_localctx.clone(), 1);
			recog.base.enter_outer_alt(None, 1);
			{
			/*InvokeRule booleanExpression*/
			recog.base.set_state(862);
			recog.booleanExpression_rec(0)?;

			}
			Ok(())
		})();
		match result {
		Ok(_)=>{},
        Err(e @ ANTLRError::FallThrough(_)) => return Err(e),
		Err(ref re) => {
				//_localctx.exception = re;
				recog.err_handler.report_error(&mut recog.base, re);
				recog.err_handler.recover(&mut recog.base, re)?;
			}
		}
		recog.base.exit_rule();

		Ok(_localctx)
	}
}
//------------------- booleanExpression ----------------
#[derive(Debug)]
pub enum BooleanExpressionContextAll<'input>{
	LogicalNotContext(LogicalNotContext<'input>),
	BooleanDefaultContext(BooleanDefaultContext<'input>),
	LogicalBinaryContext(LogicalBinaryContext<'input>),
Error(BooleanExpressionContext<'input>)
}
antlr_rust::tid!{BooleanExpressionContextAll<'a>}

impl<'input> antlr_rust::parser_rule_context::DerefSeal for BooleanExpressionContextAll<'input>{}

impl<'input> athenasqlParserContext<'input> for BooleanExpressionContextAll<'input>{}

impl<'input> Deref for BooleanExpressionContextAll<'input>{
	type Target = dyn BooleanExpressionContextAttrs<'input> + 'input;
	fn deref(&self) -> &Self::Target{
		use BooleanExpressionContextAll::*;
		match self{
			LogicalNotContext(inner) => inner,
			BooleanDefaultContext(inner) => inner,
			LogicalBinaryContext(inner) => inner,
Error(inner) => inner
		}
	}
}
impl<'input,'a> Listenable<dyn athenasqlListener<'input> + 'a> for BooleanExpressionContextAll<'input>{
    fn enter(&self, listener: &mut (dyn athenasqlListener<'input> + 'a)) { self.deref().enter(listener) }
    fn exit(&self, listener: &mut (dyn athenasqlListener<'input> + 'a)) { self.deref().exit(listener) }
}



pub type BooleanExpressionContext<'input> = BaseParserRuleContext<'input,BooleanExpressionContextExt<'input>>;

#[derive(Clone)]
pub struct BooleanExpressionContextExt<'input>{
ph:PhantomData<&'input str>
}

impl<'input> athenasqlParserContext<'input> for BooleanExpressionContext<'input>{}

impl<'input,'a> Listenable<dyn athenasqlListener<'input> + 'a> for BooleanExpressionContext<'input>{
}

impl<'input> CustomRuleContext<'input> for BooleanExpressionContextExt<'input>{
	type TF = LocalTokenFactory<'input>;
	type Ctx = athenasqlParserContextType;
	fn get_rule_index(&self) -> usize { RULE_booleanExpression }
	//fn type_rule_index() -> usize where Self: Sized { RULE_booleanExpression }
}
antlr_rust::tid!{BooleanExpressionContextExt<'a>}

impl<'input> BooleanExpressionContextExt<'input>{
	fn new(parent: Option<Rc<dyn athenasqlParserContext<'input> + 'input > >, invoking_state: isize) -> Rc<BooleanExpressionContextAll<'input>> {
		Rc::new(
		BooleanExpressionContextAll::Error(
			BaseParserRuleContext::new_parser_ctx(parent, invoking_state,BooleanExpressionContextExt{
				ph:PhantomData
			}),
		)
		)
	}
}

pub trait BooleanExpressionContextAttrs<'input>: athenasqlParserContext<'input> + BorrowMut<BooleanExpressionContextExt<'input>>{


}

impl<'input> BooleanExpressionContextAttrs<'input> for BooleanExpressionContext<'input>{}

pub type LogicalNotContext<'input> = BaseParserRuleContext<'input,LogicalNotContextExt<'input>>;

pub trait LogicalNotContextAttrs<'input>: athenasqlParserContext<'input>{
	/// Retrieves first TerminalNode corresponding to token NOT
	/// Returns `None` if there is no child corresponding to token NOT
	fn NOT(&self) -> Option<Rc<TerminalNode<'input,athenasqlParserContextType>>> where Self:Sized{
		self.get_token(NOT, 0)
	}
	fn booleanExpression(&self) -> Option<Rc<BooleanExpressionContextAll<'input>>> where Self:Sized{
		self.child_of_type(0)
	}
}

impl<'input> LogicalNotContextAttrs<'input> for LogicalNotContext<'input>{}

pub struct LogicalNotContextExt<'input>{
	base:BooleanExpressionContextExt<'input>,
	ph:PhantomData<&'input str>
}

antlr_rust::tid!{LogicalNotContextExt<'a>}

impl<'input> athenasqlParserContext<'input> for LogicalNotContext<'input>{}

impl<'input,'a> Listenable<dyn athenasqlListener<'input> + 'a> for LogicalNotContext<'input>{
	fn enter(&self,listener: &mut (dyn athenasqlListener<'input> + 'a)) {
		listener.enter_every_rule(self);
		listener.enter_logicalNot(self);
	}
}

impl<'input> CustomRuleContext<'input> for LogicalNotContextExt<'input>{
	type TF = LocalTokenFactory<'input>;
	type Ctx = athenasqlParserContextType;
	fn get_rule_index(&self) -> usize { RULE_booleanExpression }
	//fn type_rule_index() -> usize where Self: Sized { RULE_booleanExpression }
}

impl<'input> Borrow<BooleanExpressionContextExt<'input>> for LogicalNotContext<'input>{
	fn borrow(&self) -> &BooleanExpressionContextExt<'input> { &self.base }
}
impl<'input> BorrowMut<BooleanExpressionContextExt<'input>> for LogicalNotContext<'input>{
	fn borrow_mut(&mut self) -> &mut BooleanExpressionContextExt<'input> { &mut self.base }
}

impl<'input> BooleanExpressionContextAttrs<'input> for LogicalNotContext<'input> {}

impl<'input> LogicalNotContextExt<'input>{
	fn new(ctx: &dyn BooleanExpressionContextAttrs<'input>) -> Rc<BooleanExpressionContextAll<'input>>  {
		Rc::new(
			BooleanExpressionContextAll::LogicalNotContext(
				BaseParserRuleContext::copy_from(ctx,LogicalNotContextExt{
        			base: ctx.borrow().clone(),
        			ph:PhantomData
				})
			)
		)
	}
}

pub type BooleanDefaultContext<'input> = BaseParserRuleContext<'input,BooleanDefaultContextExt<'input>>;

pub trait BooleanDefaultContextAttrs<'input>: athenasqlParserContext<'input>{
	fn predicated(&self) -> Option<Rc<PredicatedContextAll<'input>>> where Self:Sized{
		self.child_of_type(0)
	}
}

impl<'input> BooleanDefaultContextAttrs<'input> for BooleanDefaultContext<'input>{}

pub struct BooleanDefaultContextExt<'input>{
	base:BooleanExpressionContextExt<'input>,
	ph:PhantomData<&'input str>
}

antlr_rust::tid!{BooleanDefaultContextExt<'a>}

impl<'input> athenasqlParserContext<'input> for BooleanDefaultContext<'input>{}

impl<'input,'a> Listenable<dyn athenasqlListener<'input> + 'a> for BooleanDefaultContext<'input>{
	fn enter(&self,listener: &mut (dyn athenasqlListener<'input> + 'a)) {
		listener.enter_every_rule(self);
		listener.enter_booleanDefault(self);
	}
}

impl<'input> CustomRuleContext<'input> for BooleanDefaultContextExt<'input>{
	type TF = LocalTokenFactory<'input>;
	type Ctx = athenasqlParserContextType;
	fn get_rule_index(&self) -> usize { RULE_booleanExpression }
	//fn type_rule_index() -> usize where Self: Sized { RULE_booleanExpression }
}

impl<'input> Borrow<BooleanExpressionContextExt<'input>> for BooleanDefaultContext<'input>{
	fn borrow(&self) -> &BooleanExpressionContextExt<'input> { &self.base }
}
impl<'input> BorrowMut<BooleanExpressionContextExt<'input>> for BooleanDefaultContext<'input>{
	fn borrow_mut(&mut self) -> &mut BooleanExpressionContextExt<'input> { &mut self.base }
}

impl<'input> BooleanExpressionContextAttrs<'input> for BooleanDefaultContext<'input> {}

impl<'input> BooleanDefaultContextExt<'input>{
	fn new(ctx: &dyn BooleanExpressionContextAttrs<'input>) -> Rc<BooleanExpressionContextAll<'input>>  {
		Rc::new(
			BooleanExpressionContextAll::BooleanDefaultContext(
				BaseParserRuleContext::copy_from(ctx,BooleanDefaultContextExt{
        			base: ctx.borrow().clone(),
        			ph:PhantomData
				})
			)
		)
	}
}

pub type LogicalBinaryContext<'input> = BaseParserRuleContext<'input,LogicalBinaryContextExt<'input>>;

pub trait LogicalBinaryContextAttrs<'input>: athenasqlParserContext<'input>{
	fn booleanExpression_all(&self) ->  Vec<Rc<BooleanExpressionContextAll<'input>>> where Self:Sized{
		self.children_of_type()
	}
	fn booleanExpression(&self, i: usize) -> Option<Rc<BooleanExpressionContextAll<'input>>> where Self:Sized{
		self.child_of_type(i)
	}
	/// Retrieves first TerminalNode corresponding to token AND
	/// Returns `None` if there is no child corresponding to token AND
	fn AND(&self) -> Option<Rc<TerminalNode<'input,athenasqlParserContextType>>> where Self:Sized{
		self.get_token(AND, 0)
	}
	/// Retrieves first TerminalNode corresponding to token OR
	/// Returns `None` if there is no child corresponding to token OR
	fn OR(&self) -> Option<Rc<TerminalNode<'input,athenasqlParserContextType>>> where Self:Sized{
		self.get_token(OR, 0)
	}
}

impl<'input> LogicalBinaryContextAttrs<'input> for LogicalBinaryContext<'input>{}

pub struct LogicalBinaryContextExt<'input>{
	base:BooleanExpressionContextExt<'input>,
	pub left: Option<Rc<BooleanExpressionContextAll<'input>>>,
	pub operator: Option<TokenType<'input>>,
	pub right: Option<Rc<BooleanExpressionContextAll<'input>>>,
	ph:PhantomData<&'input str>
}

antlr_rust::tid!{LogicalBinaryContextExt<'a>}

impl<'input> athenasqlParserContext<'input> for LogicalBinaryContext<'input>{}

impl<'input,'a> Listenable<dyn athenasqlListener<'input> + 'a> for LogicalBinaryContext<'input>{
	fn enter(&self,listener: &mut (dyn athenasqlListener<'input> + 'a)) {
		listener.enter_every_rule(self);
		listener.enter_logicalBinary(self);
	}
}

impl<'input> CustomRuleContext<'input> for LogicalBinaryContextExt<'input>{
	type TF = LocalTokenFactory<'input>;
	type Ctx = athenasqlParserContextType;
	fn get_rule_index(&self) -> usize { RULE_booleanExpression }
	//fn type_rule_index() -> usize where Self: Sized { RULE_booleanExpression }
}

impl<'input> Borrow<BooleanExpressionContextExt<'input>> for LogicalBinaryContext<'input>{
	fn borrow(&self) -> &BooleanExpressionContextExt<'input> { &self.base }
}
impl<'input> BorrowMut<BooleanExpressionContextExt<'input>> for LogicalBinaryContext<'input>{
	fn borrow_mut(&mut self) -> &mut BooleanExpressionContextExt<'input> { &mut self.base }
}

impl<'input> BooleanExpressionContextAttrs<'input> for LogicalBinaryContext<'input> {}

impl<'input> LogicalBinaryContextExt<'input>{
	fn new(ctx: &dyn BooleanExpressionContextAttrs<'input>) -> Rc<BooleanExpressionContextAll<'input>>  {
		Rc::new(
			BooleanExpressionContextAll::LogicalBinaryContext(
				BaseParserRuleContext::copy_from(ctx,LogicalBinaryContextExt{
					operator:None, 
        			left:None, right:None, 
        			base: ctx.borrow().clone(),
        			ph:PhantomData
				})
			)
		)
	}
}

impl<'input, I, H> athenasqlParser<'input, I, H>
where
    I: TokenStream<'input, TF = LocalTokenFactory<'input> > + TidAble<'input>,
    H: ErrorStrategy<'input,BaseParserType<'input,I>>
{
	pub fn  booleanExpression(&mut self,)
	-> Result<Rc<BooleanExpressionContextAll<'input>>,ANTLRError> {
		self.booleanExpression_rec(0)
	}

	fn booleanExpression_rec(&mut self, _p: isize)
	-> Result<Rc<BooleanExpressionContextAll<'input>>,ANTLRError> {
		let recog = self;
		let _parentctx = recog.ctx.take();
		let _parentState = recog.base.get_state();
		let mut _localctx = BooleanExpressionContextExt::new(_parentctx.clone(), recog.base.get_state());
		recog.base.enter_recursion_rule(_localctx.clone(), 66, RULE_booleanExpression, _p);
	    let mut _localctx: Rc<BooleanExpressionContextAll> = _localctx;
        let mut _prevctx = _localctx.clone();
		let _startState = 66;
		let result: Result<(), ANTLRError> = (|| {
			let mut _alt: isize;
			//recog.base.enter_outer_alt(_localctx.clone(), 1);
			recog.base.enter_outer_alt(None, 1);
			{
			recog.base.set_state(868);
			recog.err_handler.sync(&mut recog.base)?;
			match recog.base.input.la(1) {
			 T__1 | T__4 | ADD | ALL | SOME | ANY | AT | NO | EXISTS | NULL | TRUE |
			 FALSE | SUBSTRING | POSITION | TINYINT | SMALLINT | INTEGER | DATE |
			 TIME | TIMESTAMP | INTERVAL | YEAR | MONTH | DAY | HOUR | MINUTE | SECOND |
			 ZONE | CURRENT_DATE | CURRENT_TIME | CURRENT_TIMESTAMP | LOCALTIME |
			 LOCALTIMESTAMP | EXTRACT | CASE | FILTER | OVER | PARTITION | RANGE |
			 ROWS | PRECEDING | FOLLOWING | CURRENT | ROW | SCHEMA | COMMENT | VIEW |
			 REPLACE | GRANT | REVOKE | PRIVILEGES | PUBLIC | OPTION | EXPLAIN | ANALYZE |
			 FORMAT | TYPE | TEXT | GRAPHVIZ | LOGICAL | DISTRIBUTED | VALIDATE |
			 CAST | TRY_CAST | SHOW | TABLES | SCHEMAS | CATALOGS | COLUMNS | COLUMN |
			 USE | PARTITIONS | FUNCTIONS | TO | SYSTEM | BERNOULLI | POISSONIZED |
			 TABLESAMPLE | ARRAY | MAP | SET | RESET | SESSION | DATA | START | TRANSACTION |
			 COMMIT | ROLLBACK | WORK | ISOLATION | LEVEL | SERIALIZABLE | REPEATABLE |
			 COMMITTED | UNCOMMITTED | READ | WRITE | ONLY | CALL | INPUT | OUTPUT |
			 CASCADE | RESTRICT | INCLUDING | EXCLUDING | PROPERTIES | NORMALIZE |
			 NFD | NFC | NFKD | NFKC | IF | NULLIF | COALESCE | PLUS | MINUS | STRING |
			 BINARY_LITERAL | INTEGER_VALUE | DECIMAL_VALUE | IDENTIFIER | DIGIT_IDENTIFIER |
			 QUOTED_IDENTIFIER | BACKQUOTED_IDENTIFIER | DOUBLE_PRECISION 
				=> {
					{
					let mut tmp = BooleanDefaultContextExt::new(&**_localctx);
					recog.ctx = Some(tmp.clone());
					_localctx = tmp;
					_prevctx = _localctx.clone();


					/*InvokeRule predicated*/
					recog.base.set_state(865);
					recog.predicated()?;

					}
				}

			 NOT 
				=> {
					{
					let mut tmp = LogicalNotContextExt::new(&**_localctx);
					recog.ctx = Some(tmp.clone());
					_localctx = tmp;
					_prevctx = _localctx.clone();
					recog.base.set_state(866);
					recog.base.match_token(NOT,&mut recog.err_handler)?;

					/*InvokeRule booleanExpression*/
					recog.base.set_state(867);
					recog.booleanExpression_rec(3)?;

					}
				}

				_ => Err(ANTLRError::NoAltError(NoViableAltError::new(&mut recog.base)))?
			}

			let tmp = recog.input.lt(-1).cloned();
			recog.ctx.as_ref().unwrap().set_stop(tmp);
			recog.base.set_state(878);
			recog.err_handler.sync(&mut recog.base)?;
			_alt = recog.interpreter.adaptive_predict(107,&mut recog.base)?;
			while { _alt!=2 && _alt!=INVALID_ALT } {
				if _alt==1 {
					recog.trigger_exit_rule_event();
					_prevctx = _localctx.clone();
					{
					recog.base.set_state(876);
					recog.err_handler.sync(&mut recog.base)?;
					match  recog.interpreter.adaptive_predict(106,&mut recog.base)? {
						1 =>{
							{
							/*recRuleLabeledAltStartAction*/
							let mut tmp = LogicalBinaryContextExt::new(&**BooleanExpressionContextExt::new(_parentctx.clone(), _parentState));
							if let BooleanExpressionContextAll::LogicalBinaryContext(ctx) = cast_mut::<_,BooleanExpressionContextAll >(&mut tmp){
								ctx.left = Some(_prevctx.clone());
							} else {unreachable!("cant cast");}
							recog.push_new_recursion_context(tmp.clone(), _startState, RULE_booleanExpression);
							_localctx = tmp;
							recog.base.set_state(870);
							if !({recog.precpred(None, 2)}) {
								Err(FailedPredicateError::new(&mut recog.base, Some("recog.precpred(None, 2)".to_owned()), None))?;
							}
							recog.base.set_state(871);
							let tmp = recog.base.match_token(AND,&mut recog.err_handler)?;
							if let BooleanExpressionContextAll::LogicalBinaryContext(ctx) = cast_mut::<_,BooleanExpressionContextAll >(&mut _localctx){
							ctx.operator = Some(tmp.clone()); } else {unreachable!("cant cast");}  

							/*InvokeRule booleanExpression*/
							recog.base.set_state(872);
							let tmp = recog.booleanExpression_rec(3)?;
							if let BooleanExpressionContextAll::LogicalBinaryContext(ctx) = cast_mut::<_,BooleanExpressionContextAll >(&mut _localctx){
							ctx.right = Some(tmp.clone()); } else {unreachable!("cant cast");}  

							}
						}
					,
						2 =>{
							{
							/*recRuleLabeledAltStartAction*/
							let mut tmp = LogicalBinaryContextExt::new(&**BooleanExpressionContextExt::new(_parentctx.clone(), _parentState));
							if let BooleanExpressionContextAll::LogicalBinaryContext(ctx) = cast_mut::<_,BooleanExpressionContextAll >(&mut tmp){
								ctx.left = Some(_prevctx.clone());
							} else {unreachable!("cant cast");}
							recog.push_new_recursion_context(tmp.clone(), _startState, RULE_booleanExpression);
							_localctx = tmp;
							recog.base.set_state(873);
							if !({recog.precpred(None, 1)}) {
								Err(FailedPredicateError::new(&mut recog.base, Some("recog.precpred(None, 1)".to_owned()), None))?;
							}
							recog.base.set_state(874);
							let tmp = recog.base.match_token(OR,&mut recog.err_handler)?;
							if let BooleanExpressionContextAll::LogicalBinaryContext(ctx) = cast_mut::<_,BooleanExpressionContextAll >(&mut _localctx){
							ctx.operator = Some(tmp.clone()); } else {unreachable!("cant cast");}  

							/*InvokeRule booleanExpression*/
							recog.base.set_state(875);
							let tmp = recog.booleanExpression_rec(2)?;
							if let BooleanExpressionContextAll::LogicalBinaryContext(ctx) = cast_mut::<_,BooleanExpressionContextAll >(&mut _localctx){
							ctx.right = Some(tmp.clone()); } else {unreachable!("cant cast");}  

							}
						}

						_ => {}
					}
					} 
				}
				recog.base.set_state(880);
				recog.err_handler.sync(&mut recog.base)?;
				_alt = recog.interpreter.adaptive_predict(107,&mut recog.base)?;
			}
			}
			Ok(())
		})();
		match result {
		Ok(_) => {},
        Err(e @ ANTLRError::FallThrough(_)) => return Err(e),
		Err(ref re)=>{
			//_localctx.exception = re;
			recog.err_handler.report_error(&mut recog.base, re);
	        recog.err_handler.recover(&mut recog.base, re)?;}
		}
		recog.base.unroll_recursion_context(_parentctx);

		Ok(_localctx)
	}
}
//------------------- predicated ----------------
pub type PredicatedContextAll<'input> = PredicatedContext<'input>;


pub type PredicatedContext<'input> = BaseParserRuleContext<'input,PredicatedContextExt<'input>>;

#[derive(Clone)]
pub struct PredicatedContextExt<'input>{
	pub valueExpression: Option<Rc<ValueExpressionContextAll<'input>>>,
ph:PhantomData<&'input str>
}

impl<'input> athenasqlParserContext<'input> for PredicatedContext<'input>{}

impl<'input,'a> Listenable<dyn athenasqlListener<'input> + 'a> for PredicatedContext<'input>{
		fn enter(&self,listener: &mut (dyn athenasqlListener<'input> + 'a)) {
			listener.enter_every_rule(self);
			listener.enter_predicated(self);
		}fn exit(&self,listener: &mut (dyn athenasqlListener<'input> + 'a)) {
			listener.exit_predicated(self);
			listener.exit_every_rule(self);
		}
}

impl<'input> CustomRuleContext<'input> for PredicatedContextExt<'input>{
	type TF = LocalTokenFactory<'input>;
	type Ctx = athenasqlParserContextType;
	fn get_rule_index(&self) -> usize { RULE_predicated }
	//fn type_rule_index() -> usize where Self: Sized { RULE_predicated }
}
antlr_rust::tid!{PredicatedContextExt<'a>}

impl<'input> PredicatedContextExt<'input>{
	fn new(parent: Option<Rc<dyn athenasqlParserContext<'input> + 'input > >, invoking_state: isize) -> Rc<PredicatedContextAll<'input>> {
		Rc::new(
			BaseParserRuleContext::new_parser_ctx(parent, invoking_state,PredicatedContextExt{
				valueExpression: None, 
				ph:PhantomData
			}),
		)
	}
}

pub trait PredicatedContextAttrs<'input>: athenasqlParserContext<'input> + BorrowMut<PredicatedContextExt<'input>>{

fn valueExpression(&self) -> Option<Rc<ValueExpressionContextAll<'input>>> where Self:Sized{
	self.child_of_type(0)
}
fn predicate(&self) -> Option<Rc<PredicateContextAll<'input>>> where Self:Sized{
	self.child_of_type(0)
}

}

impl<'input> PredicatedContextAttrs<'input> for PredicatedContext<'input>{}

impl<'input, I, H> athenasqlParser<'input, I, H>
where
    I: TokenStream<'input, TF = LocalTokenFactory<'input> > + TidAble<'input>,
    H: ErrorStrategy<'input,BaseParserType<'input,I>>
{
	pub fn predicated(&mut self,)
	-> Result<Rc<PredicatedContextAll<'input>>,ANTLRError> {
		let mut recog = self;
		let _parentctx = recog.ctx.take();
		let mut _localctx = PredicatedContextExt::new(_parentctx.clone(), recog.base.get_state());
        recog.base.enter_rule(_localctx.clone(), 68, RULE_predicated);
        let mut _localctx: Rc<PredicatedContextAll> = _localctx;
		let result: Result<(), ANTLRError> = (|| {

			//recog.base.enter_outer_alt(_localctx.clone(), 1);
			recog.base.enter_outer_alt(None, 1);
			{
			/*InvokeRule valueExpression*/
			recog.base.set_state(881);
			let tmp = recog.valueExpression_rec(0)?;
			 cast_mut::<_,PredicatedContext >(&mut _localctx).valueExpression = Some(tmp.clone());
			  

			recog.base.set_state(883);
			recog.err_handler.sync(&mut recog.base)?;
			match  recog.interpreter.adaptive_predict(108,&mut recog.base)? {
				x if x == 1=>{
					{
					/*InvokeRule predicate*/
					recog.base.set_state(882);
					recog.predicate((cast::<_,PredicatedContext >(&*_localctx))
					 .valueExpression.as_ref().unwrap())?;

					}
				}

				_ => {}
			}
			}
			Ok(())
		})();
		match result {
		Ok(_)=>{},
        Err(e @ ANTLRError::FallThrough(_)) => return Err(e),
		Err(ref re) => {
				//_localctx.exception = re;
				recog.err_handler.report_error(&mut recog.base, re);
				recog.err_handler.recover(&mut recog.base, re)?;
			}
		}
		recog.base.exit_rule();

		Ok(_localctx)
	}
}
//------------------- predicate ----------------
#[derive(Debug)]
pub enum PredicateContextAll<'input>{
	ComparisonContext(ComparisonContext<'input>),
	LikeContext(LikeContext<'input>),
	InSubqueryContext(InSubqueryContext<'input>),
	DistinctFromContext(DistinctFromContext<'input>),
	InListContext(InListContext<'input>),
	NullPredicateContext(NullPredicateContext<'input>),
	BetweenContext(BetweenContext<'input>),
	QuantifiedComparisonContext(QuantifiedComparisonContext<'input>),
Error(PredicateContext<'input>)
}
antlr_rust::tid!{PredicateContextAll<'a>}

impl<'input> antlr_rust::parser_rule_context::DerefSeal for PredicateContextAll<'input>{}

impl<'input> athenasqlParserContext<'input> for PredicateContextAll<'input>{}

impl<'input> Deref for PredicateContextAll<'input>{
	type Target = dyn PredicateContextAttrs<'input> + 'input;
	fn deref(&self) -> &Self::Target{
		use PredicateContextAll::*;
		match self{
			ComparisonContext(inner) => inner,
			LikeContext(inner) => inner,
			InSubqueryContext(inner) => inner,
			DistinctFromContext(inner) => inner,
			InListContext(inner) => inner,
			NullPredicateContext(inner) => inner,
			BetweenContext(inner) => inner,
			QuantifiedComparisonContext(inner) => inner,
Error(inner) => inner
		}
	}
}
impl<'input,'a> Listenable<dyn athenasqlListener<'input> + 'a> for PredicateContextAll<'input>{
    fn enter(&self, listener: &mut (dyn athenasqlListener<'input> + 'a)) { self.deref().enter(listener) }
    fn exit(&self, listener: &mut (dyn athenasqlListener<'input> + 'a)) { self.deref().exit(listener) }
}



pub type PredicateContext<'input> = BaseParserRuleContext<'input,PredicateContextExt<'input>>;

#[derive(Clone)]
pub struct PredicateContextExt<'input>{
	pub value: ParserRuleContext,
ph:PhantomData<&'input str>
}

impl<'input> athenasqlParserContext<'input> for PredicateContext<'input>{}

impl<'input,'a> Listenable<dyn athenasqlListener<'input> + 'a> for PredicateContext<'input>{
}

impl<'input> CustomRuleContext<'input> for PredicateContextExt<'input>{
	type TF = LocalTokenFactory<'input>;
	type Ctx = athenasqlParserContextType;
	fn get_rule_index(&self) -> usize { RULE_predicate }
	//fn type_rule_index() -> usize where Self: Sized { RULE_predicate }
}
antlr_rust::tid!{PredicateContextExt<'a>}

impl<'input> PredicateContextExt<'input>{
	fn new(parent: Option<Rc<dyn athenasqlParserContext<'input> + 'input > >, invoking_state: isize, value: ParserRuleContext) -> Rc<PredicateContextAll<'input>> {
		Rc::new(
		PredicateContextAll::Error(
			BaseParserRuleContext::new_parser_ctx(parent, invoking_state,PredicateContextExt{
				value,
				ph:PhantomData
			}),
		)
		)
	}
}

pub trait PredicateContextAttrs<'input>: athenasqlParserContext<'input> + BorrowMut<PredicateContextExt<'input>>{

fn get_value<'a>(&'a self) -> &'a ParserRuleContext where 'input: 'a { &self.borrow().value }  
fn set_value(&mut self,attr: ParserRuleContext) { self.borrow_mut().value = attr; }  

}

impl<'input> PredicateContextAttrs<'input> for PredicateContext<'input>{}

pub type ComparisonContext<'input> = BaseParserRuleContext<'input,ComparisonContextExt<'input>>;

pub trait ComparisonContextAttrs<'input>: athenasqlParserContext<'input>{
	fn comparisonOperator(&self) -> Option<Rc<ComparisonOperatorContextAll<'input>>> where Self:Sized{
		self.child_of_type(0)
	}
	fn valueExpression(&self) -> Option<Rc<ValueExpressionContextAll<'input>>> where Self:Sized{
		self.child_of_type(0)
	}
}

impl<'input> ComparisonContextAttrs<'input> for ComparisonContext<'input>{}

pub struct ComparisonContextExt<'input>{
	base:PredicateContextExt<'input>,
	pub right: Option<Rc<ValueExpressionContextAll<'input>>>,
	ph:PhantomData<&'input str>
}

antlr_rust::tid!{ComparisonContextExt<'a>}

impl<'input> athenasqlParserContext<'input> for ComparisonContext<'input>{}

impl<'input,'a> Listenable<dyn athenasqlListener<'input> + 'a> for ComparisonContext<'input>{
	fn enter(&self,listener: &mut (dyn athenasqlListener<'input> + 'a)) {
		listener.enter_every_rule(self);
		listener.enter_comparison(self);
	}
}

impl<'input> CustomRuleContext<'input> for ComparisonContextExt<'input>{
	type TF = LocalTokenFactory<'input>;
	type Ctx = athenasqlParserContextType;
	fn get_rule_index(&self) -> usize { RULE_predicate }
	//fn type_rule_index() -> usize where Self: Sized { RULE_predicate }
}

impl<'input> Borrow<PredicateContextExt<'input>> for ComparisonContext<'input>{
	fn borrow(&self) -> &PredicateContextExt<'input> { &self.base }
}
impl<'input> BorrowMut<PredicateContextExt<'input>> for ComparisonContext<'input>{
	fn borrow_mut(&mut self) -> &mut PredicateContextExt<'input> { &mut self.base }
}

impl<'input> PredicateContextAttrs<'input> for ComparisonContext<'input> {}

impl<'input> ComparisonContextExt<'input>{
	fn new(ctx: &dyn PredicateContextAttrs<'input>) -> Rc<PredicateContextAll<'input>>  {
		Rc::new(
			PredicateContextAll::ComparisonContext(
				BaseParserRuleContext::copy_from(ctx,ComparisonContextExt{
        			right:None, 
        			base: ctx.borrow().clone(),
        			ph:PhantomData
				})
			)
		)
	}
}

pub type LikeContext<'input> = BaseParserRuleContext<'input,LikeContextExt<'input>>;

pub trait LikeContextAttrs<'input>: athenasqlParserContext<'input>{
	/// Retrieves first TerminalNode corresponding to token LIKE
	/// Returns `None` if there is no child corresponding to token LIKE
	fn LIKE(&self) -> Option<Rc<TerminalNode<'input,athenasqlParserContextType>>> where Self:Sized{
		self.get_token(LIKE, 0)
	}
	fn valueExpression_all(&self) ->  Vec<Rc<ValueExpressionContextAll<'input>>> where Self:Sized{
		self.children_of_type()
	}
	fn valueExpression(&self, i: usize) -> Option<Rc<ValueExpressionContextAll<'input>>> where Self:Sized{
		self.child_of_type(i)
	}
	/// Retrieves first TerminalNode corresponding to token NOT
	/// Returns `None` if there is no child corresponding to token NOT
	fn NOT(&self) -> Option<Rc<TerminalNode<'input,athenasqlParserContextType>>> where Self:Sized{
		self.get_token(NOT, 0)
	}
	/// Retrieves first TerminalNode corresponding to token ESCAPE
	/// Returns `None` if there is no child corresponding to token ESCAPE
	fn ESCAPE(&self) -> Option<Rc<TerminalNode<'input,athenasqlParserContextType>>> where Self:Sized{
		self.get_token(ESCAPE, 0)
	}
}

impl<'input> LikeContextAttrs<'input> for LikeContext<'input>{}

pub struct LikeContextExt<'input>{
	base:PredicateContextExt<'input>,
	pub pattern: Option<Rc<ValueExpressionContextAll<'input>>>,
	pub escape: Option<Rc<ValueExpressionContextAll<'input>>>,
	ph:PhantomData<&'input str>
}

antlr_rust::tid!{LikeContextExt<'a>}

impl<'input> athenasqlParserContext<'input> for LikeContext<'input>{}

impl<'input,'a> Listenable<dyn athenasqlListener<'input> + 'a> for LikeContext<'input>{
	fn enter(&self,listener: &mut (dyn athenasqlListener<'input> + 'a)) {
		listener.enter_every_rule(self);
		listener.enter_like(self);
	}
}

impl<'input> CustomRuleContext<'input> for LikeContextExt<'input>{
	type TF = LocalTokenFactory<'input>;
	type Ctx = athenasqlParserContextType;
	fn get_rule_index(&self) -> usize { RULE_predicate }
	//fn type_rule_index() -> usize where Self: Sized { RULE_predicate }
}

impl<'input> Borrow<PredicateContextExt<'input>> for LikeContext<'input>{
	fn borrow(&self) -> &PredicateContextExt<'input> { &self.base }
}
impl<'input> BorrowMut<PredicateContextExt<'input>> for LikeContext<'input>{
	fn borrow_mut(&mut self) -> &mut PredicateContextExt<'input> { &mut self.base }
}

impl<'input> PredicateContextAttrs<'input> for LikeContext<'input> {}

impl<'input> LikeContextExt<'input>{
	fn new(ctx: &dyn PredicateContextAttrs<'input>) -> Rc<PredicateContextAll<'input>>  {
		Rc::new(
			PredicateContextAll::LikeContext(
				BaseParserRuleContext::copy_from(ctx,LikeContextExt{
        			pattern:None, escape:None, 
        			base: ctx.borrow().clone(),
        			ph:PhantomData
				})
			)
		)
	}
}

pub type InSubqueryContext<'input> = BaseParserRuleContext<'input,InSubqueryContextExt<'input>>;

pub trait InSubqueryContextAttrs<'input>: athenasqlParserContext<'input>{
	/// Retrieves first TerminalNode corresponding to token IN
	/// Returns `None` if there is no child corresponding to token IN
	fn IN(&self) -> Option<Rc<TerminalNode<'input,athenasqlParserContextType>>> where Self:Sized{
		self.get_token(IN, 0)
	}
	fn query(&self) -> Option<Rc<QueryContextAll<'input>>> where Self:Sized{
		self.child_of_type(0)
	}
	/// Retrieves first TerminalNode corresponding to token NOT
	/// Returns `None` if there is no child corresponding to token NOT
	fn NOT(&self) -> Option<Rc<TerminalNode<'input,athenasqlParserContextType>>> where Self:Sized{
		self.get_token(NOT, 0)
	}
}

impl<'input> InSubqueryContextAttrs<'input> for InSubqueryContext<'input>{}

pub struct InSubqueryContextExt<'input>{
	base:PredicateContextExt<'input>,
	ph:PhantomData<&'input str>
}

antlr_rust::tid!{InSubqueryContextExt<'a>}

impl<'input> athenasqlParserContext<'input> for InSubqueryContext<'input>{}

impl<'input,'a> Listenable<dyn athenasqlListener<'input> + 'a> for InSubqueryContext<'input>{
	fn enter(&self,listener: &mut (dyn athenasqlListener<'input> + 'a)) {
		listener.enter_every_rule(self);
		listener.enter_inSubquery(self);
	}
}

impl<'input> CustomRuleContext<'input> for InSubqueryContextExt<'input>{
	type TF = LocalTokenFactory<'input>;
	type Ctx = athenasqlParserContextType;
	fn get_rule_index(&self) -> usize { RULE_predicate }
	//fn type_rule_index() -> usize where Self: Sized { RULE_predicate }
}

impl<'input> Borrow<PredicateContextExt<'input>> for InSubqueryContext<'input>{
	fn borrow(&self) -> &PredicateContextExt<'input> { &self.base }
}
impl<'input> BorrowMut<PredicateContextExt<'input>> for InSubqueryContext<'input>{
	fn borrow_mut(&mut self) -> &mut PredicateContextExt<'input> { &mut self.base }
}

impl<'input> PredicateContextAttrs<'input> for InSubqueryContext<'input> {}

impl<'input> InSubqueryContextExt<'input>{
	fn new(ctx: &dyn PredicateContextAttrs<'input>) -> Rc<PredicateContextAll<'input>>  {
		Rc::new(
			PredicateContextAll::InSubqueryContext(
				BaseParserRuleContext::copy_from(ctx,InSubqueryContextExt{
        			base: ctx.borrow().clone(),
        			ph:PhantomData
				})
			)
		)
	}
}

pub type DistinctFromContext<'input> = BaseParserRuleContext<'input,DistinctFromContextExt<'input>>;

pub trait DistinctFromContextAttrs<'input>: athenasqlParserContext<'input>{
	/// Retrieves first TerminalNode corresponding to token IS
	/// Returns `None` if there is no child corresponding to token IS
	fn IS(&self) -> Option<Rc<TerminalNode<'input,athenasqlParserContextType>>> where Self:Sized{
		self.get_token(IS, 0)
	}
	/// Retrieves first TerminalNode corresponding to token DISTINCT
	/// Returns `None` if there is no child corresponding to token DISTINCT
	fn DISTINCT(&self) -> Option<Rc<TerminalNode<'input,athenasqlParserContextType>>> where Self:Sized{
		self.get_token(DISTINCT, 0)
	}
	/// Retrieves first TerminalNode corresponding to token FROM
	/// Returns `None` if there is no child corresponding to token FROM
	fn FROM(&self) -> Option<Rc<TerminalNode<'input,athenasqlParserContextType>>> where Self:Sized{
		self.get_token(FROM, 0)
	}
	fn valueExpression(&self) -> Option<Rc<ValueExpressionContextAll<'input>>> where Self:Sized{
		self.child_of_type(0)
	}
	/// Retrieves first TerminalNode corresponding to token NOT
	/// Returns `None` if there is no child corresponding to token NOT
	fn NOT(&self) -> Option<Rc<TerminalNode<'input,athenasqlParserContextType>>> where Self:Sized{
		self.get_token(NOT, 0)
	}
}

impl<'input> DistinctFromContextAttrs<'input> for DistinctFromContext<'input>{}

pub struct DistinctFromContextExt<'input>{
	base:PredicateContextExt<'input>,
	pub right: Option<Rc<ValueExpressionContextAll<'input>>>,
	ph:PhantomData<&'input str>
}

antlr_rust::tid!{DistinctFromContextExt<'a>}

impl<'input> athenasqlParserContext<'input> for DistinctFromContext<'input>{}

impl<'input,'a> Listenable<dyn athenasqlListener<'input> + 'a> for DistinctFromContext<'input>{
	fn enter(&self,listener: &mut (dyn athenasqlListener<'input> + 'a)) {
		listener.enter_every_rule(self);
		listener.enter_distinctFrom(self);
	}
}

impl<'input> CustomRuleContext<'input> for DistinctFromContextExt<'input>{
	type TF = LocalTokenFactory<'input>;
	type Ctx = athenasqlParserContextType;
	fn get_rule_index(&self) -> usize { RULE_predicate }
	//fn type_rule_index() -> usize where Self: Sized { RULE_predicate }
}

impl<'input> Borrow<PredicateContextExt<'input>> for DistinctFromContext<'input>{
	fn borrow(&self) -> &PredicateContextExt<'input> { &self.base }
}
impl<'input> BorrowMut<PredicateContextExt<'input>> for DistinctFromContext<'input>{
	fn borrow_mut(&mut self) -> &mut PredicateContextExt<'input> { &mut self.base }
}

impl<'input> PredicateContextAttrs<'input> for DistinctFromContext<'input> {}

impl<'input> DistinctFromContextExt<'input>{
	fn new(ctx: &dyn PredicateContextAttrs<'input>) -> Rc<PredicateContextAll<'input>>  {
		Rc::new(
			PredicateContextAll::DistinctFromContext(
				BaseParserRuleContext::copy_from(ctx,DistinctFromContextExt{
        			right:None, 
        			base: ctx.borrow().clone(),
        			ph:PhantomData
				})
			)
		)
	}
}

pub type InListContext<'input> = BaseParserRuleContext<'input,InListContextExt<'input>>;

pub trait InListContextAttrs<'input>: athenasqlParserContext<'input>{
	/// Retrieves first TerminalNode corresponding to token IN
	/// Returns `None` if there is no child corresponding to token IN
	fn IN(&self) -> Option<Rc<TerminalNode<'input,athenasqlParserContextType>>> where Self:Sized{
		self.get_token(IN, 0)
	}
	fn expression_all(&self) ->  Vec<Rc<ExpressionContextAll<'input>>> where Self:Sized{
		self.children_of_type()
	}
	fn expression(&self, i: usize) -> Option<Rc<ExpressionContextAll<'input>>> where Self:Sized{
		self.child_of_type(i)
	}
	/// Retrieves first TerminalNode corresponding to token NOT
	/// Returns `None` if there is no child corresponding to token NOT
	fn NOT(&self) -> Option<Rc<TerminalNode<'input,athenasqlParserContextType>>> where Self:Sized{
		self.get_token(NOT, 0)
	}
}

impl<'input> InListContextAttrs<'input> for InListContext<'input>{}

pub struct InListContextExt<'input>{
	base:PredicateContextExt<'input>,
	ph:PhantomData<&'input str>
}

antlr_rust::tid!{InListContextExt<'a>}

impl<'input> athenasqlParserContext<'input> for InListContext<'input>{}

impl<'input,'a> Listenable<dyn athenasqlListener<'input> + 'a> for InListContext<'input>{
	fn enter(&self,listener: &mut (dyn athenasqlListener<'input> + 'a)) {
		listener.enter_every_rule(self);
		listener.enter_inList(self);
	}
}

impl<'input> CustomRuleContext<'input> for InListContextExt<'input>{
	type TF = LocalTokenFactory<'input>;
	type Ctx = athenasqlParserContextType;
	fn get_rule_index(&self) -> usize { RULE_predicate }
	//fn type_rule_index() -> usize where Self: Sized { RULE_predicate }
}

impl<'input> Borrow<PredicateContextExt<'input>> for InListContext<'input>{
	fn borrow(&self) -> &PredicateContextExt<'input> { &self.base }
}
impl<'input> BorrowMut<PredicateContextExt<'input>> for InListContext<'input>{
	fn borrow_mut(&mut self) -> &mut PredicateContextExt<'input> { &mut self.base }
}

impl<'input> PredicateContextAttrs<'input> for InListContext<'input> {}

impl<'input> InListContextExt<'input>{
	fn new(ctx: &dyn PredicateContextAttrs<'input>) -> Rc<PredicateContextAll<'input>>  {
		Rc::new(
			PredicateContextAll::InListContext(
				BaseParserRuleContext::copy_from(ctx,InListContextExt{
        			base: ctx.borrow().clone(),
        			ph:PhantomData
				})
			)
		)
	}
}

pub type NullPredicateContext<'input> = BaseParserRuleContext<'input,NullPredicateContextExt<'input>>;

pub trait NullPredicateContextAttrs<'input>: athenasqlParserContext<'input>{
	/// Retrieves first TerminalNode corresponding to token IS
	/// Returns `None` if there is no child corresponding to token IS
	fn IS(&self) -> Option<Rc<TerminalNode<'input,athenasqlParserContextType>>> where Self:Sized{
		self.get_token(IS, 0)
	}
	/// Retrieves first TerminalNode corresponding to token NULL
	/// Returns `None` if there is no child corresponding to token NULL
	fn NULL(&self) -> Option<Rc<TerminalNode<'input,athenasqlParserContextType>>> where Self:Sized{
		self.get_token(NULL, 0)
	}
	/// Retrieves first TerminalNode corresponding to token NOT
	/// Returns `None` if there is no child corresponding to token NOT
	fn NOT(&self) -> Option<Rc<TerminalNode<'input,athenasqlParserContextType>>> where Self:Sized{
		self.get_token(NOT, 0)
	}
}

impl<'input> NullPredicateContextAttrs<'input> for NullPredicateContext<'input>{}

pub struct NullPredicateContextExt<'input>{
	base:PredicateContextExt<'input>,
	ph:PhantomData<&'input str>
}

antlr_rust::tid!{NullPredicateContextExt<'a>}

impl<'input> athenasqlParserContext<'input> for NullPredicateContext<'input>{}

impl<'input,'a> Listenable<dyn athenasqlListener<'input> + 'a> for NullPredicateContext<'input>{
	fn enter(&self,listener: &mut (dyn athenasqlListener<'input> + 'a)) {
		listener.enter_every_rule(self);
		listener.enter_nullPredicate(self);
	}
}

impl<'input> CustomRuleContext<'input> for NullPredicateContextExt<'input>{
	type TF = LocalTokenFactory<'input>;
	type Ctx = athenasqlParserContextType;
	fn get_rule_index(&self) -> usize { RULE_predicate }
	//fn type_rule_index() -> usize where Self: Sized { RULE_predicate }
}

impl<'input> Borrow<PredicateContextExt<'input>> for NullPredicateContext<'input>{
	fn borrow(&self) -> &PredicateContextExt<'input> { &self.base }
}
impl<'input> BorrowMut<PredicateContextExt<'input>> for NullPredicateContext<'input>{
	fn borrow_mut(&mut self) -> &mut PredicateContextExt<'input> { &mut self.base }
}

impl<'input> PredicateContextAttrs<'input> for NullPredicateContext<'input> {}

impl<'input> NullPredicateContextExt<'input>{
	fn new(ctx: &dyn PredicateContextAttrs<'input>) -> Rc<PredicateContextAll<'input>>  {
		Rc::new(
			PredicateContextAll::NullPredicateContext(
				BaseParserRuleContext::copy_from(ctx,NullPredicateContextExt{
        			base: ctx.borrow().clone(),
        			ph:PhantomData
				})
			)
		)
	}
}

pub type BetweenContext<'input> = BaseParserRuleContext<'input,BetweenContextExt<'input>>;

pub trait BetweenContextAttrs<'input>: athenasqlParserContext<'input>{
	/// Retrieves first TerminalNode corresponding to token BETWEEN
	/// Returns `None` if there is no child corresponding to token BETWEEN
	fn BETWEEN(&self) -> Option<Rc<TerminalNode<'input,athenasqlParserContextType>>> where Self:Sized{
		self.get_token(BETWEEN, 0)
	}
	/// Retrieves first TerminalNode corresponding to token AND
	/// Returns `None` if there is no child corresponding to token AND
	fn AND(&self) -> Option<Rc<TerminalNode<'input,athenasqlParserContextType>>> where Self:Sized{
		self.get_token(AND, 0)
	}
	fn valueExpression_all(&self) ->  Vec<Rc<ValueExpressionContextAll<'input>>> where Self:Sized{
		self.children_of_type()
	}
	fn valueExpression(&self, i: usize) -> Option<Rc<ValueExpressionContextAll<'input>>> where Self:Sized{
		self.child_of_type(i)
	}
	/// Retrieves first TerminalNode corresponding to token NOT
	/// Returns `None` if there is no child corresponding to token NOT
	fn NOT(&self) -> Option<Rc<TerminalNode<'input,athenasqlParserContextType>>> where Self:Sized{
		self.get_token(NOT, 0)
	}
}

impl<'input> BetweenContextAttrs<'input> for BetweenContext<'input>{}

pub struct BetweenContextExt<'input>{
	base:PredicateContextExt<'input>,
	pub lower: Option<Rc<ValueExpressionContextAll<'input>>>,
	pub upper: Option<Rc<ValueExpressionContextAll<'input>>>,
	ph:PhantomData<&'input str>
}

antlr_rust::tid!{BetweenContextExt<'a>}

impl<'input> athenasqlParserContext<'input> for BetweenContext<'input>{}

impl<'input,'a> Listenable<dyn athenasqlListener<'input> + 'a> for BetweenContext<'input>{
	fn enter(&self,listener: &mut (dyn athenasqlListener<'input> + 'a)) {
		listener.enter_every_rule(self);
		listener.enter_between(self);
	}
}

impl<'input> CustomRuleContext<'input> for BetweenContextExt<'input>{
	type TF = LocalTokenFactory<'input>;
	type Ctx = athenasqlParserContextType;
	fn get_rule_index(&self) -> usize { RULE_predicate }
	//fn type_rule_index() -> usize where Self: Sized { RULE_predicate }
}

impl<'input> Borrow<PredicateContextExt<'input>> for BetweenContext<'input>{
	fn borrow(&self) -> &PredicateContextExt<'input> { &self.base }
}
impl<'input> BorrowMut<PredicateContextExt<'input>> for BetweenContext<'input>{
	fn borrow_mut(&mut self) -> &mut PredicateContextExt<'input> { &mut self.base }
}

impl<'input> PredicateContextAttrs<'input> for BetweenContext<'input> {}

impl<'input> BetweenContextExt<'input>{
	fn new(ctx: &dyn PredicateContextAttrs<'input>) -> Rc<PredicateContextAll<'input>>  {
		Rc::new(
			PredicateContextAll::BetweenContext(
				BaseParserRuleContext::copy_from(ctx,BetweenContextExt{
        			lower:None, upper:None, 
        			base: ctx.borrow().clone(),
        			ph:PhantomData
				})
			)
		)
	}
}

pub type QuantifiedComparisonContext<'input> = BaseParserRuleContext<'input,QuantifiedComparisonContextExt<'input>>;

pub trait QuantifiedComparisonContextAttrs<'input>: athenasqlParserContext<'input>{
	fn comparisonOperator(&self) -> Option<Rc<ComparisonOperatorContextAll<'input>>> where Self:Sized{
		self.child_of_type(0)
	}
	fn comparisonQuantifier(&self) -> Option<Rc<ComparisonQuantifierContextAll<'input>>> where Self:Sized{
		self.child_of_type(0)
	}
	fn query(&self) -> Option<Rc<QueryContextAll<'input>>> where Self:Sized{
		self.child_of_type(0)
	}
}

impl<'input> QuantifiedComparisonContextAttrs<'input> for QuantifiedComparisonContext<'input>{}

pub struct QuantifiedComparisonContextExt<'input>{
	base:PredicateContextExt<'input>,
	ph:PhantomData<&'input str>
}

antlr_rust::tid!{QuantifiedComparisonContextExt<'a>}

impl<'input> athenasqlParserContext<'input> for QuantifiedComparisonContext<'input>{}

impl<'input,'a> Listenable<dyn athenasqlListener<'input> + 'a> for QuantifiedComparisonContext<'input>{
	fn enter(&self,listener: &mut (dyn athenasqlListener<'input> + 'a)) {
		listener.enter_every_rule(self);
		listener.enter_quantifiedComparison(self);
	}
}

impl<'input> CustomRuleContext<'input> for QuantifiedComparisonContextExt<'input>{
	type TF = LocalTokenFactory<'input>;
	type Ctx = athenasqlParserContextType;
	fn get_rule_index(&self) -> usize { RULE_predicate }
	//fn type_rule_index() -> usize where Self: Sized { RULE_predicate }
}

impl<'input> Borrow<PredicateContextExt<'input>> for QuantifiedComparisonContext<'input>{
	fn borrow(&self) -> &PredicateContextExt<'input> { &self.base }
}
impl<'input> BorrowMut<PredicateContextExt<'input>> for QuantifiedComparisonContext<'input>{
	fn borrow_mut(&mut self) -> &mut PredicateContextExt<'input> { &mut self.base }
}

impl<'input> PredicateContextAttrs<'input> for QuantifiedComparisonContext<'input> {}

impl<'input> QuantifiedComparisonContextExt<'input>{
	fn new(ctx: &dyn PredicateContextAttrs<'input>) -> Rc<PredicateContextAll<'input>>  {
		Rc::new(
			PredicateContextAll::QuantifiedComparisonContext(
				BaseParserRuleContext::copy_from(ctx,QuantifiedComparisonContextExt{
        			base: ctx.borrow().clone(),
        			ph:PhantomData
				})
			)
		)
	}
}

impl<'input, I, H> athenasqlParser<'input, I, H>
where
    I: TokenStream<'input, TF = LocalTokenFactory<'input> > + TidAble<'input>,
    H: ErrorStrategy<'input,BaseParserType<'input,I>>
{
	pub fn predicate(&mut self,value: ParserRuleContext)
	-> Result<Rc<PredicateContextAll<'input>>,ANTLRError> {
		let mut recog = self;
		let _parentctx = recog.ctx.take();
		let mut _localctx = PredicateContextExt::new(_parentctx.clone(), recog.base.get_state(), value);
        recog.base.enter_rule(_localctx.clone(), 70, RULE_predicate);
        let mut _localctx: Rc<PredicateContextAll> = _localctx;
		let mut _la: isize = -1;
		let result: Result<(), ANTLRError> = (|| {

			recog.base.set_state(946);
			recog.err_handler.sync(&mut recog.base)?;
			match  recog.interpreter.adaptive_predict(117,&mut recog.base)? {
				1 =>{
					let tmp = ComparisonContextExt::new(&**_localctx);
					recog.base.enter_outer_alt(Some(tmp.clone()), 1);
					_localctx = tmp;
					{
					/*InvokeRule comparisonOperator*/
					recog.base.set_state(885);
					recog.comparisonOperator()?;

					/*InvokeRule valueExpression*/
					recog.base.set_state(886);
					let tmp = recog.valueExpression_rec(0)?;
					if let PredicateContextAll::ComparisonContext(ctx) = cast_mut::<_,PredicateContextAll >(&mut _localctx){
					ctx.right = Some(tmp.clone()); } else {unreachable!("cant cast");}  

					}
				}
			,
				2 =>{
					let tmp = QuantifiedComparisonContextExt::new(&**_localctx);
					recog.base.enter_outer_alt(Some(tmp.clone()), 2);
					_localctx = tmp;
					{
					/*InvokeRule comparisonOperator*/
					recog.base.set_state(888);
					recog.comparisonOperator()?;

					/*InvokeRule comparisonQuantifier*/
					recog.base.set_state(889);
					recog.comparisonQuantifier()?;

					recog.base.set_state(890);
					recog.base.match_token(T__1,&mut recog.err_handler)?;

					/*InvokeRule query*/
					recog.base.set_state(891);
					recog.query()?;

					recog.base.set_state(892);
					recog.base.match_token(T__3,&mut recog.err_handler)?;

					}
				}
			,
				3 =>{
					let tmp = BetweenContextExt::new(&**_localctx);
					recog.base.enter_outer_alt(Some(tmp.clone()), 3);
					_localctx = tmp;
					{
					recog.base.set_state(895);
					recog.err_handler.sync(&mut recog.base)?;
					_la = recog.base.input.la(1);
					if _la==NOT {
						{
						recog.base.set_state(894);
						recog.base.match_token(NOT,&mut recog.err_handler)?;

						}
					}

					recog.base.set_state(897);
					recog.base.match_token(BETWEEN,&mut recog.err_handler)?;

					/*InvokeRule valueExpression*/
					recog.base.set_state(898);
					let tmp = recog.valueExpression_rec(0)?;
					if let PredicateContextAll::BetweenContext(ctx) = cast_mut::<_,PredicateContextAll >(&mut _localctx){
					ctx.lower = Some(tmp.clone()); } else {unreachable!("cant cast");}  

					recog.base.set_state(899);
					recog.base.match_token(AND,&mut recog.err_handler)?;

					/*InvokeRule valueExpression*/
					recog.base.set_state(900);
					let tmp = recog.valueExpression_rec(0)?;
					if let PredicateContextAll::BetweenContext(ctx) = cast_mut::<_,PredicateContextAll >(&mut _localctx){
					ctx.upper = Some(tmp.clone()); } else {unreachable!("cant cast");}  

					}
				}
			,
				4 =>{
					let tmp = InListContextExt::new(&**_localctx);
					recog.base.enter_outer_alt(Some(tmp.clone()), 4);
					_localctx = tmp;
					{
					recog.base.set_state(903);
					recog.err_handler.sync(&mut recog.base)?;
					_la = recog.base.input.la(1);
					if _la==NOT {
						{
						recog.base.set_state(902);
						recog.base.match_token(NOT,&mut recog.err_handler)?;

						}
					}

					recog.base.set_state(905);
					recog.base.match_token(IN,&mut recog.err_handler)?;

					recog.base.set_state(906);
					recog.base.match_token(T__1,&mut recog.err_handler)?;

					/*InvokeRule expression*/
					recog.base.set_state(907);
					recog.expression()?;

					recog.base.set_state(912);
					recog.err_handler.sync(&mut recog.base)?;
					_la = recog.base.input.la(1);
					while _la==T__2 {
						{
						{
						recog.base.set_state(908);
						recog.base.match_token(T__2,&mut recog.err_handler)?;

						/*InvokeRule expression*/
						recog.base.set_state(909);
						recog.expression()?;

						}
						}
						recog.base.set_state(914);
						recog.err_handler.sync(&mut recog.base)?;
						_la = recog.base.input.la(1);
					}
					recog.base.set_state(915);
					recog.base.match_token(T__3,&mut recog.err_handler)?;

					}
				}
			,
				5 =>{
					let tmp = InSubqueryContextExt::new(&**_localctx);
					recog.base.enter_outer_alt(Some(tmp.clone()), 5);
					_localctx = tmp;
					{
					recog.base.set_state(918);
					recog.err_handler.sync(&mut recog.base)?;
					_la = recog.base.input.la(1);
					if _la==NOT {
						{
						recog.base.set_state(917);
						recog.base.match_token(NOT,&mut recog.err_handler)?;

						}
					}

					recog.base.set_state(920);
					recog.base.match_token(IN,&mut recog.err_handler)?;

					recog.base.set_state(921);
					recog.base.match_token(T__1,&mut recog.err_handler)?;

					/*InvokeRule query*/
					recog.base.set_state(922);
					recog.query()?;

					recog.base.set_state(923);
					recog.base.match_token(T__3,&mut recog.err_handler)?;

					}
				}
			,
				6 =>{
					let tmp = LikeContextExt::new(&**_localctx);
					recog.base.enter_outer_alt(Some(tmp.clone()), 6);
					_localctx = tmp;
					{
					recog.base.set_state(926);
					recog.err_handler.sync(&mut recog.base)?;
					_la = recog.base.input.la(1);
					if _la==NOT {
						{
						recog.base.set_state(925);
						recog.base.match_token(NOT,&mut recog.err_handler)?;

						}
					}

					recog.base.set_state(928);
					recog.base.match_token(LIKE,&mut recog.err_handler)?;

					/*InvokeRule valueExpression*/
					recog.base.set_state(929);
					let tmp = recog.valueExpression_rec(0)?;
					if let PredicateContextAll::LikeContext(ctx) = cast_mut::<_,PredicateContextAll >(&mut _localctx){
					ctx.pattern = Some(tmp.clone()); } else {unreachable!("cant cast");}  

					recog.base.set_state(932);
					recog.err_handler.sync(&mut recog.base)?;
					match  recog.interpreter.adaptive_predict(114,&mut recog.base)? {
						x if x == 1=>{
							{
							recog.base.set_state(930);
							recog.base.match_token(ESCAPE,&mut recog.err_handler)?;

							/*InvokeRule valueExpression*/
							recog.base.set_state(931);
							let tmp = recog.valueExpression_rec(0)?;
							if let PredicateContextAll::LikeContext(ctx) = cast_mut::<_,PredicateContextAll >(&mut _localctx){
							ctx.escape = Some(tmp.clone()); } else {unreachable!("cant cast");}  

							}
						}

						_ => {}
					}
					}
				}
			,
				7 =>{
					let tmp = NullPredicateContextExt::new(&**_localctx);
					recog.base.enter_outer_alt(Some(tmp.clone()), 7);
					_localctx = tmp;
					{
					recog.base.set_state(934);
					recog.base.match_token(IS,&mut recog.err_handler)?;

					recog.base.set_state(936);
					recog.err_handler.sync(&mut recog.base)?;
					_la = recog.base.input.la(1);
					if _la==NOT {
						{
						recog.base.set_state(935);
						recog.base.match_token(NOT,&mut recog.err_handler)?;

						}
					}

					recog.base.set_state(938);
					recog.base.match_token(NULL,&mut recog.err_handler)?;

					}
				}
			,
				8 =>{
					let tmp = DistinctFromContextExt::new(&**_localctx);
					recog.base.enter_outer_alt(Some(tmp.clone()), 8);
					_localctx = tmp;
					{
					recog.base.set_state(939);
					recog.base.match_token(IS,&mut recog.err_handler)?;

					recog.base.set_state(941);
					recog.err_handler.sync(&mut recog.base)?;
					_la = recog.base.input.la(1);
					if _la==NOT {
						{
						recog.base.set_state(940);
						recog.base.match_token(NOT,&mut recog.err_handler)?;

						}
					}

					recog.base.set_state(943);
					recog.base.match_token(DISTINCT,&mut recog.err_handler)?;

					recog.base.set_state(944);
					recog.base.match_token(FROM,&mut recog.err_handler)?;

					/*InvokeRule valueExpression*/
					recog.base.set_state(945);
					let tmp = recog.valueExpression_rec(0)?;
					if let PredicateContextAll::DistinctFromContext(ctx) = cast_mut::<_,PredicateContextAll >(&mut _localctx){
					ctx.right = Some(tmp.clone()); } else {unreachable!("cant cast");}  

					}
				}

				_ => {}
			}
			Ok(())
		})();
		match result {
		Ok(_)=>{},
        Err(e @ ANTLRError::FallThrough(_)) => return Err(e),
		Err(ref re) => {
				//_localctx.exception = re;
				recog.err_handler.report_error(&mut recog.base, re);
				recog.err_handler.recover(&mut recog.base, re)?;
			}
		}
		recog.base.exit_rule();

		Ok(_localctx)
	}
}
//------------------- valueExpression ----------------
#[derive(Debug)]
pub enum ValueExpressionContextAll<'input>{
	ValueExpressionDefaultContext(ValueExpressionDefaultContext<'input>),
	ConcatenationContext(ConcatenationContext<'input>),
	ArithmeticBinaryContext(ArithmeticBinaryContext<'input>),
	ArithmeticUnaryContext(ArithmeticUnaryContext<'input>),
	AtTimeZoneContext(AtTimeZoneContext<'input>),
Error(ValueExpressionContext<'input>)
}
antlr_rust::tid!{ValueExpressionContextAll<'a>}

impl<'input> antlr_rust::parser_rule_context::DerefSeal for ValueExpressionContextAll<'input>{}

impl<'input> athenasqlParserContext<'input> for ValueExpressionContextAll<'input>{}

impl<'input> Deref for ValueExpressionContextAll<'input>{
	type Target = dyn ValueExpressionContextAttrs<'input> + 'input;
	fn deref(&self) -> &Self::Target{
		use ValueExpressionContextAll::*;
		match self{
			ValueExpressionDefaultContext(inner) => inner,
			ConcatenationContext(inner) => inner,
			ArithmeticBinaryContext(inner) => inner,
			ArithmeticUnaryContext(inner) => inner,
			AtTimeZoneContext(inner) => inner,
Error(inner) => inner
		}
	}
}
impl<'input,'a> Listenable<dyn athenasqlListener<'input> + 'a> for ValueExpressionContextAll<'input>{
    fn enter(&self, listener: &mut (dyn athenasqlListener<'input> + 'a)) { self.deref().enter(listener) }
    fn exit(&self, listener: &mut (dyn athenasqlListener<'input> + 'a)) { self.deref().exit(listener) }
}



pub type ValueExpressionContext<'input> = BaseParserRuleContext<'input,ValueExpressionContextExt<'input>>;

#[derive(Clone)]
pub struct ValueExpressionContextExt<'input>{
ph:PhantomData<&'input str>
}

impl<'input> athenasqlParserContext<'input> for ValueExpressionContext<'input>{}

impl<'input,'a> Listenable<dyn athenasqlListener<'input> + 'a> for ValueExpressionContext<'input>{
}

impl<'input> CustomRuleContext<'input> for ValueExpressionContextExt<'input>{
	type TF = LocalTokenFactory<'input>;
	type Ctx = athenasqlParserContextType;
	fn get_rule_index(&self) -> usize { RULE_valueExpression }
	//fn type_rule_index() -> usize where Self: Sized { RULE_valueExpression }
}
antlr_rust::tid!{ValueExpressionContextExt<'a>}

impl<'input> ValueExpressionContextExt<'input>{
	fn new(parent: Option<Rc<dyn athenasqlParserContext<'input> + 'input > >, invoking_state: isize) -> Rc<ValueExpressionContextAll<'input>> {
		Rc::new(
		ValueExpressionContextAll::Error(
			BaseParserRuleContext::new_parser_ctx(parent, invoking_state,ValueExpressionContextExt{
				ph:PhantomData
			}),
		)
		)
	}
}

pub trait ValueExpressionContextAttrs<'input>: athenasqlParserContext<'input> + BorrowMut<ValueExpressionContextExt<'input>>{


}

impl<'input> ValueExpressionContextAttrs<'input> for ValueExpressionContext<'input>{}

pub type ValueExpressionDefaultContext<'input> = BaseParserRuleContext<'input,ValueExpressionDefaultContextExt<'input>>;

pub trait ValueExpressionDefaultContextAttrs<'input>: athenasqlParserContext<'input>{
	fn primaryExpression(&self) -> Option<Rc<PrimaryExpressionContextAll<'input>>> where Self:Sized{
		self.child_of_type(0)
	}
}

impl<'input> ValueExpressionDefaultContextAttrs<'input> for ValueExpressionDefaultContext<'input>{}

pub struct ValueExpressionDefaultContextExt<'input>{
	base:ValueExpressionContextExt<'input>,
	ph:PhantomData<&'input str>
}

antlr_rust::tid!{ValueExpressionDefaultContextExt<'a>}

impl<'input> athenasqlParserContext<'input> for ValueExpressionDefaultContext<'input>{}

impl<'input,'a> Listenable<dyn athenasqlListener<'input> + 'a> for ValueExpressionDefaultContext<'input>{
	fn enter(&self,listener: &mut (dyn athenasqlListener<'input> + 'a)) {
		listener.enter_every_rule(self);
		listener.enter_valueExpressionDefault(self);
	}
}

impl<'input> CustomRuleContext<'input> for ValueExpressionDefaultContextExt<'input>{
	type TF = LocalTokenFactory<'input>;
	type Ctx = athenasqlParserContextType;
	fn get_rule_index(&self) -> usize { RULE_valueExpression }
	//fn type_rule_index() -> usize where Self: Sized { RULE_valueExpression }
}

impl<'input> Borrow<ValueExpressionContextExt<'input>> for ValueExpressionDefaultContext<'input>{
	fn borrow(&self) -> &ValueExpressionContextExt<'input> { &self.base }
}
impl<'input> BorrowMut<ValueExpressionContextExt<'input>> for ValueExpressionDefaultContext<'input>{
	fn borrow_mut(&mut self) -> &mut ValueExpressionContextExt<'input> { &mut self.base }
}

impl<'input> ValueExpressionContextAttrs<'input> for ValueExpressionDefaultContext<'input> {}

impl<'input> ValueExpressionDefaultContextExt<'input>{
	fn new(ctx: &dyn ValueExpressionContextAttrs<'input>) -> Rc<ValueExpressionContextAll<'input>>  {
		Rc::new(
			ValueExpressionContextAll::ValueExpressionDefaultContext(
				BaseParserRuleContext::copy_from(ctx,ValueExpressionDefaultContextExt{
        			base: ctx.borrow().clone(),
        			ph:PhantomData
				})
			)
		)
	}
}

pub type ConcatenationContext<'input> = BaseParserRuleContext<'input,ConcatenationContextExt<'input>>;

pub trait ConcatenationContextAttrs<'input>: athenasqlParserContext<'input>{
	/// Retrieves first TerminalNode corresponding to token CONCAT
	/// Returns `None` if there is no child corresponding to token CONCAT
	fn CONCAT(&self) -> Option<Rc<TerminalNode<'input,athenasqlParserContextType>>> where Self:Sized{
		self.get_token(CONCAT, 0)
	}
	fn valueExpression_all(&self) ->  Vec<Rc<ValueExpressionContextAll<'input>>> where Self:Sized{
		self.children_of_type()
	}
	fn valueExpression(&self, i: usize) -> Option<Rc<ValueExpressionContextAll<'input>>> where Self:Sized{
		self.child_of_type(i)
	}
}

impl<'input> ConcatenationContextAttrs<'input> for ConcatenationContext<'input>{}

pub struct ConcatenationContextExt<'input>{
	base:ValueExpressionContextExt<'input>,
	pub left: Option<Rc<ValueExpressionContextAll<'input>>>,
	pub right: Option<Rc<ValueExpressionContextAll<'input>>>,
	ph:PhantomData<&'input str>
}

antlr_rust::tid!{ConcatenationContextExt<'a>}

impl<'input> athenasqlParserContext<'input> for ConcatenationContext<'input>{}

impl<'input,'a> Listenable<dyn athenasqlListener<'input> + 'a> for ConcatenationContext<'input>{
	fn enter(&self,listener: &mut (dyn athenasqlListener<'input> + 'a)) {
		listener.enter_every_rule(self);
		listener.enter_concatenation(self);
	}
}

impl<'input> CustomRuleContext<'input> for ConcatenationContextExt<'input>{
	type TF = LocalTokenFactory<'input>;
	type Ctx = athenasqlParserContextType;
	fn get_rule_index(&self) -> usize { RULE_valueExpression }
	//fn type_rule_index() -> usize where Self: Sized { RULE_valueExpression }
}

impl<'input> Borrow<ValueExpressionContextExt<'input>> for ConcatenationContext<'input>{
	fn borrow(&self) -> &ValueExpressionContextExt<'input> { &self.base }
}
impl<'input> BorrowMut<ValueExpressionContextExt<'input>> for ConcatenationContext<'input>{
	fn borrow_mut(&mut self) -> &mut ValueExpressionContextExt<'input> { &mut self.base }
}

impl<'input> ValueExpressionContextAttrs<'input> for ConcatenationContext<'input> {}

impl<'input> ConcatenationContextExt<'input>{
	fn new(ctx: &dyn ValueExpressionContextAttrs<'input>) -> Rc<ValueExpressionContextAll<'input>>  {
		Rc::new(
			ValueExpressionContextAll::ConcatenationContext(
				BaseParserRuleContext::copy_from(ctx,ConcatenationContextExt{
        			left:None, right:None, 
        			base: ctx.borrow().clone(),
        			ph:PhantomData
				})
			)
		)
	}
}

pub type ArithmeticBinaryContext<'input> = BaseParserRuleContext<'input,ArithmeticBinaryContextExt<'input>>;

pub trait ArithmeticBinaryContextAttrs<'input>: athenasqlParserContext<'input>{
	fn valueExpression_all(&self) ->  Vec<Rc<ValueExpressionContextAll<'input>>> where Self:Sized{
		self.children_of_type()
	}
	fn valueExpression(&self, i: usize) -> Option<Rc<ValueExpressionContextAll<'input>>> where Self:Sized{
		self.child_of_type(i)
	}
	/// Retrieves first TerminalNode corresponding to token ASTERISK
	/// Returns `None` if there is no child corresponding to token ASTERISK
	fn ASTERISK(&self) -> Option<Rc<TerminalNode<'input,athenasqlParserContextType>>> where Self:Sized{
		self.get_token(ASTERISK, 0)
	}
	/// Retrieves first TerminalNode corresponding to token SLASH
	/// Returns `None` if there is no child corresponding to token SLASH
	fn SLASH(&self) -> Option<Rc<TerminalNode<'input,athenasqlParserContextType>>> where Self:Sized{
		self.get_token(SLASH, 0)
	}
	/// Retrieves first TerminalNode corresponding to token PERCENT
	/// Returns `None` if there is no child corresponding to token PERCENT
	fn PERCENT(&self) -> Option<Rc<TerminalNode<'input,athenasqlParserContextType>>> where Self:Sized{
		self.get_token(PERCENT, 0)
	}
	/// Retrieves first TerminalNode corresponding to token PLUS
	/// Returns `None` if there is no child corresponding to token PLUS
	fn PLUS(&self) -> Option<Rc<TerminalNode<'input,athenasqlParserContextType>>> where Self:Sized{
		self.get_token(PLUS, 0)
	}
	/// Retrieves first TerminalNode corresponding to token MINUS
	/// Returns `None` if there is no child corresponding to token MINUS
	fn MINUS(&self) -> Option<Rc<TerminalNode<'input,athenasqlParserContextType>>> where Self:Sized{
		self.get_token(MINUS, 0)
	}
}

impl<'input> ArithmeticBinaryContextAttrs<'input> for ArithmeticBinaryContext<'input>{}

pub struct ArithmeticBinaryContextExt<'input>{
	base:ValueExpressionContextExt<'input>,
	pub left: Option<Rc<ValueExpressionContextAll<'input>>>,
	pub operator: Option<TokenType<'input>>,
	pub right: Option<Rc<ValueExpressionContextAll<'input>>>,
	ph:PhantomData<&'input str>
}

antlr_rust::tid!{ArithmeticBinaryContextExt<'a>}

impl<'input> athenasqlParserContext<'input> for ArithmeticBinaryContext<'input>{}

impl<'input,'a> Listenable<dyn athenasqlListener<'input> + 'a> for ArithmeticBinaryContext<'input>{
	fn enter(&self,listener: &mut (dyn athenasqlListener<'input> + 'a)) {
		listener.enter_every_rule(self);
		listener.enter_arithmeticBinary(self);
	}
}

impl<'input> CustomRuleContext<'input> for ArithmeticBinaryContextExt<'input>{
	type TF = LocalTokenFactory<'input>;
	type Ctx = athenasqlParserContextType;
	fn get_rule_index(&self) -> usize { RULE_valueExpression }
	//fn type_rule_index() -> usize where Self: Sized { RULE_valueExpression }
}

impl<'input> Borrow<ValueExpressionContextExt<'input>> for ArithmeticBinaryContext<'input>{
	fn borrow(&self) -> &ValueExpressionContextExt<'input> { &self.base }
}
impl<'input> BorrowMut<ValueExpressionContextExt<'input>> for ArithmeticBinaryContext<'input>{
	fn borrow_mut(&mut self) -> &mut ValueExpressionContextExt<'input> { &mut self.base }
}

impl<'input> ValueExpressionContextAttrs<'input> for ArithmeticBinaryContext<'input> {}

impl<'input> ArithmeticBinaryContextExt<'input>{
	fn new(ctx: &dyn ValueExpressionContextAttrs<'input>) -> Rc<ValueExpressionContextAll<'input>>  {
		Rc::new(
			ValueExpressionContextAll::ArithmeticBinaryContext(
				BaseParserRuleContext::copy_from(ctx,ArithmeticBinaryContextExt{
					operator:None, 
        			left:None, right:None, 
        			base: ctx.borrow().clone(),
        			ph:PhantomData
				})
			)
		)
	}
}

pub type ArithmeticUnaryContext<'input> = BaseParserRuleContext<'input,ArithmeticUnaryContextExt<'input>>;

pub trait ArithmeticUnaryContextAttrs<'input>: athenasqlParserContext<'input>{
	fn valueExpression(&self) -> Option<Rc<ValueExpressionContextAll<'input>>> where Self:Sized{
		self.child_of_type(0)
	}
	/// Retrieves first TerminalNode corresponding to token MINUS
	/// Returns `None` if there is no child corresponding to token MINUS
	fn MINUS(&self) -> Option<Rc<TerminalNode<'input,athenasqlParserContextType>>> where Self:Sized{
		self.get_token(MINUS, 0)
	}
	/// Retrieves first TerminalNode corresponding to token PLUS
	/// Returns `None` if there is no child corresponding to token PLUS
	fn PLUS(&self) -> Option<Rc<TerminalNode<'input,athenasqlParserContextType>>> where Self:Sized{
		self.get_token(PLUS, 0)
	}
}

impl<'input> ArithmeticUnaryContextAttrs<'input> for ArithmeticUnaryContext<'input>{}

pub struct ArithmeticUnaryContextExt<'input>{
	base:ValueExpressionContextExt<'input>,
	pub operator: Option<TokenType<'input>>,
	ph:PhantomData<&'input str>
}

antlr_rust::tid!{ArithmeticUnaryContextExt<'a>}

impl<'input> athenasqlParserContext<'input> for ArithmeticUnaryContext<'input>{}

impl<'input,'a> Listenable<dyn athenasqlListener<'input> + 'a> for ArithmeticUnaryContext<'input>{
	fn enter(&self,listener: &mut (dyn athenasqlListener<'input> + 'a)) {
		listener.enter_every_rule(self);
		listener.enter_arithmeticUnary(self);
	}
}

impl<'input> CustomRuleContext<'input> for ArithmeticUnaryContextExt<'input>{
	type TF = LocalTokenFactory<'input>;
	type Ctx = athenasqlParserContextType;
	fn get_rule_index(&self) -> usize { RULE_valueExpression }
	//fn type_rule_index() -> usize where Self: Sized { RULE_valueExpression }
}

impl<'input> Borrow<ValueExpressionContextExt<'input>> for ArithmeticUnaryContext<'input>{
	fn borrow(&self) -> &ValueExpressionContextExt<'input> { &self.base }
}
impl<'input> BorrowMut<ValueExpressionContextExt<'input>> for ArithmeticUnaryContext<'input>{
	fn borrow_mut(&mut self) -> &mut ValueExpressionContextExt<'input> { &mut self.base }
}

impl<'input> ValueExpressionContextAttrs<'input> for ArithmeticUnaryContext<'input> {}

impl<'input> ArithmeticUnaryContextExt<'input>{
	fn new(ctx: &dyn ValueExpressionContextAttrs<'input>) -> Rc<ValueExpressionContextAll<'input>>  {
		Rc::new(
			ValueExpressionContextAll::ArithmeticUnaryContext(
				BaseParserRuleContext::copy_from(ctx,ArithmeticUnaryContextExt{
					operator:None, 
        			base: ctx.borrow().clone(),
        			ph:PhantomData
				})
			)
		)
	}
}

pub type AtTimeZoneContext<'input> = BaseParserRuleContext<'input,AtTimeZoneContextExt<'input>>;

pub trait AtTimeZoneContextAttrs<'input>: athenasqlParserContext<'input>{
	fn valueExpression(&self) -> Option<Rc<ValueExpressionContextAll<'input>>> where Self:Sized{
		self.child_of_type(0)
	}
	/// Retrieves first TerminalNode corresponding to token AT
	/// Returns `None` if there is no child corresponding to token AT
	fn AT(&self) -> Option<Rc<TerminalNode<'input,athenasqlParserContextType>>> where Self:Sized{
		self.get_token(AT, 0)
	}
	fn timeZoneSpecifier(&self) -> Option<Rc<TimeZoneSpecifierContextAll<'input>>> where Self:Sized{
		self.child_of_type(0)
	}
}

impl<'input> AtTimeZoneContextAttrs<'input> for AtTimeZoneContext<'input>{}

pub struct AtTimeZoneContextExt<'input>{
	base:ValueExpressionContextExt<'input>,
	ph:PhantomData<&'input str>
}

antlr_rust::tid!{AtTimeZoneContextExt<'a>}

impl<'input> athenasqlParserContext<'input> for AtTimeZoneContext<'input>{}

impl<'input,'a> Listenable<dyn athenasqlListener<'input> + 'a> for AtTimeZoneContext<'input>{
	fn enter(&self,listener: &mut (dyn athenasqlListener<'input> + 'a)) {
		listener.enter_every_rule(self);
		listener.enter_atTimeZone(self);
	}
}

impl<'input> CustomRuleContext<'input> for AtTimeZoneContextExt<'input>{
	type TF = LocalTokenFactory<'input>;
	type Ctx = athenasqlParserContextType;
	fn get_rule_index(&self) -> usize { RULE_valueExpression }
	//fn type_rule_index() -> usize where Self: Sized { RULE_valueExpression }
}

impl<'input> Borrow<ValueExpressionContextExt<'input>> for AtTimeZoneContext<'input>{
	fn borrow(&self) -> &ValueExpressionContextExt<'input> { &self.base }
}
impl<'input> BorrowMut<ValueExpressionContextExt<'input>> for AtTimeZoneContext<'input>{
	fn borrow_mut(&mut self) -> &mut ValueExpressionContextExt<'input> { &mut self.base }
}

impl<'input> ValueExpressionContextAttrs<'input> for AtTimeZoneContext<'input> {}

impl<'input> AtTimeZoneContextExt<'input>{
	fn new(ctx: &dyn ValueExpressionContextAttrs<'input>) -> Rc<ValueExpressionContextAll<'input>>  {
		Rc::new(
			ValueExpressionContextAll::AtTimeZoneContext(
				BaseParserRuleContext::copy_from(ctx,AtTimeZoneContextExt{
        			base: ctx.borrow().clone(),
        			ph:PhantomData
				})
			)
		)
	}
}

impl<'input, I, H> athenasqlParser<'input, I, H>
where
    I: TokenStream<'input, TF = LocalTokenFactory<'input> > + TidAble<'input>,
    H: ErrorStrategy<'input,BaseParserType<'input,I>>
{
	pub fn  valueExpression(&mut self,)
	-> Result<Rc<ValueExpressionContextAll<'input>>,ANTLRError> {
		self.valueExpression_rec(0)
	}

	fn valueExpression_rec(&mut self, _p: isize)
	-> Result<Rc<ValueExpressionContextAll<'input>>,ANTLRError> {
		let recog = self;
		let _parentctx = recog.ctx.take();
		let _parentState = recog.base.get_state();
		let mut _localctx = ValueExpressionContextExt::new(_parentctx.clone(), recog.base.get_state());
		recog.base.enter_recursion_rule(_localctx.clone(), 72, RULE_valueExpression, _p);
	    let mut _localctx: Rc<ValueExpressionContextAll> = _localctx;
        let mut _prevctx = _localctx.clone();
		let _startState = 72;
		let mut _la: isize = -1;
		let result: Result<(), ANTLRError> = (|| {
			let mut _alt: isize;
			//recog.base.enter_outer_alt(_localctx.clone(), 1);
			recog.base.enter_outer_alt(None, 1);
			{
			recog.base.set_state(952);
			recog.err_handler.sync(&mut recog.base)?;
			match recog.base.input.la(1) {
			 T__1 | T__4 | ADD | ALL | SOME | ANY | AT | NO | EXISTS | NULL | TRUE |
			 FALSE | SUBSTRING | POSITION | TINYINT | SMALLINT | INTEGER | DATE |
			 TIME | TIMESTAMP | INTERVAL | YEAR | MONTH | DAY | HOUR | MINUTE | SECOND |
			 ZONE | CURRENT_DATE | CURRENT_TIME | CURRENT_TIMESTAMP | LOCALTIME |
			 LOCALTIMESTAMP | EXTRACT | CASE | FILTER | OVER | PARTITION | RANGE |
			 ROWS | PRECEDING | FOLLOWING | CURRENT | ROW | SCHEMA | COMMENT | VIEW |
			 REPLACE | GRANT | REVOKE | PRIVILEGES | PUBLIC | OPTION | EXPLAIN | ANALYZE |
			 FORMAT | TYPE | TEXT | GRAPHVIZ | LOGICAL | DISTRIBUTED | VALIDATE |
			 CAST | TRY_CAST | SHOW | TABLES | SCHEMAS | CATALOGS | COLUMNS | COLUMN |
			 USE | PARTITIONS | FUNCTIONS | TO | SYSTEM | BERNOULLI | POISSONIZED |
			 TABLESAMPLE | ARRAY | MAP | SET | RESET | SESSION | DATA | START | TRANSACTION |
			 COMMIT | ROLLBACK | WORK | ISOLATION | LEVEL | SERIALIZABLE | REPEATABLE |
			 COMMITTED | UNCOMMITTED | READ | WRITE | ONLY | CALL | INPUT | OUTPUT |
			 CASCADE | RESTRICT | INCLUDING | EXCLUDING | PROPERTIES | NORMALIZE |
			 NFD | NFC | NFKD | NFKC | IF | NULLIF | COALESCE | STRING | BINARY_LITERAL |
			 INTEGER_VALUE | DECIMAL_VALUE | IDENTIFIER | DIGIT_IDENTIFIER | QUOTED_IDENTIFIER |
			 BACKQUOTED_IDENTIFIER | DOUBLE_PRECISION 
				=> {
					{
					let mut tmp = ValueExpressionDefaultContextExt::new(&**_localctx);
					recog.ctx = Some(tmp.clone());
					_localctx = tmp;
					_prevctx = _localctx.clone();


					/*InvokeRule primaryExpression*/
					recog.base.set_state(949);
					recog.primaryExpression_rec(0)?;

					}
				}

			 PLUS | MINUS 
				=> {
					{
					let mut tmp = ArithmeticUnaryContextExt::new(&**_localctx);
					recog.ctx = Some(tmp.clone());
					_localctx = tmp;
					_prevctx = _localctx.clone();
					recog.base.set_state(950);
					if let ValueExpressionContextAll::ArithmeticUnaryContext(ctx) = cast_mut::<_,ValueExpressionContextAll >(&mut _localctx){
					ctx.operator = recog.base.input.lt(1).cloned(); } else {unreachable!("cant cast");} 
					_la = recog.base.input.la(1);
					if { !(_la==PLUS || _la==MINUS) } {
						let tmp = recog.err_handler.recover_inline(&mut recog.base)?;
						if let ValueExpressionContextAll::ArithmeticUnaryContext(ctx) = cast_mut::<_,ValueExpressionContextAll >(&mut _localctx){
						ctx.operator = Some(tmp.clone()); } else {unreachable!("cant cast");}  

					}
					else {
						if  recog.base.input.la(1)==TOKEN_EOF { recog.base.matched_eof = true };
						recog.err_handler.report_match(&mut recog.base);
						recog.base.consume(&mut recog.err_handler);
					}
					/*InvokeRule valueExpression*/
					recog.base.set_state(951);
					recog.valueExpression_rec(4)?;

					}
				}

				_ => Err(ANTLRError::NoAltError(NoViableAltError::new(&mut recog.base)))?
			}

			let tmp = recog.input.lt(-1).cloned();
			recog.ctx.as_ref().unwrap().set_stop(tmp);
			recog.base.set_state(968);
			recog.err_handler.sync(&mut recog.base)?;
			_alt = recog.interpreter.adaptive_predict(120,&mut recog.base)?;
			while { _alt!=2 && _alt!=INVALID_ALT } {
				if _alt==1 {
					recog.trigger_exit_rule_event();
					_prevctx = _localctx.clone();
					{
					recog.base.set_state(966);
					recog.err_handler.sync(&mut recog.base)?;
					match  recog.interpreter.adaptive_predict(119,&mut recog.base)? {
						1 =>{
							{
							/*recRuleLabeledAltStartAction*/
							let mut tmp = ArithmeticBinaryContextExt::new(&**ValueExpressionContextExt::new(_parentctx.clone(), _parentState));
							if let ValueExpressionContextAll::ArithmeticBinaryContext(ctx) = cast_mut::<_,ValueExpressionContextAll >(&mut tmp){
								ctx.left = Some(_prevctx.clone());
							} else {unreachable!("cant cast");}
							recog.push_new_recursion_context(tmp.clone(), _startState, RULE_valueExpression);
							_localctx = tmp;
							recog.base.set_state(954);
							if !({recog.precpred(None, 3)}) {
								Err(FailedPredicateError::new(&mut recog.base, Some("recog.precpred(None, 3)".to_owned()), None))?;
							}
							recog.base.set_state(955);
							if let ValueExpressionContextAll::ArithmeticBinaryContext(ctx) = cast_mut::<_,ValueExpressionContextAll >(&mut _localctx){
							ctx.operator = recog.base.input.lt(1).cloned(); } else {unreachable!("cant cast");} 
							_la = recog.base.input.la(1);
							if { !(((((_la - 194)) & !0x3f) == 0 && ((1usize << (_la - 194)) & ((1usize << (ASTERISK - 194)) | (1usize << (SLASH - 194)) | (1usize << (PERCENT - 194)))) != 0)) } {
								let tmp = recog.err_handler.recover_inline(&mut recog.base)?;
								if let ValueExpressionContextAll::ArithmeticBinaryContext(ctx) = cast_mut::<_,ValueExpressionContextAll >(&mut _localctx){
								ctx.operator = Some(tmp.clone()); } else {unreachable!("cant cast");}  

							}
							else {
								if  recog.base.input.la(1)==TOKEN_EOF { recog.base.matched_eof = true };
								recog.err_handler.report_match(&mut recog.base);
								recog.base.consume(&mut recog.err_handler);
							}
							/*InvokeRule valueExpression*/
							recog.base.set_state(956);
							let tmp = recog.valueExpression_rec(4)?;
							if let ValueExpressionContextAll::ArithmeticBinaryContext(ctx) = cast_mut::<_,ValueExpressionContextAll >(&mut _localctx){
							ctx.right = Some(tmp.clone()); } else {unreachable!("cant cast");}  

							}
						}
					,
						2 =>{
							{
							/*recRuleLabeledAltStartAction*/
							let mut tmp = ArithmeticBinaryContextExt::new(&**ValueExpressionContextExt::new(_parentctx.clone(), _parentState));
							if let ValueExpressionContextAll::ArithmeticBinaryContext(ctx) = cast_mut::<_,ValueExpressionContextAll >(&mut tmp){
								ctx.left = Some(_prevctx.clone());
							} else {unreachable!("cant cast");}
							recog.push_new_recursion_context(tmp.clone(), _startState, RULE_valueExpression);
							_localctx = tmp;
							recog.base.set_state(957);
							if !({recog.precpred(None, 2)}) {
								Err(FailedPredicateError::new(&mut recog.base, Some("recog.precpred(None, 2)".to_owned()), None))?;
							}
							recog.base.set_state(958);
							if let ValueExpressionContextAll::ArithmeticBinaryContext(ctx) = cast_mut::<_,ValueExpressionContextAll >(&mut _localctx){
							ctx.operator = recog.base.input.lt(1).cloned(); } else {unreachable!("cant cast");} 
							_la = recog.base.input.la(1);
							if { !(_la==PLUS || _la==MINUS) } {
								let tmp = recog.err_handler.recover_inline(&mut recog.base)?;
								if let ValueExpressionContextAll::ArithmeticBinaryContext(ctx) = cast_mut::<_,ValueExpressionContextAll >(&mut _localctx){
								ctx.operator = Some(tmp.clone()); } else {unreachable!("cant cast");}  

							}
							else {
								if  recog.base.input.la(1)==TOKEN_EOF { recog.base.matched_eof = true };
								recog.err_handler.report_match(&mut recog.base);
								recog.base.consume(&mut recog.err_handler);
							}
							/*InvokeRule valueExpression*/
							recog.base.set_state(959);
							let tmp = recog.valueExpression_rec(3)?;
							if let ValueExpressionContextAll::ArithmeticBinaryContext(ctx) = cast_mut::<_,ValueExpressionContextAll >(&mut _localctx){
							ctx.right = Some(tmp.clone()); } else {unreachable!("cant cast");}  

							}
						}
					,
						3 =>{
							{
							/*recRuleLabeledAltStartAction*/
							let mut tmp = ConcatenationContextExt::new(&**ValueExpressionContextExt::new(_parentctx.clone(), _parentState));
							if let ValueExpressionContextAll::ConcatenationContext(ctx) = cast_mut::<_,ValueExpressionContextAll >(&mut tmp){
								ctx.left = Some(_prevctx.clone());
							} else {unreachable!("cant cast");}
							recog.push_new_recursion_context(tmp.clone(), _startState, RULE_valueExpression);
							_localctx = tmp;
							recog.base.set_state(960);
							if !({recog.precpred(None, 1)}) {
								Err(FailedPredicateError::new(&mut recog.base, Some("recog.precpred(None, 1)".to_owned()), None))?;
							}
							recog.base.set_state(961);
							recog.base.match_token(CONCAT,&mut recog.err_handler)?;

							/*InvokeRule valueExpression*/
							recog.base.set_state(962);
							let tmp = recog.valueExpression_rec(2)?;
							if let ValueExpressionContextAll::ConcatenationContext(ctx) = cast_mut::<_,ValueExpressionContextAll >(&mut _localctx){
							ctx.right = Some(tmp.clone()); } else {unreachable!("cant cast");}  

							}
						}
					,
						4 =>{
							{
							/*recRuleLabeledAltStartAction*/
							let mut tmp = AtTimeZoneContextExt::new(&**ValueExpressionContextExt::new(_parentctx.clone(), _parentState));
							recog.push_new_recursion_context(tmp.clone(), _startState, RULE_valueExpression);
							_localctx = tmp;
							recog.base.set_state(963);
							if !({recog.precpred(None, 5)}) {
								Err(FailedPredicateError::new(&mut recog.base, Some("recog.precpred(None, 5)".to_owned()), None))?;
							}
							recog.base.set_state(964);
							recog.base.match_token(AT,&mut recog.err_handler)?;

							/*InvokeRule timeZoneSpecifier*/
							recog.base.set_state(965);
							recog.timeZoneSpecifier()?;

							}
						}

						_ => {}
					}
					} 
				}
				recog.base.set_state(970);
				recog.err_handler.sync(&mut recog.base)?;
				_alt = recog.interpreter.adaptive_predict(120,&mut recog.base)?;
			}
			}
			Ok(())
		})();
		match result {
		Ok(_) => {},
        Err(e @ ANTLRError::FallThrough(_)) => return Err(e),
		Err(ref re)=>{
			//_localctx.exception = re;
			recog.err_handler.report_error(&mut recog.base, re);
	        recog.err_handler.recover(&mut recog.base, re)?;}
		}
		recog.base.unroll_recursion_context(_parentctx);

		Ok(_localctx)
	}
}
//------------------- columnReference ----------------
pub type ColumnReferenceContextAll<'input> = ColumnReferenceContext<'input>;


pub type ColumnReferenceContext<'input> = BaseParserRuleContext<'input,ColumnReferenceContextExt<'input>>;

#[derive(Clone)]
pub struct ColumnReferenceContextExt<'input>{
ph:PhantomData<&'input str>
}

impl<'input> athenasqlParserContext<'input> for ColumnReferenceContext<'input>{}

impl<'input,'a> Listenable<dyn athenasqlListener<'input> + 'a> for ColumnReferenceContext<'input>{
		fn enter(&self,listener: &mut (dyn athenasqlListener<'input> + 'a)) {
			listener.enter_every_rule(self);
			listener.enter_columnReference(self);
		}fn exit(&self,listener: &mut (dyn athenasqlListener<'input> + 'a)) {
			listener.exit_columnReference(self);
			listener.exit_every_rule(self);
		}
}

impl<'input> CustomRuleContext<'input> for ColumnReferenceContextExt<'input>{
	type TF = LocalTokenFactory<'input>;
	type Ctx = athenasqlParserContextType;
	fn get_rule_index(&self) -> usize { RULE_columnReference }
	//fn type_rule_index() -> usize where Self: Sized { RULE_columnReference }
}
antlr_rust::tid!{ColumnReferenceContextExt<'a>}

impl<'input> ColumnReferenceContextExt<'input>{
	fn new(parent: Option<Rc<dyn athenasqlParserContext<'input> + 'input > >, invoking_state: isize) -> Rc<ColumnReferenceContextAll<'input>> {
		Rc::new(
			BaseParserRuleContext::new_parser_ctx(parent, invoking_state,ColumnReferenceContextExt{
				ph:PhantomData
			}),
		)
	}
}

pub trait ColumnReferenceContextAttrs<'input>: athenasqlParserContext<'input> + BorrowMut<ColumnReferenceContextExt<'input>>{

fn identifier(&self) -> Option<Rc<IdentifierContextAll<'input>>> where Self:Sized{
	self.child_of_type(0)
}

}

impl<'input> ColumnReferenceContextAttrs<'input> for ColumnReferenceContext<'input>{}

impl<'input, I, H> athenasqlParser<'input, I, H>
where
    I: TokenStream<'input, TF = LocalTokenFactory<'input> > + TidAble<'input>,
    H: ErrorStrategy<'input,BaseParserType<'input,I>>
{
	pub fn columnReference(&mut self,)
	-> Result<Rc<ColumnReferenceContextAll<'input>>,ANTLRError> {
		let mut recog = self;
		let _parentctx = recog.ctx.take();
		let mut _localctx = ColumnReferenceContextExt::new(_parentctx.clone(), recog.base.get_state());
        recog.base.enter_rule(_localctx.clone(), 74, RULE_columnReference);
        let mut _localctx: Rc<ColumnReferenceContextAll> = _localctx;
		let result: Result<(), ANTLRError> = (|| {

			//recog.base.enter_outer_alt(_localctx.clone(), 1);
			recog.base.enter_outer_alt(None, 1);
			{
			/*InvokeRule identifier*/
			recog.base.set_state(971);
			recog.identifier()?;

			}
			Ok(())
		})();
		match result {
		Ok(_)=>{},
        Err(e @ ANTLRError::FallThrough(_)) => return Err(e),
		Err(ref re) => {
				//_localctx.exception = re;
				recog.err_handler.report_error(&mut recog.base, re);
				recog.err_handler.recover(&mut recog.base, re)?;
			}
		}
		recog.base.exit_rule();

		Ok(_localctx)
	}
}
//------------------- primaryExpression ----------------
#[derive(Debug)]
pub enum PrimaryExpressionContextAll<'input>{
	DereferenceContext(DereferenceContext<'input>),
	TypeConstructorContext(TypeConstructorContext<'input>),
	SpecialDateTimeFunctionContext(SpecialDateTimeFunctionContext<'input>),
	SubstringContext(SubstringContext<'input>),
	CastContext(CastContext<'input>),
	LambdaContext(LambdaContext<'input>),
	ParenthesizedExpressionContext(ParenthesizedExpressionContext<'input>),
	ParameterContext(ParameterContext<'input>),
	NormalizeContext(NormalizeContext<'input>),
	IntervalLiteralContext(IntervalLiteralContext<'input>),
	NumericLiteralContext(NumericLiteralContext<'input>),
	BooleanLiteralContext(BooleanLiteralContext<'input>),
	SimpleCaseContext(SimpleCaseContext<'input>),
	NullLiteralContext(NullLiteralContext<'input>),
	RowConstructorContext(RowConstructorContext<'input>),
	SubscriptContext(SubscriptContext<'input>),
	SubqueryExpressionContext(SubqueryExpressionContext<'input>),
	BinaryLiteralContext(BinaryLiteralContext<'input>),
	ExtractContext(ExtractContext<'input>),
	StringLiteralContext(StringLiteralContext<'input>),
	ArrayConstructorContext(ArrayConstructorContext<'input>),
	FunctionCallContext(FunctionCallContext<'input>),
	ExistsContext(ExistsContext<'input>),
	PositionContext(PositionContext<'input>),
	SearchedCaseContext(SearchedCaseContext<'input>),
	ColumnNameContext(ColumnNameContext<'input>),
Error(PrimaryExpressionContext<'input>)
}
antlr_rust::tid!{PrimaryExpressionContextAll<'a>}

impl<'input> antlr_rust::parser_rule_context::DerefSeal for PrimaryExpressionContextAll<'input>{}

impl<'input> athenasqlParserContext<'input> for PrimaryExpressionContextAll<'input>{}

impl<'input> Deref for PrimaryExpressionContextAll<'input>{
	type Target = dyn PrimaryExpressionContextAttrs<'input> + 'input;
	fn deref(&self) -> &Self::Target{
		use PrimaryExpressionContextAll::*;
		match self{
			DereferenceContext(inner) => inner,
			TypeConstructorContext(inner) => inner,
			SpecialDateTimeFunctionContext(inner) => inner,
			SubstringContext(inner) => inner,
			CastContext(inner) => inner,
			LambdaContext(inner) => inner,
			ParenthesizedExpressionContext(inner) => inner,
			ParameterContext(inner) => inner,
			NormalizeContext(inner) => inner,
			IntervalLiteralContext(inner) => inner,
			NumericLiteralContext(inner) => inner,
			BooleanLiteralContext(inner) => inner,
			SimpleCaseContext(inner) => inner,
			NullLiteralContext(inner) => inner,
			RowConstructorContext(inner) => inner,
			SubscriptContext(inner) => inner,
			SubqueryExpressionContext(inner) => inner,
			BinaryLiteralContext(inner) => inner,
			ExtractContext(inner) => inner,
			StringLiteralContext(inner) => inner,
			ArrayConstructorContext(inner) => inner,
			FunctionCallContext(inner) => inner,
			ExistsContext(inner) => inner,
			PositionContext(inner) => inner,
			SearchedCaseContext(inner) => inner,
			ColumnNameContext(inner) => inner,
Error(inner) => inner
		}
	}
}
impl<'input,'a> Listenable<dyn athenasqlListener<'input> + 'a> for PrimaryExpressionContextAll<'input>{
    fn enter(&self, listener: &mut (dyn athenasqlListener<'input> + 'a)) { self.deref().enter(listener) }
    fn exit(&self, listener: &mut (dyn athenasqlListener<'input> + 'a)) { self.deref().exit(listener) }
}



pub type PrimaryExpressionContext<'input> = BaseParserRuleContext<'input,PrimaryExpressionContextExt<'input>>;

#[derive(Clone)]
pub struct PrimaryExpressionContextExt<'input>{
ph:PhantomData<&'input str>
}

impl<'input> athenasqlParserContext<'input> for PrimaryExpressionContext<'input>{}

impl<'input,'a> Listenable<dyn athenasqlListener<'input> + 'a> for PrimaryExpressionContext<'input>{
}

impl<'input> CustomRuleContext<'input> for PrimaryExpressionContextExt<'input>{
	type TF = LocalTokenFactory<'input>;
	type Ctx = athenasqlParserContextType;
	fn get_rule_index(&self) -> usize { RULE_primaryExpression }
	//fn type_rule_index() -> usize where Self: Sized { RULE_primaryExpression }
}
antlr_rust::tid!{PrimaryExpressionContextExt<'a>}

impl<'input> PrimaryExpressionContextExt<'input>{
	fn new(parent: Option<Rc<dyn athenasqlParserContext<'input> + 'input > >, invoking_state: isize) -> Rc<PrimaryExpressionContextAll<'input>> {
		Rc::new(
		PrimaryExpressionContextAll::Error(
			BaseParserRuleContext::new_parser_ctx(parent, invoking_state,PrimaryExpressionContextExt{
				ph:PhantomData
			}),
		)
		)
	}
}

pub trait PrimaryExpressionContextAttrs<'input>: athenasqlParserContext<'input> + BorrowMut<PrimaryExpressionContextExt<'input>>{


}

impl<'input> PrimaryExpressionContextAttrs<'input> for PrimaryExpressionContext<'input>{}

pub type DereferenceContext<'input> = BaseParserRuleContext<'input,DereferenceContextExt<'input>>;

pub trait DereferenceContextAttrs<'input>: athenasqlParserContext<'input>{
	fn primaryExpression(&self) -> Option<Rc<PrimaryExpressionContextAll<'input>>> where Self:Sized{
		self.child_of_type(0)
	}
	fn identifier(&self) -> Option<Rc<IdentifierContextAll<'input>>> where Self:Sized{
		self.child_of_type(0)
	}
}

impl<'input> DereferenceContextAttrs<'input> for DereferenceContext<'input>{}

pub struct DereferenceContextExt<'input>{
	base:PrimaryExpressionContextExt<'input>,
	pub base: Option<Rc<PrimaryExpressionContextAll<'input>>>,
	pub fieldName: Option<Rc<IdentifierContextAll<'input>>>,
	ph:PhantomData<&'input str>
}

antlr_rust::tid!{DereferenceContextExt<'a>}

impl<'input> athenasqlParserContext<'input> for DereferenceContext<'input>{}

impl<'input,'a> Listenable<dyn athenasqlListener<'input> + 'a> for DereferenceContext<'input>{
	fn enter(&self,listener: &mut (dyn athenasqlListener<'input> + 'a)) {
		listener.enter_every_rule(self);
		listener.enter_dereference(self);
	}
}

impl<'input> CustomRuleContext<'input> for DereferenceContextExt<'input>{
	type TF = LocalTokenFactory<'input>;
	type Ctx = athenasqlParserContextType;
	fn get_rule_index(&self) -> usize { RULE_primaryExpression }
	//fn type_rule_index() -> usize where Self: Sized { RULE_primaryExpression }
}

impl<'input> Borrow<PrimaryExpressionContextExt<'input>> for DereferenceContext<'input>{
	fn borrow(&self) -> &PrimaryExpressionContextExt<'input> { &self.base }
}
impl<'input> BorrowMut<PrimaryExpressionContextExt<'input>> for DereferenceContext<'input>{
	fn borrow_mut(&mut self) -> &mut PrimaryExpressionContextExt<'input> { &mut self.base }
}

impl<'input> PrimaryExpressionContextAttrs<'input> for DereferenceContext<'input> {}

impl<'input> DereferenceContextExt<'input>{
	fn new(ctx: &dyn PrimaryExpressionContextAttrs<'input>) -> Rc<PrimaryExpressionContextAll<'input>>  {
		Rc::new(
			PrimaryExpressionContextAll::DereferenceContext(
				BaseParserRuleContext::copy_from(ctx,DereferenceContextExt{
        			base:None, fieldName:None, 
        			base: ctx.borrow().clone(),
        			ph:PhantomData
				})
			)
		)
	}
}

pub type TypeConstructorContext<'input> = BaseParserRuleContext<'input,TypeConstructorContextExt<'input>>;

pub trait TypeConstructorContextAttrs<'input>: athenasqlParserContext<'input>{
	fn identifier(&self) -> Option<Rc<IdentifierContextAll<'input>>> where Self:Sized{
		self.child_of_type(0)
	}
	/// Retrieves first TerminalNode corresponding to token STRING
	/// Returns `None` if there is no child corresponding to token STRING
	fn STRING(&self) -> Option<Rc<TerminalNode<'input,athenasqlParserContextType>>> where Self:Sized{
		self.get_token(STRING, 0)
	}
	/// Retrieves first TerminalNode corresponding to token DOUBLE_PRECISION
	/// Returns `None` if there is no child corresponding to token DOUBLE_PRECISION
	fn DOUBLE_PRECISION(&self) -> Option<Rc<TerminalNode<'input,athenasqlParserContextType>>> where Self:Sized{
		self.get_token(DOUBLE_PRECISION, 0)
	}
}

impl<'input> TypeConstructorContextAttrs<'input> for TypeConstructorContext<'input>{}

pub struct TypeConstructorContextExt<'input>{
	base:PrimaryExpressionContextExt<'input>,
	ph:PhantomData<&'input str>
}

antlr_rust::tid!{TypeConstructorContextExt<'a>}

impl<'input> athenasqlParserContext<'input> for TypeConstructorContext<'input>{}

impl<'input,'a> Listenable<dyn athenasqlListener<'input> + 'a> for TypeConstructorContext<'input>{
	fn enter(&self,listener: &mut (dyn athenasqlListener<'input> + 'a)) {
		listener.enter_every_rule(self);
		listener.enter_typeConstructor(self);
	}
}

impl<'input> CustomRuleContext<'input> for TypeConstructorContextExt<'input>{
	type TF = LocalTokenFactory<'input>;
	type Ctx = athenasqlParserContextType;
	fn get_rule_index(&self) -> usize { RULE_primaryExpression }
	//fn type_rule_index() -> usize where Self: Sized { RULE_primaryExpression }
}

impl<'input> Borrow<PrimaryExpressionContextExt<'input>> for TypeConstructorContext<'input>{
	fn borrow(&self) -> &PrimaryExpressionContextExt<'input> { &self.base }
}
impl<'input> BorrowMut<PrimaryExpressionContextExt<'input>> for TypeConstructorContext<'input>{
	fn borrow_mut(&mut self) -> &mut PrimaryExpressionContextExt<'input> { &mut self.base }
}

impl<'input> PrimaryExpressionContextAttrs<'input> for TypeConstructorContext<'input> {}

impl<'input> TypeConstructorContextExt<'input>{
	fn new(ctx: &dyn PrimaryExpressionContextAttrs<'input>) -> Rc<PrimaryExpressionContextAll<'input>>  {
		Rc::new(
			PrimaryExpressionContextAll::TypeConstructorContext(
				BaseParserRuleContext::copy_from(ctx,TypeConstructorContextExt{
        			base: ctx.borrow().clone(),
        			ph:PhantomData
				})
			)
		)
	}
}

pub type SpecialDateTimeFunctionContext<'input> = BaseParserRuleContext<'input,SpecialDateTimeFunctionContextExt<'input>>;

pub trait SpecialDateTimeFunctionContextAttrs<'input>: athenasqlParserContext<'input>{
	/// Retrieves first TerminalNode corresponding to token CURRENT_DATE
	/// Returns `None` if there is no child corresponding to token CURRENT_DATE
	fn CURRENT_DATE(&self) -> Option<Rc<TerminalNode<'input,athenasqlParserContextType>>> where Self:Sized{
		self.get_token(CURRENT_DATE, 0)
	}
	/// Retrieves first TerminalNode corresponding to token CURRENT_TIME
	/// Returns `None` if there is no child corresponding to token CURRENT_TIME
	fn CURRENT_TIME(&self) -> Option<Rc<TerminalNode<'input,athenasqlParserContextType>>> where Self:Sized{
		self.get_token(CURRENT_TIME, 0)
	}
	/// Retrieves first TerminalNode corresponding to token INTEGER_VALUE
	/// Returns `None` if there is no child corresponding to token INTEGER_VALUE
	fn INTEGER_VALUE(&self) -> Option<Rc<TerminalNode<'input,athenasqlParserContextType>>> where Self:Sized{
		self.get_token(INTEGER_VALUE, 0)
	}
	/// Retrieves first TerminalNode corresponding to token CURRENT_TIMESTAMP
	/// Returns `None` if there is no child corresponding to token CURRENT_TIMESTAMP
	fn CURRENT_TIMESTAMP(&self) -> Option<Rc<TerminalNode<'input,athenasqlParserContextType>>> where Self:Sized{
		self.get_token(CURRENT_TIMESTAMP, 0)
	}
	/// Retrieves first TerminalNode corresponding to token LOCALTIME
	/// Returns `None` if there is no child corresponding to token LOCALTIME
	fn LOCALTIME(&self) -> Option<Rc<TerminalNode<'input,athenasqlParserContextType>>> where Self:Sized{
		self.get_token(LOCALTIME, 0)
	}
	/// Retrieves first TerminalNode corresponding to token LOCALTIMESTAMP
	/// Returns `None` if there is no child corresponding to token LOCALTIMESTAMP
	fn LOCALTIMESTAMP(&self) -> Option<Rc<TerminalNode<'input,athenasqlParserContextType>>> where Self:Sized{
		self.get_token(LOCALTIMESTAMP, 0)
	}
}

impl<'input> SpecialDateTimeFunctionContextAttrs<'input> for SpecialDateTimeFunctionContext<'input>{}

pub struct SpecialDateTimeFunctionContextExt<'input>{
	base:PrimaryExpressionContextExt<'input>,
	pub name: Option<TokenType<'input>>,
	pub precision: Option<TokenType<'input>>,
	ph:PhantomData<&'input str>
}

antlr_rust::tid!{SpecialDateTimeFunctionContextExt<'a>}

impl<'input> athenasqlParserContext<'input> for SpecialDateTimeFunctionContext<'input>{}

impl<'input,'a> Listenable<dyn athenasqlListener<'input> + 'a> for SpecialDateTimeFunctionContext<'input>{
	fn enter(&self,listener: &mut (dyn athenasqlListener<'input> + 'a)) {
		listener.enter_every_rule(self);
		listener.enter_specialDateTimeFunction(self);
	}
}

impl<'input> CustomRuleContext<'input> for SpecialDateTimeFunctionContextExt<'input>{
	type TF = LocalTokenFactory<'input>;
	type Ctx = athenasqlParserContextType;
	fn get_rule_index(&self) -> usize { RULE_primaryExpression }
	//fn type_rule_index() -> usize where Self: Sized { RULE_primaryExpression }
}

impl<'input> Borrow<PrimaryExpressionContextExt<'input>> for SpecialDateTimeFunctionContext<'input>{
	fn borrow(&self) -> &PrimaryExpressionContextExt<'input> { &self.base }
}
impl<'input> BorrowMut<PrimaryExpressionContextExt<'input>> for SpecialDateTimeFunctionContext<'input>{
	fn borrow_mut(&mut self) -> &mut PrimaryExpressionContextExt<'input> { &mut self.base }
}

impl<'input> PrimaryExpressionContextAttrs<'input> for SpecialDateTimeFunctionContext<'input> {}

impl<'input> SpecialDateTimeFunctionContextExt<'input>{
	fn new(ctx: &dyn PrimaryExpressionContextAttrs<'input>) -> Rc<PrimaryExpressionContextAll<'input>>  {
		Rc::new(
			PrimaryExpressionContextAll::SpecialDateTimeFunctionContext(
				BaseParserRuleContext::copy_from(ctx,SpecialDateTimeFunctionContextExt{
					name:None, precision:None, 
        			base: ctx.borrow().clone(),
        			ph:PhantomData
				})
			)
		)
	}
}

pub type SubstringContext<'input> = BaseParserRuleContext<'input,SubstringContextExt<'input>>;

pub trait SubstringContextAttrs<'input>: athenasqlParserContext<'input>{
	/// Retrieves first TerminalNode corresponding to token SUBSTRING
	/// Returns `None` if there is no child corresponding to token SUBSTRING
	fn SUBSTRING(&self) -> Option<Rc<TerminalNode<'input,athenasqlParserContextType>>> where Self:Sized{
		self.get_token(SUBSTRING, 0)
	}
	fn valueExpression_all(&self) ->  Vec<Rc<ValueExpressionContextAll<'input>>> where Self:Sized{
		self.children_of_type()
	}
	fn valueExpression(&self, i: usize) -> Option<Rc<ValueExpressionContextAll<'input>>> where Self:Sized{
		self.child_of_type(i)
	}
	/// Retrieves first TerminalNode corresponding to token FROM
	/// Returns `None` if there is no child corresponding to token FROM
	fn FROM(&self) -> Option<Rc<TerminalNode<'input,athenasqlParserContextType>>> where Self:Sized{
		self.get_token(FROM, 0)
	}
	/// Retrieves first TerminalNode corresponding to token FOR
	/// Returns `None` if there is no child corresponding to token FOR
	fn FOR(&self) -> Option<Rc<TerminalNode<'input,athenasqlParserContextType>>> where Self:Sized{
		self.get_token(FOR, 0)
	}
}

impl<'input> SubstringContextAttrs<'input> for SubstringContext<'input>{}

pub struct SubstringContextExt<'input>{
	base:PrimaryExpressionContextExt<'input>,
	ph:PhantomData<&'input str>
}

antlr_rust::tid!{SubstringContextExt<'a>}

impl<'input> athenasqlParserContext<'input> for SubstringContext<'input>{}

impl<'input,'a> Listenable<dyn athenasqlListener<'input> + 'a> for SubstringContext<'input>{
	fn enter(&self,listener: &mut (dyn athenasqlListener<'input> + 'a)) {
		listener.enter_every_rule(self);
		listener.enter_substring(self);
	}
}

impl<'input> CustomRuleContext<'input> for SubstringContextExt<'input>{
	type TF = LocalTokenFactory<'input>;
	type Ctx = athenasqlParserContextType;
	fn get_rule_index(&self) -> usize { RULE_primaryExpression }
	//fn type_rule_index() -> usize where Self: Sized { RULE_primaryExpression }
}

impl<'input> Borrow<PrimaryExpressionContextExt<'input>> for SubstringContext<'input>{
	fn borrow(&self) -> &PrimaryExpressionContextExt<'input> { &self.base }
}
impl<'input> BorrowMut<PrimaryExpressionContextExt<'input>> for SubstringContext<'input>{
	fn borrow_mut(&mut self) -> &mut PrimaryExpressionContextExt<'input> { &mut self.base }
}

impl<'input> PrimaryExpressionContextAttrs<'input> for SubstringContext<'input> {}

impl<'input> SubstringContextExt<'input>{
	fn new(ctx: &dyn PrimaryExpressionContextAttrs<'input>) -> Rc<PrimaryExpressionContextAll<'input>>  {
		Rc::new(
			PrimaryExpressionContextAll::SubstringContext(
				BaseParserRuleContext::copy_from(ctx,SubstringContextExt{
        			base: ctx.borrow().clone(),
        			ph:PhantomData
				})
			)
		)
	}
}

pub type CastContext<'input> = BaseParserRuleContext<'input,CastContextExt<'input>>;

pub trait CastContextAttrs<'input>: athenasqlParserContext<'input>{
	/// Retrieves first TerminalNode corresponding to token CAST
	/// Returns `None` if there is no child corresponding to token CAST
	fn CAST(&self) -> Option<Rc<TerminalNode<'input,athenasqlParserContextType>>> where Self:Sized{
		self.get_token(CAST, 0)
	}
	fn expression(&self) -> Option<Rc<ExpressionContextAll<'input>>> where Self:Sized{
		self.child_of_type(0)
	}
	/// Retrieves first TerminalNode corresponding to token AS
	/// Returns `None` if there is no child corresponding to token AS
	fn AS(&self) -> Option<Rc<TerminalNode<'input,athenasqlParserContextType>>> where Self:Sized{
		self.get_token(AS, 0)
	}
	fn type(&self) -> Option<Rc<TypeContextAll<'input>>> where Self:Sized{
		self.child_of_type(0)
	}
	/// Retrieves first TerminalNode corresponding to token TRY_CAST
	/// Returns `None` if there is no child corresponding to token TRY_CAST
	fn TRY_CAST(&self) -> Option<Rc<TerminalNode<'input,athenasqlParserContextType>>> where Self:Sized{
		self.get_token(TRY_CAST, 0)
	}
}

impl<'input> CastContextAttrs<'input> for CastContext<'input>{}

pub struct CastContextExt<'input>{
	base:PrimaryExpressionContextExt<'input>,
	ph:PhantomData<&'input str>
}

antlr_rust::tid!{CastContextExt<'a>}

impl<'input> athenasqlParserContext<'input> for CastContext<'input>{}

impl<'input,'a> Listenable<dyn athenasqlListener<'input> + 'a> for CastContext<'input>{
	fn enter(&self,listener: &mut (dyn athenasqlListener<'input> + 'a)) {
		listener.enter_every_rule(self);
		listener.enter_cast(self);
	}
}

impl<'input> CustomRuleContext<'input> for CastContextExt<'input>{
	type TF = LocalTokenFactory<'input>;
	type Ctx = athenasqlParserContextType;
	fn get_rule_index(&self) -> usize { RULE_primaryExpression }
	//fn type_rule_index() -> usize where Self: Sized { RULE_primaryExpression }
}

impl<'input> Borrow<PrimaryExpressionContextExt<'input>> for CastContext<'input>{
	fn borrow(&self) -> &PrimaryExpressionContextExt<'input> { &self.base }
}
impl<'input> BorrowMut<PrimaryExpressionContextExt<'input>> for CastContext<'input>{
	fn borrow_mut(&mut self) -> &mut PrimaryExpressionContextExt<'input> { &mut self.base }
}

impl<'input> PrimaryExpressionContextAttrs<'input> for CastContext<'input> {}

impl<'input> CastContextExt<'input>{
	fn new(ctx: &dyn PrimaryExpressionContextAttrs<'input>) -> Rc<PrimaryExpressionContextAll<'input>>  {
		Rc::new(
			PrimaryExpressionContextAll::CastContext(
				BaseParserRuleContext::copy_from(ctx,CastContextExt{
        			base: ctx.borrow().clone(),
        			ph:PhantomData
				})
			)
		)
	}
}

pub type LambdaContext<'input> = BaseParserRuleContext<'input,LambdaContextExt<'input>>;

pub trait LambdaContextAttrs<'input>: athenasqlParserContext<'input>{
	fn identifier_all(&self) ->  Vec<Rc<IdentifierContextAll<'input>>> where Self:Sized{
		self.children_of_type()
	}
	fn identifier(&self, i: usize) -> Option<Rc<IdentifierContextAll<'input>>> where Self:Sized{
		self.child_of_type(i)
	}
	fn expression(&self) -> Option<Rc<ExpressionContextAll<'input>>> where Self:Sized{
		self.child_of_type(0)
	}
}

impl<'input> LambdaContextAttrs<'input> for LambdaContext<'input>{}

pub struct LambdaContextExt<'input>{
	base:PrimaryExpressionContextExt<'input>,
	ph:PhantomData<&'input str>
}

antlr_rust::tid!{LambdaContextExt<'a>}

impl<'input> athenasqlParserContext<'input> for LambdaContext<'input>{}

impl<'input,'a> Listenable<dyn athenasqlListener<'input> + 'a> for LambdaContext<'input>{
	fn enter(&self,listener: &mut (dyn athenasqlListener<'input> + 'a)) {
		listener.enter_every_rule(self);
		listener.enter_lambda(self);
	}
}

impl<'input> CustomRuleContext<'input> for LambdaContextExt<'input>{
	type TF = LocalTokenFactory<'input>;
	type Ctx = athenasqlParserContextType;
	fn get_rule_index(&self) -> usize { RULE_primaryExpression }
	//fn type_rule_index() -> usize where Self: Sized { RULE_primaryExpression }
}

impl<'input> Borrow<PrimaryExpressionContextExt<'input>> for LambdaContext<'input>{
	fn borrow(&self) -> &PrimaryExpressionContextExt<'input> { &self.base }
}
impl<'input> BorrowMut<PrimaryExpressionContextExt<'input>> for LambdaContext<'input>{
	fn borrow_mut(&mut self) -> &mut PrimaryExpressionContextExt<'input> { &mut self.base }
}

impl<'input> PrimaryExpressionContextAttrs<'input> for LambdaContext<'input> {}

impl<'input> LambdaContextExt<'input>{
	fn new(ctx: &dyn PrimaryExpressionContextAttrs<'input>) -> Rc<PrimaryExpressionContextAll<'input>>  {
		Rc::new(
			PrimaryExpressionContextAll::LambdaContext(
				BaseParserRuleContext::copy_from(ctx,LambdaContextExt{
        			base: ctx.borrow().clone(),
        			ph:PhantomData
				})
			)
		)
	}
}

pub type ParenthesizedExpressionContext<'input> = BaseParserRuleContext<'input,ParenthesizedExpressionContextExt<'input>>;

pub trait ParenthesizedExpressionContextAttrs<'input>: athenasqlParserContext<'input>{
	fn expression(&self) -> Option<Rc<ExpressionContextAll<'input>>> where Self:Sized{
		self.child_of_type(0)
	}
}

impl<'input> ParenthesizedExpressionContextAttrs<'input> for ParenthesizedExpressionContext<'input>{}

pub struct ParenthesizedExpressionContextExt<'input>{
	base:PrimaryExpressionContextExt<'input>,
	ph:PhantomData<&'input str>
}

antlr_rust::tid!{ParenthesizedExpressionContextExt<'a>}

impl<'input> athenasqlParserContext<'input> for ParenthesizedExpressionContext<'input>{}

impl<'input,'a> Listenable<dyn athenasqlListener<'input> + 'a> for ParenthesizedExpressionContext<'input>{
	fn enter(&self,listener: &mut (dyn athenasqlListener<'input> + 'a)) {
		listener.enter_every_rule(self);
		listener.enter_parenthesizedExpression(self);
	}
}

impl<'input> CustomRuleContext<'input> for ParenthesizedExpressionContextExt<'input>{
	type TF = LocalTokenFactory<'input>;
	type Ctx = athenasqlParserContextType;
	fn get_rule_index(&self) -> usize { RULE_primaryExpression }
	//fn type_rule_index() -> usize where Self: Sized { RULE_primaryExpression }
}

impl<'input> Borrow<PrimaryExpressionContextExt<'input>> for ParenthesizedExpressionContext<'input>{
	fn borrow(&self) -> &PrimaryExpressionContextExt<'input> { &self.base }
}
impl<'input> BorrowMut<PrimaryExpressionContextExt<'input>> for ParenthesizedExpressionContext<'input>{
	fn borrow_mut(&mut self) -> &mut PrimaryExpressionContextExt<'input> { &mut self.base }
}

impl<'input> PrimaryExpressionContextAttrs<'input> for ParenthesizedExpressionContext<'input> {}

impl<'input> ParenthesizedExpressionContextExt<'input>{
	fn new(ctx: &dyn PrimaryExpressionContextAttrs<'input>) -> Rc<PrimaryExpressionContextAll<'input>>  {
		Rc::new(
			PrimaryExpressionContextAll::ParenthesizedExpressionContext(
				BaseParserRuleContext::copy_from(ctx,ParenthesizedExpressionContextExt{
        			base: ctx.borrow().clone(),
        			ph:PhantomData
				})
			)
		)
	}
}

pub type ParameterContext<'input> = BaseParserRuleContext<'input,ParameterContextExt<'input>>;

pub trait ParameterContextAttrs<'input>: athenasqlParserContext<'input>{
}

impl<'input> ParameterContextAttrs<'input> for ParameterContext<'input>{}

pub struct ParameterContextExt<'input>{
	base:PrimaryExpressionContextExt<'input>,
	ph:PhantomData<&'input str>
}

antlr_rust::tid!{ParameterContextExt<'a>}

impl<'input> athenasqlParserContext<'input> for ParameterContext<'input>{}

impl<'input,'a> Listenable<dyn athenasqlListener<'input> + 'a> for ParameterContext<'input>{
	fn enter(&self,listener: &mut (dyn athenasqlListener<'input> + 'a)) {
		listener.enter_every_rule(self);
		listener.enter_parameter(self);
	}
}

impl<'input> CustomRuleContext<'input> for ParameterContextExt<'input>{
	type TF = LocalTokenFactory<'input>;
	type Ctx = athenasqlParserContextType;
	fn get_rule_index(&self) -> usize { RULE_primaryExpression }
	//fn type_rule_index() -> usize where Self: Sized { RULE_primaryExpression }
}

impl<'input> Borrow<PrimaryExpressionContextExt<'input>> for ParameterContext<'input>{
	fn borrow(&self) -> &PrimaryExpressionContextExt<'input> { &self.base }
}
impl<'input> BorrowMut<PrimaryExpressionContextExt<'input>> for ParameterContext<'input>{
	fn borrow_mut(&mut self) -> &mut PrimaryExpressionContextExt<'input> { &mut self.base }
}

impl<'input> PrimaryExpressionContextAttrs<'input> for ParameterContext<'input> {}

impl<'input> ParameterContextExt<'input>{
	fn new(ctx: &dyn PrimaryExpressionContextAttrs<'input>) -> Rc<PrimaryExpressionContextAll<'input>>  {
		Rc::new(
			PrimaryExpressionContextAll::ParameterContext(
				BaseParserRuleContext::copy_from(ctx,ParameterContextExt{
        			base: ctx.borrow().clone(),
        			ph:PhantomData
				})
			)
		)
	}
}

pub type NormalizeContext<'input> = BaseParserRuleContext<'input,NormalizeContextExt<'input>>;

pub trait NormalizeContextAttrs<'input>: athenasqlParserContext<'input>{
	/// Retrieves first TerminalNode corresponding to token NORMALIZE
	/// Returns `None` if there is no child corresponding to token NORMALIZE
	fn NORMALIZE(&self) -> Option<Rc<TerminalNode<'input,athenasqlParserContextType>>> where Self:Sized{
		self.get_token(NORMALIZE, 0)
	}
	fn valueExpression(&self) -> Option<Rc<ValueExpressionContextAll<'input>>> where Self:Sized{
		self.child_of_type(0)
	}
	fn normalForm(&self) -> Option<Rc<NormalFormContextAll<'input>>> where Self:Sized{
		self.child_of_type(0)
	}
}

impl<'input> NormalizeContextAttrs<'input> for NormalizeContext<'input>{}

pub struct NormalizeContextExt<'input>{
	base:PrimaryExpressionContextExt<'input>,
	ph:PhantomData<&'input str>
}

antlr_rust::tid!{NormalizeContextExt<'a>}

impl<'input> athenasqlParserContext<'input> for NormalizeContext<'input>{}

impl<'input,'a> Listenable<dyn athenasqlListener<'input> + 'a> for NormalizeContext<'input>{
	fn enter(&self,listener: &mut (dyn athenasqlListener<'input> + 'a)) {
		listener.enter_every_rule(self);
		listener.enter_normalize(self);
	}
}

impl<'input> CustomRuleContext<'input> for NormalizeContextExt<'input>{
	type TF = LocalTokenFactory<'input>;
	type Ctx = athenasqlParserContextType;
	fn get_rule_index(&self) -> usize { RULE_primaryExpression }
	//fn type_rule_index() -> usize where Self: Sized { RULE_primaryExpression }
}

impl<'input> Borrow<PrimaryExpressionContextExt<'input>> for NormalizeContext<'input>{
	fn borrow(&self) -> &PrimaryExpressionContextExt<'input> { &self.base }
}
impl<'input> BorrowMut<PrimaryExpressionContextExt<'input>> for NormalizeContext<'input>{
	fn borrow_mut(&mut self) -> &mut PrimaryExpressionContextExt<'input> { &mut self.base }
}

impl<'input> PrimaryExpressionContextAttrs<'input> for NormalizeContext<'input> {}

impl<'input> NormalizeContextExt<'input>{
	fn new(ctx: &dyn PrimaryExpressionContextAttrs<'input>) -> Rc<PrimaryExpressionContextAll<'input>>  {
		Rc::new(
			PrimaryExpressionContextAll::NormalizeContext(
				BaseParserRuleContext::copy_from(ctx,NormalizeContextExt{
        			base: ctx.borrow().clone(),
        			ph:PhantomData
				})
			)
		)
	}
}

pub type IntervalLiteralContext<'input> = BaseParserRuleContext<'input,IntervalLiteralContextExt<'input>>;

pub trait IntervalLiteralContextAttrs<'input>: athenasqlParserContext<'input>{
	fn interval(&self) -> Option<Rc<IntervalContextAll<'input>>> where Self:Sized{
		self.child_of_type(0)
	}
}

impl<'input> IntervalLiteralContextAttrs<'input> for IntervalLiteralContext<'input>{}

pub struct IntervalLiteralContextExt<'input>{
	base:PrimaryExpressionContextExt<'input>,
	ph:PhantomData<&'input str>
}

antlr_rust::tid!{IntervalLiteralContextExt<'a>}

impl<'input> athenasqlParserContext<'input> for IntervalLiteralContext<'input>{}

impl<'input,'a> Listenable<dyn athenasqlListener<'input> + 'a> for IntervalLiteralContext<'input>{
	fn enter(&self,listener: &mut (dyn athenasqlListener<'input> + 'a)) {
		listener.enter_every_rule(self);
		listener.enter_intervalLiteral(self);
	}
}

impl<'input> CustomRuleContext<'input> for IntervalLiteralContextExt<'input>{
	type TF = LocalTokenFactory<'input>;
	type Ctx = athenasqlParserContextType;
	fn get_rule_index(&self) -> usize { RULE_primaryExpression }
	//fn type_rule_index() -> usize where Self: Sized { RULE_primaryExpression }
}

impl<'input> Borrow<PrimaryExpressionContextExt<'input>> for IntervalLiteralContext<'input>{
	fn borrow(&self) -> &PrimaryExpressionContextExt<'input> { &self.base }
}
impl<'input> BorrowMut<PrimaryExpressionContextExt<'input>> for IntervalLiteralContext<'input>{
	fn borrow_mut(&mut self) -> &mut PrimaryExpressionContextExt<'input> { &mut self.base }
}

impl<'input> PrimaryExpressionContextAttrs<'input> for IntervalLiteralContext<'input> {}

impl<'input> IntervalLiteralContextExt<'input>{
	fn new(ctx: &dyn PrimaryExpressionContextAttrs<'input>) -> Rc<PrimaryExpressionContextAll<'input>>  {
		Rc::new(
			PrimaryExpressionContextAll::IntervalLiteralContext(
				BaseParserRuleContext::copy_from(ctx,IntervalLiteralContextExt{
        			base: ctx.borrow().clone(),
        			ph:PhantomData
				})
			)
		)
	}
}

pub type NumericLiteralContext<'input> = BaseParserRuleContext<'input,NumericLiteralContextExt<'input>>;

pub trait NumericLiteralContextAttrs<'input>: athenasqlParserContext<'input>{
	fn number(&self) -> Option<Rc<NumberContextAll<'input>>> where Self:Sized{
		self.child_of_type(0)
	}
}

impl<'input> NumericLiteralContextAttrs<'input> for NumericLiteralContext<'input>{}

pub struct NumericLiteralContextExt<'input>{
	base:PrimaryExpressionContextExt<'input>,
	ph:PhantomData<&'input str>
}

antlr_rust::tid!{NumericLiteralContextExt<'a>}

impl<'input> athenasqlParserContext<'input> for NumericLiteralContext<'input>{}

impl<'input,'a> Listenable<dyn athenasqlListener<'input> + 'a> for NumericLiteralContext<'input>{
	fn enter(&self,listener: &mut (dyn athenasqlListener<'input> + 'a)) {
		listener.enter_every_rule(self);
		listener.enter_numericLiteral(self);
	}
}

impl<'input> CustomRuleContext<'input> for NumericLiteralContextExt<'input>{
	type TF = LocalTokenFactory<'input>;
	type Ctx = athenasqlParserContextType;
	fn get_rule_index(&self) -> usize { RULE_primaryExpression }
	//fn type_rule_index() -> usize where Self: Sized { RULE_primaryExpression }
}

impl<'input> Borrow<PrimaryExpressionContextExt<'input>> for NumericLiteralContext<'input>{
	fn borrow(&self) -> &PrimaryExpressionContextExt<'input> { &self.base }
}
impl<'input> BorrowMut<PrimaryExpressionContextExt<'input>> for NumericLiteralContext<'input>{
	fn borrow_mut(&mut self) -> &mut PrimaryExpressionContextExt<'input> { &mut self.base }
}

impl<'input> PrimaryExpressionContextAttrs<'input> for NumericLiteralContext<'input> {}

impl<'input> NumericLiteralContextExt<'input>{
	fn new(ctx: &dyn PrimaryExpressionContextAttrs<'input>) -> Rc<PrimaryExpressionContextAll<'input>>  {
		Rc::new(
			PrimaryExpressionContextAll::NumericLiteralContext(
				BaseParserRuleContext::copy_from(ctx,NumericLiteralContextExt{
        			base: ctx.borrow().clone(),
        			ph:PhantomData
				})
			)
		)
	}
}

pub type BooleanLiteralContext<'input> = BaseParserRuleContext<'input,BooleanLiteralContextExt<'input>>;

pub trait BooleanLiteralContextAttrs<'input>: athenasqlParserContext<'input>{
	fn booleanValue(&self) -> Option<Rc<BooleanValueContextAll<'input>>> where Self:Sized{
		self.child_of_type(0)
	}
}

impl<'input> BooleanLiteralContextAttrs<'input> for BooleanLiteralContext<'input>{}

pub struct BooleanLiteralContextExt<'input>{
	base:PrimaryExpressionContextExt<'input>,
	ph:PhantomData<&'input str>
}

antlr_rust::tid!{BooleanLiteralContextExt<'a>}

impl<'input> athenasqlParserContext<'input> for BooleanLiteralContext<'input>{}

impl<'input,'a> Listenable<dyn athenasqlListener<'input> + 'a> for BooleanLiteralContext<'input>{
	fn enter(&self,listener: &mut (dyn athenasqlListener<'input> + 'a)) {
		listener.enter_every_rule(self);
		listener.enter_booleanLiteral(self);
	}
}

impl<'input> CustomRuleContext<'input> for BooleanLiteralContextExt<'input>{
	type TF = LocalTokenFactory<'input>;
	type Ctx = athenasqlParserContextType;
	fn get_rule_index(&self) -> usize { RULE_primaryExpression }
	//fn type_rule_index() -> usize where Self: Sized { RULE_primaryExpression }
}

impl<'input> Borrow<PrimaryExpressionContextExt<'input>> for BooleanLiteralContext<'input>{
	fn borrow(&self) -> &PrimaryExpressionContextExt<'input> { &self.base }
}
impl<'input> BorrowMut<PrimaryExpressionContextExt<'input>> for BooleanLiteralContext<'input>{
	fn borrow_mut(&mut self) -> &mut PrimaryExpressionContextExt<'input> { &mut self.base }
}

impl<'input> PrimaryExpressionContextAttrs<'input> for BooleanLiteralContext<'input> {}

impl<'input> BooleanLiteralContextExt<'input>{
	fn new(ctx: &dyn PrimaryExpressionContextAttrs<'input>) -> Rc<PrimaryExpressionContextAll<'input>>  {
		Rc::new(
			PrimaryExpressionContextAll::BooleanLiteralContext(
				BaseParserRuleContext::copy_from(ctx,BooleanLiteralContextExt{
        			base: ctx.borrow().clone(),
        			ph:PhantomData
				})
			)
		)
	}
}

pub type SimpleCaseContext<'input> = BaseParserRuleContext<'input,SimpleCaseContextExt<'input>>;

pub trait SimpleCaseContextAttrs<'input>: athenasqlParserContext<'input>{
	/// Retrieves first TerminalNode corresponding to token CASE
	/// Returns `None` if there is no child corresponding to token CASE
	fn CASE(&self) -> Option<Rc<TerminalNode<'input,athenasqlParserContextType>>> where Self:Sized{
		self.get_token(CASE, 0)
	}
	fn valueExpression(&self) -> Option<Rc<ValueExpressionContextAll<'input>>> where Self:Sized{
		self.child_of_type(0)
	}
	/// Retrieves first TerminalNode corresponding to token END
	/// Returns `None` if there is no child corresponding to token END
	fn END(&self) -> Option<Rc<TerminalNode<'input,athenasqlParserContextType>>> where Self:Sized{
		self.get_token(END, 0)
	}
	fn whenClause_all(&self) ->  Vec<Rc<WhenClauseContextAll<'input>>> where Self:Sized{
		self.children_of_type()
	}
	fn whenClause(&self, i: usize) -> Option<Rc<WhenClauseContextAll<'input>>> where Self:Sized{
		self.child_of_type(i)
	}
	/// Retrieves first TerminalNode corresponding to token ELSE
	/// Returns `None` if there is no child corresponding to token ELSE
	fn ELSE(&self) -> Option<Rc<TerminalNode<'input,athenasqlParserContextType>>> where Self:Sized{
		self.get_token(ELSE, 0)
	}
	fn expression(&self) -> Option<Rc<ExpressionContextAll<'input>>> where Self:Sized{
		self.child_of_type(0)
	}
}

impl<'input> SimpleCaseContextAttrs<'input> for SimpleCaseContext<'input>{}

pub struct SimpleCaseContextExt<'input>{
	base:PrimaryExpressionContextExt<'input>,
	pub elseExpression: Option<Rc<ExpressionContextAll<'input>>>,
	ph:PhantomData<&'input str>
}

antlr_rust::tid!{SimpleCaseContextExt<'a>}

impl<'input> athenasqlParserContext<'input> for SimpleCaseContext<'input>{}

impl<'input,'a> Listenable<dyn athenasqlListener<'input> + 'a> for SimpleCaseContext<'input>{
	fn enter(&self,listener: &mut (dyn athenasqlListener<'input> + 'a)) {
		listener.enter_every_rule(self);
		listener.enter_simpleCase(self);
	}
}

impl<'input> CustomRuleContext<'input> for SimpleCaseContextExt<'input>{
	type TF = LocalTokenFactory<'input>;
	type Ctx = athenasqlParserContextType;
	fn get_rule_index(&self) -> usize { RULE_primaryExpression }
	//fn type_rule_index() -> usize where Self: Sized { RULE_primaryExpression }
}

impl<'input> Borrow<PrimaryExpressionContextExt<'input>> for SimpleCaseContext<'input>{
	fn borrow(&self) -> &PrimaryExpressionContextExt<'input> { &self.base }
}
impl<'input> BorrowMut<PrimaryExpressionContextExt<'input>> for SimpleCaseContext<'input>{
	fn borrow_mut(&mut self) -> &mut PrimaryExpressionContextExt<'input> { &mut self.base }
}

impl<'input> PrimaryExpressionContextAttrs<'input> for SimpleCaseContext<'input> {}

impl<'input> SimpleCaseContextExt<'input>{
	fn new(ctx: &dyn PrimaryExpressionContextAttrs<'input>) -> Rc<PrimaryExpressionContextAll<'input>>  {
		Rc::new(
			PrimaryExpressionContextAll::SimpleCaseContext(
				BaseParserRuleContext::copy_from(ctx,SimpleCaseContextExt{
        			elseExpression:None, 
        			base: ctx.borrow().clone(),
        			ph:PhantomData
				})
			)
		)
	}
}

pub type NullLiteralContext<'input> = BaseParserRuleContext<'input,NullLiteralContextExt<'input>>;

pub trait NullLiteralContextAttrs<'input>: athenasqlParserContext<'input>{
	/// Retrieves first TerminalNode corresponding to token NULL
	/// Returns `None` if there is no child corresponding to token NULL
	fn NULL(&self) -> Option<Rc<TerminalNode<'input,athenasqlParserContextType>>> where Self:Sized{
		self.get_token(NULL, 0)
	}
}

impl<'input> NullLiteralContextAttrs<'input> for NullLiteralContext<'input>{}

pub struct NullLiteralContextExt<'input>{
	base:PrimaryExpressionContextExt<'input>,
	ph:PhantomData<&'input str>
}

antlr_rust::tid!{NullLiteralContextExt<'a>}

impl<'input> athenasqlParserContext<'input> for NullLiteralContext<'input>{}

impl<'input,'a> Listenable<dyn athenasqlListener<'input> + 'a> for NullLiteralContext<'input>{
	fn enter(&self,listener: &mut (dyn athenasqlListener<'input> + 'a)) {
		listener.enter_every_rule(self);
		listener.enter_nullLiteral(self);
	}
}

impl<'input> CustomRuleContext<'input> for NullLiteralContextExt<'input>{
	type TF = LocalTokenFactory<'input>;
	type Ctx = athenasqlParserContextType;
	fn get_rule_index(&self) -> usize { RULE_primaryExpression }
	//fn type_rule_index() -> usize where Self: Sized { RULE_primaryExpression }
}

impl<'input> Borrow<PrimaryExpressionContextExt<'input>> for NullLiteralContext<'input>{
	fn borrow(&self) -> &PrimaryExpressionContextExt<'input> { &self.base }
}
impl<'input> BorrowMut<PrimaryExpressionContextExt<'input>> for NullLiteralContext<'input>{
	fn borrow_mut(&mut self) -> &mut PrimaryExpressionContextExt<'input> { &mut self.base }
}

impl<'input> PrimaryExpressionContextAttrs<'input> for NullLiteralContext<'input> {}

impl<'input> NullLiteralContextExt<'input>{
	fn new(ctx: &dyn PrimaryExpressionContextAttrs<'input>) -> Rc<PrimaryExpressionContextAll<'input>>  {
		Rc::new(
			PrimaryExpressionContextAll::NullLiteralContext(
				BaseParserRuleContext::copy_from(ctx,NullLiteralContextExt{
        			base: ctx.borrow().clone(),
        			ph:PhantomData
				})
			)
		)
	}
}

pub type RowConstructorContext<'input> = BaseParserRuleContext<'input,RowConstructorContextExt<'input>>;

pub trait RowConstructorContextAttrs<'input>: athenasqlParserContext<'input>{
	fn expression_all(&self) ->  Vec<Rc<ExpressionContextAll<'input>>> where Self:Sized{
		self.children_of_type()
	}
	fn expression(&self, i: usize) -> Option<Rc<ExpressionContextAll<'input>>> where Self:Sized{
		self.child_of_type(i)
	}
	/// Retrieves first TerminalNode corresponding to token ROW
	/// Returns `None` if there is no child corresponding to token ROW
	fn ROW(&self) -> Option<Rc<TerminalNode<'input,athenasqlParserContextType>>> where Self:Sized{
		self.get_token(ROW, 0)
	}
}

impl<'input> RowConstructorContextAttrs<'input> for RowConstructorContext<'input>{}

pub struct RowConstructorContextExt<'input>{
	base:PrimaryExpressionContextExt<'input>,
	ph:PhantomData<&'input str>
}

antlr_rust::tid!{RowConstructorContextExt<'a>}

impl<'input> athenasqlParserContext<'input> for RowConstructorContext<'input>{}

impl<'input,'a> Listenable<dyn athenasqlListener<'input> + 'a> for RowConstructorContext<'input>{
	fn enter(&self,listener: &mut (dyn athenasqlListener<'input> + 'a)) {
		listener.enter_every_rule(self);
		listener.enter_rowConstructor(self);
	}
}

impl<'input> CustomRuleContext<'input> for RowConstructorContextExt<'input>{
	type TF = LocalTokenFactory<'input>;
	type Ctx = athenasqlParserContextType;
	fn get_rule_index(&self) -> usize { RULE_primaryExpression }
	//fn type_rule_index() -> usize where Self: Sized { RULE_primaryExpression }
}

impl<'input> Borrow<PrimaryExpressionContextExt<'input>> for RowConstructorContext<'input>{
	fn borrow(&self) -> &PrimaryExpressionContextExt<'input> { &self.base }
}
impl<'input> BorrowMut<PrimaryExpressionContextExt<'input>> for RowConstructorContext<'input>{
	fn borrow_mut(&mut self) -> &mut PrimaryExpressionContextExt<'input> { &mut self.base }
}

impl<'input> PrimaryExpressionContextAttrs<'input> for RowConstructorContext<'input> {}

impl<'input> RowConstructorContextExt<'input>{
	fn new(ctx: &dyn PrimaryExpressionContextAttrs<'input>) -> Rc<PrimaryExpressionContextAll<'input>>  {
		Rc::new(
			PrimaryExpressionContextAll::RowConstructorContext(
				BaseParserRuleContext::copy_from(ctx,RowConstructorContextExt{
        			base: ctx.borrow().clone(),
        			ph:PhantomData
				})
			)
		)
	}
}

pub type SubscriptContext<'input> = BaseParserRuleContext<'input,SubscriptContextExt<'input>>;

pub trait SubscriptContextAttrs<'input>: athenasqlParserContext<'input>{
	fn primaryExpression(&self) -> Option<Rc<PrimaryExpressionContextAll<'input>>> where Self:Sized{
		self.child_of_type(0)
	}
	fn valueExpression(&self) -> Option<Rc<ValueExpressionContextAll<'input>>> where Self:Sized{
		self.child_of_type(0)
	}
}

impl<'input> SubscriptContextAttrs<'input> for SubscriptContext<'input>{}

pub struct SubscriptContextExt<'input>{
	base:PrimaryExpressionContextExt<'input>,
	pub value: Option<Rc<PrimaryExpressionContextAll<'input>>>,
	pub index: Option<Rc<ValueExpressionContextAll<'input>>>,
	ph:PhantomData<&'input str>
}

antlr_rust::tid!{SubscriptContextExt<'a>}

impl<'input> athenasqlParserContext<'input> for SubscriptContext<'input>{}

impl<'input,'a> Listenable<dyn athenasqlListener<'input> + 'a> for SubscriptContext<'input>{
	fn enter(&self,listener: &mut (dyn athenasqlListener<'input> + 'a)) {
		listener.enter_every_rule(self);
		listener.enter_subscript(self);
	}
}

impl<'input> CustomRuleContext<'input> for SubscriptContextExt<'input>{
	type TF = LocalTokenFactory<'input>;
	type Ctx = athenasqlParserContextType;
	fn get_rule_index(&self) -> usize { RULE_primaryExpression }
	//fn type_rule_index() -> usize where Self: Sized { RULE_primaryExpression }
}

impl<'input> Borrow<PrimaryExpressionContextExt<'input>> for SubscriptContext<'input>{
	fn borrow(&self) -> &PrimaryExpressionContextExt<'input> { &self.base }
}
impl<'input> BorrowMut<PrimaryExpressionContextExt<'input>> for SubscriptContext<'input>{
	fn borrow_mut(&mut self) -> &mut PrimaryExpressionContextExt<'input> { &mut self.base }
}

impl<'input> PrimaryExpressionContextAttrs<'input> for SubscriptContext<'input> {}

impl<'input> SubscriptContextExt<'input>{
	fn new(ctx: &dyn PrimaryExpressionContextAttrs<'input>) -> Rc<PrimaryExpressionContextAll<'input>>  {
		Rc::new(
			PrimaryExpressionContextAll::SubscriptContext(
				BaseParserRuleContext::copy_from(ctx,SubscriptContextExt{
        			value:None, index:None, 
        			base: ctx.borrow().clone(),
        			ph:PhantomData
				})
			)
		)
	}
}

pub type SubqueryExpressionContext<'input> = BaseParserRuleContext<'input,SubqueryExpressionContextExt<'input>>;

pub trait SubqueryExpressionContextAttrs<'input>: athenasqlParserContext<'input>{
	fn query(&self) -> Option<Rc<QueryContextAll<'input>>> where Self:Sized{
		self.child_of_type(0)
	}
}

impl<'input> SubqueryExpressionContextAttrs<'input> for SubqueryExpressionContext<'input>{}

pub struct SubqueryExpressionContextExt<'input>{
	base:PrimaryExpressionContextExt<'input>,
	ph:PhantomData<&'input str>
}

antlr_rust::tid!{SubqueryExpressionContextExt<'a>}

impl<'input> athenasqlParserContext<'input> for SubqueryExpressionContext<'input>{}

impl<'input,'a> Listenable<dyn athenasqlListener<'input> + 'a> for SubqueryExpressionContext<'input>{
	fn enter(&self,listener: &mut (dyn athenasqlListener<'input> + 'a)) {
		listener.enter_every_rule(self);
		listener.enter_subqueryExpression(self);
	}
}

impl<'input> CustomRuleContext<'input> for SubqueryExpressionContextExt<'input>{
	type TF = LocalTokenFactory<'input>;
	type Ctx = athenasqlParserContextType;
	fn get_rule_index(&self) -> usize { RULE_primaryExpression }
	//fn type_rule_index() -> usize where Self: Sized { RULE_primaryExpression }
}

impl<'input> Borrow<PrimaryExpressionContextExt<'input>> for SubqueryExpressionContext<'input>{
	fn borrow(&self) -> &PrimaryExpressionContextExt<'input> { &self.base }
}
impl<'input> BorrowMut<PrimaryExpressionContextExt<'input>> for SubqueryExpressionContext<'input>{
	fn borrow_mut(&mut self) -> &mut PrimaryExpressionContextExt<'input> { &mut self.base }
}

impl<'input> PrimaryExpressionContextAttrs<'input> for SubqueryExpressionContext<'input> {}

impl<'input> SubqueryExpressionContextExt<'input>{
	fn new(ctx: &dyn PrimaryExpressionContextAttrs<'input>) -> Rc<PrimaryExpressionContextAll<'input>>  {
		Rc::new(
			PrimaryExpressionContextAll::SubqueryExpressionContext(
				BaseParserRuleContext::copy_from(ctx,SubqueryExpressionContextExt{
        			base: ctx.borrow().clone(),
        			ph:PhantomData
				})
			)
		)
	}
}

pub type BinaryLiteralContext<'input> = BaseParserRuleContext<'input,BinaryLiteralContextExt<'input>>;

pub trait BinaryLiteralContextAttrs<'input>: athenasqlParserContext<'input>{
	/// Retrieves first TerminalNode corresponding to token BINARY_LITERAL
	/// Returns `None` if there is no child corresponding to token BINARY_LITERAL
	fn BINARY_LITERAL(&self) -> Option<Rc<TerminalNode<'input,athenasqlParserContextType>>> where Self:Sized{
		self.get_token(BINARY_LITERAL, 0)
	}
}

impl<'input> BinaryLiteralContextAttrs<'input> for BinaryLiteralContext<'input>{}

pub struct BinaryLiteralContextExt<'input>{
	base:PrimaryExpressionContextExt<'input>,
	ph:PhantomData<&'input str>
}

antlr_rust::tid!{BinaryLiteralContextExt<'a>}

impl<'input> athenasqlParserContext<'input> for BinaryLiteralContext<'input>{}

impl<'input,'a> Listenable<dyn athenasqlListener<'input> + 'a> for BinaryLiteralContext<'input>{
	fn enter(&self,listener: &mut (dyn athenasqlListener<'input> + 'a)) {
		listener.enter_every_rule(self);
		listener.enter_binaryLiteral(self);
	}
}

impl<'input> CustomRuleContext<'input> for BinaryLiteralContextExt<'input>{
	type TF = LocalTokenFactory<'input>;
	type Ctx = athenasqlParserContextType;
	fn get_rule_index(&self) -> usize { RULE_primaryExpression }
	//fn type_rule_index() -> usize where Self: Sized { RULE_primaryExpression }
}

impl<'input> Borrow<PrimaryExpressionContextExt<'input>> for BinaryLiteralContext<'input>{
	fn borrow(&self) -> &PrimaryExpressionContextExt<'input> { &self.base }
}
impl<'input> BorrowMut<PrimaryExpressionContextExt<'input>> for BinaryLiteralContext<'input>{
	fn borrow_mut(&mut self) -> &mut PrimaryExpressionContextExt<'input> { &mut self.base }
}

impl<'input> PrimaryExpressionContextAttrs<'input> for BinaryLiteralContext<'input> {}

impl<'input> BinaryLiteralContextExt<'input>{
	fn new(ctx: &dyn PrimaryExpressionContextAttrs<'input>) -> Rc<PrimaryExpressionContextAll<'input>>  {
		Rc::new(
			PrimaryExpressionContextAll::BinaryLiteralContext(
				BaseParserRuleContext::copy_from(ctx,BinaryLiteralContextExt{
        			base: ctx.borrow().clone(),
        			ph:PhantomData
				})
			)
		)
	}
}

pub type ExtractContext<'input> = BaseParserRuleContext<'input,ExtractContextExt<'input>>;

pub trait ExtractContextAttrs<'input>: athenasqlParserContext<'input>{
	/// Retrieves first TerminalNode corresponding to token EXTRACT
	/// Returns `None` if there is no child corresponding to token EXTRACT
	fn EXTRACT(&self) -> Option<Rc<TerminalNode<'input,athenasqlParserContextType>>> where Self:Sized{
		self.get_token(EXTRACT, 0)
	}
	fn identifier(&self) -> Option<Rc<IdentifierContextAll<'input>>> where Self:Sized{
		self.child_of_type(0)
	}
	/// Retrieves first TerminalNode corresponding to token FROM
	/// Returns `None` if there is no child corresponding to token FROM
	fn FROM(&self) -> Option<Rc<TerminalNode<'input,athenasqlParserContextType>>> where Self:Sized{
		self.get_token(FROM, 0)
	}
	fn valueExpression(&self) -> Option<Rc<ValueExpressionContextAll<'input>>> where Self:Sized{
		self.child_of_type(0)
	}
}

impl<'input> ExtractContextAttrs<'input> for ExtractContext<'input>{}

pub struct ExtractContextExt<'input>{
	base:PrimaryExpressionContextExt<'input>,
	ph:PhantomData<&'input str>
}

antlr_rust::tid!{ExtractContextExt<'a>}

impl<'input> athenasqlParserContext<'input> for ExtractContext<'input>{}

impl<'input,'a> Listenable<dyn athenasqlListener<'input> + 'a> for ExtractContext<'input>{
	fn enter(&self,listener: &mut (dyn athenasqlListener<'input> + 'a)) {
		listener.enter_every_rule(self);
		listener.enter_extract(self);
	}
}

impl<'input> CustomRuleContext<'input> for ExtractContextExt<'input>{
	type TF = LocalTokenFactory<'input>;
	type Ctx = athenasqlParserContextType;
	fn get_rule_index(&self) -> usize { RULE_primaryExpression }
	//fn type_rule_index() -> usize where Self: Sized { RULE_primaryExpression }
}

impl<'input> Borrow<PrimaryExpressionContextExt<'input>> for ExtractContext<'input>{
	fn borrow(&self) -> &PrimaryExpressionContextExt<'input> { &self.base }
}
impl<'input> BorrowMut<PrimaryExpressionContextExt<'input>> for ExtractContext<'input>{
	fn borrow_mut(&mut self) -> &mut PrimaryExpressionContextExt<'input> { &mut self.base }
}

impl<'input> PrimaryExpressionContextAttrs<'input> for ExtractContext<'input> {}

impl<'input> ExtractContextExt<'input>{
	fn new(ctx: &dyn PrimaryExpressionContextAttrs<'input>) -> Rc<PrimaryExpressionContextAll<'input>>  {
		Rc::new(
			PrimaryExpressionContextAll::ExtractContext(
				BaseParserRuleContext::copy_from(ctx,ExtractContextExt{
        			base: ctx.borrow().clone(),
        			ph:PhantomData
				})
			)
		)
	}
}

pub type StringLiteralContext<'input> = BaseParserRuleContext<'input,StringLiteralContextExt<'input>>;

pub trait StringLiteralContextAttrs<'input>: athenasqlParserContext<'input>{
	/// Retrieves first TerminalNode corresponding to token STRING
	/// Returns `None` if there is no child corresponding to token STRING
	fn STRING(&self) -> Option<Rc<TerminalNode<'input,athenasqlParserContextType>>> where Self:Sized{
		self.get_token(STRING, 0)
	}
}

impl<'input> StringLiteralContextAttrs<'input> for StringLiteralContext<'input>{}

pub struct StringLiteralContextExt<'input>{
	base:PrimaryExpressionContextExt<'input>,
	ph:PhantomData<&'input str>
}

antlr_rust::tid!{StringLiteralContextExt<'a>}

impl<'input> athenasqlParserContext<'input> for StringLiteralContext<'input>{}

impl<'input,'a> Listenable<dyn athenasqlListener<'input> + 'a> for StringLiteralContext<'input>{
	fn enter(&self,listener: &mut (dyn athenasqlListener<'input> + 'a)) {
		listener.enter_every_rule(self);
		listener.enter_stringLiteral(self);
	}
}

impl<'input> CustomRuleContext<'input> for StringLiteralContextExt<'input>{
	type TF = LocalTokenFactory<'input>;
	type Ctx = athenasqlParserContextType;
	fn get_rule_index(&self) -> usize { RULE_primaryExpression }
	//fn type_rule_index() -> usize where Self: Sized { RULE_primaryExpression }
}

impl<'input> Borrow<PrimaryExpressionContextExt<'input>> for StringLiteralContext<'input>{
	fn borrow(&self) -> &PrimaryExpressionContextExt<'input> { &self.base }
}
impl<'input> BorrowMut<PrimaryExpressionContextExt<'input>> for StringLiteralContext<'input>{
	fn borrow_mut(&mut self) -> &mut PrimaryExpressionContextExt<'input> { &mut self.base }
}

impl<'input> PrimaryExpressionContextAttrs<'input> for StringLiteralContext<'input> {}

impl<'input> StringLiteralContextExt<'input>{
	fn new(ctx: &dyn PrimaryExpressionContextAttrs<'input>) -> Rc<PrimaryExpressionContextAll<'input>>  {
		Rc::new(
			PrimaryExpressionContextAll::StringLiteralContext(
				BaseParserRuleContext::copy_from(ctx,StringLiteralContextExt{
        			base: ctx.borrow().clone(),
        			ph:PhantomData
				})
			)
		)
	}
}

pub type ArrayConstructorContext<'input> = BaseParserRuleContext<'input,ArrayConstructorContextExt<'input>>;

pub trait ArrayConstructorContextAttrs<'input>: athenasqlParserContext<'input>{
	/// Retrieves first TerminalNode corresponding to token ARRAY
	/// Returns `None` if there is no child corresponding to token ARRAY
	fn ARRAY(&self) -> Option<Rc<TerminalNode<'input,athenasqlParserContextType>>> where Self:Sized{
		self.get_token(ARRAY, 0)
	}
	fn expression_all(&self) ->  Vec<Rc<ExpressionContextAll<'input>>> where Self:Sized{
		self.children_of_type()
	}
	fn expression(&self, i: usize) -> Option<Rc<ExpressionContextAll<'input>>> where Self:Sized{
		self.child_of_type(i)
	}
}

impl<'input> ArrayConstructorContextAttrs<'input> for ArrayConstructorContext<'input>{}

pub struct ArrayConstructorContextExt<'input>{
	base:PrimaryExpressionContextExt<'input>,
	ph:PhantomData<&'input str>
}

antlr_rust::tid!{ArrayConstructorContextExt<'a>}

impl<'input> athenasqlParserContext<'input> for ArrayConstructorContext<'input>{}

impl<'input,'a> Listenable<dyn athenasqlListener<'input> + 'a> for ArrayConstructorContext<'input>{
	fn enter(&self,listener: &mut (dyn athenasqlListener<'input> + 'a)) {
		listener.enter_every_rule(self);
		listener.enter_arrayConstructor(self);
	}
}

impl<'input> CustomRuleContext<'input> for ArrayConstructorContextExt<'input>{
	type TF = LocalTokenFactory<'input>;
	type Ctx = athenasqlParserContextType;
	fn get_rule_index(&self) -> usize { RULE_primaryExpression }
	//fn type_rule_index() -> usize where Self: Sized { RULE_primaryExpression }
}

impl<'input> Borrow<PrimaryExpressionContextExt<'input>> for ArrayConstructorContext<'input>{
	fn borrow(&self) -> &PrimaryExpressionContextExt<'input> { &self.base }
}
impl<'input> BorrowMut<PrimaryExpressionContextExt<'input>> for ArrayConstructorContext<'input>{
	fn borrow_mut(&mut self) -> &mut PrimaryExpressionContextExt<'input> { &mut self.base }
}

impl<'input> PrimaryExpressionContextAttrs<'input> for ArrayConstructorContext<'input> {}

impl<'input> ArrayConstructorContextExt<'input>{
	fn new(ctx: &dyn PrimaryExpressionContextAttrs<'input>) -> Rc<PrimaryExpressionContextAll<'input>>  {
		Rc::new(
			PrimaryExpressionContextAll::ArrayConstructorContext(
				BaseParserRuleContext::copy_from(ctx,ArrayConstructorContextExt{
        			base: ctx.borrow().clone(),
        			ph:PhantomData
				})
			)
		)
	}
}

pub type FunctionCallContext<'input> = BaseParserRuleContext<'input,FunctionCallContextExt<'input>>;

pub trait FunctionCallContextAttrs<'input>: athenasqlParserContext<'input>{
	fn qualifiedName(&self) -> Option<Rc<QualifiedNameContextAll<'input>>> where Self:Sized{
		self.child_of_type(0)
	}
	/// Retrieves first TerminalNode corresponding to token ASTERISK
	/// Returns `None` if there is no child corresponding to token ASTERISK
	fn ASTERISK(&self) -> Option<Rc<TerminalNode<'input,athenasqlParserContextType>>> where Self:Sized{
		self.get_token(ASTERISK, 0)
	}
	fn filter(&self) -> Option<Rc<FilterContextAll<'input>>> where Self:Sized{
		self.child_of_type(0)
	}
	fn over(&self) -> Option<Rc<OverContextAll<'input>>> where Self:Sized{
		self.child_of_type(0)
	}
	fn expression_all(&self) ->  Vec<Rc<ExpressionContextAll<'input>>> where Self:Sized{
		self.children_of_type()
	}
	fn expression(&self, i: usize) -> Option<Rc<ExpressionContextAll<'input>>> where Self:Sized{
		self.child_of_type(i)
	}
	fn setQuantifier(&self) -> Option<Rc<SetQuantifierContextAll<'input>>> where Self:Sized{
		self.child_of_type(0)
	}
}

impl<'input> FunctionCallContextAttrs<'input> for FunctionCallContext<'input>{}

pub struct FunctionCallContextExt<'input>{
	base:PrimaryExpressionContextExt<'input>,
	ph:PhantomData<&'input str>
}

antlr_rust::tid!{FunctionCallContextExt<'a>}

impl<'input> athenasqlParserContext<'input> for FunctionCallContext<'input>{}

impl<'input,'a> Listenable<dyn athenasqlListener<'input> + 'a> for FunctionCallContext<'input>{
	fn enter(&self,listener: &mut (dyn athenasqlListener<'input> + 'a)) {
		listener.enter_every_rule(self);
		listener.enter_functionCall(self);
	}
}

impl<'input> CustomRuleContext<'input> for FunctionCallContextExt<'input>{
	type TF = LocalTokenFactory<'input>;
	type Ctx = athenasqlParserContextType;
	fn get_rule_index(&self) -> usize { RULE_primaryExpression }
	//fn type_rule_index() -> usize where Self: Sized { RULE_primaryExpression }
}

impl<'input> Borrow<PrimaryExpressionContextExt<'input>> for FunctionCallContext<'input>{
	fn borrow(&self) -> &PrimaryExpressionContextExt<'input> { &self.base }
}
impl<'input> BorrowMut<PrimaryExpressionContextExt<'input>> for FunctionCallContext<'input>{
	fn borrow_mut(&mut self) -> &mut PrimaryExpressionContextExt<'input> { &mut self.base }
}

impl<'input> PrimaryExpressionContextAttrs<'input> for FunctionCallContext<'input> {}

impl<'input> FunctionCallContextExt<'input>{
	fn new(ctx: &dyn PrimaryExpressionContextAttrs<'input>) -> Rc<PrimaryExpressionContextAll<'input>>  {
		Rc::new(
			PrimaryExpressionContextAll::FunctionCallContext(
				BaseParserRuleContext::copy_from(ctx,FunctionCallContextExt{
        			base: ctx.borrow().clone(),
        			ph:PhantomData
				})
			)
		)
	}
}

pub type ExistsContext<'input> = BaseParserRuleContext<'input,ExistsContextExt<'input>>;

pub trait ExistsContextAttrs<'input>: athenasqlParserContext<'input>{
	/// Retrieves first TerminalNode corresponding to token EXISTS
	/// Returns `None` if there is no child corresponding to token EXISTS
	fn EXISTS(&self) -> Option<Rc<TerminalNode<'input,athenasqlParserContextType>>> where Self:Sized{
		self.get_token(EXISTS, 0)
	}
	fn query(&self) -> Option<Rc<QueryContextAll<'input>>> where Self:Sized{
		self.child_of_type(0)
	}
}

impl<'input> ExistsContextAttrs<'input> for ExistsContext<'input>{}

pub struct ExistsContextExt<'input>{
	base:PrimaryExpressionContextExt<'input>,
	ph:PhantomData<&'input str>
}

antlr_rust::tid!{ExistsContextExt<'a>}

impl<'input> athenasqlParserContext<'input> for ExistsContext<'input>{}

impl<'input,'a> Listenable<dyn athenasqlListener<'input> + 'a> for ExistsContext<'input>{
	fn enter(&self,listener: &mut (dyn athenasqlListener<'input> + 'a)) {
		listener.enter_every_rule(self);
		listener.enter_exists(self);
	}
}

impl<'input> CustomRuleContext<'input> for ExistsContextExt<'input>{
	type TF = LocalTokenFactory<'input>;
	type Ctx = athenasqlParserContextType;
	fn get_rule_index(&self) -> usize { RULE_primaryExpression }
	//fn type_rule_index() -> usize where Self: Sized { RULE_primaryExpression }
}

impl<'input> Borrow<PrimaryExpressionContextExt<'input>> for ExistsContext<'input>{
	fn borrow(&self) -> &PrimaryExpressionContextExt<'input> { &self.base }
}
impl<'input> BorrowMut<PrimaryExpressionContextExt<'input>> for ExistsContext<'input>{
	fn borrow_mut(&mut self) -> &mut PrimaryExpressionContextExt<'input> { &mut self.base }
}

impl<'input> PrimaryExpressionContextAttrs<'input> for ExistsContext<'input> {}

impl<'input> ExistsContextExt<'input>{
	fn new(ctx: &dyn PrimaryExpressionContextAttrs<'input>) -> Rc<PrimaryExpressionContextAll<'input>>  {
		Rc::new(
			PrimaryExpressionContextAll::ExistsContext(
				BaseParserRuleContext::copy_from(ctx,ExistsContextExt{
        			base: ctx.borrow().clone(),
        			ph:PhantomData
				})
			)
		)
	}
}

pub type PositionContext<'input> = BaseParserRuleContext<'input,PositionContextExt<'input>>;

pub trait PositionContextAttrs<'input>: athenasqlParserContext<'input>{
	/// Retrieves first TerminalNode corresponding to token POSITION
	/// Returns `None` if there is no child corresponding to token POSITION
	fn POSITION(&self) -> Option<Rc<TerminalNode<'input,athenasqlParserContextType>>> where Self:Sized{
		self.get_token(POSITION, 0)
	}
	fn valueExpression_all(&self) ->  Vec<Rc<ValueExpressionContextAll<'input>>> where Self:Sized{
		self.children_of_type()
	}
	fn valueExpression(&self, i: usize) -> Option<Rc<ValueExpressionContextAll<'input>>> where Self:Sized{
		self.child_of_type(i)
	}
	/// Retrieves first TerminalNode corresponding to token IN
	/// Returns `None` if there is no child corresponding to token IN
	fn IN(&self) -> Option<Rc<TerminalNode<'input,athenasqlParserContextType>>> where Self:Sized{
		self.get_token(IN, 0)
	}
}

impl<'input> PositionContextAttrs<'input> for PositionContext<'input>{}

pub struct PositionContextExt<'input>{
	base:PrimaryExpressionContextExt<'input>,
	ph:PhantomData<&'input str>
}

antlr_rust::tid!{PositionContextExt<'a>}

impl<'input> athenasqlParserContext<'input> for PositionContext<'input>{}

impl<'input,'a> Listenable<dyn athenasqlListener<'input> + 'a> for PositionContext<'input>{
	fn enter(&self,listener: &mut (dyn athenasqlListener<'input> + 'a)) {
		listener.enter_every_rule(self);
		listener.enter_position(self);
	}
}

impl<'input> CustomRuleContext<'input> for PositionContextExt<'input>{
	type TF = LocalTokenFactory<'input>;
	type Ctx = athenasqlParserContextType;
	fn get_rule_index(&self) -> usize { RULE_primaryExpression }
	//fn type_rule_index() -> usize where Self: Sized { RULE_primaryExpression }
}

impl<'input> Borrow<PrimaryExpressionContextExt<'input>> for PositionContext<'input>{
	fn borrow(&self) -> &PrimaryExpressionContextExt<'input> { &self.base }
}
impl<'input> BorrowMut<PrimaryExpressionContextExt<'input>> for PositionContext<'input>{
	fn borrow_mut(&mut self) -> &mut PrimaryExpressionContextExt<'input> { &mut self.base }
}

impl<'input> PrimaryExpressionContextAttrs<'input> for PositionContext<'input> {}

impl<'input> PositionContextExt<'input>{
	fn new(ctx: &dyn PrimaryExpressionContextAttrs<'input>) -> Rc<PrimaryExpressionContextAll<'input>>  {
		Rc::new(
			PrimaryExpressionContextAll::PositionContext(
				BaseParserRuleContext::copy_from(ctx,PositionContextExt{
        			base: ctx.borrow().clone(),
        			ph:PhantomData
				})
			)
		)
	}
}

pub type SearchedCaseContext<'input> = BaseParserRuleContext<'input,SearchedCaseContextExt<'input>>;

pub trait SearchedCaseContextAttrs<'input>: athenasqlParserContext<'input>{
	/// Retrieves first TerminalNode corresponding to token CASE
	/// Returns `None` if there is no child corresponding to token CASE
	fn CASE(&self) -> Option<Rc<TerminalNode<'input,athenasqlParserContextType>>> where Self:Sized{
		self.get_token(CASE, 0)
	}
	/// Retrieves first TerminalNode corresponding to token END
	/// Returns `None` if there is no child corresponding to token END
	fn END(&self) -> Option<Rc<TerminalNode<'input,athenasqlParserContextType>>> where Self:Sized{
		self.get_token(END, 0)
	}
	fn whenClause_all(&self) ->  Vec<Rc<WhenClauseContextAll<'input>>> where Self:Sized{
		self.children_of_type()
	}
	fn whenClause(&self, i: usize) -> Option<Rc<WhenClauseContextAll<'input>>> where Self:Sized{
		self.child_of_type(i)
	}
	/// Retrieves first TerminalNode corresponding to token ELSE
	/// Returns `None` if there is no child corresponding to token ELSE
	fn ELSE(&self) -> Option<Rc<TerminalNode<'input,athenasqlParserContextType>>> where Self:Sized{
		self.get_token(ELSE, 0)
	}
	fn expression(&self) -> Option<Rc<ExpressionContextAll<'input>>> where Self:Sized{
		self.child_of_type(0)
	}
}

impl<'input> SearchedCaseContextAttrs<'input> for SearchedCaseContext<'input>{}

pub struct SearchedCaseContextExt<'input>{
	base:PrimaryExpressionContextExt<'input>,
	pub elseExpression: Option<Rc<ExpressionContextAll<'input>>>,
	ph:PhantomData<&'input str>
}

antlr_rust::tid!{SearchedCaseContextExt<'a>}

impl<'input> athenasqlParserContext<'input> for SearchedCaseContext<'input>{}

impl<'input,'a> Listenable<dyn athenasqlListener<'input> + 'a> for SearchedCaseContext<'input>{
	fn enter(&self,listener: &mut (dyn athenasqlListener<'input> + 'a)) {
		listener.enter_every_rule(self);
		listener.enter_searchedCase(self);
	}
}

impl<'input> CustomRuleContext<'input> for SearchedCaseContextExt<'input>{
	type TF = LocalTokenFactory<'input>;
	type Ctx = athenasqlParserContextType;
	fn get_rule_index(&self) -> usize { RULE_primaryExpression }
	//fn type_rule_index() -> usize where Self: Sized { RULE_primaryExpression }
}

impl<'input> Borrow<PrimaryExpressionContextExt<'input>> for SearchedCaseContext<'input>{
	fn borrow(&self) -> &PrimaryExpressionContextExt<'input> { &self.base }
}
impl<'input> BorrowMut<PrimaryExpressionContextExt<'input>> for SearchedCaseContext<'input>{
	fn borrow_mut(&mut self) -> &mut PrimaryExpressionContextExt<'input> { &mut self.base }
}

impl<'input> PrimaryExpressionContextAttrs<'input> for SearchedCaseContext<'input> {}

impl<'input> SearchedCaseContextExt<'input>{
	fn new(ctx: &dyn PrimaryExpressionContextAttrs<'input>) -> Rc<PrimaryExpressionContextAll<'input>>  {
		Rc::new(
			PrimaryExpressionContextAll::SearchedCaseContext(
				BaseParserRuleContext::copy_from(ctx,SearchedCaseContextExt{
        			elseExpression:None, 
        			base: ctx.borrow().clone(),
        			ph:PhantomData
				})
			)
		)
	}
}

pub type ColumnNameContext<'input> = BaseParserRuleContext<'input,ColumnNameContextExt<'input>>;

pub trait ColumnNameContextAttrs<'input>: athenasqlParserContext<'input>{
	fn columnReference(&self) -> Option<Rc<ColumnReferenceContextAll<'input>>> where Self:Sized{
		self.child_of_type(0)
	}
}

impl<'input> ColumnNameContextAttrs<'input> for ColumnNameContext<'input>{}

pub struct ColumnNameContextExt<'input>{
	base:PrimaryExpressionContextExt<'input>,
	ph:PhantomData<&'input str>
}

antlr_rust::tid!{ColumnNameContextExt<'a>}

impl<'input> athenasqlParserContext<'input> for ColumnNameContext<'input>{}

impl<'input,'a> Listenable<dyn athenasqlListener<'input> + 'a> for ColumnNameContext<'input>{
	fn enter(&self,listener: &mut (dyn athenasqlListener<'input> + 'a)) {
		listener.enter_every_rule(self);
		listener.enter_columnName(self);
	}
}

impl<'input> CustomRuleContext<'input> for ColumnNameContextExt<'input>{
	type TF = LocalTokenFactory<'input>;
	type Ctx = athenasqlParserContextType;
	fn get_rule_index(&self) -> usize { RULE_primaryExpression }
	//fn type_rule_index() -> usize where Self: Sized { RULE_primaryExpression }
}

impl<'input> Borrow<PrimaryExpressionContextExt<'input>> for ColumnNameContext<'input>{
	fn borrow(&self) -> &PrimaryExpressionContextExt<'input> { &self.base }
}
impl<'input> BorrowMut<PrimaryExpressionContextExt<'input>> for ColumnNameContext<'input>{
	fn borrow_mut(&mut self) -> &mut PrimaryExpressionContextExt<'input> { &mut self.base }
}

impl<'input> PrimaryExpressionContextAttrs<'input> for ColumnNameContext<'input> {}

impl<'input> ColumnNameContextExt<'input>{
	fn new(ctx: &dyn PrimaryExpressionContextAttrs<'input>) -> Rc<PrimaryExpressionContextAll<'input>>  {
		Rc::new(
			PrimaryExpressionContextAll::ColumnNameContext(
				BaseParserRuleContext::copy_from(ctx,ColumnNameContextExt{
        			base: ctx.borrow().clone(),
        			ph:PhantomData
				})
			)
		)
	}
}

impl<'input, I, H> athenasqlParser<'input, I, H>
where
    I: TokenStream<'input, TF = LocalTokenFactory<'input> > + TidAble<'input>,
    H: ErrorStrategy<'input,BaseParserType<'input,I>>
{
	pub fn  primaryExpression(&mut self,)
	-> Result<Rc<PrimaryExpressionContextAll<'input>>,ANTLRError> {
		self.primaryExpression_rec(0)
	}

	fn primaryExpression_rec(&mut self, _p: isize)
	-> Result<Rc<PrimaryExpressionContextAll<'input>>,ANTLRError> {
		let recog = self;
		let _parentctx = recog.ctx.take();
		let _parentState = recog.base.get_state();
		let mut _localctx = PrimaryExpressionContextExt::new(_parentctx.clone(), recog.base.get_state());
		recog.base.enter_recursion_rule(_localctx.clone(), 76, RULE_primaryExpression, _p);
	    let mut _localctx: Rc<PrimaryExpressionContextAll> = _localctx;
        let mut _prevctx = _localctx.clone();
		let _startState = 76;
		let mut _la: isize = -1;
		let result: Result<(), ANTLRError> = (|| {
			let mut _alt: isize;
			//recog.base.enter_outer_alt(_localctx.clone(), 1);
			recog.base.enter_outer_alt(None, 1);
			{
			recog.base.set_state(1182);
			recog.err_handler.sync(&mut recog.base)?;
			match  recog.interpreter.adaptive_predict(143,&mut recog.base)? {
				1 =>{
					{
					let mut tmp = NullLiteralContextExt::new(&**_localctx);
					recog.ctx = Some(tmp.clone());
					_localctx = tmp;
					_prevctx = _localctx.clone();


					recog.base.set_state(974);
					recog.base.match_token(NULL,&mut recog.err_handler)?;

					}
				}
			,
				2 =>{
					{
					let mut tmp = IntervalLiteralContextExt::new(&**_localctx);
					recog.ctx = Some(tmp.clone());
					_localctx = tmp;
					_prevctx = _localctx.clone();
					/*InvokeRule interval*/
					recog.base.set_state(975);
					recog.interval()?;

					}
				}
			,
				3 =>{
					{
					let mut tmp = TypeConstructorContextExt::new(&**_localctx);
					recog.ctx = Some(tmp.clone());
					_localctx = tmp;
					_prevctx = _localctx.clone();
					/*InvokeRule identifier*/
					recog.base.set_state(976);
					recog.identifier()?;

					recog.base.set_state(977);
					recog.base.match_token(STRING,&mut recog.err_handler)?;

					}
				}
			,
				4 =>{
					{
					let mut tmp = TypeConstructorContextExt::new(&**_localctx);
					recog.ctx = Some(tmp.clone());
					_localctx = tmp;
					_prevctx = _localctx.clone();
					recog.base.set_state(979);
					recog.base.match_token(DOUBLE_PRECISION,&mut recog.err_handler)?;

					recog.base.set_state(980);
					recog.base.match_token(STRING,&mut recog.err_handler)?;

					}
				}
			,
				5 =>{
					{
					let mut tmp = NumericLiteralContextExt::new(&**_localctx);
					recog.ctx = Some(tmp.clone());
					_localctx = tmp;
					_prevctx = _localctx.clone();
					/*InvokeRule number*/
					recog.base.set_state(981);
					recog.number()?;

					}
				}
			,
				6 =>{
					{
					let mut tmp = BooleanLiteralContextExt::new(&**_localctx);
					recog.ctx = Some(tmp.clone());
					_localctx = tmp;
					_prevctx = _localctx.clone();
					/*InvokeRule booleanValue*/
					recog.base.set_state(982);
					recog.booleanValue()?;

					}
				}
			,
				7 =>{
					{
					let mut tmp = StringLiteralContextExt::new(&**_localctx);
					recog.ctx = Some(tmp.clone());
					_localctx = tmp;
					_prevctx = _localctx.clone();
					recog.base.set_state(983);
					recog.base.match_token(STRING,&mut recog.err_handler)?;

					}
				}
			,
				8 =>{
					{
					let mut tmp = BinaryLiteralContextExt::new(&**_localctx);
					recog.ctx = Some(tmp.clone());
					_localctx = tmp;
					_prevctx = _localctx.clone();
					recog.base.set_state(984);
					recog.base.match_token(BINARY_LITERAL,&mut recog.err_handler)?;

					}
				}
			,
				9 =>{
					{
					let mut tmp = ParameterContextExt::new(&**_localctx);
					recog.ctx = Some(tmp.clone());
					_localctx = tmp;
					_prevctx = _localctx.clone();
					recog.base.set_state(985);
					recog.base.match_token(T__4,&mut recog.err_handler)?;

					}
				}
			,
				10 =>{
					{
					let mut tmp = PositionContextExt::new(&**_localctx);
					recog.ctx = Some(tmp.clone());
					_localctx = tmp;
					_prevctx = _localctx.clone();
					recog.base.set_state(986);
					recog.base.match_token(POSITION,&mut recog.err_handler)?;

					recog.base.set_state(987);
					recog.base.match_token(T__1,&mut recog.err_handler)?;

					/*InvokeRule valueExpression*/
					recog.base.set_state(988);
					recog.valueExpression_rec(0)?;

					recog.base.set_state(989);
					recog.base.match_token(IN,&mut recog.err_handler)?;

					/*InvokeRule valueExpression*/
					recog.base.set_state(990);
					recog.valueExpression_rec(0)?;

					recog.base.set_state(991);
					recog.base.match_token(T__3,&mut recog.err_handler)?;

					}
				}
			,
				11 =>{
					{
					let mut tmp = RowConstructorContextExt::new(&**_localctx);
					recog.ctx = Some(tmp.clone());
					_localctx = tmp;
					_prevctx = _localctx.clone();
					recog.base.set_state(993);
					recog.base.match_token(T__1,&mut recog.err_handler)?;

					/*InvokeRule expression*/
					recog.base.set_state(994);
					recog.expression()?;

					recog.base.set_state(997); 
					recog.err_handler.sync(&mut recog.base)?;
					_la = recog.base.input.la(1);
					loop {
						{
						{
						recog.base.set_state(995);
						recog.base.match_token(T__2,&mut recog.err_handler)?;

						/*InvokeRule expression*/
						recog.base.set_state(996);
						recog.expression()?;

						}
						}
						recog.base.set_state(999); 
						recog.err_handler.sync(&mut recog.base)?;
						_la = recog.base.input.la(1);
						if !(_la==T__2) {break}
					}
					recog.base.set_state(1001);
					recog.base.match_token(T__3,&mut recog.err_handler)?;

					}
				}
			,
				12 =>{
					{
					let mut tmp = RowConstructorContextExt::new(&**_localctx);
					recog.ctx = Some(tmp.clone());
					_localctx = tmp;
					_prevctx = _localctx.clone();
					recog.base.set_state(1003);
					recog.base.match_token(ROW,&mut recog.err_handler)?;

					recog.base.set_state(1004);
					recog.base.match_token(T__1,&mut recog.err_handler)?;

					/*InvokeRule expression*/
					recog.base.set_state(1005);
					recog.expression()?;

					recog.base.set_state(1010);
					recog.err_handler.sync(&mut recog.base)?;
					_la = recog.base.input.la(1);
					while _la==T__2 {
						{
						{
						recog.base.set_state(1006);
						recog.base.match_token(T__2,&mut recog.err_handler)?;

						/*InvokeRule expression*/
						recog.base.set_state(1007);
						recog.expression()?;

						}
						}
						recog.base.set_state(1012);
						recog.err_handler.sync(&mut recog.base)?;
						_la = recog.base.input.la(1);
					}
					recog.base.set_state(1013);
					recog.base.match_token(T__3,&mut recog.err_handler)?;

					}
				}
			,
				13 =>{
					{
					let mut tmp = FunctionCallContextExt::new(&**_localctx);
					recog.ctx = Some(tmp.clone());
					_localctx = tmp;
					_prevctx = _localctx.clone();
					/*InvokeRule qualifiedName*/
					recog.base.set_state(1015);
					recog.qualifiedName()?;

					recog.base.set_state(1016);
					recog.base.match_token(T__1,&mut recog.err_handler)?;

					recog.base.set_state(1017);
					recog.base.match_token(ASTERISK,&mut recog.err_handler)?;

					recog.base.set_state(1018);
					recog.base.match_token(T__3,&mut recog.err_handler)?;

					recog.base.set_state(1020);
					recog.err_handler.sync(&mut recog.base)?;
					match  recog.interpreter.adaptive_predict(123,&mut recog.base)? {
						x if x == 1=>{
							{
							/*InvokeRule filter*/
							recog.base.set_state(1019);
							recog.filter()?;

							}
						}

						_ => {}
					}
					recog.base.set_state(1023);
					recog.err_handler.sync(&mut recog.base)?;
					match  recog.interpreter.adaptive_predict(124,&mut recog.base)? {
						x if x == 1=>{
							{
							/*InvokeRule over*/
							recog.base.set_state(1022);
							recog.over()?;

							}
						}

						_ => {}
					}
					}
				}
			,
				14 =>{
					{
					let mut tmp = FunctionCallContextExt::new(&**_localctx);
					recog.ctx = Some(tmp.clone());
					_localctx = tmp;
					_prevctx = _localctx.clone();
					/*InvokeRule qualifiedName*/
					recog.base.set_state(1025);
					recog.qualifiedName()?;

					recog.base.set_state(1026);
					recog.base.match_token(T__1,&mut recog.err_handler)?;

					recog.base.set_state(1038);
					recog.err_handler.sync(&mut recog.base)?;
					_la = recog.base.input.la(1);
					if (((_la) & !0x3f) == 0 && ((1usize << _la) & ((1usize << T__1) | (1usize << T__4) | (1usize << ADD) | (1usize << ALL) | (1usize << SOME) | (1usize << ANY) | (1usize << DISTINCT) | (1usize << AT))) != 0) || ((((_la - 32)) & !0x3f) == 0 && ((1usize << (_la - 32)) & ((1usize << (NOT - 32)) | (1usize << (NO - 32)) | (1usize << (EXISTS - 32)) | (1usize << (NULL - 32)) | (1usize << (TRUE - 32)) | (1usize << (FALSE - 32)) | (1usize << (SUBSTRING - 32)) | (1usize << (POSITION - 32)) | (1usize << (TINYINT - 32)) | (1usize << (SMALLINT - 32)) | (1usize << (INTEGER - 32)) | (1usize << (DATE - 32)) | (1usize << (TIME - 32)) | (1usize << (TIMESTAMP - 32)) | (1usize << (INTERVAL - 32)) | (1usize << (YEAR - 32)) | (1usize << (MONTH - 32)) | (1usize << (DAY - 32)) | (1usize << (HOUR - 32)) | (1usize << (MINUTE - 32)) | (1usize << (SECOND - 32)) | (1usize << (ZONE - 32)))) != 0) || ((((_la - 64)) & !0x3f) == 0 && ((1usize << (_la - 64)) & ((1usize << (CURRENT_DATE - 64)) | (1usize << (CURRENT_TIME - 64)) | (1usize << (CURRENT_TIMESTAMP - 64)) | (1usize << (LOCALTIME - 64)) | (1usize << (LOCALTIMESTAMP - 64)) | (1usize << (EXTRACT - 64)) | (1usize << (CASE - 64)) | (1usize << (FILTER - 64)) | (1usize << (OVER - 64)) | (1usize << (PARTITION - 64)) | (1usize << (RANGE - 64)) | (1usize << (ROWS - 64)) | (1usize << (PRECEDING - 64)) | (1usize << (FOLLOWING - 64)) | (1usize << (CURRENT - 64)) | (1usize << (ROW - 64)))) != 0) || ((((_la - 99)) & !0x3f) == 0 && ((1usize << (_la - 99)) & ((1usize << (SCHEMA - 99)) | (1usize << (COMMENT - 99)) | (1usize << (VIEW - 99)) | (1usize << (REPLACE - 99)) | (1usize << (GRANT - 99)) | (1usize << (REVOKE - 99)) | (1usize << (PRIVILEGES - 99)) | (1usize << (PUBLIC - 99)) | (1usize << (OPTION - 99)) | (1usize << (EXPLAIN - 99)) | (1usize << (ANALYZE - 99)) | (1usize << (FORMAT - 99)) | (1usize << (TYPE - 99)) | (1usize << (TEXT - 99)) | (1usize << (GRAPHVIZ - 99)) | (1usize << (LOGICAL - 99)) | (1usize << (DISTRIBUTED - 99)) | (1usize << (VALIDATE - 99)) | (1usize << (CAST - 99)) | (1usize << (TRY_CAST - 99)) | (1usize << (SHOW - 99)) | (1usize << (TABLES - 99)) | (1usize << (SCHEMAS - 99)) | (1usize << (CATALOGS - 99)) | (1usize << (COLUMNS - 99)) | (1usize << (COLUMN - 99)))) != 0) || ((((_la - 131)) & !0x3f) == 0 && ((1usize << (_la - 131)) & ((1usize << (USE - 131)) | (1usize << (PARTITIONS - 131)) | (1usize << (FUNCTIONS - 131)) | (1usize << (TO - 131)) | (1usize << (SYSTEM - 131)) | (1usize << (BERNOULLI - 131)) | (1usize << (POISSONIZED - 131)) | (1usize << (TABLESAMPLE - 131)) | (1usize << (ARRAY - 131)) | (1usize << (MAP - 131)) | (1usize << (SET - 131)) | (1usize << (RESET - 131)) | (1usize << (SESSION - 131)) | (1usize << (DATA - 131)) | (1usize << (START - 131)) | (1usize << (TRANSACTION - 131)) | (1usize << (COMMIT - 131)) | (1usize << (ROLLBACK - 131)) | (1usize << (WORK - 131)) | (1usize << (ISOLATION - 131)) | (1usize << (LEVEL - 131)) | (1usize << (SERIALIZABLE - 131)) | (1usize << (REPEATABLE - 131)) | (1usize << (COMMITTED - 131)))) != 0) || ((((_la - 163)) & !0x3f) == 0 && ((1usize << (_la - 163)) & ((1usize << (UNCOMMITTED - 163)) | (1usize << (READ - 163)) | (1usize << (WRITE - 163)) | (1usize << (ONLY - 163)) | (1usize << (CALL - 163)) | (1usize << (INPUT - 163)) | (1usize << (OUTPUT - 163)) | (1usize << (CASCADE - 163)) | (1usize << (RESTRICT - 163)) | (1usize << (INCLUDING - 163)) | (1usize << (EXCLUDING - 163)) | (1usize << (PROPERTIES - 163)) | (1usize << (NORMALIZE - 163)) | (1usize << (NFD - 163)) | (1usize << (NFC - 163)) | (1usize << (NFKD - 163)) | (1usize << (NFKC - 163)) | (1usize << (IF - 163)) | (1usize << (NULLIF - 163)) | (1usize << (COALESCE - 163)) | (1usize << (PLUS - 163)) | (1usize << (MINUS - 163)))) != 0) || ((((_la - 198)) & !0x3f) == 0 && ((1usize << (_la - 198)) & ((1usize << (STRING - 198)) | (1usize << (BINARY_LITERAL - 198)) | (1usize << (INTEGER_VALUE - 198)) | (1usize << (DECIMAL_VALUE - 198)) | (1usize << (IDENTIFIER - 198)) | (1usize << (DIGIT_IDENTIFIER - 198)) | (1usize << (QUOTED_IDENTIFIER - 198)) | (1usize << (BACKQUOTED_IDENTIFIER - 198)) | (1usize << (DOUBLE_PRECISION - 198)))) != 0) {
						{
						recog.base.set_state(1028);
						recog.err_handler.sync(&mut recog.base)?;
						match  recog.interpreter.adaptive_predict(125,&mut recog.base)? {
							x if x == 1=>{
								{
								/*InvokeRule setQuantifier*/
								recog.base.set_state(1027);
								recog.setQuantifier()?;

								}
							}

							_ => {}
						}
						/*InvokeRule expression*/
						recog.base.set_state(1030);
						recog.expression()?;

						recog.base.set_state(1035);
						recog.err_handler.sync(&mut recog.base)?;
						_la = recog.base.input.la(1);
						while _la==T__2 {
							{
							{
							recog.base.set_state(1031);
							recog.base.match_token(T__2,&mut recog.err_handler)?;

							/*InvokeRule expression*/
							recog.base.set_state(1032);
							recog.expression()?;

							}
							}
							recog.base.set_state(1037);
							recog.err_handler.sync(&mut recog.base)?;
							_la = recog.base.input.la(1);
						}
						}
					}

					recog.base.set_state(1040);
					recog.base.match_token(T__3,&mut recog.err_handler)?;

					recog.base.set_state(1042);
					recog.err_handler.sync(&mut recog.base)?;
					match  recog.interpreter.adaptive_predict(128,&mut recog.base)? {
						x if x == 1=>{
							{
							/*InvokeRule filter*/
							recog.base.set_state(1041);
							recog.filter()?;

							}
						}

						_ => {}
					}
					recog.base.set_state(1045);
					recog.err_handler.sync(&mut recog.base)?;
					match  recog.interpreter.adaptive_predict(129,&mut recog.base)? {
						x if x == 1=>{
							{
							/*InvokeRule over*/
							recog.base.set_state(1044);
							recog.over()?;

							}
						}

						_ => {}
					}
					}
				}
			,
				15 =>{
					{
					let mut tmp = LambdaContextExt::new(&**_localctx);
					recog.ctx = Some(tmp.clone());
					_localctx = tmp;
					_prevctx = _localctx.clone();
					/*InvokeRule identifier*/
					recog.base.set_state(1047);
					recog.identifier()?;

					recog.base.set_state(1048);
					recog.base.match_token(T__5,&mut recog.err_handler)?;

					/*InvokeRule expression*/
					recog.base.set_state(1049);
					recog.expression()?;

					}
				}
			,
				16 =>{
					{
					let mut tmp = LambdaContextExt::new(&**_localctx);
					recog.ctx = Some(tmp.clone());
					_localctx = tmp;
					_prevctx = _localctx.clone();
					recog.base.set_state(1051);
					recog.base.match_token(T__1,&mut recog.err_handler)?;

					/*InvokeRule identifier*/
					recog.base.set_state(1052);
					recog.identifier()?;

					recog.base.set_state(1057);
					recog.err_handler.sync(&mut recog.base)?;
					_la = recog.base.input.la(1);
					while _la==T__2 {
						{
						{
						recog.base.set_state(1053);
						recog.base.match_token(T__2,&mut recog.err_handler)?;

						/*InvokeRule identifier*/
						recog.base.set_state(1054);
						recog.identifier()?;

						}
						}
						recog.base.set_state(1059);
						recog.err_handler.sync(&mut recog.base)?;
						_la = recog.base.input.la(1);
					}
					recog.base.set_state(1060);
					recog.base.match_token(T__3,&mut recog.err_handler)?;

					recog.base.set_state(1061);
					recog.base.match_token(T__5,&mut recog.err_handler)?;

					/*InvokeRule expression*/
					recog.base.set_state(1062);
					recog.expression()?;

					}
				}
			,
				17 =>{
					{
					let mut tmp = SubqueryExpressionContextExt::new(&**_localctx);
					recog.ctx = Some(tmp.clone());
					_localctx = tmp;
					_prevctx = _localctx.clone();
					recog.base.set_state(1064);
					recog.base.match_token(T__1,&mut recog.err_handler)?;

					/*InvokeRule query*/
					recog.base.set_state(1065);
					recog.query()?;

					recog.base.set_state(1066);
					recog.base.match_token(T__3,&mut recog.err_handler)?;

					}
				}
			,
				18 =>{
					{
					let mut tmp = ExistsContextExt::new(&**_localctx);
					recog.ctx = Some(tmp.clone());
					_localctx = tmp;
					_prevctx = _localctx.clone();
					recog.base.set_state(1068);
					recog.base.match_token(EXISTS,&mut recog.err_handler)?;

					recog.base.set_state(1069);
					recog.base.match_token(T__1,&mut recog.err_handler)?;

					/*InvokeRule query*/
					recog.base.set_state(1070);
					recog.query()?;

					recog.base.set_state(1071);
					recog.base.match_token(T__3,&mut recog.err_handler)?;

					}
				}
			,
				19 =>{
					{
					let mut tmp = SimpleCaseContextExt::new(&**_localctx);
					recog.ctx = Some(tmp.clone());
					_localctx = tmp;
					_prevctx = _localctx.clone();
					recog.base.set_state(1073);
					recog.base.match_token(CASE,&mut recog.err_handler)?;

					/*InvokeRule valueExpression*/
					recog.base.set_state(1074);
					recog.valueExpression_rec(0)?;

					recog.base.set_state(1076); 
					recog.err_handler.sync(&mut recog.base)?;
					_la = recog.base.input.la(1);
					loop {
						{
						{
						/*InvokeRule whenClause*/
						recog.base.set_state(1075);
						recog.whenClause()?;

						}
						}
						recog.base.set_state(1078); 
						recog.err_handler.sync(&mut recog.base)?;
						_la = recog.base.input.la(1);
						if !(_la==WHEN) {break}
					}
					recog.base.set_state(1082);
					recog.err_handler.sync(&mut recog.base)?;
					_la = recog.base.input.la(1);
					if _la==ELSE {
						{
						recog.base.set_state(1080);
						recog.base.match_token(ELSE,&mut recog.err_handler)?;

						/*InvokeRule expression*/
						recog.base.set_state(1081);
						let tmp = recog.expression()?;
						if let PrimaryExpressionContextAll::SimpleCaseContext(ctx) = cast_mut::<_,PrimaryExpressionContextAll >(&mut _localctx){
						ctx.elseExpression = Some(tmp.clone()); } else {unreachable!("cant cast");}  

						}
					}

					recog.base.set_state(1084);
					recog.base.match_token(END,&mut recog.err_handler)?;

					}
				}
			,
				20 =>{
					{
					let mut tmp = SearchedCaseContextExt::new(&**_localctx);
					recog.ctx = Some(tmp.clone());
					_localctx = tmp;
					_prevctx = _localctx.clone();
					recog.base.set_state(1086);
					recog.base.match_token(CASE,&mut recog.err_handler)?;

					recog.base.set_state(1088); 
					recog.err_handler.sync(&mut recog.base)?;
					_la = recog.base.input.la(1);
					loop {
						{
						{
						/*InvokeRule whenClause*/
						recog.base.set_state(1087);
						recog.whenClause()?;

						}
						}
						recog.base.set_state(1090); 
						recog.err_handler.sync(&mut recog.base)?;
						_la = recog.base.input.la(1);
						if !(_la==WHEN) {break}
					}
					recog.base.set_state(1094);
					recog.err_handler.sync(&mut recog.base)?;
					_la = recog.base.input.la(1);
					if _la==ELSE {
						{
						recog.base.set_state(1092);
						recog.base.match_token(ELSE,&mut recog.err_handler)?;

						/*InvokeRule expression*/
						recog.base.set_state(1093);
						let tmp = recog.expression()?;
						if let PrimaryExpressionContextAll::SearchedCaseContext(ctx) = cast_mut::<_,PrimaryExpressionContextAll >(&mut _localctx){
						ctx.elseExpression = Some(tmp.clone()); } else {unreachable!("cant cast");}  

						}
					}

					recog.base.set_state(1096);
					recog.base.match_token(END,&mut recog.err_handler)?;

					}
				}
			,
				21 =>{
					{
					let mut tmp = CastContextExt::new(&**_localctx);
					recog.ctx = Some(tmp.clone());
					_localctx = tmp;
					_prevctx = _localctx.clone();
					recog.base.set_state(1098);
					recog.base.match_token(CAST,&mut recog.err_handler)?;

					recog.base.set_state(1099);
					recog.base.match_token(T__1,&mut recog.err_handler)?;

					/*InvokeRule expression*/
					recog.base.set_state(1100);
					recog.expression()?;

					recog.base.set_state(1101);
					recog.base.match_token(AS,&mut recog.err_handler)?;

					/*InvokeRule type*/
					recog.base.set_state(1102);
					recog.type_rec(0)?;

					recog.base.set_state(1103);
					recog.base.match_token(T__3,&mut recog.err_handler)?;

					}
				}
			,
				22 =>{
					{
					let mut tmp = CastContextExt::new(&**_localctx);
					recog.ctx = Some(tmp.clone());
					_localctx = tmp;
					_prevctx = _localctx.clone();
					recog.base.set_state(1105);
					recog.base.match_token(TRY_CAST,&mut recog.err_handler)?;

					recog.base.set_state(1106);
					recog.base.match_token(T__1,&mut recog.err_handler)?;

					/*InvokeRule expression*/
					recog.base.set_state(1107);
					recog.expression()?;

					recog.base.set_state(1108);
					recog.base.match_token(AS,&mut recog.err_handler)?;

					/*InvokeRule type*/
					recog.base.set_state(1109);
					recog.type_rec(0)?;

					recog.base.set_state(1110);
					recog.base.match_token(T__3,&mut recog.err_handler)?;

					}
				}
			,
				23 =>{
					{
					let mut tmp = ArrayConstructorContextExt::new(&**_localctx);
					recog.ctx = Some(tmp.clone());
					_localctx = tmp;
					_prevctx = _localctx.clone();
					recog.base.set_state(1112);
					recog.base.match_token(ARRAY,&mut recog.err_handler)?;

					recog.base.set_state(1113);
					recog.base.match_token(T__6,&mut recog.err_handler)?;

					recog.base.set_state(1122);
					recog.err_handler.sync(&mut recog.base)?;
					_la = recog.base.input.la(1);
					if (((_la) & !0x3f) == 0 && ((1usize << _la) & ((1usize << T__1) | (1usize << T__4) | (1usize << ADD) | (1usize << ALL) | (1usize << SOME) | (1usize << ANY) | (1usize << AT))) != 0) || ((((_la - 32)) & !0x3f) == 0 && ((1usize << (_la - 32)) & ((1usize << (NOT - 32)) | (1usize << (NO - 32)) | (1usize << (EXISTS - 32)) | (1usize << (NULL - 32)) | (1usize << (TRUE - 32)) | (1usize << (FALSE - 32)) | (1usize << (SUBSTRING - 32)) | (1usize << (POSITION - 32)) | (1usize << (TINYINT - 32)) | (1usize << (SMALLINT - 32)) | (1usize << (INTEGER - 32)) | (1usize << (DATE - 32)) | (1usize << (TIME - 32)) | (1usize << (TIMESTAMP - 32)) | (1usize << (INTERVAL - 32)) | (1usize << (YEAR - 32)) | (1usize << (MONTH - 32)) | (1usize << (DAY - 32)) | (1usize << (HOUR - 32)) | (1usize << (MINUTE - 32)) | (1usize << (SECOND - 32)) | (1usize << (ZONE - 32)))) != 0) || ((((_la - 64)) & !0x3f) == 0 && ((1usize << (_la - 64)) & ((1usize << (CURRENT_DATE - 64)) | (1usize << (CURRENT_TIME - 64)) | (1usize << (CURRENT_TIMESTAMP - 64)) | (1usize << (LOCALTIME - 64)) | (1usize << (LOCALTIMESTAMP - 64)) | (1usize << (EXTRACT - 64)) | (1usize << (CASE - 64)) | (1usize << (FILTER - 64)) | (1usize << (OVER - 64)) | (1usize << (PARTITION - 64)) | (1usize << (RANGE - 64)) | (1usize << (ROWS - 64)) | (1usize << (PRECEDING - 64)) | (1usize << (FOLLOWING - 64)) | (1usize << (CURRENT - 64)) | (1usize << (ROW - 64)))) != 0) || ((((_la - 99)) & !0x3f) == 0 && ((1usize << (_la - 99)) & ((1usize << (SCHEMA - 99)) | (1usize << (COMMENT - 99)) | (1usize << (VIEW - 99)) | (1usize << (REPLACE - 99)) | (1usize << (GRANT - 99)) | (1usize << (REVOKE - 99)) | (1usize << (PRIVILEGES - 99)) | (1usize << (PUBLIC - 99)) | (1usize << (OPTION - 99)) | (1usize << (EXPLAIN - 99)) | (1usize << (ANALYZE - 99)) | (1usize << (FORMAT - 99)) | (1usize << (TYPE - 99)) | (1usize << (TEXT - 99)) | (1usize << (GRAPHVIZ - 99)) | (1usize << (LOGICAL - 99)) | (1usize << (DISTRIBUTED - 99)) | (1usize << (VALIDATE - 99)) | (1usize << (CAST - 99)) | (1usize << (TRY_CAST - 99)) | (1usize << (SHOW - 99)) | (1usize << (TABLES - 99)) | (1usize << (SCHEMAS - 99)) | (1usize << (CATALOGS - 99)) | (1usize << (COLUMNS - 99)) | (1usize << (COLUMN - 99)))) != 0) || ((((_la - 131)) & !0x3f) == 0 && ((1usize << (_la - 131)) & ((1usize << (USE - 131)) | (1usize << (PARTITIONS - 131)) | (1usize << (FUNCTIONS - 131)) | (1usize << (TO - 131)) | (1usize << (SYSTEM - 131)) | (1usize << (BERNOULLI - 131)) | (1usize << (POISSONIZED - 131)) | (1usize << (TABLESAMPLE - 131)) | (1usize << (ARRAY - 131)) | (1usize << (MAP - 131)) | (1usize << (SET - 131)) | (1usize << (RESET - 131)) | (1usize << (SESSION - 131)) | (1usize << (DATA - 131)) | (1usize << (START - 131)) | (1usize << (TRANSACTION - 131)) | (1usize << (COMMIT - 131)) | (1usize << (ROLLBACK - 131)) | (1usize << (WORK - 131)) | (1usize << (ISOLATION - 131)) | (1usize << (LEVEL - 131)) | (1usize << (SERIALIZABLE - 131)) | (1usize << (REPEATABLE - 131)) | (1usize << (COMMITTED - 131)))) != 0) || ((((_la - 163)) & !0x3f) == 0 && ((1usize << (_la - 163)) & ((1usize << (UNCOMMITTED - 163)) | (1usize << (READ - 163)) | (1usize << (WRITE - 163)) | (1usize << (ONLY - 163)) | (1usize << (CALL - 163)) | (1usize << (INPUT - 163)) | (1usize << (OUTPUT - 163)) | (1usize << (CASCADE - 163)) | (1usize << (RESTRICT - 163)) | (1usize << (INCLUDING - 163)) | (1usize << (EXCLUDING - 163)) | (1usize << (PROPERTIES - 163)) | (1usize << (NORMALIZE - 163)) | (1usize << (NFD - 163)) | (1usize << (NFC - 163)) | (1usize << (NFKD - 163)) | (1usize << (NFKC - 163)) | (1usize << (IF - 163)) | (1usize << (NULLIF - 163)) | (1usize << (COALESCE - 163)) | (1usize << (PLUS - 163)) | (1usize << (MINUS - 163)))) != 0) || ((((_la - 198)) & !0x3f) == 0 && ((1usize << (_la - 198)) & ((1usize << (STRING - 198)) | (1usize << (BINARY_LITERAL - 198)) | (1usize << (INTEGER_VALUE - 198)) | (1usize << (DECIMAL_VALUE - 198)) | (1usize << (IDENTIFIER - 198)) | (1usize << (DIGIT_IDENTIFIER - 198)) | (1usize << (QUOTED_IDENTIFIER - 198)) | (1usize << (BACKQUOTED_IDENTIFIER - 198)) | (1usize << (DOUBLE_PRECISION - 198)))) != 0) {
						{
						/*InvokeRule expression*/
						recog.base.set_state(1114);
						recog.expression()?;

						recog.base.set_state(1119);
						recog.err_handler.sync(&mut recog.base)?;
						_la = recog.base.input.la(1);
						while _la==T__2 {
							{
							{
							recog.base.set_state(1115);
							recog.base.match_token(T__2,&mut recog.err_handler)?;

							/*InvokeRule expression*/
							recog.base.set_state(1116);
							recog.expression()?;

							}
							}
							recog.base.set_state(1121);
							recog.err_handler.sync(&mut recog.base)?;
							_la = recog.base.input.la(1);
						}
						}
					}

					recog.base.set_state(1124);
					recog.base.match_token(T__7,&mut recog.err_handler)?;

					}
				}
			,
				24 =>{
					{
					let mut tmp = ColumnNameContextExt::new(&**_localctx);
					recog.ctx = Some(tmp.clone());
					_localctx = tmp;
					_prevctx = _localctx.clone();
					/*InvokeRule columnReference*/
					recog.base.set_state(1125);
					recog.columnReference()?;

					}
				}
			,
				25 =>{
					{
					let mut tmp = SpecialDateTimeFunctionContextExt::new(&**_localctx);
					recog.ctx = Some(tmp.clone());
					_localctx = tmp;
					_prevctx = _localctx.clone();
					recog.base.set_state(1126);
					let tmp = recog.base.match_token(CURRENT_DATE,&mut recog.err_handler)?;
					if let PrimaryExpressionContextAll::SpecialDateTimeFunctionContext(ctx) = cast_mut::<_,PrimaryExpressionContextAll >(&mut _localctx){
					ctx.name = Some(tmp.clone()); } else {unreachable!("cant cast");}  

					}
				}
			,
				26 =>{
					{
					let mut tmp = SpecialDateTimeFunctionContextExt::new(&**_localctx);
					recog.ctx = Some(tmp.clone());
					_localctx = tmp;
					_prevctx = _localctx.clone();
					recog.base.set_state(1127);
					let tmp = recog.base.match_token(CURRENT_TIME,&mut recog.err_handler)?;
					if let PrimaryExpressionContextAll::SpecialDateTimeFunctionContext(ctx) = cast_mut::<_,PrimaryExpressionContextAll >(&mut _localctx){
					ctx.name = Some(tmp.clone()); } else {unreachable!("cant cast");}  

					recog.base.set_state(1131);
					recog.err_handler.sync(&mut recog.base)?;
					match  recog.interpreter.adaptive_predict(137,&mut recog.base)? {
						x if x == 1=>{
							{
							recog.base.set_state(1128);
							recog.base.match_token(T__1,&mut recog.err_handler)?;

							recog.base.set_state(1129);
							let tmp = recog.base.match_token(INTEGER_VALUE,&mut recog.err_handler)?;
							if let PrimaryExpressionContextAll::SpecialDateTimeFunctionContext(ctx) = cast_mut::<_,PrimaryExpressionContextAll >(&mut _localctx){
							ctx.precision = Some(tmp.clone()); } else {unreachable!("cant cast");}  

							recog.base.set_state(1130);
							recog.base.match_token(T__3,&mut recog.err_handler)?;

							}
						}

						_ => {}
					}
					}
				}
			,
				27 =>{
					{
					let mut tmp = SpecialDateTimeFunctionContextExt::new(&**_localctx);
					recog.ctx = Some(tmp.clone());
					_localctx = tmp;
					_prevctx = _localctx.clone();
					recog.base.set_state(1133);
					let tmp = recog.base.match_token(CURRENT_TIMESTAMP,&mut recog.err_handler)?;
					if let PrimaryExpressionContextAll::SpecialDateTimeFunctionContext(ctx) = cast_mut::<_,PrimaryExpressionContextAll >(&mut _localctx){
					ctx.name = Some(tmp.clone()); } else {unreachable!("cant cast");}  

					recog.base.set_state(1137);
					recog.err_handler.sync(&mut recog.base)?;
					match  recog.interpreter.adaptive_predict(138,&mut recog.base)? {
						x if x == 1=>{
							{
							recog.base.set_state(1134);
							recog.base.match_token(T__1,&mut recog.err_handler)?;

							recog.base.set_state(1135);
							let tmp = recog.base.match_token(INTEGER_VALUE,&mut recog.err_handler)?;
							if let PrimaryExpressionContextAll::SpecialDateTimeFunctionContext(ctx) = cast_mut::<_,PrimaryExpressionContextAll >(&mut _localctx){
							ctx.precision = Some(tmp.clone()); } else {unreachable!("cant cast");}  

							recog.base.set_state(1136);
							recog.base.match_token(T__3,&mut recog.err_handler)?;

							}
						}

						_ => {}
					}
					}
				}
			,
				28 =>{
					{
					let mut tmp = SpecialDateTimeFunctionContextExt::new(&**_localctx);
					recog.ctx = Some(tmp.clone());
					_localctx = tmp;
					_prevctx = _localctx.clone();
					recog.base.set_state(1139);
					let tmp = recog.base.match_token(LOCALTIME,&mut recog.err_handler)?;
					if let PrimaryExpressionContextAll::SpecialDateTimeFunctionContext(ctx) = cast_mut::<_,PrimaryExpressionContextAll >(&mut _localctx){
					ctx.name = Some(tmp.clone()); } else {unreachable!("cant cast");}  

					recog.base.set_state(1143);
					recog.err_handler.sync(&mut recog.base)?;
					match  recog.interpreter.adaptive_predict(139,&mut recog.base)? {
						x if x == 1=>{
							{
							recog.base.set_state(1140);
							recog.base.match_token(T__1,&mut recog.err_handler)?;

							recog.base.set_state(1141);
							let tmp = recog.base.match_token(INTEGER_VALUE,&mut recog.err_handler)?;
							if let PrimaryExpressionContextAll::SpecialDateTimeFunctionContext(ctx) = cast_mut::<_,PrimaryExpressionContextAll >(&mut _localctx){
							ctx.precision = Some(tmp.clone()); } else {unreachable!("cant cast");}  

							recog.base.set_state(1142);
							recog.base.match_token(T__3,&mut recog.err_handler)?;

							}
						}

						_ => {}
					}
					}
				}
			,
				29 =>{
					{
					let mut tmp = SpecialDateTimeFunctionContextExt::new(&**_localctx);
					recog.ctx = Some(tmp.clone());
					_localctx = tmp;
					_prevctx = _localctx.clone();
					recog.base.set_state(1145);
					let tmp = recog.base.match_token(LOCALTIMESTAMP,&mut recog.err_handler)?;
					if let PrimaryExpressionContextAll::SpecialDateTimeFunctionContext(ctx) = cast_mut::<_,PrimaryExpressionContextAll >(&mut _localctx){
					ctx.name = Some(tmp.clone()); } else {unreachable!("cant cast");}  

					recog.base.set_state(1149);
					recog.err_handler.sync(&mut recog.base)?;
					match  recog.interpreter.adaptive_predict(140,&mut recog.base)? {
						x if x == 1=>{
							{
							recog.base.set_state(1146);
							recog.base.match_token(T__1,&mut recog.err_handler)?;

							recog.base.set_state(1147);
							let tmp = recog.base.match_token(INTEGER_VALUE,&mut recog.err_handler)?;
							if let PrimaryExpressionContextAll::SpecialDateTimeFunctionContext(ctx) = cast_mut::<_,PrimaryExpressionContextAll >(&mut _localctx){
							ctx.precision = Some(tmp.clone()); } else {unreachable!("cant cast");}  

							recog.base.set_state(1148);
							recog.base.match_token(T__3,&mut recog.err_handler)?;

							}
						}

						_ => {}
					}
					}
				}
			,
				30 =>{
					{
					let mut tmp = SubstringContextExt::new(&**_localctx);
					recog.ctx = Some(tmp.clone());
					_localctx = tmp;
					_prevctx = _localctx.clone();
					recog.base.set_state(1151);
					recog.base.match_token(SUBSTRING,&mut recog.err_handler)?;

					recog.base.set_state(1152);
					recog.base.match_token(T__1,&mut recog.err_handler)?;

					/*InvokeRule valueExpression*/
					recog.base.set_state(1153);
					recog.valueExpression_rec(0)?;

					recog.base.set_state(1154);
					recog.base.match_token(FROM,&mut recog.err_handler)?;

					/*InvokeRule valueExpression*/
					recog.base.set_state(1155);
					recog.valueExpression_rec(0)?;

					recog.base.set_state(1158);
					recog.err_handler.sync(&mut recog.base)?;
					_la = recog.base.input.la(1);
					if _la==FOR {
						{
						recog.base.set_state(1156);
						recog.base.match_token(FOR,&mut recog.err_handler)?;

						/*InvokeRule valueExpression*/
						recog.base.set_state(1157);
						recog.valueExpression_rec(0)?;

						}
					}

					recog.base.set_state(1160);
					recog.base.match_token(T__3,&mut recog.err_handler)?;

					}
				}
			,
				31 =>{
					{
					let mut tmp = NormalizeContextExt::new(&**_localctx);
					recog.ctx = Some(tmp.clone());
					_localctx = tmp;
					_prevctx = _localctx.clone();
					recog.base.set_state(1162);
					recog.base.match_token(NORMALIZE,&mut recog.err_handler)?;

					recog.base.set_state(1163);
					recog.base.match_token(T__1,&mut recog.err_handler)?;

					/*InvokeRule valueExpression*/
					recog.base.set_state(1164);
					recog.valueExpression_rec(0)?;

					recog.base.set_state(1167);
					recog.err_handler.sync(&mut recog.base)?;
					_la = recog.base.input.la(1);
					if _la==T__2 {
						{
						recog.base.set_state(1165);
						recog.base.match_token(T__2,&mut recog.err_handler)?;

						/*InvokeRule normalForm*/
						recog.base.set_state(1166);
						recog.normalForm()?;

						}
					}

					recog.base.set_state(1169);
					recog.base.match_token(T__3,&mut recog.err_handler)?;

					}
				}
			,
				32 =>{
					{
					let mut tmp = ExtractContextExt::new(&**_localctx);
					recog.ctx = Some(tmp.clone());
					_localctx = tmp;
					_prevctx = _localctx.clone();
					recog.base.set_state(1171);
					recog.base.match_token(EXTRACT,&mut recog.err_handler)?;

					recog.base.set_state(1172);
					recog.base.match_token(T__1,&mut recog.err_handler)?;

					/*InvokeRule identifier*/
					recog.base.set_state(1173);
					recog.identifier()?;

					recog.base.set_state(1174);
					recog.base.match_token(FROM,&mut recog.err_handler)?;

					/*InvokeRule valueExpression*/
					recog.base.set_state(1175);
					recog.valueExpression_rec(0)?;

					recog.base.set_state(1176);
					recog.base.match_token(T__3,&mut recog.err_handler)?;

					}
				}
			,
				33 =>{
					{
					let mut tmp = ParenthesizedExpressionContextExt::new(&**_localctx);
					recog.ctx = Some(tmp.clone());
					_localctx = tmp;
					_prevctx = _localctx.clone();
					recog.base.set_state(1178);
					recog.base.match_token(T__1,&mut recog.err_handler)?;

					/*InvokeRule expression*/
					recog.base.set_state(1179);
					recog.expression()?;

					recog.base.set_state(1180);
					recog.base.match_token(T__3,&mut recog.err_handler)?;

					}
				}

				_ => {}
			}

			let tmp = recog.input.lt(-1).cloned();
			recog.ctx.as_ref().unwrap().set_stop(tmp);
			recog.base.set_state(1194);
			recog.err_handler.sync(&mut recog.base)?;
			_alt = recog.interpreter.adaptive_predict(145,&mut recog.base)?;
			while { _alt!=2 && _alt!=INVALID_ALT } {
				if _alt==1 {
					recog.trigger_exit_rule_event();
					_prevctx = _localctx.clone();
					{
					recog.base.set_state(1192);
					recog.err_handler.sync(&mut recog.base)?;
					match  recog.interpreter.adaptive_predict(144,&mut recog.base)? {
						1 =>{
							{
							/*recRuleLabeledAltStartAction*/
							let mut tmp = SubscriptContextExt::new(&**PrimaryExpressionContextExt::new(_parentctx.clone(), _parentState));
							if let PrimaryExpressionContextAll::SubscriptContext(ctx) = cast_mut::<_,PrimaryExpressionContextAll >(&mut tmp){
								ctx.value = Some(_prevctx.clone());
							} else {unreachable!("cant cast");}
							recog.push_new_recursion_context(tmp.clone(), _startState, RULE_primaryExpression);
							_localctx = tmp;
							recog.base.set_state(1184);
							if !({recog.precpred(None, 12)}) {
								Err(FailedPredicateError::new(&mut recog.base, Some("recog.precpred(None, 12)".to_owned()), None))?;
							}
							recog.base.set_state(1185);
							recog.base.match_token(T__6,&mut recog.err_handler)?;

							/*InvokeRule valueExpression*/
							recog.base.set_state(1186);
							let tmp = recog.valueExpression_rec(0)?;
							if let PrimaryExpressionContextAll::SubscriptContext(ctx) = cast_mut::<_,PrimaryExpressionContextAll >(&mut _localctx){
							ctx.index = Some(tmp.clone()); } else {unreachable!("cant cast");}  

							recog.base.set_state(1187);
							recog.base.match_token(T__7,&mut recog.err_handler)?;

							}
						}
					,
						2 =>{
							{
							/*recRuleLabeledAltStartAction*/
							let mut tmp = DereferenceContextExt::new(&**PrimaryExpressionContextExt::new(_parentctx.clone(), _parentState));
							if let PrimaryExpressionContextAll::DereferenceContext(ctx) = cast_mut::<_,PrimaryExpressionContextAll >(&mut tmp){
								ctx.base = Some(_prevctx.clone());
							} else {unreachable!("cant cast");}
							recog.push_new_recursion_context(tmp.clone(), _startState, RULE_primaryExpression);
							_localctx = tmp;
							recog.base.set_state(1189);
							if !({recog.precpred(None, 10)}) {
								Err(FailedPredicateError::new(&mut recog.base, Some("recog.precpred(None, 10)".to_owned()), None))?;
							}
							recog.base.set_state(1190);
							recog.base.match_token(T__0,&mut recog.err_handler)?;

							/*InvokeRule identifier*/
							recog.base.set_state(1191);
							let tmp = recog.identifier()?;
							if let PrimaryExpressionContextAll::DereferenceContext(ctx) = cast_mut::<_,PrimaryExpressionContextAll >(&mut _localctx){
							ctx.fieldName = Some(tmp.clone()); } else {unreachable!("cant cast");}  

							}
						}

						_ => {}
					}
					} 
				}
				recog.base.set_state(1196);
				recog.err_handler.sync(&mut recog.base)?;
				_alt = recog.interpreter.adaptive_predict(145,&mut recog.base)?;
			}
			}
			Ok(())
		})();
		match result {
		Ok(_) => {},
        Err(e @ ANTLRError::FallThrough(_)) => return Err(e),
		Err(ref re)=>{
			//_localctx.exception = re;
			recog.err_handler.report_error(&mut recog.base, re);
	        recog.err_handler.recover(&mut recog.base, re)?;}
		}
		recog.base.unroll_recursion_context(_parentctx);

		Ok(_localctx)
	}
}
//------------------- timeZoneSpecifier ----------------
#[derive(Debug)]
pub enum TimeZoneSpecifierContextAll<'input>{
	TimeZoneIntervalContext(TimeZoneIntervalContext<'input>),
	TimeZoneStringContext(TimeZoneStringContext<'input>),
Error(TimeZoneSpecifierContext<'input>)
}
antlr_rust::tid!{TimeZoneSpecifierContextAll<'a>}

impl<'input> antlr_rust::parser_rule_context::DerefSeal for TimeZoneSpecifierContextAll<'input>{}

impl<'input> athenasqlParserContext<'input> for TimeZoneSpecifierContextAll<'input>{}

impl<'input> Deref for TimeZoneSpecifierContextAll<'input>{
	type Target = dyn TimeZoneSpecifierContextAttrs<'input> + 'input;
	fn deref(&self) -> &Self::Target{
		use TimeZoneSpecifierContextAll::*;
		match self{
			TimeZoneIntervalContext(inner) => inner,
			TimeZoneStringContext(inner) => inner,
Error(inner) => inner
		}
	}
}
impl<'input,'a> Listenable<dyn athenasqlListener<'input> + 'a> for TimeZoneSpecifierContextAll<'input>{
    fn enter(&self, listener: &mut (dyn athenasqlListener<'input> + 'a)) { self.deref().enter(listener) }
    fn exit(&self, listener: &mut (dyn athenasqlListener<'input> + 'a)) { self.deref().exit(listener) }
}



pub type TimeZoneSpecifierContext<'input> = BaseParserRuleContext<'input,TimeZoneSpecifierContextExt<'input>>;

#[derive(Clone)]
pub struct TimeZoneSpecifierContextExt<'input>{
ph:PhantomData<&'input str>
}

impl<'input> athenasqlParserContext<'input> for TimeZoneSpecifierContext<'input>{}

impl<'input,'a> Listenable<dyn athenasqlListener<'input> + 'a> for TimeZoneSpecifierContext<'input>{
}

impl<'input> CustomRuleContext<'input> for TimeZoneSpecifierContextExt<'input>{
	type TF = LocalTokenFactory<'input>;
	type Ctx = athenasqlParserContextType;
	fn get_rule_index(&self) -> usize { RULE_timeZoneSpecifier }
	//fn type_rule_index() -> usize where Self: Sized { RULE_timeZoneSpecifier }
}
antlr_rust::tid!{TimeZoneSpecifierContextExt<'a>}

impl<'input> TimeZoneSpecifierContextExt<'input>{
	fn new(parent: Option<Rc<dyn athenasqlParserContext<'input> + 'input > >, invoking_state: isize) -> Rc<TimeZoneSpecifierContextAll<'input>> {
		Rc::new(
		TimeZoneSpecifierContextAll::Error(
			BaseParserRuleContext::new_parser_ctx(parent, invoking_state,TimeZoneSpecifierContextExt{
				ph:PhantomData
			}),
		)
		)
	}
}

pub trait TimeZoneSpecifierContextAttrs<'input>: athenasqlParserContext<'input> + BorrowMut<TimeZoneSpecifierContextExt<'input>>{


}

impl<'input> TimeZoneSpecifierContextAttrs<'input> for TimeZoneSpecifierContext<'input>{}

pub type TimeZoneIntervalContext<'input> = BaseParserRuleContext<'input,TimeZoneIntervalContextExt<'input>>;

pub trait TimeZoneIntervalContextAttrs<'input>: athenasqlParserContext<'input>{
	/// Retrieves first TerminalNode corresponding to token TIME
	/// Returns `None` if there is no child corresponding to token TIME
	fn TIME(&self) -> Option<Rc<TerminalNode<'input,athenasqlParserContextType>>> where Self:Sized{
		self.get_token(TIME, 0)
	}
	/// Retrieves first TerminalNode corresponding to token ZONE
	/// Returns `None` if there is no child corresponding to token ZONE
	fn ZONE(&self) -> Option<Rc<TerminalNode<'input,athenasqlParserContextType>>> where Self:Sized{
		self.get_token(ZONE, 0)
	}
	fn interval(&self) -> Option<Rc<IntervalContextAll<'input>>> where Self:Sized{
		self.child_of_type(0)
	}
}

impl<'input> TimeZoneIntervalContextAttrs<'input> for TimeZoneIntervalContext<'input>{}

pub struct TimeZoneIntervalContextExt<'input>{
	base:TimeZoneSpecifierContextExt<'input>,
	ph:PhantomData<&'input str>
}

antlr_rust::tid!{TimeZoneIntervalContextExt<'a>}

impl<'input> athenasqlParserContext<'input> for TimeZoneIntervalContext<'input>{}

impl<'input,'a> Listenable<dyn athenasqlListener<'input> + 'a> for TimeZoneIntervalContext<'input>{
	fn enter(&self,listener: &mut (dyn athenasqlListener<'input> + 'a)) {
		listener.enter_every_rule(self);
		listener.enter_timeZoneInterval(self);
	}
}

impl<'input> CustomRuleContext<'input> for TimeZoneIntervalContextExt<'input>{
	type TF = LocalTokenFactory<'input>;
	type Ctx = athenasqlParserContextType;
	fn get_rule_index(&self) -> usize { RULE_timeZoneSpecifier }
	//fn type_rule_index() -> usize where Self: Sized { RULE_timeZoneSpecifier }
}

impl<'input> Borrow<TimeZoneSpecifierContextExt<'input>> for TimeZoneIntervalContext<'input>{
	fn borrow(&self) -> &TimeZoneSpecifierContextExt<'input> { &self.base }
}
impl<'input> BorrowMut<TimeZoneSpecifierContextExt<'input>> for TimeZoneIntervalContext<'input>{
	fn borrow_mut(&mut self) -> &mut TimeZoneSpecifierContextExt<'input> { &mut self.base }
}

impl<'input> TimeZoneSpecifierContextAttrs<'input> for TimeZoneIntervalContext<'input> {}

impl<'input> TimeZoneIntervalContextExt<'input>{
	fn new(ctx: &dyn TimeZoneSpecifierContextAttrs<'input>) -> Rc<TimeZoneSpecifierContextAll<'input>>  {
		Rc::new(
			TimeZoneSpecifierContextAll::TimeZoneIntervalContext(
				BaseParserRuleContext::copy_from(ctx,TimeZoneIntervalContextExt{
        			base: ctx.borrow().clone(),
        			ph:PhantomData
				})
			)
		)
	}
}

pub type TimeZoneStringContext<'input> = BaseParserRuleContext<'input,TimeZoneStringContextExt<'input>>;

pub trait TimeZoneStringContextAttrs<'input>: athenasqlParserContext<'input>{
	/// Retrieves first TerminalNode corresponding to token TIME
	/// Returns `None` if there is no child corresponding to token TIME
	fn TIME(&self) -> Option<Rc<TerminalNode<'input,athenasqlParserContextType>>> where Self:Sized{
		self.get_token(TIME, 0)
	}
	/// Retrieves first TerminalNode corresponding to token ZONE
	/// Returns `None` if there is no child corresponding to token ZONE
	fn ZONE(&self) -> Option<Rc<TerminalNode<'input,athenasqlParserContextType>>> where Self:Sized{
		self.get_token(ZONE, 0)
	}
	/// Retrieves first TerminalNode corresponding to token STRING
	/// Returns `None` if there is no child corresponding to token STRING
	fn STRING(&self) -> Option<Rc<TerminalNode<'input,athenasqlParserContextType>>> where Self:Sized{
		self.get_token(STRING, 0)
	}
}

impl<'input> TimeZoneStringContextAttrs<'input> for TimeZoneStringContext<'input>{}

pub struct TimeZoneStringContextExt<'input>{
	base:TimeZoneSpecifierContextExt<'input>,
	ph:PhantomData<&'input str>
}

antlr_rust::tid!{TimeZoneStringContextExt<'a>}

impl<'input> athenasqlParserContext<'input> for TimeZoneStringContext<'input>{}

impl<'input,'a> Listenable<dyn athenasqlListener<'input> + 'a> for TimeZoneStringContext<'input>{
	fn enter(&self,listener: &mut (dyn athenasqlListener<'input> + 'a)) {
		listener.enter_every_rule(self);
		listener.enter_timeZoneString(self);
	}
}

impl<'input> CustomRuleContext<'input> for TimeZoneStringContextExt<'input>{
	type TF = LocalTokenFactory<'input>;
	type Ctx = athenasqlParserContextType;
	fn get_rule_index(&self) -> usize { RULE_timeZoneSpecifier }
	//fn type_rule_index() -> usize where Self: Sized { RULE_timeZoneSpecifier }
}

impl<'input> Borrow<TimeZoneSpecifierContextExt<'input>> for TimeZoneStringContext<'input>{
	fn borrow(&self) -> &TimeZoneSpecifierContextExt<'input> { &self.base }
}
impl<'input> BorrowMut<TimeZoneSpecifierContextExt<'input>> for TimeZoneStringContext<'input>{
	fn borrow_mut(&mut self) -> &mut TimeZoneSpecifierContextExt<'input> { &mut self.base }
}

impl<'input> TimeZoneSpecifierContextAttrs<'input> for TimeZoneStringContext<'input> {}

impl<'input> TimeZoneStringContextExt<'input>{
	fn new(ctx: &dyn TimeZoneSpecifierContextAttrs<'input>) -> Rc<TimeZoneSpecifierContextAll<'input>>  {
		Rc::new(
			TimeZoneSpecifierContextAll::TimeZoneStringContext(
				BaseParserRuleContext::copy_from(ctx,TimeZoneStringContextExt{
        			base: ctx.borrow().clone(),
        			ph:PhantomData
				})
			)
		)
	}
}

impl<'input, I, H> athenasqlParser<'input, I, H>
where
    I: TokenStream<'input, TF = LocalTokenFactory<'input> > + TidAble<'input>,
    H: ErrorStrategy<'input,BaseParserType<'input,I>>
{
	pub fn timeZoneSpecifier(&mut self,)
	-> Result<Rc<TimeZoneSpecifierContextAll<'input>>,ANTLRError> {
		let mut recog = self;
		let _parentctx = recog.ctx.take();
		let mut _localctx = TimeZoneSpecifierContextExt::new(_parentctx.clone(), recog.base.get_state());
        recog.base.enter_rule(_localctx.clone(), 78, RULE_timeZoneSpecifier);
        let mut _localctx: Rc<TimeZoneSpecifierContextAll> = _localctx;
		let result: Result<(), ANTLRError> = (|| {

			recog.base.set_state(1203);
			recog.err_handler.sync(&mut recog.base)?;
			match  recog.interpreter.adaptive_predict(146,&mut recog.base)? {
				1 =>{
					let tmp = TimeZoneIntervalContextExt::new(&**_localctx);
					recog.base.enter_outer_alt(Some(tmp.clone()), 1);
					_localctx = tmp;
					{
					recog.base.set_state(1197);
					recog.base.match_token(TIME,&mut recog.err_handler)?;

					recog.base.set_state(1198);
					recog.base.match_token(ZONE,&mut recog.err_handler)?;

					/*InvokeRule interval*/
					recog.base.set_state(1199);
					recog.interval()?;

					}
				}
			,
				2 =>{
					let tmp = TimeZoneStringContextExt::new(&**_localctx);
					recog.base.enter_outer_alt(Some(tmp.clone()), 2);
					_localctx = tmp;
					{
					recog.base.set_state(1200);
					recog.base.match_token(TIME,&mut recog.err_handler)?;

					recog.base.set_state(1201);
					recog.base.match_token(ZONE,&mut recog.err_handler)?;

					recog.base.set_state(1202);
					recog.base.match_token(STRING,&mut recog.err_handler)?;

					}
				}

				_ => {}
			}
			Ok(())
		})();
		match result {
		Ok(_)=>{},
        Err(e @ ANTLRError::FallThrough(_)) => return Err(e),
		Err(ref re) => {
				//_localctx.exception = re;
				recog.err_handler.report_error(&mut recog.base, re);
				recog.err_handler.recover(&mut recog.base, re)?;
			}
		}
		recog.base.exit_rule();

		Ok(_localctx)
	}
}
//------------------- comparisonOperator ----------------
pub type ComparisonOperatorContextAll<'input> = ComparisonOperatorContext<'input>;


pub type ComparisonOperatorContext<'input> = BaseParserRuleContext<'input,ComparisonOperatorContextExt<'input>>;

#[derive(Clone)]
pub struct ComparisonOperatorContextExt<'input>{
ph:PhantomData<&'input str>
}

impl<'input> athenasqlParserContext<'input> for ComparisonOperatorContext<'input>{}

impl<'input,'a> Listenable<dyn athenasqlListener<'input> + 'a> for ComparisonOperatorContext<'input>{
		fn enter(&self,listener: &mut (dyn athenasqlListener<'input> + 'a)) {
			listener.enter_every_rule(self);
			listener.enter_comparisonOperator(self);
		}fn exit(&self,listener: &mut (dyn athenasqlListener<'input> + 'a)) {
			listener.exit_comparisonOperator(self);
			listener.exit_every_rule(self);
		}
}

impl<'input> CustomRuleContext<'input> for ComparisonOperatorContextExt<'input>{
	type TF = LocalTokenFactory<'input>;
	type Ctx = athenasqlParserContextType;
	fn get_rule_index(&self) -> usize { RULE_comparisonOperator }
	//fn type_rule_index() -> usize where Self: Sized { RULE_comparisonOperator }
}
antlr_rust::tid!{ComparisonOperatorContextExt<'a>}

impl<'input> ComparisonOperatorContextExt<'input>{
	fn new(parent: Option<Rc<dyn athenasqlParserContext<'input> + 'input > >, invoking_state: isize) -> Rc<ComparisonOperatorContextAll<'input>> {
		Rc::new(
			BaseParserRuleContext::new_parser_ctx(parent, invoking_state,ComparisonOperatorContextExt{
				ph:PhantomData
			}),
		)
	}
}

pub trait ComparisonOperatorContextAttrs<'input>: athenasqlParserContext<'input> + BorrowMut<ComparisonOperatorContextExt<'input>>{

/// Retrieves first TerminalNode corresponding to token EQ
/// Returns `None` if there is no child corresponding to token EQ
fn EQ(&self) -> Option<Rc<TerminalNode<'input,athenasqlParserContextType>>> where Self:Sized{
	self.get_token(EQ, 0)
}
/// Retrieves first TerminalNode corresponding to token NEQ
/// Returns `None` if there is no child corresponding to token NEQ
fn NEQ(&self) -> Option<Rc<TerminalNode<'input,athenasqlParserContextType>>> where Self:Sized{
	self.get_token(NEQ, 0)
}
/// Retrieves first TerminalNode corresponding to token LT
/// Returns `None` if there is no child corresponding to token LT
fn LT(&self) -> Option<Rc<TerminalNode<'input,athenasqlParserContextType>>> where Self:Sized{
	self.get_token(LT, 0)
}
/// Retrieves first TerminalNode corresponding to token LTE
/// Returns `None` if there is no child corresponding to token LTE
fn LTE(&self) -> Option<Rc<TerminalNode<'input,athenasqlParserContextType>>> where Self:Sized{
	self.get_token(LTE, 0)
}
/// Retrieves first TerminalNode corresponding to token GT
/// Returns `None` if there is no child corresponding to token GT
fn GT(&self) -> Option<Rc<TerminalNode<'input,athenasqlParserContextType>>> where Self:Sized{
	self.get_token(GT, 0)
}
/// Retrieves first TerminalNode corresponding to token GTE
/// Returns `None` if there is no child corresponding to token GTE
fn GTE(&self) -> Option<Rc<TerminalNode<'input,athenasqlParserContextType>>> where Self:Sized{
	self.get_token(GTE, 0)
}

}

impl<'input> ComparisonOperatorContextAttrs<'input> for ComparisonOperatorContext<'input>{}

impl<'input, I, H> athenasqlParser<'input, I, H>
where
    I: TokenStream<'input, TF = LocalTokenFactory<'input> > + TidAble<'input>,
    H: ErrorStrategy<'input,BaseParserType<'input,I>>
{
	pub fn comparisonOperator(&mut self,)
	-> Result<Rc<ComparisonOperatorContextAll<'input>>,ANTLRError> {
		let mut recog = self;
		let _parentctx = recog.ctx.take();
		let mut _localctx = ComparisonOperatorContextExt::new(_parentctx.clone(), recog.base.get_state());
        recog.base.enter_rule(_localctx.clone(), 80, RULE_comparisonOperator);
        let mut _localctx: Rc<ComparisonOperatorContextAll> = _localctx;
		let mut _la: isize = -1;
		let result: Result<(), ANTLRError> = (|| {

			//recog.base.enter_outer_alt(_localctx.clone(), 1);
			recog.base.enter_outer_alt(None, 1);
			{
			recog.base.set_state(1205);
			_la = recog.base.input.la(1);
			if { !(((((_la - 186)) & !0x3f) == 0 && ((1usize << (_la - 186)) & ((1usize << (EQ - 186)) | (1usize << (NEQ - 186)) | (1usize << (LT - 186)) | (1usize << (LTE - 186)) | (1usize << (GT - 186)) | (1usize << (GTE - 186)))) != 0)) } {
				recog.err_handler.recover_inline(&mut recog.base)?;

			}
			else {
				if  recog.base.input.la(1)==TOKEN_EOF { recog.base.matched_eof = true };
				recog.err_handler.report_match(&mut recog.base);
				recog.base.consume(&mut recog.err_handler);
			}
			}
			Ok(())
		})();
		match result {
		Ok(_)=>{},
        Err(e @ ANTLRError::FallThrough(_)) => return Err(e),
		Err(ref re) => {
				//_localctx.exception = re;
				recog.err_handler.report_error(&mut recog.base, re);
				recog.err_handler.recover(&mut recog.base, re)?;
			}
		}
		recog.base.exit_rule();

		Ok(_localctx)
	}
}
//------------------- comparisonQuantifier ----------------
pub type ComparisonQuantifierContextAll<'input> = ComparisonQuantifierContext<'input>;


pub type ComparisonQuantifierContext<'input> = BaseParserRuleContext<'input,ComparisonQuantifierContextExt<'input>>;

#[derive(Clone)]
pub struct ComparisonQuantifierContextExt<'input>{
ph:PhantomData<&'input str>
}

impl<'input> athenasqlParserContext<'input> for ComparisonQuantifierContext<'input>{}

impl<'input,'a> Listenable<dyn athenasqlListener<'input> + 'a> for ComparisonQuantifierContext<'input>{
		fn enter(&self,listener: &mut (dyn athenasqlListener<'input> + 'a)) {
			listener.enter_every_rule(self);
			listener.enter_comparisonQuantifier(self);
		}fn exit(&self,listener: &mut (dyn athenasqlListener<'input> + 'a)) {
			listener.exit_comparisonQuantifier(self);
			listener.exit_every_rule(self);
		}
}

impl<'input> CustomRuleContext<'input> for ComparisonQuantifierContextExt<'input>{
	type TF = LocalTokenFactory<'input>;
	type Ctx = athenasqlParserContextType;
	fn get_rule_index(&self) -> usize { RULE_comparisonQuantifier }
	//fn type_rule_index() -> usize where Self: Sized { RULE_comparisonQuantifier }
}
antlr_rust::tid!{ComparisonQuantifierContextExt<'a>}

impl<'input> ComparisonQuantifierContextExt<'input>{
	fn new(parent: Option<Rc<dyn athenasqlParserContext<'input> + 'input > >, invoking_state: isize) -> Rc<ComparisonQuantifierContextAll<'input>> {
		Rc::new(
			BaseParserRuleContext::new_parser_ctx(parent, invoking_state,ComparisonQuantifierContextExt{
				ph:PhantomData
			}),
		)
	}
}

pub trait ComparisonQuantifierContextAttrs<'input>: athenasqlParserContext<'input> + BorrowMut<ComparisonQuantifierContextExt<'input>>{

/// Retrieves first TerminalNode corresponding to token ALL
/// Returns `None` if there is no child corresponding to token ALL
fn ALL(&self) -> Option<Rc<TerminalNode<'input,athenasqlParserContextType>>> where Self:Sized{
	self.get_token(ALL, 0)
}
/// Retrieves first TerminalNode corresponding to token SOME
/// Returns `None` if there is no child corresponding to token SOME
fn SOME(&self) -> Option<Rc<TerminalNode<'input,athenasqlParserContextType>>> where Self:Sized{
	self.get_token(SOME, 0)
}
/// Retrieves first TerminalNode corresponding to token ANY
/// Returns `None` if there is no child corresponding to token ANY
fn ANY(&self) -> Option<Rc<TerminalNode<'input,athenasqlParserContextType>>> where Self:Sized{
	self.get_token(ANY, 0)
}

}

impl<'input> ComparisonQuantifierContextAttrs<'input> for ComparisonQuantifierContext<'input>{}

impl<'input, I, H> athenasqlParser<'input, I, H>
where
    I: TokenStream<'input, TF = LocalTokenFactory<'input> > + TidAble<'input>,
    H: ErrorStrategy<'input,BaseParserType<'input,I>>
{
	pub fn comparisonQuantifier(&mut self,)
	-> Result<Rc<ComparisonQuantifierContextAll<'input>>,ANTLRError> {
		let mut recog = self;
		let _parentctx = recog.ctx.take();
		let mut _localctx = ComparisonQuantifierContextExt::new(_parentctx.clone(), recog.base.get_state());
        recog.base.enter_rule(_localctx.clone(), 82, RULE_comparisonQuantifier);
        let mut _localctx: Rc<ComparisonQuantifierContextAll> = _localctx;
		let mut _la: isize = -1;
		let result: Result<(), ANTLRError> = (|| {

			//recog.base.enter_outer_alt(_localctx.clone(), 1);
			recog.base.enter_outer_alt(None, 1);
			{
			recog.base.set_state(1207);
			_la = recog.base.input.la(1);
			if { !((((_la) & !0x3f) == 0 && ((1usize << _la) & ((1usize << ALL) | (1usize << SOME) | (1usize << ANY))) != 0)) } {
				recog.err_handler.recover_inline(&mut recog.base)?;

			}
			else {
				if  recog.base.input.la(1)==TOKEN_EOF { recog.base.matched_eof = true };
				recog.err_handler.report_match(&mut recog.base);
				recog.base.consume(&mut recog.err_handler);
			}
			}
			Ok(())
		})();
		match result {
		Ok(_)=>{},
        Err(e @ ANTLRError::FallThrough(_)) => return Err(e),
		Err(ref re) => {
				//_localctx.exception = re;
				recog.err_handler.report_error(&mut recog.base, re);
				recog.err_handler.recover(&mut recog.base, re)?;
			}
		}
		recog.base.exit_rule();

		Ok(_localctx)
	}
}
//------------------- booleanValue ----------------
pub type BooleanValueContextAll<'input> = BooleanValueContext<'input>;


pub type BooleanValueContext<'input> = BaseParserRuleContext<'input,BooleanValueContextExt<'input>>;

#[derive(Clone)]
pub struct BooleanValueContextExt<'input>{
ph:PhantomData<&'input str>
}

impl<'input> athenasqlParserContext<'input> for BooleanValueContext<'input>{}

impl<'input,'a> Listenable<dyn athenasqlListener<'input> + 'a> for BooleanValueContext<'input>{
		fn enter(&self,listener: &mut (dyn athenasqlListener<'input> + 'a)) {
			listener.enter_every_rule(self);
			listener.enter_booleanValue(self);
		}fn exit(&self,listener: &mut (dyn athenasqlListener<'input> + 'a)) {
			listener.exit_booleanValue(self);
			listener.exit_every_rule(self);
		}
}

impl<'input> CustomRuleContext<'input> for BooleanValueContextExt<'input>{
	type TF = LocalTokenFactory<'input>;
	type Ctx = athenasqlParserContextType;
	fn get_rule_index(&self) -> usize { RULE_booleanValue }
	//fn type_rule_index() -> usize where Self: Sized { RULE_booleanValue }
}
antlr_rust::tid!{BooleanValueContextExt<'a>}

impl<'input> BooleanValueContextExt<'input>{
	fn new(parent: Option<Rc<dyn athenasqlParserContext<'input> + 'input > >, invoking_state: isize) -> Rc<BooleanValueContextAll<'input>> {
		Rc::new(
			BaseParserRuleContext::new_parser_ctx(parent, invoking_state,BooleanValueContextExt{
				ph:PhantomData
			}),
		)
	}
}

pub trait BooleanValueContextAttrs<'input>: athenasqlParserContext<'input> + BorrowMut<BooleanValueContextExt<'input>>{

/// Retrieves first TerminalNode corresponding to token TRUE
/// Returns `None` if there is no child corresponding to token TRUE
fn TRUE(&self) -> Option<Rc<TerminalNode<'input,athenasqlParserContextType>>> where Self:Sized{
	self.get_token(TRUE, 0)
}
/// Retrieves first TerminalNode corresponding to token FALSE
/// Returns `None` if there is no child corresponding to token FALSE
fn FALSE(&self) -> Option<Rc<TerminalNode<'input,athenasqlParserContextType>>> where Self:Sized{
	self.get_token(FALSE, 0)
}

}

impl<'input> BooleanValueContextAttrs<'input> for BooleanValueContext<'input>{}

impl<'input, I, H> athenasqlParser<'input, I, H>
where
    I: TokenStream<'input, TF = LocalTokenFactory<'input> > + TidAble<'input>,
    H: ErrorStrategy<'input,BaseParserType<'input,I>>
{
	pub fn booleanValue(&mut self,)
	-> Result<Rc<BooleanValueContextAll<'input>>,ANTLRError> {
		let mut recog = self;
		let _parentctx = recog.ctx.take();
		let mut _localctx = BooleanValueContextExt::new(_parentctx.clone(), recog.base.get_state());
        recog.base.enter_rule(_localctx.clone(), 84, RULE_booleanValue);
        let mut _localctx: Rc<BooleanValueContextAll> = _localctx;
		let mut _la: isize = -1;
		let result: Result<(), ANTLRError> = (|| {

			//recog.base.enter_outer_alt(_localctx.clone(), 1);
			recog.base.enter_outer_alt(None, 1);
			{
			recog.base.set_state(1209);
			_la = recog.base.input.la(1);
			if { !(_la==TRUE || _la==FALSE) } {
				recog.err_handler.recover_inline(&mut recog.base)?;

			}
			else {
				if  recog.base.input.la(1)==TOKEN_EOF { recog.base.matched_eof = true };
				recog.err_handler.report_match(&mut recog.base);
				recog.base.consume(&mut recog.err_handler);
			}
			}
			Ok(())
		})();
		match result {
		Ok(_)=>{},
        Err(e @ ANTLRError::FallThrough(_)) => return Err(e),
		Err(ref re) => {
				//_localctx.exception = re;
				recog.err_handler.report_error(&mut recog.base, re);
				recog.err_handler.recover(&mut recog.base, re)?;
			}
		}
		recog.base.exit_rule();

		Ok(_localctx)
	}
}
//------------------- interval ----------------
pub type IntervalContextAll<'input> = IntervalContext<'input>;


pub type IntervalContext<'input> = BaseParserRuleContext<'input,IntervalContextExt<'input>>;

#[derive(Clone)]
pub struct IntervalContextExt<'input>{
	pub sign: Option<TokenType<'input>>,
	pub from: Option<Rc<IntervalFieldContextAll<'input>>>,
	pub to: Option<Rc<IntervalFieldContextAll<'input>>>,
ph:PhantomData<&'input str>
}

impl<'input> athenasqlParserContext<'input> for IntervalContext<'input>{}

impl<'input,'a> Listenable<dyn athenasqlListener<'input> + 'a> for IntervalContext<'input>{
		fn enter(&self,listener: &mut (dyn athenasqlListener<'input> + 'a)) {
			listener.enter_every_rule(self);
			listener.enter_interval(self);
		}fn exit(&self,listener: &mut (dyn athenasqlListener<'input> + 'a)) {
			listener.exit_interval(self);
			listener.exit_every_rule(self);
		}
}

impl<'input> CustomRuleContext<'input> for IntervalContextExt<'input>{
	type TF = LocalTokenFactory<'input>;
	type Ctx = athenasqlParserContextType;
	fn get_rule_index(&self) -> usize { RULE_interval }
	//fn type_rule_index() -> usize where Self: Sized { RULE_interval }
}
antlr_rust::tid!{IntervalContextExt<'a>}

impl<'input> IntervalContextExt<'input>{
	fn new(parent: Option<Rc<dyn athenasqlParserContext<'input> + 'input > >, invoking_state: isize) -> Rc<IntervalContextAll<'input>> {
		Rc::new(
			BaseParserRuleContext::new_parser_ctx(parent, invoking_state,IntervalContextExt{
				sign: None, 
				from: None, to: None, 
				ph:PhantomData
			}),
		)
	}
}

pub trait IntervalContextAttrs<'input>: athenasqlParserContext<'input> + BorrowMut<IntervalContextExt<'input>>{

/// Retrieves first TerminalNode corresponding to token INTERVAL
/// Returns `None` if there is no child corresponding to token INTERVAL
fn INTERVAL(&self) -> Option<Rc<TerminalNode<'input,athenasqlParserContextType>>> where Self:Sized{
	self.get_token(INTERVAL, 0)
}
/// Retrieves first TerminalNode corresponding to token STRING
/// Returns `None` if there is no child corresponding to token STRING
fn STRING(&self) -> Option<Rc<TerminalNode<'input,athenasqlParserContextType>>> where Self:Sized{
	self.get_token(STRING, 0)
}
fn intervalField_all(&self) ->  Vec<Rc<IntervalFieldContextAll<'input>>> where Self:Sized{
	self.children_of_type()
}
fn intervalField(&self, i: usize) -> Option<Rc<IntervalFieldContextAll<'input>>> where Self:Sized{
	self.child_of_type(i)
}
/// Retrieves first TerminalNode corresponding to token TO
/// Returns `None` if there is no child corresponding to token TO
fn TO(&self) -> Option<Rc<TerminalNode<'input,athenasqlParserContextType>>> where Self:Sized{
	self.get_token(TO, 0)
}
/// Retrieves first TerminalNode corresponding to token PLUS
/// Returns `None` if there is no child corresponding to token PLUS
fn PLUS(&self) -> Option<Rc<TerminalNode<'input,athenasqlParserContextType>>> where Self:Sized{
	self.get_token(PLUS, 0)
}
/// Retrieves first TerminalNode corresponding to token MINUS
/// Returns `None` if there is no child corresponding to token MINUS
fn MINUS(&self) -> Option<Rc<TerminalNode<'input,athenasqlParserContextType>>> where Self:Sized{
	self.get_token(MINUS, 0)
}

}

impl<'input> IntervalContextAttrs<'input> for IntervalContext<'input>{}

impl<'input, I, H> athenasqlParser<'input, I, H>
where
    I: TokenStream<'input, TF = LocalTokenFactory<'input> > + TidAble<'input>,
    H: ErrorStrategy<'input,BaseParserType<'input,I>>
{
	pub fn interval(&mut self,)
	-> Result<Rc<IntervalContextAll<'input>>,ANTLRError> {
		let mut recog = self;
		let _parentctx = recog.ctx.take();
		let mut _localctx = IntervalContextExt::new(_parentctx.clone(), recog.base.get_state());
        recog.base.enter_rule(_localctx.clone(), 86, RULE_interval);
        let mut _localctx: Rc<IntervalContextAll> = _localctx;
		let mut _la: isize = -1;
		let result: Result<(), ANTLRError> = (|| {

			//recog.base.enter_outer_alt(_localctx.clone(), 1);
			recog.base.enter_outer_alt(None, 1);
			{
			recog.base.set_state(1211);
			recog.base.match_token(INTERVAL,&mut recog.err_handler)?;

			recog.base.set_state(1213);
			recog.err_handler.sync(&mut recog.base)?;
			_la = recog.base.input.la(1);
			if _la==PLUS || _la==MINUS {
				{
				recog.base.set_state(1212);
				 cast_mut::<_,IntervalContext >(&mut _localctx).sign = recog.base.input.lt(1).cloned();
				 
				_la = recog.base.input.la(1);
				if { !(_la==PLUS || _la==MINUS) } {
					let tmp = recog.err_handler.recover_inline(&mut recog.base)?;
					 cast_mut::<_,IntervalContext >(&mut _localctx).sign = Some(tmp.clone());
					  

				}
				else {
					if  recog.base.input.la(1)==TOKEN_EOF { recog.base.matched_eof = true };
					recog.err_handler.report_match(&mut recog.base);
					recog.base.consume(&mut recog.err_handler);
				}
				}
			}

			recog.base.set_state(1215);
			recog.base.match_token(STRING,&mut recog.err_handler)?;

			/*InvokeRule intervalField*/
			recog.base.set_state(1216);
			let tmp = recog.intervalField()?;
			 cast_mut::<_,IntervalContext >(&mut _localctx).from = Some(tmp.clone());
			  

			recog.base.set_state(1219);
			recog.err_handler.sync(&mut recog.base)?;
			match  recog.interpreter.adaptive_predict(148,&mut recog.base)? {
				x if x == 1=>{
					{
					recog.base.set_state(1217);
					recog.base.match_token(TO,&mut recog.err_handler)?;

					/*InvokeRule intervalField*/
					recog.base.set_state(1218);
					let tmp = recog.intervalField()?;
					 cast_mut::<_,IntervalContext >(&mut _localctx).to = Some(tmp.clone());
					  

					}
				}

				_ => {}
			}
			}
			Ok(())
		})();
		match result {
		Ok(_)=>{},
        Err(e @ ANTLRError::FallThrough(_)) => return Err(e),
		Err(ref re) => {
				//_localctx.exception = re;
				recog.err_handler.report_error(&mut recog.base, re);
				recog.err_handler.recover(&mut recog.base, re)?;
			}
		}
		recog.base.exit_rule();

		Ok(_localctx)
	}
}
//------------------- intervalField ----------------
pub type IntervalFieldContextAll<'input> = IntervalFieldContext<'input>;


pub type IntervalFieldContext<'input> = BaseParserRuleContext<'input,IntervalFieldContextExt<'input>>;

#[derive(Clone)]
pub struct IntervalFieldContextExt<'input>{
ph:PhantomData<&'input str>
}

impl<'input> athenasqlParserContext<'input> for IntervalFieldContext<'input>{}

impl<'input,'a> Listenable<dyn athenasqlListener<'input> + 'a> for IntervalFieldContext<'input>{
		fn enter(&self,listener: &mut (dyn athenasqlListener<'input> + 'a)) {
			listener.enter_every_rule(self);
			listener.enter_intervalField(self);
		}fn exit(&self,listener: &mut (dyn athenasqlListener<'input> + 'a)) {
			listener.exit_intervalField(self);
			listener.exit_every_rule(self);
		}
}

impl<'input> CustomRuleContext<'input> for IntervalFieldContextExt<'input>{
	type TF = LocalTokenFactory<'input>;
	type Ctx = athenasqlParserContextType;
	fn get_rule_index(&self) -> usize { RULE_intervalField }
	//fn type_rule_index() -> usize where Self: Sized { RULE_intervalField }
}
antlr_rust::tid!{IntervalFieldContextExt<'a>}

impl<'input> IntervalFieldContextExt<'input>{
	fn new(parent: Option<Rc<dyn athenasqlParserContext<'input> + 'input > >, invoking_state: isize) -> Rc<IntervalFieldContextAll<'input>> {
		Rc::new(
			BaseParserRuleContext::new_parser_ctx(parent, invoking_state,IntervalFieldContextExt{
				ph:PhantomData
			}),
		)
	}
}

pub trait IntervalFieldContextAttrs<'input>: athenasqlParserContext<'input> + BorrowMut<IntervalFieldContextExt<'input>>{

/// Retrieves first TerminalNode corresponding to token YEAR
/// Returns `None` if there is no child corresponding to token YEAR
fn YEAR(&self) -> Option<Rc<TerminalNode<'input,athenasqlParserContextType>>> where Self:Sized{
	self.get_token(YEAR, 0)
}
/// Retrieves first TerminalNode corresponding to token MONTH
/// Returns `None` if there is no child corresponding to token MONTH
fn MONTH(&self) -> Option<Rc<TerminalNode<'input,athenasqlParserContextType>>> where Self:Sized{
	self.get_token(MONTH, 0)
}
/// Retrieves first TerminalNode corresponding to token DAY
/// Returns `None` if there is no child corresponding to token DAY
fn DAY(&self) -> Option<Rc<TerminalNode<'input,athenasqlParserContextType>>> where Self:Sized{
	self.get_token(DAY, 0)
}
/// Retrieves first TerminalNode corresponding to token HOUR
/// Returns `None` if there is no child corresponding to token HOUR
fn HOUR(&self) -> Option<Rc<TerminalNode<'input,athenasqlParserContextType>>> where Self:Sized{
	self.get_token(HOUR, 0)
}
/// Retrieves first TerminalNode corresponding to token MINUTE
/// Returns `None` if there is no child corresponding to token MINUTE
fn MINUTE(&self) -> Option<Rc<TerminalNode<'input,athenasqlParserContextType>>> where Self:Sized{
	self.get_token(MINUTE, 0)
}
/// Retrieves first TerminalNode corresponding to token SECOND
/// Returns `None` if there is no child corresponding to token SECOND
fn SECOND(&self) -> Option<Rc<TerminalNode<'input,athenasqlParserContextType>>> where Self:Sized{
	self.get_token(SECOND, 0)
}

}

impl<'input> IntervalFieldContextAttrs<'input> for IntervalFieldContext<'input>{}

impl<'input, I, H> athenasqlParser<'input, I, H>
where
    I: TokenStream<'input, TF = LocalTokenFactory<'input> > + TidAble<'input>,
    H: ErrorStrategy<'input,BaseParserType<'input,I>>
{
	pub fn intervalField(&mut self,)
	-> Result<Rc<IntervalFieldContextAll<'input>>,ANTLRError> {
		let mut recog = self;
		let _parentctx = recog.ctx.take();
		let mut _localctx = IntervalFieldContextExt::new(_parentctx.clone(), recog.base.get_state());
        recog.base.enter_rule(_localctx.clone(), 88, RULE_intervalField);
        let mut _localctx: Rc<IntervalFieldContextAll> = _localctx;
		let mut _la: isize = -1;
		let result: Result<(), ANTLRError> = (|| {

			//recog.base.enter_outer_alt(_localctx.clone(), 1);
			recog.base.enter_outer_alt(None, 1);
			{
			recog.base.set_state(1221);
			_la = recog.base.input.la(1);
			if { !(((((_la - 57)) & !0x3f) == 0 && ((1usize << (_la - 57)) & ((1usize << (YEAR - 57)) | (1usize << (MONTH - 57)) | (1usize << (DAY - 57)) | (1usize << (HOUR - 57)) | (1usize << (MINUTE - 57)) | (1usize << (SECOND - 57)))) != 0)) } {
				recog.err_handler.recover_inline(&mut recog.base)?;

			}
			else {
				if  recog.base.input.la(1)==TOKEN_EOF { recog.base.matched_eof = true };
				recog.err_handler.report_match(&mut recog.base);
				recog.base.consume(&mut recog.err_handler);
			}
			}
			Ok(())
		})();
		match result {
		Ok(_)=>{},
        Err(e @ ANTLRError::FallThrough(_)) => return Err(e),
		Err(ref re) => {
				//_localctx.exception = re;
				recog.err_handler.report_error(&mut recog.base, re);
				recog.err_handler.recover(&mut recog.base, re)?;
			}
		}
		recog.base.exit_rule();

		Ok(_localctx)
	}
}
//------------------- type ----------------
pub type TypeContextAll<'input> = TypeContext<'input>;


pub type TypeContext<'input> = BaseParserRuleContext<'input,TypeContextExt<'input>>;

#[derive(Clone)]
pub struct TypeContextExt<'input>{
ph:PhantomData<&'input str>
}

impl<'input> athenasqlParserContext<'input> for TypeContext<'input>{}

impl<'input,'a> Listenable<dyn athenasqlListener<'input> + 'a> for TypeContext<'input>{
		fn enter(&self,listener: &mut (dyn athenasqlListener<'input> + 'a)) {
			listener.enter_every_rule(self);
			listener.enter_type(self);
		}fn exit(&self,listener: &mut (dyn athenasqlListener<'input> + 'a)) {
			listener.exit_type(self);
			listener.exit_every_rule(self);
		}
}

impl<'input> CustomRuleContext<'input> for TypeContextExt<'input>{
	type TF = LocalTokenFactory<'input>;
	type Ctx = athenasqlParserContextType;
	fn get_rule_index(&self) -> usize { RULE_type }
	//fn type_rule_index() -> usize where Self: Sized { RULE_type }
}
antlr_rust::tid!{TypeContextExt<'a>}

impl<'input> TypeContextExt<'input>{
	fn new(parent: Option<Rc<dyn athenasqlParserContext<'input> + 'input > >, invoking_state: isize) -> Rc<TypeContextAll<'input>> {
		Rc::new(
			BaseParserRuleContext::new_parser_ctx(parent, invoking_state,TypeContextExt{
				ph:PhantomData
			}),
		)
	}
}

pub trait TypeContextAttrs<'input>: athenasqlParserContext<'input> + BorrowMut<TypeContextExt<'input>>{

/// Retrieves first TerminalNode corresponding to token ARRAY
/// Returns `None` if there is no child corresponding to token ARRAY
fn ARRAY(&self) -> Option<Rc<TerminalNode<'input,athenasqlParserContextType>>> where Self:Sized{
	self.get_token(ARRAY, 0)
}
/// Retrieves first TerminalNode corresponding to token LT
/// Returns `None` if there is no child corresponding to token LT
fn LT(&self) -> Option<Rc<TerminalNode<'input,athenasqlParserContextType>>> where Self:Sized{
	self.get_token(LT, 0)
}
fn type_all(&self) ->  Vec<Rc<TypeContextAll<'input>>> where Self:Sized{
	self.children_of_type()
}
fn type(&self, i: usize) -> Option<Rc<TypeContextAll<'input>>> where Self:Sized{
	self.child_of_type(i)
}
/// Retrieves first TerminalNode corresponding to token GT
/// Returns `None` if there is no child corresponding to token GT
fn GT(&self) -> Option<Rc<TerminalNode<'input,athenasqlParserContextType>>> where Self:Sized{
	self.get_token(GT, 0)
}
/// Retrieves first TerminalNode corresponding to token MAP
/// Returns `None` if there is no child corresponding to token MAP
fn MAP(&self) -> Option<Rc<TerminalNode<'input,athenasqlParserContextType>>> where Self:Sized{
	self.get_token(MAP, 0)
}
/// Retrieves first TerminalNode corresponding to token ROW
/// Returns `None` if there is no child corresponding to token ROW
fn ROW(&self) -> Option<Rc<TerminalNode<'input,athenasqlParserContextType>>> where Self:Sized{
	self.get_token(ROW, 0)
}
fn identifier_all(&self) ->  Vec<Rc<IdentifierContextAll<'input>>> where Self:Sized{
	self.children_of_type()
}
fn identifier(&self, i: usize) -> Option<Rc<IdentifierContextAll<'input>>> where Self:Sized{
	self.child_of_type(i)
}
fn baseType(&self) -> Option<Rc<BaseTypeContextAll<'input>>> where Self:Sized{
	self.child_of_type(0)
}
fn typeParameter_all(&self) ->  Vec<Rc<TypeParameterContextAll<'input>>> where Self:Sized{
	self.children_of_type()
}
fn typeParameter(&self, i: usize) -> Option<Rc<TypeParameterContextAll<'input>>> where Self:Sized{
	self.child_of_type(i)
}

}

impl<'input> TypeContextAttrs<'input> for TypeContext<'input>{}

impl<'input, I, H> athenasqlParser<'input, I, H>
where
    I: TokenStream<'input, TF = LocalTokenFactory<'input> > + TidAble<'input>,
    H: ErrorStrategy<'input,BaseParserType<'input,I>>
{
	pub fn  type(&mut self,)
	-> Result<Rc<TypeContextAll<'input>>,ANTLRError> {
		self.type_rec(0)
	}

	fn type_rec(&mut self, _p: isize)
	-> Result<Rc<TypeContextAll<'input>>,ANTLRError> {
		let recog = self;
		let _parentctx = recog.ctx.take();
		let _parentState = recog.base.get_state();
		let mut _localctx = TypeContextExt::new(_parentctx.clone(), recog.base.get_state());
		recog.base.enter_recursion_rule(_localctx.clone(), 90, RULE_type, _p);
	    let mut _localctx: Rc<TypeContextAll> = _localctx;
        let mut _prevctx = _localctx.clone();
		let _startState = 90;
		let mut _la: isize = -1;
		let result: Result<(), ANTLRError> = (|| {
			let mut _alt: isize;
			//recog.base.enter_outer_alt(_localctx.clone(), 1);
			recog.base.enter_outer_alt(None, 1);
			{
			recog.base.set_state(1265);
			recog.err_handler.sync(&mut recog.base)?;
			match  recog.interpreter.adaptive_predict(152,&mut recog.base)? {
				1 =>{
					{
					recog.base.set_state(1224);
					recog.base.match_token(ARRAY,&mut recog.err_handler)?;

					recog.base.set_state(1225);
					recog.base.match_token(LT,&mut recog.err_handler)?;

					/*InvokeRule type*/
					recog.base.set_state(1226);
					recog.type_rec(0)?;

					recog.base.set_state(1227);
					recog.base.match_token(GT,&mut recog.err_handler)?;

					}
				}
			,
				2 =>{
					{
					recog.base.set_state(1229);
					recog.base.match_token(MAP,&mut recog.err_handler)?;

					recog.base.set_state(1230);
					recog.base.match_token(LT,&mut recog.err_handler)?;

					/*InvokeRule type*/
					recog.base.set_state(1231);
					recog.type_rec(0)?;

					recog.base.set_state(1232);
					recog.base.match_token(T__2,&mut recog.err_handler)?;

					/*InvokeRule type*/
					recog.base.set_state(1233);
					recog.type_rec(0)?;

					recog.base.set_state(1234);
					recog.base.match_token(GT,&mut recog.err_handler)?;

					}
				}
			,
				3 =>{
					{
					recog.base.set_state(1236);
					recog.base.match_token(ROW,&mut recog.err_handler)?;

					recog.base.set_state(1237);
					recog.base.match_token(T__1,&mut recog.err_handler)?;

					/*InvokeRule identifier*/
					recog.base.set_state(1238);
					recog.identifier()?;

					/*InvokeRule type*/
					recog.base.set_state(1239);
					recog.type_rec(0)?;

					recog.base.set_state(1246);
					recog.err_handler.sync(&mut recog.base)?;
					_la = recog.base.input.la(1);
					while _la==T__2 {
						{
						{
						recog.base.set_state(1240);
						recog.base.match_token(T__2,&mut recog.err_handler)?;

						/*InvokeRule identifier*/
						recog.base.set_state(1241);
						recog.identifier()?;

						/*InvokeRule type*/
						recog.base.set_state(1242);
						recog.type_rec(0)?;

						}
						}
						recog.base.set_state(1248);
						recog.err_handler.sync(&mut recog.base)?;
						_la = recog.base.input.la(1);
					}
					recog.base.set_state(1249);
					recog.base.match_token(T__3,&mut recog.err_handler)?;

					}
				}
			,
				4 =>{
					{
					/*InvokeRule baseType*/
					recog.base.set_state(1251);
					recog.baseType()?;

					recog.base.set_state(1263);
					recog.err_handler.sync(&mut recog.base)?;
					match  recog.interpreter.adaptive_predict(151,&mut recog.base)? {
						x if x == 1=>{
							{
							recog.base.set_state(1252);
							recog.base.match_token(T__1,&mut recog.err_handler)?;

							/*InvokeRule typeParameter*/
							recog.base.set_state(1253);
							recog.typeParameter()?;

							recog.base.set_state(1258);
							recog.err_handler.sync(&mut recog.base)?;
							_la = recog.base.input.la(1);
							while _la==T__2 {
								{
								{
								recog.base.set_state(1254);
								recog.base.match_token(T__2,&mut recog.err_handler)?;

								/*InvokeRule typeParameter*/
								recog.base.set_state(1255);
								recog.typeParameter()?;

								}
								}
								recog.base.set_state(1260);
								recog.err_handler.sync(&mut recog.base)?;
								_la = recog.base.input.la(1);
							}
							recog.base.set_state(1261);
							recog.base.match_token(T__3,&mut recog.err_handler)?;

							}
						}

						_ => {}
					}
					}
				}

				_ => {}
			}

			let tmp = recog.input.lt(-1).cloned();
			recog.ctx.as_ref().unwrap().set_stop(tmp);
			recog.base.set_state(1271);
			recog.err_handler.sync(&mut recog.base)?;
			_alt = recog.interpreter.adaptive_predict(153,&mut recog.base)?;
			while { _alt!=2 && _alt!=INVALID_ALT } {
				if _alt==1 {
					recog.trigger_exit_rule_event();
					_prevctx = _localctx.clone();
					{
					{
					/*recRuleAltStartAction*/
					let mut tmp = TypeContextExt::new(_parentctx.clone(), _parentState);
					recog.push_new_recursion_context(tmp.clone(), _startState, RULE_type);
					_localctx = tmp;
					recog.base.set_state(1267);
					if !({recog.precpred(None, 5)}) {
						Err(FailedPredicateError::new(&mut recog.base, Some("recog.precpred(None, 5)".to_owned()), None))?;
					}
					recog.base.set_state(1268);
					recog.base.match_token(ARRAY,&mut recog.err_handler)?;

					}
					} 
				}
				recog.base.set_state(1273);
				recog.err_handler.sync(&mut recog.base)?;
				_alt = recog.interpreter.adaptive_predict(153,&mut recog.base)?;
			}
			}
			Ok(())
		})();
		match result {
		Ok(_) => {},
        Err(e @ ANTLRError::FallThrough(_)) => return Err(e),
		Err(ref re)=>{
			//_localctx.exception = re;
			recog.err_handler.report_error(&mut recog.base, re);
	        recog.err_handler.recover(&mut recog.base, re)?;}
		}
		recog.base.unroll_recursion_context(_parentctx);

		Ok(_localctx)
	}
}
//------------------- typeParameter ----------------
pub type TypeParameterContextAll<'input> = TypeParameterContext<'input>;


pub type TypeParameterContext<'input> = BaseParserRuleContext<'input,TypeParameterContextExt<'input>>;

#[derive(Clone)]
pub struct TypeParameterContextExt<'input>{
ph:PhantomData<&'input str>
}

impl<'input> athenasqlParserContext<'input> for TypeParameterContext<'input>{}

impl<'input,'a> Listenable<dyn athenasqlListener<'input> + 'a> for TypeParameterContext<'input>{
		fn enter(&self,listener: &mut (dyn athenasqlListener<'input> + 'a)) {
			listener.enter_every_rule(self);
			listener.enter_typeParameter(self);
		}fn exit(&self,listener: &mut (dyn athenasqlListener<'input> + 'a)) {
			listener.exit_typeParameter(self);
			listener.exit_every_rule(self);
		}
}

impl<'input> CustomRuleContext<'input> for TypeParameterContextExt<'input>{
	type TF = LocalTokenFactory<'input>;
	type Ctx = athenasqlParserContextType;
	fn get_rule_index(&self) -> usize { RULE_typeParameter }
	//fn type_rule_index() -> usize where Self: Sized { RULE_typeParameter }
}
antlr_rust::tid!{TypeParameterContextExt<'a>}

impl<'input> TypeParameterContextExt<'input>{
	fn new(parent: Option<Rc<dyn athenasqlParserContext<'input> + 'input > >, invoking_state: isize) -> Rc<TypeParameterContextAll<'input>> {
		Rc::new(
			BaseParserRuleContext::new_parser_ctx(parent, invoking_state,TypeParameterContextExt{
				ph:PhantomData
			}),
		)
	}
}

pub trait TypeParameterContextAttrs<'input>: athenasqlParserContext<'input> + BorrowMut<TypeParameterContextExt<'input>>{

/// Retrieves first TerminalNode corresponding to token INTEGER_VALUE
/// Returns `None` if there is no child corresponding to token INTEGER_VALUE
fn INTEGER_VALUE(&self) -> Option<Rc<TerminalNode<'input,athenasqlParserContextType>>> where Self:Sized{
	self.get_token(INTEGER_VALUE, 0)
}
fn type(&self) -> Option<Rc<TypeContextAll<'input>>> where Self:Sized{
	self.child_of_type(0)
}

}

impl<'input> TypeParameterContextAttrs<'input> for TypeParameterContext<'input>{}

impl<'input, I, H> athenasqlParser<'input, I, H>
where
    I: TokenStream<'input, TF = LocalTokenFactory<'input> > + TidAble<'input>,
    H: ErrorStrategy<'input,BaseParserType<'input,I>>
{
	pub fn typeParameter(&mut self,)
	-> Result<Rc<TypeParameterContextAll<'input>>,ANTLRError> {
		let mut recog = self;
		let _parentctx = recog.ctx.take();
		let mut _localctx = TypeParameterContextExt::new(_parentctx.clone(), recog.base.get_state());
        recog.base.enter_rule(_localctx.clone(), 92, RULE_typeParameter);
        let mut _localctx: Rc<TypeParameterContextAll> = _localctx;
		let result: Result<(), ANTLRError> = (|| {

			recog.base.set_state(1276);
			recog.err_handler.sync(&mut recog.base)?;
			match recog.base.input.la(1) {
			 INTEGER_VALUE 
				=> {
					//recog.base.enter_outer_alt(_localctx.clone(), 1);
					recog.base.enter_outer_alt(None, 1);
					{
					recog.base.set_state(1274);
					recog.base.match_token(INTEGER_VALUE,&mut recog.err_handler)?;

					}
				}

			 ADD | ALL | SOME | ANY | AT | NO | SUBSTRING | POSITION | TINYINT | SMALLINT |
			 INTEGER | DATE | TIME | TIMESTAMP | INTERVAL | YEAR | MONTH | DAY | HOUR |
			 MINUTE | SECOND | ZONE | FILTER | OVER | PARTITION | RANGE | ROWS | PRECEDING |
			 FOLLOWING | CURRENT | ROW | SCHEMA | COMMENT | VIEW | REPLACE | GRANT |
			 REVOKE | PRIVILEGES | PUBLIC | OPTION | EXPLAIN | ANALYZE | FORMAT |
			 TYPE | TEXT | GRAPHVIZ | LOGICAL | DISTRIBUTED | VALIDATE | SHOW | TABLES |
			 SCHEMAS | CATALOGS | COLUMNS | COLUMN | USE | PARTITIONS | FUNCTIONS |
			 TO | SYSTEM | BERNOULLI | POISSONIZED | TABLESAMPLE | ARRAY | MAP | SET |
			 RESET | SESSION | DATA | START | TRANSACTION | COMMIT | ROLLBACK | WORK |
			 ISOLATION | LEVEL | SERIALIZABLE | REPEATABLE | COMMITTED | UNCOMMITTED |
			 READ | WRITE | ONLY | CALL | INPUT | OUTPUT | CASCADE | RESTRICT | INCLUDING |
			 EXCLUDING | PROPERTIES | NFD | NFC | NFKD | NFKC | IF | NULLIF | COALESCE |
			 IDENTIFIER | DIGIT_IDENTIFIER | QUOTED_IDENTIFIER | BACKQUOTED_IDENTIFIER |
			 TIME_WITH_TIME_ZONE | TIMESTAMP_WITH_TIME_ZONE | DOUBLE_PRECISION 
				=> {
					//recog.base.enter_outer_alt(_localctx.clone(), 2);
					recog.base.enter_outer_alt(None, 2);
					{
					/*InvokeRule type*/
					recog.base.set_state(1275);
					recog.type_rec(0)?;

					}
				}

				_ => Err(ANTLRError::NoAltError(NoViableAltError::new(&mut recog.base)))?
			}
			Ok(())
		})();
		match result {
		Ok(_)=>{},
        Err(e @ ANTLRError::FallThrough(_)) => return Err(e),
		Err(ref re) => {
				//_localctx.exception = re;
				recog.err_handler.report_error(&mut recog.base, re);
				recog.err_handler.recover(&mut recog.base, re)?;
			}
		}
		recog.base.exit_rule();

		Ok(_localctx)
	}
}
//------------------- baseType ----------------
pub type BaseTypeContextAll<'input> = BaseTypeContext<'input>;


pub type BaseTypeContext<'input> = BaseParserRuleContext<'input,BaseTypeContextExt<'input>>;

#[derive(Clone)]
pub struct BaseTypeContextExt<'input>{
ph:PhantomData<&'input str>
}

impl<'input> athenasqlParserContext<'input> for BaseTypeContext<'input>{}

impl<'input,'a> Listenable<dyn athenasqlListener<'input> + 'a> for BaseTypeContext<'input>{
		fn enter(&self,listener: &mut (dyn athenasqlListener<'input> + 'a)) {
			listener.enter_every_rule(self);
			listener.enter_baseType(self);
		}fn exit(&self,listener: &mut (dyn athenasqlListener<'input> + 'a)) {
			listener.exit_baseType(self);
			listener.exit_every_rule(self);
		}
}

impl<'input> CustomRuleContext<'input> for BaseTypeContextExt<'input>{
	type TF = LocalTokenFactory<'input>;
	type Ctx = athenasqlParserContextType;
	fn get_rule_index(&self) -> usize { RULE_baseType }
	//fn type_rule_index() -> usize where Self: Sized { RULE_baseType }
}
antlr_rust::tid!{BaseTypeContextExt<'a>}

impl<'input> BaseTypeContextExt<'input>{
	fn new(parent: Option<Rc<dyn athenasqlParserContext<'input> + 'input > >, invoking_state: isize) -> Rc<BaseTypeContextAll<'input>> {
		Rc::new(
			BaseParserRuleContext::new_parser_ctx(parent, invoking_state,BaseTypeContextExt{
				ph:PhantomData
			}),
		)
	}
}

pub trait BaseTypeContextAttrs<'input>: athenasqlParserContext<'input> + BorrowMut<BaseTypeContextExt<'input>>{

/// Retrieves first TerminalNode corresponding to token TIME_WITH_TIME_ZONE
/// Returns `None` if there is no child corresponding to token TIME_WITH_TIME_ZONE
fn TIME_WITH_TIME_ZONE(&self) -> Option<Rc<TerminalNode<'input,athenasqlParserContextType>>> where Self:Sized{
	self.get_token(TIME_WITH_TIME_ZONE, 0)
}
/// Retrieves first TerminalNode corresponding to token TIMESTAMP_WITH_TIME_ZONE
/// Returns `None` if there is no child corresponding to token TIMESTAMP_WITH_TIME_ZONE
fn TIMESTAMP_WITH_TIME_ZONE(&self) -> Option<Rc<TerminalNode<'input,athenasqlParserContextType>>> where Self:Sized{
	self.get_token(TIMESTAMP_WITH_TIME_ZONE, 0)
}
/// Retrieves first TerminalNode corresponding to token DOUBLE_PRECISION
/// Returns `None` if there is no child corresponding to token DOUBLE_PRECISION
fn DOUBLE_PRECISION(&self) -> Option<Rc<TerminalNode<'input,athenasqlParserContextType>>> where Self:Sized{
	self.get_token(DOUBLE_PRECISION, 0)
}
fn identifier(&self) -> Option<Rc<IdentifierContextAll<'input>>> where Self:Sized{
	self.child_of_type(0)
}

}

impl<'input> BaseTypeContextAttrs<'input> for BaseTypeContext<'input>{}

impl<'input, I, H> athenasqlParser<'input, I, H>
where
    I: TokenStream<'input, TF = LocalTokenFactory<'input> > + TidAble<'input>,
    H: ErrorStrategy<'input,BaseParserType<'input,I>>
{
	pub fn baseType(&mut self,)
	-> Result<Rc<BaseTypeContextAll<'input>>,ANTLRError> {
		let mut recog = self;
		let _parentctx = recog.ctx.take();
		let mut _localctx = BaseTypeContextExt::new(_parentctx.clone(), recog.base.get_state());
        recog.base.enter_rule(_localctx.clone(), 94, RULE_baseType);
        let mut _localctx: Rc<BaseTypeContextAll> = _localctx;
		let result: Result<(), ANTLRError> = (|| {

			recog.base.set_state(1282);
			recog.err_handler.sync(&mut recog.base)?;
			match recog.base.input.la(1) {
			 TIME_WITH_TIME_ZONE 
				=> {
					//recog.base.enter_outer_alt(_localctx.clone(), 1);
					recog.base.enter_outer_alt(None, 1);
					{
					recog.base.set_state(1278);
					recog.base.match_token(TIME_WITH_TIME_ZONE,&mut recog.err_handler)?;

					}
				}

			 TIMESTAMP_WITH_TIME_ZONE 
				=> {
					//recog.base.enter_outer_alt(_localctx.clone(), 2);
					recog.base.enter_outer_alt(None, 2);
					{
					recog.base.set_state(1279);
					recog.base.match_token(TIMESTAMP_WITH_TIME_ZONE,&mut recog.err_handler)?;

					}
				}

			 DOUBLE_PRECISION 
				=> {
					//recog.base.enter_outer_alt(_localctx.clone(), 3);
					recog.base.enter_outer_alt(None, 3);
					{
					recog.base.set_state(1280);
					recog.base.match_token(DOUBLE_PRECISION,&mut recog.err_handler)?;

					}
				}

			 ADD | ALL | SOME | ANY | AT | NO | SUBSTRING | POSITION | TINYINT | SMALLINT |
			 INTEGER | DATE | TIME | TIMESTAMP | INTERVAL | YEAR | MONTH | DAY | HOUR |
			 MINUTE | SECOND | ZONE | FILTER | OVER | PARTITION | RANGE | ROWS | PRECEDING |
			 FOLLOWING | CURRENT | ROW | SCHEMA | COMMENT | VIEW | REPLACE | GRANT |
			 REVOKE | PRIVILEGES | PUBLIC | OPTION | EXPLAIN | ANALYZE | FORMAT |
			 TYPE | TEXT | GRAPHVIZ | LOGICAL | DISTRIBUTED | VALIDATE | SHOW | TABLES |
			 SCHEMAS | CATALOGS | COLUMNS | COLUMN | USE | PARTITIONS | FUNCTIONS |
			 TO | SYSTEM | BERNOULLI | POISSONIZED | TABLESAMPLE | ARRAY | MAP | SET |
			 RESET | SESSION | DATA | START | TRANSACTION | COMMIT | ROLLBACK | WORK |
			 ISOLATION | LEVEL | SERIALIZABLE | REPEATABLE | COMMITTED | UNCOMMITTED |
			 READ | WRITE | ONLY | CALL | INPUT | OUTPUT | CASCADE | RESTRICT | INCLUDING |
			 EXCLUDING | PROPERTIES | NFD | NFC | NFKD | NFKC | IF | NULLIF | COALESCE |
			 IDENTIFIER | DIGIT_IDENTIFIER | QUOTED_IDENTIFIER | BACKQUOTED_IDENTIFIER 
				=> {
					//recog.base.enter_outer_alt(_localctx.clone(), 4);
					recog.base.enter_outer_alt(None, 4);
					{
					/*InvokeRule identifier*/
					recog.base.set_state(1281);
					recog.identifier()?;

					}
				}

				_ => Err(ANTLRError::NoAltError(NoViableAltError::new(&mut recog.base)))?
			}
			Ok(())
		})();
		match result {
		Ok(_)=>{},
        Err(e @ ANTLRError::FallThrough(_)) => return Err(e),
		Err(ref re) => {
				//_localctx.exception = re;
				recog.err_handler.report_error(&mut recog.base, re);
				recog.err_handler.recover(&mut recog.base, re)?;
			}
		}
		recog.base.exit_rule();

		Ok(_localctx)
	}
}
//------------------- whenClause ----------------
pub type WhenClauseContextAll<'input> = WhenClauseContext<'input>;


pub type WhenClauseContext<'input> = BaseParserRuleContext<'input,WhenClauseContextExt<'input>>;

#[derive(Clone)]
pub struct WhenClauseContextExt<'input>{
	pub condition: Option<Rc<ExpressionContextAll<'input>>>,
	pub result: Option<Rc<ExpressionContextAll<'input>>>,
ph:PhantomData<&'input str>
}

impl<'input> athenasqlParserContext<'input> for WhenClauseContext<'input>{}

impl<'input,'a> Listenable<dyn athenasqlListener<'input> + 'a> for WhenClauseContext<'input>{
		fn enter(&self,listener: &mut (dyn athenasqlListener<'input> + 'a)) {
			listener.enter_every_rule(self);
			listener.enter_whenClause(self);
		}fn exit(&self,listener: &mut (dyn athenasqlListener<'input> + 'a)) {
			listener.exit_whenClause(self);
			listener.exit_every_rule(self);
		}
}

impl<'input> CustomRuleContext<'input> for WhenClauseContextExt<'input>{
	type TF = LocalTokenFactory<'input>;
	type Ctx = athenasqlParserContextType;
	fn get_rule_index(&self) -> usize { RULE_whenClause }
	//fn type_rule_index() -> usize where Self: Sized { RULE_whenClause }
}
antlr_rust::tid!{WhenClauseContextExt<'a>}

impl<'input> WhenClauseContextExt<'input>{
	fn new(parent: Option<Rc<dyn athenasqlParserContext<'input> + 'input > >, invoking_state: isize) -> Rc<WhenClauseContextAll<'input>> {
		Rc::new(
			BaseParserRuleContext::new_parser_ctx(parent, invoking_state,WhenClauseContextExt{
				condition: None, result: None, 
				ph:PhantomData
			}),
		)
	}
}

pub trait WhenClauseContextAttrs<'input>: athenasqlParserContext<'input> + BorrowMut<WhenClauseContextExt<'input>>{

/// Retrieves first TerminalNode corresponding to token WHEN
/// Returns `None` if there is no child corresponding to token WHEN
fn WHEN(&self) -> Option<Rc<TerminalNode<'input,athenasqlParserContextType>>> where Self:Sized{
	self.get_token(WHEN, 0)
}
/// Retrieves first TerminalNode corresponding to token THEN
/// Returns `None` if there is no child corresponding to token THEN
fn THEN(&self) -> Option<Rc<TerminalNode<'input,athenasqlParserContextType>>> where Self:Sized{
	self.get_token(THEN, 0)
}
fn expression_all(&self) ->  Vec<Rc<ExpressionContextAll<'input>>> where Self:Sized{
	self.children_of_type()
}
fn expression(&self, i: usize) -> Option<Rc<ExpressionContextAll<'input>>> where Self:Sized{
	self.child_of_type(i)
}

}

impl<'input> WhenClauseContextAttrs<'input> for WhenClauseContext<'input>{}

impl<'input, I, H> athenasqlParser<'input, I, H>
where
    I: TokenStream<'input, TF = LocalTokenFactory<'input> > + TidAble<'input>,
    H: ErrorStrategy<'input,BaseParserType<'input,I>>
{
	pub fn whenClause(&mut self,)
	-> Result<Rc<WhenClauseContextAll<'input>>,ANTLRError> {
		let mut recog = self;
		let _parentctx = recog.ctx.take();
		let mut _localctx = WhenClauseContextExt::new(_parentctx.clone(), recog.base.get_state());
        recog.base.enter_rule(_localctx.clone(), 96, RULE_whenClause);
        let mut _localctx: Rc<WhenClauseContextAll> = _localctx;
		let result: Result<(), ANTLRError> = (|| {

			//recog.base.enter_outer_alt(_localctx.clone(), 1);
			recog.base.enter_outer_alt(None, 1);
			{
			recog.base.set_state(1284);
			recog.base.match_token(WHEN,&mut recog.err_handler)?;

			/*InvokeRule expression*/
			recog.base.set_state(1285);
			let tmp = recog.expression()?;
			 cast_mut::<_,WhenClauseContext >(&mut _localctx).condition = Some(tmp.clone());
			  

			recog.base.set_state(1286);
			recog.base.match_token(THEN,&mut recog.err_handler)?;

			/*InvokeRule expression*/
			recog.base.set_state(1287);
			let tmp = recog.expression()?;
			 cast_mut::<_,WhenClauseContext >(&mut _localctx).result = Some(tmp.clone());
			  

			}
			Ok(())
		})();
		match result {
		Ok(_)=>{},
        Err(e @ ANTLRError::FallThrough(_)) => return Err(e),
		Err(ref re) => {
				//_localctx.exception = re;
				recog.err_handler.report_error(&mut recog.base, re);
				recog.err_handler.recover(&mut recog.base, re)?;
			}
		}
		recog.base.exit_rule();

		Ok(_localctx)
	}
}
//------------------- filter ----------------
pub type FilterContextAll<'input> = FilterContext<'input>;


pub type FilterContext<'input> = BaseParserRuleContext<'input,FilterContextExt<'input>>;

#[derive(Clone)]
pub struct FilterContextExt<'input>{
ph:PhantomData<&'input str>
}

impl<'input> athenasqlParserContext<'input> for FilterContext<'input>{}

impl<'input,'a> Listenable<dyn athenasqlListener<'input> + 'a> for FilterContext<'input>{
		fn enter(&self,listener: &mut (dyn athenasqlListener<'input> + 'a)) {
			listener.enter_every_rule(self);
			listener.enter_filter(self);
		}fn exit(&self,listener: &mut (dyn athenasqlListener<'input> + 'a)) {
			listener.exit_filter(self);
			listener.exit_every_rule(self);
		}
}

impl<'input> CustomRuleContext<'input> for FilterContextExt<'input>{
	type TF = LocalTokenFactory<'input>;
	type Ctx = athenasqlParserContextType;
	fn get_rule_index(&self) -> usize { RULE_filter }
	//fn type_rule_index() -> usize where Self: Sized { RULE_filter }
}
antlr_rust::tid!{FilterContextExt<'a>}

impl<'input> FilterContextExt<'input>{
	fn new(parent: Option<Rc<dyn athenasqlParserContext<'input> + 'input > >, invoking_state: isize) -> Rc<FilterContextAll<'input>> {
		Rc::new(
			BaseParserRuleContext::new_parser_ctx(parent, invoking_state,FilterContextExt{
				ph:PhantomData
			}),
		)
	}
}

pub trait FilterContextAttrs<'input>: athenasqlParserContext<'input> + BorrowMut<FilterContextExt<'input>>{

/// Retrieves first TerminalNode corresponding to token FILTER
/// Returns `None` if there is no child corresponding to token FILTER
fn FILTER(&self) -> Option<Rc<TerminalNode<'input,athenasqlParserContextType>>> where Self:Sized{
	self.get_token(FILTER, 0)
}
/// Retrieves first TerminalNode corresponding to token WHERE
/// Returns `None` if there is no child corresponding to token WHERE
fn WHERE(&self) -> Option<Rc<TerminalNode<'input,athenasqlParserContextType>>> where Self:Sized{
	self.get_token(WHERE, 0)
}
fn booleanExpression(&self) -> Option<Rc<BooleanExpressionContextAll<'input>>> where Self:Sized{
	self.child_of_type(0)
}

}

impl<'input> FilterContextAttrs<'input> for FilterContext<'input>{}

impl<'input, I, H> athenasqlParser<'input, I, H>
where
    I: TokenStream<'input, TF = LocalTokenFactory<'input> > + TidAble<'input>,
    H: ErrorStrategy<'input,BaseParserType<'input,I>>
{
	pub fn filter(&mut self,)
	-> Result<Rc<FilterContextAll<'input>>,ANTLRError> {
		let mut recog = self;
		let _parentctx = recog.ctx.take();
		let mut _localctx = FilterContextExt::new(_parentctx.clone(), recog.base.get_state());
        recog.base.enter_rule(_localctx.clone(), 98, RULE_filter);
        let mut _localctx: Rc<FilterContextAll> = _localctx;
		let result: Result<(), ANTLRError> = (|| {

			//recog.base.enter_outer_alt(_localctx.clone(), 1);
			recog.base.enter_outer_alt(None, 1);
			{
			recog.base.set_state(1289);
			recog.base.match_token(FILTER,&mut recog.err_handler)?;

			recog.base.set_state(1290);
			recog.base.match_token(T__1,&mut recog.err_handler)?;

			recog.base.set_state(1291);
			recog.base.match_token(WHERE,&mut recog.err_handler)?;

			/*InvokeRule booleanExpression*/
			recog.base.set_state(1292);
			recog.booleanExpression_rec(0)?;

			recog.base.set_state(1293);
			recog.base.match_token(T__3,&mut recog.err_handler)?;

			}
			Ok(())
		})();
		match result {
		Ok(_)=>{},
        Err(e @ ANTLRError::FallThrough(_)) => return Err(e),
		Err(ref re) => {
				//_localctx.exception = re;
				recog.err_handler.report_error(&mut recog.base, re);
				recog.err_handler.recover(&mut recog.base, re)?;
			}
		}
		recog.base.exit_rule();

		Ok(_localctx)
	}
}
//------------------- over ----------------
pub type OverContextAll<'input> = OverContext<'input>;


pub type OverContext<'input> = BaseParserRuleContext<'input,OverContextExt<'input>>;

#[derive(Clone)]
pub struct OverContextExt<'input>{
	pub expression: Option<Rc<ExpressionContextAll<'input>>>,
	pub partition:Vec<Rc<ExpressionContextAll<'input>>>,
ph:PhantomData<&'input str>
}

impl<'input> athenasqlParserContext<'input> for OverContext<'input>{}

impl<'input,'a> Listenable<dyn athenasqlListener<'input> + 'a> for OverContext<'input>{
		fn enter(&self,listener: &mut (dyn athenasqlListener<'input> + 'a)) {
			listener.enter_every_rule(self);
			listener.enter_over(self);
		}fn exit(&self,listener: &mut (dyn athenasqlListener<'input> + 'a)) {
			listener.exit_over(self);
			listener.exit_every_rule(self);
		}
}

impl<'input> CustomRuleContext<'input> for OverContextExt<'input>{
	type TF = LocalTokenFactory<'input>;
	type Ctx = athenasqlParserContextType;
	fn get_rule_index(&self) -> usize { RULE_over }
	//fn type_rule_index() -> usize where Self: Sized { RULE_over }
}
antlr_rust::tid!{OverContextExt<'a>}

impl<'input> OverContextExt<'input>{
	fn new(parent: Option<Rc<dyn athenasqlParserContext<'input> + 'input > >, invoking_state: isize) -> Rc<OverContextAll<'input>> {
		Rc::new(
			BaseParserRuleContext::new_parser_ctx(parent, invoking_state,OverContextExt{
				expression: None, 
				partition: Vec::new(), 
				ph:PhantomData
			}),
		)
	}
}

pub trait OverContextAttrs<'input>: athenasqlParserContext<'input> + BorrowMut<OverContextExt<'input>>{

/// Retrieves first TerminalNode corresponding to token OVER
/// Returns `None` if there is no child corresponding to token OVER
fn OVER(&self) -> Option<Rc<TerminalNode<'input,athenasqlParserContextType>>> where Self:Sized{
	self.get_token(OVER, 0)
}
/// Retrieves first TerminalNode corresponding to token PARTITION
/// Returns `None` if there is no child corresponding to token PARTITION
fn PARTITION(&self) -> Option<Rc<TerminalNode<'input,athenasqlParserContextType>>> where Self:Sized{
	self.get_token(PARTITION, 0)
}
/// Retrieves all `TerminalNode`s corresponding to token BY in current rule
fn BY_all(&self) -> Vec<Rc<TerminalNode<'input,athenasqlParserContextType>>>  where Self:Sized{
	self.children_of_type()
}
/// Retrieves 'i's TerminalNode corresponding to token BY, starting from 0.
/// Returns `None` if number of children corresponding to token BY is less or equal than `i`.
fn BY(&self, i: usize) -> Option<Rc<TerminalNode<'input,athenasqlParserContextType>>> where Self:Sized{
	self.get_token(BY, i)
}
/// Retrieves first TerminalNode corresponding to token ORDER
/// Returns `None` if there is no child corresponding to token ORDER
fn ORDER(&self) -> Option<Rc<TerminalNode<'input,athenasqlParserContextType>>> where Self:Sized{
	self.get_token(ORDER, 0)
}
fn sortItem_all(&self) ->  Vec<Rc<SortItemContextAll<'input>>> where Self:Sized{
	self.children_of_type()
}
fn sortItem(&self, i: usize) -> Option<Rc<SortItemContextAll<'input>>> where Self:Sized{
	self.child_of_type(i)
}
fn windowFrame(&self) -> Option<Rc<WindowFrameContextAll<'input>>> where Self:Sized{
	self.child_of_type(0)
}
fn expression_all(&self) ->  Vec<Rc<ExpressionContextAll<'input>>> where Self:Sized{
	self.children_of_type()
}
fn expression(&self, i: usize) -> Option<Rc<ExpressionContextAll<'input>>> where Self:Sized{
	self.child_of_type(i)
}

}

impl<'input> OverContextAttrs<'input> for OverContext<'input>{}

impl<'input, I, H> athenasqlParser<'input, I, H>
where
    I: TokenStream<'input, TF = LocalTokenFactory<'input> > + TidAble<'input>,
    H: ErrorStrategy<'input,BaseParserType<'input,I>>
{
	pub fn over(&mut self,)
	-> Result<Rc<OverContextAll<'input>>,ANTLRError> {
		let mut recog = self;
		let _parentctx = recog.ctx.take();
		let mut _localctx = OverContextExt::new(_parentctx.clone(), recog.base.get_state());
        recog.base.enter_rule(_localctx.clone(), 100, RULE_over);
        let mut _localctx: Rc<OverContextAll> = _localctx;
		let mut _la: isize = -1;
		let result: Result<(), ANTLRError> = (|| {

			//recog.base.enter_outer_alt(_localctx.clone(), 1);
			recog.base.enter_outer_alt(None, 1);
			{
			recog.base.set_state(1295);
			recog.base.match_token(OVER,&mut recog.err_handler)?;

			recog.base.set_state(1296);
			recog.base.match_token(T__1,&mut recog.err_handler)?;

			recog.base.set_state(1307);
			recog.err_handler.sync(&mut recog.base)?;
			_la = recog.base.input.la(1);
			if _la==PARTITION {
				{
				recog.base.set_state(1297);
				recog.base.match_token(PARTITION,&mut recog.err_handler)?;

				recog.base.set_state(1298);
				recog.base.match_token(BY,&mut recog.err_handler)?;

				/*InvokeRule expression*/
				recog.base.set_state(1299);
				let tmp = recog.expression()?;
				 cast_mut::<_,OverContext >(&mut _localctx).expression = Some(tmp.clone());
				  

				let temp =  cast_mut::<_,OverContext >(&mut _localctx).expression.clone().unwrap()
				 ;
				 cast_mut::<_,OverContext >(&mut _localctx).partition.push(temp);
				  
				recog.base.set_state(1304);
				recog.err_handler.sync(&mut recog.base)?;
				_la = recog.base.input.la(1);
				while _la==T__2 {
					{
					{
					recog.base.set_state(1300);
					recog.base.match_token(T__2,&mut recog.err_handler)?;

					/*InvokeRule expression*/
					recog.base.set_state(1301);
					let tmp = recog.expression()?;
					 cast_mut::<_,OverContext >(&mut _localctx).expression = Some(tmp.clone());
					  

					let temp =  cast_mut::<_,OverContext >(&mut _localctx).expression.clone().unwrap()
					 ;
					 cast_mut::<_,OverContext >(&mut _localctx).partition.push(temp);
					  
					}
					}
					recog.base.set_state(1306);
					recog.err_handler.sync(&mut recog.base)?;
					_la = recog.base.input.la(1);
				}
				}
			}

			recog.base.set_state(1319);
			recog.err_handler.sync(&mut recog.base)?;
			_la = recog.base.input.la(1);
			if _la==ORDER {
				{
				recog.base.set_state(1309);
				recog.base.match_token(ORDER,&mut recog.err_handler)?;

				recog.base.set_state(1310);
				recog.base.match_token(BY,&mut recog.err_handler)?;

				/*InvokeRule sortItem*/
				recog.base.set_state(1311);
				recog.sortItem()?;

				recog.base.set_state(1316);
				recog.err_handler.sync(&mut recog.base)?;
				_la = recog.base.input.la(1);
				while _la==T__2 {
					{
					{
					recog.base.set_state(1312);
					recog.base.match_token(T__2,&mut recog.err_handler)?;

					/*InvokeRule sortItem*/
					recog.base.set_state(1313);
					recog.sortItem()?;

					}
					}
					recog.base.set_state(1318);
					recog.err_handler.sync(&mut recog.base)?;
					_la = recog.base.input.la(1);
				}
				}
			}

			recog.base.set_state(1322);
			recog.err_handler.sync(&mut recog.base)?;
			_la = recog.base.input.la(1);
			if _la==RANGE || _la==ROWS {
				{
				/*InvokeRule windowFrame*/
				recog.base.set_state(1321);
				recog.windowFrame()?;

				}
			}

			recog.base.set_state(1324);
			recog.base.match_token(T__3,&mut recog.err_handler)?;

			}
			Ok(())
		})();
		match result {
		Ok(_)=>{},
        Err(e @ ANTLRError::FallThrough(_)) => return Err(e),
		Err(ref re) => {
				//_localctx.exception = re;
				recog.err_handler.report_error(&mut recog.base, re);
				recog.err_handler.recover(&mut recog.base, re)?;
			}
		}
		recog.base.exit_rule();

		Ok(_localctx)
	}
}
//------------------- windowFrame ----------------
pub type WindowFrameContextAll<'input> = WindowFrameContext<'input>;


pub type WindowFrameContext<'input> = BaseParserRuleContext<'input,WindowFrameContextExt<'input>>;

#[derive(Clone)]
pub struct WindowFrameContextExt<'input>{
	pub frameType: Option<TokenType<'input>>,
	pub start: Option<Rc<FrameBoundContextAll<'input>>>,
	pub end: Option<Rc<FrameBoundContextAll<'input>>>,
ph:PhantomData<&'input str>
}

impl<'input> athenasqlParserContext<'input> for WindowFrameContext<'input>{}

impl<'input,'a> Listenable<dyn athenasqlListener<'input> + 'a> for WindowFrameContext<'input>{
		fn enter(&self,listener: &mut (dyn athenasqlListener<'input> + 'a)) {
			listener.enter_every_rule(self);
			listener.enter_windowFrame(self);
		}fn exit(&self,listener: &mut (dyn athenasqlListener<'input> + 'a)) {
			listener.exit_windowFrame(self);
			listener.exit_every_rule(self);
		}
}

impl<'input> CustomRuleContext<'input> for WindowFrameContextExt<'input>{
	type TF = LocalTokenFactory<'input>;
	type Ctx = athenasqlParserContextType;
	fn get_rule_index(&self) -> usize { RULE_windowFrame }
	//fn type_rule_index() -> usize where Self: Sized { RULE_windowFrame }
}
antlr_rust::tid!{WindowFrameContextExt<'a>}

impl<'input> WindowFrameContextExt<'input>{
	fn new(parent: Option<Rc<dyn athenasqlParserContext<'input> + 'input > >, invoking_state: isize) -> Rc<WindowFrameContextAll<'input>> {
		Rc::new(
			BaseParserRuleContext::new_parser_ctx(parent, invoking_state,WindowFrameContextExt{
				frameType: None, 
				start: None, end: None, 
				ph:PhantomData
			}),
		)
	}
}

pub trait WindowFrameContextAttrs<'input>: athenasqlParserContext<'input> + BorrowMut<WindowFrameContextExt<'input>>{

/// Retrieves first TerminalNode corresponding to token RANGE
/// Returns `None` if there is no child corresponding to token RANGE
fn RANGE(&self) -> Option<Rc<TerminalNode<'input,athenasqlParserContextType>>> where Self:Sized{
	self.get_token(RANGE, 0)
}
fn frameBound_all(&self) ->  Vec<Rc<FrameBoundContextAll<'input>>> where Self:Sized{
	self.children_of_type()
}
fn frameBound(&self, i: usize) -> Option<Rc<FrameBoundContextAll<'input>>> where Self:Sized{
	self.child_of_type(i)
}
/// Retrieves first TerminalNode corresponding to token ROWS
/// Returns `None` if there is no child corresponding to token ROWS
fn ROWS(&self) -> Option<Rc<TerminalNode<'input,athenasqlParserContextType>>> where Self:Sized{
	self.get_token(ROWS, 0)
}
/// Retrieves first TerminalNode corresponding to token BETWEEN
/// Returns `None` if there is no child corresponding to token BETWEEN
fn BETWEEN(&self) -> Option<Rc<TerminalNode<'input,athenasqlParserContextType>>> where Self:Sized{
	self.get_token(BETWEEN, 0)
}
/// Retrieves first TerminalNode corresponding to token AND
/// Returns `None` if there is no child corresponding to token AND
fn AND(&self) -> Option<Rc<TerminalNode<'input,athenasqlParserContextType>>> where Self:Sized{
	self.get_token(AND, 0)
}

}

impl<'input> WindowFrameContextAttrs<'input> for WindowFrameContext<'input>{}

impl<'input, I, H> athenasqlParser<'input, I, H>
where
    I: TokenStream<'input, TF = LocalTokenFactory<'input> > + TidAble<'input>,
    H: ErrorStrategy<'input,BaseParserType<'input,I>>
{
	pub fn windowFrame(&mut self,)
	-> Result<Rc<WindowFrameContextAll<'input>>,ANTLRError> {
		let mut recog = self;
		let _parentctx = recog.ctx.take();
		let mut _localctx = WindowFrameContextExt::new(_parentctx.clone(), recog.base.get_state());
        recog.base.enter_rule(_localctx.clone(), 102, RULE_windowFrame);
        let mut _localctx: Rc<WindowFrameContextAll> = _localctx;
		let result: Result<(), ANTLRError> = (|| {

			recog.base.set_state(1342);
			recog.err_handler.sync(&mut recog.base)?;
			match  recog.interpreter.adaptive_predict(161,&mut recog.base)? {
				1 =>{
					//recog.base.enter_outer_alt(_localctx.clone(), 1);
					recog.base.enter_outer_alt(None, 1);
					{
					recog.base.set_state(1326);
					let tmp = recog.base.match_token(RANGE,&mut recog.err_handler)?;
					 cast_mut::<_,WindowFrameContext >(&mut _localctx).frameType = Some(tmp.clone());
					  

					/*InvokeRule frameBound*/
					recog.base.set_state(1327);
					let tmp = recog.frameBound()?;
					 cast_mut::<_,WindowFrameContext >(&mut _localctx).start = Some(tmp.clone());
					  

					}
				}
			,
				2 =>{
					//recog.base.enter_outer_alt(_localctx.clone(), 2);
					recog.base.enter_outer_alt(None, 2);
					{
					recog.base.set_state(1328);
					let tmp = recog.base.match_token(ROWS,&mut recog.err_handler)?;
					 cast_mut::<_,WindowFrameContext >(&mut _localctx).frameType = Some(tmp.clone());
					  

					/*InvokeRule frameBound*/
					recog.base.set_state(1329);
					let tmp = recog.frameBound()?;
					 cast_mut::<_,WindowFrameContext >(&mut _localctx).start = Some(tmp.clone());
					  

					}
				}
			,
				3 =>{
					//recog.base.enter_outer_alt(_localctx.clone(), 3);
					recog.base.enter_outer_alt(None, 3);
					{
					recog.base.set_state(1330);
					let tmp = recog.base.match_token(RANGE,&mut recog.err_handler)?;
					 cast_mut::<_,WindowFrameContext >(&mut _localctx).frameType = Some(tmp.clone());
					  

					recog.base.set_state(1331);
					recog.base.match_token(BETWEEN,&mut recog.err_handler)?;

					/*InvokeRule frameBound*/
					recog.base.set_state(1332);
					let tmp = recog.frameBound()?;
					 cast_mut::<_,WindowFrameContext >(&mut _localctx).start = Some(tmp.clone());
					  

					recog.base.set_state(1333);
					recog.base.match_token(AND,&mut recog.err_handler)?;

					/*InvokeRule frameBound*/
					recog.base.set_state(1334);
					let tmp = recog.frameBound()?;
					 cast_mut::<_,WindowFrameContext >(&mut _localctx).end = Some(tmp.clone());
					  

					}
				}
			,
				4 =>{
					//recog.base.enter_outer_alt(_localctx.clone(), 4);
					recog.base.enter_outer_alt(None, 4);
					{
					recog.base.set_state(1336);
					let tmp = recog.base.match_token(ROWS,&mut recog.err_handler)?;
					 cast_mut::<_,WindowFrameContext >(&mut _localctx).frameType = Some(tmp.clone());
					  

					recog.base.set_state(1337);
					recog.base.match_token(BETWEEN,&mut recog.err_handler)?;

					/*InvokeRule frameBound*/
					recog.base.set_state(1338);
					let tmp = recog.frameBound()?;
					 cast_mut::<_,WindowFrameContext >(&mut _localctx).start = Some(tmp.clone());
					  

					recog.base.set_state(1339);
					recog.base.match_token(AND,&mut recog.err_handler)?;

					/*InvokeRule frameBound*/
					recog.base.set_state(1340);
					let tmp = recog.frameBound()?;
					 cast_mut::<_,WindowFrameContext >(&mut _localctx).end = Some(tmp.clone());
					  

					}
				}

				_ => {}
			}
			Ok(())
		})();
		match result {
		Ok(_)=>{},
        Err(e @ ANTLRError::FallThrough(_)) => return Err(e),
		Err(ref re) => {
				//_localctx.exception = re;
				recog.err_handler.report_error(&mut recog.base, re);
				recog.err_handler.recover(&mut recog.base, re)?;
			}
		}
		recog.base.exit_rule();

		Ok(_localctx)
	}
}
//------------------- frameBound ----------------
#[derive(Debug)]
pub enum FrameBoundContextAll<'input>{
	BoundedFrameContext(BoundedFrameContext<'input>),
	UnboundedFrameContext(UnboundedFrameContext<'input>),
	CurrentRowBoundContext(CurrentRowBoundContext<'input>),
Error(FrameBoundContext<'input>)
}
antlr_rust::tid!{FrameBoundContextAll<'a>}

impl<'input> antlr_rust::parser_rule_context::DerefSeal for FrameBoundContextAll<'input>{}

impl<'input> athenasqlParserContext<'input> for FrameBoundContextAll<'input>{}

impl<'input> Deref for FrameBoundContextAll<'input>{
	type Target = dyn FrameBoundContextAttrs<'input> + 'input;
	fn deref(&self) -> &Self::Target{
		use FrameBoundContextAll::*;
		match self{
			BoundedFrameContext(inner) => inner,
			UnboundedFrameContext(inner) => inner,
			CurrentRowBoundContext(inner) => inner,
Error(inner) => inner
		}
	}
}
impl<'input,'a> Listenable<dyn athenasqlListener<'input> + 'a> for FrameBoundContextAll<'input>{
    fn enter(&self, listener: &mut (dyn athenasqlListener<'input> + 'a)) { self.deref().enter(listener) }
    fn exit(&self, listener: &mut (dyn athenasqlListener<'input> + 'a)) { self.deref().exit(listener) }
}



pub type FrameBoundContext<'input> = BaseParserRuleContext<'input,FrameBoundContextExt<'input>>;

#[derive(Clone)]
pub struct FrameBoundContextExt<'input>{
ph:PhantomData<&'input str>
}

impl<'input> athenasqlParserContext<'input> for FrameBoundContext<'input>{}

impl<'input,'a> Listenable<dyn athenasqlListener<'input> + 'a> for FrameBoundContext<'input>{
}

impl<'input> CustomRuleContext<'input> for FrameBoundContextExt<'input>{
	type TF = LocalTokenFactory<'input>;
	type Ctx = athenasqlParserContextType;
	fn get_rule_index(&self) -> usize { RULE_frameBound }
	//fn type_rule_index() -> usize where Self: Sized { RULE_frameBound }
}
antlr_rust::tid!{FrameBoundContextExt<'a>}

impl<'input> FrameBoundContextExt<'input>{
	fn new(parent: Option<Rc<dyn athenasqlParserContext<'input> + 'input > >, invoking_state: isize) -> Rc<FrameBoundContextAll<'input>> {
		Rc::new(
		FrameBoundContextAll::Error(
			BaseParserRuleContext::new_parser_ctx(parent, invoking_state,FrameBoundContextExt{
				ph:PhantomData
			}),
		)
		)
	}
}

pub trait FrameBoundContextAttrs<'input>: athenasqlParserContext<'input> + BorrowMut<FrameBoundContextExt<'input>>{


}

impl<'input> FrameBoundContextAttrs<'input> for FrameBoundContext<'input>{}

pub type BoundedFrameContext<'input> = BaseParserRuleContext<'input,BoundedFrameContextExt<'input>>;

pub trait BoundedFrameContextAttrs<'input>: athenasqlParserContext<'input>{
	fn expression(&self) -> Option<Rc<ExpressionContextAll<'input>>> where Self:Sized{
		self.child_of_type(0)
	}
	/// Retrieves first TerminalNode corresponding to token PRECEDING
	/// Returns `None` if there is no child corresponding to token PRECEDING
	fn PRECEDING(&self) -> Option<Rc<TerminalNode<'input,athenasqlParserContextType>>> where Self:Sized{
		self.get_token(PRECEDING, 0)
	}
	/// Retrieves first TerminalNode corresponding to token FOLLOWING
	/// Returns `None` if there is no child corresponding to token FOLLOWING
	fn FOLLOWING(&self) -> Option<Rc<TerminalNode<'input,athenasqlParserContextType>>> where Self:Sized{
		self.get_token(FOLLOWING, 0)
	}
}

impl<'input> BoundedFrameContextAttrs<'input> for BoundedFrameContext<'input>{}

pub struct BoundedFrameContextExt<'input>{
	base:FrameBoundContextExt<'input>,
	pub boundType: Option<TokenType<'input>>,
	ph:PhantomData<&'input str>
}

antlr_rust::tid!{BoundedFrameContextExt<'a>}

impl<'input> athenasqlParserContext<'input> for BoundedFrameContext<'input>{}

impl<'input,'a> Listenable<dyn athenasqlListener<'input> + 'a> for BoundedFrameContext<'input>{
	fn enter(&self,listener: &mut (dyn athenasqlListener<'input> + 'a)) {
		listener.enter_every_rule(self);
		listener.enter_boundedFrame(self);
	}
}

impl<'input> CustomRuleContext<'input> for BoundedFrameContextExt<'input>{
	type TF = LocalTokenFactory<'input>;
	type Ctx = athenasqlParserContextType;
	fn get_rule_index(&self) -> usize { RULE_frameBound }
	//fn type_rule_index() -> usize where Self: Sized { RULE_frameBound }
}

impl<'input> Borrow<FrameBoundContextExt<'input>> for BoundedFrameContext<'input>{
	fn borrow(&self) -> &FrameBoundContextExt<'input> { &self.base }
}
impl<'input> BorrowMut<FrameBoundContextExt<'input>> for BoundedFrameContext<'input>{
	fn borrow_mut(&mut self) -> &mut FrameBoundContextExt<'input> { &mut self.base }
}

impl<'input> FrameBoundContextAttrs<'input> for BoundedFrameContext<'input> {}

impl<'input> BoundedFrameContextExt<'input>{
	fn new(ctx: &dyn FrameBoundContextAttrs<'input>) -> Rc<FrameBoundContextAll<'input>>  {
		Rc::new(
			FrameBoundContextAll::BoundedFrameContext(
				BaseParserRuleContext::copy_from(ctx,BoundedFrameContextExt{
					boundType:None, 
        			base: ctx.borrow().clone(),
        			ph:PhantomData
				})
			)
		)
	}
}

pub type UnboundedFrameContext<'input> = BaseParserRuleContext<'input,UnboundedFrameContextExt<'input>>;

pub trait UnboundedFrameContextAttrs<'input>: athenasqlParserContext<'input>{
	/// Retrieves first TerminalNode corresponding to token UNBOUNDED
	/// Returns `None` if there is no child corresponding to token UNBOUNDED
	fn UNBOUNDED(&self) -> Option<Rc<TerminalNode<'input,athenasqlParserContextType>>> where Self:Sized{
		self.get_token(UNBOUNDED, 0)
	}
	/// Retrieves first TerminalNode corresponding to token PRECEDING
	/// Returns `None` if there is no child corresponding to token PRECEDING
	fn PRECEDING(&self) -> Option<Rc<TerminalNode<'input,athenasqlParserContextType>>> where Self:Sized{
		self.get_token(PRECEDING, 0)
	}
	/// Retrieves first TerminalNode corresponding to token FOLLOWING
	/// Returns `None` if there is no child corresponding to token FOLLOWING
	fn FOLLOWING(&self) -> Option<Rc<TerminalNode<'input,athenasqlParserContextType>>> where Self:Sized{
		self.get_token(FOLLOWING, 0)
	}
}

impl<'input> UnboundedFrameContextAttrs<'input> for UnboundedFrameContext<'input>{}

pub struct UnboundedFrameContextExt<'input>{
	base:FrameBoundContextExt<'input>,
	pub boundType: Option<TokenType<'input>>,
	ph:PhantomData<&'input str>
}

antlr_rust::tid!{UnboundedFrameContextExt<'a>}

impl<'input> athenasqlParserContext<'input> for UnboundedFrameContext<'input>{}

impl<'input,'a> Listenable<dyn athenasqlListener<'input> + 'a> for UnboundedFrameContext<'input>{
	fn enter(&self,listener: &mut (dyn athenasqlListener<'input> + 'a)) {
		listener.enter_every_rule(self);
		listener.enter_unboundedFrame(self);
	}
}

impl<'input> CustomRuleContext<'input> for UnboundedFrameContextExt<'input>{
	type TF = LocalTokenFactory<'input>;
	type Ctx = athenasqlParserContextType;
	fn get_rule_index(&self) -> usize { RULE_frameBound }
	//fn type_rule_index() -> usize where Self: Sized { RULE_frameBound }
}

impl<'input> Borrow<FrameBoundContextExt<'input>> for UnboundedFrameContext<'input>{
	fn borrow(&self) -> &FrameBoundContextExt<'input> { &self.base }
}
impl<'input> BorrowMut<FrameBoundContextExt<'input>> for UnboundedFrameContext<'input>{
	fn borrow_mut(&mut self) -> &mut FrameBoundContextExt<'input> { &mut self.base }
}

impl<'input> FrameBoundContextAttrs<'input> for UnboundedFrameContext<'input> {}

impl<'input> UnboundedFrameContextExt<'input>{
	fn new(ctx: &dyn FrameBoundContextAttrs<'input>) -> Rc<FrameBoundContextAll<'input>>  {
		Rc::new(
			FrameBoundContextAll::UnboundedFrameContext(
				BaseParserRuleContext::copy_from(ctx,UnboundedFrameContextExt{
					boundType:None, 
        			base: ctx.borrow().clone(),
        			ph:PhantomData
				})
			)
		)
	}
}

pub type CurrentRowBoundContext<'input> = BaseParserRuleContext<'input,CurrentRowBoundContextExt<'input>>;

pub trait CurrentRowBoundContextAttrs<'input>: athenasqlParserContext<'input>{
	/// Retrieves first TerminalNode corresponding to token CURRENT
	/// Returns `None` if there is no child corresponding to token CURRENT
	fn CURRENT(&self) -> Option<Rc<TerminalNode<'input,athenasqlParserContextType>>> where Self:Sized{
		self.get_token(CURRENT, 0)
	}
	/// Retrieves first TerminalNode corresponding to token ROW
	/// Returns `None` if there is no child corresponding to token ROW
	fn ROW(&self) -> Option<Rc<TerminalNode<'input,athenasqlParserContextType>>> where Self:Sized{
		self.get_token(ROW, 0)
	}
}

impl<'input> CurrentRowBoundContextAttrs<'input> for CurrentRowBoundContext<'input>{}

pub struct CurrentRowBoundContextExt<'input>{
	base:FrameBoundContextExt<'input>,
	ph:PhantomData<&'input str>
}

antlr_rust::tid!{CurrentRowBoundContextExt<'a>}

impl<'input> athenasqlParserContext<'input> for CurrentRowBoundContext<'input>{}

impl<'input,'a> Listenable<dyn athenasqlListener<'input> + 'a> for CurrentRowBoundContext<'input>{
	fn enter(&self,listener: &mut (dyn athenasqlListener<'input> + 'a)) {
		listener.enter_every_rule(self);
		listener.enter_currentRowBound(self);
	}
}

impl<'input> CustomRuleContext<'input> for CurrentRowBoundContextExt<'input>{
	type TF = LocalTokenFactory<'input>;
	type Ctx = athenasqlParserContextType;
	fn get_rule_index(&self) -> usize { RULE_frameBound }
	//fn type_rule_index() -> usize where Self: Sized { RULE_frameBound }
}

impl<'input> Borrow<FrameBoundContextExt<'input>> for CurrentRowBoundContext<'input>{
	fn borrow(&self) -> &FrameBoundContextExt<'input> { &self.base }
}
impl<'input> BorrowMut<FrameBoundContextExt<'input>> for CurrentRowBoundContext<'input>{
	fn borrow_mut(&mut self) -> &mut FrameBoundContextExt<'input> { &mut self.base }
}

impl<'input> FrameBoundContextAttrs<'input> for CurrentRowBoundContext<'input> {}

impl<'input> CurrentRowBoundContextExt<'input>{
	fn new(ctx: &dyn FrameBoundContextAttrs<'input>) -> Rc<FrameBoundContextAll<'input>>  {
		Rc::new(
			FrameBoundContextAll::CurrentRowBoundContext(
				BaseParserRuleContext::copy_from(ctx,CurrentRowBoundContextExt{
        			base: ctx.borrow().clone(),
        			ph:PhantomData
				})
			)
		)
	}
}

impl<'input, I, H> athenasqlParser<'input, I, H>
where
    I: TokenStream<'input, TF = LocalTokenFactory<'input> > + TidAble<'input>,
    H: ErrorStrategy<'input,BaseParserType<'input,I>>
{
	pub fn frameBound(&mut self,)
	-> Result<Rc<FrameBoundContextAll<'input>>,ANTLRError> {
		let mut recog = self;
		let _parentctx = recog.ctx.take();
		let mut _localctx = FrameBoundContextExt::new(_parentctx.clone(), recog.base.get_state());
        recog.base.enter_rule(_localctx.clone(), 104, RULE_frameBound);
        let mut _localctx: Rc<FrameBoundContextAll> = _localctx;
		let mut _la: isize = -1;
		let result: Result<(), ANTLRError> = (|| {

			recog.base.set_state(1353);
			recog.err_handler.sync(&mut recog.base)?;
			match  recog.interpreter.adaptive_predict(162,&mut recog.base)? {
				1 =>{
					let tmp = UnboundedFrameContextExt::new(&**_localctx);
					recog.base.enter_outer_alt(Some(tmp.clone()), 1);
					_localctx = tmp;
					{
					recog.base.set_state(1344);
					recog.base.match_token(UNBOUNDED,&mut recog.err_handler)?;

					recog.base.set_state(1345);
					let tmp = recog.base.match_token(PRECEDING,&mut recog.err_handler)?;
					if let FrameBoundContextAll::UnboundedFrameContext(ctx) = cast_mut::<_,FrameBoundContextAll >(&mut _localctx){
					ctx.boundType = Some(tmp.clone()); } else {unreachable!("cant cast");}  

					}
				}
			,
				2 =>{
					let tmp = UnboundedFrameContextExt::new(&**_localctx);
					recog.base.enter_outer_alt(Some(tmp.clone()), 2);
					_localctx = tmp;
					{
					recog.base.set_state(1346);
					recog.base.match_token(UNBOUNDED,&mut recog.err_handler)?;

					recog.base.set_state(1347);
					let tmp = recog.base.match_token(FOLLOWING,&mut recog.err_handler)?;
					if let FrameBoundContextAll::UnboundedFrameContext(ctx) = cast_mut::<_,FrameBoundContextAll >(&mut _localctx){
					ctx.boundType = Some(tmp.clone()); } else {unreachable!("cant cast");}  

					}
				}
			,
				3 =>{
					let tmp = CurrentRowBoundContextExt::new(&**_localctx);
					recog.base.enter_outer_alt(Some(tmp.clone()), 3);
					_localctx = tmp;
					{
					recog.base.set_state(1348);
					recog.base.match_token(CURRENT,&mut recog.err_handler)?;

					recog.base.set_state(1349);
					recog.base.match_token(ROW,&mut recog.err_handler)?;

					}
				}
			,
				4 =>{
					let tmp = BoundedFrameContextExt::new(&**_localctx);
					recog.base.enter_outer_alt(Some(tmp.clone()), 4);
					_localctx = tmp;
					{
					/*InvokeRule expression*/
					recog.base.set_state(1350);
					recog.expression()?;

					recog.base.set_state(1351);
					if let FrameBoundContextAll::BoundedFrameContext(ctx) = cast_mut::<_,FrameBoundContextAll >(&mut _localctx){
					ctx.boundType = recog.base.input.lt(1).cloned(); } else {unreachable!("cant cast");} 
					_la = recog.base.input.la(1);
					if { !(_la==PRECEDING || _la==FOLLOWING) } {
						let tmp = recog.err_handler.recover_inline(&mut recog.base)?;
						if let FrameBoundContextAll::BoundedFrameContext(ctx) = cast_mut::<_,FrameBoundContextAll >(&mut _localctx){
						ctx.boundType = Some(tmp.clone()); } else {unreachable!("cant cast");}  

					}
					else {
						if  recog.base.input.la(1)==TOKEN_EOF { recog.base.matched_eof = true };
						recog.err_handler.report_match(&mut recog.base);
						recog.base.consume(&mut recog.err_handler);
					}
					}
				}

				_ => {}
			}
			Ok(())
		})();
		match result {
		Ok(_)=>{},
        Err(e @ ANTLRError::FallThrough(_)) => return Err(e),
		Err(ref re) => {
				//_localctx.exception = re;
				recog.err_handler.report_error(&mut recog.base, re);
				recog.err_handler.recover(&mut recog.base, re)?;
			}
		}
		recog.base.exit_rule();

		Ok(_localctx)
	}
}
//------------------- explainOption ----------------
#[derive(Debug)]
pub enum ExplainOptionContextAll<'input>{
	ExplainFormatContext(ExplainFormatContext<'input>),
	ExplainTypeContext(ExplainTypeContext<'input>),
Error(ExplainOptionContext<'input>)
}
antlr_rust::tid!{ExplainOptionContextAll<'a>}

impl<'input> antlr_rust::parser_rule_context::DerefSeal for ExplainOptionContextAll<'input>{}

impl<'input> athenasqlParserContext<'input> for ExplainOptionContextAll<'input>{}

impl<'input> Deref for ExplainOptionContextAll<'input>{
	type Target = dyn ExplainOptionContextAttrs<'input> + 'input;
	fn deref(&self) -> &Self::Target{
		use ExplainOptionContextAll::*;
		match self{
			ExplainFormatContext(inner) => inner,
			ExplainTypeContext(inner) => inner,
Error(inner) => inner
		}
	}
}
impl<'input,'a> Listenable<dyn athenasqlListener<'input> + 'a> for ExplainOptionContextAll<'input>{
    fn enter(&self, listener: &mut (dyn athenasqlListener<'input> + 'a)) { self.deref().enter(listener) }
    fn exit(&self, listener: &mut (dyn athenasqlListener<'input> + 'a)) { self.deref().exit(listener) }
}



pub type ExplainOptionContext<'input> = BaseParserRuleContext<'input,ExplainOptionContextExt<'input>>;

#[derive(Clone)]
pub struct ExplainOptionContextExt<'input>{
ph:PhantomData<&'input str>
}

impl<'input> athenasqlParserContext<'input> for ExplainOptionContext<'input>{}

impl<'input,'a> Listenable<dyn athenasqlListener<'input> + 'a> for ExplainOptionContext<'input>{
}

impl<'input> CustomRuleContext<'input> for ExplainOptionContextExt<'input>{
	type TF = LocalTokenFactory<'input>;
	type Ctx = athenasqlParserContextType;
	fn get_rule_index(&self) -> usize { RULE_explainOption }
	//fn type_rule_index() -> usize where Self: Sized { RULE_explainOption }
}
antlr_rust::tid!{ExplainOptionContextExt<'a>}

impl<'input> ExplainOptionContextExt<'input>{
	fn new(parent: Option<Rc<dyn athenasqlParserContext<'input> + 'input > >, invoking_state: isize) -> Rc<ExplainOptionContextAll<'input>> {
		Rc::new(
		ExplainOptionContextAll::Error(
			BaseParserRuleContext::new_parser_ctx(parent, invoking_state,ExplainOptionContextExt{
				ph:PhantomData
			}),
		)
		)
	}
}

pub trait ExplainOptionContextAttrs<'input>: athenasqlParserContext<'input> + BorrowMut<ExplainOptionContextExt<'input>>{


}

impl<'input> ExplainOptionContextAttrs<'input> for ExplainOptionContext<'input>{}

pub type ExplainFormatContext<'input> = BaseParserRuleContext<'input,ExplainFormatContextExt<'input>>;

pub trait ExplainFormatContextAttrs<'input>: athenasqlParserContext<'input>{
	/// Retrieves first TerminalNode corresponding to token FORMAT
	/// Returns `None` if there is no child corresponding to token FORMAT
	fn FORMAT(&self) -> Option<Rc<TerminalNode<'input,athenasqlParserContextType>>> where Self:Sized{
		self.get_token(FORMAT, 0)
	}
	/// Retrieves first TerminalNode corresponding to token TEXT
	/// Returns `None` if there is no child corresponding to token TEXT
	fn TEXT(&self) -> Option<Rc<TerminalNode<'input,athenasqlParserContextType>>> where Self:Sized{
		self.get_token(TEXT, 0)
	}
	/// Retrieves first TerminalNode corresponding to token GRAPHVIZ
	/// Returns `None` if there is no child corresponding to token GRAPHVIZ
	fn GRAPHVIZ(&self) -> Option<Rc<TerminalNode<'input,athenasqlParserContextType>>> where Self:Sized{
		self.get_token(GRAPHVIZ, 0)
	}
}

impl<'input> ExplainFormatContextAttrs<'input> for ExplainFormatContext<'input>{}

pub struct ExplainFormatContextExt<'input>{
	base:ExplainOptionContextExt<'input>,
	pub value: Option<TokenType<'input>>,
	ph:PhantomData<&'input str>
}

antlr_rust::tid!{ExplainFormatContextExt<'a>}

impl<'input> athenasqlParserContext<'input> for ExplainFormatContext<'input>{}

impl<'input,'a> Listenable<dyn athenasqlListener<'input> + 'a> for ExplainFormatContext<'input>{
	fn enter(&self,listener: &mut (dyn athenasqlListener<'input> + 'a)) {
		listener.enter_every_rule(self);
		listener.enter_explainFormat(self);
	}
}

impl<'input> CustomRuleContext<'input> for ExplainFormatContextExt<'input>{
	type TF = LocalTokenFactory<'input>;
	type Ctx = athenasqlParserContextType;
	fn get_rule_index(&self) -> usize { RULE_explainOption }
	//fn type_rule_index() -> usize where Self: Sized { RULE_explainOption }
}

impl<'input> Borrow<ExplainOptionContextExt<'input>> for ExplainFormatContext<'input>{
	fn borrow(&self) -> &ExplainOptionContextExt<'input> { &self.base }
}
impl<'input> BorrowMut<ExplainOptionContextExt<'input>> for ExplainFormatContext<'input>{
	fn borrow_mut(&mut self) -> &mut ExplainOptionContextExt<'input> { &mut self.base }
}

impl<'input> ExplainOptionContextAttrs<'input> for ExplainFormatContext<'input> {}

impl<'input> ExplainFormatContextExt<'input>{
	fn new(ctx: &dyn ExplainOptionContextAttrs<'input>) -> Rc<ExplainOptionContextAll<'input>>  {
		Rc::new(
			ExplainOptionContextAll::ExplainFormatContext(
				BaseParserRuleContext::copy_from(ctx,ExplainFormatContextExt{
					value:None, 
        			base: ctx.borrow().clone(),
        			ph:PhantomData
				})
			)
		)
	}
}

pub type ExplainTypeContext<'input> = BaseParserRuleContext<'input,ExplainTypeContextExt<'input>>;

pub trait ExplainTypeContextAttrs<'input>: athenasqlParserContext<'input>{
	/// Retrieves first TerminalNode corresponding to token TYPE
	/// Returns `None` if there is no child corresponding to token TYPE
	fn TYPE(&self) -> Option<Rc<TerminalNode<'input,athenasqlParserContextType>>> where Self:Sized{
		self.get_token(TYPE, 0)
	}
	/// Retrieves first TerminalNode corresponding to token LOGICAL
	/// Returns `None` if there is no child corresponding to token LOGICAL
	fn LOGICAL(&self) -> Option<Rc<TerminalNode<'input,athenasqlParserContextType>>> where Self:Sized{
		self.get_token(LOGICAL, 0)
	}
	/// Retrieves first TerminalNode corresponding to token DISTRIBUTED
	/// Returns `None` if there is no child corresponding to token DISTRIBUTED
	fn DISTRIBUTED(&self) -> Option<Rc<TerminalNode<'input,athenasqlParserContextType>>> where Self:Sized{
		self.get_token(DISTRIBUTED, 0)
	}
	/// Retrieves first TerminalNode corresponding to token VALIDATE
	/// Returns `None` if there is no child corresponding to token VALIDATE
	fn VALIDATE(&self) -> Option<Rc<TerminalNode<'input,athenasqlParserContextType>>> where Self:Sized{
		self.get_token(VALIDATE, 0)
	}
}

impl<'input> ExplainTypeContextAttrs<'input> for ExplainTypeContext<'input>{}

pub struct ExplainTypeContextExt<'input>{
	base:ExplainOptionContextExt<'input>,
	pub value: Option<TokenType<'input>>,
	ph:PhantomData<&'input str>
}

antlr_rust::tid!{ExplainTypeContextExt<'a>}

impl<'input> athenasqlParserContext<'input> for ExplainTypeContext<'input>{}

impl<'input,'a> Listenable<dyn athenasqlListener<'input> + 'a> for ExplainTypeContext<'input>{
	fn enter(&self,listener: &mut (dyn athenasqlListener<'input> + 'a)) {
		listener.enter_every_rule(self);
		listener.enter_explainType(self);
	}
}

impl<'input> CustomRuleContext<'input> for ExplainTypeContextExt<'input>{
	type TF = LocalTokenFactory<'input>;
	type Ctx = athenasqlParserContextType;
	fn get_rule_index(&self) -> usize { RULE_explainOption }
	//fn type_rule_index() -> usize where Self: Sized { RULE_explainOption }
}

impl<'input> Borrow<ExplainOptionContextExt<'input>> for ExplainTypeContext<'input>{
	fn borrow(&self) -> &ExplainOptionContextExt<'input> { &self.base }
}
impl<'input> BorrowMut<ExplainOptionContextExt<'input>> for ExplainTypeContext<'input>{
	fn borrow_mut(&mut self) -> &mut ExplainOptionContextExt<'input> { &mut self.base }
}

impl<'input> ExplainOptionContextAttrs<'input> for ExplainTypeContext<'input> {}

impl<'input> ExplainTypeContextExt<'input>{
	fn new(ctx: &dyn ExplainOptionContextAttrs<'input>) -> Rc<ExplainOptionContextAll<'input>>  {
		Rc::new(
			ExplainOptionContextAll::ExplainTypeContext(
				BaseParserRuleContext::copy_from(ctx,ExplainTypeContextExt{
					value:None, 
        			base: ctx.borrow().clone(),
        			ph:PhantomData
				})
			)
		)
	}
}

impl<'input, I, H> athenasqlParser<'input, I, H>
where
    I: TokenStream<'input, TF = LocalTokenFactory<'input> > + TidAble<'input>,
    H: ErrorStrategy<'input,BaseParserType<'input,I>>
{
	pub fn explainOption(&mut self,)
	-> Result<Rc<ExplainOptionContextAll<'input>>,ANTLRError> {
		let mut recog = self;
		let _parentctx = recog.ctx.take();
		let mut _localctx = ExplainOptionContextExt::new(_parentctx.clone(), recog.base.get_state());
        recog.base.enter_rule(_localctx.clone(), 106, RULE_explainOption);
        let mut _localctx: Rc<ExplainOptionContextAll> = _localctx;
		let mut _la: isize = -1;
		let result: Result<(), ANTLRError> = (|| {

			recog.base.set_state(1359);
			recog.err_handler.sync(&mut recog.base)?;
			match recog.base.input.la(1) {
			 FORMAT 
				=> {
					let tmp = ExplainFormatContextExt::new(&**_localctx);
					recog.base.enter_outer_alt(Some(tmp.clone()), 1);
					_localctx = tmp;
					{
					recog.base.set_state(1355);
					recog.base.match_token(FORMAT,&mut recog.err_handler)?;

					recog.base.set_state(1356);
					if let ExplainOptionContextAll::ExplainFormatContext(ctx) = cast_mut::<_,ExplainOptionContextAll >(&mut _localctx){
					ctx.value = recog.base.input.lt(1).cloned(); } else {unreachable!("cant cast");} 
					_la = recog.base.input.la(1);
					if { !(_la==TEXT || _la==GRAPHVIZ) } {
						let tmp = recog.err_handler.recover_inline(&mut recog.base)?;
						if let ExplainOptionContextAll::ExplainFormatContext(ctx) = cast_mut::<_,ExplainOptionContextAll >(&mut _localctx){
						ctx.value = Some(tmp.clone()); } else {unreachable!("cant cast");}  

					}
					else {
						if  recog.base.input.la(1)==TOKEN_EOF { recog.base.matched_eof = true };
						recog.err_handler.report_match(&mut recog.base);
						recog.base.consume(&mut recog.err_handler);
					}
					}
				}

			 TYPE 
				=> {
					let tmp = ExplainTypeContextExt::new(&**_localctx);
					recog.base.enter_outer_alt(Some(tmp.clone()), 2);
					_localctx = tmp;
					{
					recog.base.set_state(1357);
					recog.base.match_token(TYPE,&mut recog.err_handler)?;

					recog.base.set_state(1358);
					if let ExplainOptionContextAll::ExplainTypeContext(ctx) = cast_mut::<_,ExplainOptionContextAll >(&mut _localctx){
					ctx.value = recog.base.input.lt(1).cloned(); } else {unreachable!("cant cast");} 
					_la = recog.base.input.la(1);
					if { !(((((_la - 120)) & !0x3f) == 0 && ((1usize << (_la - 120)) & ((1usize << (LOGICAL - 120)) | (1usize << (DISTRIBUTED - 120)) | (1usize << (VALIDATE - 120)))) != 0)) } {
						let tmp = recog.err_handler.recover_inline(&mut recog.base)?;
						if let ExplainOptionContextAll::ExplainTypeContext(ctx) = cast_mut::<_,ExplainOptionContextAll >(&mut _localctx){
						ctx.value = Some(tmp.clone()); } else {unreachable!("cant cast");}  

					}
					else {
						if  recog.base.input.la(1)==TOKEN_EOF { recog.base.matched_eof = true };
						recog.err_handler.report_match(&mut recog.base);
						recog.base.consume(&mut recog.err_handler);
					}
					}
				}

				_ => Err(ANTLRError::NoAltError(NoViableAltError::new(&mut recog.base)))?
			}
			Ok(())
		})();
		match result {
		Ok(_)=>{},
        Err(e @ ANTLRError::FallThrough(_)) => return Err(e),
		Err(ref re) => {
				//_localctx.exception = re;
				recog.err_handler.report_error(&mut recog.base, re);
				recog.err_handler.recover(&mut recog.base, re)?;
			}
		}
		recog.base.exit_rule();

		Ok(_localctx)
	}
}
//------------------- transactionMode ----------------
#[derive(Debug)]
pub enum TransactionModeContextAll<'input>{
	TransactionAccessModeContext(TransactionAccessModeContext<'input>),
	IsolationLevelContext(IsolationLevelContext<'input>),
Error(TransactionModeContext<'input>)
}
antlr_rust::tid!{TransactionModeContextAll<'a>}

impl<'input> antlr_rust::parser_rule_context::DerefSeal for TransactionModeContextAll<'input>{}

impl<'input> athenasqlParserContext<'input> for TransactionModeContextAll<'input>{}

impl<'input> Deref for TransactionModeContextAll<'input>{
	type Target = dyn TransactionModeContextAttrs<'input> + 'input;
	fn deref(&self) -> &Self::Target{
		use TransactionModeContextAll::*;
		match self{
			TransactionAccessModeContext(inner) => inner,
			IsolationLevelContext(inner) => inner,
Error(inner) => inner
		}
	}
}
impl<'input,'a> Listenable<dyn athenasqlListener<'input> + 'a> for TransactionModeContextAll<'input>{
    fn enter(&self, listener: &mut (dyn athenasqlListener<'input> + 'a)) { self.deref().enter(listener) }
    fn exit(&self, listener: &mut (dyn athenasqlListener<'input> + 'a)) { self.deref().exit(listener) }
}



pub type TransactionModeContext<'input> = BaseParserRuleContext<'input,TransactionModeContextExt<'input>>;

#[derive(Clone)]
pub struct TransactionModeContextExt<'input>{
ph:PhantomData<&'input str>
}

impl<'input> athenasqlParserContext<'input> for TransactionModeContext<'input>{}

impl<'input,'a> Listenable<dyn athenasqlListener<'input> + 'a> for TransactionModeContext<'input>{
}

impl<'input> CustomRuleContext<'input> for TransactionModeContextExt<'input>{
	type TF = LocalTokenFactory<'input>;
	type Ctx = athenasqlParserContextType;
	fn get_rule_index(&self) -> usize { RULE_transactionMode }
	//fn type_rule_index() -> usize where Self: Sized { RULE_transactionMode }
}
antlr_rust::tid!{TransactionModeContextExt<'a>}

impl<'input> TransactionModeContextExt<'input>{
	fn new(parent: Option<Rc<dyn athenasqlParserContext<'input> + 'input > >, invoking_state: isize) -> Rc<TransactionModeContextAll<'input>> {
		Rc::new(
		TransactionModeContextAll::Error(
			BaseParserRuleContext::new_parser_ctx(parent, invoking_state,TransactionModeContextExt{
				ph:PhantomData
			}),
		)
		)
	}
}

pub trait TransactionModeContextAttrs<'input>: athenasqlParserContext<'input> + BorrowMut<TransactionModeContextExt<'input>>{


}

impl<'input> TransactionModeContextAttrs<'input> for TransactionModeContext<'input>{}

pub type TransactionAccessModeContext<'input> = BaseParserRuleContext<'input,TransactionAccessModeContextExt<'input>>;

pub trait TransactionAccessModeContextAttrs<'input>: athenasqlParserContext<'input>{
	/// Retrieves first TerminalNode corresponding to token READ
	/// Returns `None` if there is no child corresponding to token READ
	fn READ(&self) -> Option<Rc<TerminalNode<'input,athenasqlParserContextType>>> where Self:Sized{
		self.get_token(READ, 0)
	}
	/// Retrieves first TerminalNode corresponding to token ONLY
	/// Returns `None` if there is no child corresponding to token ONLY
	fn ONLY(&self) -> Option<Rc<TerminalNode<'input,athenasqlParserContextType>>> where Self:Sized{
		self.get_token(ONLY, 0)
	}
	/// Retrieves first TerminalNode corresponding to token WRITE
	/// Returns `None` if there is no child corresponding to token WRITE
	fn WRITE(&self) -> Option<Rc<TerminalNode<'input,athenasqlParserContextType>>> where Self:Sized{
		self.get_token(WRITE, 0)
	}
}

impl<'input> TransactionAccessModeContextAttrs<'input> for TransactionAccessModeContext<'input>{}

pub struct TransactionAccessModeContextExt<'input>{
	base:TransactionModeContextExt<'input>,
	pub accessMode: Option<TokenType<'input>>,
	ph:PhantomData<&'input str>
}

antlr_rust::tid!{TransactionAccessModeContextExt<'a>}

impl<'input> athenasqlParserContext<'input> for TransactionAccessModeContext<'input>{}

impl<'input,'a> Listenable<dyn athenasqlListener<'input> + 'a> for TransactionAccessModeContext<'input>{
	fn enter(&self,listener: &mut (dyn athenasqlListener<'input> + 'a)) {
		listener.enter_every_rule(self);
		listener.enter_transactionAccessMode(self);
	}
}

impl<'input> CustomRuleContext<'input> for TransactionAccessModeContextExt<'input>{
	type TF = LocalTokenFactory<'input>;
	type Ctx = athenasqlParserContextType;
	fn get_rule_index(&self) -> usize { RULE_transactionMode }
	//fn type_rule_index() -> usize where Self: Sized { RULE_transactionMode }
}

impl<'input> Borrow<TransactionModeContextExt<'input>> for TransactionAccessModeContext<'input>{
	fn borrow(&self) -> &TransactionModeContextExt<'input> { &self.base }
}
impl<'input> BorrowMut<TransactionModeContextExt<'input>> for TransactionAccessModeContext<'input>{
	fn borrow_mut(&mut self) -> &mut TransactionModeContextExt<'input> { &mut self.base }
}

impl<'input> TransactionModeContextAttrs<'input> for TransactionAccessModeContext<'input> {}

impl<'input> TransactionAccessModeContextExt<'input>{
	fn new(ctx: &dyn TransactionModeContextAttrs<'input>) -> Rc<TransactionModeContextAll<'input>>  {
		Rc::new(
			TransactionModeContextAll::TransactionAccessModeContext(
				BaseParserRuleContext::copy_from(ctx,TransactionAccessModeContextExt{
					accessMode:None, 
        			base: ctx.borrow().clone(),
        			ph:PhantomData
				})
			)
		)
	}
}

pub type IsolationLevelContext<'input> = BaseParserRuleContext<'input,IsolationLevelContextExt<'input>>;

pub trait IsolationLevelContextAttrs<'input>: athenasqlParserContext<'input>{
	/// Retrieves first TerminalNode corresponding to token ISOLATION
	/// Returns `None` if there is no child corresponding to token ISOLATION
	fn ISOLATION(&self) -> Option<Rc<TerminalNode<'input,athenasqlParserContextType>>> where Self:Sized{
		self.get_token(ISOLATION, 0)
	}
	/// Retrieves first TerminalNode corresponding to token LEVEL
	/// Returns `None` if there is no child corresponding to token LEVEL
	fn LEVEL(&self) -> Option<Rc<TerminalNode<'input,athenasqlParserContextType>>> where Self:Sized{
		self.get_token(LEVEL, 0)
	}
	fn levelOfIsolation(&self) -> Option<Rc<LevelOfIsolationContextAll<'input>>> where Self:Sized{
		self.child_of_type(0)
	}
}

impl<'input> IsolationLevelContextAttrs<'input> for IsolationLevelContext<'input>{}

pub struct IsolationLevelContextExt<'input>{
	base:TransactionModeContextExt<'input>,
	ph:PhantomData<&'input str>
}

antlr_rust::tid!{IsolationLevelContextExt<'a>}

impl<'input> athenasqlParserContext<'input> for IsolationLevelContext<'input>{}

impl<'input,'a> Listenable<dyn athenasqlListener<'input> + 'a> for IsolationLevelContext<'input>{
	fn enter(&self,listener: &mut (dyn athenasqlListener<'input> + 'a)) {
		listener.enter_every_rule(self);
		listener.enter_isolationLevel(self);
	}
}

impl<'input> CustomRuleContext<'input> for IsolationLevelContextExt<'input>{
	type TF = LocalTokenFactory<'input>;
	type Ctx = athenasqlParserContextType;
	fn get_rule_index(&self) -> usize { RULE_transactionMode }
	//fn type_rule_index() -> usize where Self: Sized { RULE_transactionMode }
}

impl<'input> Borrow<TransactionModeContextExt<'input>> for IsolationLevelContext<'input>{
	fn borrow(&self) -> &TransactionModeContextExt<'input> { &self.base }
}
impl<'input> BorrowMut<TransactionModeContextExt<'input>> for IsolationLevelContext<'input>{
	fn borrow_mut(&mut self) -> &mut TransactionModeContextExt<'input> { &mut self.base }
}

impl<'input> TransactionModeContextAttrs<'input> for IsolationLevelContext<'input> {}

impl<'input> IsolationLevelContextExt<'input>{
	fn new(ctx: &dyn TransactionModeContextAttrs<'input>) -> Rc<TransactionModeContextAll<'input>>  {
		Rc::new(
			TransactionModeContextAll::IsolationLevelContext(
				BaseParserRuleContext::copy_from(ctx,IsolationLevelContextExt{
        			base: ctx.borrow().clone(),
        			ph:PhantomData
				})
			)
		)
	}
}

impl<'input, I, H> athenasqlParser<'input, I, H>
where
    I: TokenStream<'input, TF = LocalTokenFactory<'input> > + TidAble<'input>,
    H: ErrorStrategy<'input,BaseParserType<'input,I>>
{
	pub fn transactionMode(&mut self,)
	-> Result<Rc<TransactionModeContextAll<'input>>,ANTLRError> {
		let mut recog = self;
		let _parentctx = recog.ctx.take();
		let mut _localctx = TransactionModeContextExt::new(_parentctx.clone(), recog.base.get_state());
        recog.base.enter_rule(_localctx.clone(), 108, RULE_transactionMode);
        let mut _localctx: Rc<TransactionModeContextAll> = _localctx;
		let mut _la: isize = -1;
		let result: Result<(), ANTLRError> = (|| {

			recog.base.set_state(1366);
			recog.err_handler.sync(&mut recog.base)?;
			match recog.base.input.la(1) {
			 ISOLATION 
				=> {
					let tmp = IsolationLevelContextExt::new(&**_localctx);
					recog.base.enter_outer_alt(Some(tmp.clone()), 1);
					_localctx = tmp;
					{
					recog.base.set_state(1361);
					recog.base.match_token(ISOLATION,&mut recog.err_handler)?;

					recog.base.set_state(1362);
					recog.base.match_token(LEVEL,&mut recog.err_handler)?;

					/*InvokeRule levelOfIsolation*/
					recog.base.set_state(1363);
					recog.levelOfIsolation()?;

					}
				}

			 READ 
				=> {
					let tmp = TransactionAccessModeContextExt::new(&**_localctx);
					recog.base.enter_outer_alt(Some(tmp.clone()), 2);
					_localctx = tmp;
					{
					recog.base.set_state(1364);
					recog.base.match_token(READ,&mut recog.err_handler)?;

					recog.base.set_state(1365);
					if let TransactionModeContextAll::TransactionAccessModeContext(ctx) = cast_mut::<_,TransactionModeContextAll >(&mut _localctx){
					ctx.accessMode = recog.base.input.lt(1).cloned(); } else {unreachable!("cant cast");} 
					_la = recog.base.input.la(1);
					if { !(_la==WRITE || _la==ONLY) } {
						let tmp = recog.err_handler.recover_inline(&mut recog.base)?;
						if let TransactionModeContextAll::TransactionAccessModeContext(ctx) = cast_mut::<_,TransactionModeContextAll >(&mut _localctx){
						ctx.accessMode = Some(tmp.clone()); } else {unreachable!("cant cast");}  

					}
					else {
						if  recog.base.input.la(1)==TOKEN_EOF { recog.base.matched_eof = true };
						recog.err_handler.report_match(&mut recog.base);
						recog.base.consume(&mut recog.err_handler);
					}
					}
				}

				_ => Err(ANTLRError::NoAltError(NoViableAltError::new(&mut recog.base)))?
			}
			Ok(())
		})();
		match result {
		Ok(_)=>{},
        Err(e @ ANTLRError::FallThrough(_)) => return Err(e),
		Err(ref re) => {
				//_localctx.exception = re;
				recog.err_handler.report_error(&mut recog.base, re);
				recog.err_handler.recover(&mut recog.base, re)?;
			}
		}
		recog.base.exit_rule();

		Ok(_localctx)
	}
}
//------------------- levelOfIsolation ----------------
#[derive(Debug)]
pub enum LevelOfIsolationContextAll<'input>{
	ReadUncommittedContext(ReadUncommittedContext<'input>),
	SerializableContext(SerializableContext<'input>),
	ReadCommittedContext(ReadCommittedContext<'input>),
	RepeatableReadContext(RepeatableReadContext<'input>),
Error(LevelOfIsolationContext<'input>)
}
antlr_rust::tid!{LevelOfIsolationContextAll<'a>}

impl<'input> antlr_rust::parser_rule_context::DerefSeal for LevelOfIsolationContextAll<'input>{}

impl<'input> athenasqlParserContext<'input> for LevelOfIsolationContextAll<'input>{}

impl<'input> Deref for LevelOfIsolationContextAll<'input>{
	type Target = dyn LevelOfIsolationContextAttrs<'input> + 'input;
	fn deref(&self) -> &Self::Target{
		use LevelOfIsolationContextAll::*;
		match self{
			ReadUncommittedContext(inner) => inner,
			SerializableContext(inner) => inner,
			ReadCommittedContext(inner) => inner,
			RepeatableReadContext(inner) => inner,
Error(inner) => inner
		}
	}
}
impl<'input,'a> Listenable<dyn athenasqlListener<'input> + 'a> for LevelOfIsolationContextAll<'input>{
    fn enter(&self, listener: &mut (dyn athenasqlListener<'input> + 'a)) { self.deref().enter(listener) }
    fn exit(&self, listener: &mut (dyn athenasqlListener<'input> + 'a)) { self.deref().exit(listener) }
}



pub type LevelOfIsolationContext<'input> = BaseParserRuleContext<'input,LevelOfIsolationContextExt<'input>>;

#[derive(Clone)]
pub struct LevelOfIsolationContextExt<'input>{
ph:PhantomData<&'input str>
}

impl<'input> athenasqlParserContext<'input> for LevelOfIsolationContext<'input>{}

impl<'input,'a> Listenable<dyn athenasqlListener<'input> + 'a> for LevelOfIsolationContext<'input>{
}

impl<'input> CustomRuleContext<'input> for LevelOfIsolationContextExt<'input>{
	type TF = LocalTokenFactory<'input>;
	type Ctx = athenasqlParserContextType;
	fn get_rule_index(&self) -> usize { RULE_levelOfIsolation }
	//fn type_rule_index() -> usize where Self: Sized { RULE_levelOfIsolation }
}
antlr_rust::tid!{LevelOfIsolationContextExt<'a>}

impl<'input> LevelOfIsolationContextExt<'input>{
	fn new(parent: Option<Rc<dyn athenasqlParserContext<'input> + 'input > >, invoking_state: isize) -> Rc<LevelOfIsolationContextAll<'input>> {
		Rc::new(
		LevelOfIsolationContextAll::Error(
			BaseParserRuleContext::new_parser_ctx(parent, invoking_state,LevelOfIsolationContextExt{
				ph:PhantomData
			}),
		)
		)
	}
}

pub trait LevelOfIsolationContextAttrs<'input>: athenasqlParserContext<'input> + BorrowMut<LevelOfIsolationContextExt<'input>>{


}

impl<'input> LevelOfIsolationContextAttrs<'input> for LevelOfIsolationContext<'input>{}

pub type ReadUncommittedContext<'input> = BaseParserRuleContext<'input,ReadUncommittedContextExt<'input>>;

pub trait ReadUncommittedContextAttrs<'input>: athenasqlParserContext<'input>{
	/// Retrieves first TerminalNode corresponding to token READ
	/// Returns `None` if there is no child corresponding to token READ
	fn READ(&self) -> Option<Rc<TerminalNode<'input,athenasqlParserContextType>>> where Self:Sized{
		self.get_token(READ, 0)
	}
	/// Retrieves first TerminalNode corresponding to token UNCOMMITTED
	/// Returns `None` if there is no child corresponding to token UNCOMMITTED
	fn UNCOMMITTED(&self) -> Option<Rc<TerminalNode<'input,athenasqlParserContextType>>> where Self:Sized{
		self.get_token(UNCOMMITTED, 0)
	}
}

impl<'input> ReadUncommittedContextAttrs<'input> for ReadUncommittedContext<'input>{}

pub struct ReadUncommittedContextExt<'input>{
	base:LevelOfIsolationContextExt<'input>,
	ph:PhantomData<&'input str>
}

antlr_rust::tid!{ReadUncommittedContextExt<'a>}

impl<'input> athenasqlParserContext<'input> for ReadUncommittedContext<'input>{}

impl<'input,'a> Listenable<dyn athenasqlListener<'input> + 'a> for ReadUncommittedContext<'input>{
	fn enter(&self,listener: &mut (dyn athenasqlListener<'input> + 'a)) {
		listener.enter_every_rule(self);
		listener.enter_readUncommitted(self);
	}
}

impl<'input> CustomRuleContext<'input> for ReadUncommittedContextExt<'input>{
	type TF = LocalTokenFactory<'input>;
	type Ctx = athenasqlParserContextType;
	fn get_rule_index(&self) -> usize { RULE_levelOfIsolation }
	//fn type_rule_index() -> usize where Self: Sized { RULE_levelOfIsolation }
}

impl<'input> Borrow<LevelOfIsolationContextExt<'input>> for ReadUncommittedContext<'input>{
	fn borrow(&self) -> &LevelOfIsolationContextExt<'input> { &self.base }
}
impl<'input> BorrowMut<LevelOfIsolationContextExt<'input>> for ReadUncommittedContext<'input>{
	fn borrow_mut(&mut self) -> &mut LevelOfIsolationContextExt<'input> { &mut self.base }
}

impl<'input> LevelOfIsolationContextAttrs<'input> for ReadUncommittedContext<'input> {}

impl<'input> ReadUncommittedContextExt<'input>{
	fn new(ctx: &dyn LevelOfIsolationContextAttrs<'input>) -> Rc<LevelOfIsolationContextAll<'input>>  {
		Rc::new(
			LevelOfIsolationContextAll::ReadUncommittedContext(
				BaseParserRuleContext::copy_from(ctx,ReadUncommittedContextExt{
        			base: ctx.borrow().clone(),
        			ph:PhantomData
				})
			)
		)
	}
}

pub type SerializableContext<'input> = BaseParserRuleContext<'input,SerializableContextExt<'input>>;

pub trait SerializableContextAttrs<'input>: athenasqlParserContext<'input>{
	/// Retrieves first TerminalNode corresponding to token SERIALIZABLE
	/// Returns `None` if there is no child corresponding to token SERIALIZABLE
	fn SERIALIZABLE(&self) -> Option<Rc<TerminalNode<'input,athenasqlParserContextType>>> where Self:Sized{
		self.get_token(SERIALIZABLE, 0)
	}
}

impl<'input> SerializableContextAttrs<'input> for SerializableContext<'input>{}

pub struct SerializableContextExt<'input>{
	base:LevelOfIsolationContextExt<'input>,
	ph:PhantomData<&'input str>
}

antlr_rust::tid!{SerializableContextExt<'a>}

impl<'input> athenasqlParserContext<'input> for SerializableContext<'input>{}

impl<'input,'a> Listenable<dyn athenasqlListener<'input> + 'a> for SerializableContext<'input>{
	fn enter(&self,listener: &mut (dyn athenasqlListener<'input> + 'a)) {
		listener.enter_every_rule(self);
		listener.enter_serializable(self);
	}
}

impl<'input> CustomRuleContext<'input> for SerializableContextExt<'input>{
	type TF = LocalTokenFactory<'input>;
	type Ctx = athenasqlParserContextType;
	fn get_rule_index(&self) -> usize { RULE_levelOfIsolation }
	//fn type_rule_index() -> usize where Self: Sized { RULE_levelOfIsolation }
}

impl<'input> Borrow<LevelOfIsolationContextExt<'input>> for SerializableContext<'input>{
	fn borrow(&self) -> &LevelOfIsolationContextExt<'input> { &self.base }
}
impl<'input> BorrowMut<LevelOfIsolationContextExt<'input>> for SerializableContext<'input>{
	fn borrow_mut(&mut self) -> &mut LevelOfIsolationContextExt<'input> { &mut self.base }
}

impl<'input> LevelOfIsolationContextAttrs<'input> for SerializableContext<'input> {}

impl<'input> SerializableContextExt<'input>{
	fn new(ctx: &dyn LevelOfIsolationContextAttrs<'input>) -> Rc<LevelOfIsolationContextAll<'input>>  {
		Rc::new(
			LevelOfIsolationContextAll::SerializableContext(
				BaseParserRuleContext::copy_from(ctx,SerializableContextExt{
        			base: ctx.borrow().clone(),
        			ph:PhantomData
				})
			)
		)
	}
}

pub type ReadCommittedContext<'input> = BaseParserRuleContext<'input,ReadCommittedContextExt<'input>>;

pub trait ReadCommittedContextAttrs<'input>: athenasqlParserContext<'input>{
	/// Retrieves first TerminalNode corresponding to token READ
	/// Returns `None` if there is no child corresponding to token READ
	fn READ(&self) -> Option<Rc<TerminalNode<'input,athenasqlParserContextType>>> where Self:Sized{
		self.get_token(READ, 0)
	}
	/// Retrieves first TerminalNode corresponding to token COMMITTED
	/// Returns `None` if there is no child corresponding to token COMMITTED
	fn COMMITTED(&self) -> Option<Rc<TerminalNode<'input,athenasqlParserContextType>>> where Self:Sized{
		self.get_token(COMMITTED, 0)
	}
}

impl<'input> ReadCommittedContextAttrs<'input> for ReadCommittedContext<'input>{}

pub struct ReadCommittedContextExt<'input>{
	base:LevelOfIsolationContextExt<'input>,
	ph:PhantomData<&'input str>
}

antlr_rust::tid!{ReadCommittedContextExt<'a>}

impl<'input> athenasqlParserContext<'input> for ReadCommittedContext<'input>{}

impl<'input,'a> Listenable<dyn athenasqlListener<'input> + 'a> for ReadCommittedContext<'input>{
	fn enter(&self,listener: &mut (dyn athenasqlListener<'input> + 'a)) {
		listener.enter_every_rule(self);
		listener.enter_readCommitted(self);
	}
}

impl<'input> CustomRuleContext<'input> for ReadCommittedContextExt<'input>{
	type TF = LocalTokenFactory<'input>;
	type Ctx = athenasqlParserContextType;
	fn get_rule_index(&self) -> usize { RULE_levelOfIsolation }
	//fn type_rule_index() -> usize where Self: Sized { RULE_levelOfIsolation }
}

impl<'input> Borrow<LevelOfIsolationContextExt<'input>> for ReadCommittedContext<'input>{
	fn borrow(&self) -> &LevelOfIsolationContextExt<'input> { &self.base }
}
impl<'input> BorrowMut<LevelOfIsolationContextExt<'input>> for ReadCommittedContext<'input>{
	fn borrow_mut(&mut self) -> &mut LevelOfIsolationContextExt<'input> { &mut self.base }
}

impl<'input> LevelOfIsolationContextAttrs<'input> for ReadCommittedContext<'input> {}

impl<'input> ReadCommittedContextExt<'input>{
	fn new(ctx: &dyn LevelOfIsolationContextAttrs<'input>) -> Rc<LevelOfIsolationContextAll<'input>>  {
		Rc::new(
			LevelOfIsolationContextAll::ReadCommittedContext(
				BaseParserRuleContext::copy_from(ctx,ReadCommittedContextExt{
        			base: ctx.borrow().clone(),
        			ph:PhantomData
				})
			)
		)
	}
}

pub type RepeatableReadContext<'input> = BaseParserRuleContext<'input,RepeatableReadContextExt<'input>>;

pub trait RepeatableReadContextAttrs<'input>: athenasqlParserContext<'input>{
	/// Retrieves first TerminalNode corresponding to token REPEATABLE
	/// Returns `None` if there is no child corresponding to token REPEATABLE
	fn REPEATABLE(&self) -> Option<Rc<TerminalNode<'input,athenasqlParserContextType>>> where Self:Sized{
		self.get_token(REPEATABLE, 0)
	}
	/// Retrieves first TerminalNode corresponding to token READ
	/// Returns `None` if there is no child corresponding to token READ
	fn READ(&self) -> Option<Rc<TerminalNode<'input,athenasqlParserContextType>>> where Self:Sized{
		self.get_token(READ, 0)
	}
}

impl<'input> RepeatableReadContextAttrs<'input> for RepeatableReadContext<'input>{}

pub struct RepeatableReadContextExt<'input>{
	base:LevelOfIsolationContextExt<'input>,
	ph:PhantomData<&'input str>
}

antlr_rust::tid!{RepeatableReadContextExt<'a>}

impl<'input> athenasqlParserContext<'input> for RepeatableReadContext<'input>{}

impl<'input,'a> Listenable<dyn athenasqlListener<'input> + 'a> for RepeatableReadContext<'input>{
	fn enter(&self,listener: &mut (dyn athenasqlListener<'input> + 'a)) {
		listener.enter_every_rule(self);
		listener.enter_repeatableRead(self);
	}
}

impl<'input> CustomRuleContext<'input> for RepeatableReadContextExt<'input>{
	type TF = LocalTokenFactory<'input>;
	type Ctx = athenasqlParserContextType;
	fn get_rule_index(&self) -> usize { RULE_levelOfIsolation }
	//fn type_rule_index() -> usize where Self: Sized { RULE_levelOfIsolation }
}

impl<'input> Borrow<LevelOfIsolationContextExt<'input>> for RepeatableReadContext<'input>{
	fn borrow(&self) -> &LevelOfIsolationContextExt<'input> { &self.base }
}
impl<'input> BorrowMut<LevelOfIsolationContextExt<'input>> for RepeatableReadContext<'input>{
	fn borrow_mut(&mut self) -> &mut LevelOfIsolationContextExt<'input> { &mut self.base }
}

impl<'input> LevelOfIsolationContextAttrs<'input> for RepeatableReadContext<'input> {}

impl<'input> RepeatableReadContextExt<'input>{
	fn new(ctx: &dyn LevelOfIsolationContextAttrs<'input>) -> Rc<LevelOfIsolationContextAll<'input>>  {
		Rc::new(
			LevelOfIsolationContextAll::RepeatableReadContext(
				BaseParserRuleContext::copy_from(ctx,RepeatableReadContextExt{
        			base: ctx.borrow().clone(),
        			ph:PhantomData
				})
			)
		)
	}
}

impl<'input, I, H> athenasqlParser<'input, I, H>
where
    I: TokenStream<'input, TF = LocalTokenFactory<'input> > + TidAble<'input>,
    H: ErrorStrategy<'input,BaseParserType<'input,I>>
{
	pub fn levelOfIsolation(&mut self,)
	-> Result<Rc<LevelOfIsolationContextAll<'input>>,ANTLRError> {
		let mut recog = self;
		let _parentctx = recog.ctx.take();
		let mut _localctx = LevelOfIsolationContextExt::new(_parentctx.clone(), recog.base.get_state());
        recog.base.enter_rule(_localctx.clone(), 110, RULE_levelOfIsolation);
        let mut _localctx: Rc<LevelOfIsolationContextAll> = _localctx;
		let result: Result<(), ANTLRError> = (|| {

			recog.base.set_state(1375);
			recog.err_handler.sync(&mut recog.base)?;
			match  recog.interpreter.adaptive_predict(165,&mut recog.base)? {
				1 =>{
					let tmp = ReadUncommittedContextExt::new(&**_localctx);
					recog.base.enter_outer_alt(Some(tmp.clone()), 1);
					_localctx = tmp;
					{
					recog.base.set_state(1368);
					recog.base.match_token(READ,&mut recog.err_handler)?;

					recog.base.set_state(1369);
					recog.base.match_token(UNCOMMITTED,&mut recog.err_handler)?;

					}
				}
			,
				2 =>{
					let tmp = ReadCommittedContextExt::new(&**_localctx);
					recog.base.enter_outer_alt(Some(tmp.clone()), 2);
					_localctx = tmp;
					{
					recog.base.set_state(1370);
					recog.base.match_token(READ,&mut recog.err_handler)?;

					recog.base.set_state(1371);
					recog.base.match_token(COMMITTED,&mut recog.err_handler)?;

					}
				}
			,
				3 =>{
					let tmp = RepeatableReadContextExt::new(&**_localctx);
					recog.base.enter_outer_alt(Some(tmp.clone()), 3);
					_localctx = tmp;
					{
					recog.base.set_state(1372);
					recog.base.match_token(REPEATABLE,&mut recog.err_handler)?;

					recog.base.set_state(1373);
					recog.base.match_token(READ,&mut recog.err_handler)?;

					}
				}
			,
				4 =>{
					let tmp = SerializableContextExt::new(&**_localctx);
					recog.base.enter_outer_alt(Some(tmp.clone()), 4);
					_localctx = tmp;
					{
					recog.base.set_state(1374);
					recog.base.match_token(SERIALIZABLE,&mut recog.err_handler)?;

					}
				}

				_ => {}
			}
			Ok(())
		})();
		match result {
		Ok(_)=>{},
        Err(e @ ANTLRError::FallThrough(_)) => return Err(e),
		Err(ref re) => {
				//_localctx.exception = re;
				recog.err_handler.report_error(&mut recog.base, re);
				recog.err_handler.recover(&mut recog.base, re)?;
			}
		}
		recog.base.exit_rule();

		Ok(_localctx)
	}
}
//------------------- callArgument ----------------
#[derive(Debug)]
pub enum CallArgumentContextAll<'input>{
	PositionalArgumentContext(PositionalArgumentContext<'input>),
	NamedArgumentContext(NamedArgumentContext<'input>),
Error(CallArgumentContext<'input>)
}
antlr_rust::tid!{CallArgumentContextAll<'a>}

impl<'input> antlr_rust::parser_rule_context::DerefSeal for CallArgumentContextAll<'input>{}

impl<'input> athenasqlParserContext<'input> for CallArgumentContextAll<'input>{}

impl<'input> Deref for CallArgumentContextAll<'input>{
	type Target = dyn CallArgumentContextAttrs<'input> + 'input;
	fn deref(&self) -> &Self::Target{
		use CallArgumentContextAll::*;
		match self{
			PositionalArgumentContext(inner) => inner,
			NamedArgumentContext(inner) => inner,
Error(inner) => inner
		}
	}
}
impl<'input,'a> Listenable<dyn athenasqlListener<'input> + 'a> for CallArgumentContextAll<'input>{
    fn enter(&self, listener: &mut (dyn athenasqlListener<'input> + 'a)) { self.deref().enter(listener) }
    fn exit(&self, listener: &mut (dyn athenasqlListener<'input> + 'a)) { self.deref().exit(listener) }
}



pub type CallArgumentContext<'input> = BaseParserRuleContext<'input,CallArgumentContextExt<'input>>;

#[derive(Clone)]
pub struct CallArgumentContextExt<'input>{
ph:PhantomData<&'input str>
}

impl<'input> athenasqlParserContext<'input> for CallArgumentContext<'input>{}

impl<'input,'a> Listenable<dyn athenasqlListener<'input> + 'a> for CallArgumentContext<'input>{
}

impl<'input> CustomRuleContext<'input> for CallArgumentContextExt<'input>{
	type TF = LocalTokenFactory<'input>;
	type Ctx = athenasqlParserContextType;
	fn get_rule_index(&self) -> usize { RULE_callArgument }
	//fn type_rule_index() -> usize where Self: Sized { RULE_callArgument }
}
antlr_rust::tid!{CallArgumentContextExt<'a>}

impl<'input> CallArgumentContextExt<'input>{
	fn new(parent: Option<Rc<dyn athenasqlParserContext<'input> + 'input > >, invoking_state: isize) -> Rc<CallArgumentContextAll<'input>> {
		Rc::new(
		CallArgumentContextAll::Error(
			BaseParserRuleContext::new_parser_ctx(parent, invoking_state,CallArgumentContextExt{
				ph:PhantomData
			}),
		)
		)
	}
}

pub trait CallArgumentContextAttrs<'input>: athenasqlParserContext<'input> + BorrowMut<CallArgumentContextExt<'input>>{


}

impl<'input> CallArgumentContextAttrs<'input> for CallArgumentContext<'input>{}

pub type PositionalArgumentContext<'input> = BaseParserRuleContext<'input,PositionalArgumentContextExt<'input>>;

pub trait PositionalArgumentContextAttrs<'input>: athenasqlParserContext<'input>{
	fn expression(&self) -> Option<Rc<ExpressionContextAll<'input>>> where Self:Sized{
		self.child_of_type(0)
	}
}

impl<'input> PositionalArgumentContextAttrs<'input> for PositionalArgumentContext<'input>{}

pub struct PositionalArgumentContextExt<'input>{
	base:CallArgumentContextExt<'input>,
	ph:PhantomData<&'input str>
}

antlr_rust::tid!{PositionalArgumentContextExt<'a>}

impl<'input> athenasqlParserContext<'input> for PositionalArgumentContext<'input>{}

impl<'input,'a> Listenable<dyn athenasqlListener<'input> + 'a> for PositionalArgumentContext<'input>{
	fn enter(&self,listener: &mut (dyn athenasqlListener<'input> + 'a)) {
		listener.enter_every_rule(self);
		listener.enter_positionalArgument(self);
	}
}

impl<'input> CustomRuleContext<'input> for PositionalArgumentContextExt<'input>{
	type TF = LocalTokenFactory<'input>;
	type Ctx = athenasqlParserContextType;
	fn get_rule_index(&self) -> usize { RULE_callArgument }
	//fn type_rule_index() -> usize where Self: Sized { RULE_callArgument }
}

impl<'input> Borrow<CallArgumentContextExt<'input>> for PositionalArgumentContext<'input>{
	fn borrow(&self) -> &CallArgumentContextExt<'input> { &self.base }
}
impl<'input> BorrowMut<CallArgumentContextExt<'input>> for PositionalArgumentContext<'input>{
	fn borrow_mut(&mut self) -> &mut CallArgumentContextExt<'input> { &mut self.base }
}

impl<'input> CallArgumentContextAttrs<'input> for PositionalArgumentContext<'input> {}

impl<'input> PositionalArgumentContextExt<'input>{
	fn new(ctx: &dyn CallArgumentContextAttrs<'input>) -> Rc<CallArgumentContextAll<'input>>  {
		Rc::new(
			CallArgumentContextAll::PositionalArgumentContext(
				BaseParserRuleContext::copy_from(ctx,PositionalArgumentContextExt{
        			base: ctx.borrow().clone(),
        			ph:PhantomData
				})
			)
		)
	}
}

pub type NamedArgumentContext<'input> = BaseParserRuleContext<'input,NamedArgumentContextExt<'input>>;

pub trait NamedArgumentContextAttrs<'input>: athenasqlParserContext<'input>{
	fn identifier(&self) -> Option<Rc<IdentifierContextAll<'input>>> where Self:Sized{
		self.child_of_type(0)
	}
	fn expression(&self) -> Option<Rc<ExpressionContextAll<'input>>> where Self:Sized{
		self.child_of_type(0)
	}
}

impl<'input> NamedArgumentContextAttrs<'input> for NamedArgumentContext<'input>{}

pub struct NamedArgumentContextExt<'input>{
	base:CallArgumentContextExt<'input>,
	ph:PhantomData<&'input str>
}

antlr_rust::tid!{NamedArgumentContextExt<'a>}

impl<'input> athenasqlParserContext<'input> for NamedArgumentContext<'input>{}

impl<'input,'a> Listenable<dyn athenasqlListener<'input> + 'a> for NamedArgumentContext<'input>{
	fn enter(&self,listener: &mut (dyn athenasqlListener<'input> + 'a)) {
		listener.enter_every_rule(self);
		listener.enter_namedArgument(self);
	}
}

impl<'input> CustomRuleContext<'input> for NamedArgumentContextExt<'input>{
	type TF = LocalTokenFactory<'input>;
	type Ctx = athenasqlParserContextType;
	fn get_rule_index(&self) -> usize { RULE_callArgument }
	//fn type_rule_index() -> usize where Self: Sized { RULE_callArgument }
}

impl<'input> Borrow<CallArgumentContextExt<'input>> for NamedArgumentContext<'input>{
	fn borrow(&self) -> &CallArgumentContextExt<'input> { &self.base }
}
impl<'input> BorrowMut<CallArgumentContextExt<'input>> for NamedArgumentContext<'input>{
	fn borrow_mut(&mut self) -> &mut CallArgumentContextExt<'input> { &mut self.base }
}

impl<'input> CallArgumentContextAttrs<'input> for NamedArgumentContext<'input> {}

impl<'input> NamedArgumentContextExt<'input>{
	fn new(ctx: &dyn CallArgumentContextAttrs<'input>) -> Rc<CallArgumentContextAll<'input>>  {
		Rc::new(
			CallArgumentContextAll::NamedArgumentContext(
				BaseParserRuleContext::copy_from(ctx,NamedArgumentContextExt{
        			base: ctx.borrow().clone(),
        			ph:PhantomData
				})
			)
		)
	}
}

impl<'input, I, H> athenasqlParser<'input, I, H>
where
    I: TokenStream<'input, TF = LocalTokenFactory<'input> > + TidAble<'input>,
    H: ErrorStrategy<'input,BaseParserType<'input,I>>
{
	pub fn callArgument(&mut self,)
	-> Result<Rc<CallArgumentContextAll<'input>>,ANTLRError> {
		let mut recog = self;
		let _parentctx = recog.ctx.take();
		let mut _localctx = CallArgumentContextExt::new(_parentctx.clone(), recog.base.get_state());
        recog.base.enter_rule(_localctx.clone(), 112, RULE_callArgument);
        let mut _localctx: Rc<CallArgumentContextAll> = _localctx;
		let result: Result<(), ANTLRError> = (|| {

			recog.base.set_state(1382);
			recog.err_handler.sync(&mut recog.base)?;
			match  recog.interpreter.adaptive_predict(166,&mut recog.base)? {
				1 =>{
					let tmp = PositionalArgumentContextExt::new(&**_localctx);
					recog.base.enter_outer_alt(Some(tmp.clone()), 1);
					_localctx = tmp;
					{
					/*InvokeRule expression*/
					recog.base.set_state(1377);
					recog.expression()?;

					}
				}
			,
				2 =>{
					let tmp = NamedArgumentContextExt::new(&**_localctx);
					recog.base.enter_outer_alt(Some(tmp.clone()), 2);
					_localctx = tmp;
					{
					/*InvokeRule identifier*/
					recog.base.set_state(1378);
					recog.identifier()?;

					recog.base.set_state(1379);
					recog.base.match_token(T__8,&mut recog.err_handler)?;

					/*InvokeRule expression*/
					recog.base.set_state(1380);
					recog.expression()?;

					}
				}

				_ => {}
			}
			Ok(())
		})();
		match result {
		Ok(_)=>{},
        Err(e @ ANTLRError::FallThrough(_)) => return Err(e),
		Err(ref re) => {
				//_localctx.exception = re;
				recog.err_handler.report_error(&mut recog.base, re);
				recog.err_handler.recover(&mut recog.base, re)?;
			}
		}
		recog.base.exit_rule();

		Ok(_localctx)
	}
}
//------------------- privilege ----------------
pub type PrivilegeContextAll<'input> = PrivilegeContext<'input>;


pub type PrivilegeContext<'input> = BaseParserRuleContext<'input,PrivilegeContextExt<'input>>;

#[derive(Clone)]
pub struct PrivilegeContextExt<'input>{
ph:PhantomData<&'input str>
}

impl<'input> athenasqlParserContext<'input> for PrivilegeContext<'input>{}

impl<'input,'a> Listenable<dyn athenasqlListener<'input> + 'a> for PrivilegeContext<'input>{
		fn enter(&self,listener: &mut (dyn athenasqlListener<'input> + 'a)) {
			listener.enter_every_rule(self);
			listener.enter_privilege(self);
		}fn exit(&self,listener: &mut (dyn athenasqlListener<'input> + 'a)) {
			listener.exit_privilege(self);
			listener.exit_every_rule(self);
		}
}

impl<'input> CustomRuleContext<'input> for PrivilegeContextExt<'input>{
	type TF = LocalTokenFactory<'input>;
	type Ctx = athenasqlParserContextType;
	fn get_rule_index(&self) -> usize { RULE_privilege }
	//fn type_rule_index() -> usize where Self: Sized { RULE_privilege }
}
antlr_rust::tid!{PrivilegeContextExt<'a>}

impl<'input> PrivilegeContextExt<'input>{
	fn new(parent: Option<Rc<dyn athenasqlParserContext<'input> + 'input > >, invoking_state: isize) -> Rc<PrivilegeContextAll<'input>> {
		Rc::new(
			BaseParserRuleContext::new_parser_ctx(parent, invoking_state,PrivilegeContextExt{
				ph:PhantomData
			}),
		)
	}
}

pub trait PrivilegeContextAttrs<'input>: athenasqlParserContext<'input> + BorrowMut<PrivilegeContextExt<'input>>{

/// Retrieves first TerminalNode corresponding to token SELECT
/// Returns `None` if there is no child corresponding to token SELECT
fn SELECT(&self) -> Option<Rc<TerminalNode<'input,athenasqlParserContextType>>> where Self:Sized{
	self.get_token(SELECT, 0)
}
/// Retrieves first TerminalNode corresponding to token DELETE
/// Returns `None` if there is no child corresponding to token DELETE
fn DELETE(&self) -> Option<Rc<TerminalNode<'input,athenasqlParserContextType>>> where Self:Sized{
	self.get_token(DELETE, 0)
}
/// Retrieves first TerminalNode corresponding to token INSERT
/// Returns `None` if there is no child corresponding to token INSERT
fn INSERT(&self) -> Option<Rc<TerminalNode<'input,athenasqlParserContextType>>> where Self:Sized{
	self.get_token(INSERT, 0)
}
fn identifier(&self) -> Option<Rc<IdentifierContextAll<'input>>> where Self:Sized{
	self.child_of_type(0)
}

}

impl<'input> PrivilegeContextAttrs<'input> for PrivilegeContext<'input>{}

impl<'input, I, H> athenasqlParser<'input, I, H>
where
    I: TokenStream<'input, TF = LocalTokenFactory<'input> > + TidAble<'input>,
    H: ErrorStrategy<'input,BaseParserType<'input,I>>
{
	pub fn privilege(&mut self,)
	-> Result<Rc<PrivilegeContextAll<'input>>,ANTLRError> {
		let mut recog = self;
		let _parentctx = recog.ctx.take();
		let mut _localctx = PrivilegeContextExt::new(_parentctx.clone(), recog.base.get_state());
        recog.base.enter_rule(_localctx.clone(), 114, RULE_privilege);
        let mut _localctx: Rc<PrivilegeContextAll> = _localctx;
		let result: Result<(), ANTLRError> = (|| {

			recog.base.set_state(1388);
			recog.err_handler.sync(&mut recog.base)?;
			match recog.base.input.la(1) {
			 SELECT 
				=> {
					//recog.base.enter_outer_alt(_localctx.clone(), 1);
					recog.base.enter_outer_alt(None, 1);
					{
					recog.base.set_state(1384);
					recog.base.match_token(SELECT,&mut recog.err_handler)?;

					}
				}

			 DELETE 
				=> {
					//recog.base.enter_outer_alt(_localctx.clone(), 2);
					recog.base.enter_outer_alt(None, 2);
					{
					recog.base.set_state(1385);
					recog.base.match_token(DELETE,&mut recog.err_handler)?;

					}
				}

			 INSERT 
				=> {
					//recog.base.enter_outer_alt(_localctx.clone(), 3);
					recog.base.enter_outer_alt(None, 3);
					{
					recog.base.set_state(1386);
					recog.base.match_token(INSERT,&mut recog.err_handler)?;

					}
				}

			 ADD | ALL | SOME | ANY | AT | NO | SUBSTRING | POSITION | TINYINT | SMALLINT |
			 INTEGER | DATE | TIME | TIMESTAMP | INTERVAL | YEAR | MONTH | DAY | HOUR |
			 MINUTE | SECOND | ZONE | FILTER | OVER | PARTITION | RANGE | ROWS | PRECEDING |
			 FOLLOWING | CURRENT | ROW | SCHEMA | COMMENT | VIEW | REPLACE | GRANT |
			 REVOKE | PRIVILEGES | PUBLIC | OPTION | EXPLAIN | ANALYZE | FORMAT |
			 TYPE | TEXT | GRAPHVIZ | LOGICAL | DISTRIBUTED | VALIDATE | SHOW | TABLES |
			 SCHEMAS | CATALOGS | COLUMNS | COLUMN | USE | PARTITIONS | FUNCTIONS |
			 TO | SYSTEM | BERNOULLI | POISSONIZED | TABLESAMPLE | ARRAY | MAP | SET |
			 RESET | SESSION | DATA | START | TRANSACTION | COMMIT | ROLLBACK | WORK |
			 ISOLATION | LEVEL | SERIALIZABLE | REPEATABLE | COMMITTED | UNCOMMITTED |
			 READ | WRITE | ONLY | CALL | INPUT | OUTPUT | CASCADE | RESTRICT | INCLUDING |
			 EXCLUDING | PROPERTIES | NFD | NFC | NFKD | NFKC | IF | NULLIF | COALESCE |
			 IDENTIFIER | DIGIT_IDENTIFIER | QUOTED_IDENTIFIER | BACKQUOTED_IDENTIFIER 
				=> {
					//recog.base.enter_outer_alt(_localctx.clone(), 4);
					recog.base.enter_outer_alt(None, 4);
					{
					/*InvokeRule identifier*/
					recog.base.set_state(1387);
					recog.identifier()?;

					}
				}

				_ => Err(ANTLRError::NoAltError(NoViableAltError::new(&mut recog.base)))?
			}
			Ok(())
		})();
		match result {
		Ok(_)=>{},
        Err(e @ ANTLRError::FallThrough(_)) => return Err(e),
		Err(ref re) => {
				//_localctx.exception = re;
				recog.err_handler.report_error(&mut recog.base, re);
				recog.err_handler.recover(&mut recog.base, re)?;
			}
		}
		recog.base.exit_rule();

		Ok(_localctx)
	}
}
//------------------- qualifiedName ----------------
pub type QualifiedNameContextAll<'input> = QualifiedNameContext<'input>;


pub type QualifiedNameContext<'input> = BaseParserRuleContext<'input,QualifiedNameContextExt<'input>>;

#[derive(Clone)]
pub struct QualifiedNameContextExt<'input>{
ph:PhantomData<&'input str>
}

impl<'input> athenasqlParserContext<'input> for QualifiedNameContext<'input>{}

impl<'input,'a> Listenable<dyn athenasqlListener<'input> + 'a> for QualifiedNameContext<'input>{
		fn enter(&self,listener: &mut (dyn athenasqlListener<'input> + 'a)) {
			listener.enter_every_rule(self);
			listener.enter_qualifiedName(self);
		}fn exit(&self,listener: &mut (dyn athenasqlListener<'input> + 'a)) {
			listener.exit_qualifiedName(self);
			listener.exit_every_rule(self);
		}
}

impl<'input> CustomRuleContext<'input> for QualifiedNameContextExt<'input>{
	type TF = LocalTokenFactory<'input>;
	type Ctx = athenasqlParserContextType;
	fn get_rule_index(&self) -> usize { RULE_qualifiedName }
	//fn type_rule_index() -> usize where Self: Sized { RULE_qualifiedName }
}
antlr_rust::tid!{QualifiedNameContextExt<'a>}

impl<'input> QualifiedNameContextExt<'input>{
	fn new(parent: Option<Rc<dyn athenasqlParserContext<'input> + 'input > >, invoking_state: isize) -> Rc<QualifiedNameContextAll<'input>> {
		Rc::new(
			BaseParserRuleContext::new_parser_ctx(parent, invoking_state,QualifiedNameContextExt{
				ph:PhantomData
			}),
		)
	}
}

pub trait QualifiedNameContextAttrs<'input>: athenasqlParserContext<'input> + BorrowMut<QualifiedNameContextExt<'input>>{

fn identifier_all(&self) ->  Vec<Rc<IdentifierContextAll<'input>>> where Self:Sized{
	self.children_of_type()
}
fn identifier(&self, i: usize) -> Option<Rc<IdentifierContextAll<'input>>> where Self:Sized{
	self.child_of_type(i)
}

}

impl<'input> QualifiedNameContextAttrs<'input> for QualifiedNameContext<'input>{}

impl<'input, I, H> athenasqlParser<'input, I, H>
where
    I: TokenStream<'input, TF = LocalTokenFactory<'input> > + TidAble<'input>,
    H: ErrorStrategy<'input,BaseParserType<'input,I>>
{
	pub fn qualifiedName(&mut self,)
	-> Result<Rc<QualifiedNameContextAll<'input>>,ANTLRError> {
		let mut recog = self;
		let _parentctx = recog.ctx.take();
		let mut _localctx = QualifiedNameContextExt::new(_parentctx.clone(), recog.base.get_state());
        recog.base.enter_rule(_localctx.clone(), 116, RULE_qualifiedName);
        let mut _localctx: Rc<QualifiedNameContextAll> = _localctx;
		let result: Result<(), ANTLRError> = (|| {

			let mut _alt: isize;
			//recog.base.enter_outer_alt(_localctx.clone(), 1);
			recog.base.enter_outer_alt(None, 1);
			{
			/*InvokeRule identifier*/
			recog.base.set_state(1390);
			recog.identifier()?;

			recog.base.set_state(1395);
			recog.err_handler.sync(&mut recog.base)?;
			_alt = recog.interpreter.adaptive_predict(168,&mut recog.base)?;
			while { _alt!=2 && _alt!=INVALID_ALT } {
				if _alt==1 {
					{
					{
					recog.base.set_state(1391);
					recog.base.match_token(T__0,&mut recog.err_handler)?;

					/*InvokeRule identifier*/
					recog.base.set_state(1392);
					recog.identifier()?;

					}
					} 
				}
				recog.base.set_state(1397);
				recog.err_handler.sync(&mut recog.base)?;
				_alt = recog.interpreter.adaptive_predict(168,&mut recog.base)?;
			}
			}
			Ok(())
		})();
		match result {
		Ok(_)=>{},
        Err(e @ ANTLRError::FallThrough(_)) => return Err(e),
		Err(ref re) => {
				//_localctx.exception = re;
				recog.err_handler.report_error(&mut recog.base, re);
				recog.err_handler.recover(&mut recog.base, re)?;
			}
		}
		recog.base.exit_rule();

		Ok(_localctx)
	}
}
//------------------- identifier ----------------
#[derive(Debug)]
pub enum IdentifierContextAll<'input>{
	BackQuotedIdentifierContext(BackQuotedIdentifierContext<'input>),
	QuotedIdentifierAlternativeContext(QuotedIdentifierAlternativeContext<'input>),
	DigitIdentifierContext(DigitIdentifierContext<'input>),
	UnquotedIdentifierContext(UnquotedIdentifierContext<'input>),
Error(IdentifierContext<'input>)
}
antlr_rust::tid!{IdentifierContextAll<'a>}

impl<'input> antlr_rust::parser_rule_context::DerefSeal for IdentifierContextAll<'input>{}

impl<'input> athenasqlParserContext<'input> for IdentifierContextAll<'input>{}

impl<'input> Deref for IdentifierContextAll<'input>{
	type Target = dyn IdentifierContextAttrs<'input> + 'input;
	fn deref(&self) -> &Self::Target{
		use IdentifierContextAll::*;
		match self{
			BackQuotedIdentifierContext(inner) => inner,
			QuotedIdentifierAlternativeContext(inner) => inner,
			DigitIdentifierContext(inner) => inner,
			UnquotedIdentifierContext(inner) => inner,
Error(inner) => inner
		}
	}
}
impl<'input,'a> Listenable<dyn athenasqlListener<'input> + 'a> for IdentifierContextAll<'input>{
    fn enter(&self, listener: &mut (dyn athenasqlListener<'input> + 'a)) { self.deref().enter(listener) }
    fn exit(&self, listener: &mut (dyn athenasqlListener<'input> + 'a)) { self.deref().exit(listener) }
}



pub type IdentifierContext<'input> = BaseParserRuleContext<'input,IdentifierContextExt<'input>>;

#[derive(Clone)]
pub struct IdentifierContextExt<'input>{
ph:PhantomData<&'input str>
}

impl<'input> athenasqlParserContext<'input> for IdentifierContext<'input>{}

impl<'input,'a> Listenable<dyn athenasqlListener<'input> + 'a> for IdentifierContext<'input>{
}

impl<'input> CustomRuleContext<'input> for IdentifierContextExt<'input>{
	type TF = LocalTokenFactory<'input>;
	type Ctx = athenasqlParserContextType;
	fn get_rule_index(&self) -> usize { RULE_identifier }
	//fn type_rule_index() -> usize where Self: Sized { RULE_identifier }
}
antlr_rust::tid!{IdentifierContextExt<'a>}

impl<'input> IdentifierContextExt<'input>{
	fn new(parent: Option<Rc<dyn athenasqlParserContext<'input> + 'input > >, invoking_state: isize) -> Rc<IdentifierContextAll<'input>> {
		Rc::new(
		IdentifierContextAll::Error(
			BaseParserRuleContext::new_parser_ctx(parent, invoking_state,IdentifierContextExt{
				ph:PhantomData
			}),
		)
		)
	}
}

pub trait IdentifierContextAttrs<'input>: athenasqlParserContext<'input> + BorrowMut<IdentifierContextExt<'input>>{


}

impl<'input> IdentifierContextAttrs<'input> for IdentifierContext<'input>{}

pub type BackQuotedIdentifierContext<'input> = BaseParserRuleContext<'input,BackQuotedIdentifierContextExt<'input>>;

pub trait BackQuotedIdentifierContextAttrs<'input>: athenasqlParserContext<'input>{
	/// Retrieves first TerminalNode corresponding to token BACKQUOTED_IDENTIFIER
	/// Returns `None` if there is no child corresponding to token BACKQUOTED_IDENTIFIER
	fn BACKQUOTED_IDENTIFIER(&self) -> Option<Rc<TerminalNode<'input,athenasqlParserContextType>>> where Self:Sized{
		self.get_token(BACKQUOTED_IDENTIFIER, 0)
	}
}

impl<'input> BackQuotedIdentifierContextAttrs<'input> for BackQuotedIdentifierContext<'input>{}

pub struct BackQuotedIdentifierContextExt<'input>{
	base:IdentifierContextExt<'input>,
	ph:PhantomData<&'input str>
}

antlr_rust::tid!{BackQuotedIdentifierContextExt<'a>}

impl<'input> athenasqlParserContext<'input> for BackQuotedIdentifierContext<'input>{}

impl<'input,'a> Listenable<dyn athenasqlListener<'input> + 'a> for BackQuotedIdentifierContext<'input>{
	fn enter(&self,listener: &mut (dyn athenasqlListener<'input> + 'a)) {
		listener.enter_every_rule(self);
		listener.enter_backQuotedIdentifier(self);
	}
}

impl<'input> CustomRuleContext<'input> for BackQuotedIdentifierContextExt<'input>{
	type TF = LocalTokenFactory<'input>;
	type Ctx = athenasqlParserContextType;
	fn get_rule_index(&self) -> usize { RULE_identifier }
	//fn type_rule_index() -> usize where Self: Sized { RULE_identifier }
}

impl<'input> Borrow<IdentifierContextExt<'input>> for BackQuotedIdentifierContext<'input>{
	fn borrow(&self) -> &IdentifierContextExt<'input> { &self.base }
}
impl<'input> BorrowMut<IdentifierContextExt<'input>> for BackQuotedIdentifierContext<'input>{
	fn borrow_mut(&mut self) -> &mut IdentifierContextExt<'input> { &mut self.base }
}

impl<'input> IdentifierContextAttrs<'input> for BackQuotedIdentifierContext<'input> {}

impl<'input> BackQuotedIdentifierContextExt<'input>{
	fn new(ctx: &dyn IdentifierContextAttrs<'input>) -> Rc<IdentifierContextAll<'input>>  {
		Rc::new(
			IdentifierContextAll::BackQuotedIdentifierContext(
				BaseParserRuleContext::copy_from(ctx,BackQuotedIdentifierContextExt{
        			base: ctx.borrow().clone(),
        			ph:PhantomData
				})
			)
		)
	}
}

pub type QuotedIdentifierAlternativeContext<'input> = BaseParserRuleContext<'input,QuotedIdentifierAlternativeContextExt<'input>>;

pub trait QuotedIdentifierAlternativeContextAttrs<'input>: athenasqlParserContext<'input>{
	fn quotedIdentifier(&self) -> Option<Rc<QuotedIdentifierContextAll<'input>>> where Self:Sized{
		self.child_of_type(0)
	}
}

impl<'input> QuotedIdentifierAlternativeContextAttrs<'input> for QuotedIdentifierAlternativeContext<'input>{}

pub struct QuotedIdentifierAlternativeContextExt<'input>{
	base:IdentifierContextExt<'input>,
	ph:PhantomData<&'input str>
}

antlr_rust::tid!{QuotedIdentifierAlternativeContextExt<'a>}

impl<'input> athenasqlParserContext<'input> for QuotedIdentifierAlternativeContext<'input>{}

impl<'input,'a> Listenable<dyn athenasqlListener<'input> + 'a> for QuotedIdentifierAlternativeContext<'input>{
	fn enter(&self,listener: &mut (dyn athenasqlListener<'input> + 'a)) {
		listener.enter_every_rule(self);
		listener.enter_quotedIdentifierAlternative(self);
	}
}

impl<'input> CustomRuleContext<'input> for QuotedIdentifierAlternativeContextExt<'input>{
	type TF = LocalTokenFactory<'input>;
	type Ctx = athenasqlParserContextType;
	fn get_rule_index(&self) -> usize { RULE_identifier }
	//fn type_rule_index() -> usize where Self: Sized { RULE_identifier }
}

impl<'input> Borrow<IdentifierContextExt<'input>> for QuotedIdentifierAlternativeContext<'input>{
	fn borrow(&self) -> &IdentifierContextExt<'input> { &self.base }
}
impl<'input> BorrowMut<IdentifierContextExt<'input>> for QuotedIdentifierAlternativeContext<'input>{
	fn borrow_mut(&mut self) -> &mut IdentifierContextExt<'input> { &mut self.base }
}

impl<'input> IdentifierContextAttrs<'input> for QuotedIdentifierAlternativeContext<'input> {}

impl<'input> QuotedIdentifierAlternativeContextExt<'input>{
	fn new(ctx: &dyn IdentifierContextAttrs<'input>) -> Rc<IdentifierContextAll<'input>>  {
		Rc::new(
			IdentifierContextAll::QuotedIdentifierAlternativeContext(
				BaseParserRuleContext::copy_from(ctx,QuotedIdentifierAlternativeContextExt{
        			base: ctx.borrow().clone(),
        			ph:PhantomData
				})
			)
		)
	}
}

pub type DigitIdentifierContext<'input> = BaseParserRuleContext<'input,DigitIdentifierContextExt<'input>>;

pub trait DigitIdentifierContextAttrs<'input>: athenasqlParserContext<'input>{
	/// Retrieves first TerminalNode corresponding to token DIGIT_IDENTIFIER
	/// Returns `None` if there is no child corresponding to token DIGIT_IDENTIFIER
	fn DIGIT_IDENTIFIER(&self) -> Option<Rc<TerminalNode<'input,athenasqlParserContextType>>> where Self:Sized{
		self.get_token(DIGIT_IDENTIFIER, 0)
	}
}

impl<'input> DigitIdentifierContextAttrs<'input> for DigitIdentifierContext<'input>{}

pub struct DigitIdentifierContextExt<'input>{
	base:IdentifierContextExt<'input>,
	ph:PhantomData<&'input str>
}

antlr_rust::tid!{DigitIdentifierContextExt<'a>}

impl<'input> athenasqlParserContext<'input> for DigitIdentifierContext<'input>{}

impl<'input,'a> Listenable<dyn athenasqlListener<'input> + 'a> for DigitIdentifierContext<'input>{
	fn enter(&self,listener: &mut (dyn athenasqlListener<'input> + 'a)) {
		listener.enter_every_rule(self);
		listener.enter_digitIdentifier(self);
	}
}

impl<'input> CustomRuleContext<'input> for DigitIdentifierContextExt<'input>{
	type TF = LocalTokenFactory<'input>;
	type Ctx = athenasqlParserContextType;
	fn get_rule_index(&self) -> usize { RULE_identifier }
	//fn type_rule_index() -> usize where Self: Sized { RULE_identifier }
}

impl<'input> Borrow<IdentifierContextExt<'input>> for DigitIdentifierContext<'input>{
	fn borrow(&self) -> &IdentifierContextExt<'input> { &self.base }
}
impl<'input> BorrowMut<IdentifierContextExt<'input>> for DigitIdentifierContext<'input>{
	fn borrow_mut(&mut self) -> &mut IdentifierContextExt<'input> { &mut self.base }
}

impl<'input> IdentifierContextAttrs<'input> for DigitIdentifierContext<'input> {}

impl<'input> DigitIdentifierContextExt<'input>{
	fn new(ctx: &dyn IdentifierContextAttrs<'input>) -> Rc<IdentifierContextAll<'input>>  {
		Rc::new(
			IdentifierContextAll::DigitIdentifierContext(
				BaseParserRuleContext::copy_from(ctx,DigitIdentifierContextExt{
        			base: ctx.borrow().clone(),
        			ph:PhantomData
				})
			)
		)
	}
}

pub type UnquotedIdentifierContext<'input> = BaseParserRuleContext<'input,UnquotedIdentifierContextExt<'input>>;

pub trait UnquotedIdentifierContextAttrs<'input>: athenasqlParserContext<'input>{
	/// Retrieves first TerminalNode corresponding to token IDENTIFIER
	/// Returns `None` if there is no child corresponding to token IDENTIFIER
	fn IDENTIFIER(&self) -> Option<Rc<TerminalNode<'input,athenasqlParserContextType>>> where Self:Sized{
		self.get_token(IDENTIFIER, 0)
	}
	fn nonReserved(&self) -> Option<Rc<NonReservedContextAll<'input>>> where Self:Sized{
		self.child_of_type(0)
	}
}

impl<'input> UnquotedIdentifierContextAttrs<'input> for UnquotedIdentifierContext<'input>{}

pub struct UnquotedIdentifierContextExt<'input>{
	base:IdentifierContextExt<'input>,
	ph:PhantomData<&'input str>
}

antlr_rust::tid!{UnquotedIdentifierContextExt<'a>}

impl<'input> athenasqlParserContext<'input> for UnquotedIdentifierContext<'input>{}

impl<'input,'a> Listenable<dyn athenasqlListener<'input> + 'a> for UnquotedIdentifierContext<'input>{
	fn enter(&self,listener: &mut (dyn athenasqlListener<'input> + 'a)) {
		listener.enter_every_rule(self);
		listener.enter_unquotedIdentifier(self);
	}
}

impl<'input> CustomRuleContext<'input> for UnquotedIdentifierContextExt<'input>{
	type TF = LocalTokenFactory<'input>;
	type Ctx = athenasqlParserContextType;
	fn get_rule_index(&self) -> usize { RULE_identifier }
	//fn type_rule_index() -> usize where Self: Sized { RULE_identifier }
}

impl<'input> Borrow<IdentifierContextExt<'input>> for UnquotedIdentifierContext<'input>{
	fn borrow(&self) -> &IdentifierContextExt<'input> { &self.base }
}
impl<'input> BorrowMut<IdentifierContextExt<'input>> for UnquotedIdentifierContext<'input>{
	fn borrow_mut(&mut self) -> &mut IdentifierContextExt<'input> { &mut self.base }
}

impl<'input> IdentifierContextAttrs<'input> for UnquotedIdentifierContext<'input> {}

impl<'input> UnquotedIdentifierContextExt<'input>{
	fn new(ctx: &dyn IdentifierContextAttrs<'input>) -> Rc<IdentifierContextAll<'input>>  {
		Rc::new(
			IdentifierContextAll::UnquotedIdentifierContext(
				BaseParserRuleContext::copy_from(ctx,UnquotedIdentifierContextExt{
        			base: ctx.borrow().clone(),
        			ph:PhantomData
				})
			)
		)
	}
}

impl<'input, I, H> athenasqlParser<'input, I, H>
where
    I: TokenStream<'input, TF = LocalTokenFactory<'input> > + TidAble<'input>,
    H: ErrorStrategy<'input,BaseParserType<'input,I>>
{
	pub fn identifier(&mut self,)
	-> Result<Rc<IdentifierContextAll<'input>>,ANTLRError> {
		let mut recog = self;
		let _parentctx = recog.ctx.take();
		let mut _localctx = IdentifierContextExt::new(_parentctx.clone(), recog.base.get_state());
        recog.base.enter_rule(_localctx.clone(), 118, RULE_identifier);
        let mut _localctx: Rc<IdentifierContextAll> = _localctx;
		let result: Result<(), ANTLRError> = (|| {

			recog.base.set_state(1403);
			recog.err_handler.sync(&mut recog.base)?;
			match recog.base.input.la(1) {
			 IDENTIFIER 
				=> {
					let tmp = UnquotedIdentifierContextExt::new(&**_localctx);
					recog.base.enter_outer_alt(Some(tmp.clone()), 1);
					_localctx = tmp;
					{
					recog.base.set_state(1398);
					recog.base.match_token(IDENTIFIER,&mut recog.err_handler)?;

					}
				}

			 QUOTED_IDENTIFIER 
				=> {
					let tmp = QuotedIdentifierAlternativeContextExt::new(&**_localctx);
					recog.base.enter_outer_alt(Some(tmp.clone()), 2);
					_localctx = tmp;
					{
					/*InvokeRule quotedIdentifier*/
					recog.base.set_state(1399);
					recog.quotedIdentifier()?;

					}
				}

			 ADD | ALL | SOME | ANY | AT | NO | SUBSTRING | POSITION | TINYINT | SMALLINT |
			 INTEGER | DATE | TIME | TIMESTAMP | INTERVAL | YEAR | MONTH | DAY | HOUR |
			 MINUTE | SECOND | ZONE | FILTER | OVER | PARTITION | RANGE | ROWS | PRECEDING |
			 FOLLOWING | CURRENT | ROW | SCHEMA | COMMENT | VIEW | REPLACE | GRANT |
			 REVOKE | PRIVILEGES | PUBLIC | OPTION | EXPLAIN | ANALYZE | FORMAT |
			 TYPE | TEXT | GRAPHVIZ | LOGICAL | DISTRIBUTED | VALIDATE | SHOW | TABLES |
			 SCHEMAS | CATALOGS | COLUMNS | COLUMN | USE | PARTITIONS | FUNCTIONS |
			 TO | SYSTEM | BERNOULLI | POISSONIZED | TABLESAMPLE | ARRAY | MAP | SET |
			 RESET | SESSION | DATA | START | TRANSACTION | COMMIT | ROLLBACK | WORK |
			 ISOLATION | LEVEL | SERIALIZABLE | REPEATABLE | COMMITTED | UNCOMMITTED |
			 READ | WRITE | ONLY | CALL | INPUT | OUTPUT | CASCADE | RESTRICT | INCLUDING |
			 EXCLUDING | PROPERTIES | NFD | NFC | NFKD | NFKC | IF | NULLIF | COALESCE 
				=> {
					let tmp = UnquotedIdentifierContextExt::new(&**_localctx);
					recog.base.enter_outer_alt(Some(tmp.clone()), 3);
					_localctx = tmp;
					{
					/*InvokeRule nonReserved*/
					recog.base.set_state(1400);
					recog.nonReserved()?;

					}
				}

			 BACKQUOTED_IDENTIFIER 
				=> {
					let tmp = BackQuotedIdentifierContextExt::new(&**_localctx);
					recog.base.enter_outer_alt(Some(tmp.clone()), 4);
					_localctx = tmp;
					{
					recog.base.set_state(1401);
					recog.base.match_token(BACKQUOTED_IDENTIFIER,&mut recog.err_handler)?;

					}
				}

			 DIGIT_IDENTIFIER 
				=> {
					let tmp = DigitIdentifierContextExt::new(&**_localctx);
					recog.base.enter_outer_alt(Some(tmp.clone()), 5);
					_localctx = tmp;
					{
					recog.base.set_state(1402);
					recog.base.match_token(DIGIT_IDENTIFIER,&mut recog.err_handler)?;

					}
				}

				_ => Err(ANTLRError::NoAltError(NoViableAltError::new(&mut recog.base)))?
			}
			Ok(())
		})();
		match result {
		Ok(_)=>{},
        Err(e @ ANTLRError::FallThrough(_)) => return Err(e),
		Err(ref re) => {
				//_localctx.exception = re;
				recog.err_handler.report_error(&mut recog.base, re);
				recog.err_handler.recover(&mut recog.base, re)?;
			}
		}
		recog.base.exit_rule();

		Ok(_localctx)
	}
}
//------------------- quotedIdentifier ----------------
pub type QuotedIdentifierContextAll<'input> = QuotedIdentifierContext<'input>;


pub type QuotedIdentifierContext<'input> = BaseParserRuleContext<'input,QuotedIdentifierContextExt<'input>>;

#[derive(Clone)]
pub struct QuotedIdentifierContextExt<'input>{
ph:PhantomData<&'input str>
}

impl<'input> athenasqlParserContext<'input> for QuotedIdentifierContext<'input>{}

impl<'input,'a> Listenable<dyn athenasqlListener<'input> + 'a> for QuotedIdentifierContext<'input>{
		fn enter(&self,listener: &mut (dyn athenasqlListener<'input> + 'a)) {
			listener.enter_every_rule(self);
			listener.enter_quotedIdentifier(self);
		}fn exit(&self,listener: &mut (dyn athenasqlListener<'input> + 'a)) {
			listener.exit_quotedIdentifier(self);
			listener.exit_every_rule(self);
		}
}

impl<'input> CustomRuleContext<'input> for QuotedIdentifierContextExt<'input>{
	type TF = LocalTokenFactory<'input>;
	type Ctx = athenasqlParserContextType;
	fn get_rule_index(&self) -> usize { RULE_quotedIdentifier }
	//fn type_rule_index() -> usize where Self: Sized { RULE_quotedIdentifier }
}
antlr_rust::tid!{QuotedIdentifierContextExt<'a>}

impl<'input> QuotedIdentifierContextExt<'input>{
	fn new(parent: Option<Rc<dyn athenasqlParserContext<'input> + 'input > >, invoking_state: isize) -> Rc<QuotedIdentifierContextAll<'input>> {
		Rc::new(
			BaseParserRuleContext::new_parser_ctx(parent, invoking_state,QuotedIdentifierContextExt{
				ph:PhantomData
			}),
		)
	}
}

pub trait QuotedIdentifierContextAttrs<'input>: athenasqlParserContext<'input> + BorrowMut<QuotedIdentifierContextExt<'input>>{

/// Retrieves first TerminalNode corresponding to token QUOTED_IDENTIFIER
/// Returns `None` if there is no child corresponding to token QUOTED_IDENTIFIER
fn QUOTED_IDENTIFIER(&self) -> Option<Rc<TerminalNode<'input,athenasqlParserContextType>>> where Self:Sized{
	self.get_token(QUOTED_IDENTIFIER, 0)
}

}

impl<'input> QuotedIdentifierContextAttrs<'input> for QuotedIdentifierContext<'input>{}

impl<'input, I, H> athenasqlParser<'input, I, H>
where
    I: TokenStream<'input, TF = LocalTokenFactory<'input> > + TidAble<'input>,
    H: ErrorStrategy<'input,BaseParserType<'input,I>>
{
	pub fn quotedIdentifier(&mut self,)
	-> Result<Rc<QuotedIdentifierContextAll<'input>>,ANTLRError> {
		let mut recog = self;
		let _parentctx = recog.ctx.take();
		let mut _localctx = QuotedIdentifierContextExt::new(_parentctx.clone(), recog.base.get_state());
        recog.base.enter_rule(_localctx.clone(), 120, RULE_quotedIdentifier);
        let mut _localctx: Rc<QuotedIdentifierContextAll> = _localctx;
		let result: Result<(), ANTLRError> = (|| {

			//recog.base.enter_outer_alt(_localctx.clone(), 1);
			recog.base.enter_outer_alt(None, 1);
			{
			recog.base.set_state(1405);
			recog.base.match_token(QUOTED_IDENTIFIER,&mut recog.err_handler)?;

			}
			Ok(())
		})();
		match result {
		Ok(_)=>{},
        Err(e @ ANTLRError::FallThrough(_)) => return Err(e),
		Err(ref re) => {
				//_localctx.exception = re;
				recog.err_handler.report_error(&mut recog.base, re);
				recog.err_handler.recover(&mut recog.base, re)?;
			}
		}
		recog.base.exit_rule();

		Ok(_localctx)
	}
}
//------------------- number ----------------
#[derive(Debug)]
pub enum NumberContextAll<'input>{
	DecimalLiteralContext(DecimalLiteralContext<'input>),
	IntegerLiteralContext(IntegerLiteralContext<'input>),
Error(NumberContext<'input>)
}
antlr_rust::tid!{NumberContextAll<'a>}

impl<'input> antlr_rust::parser_rule_context::DerefSeal for NumberContextAll<'input>{}

impl<'input> athenasqlParserContext<'input> for NumberContextAll<'input>{}

impl<'input> Deref for NumberContextAll<'input>{
	type Target = dyn NumberContextAttrs<'input> + 'input;
	fn deref(&self) -> &Self::Target{
		use NumberContextAll::*;
		match self{
			DecimalLiteralContext(inner) => inner,
			IntegerLiteralContext(inner) => inner,
Error(inner) => inner
		}
	}
}
impl<'input,'a> Listenable<dyn athenasqlListener<'input> + 'a> for NumberContextAll<'input>{
    fn enter(&self, listener: &mut (dyn athenasqlListener<'input> + 'a)) { self.deref().enter(listener) }
    fn exit(&self, listener: &mut (dyn athenasqlListener<'input> + 'a)) { self.deref().exit(listener) }
}



pub type NumberContext<'input> = BaseParserRuleContext<'input,NumberContextExt<'input>>;

#[derive(Clone)]
pub struct NumberContextExt<'input>{
ph:PhantomData<&'input str>
}

impl<'input> athenasqlParserContext<'input> for NumberContext<'input>{}

impl<'input,'a> Listenable<dyn athenasqlListener<'input> + 'a> for NumberContext<'input>{
}

impl<'input> CustomRuleContext<'input> for NumberContextExt<'input>{
	type TF = LocalTokenFactory<'input>;
	type Ctx = athenasqlParserContextType;
	fn get_rule_index(&self) -> usize { RULE_number }
	//fn type_rule_index() -> usize where Self: Sized { RULE_number }
}
antlr_rust::tid!{NumberContextExt<'a>}

impl<'input> NumberContextExt<'input>{
	fn new(parent: Option<Rc<dyn athenasqlParserContext<'input> + 'input > >, invoking_state: isize) -> Rc<NumberContextAll<'input>> {
		Rc::new(
		NumberContextAll::Error(
			BaseParserRuleContext::new_parser_ctx(parent, invoking_state,NumberContextExt{
				ph:PhantomData
			}),
		)
		)
	}
}

pub trait NumberContextAttrs<'input>: athenasqlParserContext<'input> + BorrowMut<NumberContextExt<'input>>{


}

impl<'input> NumberContextAttrs<'input> for NumberContext<'input>{}

pub type DecimalLiteralContext<'input> = BaseParserRuleContext<'input,DecimalLiteralContextExt<'input>>;

pub trait DecimalLiteralContextAttrs<'input>: athenasqlParserContext<'input>{
	/// Retrieves first TerminalNode corresponding to token DECIMAL_VALUE
	/// Returns `None` if there is no child corresponding to token DECIMAL_VALUE
	fn DECIMAL_VALUE(&self) -> Option<Rc<TerminalNode<'input,athenasqlParserContextType>>> where Self:Sized{
		self.get_token(DECIMAL_VALUE, 0)
	}
}

impl<'input> DecimalLiteralContextAttrs<'input> for DecimalLiteralContext<'input>{}

pub struct DecimalLiteralContextExt<'input>{
	base:NumberContextExt<'input>,
	ph:PhantomData<&'input str>
}

antlr_rust::tid!{DecimalLiteralContextExt<'a>}

impl<'input> athenasqlParserContext<'input> for DecimalLiteralContext<'input>{}

impl<'input,'a> Listenable<dyn athenasqlListener<'input> + 'a> for DecimalLiteralContext<'input>{
	fn enter(&self,listener: &mut (dyn athenasqlListener<'input> + 'a)) {
		listener.enter_every_rule(self);
		listener.enter_decimalLiteral(self);
	}
}

impl<'input> CustomRuleContext<'input> for DecimalLiteralContextExt<'input>{
	type TF = LocalTokenFactory<'input>;
	type Ctx = athenasqlParserContextType;
	fn get_rule_index(&self) -> usize { RULE_number }
	//fn type_rule_index() -> usize where Self: Sized { RULE_number }
}

impl<'input> Borrow<NumberContextExt<'input>> for DecimalLiteralContext<'input>{
	fn borrow(&self) -> &NumberContextExt<'input> { &self.base }
}
impl<'input> BorrowMut<NumberContextExt<'input>> for DecimalLiteralContext<'input>{
	fn borrow_mut(&mut self) -> &mut NumberContextExt<'input> { &mut self.base }
}

impl<'input> NumberContextAttrs<'input> for DecimalLiteralContext<'input> {}

impl<'input> DecimalLiteralContextExt<'input>{
	fn new(ctx: &dyn NumberContextAttrs<'input>) -> Rc<NumberContextAll<'input>>  {
		Rc::new(
			NumberContextAll::DecimalLiteralContext(
				BaseParserRuleContext::copy_from(ctx,DecimalLiteralContextExt{
        			base: ctx.borrow().clone(),
        			ph:PhantomData
				})
			)
		)
	}
}

pub type IntegerLiteralContext<'input> = BaseParserRuleContext<'input,IntegerLiteralContextExt<'input>>;

pub trait IntegerLiteralContextAttrs<'input>: athenasqlParserContext<'input>{
	/// Retrieves first TerminalNode corresponding to token INTEGER_VALUE
	/// Returns `None` if there is no child corresponding to token INTEGER_VALUE
	fn INTEGER_VALUE(&self) -> Option<Rc<TerminalNode<'input,athenasqlParserContextType>>> where Self:Sized{
		self.get_token(INTEGER_VALUE, 0)
	}
}

impl<'input> IntegerLiteralContextAttrs<'input> for IntegerLiteralContext<'input>{}

pub struct IntegerLiteralContextExt<'input>{
	base:NumberContextExt<'input>,
	ph:PhantomData<&'input str>
}

antlr_rust::tid!{IntegerLiteralContextExt<'a>}

impl<'input> athenasqlParserContext<'input> for IntegerLiteralContext<'input>{}

impl<'input,'a> Listenable<dyn athenasqlListener<'input> + 'a> for IntegerLiteralContext<'input>{
	fn enter(&self,listener: &mut (dyn athenasqlListener<'input> + 'a)) {
		listener.enter_every_rule(self);
		listener.enter_integerLiteral(self);
	}
}

impl<'input> CustomRuleContext<'input> for IntegerLiteralContextExt<'input>{
	type TF = LocalTokenFactory<'input>;
	type Ctx = athenasqlParserContextType;
	fn get_rule_index(&self) -> usize { RULE_number }
	//fn type_rule_index() -> usize where Self: Sized { RULE_number }
}

impl<'input> Borrow<NumberContextExt<'input>> for IntegerLiteralContext<'input>{
	fn borrow(&self) -> &NumberContextExt<'input> { &self.base }
}
impl<'input> BorrowMut<NumberContextExt<'input>> for IntegerLiteralContext<'input>{
	fn borrow_mut(&mut self) -> &mut NumberContextExt<'input> { &mut self.base }
}

impl<'input> NumberContextAttrs<'input> for IntegerLiteralContext<'input> {}

impl<'input> IntegerLiteralContextExt<'input>{
	fn new(ctx: &dyn NumberContextAttrs<'input>) -> Rc<NumberContextAll<'input>>  {
		Rc::new(
			NumberContextAll::IntegerLiteralContext(
				BaseParserRuleContext::copy_from(ctx,IntegerLiteralContextExt{
        			base: ctx.borrow().clone(),
        			ph:PhantomData
				})
			)
		)
	}
}

impl<'input, I, H> athenasqlParser<'input, I, H>
where
    I: TokenStream<'input, TF = LocalTokenFactory<'input> > + TidAble<'input>,
    H: ErrorStrategy<'input,BaseParserType<'input,I>>
{
	pub fn number(&mut self,)
	-> Result<Rc<NumberContextAll<'input>>,ANTLRError> {
		let mut recog = self;
		let _parentctx = recog.ctx.take();
		let mut _localctx = NumberContextExt::new(_parentctx.clone(), recog.base.get_state());
        recog.base.enter_rule(_localctx.clone(), 122, RULE_number);
        let mut _localctx: Rc<NumberContextAll> = _localctx;
		let result: Result<(), ANTLRError> = (|| {

			recog.base.set_state(1409);
			recog.err_handler.sync(&mut recog.base)?;
			match recog.base.input.la(1) {
			 DECIMAL_VALUE 
				=> {
					let tmp = DecimalLiteralContextExt::new(&**_localctx);
					recog.base.enter_outer_alt(Some(tmp.clone()), 1);
					_localctx = tmp;
					{
					recog.base.set_state(1407);
					recog.base.match_token(DECIMAL_VALUE,&mut recog.err_handler)?;

					}
				}

			 INTEGER_VALUE 
				=> {
					let tmp = IntegerLiteralContextExt::new(&**_localctx);
					recog.base.enter_outer_alt(Some(tmp.clone()), 2);
					_localctx = tmp;
					{
					recog.base.set_state(1408);
					recog.base.match_token(INTEGER_VALUE,&mut recog.err_handler)?;

					}
				}

				_ => Err(ANTLRError::NoAltError(NoViableAltError::new(&mut recog.base)))?
			}
			Ok(())
		})();
		match result {
		Ok(_)=>{},
        Err(e @ ANTLRError::FallThrough(_)) => return Err(e),
		Err(ref re) => {
				//_localctx.exception = re;
				recog.err_handler.report_error(&mut recog.base, re);
				recog.err_handler.recover(&mut recog.base, re)?;
			}
		}
		recog.base.exit_rule();

		Ok(_localctx)
	}
}
//------------------- nonReserved ----------------
pub type NonReservedContextAll<'input> = NonReservedContext<'input>;


pub type NonReservedContext<'input> = BaseParserRuleContext<'input,NonReservedContextExt<'input>>;

#[derive(Clone)]
pub struct NonReservedContextExt<'input>{
ph:PhantomData<&'input str>
}

impl<'input> athenasqlParserContext<'input> for NonReservedContext<'input>{}

impl<'input,'a> Listenable<dyn athenasqlListener<'input> + 'a> for NonReservedContext<'input>{
		fn enter(&self,listener: &mut (dyn athenasqlListener<'input> + 'a)) {
			listener.enter_every_rule(self);
			listener.enter_nonReserved(self);
		}fn exit(&self,listener: &mut (dyn athenasqlListener<'input> + 'a)) {
			listener.exit_nonReserved(self);
			listener.exit_every_rule(self);
		}
}

impl<'input> CustomRuleContext<'input> for NonReservedContextExt<'input>{
	type TF = LocalTokenFactory<'input>;
	type Ctx = athenasqlParserContextType;
	fn get_rule_index(&self) -> usize { RULE_nonReserved }
	//fn type_rule_index() -> usize where Self: Sized { RULE_nonReserved }
}
antlr_rust::tid!{NonReservedContextExt<'a>}

impl<'input> NonReservedContextExt<'input>{
	fn new(parent: Option<Rc<dyn athenasqlParserContext<'input> + 'input > >, invoking_state: isize) -> Rc<NonReservedContextAll<'input>> {
		Rc::new(
			BaseParserRuleContext::new_parser_ctx(parent, invoking_state,NonReservedContextExt{
				ph:PhantomData
			}),
		)
	}
}

pub trait NonReservedContextAttrs<'input>: athenasqlParserContext<'input> + BorrowMut<NonReservedContextExt<'input>>{

/// Retrieves first TerminalNode corresponding to token SHOW
/// Returns `None` if there is no child corresponding to token SHOW
fn SHOW(&self) -> Option<Rc<TerminalNode<'input,athenasqlParserContextType>>> where Self:Sized{
	self.get_token(SHOW, 0)
}
/// Retrieves first TerminalNode corresponding to token TABLES
/// Returns `None` if there is no child corresponding to token TABLES
fn TABLES(&self) -> Option<Rc<TerminalNode<'input,athenasqlParserContextType>>> where Self:Sized{
	self.get_token(TABLES, 0)
}
/// Retrieves first TerminalNode corresponding to token COLUMNS
/// Returns `None` if there is no child corresponding to token COLUMNS
fn COLUMNS(&self) -> Option<Rc<TerminalNode<'input,athenasqlParserContextType>>> where Self:Sized{
	self.get_token(COLUMNS, 0)
}
/// Retrieves first TerminalNode corresponding to token COLUMN
/// Returns `None` if there is no child corresponding to token COLUMN
fn COLUMN(&self) -> Option<Rc<TerminalNode<'input,athenasqlParserContextType>>> where Self:Sized{
	self.get_token(COLUMN, 0)
}
/// Retrieves first TerminalNode corresponding to token PARTITIONS
/// Returns `None` if there is no child corresponding to token PARTITIONS
fn PARTITIONS(&self) -> Option<Rc<TerminalNode<'input,athenasqlParserContextType>>> where Self:Sized{
	self.get_token(PARTITIONS, 0)
}
/// Retrieves first TerminalNode corresponding to token FUNCTIONS
/// Returns `None` if there is no child corresponding to token FUNCTIONS
fn FUNCTIONS(&self) -> Option<Rc<TerminalNode<'input,athenasqlParserContextType>>> where Self:Sized{
	self.get_token(FUNCTIONS, 0)
}
/// Retrieves first TerminalNode corresponding to token SCHEMAS
/// Returns `None` if there is no child corresponding to token SCHEMAS
fn SCHEMAS(&self) -> Option<Rc<TerminalNode<'input,athenasqlParserContextType>>> where Self:Sized{
	self.get_token(SCHEMAS, 0)
}
/// Retrieves first TerminalNode corresponding to token CATALOGS
/// Returns `None` if there is no child corresponding to token CATALOGS
fn CATALOGS(&self) -> Option<Rc<TerminalNode<'input,athenasqlParserContextType>>> where Self:Sized{
	self.get_token(CATALOGS, 0)
}
/// Retrieves first TerminalNode corresponding to token SESSION
/// Returns `None` if there is no child corresponding to token SESSION
fn SESSION(&self) -> Option<Rc<TerminalNode<'input,athenasqlParserContextType>>> where Self:Sized{
	self.get_token(SESSION, 0)
}
/// Retrieves first TerminalNode corresponding to token ADD
/// Returns `None` if there is no child corresponding to token ADD
fn ADD(&self) -> Option<Rc<TerminalNode<'input,athenasqlParserContextType>>> where Self:Sized{
	self.get_token(ADD, 0)
}
/// Retrieves first TerminalNode corresponding to token FILTER
/// Returns `None` if there is no child corresponding to token FILTER
fn FILTER(&self) -> Option<Rc<TerminalNode<'input,athenasqlParserContextType>>> where Self:Sized{
	self.get_token(FILTER, 0)
}
/// Retrieves first TerminalNode corresponding to token AT
/// Returns `None` if there is no child corresponding to token AT
fn AT(&self) -> Option<Rc<TerminalNode<'input,athenasqlParserContextType>>> where Self:Sized{
	self.get_token(AT, 0)
}
/// Retrieves first TerminalNode corresponding to token OVER
/// Returns `None` if there is no child corresponding to token OVER
fn OVER(&self) -> Option<Rc<TerminalNode<'input,athenasqlParserContextType>>> where Self:Sized{
	self.get_token(OVER, 0)
}
/// Retrieves first TerminalNode corresponding to token PARTITION
/// Returns `None` if there is no child corresponding to token PARTITION
fn PARTITION(&self) -> Option<Rc<TerminalNode<'input,athenasqlParserContextType>>> where Self:Sized{
	self.get_token(PARTITION, 0)
}
/// Retrieves first TerminalNode corresponding to token RANGE
/// Returns `None` if there is no child corresponding to token RANGE
fn RANGE(&self) -> Option<Rc<TerminalNode<'input,athenasqlParserContextType>>> where Self:Sized{
	self.get_token(RANGE, 0)
}
/// Retrieves first TerminalNode corresponding to token ROWS
/// Returns `None` if there is no child corresponding to token ROWS
fn ROWS(&self) -> Option<Rc<TerminalNode<'input,athenasqlParserContextType>>> where Self:Sized{
	self.get_token(ROWS, 0)
}
/// Retrieves first TerminalNode corresponding to token PRECEDING
/// Returns `None` if there is no child corresponding to token PRECEDING
fn PRECEDING(&self) -> Option<Rc<TerminalNode<'input,athenasqlParserContextType>>> where Self:Sized{
	self.get_token(PRECEDING, 0)
}
/// Retrieves first TerminalNode corresponding to token FOLLOWING
/// Returns `None` if there is no child corresponding to token FOLLOWING
fn FOLLOWING(&self) -> Option<Rc<TerminalNode<'input,athenasqlParserContextType>>> where Self:Sized{
	self.get_token(FOLLOWING, 0)
}
/// Retrieves first TerminalNode corresponding to token CURRENT
/// Returns `None` if there is no child corresponding to token CURRENT
fn CURRENT(&self) -> Option<Rc<TerminalNode<'input,athenasqlParserContextType>>> where Self:Sized{
	self.get_token(CURRENT, 0)
}
/// Retrieves first TerminalNode corresponding to token ROW
/// Returns `None` if there is no child corresponding to token ROW
fn ROW(&self) -> Option<Rc<TerminalNode<'input,athenasqlParserContextType>>> where Self:Sized{
	self.get_token(ROW, 0)
}
/// Retrieves first TerminalNode corresponding to token MAP
/// Returns `None` if there is no child corresponding to token MAP
fn MAP(&self) -> Option<Rc<TerminalNode<'input,athenasqlParserContextType>>> where Self:Sized{
	self.get_token(MAP, 0)
}
/// Retrieves first TerminalNode corresponding to token ARRAY
/// Returns `None` if there is no child corresponding to token ARRAY
fn ARRAY(&self) -> Option<Rc<TerminalNode<'input,athenasqlParserContextType>>> where Self:Sized{
	self.get_token(ARRAY, 0)
}
/// Retrieves first TerminalNode corresponding to token TINYINT
/// Returns `None` if there is no child corresponding to token TINYINT
fn TINYINT(&self) -> Option<Rc<TerminalNode<'input,athenasqlParserContextType>>> where Self:Sized{
	self.get_token(TINYINT, 0)
}
/// Retrieves first TerminalNode corresponding to token SMALLINT
/// Returns `None` if there is no child corresponding to token SMALLINT
fn SMALLINT(&self) -> Option<Rc<TerminalNode<'input,athenasqlParserContextType>>> where Self:Sized{
	self.get_token(SMALLINT, 0)
}
/// Retrieves first TerminalNode corresponding to token INTEGER
/// Returns `None` if there is no child corresponding to token INTEGER
fn INTEGER(&self) -> Option<Rc<TerminalNode<'input,athenasqlParserContextType>>> where Self:Sized{
	self.get_token(INTEGER, 0)
}
/// Retrieves first TerminalNode corresponding to token DATE
/// Returns `None` if there is no child corresponding to token DATE
fn DATE(&self) -> Option<Rc<TerminalNode<'input,athenasqlParserContextType>>> where Self:Sized{
	self.get_token(DATE, 0)
}
/// Retrieves first TerminalNode corresponding to token TIME
/// Returns `None` if there is no child corresponding to token TIME
fn TIME(&self) -> Option<Rc<TerminalNode<'input,athenasqlParserContextType>>> where Self:Sized{
	self.get_token(TIME, 0)
}
/// Retrieves first TerminalNode corresponding to token TIMESTAMP
/// Returns `None` if there is no child corresponding to token TIMESTAMP
fn TIMESTAMP(&self) -> Option<Rc<TerminalNode<'input,athenasqlParserContextType>>> where Self:Sized{
	self.get_token(TIMESTAMP, 0)
}
/// Retrieves first TerminalNode corresponding to token INTERVAL
/// Returns `None` if there is no child corresponding to token INTERVAL
fn INTERVAL(&self) -> Option<Rc<TerminalNode<'input,athenasqlParserContextType>>> where Self:Sized{
	self.get_token(INTERVAL, 0)
}
/// Retrieves first TerminalNode corresponding to token ZONE
/// Returns `None` if there is no child corresponding to token ZONE
fn ZONE(&self) -> Option<Rc<TerminalNode<'input,athenasqlParserContextType>>> where Self:Sized{
	self.get_token(ZONE, 0)
}
/// Retrieves first TerminalNode corresponding to token YEAR
/// Returns `None` if there is no child corresponding to token YEAR
fn YEAR(&self) -> Option<Rc<TerminalNode<'input,athenasqlParserContextType>>> where Self:Sized{
	self.get_token(YEAR, 0)
}
/// Retrieves first TerminalNode corresponding to token MONTH
/// Returns `None` if there is no child corresponding to token MONTH
fn MONTH(&self) -> Option<Rc<TerminalNode<'input,athenasqlParserContextType>>> where Self:Sized{
	self.get_token(MONTH, 0)
}
/// Retrieves first TerminalNode corresponding to token DAY
/// Returns `None` if there is no child corresponding to token DAY
fn DAY(&self) -> Option<Rc<TerminalNode<'input,athenasqlParserContextType>>> where Self:Sized{
	self.get_token(DAY, 0)
}
/// Retrieves first TerminalNode corresponding to token HOUR
/// Returns `None` if there is no child corresponding to token HOUR
fn HOUR(&self) -> Option<Rc<TerminalNode<'input,athenasqlParserContextType>>> where Self:Sized{
	self.get_token(HOUR, 0)
}
/// Retrieves first TerminalNode corresponding to token MINUTE
/// Returns `None` if there is no child corresponding to token MINUTE
fn MINUTE(&self) -> Option<Rc<TerminalNode<'input,athenasqlParserContextType>>> where Self:Sized{
	self.get_token(MINUTE, 0)
}
/// Retrieves first TerminalNode corresponding to token SECOND
/// Returns `None` if there is no child corresponding to token SECOND
fn SECOND(&self) -> Option<Rc<TerminalNode<'input,athenasqlParserContextType>>> where Self:Sized{
	self.get_token(SECOND, 0)
}
/// Retrieves first TerminalNode corresponding to token EXPLAIN
/// Returns `None` if there is no child corresponding to token EXPLAIN
fn EXPLAIN(&self) -> Option<Rc<TerminalNode<'input,athenasqlParserContextType>>> where Self:Sized{
	self.get_token(EXPLAIN, 0)
}
/// Retrieves first TerminalNode corresponding to token ANALYZE
/// Returns `None` if there is no child corresponding to token ANALYZE
fn ANALYZE(&self) -> Option<Rc<TerminalNode<'input,athenasqlParserContextType>>> where Self:Sized{
	self.get_token(ANALYZE, 0)
}
/// Retrieves first TerminalNode corresponding to token FORMAT
/// Returns `None` if there is no child corresponding to token FORMAT
fn FORMAT(&self) -> Option<Rc<TerminalNode<'input,athenasqlParserContextType>>> where Self:Sized{
	self.get_token(FORMAT, 0)
}
/// Retrieves first TerminalNode corresponding to token TYPE
/// Returns `None` if there is no child corresponding to token TYPE
fn TYPE(&self) -> Option<Rc<TerminalNode<'input,athenasqlParserContextType>>> where Self:Sized{
	self.get_token(TYPE, 0)
}
/// Retrieves first TerminalNode corresponding to token TEXT
/// Returns `None` if there is no child corresponding to token TEXT
fn TEXT(&self) -> Option<Rc<TerminalNode<'input,athenasqlParserContextType>>> where Self:Sized{
	self.get_token(TEXT, 0)
}
/// Retrieves first TerminalNode corresponding to token GRAPHVIZ
/// Returns `None` if there is no child corresponding to token GRAPHVIZ
fn GRAPHVIZ(&self) -> Option<Rc<TerminalNode<'input,athenasqlParserContextType>>> where Self:Sized{
	self.get_token(GRAPHVIZ, 0)
}
/// Retrieves first TerminalNode corresponding to token LOGICAL
/// Returns `None` if there is no child corresponding to token LOGICAL
fn LOGICAL(&self) -> Option<Rc<TerminalNode<'input,athenasqlParserContextType>>> where Self:Sized{
	self.get_token(LOGICAL, 0)
}
/// Retrieves first TerminalNode corresponding to token DISTRIBUTED
/// Returns `None` if there is no child corresponding to token DISTRIBUTED
fn DISTRIBUTED(&self) -> Option<Rc<TerminalNode<'input,athenasqlParserContextType>>> where Self:Sized{
	self.get_token(DISTRIBUTED, 0)
}
/// Retrieves first TerminalNode corresponding to token VALIDATE
/// Returns `None` if there is no child corresponding to token VALIDATE
fn VALIDATE(&self) -> Option<Rc<TerminalNode<'input,athenasqlParserContextType>>> where Self:Sized{
	self.get_token(VALIDATE, 0)
}
/// Retrieves first TerminalNode corresponding to token TABLESAMPLE
/// Returns `None` if there is no child corresponding to token TABLESAMPLE
fn TABLESAMPLE(&self) -> Option<Rc<TerminalNode<'input,athenasqlParserContextType>>> where Self:Sized{
	self.get_token(TABLESAMPLE, 0)
}
/// Retrieves first TerminalNode corresponding to token SYSTEM
/// Returns `None` if there is no child corresponding to token SYSTEM
fn SYSTEM(&self) -> Option<Rc<TerminalNode<'input,athenasqlParserContextType>>> where Self:Sized{
	self.get_token(SYSTEM, 0)
}
/// Retrieves first TerminalNode corresponding to token BERNOULLI
/// Returns `None` if there is no child corresponding to token BERNOULLI
fn BERNOULLI(&self) -> Option<Rc<TerminalNode<'input,athenasqlParserContextType>>> where Self:Sized{
	self.get_token(BERNOULLI, 0)
}
/// Retrieves first TerminalNode corresponding to token POISSONIZED
/// Returns `None` if there is no child corresponding to token POISSONIZED
fn POISSONIZED(&self) -> Option<Rc<TerminalNode<'input,athenasqlParserContextType>>> where Self:Sized{
	self.get_token(POISSONIZED, 0)
}
/// Retrieves first TerminalNode corresponding to token USE
/// Returns `None` if there is no child corresponding to token USE
fn USE(&self) -> Option<Rc<TerminalNode<'input,athenasqlParserContextType>>> where Self:Sized{
	self.get_token(USE, 0)
}
/// Retrieves first TerminalNode corresponding to token TO
/// Returns `None` if there is no child corresponding to token TO
fn TO(&self) -> Option<Rc<TerminalNode<'input,athenasqlParserContextType>>> where Self:Sized{
	self.get_token(TO, 0)
}
/// Retrieves first TerminalNode corresponding to token SET
/// Returns `None` if there is no child corresponding to token SET
fn SET(&self) -> Option<Rc<TerminalNode<'input,athenasqlParserContextType>>> where Self:Sized{
	self.get_token(SET, 0)
}
/// Retrieves first TerminalNode corresponding to token RESET
/// Returns `None` if there is no child corresponding to token RESET
fn RESET(&self) -> Option<Rc<TerminalNode<'input,athenasqlParserContextType>>> where Self:Sized{
	self.get_token(RESET, 0)
}
/// Retrieves first TerminalNode corresponding to token VIEW
/// Returns `None` if there is no child corresponding to token VIEW
fn VIEW(&self) -> Option<Rc<TerminalNode<'input,athenasqlParserContextType>>> where Self:Sized{
	self.get_token(VIEW, 0)
}
/// Retrieves first TerminalNode corresponding to token REPLACE
/// Returns `None` if there is no child corresponding to token REPLACE
fn REPLACE(&self) -> Option<Rc<TerminalNode<'input,athenasqlParserContextType>>> where Self:Sized{
	self.get_token(REPLACE, 0)
}
/// Retrieves first TerminalNode corresponding to token IF
/// Returns `None` if there is no child corresponding to token IF
fn IF(&self) -> Option<Rc<TerminalNode<'input,athenasqlParserContextType>>> where Self:Sized{
	self.get_token(IF, 0)
}
/// Retrieves first TerminalNode corresponding to token NULLIF
/// Returns `None` if there is no child corresponding to token NULLIF
fn NULLIF(&self) -> Option<Rc<TerminalNode<'input,athenasqlParserContextType>>> where Self:Sized{
	self.get_token(NULLIF, 0)
}
/// Retrieves first TerminalNode corresponding to token COALESCE
/// Returns `None` if there is no child corresponding to token COALESCE
fn COALESCE(&self) -> Option<Rc<TerminalNode<'input,athenasqlParserContextType>>> where Self:Sized{
	self.get_token(COALESCE, 0)
}
fn normalForm(&self) -> Option<Rc<NormalFormContextAll<'input>>> where Self:Sized{
	self.child_of_type(0)
}
/// Retrieves first TerminalNode corresponding to token POSITION
/// Returns `None` if there is no child corresponding to token POSITION
fn POSITION(&self) -> Option<Rc<TerminalNode<'input,athenasqlParserContextType>>> where Self:Sized{
	self.get_token(POSITION, 0)
}
/// Retrieves first TerminalNode corresponding to token NO
/// Returns `None` if there is no child corresponding to token NO
fn NO(&self) -> Option<Rc<TerminalNode<'input,athenasqlParserContextType>>> where Self:Sized{
	self.get_token(NO, 0)
}
/// Retrieves first TerminalNode corresponding to token DATA
/// Returns `None` if there is no child corresponding to token DATA
fn DATA(&self) -> Option<Rc<TerminalNode<'input,athenasqlParserContextType>>> where Self:Sized{
	self.get_token(DATA, 0)
}
/// Retrieves first TerminalNode corresponding to token START
/// Returns `None` if there is no child corresponding to token START
fn START(&self) -> Option<Rc<TerminalNode<'input,athenasqlParserContextType>>> where Self:Sized{
	self.get_token(START, 0)
}
/// Retrieves first TerminalNode corresponding to token TRANSACTION
/// Returns `None` if there is no child corresponding to token TRANSACTION
fn TRANSACTION(&self) -> Option<Rc<TerminalNode<'input,athenasqlParserContextType>>> where Self:Sized{
	self.get_token(TRANSACTION, 0)
}
/// Retrieves first TerminalNode corresponding to token COMMIT
/// Returns `None` if there is no child corresponding to token COMMIT
fn COMMIT(&self) -> Option<Rc<TerminalNode<'input,athenasqlParserContextType>>> where Self:Sized{
	self.get_token(COMMIT, 0)
}
/// Retrieves first TerminalNode corresponding to token ROLLBACK
/// Returns `None` if there is no child corresponding to token ROLLBACK
fn ROLLBACK(&self) -> Option<Rc<TerminalNode<'input,athenasqlParserContextType>>> where Self:Sized{
	self.get_token(ROLLBACK, 0)
}
/// Retrieves first TerminalNode corresponding to token WORK
/// Returns `None` if there is no child corresponding to token WORK
fn WORK(&self) -> Option<Rc<TerminalNode<'input,athenasqlParserContextType>>> where Self:Sized{
	self.get_token(WORK, 0)
}
/// Retrieves first TerminalNode corresponding to token ISOLATION
/// Returns `None` if there is no child corresponding to token ISOLATION
fn ISOLATION(&self) -> Option<Rc<TerminalNode<'input,athenasqlParserContextType>>> where Self:Sized{
	self.get_token(ISOLATION, 0)
}
/// Retrieves first TerminalNode corresponding to token LEVEL
/// Returns `None` if there is no child corresponding to token LEVEL
fn LEVEL(&self) -> Option<Rc<TerminalNode<'input,athenasqlParserContextType>>> where Self:Sized{
	self.get_token(LEVEL, 0)
}
/// Retrieves first TerminalNode corresponding to token SERIALIZABLE
/// Returns `None` if there is no child corresponding to token SERIALIZABLE
fn SERIALIZABLE(&self) -> Option<Rc<TerminalNode<'input,athenasqlParserContextType>>> where Self:Sized{
	self.get_token(SERIALIZABLE, 0)
}
/// Retrieves first TerminalNode corresponding to token REPEATABLE
/// Returns `None` if there is no child corresponding to token REPEATABLE
fn REPEATABLE(&self) -> Option<Rc<TerminalNode<'input,athenasqlParserContextType>>> where Self:Sized{
	self.get_token(REPEATABLE, 0)
}
/// Retrieves first TerminalNode corresponding to token COMMITTED
/// Returns `None` if there is no child corresponding to token COMMITTED
fn COMMITTED(&self) -> Option<Rc<TerminalNode<'input,athenasqlParserContextType>>> where Self:Sized{
	self.get_token(COMMITTED, 0)
}
/// Retrieves first TerminalNode corresponding to token UNCOMMITTED
/// Returns `None` if there is no child corresponding to token UNCOMMITTED
fn UNCOMMITTED(&self) -> Option<Rc<TerminalNode<'input,athenasqlParserContextType>>> where Self:Sized{
	self.get_token(UNCOMMITTED, 0)
}
/// Retrieves first TerminalNode corresponding to token READ
/// Returns `None` if there is no child corresponding to token READ
fn READ(&self) -> Option<Rc<TerminalNode<'input,athenasqlParserContextType>>> where Self:Sized{
	self.get_token(READ, 0)
}
/// Retrieves first TerminalNode corresponding to token WRITE
/// Returns `None` if there is no child corresponding to token WRITE
fn WRITE(&self) -> Option<Rc<TerminalNode<'input,athenasqlParserContextType>>> where Self:Sized{
	self.get_token(WRITE, 0)
}
/// Retrieves first TerminalNode corresponding to token ONLY
/// Returns `None` if there is no child corresponding to token ONLY
fn ONLY(&self) -> Option<Rc<TerminalNode<'input,athenasqlParserContextType>>> where Self:Sized{
	self.get_token(ONLY, 0)
}
/// Retrieves first TerminalNode corresponding to token COMMENT
/// Returns `None` if there is no child corresponding to token COMMENT
fn COMMENT(&self) -> Option<Rc<TerminalNode<'input,athenasqlParserContextType>>> where Self:Sized{
	self.get_token(COMMENT, 0)
}
/// Retrieves first TerminalNode corresponding to token CALL
/// Returns `None` if there is no child corresponding to token CALL
fn CALL(&self) -> Option<Rc<TerminalNode<'input,athenasqlParserContextType>>> where Self:Sized{
	self.get_token(CALL, 0)
}
/// Retrieves first TerminalNode corresponding to token GRANT
/// Returns `None` if there is no child corresponding to token GRANT
fn GRANT(&self) -> Option<Rc<TerminalNode<'input,athenasqlParserContextType>>> where Self:Sized{
	self.get_token(GRANT, 0)
}
/// Retrieves first TerminalNode corresponding to token REVOKE
/// Returns `None` if there is no child corresponding to token REVOKE
fn REVOKE(&self) -> Option<Rc<TerminalNode<'input,athenasqlParserContextType>>> where Self:Sized{
	self.get_token(REVOKE, 0)
}
/// Retrieves first TerminalNode corresponding to token PRIVILEGES
/// Returns `None` if there is no child corresponding to token PRIVILEGES
fn PRIVILEGES(&self) -> Option<Rc<TerminalNode<'input,athenasqlParserContextType>>> where Self:Sized{
	self.get_token(PRIVILEGES, 0)
}
/// Retrieves first TerminalNode corresponding to token PUBLIC
/// Returns `None` if there is no child corresponding to token PUBLIC
fn PUBLIC(&self) -> Option<Rc<TerminalNode<'input,athenasqlParserContextType>>> where Self:Sized{
	self.get_token(PUBLIC, 0)
}
/// Retrieves first TerminalNode corresponding to token OPTION
/// Returns `None` if there is no child corresponding to token OPTION
fn OPTION(&self) -> Option<Rc<TerminalNode<'input,athenasqlParserContextType>>> where Self:Sized{
	self.get_token(OPTION, 0)
}
/// Retrieves first TerminalNode corresponding to token SUBSTRING
/// Returns `None` if there is no child corresponding to token SUBSTRING
fn SUBSTRING(&self) -> Option<Rc<TerminalNode<'input,athenasqlParserContextType>>> where Self:Sized{
	self.get_token(SUBSTRING, 0)
}
/// Retrieves first TerminalNode corresponding to token SCHEMA
/// Returns `None` if there is no child corresponding to token SCHEMA
fn SCHEMA(&self) -> Option<Rc<TerminalNode<'input,athenasqlParserContextType>>> where Self:Sized{
	self.get_token(SCHEMA, 0)
}
/// Retrieves first TerminalNode corresponding to token CASCADE
/// Returns `None` if there is no child corresponding to token CASCADE
fn CASCADE(&self) -> Option<Rc<TerminalNode<'input,athenasqlParserContextType>>> where Self:Sized{
	self.get_token(CASCADE, 0)
}
/// Retrieves first TerminalNode corresponding to token RESTRICT
/// Returns `None` if there is no child corresponding to token RESTRICT
fn RESTRICT(&self) -> Option<Rc<TerminalNode<'input,athenasqlParserContextType>>> where Self:Sized{
	self.get_token(RESTRICT, 0)
}
/// Retrieves first TerminalNode corresponding to token INPUT
/// Returns `None` if there is no child corresponding to token INPUT
fn INPUT(&self) -> Option<Rc<TerminalNode<'input,athenasqlParserContextType>>> where Self:Sized{
	self.get_token(INPUT, 0)
}
/// Retrieves first TerminalNode corresponding to token OUTPUT
/// Returns `None` if there is no child corresponding to token OUTPUT
fn OUTPUT(&self) -> Option<Rc<TerminalNode<'input,athenasqlParserContextType>>> where Self:Sized{
	self.get_token(OUTPUT, 0)
}
/// Retrieves first TerminalNode corresponding to token INCLUDING
/// Returns `None` if there is no child corresponding to token INCLUDING
fn INCLUDING(&self) -> Option<Rc<TerminalNode<'input,athenasqlParserContextType>>> where Self:Sized{
	self.get_token(INCLUDING, 0)
}
/// Retrieves first TerminalNode corresponding to token EXCLUDING
/// Returns `None` if there is no child corresponding to token EXCLUDING
fn EXCLUDING(&self) -> Option<Rc<TerminalNode<'input,athenasqlParserContextType>>> where Self:Sized{
	self.get_token(EXCLUDING, 0)
}
/// Retrieves first TerminalNode corresponding to token PROPERTIES
/// Returns `None` if there is no child corresponding to token PROPERTIES
fn PROPERTIES(&self) -> Option<Rc<TerminalNode<'input,athenasqlParserContextType>>> where Self:Sized{
	self.get_token(PROPERTIES, 0)
}
/// Retrieves first TerminalNode corresponding to token ALL
/// Returns `None` if there is no child corresponding to token ALL
fn ALL(&self) -> Option<Rc<TerminalNode<'input,athenasqlParserContextType>>> where Self:Sized{
	self.get_token(ALL, 0)
}
/// Retrieves first TerminalNode corresponding to token SOME
/// Returns `None` if there is no child corresponding to token SOME
fn SOME(&self) -> Option<Rc<TerminalNode<'input,athenasqlParserContextType>>> where Self:Sized{
	self.get_token(SOME, 0)
}
/// Retrieves first TerminalNode corresponding to token ANY
/// Returns `None` if there is no child corresponding to token ANY
fn ANY(&self) -> Option<Rc<TerminalNode<'input,athenasqlParserContextType>>> where Self:Sized{
	self.get_token(ANY, 0)
}

}

impl<'input> NonReservedContextAttrs<'input> for NonReservedContext<'input>{}

impl<'input, I, H> athenasqlParser<'input, I, H>
where
    I: TokenStream<'input, TF = LocalTokenFactory<'input> > + TidAble<'input>,
    H: ErrorStrategy<'input,BaseParserType<'input,I>>
{
	pub fn nonReserved(&mut self,)
	-> Result<Rc<NonReservedContextAll<'input>>,ANTLRError> {
		let mut recog = self;
		let _parentctx = recog.ctx.take();
		let mut _localctx = NonReservedContextExt::new(_parentctx.clone(), recog.base.get_state());
        recog.base.enter_rule(_localctx.clone(), 124, RULE_nonReserved);
        let mut _localctx: Rc<NonReservedContextAll> = _localctx;
		let result: Result<(), ANTLRError> = (|| {

			recog.base.set_state(1506);
			recog.err_handler.sync(&mut recog.base)?;
			match recog.base.input.la(1) {
			 SHOW 
				=> {
					//recog.base.enter_outer_alt(_localctx.clone(), 1);
					recog.base.enter_outer_alt(None, 1);
					{
					recog.base.set_state(1411);
					recog.base.match_token(SHOW,&mut recog.err_handler)?;

					}
				}

			 TABLES 
				=> {
					//recog.base.enter_outer_alt(_localctx.clone(), 2);
					recog.base.enter_outer_alt(None, 2);
					{
					recog.base.set_state(1412);
					recog.base.match_token(TABLES,&mut recog.err_handler)?;

					}
				}

			 COLUMNS 
				=> {
					//recog.base.enter_outer_alt(_localctx.clone(), 3);
					recog.base.enter_outer_alt(None, 3);
					{
					recog.base.set_state(1413);
					recog.base.match_token(COLUMNS,&mut recog.err_handler)?;

					}
				}

			 COLUMN 
				=> {
					//recog.base.enter_outer_alt(_localctx.clone(), 4);
					recog.base.enter_outer_alt(None, 4);
					{
					recog.base.set_state(1414);
					recog.base.match_token(COLUMN,&mut recog.err_handler)?;

					}
				}

			 PARTITIONS 
				=> {
					//recog.base.enter_outer_alt(_localctx.clone(), 5);
					recog.base.enter_outer_alt(None, 5);
					{
					recog.base.set_state(1415);
					recog.base.match_token(PARTITIONS,&mut recog.err_handler)?;

					}
				}

			 FUNCTIONS 
				=> {
					//recog.base.enter_outer_alt(_localctx.clone(), 6);
					recog.base.enter_outer_alt(None, 6);
					{
					recog.base.set_state(1416);
					recog.base.match_token(FUNCTIONS,&mut recog.err_handler)?;

					}
				}

			 SCHEMAS 
				=> {
					//recog.base.enter_outer_alt(_localctx.clone(), 7);
					recog.base.enter_outer_alt(None, 7);
					{
					recog.base.set_state(1417);
					recog.base.match_token(SCHEMAS,&mut recog.err_handler)?;

					}
				}

			 CATALOGS 
				=> {
					//recog.base.enter_outer_alt(_localctx.clone(), 8);
					recog.base.enter_outer_alt(None, 8);
					{
					recog.base.set_state(1418);
					recog.base.match_token(CATALOGS,&mut recog.err_handler)?;

					}
				}

			 SESSION 
				=> {
					//recog.base.enter_outer_alt(_localctx.clone(), 9);
					recog.base.enter_outer_alt(None, 9);
					{
					recog.base.set_state(1419);
					recog.base.match_token(SESSION,&mut recog.err_handler)?;

					}
				}

			 ADD 
				=> {
					//recog.base.enter_outer_alt(_localctx.clone(), 10);
					recog.base.enter_outer_alt(None, 10);
					{
					recog.base.set_state(1420);
					recog.base.match_token(ADD,&mut recog.err_handler)?;

					}
				}

			 FILTER 
				=> {
					//recog.base.enter_outer_alt(_localctx.clone(), 11);
					recog.base.enter_outer_alt(None, 11);
					{
					recog.base.set_state(1421);
					recog.base.match_token(FILTER,&mut recog.err_handler)?;

					}
				}

			 AT 
				=> {
					//recog.base.enter_outer_alt(_localctx.clone(), 12);
					recog.base.enter_outer_alt(None, 12);
					{
					recog.base.set_state(1422);
					recog.base.match_token(AT,&mut recog.err_handler)?;

					}
				}

			 OVER 
				=> {
					//recog.base.enter_outer_alt(_localctx.clone(), 13);
					recog.base.enter_outer_alt(None, 13);
					{
					recog.base.set_state(1423);
					recog.base.match_token(OVER,&mut recog.err_handler)?;

					}
				}

			 PARTITION 
				=> {
					//recog.base.enter_outer_alt(_localctx.clone(), 14);
					recog.base.enter_outer_alt(None, 14);
					{
					recog.base.set_state(1424);
					recog.base.match_token(PARTITION,&mut recog.err_handler)?;

					}
				}

			 RANGE 
				=> {
					//recog.base.enter_outer_alt(_localctx.clone(), 15);
					recog.base.enter_outer_alt(None, 15);
					{
					recog.base.set_state(1425);
					recog.base.match_token(RANGE,&mut recog.err_handler)?;

					}
				}

			 ROWS 
				=> {
					//recog.base.enter_outer_alt(_localctx.clone(), 16);
					recog.base.enter_outer_alt(None, 16);
					{
					recog.base.set_state(1426);
					recog.base.match_token(ROWS,&mut recog.err_handler)?;

					}
				}

			 PRECEDING 
				=> {
					//recog.base.enter_outer_alt(_localctx.clone(), 17);
					recog.base.enter_outer_alt(None, 17);
					{
					recog.base.set_state(1427);
					recog.base.match_token(PRECEDING,&mut recog.err_handler)?;

					}
				}

			 FOLLOWING 
				=> {
					//recog.base.enter_outer_alt(_localctx.clone(), 18);
					recog.base.enter_outer_alt(None, 18);
					{
					recog.base.set_state(1428);
					recog.base.match_token(FOLLOWING,&mut recog.err_handler)?;

					}
				}

			 CURRENT 
				=> {
					//recog.base.enter_outer_alt(_localctx.clone(), 19);
					recog.base.enter_outer_alt(None, 19);
					{
					recog.base.set_state(1429);
					recog.base.match_token(CURRENT,&mut recog.err_handler)?;

					}
				}

			 ROW 
				=> {
					//recog.base.enter_outer_alt(_localctx.clone(), 20);
					recog.base.enter_outer_alt(None, 20);
					{
					recog.base.set_state(1430);
					recog.base.match_token(ROW,&mut recog.err_handler)?;

					}
				}

			 MAP 
				=> {
					//recog.base.enter_outer_alt(_localctx.clone(), 21);
					recog.base.enter_outer_alt(None, 21);
					{
					recog.base.set_state(1431);
					recog.base.match_token(MAP,&mut recog.err_handler)?;

					}
				}

			 ARRAY 
				=> {
					//recog.base.enter_outer_alt(_localctx.clone(), 22);
					recog.base.enter_outer_alt(None, 22);
					{
					recog.base.set_state(1432);
					recog.base.match_token(ARRAY,&mut recog.err_handler)?;

					}
				}

			 TINYINT 
				=> {
					//recog.base.enter_outer_alt(_localctx.clone(), 23);
					recog.base.enter_outer_alt(None, 23);
					{
					recog.base.set_state(1433);
					recog.base.match_token(TINYINT,&mut recog.err_handler)?;

					}
				}

			 SMALLINT 
				=> {
					//recog.base.enter_outer_alt(_localctx.clone(), 24);
					recog.base.enter_outer_alt(None, 24);
					{
					recog.base.set_state(1434);
					recog.base.match_token(SMALLINT,&mut recog.err_handler)?;

					}
				}

			 INTEGER 
				=> {
					//recog.base.enter_outer_alt(_localctx.clone(), 25);
					recog.base.enter_outer_alt(None, 25);
					{
					recog.base.set_state(1435);
					recog.base.match_token(INTEGER,&mut recog.err_handler)?;

					}
				}

			 DATE 
				=> {
					//recog.base.enter_outer_alt(_localctx.clone(), 26);
					recog.base.enter_outer_alt(None, 26);
					{
					recog.base.set_state(1436);
					recog.base.match_token(DATE,&mut recog.err_handler)?;

					}
				}

			 TIME 
				=> {
					//recog.base.enter_outer_alt(_localctx.clone(), 27);
					recog.base.enter_outer_alt(None, 27);
					{
					recog.base.set_state(1437);
					recog.base.match_token(TIME,&mut recog.err_handler)?;

					}
				}

			 TIMESTAMP 
				=> {
					//recog.base.enter_outer_alt(_localctx.clone(), 28);
					recog.base.enter_outer_alt(None, 28);
					{
					recog.base.set_state(1438);
					recog.base.match_token(TIMESTAMP,&mut recog.err_handler)?;

					}
				}

			 INTERVAL 
				=> {
					//recog.base.enter_outer_alt(_localctx.clone(), 29);
					recog.base.enter_outer_alt(None, 29);
					{
					recog.base.set_state(1439);
					recog.base.match_token(INTERVAL,&mut recog.err_handler)?;

					}
				}

			 ZONE 
				=> {
					//recog.base.enter_outer_alt(_localctx.clone(), 30);
					recog.base.enter_outer_alt(None, 30);
					{
					recog.base.set_state(1440);
					recog.base.match_token(ZONE,&mut recog.err_handler)?;

					}
				}

			 YEAR 
				=> {
					//recog.base.enter_outer_alt(_localctx.clone(), 31);
					recog.base.enter_outer_alt(None, 31);
					{
					recog.base.set_state(1441);
					recog.base.match_token(YEAR,&mut recog.err_handler)?;

					}
				}

			 MONTH 
				=> {
					//recog.base.enter_outer_alt(_localctx.clone(), 32);
					recog.base.enter_outer_alt(None, 32);
					{
					recog.base.set_state(1442);
					recog.base.match_token(MONTH,&mut recog.err_handler)?;

					}
				}

			 DAY 
				=> {
					//recog.base.enter_outer_alt(_localctx.clone(), 33);
					recog.base.enter_outer_alt(None, 33);
					{
					recog.base.set_state(1443);
					recog.base.match_token(DAY,&mut recog.err_handler)?;

					}
				}

			 HOUR 
				=> {
					//recog.base.enter_outer_alt(_localctx.clone(), 34);
					recog.base.enter_outer_alt(None, 34);
					{
					recog.base.set_state(1444);
					recog.base.match_token(HOUR,&mut recog.err_handler)?;

					}
				}

			 MINUTE 
				=> {
					//recog.base.enter_outer_alt(_localctx.clone(), 35);
					recog.base.enter_outer_alt(None, 35);
					{
					recog.base.set_state(1445);
					recog.base.match_token(MINUTE,&mut recog.err_handler)?;

					}
				}

			 SECOND 
				=> {
					//recog.base.enter_outer_alt(_localctx.clone(), 36);
					recog.base.enter_outer_alt(None, 36);
					{
					recog.base.set_state(1446);
					recog.base.match_token(SECOND,&mut recog.err_handler)?;

					}
				}

			 EXPLAIN 
				=> {
					//recog.base.enter_outer_alt(_localctx.clone(), 37);
					recog.base.enter_outer_alt(None, 37);
					{
					recog.base.set_state(1447);
					recog.base.match_token(EXPLAIN,&mut recog.err_handler)?;

					}
				}

			 ANALYZE 
				=> {
					//recog.base.enter_outer_alt(_localctx.clone(), 38);
					recog.base.enter_outer_alt(None, 38);
					{
					recog.base.set_state(1448);
					recog.base.match_token(ANALYZE,&mut recog.err_handler)?;

					}
				}

			 FORMAT 
				=> {
					//recog.base.enter_outer_alt(_localctx.clone(), 39);
					recog.base.enter_outer_alt(None, 39);
					{
					recog.base.set_state(1449);
					recog.base.match_token(FORMAT,&mut recog.err_handler)?;

					}
				}

			 TYPE 
				=> {
					//recog.base.enter_outer_alt(_localctx.clone(), 40);
					recog.base.enter_outer_alt(None, 40);
					{
					recog.base.set_state(1450);
					recog.base.match_token(TYPE,&mut recog.err_handler)?;

					}
				}

			 TEXT 
				=> {
					//recog.base.enter_outer_alt(_localctx.clone(), 41);
					recog.base.enter_outer_alt(None, 41);
					{
					recog.base.set_state(1451);
					recog.base.match_token(TEXT,&mut recog.err_handler)?;

					}
				}

			 GRAPHVIZ 
				=> {
					//recog.base.enter_outer_alt(_localctx.clone(), 42);
					recog.base.enter_outer_alt(None, 42);
					{
					recog.base.set_state(1452);
					recog.base.match_token(GRAPHVIZ,&mut recog.err_handler)?;

					}
				}

			 LOGICAL 
				=> {
					//recog.base.enter_outer_alt(_localctx.clone(), 43);
					recog.base.enter_outer_alt(None, 43);
					{
					recog.base.set_state(1453);
					recog.base.match_token(LOGICAL,&mut recog.err_handler)?;

					}
				}

			 DISTRIBUTED 
				=> {
					//recog.base.enter_outer_alt(_localctx.clone(), 44);
					recog.base.enter_outer_alt(None, 44);
					{
					recog.base.set_state(1454);
					recog.base.match_token(DISTRIBUTED,&mut recog.err_handler)?;

					}
				}

			 VALIDATE 
				=> {
					//recog.base.enter_outer_alt(_localctx.clone(), 45);
					recog.base.enter_outer_alt(None, 45);
					{
					recog.base.set_state(1455);
					recog.base.match_token(VALIDATE,&mut recog.err_handler)?;

					}
				}

			 TABLESAMPLE 
				=> {
					//recog.base.enter_outer_alt(_localctx.clone(), 46);
					recog.base.enter_outer_alt(None, 46);
					{
					recog.base.set_state(1456);
					recog.base.match_token(TABLESAMPLE,&mut recog.err_handler)?;

					}
				}

			 SYSTEM 
				=> {
					//recog.base.enter_outer_alt(_localctx.clone(), 47);
					recog.base.enter_outer_alt(None, 47);
					{
					recog.base.set_state(1457);
					recog.base.match_token(SYSTEM,&mut recog.err_handler)?;

					}
				}

			 BERNOULLI 
				=> {
					//recog.base.enter_outer_alt(_localctx.clone(), 48);
					recog.base.enter_outer_alt(None, 48);
					{
					recog.base.set_state(1458);
					recog.base.match_token(BERNOULLI,&mut recog.err_handler)?;

					}
				}

			 POISSONIZED 
				=> {
					//recog.base.enter_outer_alt(_localctx.clone(), 49);
					recog.base.enter_outer_alt(None, 49);
					{
					recog.base.set_state(1459);
					recog.base.match_token(POISSONIZED,&mut recog.err_handler)?;

					}
				}

			 USE 
				=> {
					//recog.base.enter_outer_alt(_localctx.clone(), 50);
					recog.base.enter_outer_alt(None, 50);
					{
					recog.base.set_state(1460);
					recog.base.match_token(USE,&mut recog.err_handler)?;

					}
				}

			 TO 
				=> {
					//recog.base.enter_outer_alt(_localctx.clone(), 51);
					recog.base.enter_outer_alt(None, 51);
					{
					recog.base.set_state(1461);
					recog.base.match_token(TO,&mut recog.err_handler)?;

					}
				}

			 SET 
				=> {
					//recog.base.enter_outer_alt(_localctx.clone(), 52);
					recog.base.enter_outer_alt(None, 52);
					{
					recog.base.set_state(1462);
					recog.base.match_token(SET,&mut recog.err_handler)?;

					}
				}

			 RESET 
				=> {
					//recog.base.enter_outer_alt(_localctx.clone(), 53);
					recog.base.enter_outer_alt(None, 53);
					{
					recog.base.set_state(1463);
					recog.base.match_token(RESET,&mut recog.err_handler)?;

					}
				}

			 VIEW 
				=> {
					//recog.base.enter_outer_alt(_localctx.clone(), 54);
					recog.base.enter_outer_alt(None, 54);
					{
					recog.base.set_state(1464);
					recog.base.match_token(VIEW,&mut recog.err_handler)?;

					}
				}

			 REPLACE 
				=> {
					//recog.base.enter_outer_alt(_localctx.clone(), 55);
					recog.base.enter_outer_alt(None, 55);
					{
					recog.base.set_state(1465);
					recog.base.match_token(REPLACE,&mut recog.err_handler)?;

					}
				}

			 IF 
				=> {
					//recog.base.enter_outer_alt(_localctx.clone(), 56);
					recog.base.enter_outer_alt(None, 56);
					{
					recog.base.set_state(1466);
					recog.base.match_token(IF,&mut recog.err_handler)?;

					}
				}

			 NULLIF 
				=> {
					//recog.base.enter_outer_alt(_localctx.clone(), 57);
					recog.base.enter_outer_alt(None, 57);
					{
					recog.base.set_state(1467);
					recog.base.match_token(NULLIF,&mut recog.err_handler)?;

					}
				}

			 COALESCE 
				=> {
					//recog.base.enter_outer_alt(_localctx.clone(), 58);
					recog.base.enter_outer_alt(None, 58);
					{
					recog.base.set_state(1468);
					recog.base.match_token(COALESCE,&mut recog.err_handler)?;

					}
				}

			 NFD | NFC | NFKD | NFKC 
				=> {
					//recog.base.enter_outer_alt(_localctx.clone(), 59);
					recog.base.enter_outer_alt(None, 59);
					{
					/*InvokeRule normalForm*/
					recog.base.set_state(1469);
					recog.normalForm()?;

					}
				}

			 POSITION 
				=> {
					//recog.base.enter_outer_alt(_localctx.clone(), 60);
					recog.base.enter_outer_alt(None, 60);
					{
					recog.base.set_state(1470);
					recog.base.match_token(POSITION,&mut recog.err_handler)?;

					}
				}

			 NO 
				=> {
					//recog.base.enter_outer_alt(_localctx.clone(), 61);
					recog.base.enter_outer_alt(None, 61);
					{
					recog.base.set_state(1471);
					recog.base.match_token(NO,&mut recog.err_handler)?;

					}
				}

			 DATA 
				=> {
					//recog.base.enter_outer_alt(_localctx.clone(), 62);
					recog.base.enter_outer_alt(None, 62);
					{
					recog.base.set_state(1472);
					recog.base.match_token(DATA,&mut recog.err_handler)?;

					}
				}

			 START 
				=> {
					//recog.base.enter_outer_alt(_localctx.clone(), 63);
					recog.base.enter_outer_alt(None, 63);
					{
					recog.base.set_state(1473);
					recog.base.match_token(START,&mut recog.err_handler)?;

					}
				}

			 TRANSACTION 
				=> {
					//recog.base.enter_outer_alt(_localctx.clone(), 64);
					recog.base.enter_outer_alt(None, 64);
					{
					recog.base.set_state(1474);
					recog.base.match_token(TRANSACTION,&mut recog.err_handler)?;

					}
				}

			 COMMIT 
				=> {
					//recog.base.enter_outer_alt(_localctx.clone(), 65);
					recog.base.enter_outer_alt(None, 65);
					{
					recog.base.set_state(1475);
					recog.base.match_token(COMMIT,&mut recog.err_handler)?;

					}
				}

			 ROLLBACK 
				=> {
					//recog.base.enter_outer_alt(_localctx.clone(), 66);
					recog.base.enter_outer_alt(None, 66);
					{
					recog.base.set_state(1476);
					recog.base.match_token(ROLLBACK,&mut recog.err_handler)?;

					}
				}

			 WORK 
				=> {
					//recog.base.enter_outer_alt(_localctx.clone(), 67);
					recog.base.enter_outer_alt(None, 67);
					{
					recog.base.set_state(1477);
					recog.base.match_token(WORK,&mut recog.err_handler)?;

					}
				}

			 ISOLATION 
				=> {
					//recog.base.enter_outer_alt(_localctx.clone(), 68);
					recog.base.enter_outer_alt(None, 68);
					{
					recog.base.set_state(1478);
					recog.base.match_token(ISOLATION,&mut recog.err_handler)?;

					}
				}

			 LEVEL 
				=> {
					//recog.base.enter_outer_alt(_localctx.clone(), 69);
					recog.base.enter_outer_alt(None, 69);
					{
					recog.base.set_state(1479);
					recog.base.match_token(LEVEL,&mut recog.err_handler)?;

					}
				}

			 SERIALIZABLE 
				=> {
					//recog.base.enter_outer_alt(_localctx.clone(), 70);
					recog.base.enter_outer_alt(None, 70);
					{
					recog.base.set_state(1480);
					recog.base.match_token(SERIALIZABLE,&mut recog.err_handler)?;

					}
				}

			 REPEATABLE 
				=> {
					//recog.base.enter_outer_alt(_localctx.clone(), 71);
					recog.base.enter_outer_alt(None, 71);
					{
					recog.base.set_state(1481);
					recog.base.match_token(REPEATABLE,&mut recog.err_handler)?;

					}
				}

			 COMMITTED 
				=> {
					//recog.base.enter_outer_alt(_localctx.clone(), 72);
					recog.base.enter_outer_alt(None, 72);
					{
					recog.base.set_state(1482);
					recog.base.match_token(COMMITTED,&mut recog.err_handler)?;

					}
				}

			 UNCOMMITTED 
				=> {
					//recog.base.enter_outer_alt(_localctx.clone(), 73);
					recog.base.enter_outer_alt(None, 73);
					{
					recog.base.set_state(1483);
					recog.base.match_token(UNCOMMITTED,&mut recog.err_handler)?;

					}
				}

			 READ 
				=> {
					//recog.base.enter_outer_alt(_localctx.clone(), 74);
					recog.base.enter_outer_alt(None, 74);
					{
					recog.base.set_state(1484);
					recog.base.match_token(READ,&mut recog.err_handler)?;

					}
				}

			 WRITE 
				=> {
					//recog.base.enter_outer_alt(_localctx.clone(), 75);
					recog.base.enter_outer_alt(None, 75);
					{
					recog.base.set_state(1485);
					recog.base.match_token(WRITE,&mut recog.err_handler)?;

					}
				}

			 ONLY 
				=> {
					//recog.base.enter_outer_alt(_localctx.clone(), 76);
					recog.base.enter_outer_alt(None, 76);
					{
					recog.base.set_state(1486);
					recog.base.match_token(ONLY,&mut recog.err_handler)?;

					}
				}

			 COMMENT 
				=> {
					//recog.base.enter_outer_alt(_localctx.clone(), 77);
					recog.base.enter_outer_alt(None, 77);
					{
					recog.base.set_state(1487);
					recog.base.match_token(COMMENT,&mut recog.err_handler)?;

					}
				}

			 CALL 
				=> {
					//recog.base.enter_outer_alt(_localctx.clone(), 78);
					recog.base.enter_outer_alt(None, 78);
					{
					recog.base.set_state(1488);
					recog.base.match_token(CALL,&mut recog.err_handler)?;

					}
				}

			 GRANT 
				=> {
					//recog.base.enter_outer_alt(_localctx.clone(), 79);
					recog.base.enter_outer_alt(None, 79);
					{
					recog.base.set_state(1489);
					recog.base.match_token(GRANT,&mut recog.err_handler)?;

					}
				}

			 REVOKE 
				=> {
					//recog.base.enter_outer_alt(_localctx.clone(), 80);
					recog.base.enter_outer_alt(None, 80);
					{
					recog.base.set_state(1490);
					recog.base.match_token(REVOKE,&mut recog.err_handler)?;

					}
				}

			 PRIVILEGES 
				=> {
					//recog.base.enter_outer_alt(_localctx.clone(), 81);
					recog.base.enter_outer_alt(None, 81);
					{
					recog.base.set_state(1491);
					recog.base.match_token(PRIVILEGES,&mut recog.err_handler)?;

					}
				}

			 PUBLIC 
				=> {
					//recog.base.enter_outer_alt(_localctx.clone(), 82);
					recog.base.enter_outer_alt(None, 82);
					{
					recog.base.set_state(1492);
					recog.base.match_token(PUBLIC,&mut recog.err_handler)?;

					}
				}

			 OPTION 
				=> {
					//recog.base.enter_outer_alt(_localctx.clone(), 83);
					recog.base.enter_outer_alt(None, 83);
					{
					recog.base.set_state(1493);
					recog.base.match_token(OPTION,&mut recog.err_handler)?;

					}
				}

			 SUBSTRING 
				=> {
					//recog.base.enter_outer_alt(_localctx.clone(), 84);
					recog.base.enter_outer_alt(None, 84);
					{
					recog.base.set_state(1494);
					recog.base.match_token(SUBSTRING,&mut recog.err_handler)?;

					}
				}

			 SCHEMA 
				=> {
					//recog.base.enter_outer_alt(_localctx.clone(), 85);
					recog.base.enter_outer_alt(None, 85);
					{
					recog.base.set_state(1495);
					recog.base.match_token(SCHEMA,&mut recog.err_handler)?;

					}
				}

			 CASCADE 
				=> {
					//recog.base.enter_outer_alt(_localctx.clone(), 86);
					recog.base.enter_outer_alt(None, 86);
					{
					recog.base.set_state(1496);
					recog.base.match_token(CASCADE,&mut recog.err_handler)?;

					}
				}

			 RESTRICT 
				=> {
					//recog.base.enter_outer_alt(_localctx.clone(), 87);
					recog.base.enter_outer_alt(None, 87);
					{
					recog.base.set_state(1497);
					recog.base.match_token(RESTRICT,&mut recog.err_handler)?;

					}
				}

			 INPUT 
				=> {
					//recog.base.enter_outer_alt(_localctx.clone(), 88);
					recog.base.enter_outer_alt(None, 88);
					{
					recog.base.set_state(1498);
					recog.base.match_token(INPUT,&mut recog.err_handler)?;

					}
				}

			 OUTPUT 
				=> {
					//recog.base.enter_outer_alt(_localctx.clone(), 89);
					recog.base.enter_outer_alt(None, 89);
					{
					recog.base.set_state(1499);
					recog.base.match_token(OUTPUT,&mut recog.err_handler)?;

					}
				}

			 INCLUDING 
				=> {
					//recog.base.enter_outer_alt(_localctx.clone(), 90);
					recog.base.enter_outer_alt(None, 90);
					{
					recog.base.set_state(1500);
					recog.base.match_token(INCLUDING,&mut recog.err_handler)?;

					}
				}

			 EXCLUDING 
				=> {
					//recog.base.enter_outer_alt(_localctx.clone(), 91);
					recog.base.enter_outer_alt(None, 91);
					{
					recog.base.set_state(1501);
					recog.base.match_token(EXCLUDING,&mut recog.err_handler)?;

					}
				}

			 PROPERTIES 
				=> {
					//recog.base.enter_outer_alt(_localctx.clone(), 92);
					recog.base.enter_outer_alt(None, 92);
					{
					recog.base.set_state(1502);
					recog.base.match_token(PROPERTIES,&mut recog.err_handler)?;

					}
				}

			 ALL 
				=> {
					//recog.base.enter_outer_alt(_localctx.clone(), 93);
					recog.base.enter_outer_alt(None, 93);
					{
					recog.base.set_state(1503);
					recog.base.match_token(ALL,&mut recog.err_handler)?;

					}
				}

			 SOME 
				=> {
					//recog.base.enter_outer_alt(_localctx.clone(), 94);
					recog.base.enter_outer_alt(None, 94);
					{
					recog.base.set_state(1504);
					recog.base.match_token(SOME,&mut recog.err_handler)?;

					}
				}

			 ANY 
				=> {
					//recog.base.enter_outer_alt(_localctx.clone(), 95);
					recog.base.enter_outer_alt(None, 95);
					{
					recog.base.set_state(1505);
					recog.base.match_token(ANY,&mut recog.err_handler)?;

					}
				}

				_ => Err(ANTLRError::NoAltError(NoViableAltError::new(&mut recog.base)))?
			}
			Ok(())
		})();
		match result {
		Ok(_)=>{},
        Err(e @ ANTLRError::FallThrough(_)) => return Err(e),
		Err(ref re) => {
				//_localctx.exception = re;
				recog.err_handler.report_error(&mut recog.base, re);
				recog.err_handler.recover(&mut recog.base, re)?;
			}
		}
		recog.base.exit_rule();

		Ok(_localctx)
	}
}
//------------------- normalForm ----------------
pub type NormalFormContextAll<'input> = NormalFormContext<'input>;


pub type NormalFormContext<'input> = BaseParserRuleContext<'input,NormalFormContextExt<'input>>;

#[derive(Clone)]
pub struct NormalFormContextExt<'input>{
ph:PhantomData<&'input str>
}

impl<'input> athenasqlParserContext<'input> for NormalFormContext<'input>{}

impl<'input,'a> Listenable<dyn athenasqlListener<'input> + 'a> for NormalFormContext<'input>{
		fn enter(&self,listener: &mut (dyn athenasqlListener<'input> + 'a)) {
			listener.enter_every_rule(self);
			listener.enter_normalForm(self);
		}fn exit(&self,listener: &mut (dyn athenasqlListener<'input> + 'a)) {
			listener.exit_normalForm(self);
			listener.exit_every_rule(self);
		}
}

impl<'input> CustomRuleContext<'input> for NormalFormContextExt<'input>{
	type TF = LocalTokenFactory<'input>;
	type Ctx = athenasqlParserContextType;
	fn get_rule_index(&self) -> usize { RULE_normalForm }
	//fn type_rule_index() -> usize where Self: Sized { RULE_normalForm }
}
antlr_rust::tid!{NormalFormContextExt<'a>}

impl<'input> NormalFormContextExt<'input>{
	fn new(parent: Option<Rc<dyn athenasqlParserContext<'input> + 'input > >, invoking_state: isize) -> Rc<NormalFormContextAll<'input>> {
		Rc::new(
			BaseParserRuleContext::new_parser_ctx(parent, invoking_state,NormalFormContextExt{
				ph:PhantomData
			}),
		)
	}
}

pub trait NormalFormContextAttrs<'input>: athenasqlParserContext<'input> + BorrowMut<NormalFormContextExt<'input>>{

/// Retrieves first TerminalNode corresponding to token NFD
/// Returns `None` if there is no child corresponding to token NFD
fn NFD(&self) -> Option<Rc<TerminalNode<'input,athenasqlParserContextType>>> where Self:Sized{
	self.get_token(NFD, 0)
}
/// Retrieves first TerminalNode corresponding to token NFC
/// Returns `None` if there is no child corresponding to token NFC
fn NFC(&self) -> Option<Rc<TerminalNode<'input,athenasqlParserContextType>>> where Self:Sized{
	self.get_token(NFC, 0)
}
/// Retrieves first TerminalNode corresponding to token NFKD
/// Returns `None` if there is no child corresponding to token NFKD
fn NFKD(&self) -> Option<Rc<TerminalNode<'input,athenasqlParserContextType>>> where Self:Sized{
	self.get_token(NFKD, 0)
}
/// Retrieves first TerminalNode corresponding to token NFKC
/// Returns `None` if there is no child corresponding to token NFKC
fn NFKC(&self) -> Option<Rc<TerminalNode<'input,athenasqlParserContextType>>> where Self:Sized{
	self.get_token(NFKC, 0)
}

}

impl<'input> NormalFormContextAttrs<'input> for NormalFormContext<'input>{}

impl<'input, I, H> athenasqlParser<'input, I, H>
where
    I: TokenStream<'input, TF = LocalTokenFactory<'input> > + TidAble<'input>,
    H: ErrorStrategy<'input,BaseParserType<'input,I>>
{
	pub fn normalForm(&mut self,)
	-> Result<Rc<NormalFormContextAll<'input>>,ANTLRError> {
		let mut recog = self;
		let _parentctx = recog.ctx.take();
		let mut _localctx = NormalFormContextExt::new(_parentctx.clone(), recog.base.get_state());
        recog.base.enter_rule(_localctx.clone(), 126, RULE_normalForm);
        let mut _localctx: Rc<NormalFormContextAll> = _localctx;
		let mut _la: isize = -1;
		let result: Result<(), ANTLRError> = (|| {

			//recog.base.enter_outer_alt(_localctx.clone(), 1);
			recog.base.enter_outer_alt(None, 1);
			{
			recog.base.set_state(1508);
			_la = recog.base.input.la(1);
			if { !(((((_la - 179)) & !0x3f) == 0 && ((1usize << (_la - 179)) & ((1usize << (NFD - 179)) | (1usize << (NFC - 179)) | (1usize << (NFKD - 179)) | (1usize << (NFKC - 179)))) != 0)) } {
				recog.err_handler.recover_inline(&mut recog.base)?;

			}
			else {
				if  recog.base.input.la(1)==TOKEN_EOF { recog.base.matched_eof = true };
				recog.err_handler.report_match(&mut recog.base);
				recog.base.consume(&mut recog.err_handler);
			}
			}
			Ok(())
		})();
		match result {
		Ok(_)=>{},
        Err(e @ ANTLRError::FallThrough(_)) => return Err(e),
		Err(ref re) => {
				//_localctx.exception = re;
				recog.err_handler.report_error(&mut recog.base, re);
				recog.err_handler.recover(&mut recog.base, re)?;
			}
		}
		recog.base.exit_rule();

		Ok(_localctx)
	}
}

lazy_static! {
    static ref _ATN: Arc<ATN> =
        Arc::new(ATNDeserializer::new(None).deserialize(_serializedATN.chars()));
    static ref _decision_to_DFA: Arc<Vec<antlr_rust::RwLock<DFA>>> = {
        let mut dfa = Vec::new();
        let size = _ATN.decision_to_state.len();
        for i in 0..size {
            dfa.push(DFA::new(
                _ATN.clone(),
                _ATN.get_decision_state(i),
                i as isize,
            ).into())
        }
        Arc::new(dfa)
    };
}



const _serializedATN:&'static str =
	"\x03\u{608b}\u{a72a}\u{8133}\u{b9ed}\u{417c}\u{3be7}\u{7786}\u{5964}\x03\
	\u{d7}\u{5e9}\x04\x02\x09\x02\x04\x03\x09\x03\x04\x04\x09\x04\x04\x05\x09\
	\x05\x04\x06\x09\x06\x04\x07\x09\x07\x04\x08\x09\x08\x04\x09\x09\x09\x04\
	\x0a\x09\x0a\x04\x0b\x09\x0b\x04\x0c\x09\x0c\x04\x0d\x09\x0d\x04\x0e\x09\
	\x0e\x04\x0f\x09\x0f\x04\x10\x09\x10\x04\x11\x09\x11\x04\x12\x09\x12\x04\
	\x13\x09\x13\x04\x14\x09\x14\x04\x15\x09\x15\x04\x16\x09\x16\x04\x17\x09\
	\x17\x04\x18\x09\x18\x04\x19\x09\x19\x04\x1a\x09\x1a\x04\x1b\x09\x1b\x04\
	\x1c\x09\x1c\x04\x1d\x09\x1d\x04\x1e\x09\x1e\x04\x1f\x09\x1f\x04\x20\x09\
	\x20\x04\x21\x09\x21\x04\x22\x09\x22\x04\x23\x09\x23\x04\x24\x09\x24\x04\
	\x25\x09\x25\x04\x26\x09\x26\x04\x27\x09\x27\x04\x28\x09\x28\x04\x29\x09\
	\x29\x04\x2a\x09\x2a\x04\x2b\x09\x2b\x04\x2c\x09\x2c\x04\x2d\x09\x2d\x04\
	\x2e\x09\x2e\x04\x2f\x09\x2f\x04\x30\x09\x30\x04\x31\x09\x31\x04\x32\x09\
	\x32\x04\x33\x09\x33\x04\x34\x09\x34\x04\x35\x09\x35\x04\x36\x09\x36\x04\
	\x37\x09\x37\x04\x38\x09\x38\x04\x39\x09\x39\x04\x3a\x09\x3a\x04\x3b\x09\
	\x3b\x04\x3c\x09\x3c\x04\x3d\x09\x3d\x04\x3e\x09\x3e\x04\x3f\x09\x3f\x04\
	\x40\x09\x40\x04\x41\x09\x41\x03\x02\x03\x02\x03\x03\x03\x03\x03\x03\x03\
	\x04\x03\x04\x03\x04\x03\x05\x03\x05\x03\x05\x03\x05\x03\x05\x03\x05\x03\
	\x05\x03\x05\x03\x05\x03\x05\x03\x05\x03\x05\x03\x05\x05\x05\u{98}\x0a\x05\
	\x03\x05\x03\x05\x03\x05\x05\x05\u{9d}\x0a\x05\x03\x05\x03\x05\x03\x05\x03\
	\x05\x05\x05\u{a3}\x0a\x05\x03\x05\x03\x05\x05\x05\u{a7}\x0a\x05\x03\x05\
	\x03\x05\x03\x05\x03\x05\x03\x05\x03\x05\x03\x05\x03\x05\x03\x05\x03\x05\
	\x03\x05\x03\x05\x05\x05\u{b5}\x0a\x05\x03\x05\x03\x05\x03\x05\x05\x05\u{ba}\
	\x0a\x05\x03\x05\x03\x05\x03\x05\x03\x05\x05\x05\u{c0}\x0a\x05\x03\x05\x05\
	\x05\u{c3}\x0a\x05\x03\x05\x03\x05\x03\x05\x03\x05\x03\x05\x05\x05\u{ca}\
	\x0a\x05\x03\x05\x03\x05\x03\x05\x03\x05\x03\x05\x07\x05\u{d1}\x0a\x05\x0c\
	\x05\x0e\x05\u{d4}\x0b\x05\x03\x05\x03\x05\x03\x05\x05\x05\u{d9}\x0a\x05\
	\x03\x05\x03\x05\x03\x05\x03\x05\x05\x05\u{df}\x0a\x05\x03\x05\x03\x05\x03\
	\x05\x03\x05\x03\x05\x05\x05\u{e6}\x0a\x05\x03\x05\x03\x05\x03\x05\x03\x05\
	\x03\x05\x03\x05\x03\x05\x05\x05\u{ef}\x0a\x05\x03\x05\x03\x05\x03\x05\x03\
	\x05\x03\x05\x03\x05\x03\x05\x03\x05\x03\x05\x03\x05\x03\x05\x03\x05\x03\
	\x05\x03\x05\x03\x05\x03\x05\x03\x05\x03\x05\x03\x05\x03\x05\x03\x05\x03\
	\x05\x03\x05\x03\x05\x03\x05\x03\x05\x05\x05\u{10b}\x0a\x05\x03\x05\x03\
	\x05\x03\x05\x03\x05\x03\x05\x03\x05\x03\x05\x03\x05\x03\x05\x05\x05\u{116}\
	\x0a\x05\x03\x05\x03\x05\x03\x05\x03\x05\x03\x05\x03\x05\x03\x05\x07\x05\
	\u{11f}\x0a\x05\x0c\x05\x0e\x05\u{122}\x0b\x05\x05\x05\u{124}\x0a\x05\x03\
	\x05\x03\x05\x03\x05\x03\x05\x03\x05\x03\x05\x07\x05\u{12c}\x0a\x05\x0c\
	\x05\x0e\x05\u{12f}\x0b\x05\x03\x05\x03\x05\x05\x05\u{133}\x0a\x05\x03\x05\
	\x03\x05\x05\x05\u{137}\x0a\x05\x03\x05\x03\x05\x03\x05\x03\x05\x03\x05\
	\x03\x05\x05\x05\u{13f}\x0a\x05\x03\x05\x03\x05\x03\x05\x03\x05\x05\x05\
	\u{145}\x0a\x05\x03\x05\x03\x05\x03\x05\x07\x05\u{14a}\x0a\x05\x0c\x05\x0e\
	\x05\u{14d}\x0b\x05\x03\x05\x03\x05\x05\x05\u{151}\x0a\x05\x03\x05\x03\x05\
	\x05\x05\u{155}\x0a\x05\x03\x05\x03\x05\x03\x05\x03\x05\x03\x05\x03\x05\
	\x05\x05\u{15d}\x0a\x05\x03\x05\x03\x05\x03\x05\x03\x05\x07\x05\u{163}\x0a\
	\x05\x0c\x05\x0e\x05\u{166}\x0b\x05\x03\x05\x03\x05\x05\x05\u{16a}\x0a\x05\
	\x03\x05\x03\x05\x03\x05\x03\x05\x03\x05\x03\x05\x03\x05\x03\x05\x03\x05\
	\x03\x05\x03\x05\x03\x05\x03\x05\x05\x05\u{179}\x0a\x05\x03\x05\x03\x05\
	\x05\x05\u{17d}\x0a\x05\x03\x05\x03\x05\x03\x05\x03\x05\x05\x05\u{183}\x0a\
	\x05\x03\x05\x03\x05\x05\x05\u{187}\x0a\x05\x03\x05\x03\x05\x03\x05\x03\
	\x05\x05\x05\u{18d}\x0a\x05\x03\x05\x03\x05\x03\x05\x03\x05\x03\x05\x03\
	\x05\x03\x05\x03\x05\x03\x05\x03\x05\x03\x05\x03\x05\x03\x05\x03\x05\x03\
	\x05\x03\x05\x03\x05\x03\x05\x03\x05\x03\x05\x03\x05\x03\x05\x03\x05\x03\
	\x05\x03\x05\x03\x05\x07\x05\u{1a9}\x0a\x05\x0c\x05\x0e\x05\u{1ac}\x0b\x05\
	\x05\x05\u{1ae}\x0a\x05\x03\x05\x03\x05\x05\x05\u{1b2}\x0a\x05\x03\x05\x03\
	\x05\x05\x05\u{1b6}\x0a\x05\x03\x05\x03\x05\x03\x05\x03\x05\x03\x05\x03\
	\x05\x05\x05\u{1be}\x0a\x05\x03\x05\x03\x05\x03\x05\x03\x05\x03\x05\x07\
	\x05\u{1c5}\x0a\x05\x0c\x05\x0e\x05\u{1c8}\x0b\x05\x05\x05\u{1ca}\x0a\x05\
	\x03\x05\x03\x05\x05\x05\u{1ce}\x0a\x05\x03\x05\x03\x05\x03\x05\x03\x05\
	\x03\x05\x03\x05\x03\x05\x03\x05\x03\x05\x03\x05\x03\x05\x03\x05\x03\x05\
	\x03\x05\x07\x05\u{1de}\x0a\x05\x0c\x05\x0e\x05\u{1e1}\x0b\x05\x05\x05\u{1e3}\
	\x0a\x05\x03\x05\x03\x05\x03\x05\x03\x05\x03\x05\x03\x05\x05\x05\u{1eb}\
	\x0a\x05\x03\x06\x05\x06\u{1ee}\x0a\x06\x03\x06\x03\x06\x03\x07\x03\x07\
	\x05\x07\u{1f4}\x0a\x07\x03\x07\x03\x07\x03\x07\x07\x07\u{1f9}\x0a\x07\x0c\
	\x07\x0e\x07\u{1fc}\x0b\x07\x03\x08\x03\x08\x05\x08\u{200}\x0a\x08\x03\x09\
	\x03\x09\x03\x09\x03\x09\x05\x09\u{206}\x0a\x09\x03\x0a\x03\x0a\x03\x0a\
	\x03\x0a\x05\x0a\u{20c}\x0a\x0a\x03\x0b\x03\x0b\x03\x0b\x03\x0b\x07\x0b\
	\u{212}\x0a\x0b\x0c\x0b\x0e\x0b\u{215}\x0b\x0b\x03\x0b\x03\x0b\x03\x0c\x03\
	\x0c\x03\x0c\x03\x0c\x03\x0d\x03\x0d\x03\x0d\x03\x0d\x03\x0d\x03\x0d\x07\
	\x0d\u{223}\x0a\x0d\x0c\x0d\x0e\x0d\u{226}\x0b\x0d\x05\x0d\u{228}\x0a\x0d\
	\x03\x0d\x03\x0d\x05\x0d\u{22c}\x0a\x0d\x03\x0e\x03\x0e\x03\x0e\x03\x0e\
	\x03\x0e\x03\x0e\x05\x0e\u{234}\x0a\x0e\x03\x0e\x03\x0e\x03\x0e\x03\x0e\
	\x05\x0e\u{23a}\x0a\x0e\x03\x0e\x07\x0e\u{23d}\x0a\x0e\x0c\x0e\x0e\x0e\u{240}\
	\x0b\x0e\x03\x0f\x03\x0f\x03\x0f\x03\x0f\x03\x0f\x03\x0f\x03\x0f\x07\x0f\
	\u{249}\x0a\x0f\x0c\x0f\x0e\x0f\u{24c}\x0b\x0f\x03\x0f\x03\x0f\x03\x0f\x03\
	\x0f\x05\x0f\u{252}\x0a\x0f\x03\x10\x03\x10\x05\x10\u{256}\x0a\x10\x03\x10\
	\x03\x10\x05\x10\u{25a}\x0a\x10\x03\x11\x03\x11\x05\x11\u{25e}\x0a\x11\x03\
	\x11\x03\x11\x03\x11\x07\x11\u{263}\x0a\x11\x0c\x11\x0e\x11\u{266}\x0b\x11\
	\x03\x11\x03\x11\x03\x11\x03\x11\x07\x11\u{26c}\x0a\x11\x0c\x11\x0e\x11\
	\u{26f}\x0b\x11\x05\x11\u{271}\x0a\x11\x03\x11\x03\x11\x05\x11\u{275}\x0a\
	\x11\x03\x11\x03\x11\x03\x11\x05\x11\u{27a}\x0a\x11\x03\x11\x03\x11\x05\
	\x11\u{27e}\x0a\x11\x03\x12\x05\x12\u{281}\x0a\x12\x03\x12\x03\x12\x03\x12\
	\x07\x12\u{286}\x0a\x12\x0c\x12\x0e\x12\u{289}\x0b\x12\x03\x13\x03\x13\x03\
	\x13\x03\x13\x03\x13\x03\x13\x07\x13\u{291}\x0a\x13\x0c\x13\x0e\x13\u{294}\
	\x0b\x13\x05\x13\u{296}\x0a\x13\x03\x13\x03\x13\x03\x13\x03\x13\x03\x13\
	\x03\x13\x07\x13\u{29e}\x0a\x13\x0c\x13\x0e\x13\u{2a1}\x0b\x13\x05\x13\u{2a3}\
	\x0a\x13\x03\x13\x03\x13\x03\x13\x03\x13\x03\x13\x03\x13\x03\x13\x07\x13\
	\u{2ac}\x0a\x13\x0c\x13\x0e\x13\u{2af}\x0b\x13\x03\x13\x03\x13\x05\x13\u{2b3}\
	\x0a\x13\x03\x14\x03\x14\x03\x14\x03\x14\x07\x14\u{2b9}\x0a\x14\x0c\x14\
	\x0e\x14\u{2bc}\x0b\x14\x05\x14\u{2be}\x0a\x14\x03\x14\x03\x14\x05\x14\u{2c2}\
	\x0a\x14\x03\x15\x03\x15\x03\x15\x03\x15\x07\x15\u{2c8}\x0a\x15\x0c\x15\
	\x0e\x15\u{2cb}\x0b\x15\x05\x15\u{2cd}\x0a\x15\x03\x15\x03\x15\x05\x15\u{2d1}\
	\x0a\x15\x03\x16\x03\x16\x05\x16\u{2d5}\x0a\x16\x03\x16\x03\x16\x03\x16\
	\x03\x16\x03\x16\x03\x17\x03\x17\x03\x18\x03\x18\x05\x18\u{2e0}\x0a\x18\
	\x03\x18\x05\x18\u{2e3}\x0a\x18\x03\x18\x03\x18\x03\x18\x03\x18\x03\x18\
	\x05\x18\u{2ea}\x0a\x18\x03\x19\x03\x19\x03\x19\x03\x19\x03\x19\x03\x19\
	\x03\x19\x03\x19\x03\x19\x03\x19\x03\x19\x03\x19\x03\x19\x03\x19\x03\x19\
	\x03\x19\x03\x19\x05\x19\u{2fd}\x0a\x19\x07\x19\u{2ff}\x0a\x19\x0c\x19\x0e\
	\x19\u{302}\x0b\x19\x03\x1a\x05\x1a\u{305}\x0a\x1a\x03\x1a\x03\x1a\x05\x1a\
	\u{309}\x0a\x1a\x03\x1a\x03\x1a\x05\x1a\u{30d}\x0a\x1a\x03\x1a\x03\x1a\x05\
	\x1a\u{311}\x0a\x1a\x05\x1a\u{313}\x0a\x1a\x03\x1b\x03\x1b\x03\x1b\x03\x1b\
	\x03\x1b\x03\x1b\x03\x1b\x07\x1b\u{31c}\x0a\x1b\x0c\x1b\x0e\x1b\u{31f}\x0b\
	\x1b\x03\x1b\x03\x1b\x05\x1b\u{323}\x0a\x1b\x03\x1c\x03\x1c\x03\x1c\x03\
	\x1c\x03\x1c\x03\x1c\x03\x1c\x05\x1c\u{32c}\x0a\x1c\x03\x1d\x03\x1d\x03\
	\x1e\x03\x1e\x05\x1e\u{332}\x0a\x1e\x03\x1e\x03\x1e\x05\x1e\u{336}\x0a\x1e\
	\x05\x1e\u{338}\x0a\x1e\x03\x1f\x03\x1f\x03\x1f\x03\x1f\x07\x1f\u{33e}\x0a\
	\x1f\x0c\x1f\x0e\x1f\u{341}\x0b\x1f\x03\x1f\x03\x1f\x03\x20\x03\x20\x03\
	\x20\x03\x20\x03\x20\x03\x20\x03\x20\x03\x20\x03\x20\x03\x20\x07\x20\u{34f}\
	\x0a\x20\x0c\x20\x0e\x20\u{352}\x0b\x20\x03\x20\x03\x20\x03\x20\x05\x20\
	\u{357}\x0a\x20\x03\x20\x03\x20\x03\x20\x03\x20\x05\x20\u{35d}\x0a\x20\x03\
	\x21\x03\x21\x03\x22\x03\x22\x03\x23\x03\x23\x03\x23\x03\x23\x05\x23\u{367}\
	\x0a\x23\x03\x23\x03\x23\x03\x23\x03\x23\x03\x23\x03\x23\x07\x23\u{36f}\
	\x0a\x23\x0c\x23\x0e\x23\u{372}\x0b\x23\x03\x24\x03\x24\x05\x24\u{376}\x0a\
	\x24\x03\x25\x03\x25\x03\x25\x03\x25\x03\x25\x03\x25\x03\x25\x03\x25\x03\
	\x25\x03\x25\x05\x25\u{382}\x0a\x25\x03\x25\x03\x25\x03\x25\x03\x25\x03\
	\x25\x03\x25\x05\x25\u{38a}\x0a\x25\x03\x25\x03\x25\x03\x25\x03\x25\x03\
	\x25\x07\x25\u{391}\x0a\x25\x0c\x25\x0e\x25\u{394}\x0b\x25\x03\x25\x03\x25\
	\x03\x25\x05\x25\u{399}\x0a\x25\x03\x25\x03\x25\x03\x25\x03\x25\x03\x25\
	\x03\x25\x05\x25\u{3a1}\x0a\x25\x03\x25\x03\x25\x03\x25\x03\x25\x05\x25\
	\u{3a7}\x0a\x25\x03\x25\x03\x25\x05\x25\u{3ab}\x0a\x25\x03\x25\x03\x25\x03\
	\x25\x05\x25\u{3b0}\x0a\x25\x03\x25\x03\x25\x03\x25\x05\x25\u{3b5}\x0a\x25\
	\x03\x26\x03\x26\x03\x26\x03\x26\x05\x26\u{3bb}\x0a\x26\x03\x26\x03\x26\
	\x03\x26\x03\x26\x03\x26\x03\x26\x03\x26\x03\x26\x03\x26\x03\x26\x03\x26\
	\x03\x26\x07\x26\u{3c9}\x0a\x26\x0c\x26\x0e\x26\u{3cc}\x0b\x26\x03\x27\x03\
	\x27\x03\x28\x03\x28\x03\x28\x03\x28\x03\x28\x03\x28\x03\x28\x03\x28\x03\
	\x28\x03\x28\x03\x28\x03\x28\x03\x28\x03\x28\x03\x28\x03\x28\x03\x28\x03\
	\x28\x03\x28\x03\x28\x03\x28\x03\x28\x03\x28\x03\x28\x06\x28\u{3e8}\x0a\
	\x28\x0d\x28\x0e\x28\u{3e9}\x03\x28\x03\x28\x03\x28\x03\x28\x03\x28\x03\
	\x28\x03\x28\x07\x28\u{3f3}\x0a\x28\x0c\x28\x0e\x28\u{3f6}\x0b\x28\x03\x28\
	\x03\x28\x03\x28\x03\x28\x03\x28\x03\x28\x03\x28\x05\x28\u{3ff}\x0a\x28\
	\x03\x28\x05\x28\u{402}\x0a\x28\x03\x28\x03\x28\x03\x28\x05\x28\u{407}\x0a\
	\x28\x03\x28\x03\x28\x03\x28\x07\x28\u{40c}\x0a\x28\x0c\x28\x0e\x28\u{40f}\
	\x0b\x28\x05\x28\u{411}\x0a\x28\x03\x28\x03\x28\x05\x28\u{415}\x0a\x28\x03\
	\x28\x05\x28\u{418}\x0a\x28\x03\x28\x03\x28\x03\x28\x03\x28\x03\x28\x03\
	\x28\x03\x28\x03\x28\x07\x28\u{422}\x0a\x28\x0c\x28\x0e\x28\u{425}\x0b\x28\
	\x03\x28\x03\x28\x03\x28\x03\x28\x03\x28\x03\x28\x03\x28\x03\x28\x03\x28\
	\x03\x28\x03\x28\x03\x28\x03\x28\x03\x28\x03\x28\x03\x28\x06\x28\u{437}\
	\x0a\x28\x0d\x28\x0e\x28\u{438}\x03\x28\x03\x28\x05\x28\u{43d}\x0a\x28\x03\
	\x28\x03\x28\x03\x28\x03\x28\x06\x28\u{443}\x0a\x28\x0d\x28\x0e\x28\u{444}\
	\x03\x28\x03\x28\x05\x28\u{449}\x0a\x28\x03\x28\x03\x28\x03\x28\x03\x28\
	\x03\x28\x03\x28\x03\x28\x03\x28\x03\x28\x03\x28\x03\x28\x03\x28\x03\x28\
	\x03\x28\x03\x28\x03\x28\x03\x28\x03\x28\x03\x28\x03\x28\x03\x28\x07\x28\
	\u{460}\x0a\x28\x0c\x28\x0e\x28\u{463}\x0b\x28\x05\x28\u{465}\x0a\x28\x03\
	\x28\x03\x28\x03\x28\x03\x28\x03\x28\x03\x28\x03\x28\x05\x28\u{46e}\x0a\
	\x28\x03\x28\x03\x28\x03\x28\x03\x28\x05\x28\u{474}\x0a\x28\x03\x28\x03\
	\x28\x03\x28\x03\x28\x05\x28\u{47a}\x0a\x28\x03\x28\x03\x28\x03\x28\x03\
	\x28\x05\x28\u{480}\x0a\x28\x03\x28\x03\x28\x03\x28\x03\x28\x03\x28\x03\
	\x28\x03\x28\x05\x28\u{489}\x0a\x28\x03\x28\x03\x28\x03\x28\x03\x28\x03\
	\x28\x03\x28\x03\x28\x05\x28\u{492}\x0a\x28\x03\x28\x03\x28\x03\x28\x03\
	\x28\x03\x28\x03\x28\x03\x28\x03\x28\x03\x28\x03\x28\x03\x28\x03\x28\x03\
	\x28\x05\x28\u{4a1}\x0a\x28\x03\x28\x03\x28\x03\x28\x03\x28\x03\x28\x03\
	\x28\x03\x28\x03\x28\x07\x28\u{4ab}\x0a\x28\x0c\x28\x0e\x28\u{4ae}\x0b\x28\
	\x03\x29\x03\x29\x03\x29\x03\x29\x03\x29\x03\x29\x05\x29\u{4b6}\x0a\x29\
	\x03\x2a\x03\x2a\x03\x2b\x03\x2b\x03\x2c\x03\x2c\x03\x2d\x03\x2d\x05\x2d\
	\u{4c0}\x0a\x2d\x03\x2d\x03\x2d\x03\x2d\x03\x2d\x05\x2d\u{4c6}\x0a\x2d\x03\
	\x2e\x03\x2e\x03\x2f\x03\x2f\x03\x2f\x03\x2f\x03\x2f\x03\x2f\x03\x2f\x03\
	\x2f\x03\x2f\x03\x2f\x03\x2f\x03\x2f\x03\x2f\x03\x2f\x03\x2f\x03\x2f\x03\
	\x2f\x03\x2f\x03\x2f\x03\x2f\x03\x2f\x07\x2f\u{4df}\x0a\x2f\x0c\x2f\x0e\
	\x2f\u{4e2}\x0b\x2f\x03\x2f\x03\x2f\x03\x2f\x03\x2f\x03\x2f\x03\x2f\x03\
	\x2f\x07\x2f\u{4eb}\x0a\x2f\x0c\x2f\x0e\x2f\u{4ee}\x0b\x2f\x03\x2f\x03\x2f\
	\x05\x2f\u{4f2}\x0a\x2f\x05\x2f\u{4f4}\x0a\x2f\x03\x2f\x03\x2f\x07\x2f\u{4f8}\
	\x0a\x2f\x0c\x2f\x0e\x2f\u{4fb}\x0b\x2f\x03\x30\x03\x30\x05\x30\u{4ff}\x0a\
	\x30\x03\x31\x03\x31\x03\x31\x03\x31\x05\x31\u{505}\x0a\x31\x03\x32\x03\
	\x32\x03\x32\x03\x32\x03\x32\x03\x33\x03\x33\x03\x33\x03\x33\x03\x33\x03\
	\x33\x03\x34\x03\x34\x03\x34\x03\x34\x03\x34\x03\x34\x03\x34\x07\x34\u{519}\
	\x0a\x34\x0c\x34\x0e\x34\u{51c}\x0b\x34\x05\x34\u{51e}\x0a\x34\x03\x34\x03\
	\x34\x03\x34\x03\x34\x03\x34\x07\x34\u{525}\x0a\x34\x0c\x34\x0e\x34\u{528}\
	\x0b\x34\x05\x34\u{52a}\x0a\x34\x03\x34\x05\x34\u{52d}\x0a\x34\x03\x34\x03\
	\x34\x03\x35\x03\x35\x03\x35\x03\x35\x03\x35\x03\x35\x03\x35\x03\x35\x03\
	\x35\x03\x35\x03\x35\x03\x35\x03\x35\x03\x35\x03\x35\x03\x35\x05\x35\u{541}\
	\x0a\x35\x03\x36\x03\x36\x03\x36\x03\x36\x03\x36\x03\x36\x03\x36\x03\x36\
	\x03\x36\x05\x36\u{54c}\x0a\x36\x03\x37\x03\x37\x03\x37\x03\x37\x05\x37\
	\u{552}\x0a\x37\x03\x38\x03\x38\x03\x38\x03\x38\x03\x38\x05\x38\u{559}\x0a\
	\x38\x03\x39\x03\x39\x03\x39\x03\x39\x03\x39\x03\x39\x03\x39\x05\x39\u{562}\
	\x0a\x39\x03\x3a\x03\x3a\x03\x3a\x03\x3a\x03\x3a\x05\x3a\u{569}\x0a\x3a\
	\x03\x3b\x03\x3b\x03\x3b\x03\x3b\x05\x3b\u{56f}\x0a\x3b\x03\x3c\x03\x3c\
	\x03\x3c\x07\x3c\u{574}\x0a\x3c\x0c\x3c\x0e\x3c\u{577}\x0b\x3c\x03\x3d\x03\
	\x3d\x03\x3d\x03\x3d\x03\x3d\x05\x3d\u{57e}\x0a\x3d\x03\x3e\x03\x3e\x03\
	\x3f\x03\x3f\x05\x3f\u{584}\x0a\x3f\x03\x40\x03\x40\x03\x40\x03\x40\x03\
	\x40\x03\x40\x03\x40\x03\x40\x03\x40\x03\x40\x03\x40\x03\x40\x03\x40\x03\
	\x40\x03\x40\x03\x40\x03\x40\x03\x40\x03\x40\x03\x40\x03\x40\x03\x40\x03\
	\x40\x03\x40\x03\x40\x03\x40\x03\x40\x03\x40\x03\x40\x03\x40\x03\x40\x03\
	\x40\x03\x40\x03\x40\x03\x40\x03\x40\x03\x40\x03\x40\x03\x40\x03\x40\x03\
	\x40\x03\x40\x03\x40\x03\x40\x03\x40\x03\x40\x03\x40\x03\x40\x03\x40\x03\
	\x40\x03\x40\x03\x40\x03\x40\x03\x40\x03\x40\x03\x40\x03\x40\x03\x40\x03\
	\x40\x03\x40\x03\x40\x03\x40\x03\x40\x03\x40\x03\x40\x03\x40\x03\x40\x03\
	\x40\x03\x40\x03\x40\x03\x40\x03\x40\x03\x40\x03\x40\x03\x40\x03\x40\x03\
	\x40\x03\x40\x03\x40\x03\x40\x03\x40\x03\x40\x03\x40\x03\x40\x03\x40\x03\
	\x40\x03\x40\x03\x40\x03\x40\x03\x40\x03\x40\x03\x40\x03\x40\x03\x40\x03\
	\x40\x05\x40\u{5e5}\x0a\x40\x03\x41\x03\x41\x03\x41\x02\x08\x1a\x30\x44\
	\x4a\x4e\x5c\x42\x02\x04\x06\x08\x0a\x0c\x0e\x10\x12\x14\x16\x18\x1a\x1c\
	\x1e\x20\x22\x24\x26\x28\x2a\x2c\x2e\x30\x32\x34\x36\x38\x3a\x3c\x3e\x40\
	\x42\x44\x46\x48\x4a\x4c\x4e\x50\x52\x54\x56\x58\x5a\x5c\x5e\x60\x62\x64\
	\x66\x68\x6a\x6c\x6e\x70\x72\x74\x76\x78\x7a\x7c\x7e\u{80}\x02\x16\x03\x02\
	\u{af}\u{b0}\x04\x02\x0d\x0d\x21\x21\x04\x02\x10\x10\u{ca}\u{ca}\x03\x02\
	\u{b1}\u{b2}\x03\x02\u{89}\u{8a}\x03\x02\x2f\x30\x03\x02\x2c\x2d\x04\x02\
	\x10\x10\x13\x13\x03\x02\u{8d}\u{8f}\x03\x02\u{c2}\u{c3}\x03\x02\u{c4}\u{c6}\
	\x03\x02\u{bc}\u{c1}\x03\x02\x10\x12\x03\x02\x29\x2a\x03\x02\x3b\x40\x03\
	\x02\x5d\x5e\x03\x02\x78\x79\x03\x02\x7a\x7c\x03\x02\u{a7}\u{a8}\x03\x02\
	\u{b5}\u{b8}\x02\u{718}\x02\u{82}\x03\x02\x02\x02\x04\u{84}\x03\x02\x02\
	\x02\x06\u{87}\x03\x02\x02\x02\x08\u{1ea}\x03\x02\x02\x02\x0a\u{1ed}\x03\
	\x02\x02\x02\x0c\u{1f1}\x03\x02\x02\x02\x0e\u{1ff}\x03\x02\x02\x02\x10\u{201}\
	\x03\x02\x02\x02\x12\u{207}\x03\x02\x02\x02\x14\u{20d}\x03\x02\x02\x02\x16\
	\u{218}\x03\x02\x02\x02\x18\u{21c}\x03\x02\x02\x02\x1a\u{22d}\x03\x02\x02\
	\x02\x1c\u{251}\x03\x02\x02\x02\x1e\u{253}\x03\x02\x02\x02\x20\u{25b}\x03\
	\x02\x02\x02\x22\u{280}\x03\x02\x02\x02\x24\u{2b2}\x03\x02\x02\x02\x26\u{2c1}\
	\x03\x02\x02\x02\x28\u{2d0}\x03\x02\x02\x02\x2a\u{2d2}\x03\x02\x02\x02\x2c\
	\u{2db}\x03\x02\x02\x02\x2e\u{2e9}\x03\x02\x02\x02\x30\u{2eb}\x03\x02\x02\
	\x02\x32\u{312}\x03\x02\x02\x02\x34\u{322}\x03\x02\x02\x02\x36\u{324}\x03\
	\x02\x02\x02\x38\u{32d}\x03\x02\x02\x02\x3a\u{32f}\x03\x02\x02\x02\x3c\u{339}\
	\x03\x02\x02\x02\x3e\u{35c}\x03\x02\x02\x02\x40\u{35e}\x03\x02\x02\x02\x42\
	\u{360}\x03\x02\x02\x02\x44\u{366}\x03\x02\x02\x02\x46\u{373}\x03\x02\x02\
	\x02\x48\u{3b4}\x03\x02\x02\x02\x4a\u{3ba}\x03\x02\x02\x02\x4c\u{3cd}\x03\
	\x02\x02\x02\x4e\u{4a0}\x03\x02\x02\x02\x50\u{4b5}\x03\x02\x02\x02\x52\u{4b7}\
	\x03\x02\x02\x02\x54\u{4b9}\x03\x02\x02\x02\x56\u{4bb}\x03\x02\x02\x02\x58\
	\u{4bd}\x03\x02\x02\x02\x5a\u{4c7}\x03\x02\x02\x02\x5c\u{4f3}\x03\x02\x02\
	\x02\x5e\u{4fe}\x03\x02\x02\x02\x60\u{504}\x03\x02\x02\x02\x62\u{506}\x03\
	\x02\x02\x02\x64\u{50b}\x03\x02\x02\x02\x66\u{511}\x03\x02\x02\x02\x68\u{540}\
	\x03\x02\x02\x02\x6a\u{54b}\x03\x02\x02\x02\x6c\u{551}\x03\x02\x02\x02\x6e\
	\u{558}\x03\x02\x02\x02\x70\u{561}\x03\x02\x02\x02\x72\u{568}\x03\x02\x02\
	\x02\x74\u{56e}\x03\x02\x02\x02\x76\u{570}\x03\x02\x02\x02\x78\u{57d}\x03\
	\x02\x02\x02\x7a\u{57f}\x03\x02\x02\x02\x7c\u{583}\x03\x02\x02\x02\x7e\u{5e4}\
	\x03\x02\x02\x02\u{80}\u{5e6}\x03\x02\x02\x02\u{82}\u{83}\x05\x04\x03\x02\
	\u{83}\x03\x03\x02\x02\x02\u{84}\u{85}\x05\x08\x05\x02\u{85}\u{86}\x07\x02\
	\x02\x03\u{86}\x05\x03\x02\x02\x02\u{87}\u{88}\x05\x42\x22\x02\u{88}\u{89}\
	\x07\x02\x02\x03\u{89}\x07\x03\x02\x02\x02\u{8a}\u{1eb}\x05\x0a\x06\x02\
	\u{8b}\u{8c}\x07\u{85}\x02\x02\u{8c}\u{1eb}\x05\x78\x3d\x02\u{8d}\u{8e}\
	\x07\u{85}\x02\x02\u{8e}\u{8f}\x05\x78\x3d\x02\u{8f}\u{90}\x07\x03\x02\x02\
	\u{90}\u{91}\x05\x78\x3d\x02\u{91}\u{1eb}\x03\x02\x02\x02\u{92}\u{93}\x07\
	\x64\x02\x02\u{93}\u{97}\x07\x65\x02\x02\u{94}\u{95}\x07\u{b9}\x02\x02\u{95}\
	\u{96}\x07\x22\x02\x02\u{96}\u{98}\x07\x24\x02\x02\u{97}\u{94}\x03\x02\x02\
	\x02\u{97}\u{98}\x03\x02\x02\x02\u{98}\u{99}\x03\x02\x02\x02\u{99}\u{9c}\
	\x05\x76\x3c\x02\u{9a}\u{9b}\x07\x61\x02\x02\u{9b}\u{9d}\x05\x14\x0b\x02\
	\u{9c}\u{9a}\x03\x02\x02\x02\u{9c}\u{9d}\x03\x02\x02\x02\u{9d}\u{1eb}\x03\
	\x02\x02\x02\u{9e}\u{9f}\x07\u{88}\x02\x02\u{9f}\u{a2}\x07\x65\x02\x02\u{a0}\
	\u{a1}\x07\u{b9}\x02\x02\u{a1}\u{a3}\x07\x24\x02\x02\u{a2}\u{a0}\x03\x02\
	\x02\x02\u{a2}\u{a3}\x03\x02\x02\x02\u{a3}\u{a4}\x03\x02\x02\x02\u{a4}\u{a6}\
	\x05\x76\x3c\x02\u{a5}\u{a7}\x09\x02\x02\x02\u{a6}\u{a5}\x03\x02\x02\x02\
	\u{a6}\u{a7}\x03\x02\x02\x02\u{a7}\u{1eb}\x03\x02\x02\x02\u{a8}\u{a9}\x07\
	\u{91}\x02\x02\u{a9}\u{aa}\x07\x65\x02\x02\u{aa}\u{ab}\x05\x76\x3c\x02\u{ab}\
	\u{ac}\x07\u{92}\x02\x02\u{ac}\u{ad}\x07\u{8c}\x02\x02\u{ad}\u{ae}\x05\x78\
	\x3d\x02\u{ae}\u{1eb}\x03\x02\x02\x02\u{af}\u{b0}\x07\x64\x02\x02\u{b0}\
	\u{b4}\x07\x66\x02\x02\u{b1}\u{b2}\x07\u{b9}\x02\x02\u{b2}\u{b3}\x07\x22\
	\x02\x02\u{b3}\u{b5}\x07\x24\x02\x02\u{b4}\u{b1}\x03\x02\x02\x02\u{b4}\u{b5}\
	\x03\x02\x02\x02\u{b5}\u{b6}\x03\x02\x02\x02\u{b6}\u{b9}\x05\x76\x3c\x02\
	\u{b7}\u{b8}\x07\x61\x02\x02\u{b8}\u{ba}\x05\x14\x0b\x02\u{b9}\u{b7}\x03\
	\x02\x02\x02\u{b9}\u{ba}\x03\x02\x02\x02\u{ba}\u{bb}\x03\x02\x02\x02\u{bb}\
	\u{bc}\x07\x0f\x02\x02\u{bc}\u{c2}\x05\x0a\x06\x02\u{bd}\u{bf}\x07\x61\x02\
	\x02\u{be}\u{c0}\x07\x23\x02\x02\u{bf}\u{be}\x03\x02\x02\x02\u{bf}\u{c0}\
	\x03\x02\x02\x02\u{c0}\u{c1}\x03\x02\x02\x02\u{c1}\u{c3}\x07\u{9a}\x02\x02\
	\u{c2}\u{bd}\x03\x02\x02\x02\u{c2}\u{c3}\x03\x02\x02\x02\u{c3}\u{1eb}\x03\
	\x02\x02\x02\u{c4}\u{c5}\x07\x64\x02\x02\u{c5}\u{c9}\x07\x66\x02\x02\u{c6}\
	\u{c7}\x07\u{b9}\x02\x02\u{c7}\u{c8}\x07\x22\x02\x02\u{c8}\u{ca}\x07\x24\
	\x02\x02\u{c9}\u{c6}\x03\x02\x02\x02\u{c9}\u{ca}\x03\x02\x02\x02\u{ca}\u{cb}\
	\x03\x02\x02\x02\u{cb}\u{cc}\x05\x76\x3c\x02\u{cc}\u{cd}\x07\x04\x02\x02\
	\u{cd}\u{d2}\x05\x0e\x08\x02\u{ce}\u{cf}\x07\x05\x02\x02\u{cf}\u{d1}\x05\
	\x0e\x08\x02\u{d0}\u{ce}\x03\x02\x02\x02\u{d1}\u{d4}\x03\x02\x02\x02\u{d2}\
	\u{d0}\x03\x02\x02\x02\u{d2}\u{d3}\x03\x02\x02\x02\u{d3}\u{d5}\x03\x02\x02\
	\x02\u{d4}\u{d2}\x03\x02\x02\x02\u{d5}\u{d8}\x07\x06\x02\x02\u{d6}\u{d7}\
	\x07\x61\x02\x02\u{d7}\u{d9}\x05\x14\x0b\x02\u{d8}\u{d6}\x03\x02\x02\x02\
	\u{d8}\u{d9}\x03\x02\x02\x02\u{d9}\u{1eb}\x03\x02\x02\x02\u{da}\u{db}\x07\
	\u{88}\x02\x02\u{db}\u{de}\x07\x66\x02\x02\u{dc}\u{dd}\x07\u{b9}\x02\x02\
	\u{dd}\u{df}\x07\x24\x02\x02\u{de}\u{dc}\x03\x02\x02\x02\u{de}\u{df}\x03\
	\x02\x02\x02\u{df}\u{e0}\x03\x02\x02\x02\u{e0}\u{1eb}\x05\x76\x3c\x02\u{e1}\
	\u{e2}\x07\x6a\x02\x02\u{e2}\u{e3}\x07\x6c\x02\x02\u{e3}\u{e5}\x05\x76\x3c\
	\x02\u{e4}\u{e6}\x05\x3c\x1f\x02\u{e5}\u{e4}\x03\x02\x02\x02\u{e5}\u{e6}\
	\x03\x02\x02\x02\u{e6}\u{e7}\x03\x02\x02\x02\u{e7}\u{e8}\x05\x0a\x06\x02\
	\u{e8}\u{1eb}\x03\x02\x02\x02\u{e9}\u{ea}\x07\x6b\x02\x02\u{ea}\u{eb}\x07\
	\x0d\x02\x02\u{eb}\u{ee}\x05\x76\x3c\x02\u{ec}\u{ed}\x07\x14\x02\x02\u{ed}\
	\u{ef}\x05\x44\x23\x02\u{ee}\u{ec}\x03\x02\x02\x02\u{ee}\u{ef}\x03\x02\x02\
	\x02\u{ef}\u{1eb}\x03\x02\x02\x02\u{f0}\u{f1}\x07\u{91}\x02\x02\u{f1}\u{f2}\
	\x07\x66\x02\x02\u{f2}\u{f3}\x05\x76\x3c\x02\u{f3}\u{f4}\x07\u{92}\x02\x02\
	\u{f4}\u{f5}\x07\u{8c}\x02\x02\u{f5}\u{f6}\x05\x76\x3c\x02\u{f6}\u{1eb}\
	\x03\x02\x02\x02\u{f7}\u{f8}\x07\u{91}\x02\x02\u{f8}\u{f9}\x07\x66\x02\x02\
	\u{f9}\u{fa}\x05\x76\x3c\x02\u{fa}\u{fb}\x07\u{92}\x02\x02\u{fb}\u{fc}\x07\
	\u{84}\x02\x02\u{fc}\u{fd}\x05\x78\x3d\x02\u{fd}\u{fe}\x07\u{8c}\x02\x02\
	\u{fe}\u{ff}\x05\x78\x3d\x02\u{ff}\u{1eb}\x03\x02\x02\x02\u{100}\u{101}\
	\x07\u{91}\x02\x02\u{101}\u{102}\x07\x66\x02\x02\u{102}\u{103}\x05\x76\x3c\
	\x02\u{103}\u{104}\x07\x0e\x02\x02\u{104}\u{105}\x07\u{84}\x02\x02\u{105}\
	\u{106}\x05\x10\x09\x02\u{106}\u{1eb}\x03\x02\x02\x02\u{107}\u{10a}\x07\
	\x64\x02\x02\u{108}\u{109}\x07\x1f\x02\x02\u{109}\u{10b}\x07\x69\x02\x02\
	\u{10a}\u{108}\x03\x02\x02\x02\u{10a}\u{10b}\x03\x02\x02\x02\u{10b}\u{10c}\
	\x03\x02\x02\x02\u{10c}\u{10d}\x07\x68\x02\x02\u{10d}\u{10e}\x05\x76\x3c\
	\x02\u{10e}\u{10f}\x07\x0f\x02\x02\u{10f}\u{110}\x05\x0a\x06\x02\u{110}\
	\u{1eb}\x03\x02\x02\x02\u{111}\u{112}\x07\u{88}\x02\x02\u{112}\u{115}\x07\
	\x68\x02\x02\u{113}\u{114}\x07\u{b9}\x02\x02\u{114}\u{116}\x07\x24\x02\x02\
	\u{115}\u{113}\x03\x02\x02\x02\u{115}\u{116}\x03\x02\x02\x02\u{116}\u{117}\
	\x03\x02\x02\x02\u{117}\u{1eb}\x05\x76\x3c\x02\u{118}\u{119}\x07\u{a9}\x02\
	\x02\u{119}\u{11a}\x05\x76\x3c\x02\u{11a}\u{123}\x07\x04\x02\x02\u{11b}\
	\u{120}\x05\x72\x3a\x02\u{11c}\u{11d}\x07\x05\x02\x02\u{11d}\u{11f}\x05\
	\x72\x3a\x02\u{11e}\u{11c}\x03\x02\x02\x02\u{11f}\u{122}\x03\x02\x02\x02\
	\u{120}\u{11e}\x03\x02\x02\x02\u{120}\u{121}\x03\x02\x02\x02\u{121}\u{124}\
	\x03\x02\x02\x02\u{122}\u{120}\x03\x02\x02\x02\u{123}\u{11b}\x03\x02\x02\
	\x02\u{123}\u{124}\x03\x02\x02\x02\u{124}\u{125}\x03\x02\x02\x02\u{125}\
	\u{126}\x07\x06\x02\x02\u{126}\u{1eb}\x03\x02\x02\x02\u{127}\u{132}\x07\
	\x6f\x02\x02\u{128}\u{12d}\x05\x74\x3b\x02\u{129}\u{12a}\x07\x05\x02\x02\
	\u{12a}\u{12c}\x05\x74\x3b\x02\u{12b}\u{129}\x03\x02\x02\x02\u{12c}\u{12f}\
	\x03\x02\x02\x02\u{12d}\u{12b}\x03\x02\x02\x02\u{12d}\u{12e}\x03\x02\x02\
	\x02\u{12e}\u{133}\x03\x02\x02\x02\u{12f}\u{12d}\x03\x02\x02\x02\u{130}\
	\u{131}\x07\x10\x02\x02\u{131}\u{133}\x07\x71\x02\x02\u{132}\u{128}\x03\
	\x02\x02\x02\u{132}\u{130}\x03\x02\x02\x02\u{133}\u{134}\x03\x02\x02\x02\
	\u{134}\u{136}\x07\x56\x02\x02\u{135}\u{137}\x07\x66\x02\x02\u{136}\u{135}\
	\x03\x02\x02\x02\u{136}\u{137}\x03\x02\x02\x02\u{137}\u{138}\x03\x02\x02\
	\x02\u{138}\u{139}\x05\x76\x3c\x02\u{139}\u{13a}\x07\u{8c}\x02\x02\u{13a}\
	\u{13e}\x05\x78\x3d\x02\u{13b}\u{13c}\x07\x61\x02\x02\u{13c}\u{13d}\x07\
	\x6f\x02\x02\u{13d}\u{13f}\x07\x73\x02\x02\u{13e}\u{13b}\x03\x02\x02\x02\
	\u{13e}\u{13f}\x03\x02\x02\x02\u{13f}\u{1eb}\x03\x02\x02\x02\u{140}\u{144}\
	\x07\x70\x02\x02\u{141}\u{142}\x07\x6f\x02\x02\u{142}\u{143}\x07\x73\x02\
	\x02\u{143}\u{145}\x07\x33\x02\x02\u{144}\u{141}\x03\x02\x02\x02\u{144}\
	\u{145}\x03\x02\x02\x02\u{145}\u{150}\x03\x02\x02\x02\u{146}\u{14b}\x05\
	\x74\x3b\x02\u{147}\u{148}\x07\x05\x02\x02\u{148}\u{14a}\x05\x74\x3b\x02\
	\u{149}\u{147}\x03\x02\x02\x02\u{14a}\u{14d}\x03\x02\x02\x02\u{14b}\u{149}\
	\x03\x02\x02\x02\u{14b}\u{14c}\x03\x02\x02\x02\u{14c}\u{151}\x03\x02\x02\
	\x02\u{14d}\u{14b}\x03\x02\x02\x02\u{14e}\u{14f}\x07\x10\x02\x02\u{14f}\
	\u{151}\x07\x71\x02\x02\u{150}\u{146}\x03\x02\x02\x02\u{150}\u{14e}\x03\
	\x02\x02\x02\u{151}\u{152}\x03\x02\x02\x02\u{152}\u{154}\x07\x56\x02\x02\
	\u{153}\u{155}\x07\x66\x02\x02\u{154}\u{153}\x03\x02\x02\x02\u{154}\u{155}\
	\x03\x02\x02\x02\u{155}\u{156}\x03\x02\x02\x02\u{156}\u{157}\x05\x76\x3c\
	\x02\u{157}\u{158}\x07\x0d\x02\x02\u{158}\u{159}\x05\x78\x3d\x02\u{159}\
	\u{1eb}\x03\x02\x02\x02\u{15a}\u{15c}\x07\x74\x02\x02\u{15b}\u{15d}\x07\
	\x75\x02\x02\u{15c}\u{15b}\x03\x02\x02\x02\u{15c}\u{15d}\x03\x02\x02\x02\
	\u{15d}\u{169}\x03\x02\x02\x02\u{15e}\u{15f}\x07\x04\x02\x02\u{15f}\u{164}\
	\x05\x6c\x37\x02\u{160}\u{161}\x07\x05\x02\x02\u{161}\u{163}\x05\x6c\x37\
	\x02\u{162}\u{160}\x03\x02\x02\x02\u{163}\u{166}\x03\x02\x02\x02\u{164}\
	\u{162}\x03\x02\x02\x02\u{164}\u{165}\x03\x02\x02\x02\u{165}\u{167}\x03\
	\x02\x02\x02\u{166}\u{164}\x03\x02\x02\x02\u{167}\u{168}\x07\x06\x02\x02\
	\u{168}\u{16a}\x03\x02\x02\x02\u{169}\u{15e}\x03\x02\x02\x02\u{169}\u{16a}\
	\x03\x02\x02\x02\u{16a}\u{16b}\x03\x02\x02\x02\u{16b}\u{1eb}\x05\x08\x05\
	\x02\u{16c}\u{16d}\x07\x7f\x02\x02\u{16d}\u{16e}\x07\x64\x02\x02\u{16e}\
	\u{16f}\x07\x66\x02\x02\u{16f}\u{1eb}\x05\x76\x3c\x02\u{170}\u{171}\x07\
	\x7f\x02\x02\u{171}\u{172}\x07\x64\x02\x02\u{172}\u{173}\x07\x68\x02\x02\
	\u{173}\u{1eb}\x05\x76\x3c\x02\u{174}\u{175}\x07\x7f\x02\x02\u{175}\u{178}\
	\x07\u{80}\x02\x02\u{176}\u{177}\x09\x03\x02\x02\u{177}\u{179}\x05\x76\x3c\
	\x02\u{178}\u{176}\x03\x02\x02\x02\u{178}\u{179}\x03\x02\x02\x02\u{179}\
	\u{17c}\x03\x02\x02\x02\u{17a}\u{17b}\x07\x26\x02\x02\u{17b}\u{17d}\x07\
	\u{c8}\x02\x02\u{17c}\u{17a}\x03\x02\x02\x02\u{17c}\u{17d}\x03\x02\x02\x02\
	\u{17d}\u{1eb}\x03\x02\x02\x02\u{17e}\u{17f}\x07\x7f\x02\x02\u{17f}\u{182}\
	\x07\u{81}\x02\x02\u{180}\u{181}\x09\x03\x02\x02\u{181}\u{183}\x05\x78\x3d\
	\x02\u{182}\u{180}\x03\x02\x02\x02\u{182}\u{183}\x03\x02\x02\x02\u{183}\
	\u{186}\x03\x02\x02\x02\u{184}\u{185}\x07\x26\x02\x02\u{185}\u{187}\x07\
	\u{c8}\x02\x02\u{186}\u{184}\x03\x02\x02\x02\u{186}\u{187}\x03\x02\x02\x02\
	\u{187}\u{1eb}\x03\x02\x02\x02\u{188}\u{189}\x07\x7f\x02\x02\u{189}\u{18c}\
	\x07\u{82}\x02\x02\u{18a}\u{18b}\x07\x26\x02\x02\u{18b}\u{18d}\x07\u{c8}\
	\x02\x02\u{18c}\u{18a}\x03\x02\x02\x02\u{18c}\u{18d}\x03\x02\x02\x02\u{18d}\
	\u{1eb}\x03\x02\x02\x02\u{18e}\u{18f}\x07\x7f\x02\x02\u{18f}\u{190}\x07\
	\u{83}\x02\x02\u{190}\u{191}\x09\x03\x02\x02\u{191}\u{1eb}\x05\x76\x3c\x02\
	\u{192}\u{193}\x07\x6e\x02\x02\u{193}\u{1eb}\x05\x76\x3c\x02\u{194}\u{195}\
	\x07\x30\x02\x02\u{195}\u{1eb}\x05\x76\x3c\x02\u{196}\u{197}\x07\x7f\x02\
	\x02\u{197}\u{1eb}\x07\u{87}\x02\x02\u{198}\u{199}\x07\x7f\x02\x02\u{199}\
	\u{1eb}\x07\u{99}\x02\x02\u{19a}\u{19b}\x07\u{97}\x02\x02\u{19b}\u{19c}\
	\x07\u{99}\x02\x02\u{19c}\u{19d}\x05\x76\x3c\x02\u{19d}\u{19e}\x07\u{bc}\
	\x02\x02\u{19e}\u{19f}\x05\x42\x22\x02\u{19f}\u{1eb}\x03\x02\x02\x02\u{1a0}\
	\u{1a1}\x07\u{98}\x02\x02\u{1a1}\u{1a2}\x07\u{99}\x02\x02\u{1a2}\u{1eb}\
	\x05\x76\x3c\x02\u{1a3}\u{1a4}\x07\u{9b}\x02\x02\u{1a4}\u{1ad}\x07\u{9c}\
	\x02\x02\u{1a5}\u{1aa}\x05\x6e\x38\x02\u{1a6}\u{1a7}\x07\x05\x02\x02\u{1a7}\
	\u{1a9}\x05\x6e\x38\x02\u{1a8}\u{1a6}\x03\x02\x02\x02\u{1a9}\u{1ac}\x03\
	\x02\x02\x02\u{1aa}\u{1a8}\x03\x02\x02\x02\u{1aa}\u{1ab}\x03\x02\x02\x02\
	\u{1ab}\u{1ae}\x03\x02\x02\x02\u{1ac}\u{1aa}\x03\x02\x02\x02\u{1ad}\u{1a5}\
	\x03\x02\x02\x02\u{1ad}\u{1ae}\x03\x02\x02\x02\u{1ae}\u{1eb}\x03\x02\x02\
	\x02\u{1af}\u{1b1}\x07\u{9d}\x02\x02\u{1b0}\u{1b2}\x07\u{9f}\x02\x02\u{1b1}\
	\u{1b0}\x03\x02\x02\x02\u{1b1}\u{1b2}\x03\x02\x02\x02\u{1b2}\u{1eb}\x03\
	\x02\x02\x02\u{1b3}\u{1b5}\x07\u{9e}\x02\x02\u{1b4}\u{1b6}\x07\u{9f}\x02\
	\x02\u{1b5}\u{1b4}\x03\x02\x02\x02\u{1b5}\u{1b6}\x03\x02\x02\x02\u{1b6}\
	\u{1eb}\x03\x02\x02\x02\u{1b7}\u{1b8}\x07\x7f\x02\x02\u{1b8}\u{1b9}\x07\
	\u{86}\x02\x02\u{1b9}\u{1ba}\x09\x03\x02\x02\u{1ba}\u{1bd}\x05\x76\x3c\x02\
	\u{1bb}\u{1bc}\x07\x14\x02\x02\u{1bc}\u{1be}\x05\x44\x23\x02\u{1bd}\u{1bb}\
	\x03\x02\x02\x02\u{1bd}\u{1be}\x03\x02\x02\x02\u{1be}\u{1c9}\x03\x02\x02\
	\x02\u{1bf}\u{1c0}\x07\x1b\x02\x02\u{1c0}\u{1c1}\x07\x16\x02\x02\u{1c1}\
	\u{1c6}\x05\x1e\x10\x02\u{1c2}\u{1c3}\x07\x05\x02\x02\u{1c3}\u{1c5}\x05\
	\x1e\x10\x02\u{1c4}\u{1c2}\x03\x02\x02\x02\u{1c5}\u{1c8}\x03\x02\x02\x02\
	\u{1c6}\u{1c4}\x03\x02\x02\x02\u{1c6}\u{1c7}\x03\x02\x02\x02\u{1c7}\u{1ca}\
	\x03\x02\x02\x02\u{1c8}\u{1c6}\x03\x02\x02\x02\u{1c9}\u{1bf}\x03\x02\x02\
	\x02\u{1c9}\u{1ca}\x03\x02\x02\x02\u{1ca}\u{1cd}\x03\x02\x02\x02\u{1cb}\
	\u{1cc}\x07\x1d\x02\x02\u{1cc}\u{1ce}\x09\x04\x02\x02\u{1cd}\u{1cb}\x03\
	\x02\x02\x02\u{1cd}\u{1ce}\x03\x02\x02\x02\u{1ce}\u{1eb}\x03\x02\x02\x02\
	\u{1cf}\u{1d0}\x07\u{aa}\x02\x02\u{1d0}\u{1d1}\x05\x78\x3d\x02\u{1d1}\u{1d2}\
	\x07\x0d\x02\x02\u{1d2}\u{1d3}\x05\x08\x05\x02\u{1d3}\u{1eb}\x03\x02\x02\
	\x02\u{1d4}\u{1d5}\x07\u{ab}\x02\x02\u{1d5}\u{1d6}\x07\u{aa}\x02\x02\u{1d6}\
	\u{1eb}\x05\x78\x3d\x02\u{1d7}\u{1d8}\x07\u{ac}\x02\x02\u{1d8}\u{1e2}\x05\
	\x78\x3d\x02\u{1d9}\u{1da}\x07\x55\x02\x02\u{1da}\u{1df}\x05\x42\x22\x02\
	\u{1db}\u{1dc}\x07\x05\x02\x02\u{1dc}\u{1de}\x05\x42\x22\x02\u{1dd}\u{1db}\
	\x03\x02\x02\x02\u{1de}\u{1e1}\x03\x02\x02\x02\u{1df}\u{1dd}\x03\x02\x02\
	\x02\u{1df}\u{1e0}\x03\x02\x02\x02\u{1e0}\u{1e3}\x03\x02\x02\x02\u{1e1}\
	\u{1df}\x03\x02\x02\x02\u{1e2}\u{1d9}\x03\x02\x02\x02\u{1e2}\u{1e3}\x03\
	\x02\x02\x02\u{1e3}\u{1eb}\x03\x02\x02\x02\u{1e4}\u{1e5}\x07\x6e\x02\x02\
	\u{1e5}\u{1e6}\x07\u{ad}\x02\x02\u{1e6}\u{1eb}\x05\x78\x3d\x02\u{1e7}\u{1e8}\
	\x07\x6e\x02\x02\u{1e8}\u{1e9}\x07\u{ae}\x02\x02\u{1e9}\u{1eb}\x05\x78\x3d\
	\x02\u{1ea}\u{8a}\x03\x02\x02\x02\u{1ea}\u{8b}\x03\x02\x02\x02\u{1ea}\u{8d}\
	\x03\x02\x02\x02\u{1ea}\u{92}\x03\x02\x02\x02\u{1ea}\u{9e}\x03\x02\x02\x02\
	\u{1ea}\u{a8}\x03\x02\x02\x02\u{1ea}\u{af}\x03\x02\x02\x02\u{1ea}\u{c4}\
	\x03\x02\x02\x02\u{1ea}\u{da}\x03\x02\x02\x02\u{1ea}\u{e1}\x03\x02\x02\x02\
	\u{1ea}\u{e9}\x03\x02\x02\x02\u{1ea}\u{f0}\x03\x02\x02\x02\u{1ea}\u{f7}\
	\x03\x02\x02\x02\u{1ea}\u{100}\x03\x02\x02\x02\u{1ea}\u{107}\x03\x02\x02\
	\x02\u{1ea}\u{111}\x03\x02\x02\x02\u{1ea}\u{118}\x03\x02\x02\x02\u{1ea}\
	\u{127}\x03\x02\x02\x02\u{1ea}\u{140}\x03\x02\x02\x02\u{1ea}\u{15a}\x03\
	\x02\x02\x02\u{1ea}\u{16c}\x03\x02\x02\x02\u{1ea}\u{170}\x03\x02\x02\x02\
	\u{1ea}\u{174}\x03\x02\x02\x02\u{1ea}\u{17e}\x03\x02\x02\x02\u{1ea}\u{188}\
	\x03\x02\x02\x02\u{1ea}\u{18e}\x03\x02\x02\x02\u{1ea}\u{192}\x03\x02\x02\
	\x02\u{1ea}\u{194}\x03\x02\x02\x02\u{1ea}\u{196}\x03\x02\x02\x02\u{1ea}\
	\u{198}\x03\x02\x02\x02\u{1ea}\u{19a}\x03\x02\x02\x02\u{1ea}\u{1a0}\x03\
	\x02\x02\x02\u{1ea}\u{1a3}\x03\x02\x02\x02\u{1ea}\u{1af}\x03\x02\x02\x02\
	\u{1ea}\u{1b3}\x03\x02\x02\x02\u{1ea}\u{1b7}\x03\x02\x02\x02\u{1ea}\u{1cf}\
	\x03\x02\x02\x02\u{1ea}\u{1d4}\x03\x02\x02\x02\u{1ea}\u{1d7}\x03\x02\x02\
	\x02\u{1ea}\u{1e4}\x03\x02\x02\x02\u{1ea}\u{1e7}\x03\x02\x02\x02\u{1eb}\
	\x09\x03\x02\x02\x02\u{1ec}\u{1ee}\x05\x0c\x07\x02\u{1ed}\u{1ec}\x03\x02\
	\x02\x02\u{1ed}\u{1ee}\x03\x02\x02\x02\u{1ee}\u{1ef}\x03\x02\x02\x02\u{1ef}\
	\u{1f0}\x05\x18\x0d\x02\u{1f0}\x0b\x03\x02\x02\x02\u{1f1}\u{1f3}\x07\x61\
	\x02\x02\u{1f2}\u{1f4}\x07\x62\x02\x02\u{1f3}\u{1f2}\x03\x02\x02\x02\u{1f3}\
	\u{1f4}\x03\x02\x02\x02\u{1f4}\u{1f5}\x03\x02\x02\x02\u{1f5}\u{1fa}\x05\
	\x2a\x16\x02\u{1f6}\u{1f7}\x07\x05\x02\x02\u{1f7}\u{1f9}\x05\x2a\x16\x02\
	\u{1f8}\u{1f6}\x03\x02\x02\x02\u{1f9}\u{1fc}\x03\x02\x02\x02\u{1fa}\u{1f8}\
	\x03\x02\x02\x02\u{1fa}\u{1fb}\x03\x02\x02\x02\u{1fb}\x0d\x03\x02\x02\x02\
	\u{1fc}\u{1fa}\x03\x02\x02\x02\u{1fd}\u{200}\x05\x10\x09\x02\u{1fe}\u{200}\
	\x05\x12\x0a\x02\u{1ff}\u{1fd}\x03\x02\x02\x02\u{1ff}\u{1fe}\x03\x02\x02\
	\x02\u{200}\x0f\x03\x02\x02\x02\u{201}\u{202}\x05\x78\x3d\x02\u{202}\u{205}\
	\x05\x5c\x2f\x02\u{203}\u{204}\x07\x67\x02\x02\u{204}\u{206}\x07\u{c8}\x02\
	\x02\u{205}\u{203}\x03\x02\x02\x02\u{205}\u{206}\x03\x02\x02\x02\u{206}\
	\x11\x03\x02\x02\x02\u{207}\u{208}\x07\x26\x02\x02\u{208}\u{20b}\x05\x76\
	\x3c\x02\u{209}\u{20a}\x09\x05\x02\x02\u{20a}\u{20c}\x07\u{b3}\x02\x02\u{20b}\
	\u{209}\x03\x02\x02\x02\u{20b}\u{20c}\x03\x02\x02\x02\u{20c}\x13\x03\x02\
	\x02\x02\u{20d}\u{20e}\x07\x04\x02\x02\u{20e}\u{213}\x05\x16\x0c\x02\u{20f}\
	\u{210}\x07\x05\x02\x02\u{210}\u{212}\x05\x16\x0c\x02\u{211}\u{20f}\x03\
	\x02\x02\x02\u{212}\u{215}\x03\x02\x02\x02\u{213}\u{211}\x03\x02\x02\x02\
	\u{213}\u{214}\x03\x02\x02\x02\u{214}\u{216}\x03\x02\x02\x02\u{215}\u{213}\
	\x03\x02\x02\x02\u{216}\u{217}\x07\x06\x02\x02\u{217}\x15\x03\x02\x02\x02\
	\u{218}\u{219}\x05\x78\x3d\x02\u{219}\u{21a}\x07\u{bc}\x02\x02\u{21a}\u{21b}\
	\x05\x42\x22\x02\u{21b}\x17\x03\x02\x02\x02\u{21c}\u{227}\x05\x1a\x0e\x02\
	\u{21d}\u{21e}\x07\x1b\x02\x02\u{21e}\u{21f}\x07\x16\x02\x02\u{21f}\u{224}\
	\x05\x1e\x10\x02\u{220}\u{221}\x07\x05\x02\x02\u{221}\u{223}\x05\x1e\x10\
	\x02\u{222}\u{220}\x03\x02\x02\x02\u{223}\u{226}\x03\x02\x02\x02\u{224}\
	\u{222}\x03\x02\x02\x02\u{224}\u{225}\x03\x02\x02\x02\u{225}\u{228}\x03\
	\x02\x02\x02\u{226}\u{224}\x03\x02\x02\x02\u{227}\u{21d}\x03\x02\x02\x02\
	\u{227}\u{228}\x03\x02\x02\x02\u{228}\u{22b}\x03\x02\x02\x02\u{229}\u{22a}\
	\x07\x1d\x02\x02\u{22a}\u{22c}\x09\x04\x02\x02\u{22b}\u{229}\x03\x02\x02\
	\x02\u{22b}\u{22c}\x03\x02\x02\x02\u{22c}\x19\x03\x02\x02\x02\u{22d}\u{22e}\
	\x08\x0e\x01\x02\u{22e}\u{22f}\x05\x1c\x0f\x02\u{22f}\u{23e}\x03\x02\x02\
	\x02\u{230}\u{231}\x0c\x04\x02\x02\u{231}\u{233}\x07\u{8b}\x02\x02\u{232}\
	\u{234}\x05\x2c\x17\x02\u{233}\u{232}\x03\x02\x02\x02\u{233}\u{234}\x03\
	\x02\x02\x02\u{234}\u{235}\x03\x02\x02\x02\u{235}\u{23d}\x05\x1a\x0e\x05\
	\u{236}\u{237}\x0c\x03\x02\x02\u{237}\u{239}\x09\x06\x02\x02\u{238}\u{23a}\
	\x05\x2c\x17\x02\u{239}\u{238}\x03\x02\x02\x02\u{239}\u{23a}\x03\x02\x02\
	\x02\u{23a}\u{23b}\x03\x02\x02\x02\u{23b}\u{23d}\x05\x1a\x0e\x04\u{23c}\
	\u{230}\x03\x02\x02\x02\u{23c}\u{236}\x03\x02\x02\x02\u{23d}\u{240}\x03\
	\x02\x02\x02\u{23e}\u{23c}\x03\x02\x02\x02\u{23e}\u{23f}\x03\x02\x02\x02\
	\u{23f}\x1b\x03\x02\x02\x02\u{240}\u{23e}\x03\x02\x02\x02\u{241}\u{252}\
	\x05\x20\x11\x02\u{242}\u{243}\x07\x66\x02\x02\u{243}\u{252}\x05\x76\x3c\
	\x02\u{244}\u{245}\x07\x63\x02\x02\u{245}\u{24a}\x05\x42\x22\x02\u{246}\
	\u{247}\x07\x05\x02\x02\u{247}\u{249}\x05\x42\x22\x02\u{248}\u{246}\x03\
	\x02\x02\x02\u{249}\u{24c}\x03\x02\x02\x02\u{24a}\u{248}\x03\x02\x02\x02\
	\u{24a}\u{24b}\x03\x02\x02\x02\u{24b}\u{252}\x03\x02\x02\x02\u{24c}\u{24a}\
	\x03\x02\x02\x02\u{24d}\u{24e}\x07\x04\x02\x02\u{24e}\u{24f}\x05\x18\x0d\
	\x02\u{24f}\u{250}\x07\x06\x02\x02\u{250}\u{252}\x03\x02\x02\x02\u{251}\
	\u{241}\x03\x02\x02\x02\u{251}\u{242}\x03\x02\x02\x02\u{251}\u{244}\x03\
	\x02\x02\x02\u{251}\u{24d}\x03\x02\x02\x02\u{252}\x1d\x03\x02\x02\x02\u{253}\
	\u{255}\x05\x42\x22\x02\u{254}\u{256}\x09\x07\x02\x02\u{255}\u{254}\x03\
	\x02\x02\x02\u{255}\u{256}\x03\x02\x02\x02\u{256}\u{259}\x03\x02\x02\x02\
	\u{257}\u{258}\x07\x2b\x02\x02\u{258}\u{25a}\x09\x08\x02\x02\u{259}\u{257}\
	\x03\x02\x02\x02\u{259}\u{25a}\x03\x02\x02\x02\u{25a}\x1f\x03\x02\x02\x02\
	\u{25b}\u{25d}\x07\x0c\x02\x02\u{25c}\u{25e}\x05\x2c\x17\x02\u{25d}\u{25c}\
	\x03\x02\x02\x02\u{25d}\u{25e}\x03\x02\x02\x02\u{25e}\u{25f}\x03\x02\x02\
	\x02\u{25f}\u{264}\x05\x2e\x18\x02\u{260}\u{261}\x07\x05\x02\x02\u{261}\
	\u{263}\x05\x2e\x18\x02\u{262}\u{260}\x03\x02\x02\x02\u{263}\u{266}\x03\
	\x02\x02\x02\u{264}\u{262}\x03\x02\x02\x02\u{264}\u{265}\x03\x02\x02\x02\
	\u{265}\u{270}\x03\x02\x02\x02\u{266}\u{264}\x03\x02\x02\x02\u{267}\u{268}\
	\x07\x0d\x02\x02\u{268}\u{26d}\x05\x30\x19\x02\u{269}\u{26a}\x07\x05\x02\
	\x02\u{26a}\u{26c}\x05\x30\x19\x02\u{26b}\u{269}\x03\x02\x02\x02\u{26c}\
	\u{26f}\x03\x02\x02\x02\u{26d}\u{26b}\x03\x02\x02\x02\u{26d}\u{26e}\x03\
	\x02\x02\x02\u{26e}\u{271}\x03\x02\x02\x02\u{26f}\u{26d}\x03\x02\x02\x02\
	\u{270}\u{267}\x03\x02\x02\x02\u{270}\u{271}\x03\x02\x02\x02\u{271}\u{274}\
	\x03\x02\x02\x02\u{272}\u{273}\x07\x14\x02\x02\u{273}\u{275}\x05\x44\x23\
	\x02\u{274}\u{272}\x03\x02\x02\x02\u{274}\u{275}\x03\x02\x02\x02\u{275}\
	\u{279}\x03\x02\x02\x02\u{276}\u{277}\x07\x15\x02\x02\u{277}\u{278}\x07\
	\x16\x02\x02\u{278}\u{27a}\x05\x22\x12\x02\u{279}\u{276}\x03\x02\x02\x02\
	\u{279}\u{27a}\x03\x02\x02\x02\u{27a}\u{27d}\x03\x02\x02\x02\u{27b}\u{27c}\
	\x07\x1c\x02\x02\u{27c}\u{27e}\x05\x44\x23\x02\u{27d}\u{27b}\x03\x02\x02\
	\x02\u{27d}\u{27e}\x03\x02\x02\x02\u{27e}\x21\x03\x02\x02\x02\u{27f}\u{281}\
	\x05\x2c\x17\x02\u{280}\u{27f}\x03\x02\x02\x02\u{280}\u{281}\x03\x02\x02\
	\x02\u{281}\u{282}\x03\x02\x02\x02\u{282}\u{287}\x05\x24\x13\x02\u{283}\
	\u{284}\x07\x05\x02\x02\u{284}\u{286}\x05\x24\x13\x02\u{285}\u{283}\x03\
	\x02\x02\x02\u{286}\u{289}\x03\x02\x02\x02\u{287}\u{285}\x03\x02\x02\x02\
	\u{287}\u{288}\x03\x02\x02\x02\u{288}\x23\x03\x02\x02\x02\u{289}\u{287}\
	\x03\x02\x02\x02\u{28a}\u{2b3}\x05\x26\x14\x02\u{28b}\u{28c}\x07\x1a\x02\
	\x02\u{28c}\u{295}\x07\x04\x02\x02\u{28d}\u{292}\x05\x76\x3c\x02\u{28e}\
	\u{28f}\x07\x05\x02\x02\u{28f}\u{291}\x05\x76\x3c\x02\u{290}\u{28e}\x03\
	\x02\x02\x02\u{291}\u{294}\x03\x02\x02\x02\u{292}\u{290}\x03\x02\x02\x02\
	\u{292}\u{293}\x03\x02\x02\x02\u{293}\u{296}\x03\x02\x02\x02\u{294}\u{292}\
	\x03\x02\x02\x02\u{295}\u{28d}\x03\x02\x02\x02\u{295}\u{296}\x03\x02\x02\
	\x02\u{296}\u{297}\x03\x02\x02\x02\u{297}\u{2b3}\x07\x06\x02\x02\u{298}\
	\u{299}\x07\x19\x02\x02\u{299}\u{2a2}\x07\x04\x02\x02\u{29a}\u{29f}\x05\
	\x76\x3c\x02\u{29b}\u{29c}\x07\x05\x02\x02\u{29c}\u{29e}\x05\x76\x3c\x02\
	\u{29d}\u{29b}\x03\x02\x02\x02\u{29e}\u{2a1}\x03\x02\x02\x02\u{29f}\u{29d}\
	\x03\x02\x02\x02\u{29f}\u{2a0}\x03\x02\x02\x02\u{2a0}\u{2a3}\x03\x02\x02\
	\x02\u{2a1}\u{29f}\x03\x02\x02\x02\u{2a2}\u{29a}\x03\x02\x02\x02\u{2a2}\
	\u{2a3}\x03\x02\x02\x02\u{2a3}\u{2a4}\x03\x02\x02\x02\u{2a4}\u{2b3}\x07\
	\x06\x02\x02\u{2a5}\u{2a6}\x07\x17\x02\x02\u{2a6}\u{2a7}\x07\x18\x02\x02\
	\u{2a7}\u{2a8}\x07\x04\x02\x02\u{2a8}\u{2ad}\x05\x28\x15\x02\u{2a9}\u{2aa}\
	\x07\x05\x02\x02\u{2aa}\u{2ac}\x05\x28\x15\x02\u{2ab}\u{2a9}\x03\x02\x02\
	\x02\u{2ac}\u{2af}\x03\x02\x02\x02\u{2ad}\u{2ab}\x03\x02\x02\x02\u{2ad}\
	\u{2ae}\x03\x02\x02\x02\u{2ae}\u{2b0}\x03\x02\x02\x02\u{2af}\u{2ad}\x03\
	\x02\x02\x02\u{2b0}\u{2b1}\x07\x06\x02\x02\u{2b1}\u{2b3}\x03\x02\x02\x02\
	\u{2b2}\u{28a}\x03\x02\x02\x02\u{2b2}\u{28b}\x03\x02\x02\x02\u{2b2}\u{298}\
	\x03\x02\x02\x02\u{2b2}\u{2a5}\x03\x02\x02\x02\u{2b3}\x25\x03\x02\x02\x02\
	\u{2b4}\u{2bd}\x07\x04\x02\x02\u{2b5}\u{2ba}\x05\x42\x22\x02\u{2b6}\u{2b7}\
	\x07\x05\x02\x02\u{2b7}\u{2b9}\x05\x42\x22\x02\u{2b8}\u{2b6}\x03\x02\x02\
	\x02\u{2b9}\u{2bc}\x03\x02\x02\x02\u{2ba}\u{2b8}\x03\x02\x02\x02\u{2ba}\
	\u{2bb}\x03\x02\x02\x02\u{2bb}\u{2be}\x03\x02\x02\x02\u{2bc}\u{2ba}\x03\
	\x02\x02\x02\u{2bd}\u{2b5}\x03\x02\x02\x02\u{2bd}\u{2be}\x03\x02\x02\x02\
	\u{2be}\u{2bf}\x03\x02\x02\x02\u{2bf}\u{2c2}\x07\x06\x02\x02\u{2c0}\u{2c2}\
	\x05\x42\x22\x02\u{2c1}\u{2b4}\x03\x02\x02\x02\u{2c1}\u{2c0}\x03\x02\x02\
	\x02\u{2c2}\x27\x03\x02\x02\x02\u{2c3}\u{2cc}\x07\x04\x02\x02\u{2c4}\u{2c9}\
	\x05\x76\x3c\x02\u{2c5}\u{2c6}\x07\x05\x02\x02\u{2c6}\u{2c8}\x05\x76\x3c\
	\x02\u{2c7}\u{2c5}\x03\x02\x02\x02\u{2c8}\u{2cb}\x03\x02\x02\x02\u{2c9}\
	\u{2c7}\x03\x02\x02\x02\u{2c9}\u{2ca}\x03\x02\x02\x02\u{2ca}\u{2cd}\x03\
	\x02\x02\x02\u{2cb}\u{2c9}\x03\x02\x02\x02\u{2cc}\u{2c4}\x03\x02\x02\x02\
	\u{2cc}\u{2cd}\x03\x02\x02\x02\u{2cd}\u{2ce}\x03\x02\x02\x02\u{2ce}\u{2d1}\
	\x07\x06\x02\x02\u{2cf}\u{2d1}\x05\x76\x3c\x02\u{2d0}\u{2c3}\x03\x02\x02\
	\x02\u{2d0}\u{2cf}\x03\x02\x02\x02\u{2d1}\x29\x03\x02\x02\x02\u{2d2}\u{2d4}\
	\x05\x78\x3d\x02\u{2d3}\u{2d5}\x05\x3c\x1f\x02\u{2d4}\u{2d3}\x03\x02\x02\
	\x02\u{2d4}\u{2d5}\x03\x02\x02\x02\u{2d5}\u{2d6}\x03\x02\x02\x02\u{2d6}\
	\u{2d7}\x07\x0f\x02\x02\u{2d7}\u{2d8}\x07\x04\x02\x02\u{2d8}\u{2d9}\x05\
	\x0a\x06\x02\u{2d9}\u{2da}\x07\x06\x02\x02\u{2da}\x2b\x03\x02\x02\x02\u{2db}\
	\u{2dc}\x09\x09\x02\x02\u{2dc}\x2d\x03\x02\x02\x02\u{2dd}\u{2e2}\x05\x42\
	\x22\x02\u{2de}\u{2e0}\x07\x0f\x02\x02\u{2df}\u{2de}\x03\x02\x02\x02\u{2df}\
	\u{2e0}\x03\x02\x02\x02\u{2e0}\u{2e1}\x03\x02\x02\x02\u{2e1}\u{2e3}\x05\
	\x78\x3d\x02\u{2e2}\u{2df}\x03\x02\x02\x02\u{2e2}\u{2e3}\x03\x02\x02\x02\
	\u{2e3}\u{2ea}\x03\x02\x02\x02\u{2e4}\u{2e5}\x05\x76\x3c\x02\u{2e5}\u{2e6}\
	\x07\x03\x02\x02\u{2e6}\u{2e7}\x07\u{c4}\x02\x02\u{2e7}\u{2ea}\x03\x02\x02\
	\x02\u{2e8}\u{2ea}\x07\u{c4}\x02\x02\u{2e9}\u{2dd}\x03\x02\x02\x02\u{2e9}\
	\u{2e4}\x03\x02\x02\x02\u{2e9}\u{2e8}\x03\x02\x02\x02\u{2ea}\x2f\x03\x02\
	\x02\x02\u{2eb}\u{2ec}\x08\x19\x01\x02\u{2ec}\u{2ed}\x05\x36\x1c\x02\u{2ed}\
	\u{300}\x03\x02\x02\x02\u{2ee}\u{2fc}\x0c\x04\x02\x02\u{2ef}\u{2f0}\x07\
	\x4e\x02\x02\u{2f0}\u{2f1}\x07\x4d\x02\x02\u{2f1}\u{2fd}\x05\x36\x1c\x02\
	\u{2f2}\u{2f3}\x05\x32\x1a\x02\u{2f3}\u{2f4}\x07\x4d\x02\x02\u{2f4}\u{2f5}\
	\x05\x30\x19\x02\u{2f5}\u{2f6}\x05\x34\x1b\x02\u{2f6}\u{2fd}\x03\x02\x02\
	\x02\u{2f7}\u{2f8}\x07\x54\x02\x02\u{2f8}\u{2f9}\x05\x32\x1a\x02\u{2f9}\
	\u{2fa}\x07\x4d\x02\x02\u{2fa}\u{2fb}\x05\x36\x1c\x02\u{2fb}\u{2fd}\x03\
	\x02\x02\x02\u{2fc}\u{2ef}\x03\x02\x02\x02\u{2fc}\u{2f2}\x03\x02\x02\x02\
	\u{2fc}\u{2f7}\x03\x02\x02\x02\u{2fd}\u{2ff}\x03\x02\x02\x02\u{2fe}\u{2ee}\
	\x03\x02\x02\x02\u{2ff}\u{302}\x03\x02\x02\x02\u{300}\u{2fe}\x03\x02\x02\
	\x02\u{300}\u{301}\x03\x02\x02\x02\u{301}\x31\x03\x02\x02\x02\u{302}\u{300}\
	\x03\x02\x02\x02\u{303}\u{305}\x07\x50\x02\x02\u{304}\u{303}\x03\x02\x02\
	\x02\u{304}\u{305}\x03\x02\x02\x02\u{305}\u{313}\x03\x02\x02\x02\u{306}\
	\u{308}\x07\x51\x02\x02\u{307}\u{309}\x07\x4f\x02\x02\u{308}\u{307}\x03\
	\x02\x02\x02\u{308}\u{309}\x03\x02\x02\x02\u{309}\u{313}\x03\x02\x02\x02\
	\u{30a}\u{30c}\x07\x52\x02\x02\u{30b}\u{30d}\x07\x4f\x02\x02\u{30c}\u{30b}\
	\x03\x02\x02\x02\u{30c}\u{30d}\x03\x02\x02\x02\u{30d}\u{313}\x03\x02\x02\
	\x02\u{30e}\u{310}\x07\x53\x02\x02\u{30f}\u{311}\x07\x4f\x02\x02\u{310}\
	\u{30f}\x03\x02\x02\x02\u{310}\u{311}\x03\x02\x02\x02\u{311}\u{313}\x03\
	\x02\x02\x02\u{312}\u{304}\x03\x02\x02\x02\u{312}\u{306}\x03\x02\x02\x02\
	\u{312}\u{30a}\x03\x02\x02\x02\u{312}\u{30e}\x03\x02\x02\x02\u{313}\x33\
	\x03\x02\x02\x02\u{314}\u{315}\x07\x56\x02\x02\u{315}\u{323}\x05\x44\x23\
	\x02\u{316}\u{317}\x07\x55\x02\x02\u{317}\u{318}\x07\x04\x02\x02\u{318}\
	\u{31d}\x05\x78\x3d\x02\u{319}\u{31a}\x07\x05\x02\x02\u{31a}\u{31c}\x05\
	\x78\x3d\x02\u{31b}\u{319}\x03\x02\x02\x02\u{31c}\u{31f}\x03\x02\x02\x02\
	\u{31d}\u{31b}\x03\x02\x02\x02\u{31d}\u{31e}\x03\x02\x02\x02\u{31e}\u{320}\
	\x03\x02\x02\x02\u{31f}\u{31d}\x03\x02\x02\x02\u{320}\u{321}\x07\x06\x02\
	\x02\u{321}\u{323}\x03\x02\x02\x02\u{322}\u{314}\x03\x02\x02\x02\u{322}\
	\u{316}\x03\x02\x02\x02\u{323}\x35\x03\x02\x02\x02\u{324}\u{32b}\x05\x3a\
	\x1e\x02\u{325}\u{326}\x07\u{90}\x02\x02\u{326}\u{327}\x05\x38\x1d\x02\u{327}\
	\u{328}\x07\x04\x02\x02\u{328}\u{329}\x05\x42\x22\x02\u{329}\u{32a}\x07\
	\x06\x02\x02\u{32a}\u{32c}\x03\x02\x02\x02\u{32b}\u{325}\x03\x02\x02\x02\
	\u{32b}\u{32c}\x03\x02\x02\x02\u{32c}\x37\x03\x02\x02\x02\u{32d}\u{32e}\
	\x09\x0a\x02\x02\u{32e}\x39\x03\x02\x02\x02\u{32f}\u{337}\x05\x3e\x20\x02\
	\u{330}\u{332}\x07\x0f\x02\x02\u{331}\u{330}\x03\x02\x02\x02\u{331}\u{332}\
	\x03\x02\x02\x02\u{332}\u{333}\x03\x02\x02\x02\u{333}\u{335}\x05\x78\x3d\
	\x02\u{334}\u{336}\x05\x3c\x1f\x02\u{335}\u{334}\x03\x02\x02\x02\u{335}\
	\u{336}\x03\x02\x02\x02\u{336}\u{338}\x03\x02\x02\x02\u{337}\u{331}\x03\
	\x02\x02\x02\u{337}\u{338}\x03\x02\x02\x02\u{338}\x3b\x03\x02\x02\x02\u{339}\
	\u{33a}\x07\x04\x02\x02\u{33a}\u{33f}\x05\x78\x3d\x02\u{33b}\u{33c}\x07\
	\x05\x02\x02\u{33c}\u{33e}\x05\x78\x3d\x02\u{33d}\u{33b}\x03\x02\x02\x02\
	\u{33e}\u{341}\x03\x02\x02\x02\u{33f}\u{33d}\x03\x02\x02\x02\u{33f}\u{340}\
	\x03\x02\x02\x02\u{340}\u{342}\x03\x02\x02\x02\u{341}\u{33f}\x03\x02\x02\
	\x02\u{342}\u{343}\x07\x06\x02\x02\u{343}\x3d\x03\x02\x02\x02\u{344}\u{35d}\
	\x05\x40\x21\x02\u{345}\u{346}\x07\x04\x02\x02\u{346}\u{347}\x05\x0a\x06\
	\x02\u{347}\u{348}\x07\x06\x02\x02\u{348}\u{35d}\x03\x02\x02\x02\u{349}\
	\u{34a}\x07\u{93}\x02\x02\u{34a}\u{34b}\x07\x04\x02\x02\u{34b}\u{350}\x05\
	\x42\x22\x02\u{34c}\u{34d}\x07\x05\x02\x02\u{34d}\u{34f}\x05\x42\x22\x02\
	\u{34e}\u{34c}\x03\x02\x02\x02\u{34f}\u{352}\x03\x02\x02\x02\u{350}\u{34e}\
	\x03\x02\x02\x02\u{350}\u{351}\x03\x02\x02\x02\u{351}\u{353}\x03\x02\x02\
	\x02\u{352}\u{350}\x03\x02\x02\x02\u{353}\u{356}\x07\x06\x02\x02\u{354}\
	\u{355}\x07\x61\x02\x02\u{355}\u{357}\x07\u{94}\x02\x02\u{356}\u{354}\x03\
	\x02\x02\x02\u{356}\u{357}\x03\x02\x02\x02\u{357}\u{35d}\x03\x02\x02\x02\
	\u{358}\u{359}\x07\x04\x02\x02\u{359}\u{35a}\x05\x30\x19\x02\u{35a}\u{35b}\
	\x07\x06\x02\x02\u{35b}\u{35d}\x03\x02\x02\x02\u{35c}\u{344}\x03\x02\x02\
	\x02\u{35c}\u{345}\x03\x02\x02\x02\u{35c}\u{349}\x03\x02\x02\x02\u{35c}\
	\u{358}\x03\x02\x02\x02\u{35d}\x3f\x03\x02\x02\x02\u{35e}\u{35f}\x05\x76\
	\x3c\x02\u{35f}\x41\x03\x02\x02\x02\u{360}\u{361}\x05\x44\x23\x02\u{361}\
	\x43\x03\x02\x02\x02\u{362}\u{363}\x08\x23\x01\x02\u{363}\u{367}\x05\x46\
	\x24\x02\u{364}\u{365}\x07\x22\x02\x02\u{365}\u{367}\x05\x44\x23\x05\u{366}\
	\u{362}\x03\x02\x02\x02\u{366}\u{364}\x03\x02\x02\x02\u{367}\u{370}\x03\
	\x02\x02\x02\u{368}\u{369}\x0c\x04\x02\x02\u{369}\u{36a}\x07\x20\x02\x02\
	\u{36a}\u{36f}\x05\x44\x23\x05\u{36b}\u{36c}\x0c\x03\x02\x02\u{36c}\u{36d}\
	\x07\x1f\x02\x02\u{36d}\u{36f}\x05\x44\x23\x04\u{36e}\u{368}\x03\x02\x02\
	\x02\u{36e}\u{36b}\x03\x02\x02\x02\u{36f}\u{372}\x03\x02\x02\x02\u{370}\
	\u{36e}\x03\x02\x02\x02\u{370}\u{371}\x03\x02\x02\x02\u{371}\x45\x03\x02\
	\x02\x02\u{372}\u{370}\x03\x02\x02\x02\u{373}\u{375}\x05\x4a\x26\x02\u{374}\
	\u{376}\x05\x48\x25\x02\u{375}\u{374}\x03\x02\x02\x02\u{375}\u{376}\x03\
	\x02\x02\x02\u{376}\x47\x03\x02\x02\x02\u{377}\u{378}\x05\x52\x2a\x02\u{378}\
	\u{379}\x05\x4a\x26\x02\u{379}\u{3b5}\x03\x02\x02\x02\u{37a}\u{37b}\x05\
	\x52\x2a\x02\u{37b}\u{37c}\x05\x54\x2b\x02\u{37c}\u{37d}\x07\x04\x02\x02\
	\u{37d}\u{37e}\x05\x0a\x06\x02\u{37e}\u{37f}\x07\x06\x02\x02\u{37f}\u{3b5}\
	\x03\x02\x02\x02\u{380}\u{382}\x07\x22\x02\x02\u{381}\u{380}\x03\x02\x02\
	\x02\u{381}\u{382}\x03\x02\x02\x02\u{382}\u{383}\x03\x02\x02\x02\u{383}\
	\u{384}\x07\x25\x02\x02\u{384}\u{385}\x05\x4a\x26\x02\u{385}\u{386}\x07\
	\x20\x02\x02\u{386}\u{387}\x05\x4a\x26\x02\u{387}\u{3b5}\x03\x02\x02\x02\
	\u{388}\u{38a}\x07\x22\x02\x02\u{389}\u{388}\x03\x02\x02\x02\u{389}\u{38a}\
	\x03\x02\x02\x02\u{38a}\u{38b}\x03\x02\x02\x02\u{38b}\u{38c}\x07\x21\x02\
	\x02\u{38c}\u{38d}\x07\x04\x02\x02\u{38d}\u{392}\x05\x42\x22\x02\u{38e}\
	\u{38f}\x07\x05\x02\x02\u{38f}\u{391}\x05\x42\x22\x02\u{390}\u{38e}\x03\
	\x02\x02\x02\u{391}\u{394}\x03\x02\x02\x02\u{392}\u{390}\x03\x02\x02\x02\
	\u{392}\u{393}\x03\x02\x02\x02\u{393}\u{395}\x03\x02\x02\x02\u{394}\u{392}\
	\x03\x02\x02\x02\u{395}\u{396}\x07\x06\x02\x02\u{396}\u{3b5}\x03\x02\x02\
	\x02\u{397}\u{399}\x07\x22\x02\x02\u{398}\u{397}\x03\x02\x02\x02\u{398}\
	\u{399}\x03\x02\x02\x02\u{399}\u{39a}\x03\x02\x02\x02\u{39a}\u{39b}\x07\
	\x21\x02\x02\u{39b}\u{39c}\x07\x04\x02\x02\u{39c}\u{39d}\x05\x0a\x06\x02\
	\u{39d}\u{39e}\x07\x06\x02\x02\u{39e}\u{3b5}\x03\x02\x02\x02\u{39f}\u{3a1}\
	\x07\x22\x02\x02\u{3a0}\u{39f}\x03\x02\x02\x02\u{3a0}\u{3a1}\x03\x02\x02\
	\x02\u{3a1}\u{3a2}\x03\x02\x02\x02\u{3a2}\u{3a3}\x07\x26\x02\x02\u{3a3}\
	\u{3a6}\x05\x4a\x26\x02\u{3a4}\u{3a5}\x07\x2e\x02\x02\u{3a5}\u{3a7}\x05\
	\x4a\x26\x02\u{3a6}\u{3a4}\x03\x02\x02\x02\u{3a6}\u{3a7}\x03\x02\x02\x02\
	\u{3a7}\u{3b5}\x03\x02\x02\x02\u{3a8}\u{3aa}\x07\x27\x02\x02\u{3a9}\u{3ab}\
	\x07\x22\x02\x02\u{3aa}\u{3a9}\x03\x02\x02\x02\u{3aa}\u{3ab}\x03\x02\x02\
	\x02\u{3ab}\u{3ac}\x03\x02\x02\x02\u{3ac}\u{3b5}\x07\x28\x02\x02\u{3ad}\
	\u{3af}\x07\x27\x02\x02\u{3ae}\u{3b0}\x07\x22\x02\x02\u{3af}\u{3ae}\x03\
	\x02\x02\x02\u{3af}\u{3b0}\x03\x02\x02\x02\u{3b0}\u{3b1}\x03\x02\x02\x02\
	\u{3b1}\u{3b2}\x07\x13\x02\x02\u{3b2}\u{3b3}\x07\x0d\x02\x02\u{3b3}\u{3b5}\
	\x05\x4a\x26\x02\u{3b4}\u{377}\x03\x02\x02\x02\u{3b4}\u{37a}\x03\x02\x02\
	\x02\u{3b4}\u{381}\x03\x02\x02\x02\u{3b4}\u{389}\x03\x02\x02\x02\u{3b4}\
	\u{398}\x03\x02\x02\x02\u{3b4}\u{3a0}\x03\x02\x02\x02\u{3b4}\u{3a8}\x03\
	\x02\x02\x02\u{3b4}\u{3ad}\x03\x02\x02\x02\u{3b5}\x49\x03\x02\x02\x02\u{3b6}\
	\u{3b7}\x08\x26\x01\x02\u{3b7}\u{3bb}\x05\x4e\x28\x02\u{3b8}\u{3b9}\x09\
	\x0b\x02\x02\u{3b9}\u{3bb}\x05\x4a\x26\x06\u{3ba}\u{3b6}\x03\x02\x02\x02\
	\u{3ba}\u{3b8}\x03\x02\x02\x02\u{3bb}\u{3ca}\x03\x02\x02\x02\u{3bc}\u{3bd}\
	\x0c\x05\x02\x02\u{3bd}\u{3be}\x09\x0c\x02\x02\u{3be}\u{3c9}\x05\x4a\x26\
	\x06\u{3bf}\u{3c0}\x0c\x04\x02\x02\u{3c0}\u{3c1}\x09\x0b\x02\x02\u{3c1}\
	\u{3c9}\x05\x4a\x26\x05\u{3c2}\u{3c3}\x0c\x03\x02\x02\u{3c3}\u{3c4}\x07\
	\u{c7}\x02\x02\u{3c4}\u{3c9}\x05\x4a\x26\x04\u{3c5}\u{3c6}\x0c\x07\x02\x02\
	\u{3c6}\u{3c7}\x07\x1e\x02\x02\u{3c7}\u{3c9}\x05\x50\x29\x02\u{3c8}\u{3bc}\
	\x03\x02\x02\x02\u{3c8}\u{3bf}\x03\x02\x02\x02\u{3c8}\u{3c2}\x03\x02\x02\
	\x02\u{3c8}\u{3c5}\x03\x02\x02\x02\u{3c9}\u{3cc}\x03\x02\x02\x02\u{3ca}\
	\u{3c8}\x03\x02\x02\x02\u{3ca}\u{3cb}\x03\x02\x02\x02\u{3cb}\x4b\x03\x02\
	\x02\x02\u{3cc}\u{3ca}\x03\x02\x02\x02\u{3cd}\u{3ce}\x05\x78\x3d\x02\u{3ce}\
	\x4d\x03\x02\x02\x02\u{3cf}\u{3d0}\x08\x28\x01\x02\u{3d0}\u{4a1}\x07\x28\
	\x02\x02\u{3d1}\u{4a1}\x05\x58\x2d\x02\u{3d2}\u{3d3}\x05\x78\x3d\x02\u{3d3}\
	\u{3d4}\x07\u{c8}\x02\x02\u{3d4}\u{4a1}\x03\x02\x02\x02\u{3d5}\u{3d6}\x07\
	\u{d2}\x02\x02\u{3d6}\u{4a1}\x07\u{c8}\x02\x02\u{3d7}\u{4a1}\x05\x7c\x3f\
	\x02\u{3d8}\u{4a1}\x05\x56\x2c\x02\u{3d9}\u{4a1}\x07\u{c8}\x02\x02\u{3da}\
	\u{4a1}\x07\u{c9}\x02\x02\u{3db}\u{4a1}\x07\x07\x02\x02\u{3dc}\u{3dd}\x07\
	\x32\x02\x02\u{3dd}\u{3de}\x07\x04\x02\x02\u{3de}\u{3df}\x05\x4a\x26\x02\
	\u{3df}\u{3e0}\x07\x21\x02\x02\u{3e0}\u{3e1}\x05\x4a\x26\x02\u{3e1}\u{3e2}\
	\x07\x06\x02\x02\u{3e2}\u{4a1}\x03\x02\x02\x02\u{3e3}\u{3e4}\x07\x04\x02\
	\x02\u{3e4}\u{3e7}\x05\x42\x22\x02\u{3e5}\u{3e6}\x07\x05\x02\x02\u{3e6}\
	\u{3e8}\x05\x42\x22\x02\u{3e7}\u{3e5}\x03\x02\x02\x02\u{3e8}\u{3e9}\x03\
	\x02\x02\x02\u{3e9}\u{3e7}\x03\x02\x02\x02\u{3e9}\u{3ea}\x03\x02\x02\x02\
	\u{3ea}\u{3eb}\x03\x02\x02\x02\u{3eb}\u{3ec}\x07\x06\x02\x02\u{3ec}\u{4a1}\
	\x03\x02\x02\x02\u{3ed}\u{3ee}\x07\x60\x02\x02\u{3ee}\u{3ef}\x07\x04\x02\
	\x02\u{3ef}\u{3f4}\x05\x42\x22\x02\u{3f0}\u{3f1}\x07\x05\x02\x02\u{3f1}\
	\u{3f3}\x05\x42\x22\x02\u{3f2}\u{3f0}\x03\x02\x02\x02\u{3f3}\u{3f6}\x03\
	\x02\x02\x02\u{3f4}\u{3f2}\x03\x02\x02\x02\u{3f4}\u{3f5}\x03\x02\x02\x02\
	\u{3f5}\u{3f7}\x03\x02\x02\x02\u{3f6}\u{3f4}\x03\x02\x02\x02\u{3f7}\u{3f8}\
	\x07\x06\x02\x02\u{3f8}\u{4a1}\x03\x02\x02\x02\u{3f9}\u{3fa}\x05\x76\x3c\
	\x02\u{3fa}\u{3fb}\x07\x04\x02\x02\u{3fb}\u{3fc}\x07\u{c4}\x02\x02\u{3fc}\
	\u{3fe}\x07\x06\x02\x02\u{3fd}\u{3ff}\x05\x64\x33\x02\u{3fe}\u{3fd}\x03\
	\x02\x02\x02\u{3fe}\u{3ff}\x03\x02\x02\x02\u{3ff}\u{401}\x03\x02\x02\x02\
	\u{400}\u{402}\x05\x66\x34\x02\u{401}\u{400}\x03\x02\x02\x02\u{401}\u{402}\
	\x03\x02\x02\x02\u{402}\u{4a1}\x03\x02\x02\x02\u{403}\u{404}\x05\x76\x3c\
	\x02\u{404}\u{410}\x07\x04\x02\x02\u{405}\u{407}\x05\x2c\x17\x02\u{406}\
	\u{405}\x03\x02\x02\x02\u{406}\u{407}\x03\x02\x02\x02\u{407}\u{408}\x03\
	\x02\x02\x02\u{408}\u{40d}\x05\x42\x22\x02\u{409}\u{40a}\x07\x05\x02\x02\
	\u{40a}\u{40c}\x05\x42\x22\x02\u{40b}\u{409}\x03\x02\x02\x02\u{40c}\u{40f}\
	\x03\x02\x02\x02\u{40d}\u{40b}\x03\x02\x02\x02\u{40d}\u{40e}\x03\x02\x02\
	\x02\u{40e}\u{411}\x03\x02\x02\x02\u{40f}\u{40d}\x03\x02\x02\x02\u{410}\
	\u{406}\x03\x02\x02\x02\u{410}\u{411}\x03\x02\x02\x02\u{411}\u{412}\x03\
	\x02\x02\x02\u{412}\u{414}\x07\x06\x02\x02\u{413}\u{415}\x05\x64\x33\x02\
	\u{414}\u{413}\x03\x02\x02\x02\u{414}\u{415}\x03\x02\x02\x02\u{415}\u{417}\
	\x03\x02\x02\x02\u{416}\u{418}\x05\x66\x34\x02\u{417}\u{416}\x03\x02\x02\
	\x02\u{417}\u{418}\x03\x02\x02\x02\u{418}\u{4a1}\x03\x02\x02\x02\u{419}\
	\u{41a}\x05\x78\x3d\x02\u{41a}\u{41b}\x07\x08\x02\x02\u{41b}\u{41c}\x05\
	\x42\x22\x02\u{41c}\u{4a1}\x03\x02\x02\x02\u{41d}\u{41e}\x07\x04\x02\x02\
	\u{41e}\u{423}\x05\x78\x3d\x02\u{41f}\u{420}\x07\x05\x02\x02\u{420}\u{422}\
	\x05\x78\x3d\x02\u{421}\u{41f}\x03\x02\x02\x02\u{422}\u{425}\x03\x02\x02\
	\x02\u{423}\u{421}\x03\x02\x02\x02\u{423}\u{424}\x03\x02\x02\x02\u{424}\
	\u{426}\x03\x02\x02\x02\u{425}\u{423}\x03\x02\x02\x02\u{426}\u{427}\x07\
	\x06\x02\x02\u{427}\u{428}\x07\x08\x02\x02\u{428}\u{429}\x05\x42\x22\x02\
	\u{429}\u{4a1}\x03\x02\x02\x02\u{42a}\u{42b}\x07\x04\x02\x02\u{42b}\u{42c}\
	\x05\x0a\x06\x02\u{42c}\u{42d}\x07\x06\x02\x02\u{42d}\u{4a1}\x03\x02\x02\
	\x02\u{42e}\u{42f}\x07\x24\x02\x02\u{42f}\u{430}\x07\x04\x02\x02\u{430}\
	\u{431}\x05\x0a\x06\x02\u{431}\u{432}\x07\x06\x02\x02\u{432}\u{4a1}\x03\
	\x02\x02\x02\u{433}\u{434}\x07\x48\x02\x02\u{434}\u{436}\x05\x4a\x26\x02\
	\u{435}\u{437}\x05\x62\x32\x02\u{436}\u{435}\x03\x02\x02\x02\u{437}\u{438}\
	\x03\x02\x02\x02\u{438}\u{436}\x03\x02\x02\x02\u{438}\u{439}\x03\x02\x02\
	\x02\u{439}\u{43c}\x03\x02\x02\x02\u{43a}\u{43b}\x07\x4b\x02\x02\u{43b}\
	\u{43d}\x05\x42\x22\x02\u{43c}\u{43a}\x03\x02\x02\x02\u{43c}\u{43d}\x03\
	\x02\x02\x02\u{43d}\u{43e}\x03\x02\x02\x02\u{43e}\u{43f}\x07\x4c\x02\x02\
	\u{43f}\u{4a1}\x03\x02\x02\x02\u{440}\u{442}\x07\x48\x02\x02\u{441}\u{443}\
	\x05\x62\x32\x02\u{442}\u{441}\x03\x02\x02\x02\u{443}\u{444}\x03\x02\x02\
	\x02\u{444}\u{442}\x03\x02\x02\x02\u{444}\u{445}\x03\x02\x02\x02\u{445}\
	\u{448}\x03\x02\x02\x02\u{446}\u{447}\x07\x4b\x02\x02\u{447}\u{449}\x05\
	\x42\x22\x02\u{448}\u{446}\x03\x02\x02\x02\u{448}\u{449}\x03\x02\x02\x02\
	\u{449}\u{44a}\x03\x02\x02\x02\u{44a}\u{44b}\x07\x4c\x02\x02\u{44b}\u{4a1}\
	\x03\x02\x02\x02\u{44c}\u{44d}\x07\x7d\x02\x02\u{44d}\u{44e}\x07\x04\x02\
	\x02\u{44e}\u{44f}\x05\x42\x22\x02\u{44f}\u{450}\x07\x0f\x02\x02\u{450}\
	\u{451}\x05\x5c\x2f\x02\u{451}\u{452}\x07\x06\x02\x02\u{452}\u{4a1}\x03\
	\x02\x02\x02\u{453}\u{454}\x07\x7e\x02\x02\u{454}\u{455}\x07\x04\x02\x02\
	\u{455}\u{456}\x05\x42\x22\x02\u{456}\u{457}\x07\x0f\x02\x02\u{457}\u{458}\
	\x05\x5c\x2f\x02\u{458}\u{459}\x07\x06\x02\x02\u{459}\u{4a1}\x03\x02\x02\
	\x02\u{45a}\u{45b}\x07\u{95}\x02\x02\u{45b}\u{464}\x07\x09\x02\x02\u{45c}\
	\u{461}\x05\x42\x22\x02\u{45d}\u{45e}\x07\x05\x02\x02\u{45e}\u{460}\x05\
	\x42\x22\x02\u{45f}\u{45d}\x03\x02\x02\x02\u{460}\u{463}\x03\x02\x02\x02\
	\u{461}\u{45f}\x03\x02\x02\x02\u{461}\u{462}\x03\x02\x02\x02\u{462}\u{465}\
	\x03\x02\x02\x02\u{463}\u{461}\x03\x02\x02\x02\u{464}\u{45c}\x03\x02\x02\
	\x02\u{464}\u{465}\x03\x02\x02\x02\u{465}\u{466}\x03\x02\x02\x02\u{466}\
	\u{4a1}\x07\x0a\x02\x02\u{467}\u{4a1}\x05\x4c\x27\x02\u{468}\u{4a1}\x07\
	\x42\x02\x02\u{469}\u{46d}\x07\x43\x02\x02\u{46a}\u{46b}\x07\x04\x02\x02\
	\u{46b}\u{46c}\x07\u{ca}\x02\x02\u{46c}\u{46e}\x07\x06\x02\x02\u{46d}\u{46a}\
	\x03\x02\x02\x02\u{46d}\u{46e}\x03\x02\x02\x02\u{46e}\u{4a1}\x03\x02\x02\
	\x02\u{46f}\u{473}\x07\x44\x02\x02\u{470}\u{471}\x07\x04\x02\x02\u{471}\
	\u{472}\x07\u{ca}\x02\x02\u{472}\u{474}\x07\x06\x02\x02\u{473}\u{470}\x03\
	\x02\x02\x02\u{473}\u{474}\x03\x02\x02\x02\u{474}\u{4a1}\x03\x02\x02\x02\
	\u{475}\u{479}\x07\x45\x02\x02\u{476}\u{477}\x07\x04\x02\x02\u{477}\u{478}\
	\x07\u{ca}\x02\x02\u{478}\u{47a}\x07\x06\x02\x02\u{479}\u{476}\x03\x02\x02\
	\x02\u{479}\u{47a}\x03\x02\x02\x02\u{47a}\u{4a1}\x03\x02\x02\x02\u{47b}\
	\u{47f}\x07\x46\x02\x02\u{47c}\u{47d}\x07\x04\x02\x02\u{47d}\u{47e}\x07\
	\u{ca}\x02\x02\u{47e}\u{480}\x07\x06\x02\x02\u{47f}\u{47c}\x03\x02\x02\x02\
	\u{47f}\u{480}\x03\x02\x02\x02\u{480}\u{4a1}\x03\x02\x02\x02\u{481}\u{482}\
	\x07\x31\x02\x02\u{482}\u{483}\x07\x04\x02\x02\u{483}\u{484}\x05\x4a\x26\
	\x02\u{484}\u{485}\x07\x0d\x02\x02\u{485}\u{488}\x05\x4a\x26\x02\u{486}\
	\u{487}\x07\x33\x02\x02\u{487}\u{489}\x05\x4a\x26\x02\u{488}\u{486}\x03\
	\x02\x02\x02\u{488}\u{489}\x03\x02\x02\x02\u{489}\u{48a}\x03\x02\x02\x02\
	\u{48a}\u{48b}\x07\x06\x02\x02\u{48b}\u{4a1}\x03\x02\x02\x02\u{48c}\u{48d}\
	\x07\u{b4}\x02\x02\u{48d}\u{48e}\x07\x04\x02\x02\u{48e}\u{491}\x05\x4a\x26\
	\x02\u{48f}\u{490}\x07\x05\x02\x02\u{490}\u{492}\x05\u{80}\x41\x02\u{491}\
	\u{48f}\x03\x02\x02\x02\u{491}\u{492}\x03\x02\x02\x02\u{492}\u{493}\x03\
	\x02\x02\x02\u{493}\u{494}\x07\x06\x02\x02\u{494}\u{4a1}\x03\x02\x02\x02\
	\u{495}\u{496}\x07\x47\x02\x02\u{496}\u{497}\x07\x04\x02\x02\u{497}\u{498}\
	\x05\x78\x3d\x02\u{498}\u{499}\x07\x0d\x02\x02\u{499}\u{49a}\x05\x4a\x26\
	\x02\u{49a}\u{49b}\x07\x06\x02\x02\u{49b}\u{4a1}\x03\x02\x02\x02\u{49c}\
	\u{49d}\x07\x04\x02\x02\u{49d}\u{49e}\x05\x42\x22\x02\u{49e}\u{49f}\x07\
	\x06\x02\x02\u{49f}\u{4a1}\x03\x02\x02\x02\u{4a0}\u{3cf}\x03\x02\x02\x02\
	\u{4a0}\u{3d1}\x03\x02\x02\x02\u{4a0}\u{3d2}\x03\x02\x02\x02\u{4a0}\u{3d5}\
	\x03\x02\x02\x02\u{4a0}\u{3d7}\x03\x02\x02\x02\u{4a0}\u{3d8}\x03\x02\x02\
	\x02\u{4a0}\u{3d9}\x03\x02\x02\x02\u{4a0}\u{3da}\x03\x02\x02\x02\u{4a0}\
	\u{3db}\x03\x02\x02\x02\u{4a0}\u{3dc}\x03\x02\x02\x02\u{4a0}\u{3e3}\x03\
	\x02\x02\x02\u{4a0}\u{3ed}\x03\x02\x02\x02\u{4a0}\u{3f9}\x03\x02\x02\x02\
	\u{4a0}\u{403}\x03\x02\x02\x02\u{4a0}\u{419}\x03\x02\x02\x02\u{4a0}\u{41d}\
	\x03\x02\x02\x02\u{4a0}\u{42a}\x03\x02\x02\x02\u{4a0}\u{42e}\x03\x02\x02\
	\x02\u{4a0}\u{433}\x03\x02\x02\x02\u{4a0}\u{440}\x03\x02\x02\x02\u{4a0}\
	\u{44c}\x03\x02\x02\x02\u{4a0}\u{453}\x03\x02\x02\x02\u{4a0}\u{45a}\x03\
	\x02\x02\x02\u{4a0}\u{467}\x03\x02\x02\x02\u{4a0}\u{468}\x03\x02\x02\x02\
	\u{4a0}\u{469}\x03\x02\x02\x02\u{4a0}\u{46f}\x03\x02\x02\x02\u{4a0}\u{475}\
	\x03\x02\x02\x02\u{4a0}\u{47b}\x03\x02\x02\x02\u{4a0}\u{481}\x03\x02\x02\
	\x02\u{4a0}\u{48c}\x03\x02\x02\x02\u{4a0}\u{495}\x03\x02\x02\x02\u{4a0}\
	\u{49c}\x03\x02\x02\x02\u{4a1}\u{4ac}\x03\x02\x02\x02\u{4a2}\u{4a3}\x0c\
	\x0e\x02\x02\u{4a3}\u{4a4}\x07\x09\x02\x02\u{4a4}\u{4a5}\x05\x4a\x26\x02\
	\u{4a5}\u{4a6}\x07\x0a\x02\x02\u{4a6}\u{4ab}\x03\x02\x02\x02\u{4a7}\u{4a8}\
	\x0c\x0c\x02\x02\u{4a8}\u{4a9}\x07\x03\x02\x02\u{4a9}\u{4ab}\x05\x78\x3d\
	\x02\u{4aa}\u{4a2}\x03\x02\x02\x02\u{4aa}\u{4a7}\x03\x02\x02\x02\u{4ab}\
	\u{4ae}\x03\x02\x02\x02\u{4ac}\u{4aa}\x03\x02\x02\x02\u{4ac}\u{4ad}\x03\
	\x02\x02\x02\u{4ad}\x4f\x03\x02\x02\x02\u{4ae}\u{4ac}\x03\x02\x02\x02\u{4af}\
	\u{4b0}\x07\x38\x02\x02\u{4b0}\u{4b1}\x07\x41\x02\x02\u{4b1}\u{4b6}\x05\
	\x58\x2d\x02\u{4b2}\u{4b3}\x07\x38\x02\x02\u{4b3}\u{4b4}\x07\x41\x02\x02\
	\u{4b4}\u{4b6}\x07\u{c8}\x02\x02\u{4b5}\u{4af}\x03\x02\x02\x02\u{4b5}\u{4b2}\
	\x03\x02\x02\x02\u{4b6}\x51\x03\x02\x02\x02\u{4b7}\u{4b8}\x09\x0d\x02\x02\
	\u{4b8}\x53\x03\x02\x02\x02\u{4b9}\u{4ba}\x09\x0e\x02\x02\u{4ba}\x55\x03\
	\x02\x02\x02\u{4bb}\u{4bc}\x09\x0f\x02\x02\u{4bc}\x57\x03\x02\x02\x02\u{4bd}\
	\u{4bf}\x07\x3a\x02\x02\u{4be}\u{4c0}\x09\x0b\x02\x02\u{4bf}\u{4be}\x03\
	\x02\x02\x02\u{4bf}\u{4c0}\x03\x02\x02\x02\u{4c0}\u{4c1}\x03\x02\x02\x02\
	\u{4c1}\u{4c2}\x07\u{c8}\x02\x02\u{4c2}\u{4c5}\x05\x5a\x2e\x02\u{4c3}\u{4c4}\
	\x07\u{8c}\x02\x02\u{4c4}\u{4c6}\x05\x5a\x2e\x02\u{4c5}\u{4c3}\x03\x02\x02\
	\x02\u{4c5}\u{4c6}\x03\x02\x02\x02\u{4c6}\x59\x03\x02\x02\x02\u{4c7}\u{4c8}\
	\x09\x10\x02\x02\u{4c8}\x5b\x03\x02\x02\x02\u{4c9}\u{4ca}\x08\x2f\x01\x02\
	\u{4ca}\u{4cb}\x07\u{95}\x02\x02\u{4cb}\u{4cc}\x07\u{be}\x02\x02\u{4cc}\
	\u{4cd}\x05\x5c\x2f\x02\u{4cd}\u{4ce}\x07\u{c0}\x02\x02\u{4ce}\u{4f4}\x03\
	\x02\x02\x02\u{4cf}\u{4d0}\x07\u{96}\x02\x02\u{4d0}\u{4d1}\x07\u{be}\x02\
	\x02\u{4d1}\u{4d2}\x05\x5c\x2f\x02\u{4d2}\u{4d3}\x07\x05\x02\x02\u{4d3}\
	\u{4d4}\x05\x5c\x2f\x02\u{4d4}\u{4d5}\x07\u{c0}\x02\x02\u{4d5}\u{4f4}\x03\
	\x02\x02\x02\u{4d6}\u{4d7}\x07\x60\x02\x02\u{4d7}\u{4d8}\x07\x04\x02\x02\
	\u{4d8}\u{4d9}\x05\x78\x3d\x02\u{4d9}\u{4e0}\x05\x5c\x2f\x02\u{4da}\u{4db}\
	\x07\x05\x02\x02\u{4db}\u{4dc}\x05\x78\x3d\x02\u{4dc}\u{4dd}\x05\x5c\x2f\
	\x02\u{4dd}\u{4df}\x03\x02\x02\x02\u{4de}\u{4da}\x03\x02\x02\x02\u{4df}\
	\u{4e2}\x03\x02\x02\x02\u{4e0}\u{4de}\x03\x02\x02\x02\u{4e0}\u{4e1}\x03\
	\x02\x02\x02\u{4e1}\u{4e3}\x03\x02\x02\x02\u{4e2}\u{4e0}\x03\x02\x02\x02\
	\u{4e3}\u{4e4}\x07\x06\x02\x02\u{4e4}\u{4f4}\x03\x02\x02\x02\u{4e5}\u{4f1}\
	\x05\x60\x31\x02\u{4e6}\u{4e7}\x07\x04\x02\x02\u{4e7}\u{4ec}\x05\x5e\x30\
	\x02\u{4e8}\u{4e9}\x07\x05\x02\x02\u{4e9}\u{4eb}\x05\x5e\x30\x02\u{4ea}\
	\u{4e8}\x03\x02\x02\x02\u{4eb}\u{4ee}\x03\x02\x02\x02\u{4ec}\u{4ea}\x03\
	\x02\x02\x02\u{4ec}\u{4ed}\x03\x02\x02\x02\u{4ed}\u{4ef}\x03\x02\x02\x02\
	\u{4ee}\u{4ec}\x03\x02\x02\x02\u{4ef}\u{4f0}\x07\x06\x02\x02\u{4f0}\u{4f2}\
	\x03\x02\x02\x02\u{4f1}\u{4e6}\x03\x02\x02\x02\u{4f1}\u{4f2}\x03\x02\x02\
	\x02\u{4f2}\u{4f4}\x03\x02\x02\x02\u{4f3}\u{4c9}\x03\x02\x02\x02\u{4f3}\
	\u{4cf}\x03\x02\x02\x02\u{4f3}\u{4d6}\x03\x02\x02\x02\u{4f3}\u{4e5}\x03\
	\x02\x02\x02\u{4f4}\u{4f9}\x03\x02\x02\x02\u{4f5}\u{4f6}\x0c\x07\x02\x02\
	\u{4f6}\u{4f8}\x07\u{95}\x02\x02\u{4f7}\u{4f5}\x03\x02\x02\x02\u{4f8}\u{4fb}\
	\x03\x02\x02\x02\u{4f9}\u{4f7}\x03\x02\x02\x02\u{4f9}\u{4fa}\x03\x02\x02\
	\x02\u{4fa}\x5d\x03\x02\x02\x02\u{4fb}\u{4f9}\x03\x02\x02\x02\u{4fc}\u{4ff}\
	\x07\u{ca}\x02\x02\u{4fd}\u{4ff}\x05\x5c\x2f\x02\u{4fe}\u{4fc}\x03\x02\x02\
	\x02\u{4fe}\u{4fd}\x03\x02\x02\x02\u{4ff}\x5f\x03\x02\x02\x02\u{500}\u{505}\
	\x07\u{d0}\x02\x02\u{501}\u{505}\x07\u{d1}\x02\x02\u{502}\u{505}\x07\u{d2}\
	\x02\x02\u{503}\u{505}\x05\x78\x3d\x02\u{504}\u{500}\x03\x02\x02\x02\u{504}\
	\u{501}\x03\x02\x02\x02\u{504}\u{502}\x03\x02\x02\x02\u{504}\u{503}\x03\
	\x02\x02\x02\u{505}\x61\x03\x02\x02\x02\u{506}\u{507}\x07\x49\x02\x02\u{507}\
	\u{508}\x05\x42\x22\x02\u{508}\u{509}\x07\x4a\x02\x02\u{509}\u{50a}\x05\
	\x42\x22\x02\u{50a}\x63\x03\x02\x02\x02\u{50b}\u{50c}\x07\x57\x02\x02\u{50c}\
	\u{50d}\x07\x04\x02\x02\u{50d}\u{50e}\x07\x14\x02\x02\u{50e}\u{50f}\x05\
	\x44\x23\x02\u{50f}\u{510}\x07\x06\x02\x02\u{510}\x65\x03\x02\x02\x02\u{511}\
	\u{512}\x07\x58\x02\x02\u{512}\u{51d}\x07\x04\x02\x02\u{513}\u{514}\x07\
	\x59\x02\x02\u{514}\u{515}\x07\x16\x02\x02\u{515}\u{51a}\x05\x42\x22\x02\
	\u{516}\u{517}\x07\x05\x02\x02\u{517}\u{519}\x05\x42\x22\x02\u{518}\u{516}\
	\x03\x02\x02\x02\u{519}\u{51c}\x03\x02\x02\x02\u{51a}\u{518}\x03\x02\x02\
	\x02\u{51a}\u{51b}\x03\x02\x02\x02\u{51b}\u{51e}\x03\x02\x02\x02\u{51c}\
	\u{51a}\x03\x02\x02\x02\u{51d}\u{513}\x03\x02\x02\x02\u{51d}\u{51e}\x03\
	\x02\x02\x02\u{51e}\u{529}\x03\x02\x02\x02\u{51f}\u{520}\x07\x1b\x02\x02\
	\u{520}\u{521}\x07\x16\x02\x02\u{521}\u{526}\x05\x1e\x10\x02\u{522}\u{523}\
	\x07\x05\x02\x02\u{523}\u{525}\x05\x1e\x10\x02\u{524}\u{522}\x03\x02\x02\
	\x02\u{525}\u{528}\x03\x02\x02\x02\u{526}\u{524}\x03\x02\x02\x02\u{526}\
	\u{527}\x03\x02\x02\x02\u{527}\u{52a}\x03\x02\x02\x02\u{528}\u{526}\x03\
	\x02\x02\x02\u{529}\u{51f}\x03\x02\x02\x02\u{529}\u{52a}\x03\x02\x02\x02\
	\u{52a}\u{52c}\x03\x02\x02\x02\u{52b}\u{52d}\x05\x68\x35\x02\u{52c}\u{52b}\
	\x03\x02\x02\x02\u{52c}\u{52d}\x03\x02\x02\x02\u{52d}\u{52e}\x03\x02\x02\
	\x02\u{52e}\u{52f}\x07\x06\x02\x02\u{52f}\x67\x03\x02\x02\x02\u{530}\u{531}\
	\x07\x5a\x02\x02\u{531}\u{541}\x05\x6a\x36\x02\u{532}\u{533}\x07\x5b\x02\
	\x02\u{533}\u{541}\x05\x6a\x36\x02\u{534}\u{535}\x07\x5a\x02\x02\u{535}\
	\u{536}\x07\x25\x02\x02\u{536}\u{537}\x05\x6a\x36\x02\u{537}\u{538}\x07\
	\x20\x02\x02\u{538}\u{539}\x05\x6a\x36\x02\u{539}\u{541}\x03\x02\x02\x02\
	\u{53a}\u{53b}\x07\x5b\x02\x02\u{53b}\u{53c}\x07\x25\x02\x02\u{53c}\u{53d}\
	\x05\x6a\x36\x02\u{53d}\u{53e}\x07\x20\x02\x02\u{53e}\u{53f}\x05\x6a\x36\
	\x02\u{53f}\u{541}\x03\x02\x02\x02\u{540}\u{530}\x03\x02\x02\x02\u{540}\
	\u{532}\x03\x02\x02\x02\u{540}\u{534}\x03\x02\x02\x02\u{540}\u{53a}\x03\
	\x02\x02\x02\u{541}\x69\x03\x02\x02\x02\u{542}\u{543}\x07\x5c\x02\x02\u{543}\
	\u{54c}\x07\x5d\x02\x02\u{544}\u{545}\x07\x5c\x02\x02\u{545}\u{54c}\x07\
	\x5e\x02\x02\u{546}\u{547}\x07\x5f\x02\x02\u{547}\u{54c}\x07\x60\x02\x02\
	\u{548}\u{549}\x05\x42\x22\x02\u{549}\u{54a}\x09\x11\x02\x02\u{54a}\u{54c}\
	\x03\x02\x02\x02\u{54b}\u{542}\x03\x02\x02\x02\u{54b}\u{544}\x03\x02\x02\
	\x02\u{54b}\u{546}\x03\x02\x02\x02\u{54b}\u{548}\x03\x02\x02\x02\u{54c}\
	\x6b\x03\x02\x02\x02\u{54d}\u{54e}\x07\x76\x02\x02\u{54e}\u{552}\x09\x12\
	\x02\x02\u{54f}\u{550}\x07\x77\x02\x02\u{550}\u{552}\x09\x13\x02\x02\u{551}\
	\u{54d}\x03\x02\x02\x02\u{551}\u{54f}\x03\x02\x02\x02\u{552}\x6d\x03\x02\
	\x02\x02\u{553}\u{554}\x07\u{a0}\x02\x02\u{554}\u{555}\x07\u{a1}\x02\x02\
	\u{555}\u{559}\x05\x70\x39\x02\u{556}\u{557}\x07\u{a6}\x02\x02\u{557}\u{559}\
	\x09\x14\x02\x02\u{558}\u{553}\x03\x02\x02\x02\u{558}\u{556}\x03\x02\x02\
	\x02\u{559}\x6f\x03\x02\x02\x02\u{55a}\u{55b}\x07\u{a6}\x02\x02\u{55b}\u{562}\
	\x07\u{a5}\x02\x02\u{55c}\u{55d}\x07\u{a6}\x02\x02\u{55d}\u{562}\x07\u{a4}\
	\x02\x02\u{55e}\u{55f}\x07\u{a3}\x02\x02\u{55f}\u{562}\x07\u{a6}\x02\x02\
	\u{560}\u{562}\x07\u{a2}\x02\x02\u{561}\u{55a}\x03\x02\x02\x02\u{561}\u{55c}\
	\x03\x02\x02\x02\u{561}\u{55e}\x03\x02\x02\x02\u{561}\u{560}\x03\x02\x02\
	\x02\u{562}\x71\x03\x02\x02\x02\u{563}\u{569}\x05\x42\x22\x02\u{564}\u{565}\
	\x05\x78\x3d\x02\u{565}\u{566}\x07\x0b\x02\x02\u{566}\u{567}\x05\x42\x22\
	\x02\u{567}\u{569}\x03\x02\x02\x02\u{568}\u{563}\x03\x02\x02\x02\u{568}\
	\u{564}\x03\x02\x02\x02\u{569}\x73\x03\x02\x02\x02\u{56a}\u{56f}\x07\x0c\
	\x02\x02\u{56b}\u{56f}\x07\x6b\x02\x02\u{56c}\u{56f}\x07\x6a\x02\x02\u{56d}\
	\u{56f}\x05\x78\x3d\x02\u{56e}\u{56a}\x03\x02\x02\x02\u{56e}\u{56b}\x03\
	\x02\x02\x02\u{56e}\u{56c}\x03\x02\x02\x02\u{56e}\u{56d}\x03\x02\x02\x02\
	\u{56f}\x75\x03\x02\x02\x02\u{570}\u{575}\x05\x78\x3d\x02\u{571}\u{572}\
	\x07\x03\x02\x02\u{572}\u{574}\x05\x78\x3d\x02\u{573}\u{571}\x03\x02\x02\
	\x02\u{574}\u{577}\x03\x02\x02\x02\u{575}\u{573}\x03\x02\x02\x02\u{575}\
	\u{576}\x03\x02\x02\x02\u{576}\x77\x03\x02\x02\x02\u{577}\u{575}\x03\x02\
	\x02\x02\u{578}\u{57e}\x07\u{cc}\x02\x02\u{579}\u{57e}\x05\x7a\x3e\x02\u{57a}\
	\u{57e}\x05\x7e\x40\x02\u{57b}\u{57e}\x07\u{cf}\x02\x02\u{57c}\u{57e}\x07\
	\u{cd}\x02\x02\u{57d}\u{578}\x03\x02\x02\x02\u{57d}\u{579}\x03\x02\x02\x02\
	\u{57d}\u{57a}\x03\x02\x02\x02\u{57d}\u{57b}\x03\x02\x02\x02\u{57d}\u{57c}\
	\x03\x02\x02\x02\u{57e}\x79\x03\x02\x02\x02\u{57f}\u{580}\x07\u{ce}\x02\
	\x02\u{580}\x7b\x03\x02\x02\x02\u{581}\u{584}\x07\u{cb}\x02\x02\u{582}\u{584}\
	\x07\u{ca}\x02\x02\u{583}\u{581}\x03\x02\x02\x02\u{583}\u{582}\x03\x02\x02\
	\x02\u{584}\x7d\x03\x02\x02\x02\u{585}\u{5e5}\x07\x7f\x02\x02\u{586}\u{5e5}\
	\x07\u{80}\x02\x02\u{587}\u{5e5}\x07\u{83}\x02\x02\u{588}\u{5e5}\x07\u{84}\
	\x02\x02\u{589}\u{5e5}\x07\u{86}\x02\x02\u{58a}\u{5e5}\x07\u{87}\x02\x02\
	\u{58b}\u{5e5}\x07\u{81}\x02\x02\u{58c}\u{5e5}\x07\u{82}\x02\x02\u{58d}\
	\u{5e5}\x07\u{99}\x02\x02\u{58e}\u{5e5}\x07\x0e\x02\x02\u{58f}\u{5e5}\x07\
	\x57\x02\x02\u{590}\u{5e5}\x07\x1e\x02\x02\u{591}\u{5e5}\x07\x58\x02\x02\
	\u{592}\u{5e5}\x07\x59\x02\x02\u{593}\u{5e5}\x07\x5a\x02\x02\u{594}\u{5e5}\
	\x07\x5b\x02\x02\u{595}\u{5e5}\x07\x5d\x02\x02\u{596}\u{5e5}\x07\x5e\x02\
	\x02\u{597}\u{5e5}\x07\x5f\x02\x02\u{598}\u{5e5}\x07\x60\x02\x02\u{599}\
	\u{5e5}\x07\u{96}\x02\x02\u{59a}\u{5e5}\x07\u{95}\x02\x02\u{59b}\u{5e5}\
	\x07\x34\x02\x02\u{59c}\u{5e5}\x07\x35\x02\x02\u{59d}\u{5e5}\x07\x36\x02\
	\x02\u{59e}\u{5e5}\x07\x37\x02\x02\u{59f}\u{5e5}\x07\x38\x02\x02\u{5a0}\
	\u{5e5}\x07\x39\x02\x02\u{5a1}\u{5e5}\x07\x3a\x02\x02\u{5a2}\u{5e5}\x07\
	\x41\x02\x02\u{5a3}\u{5e5}\x07\x3b\x02\x02\u{5a4}\u{5e5}\x07\x3c\x02\x02\
	\u{5a5}\u{5e5}\x07\x3d\x02\x02\u{5a6}\u{5e5}\x07\x3e\x02\x02\u{5a7}\u{5e5}\
	\x07\x3f\x02\x02\u{5a8}\u{5e5}\x07\x40\x02\x02\u{5a9}\u{5e5}\x07\x74\x02\
	\x02\u{5aa}\u{5e5}\x07\x75\x02\x02\u{5ab}\u{5e5}\x07\x76\x02\x02\u{5ac}\
	\u{5e5}\x07\x77\x02\x02\u{5ad}\u{5e5}\x07\x78\x02\x02\u{5ae}\u{5e5}\x07\
	\x79\x02\x02\u{5af}\u{5e5}\x07\x7a\x02\x02\u{5b0}\u{5e5}\x07\x7b\x02\x02\
	\u{5b1}\u{5e5}\x07\x7c\x02\x02\u{5b2}\u{5e5}\x07\u{90}\x02\x02\u{5b3}\u{5e5}\
	\x07\u{8d}\x02\x02\u{5b4}\u{5e5}\x07\u{8e}\x02\x02\u{5b5}\u{5e5}\x07\u{8f}\
	\x02\x02\u{5b6}\u{5e5}\x07\u{85}\x02\x02\u{5b7}\u{5e5}\x07\u{8c}\x02\x02\
	\u{5b8}\u{5e5}\x07\u{97}\x02\x02\u{5b9}\u{5e5}\x07\u{98}\x02\x02\u{5ba}\
	\u{5e5}\x07\x68\x02\x02\u{5bb}\u{5e5}\x07\x69\x02\x02\u{5bc}\u{5e5}\x07\
	\u{b9}\x02\x02\u{5bd}\u{5e5}\x07\u{ba}\x02\x02\u{5be}\u{5e5}\x07\u{bb}\x02\
	\x02\u{5bf}\u{5e5}\x05\u{80}\x41\x02\u{5c0}\u{5e5}\x07\x32\x02\x02\u{5c1}\
	\u{5e5}\x07\x23\x02\x02\u{5c2}\u{5e5}\x07\u{9a}\x02\x02\u{5c3}\u{5e5}\x07\
	\u{9b}\x02\x02\u{5c4}\u{5e5}\x07\u{9c}\x02\x02\u{5c5}\u{5e5}\x07\u{9d}\x02\
	\x02\u{5c6}\u{5e5}\x07\u{9e}\x02\x02\u{5c7}\u{5e5}\x07\u{9f}\x02\x02\u{5c8}\
	\u{5e5}\x07\u{a0}\x02\x02\u{5c9}\u{5e5}\x07\u{a1}\x02\x02\u{5ca}\u{5e5}\
	\x07\u{a2}\x02\x02\u{5cb}\u{5e5}\x07\u{a3}\x02\x02\u{5cc}\u{5e5}\x07\u{a4}\
	\x02\x02\u{5cd}\u{5e5}\x07\u{a5}\x02\x02\u{5ce}\u{5e5}\x07\u{a6}\x02\x02\
	\u{5cf}\u{5e5}\x07\u{a7}\x02\x02\u{5d0}\u{5e5}\x07\u{a8}\x02\x02\u{5d1}\
	\u{5e5}\x07\x67\x02\x02\u{5d2}\u{5e5}\x07\u{a9}\x02\x02\u{5d3}\u{5e5}\x07\
	\x6f\x02\x02\u{5d4}\u{5e5}\x07\x70\x02\x02\u{5d5}\u{5e5}\x07\x71\x02\x02\
	\u{5d6}\u{5e5}\x07\x72\x02\x02\u{5d7}\u{5e5}\x07\x73\x02\x02\u{5d8}\u{5e5}\
	\x07\x31\x02\x02\u{5d9}\u{5e5}\x07\x65\x02\x02\u{5da}\u{5e5}\x07\u{af}\x02\
	\x02\u{5db}\u{5e5}\x07\u{b0}\x02\x02\u{5dc}\u{5e5}\x07\u{ad}\x02\x02\u{5dd}\
	\u{5e5}\x07\u{ae}\x02\x02\u{5de}\u{5e5}\x07\u{b1}\x02\x02\u{5df}\u{5e5}\
	\x07\u{b2}\x02\x02\u{5e0}\u{5e5}\x07\u{b3}\x02\x02\u{5e1}\u{5e5}\x07\x10\
	\x02\x02\u{5e2}\u{5e5}\x07\x11\x02\x02\u{5e3}\u{5e5}\x07\x12\x02\x02\u{5e4}\
	\u{585}\x03\x02\x02\x02\u{5e4}\u{586}\x03\x02\x02\x02\u{5e4}\u{587}\x03\
	\x02\x02\x02\u{5e4}\u{588}\x03\x02\x02\x02\u{5e4}\u{589}\x03\x02\x02\x02\
	\u{5e4}\u{58a}\x03\x02\x02\x02\u{5e4}\u{58b}\x03\x02\x02\x02\u{5e4}\u{58c}\
	\x03\x02\x02\x02\u{5e4}\u{58d}\x03\x02\x02\x02\u{5e4}\u{58e}\x03\x02\x02\
	\x02\u{5e4}\u{58f}\x03\x02\x02\x02\u{5e4}\u{590}\x03\x02\x02\x02\u{5e4}\
	\u{591}\x03\x02\x02\x02\u{5e4}\u{592}\x03\x02\x02\x02\u{5e4}\u{593}\x03\
	\x02\x02\x02\u{5e4}\u{594}\x03\x02\x02\x02\u{5e4}\u{595}\x03\x02\x02\x02\
	\u{5e4}\u{596}\x03\x02\x02\x02\u{5e4}\u{597}\x03\x02\x02\x02\u{5e4}\u{598}\
	\x03\x02\x02\x02\u{5e4}\u{599}\x03\x02\x02\x02\u{5e4}\u{59a}\x03\x02\x02\
	\x02\u{5e4}\u{59b}\x03\x02\x02\x02\u{5e4}\u{59c}\x03\x02\x02\x02\u{5e4}\
	\u{59d}\x03\x02\x02\x02\u{5e4}\u{59e}\x03\x02\x02\x02\u{5e4}\u{59f}\x03\
	\x02\x02\x02\u{5e4}\u{5a0}\x03\x02\x02\x02\u{5e4}\u{5a1}\x03\x02\x02\x02\
	\u{5e4}\u{5a2}\x03\x02\x02\x02\u{5e4}\u{5a3}\x03\x02\x02\x02\u{5e4}\u{5a4}\
	\x03\x02\x02\x02\u{5e4}\u{5a5}\x03\x02\x02\x02\u{5e4}\u{5a6}\x03\x02\x02\
	\x02\u{5e4}\u{5a7}\x03\x02\x02\x02\u{5e4}\u{5a8}\x03\x02\x02\x02\u{5e4}\
	\u{5a9}\x03\x02\x02\x02\u{5e4}\u{5aa}\x03\x02\x02\x02\u{5e4}\u{5ab}\x03\
	\x02\x02\x02\u{5e4}\u{5ac}\x03\x02\x02\x02\u{5e4}\u{5ad}\x03\x02\x02\x02\
	\u{5e4}\u{5ae}\x03\x02\x02\x02\u{5e4}\u{5af}\x03\x02\x02\x02\u{5e4}\u{5b0}\
	\x03\x02\x02\x02\u{5e4}\u{5b1}\x03\x02\x02\x02\u{5e4}\u{5b2}\x03\x02\x02\
	\x02\u{5e4}\u{5b3}\x03\x02\x02\x02\u{5e4}\u{5b4}\x03\x02\x02\x02\u{5e4}\
	\u{5b5}\x03\x02\x02\x02\u{5e4}\u{5b6}\x03\x02\x02\x02\u{5e4}\u{5b7}\x03\
	\x02\x02\x02\u{5e4}\u{5b8}\x03\x02\x02\x02\u{5e4}\u{5b9}\x03\x02\x02\x02\
	\u{5e4}\u{5ba}\x03\x02\x02\x02\u{5e4}\u{5bb}\x03\x02\x02\x02\u{5e4}\u{5bc}\
	\x03\x02\x02\x02\u{5e4}\u{5bd}\x03\x02\x02\x02\u{5e4}\u{5be}\x03\x02\x02\
	\x02\u{5e4}\u{5bf}\x03\x02\x02\x02\u{5e4}\u{5c0}\x03\x02\x02\x02\u{5e4}\
	\u{5c1}\x03\x02\x02\x02\u{5e4}\u{5c2}\x03\x02\x02\x02\u{5e4}\u{5c3}\x03\
	\x02\x02\x02\u{5e4}\u{5c4}\x03\x02\x02\x02\u{5e4}\u{5c5}\x03\x02\x02\x02\
	\u{5e4}\u{5c6}\x03\x02\x02\x02\u{5e4}\u{5c7}\x03\x02\x02\x02\u{5e4}\u{5c8}\
	\x03\x02\x02\x02\u{5e4}\u{5c9}\x03\x02\x02\x02\u{5e4}\u{5ca}\x03\x02\x02\
	\x02\u{5e4}\u{5cb}\x03\x02\x02\x02\u{5e4}\u{5cc}\x03\x02\x02\x02\u{5e4}\
	\u{5cd}\x03\x02\x02\x02\u{5e4}\u{5ce}\x03\x02\x02\x02\u{5e4}\u{5cf}\x03\
	\x02\x02\x02\u{5e4}\u{5d0}\x03\x02\x02\x02\u{5e4}\u{5d1}\x03\x02\x02\x02\
	\u{5e4}\u{5d2}\x03\x02\x02\x02\u{5e4}\u{5d3}\x03\x02\x02\x02\u{5e4}\u{5d4}\
	\x03\x02\x02\x02\u{5e4}\u{5d5}\x03\x02\x02\x02\u{5e4}\u{5d6}\x03\x02\x02\
	\x02\u{5e4}\u{5d7}\x03\x02\x02\x02\u{5e4}\u{5d8}\x03\x02\x02\x02\u{5e4}\
	\u{5d9}\x03\x02\x02\x02\u{5e4}\u{5da}\x03\x02\x02\x02\u{5e4}\u{5db}\x03\
	\x02\x02\x02\u{5e4}\u{5dc}\x03\x02\x02\x02\u{5e4}\u{5dd}\x03\x02\x02\x02\
	\u{5e4}\u{5de}\x03\x02\x02\x02\u{5e4}\u{5df}\x03\x02\x02\x02\u{5e4}\u{5e0}\
	\x03\x02\x02\x02\u{5e4}\u{5e1}\x03\x02\x02\x02\u{5e4}\u{5e2}\x03\x02\x02\
	\x02\u{5e4}\u{5e3}\x03\x02\x02\x02\u{5e5}\x7f\x03\x02\x02\x02\u{5e6}\u{5e7}\
	\x09\x15\x02\x02\u{5e7}\u{81}\x03\x02\x02\x02\u{ae}\u{97}\u{9c}\u{a2}\u{a6}\
	\u{b4}\u{b9}\u{bf}\u{c2}\u{c9}\u{d2}\u{d8}\u{de}\u{e5}\u{ee}\u{10a}\u{115}\
	\u{120}\u{123}\u{12d}\u{132}\u{136}\u{13e}\u{144}\u{14b}\u{150}\u{154}\u{15c}\
	\u{164}\u{169}\u{178}\u{17c}\u{182}\u{186}\u{18c}\u{1aa}\u{1ad}\u{1b1}\u{1b5}\
	\u{1bd}\u{1c6}\u{1c9}\u{1cd}\u{1df}\u{1e2}\u{1ea}\u{1ed}\u{1f3}\u{1fa}\u{1ff}\
	\u{205}\u{20b}\u{213}\u{224}\u{227}\u{22b}\u{233}\u{239}\u{23c}\u{23e}\u{24a}\
	\u{251}\u{255}\u{259}\u{25d}\u{264}\u{26d}\u{270}\u{274}\u{279}\u{27d}\u{280}\
	\u{287}\u{292}\u{295}\u{29f}\u{2a2}\u{2ad}\u{2b2}\u{2ba}\u{2bd}\u{2c1}\u{2c9}\
	\u{2cc}\u{2d0}\u{2d4}\u{2df}\u{2e2}\u{2e9}\u{2fc}\u{300}\u{304}\u{308}\u{30c}\
	\u{310}\u{312}\u{31d}\u{322}\u{32b}\u{331}\u{335}\u{337}\u{33f}\u{350}\u{356}\
	\u{35c}\u{366}\u{36e}\u{370}\u{375}\u{381}\u{389}\u{392}\u{398}\u{3a0}\u{3a6}\
	\u{3aa}\u{3af}\u{3b4}\u{3ba}\u{3c8}\u{3ca}\u{3e9}\u{3f4}\u{3fe}\u{401}\u{406}\
	\u{40d}\u{410}\u{414}\u{417}\u{423}\u{438}\u{43c}\u{444}\u{448}\u{461}\u{464}\
	\u{46d}\u{473}\u{479}\u{47f}\u{488}\u{491}\u{4a0}\u{4aa}\u{4ac}\u{4b5}\u{4bf}\
	\u{4c5}\u{4e0}\u{4ec}\u{4f1}\u{4f3}\u{4f9}\u{4fe}\u{504}\u{51a}\u{51d}\u{526}\
	\u{529}\u{52c}\u{540}\u{54b}\u{551}\u{558}\u{561}\u{568}\u{56e}\u{575}\u{57d}\
	\u{583}\u{5e4}";

