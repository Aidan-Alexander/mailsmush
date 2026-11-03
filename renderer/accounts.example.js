// Your accounts. Copy this file to accounts.js, in this folder, and edit it: accounts.js is yours and
// stays out of git. Each account gets its own Gmail and Calendar, kept signed in separately.
//   id               any short name, different for each account. Don't change it later, or you'll
//                    have to sign in to that account again
//   name             shown when you hover over the account's icon
//   color            used for the icon when there's no image
//   image            optional: a picture or gif in the images folder, shown as the account's icon
//   email            optional: filled in for you on Google's sign-in page
//   hideUnreadCount  optional: true hides that account's unread badge
//   opensMailtoLinks optional: true on the account that email links from other apps open in
var MAILSMUSH_ACCOUNTS = [
  { id: 'account1', name: 'Personal', color: '#4CAF50', image: 'personal.gif' },
  { id: 'account2', name: 'Work', color: '#9C27B0', image: 'aim.gif', opensMailtoLinks: true },
  { id: 'account3', name: 'Side project', color: '#FF5722', image: 'farmkind.gif', hideUnreadCount: true }
];
if (typeof module !== 'undefined') module.exports = MAILSMUSH_ACCOUNTS;
