// Accounts come from accounts.js (yours, kept out of git) or, failing that, accounts.example.js,
// which index.html loads first. accounts.example.js explains each setting.
const accounts = MAILSMUSH_ACCOUNTS;
// The account whose inbox opens behind the compose window when you click an email link elsewhere
const mailtoAccountId = (accounts.find((a) => a.opensMailtoLinks) || accounts[0]).id;

// URLs
const GMAIL_URL = 'https://mail.google.com';
const CALENDAR_URL = 'https://calendar.google.com';

// Check if URL is a Google redirect (used for external links in Gmail)
function isGoogleRedirectUrl(url) {
  try {
    const parsed = new URL(url);
    return (parsed.hostname === 'www.google.com' || parsed.hostname === 'google.com') &&
           parsed.pathname === '/url' &&
           parsed.searchParams.has('q');
  } catch {
    return false;
  }
}

// Extract the actual URL from a Google redirect
function extractRedirectUrl(url) {
  try {
    const parsed = new URL(url);
    return parsed.searchParams.get('q') || url;
  } catch {
    return url;
  }
}

// Check if URL is part of Google auth flow (but NOT a redirect)
function isGoogleUrl(url) {
  try {
    const parsed = new URL(url);
    if (isGoogleRedirectUrl(url)) {
      return false;
    }
    // Only match actual auth-related domains, not all Google services
    const authDomains = [
      'accounts.google.com',
      'myaccount.google.com',
      'login.google.com'
    ];
    return authDomains.includes(parsed.hostname);
  } catch {
    return false;
  }
}

// State
let currentAccountId = accounts[0].id;
let currentView = 'gmail'; // 'gmail' or 'calendar'
const unreadCounts = {};
let touchIDAuthenticated = false;
const pendingPasswordSaves = new Map(); // Track accounts that need password saving

// Icons as SVG strings
const gmailIcon = `<svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
  <path d="M20 4H4c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V6c0-1.1-.9-2-2-2zm0 4l-8 5-8-5V6l8 5 8-5v2z"/>
</svg>`;

const calendarIcon = `<svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
  <path d="M19 3h-1V1h-2v2H8V1H6v2H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2zm0 16H5V8h14v11zM9 10H7v2h2v-2zm4 0h-2v2h2v-2zm4 0h-2v2h2v-2zm-8 4H7v2h2v-2zm4 0h-2v2h2v-2zm4 0h-2v2h2v-2z"/>
</svg>`;

// Initialize the app
async function init() {
  createSidebar();
  createWebviews();
  startUnreadCountPolling();
  setupAuthCompleteListener();
  setupMailtoHandler();
  setupRefreshButton();
  setupKeyboardShortcuts();
  createPasswordSaveDialog();

  // Authenticate with Touch ID on startup
  await authenticateOnStartup();

  // Set initial view
  switchToAccount(accounts[0].id, 'gmail');
}

// Handle mailto: links from the OS: open a compose window in the mailto account
function setupMailtoHandler() {
  if (window.electronAPI && window.electronAPI.onOpenMailto) {
    window.electronAPI.onOpenMailto((mailtoUrl) => {
      // Parse the mailto: URL
      let to = '', subject = '', body = '';
      try {
        // mailto:someone@example.com?subject=Hi&body=Hello
        const withoutScheme = mailtoUrl.replace(/^mailto:/, '');
        const qIndex = withoutScheme.indexOf('?');
        if (qIndex !== -1) {
          to = decodeURIComponent(withoutScheme.substring(0, qIndex));
          const params = new URLSearchParams(withoutScheme.substring(qIndex + 1));
          subject = params.get('subject') || '';
          body = params.get('body') || '';
        } else {
          to = decodeURIComponent(withoutScheme);
        }
      } catch (e) {
        to = mailtoUrl.replace(/^mailto:/, '');
      }

      // Build Gmail compose URL
      const composeParams = new URLSearchParams({ view: 'cm', to, su: subject, body });
      const composeUrl = `https://mail.google.com/mail/?${composeParams.toString()}`;

      // Switch to that account so its inbox is visible behind the popup
      switchToAccount(mailtoAccountId, 'gmail');

      // Open compose in a small popup window (keeps inbox intact)
      if (window.electronAPI && window.electronAPI.openComposePopup) {
        window.electronAPI.openComposePopup(composeUrl, mailtoAccountId);
      }
    });
  }
}

