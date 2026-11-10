# Setting up MailSmüsh (instructions for Claude)

You're setting up MailSmüsh for the person you're working with: a Mac app that keeps their Gmail inboxes and Google Calendars in one window, outside their browser. It's from Aidan Alexander, at github.com/Aidan-Alexander/mailsmush. Assume they aren't technical: do the technical parts yourself, explain each step in a sentence of plain English, and don't show them commands unless they ask.

## 1. Check the Mac

- Run `uname -s`. If it doesn't print `Darwin`, stop and tell them kindly that MailSmüsh only runs on a Mac.
- Run `node -v`. MailSmüsh needs Node.js 18 or later to build. If it's missing or older: if Homebrew is installed (`brew -v`), offer to run `brew install node`; otherwise ask them to download the "LTS" installer for macOS from https://nodejs.org, run it, and tell you when it's done.

## 2. Get the code

The source lives in `~/MailSmush-source`. The setup line usually asks you to clone or update it before you read this file, so it may already be there and up to date.
- If that folder doesn't exist, get the code: `git clone https://github.com/Aidan-Alexander/mailsmush.git ~/MailSmush-source`. If git isn't available, download https://github.com/Aidan-Alexander/mailsmush/archive/refs/heads/main.zip and unzip it to that folder instead.
- If it exists and has `renderer/accounts.js`, this is an update. Their accounts file and any pictures they added are theirs: keep them. Bring in the latest code (`git pull` in that folder, or replace everything else from the zip), then skip to step 5.

## 3. Ask about their accounts

Ask these together (with AskUserQuestion if you have it):
1. **Which Google accounts?** For each one: a short name (shown when they hover over its icon) and, optionally, its email address (MailSmüsh fills it in on Google's sign-in page). Three is typical; one is fine.
2. **A picture or gif for each account's icon?** They can point you to an image file, or keep the cute defaults that come with it (a dancing man, a rocket and a piglet), or have a coloured letter instead.
3. **Which account should email links from other apps open in?** For example when they click someone's email address on a website.
4. **Make MailSmüsh their default email app?** Then email links open in it, rather than in Mail or the browser. They can change this later in Mail's settings.
5. **Hide the unread count** on any account? Useful for an inbox they don't want to be nudged by.

## 4. Write their settings

- Copy any image files they gave you into the `images` folder.
- Write `renderer/accounts.js`, in the same shape as `renderer/accounts.example.js` (read it first: it explains each setting). Give each account an id like `account1`, `account2`; a `name`; a `color`; `image` if they have one; `email` if they gave it; `opensMailtoLinks: true` on the account for email links; and `hideUnreadCount: true` where they asked. End the file with the same `module.exports` line as the example.

## 5. Build and install

Run `bash build-local.sh` in the source folder, adding `--default-mail-app` if they said yes to step 3.4. Tell them it takes a few minutes: it downloads what it needs, builds the app and copies it to Applications. If an older MailSmüsh is open, ask them to quit it first.

If the build fails, read the error and fix what you can (most often an old Node.js version, or no internet connection). Don't change the app's code to get round an error without asking them.

## 6. Open it

Run `open /Applications/MailSmush.app`, and tell them:
- Sign in to each account once, in its Gmail. Each account stays signed in on its own from then on.
- MailSmüsh may offer to save each password in the Mac's keychain, unlocked with Touch ID, so it can fill it in next time Google asks. That's their choice.
- To keep it in the Dock, right-click its icon, then Options → Keep in Dock.
- To change accounts or pictures later, they can ask Claude Code ("add an account to MailSmüsh"). Edit `renderer/accounts.js` and run `bash build-local.sh` again.
- To update it, they paste the same setup line again: their accounts and pictures are kept.
- To remove it, drag MailSmüsh from Applications to the Bin.
