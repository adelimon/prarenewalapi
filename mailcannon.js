const fire = async function(ammo) {
    let mailgun = require('mailgun-js')({apiKey: process.env.MAILER_API_KEY, domain: process.env.MAILER_DOMAIN});
    
    console.log(JSON.stringify(ammo));
    console.log(process.env.MAILER_DOMAIN);
    let testMode = process.env.MAIL_TEST_MODE;
    let body = {};
    if (!testMode) {
        let body = await mailgun.messages().send(ammo);
        try {
            console.log(JSON.stringify(body));
        } catch (err) {
            console.log("error sending email via mailgun api, see the next line for details");
            console.log(JSON.stringify(err));
        }
    } else {
        console.log("mail not sent, because youre in test mode, but here's what it'd look like if I did send it");
        console.log(JSON.stringify(ammo));
    }
    return body;
}
module.exports = {
    fire,
}