// Authenticate with Touch ID on app startup
async function authenticateOnStartup() {
  if (window.electronAPI && window.electronAPI.authenticateTouchID) {
    try {
      const result = await window.electronAPI.authenticateTouchID();
      touchIDAuthenticated = result.success;
      if (result.success) {
        console.log('Touch ID authentication successful');
      }
    } catch (error) {
      console.error('Touch ID authentication failed:', error);
    }
  }
}

// Create password save dialog
function createPasswordSaveDialog() {
  const dialog = document.createElement('div');
  dialog.id = 'password-save-dialog';
  dialog.className = 'password-dialog hidden';
  dialog.innerHTML = `
    <div class="password-dialog-content">
      <p>Save password for <span id="password-save-account"></span>?</p>
      <div class="password-dialog-buttons">
        <button id="password-save-yes">Save</button>
        <button id="password-save-no">Not now</button>
      </div>
    </div>
  `;
  document.body.appendChild(dialog);

  document.getElementById('password-save-yes').addEventListener('click', async () => {
    const accountId = dialog.dataset.accountId;
    const password = dialog.dataset.password;
    if (accountId && password && window.electronAPI) {
      await window.electronAPI.savePassword(accountId, password);
    }
    hidePasswordSaveDialog();
  });

  document.getElementById('password-save-no').addEventListener('click', () => {
    hidePasswordSaveDialog();
  });
}

// Show password save dialog
function showPasswordSaveDialog(accountId, accountName, password) {
  const dialog = document.getElementById('password-save-dialog');
  document.getElementById('password-save-account').textContent = accountName;
  dialog.dataset.accountId = accountId;
  dialog.dataset.password = password;
  dialog.classList.remove('hidden');
}

// Hide password save dialog
function hidePasswordSaveDialog() {
  const dialog = document.getElementById('password-save-dialog');
  dialog.classList.add('hidden');
  dialog.dataset.accountId = '';
  dialog.dataset.password = '';
}

// Setup refresh button
function setupRefreshButton() {
  const refreshBtn = document.getElementById('refresh-btn');
  if (refreshBtn) {
    refreshBtn.addEventListener('click', refreshCurrentWebview);
  }
}

// Setup keyboard shortcuts
function setupKeyboardShortcuts() {
  document.addEventListener('keydown', (e) => {
    // Cmd+R to refresh
    if ((e.metaKey || e.ctrlKey) && e.key === 'r') {
      e.preventDefault();
      refreshCurrentWebview();
    }
  });
}

// Refresh the currently visible webview
function refreshCurrentWebview() {
  const webview = document.getElementById(`webview-${currentView}-${currentAccountId}`);
  if (webview) {
    webview.reload();
  }
}

// Listen for auth completion from main process
function setupAuthCompleteListener() {
  if (window.electronAPI && window.electronAPI.onAuthComplete) {
    window.electronAPI.onAuthComplete((data) => {
      console.log('Auth complete:', data);
      // Reload webviews for the account that just authenticated
      // The partition name format is like "persist:account1" -> extract "account1"
      if (data.partition) {
        const accountId = data.partition;
        reloadWebviewsForAccount(accountId);
      } else {
        // If we can't determine the account, reload all webviews
        reloadAllWebviews();
      }
    });
  }
}

// Reload webviews for a specific account
function reloadWebviewsForAccount(accountId) {
  const gmailWebview = document.getElementById(`webview-gmail-${accountId}`);
  const calendarWebview = document.getElementById(`webview-calendar-${accountId}`);

  if (gmailWebview) {
    gmailWebview.reload();
  }
  if (calendarWebview) {
    calendarWebview.reload();
  }
}

// Reload all webviews
function reloadAllWebviews() {
  accounts.forEach(account => {
    reloadWebviewsForAccount(account.id);
  });
}

