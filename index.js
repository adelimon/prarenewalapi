require('dotenv').load();

const express = require('express');
const bodyParser = require('body-parser');
const pool = require('./database');
const tokendecoder = require('./tokendecoder');

const app = express();
const port = 3000;

const getMemberByToken = async function(token) {
    let decodedtoken = tokendecoder.getMemberInfo(token);
    let result = await pool.query(
        'select * FROM member where end_date is null and id = ? and zip = ? and year(date_joined) = ?', 
        [decodedtoken.id, decodedtoken.zip, decodedtoken.yearJoined]
    );
    // sort of a hack but this should only ever return one person.
    return result[0];
}

app.use(bodyParser.json());
app.use(
  bodyParser.urlencoded({
    extended: true,
  })
);

app.listen(port, 
    function start() {
        console.log(`App running on port ${port}.`);
    }
);

app.get('/', 
    async function get(request, response)  {
        try {
            let result = await pool.query('SELECT * FROM member where end_date is null order by last_name desc');
            response.json(result);
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

app.post('/members/renew/:token',
    async function renewMember(request, response) {
        let decodedtoken = tokendecoder.getMemberInfo(request.params.token);
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

            response.json(updateResult)
        }
    }
);


