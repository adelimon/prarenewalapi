const database = require('./database');

const getMemberInfo = function(token) {
    // first, get the "encoded" member ID to make sure we have the right person
    let memberToken = token;
    // this ID is generated on the Java side via the following method:
    // SYSTEM_MEMBER_ID-MEMBER_ZIP_CODE-YEARJOINED
    let memberTokenParts = memberToken.split('-');
    let memberId = memberTokenParts[0];
    let memberZip = memberTokenParts[1];
    let memberYearJoined = memberTokenParts[2];
    let decodedToken = {
        id: memberId,
        zip: memberZip,
        yearJoined: memberYearJoined,
    }
    return decodedToken;
}

module.exports = {
    getMemberInfo,
}