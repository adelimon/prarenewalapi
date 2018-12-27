require('dotenv').load();

const express = require('express');
const cors = require('cors');
const bodyParser = require('body-parser');
const fs = require('fs');
const pool = require('./database');
const tokendecoder = require('./tokendecoder');

const app = express();
const port = 8000;

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

app.listen(port, 
    function start() {
        console.log(`App running on port ${port}.`);
    }
);

app.get('/health', 
    async function get(request, response)  {
        try {
            let result = await pool.query('SELECT * FROM member where end_date is null order by last_name desc');
            if (result) {
                response.json({ status: 'OK'});
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
            // he exists, so update this mofo
            let updateResult = await pool.query(
                'update member set current_year_renewed = 1, last_modified_date = CURRENT_TIMESTAMP(), last_modified_by = ? where id = ?', 
                ['renewalsAPI', decodedtoken.id]
            );
            // now that the database is updated, save the insurnace card file (to disk for now, although an s3 bucket is a good place)
            let insuranceCapture = request.body.insCopy;
            let fileData = insuranceCapture.split(';base64,')[1];
            let savePath = process.env.FILE_PATH;
            if (!fs.existsSync(savePath)) {
                fs.mkdirSync(savePath);
                console.log('created the path ' + savePath);
            }
            let fileName = savePath + '/' + (new Date().getFullYear()) + result[0].id + result[0].last_name + '.png';
            fs.writeFile(fileName, fileData, {encoding: 'base64'}, function(err) {
                console.log(fileName + ' created');
            });
            response.json(updateResult);
        }
    }
);


