// The app's menus on a desktop: the menu bar, and what is left of the web view's own menu on a right-click.
package main

import (
	"github.com/egoist/mygo"
	"github.com/egoist/mygo/plugins/updater"
)

// appMenu is the menu bar: MyGo's default one, with "Check for Updates…" under About, where a Mac app keeps it. Only
// macOS has a default menu bar (it is where copy, paste and quit get their shortcuts); the other systems' windows
// carry none, and the updater's own background check is how an update is found there. nil leaves the default alone.
// Called once the app is ready: the item's label is in the language the app runs in.
func appMenu(goos string) *mygo.Menu {
	if goos != "darwin" {
		return nil
	}
	return mygo.NewMenu([]*mygo.MenuItem{
		{Role: mygo.RoleAppMenu, Submenu: []*mygo.MenuItem{
			{Role: mygo.RoleAbout},
			updater.MenuItem(),
			mygo.Separator(),
			{Role: mygo.RoleServices},
			mygo.Separator(),
			{Role: mygo.RoleHide},
			{Role: mygo.RoleHideOthers},
			{Role: mygo.RoleUnhide},
			mygo.Separator(),
			{Role: mygo.RoleQuit},
		}},
		{Role: mygo.RoleFileMenu},
		{Role: mygo.RoleEditMenu},
		{Role: mygo.RoleViewMenu},
		{Role: mygo.RoleWindowMenu},
	})
}

// trimContextMenu takes the browser's items out of the web view's menu: the window is the app, not a page in a
// browser. The rest is the system's, and stays.
func trimContextMenu(e *mygo.ContextMenuEvent) {
	e.Menu.Remove(mygo.ContextMenuReload, mygo.ContextMenuBack, mygo.ContextMenuForward, mygo.ContextMenuInspect)
}
