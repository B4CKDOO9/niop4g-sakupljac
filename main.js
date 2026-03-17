const { app, BrowserWindow, Menu, shell, ipcMain } = require('electron')
const http = require('http')

let win
let activeOAuthServer  = null
let activeOAuthTimeout = null

// Register custom protocol for Google OAuth deep-link callback
// The OS will route sakupljac:// URLs back to this app after sign-in
app.setAsDefaultProtocolClient('sakupljac')

// Single-instance lock — on Windows, the second instance receives the deep-link
// URL as a command-line argument and forwards it to the first instance
const gotTheLock = app.requestSingleInstanceLock()
if (!gotTheLock) {
    app.quit()
} else {
    app.on('second-instance', (event, argv) => {
        const deepLink = argv.find(a => a.startsWith('sakupljac://'))
        if (deepLink && win) {
            win.webContents.send('oauth-callback', deepLink)
        }
        if (win) {
            if (win.isMinimized()) win.restore()
            win.focus()
        }
    })
}

// macOS: deep-link arrives via open-url event instead
app.on('open-url', (event, url) => {
    event.preventDefault()
    if (win) win.webContents.send('oauth-callback', url)
})

// IPC bridge: renderer calls this to open the OAuth URL in the system browser
ipcMain.handle('open-external', (_event, url) => shell.openExternal(url))

// Starts a one-shot local HTTP server on a random free port.
// Returns the port so the renderer can build the OAuth redirect URI.
// When the browser hits /callback?code=..., forwards the URL to the renderer and shuts down.
// Times out after 3 minutes if the user never completes sign-in.
function cleanupOAuthServer() {
    if (activeOAuthTimeout) { clearTimeout(activeOAuthTimeout); activeOAuthTimeout = null }
    if (activeOAuthServer)  { try { activeOAuthServer.close() } catch (_) {} activeOAuthServer = null }
}

ipcMain.handle('start-oauth-server', () => {
    // Close any lingering server from a previous attempt
    cleanupOAuthServer()

    return new Promise((resolve, reject) => {
        const server = http.createServer((req, res) => {
            if (req.url && req.url.startsWith('/callback')) {
                res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
                res.end('<h2>Prijava uspješna! Možete zatvoriti ovaj prozor.</h2>')
                if (win) win.webContents.send('oauth-callback', 'http://127.0.0.1' + req.url)
                clearTimeout(activeOAuthTimeout)
                activeOAuthTimeout = null
                setTimeout(() => { server.close(); activeOAuthServer = null }, 500)
            } else {
                res.writeHead(404); res.end()
            }
        })

        activeOAuthServer = server

        activeOAuthTimeout = setTimeout(() => {
            server.close()
            activeOAuthServer  = null
            activeOAuthTimeout = null
            if (win) win.webContents.send('oauth-server-timeout')
        }, 3 * 60 * 1000)

        server.listen(0, '127.0.0.1', () => {
            resolve(server.address().port)
        })
        server.on('error', (err) => {
            cleanupOAuthServer()
            reject(err)
        })
    })
})

ipcMain.handle('cancel-oauth-server', () => {
    cleanupOAuthServer()
})

// Renderer sends this just before window closes to delete a waiting room
ipcMain.handle('delete-waiting-room', async (_event, gameId) => {
    // Fire a Firestore REST delete — no Firebase SDK in main process
    const { net } = require('electron')
    const projectId = 'niop4g-sakupljac'
    const url = `https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents/games/${gameId}`
    return new Promise((resolve) => {
        const req = net.request({ method: 'DELETE', url })
        req.on('response', () => resolve())
        req.on('error', () => resolve())
        req.end()
    })
})

const createWindow = () => {
    win = new BrowserWindow({
        //fullscreen: true,
        width: 800,
        height: 850,
        webPreferences: {
            nodeIntegration: true,
            contextIsolation: false
        }
    })
    win.loadFile('index.html')
    //win.webContents.openDevTools()
    // Izbornik (menu bar)
    const menuTemplate = [
        {
            label: 'File',
            submenu: [
                {
                    label: 'Nova Igra',
                    accelerator: 'CmdOrCtrl+N',
                    click: () => {
                        win.webContents.send('menu-action', 'new-game');
                    }
                },
                { type: 'separator' },
                {
                    label: 'Quit',
                    accelerator: 'CmdOrCtrl+Q',
                    click: () => {
                        app.quit();
                    }
                }
            ]
        },
        {
            label: 'Game',
            submenu: [
                {
                    label: 'Reset Igru',
                    accelerator: 'CmdOrCtrl+R',
                    click: () => {
                        win.webContents.send('menu-action', 'reset-game');
                    }
                },
                {
                    label: 'Glavni Izbornik',
                    accelerator: 'CmdOrCtrl+M',
                    click: () => {
                        win.webContents.send('menu-action', 'main-menu');
                    }
                }
            ]
        },
        {
            label: 'Help',
            submenu: [
                {
                    label: 'Pravila',
                    click: () => {
                        win.webContents.send('menu-action', 'show-rules');
                    }
                }
            ]
        }
    ];

    const menu = Menu.buildFromTemplate(menuTemplate);
    Menu.setApplicationMenu(menu);
}

app.whenReady().then(() => {
    createWindow()
})