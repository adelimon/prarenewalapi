const express = require('express');
const cors = require('cors');
const bodyParser = require('body-parser');
const fs = require('fs');
// eslint-disable-next-line id-length
const _ = require('lodash');
const AWS = require('aws-sdk');

const QRCodeInterface = require('./qrCodeInterface');

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
        'select * FROM member where end_date is null and id = ? and year(date_joined) = ?',
        [decodedtoken.id, decodedtoken.yearJoined]
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
app.use(bodyParser.json({limit: "50mb", extended: true, parameterLimit:50000}));
app.use(bodyParser.urlencoded({limit: "50mb", extended: true, parameterLimit:50000}));
app.use(bodyParser.raw({limit: "50mb", extended: true, parameterLimit:50000}));

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

app.post('/members/apply',
    async function newMemberApply(request, response) {
        // step one: create the new guy in the database.
        let applicant = request.body;
        let year = (new Date()).getFullYear();
        let insertApplicant = {
            first_name: _.startCase(applicant.firstName),
            last_name: _.startCase(applicant.lastName),
            address: _.startCase(applicant.address),
            city: _.startCase(applicant.city),
            state: applicant.state,
            zip: applicant.zip,
            occupation: _.startCase(applicant.occupation),
            phone: applicant.phone,
            view_online: true,
            email: applicant.email.toLowerCase(),
            birthday: applicant.birthday,
            date_joined: new Date(),
            status: 21,
            prefers_mail: false,
            last_modified_by: 'renewalsApi',
            last_modified_date: new Date(),
            text_ok: true,
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
              'follow up with you on any next steps.  We will be reviewing all applications in late February of 2022.\n' +
              'See you soon!\n -PRA'
        };
        let mailgunResponse = await mailcannon.fireAws(applicantConfirmation);

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
            let boardEmail = await mailcannon.fireAws(boardMemberNotification);
        }
        response.json(createdResult[0]);
    }

);