// Create the sidebar with account icons
function createSidebar() {
  const container = document.getElementById('accounts-container');

  accounts.forEach((account, index) => {
    const accountItem = document.createElement('div');
    accountItem.className = 'account-item';
    accountItem.id = `account-item-${account.id}`;

    // Account icon with badge
    const iconContainer = document.createElement('div');
    iconContainer.className = 'account-icon-container';
    iconContainer.onclick = () => switchToAccount(account.id, 'gmail');

    const icon = document.createElement('div');
    icon.className = 'account-icon';
    icon.id = `account-icon-${account.id}`;

    // Use image if specified, otherwise use first letter
    if (account.image) {
      const img = document.createElement('img');
      img.src = `../images/${account.image}`;
      img.alt = account.name;
      img.className = 'account-image';
      img.onerror = () => {
        // Fallback to letter if image fails to load
        img.remove();
        icon.style.backgroundColor = darkenColor(account.color, 30);
        icon.textContent = account.name.charAt(0).toUpperCase();
      };
      icon.appendChild(img);
    } else {
      icon.style.backgroundColor = darkenColor(account.color, 30);
      icon.textContent = account.name.charAt(0).toUpperCase();
    }

    const badge = document.createElement('div');
    badge.className = 'unread-badge hidden';
    badge.id = `badge-${account.id}`;
    badge.textContent = '0';

    iconContainer.appendChild(icon);
    iconContainer.appendChild(badge);

    // Sub-view tabs
    const subviewTabs = document.createElement('div');
    subviewTabs.className = 'subview-tabs';

    const gmailTab = document.createElement('button');
    gmailTab.className = 'subview-tab';
    gmailTab.id = `gmail-tab-${account.id}`;
    gmailTab.innerHTML = gmailIcon;
    gmailTab.title = 'Gmail';
    gmailTab.onclick = (e) => {
      e.stopPropagation();
      switchToAccount(account.id, 'gmail');
    };

    const calendarTab = document.createElement('button');
    calendarTab.className = 'subview-tab';
    calendarTab.id = `calendar-tab-${account.id}`;
    calendarTab.innerHTML = calendarIcon;
    calendarTab.title = 'Calendar';
    calendarTab.onclick = (e) => {
      e.stopPropagation();
      switchToAccount(account.id, 'calendar');
    };

    subviewTabs.appendChild(gmailTab);
    subviewTabs.appendChild(calendarTab);

    accountItem.appendChild(iconContainer);
    accountItem.appendChild(subviewTabs);

    container.appendChild(accountItem);

    // Add divider between accounts (except after last)
    if (index < accounts.length - 1) {
      const divider = document.createElement('div');
      divider.className = 'account-divider';
      container.appendChild(divider);
    }
  });
}

