const mailcannon = require('../mailcannon');

test('mail is sent!', async() => {
    const testMsg = {
        to: 'fake@gmail.com',
        from: 'fake@gmail.com', 
        cc: 'fake@gmail.com',
        subject: 'testSubject',
        text: `This is a test email sent at ${new Date()}`,
    };
    try {
        const msgId = mailcannon.fireAws(testMsg);
        expect(msgId).toBeTruthy();
    } catch (error) {
        console.error(error);
    }
});