mod athenasqllexer;
mod athenasqllistener;
mod athenasqlparser;

use node_bindgen::derive::node_bindgen;

/// add two integer
#[node_bindgen]
pub fn sum(first: i32, second: i32) -> i32 {
    first + second
}

#[node_bindgen]
pub fn parse(sql: String) -> String {
    let lexer: athenasqllexer::athenasqlLexer<'_, _> = athenasqllexer::athenasqlLexer {
        input: antlr_rust::InputStream::new(sql.as_str()),
    };
    return "hello".to_string();
    // let mut token_stream = antlr_rust::CommonTokenStream::new(lexer);
    // let mut parser: athenasqlparser::athenasqlParser<
    //     '_,
    //     _,
    //     antlr_rust::DefaultErrorStrategy<'_, athenasqlparser::athenasqlParserContextType>,
    // > = athenasqlparser::athenasqlParser::new(token_stream);
    // let mut listener: athenasqllistener::athenasqlListener =
    //     athenasqllistener::athenasqlListener {};

    // athenasqlparser::athenasqlParser(sql)
}

// #[cfg(test)]
// mod tests {
//     use super::*;

//     #[test]
//     fn is_sum() {
//         assert_eq!(sum(1, 2), 3);
//     }
// }
