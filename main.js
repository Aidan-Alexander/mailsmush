const { app, BrowserWindow, ipcMain, session, shell, systemPreferences } = require('electron');
const path = require('path');
const keytar = require('keytar');

const SERVICE_NAME = 'com.mailsmush.app';

// Register as default mailto handler (must be before app ready)
app.setAsDefaultProtocolClient('mailto');

// Enforce single instance - forward mailto URLs to existing instance
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
}

// Store pending mailto URL if received before window is ready
let pendingMailtoUrl = null;

// Handle mailto: links from OS (macOS open-url event)
app.on('open-url', (event, url) => {
  event.preventDefault();
  if (url.startsWith('mailto:')) {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.show();
      mainWindow.focus();
      mainWindow.webContents.send('open-mailto', url);
    } else {
      pendingMailtoUrl = url;
    }
  }
});

// Accounts: renderer/accounts.js is yours (kept out of git); accounts.example.js is the template
let accounts;
try {
  accounts = require('./renderer/accounts.js');
} catch (e) {
  accounts = require('./renderer/accounts.example.js');
}

// Map partition names to account info
const partitionToAccount = new Map();
accounts.forEach(acc => {
  partitionToAccount.set(acc.id, acc);
  partitionToAccount.set(`persist:${acc.id}`, acc);
});

let mainWindow;

// Track popup windows and their source webview info
const popupWindows = new Map();

// Store webview sessions by partition name for auth popups
const webviewSessions = new Map();

// Track if user has authenticated with Touch ID this session
let sessionAuthenticated = false;

// Track captured passwords for each account during login
const capturedPasswords = new Map();

// Auto-fill credentials in popup window and capture password for saving
async function setupPopupAutoFill(popup, partitionName) {
  const account = partitionToAccount.get(partitionName);
  if (!account) return;

  // Function to inject auto-fill and password capture
  const injectScripts = async () => {
    const url = popup.webContents.getURL();
    if (!url.includes('accounts.google.com')) return;

    // Auto-fill email
    if (account.email) {
      await popup.webContents.executeJavaScript(`
        (function() {
          const emailInput = document.querySelector('input[type="email"]');
          if (emailInput && !emailInput.value) {
            emailInput.value = ${JSON.stringify(account.email)};
            emailInput.dispatchEvent(new Event('input', { bubbles: true }));
          }
        })();
      `).catch(() => {});
    }

    // Auto-fill password if we have one saved and are authenticated
    if (sessionAuthenticated) {
      try {
        const password = await keytar.getPassword(SERVICE_NAME, account.id);
        if (password) {
          await popup.webContents.executeJavaScript(`
            (function() {
              const passwordInput = document.querySelector('input[type="password"]');
              if (passwordInput && !passwordInput.value) {
                passwordInput.value = ${JSON.stringify(password)};
                passwordInput.dispatchEvent(new Event('input', { bubbles: true }));
              }
            })();
          `).catch(() => {});
        }
      } catch (e) {}
    }

    // Setup password capture - monitor password input
    await popup.webContents.executeJavaScript(`
      (function() {
        if (window._pwCaptureSetup) return;
        window._pwCaptureSetup = true;

        // Watch for password field
        const observer = new MutationObserver(() => {
          const pwInput = document.querySelector('input[type="password"]');
          if (pwInput && !pwInput._captured) {
            pwInput._captured = true;
            pwInput.addEventListener('input', (e) => {
              window._capturedPassword = e.target.value;
            });
            pwInput.addEventListener('change', (e) => {
              window._capturedPassword = e.target.value;
            });
          }
        });
        observer.observe(document.body, { childList: true, subtree: true });

        // Also check immediately
        const pwInput = document.querySelector('input[type="password"]');
        if (pwInput && !pwInput._captured) {
          pwInput._captured = true;
          pwInput.addEventListener('input', (e) => {
            window._capturedPassword = e.target.value;
          });
          pwInput.addEventListener('change', (e) => {
            window._capturedPassword = e.target.value;
          });
        }
      })();
    `).catch(() => {});
  };

  // Inject on various events for better coverage
  popup.webContents.on('did-finish-load', injectScripts);
  popup.webContents.on('dom-ready', () => setTimeout(injectScripts, 300));
  popup.webContents.on('did-navigate', () => setTimeout(injectScripts, 300));
  popup.webContents.on('did-navigate-in-page', () => setTimeout(injectScripts, 300));

  // Before closing or navigating away, try to capture the password
  popup.webContents.on('will-navigate', async (event, url) => {
    try {
      const captured = await popup.webContents.executeJavaScript('window._capturedPassword || ""').catch(() => '');
      if (captured) {
        capturedPasswords.set(account.id, captured);
      }
    } catch (e) {}
  });
}

