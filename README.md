# MailSmüsh

<p align="center"><img src="images/icon.png" width="160" alt="MailSmüsh's icon: a smiling hedgehog"></p>

A Mac app that keeps my three Gmail inboxes and Google Calendars in one place, as a desktop app of its own, outside Chrome.

<p align="center">
  <img src="images/personal.gif" width="120" alt="A man dancing in pyjamas">
  <img src="images/aim.gif" width="120" alt="A cartoon rocket flying past the Earth">
  <img src="images/farmkind.gif" width="120" alt="A piglet being stroked">
</p>

Each account gets its own animated icon in the sidebar. Those are mine, for my personal, AIM and FarmKind accounts.

## What it does

- **One window for all your Google accounts:** a sidebar with an icon for each account, and a click to switch. Each account has its Gmail and its Calendar.
- **Its own app, outside your browser:** its own window and Dock icon (the hedgehog), so your email isn't one tab among dozens.
- **Unread counts** on each account's icon. You can hide them for an account you'd rather not be nudged by.
- **Each account stays signed in on its own**, so there's no switching Google accounts back and forth.
- **Email links from other apps** (the "mailto:" kind) open a compose window in the account you choose, if you make MailSmüsh your default email app.
- **Optional saved passwords:** it can keep your Google passwords in your Mac's keychain, unlocked with Touch ID, and fill them in when Google asks you to sign in again.

## Get it

Mac only. The easiest way is to let Claude Code do it: paste this into Claude Code (the Code tab of the Claude desktop app).

```
Set up MailSmüsh for me. Fetch https://raw.githubusercontent.com/Aidan-Alexander/mailsmush/main/SETUP.md exactly as written (e.g. with curl) and follow it.
```

Claude checks your Mac has what it needs, asks which Google accounts you want and which picture or gif to use for each, then builds the app and puts it in your Applications folder. It takes about 10 minutes, most of it waiting. Then you open MailSmüsh and sign in to each account once.

To change it later, ask Claude Code, for example "add a fourth account to MailSmüsh" or "use this gif for my work account in MailSmüsh". To update it, paste the line again: your accounts and pictures are kept.

## For developers

It's an Electron app.
- `npm install`, then `npm start` runs it from source.
- `bash build-local.sh` builds it and installs it in /Applications. Add `--default-mail-app` to also make it the app that opens email links.
- Your accounts live in `renderer/accounts.js`, which stays out of git. Copy `renderer/accounts.example.js` to make one: it explains each setting.

## Credits

The hedgehog and the gifs came from around the internet. Built with Claude Code.

## Licence

[MIT](LICENSE)
