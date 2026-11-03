#!/usr/bin/env node
const keytar = require('keytar');
const readline = require('readline');

const SERVICE_NAME = 'com.mailsmush.app';

// Your accounts, from renderer/accounts.js (or the example, if you haven't made one)
let accounts;
try {
  accounts = require('./renderer/accounts.js');
} catch (e) {
  accounts = require('./renderer/accounts.example.js');
}

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout
});

function question(prompt) {
  return new Promise((resolve) => {
    rl.question(prompt, resolve);
  });
}

async function main() {
  console.log('\n=== MailSmüsh Password Setup ===\n');
  console.log('This will save your passwords securely to macOS Keychain.');
  console.log('They will be protected by Touch ID when accessed by the app.\n');

  for (const account of accounts) {
    const existing = await keytar.getPassword(SERVICE_NAME, account.id);
    const status = existing ? ' (password already saved)' : '';

    console.log(`\n${account.name}${account.email ? ' - ' + account.email : ''}${status}`);

    const password = await question(`Enter password (or press Enter to skip): `);

    if (password) {
      await keytar.setPassword(SERVICE_NAME, account.id, password);
      console.log(`  ✓ Password saved for ${account.name}`);
    } else if (existing) {
      console.log(`  - Keeping existing password`);
    } else {
      console.log(`  - Skipped`);
    }
  }

  console.log('\n✓ Done! Restart MailSmüsh to use your saved passwords.\n');
  rl.close();
}

main().catch(console.error);