// Show password save dialog
function showPasswordSavePrompt(accountId, accountName) {
  const { dialog } = require('electron');

  dialog.showMessageBox(mainWindow, {
    type: 'question',
    buttons: ['Save Password', 'Not Now'],
    defaultId: 0,
    title: 'Save Password',
    message: `Save password for ${accountName}?`,
    detail: 'Your password will be stored securely in your macOS Keychain and protected by Touch ID.'
  }).then(async (result) => {
    if (result.response === 0) {
      const password = capturedPasswords.get(accountId);
      if (password) {
        await keytar.setPassword(SERVICE_NAME, accountId, password);
      }
    }
    capturedPasswords.delete(accountId);
  });
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 800,
    minHeight: 600,
    titleBarStyle: 'hiddenInset',
    trafficLightPosition: { x: 12, y: 12 },
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.js'),
      webviewTag: true
    }
  });

  mainWindow.loadFile(path.join(__dirname, 'renderer', 'index.html'));

  // Send any pending mailto URL once renderer is ready
  mainWindow.webContents.once('did-finish-load', () => {
    if (pendingMailtoUrl) {
      mainWindow.webContents.send('open-mailto', pendingMailtoUrl);
      pendingMailtoUrl = null;
    }
  });

  // Open DevTools in development
  // mainWindow.webContents.openDevTools();
}

