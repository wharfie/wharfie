// const { S3Client, GetObjectCommand } = require('@aws-sdk/client-s3');
// /**
//  *
//  * @param obj
//  */
// function memorySizeOf(obj) {
//     let bytes = 0;

//     /**
//      *
//      * @param obj
//      */
//     function sizeOf(obj) {
//       if (obj !== null && obj !== undefined) {
//         switch (typeof obj) {
//           case "number":
//             bytes += 8;
//             break;
//           case "string":
//             bytes += obj.length * 2;
//             break;
//           case "boolean":
//             bytes += 4;
//             break;
//           case "object":
//             var objClass = Object.prototype.toString.call(obj).slice(8, -1);
//             if (objClass === "Object" || objClass === "Array") {
//               for (const key in obj) {
//                 if (!obj.hasOwnProperty(key)) continue;
//                 sizeOf(obj[key]);
//               }
//             } else bytes += obj.toString().length * 2;
//             break;
//         }
//       }
//       return bytes;
//     }

//     /**
//      *
//      * @param bytes
//      */
//     function formatByteSize(bytes) {
//       if (bytes < 1024) return bytes + " bytes";
//       else if (bytes < 1048576) return (bytes / 1024).toFixed(3) + " KiB";
//       else if (bytes < 1073741824) return (bytes / 1048576).toFixed(3) + " MiB";
//       else return (bytes / 1073741824).toFixed(3) + " GiB";
//     }

//     return formatByteSize(sizeOf(obj));
//   }

// /**
//  *
//  * @param bucket
//  * @param key
//  */
// async function downloadFromS3(bucket, key) {
//   const s3 = new S3Client({ region: 'us-west-2' });
//   const command = new GetObjectCommand({ Bucket: bucket, Key: key });
//   const s3Response = await s3.send(command);

//   return new Promise((resolve, reject) => {
//     const chunks = [];
//     s3Response.Body.on('data', (chunk) => chunks.push(chunk));
//     s3Response.Body.on('error', reject);
//     s3Response.Body.on('end', () => {
//       const buffer = Buffer.concat(chunks);
//       // Convert Node.js Buffer to a standard ArrayBuffer
//       const arrayBuffer = buffer.buffer.slice(
//         buffer.byteOffset,
//         buffer.byteOffset + buffer.byteLength
//       );
//       resolve(arrayBuffer);
//     });
//   });
// }

// /**
//  *
//  */
// async function main() {
//   // Adjust these parameters as needed.
//   const bucket = 'project-test-bucket-m4aqsn';
//   const key =
//     'abo/data/t426kwdgylsptv6ndms9ig2k/20250303_234604_00025_9j7cd_f99c4fdb-27f0-4025-a463-3475d7c3adb0';

//   const { parquetRead, parquetMetadata } = await import('hyparquet');
//   const { compressors } = await import('hyparquet-compressors');
//   let count = 0
//   try {
//     const file = await downloadFromS3(bucket, key);
//     console.log(parquetMetadata(file));
//     await parquetRead({
//       file,
//       compressors,
//       rowFormat: 'object',
//       onComplete: function (data) {
//         console.log(memorySizeOf(data));
//         count = data.length
//       },
//     });
//   } catch (err) {
//     console.error('Error:', err);
//   }
//   console.log(count)
// }

// main().catch((err) => {
//   console.error('Fatal error:', err);
// });
