const fire = async function(ammo) {
    let mailgun = require('mailgun-js')({apiKey: process.env.MAILER_API_KEY, domain: process.env.MAILER_DOMAIN});
    
    console.log(JSON.stringify(ammo));
    console.log(process.env.MAILER_DOMAIN);

    let body = await mailgun.messages().send(ammo);
    console.log(JSON.stringify(body));
    return body;
}
module.exports = {
    fire,
}