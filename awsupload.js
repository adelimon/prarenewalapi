// You can either "yarn add aws-sdk" or "npm i aws-sdk"
const AWS = require('aws-sdk');
const fs = require('fs');
const uploadToS3 = async function (year, name, base64Data, type) {
    console.log('Starting s3 upload for ' + name+type);
    // Configure AWS with your access and secret key. I stored mine as an ENV on the server
    // ie: process.env.ACCESS_KEY_ID = "abcdefg"
    // when doing this locally, set this.  But you don't need to on Lambda, since that's in the
    // same VPC.
    let configureAws = process.env.CONFIGURE_AWS;
    if (configureAws) {
        AWS.config.update({
            accessKeyId: process.env.ACCESS_KEY_ID,
            secretAccessKey: process.env.SECRET_ACCESS_KEY
        });
    }

    console.log('updated aws config');
    // Create an s3 instance
    const s3 = new AWS.S3();
    const base64Buffer = new Buffer(base64Data, 'base64');
    console.log('created base 64 buffer');
    // With this setup, each time your user uploads an image, will be overwritten.
    // To prevent this, use a unique Key each time.
    // This won't be needed if they're uploading their avatar, hence the filename, userAvatar.js.
    const params = {
        Bucket: process.env.S3_BUCKET,
        Key: `${year}/${name}.${type}`,
        Body: base64Buffer,
        ContentEncoding: 'base64',
        ContentType: `image/${type}`,
        // I'm using Intelligent Tiering here because these are seldom, if ever, accessed.
        // The Optimal storage class would be "not stored at all" :)
        // I don't even know why the Fudge we even store them but they are cheap enough.
        StorageClass: 'INTELLIGENT_TIERING'
    }

    //console.log(JSON.stringify(params));

    // The upload() is used instead of putObject() as we'd need the location url and assign that to our user profile/database
    // see: http://docs.aws.amazon.com/AWSJavaScriptSDK/latest/AWS/S3.html#upload-property
    console.log(new Date());
    s3.upload(params, (err, data) => {
        if (err) {
            console.log("there was an error: " + err);
        }
        if (data) {
            console.log(JSON.stringify(data));
        }
        // Continue if no error
        // Save data.Location in your database
        console.log('Image successfully uploaded.');
        console.log(new Date());
    });
}

module.exports = {
  uploadToS3
}