// Create webviews for each account (both Gmail and Calendar)
function createWebviews() {
  const container = document.getElementById('webviews-container');

  // User agent to appear as a regular Chrome browser (helps with Google sign-in and password managers)
  const userAgent = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/136.0.0.0 Safari/537.36';

  accounts.forEach(account => {
    // Gmail webview
    const gmailWebview = document.createElement('webview');
    gmailWebview.id = `webview-gmail-${account.id}`;
    gmailWebview.className = 'hidden';
    gmailWebview.setAttribute('partition', `persist:${account.id}`);
    gmailWebview.setAttribute('src', GMAIL_URL);
    gmailWebview.setAttribute('allowpopups', 'true');
    gmailWebview.setAttribute('useragent', userAgent);
    gmailWebview.setAttribute('webpreferences', 'spellcheck=yes');

    // Calendar webview
    const calendarWebview = document.createElement('webview');
    calendarWebview.id = `webview-calendar-${account.id}`;
    calendarWebview.className = 'hidden';
    calendarWebview.setAttribute('partition', `persist:${account.id}`);
    calendarWebview.setAttribute('src', CALENDAR_URL);
    calendarWebview.setAttribute('allowpopups', 'true');
    calendarWebview.setAttribute('useragent', userAgent);
    calendarWebview.setAttribute('webpreferences', 'spellcheck=yes');

    container.appendChild(gmailWebview);
    container.appendChild(calendarWebview);

    // Set up event listeners for title changes (unread count)
    gmailWebview.addEventListener('page-title-updated', (event) => {
      updateUnreadCount(account.id, event.title);
    });

    gmailWebview.addEventListener('did-navigate', () => {
      checkUnreadCount(account.id);
    });

    gmailWebview.addEventListener('did-navigate-in-page', () => {
      checkUnreadCount(account.id);
    });

    // Auto-fill email and password when login pages load
    gmailWebview.addEventListener('dom-ready', () => {
      gmailWebview.setAudioMuted(true);
      if (account.email) {
        autoFillEmail(gmailWebview, account.email);
        autoFillPassword(gmailWebview, account.id);
      }
    });

    calendarWebview.addEventListener('dom-ready', () => {
      calendarWebview.setAudioMuted(true);
      if (account.email) {
        autoFillEmail(calendarWebview, account.email);
        autoFillPassword(calendarWebview, account.id);
      }
    });

    // Setup password capture for saving
    setupPasswordCapture(gmailWebview, account);
    setupPasswordCapture(calendarWebview, account);

    // Handle new window requests - open external links in default browser
    gmailWebview.addEventListener('new-window', (event) => {
      event.preventDefault();
      let url = event.url;

      // Handle Google redirect URLs
      if (isGoogleRedirectUrl(url)) {
        url = extractRedirectUrl(url);
      }

      if (isGoogleUrl(url)) {
        // Google URLs (auth, etc.) - open in auth popup
        if (window.electronAPI && window.electronAPI.openAuthPopup) {
          window.electronAPI.openAuthPopup(url, account.id);
        }
      } else {
        // External URLs - open in default browser
        if (window.electronAPI && window.electronAPI.openExternal) {
          window.electronAPI.openExternal(url);
        }
      }
    });

    calendarWebview.addEventListener('new-window', (event) => {
      event.preventDefault();
      let url = event.url;

      // Handle Google redirect URLs
      if (isGoogleRedirectUrl(url)) {
        url = extractRedirectUrl(url);
      }

      if (isGoogleUrl(url)) {
        if (window.electronAPI && window.electronAPI.openAuthPopup) {
          window.electronAPI.openAuthPopup(url, account.id);
        }
      } else {
        if (window.electronAPI && window.electronAPI.openExternal) {
          window.electronAPI.openExternal(url);
        }
      }
    });
  });
}

// Auto-fill email on Google login page
function autoFillEmail(webview, email) {
  try {
    webview.executeJavaScript(`
      (function() {
        // Check if we're on a Google login page
        if (window.location.hostname === 'accounts.google.com') {
          // Find email input field
          const emailInput = document.querySelector('input[type="email"]');
          if (emailInput && !emailInput.value) {
            emailInput.value = '${email}';
            emailInput.dispatchEvent(new Event('input', { bubbles: true }));
          }
        }
      })();
    `).catch(() => {});
  } catch (e) {
    // Ignore errors
  }
}

// Auto-fill password on Google login page
async function autoFillPassword(webview, accountId) {
  if (!touchIDAuthenticated || !window.electronAPI) return;

  try {
    // Check if we have a saved password
    const hasPassword = await window.electronAPI.hasPassword(accountId);
    if (!hasPassword.exists) return;

    // Get the password
    const result = await window.electronAPI.getPassword(accountId);
    if (!result.success || !result.password) return;

    const password = result.password;

    webview.executeJavaScript(`
      (function() {
        if (window.location.hostname === 'accounts.google.com') {
          // Find password input field
          const passwordInput = document.querySelector('input[type="password"]');
          if (passwordInput && !passwordInput.value) {
            passwordInput.value = ${JSON.stringify(password)};
            passwordInput.dispatchEvent(new Event('input', { bubbles: true }));
            return true;
          }
        }
        return false;
      })();
    `).catch(() => {});
  } catch (e) {
    // Ignore errors
  }
}

