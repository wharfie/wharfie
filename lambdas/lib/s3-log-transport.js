const Transport = require('winston-transport');
const S3 = require('./s3');
const fs = require('fs');
const os = require('os');

const FUNCTION_NAME = process.env.AWS_LAMBDA_FUNCTION_NAME;

module.exports = class S3Transport extends Transport {
  /**
   * @param {import("winston-transport").TransportStreamOptions} [opts] -
   */
  constructor(opts = {}) {
    super(opts);
    this.s3 = new S3();

    const currentDateTime = new Date();
    const year = currentDateTime.getUTCFullYear();
    const month = String(currentDateTime.getUTCMonth() + 1).padStart(2, '0'); // Months are 0-indexed
    const day = String(currentDateTime.getUTCDate()).padStart(2, '0');
    const currentHourUTC = currentDateTime.getUTCHours();

    const formattedDate = `${year}-${month}-${day}`;

    console.log(`Current date in UTC: ${formattedDate}`);
    console.log(`Current hour in UTC: ${currentHourUTC}`);
    this.temp_file_stream = fs.createWriteStream(
      `${os.tmpdir()}/${FUNCTION_NAME}.log`
    );
  }

  /**
   * @param {any} info -
   * @param {any} callback -
   */
  async log(info, callback) {
    setImmediate(() => {
      this.emit('logged', info);
    });
    this.temp_file_stream.write(info);
    // Perform the writing to the remote service
    callback();
  }

  close() {
    this.temp_file_stream.end();
  }
};
