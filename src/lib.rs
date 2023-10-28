use node_bindgen::core::buffer::{ArrayBuffer, JSArrayBuffer};
use node_bindgen::core::val::JsEnv;
use node_bindgen::core::val::JsObject;
use node_bindgen::core::NjError;
use node_bindgen::core::TryIntoJs;
use node_bindgen::derive::node_bindgen;
use node_bindgen::sys::napi_value;

use std::fmt;

use aws_sdk_s3::model::GetObjectRequest;
use aws_sdk_s3::Client;

use tokio::io::AsyncReadExt;

/// add two integer
#[node_bindgen]
pub fn sum(first: i32, second: i32) -> i32 {
    first + second
}
struct WharfieS3Error(aws_sdk_s3::Error);

impl fmt::Display for WharfieS3Error {
    fn fmt(&self, f: &mut fmt::Formatter) -> fmt::Result {
        f.write_str("error")
    }
}

impl TryIntoJs for WharfieS3Error {
    fn try_to_js(self, env: &JsEnv) -> Result<napi_value, NjError> {
        let error = env.create_error(&self.to_string())?;
        env.add_error_info(error, &self.to_string())?;
        Ok(error)
    }
}
// Implement the conversion from `ParseIntError` to `DoubleError`.
// This will be automatically called by `?` if a `ParseIntError`
// needs to be converted into a `DoubleError`.
impl From<aws_sdk_s3::Error> for WharfieS3Error {
    fn from(err: aws_sdk_s3::Error) -> WharfieS3Error {
        WharfieS3Error(err)
    }
}

#[node_bindgen]
pub async fn get_object() -> Result<String, WharfieS3Error> {
    let config: aws_config::SdkConfig = aws_config::load_from_env().await;
    let client: Client = aws_sdk_s3::Client::new(&config);

    let resp = client
        .get_object()
        .bucket("your-bucket-name")
        .key("your-object-key")
        .send()
        .await?;

    let mut body = resp.body.into_async_read();
    let mut buffer: Vec<_> = Vec::new();
    body.read_to_end(&mut buffer).await.unwrap();
    let content: String =
        String::from_utf8(buffer).expect("Object body is not a valid utf-8 string");

    Ok(content)
}

#[tracing::instrument(skip(s3_client, event), fields(req_id = %event.context.request_id))]
async fn put_object(
    // s3_client: &aws_sdk_s3::Client,
    bucket_name: &str,
    event: LambdaEvent<Request>,
) -> Result<Response, Error> {
    let config = aws_config::load_from_env().await;
    let s3_client = aws_sdk_s3::Client::new(&config);
    tracing::info!("handling a request");
    // Generate a filename based on when the request was received.
    let timestamp = SystemTime::now()
        .duration_since(SystemTime::UNIX_EPOCH)
        .map(|n| n.as_secs())
        .expect("SystemTime before UNIX EPOCH, clock might have gone backwards");

    let filename = format!("{timestamp}.txt");
    let response = s3_client
        .put_object()
        .bucket(bucket_name)
        .body(event.payload.body.as_bytes().to_owned().into())
        .key(&filename)
        .content_type("text/plain")
        .send()
        .await;

    match response {
        Ok(_) => {
            tracing::info!(
                filename = %filename,
                "data successfully stored in S3",
            );
            // Return `Response` (it will be serialized to JSON automatically by the runtime)
            Ok(Response {
                req_id: event.context.request_id,
                body: format!(
                    "the Lambda function has successfully stored your data in S3 with name '{filename}'"
                ),
            })
        }
        Err(err) => {
            // In case of failure, log a detailed error to CloudWatch.
            tracing::error!(
                err = %err,
                filename = %filename,
                "failed to upload data to S3"
            );
            Err(Box::new(Response {
                req_id: event.context.request_id,
                body: "The Lambda function encountered an error and your data was not saved"
                    .to_owned(),
            }))
        }
    }
}
