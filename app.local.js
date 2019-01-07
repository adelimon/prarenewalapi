const app = require('./index');

const port = process.env.PORT;

app.listen(port, 
    function start() {
        console.log(`App running on port ${port}.`);
    }
);