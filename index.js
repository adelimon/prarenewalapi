require('dotenv').load();

const express = require('express');
const cors = require('cors');
const bodyParser = require('body-parser');
const fs = require('fs');
const mailgun = require("mailgun-js");

const pool = require('./database');
const tokendecoder = require('./tokendecoder');
const awsupload = require('./awsupload');

const app = express();

const getMemberByToken = async function(token) {
    let decodedtoken = tokendecoder.getMemberInfo(token);
    let result = await pool.query(
        'select * FROM member where end_date is null and id = ? and zip = ? and year(date_joined) = ?', 
        [decodedtoken.id, decodedtoken.zip, decodedtoken.yearJoined]
    );
    // sort of a hack but this should only ever return one person.
    return result[0];
}
app.use(cors());
app.use(bodyParser.json({limit: "50mb"}));
app.use(bodyParser.urlencoded({limit: "50mb", extended: true, parameterLimit:50000}));

app.get('/health', 
    async function get(request, response)  {
        try {
            let result = await pool.query('SELECT count(*) FROM member where end_date is null and status !=9');
            if (result) {
                response.json(result);
            } 
        } catch(err) {
            throw new Error(err);
        }
    }
);
app.get('/members/:token', 
    async function getMember(request, response)  {
        try {
            let result = await getMemberByToken(request.params.token);
            response.json(result);
        } catch(err) {
            throw new Error(err);
        }
    }
);

app.post('/members/renew/',
    async function renewMember(request, response) {
        let token = request.body.token;
        let decodedtoken = tokendecoder.getMemberInfo(token);
        let result = await pool.query(
            'select * FROM member where end_date is null and id = ? and zip = ? and year(date_joined) = ?', 
            [decodedtoken.id, decodedtoken.zip, decodedtoken.yearJoined]
        );
        // only move foward with this if there is actually a member with this ID. This is probably a wee bit of 
        // overkill but going to do it anyway for safety.
        let exists = (result.length >= 1);
        if (exists) {
            let member = result[0];
            // he exists, so update this mofo
            let updateResult = await pool.query(
                'update member set current_year_renewed = 1, last_modified_date = CURRENT_TIMESTAMP(), last_modified_by = ? where id = ?', 
                ['renewalsAPI', decodedtoken.id]
            );
            // now that the database is updated, save the insurance card file (to disk for now, although an s3 bucket is a good place)
            let insuranceCapture = request.body.insCopy;
            let fileInfo = insuranceCapture.split(';base64,');
            let fileTypeInfo = fileInfo[0].split(';');
            let imgFileType = fileTypeInfo[0].replace('data:image\/', '');
            let imgFileName = fileTypeInfo[1].replace('name=', '');
            let fileData = fileInfo[1];

            let fullYear = (new Date()).getFullYear();

            await awsupload.uploadToS3(fullYear+member.last_name+token, fileData, imgFileType);
            // send a confirmation email as part of the renewal

            let mailgun = require('mailgun-js')({apiKey: process.env.MAILER_API_KEY, domain: process.env.MAILER_DOMAIN});
            
            let data = {
              from: 'hogbacksecretary@gmail.com',
              to: member.first_name + ' ' + member.last_name + '<' + member.email + '>',
              cc: 'hogbacksecretary@gmail.com',
              subject: fullYear + ' PRA rules acknowledgement confirmation',
              text: 
                'Hi, ' + member.first_name + '!\nThis email is your confirmation that you have acknowledged the rules for PRA for ' +
                'the coming season.  We will send you a gate code later this winter.  Please pass along your payment in the method ' +
                'indicated in the instructions in our prior email.  See you soon!\n -PRA'
            };
            
            mailgun.messages().send(data, function (error, body) {
              console.log(body);
            });

            response.json(updateResult);
        }
    }
);

module.exports = app;