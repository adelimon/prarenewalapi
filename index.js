const express = require('express');
const cors = require('cors');
const bodyParser = require('body-parser');
const fs = require('fs');
const mailcannon = require('./mailcannon');

const pool = require('./database');
const tokendecoder = require('./tokendecoder');
const awsupload = require('./awsupload');

const app = express();

const emailWithName = function(rowData) {
    return rowData.first_name + ' ' + rowData.last_name + '<' + rowData.email + '>';
}

app.use(cors());
app.use(bodyParser.json({limit: "50mb"}));
app.use(bodyParser.urlencoded({limit: "50mb", extended: true, parameterLimit:50000}));

app.get('/health', 
    async function get(request, response)  {
        try {
            let result = await pool.query(
                'SELECT count(*), mt.type FROM member m, member_types mt where m.end_date is null and m.status !=9 and m.status = mt.id group by mt.type order by count(*) desc'
            );
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
            let decodedtoken = tokendecoder.getMemberInfo(request.params.token);
            let result = await pool.query(
                'select * FROM member where end_date is null and id = ? and zip = ? and year(date_joined) = ?', 
                [decodedtoken.id, decodedtoken.zip, decodedtoken.yearJoined]
            );
            response.json(result[0]);
        } catch(err) {
            throw new Error(err);
        }
    }
);

app.post('/members/renew/',
    async function renewMember(request, response) {
        let token = request.body.token;
        console.log('Starting renewal for ' + token);
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
            console.log('found member ' + member.last_name + ' with token ' + token);
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
            let fileData = fileInfo[1];

            let fullYear = (new Date()).getFullYear();
            console.log('Starting upload for ' + token);
            try {
                await awsupload.uploadToS3(fullYear+member.last_name+token, fileData, imgFileType);
            } catch (err) {
                console.log('error uploading ' + JSON.stringify(err));                
            }
            
            console.log('Upload complete for ' + token);
            // send a confirmation email as part of the renewal

            let data = {
              from: 'hogbacksecretary@gmail.com',
              to: emailWithName(member),
              cc: 'hogbacksecretary@gmail.com',
              subject: fullYear + ' PRA rules acknowledgement confirmation',
              text: 
                'Hi, ' + member.first_name + '!\nThis email is your confirmation that you have acknowledged the rules for PRA for ' +
                'the coming season.  We will send you a gate code later this winter.  Please pass along your payment in the method ' +
                'indicated in the instructions in our prior email.  See you soon!\n -PRA'
            };
            let mailReponse = await mailcannon.fire(data);

            response.json(updateResult);
        }
    }
);

app.post('/members/apply',
    async function newMemberApply(request, response) {
        // step one: create the new guy in the database.
        let applicant = request.body;
        let year = (new Date()).getFullYear();
        let insertApplicant = {
            first_name: applicant.firstName,
            last_name: applicant.lastName,
            address: applicant.address,
            city: applicant.city,
            state: applicant.state,
            zip: applicant.zip,
            occupation: applicant.occupation,
            phone: applicant.phone,
            view_online: true,
            email: applicant.email,
            birthday: applicant.birthday,
            date_joined: new Date(),
            status: 21,
            prefers_mail: false,
            last_modified_by: 'renewalsApi',
            last_modified_date: new Date(),
        };
        let result = await pool.query('insert into member set ?', insertApplicant);
        console.log("inserted member id " + result.insertId + ": " + applicant.firstName + " " + applicant.lastName);
        let createdResult = await pool.query('select * from member where id = ?', result.insertId);

        // step two: send an email to the guy letting him know we have his application
        let applicantConfirmation = {
            from: 'hogbacksecretary@gmail.com',
            to: emailWithName(insertApplicant),
            cc: 'hogbacksecretary@gmail.com',
            subject: year + ' PRA application confirmation',
            text: 
              'Hi, ' + insertApplicant.first_name + '!\nThis email is your confirmation that your application to PRA has been received by the club.  We will\n' +
              'follow up with you on any next steps, and usually we can do this soon (within 7-10 business days, sometimes more quickly).\n' +
              'See you soon!\n -PRA'
        };
        let mailgunResponse = await mailcannon.fire(applicantConfirmation);

        // step three: send an email to the board with the guy's information so that they can accept or deny the guy
        // get all the board members for the current year
        
        let boardMembers = await pool.query(
            'select m.first_name, m.last_name, m.email from member m where m.id in (select member_id from board_member where year = ' + year + ')'
        );
        let boardMemberEmails = new Array();
        for (let index = 0; index < boardMembers.length; index++) {
            boardMemberEmails.push(emailWithName(boardMembers[index]));
        }
        let applicantInfo = [];
        applicantInfo.push(applicant.firstName);
        applicantInfo.push(applicant.lastName);
        applicantInfo.push(applicant.city.replace(/\s/g, '+'));
        applicantInfo.push(applicant.state);
        let googleLink = 'https://www.google.com/search?q=' + applicantInfo.join('+');
        let boardHtml = fs.readFileSync('./emails/boardApplicationNotify.html').toString('utf-8');      
        boardHtml = boardHtml.replace('GOOGLE_LINK', googleLink);  
        boardHtml = boardHtml.replace('APPLICANT_INFO', JSON.stringify(applicant, null, '\t'));
        let boardMemberNotification = {
            from: 'hogbacksecretary@gmail.com',
            to: boardMemberEmails.join(),
            subject: 'New member application - ' + insertApplicant.first_name + ' ' + insertApplicant.last_name,
            html: boardHtml,
        };
        mailcannon.fire(boardMemberNotification);
        response.json(createdResult[0]); 
    }
);

module.exports = app;
