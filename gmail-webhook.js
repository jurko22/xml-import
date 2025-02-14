const Imap = require('imap');
const { simpleParser } = require('mailparser');
const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

// Zabezpečenie - ignorovanie SSL/TLS problémov
process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0"; // Toto umožní pripojenie k serverom so self-signed certifikátmi

// Supabase klient
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);

// Gmail IMAP pripojenie
const imap = new Imap({
  user: process.env.GMAIL_USER, // Your Gmail email address
  password: process.env.GMAIL_APP_PASSWORD, // App Password here, NOT your regular Gmail password
  host: 'imap.gmail.com',
  port: 993,
  tls: true
});

function openInbox(cb) {
  imap.openBox('INBOX', false, cb);
}

imap.once('ready', function () {
  openInbox((err, box) => {
    if (err) throw err;
    console.log(`📩 Monitoring Gmail for new emails...`);

    imap.on('mail', () => {
      const fetch = imap.seq.fetch(`${box.messages.total}:*`, { bodies: '' });
      fetch.on('message', (msg) => {
        msg.on('body', (stream) => {
          simpleParser(stream, async (err, parsed) => {
            if (err) throw err;

            // Extrahovanie údajov z e-mailu
            const emailData = {
              subject: parsed.subject || 'Neznámy predmet',
              from: parsed.from.text || 'Neznámy odosielateľ',
              text: parsed.text || '',
              html: parsed.html || ''
            };

            console.log("📥 Prijatý email:", emailData);

            // ✅ Handler na spracovanie objednávky
            const parsedOrder = processOrderEmail(emailData);

            if (parsedOrder) {
              console.log("✅ Platná objednávka, ukladám do Supabase:", parsedOrder);
              
              const { data, error } = await supabase.from('orders').insert([parsedOrder]);
              
              if (error) {
                console.error("❌ Chyba pri ukladaní do Supabase:", error);
              } else {
                console.log("✅ Objednávka uložená do Supabase:", data);
              }
            } else {
              console.log("❌ E-mail nie je objednávka, ignorujem.");
            }
          });
        });
      });
    });
  });
});

imap.once('error', (err) => {
  console.log('❌ Chyba IMAP:', err);
});

imap.once('end', () => {
  console.log('📤 IMAP spojenie zatvorené');
});

imap.connect();

/**
 * Handler na spracovanie e-mailov z Shoptetu
 * @param {Object} emailData - Dáta z e-mailu
 * @returns {Object|null} - Spracovaná objednávka alebo null
 */
function processOrderEmail(emailData) {
  if (!emailData.subject.includes("Objednávka")) {
    return null; // ❌ Ak e-mail nie je objednávka, ignorujeme ho
  }

  // 📦 Extrahovanie údajov
  const orderIdMatch = emailData.text.match(/Kód objednávky:\s?(\d+)/);
  const productMatch = emailData.text.match(/(Sneaker Shields)/);
  const sizeMatch = emailData.text.match(/Veľkosť tenisky:\s?([\d-]+)/);
  const priceMatch = emailData.text.match(/Cena za m.1:\s?([\d,]+) €/);

  if (!orderIdMatch || !productMatch || !sizeMatch || !priceMatch) {
    return null; // ❌ Ak sa nepodarilo extrahovať údaje, ignorujeme e-mail
  }

  return {
    order_id: orderIdMatch[1].trim(),
    product_name: productMatch[1].trim(),
    size: sizeMatch[1].trim(),
    price: parseFloat(priceMatch[1].replace(',', '.').trim()),
    email_subject: emailData.subject,
    email_from: emailData.from,
    created_at: new Date().toISOString()  // Timestamp pre Supabase
  };
}

