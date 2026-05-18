const assert = require('assert');
const net = require('net');
const path = require('path');
const fs = require('fs');

const { sendEmailWithAttachment } = require('../src/services/smtpService');
const { getSenderCatalog, resolveSender } = require('../src/services/messageSenderService');

function loadMessageDispatchServiceWithMocks() {
  const dbPath = path.resolve(__dirname, '../src/config/db.js');
  const waPath = path.resolve(__dirname, '../src/services/doubleTickWhatsAppService.js');
  require.cache[dbPath] = { exports: {} };
  require.cache[waPath] = {
    exports: {
      sendWhatsAppDocumentBuffer: async () => ({ messageId: 'wa-doc-1' }),
      sendWhatsAppText: async () => ({ messageId: 'wa-msg-1' })
    }
  };
  return require('../src/services/messageDispatchService');
}

async function startFakeSmtpServer(port) {
  const messages = [];
  const server = net.createServer((socket) => {
    let dataMode = false;
    let messageBuffer = '';
    let loginStage = 0;

    socket.setEncoding('utf8');
    socket.write('220 fake-smtp.local ESMTP\r\n');

    socket.on('data', (chunk) => {
      if (dataMode) {
        messageBuffer += chunk;
        if (messageBuffer.includes('\r\n.\r\n')) {
          messages.push(messageBuffer.replace(/\r\n\.\r\n$/, ''));
          messageBuffer = '';
          dataMode = false;
          socket.write('250 Queued\r\n');
        }
        return;
      }

      const lines = chunk.split(/\r\n/).filter(Boolean);
      for (const line of lines) {
        const upper = line.toUpperCase();
        if (upper.startsWith('EHLO') || upper.startsWith('HELO')) {
          socket.write('250-fake-smtp.local\r\n250-AUTH LOGIN PLAIN\r\n250 OK\r\n');
        } else if (upper === 'AUTH LOGIN') {
          loginStage = 1;
          socket.write('334 VXNlcm5hbWU6\r\n');
        } else if (loginStage === 1) {
          loginStage = 2;
          socket.write('334 UGFzc3dvcmQ6\r\n');
        } else if (loginStage === 2) {
          loginStage = 0;
          socket.write('235 Auth OK\r\n');
        } else if (upper.startsWith('AUTH PLAIN')) {
          socket.write('235 Auth OK\r\n');
        } else if (upper.startsWith('MAIL FROM:')) {
          socket.write('250 Sender OK\r\n');
        } else if (upper.startsWith('RCPT TO:')) {
          socket.write('250 Recipient OK\r\n');
        } else if (upper === 'DATA') {
          dataMode = true;
          socket.write('354 End data with <CR><LF>.<CR><LF>\r\n');
        } else if (upper === 'QUIT') {
          socket.write('221 Bye\r\n');
          socket.end();
        } else {
          socket.write('250 OK\r\n');
        }
      }
    });
  });

  await new Promise((resolve) => server.listen(port, '127.0.0.1', resolve));
  return { server, messages };
}

(async () => {
  const jwtSource = fs.readFileSync(path.resolve(__dirname, '../src/utils/jwt.js'), 'utf8');
  assert(jwtSource.includes('{ expiresIn }'), 'jwt util should sign direct-login tokens with expiresIn');

  const { renderTemplateString } = loadMessageDispatchServiceWithMocks();
  assert.strictEqual(renderTemplateString('Hello {{ client_name }}', { client_name: 'Acme' }), 'Hello Acme');

  const port1 = 2526;
  const port2 = 2527;
  const smtp1 = await startFakeSmtpServer(port1);
  const smtp2 = await startFakeSmtpServer(port2);

  process.env.SMTP_HOST = '127.0.0.1';
  process.env.SMTP_PORT = String(port1);
  process.env.SMTP_SECURE = '0';
  process.env.SMTP_STARTTLS = '0';
  process.env.SMTP_USER = 'demo-user';
  process.env.SMTP_PASS = 'demo-pass';
  process.env.SMTP_FROM_EMAIL = 'default@example.com';
  process.env.SMTP_FROM_NAME = 'Default Sender';

  process.env.EMAIL_SENDER_1_KEY = 'sales';
  process.env.EMAIL_SENDER_1_LABEL = 'Sales Team';
  process.env.EMAIL_SENDER_1_FROM_EMAIL = 'sales@example.com';
  process.env.EMAIL_SENDER_1_FROM_NAME = 'Sales Team';
  process.env.EMAIL_SENDER_1_SMTP_HOST = '127.0.0.1';
  process.env.EMAIL_SENDER_1_SMTP_PORT = String(port1);
  process.env.EMAIL_SENDER_1_SMTP_SECURE = '0';
  process.env.EMAIL_SENDER_1_SMTP_STARTTLS = '0';
  process.env.EMAIL_SENDER_1_SMTP_USER = 'sales-user';
  process.env.EMAIL_SENDER_1_SMTP_PASS = 'sales-pass';

  process.env.EMAIL_SENDER_2_KEY = 'support';
  process.env.EMAIL_SENDER_2_LABEL = 'Support Team';
  process.env.EMAIL_SENDER_2_FROM_EMAIL = 'support@example.com';
  process.env.EMAIL_SENDER_2_FROM_NAME = 'Support Team';
  process.env.EMAIL_SENDER_2_SMTP_HOST = '127.0.0.1';
  process.env.EMAIL_SENDER_2_SMTP_PORT = String(port2);
  process.env.EMAIL_SENDER_2_SMTP_SECURE = '0';
  process.env.EMAIL_SENDER_2_SMTP_STARTTLS = '0';
  process.env.EMAIL_SENDER_2_SMTP_USER = 'support-user';
  process.env.EMAIL_SENDER_2_SMTP_PASS = 'support-pass';

  const catalog = getSenderCatalog();
  assert.strictEqual(catalog.email.length, 2, 'should expose two email senders');
  assert.strictEqual(resolveSender('EMAIL', 'sales').from_email, 'sales@example.com');
  assert.strictEqual(resolveSender('EMAIL', 'support').from_email, 'support@example.com');

  await sendEmailWithAttachment({
    toEmail: 'client@example.com',
    subject: 'Smoke Subject Sales',
    html: '<p>Hello from sales</p>',
    senderKey: 'sales'
  });

  await sendEmailWithAttachment({
    toEmail: 'client@example.com',
    subject: 'Smoke Subject Support',
    html: '<p>Hello from support</p>',
    senderKey: 'support'
  });

  await new Promise((resolve) => setTimeout(resolve, 150));
  assert.strictEqual(smtp1.messages.length, 1, 'sales sender should hit smtp server 1');
  assert.strictEqual(smtp2.messages.length, 1, 'support sender should hit smtp server 2');
  assert(smtp1.messages[0].includes('From: "Sales Team" <sales@example.com>'), 'sales payload should include selected sender');
  assert(smtp2.messages[0].includes('From: "Support Team" <support@example.com>'), 'support payload should include selected sender');

  await new Promise((resolve) => smtp1.server.close(resolve));
  await new Promise((resolve) => smtp2.server.close(resolve));
  console.log('smoke-test: ok');
})().catch((err) => {
  console.error('smoke-test: failed');
  console.error(err);
  process.exit(1);
});