// Capture password when user types it (for saving later)
function setupPasswordCapture(webview, account) {
  // Monitor for password entry and successful login
  webview.addEventListener('did-navigate', async (event) => {
    const url = event.url;

    // If we navigated to Gmail/Calendar, login was successful
    if (url.includes('mail.google.com') || url.includes('calendar.google.com')) {
      // Check if we have a pending password to save
      const pendingPassword = pendingPasswordSaves.get(account.id);
      if (pendingPassword && window.electronAPI) {
        // Check if password already exists
        const hasPassword = await window.electronAPI.hasPassword(account.id);
        if (!hasPassword.exists) {
          showPasswordSaveDialog(account.id, account.name, pendingPassword);
        }
        pendingPasswordSaves.delete(account.id);
      }
    }
  });

  // Inject script to capture password on login page
  webview.addEventListener('dom-ready', () => {
    webview.executeJavaScript(`
      (function() {
        if (window.location.hostname === 'accounts.google.com' && !window._passwordCaptureSetup) {
          window._passwordCaptureSetup = true;
          const observer = new MutationObserver(() => {
            const passwordInput = document.querySelector('input[type="password"]');
            if (passwordInput && !passwordInput._captureSetup) {
              passwordInput._captureSetup = true;
              passwordInput.addEventListener('input', (e) => {
                window._lastPassword = e.target.value;
              });
              // Also capture on form submit
              const form = passwordInput.closest('form');
              if (form) {
                form.addEventListener('submit', () => {
                  if (window._lastPassword) {
                    // Send password to main process through a custom event
                    window.postMessage({ type: 'password-captured', password: window._lastPassword }, '*');
                  }
                });
              }
            }
          });
          observer.observe(document.body, { childList: true, subtree: true });
        }
      })();
    `).catch(() => {});
  });

  // Listen for password capture messages
  webview.addEventListener('console-message', (event) => {
    // This is a backup method - the main capture happens via dom-ready
  });

  // Use ipc-message for password capture
  webview.addEventListener('ipc-message', (event) => {
    if (event.channel === 'password-captured') {
      pendingPasswordSaves.set(account.id, event.args[0]);
    }
  });
}

// Switch to a specific account and view
function switchToAccount(accountId, view) {
  currentAccountId = accountId;
  currentView = view;

  // Hide all webviews
  document.querySelectorAll('webview').forEach(wv => {
    wv.classList.add('hidden');
  });

  // Show the selected webview
  const selectedWebview = document.getElementById(`webview-${view}-${accountId}`);
  if (selectedWebview) {
    selectedWebview.classList.remove('hidden');
  }

  // Update sidebar UI
  updateSidebarUI();
}

// Update sidebar visual state
function updateSidebarUI() {
  // Update account icons
  accounts.forEach(account => {
    const icon = document.getElementById(`account-icon-${account.id}`);
    if (icon) {
      if (account.id === currentAccountId) {
        icon.classList.add('active');
      } else {
        icon.classList.remove('active');
      }
    }

    // Update subview tabs
    const gmailTab = document.getElementById(`gmail-tab-${account.id}`);
    const calendarTab = document.getElementById(`calendar-tab-${account.id}`);

    if (gmailTab) {
      gmailTab.classList.toggle('active', account.id === currentAccountId && currentView === 'gmail');
    }
    if (calendarTab) {
      calendarTab.classList.toggle('active', account.id === currentAccountId && currentView === 'calendar');
    }
  });
}

// Parse unread count from Gmail title
// Returns { count, hasCount } to distinguish between "0 unread" and "no count in title"
function parseUnreadCount(title) {
  if (!title) return { count: null, hasCount: false };

  // Gmail title format: "Inbox (5) - email@gmail.com" or just "Inbox - email@gmail.com"
  const match = title.match(/\((\d+)\)/);
  if (match) {
    return { count: parseInt(match[1], 10), hasCount: true };
  }
  // Title exists but no count - could be navigating away from inbox or loading
  return { count: null, hasCount: false };
}

// Update unread count for an account based on page title
function updateUnreadCount(accountId, title) {
  const result = parseUnreadCount(title);
  // Only update if title actually contains a count
  // This prevents hiding the badge when navigating away from inbox
  if (result.hasCount) {
    updateUnreadCountDirect(accountId, result.count);
  }
}