app.whenReady().then(() => {
  if (app.dock) {
    app.dock.setIcon(path.join(__dirname, 'images', 'icon.png'));
  }

  // Strip Electron from user-agent; Google blocks requests that identify as Electron
  const stripElectronUA = (sess) => {
    const ua = sess.getUserAgent().replace(/\s*Electron\/[\d.]+/, '');
    sess.setUserAgent(ua);
  };
  stripElectronUA(session.defaultSession);
  accounts.forEach(acc => stripElectronUA(session.fromPartition(`persist:${acc.id}`)));

  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

// Check if URL is a Google service URL (after auth completes)
function isGoogleServiceUrl(url) {
  try {
    const parsed = new URL(url);
    return parsed.hostname === 'mail.google.com' ||
           parsed.hostname === 'calendar.google.com';
  } catch {
    return false;
  }
}

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

// Check if URL is part of Google auth flow (but NOT a redirect to external site)
function isGoogleAuthUrl(url) {
  try {
    const parsed = new URL(url);
    // Don't treat Google redirect URLs as auth URLs
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

// Extract partition name from session
function getPartitionFromSession(sess) {
  // Try to extract partition name from the session's storage path
  if (sess && sess.storagePath) {
    const parts = sess.storagePath.split('/');
    const partitionPart = parts.find(p => p.startsWith('Partitions'));
    if (partitionPart) {
      const idx = parts.indexOf(partitionPart);
      if (idx >= 0 && parts[idx + 1]) {
        return parts[idx + 1];
      }
    }
    // Fallback: get last meaningful segment
    return parts[parts.length - 1];
  }
  return null;
}

// Handle webview permission requests and new windows
app.on('web-contents-created', (event, contents) => {
  // Handle webview attachment
  contents.on('will-attach-webview', (event, webPreferences, params) => {
    webPreferences.nodeIntegration = false;
    webPreferences.contextIsolation = true;
  });

  // Handle permission requests
  contents.session.setPermissionRequestHandler((webContents, permission, callback) => {
    const allowedPermissions = ['media', 'geolocation', 'clipboard-read'];
    callback(allowedPermissions.includes(permission));
  });

  // Handle new window requests (popups) from webviews
  contents.setWindowOpenHandler(({ url }) => {
    // Handle Google redirect URLs - extract actual destination and open in browser
    if (isGoogleRedirectUrl(url)) {
      const actualUrl = extractRedirectUrl(url);
      shell.openExternal(actualUrl);
      return { action: 'deny' };
    }

    // For Google auth and related URLs, open in a popup window
    if (isGoogleAuthUrl(url) || isGoogleServiceUrl(url)) {
      // Get the partition name from the source webview's session
      const partitionName = getPartitionFromSession(contents.session);

      // Create a popup window using the SAME session as the source webview
      const popup = new BrowserWindow({
        width: 500,
        height: 700,
        parent: mainWindow,
        webPreferences: {
          nodeIntegration: false,
          contextIsolation: true,
          // Use the exact same session object from the source webview
          session: contents.session
        }
      });

      popup.loadURL(url);

      // Track this popup with partition info
      popupWindows.set(popup.id, {
        partitionName,
        sourceSession: contents.session
      });

      // Setup auto-fill for this popup
      setupPopupAutoFill(popup, partitionName);

      // Monitor navigation in popup
      popup.webContents.on('did-navigate', async (event, navUrl) => {
        // If navigated to Gmail or Calendar (auth complete), close popup and reload webview
        if (isGoogleServiceUrl(navUrl)) {
          const info = popupWindows.get(popup.id);

          // Try to capture password before closing
          try {
            const captured = await popup.webContents.executeJavaScript('window._capturedPassword || ""').catch(() => '');
            if (captured && info && info.partitionName) {
              const account = partitionToAccount.get(info.partitionName);
              if (account) {
                capturedPasswords.set(account.id, captured);
              }
            }
          } catch (e) {}

          if (info && mainWindow && !mainWindow.isDestroyed()) {
            // Tell renderer to reload the webviews for this partition
            mainWindow.webContents.send('auth-complete', {
              partition: info.partitionName,
              url: navUrl
            });

            // Check if we should prompt to save password
            const account = partitionToAccount.get(info.partitionName);
            if (account && capturedPasswords.has(account.id)) {
              // Check if password already saved
              const existingPassword = await keytar.getPassword(SERVICE_NAME, account.id);
              if (!existingPassword) {
                // Delay slightly to let popup close first
                setTimeout(() => {
                  showPasswordSavePrompt(account.id, account.name);
                }, 500);
              } else {
                capturedPasswords.delete(account.id);
              }
            }
          }
          popup.close();
        }
      });

      popup.on('closed', () => {
        popupWindows.delete(popup.id);
      });

      return { action: 'deny' }; // We handled it ourselves
    }

    // For other URLs, open in the system default browser (Chrome, etc.)
    shell.openExternal(url);
    return { action: 'deny' };
  });
});

// IPC handler for opening a Gmail compose popup (called from renderer for mailto: links)
ipcMain.on('open-compose-popup', (event, { composeUrl, partition }) => {
  const sess = session.fromPartition(`persist:${partition}`);

  const popup = new BrowserWindow({
    width: 640,
    height: 520,
    title: 'New Message',
    parent: mainWindow,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      session: sess
    }
  });

  popup.loadURL(composeUrl);
});

// IPC handler for opening URLs in external browser (called from renderer)
ipcMain.on('open-external', (event, url) => {
  shell.openExternal(url);
});

// IPC handler for opening auth popup (called from renderer when webview needs auth)
ipcMain.on('open-auth-popup', (event, { url, partition }) => {
  // Get the session for this partition
  const sess = session.fromPartition(`persist:${partition}`);

  const popup = new BrowserWindow({
    width: 500,
    height: 700,
    parent: mainWindow,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      session: sess
    }
  });

  popup.loadURL(url);

  // Setup auto-fill for this popup
  setupPopupAutoFill(popup, partition);

  // Monitor navigation in popup
  popup.webContents.on('did-navigate', async (event, navUrl) => {
    if (isGoogleServiceUrl(navUrl)) {
      // Try to capture password before closing
      try {
        const captured = await popup.webContents.executeJavaScript('window._capturedPassword || ""').catch(() => '');
        const account = partitionToAccount.get(partition);
        if (captured && account) {
          capturedPasswords.set(account.id, captured);
        }
      } catch (e) {}

      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('auth-complete', {
          partition: partition,
          url: navUrl
        });

        // Check if we should prompt to save password
        const account = partitionToAccount.get(partition);
        if (account && capturedPasswords.has(account.id)) {
          const existingPassword = await keytar.getPassword(SERVICE_NAME, account.id);
          if (!existingPassword) {
            setTimeout(() => {
              showPasswordSavePrompt(account.id, account.name);
            }, 500);
          } else {
            capturedPasswords.delete(account.id);
          }
        }
      }
      popup.close();
    }
  });
});

// Touch ID authentication - once per session
ipcMain.handle('authenticate-touch-id', async () => {
  if (sessionAuthenticated) {
    return { success: true, alreadyAuthenticated: true };
  }

  try {
    // Check if Touch ID is available
    const canPrompt = systemPreferences.canPromptTouchID();
    if (!canPrompt) {
      // No Touch ID available, auto-authenticate
      sessionAuthenticated = true;
      return { success: true, noTouchID: true };
    }

    await systemPreferences.promptTouchID('access your saved passwords');
    sessionAuthenticated = true;
    return { success: true };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

// Check if session is authenticated
ipcMain.handle('is-session-authenticated', () => {
  return sessionAuthenticated;
});

// Save password to Keychain
ipcMain.handle('save-password', async (event, { accountId, password }) => {
  try {
    await keytar.setPassword(SERVICE_NAME, accountId, password);
    return { success: true };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

// Get password from Keychain (only if session authenticated)
ipcMain.handle('get-password', async (event, { accountId }) => {
  if (!sessionAuthenticated) {
    return { success: false, error: 'Not authenticated' };
  }

  try {
    const password = await keytar.getPassword(SERVICE_NAME, accountId);
    return { success: true, password };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

// Check if password exists for account
ipcMain.handle('has-password', async (event, { accountId }) => {
  try {
    const password = await keytar.getPassword(SERVICE_NAME, accountId);
    return { exists: !!password };
  } catch (error) {
    return { exists: false };
  }
});

// Delete password from Keychain
ipcMain.handle('delete-password', async (event, { accountId }) => {
  try {
    await keytar.deletePassword(SERVICE_NAME, accountId);
    return { success: true };
  } catch (error) {
    return { success: false, error: error.message };
  }
});
