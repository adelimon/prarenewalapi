const fire = async function(ammo) {
    let mailgun = require('mailgun-js')({apiKey: process.env.MAILER_API_KEY, domain: process.env.MAILER_DOMAIN});
    
    console.log(JSON.stringify(ammo));
    console.log(process.env.MAILER_DOMAIN);

    let body = await mailgun.messages().send(ammo);
    try {
        console.log(JSON.stringify(body));
    } catch (err) {
        console.log("error sending email via mailgun api, see the next line for details");
        console.log(JSON.stringify(err));
    }
    return body;
}
module.exports = {
    fire,
}