// Update unread count directly with a number
// If count is null/undefined, keep the previous value (used during page loads)
function updateUnreadCountDirect(accountId, count, forceUpdate = false) {
  // If count is null/undefined and not forcing, keep previous value
  if (count === null || count === undefined) {
    return;
  }

  // Only update if the count has changed, or if forcing update
  const previousCount = unreadCounts[accountId];
  if (!forceUpdate && previousCount === count) {
    return;
  }

  unreadCounts[accountId] = count;

  // Check if this account has hideUnreadCount enabled
  const account = accounts.find(a => a.id === accountId);
  if (account && account.hideUnreadCount) {
    return; // Don't show badge for this account
  }

  const badge = document.getElementById(`badge-${accountId}`);
  if (badge) {
    if (count > 0) {
      badge.textContent = count > 99 ? '99+' : count.toString();
      badge.classList.remove('hidden');
    } else {
      badge.classList.add('hidden');
    }
  }
}

// Check unread count by querying Gmail's sidebar
function checkUnreadCount(accountId) {
  const webview = document.getElementById(`webview-gmail-${accountId}`);
  if (webview) {
    try {
      // Try to get unread count from Gmail's sidebar, which always shows the inbox count
      webview.executeJavaScript(`
        (function() {
          // Method 1: Look for the inbox link in the sidebar with unread count
          // Gmail shows unread count in various elements near "Inbox"
          const inboxLinks = document.querySelectorAll('a[href*="#inbox"]');
          for (const link of inboxLinks) {
            // Check the link's text content or nearby elements for a number
            const text = link.textContent || '';
            const match = text.match(/(\\d+)/);
            if (match) {
              return { count: parseInt(match[1], 10), confident: true };
            }
            // Check parent and sibling elements
            const parent = link.closest('div[role="navigation"]') || link.parentElement;
            if (parent) {
              const countEl = parent.querySelector('.bsU') || parent.querySelector('[class*="unread"]');
              if (countEl) {
                const num = parseInt(countEl.textContent, 10);
                if (!isNaN(num)) return { count: num, confident: true };
              }
            }
          }

          // Method 2: Look for Gmail's specific unread count class
          const unreadBadges = document.querySelectorAll('.bsU');
          for (const badge of unreadBadges) {
            // Check if this badge is near "Inbox"
            const row = badge.closest('div[data-tooltip="Inbox"]') || badge.closest('[role="treeitem"]');
            if (row) {
              const text = row.textContent || '';
              if (text.includes('Inbox')) {
                const num = parseInt(badge.textContent, 10);
                if (!isNaN(num)) return { count: num, confident: true };
              }
            }
          }

          // Method 3: Fall back to page title if viewing inbox
          const title = document.title;
          const titleMatch = title.match(/\\((\\d+)\\)/);
          if (titleMatch) {
            return { count: parseInt(titleMatch[1], 10), confident: true };
          }

          // Check if Gmail UI is loaded (has navigation)
          const hasNav = document.querySelector('div[role="navigation"]');
          if (hasNav) {
            // Gmail is loaded but no unread count found - likely 0
            return { count: 0, confident: true };
          }

          // Gmail not fully loaded yet - don't update
          return { count: null, confident: false };
        })();
      `)
        .then(result => {
          if (result && result.confident) {
            updateUnreadCountDirect(accountId, result.count);
          }
          // If not confident, keep the previous count
        })
        .catch(() => {
          // Ignore errors (webview might not be ready) - keep previous count
        });
    } catch (e) {
      // Ignore errors - keep previous count
    }
  }
}

// Poll all accounts for unread counts
function pollUnreadCounts() {
  accounts.forEach(account => {
    checkUnreadCount(account.id);
  });
}

// Start polling for unread counts
function startUnreadCountPolling() {
  // Initial check after a delay to let webviews load
  setTimeout(pollUnreadCounts, 5000);

  // Poll every 5 seconds
  setInterval(pollUnreadCounts, 5000);
}

// Utility: Darken a hex color
function darkenColor(hex, percent) {
  const num = parseInt(hex.replace('#', ''), 16);
  const amt = Math.round(2.55 * percent);
  const R = Math.max((num >> 16) - amt, 0);
  const G = Math.max((num >> 8 & 0x00FF) - amt, 0);
  const B = Math.max((num & 0x0000FF) - amt, 0);
  return '#' + (0x1000000 + R * 0x10000 + G * 0x100 + B).toString(16).slice(1);
}

// Initialize when DOM is ready
document.addEventListener('DOMContentLoaded', init);