app.post('/members/renew',
    async function captureBikes(request, response) {
        let memberInfo = request.body;
        let member = await lookupMemberByToken(memberInfo.token);
        let addressChanged = (memberInfo.address !== member.address);
        let zipChanged = (memberInfo.zip !== member.zip);
        let cityChanged = (memberInfo.city !== member.city);
        console.log('starting member data update for ' + memberInfo.token + ' ' + memberInfo.id);
        if (addressChanged || zipChanged || cityChanged) {
            // todo if the address has changed, update the address in our records using a query.
            console.log('Updating address for ' + memberInfo.token);
            let updateResult = await pool.query(
                'update member set address = ?, city = ?, zip = ?, last_modified_date = CURRENT_TIMESTAMP(), last_modified_by = ? where id = ?',
                [memberInfo.address, memberInfo.city, memberInfo.zip, 'renewalsAPI', member.id]
            );
            console.log(JSON.stringify(updateResult));
        }
        if (memberInfo.phone !== member.phone) {
            console.log('Updating phone number for ' + memberInfo.token);
            let updateResult = await pool.query(
                'update member set phone = ?, last_modified_date = CURRENT_TIMESTAMP(), last_modified_by = ? where id = ?',
                [memberInfo.phone, 'renewalsAPI', member.id]
            );
            console.log(JSON.stringify(updateResult));
        }
        console.log('removing old family and bike data for this member');
        // clean up the data
        await pool.query(
            'delete from member_family where member_id = ?', [member.id]
        );

        await pool.query(
            'delete from member_bikes where member_id = ?', [member.id]
        );
        let familyStr = '';
        let bikesStr = '';

        // now get family members into the database
        if (memberInfo.familyMembers) {
            for (let familyMember of memberInfo.familyMembers) {
                let firstName = familyMember.firstName;
                let lastName = familyMember.lastName;
                if (firstName && lastName) {
                    // fix bad input
                    firstName = firstName.replace(/,/, "");
                    lastName = lastName.replace(/,/, "");
                    firstName = _.startCase(firstName);
                    lastName = _.startCase(lastName);

                    // shove family member in the database
                    let insertFamily = await pool.query(
                        'insert into member_family (first_name, last_name, age, member_id) values (?, ?, ?, ?)',
                        [firstName, lastName, familyMember.age, member.id]
                    );
                    console.log('adding family member');
                    console.log(JSON.stringify(insertFamily));
                    familyStr += firstName + ' ' + lastName + '\n';
                }
            }
        }
        if (memberInfo.bikes) {
            for (let bike of memberInfo.bikes) {
                let bikeYear = bike.year;
                let bikeMake = bike.make;
                let bikeModel = bike.model;
                if (bikeMake.toLowerCase() === "ktm") {
                    bikeMake = _.upperCase(bikeMake);
                } else {
                    bikeMake = _.startCase(bikeMake);
                }
                // shove member bike in the database
                let insertBike = await pool.query(
                    'insert into member_bikes (year, make, model, member_id) values (?, ?, ?, ?)',
                    [bikeYear, bikeMake, bikeModel, member.id]
                );
                console.log('adding bike');
                console.log(JSON.stringify(insertBike));
                bikesStr += bikeYear + ' ' + bikeMake + ' ' + bikeModel + '\n';
            }
        }
        if (!memberInfo.familyMembers) {
            memberInfo.familyMembers = '';
        }

        let decodedtoken = tokendecoder.getMemberInfo(memberInfo.token);
        let updateResult = await pool.query(
            'update member set current_year_renewed = 1, text_ok = 1, last_modified_date = CURRENT_TIMESTAMP(), last_modified_by = ? where id = ?',
            ['renewalsAPI', decodedtoken.id]
        );
	    // now that the database is updated, save the insurance card file (to an s3 bucket)
	    let insuranceCapture = request.body.insuranceCapture;
	    let fileInfo = insuranceCapture.split(';base64,');
	    let fileTypeInfo = fileInfo[0].split(';');
	    let imgFileType = fileTypeInfo[0].replace('data:image\/', '');
	    let fileData = fileInfo[1];

        // some date logic to make sure we don't have to edit this next year....
        let now = new Date();
        let fullYear = now.getFullYear();
        // if we are doing this in October or later, then it's for next year.  So, let's add a year to the full year so we can
        // save the insurance card copy with a handy dandy file name containing the year.
        if (now.getMonth() > 9) {
            fullYear += 1;
        }
	    console.log('Starting upload for ' + memberInfo.token);
	    try {
		    await awsupload.uploadToS3(fullYear, fullYear+member.last_name+member.first_name, fileData, imgFileType);
	    } catch (err) {
		    console.log('error uploading ' + JSON.stringify(err));
        }

        let emailNotification = {
            from: 'hogbacksecretary@gmail.com',
            to: emailWithName(member),
            cc: 'hogbacksecretary@gmail.com',
            subject: 'PRA Renewal Confirmation for ' + fullYear + ' Season',
            text:
                'Hi, ' + member.first_name + '!\n' +
                'This email is your confirmation that you have acknowledged the rules for PRA for the coming season.  We will send you a bike sticker and gate code ' +
                'later in the winter.\n' +
                'Please pass along your payment in the method indicated in the instructions in our prior email.  See you soon!\n -PRA' +
                '----------------------------------------------\n' +
                'You entered the following ' + memberInfo.bikes.length + ' bike(s):\n' +
                bikesStr + '\n' +
                'And the following family members:\n' +
                familyStr + '\n' +
                'Your ' + memberInfo.bikes.length + ' sticker(s) will go to the following address that you confirmed:\n\n' +
                memberInfo.address + '\n' + memberInfo.city + ', ' + memberInfo.state + ' '  + memberInfo.zip + '\n\n' +
                memberInfo.phone
          };
          try {
            let mailReponse = await mailcannon.fireAws(emailNotification);
            console.log('mail sent for ' + memberInfo.token + ' we are all done, wrapping it up');
            response.json(mailReponse);
          } catch (error) {
            console.error(error);
            response.status(500);
          }
    }
);

app.get('/member/text/allowed', 
    async function(request, response) {
        try {
            let result = await pool.query('select * from text_allow_list');
            response.json(result);
        } catch (err) {
            throw new Error(err);
        }
    }
);

app.get('/member/qr/:token', 
    async (request, response) => {
        try {
            const token = request.params.token;
            // make sure this exists, so we aren't QR coding just anything!
            const member = await tokendecoder.getMemberInfo(token);
            if (!member) {
                throw new Error(`${token} is not a valid value and no record is associated with it, sorry.`);
            }
            console.log('member found, generating a QR...');
            const generator = new QRCodeInterface();
            const qrData = await generator.getQrDataUrl(token);
            const imgData = qrData.replace('data:image/png;base64,', '');;            
            const qrImg = Buffer.from(imgData, 'base64');

            response.writeHead(200, {
                'Content-Type': 'image/png',
                'Content-Length': qrImg.length
            });            
            response.end(qrImg); 
        } catch (err) {
            console.error(err);
            response.status(500);
        }
    }
)

app.get('/member/resend/:token',
    async (request, response) => {
        try {
            const token = request.params.token;
            console.log(`Resending for ${token}`);
            const sns = new AWS.SNS();
            const snsResponse = await sns.publish({
                Message: token,
                TopicArn: process.env.BILLING_SNS_ARN,
            }).promise();
            console.log(snsResponse);
            response.json({
                token,
                snsResponse,
            });
        } catch (err) {
            throw new Error(err);
        }
    }
);

module.exports = app;