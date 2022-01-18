const AWS = require('aws-sdk');

/**
 * Load an email into the email cannon, and fire away!
 * 
 * This method name is a poor play on "mailgun" which I used to use to perform this service.  It's not there 
 * any more but the name sticks for amusement.
 * 
 * @param {object} ammo an object with the following fields:
 * { from, to, cc, subject, text}
 * @returns result of the send.
 */
const fireAws = async function(ammo) {
    const sendParams = {
        Destination: {
            ToAddresses: [ammo.to],
            CcAddresses: [ammo.cc],
        },
        Message: {
            Subject: { Data: ammo.subject },
            Body: {
                Text: {
                    Charset: 'UTF-8',
                    Data: ammo.text,
                },
            },
        },
        ReplyToAddresses: [ammo.from],
        Source: 'admin@palmyramx.com',        
    };
    try {
        let ses = new AWS.SES();
        let key = await ses.sendEmail(sendParams).promise();
        console.log('Email sent ' + key.MessageId);
    } catch (error) {
        console.error('Failed to send email to ' + ammo.to + ' due to ', error);
        throw error;
    }
}

module.exports = {
    fireAws,
}