const { app, BrowserWindow, Menu } = require('electron')

const createWindow = () => {
    const win = new BrowserWindow({
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