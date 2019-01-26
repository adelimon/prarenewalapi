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

const lookupMemberByToken = async function(memberToken) {
    let decodedtoken = tokendecoder.getMemberInfo(memberToken);
    let memberResult = await pool.query(
        'select * FROM member where end_date is null and id = ? and zip = ? and year(date_joined) = ?', 
        [decodedtoken.id, decodedtoken.zip, decodedtoken.yearJoined]
    );
    // this is a bit of a hack a roo, but this should only return one combination and if it returns more
    // something is wrong anyway.
    let result;
    if (memberResult.length === 1) {
        result = memberResult[0];
    }
    return result;
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
            let member = await lookupMemberByToken(request.params.token);
            response.json(member);
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
            // now that the database is updated, save the insurance card file (to an s3 bucket)
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
        
        // first build the base email.
        let applicantInfo = [];
        applicantInfo.push(applicant.firstName);
        applicantInfo.push(applicant.lastName);
        applicantInfo.push(applicant.city.replace(/\s/g, '+'));
        applicantInfo.push(applicant.state);
        let googleLink = 'https://www.google.com/search?q=' + applicantInfo.join('+');
        let boardHtml = fs.readFileSync('./emails/boardApplicationNotify.html').toString('utf-8');      
        boardHtml = boardHtml.replace('GOOGLE_LINK', googleLink);  
        boardHtml = boardHtml.replace('APPLICANT_INFO', JSON.stringify(applicant, null, '\t'));
        
        let boardMembers = await pool.query(
            'select m.id, m.zip, m.first_name, m.last_name, m.email, year(m.date_joined) year_joined from member m where m.id in (select member_id from board_member where year = ' + year + ')'
        );
        for (let index = 0; index < boardMembers.length; index++) {      
            let boardMember = boardMembers[index];
            let boardMemberToken = tokendecoder.buildMemberToken(boardMember.id, boardMember.zip, boardMember.year_joined);
            let approvalLink = process.env.APPROVAL_LINK + year + '/' + result.insertId + '/' + boardMemberToken;
            let boardMemberHtml = boardHtml.replace('APPROVAL_LINK', approvalLink);     
            let boardMemberNotification = {
                from: 'hogbacksecretary@gmail.com',
                to: emailWithName(boardMembers[index]),
                subject: 'New member application - ' + insertApplicant.first_name + ' ' + insertApplicant.last_name,
                html: boardMemberHtml,
            };
            let boardEmail = await mailcannon.fire(boardMemberNotification);
        }
        response.json(createdResult[0]); 
    }

);

app.get('/applicant/approve/:year/:memberId/:boardMemberToken', 
    async function boardMemberApproval(request, response) {        
        // make sure that this is an actual board member
        let applicantId = request.params.memberId;
        let applicationYear = request.params.year;
        let result = {
            status: 'Failed',
            approver: '',
            detail: '',
        };
        let boardMemberInfo = await lookupMemberByToken(request.params.boardMemberToken);
        let boardMemberResult = await pool.query(
            'select * from member where id in (select member_id from board_member where member_id = ? and year = ?)',
            [boardMemberInfo.id, applicationYear]
        );
        let applicantResult = await pool.query('select * from member where id = ?', applicantId);
        if (boardMemberResult.length == 1) {
            // make sure the member applying exists
            result.approver = boardMemberInfo.last_name + ', ' + boardMemberInfo.first_name;            
            if (applicantResult && (applicantResult.length == 1)) {
                // both board member and applicant are valid, so record the response in the table
                let approvalRecorded = await pool.query('select * from application where member_id = ? and approver = ?', [applicantId, boardMemberResult[0].id]);
                // if there is an approval already recorded, then ignore this. but otherwise, record it.
                if (approvalRecorded.length === 0) {
                    let approvalInsert = {
                        member_id: applicantId,
                        approver: boardMemberResult[0].id,
                        last_modified_date: new Date(),
                    };
                    let something = await pool.query('insert into application set ?', approvalInsert);
                    result.status = 'Success';
                    result.detail = 'Approval for ' + applicantResult[0].last_name + ' recorded at ' + approvalInsert.last_modified_date;                                        
                } else {
                    result.status = 'Failed';
                    result.detail = 'Approval for ' + applicantResult[0].last_name + ' already recorded for you at ' + approvalRecorded[0].last_modified_date;                                        
                }                
            }
        }        
        // that the approval is recorded, check to see if we have hit the threshold, and if so, throw an email to the
        // secretary telling him to get his shit done.
        let approvalResult = await pool.query('select count(*) approvals from application where member_id = ?', applicantId);
        let approvals = approvalResult[0].approvals;
        // greater than 4 (5 or more) approvals is a majority so let the secretary know he's got work to do.
        if (approvals > 4) {
            // flip the member from 'applicant' to 'new member' now that all approvals are done. This saves the secretary
            // a step so that they don't have to do it manually.
            await pool.query('update member set status = 14 where id = ?', applicantId);
            let secretaryNotification = {
                from: 'no-reply@palmyramx.com', 
                to: 'hogbacksecretary@gmail.com',
                subject: 'PRA Application for ' + applicantResult[0].last_name + ',' + applicantResult[0].first_name + ' requires action',
                text:
                    'Application for ' + applicantResult[0].last_name + ', ' + applicantResult[0].first_name +  ' has the required approvals.  Please ' +
                    'log in to https://apps.palmyramx.com/#/member/' + applicantId + ' to generate a bill and complete the process.'
            };
            let mailResult = await mailcannon.fire(secretaryNotification);
            result.detail += 'all approvals recieved, sent for further processing';
        }
        console.log(JSON.stringify(result));
        response.json(result);
    }
);
module.exports = app;
